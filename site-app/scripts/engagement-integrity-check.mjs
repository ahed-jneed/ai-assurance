// Engagement hydration and integrity isolation (#16) against the built Worker
// in Miniflare: listing engagements reads no R2 part of an engagement that is
// not selected (its parts are deleted and the listing still works), and one
// engagement with a missing blob or a corrupt record leaves the workspace and
// the work inbox usable for everyone, shows the integrity error and records
// an incident. Run `npm run build` first.
import assert from "node:assert/strict";
import "./harness/env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const base = "http://127.0.0.1:5173";
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
    // Loopback-only fixture identities (docs/security/identity.md).
    bindings: {
      IDENTITY_MODE: "trusted-headers",
      IDENTITY_TRUSTED_HEADERS: "loopback-tests",
      SELF_SIGNUP: "open",
    },
    d1Databases: { DB: "engagement-integrity" },
    r2Buckets: { BUCKET: "engagement-integrity-evidence" },
  }),
);
try {
  const testDb = await mf.getD1Database("DB"),
    bucket = await mf.getR2Bucket("BUCKET");
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const statement of (await fs.readFile("drizzle/" + file, "utf8"))
      .split("--> statement-breakpoint")
      .filter((x) => x.trim()))
      await testDb.prepare(statement.trim()).run();
  const owner = "fixture-integrity-owner-" + Date.now();
  async function call(
    route,
    { body, raw, method = body || raw ? "POST" : "GET", status = 200 } = {},
  ) {
    const r = await mf.dispatchFetch(base + route, {
      method,
      headers: {
        "x-assurance-user-id": owner,
        "x-assurance-user-email": owner + "@fixture.invalid",
        Origin: base,
        ...(body || raw ? { "Content-Type": "application/json" } : {}),
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const value = await r.json();
    assert.equal(r.status, status, route + " " + JSON.stringify(value));
    return value;
  }
  let workspace = await call("/api/workspace");
  const tenantId = workspace.tenantId,
    first = workspace.engagement;
  const created = await call("/api/management", {
    body: {
      tenantId,
      op: "createEngagement",
      expectedVersion: workspace.managementVersion,
      data: { clientId: first.clientId, title: "Zulu integrity fixture" },
    },
  });
  const second = created.details.engagementId;
  // A draft report in each engagement stores an immutable snapshot in R2.
  const reportIds = {};
  const engagementOf = async (id) =>
    (
      await call(
        "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: id }),
      )
    ).engagement;
  for (const id of [first.id, second]) {
    const e = await engagementOf(id);
    const saved = await call("/api/workspace", {
      body: {
        tenantId,
        engagementId: id,
        expectedVersion: e.version,
        op: "createReport",
        data: {
          kind: "draft",
          engagementType: "readiness",
          conclusion: "readiness",
          summary: "Integrity fixture snapshot.",
        },
      },
    });
    // The command's response carries the audit trail and stored size, so
    // the workspace applies it without reloading.
    assert.equal(saved.events[0].action, "createReport");
    assert.equal(typeof saved.metadataBytes, "number");
    reportIds[id] = (await engagementOf(id)).reports.at(-1).id;
  }
  // #220: the print views answer a damaged record with the status their JSON
  // API gives (409 mismatch or unreadable, 503 missing), with their own
  // "could not be loaded" fallback, never 404 or 200.
  async function printViewsAnswer(id, status, kind) {
    const query = new URLSearchParams({
      tenantId,
      engagementId: id,
      reportId: reportIds[id],
      auditId: "LL144-any",
    });
    for (const [page, api, fallback] of [
      ["/report", "/api/report-package", /The report could not be loaded/],
      [
        "/ll144-summary",
        "/api/ll144-summary",
        /The summary could not be loaded/,
      ],
    ]) {
      const headers = {
        "x-assurance-user-id": owner,
        "x-assurance-user-email": owner + "@fixture.invalid",
      };
      const json = await mf.dispatchFetch(base + api + "?" + query, {
        headers,
      });
      assert.equal(json.status, status, api + " " + kind);
      assert.match((await json.json()).error, new RegExp(kind));
      const html = await mf.dispatchFetch(base + page + "?" + query, {
        headers,
      });
      assert.equal(html.status, status, page + " " + kind);
      // The rendered page without its scripts: the RSC payload also carries
      // the segment's not-found and forbidden fallbacks.
      const text = (await html.text()).replace(
        /<script\b[\s\S]*?<\/script>/g,
        "",
      );
      assert.match(text, fallback);
      assert.doesNotMatch(text, /has not been (released|published)/);
    }
  }
  const partsOf = async (id) =>
    (await bucket.list({ prefix: tenantId + "/" + id + "/immutable/" }))
      .objects;
  assert((await partsOf(first.id)).length > 0);
  assert((await partsOf(second)).length > 0);

  // Listing never reads the parts of an engagement that is not selected:
  // with the second engagement's parts gone, opening the first still works.
  const secondParts = (await partsOf(second)).map((o) => o.key);
  for (const key of secondParts) await bucket.delete(key);
  workspace = await call(
    "/api/workspace?" +
      new URLSearchParams({ tenantId, engagementId: first.id }),
  );
  assert.equal(workspace.engagement.id, first.id);
  assert.equal(workspace.engagementError, null);
  assert.deepEqual(
    workspace.engagements.map((e) => e.id).sort(),
    [first.id, second].sort(),
  );
  assert(workspace.engagements.every((e) => !e.integrity_error));
  console.log("PASS listing reads no R2 parts of unselected engagements");

  // Opening the damaged engagement answers 200 with the integrity error, and
  // the rest of the workspace stays usable.
  workspace = await call(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: second }),
  );
  assert.equal(workspace.engagement, null);
  assert.equal(workspace.engagementError.engagementId, second);
  assert.match(workspace.engagementError.error, /missing/);
  assert.match(
    workspace.engagements.find((e) => e.id === second).integrity_error,
    /missing/,
  );
  assert(!workspace.engagements.find((e) => e.id === first.id).integrity_error);
  assert.equal((await engagementOf(first.id)).id, first.id);
  // Work items need no draft report snapshot, so the inbox still loads both.
  let inbox = await call("/api/work-inbox?tenantId=" + tenantId);
  assert.equal(inbox.loadedEngagements, 2);
  assert.deepEqual(inbox.integrityErrors, []);
  // The assurance workbench needs the record only, never its parts.
  await call(
    "/api/assurance?" + new URLSearchParams({ tenantId, engagementId: second }),
  );
  console.log("PASS a missing blob isolates its engagement only");
  await printViewsAnswer(second, 503, "missing");
  console.log(
    "PASS the print views answer a missing blob with 503 like their API",
  );

  // A corrupt engagement record is listed with an integrity error, the
  // default selection skips it, and the inbox reports it beside the queue.
  await testDb
    .prepare("UPDATE engagements SET body='{\"broken\":' WHERE id=?")
    .bind(first.id)
    .run();
  workspace = await call("/api/workspace?tenantId=" + tenantId);
  assert.match(
    workspace.engagements.find((e) => e.id === first.id).integrity_error,
    /unreadable/,
  );
  assert.equal(workspace.engagements.length, 2);
  inbox = await call("/api/work-inbox?tenantId=" + tenantId);
  assert.equal(inbox.loadedEngagements, 2);
  assert.deepEqual(
    inbox.integrityErrors.map((i) => i.engagementId),
    [first.id],
  );
  assert(inbox.items.every((i) => i.engagementId !== first.id));
  assert(inbox.items.some((i) => i.engagementId === second));
  const incidents = (
    await testDb
      .prepare(
        "SELECT engagement_id,object_key,kind,occurrences FROM integrity_incidents WHERE tenant_id=? ORDER BY engagement_id,kind",
      )
      .bind(tenantId)
      .all()
  ).results;
  assert.deepEqual(
    incidents.map((i) => [i.engagement_id, i.kind]).sort(),
    [
      [first.id, "unreadable"],
      [second, "missing"],
    ].sort(),
  );
  // The parts load in parallel; the incident names whichever read failed.
  assert(
    secondParts.includes(
      incidents.find((i) => i.engagement_id === second).object_key,
    ),
  );
  console.log("PASS a corrupt record isolates its engagement and is recorded");
  await printViewsAnswer(first.id, 409, "unreadable");
  console.log(
    "PASS the print views answer an unreadable record with 409 like their API",
  );

  // F-54: a request body that is not JSON is a 400, not a 500.
  const malformed = await call("/api/workspace", {
    raw: "{not json",
    status: 400,
  });
  assert.match(malformed.error, /not valid JSON/);
  console.log("PASS malformed JSON answers 400");
  console.log("Engagement integrity checks passed.");
} finally {
  await mf.dispose();
}
