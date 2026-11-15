// The identity boundary of the built Worker (docs/security/identity.md): which
// credential each IDENTITY_MODE trusts, that forged x-assurance-user-* headers
// are refused in every mode that does not trust them, Cloudflare Access tokens
// checked against a stub key set (no network), and that the development
// personas never reach a build. Needs `npm run build` first.
import assert from "node:assert/strict";
import "./harness/env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";

const modules = [
  "index.js",
  ...(await fs.readdir("dist/server", { recursive: true })).filter(
    (p) => p !== "index.js" && /\.m?js$/.test(p),
  ),
];
const migrations = [];
for (const file of (await fs.readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  for (const sql of (await fs.readFile("drizzle/" + file, "utf8"))
    .split("--> statement-breakpoint")
    .filter((s) => s.trim()))
    migrations.push(sql.trim());

const local = "http://127.0.0.1:5173";
const forged = {
  "x-assurance-user-id": "forged-admin",
  "x-assurance-user-email": "forged@attacker.invalid",
};
const trusted = {
  IDENTITY_MODE: "trusted-headers",
  IDENTITY_TRUSTED_HEADERS: "loopback-tests",
};

/** Runs `check` against the built Worker with the given Worker variables. */
async function withWorker(bindings, check, outboundService) {
  const mf = new Miniflare({
    modules: modules.map((p) => ({
      type: "ESModule",
      path: path.resolve("dist/server", p),
    })),
    modulesRoot: path.resolve("dist/server"),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    // The checks below sign in first-time users, which provisions their
    // practice only where self-signup is allowed (lib/access-policy.ts).
    bindings: { SELF_SIGNUP: "open", ...bindings },
    ...(outboundService ? { outboundService } : {}),
    d1Databases: { DB: "identity-fixture" },
    r2Buckets: { BUCKET: "identity-fixture-evidence" },
    d1Persist: false,
    r2Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    for (const sql of migrations) await db.prepare(sql).run();
    await check(async (url, headers = {}, init = {}) => {
      const response = await mf.dispatchFetch(url, {
        redirect: "manual",
        ...init,
        headers,
      });
      const type = response.headers.get("content-type") ?? "";
      const body = type.includes("json")
        ? await response.json()
        : await response.text();
      return { status: response.status, headers: response.headers, body };
    });
  } finally {
    await mf.dispose();
  }
}

async function refused(call, headers, url = local + "/api/workspace") {
  const response = await call(url, headers);
  assert.equal(response.status, 401, JSON.stringify(response.body));
  return response;
}

// --- No identity is trusted unless a mode is configured ---------------------
for (const [label, bindings] of [
  ["no IDENTITY_MODE", {}],
  ["an empty IDENTITY_MODE", { IDENTITY_MODE: "" }],
  ["an unknown IDENTITY_MODE", { IDENTITY_MODE: "DEV" }],
  ["the removed sites mode", { IDENTITY_MODE: "sites" }],
  ["IDENTITY_MODE=dev in a build", { IDENTITY_MODE: "dev" }],
  ["trusted-headers without the opt-in", { IDENTITY_MODE: "trusted-headers" }],
  [
    "trusted-headers with the wrong opt-in",
    { IDENTITY_MODE: "trusted-headers", IDENTITY_TRUSTED_HEADERS: "true" },
  ],
  [
    "cloudflare-access without its settings",
    { IDENTITY_MODE: "cloudflare-access" },
  ],
])
  await withWorker(bindings, async (call) => {
    const response = await refused(call, forged);
    assert.equal(
      response.body.error,
      "Sign in to access the audit workspace",
      label,
    );
    await refused(call, forged, local + "/api/work-inbox");
    // The sign-in routes say so instead of pretending to sign anyone in.
    const signIn = await call(local + "/auth/sign-in?return_to=/");
    assert.equal(signIn.status, 401, label);
  });
console.log(
  "PASS forged identity headers are refused with no, empty, unknown, removed, dev or incomplete identity configuration",
);

// --- trusted-headers: explicit opt-in, loopback requests only ----------------
await withWorker(trusted, async (call) => {
  const ok = await call(local + "/api/workspace", forged);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.identity.id, "forged-admin");
  await refused(call, forged, "https://audit.example.com/api/workspace");
  await refused(call, { ...forged, "CF-Connecting-IP": "203.0.113.7" });
  await refused(call, { ...forged, "CF-Connecting-IP": "10.0.0.8" });
});
console.log(
  "PASS trusted-headers mode needs its opt-in and refuses non-loopback hosts and clients",
);

// --- cloudflare-access: RS256 tokens against a stub team key set -------------
const team = "assurance-team.cloudflareaccess.com",
  issuer = "https://" + team,
  audience = "aud-identity-check";
const encoder = new TextEncoder();
const base64url = (value) =>
  Buffer.from(
    typeof value === "string" ? encoder.encode(value) : value,
  ).toString("base64url");
const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};
const signer = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const impostor = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", signer.publicKey)),
  kid: "key-1",
  alg: "RS256",
  use: "sig",
};
async function accessToken(
  overrides = {},
  { key = signer, kid = "key-1" } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const data =
    base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })) +
    "." +
    base64url(
      JSON.stringify({
        aud: [audience],
        email: "lea@practice.invalid",
        name: "Lea Access",
        sub: "access-user-lea",
        iss: issuer,
        iat: now,
        nbf: now,
        exp: now + 600,
        type: "app",
        ...overrides,
      }),
    );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    encoder.encode(data),
  );
  return data + "." + base64url(new Uint8Array(signature));
}
const outbound = [];
await withWorker(
  {
    IDENTITY_MODE: "cloudflare-access",
    CF_ACCESS_TEAM_DOMAIN: team,
    CF_ACCESS_AUD: audience,
  },
  async (call) => {
    const app = "https://audit.example.com";
    await refused(call, forged, app + "/api/workspace");
    const ok = await call(app + "/api/workspace", {
      ...forged,
      "Cf-Access-Jwt-Assertion": await accessToken(),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.identity.id, "access-user-lea", "forged headers win");
    assert.equal(ok.body.identity.name, "Lea Access");
    const now = Math.floor(Date.now() / 1000);
    for (const [label, token] of [
      ["wrong audience", await accessToken({ aud: ["another-app"] })],
      [
        "wrong issuer",
        await accessToken({ iss: "https://evil.cloudflareaccess.com" }),
      ],
      [
        "expired",
        await accessToken({ iat: now - 900, nbf: now - 900, exp: now - 300 }),
      ],
      ["unknown kid", await accessToken({}, { kid: "key-unknown" })],
      ["bad signature", await accessToken({}, { key: impostor })],
      [
        "alg none",
        base64url(JSON.stringify({ alg: "none", typ: "JWT" })) +
          "." +
          (await accessToken()).split(".")[1] +
          ".",
      ],
      [
        "HS256",
        base64url(JSON.stringify({ alg: "HS256", kid: "key-1" })) +
          "." +
          (await accessToken()).split(".")[1] +
          "." +
          base64url("forged-mac"),
      ],
    ]) {
      const response = await call(app + "/api/workspace", {
        "Cf-Access-Jwt-Assertion": token,
      });
      assert.equal(response.status, 401, label);
    }
    // Sign-out leaves through Access; sign-in comes back to the deep link.
    const out = await call(app + "/auth/sign-out?return_to=/");
    assert.equal(out.status, 302);
    assert.equal(out.headers.get("location"), "/cdn-cgi/access/logout");
    const into = await call(
      app + "/auth/sign-in?return_to=" + encodeURIComponent("/?view=Findings"),
      { "Cf-Access-Jwt-Assertion": await accessToken() },
    );
    assert.equal(into.status, 302);
    assert.equal(into.headers.get("location"), "/?view=Findings");
    // A request that bypassed or failed Access (no token, or a rejected one)
    // gets 401 at sign-in instead of a redirect back to the page that sent it
    // there, which would loop: /report -> sign-in -> /report -> ...
    const page = await call(app + "/report?reportId=RPT-1");
    assert.equal(page.status, 307, "an anonymous report is sent to sign-in");
    const hop = new URL(page.headers.get("location"), app);
    assert.equal(
      hop.pathname + hop.search,
      "/auth/sign-in?return_to=" + encodeURIComponent("/report?reportId=RPT-1"),
    );
    for (const [label, headers] of [
      ["no token", {}],
      [
        "a rejected token",
        {
          "Cf-Access-Jwt-Assertion": await accessToken({
            aud: ["another-app"],
          }),
        },
      ],
    ]) {
      const back = await call(hop.href, headers);
      assert.equal(back.status, 401, label);
      assert.equal(back.headers.get("location"), null, label);
      assert.equal(
        back.body,
        "Cloudflare Access did not authenticate this request.",
        label,
      );
    }
    // The runner keeps its own bearer-token authentication.
    const runner = await call(app + "/api/runner?jobId=x", {
      Authorization: "Bearer " + "r".repeat(64),
    });
    assert.equal(runner.status, 401);
    assert.equal(runner.body.error, "Runner credential invalid or revoked");
  },
  async (request) => {
    outbound.push(request.url);
    assert.equal(request.url, issuer + "/cdn-cgi/access/certs");
    return Response.json({ keys: [jwk] });
  },
);
assert.deepEqual(
  outbound,
  [issuer + "/cdn-cgi/access/certs"],
  "the team key set is fetched once and nothing else leaves the Worker",
);
console.log(
  "PASS cloudflare-access verifies RS256 tokens and refuses forged headers, wrong audience or issuer, expiry, unknown keys, bad signatures, alg none and HS256",
);
console.log(
  "PASS cloudflare-access sign-in returns only a verified caller, so an unauthenticated /report does not loop",
);

// --- The build: identity configuration and no development personas ----------
const wrangler = JSON.parse(
  await fs.readFile("dist/server/wrangler.json", "utf8"),
);
assert.equal(
  wrangler.vars?.IDENTITY_MODE,
  undefined,
  "a build trusts no identity until the deployment sets IDENTITY_MODE",
);
const personas = JSON.parse(
  await fs.readFile("fixtures/dev-personas.json", "utf8"),
);
const markers = [personas.defaultIdentity, ...personas.personas].flatMap(
  (p) => [p.userId, p.email],
);
for (const file of await fs.readdir("dist", { recursive: true })) {
  if (!/\.(m?js|json|html|css|map)$/.test(file)) continue;
  const text = await fs.readFile(path.join("dist", file), "utf8");
  for (const marker of markers)
    assert(
      !text.includes(marker),
      `${file} contains the dev persona ${marker}`,
    );
  assert(
    !/\.m?js$/.test(file) ||
      !/signin-with-chatgpt|oai-authenticated/.test(text),
    `dist/${file} still contains the removed ChatGPT sign-in`,
  );
}
console.log(
  "PASS the build configures no identity, contains no development personas and no trace of the removed ChatGPT sign-in",
);
