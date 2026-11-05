import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessTokenError,
  accessIssuer,
  createAccessVerifier,
} from "@/lib/cloudflare-access";

// Tokens are signed with key pairs generated here and the team's key set is a
// stub: nothing reaches the network.
const issuer = "https://assurance-team.cloudflareaccess.com";
const certsUrl = issuer + "/cdn-cgi/access/certs";
const audience =
  "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
const start = Date.parse("2026-11-05T12:00:00Z");
const encoder = new TextEncoder();

type Jwk = JsonWebKey & { kid?: string };
type Keys = CryptoKeyPair & { jwk: Jwk };
let signing: Keys, other: Keys;
let clock: number;
let published: Jwk[];
let fetches: string[];
let failNext: number | "network" | null;

async function generate(kid: string): Promise<Keys> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { ...pair, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}

function base64url(bytes: Uint8Array | string) {
  return Buffer.from(
    typeof bytes === "string" ? encoder.encode(bytes) : bytes,
  ).toString("base64url");
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(clock / 1000);
  return {
    aud: [audience],
    email: "lead@practice.example",
    exp: now + 3600,
    iat: now,
    nbf: now,
    iss: issuer,
    type: "app",
    identity_nonce: "nonce",
    sub: "7335d417-61da-459d-899c-0a01c76a2b1d",
    country: "AT",
    ...overrides,
  };
}

async function token(
  payload: Record<string, unknown> = claims(),
  {
    key = signing.privateKey,
    header = { alg: "RS256", kid: "key-1", typ: "JWT" } as Record<
      string,
      unknown
    >,
  } = {},
) {
  const data =
    base64url(JSON.stringify(header)) +
    "." +
    base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(data),
  );
  return data + "." + base64url(new Uint8Array(signature));
}

function verifier(options: { keyTtlMs?: number } = {}) {
  return createAccessVerifier({
    issuer,
    audiences: [audience],
    now: () => clock,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetches.push(url);
      if (url !== certsUrl) throw new Error("unexpected fetch " + url);
      const failure = failNext;
      failNext = null;
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure) return new Response("unavailable", { status: failure });
      return Response.json({ keys: published, public_cert: {} });
    }) as typeof fetch,
    ...options,
  });
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccessTokenError);
  return (error as AccessTokenError).message;
}

beforeAll(async () => {
  signing = await generate("key-1");
  other = await generate("key-1");
});

beforeEach(() => {
  clock = start;
  published = [signing.jwk];
  fetches = [];
  failNext = null;
});

describe("accessIssuer", () => {
  it.each([
    ["assurance-team", issuer],
    ["assurance-team.cloudflareaccess.com", issuer],
    ["https://Assurance-Team.cloudflareaccess.com/", issuer],
  ])("normalises %s", (value, expected) => {
    expect(accessIssuer(value)).toBe(expected);
  });

  it.each([
    "",
    undefined,
    "evil.example",
    "http://assurance-team.cloudflareaccess.com",
    "assurance-team.cloudflareaccess.com.evil.example",
    "a.b.cloudflareaccess.com",
  ])("rejects %s", (value) => {
    expect(accessIssuer(value)).toBeNull();
  });
});

