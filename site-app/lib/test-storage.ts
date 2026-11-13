// A practice for unit tests of the engagement read paths: SQLite D1
// (lib/test-d1.ts) with a tenant, a client, members and engagements stored as
// the app stores them (dehydrated, with their immutable parts in R2), and an
// in-memory R2 bucket that counts every read. The app never imports this
// module.
import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import type { Engagement, Report, Role } from "./domain";
import { dehydrate } from "./engagement-storage";
import catalog from "./catalog.json";
import { freshEngagement, templatePaper } from "./factories";
import type { Context } from "./tenancy";
import { sqliteD1 } from "./test-d1";
import { resolveNew } from "./criteria/pin";

/** An R2 stand-in holding objects in memory and recording each get and put. */
export function countingBucket() {
  const objects = new Map<string, string>(),
    reads: string[] = [],
    writes: string[] = [];
  const bucket = {
    async put(key: string, body: string) {
      writes.push(key);
      objects.set(key, body);
    },
    async get(key: string) {
      reads.push(key);
      const body = objects.get(key);
      if (body === undefined) return null;
      const bytes = new TextEncoder().encode(body);
      return { arrayBuffer: async () => bytes.buffer };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, reads, writes };
}

export const tenantId = "tenant-1";
/** A signed-in member of the test practice. */
export function member(
  userId: string,
  role: Role,
  clientId: string | null = null,
): Context {
  return {
    user: { userId, displayName: userId, email: userId + "@fixture.invalid" },
    tenantId,
    role,
    clientId,
    practiceAdmin: false,
    accessSince: null,
  };
}

/**
 * An engagement with every kind of immutable part: an open final report
 * awaiting approval, a released one, a paper history and run results.
 */
export function engagementWithParts(id: string, title: string) {
  const e = freshEngagement(resolveNew(), "CL-1", title, "lead", true);
  e.id = id;
  const report = (rid: string, state: string) =>
    ({
      id: rid,
      kind: "final",
      createdAt: "2026-11-01T00:00:00.000Z",
      actor: "auditor",
      sha256: "a".repeat(64),
      snapshot: { workflow: { captured: rid } },
      ...(state === "released"
        ? {
            clientSnapshot: { released: rid },
            release: { state: "released" },
          }
        : {}),
    }) as unknown as Report;
  e.reports.push(
    report(id + "-open", "internal"),
    report(id + "-out", "released"),
  );
  e.papers.push(templatePaper(resolveNew(), catalog.items[0].id, "auditor"));
  e.papers[0].history = [
    { revision: 0, at: "2026-11-01T00:00:00.000Z" },
  ] as unknown as Engagement["papers"][number]["history"];
  e.runs.push({
    id: id + "-run",
    results: [{ metric: "accuracy", value: 0.9 }],
  } as unknown as Engagement["runs"][number]);
  return e;
}

/**
 * Seeds the practice: a Lead Auditor ("lead") with access to every
 * engagement, an Auditor ("auditor") with access to the listed ones, and the
 * engagements stored dehydrated. Assigns env.DB and env.BUCKET.
 */
export async function practice(
  engagements: Engagement[],
  auditorAccess: string[] = engagements.map((e) => e.id),
) {
  const d1 = sqliteD1(),
    r2 = countingBucket();
  env.DB = d1.db;
  env.BUCKET = r2.bucket;
  const sqlite: DatabaseSync = d1.sqlite,
    at = "2026-11-01T00:00:00.000Z";
  sqlite
    .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
    .run(tenantId, "Practice", at);
  sqlite
    .prepare(
      "INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('CL-1',?,'Client','Finance',?)",
    )
    .run(tenantId, at);
  for (const [userId, role, clientId] of [
    ["lead", "Lead Auditor", null],
    ["auditor", "Auditor", null],
    ["viewer", "Client Viewer", "CL-1"],
    ["contributor", "Client Contributor", "CL-1"],
  ])
    sqlite
      .prepare(
        "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name) VALUES(?,?,?,?,?)",
      )
      .run(tenantId, userId, role, clientId, userId);
  const lead = member("lead", "Lead Auditor");
  for (const e of engagements) {
    const body = JSON.stringify(await dehydrate(lead, e));
    sqlite
      .prepare(
        "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES(?,?,'CL-1',?,?,?,'init')",
      )
      .run(e.id, tenantId, e.title, e.version, body);
    for (const userId of [
      "lead",
      ...(auditorAccess.includes(e.id) ? ["auditor"] : []),
    ])
      sqlite
        .prepare(
          "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES(?,?,?,1,'lead',?)",
        )
        .run(tenantId, e.id, userId, at);
  }
  // Seeding wrote the parts; tests count the reads and writes that follow.
  r2.reads.length = 0;
  r2.writes.length = 0;
  return { sqlite, ...r2 };
}

/** The R2 keys of one engagement's immutable parts. */
export const partsOf = (keys: Iterable<string>, engagementId: string) =>
  [...keys].filter((k) => k.startsWith(tenantId + "/" + engagementId + "/"));
