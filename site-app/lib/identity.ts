// Who is making the request. The Worker entry (build/sites-worker.ts) runs the
// adapter before the app sees a request: IDENTITY_MODE picks the one credential
// that is trusted, and with no mode configured every request is anonymous, so
// the API answers 401. Inbound oai-* headers are removed unless Sites dispatch
// set them. The trust boundary of each mode is in docs/security/identity.md.
import { AsyncLocalStorage } from "node:async_hooks";
import { SIGN_IN_PATH, SIGN_OUT_PATH, safeReturnPath } from "./auth-paths";
import {
  AccessTokenError,
  accessIssuer,
  createAccessVerifier,
  type AccessVerifier,
} from "./cloudflare-access";

export type Identity = {
  /** Stable key for user-owned records. */
  userId: string;
  email: string;
  /** The full name when the identity provider sent one, else the email. */
  displayName: string;
  fullName: string | null;
};

/** The Worker variables that configure identity (cloudflare-env.d.ts). */
export type IdentitySettings = {
  IDENTITY_MODE?: string;
  IDENTITY_TRUSTED_HEADERS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
};

export type IdentityConfig =
  /** Nothing trusted: every request is anonymous. */
  | { mode: "none"; problem?: string }
  /** OpenAI Sites dispatch: it strips and sets the oai-* identity headers. */
  | { mode: "sites" }
  /** A Cloudflare Access application token in Cf-Access-Jwt-Assertion. */
  | { mode: "cloudflare-access"; issuer: string; audiences: string[] }
  /** oai-* headers from a test client, on loopback requests only. */
  | { mode: "trusted-headers" }
  /** oai-* headers set by the development server's persona sign-in. */
  | { mode: "dev" };

/** The value IDENTITY_TRUSTED_HEADERS must have to enable trusted-headers. */
export const TRUSTED_HEADERS_OPT_IN = "loopback-tests";

/**
 * The identity mode the Worker variables select. A mode that is not fully
 * configured, or not allowed here, selects nothing and names the problem.
 */
export function identityConfig(
  settings: IdentitySettings,
  { devServer }: { devServer: boolean },
): IdentityConfig {
  const mode = settings.IDENTITY_MODE ?? "";
  switch (mode) {
    case "":
      return {
        mode: "none",
        problem:
          "no IDENTITY_MODE is configured, so every request is anonymous",
      };
    case "sites":
      return { mode: "sites" };
    case "dev":
      return devServer
        ? { mode: "dev" }
        : {
            mode: "none",
            problem: "IDENTITY_MODE=dev works only on the development server",
          };
    case "trusted-headers":
      return settings.IDENTITY_TRUSTED_HEADERS === TRUSTED_HEADERS_OPT_IN
        ? { mode: "trusted-headers" }
        : {
            mode: "none",
            problem:
              "IDENTITY_MODE=trusted-headers also needs IDENTITY_TRUSTED_HEADERS=" +
              TRUSTED_HEADERS_OPT_IN,
          };
    case "cloudflare-access": {
      const issuer = accessIssuer(settings.CF_ACCESS_TEAM_DOMAIN);
      const audiences = (settings.CF_ACCESS_AUD ?? "")
        .split(",")
        .map((aud) => aud.trim())
        .filter(Boolean);
      if (!issuer)
        return {
          mode: "none",
          problem:
            "CF_ACCESS_TEAM_DOMAIN must name the Access team (<team>.cloudflareaccess.com)",
        };
      if (!audiences.length)
        return {
          mode: "none",
          problem:
            "CF_ACCESS_AUD must list the Access application audience tag",
        };
      return { mode: "cloudflare-access", issuer, audiences };
    }
    default:
      return {
        mode: "none",
        problem: "unknown IDENTITY_MODE " + JSON.stringify(mode.slice(0, 40)),
      };
  }
}

export type Authentication = {
  identity: Identity | null;
  /** The request to hand to the app: without oai-* headers unless sites. */
  request: Request;
};

/** Resolves the caller under `config` and strips headers the app must not trust. */
export async function authenticate(
  request: Request,
  config: IdentityConfig,
): Promise<Authentication> {
  return {
    identity: await resolve(request, config),
    request:
      config.mode === "sites" ? request : withoutDispatchHeaders(request),
  };
}

