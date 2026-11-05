import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  authRoute,
  authenticate,
  currentUser,
  identityConfig,
  runWithIdentity,
  TRUSTED_HEADERS_OPT_IN,
  type IdentityConfig,
  type IdentitySettings,
} from "@/lib/identity";

const forged = {
  "oai-authenticated-user-id": "forged-admin",
  "oai-authenticated-user-email": "forged@attacker.example",
  "oai-authenticated-user-full-name": "Forged%20Admin",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  "oai-site-id": "forged-site",
};
const trusted: IdentitySettings = {
  IDENTITY_MODE: "trusted-headers",
  IDENTITY_TRUSTED_HEADERS: TRUSTED_HEADERS_OPT_IN,
};
const access: IdentitySettings = {
  IDENTITY_MODE: "cloudflare-access",
  CF_ACCESS_TEAM_DOMAIN: "assurance-team.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud-tag-1, aud-tag-2",
};

function config(settings: IdentitySettings, devServer = false) {
  return identityConfig(settings, { devServer });
}
function request(
  url = "http://127.0.0.1:5173/api/workspace",
  headers: Record<string, string> = forged,
  init: RequestInit = {},
) {
  return new Request(url, { ...init, headers });
}
function dispatchHeaders(r: Request) {
  return [...r.headers.keys()].filter((name) => name.startsWith("oai-"));
}

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("identityConfig", () => {
  it("trusts nothing unless a mode is configured", () => {
    expect(config({})).toMatchObject({ mode: "none" });
    expect(config({ IDENTITY_MODE: "" })).toMatchObject({ mode: "none" });
  });

  it("rejects unknown modes instead of guessing", () => {
    const result = config({ IDENTITY_MODE: "SITES" });
    expect(result).toMatchObject({ mode: "none" });
    expect(result.mode === "none" && result.problem).toContain('"SITES"');
  });

  it("selects sites only when it is named", () => {
    expect(config({ IDENTITY_MODE: "sites" })).toEqual({ mode: "sites" });
  });

  it("allows dev only on the development server", () => {
    expect(config({ IDENTITY_MODE: "dev" }, true)).toEqual({ mode: "dev" });
    expect(config({ IDENTITY_MODE: "dev" }, false)).toMatchObject({
      mode: "none",
    });
  });

  it("requires the explicit opt-in for trusted-headers", () => {
    expect(config({ IDENTITY_MODE: "trusted-headers" })).toMatchObject({
      mode: "none",
    });
    expect(
      config({
        IDENTITY_MODE: "trusted-headers",
        IDENTITY_TRUSTED_HEADERS: "1",
      }),
    ).toMatchObject({ mode: "none" });
    expect(config(trusted)).toEqual({ mode: "trusted-headers" });
  });

  it("requires the team domain and audience for cloudflare-access", () => {
    expect(config(access)).toEqual({
      mode: "cloudflare-access",
      issuer: "https://assurance-team.cloudflareaccess.com",
      audiences: ["aud-tag-1", "aud-tag-2"],
    });
    expect(
      config({ ...access, CF_ACCESS_TEAM_DOMAIN: "evil.example" }),
    ).toMatchObject({ mode: "none" });
    expect(config({ ...access, CF_ACCESS_AUD: " , " })).toMatchObject({
      mode: "none",
    });
  });
});

