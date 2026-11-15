// The assurance workbench at scale, against the built Worker in Miniflare:
// with 5,000 records in an engagement, GET /api/assurance?view=search finds a
// record that is not on the first page, pages through a register without
// repeating or skipping a record, filters by review state, and stays inside
// the caller's tenant and engagement; view=queue answers each member's review
// queue and pages through it; the workbench view counts the records without
// carrying them, and view=record opens one record with its reviews (#121).
// The records are inserted straight into D1 (the
// ops that create them are covered by assurance-integration-check.mjs);
// everything else goes through the API.
import assert from "node:assert/strict";
import "./harness/env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const modules = [
  "index.js",
  ...(await fs.readdir("dist/server", { recursive: true })).filter(
    (p) => p !== "index.js" && /\.m?js$/.test(p),
  ),
];
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: modules.map((p) => ({
      type: "ESModule",
      path: path.resolve("dist/server", p),
    })),
    modulesRoot: path.resolve("dist/server"),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    // The fixture identity headers below are trusted only because this opts in
    // to the loopback-only test mode (docs/security/identity.md).
    bindings: {
      IDENTITY_MODE: "trusted-headers",
      IDENTITY_TRUSTED_HEADERS: "loopback-tests",
      SELF_SIGNUP: "open",
    },
    d1Databases: { DB: "workbench-scale-fixture" },
    r2Buckets: { BUCKET: "workbench-scale-fixture-evidence" },
  }),
);
const testDb = await mf.getD1Database("DB");
for (const file of (await fs.readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  for (const sql of (await fs.readFile("drizzle/" + file, "utf8"))
    .split("--> statement-breakpoint")
    .filter((s) => s.trim()))
    await testDb.prepare(sql).run();
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await mf.dispatchFetch(origin + req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" ? undefined : Buffer.concat(chunks),
    });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Fixture transport failed");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const owner = "scale-owner",
  reviewer = "scale-reviewer",
  outsider = "scale-outsider";
const identity = (user) => ({
  "x-assurance-user-id": user,
  "x-assurance-user-email": user + "@fixture.invalid",
  Origin: origin,
});
async function api(route, { user = owner, body, status = 200 } = {}) {
  const r = await fetch(origin + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...identity(user),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  assert.equal(r.status, status, JSON.stringify(v).slice(0, 300));
  return v;
}
const digest = (s) => createHash("sha256").update(s).digest("hex");
const timings = [];
async function timed(label, run) {
  const started = performance.now(),
    value = await run();
  timings.push([label, Math.round(performance.now() - started)]);
  return value;
}

try {
  let w = await api("/api/workspace");
  const tenantId = w.tenantId,
    e = w.engagement;
  for (const [userId, role] of [[reviewer, "Reviewer"]]) {
    w = await api("/api/management", {
      body: {
        tenantId,
        expectedVersion: w.managementVersion,
        op: "grantMember",
        data: { userId, displayName: "Scale Reviewer", role, clientId: null },
      },
    });
    w = await api("/api/workspace?" + new URLSearchParams({ tenantId }));
    await api("/api/assurance", {
      body: {
        tenantId,
        engagementId: e.id,
        op: "setAccess",
        data: { userId, active: true, reason: "Scale reviewer" },
      },
    });
  }

  // 5,000 records: sources, assertions by the owner and by the reviewer, and
  // reviews that approve some and return others. One source, far past the
  // first page, carries a word no other record has.
  const start = Date.parse("2026-11-01T08:00:00.000Z"),
    seeds = [];
  const add = (kind, body, actor = owner) => {
    const record = {
      id: "AS-scale-" + String(seeds.length).padStart(5, "0"),
      kind,
      body: JSON.stringify(body),
      actor,
      // Ten records share each second, so pages break inside a run.
      createdAt: new Date(
        start + Math.floor(seeds.length / 10) * 1000,
      ).toISOString(),
    };
    seeds.push(record);
    return record;
  };
  const assertions = [];
  while (seeds.length < 4999) {
    const i = seeds.length;
    if (i === 4321) {
      add("location", {
        label: "Quarantined holdout extract",
        locator: "rows 9001-9500",
        artifactName:
          "Überprüfung holdout extract of the quarantined population.csv",
      });
      continue;
    }
    if (i % 5 === 1) {
      const assertion = add(
        "assertion",
        {
          statement: "Scale assertion " + i,
          criterion: "AIA-10-" + (i % 7),
          conclusion: "supported",
        },
        i % 2 ? owner : reviewer,
      );
      assertions.push(assertion);
      continue;
    }
    if (i % 5 === 2 && assertions.length % 3 !== 0) {
      const target = assertions.at(-1);
      add(
        "assertion_review",
        {
          assertionId: target.id,
          decision: assertions.length % 3 === 1 ? "approve" : "return",
          reason: "Scale review",
        },
        target.actor === owner ? reviewer : owner,
      );
      continue;
    }
    add("location", {
      label: "Scale source " + i,
      locator: "row " + i,
      artifactName: "population.csv",
    });
  }
  // A record of another engagement that matches the same search.
  const otherEngagement = "ENG-scale-other";
  await testDb
    .prepare(
      "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES(?,?,?,?,1,'{}','init')",
    )
    .bind(otherEngagement, tenantId, e.clientId, "Other audit")
    .run();
  const insert = (r, engagementId = e.id) =>
    testDb
      .prepare(
        "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        tenantId,
        engagementId,
        r.id,
        r.kind,
        r.body,
        digest(r.body),
        r.createdAt,
        r.actor,
      );
  for (let i = 0; i < seeds.length; i += 100)
    await testDb.batch(seeds.slice(i, i + 100).map((r) => insert(r)));
  await insert(
    {
      id: "AS-scale-other",
      kind: "location",
      body: JSON.stringify({ label: "Quarantined holdout extract (other)" }),
      actor: owner,
      createdAt: seeds[0].createdAt,
    },
    otherEngagement,
  ).run();

  const path_ = (query) =>
    "/api/assurance?" +
    new URLSearchParams({ tenantId, engagementId: e.id, ...query });
  const view = await timed("workbench view", () => api(path_({})));
  // The setAccess op added one access event to the 4,999 seeded records.
  assert.equal(view.total, 5000);
  // The view counts records by kind and carries none of them (#121).
  assert(!("records" in view));
  assert.equal(
    Object.values(view.kindCounts).reduce((sum, n) => sum + n, 0),
    5000,
  );
  assert.equal(
    view.kindCounts.assertion,
    seeds.filter((r) => r.kind === "assertion").length,
  );

  const found = await timed("search: one match", () =>
    api(path_({ view: "search", q: "quarantined HOLDOUT" })),
  );
  assert.deepEqual(
    found.records.map((r) => r.id),
    ["AS-scale-04321"],
  );
  assert.equal(found.total, 1);
  assert.equal(found.nextCursor, null);
  assert.equal(found.records[0].reviewState, null);
  assert.equal(found.records[0].body.locator, "rows 9001-9500");
  // Case is ignored for non-ASCII letters too, in D1 as in the browser, and a
  // term may be longer than D1's 50-byte LIKE and GLOB patterns.
  for (const q of [
    "überprüfung HOLDOUT",
    "ÜBERPRÜFUNG",
    "ÜBERPRÜFUNG HOLDOUT EXTRACT OF THE QUARANTINED POPULATION.CSV",
  ])
    assert.deepEqual(
      (await api(path_({ view: "search", q }))).records.map((r) => r.id),
      ["AS-scale-04321"],
      q,
    );
  console.log(
    "PASS search finds a record far past the first page among 5,000, within the engagement, ignoring the case of every letter",
  );

  // A register pages through every source and assertion exactly once.
  const expected = seeds
    .filter((r) => ["location", "assertion"].includes(r.kind))
    .map((r) => r.id);
  const listed = [];
  let first;
  for (let cursor = ""; ;) {
    const page = await timed("register page", () =>
      api(
        path_({
          view: "search",
          kinds: "location,assertion",
          limit: "200",
          ...(cursor ? { cursor } : {}),
        }),
      ),
    );
    first ??= page;
    listed.push(...page.records.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert.equal(first.total, expected.length);
  assert.deepEqual(listed, expected);
  console.log(
    "PASS a register pages through " +
      expected.length.toLocaleString("en") +
      " records without repeating or skipping one",
  );

  // Review states and the review queue.
  const reviewsOf = new Map();
  for (const r of seeds)
    if (r.kind === "assertion_review")
      reviewsOf.set(JSON.parse(r.body).assertionId, JSON.parse(r.body));
  const state = (a) =>
    !reviewsOf.has(a.id)
      ? "Awaiting review"
      : reviewsOf.get(a.id).decision === "approve"
        ? "Confirmed"
        : "Returned";
  const returned = assertions.filter((a) => state(a) === "Returned"),
    awaiting = assertions.filter((a) => state(a) === "Awaiting review");
  const returnedPage = await timed("search: review filter", () =>
    api(
      path_({
        view: "search",
        kinds: "assertion",
        review: "Returned",
        limit: "200",
      }),
    ),
  );
  assert.equal(returnedPage.total, returned.length);
  assert(returnedPage.records.every((r) => r.reviewState === "Returned"));
  const summary = await timed("queue summary", () =>
    api(path_({ view: "queue" }), { user: reviewer }),
  );
  assert.deepEqual(
    {
      awaiting: summary.awaiting,
      returned: summary.returned,
      reviewable: summary.reviewable,
      revisable: summary.revisable,
    },
    {
      awaiting: awaiting.length,
      returned: returned.length,
      reviewable: awaiting.filter((a) => a.actor !== reviewer).length,
      revisable: 0,
    },
  );
  assert.equal(summary.next.reviewable.actor, owner);
  // The workbench view carries the owner's queue: what the reviewer wrote.
  assert.equal(
    view.queue.reviewable,
    awaiting.filter((a) => a.actor !== owner).length,
  );
  const queued = [];
  for (let cursor = ""; ;) {
    const page = await api(
      path_({
        view: "queue",
        state: "reviewable",
        limit: "100",
        ...(cursor ? { cursor } : {}),
      }),
      { user: reviewer },
    );
    queued.push(...page.records.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    queued,
    awaiting.filter((a) => a.actor !== reviewer).map((a) => a.id),
  );
  console.log(
    "PASS review states, review filter and each member's paged review queue over 5,000 records",
  );

  // A record opens by id with its reviews, whatever its position.
  const reviewed = assertions.findLast((a) =>
    seeds.some(
      (r) =>
        r.kind === "assertion_review" &&
        JSON.parse(r.body).assertionId === a.id,
    ),
  );
  const opened = await timed("record details", () =>
    api(path_({ view: "record", id: reviewed.id })),
  );
  assert.equal(opened.record.id, reviewed.id);
  const itsReviews = seeds.filter(
    (r) =>
      r.kind === "assertion_review" &&
      JSON.parse(r.body).assertionId === reviewed.id,
  );
  assert.deepEqual(
    opened.related.map((r) => r.id),
    itsReviews.map((r) => r.id),
  );
  assert.equal(
    opened.reviewState,
    JSON.parse(itsReviews.at(-1).body).decision === "approve"
      ? "Confirmed"
      : "Returned",
  );
  await api(path_({ view: "record", id: "AS-scale-other" }), {
    status: 404,
  });
  console.log("PASS a record opens by id with its reviews and review state");

  // Scope and input checks.
  await api("/api/workspace", { user: outsider });
  await api(path_({ view: "record", id: reviewed.id }), {
    user: outsider,
    status: 403,
  });
  await api(path_({ view: "search", q: "holdout" }), {
    user: outsider,
    status: 403,
  });
  await api(path_({ view: "search", kinds: "Location" }), { status: 400 });
  await api(path_({ view: "search", review: "Approved" }), { status: 400 });
  await api(path_({ view: "queue", state: "mine" }), { status: 400 });
  await api(path_({ view: "everything" }), { status: 400 });
  await api(path_({ view: "search", cursor: "nope" }), { status: 400 });
  console.log(
    "PASS another practice cannot search the engagement; invalid kinds, states, views and cursors are refused",
  );

  const slowest = Math.max(...timings.map(([, ms]) => ms));
  console.log(
    "Timings (ms): " +
      [
        ...new Map(
          timings.map(([label]) => [
            label,
            Math.max(...timings.filter(([l]) => l === label).map(([, m]) => m)),
          ]),
        ),
      ]
        .map(([label, ms]) => label + " " + ms)
        .join(", "),
  );
  assert(slowest < 5000, "Every read answers within 5 s in Miniflare");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose();
}
