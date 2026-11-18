// The built Worker in Miniflare with a fresh D1 database and R2 bucket, and
// an API client that signs requests in as fixture users. Shared by the
// harnesses split out of the former scripts/integration-check.mjs (#52).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import "./env.mjs";

/** The loopback origin the fixture requests claim to come from. */
export const base = process.argv[2] ?? "http://127.0.0.1:5173";
assert(
  ["127.0.0.1", "localhost", "::1"].includes(new URL(base).hostname),
  "This fixture identity test may run only against loopback development",
);

/**
 * Starts dist/server in Miniflare with every drizzle/ migration applied.
 * Identity comes from the fixture headers, trusted only because this opts in
 * to the loopback-only test mode (docs/security/identity.md).
 */
export async function startWorker(name) {
  if (!existsSync("dist/server/index.js"))
    throw new Error(
      "dist/server/index.js is missing; run `npm run build` first.",
    );
  const moduleFiles = [
    "index.js",
    ...(await fs.readdir("dist/server", { recursive: true })).filter(
      (p) => p !== "index.js" && (p.endsWith(".js") || p.endsWith(".mjs")),
    ),
  ];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: moduleFiles.map((p) => ({
        type: "ESModule",
        path: path.resolve("dist/server", p),
      })),
      modulesRoot: path.resolve("dist/server"),
      compatibilityDate: "2026-05-15",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        IDENTITY_MODE: "trusted-headers",
        IDENTITY_TRUSTED_HEADERS: "loopback-tests",
        // First sign-ins provision the fixture practices (lib/access-policy.ts).
        SELF_SIGNUP: "open",
        // A key-encryption key generated for this run (docs/security/signing-keys.md).
        DOSSIER_KEK: randomBytes(32).toString("base64"),
      },
      d1Databases: { DB: name },
      r2Buckets: { BUCKET: name + "-evidence" },
    }),
  );
  const testDb = await mf.getD1Database("DB");
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const statement of (await fs.readFile("drizzle/" + file, "utf8"))
      .split("--> statement-breakpoint")
      .filter((x) => x.trim()))
      await testDb.prepare(statement.trim()).run();
  const transport = async (url, options) => {
    const request = new Request(url, options);
    return mf.dispatchFetch(url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.body ? await request.arrayBuffer() : undefined,
    });
  };
  return { mf, testDb, transport };
}

/** Fixture user ids that are unique to this run. */
export function fixtureUsers() {
  const stamp = Date.now();
  return {
    stamp,
    owner: "fixture-owner-" + stamp,
    reviewer: "fixture-reviewer-" + stamp,
    viewer: "fixture-viewer-" + stamp,
    other: "fixture-other-" + stamp,
  };
}

/** The identity headers of a fixture user. */
export const identity = (user) => ({
  "x-assurance-user-id": user,
  "x-assurance-user-email": user + "@fixture.invalid",
  Origin: base,
});

/**
 * The API as `owner` sees it. `state` holds the practice id (`tenantId`),
 * the current workspace and the current engagement (`workspace` and `e`,
 * accessor properties over the harness's own variables): refresh() and the
 * commands update them, and commands send the engagement's id and version.
 */
export function apiClient(transport, owner, state) {
  const request = async (
    path,
    { user = owner, body, method = "GET", status = 200 } = {},
  ) => {
    const r = await transport(base + path, {
      method,
      headers: {
        ...identity(user),
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
    });
    const value = await r.json();
    assert.equal(r.status, status, JSON.stringify(value));
    return value;
  };
  async function refresh(user = owner) {
    state.workspace = await request(
      "/api/workspace?" +
        new URLSearchParams({
          tenantId: state.tenantId,
          engagementId: state.e.id,
        }),
      { user },
    );
    state.e = state.workspace.engagement;
    return state.workspace;
  }
  async function management(
    op,
    data,
    user = owner,
    status = 200,
    version = state.workspace.managementVersion,
  ) {
    const result = await request("/api/management", {
      method: "POST",
      user,
      status,
      body: {
        op,
        data,
        tenantId: state.tenantId,
        expectedVersion: version,
      },
    });
    if (status === 200) await refresh();
    return result;
  }
  async function command(
    op,
    data,
    user = owner,
    status = 200,
    version = state.e.version,
  ) {
    if (["grantMember", "createClient", "createEngagement"].includes(op))
      return management(op, data, user, status);
    const result = await request("/api/workspace", {
      method: "POST",
      user,
      status,
      body: {
        op,
        data,
        tenantId: state.tenantId,
        engagementId: state.e.id,
        expectedVersion: version,
      },
    });
    if (status === 200) state.e = result.engagement;
    return result;
  }
  return { request, refresh, management, command };
}