describe("forged oai-* headers", () => {
  const rejecting: [string, IdentityConfig, string?][] = [
    ["no mode", config({})],
    ["an unknown mode", config({ IDENTITY_MODE: "headers" })],
    ["dev outside the development server", config({ IDENTITY_MODE: "dev" })],
    [
      "dev from another host",
      config({ IDENTITY_MODE: "dev" }, true),
      "https://audit.example.com/api/workspace",
    ],
    [
      "trusted-headers without the opt-in",
      config({ IDENTITY_MODE: "trusted-headers" }),
    ],
    [
      "trusted-headers from another host",
      config(trusted),
      "https://audit.example.com/api/workspace",
    ],
    ["cloudflare-access without a token", config(access)],
  ];
  it.each(rejecting)(
    "are rejected and removed with %s",
    async (_, mode, url) => {
      const caller = await authenticate(request(url), mode);
      expect(caller.identity).toBeNull();
      expect(dispatchHeaders(caller.request)).toEqual([]);
    },
  );

  it("are rejected from a non-loopback client even on a loopback URL", async () => {
    for (const mode of [
      config(trusted),
      config({ IDENTITY_MODE: "dev" }, true),
    ]) {
      const caller = await authenticate(
        request(undefined, { ...forged, "CF-Connecting-IP": "203.0.113.7" }),
        mode,
      );
      expect(caller.identity).toBeNull();
      expect(dispatchHeaders(caller.request)).toEqual([]);
    }
  });

  it("are trusted and kept in sites mode", async () => {
    const caller = await authenticate(
      request("https://site.example/api/workspace"),
      config({ IDENTITY_MODE: "sites" }),
    );
    expect(caller.identity).toEqual({
      userId: "forged-admin",
      email: "forged@attacker.example",
      displayName: "Forged Admin",
      fullName: "Forged Admin",
    });
    expect(dispatchHeaders(caller.request)).toHaveLength(5);
  });

  it("are trusted on loopback in trusted-headers and dev mode, then removed", async () => {
    for (const mode of [
      config(trusted),
      config({ IDENTITY_MODE: "dev" }, true),
    ]) {
      for (const url of [
        "http://127.0.0.1:5173/api/workspace",
        "http://localhost:5173/api/workspace",
        "http://[::1]:5173/api/workspace",
      ]) {
        const caller = await authenticate(
          request(url, { ...forged, "CF-Connecting-IP": "127.0.0.1" }),
          mode,
        );
        expect(caller.identity?.userId).toBe("forged-admin");
        expect(dispatchHeaders(caller.request)).toEqual([]);
        expect(caller.request.headers.get("cf-connecting-ip")).toBe(
          "127.0.0.1",
        );
      }
    }
  });

  it("keep the request body when they are removed", async () => {
    const caller = await authenticate(
      request(
        undefined,
        { ...forged, "Content-Type": "application/json" },
        {
          method: "POST",
          body: JSON.stringify({ op: "createClient" }),
        },
      ),
      config({}),
    );
    expect(caller.request.method).toBe("POST");
    expect(await caller.request.json()).toEqual({ op: "createClient" });
    expect(caller.request.headers.get("content-type")).toBe("application/json");
  });
});

describe("dispatch-style header identity", () => {
  const sites = config({ IDENTITY_MODE: "sites" });
  async function identity(headers: Record<string, string>) {
    return (await authenticate(request(undefined, headers), sites)).identity;
  }

  it("decodes the percent-encoded full name and falls back to the email", async () => {
    expect(
      await identity({
        ...forged,
        "oai-authenticated-user-full-name": "Ren%C3%A9e%20Auditor",
      }),
    ).toMatchObject({ displayName: "Renée Auditor" });
    expect(
      await identity({
        ...forged,
        "oai-authenticated-user-full-name": "%E0%A4%A",
      }),
    ).toMatchObject({ displayName: "forged@attacker.example", fullName: null });
    expect(
      await identity({
        ...forged,
        "oai-authenticated-user-full-name-encoding": "plain",
      }),
    ).toMatchObject({ fullName: null });
  });

  it("needs both the id and the email, within bounds", async () => {
    expect(
      await identity({ "oai-authenticated-user-id": "user-1" }),
    ).toBeNull();
    expect(
      await identity({
        ...forged,
        "oai-authenticated-user-id": "x".repeat(257),
      }),
    ).toBeNull();
  });
});