describe("Cloudflare Access token verification", () => {
  it("accepts a valid token and maps sub, email and name", async () => {
    const verify = verifier();
    await expect(
      verify.verify(await token(claims({ name: " Lea Lead " }))),
    ).resolves.toEqual({
      sub: "7335d417-61da-459d-899c-0a01c76a2b1d",
      email: "lead@practice.example",
      name: "Lea Lead",
    });
    // A single audience may also be a plain string; the name is optional.
    await expect(
      verify.verify(await token(claims({ aud: audience }))),
    ).resolves.toMatchObject({ name: null });
    expect(fetches).toEqual([certsUrl]);
  });

  it("caches the key set and fetches it again after its lifetime", async () => {
    const verify = verifier({ keyTtlMs: 60_000 });
    await verify.verify(await token());
    clock += 59_000;
    await verify.verify(await token());
    expect(fetches).toHaveLength(1);
    clock += 2_000;
    await verify.verify(await token());
    expect(fetches).toHaveLength(2);
  });

  it("rejects a wrong audience", async () => {
    expect(
      await rejection(
        verifier().verify(await token(claims({ aud: ["another-app"] }))),
      ),
    ).toBe("wrong audience");
    expect(
      await rejection(verifier().verify(await token(claims({ aud: [] })))),
    ).toBe("wrong audience");
  });

  it("rejects a wrong issuer", async () => {
    expect(
      await rejection(
        verifier().verify(
          await token(claims({ iss: "https://other.cloudflareaccess.com" })),
        ),
      ),
    ).toBe("wrong issuer");
  });

  it("rejects an expired token or one without an expiry", async () => {
    const verify = verifier();
    const expiring = await token(claims({ exp: Math.floor(clock / 1000) + 5 }));
    await verify.verify(expiring);
    clock += 5_000;
    expect(await rejection(verify.verify(expiring))).toBe("expired");
    expect(
      await rejection(verify.verify(await token(claims({ exp: undefined })))),
    ).toBe("expired");
  });

  it("rejects a token that is not valid yet", async () => {
    const later = Math.floor(clock / 1000) + 300;
    expect(
      await rejection(verifier().verify(await token(claims({ nbf: later })))),
    ).toBe("not yet valid");
  });

  it("rejects alg none, HS256 and other algorithms", async () => {
    const verify = verifier();
    const body = base64url(JSON.stringify(claims()));
    const none = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    expect(await rejection(verify.verify(none + "." + body + "."))).toBe(
      "malformed token",
    );
    expect(await rejection(verify.verify(none + "." + body + ".c2ln"))).toBe(
      "unsupported algorithm",
    );
    // HS256 signed with the published public key as the shared secret: the
    // classic algorithm-confusion forgery.
    const hsHeader = base64url(
      JSON.stringify({ alg: "HS256", kid: "key-1", typ: "JWT" }),
    );
    const secret = await crypto.subtle.importKey(
      "raw",
      encoder.encode(JSON.stringify(signing.jwk)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      secret,
      encoder.encode(hsHeader + "." + body),
    );
    expect(
      await rejection(
        verify.verify(
          hsHeader + "." + body + "." + base64url(new Uint8Array(mac)),
        ),
      ),
    ).toBe("unsupported algorithm");
    expect(
      await rejection(
        verify.verify(
          await token(claims(), { header: { alg: "RS512", kid: "key-1" } }),
        ),
      ),
    ).toBe("unsupported algorithm");
    expect(fetches).toEqual([]);
  });

  it("rejects an unknown key id without refetching on every request", async () => {
    const verify = verifier();
    await verify.verify(await token());
    const unknown = await token(claims(), {
      header: { alg: "RS256", kid: "key-unknown" },
    });
    expect(await rejection(verify.verify(unknown))).toBe("unknown signing key");
    expect(await rejection(verify.verify(unknown))).toBe("unknown signing key");
    expect(fetches).toHaveLength(1);
    clock += 61_000;
    expect(await rejection(verify.verify(unknown))).toBe("unknown signing key");
    expect(fetches).toHaveLength(2);
  });

  it("picks up a rotated key", async () => {
    const verify = verifier();
    await verify.verify(await token());
    const rotated = await generate("key-2");
    published = [signing.jwk, rotated.jwk];
    clock += 61_000;
    await expect(
      verify.verify(
        await token(claims(), {
          key: rotated.privateKey,
          header: { alg: "RS256", kid: "key-2" },
        }),
      ),
    ).resolves.toMatchObject({ email: "lead@practice.example" });
  });

  it("rejects a bad signature", async () => {
    const verify = verifier();
    // Signed by a different key that claims the published key id.
    expect(
      await rejection(
        verify.verify(await token(claims(), { key: other.privateKey })),
      ),
    ).toBe("invalid signature");
    // A valid token whose claims were edited after signing.
    const [header, , signature] = (await token()).split(".");
    const edited = base64url(
      JSON.stringify(claims({ email: "ceo@practice.example" })),
    );
    expect(
      await rejection(verify.verify([header, edited, signature].join("."))),
    ).toBe("invalid signature");
  });

  it("rejects service tokens, which name no user", async () => {
    expect(
      await rejection(
        verifier().verify(
          await token(
            claims({ sub: "", email: undefined, common_name: "runner.access" }),
          ),
        ),
      ),
    ).toBe("no user identity");
  });

  it("rejects malformed tokens and critical headers", async () => {
    const verify = verifier();
    for (const value of [
      "",
      "abc",
      "a.b.c.d",
      "a.b!.c",
      base64url("[]") + "." + base64url("{}") + ".c2ln",
      "x".repeat(9000),
    ])
      expect(await rejection(verify.verify(value))).toBe("malformed token");
    expect(
      await rejection(
        verify.verify(
          await token(claims(), {
            header: { alg: "RS256", kid: "key-1", crit: ["exp"] },
          }),
        ),
      ),
    ).toBe("unsupported critical header");
  });

  it("fails closed while the key set is unavailable, then recovers", async () => {
    const verify = verifier();
    failNext = 503;
    expect(await rejection(verify.verify(await token()))).toMatch(
      /^signing keys unavailable/,
    );
    // Retries wait out a short backoff instead of fetching per request.
    expect(await rejection(verify.verify(await token()))).toMatch(
      /^signing keys unavailable/,
    );
    expect(fetches).toHaveLength(1);
    clock += 6_000;
    failNext = "network";
    expect(await rejection(verify.verify(await token()))).toMatch(
      /^signing keys unavailable/,
    );
    clock += 6_000;
    await expect(verify.verify(await token())).resolves.toBeTruthy();
    expect(fetches).toHaveLength(3);
  });

  it("ignores published keys that are not RS256 signing keys", async () => {
    published = [{ ...signing.jwk, use: "enc" }];
    expect(await rejection(verifier().verify(await token()))).toMatch(
      /^signing keys unavailable/,
    );
    published = [
      { ...signing.jwk, alg: "RS384" },
      { kty: "EC", kid: "key-1" },
    ];
    clock += 6_000;
    expect(await rejection(verifier().verify(await token()))).toMatch(
      /^signing keys unavailable/,
    );
  });

  it("shares one fetch between concurrent first requests", async () => {
    const verify = verifier();
    const value = await token();
    await Promise.all([verify.verify(value), verify.verify(value)]);
    expect(fetches).toHaveLength(1);
  });
});

describe("verifier defaults", () => {
  it("uses the global fetch when none is given", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ keys: [signing.jwk] }));
    try {
      const verify = createAccessVerifier({ issuer, audiences: [audience] });
      clock = Date.now();
      await expect(verify.verify(await token())).resolves.toBeTruthy();
      expect(String(spy.mock.calls[0][0])).toBe(certsUrl);
    } finally {
      spy.mockRestore();
    }
  });
});
