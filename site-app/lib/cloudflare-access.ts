// Verifies Cloudflare Access application tokens (the Cf-Access-Jwt-Assertion
// header): an RS256 signature by one of the team's published signing keys, the
// team issuer, the application audience and the validity window. Anything else
// is rejected with an AccessTokenError, including service tokens, which carry
// no user. See docs/security/identity.md.

/** Why a token was rejected. The message never contains the token. */
export class AccessTokenError extends Error {}

/** The user an accepted token names. */
export type AccessClaims = { sub: string; email: string; name: string | null };

export type AccessVerifierOptions = {
  /** `https://<team>.cloudflareaccess.com`, from accessIssuer(). */
  issuer: string;
  /** Application audience (AUD) tags; the token must name one of them. */
  audiences: string[];
  fetch?: typeof fetch;
  now?: () => number;
  /** How long fetched signing keys are used before they are fetched again. */
  keyTtlMs?: number;
  /** Minimum time between fetches triggered by an unknown key id. */
  refetchIntervalMs?: number;
};

export type AccessVerifier = { verify(token: string): Promise<AccessClaims> };

type Jwk = {
  kid?: unknown;
  kty?: unknown;
  alg?: unknown;
  use?: unknown;
  n?: unknown;
  e?: unknown;
};

const MAX_TOKEN_LENGTH = 8192;
const MAX_KEYS = 20;
const CLOCK_SKEW_SECONDS = 30;
const FETCH_TIMEOUT_MS = 5000;
const FAILURE_BACKOFF_MS = 5000;
const segment = /^[A-Za-z0-9_-]+$/;
const teamHost =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const encoder = new TextEncoder();

/**
 * The token issuer for a team domain given as `<team>`,
 * `<team>.cloudflareaccess.com` or `https://<team>.cloudflareaccess.com`, or
 * null when the value names no Cloudflare Access team.
 */
export function accessIssuer(teamDomain: string | undefined): string | null {
  let host = (teamDomain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/+$/, "");
  if (/^[a-z0-9-]+$/.test(host)) host += ".cloudflareaccess.com";
  return teamHost.test(host) ? "https://" + host : null;
}

export function createAccessVerifier(
  options: AccessVerifierOptions,
): AccessVerifier {
  const {
    issuer,
    audiences,
    fetch: fetchKeys = (input, init) => fetch(input, init),
    now = Date.now,
    keyTtlMs = 60 * 60 * 1000,
    refetchIntervalMs = 60 * 1000,
  } = options;
  const certsUrl = issuer + "/cdn-cgi/access/certs";
  let keys = new Map<string, CryptoKey>(),
    fetchedAt = -Infinity,
    failedAt = -Infinity,
    pending: Promise<void> | null = null;

  async function fetchSigningKeys() {
    try {
      const response = await fetchKeys(certsUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const body = (await response.json()) as { keys?: unknown };
      const next = new Map<string, CryptoKey>();
      for (const jwk of (Array.isArray(body.keys) ? body.keys : []).slice(
        0,
        MAX_KEYS,
      ) as Jwk[]) {
        if (
          jwk.kty !== "RSA" ||
          typeof jwk.kid !== "string" ||
          typeof jwk.n !== "string" ||
          typeof jwk.e !== "string" ||
          (jwk.alg !== undefined && jwk.alg !== "RS256") ||
          (jwk.use !== undefined && jwk.use !== "sig")
        )
          continue;
        next.set(
          jwk.kid,
          await crypto.subtle.importKey(
            "jwk",
            { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"],
          ),
        );
      }
      if (!next.size) throw new Error("no RS256 signing keys");
      keys = next;
      fetchedAt = now();
    } catch (error) {
      failedAt = now();
      throw new AccessTokenError(
        "signing keys unavailable (" +
          (error instanceof Error ? error.message : "unknown error") +
          ")",
      );
    }
  }
  function refresh() {
    if (now() - failedAt < FAILURE_BACKOFF_MS)
      return Promise.reject(
        new AccessTokenError("signing keys unavailable (retrying shortly)"),
      );
    pending ??= fetchSigningKeys().finally(() => (pending = null));
    return pending;
  }
  async function signingKey(kid: string) {
    if (now() - fetchedAt >= keyTtlMs) await refresh();
    let key = keys.get(kid);
    // A new key id after a rotation is fetched at most once per interval, so
    // made-up key ids cannot turn every request into a fetch.
    if (!key && now() - fetchedAt >= refetchIntervalMs) {
      await refresh();
      key = keys.get(kid);
    }
    if (!key) throw new AccessTokenError("unknown signing key");
    return key;
  }

  return {
    async verify(token) {
      const parts = token.length <= MAX_TOKEN_LENGTH ? token.split(".") : [];
      if (parts.length !== 3 || !parts.every((part) => segment.test(part)))
        throw new AccessTokenError("malformed token");
      const header = json(parts[0]);
      if (header.alg !== "RS256")
        throw new AccessTokenError("unsupported algorithm");
      if (header.crit !== undefined)
        throw new AccessTokenError("unsupported critical header");
      if (typeof header.kid !== "string" || !header.kid)
        throw new AccessTokenError("missing key id");
      const key = await signingKey(header.kid);
      if (
        !(await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          key,
          base64url(parts[2]),
          encoder.encode(parts[0] + "." + parts[1]),
        ))
      )
        throw new AccessTokenError("invalid signature");
      const claims = json(parts[1]);
      if (claims.iss !== issuer) throw new AccessTokenError("wrong issuer");
      const tokenAudiences =
        typeof claims.aud === "string"
          ? [claims.aud]
          : Array.isArray(claims.aud)
            ? claims.aud
            : [];
      if (!tokenAudiences.some((aud) => audiences.includes(aud)))
        throw new AccessTokenError("wrong audience");
      const seconds = now() / 1000;
      if (typeof claims.exp !== "number" || seconds >= claims.exp)
        throw new AccessTokenError("expired");
      if (
        (typeof claims.nbf === "number" &&
          seconds + CLOCK_SKEW_SECONDS < claims.nbf) ||
        (typeof claims.iat === "number" &&
          seconds + CLOCK_SKEW_SECONDS < claims.iat)
      )
        throw new AccessTokenError("not yet valid");
      if (
        typeof claims.sub !== "string" ||
        !claims.sub ||
        typeof claims.email !== "string" ||
        !claims.email
      )
        throw new AccessTokenError("no user identity");
      const name = typeof claims.name === "string" ? claims.name.trim() : "";
      return { sub: claims.sub, email: claims.email, name: name || null };
    },
  };
}

function base64url(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new AccessTokenError("malformed token");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(base64url(value)),
    );
  } catch {
    throw new AccessTokenError("malformed token");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new AccessTokenError("malformed token");
  return parsed as Record<string, unknown>;
}