describe("cloudflare-access mode", () => {
  const issuer = "https://assurance-team.cloudflareaccess.com";
  const encoder = new TextEncoder();
  let pair: CryptoKeyPair, jwk: JsonWebKey;
  const base64url = (value: Uint8Array | string) =>
    Buffer.from(
      typeof value === "string" ? encoder.encode(value) : value,
    ).toString("base64url");
  async function jwt(claims: Record<string, unknown>) {
    const data =
      base64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })) +
      "." +
      base64url(JSON.stringify(claims));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      encoder.encode(data),
    );
    return data + "." + base64url(new Uint8Array(signature));
  }
  function claims(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: issuer,
      aud: ["aud-tag-2"],
      sub: "access-user-1",
      email: "lea@practice.example",
      name: "Lea Lead",
      iat: now,
      nbf: now,
      exp: now + 600,
      ...overrides,
    };
  }

  beforeAll(async () => {
    pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  });
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe(issuer + "/cdn-cgi/access/certs");
      return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] });
    });
  });

  it("maps a verified token and ignores forged headers next to it", async () => {
    const caller = await authenticate(
      request("https://audit.example.com/api/workspace", {
        ...forged,
        "Cf-Access-Jwt-Assertion": await jwt(claims()),
      }),
      config(access),
    );
    expect(caller.identity).toEqual({
      userId: "access-user-1",
      email: "lea@practice.example",
      displayName: "Lea Lead",
      fullName: "Lea Lead",
    });
    expect(dispatchHeaders(caller.request)).toEqual([]);
  });

  it("falls back to the email without a name claim", async () => {
    const caller = await authenticate(
      request("https://audit.example.com/", {
        "Cf-Access-Jwt-Assertion": await jwt(claims({ name: undefined })),
      }),
      config(access),
    );
    expect(caller.identity).toMatchObject({
      displayName: "lea@practice.example",
      fullName: null,
    });
  });

  it("treats a rejected token as anonymous and says why once", async () => {
    for (let i = 0; i < 2; i++) {
      const caller = await authenticate(
        request("https://audit.example.com/", {
          "Cf-Access-Jwt-Assertion": await jwt(claims({ aud: ["other-app"] })),
        }),
        config(access),
      );
      expect(caller.identity).toBeNull();
    }
    expect(
      warn.mock.calls.filter(
        ([message]) =>
          message ===
          "Identity: Cloudflare Access token rejected: wrong audience",
      ),
    ).toHaveLength(1);
  });
});

describe("authRoute", () => {
  const signIn =
    "http://127.0.0.1:5173/signin-with-chatgpt?return_to=%2F%3Fview%3DFindings";
  const signOut = "http://127.0.0.1:5173/signout-with-chatgpt?return_to=%2F";

  it("leaves the reserved routes to Sites dispatch and the development server", () => {
    expect(
      authRoute(new Request(signIn), config({ IDENTITY_MODE: "sites" })),
    ).toBeNull();
    expect(
      authRoute(new Request(signIn), config({ IDENTITY_MODE: "dev" }, true)),
    ).toBeNull();
    expect(
      authRoute(new Request("http://127.0.0.1:5173/api/workspace"), config({})),
    ).toBeNull();
  });

  it("maps sign-in and sign-out onto Cloudflare Access", () => {
    const mode = config(access);
    const out = authRoute(new Request(signOut), mode)!;
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("/cdn-cgi/access/logout");
    expect(
      authRoute(new Request(signOut, { method: "POST" }), mode)!.status,
    ).toBe(303);
    const into = authRoute(new Request(signIn), mode)!;
    expect(into.status).toBe(302);
    expect(into.headers.get("location")).toBe("/?view=Findings");
    expect(
      authRoute(
        new Request(
          "http://127.0.0.1:5173/signin-with-chatgpt?return_to=//evil.example",
        ),
        mode,
      )!.headers.get("location"),
    ).toBe("/");
    expect(
      authRoute(new Request(signIn, { method: "PUT" }), mode)!.status,
    ).toBe(405);
  });

  it("answers 401 where there is no interactive sign-in", () => {
    for (const mode of [config({}), config(trusted)]) {
      expect(authRoute(new Request(signIn), mode)!.status).toBe(401);
      expect(authRoute(new Request(signOut), mode)!.status).toBe(401);
    }
  });
});

describe("currentUser", () => {
  const lea = {
    userId: "user-1",
    email: "lea@practice.example",
    displayName: "Lea",
    fullName: "Lea",
  };

  it("is the identity of the request being handled, across awaits", async () => {
    expect(currentUser()).toBeNull();
    await runWithIdentity(lea, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentUser()).toEqual(lea);
      await runWithIdentity(null, async () => expect(currentUser()).toBeNull());
      expect(currentUser()).toEqual(lea);
    });
    expect(currentUser()).toBeNull();
  });
});