async function resolve(
  request: Request,
  config: IdentityConfig,
): Promise<Identity | null> {
  switch (config.mode) {
    case "none":
      if (config.problem) report(config.problem);
      return null;
    case "sites":
      return headerIdentity(request.headers);
    case "dev":
    case "trusted-headers":
      if (!isLoopback(request)) {
        report(config.mode + " mode refused a request that is not loopback");
        return null;
      }
      return headerIdentity(request.headers);
    case "cloudflare-access": {
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token) return null;
      try {
        const claims = await accessVerifier(config).verify(token);
        return {
          userId: claims.sub,
          email: claims.email,
          displayName: claims.name ?? claims.email,
          fullName: claims.name,
        };
      } catch (error) {
        if (!(error instanceof AccessTokenError)) throw error;
        report("Cloudflare Access token rejected: " + error.message);
        return null;
      }
    }
  }
}

const verifiers = new Map<string, AccessVerifier>();
/** One verifier, and so one signing-key cache, per team and audience list. */
function accessVerifier(config: {
  issuer: string;
  audiences: string[];
}): AccessVerifier {
  const key = config.issuer + " " + config.audiences.join(",");
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = createAccessVerifier(config);
    verifiers.set(key, verifier);
  }
  return verifier;
}

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

/** The identity in Sites-style oai-authenticated-user-* headers. */
function headerIdentity(headers: Headers): Identity | null {
  const userId = headers.get(USER_ID_HEADER);
  const email = headers.get(USER_EMAIL_HEADER);
  if (!userId || !email || userId.length > 256 || email.length > 320)
    return null;
  const encodedFullName = headers.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    headers.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)?.slice(0, 300) || null
      : null;
  return { userId, email, displayName: fullName ?? email, fullName };
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/**
 * Whether the request was addressed to and came from this machine. On
 * Cloudflare the edge sets CF-Connecting-IP to the real client and routes only
 * the Worker's own hostnames, so neither check passes there.
 */
function isLoopback(request: Request): boolean {
  const host = new URL(request.url).hostname.replace(/^\[|\]$/g, "");
  const client = request.headers.get("cf-connecting-ip");
  return (
    loopbackHosts.has(host) &&
    (client === null || loopbackAddresses.has(client))
  );
}

function withoutDispatchHeaders(request: Request): Request {
  const names = [...request.headers.keys()].filter((name) =>
    name.startsWith("oai-"),
  );
  if (!names.length) return request;
  const headers = new Headers(request.headers);
  for (const name of names) headers.delete(name);
  return new Request(request, { headers });
}

/**
 * The reserved sign-in routes in modes that have no dispatch or development
 * server to answer them: Cloudflare Access signs in on the way to the page and
 * signs out at its own logout URL; without an interactive sign-in they are 401.
 * Returns null where the app should handle the request.
 */
export function authRoute(
  request: Request,
  config: IdentityConfig,
): Response | null {
  const url = new URL(request.url);
  const signIn = url.pathname === SIGN_IN_PATH,
    signOut = url.pathname === SIGN_OUT_PATH;
  if ((!signIn && !signOut) || config.mode === "sites" || config.mode === "dev")
    return null;
  const headers = { "Cache-Control": "private, no-store" };
  if (
    !["GET", "HEAD"].includes(request.method) &&
    !(signOut && request.method === "POST")
  )
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: signIn ? "GET, HEAD" : "GET, HEAD, POST" },
    });
  if (config.mode === "cloudflare-access")
    return new Response(null, {
      status: request.method === "POST" ? 303 : 302,
      headers: {
        ...headers,
        Location: signOut
          ? "/cdn-cgi/access/logout"
          : safeReturnPath(url.searchParams.get("return_to")),
      },
    });
  return new Response(
    config.mode === "trusted-headers"
      ? "The test client sends the identity in trusted-headers mode."
      : "Sign-in is not configured for this deployment.",
    {
      status: 401,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}

const reported = new Set<string>();
/** Logs a configuration or rejection problem once per isolate. */
function report(problem: string) {
  if (reported.has(problem) || reported.size >= 50) return;
  reported.add(problem);
  console.warn("Identity: " + problem);
}

const current = new AsyncLocalStorage<Identity | null>();

/** Runs the app for one request with its resolved identity. */
export function runWithIdentity<T>(identity: Identity | null, run: () => T): T {
  return current.run(identity, run);
}

/** The signed-in user of the current request, or null when anonymous. */
export function currentUser(): Identity | null {
  return current.getStore() ?? null;
}
