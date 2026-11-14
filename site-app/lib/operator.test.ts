import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Engagement, Report } from "./domain/types";
import { dehydrate } from "./engagement-storage";
import { ApiError } from "./http";
import type { Identity } from "./identity";
import {
  abandonedAfterDays,
  archivePractice,
  deletePractice,
  isOperator,
  issuedWork,
  listPractices,
  operatorEvents,
  practicePage,
  practicePageSize,
  requireOperator,
} from "./operator";
import type { Context } from "./tenancy";
import { sqliteD1 } from "./test-d1";
import type { Release } from "./workflow-types";

const operator: Identity = {
  userId: "user-ops",
  email: "ops@platform.example",
  displayName: "Ops",
  fullName: "Ops",
};
const at = "2026-11-12T00:00:00.000Z";
const old = "2026-01-05T00:00:00.000Z";
const recent = "2026-11-01T00:00:00.000Z";

const hex = (text: string) => createHash("sha256").update(text).digest("hex");
/** The signed dossier archive app/api/dossier puts in R2, and its key. */
const dossierArchive = '{"manifest":{"files":[]},"signature":{}}';
const dossierKey = (tenant: string) =>
  tenant + "/ENG-1/dossiers/RPT-1/client/" + hex(dossierArchive);
/** The dossier record app/api/dossier writes, naming that archive. */
const dossierBody = (tenant: string) =>
  JSON.stringify({
    reportId: "RPT-1",
    audience: "client",
    key: dossierKey(tenant),
    sha256: hex(dossierArchive),
  });
/** A final report in the given release state with a consistent package. */
function reportIn(state: Release["state"], when: string): Report {
  const snapshot = { conclusion: "Unmodified", papers: [], evidence: [] };
  const clientSnapshot = { conclusion: "Unmodified" };
  return {
    id: "RPT-1",
    kind: "final",
    createdAt: when,
    actor: "user-lead",
    sha256: hex(JSON.stringify(snapshot)),
    snapshot,
    clientSnapshot,
    clientSha256: hex(JSON.stringify(clientSnapshot)),
    release: { state, releasedAt: when, history: [] },
  };
}

/**
 * An R2 stand-in with the put and get calls dehydrate() and issuedWork make
 * and the list and delete calls purgeObjects makes. `keys` start with a
 * 10-byte body each.
 */
function fakeBucket(keys: string[] = []) {
  const objects = new Map(keys.map((k) => [k, "x".repeat(10)]));
  const bucket = {
    async put(key: string, body: string) {
      objects.set(key, body);
    },
    async get(key: string) {
      const body = objects.get(key);
      return body === undefined
        ? null
        : { arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    },
    async list({ prefix, limit }: { prefix: string; limit: number }) {
      const page = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .slice(0, limit);
      return {
        objects: page.map((key) => ({ key, size: objects.get(key)!.length })),
        truncated: false,
      };
    },
    async delete(keys: string[]) {
      for (const key of keys) objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

/**
 * The practices' stored objects: the report snapshots dehydrate() moves out
 * of the engagement record and the signed dossier archives, as the app
 * stores them.
 */
let r2 = fakeBucket();
beforeEach(() => {
  r2 = fakeBucket();
  (env as { BUCKET?: R2Bucket }).BUCKET = r2.bucket;
});

/**
 * A practice with a row in every table it owns, last active at `when`;
 * `issued` adds work it must retain: a signed dossier with its archive in
 * R2, or a report in the given release state as the engagement's only
 * report, stored through dehydrate() as every save stores it.
 */
async function seed(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  tenant: string,
  name: string,
  when: string,
  issued?: "dossier" | Release["state"],
) {
  const dossier = issued === "dossier";
  const body = JSON.stringify(
    await dehydrate(
      { tenantId: tenant } as Context,
      {
        id: "ENG-1",
        reports: issued && !dossier ? [reportIn(issued, when)] : [],
        papers: [],
        runs: [],
      } as unknown as Engagement,
    ),
  );
  if (dossier) await r2.bucket.put(dossierKey(tenant), dossierArchive);
  const run = (sql: string, ...args: (string | number | null)[]) =>
    sqlite.prepare(sql).run(...args);
  run(
    "INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)",
    tenant,
    name,
    when,
  );
  run(
    "INSERT INTO memberships(tenant_id,user_id,role,display_name,access_since,email) VALUES(?,?,?,?,?,?)",
    tenant,
    "user-" + tenant,
    "Lead Auditor",
    name,
    when,
    tenant + "@example.test",
  );
  run(
    "INSERT INTO practice_admins(tenant_id,user_id,active) VALUES(?,?,1)",
    tenant,
    "user-" + tenant,
  );
  run(
    "INSERT INTO clients(tenant_id,id,name,sector,created_at) VALUES(?,?,?,?,?)",
    tenant,
    "CL-1",
    "Client",
    "Lending",
    when,
  );
  run(
    "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) VALUES(?,?,?,?,?,?,?)",
    tenant,
    "ENG-1",
    "CL-1",
    "Audit",
    1,
    body,
    "init",
  );
  run(
    "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) VALUES(?,?,?,?,?,?)",
    tenant,
    "ENG-1",
    1,
    '{"reports":[]}',
    "h",
    when,
  );
  run(
    "INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) VALUES(?,?,?,?,?,?,?,?,?)",
    tenant,
    "ENG-1",
    "EV-1",
    "user-" + tenant,
    "save",
    "",
    "h",
    when,
    "{}",
  );
  run(
    "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES(?,?,?,?,?,?,?)",
    tenant,
    "ME-1",
    "user-" + tenant,
    "createClient",
    "{}",
    "h",
    when,
  );
  run(
    "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) VALUES(?,?,?,?,?,?,?,?)",
    tenant,
    "ENG-1",
    "REC-1",
    dossier ? "dossier" : "observation",
    dossierBody(tenant),
    hex(dossierBody(tenant)),
    when,
    "user-" + tenant,
  );
  run(
    "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES(?,?,?,1,?,?)",
    tenant,
    "ENG-1",
    "user-" + tenant,
    "user-" + tenant,
    when,
  );
  run(
    "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
    "JOB-" + tenant,
    tenant,
    "ENG-1",
    "queued",
    "{}",
    "h",
    "user-" + tenant,
    when,
  );
  run(
    "INSERT INTO execution_attempts(job_id,fence,id,worker_id,state,started_at,details) VALUES(?,?,?,?,?,?,?)",
    "JOB-" + tenant,
    1,
    "ATT-" + tenant,
    "W-1",
    "running",
    when,
    "{}",
  );
  run(
    "INSERT INTO invitations(tenant_id,id,email,role,invited_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    tenant,
    "INV-1",
    "nia@example.test",
    "Auditor",
    "user-" + tenant,
    when,
    when,
  );
}

const count = (
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  table: string,
  tenant: string,
) =>
  Number(
    (
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id=?`)
        .get(tenant) as { n: number }
    ).n,
  );

const tables = [
  "memberships",
  "practice_admins",
  "clients",
  "engagements",
  "engagement_snapshots",
  "audit_events",
  "management_events",
  "assurance_records",
  "engagement_access",
  "engagement_access_history",
  "execution_jobs",
  "invitations",
];

describe("platform operators", () => {
  it("are the exact emails PLATFORM_OPERATORS lists, and nobody when it is unset", () => {
    expect(isOperator("ops@platform.example", {})).toBe(false);
    expect(
      isOperator(" OPS@platform.example", {
        PLATFORM_OPERATORS: "a@b.example, Ops@Platform.example",
      }),
    ).toBe(true);
    expect(
      isOperator("ops@platform.example", {
        PLATFORM_OPERATORS: "@platform.example",
      }),
    ).toBe(false);
    expect(isOperator("", { PLATFORM_OPERATORS: "," })).toBe(false);
  });

  it("refuses anonymous callers and non-operators", () => {
    const status = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return (error as ApiError).status;
      }
    };
    expect(status(() => requireOperator(null))).toBe(401);
    // The test environment names no operator.
    expect(status(() => requireOperator(operator))).toBe(403);
  });
});

describe("the practice listing", () => {
  it("pages by last activity, then id, without gaps or repeats (#151)", async () => {
    const { db, sqlite } = sqliteD1();
    // 120 dormant practices; pairs share a last activity, so the id breaks
    // ties across page boundaries.
    for (let i = 0; i < 120; i++)
      sqlite
        .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
        .run(
          "t-" + String(i).padStart(3, "0"),
          "Practice " + i,
          new Date(Date.parse(old) + Math.floor(i / 2) * 60000).toISOString(),
        );
    await seed(sqlite, "t-busy", "Busy practice", recent);
    const seen: string[] = [];
    let page = await practicePage(db, at);
    let pages = 1;
    while (true) {
      expect(page.practices.length).toBeLessThanOrEqual(practicePageSize);
      seen.push(...page.practices.map((p) => p.id));
      if (!page.next) break;
      page = await practicePage(db, at, { after: page.next });
      pages++;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(
      Array.from({ length: 120 }, (_, i) => "t-" + String(i).padStart(3, "0")),
    );
    // With every practice, the active one comes last, on the third page.
    const last = await listPractices(db, at, { all: true, limit: 1000 });
    expect(last.map((p) => p.id)).toEqual([...seen, "t-busy"]);
    const tail = await practicePage(db, at, {
      all: true,
      after: { lastActivity: last[99].lastActivity, id: last[99].id },
    });
    expect(tail).toEqual({ practices: last.slice(100), next: null });
  });
});

describe("abandoned practices", () => {
  it("lists practices without activity for the period, oldest first", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-old", "Old practice", old);
    await seed(sqlite, "t-new", "Busy practice", recent);
    await seed(sqlite, "t-kept", "Kept practice", old, "dossier");
    const listed = await listPractices(db, at);
    // The retained practice is listed too: it may be archived, not deleted.
    expect(listed.map((p) => [p.id, p.abandoned, p.archivable])).toEqual([
      ["t-kept", false, true],
      ["t-old", true, false],
    ]);
    const abandoned = listed.slice(1);
    expect(abandoned[0]).toMatchObject({
      name: "Old practice",
      lastActivity: old,
      members: 1,
      activeMembers: 1,
      engagements: 1,
      snapshots: 1,
      snapshotBytes: 14,
      records: 1,
      retained: false,
      abandoned: true,
      archivable: false,
      archivedAt: null,
    });
    const all = await listPractices(db, at, { all: true });
    expect(all.map((p) => [p.id, p.abandoned, p.retained])).toEqual([
      ["t-kept", false, true],
      ["t-old", true, false],
      ["t-new", false, false],
    ]);
    // Any later activity keeps a practice: here a pending invitation.
    sqlite
      .prepare(
        "INSERT INTO invitations(tenant_id,id,email,role,invited_by,created_at,expires_at) VALUES('t-old','INV-2','x@example.test','Auditor','u',?,?)",
      )
      .run(recent, recent);
    expect((await listPractices(db, at)).map((p) => p.id)).toEqual(["t-kept"]);
    expect(abandonedAfterDays).toBe(90);
  });

  it("deletes an abandoned practice with its append-only rows and objects, and records it", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-old", "Old practice", old);
    await seed(sqlite, "t-new", "Busy practice", recent);
    const { bucket, objects } = fakeBucket([
      "t-old/ENG-1/immutable/report/abc",
      "t-old/ENG-1/EV-1/def",
      "t-new/ENG-1/immutable/report/abc",
    ]);
    const details = await deletePractice(
      db,
      bucket,
      operator,
      {
        tenantId: "t-old",
        confirmName: "Old practice",
        reason: "Abandoned self-signup",
      },
      at,
    );
    expect(details).toMatchObject({
      tenantId: "t-old",
      objects: 2,
      bytes: 20,
    });
    expect(details.rows).toMatchObject({
      engagement_snapshots: 1,
      audit_events: 1,
      management_events: 1,
      execution_attempts: 1,
      engagement_access_history: 1,
      tenants: 1,
    });
    for (const table of tables) {
      expect(count(sqlite, table, "t-old"), table).toBe(0);
      expect(count(sqlite, table, "t-new"), table).toBeGreaterThan(0);
    }
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM execution_attempts").get(),
    ).toEqual({ n: 1 });
    expect([...objects.keys()]).toEqual(["t-new/ENG-1/immutable/report/abc"]);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM practice_erasures").get(),
    ).toEqual({ n: 0 });
    const events = await operatorEvents(db);
    expect(events.map((e) => [e.action, e.tenantId, e.actorEmail])).toEqual([
      ["purgePracticeObjects", "t-old", "ops@platform.example"],
      ["deletePractice", "t-old", "ops@platform.example"],
    ]);
    expect(events[1].details).toMatchObject({
      name: "Old practice",
      reason: "Abandoned self-signup",
      lastActivity: old,
    });
    // Other practices' history stays append-only, and so does the trail.
    expect(() =>
      sqlite.exec("DELETE FROM audit_events WHERE tenant_id='t-new'"),
    ).toThrow(/append-only/);
    expect(() =>
      sqlite.exec("DELETE FROM engagement_snapshots WHERE tenant_id='t-new'"),
    ).toThrow(/append-only/);
    expect(() =>
      sqlite.exec("DELETE FROM execution_attempts WHERE job_id='JOB-t-new'"),
    ).toThrow(/retained/);
    expect(() => sqlite.exec("DELETE FROM operator_events")).toThrow(
      /immutable/,
    );
    expect(() => sqlite.exec("UPDATE operator_events SET action='x'")).toThrow(
      /immutable/,
    );
    // Deleting it again only finishes the object purge.
    const again = await deletePractice(
      db,
      bucket,
      operator,
      { tenantId: "t-old", confirmName: "", reason: "Retry the purge" },
      at,
    );
    expect(again).toMatchObject({ eventId: details.eventId, objects: 0 });
  });

  it("refuses a wrong name, an active or retained practice, and an unknown one", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-old", "Old practice", old);
    await seed(sqlite, "t-new", "Busy practice", recent);
    await seed(sqlite, "t-kept", "Kept practice", old, "dossier");
    const { bucket } = fakeBucket([]);
    const refusal = (tenantId: string, confirmName: string) =>
      deletePractice(
        db,
        bucket,
        operator,
        { tenantId, confirmName, reason: "Abandoned self-signup" },
        at,
      ).then(
        () => null,
        (error: ApiError) => [error.status, error.message],
      );
    expect(await refusal("t-old", "old practice")).toEqual([
      400,
      "Type the practice name exactly to confirm the deletion",
    ]);
    expect(await refusal("t-new", "Busy practice")).toEqual([
      409,
      "This practice recorded activity on 2026-11-01. Only a practice without activity for 90 days can be deleted.",
    ]);
    expect((await refusal("t-kept", "Kept practice"))?.[0]).toBe(409);
    expect(await refusal("t-none", "x")).toEqual([404, "Practice not found"]);
    for (const tenant of ["t-old", "t-new", "t-kept"])
      expect(count(sqlite, "engagement_snapshots", tenant)).toBe(1);
    expect(await operatorEvents(db)).toEqual([]);
  });

  it("deletes nothing when the practice became active before the batch ran", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-old", "Old practice", old);
    const { bucket } = fakeBucket([]);
    // Activity recorded between the checks and the batch.
    const batch = db.batch.bind(db);
    db.batch = (async (statements: D1PreparedStatement[]) => {
      sqlite
        .prepare(
          "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES('t-old','ME-2','u','renamePractice','{}','h',?)",
        )
        .run(recent);
      return batch(statements);
    }) as typeof db.batch;
    const error = await deletePractice(
      db,
      bucket,
      operator,
      {
        tenantId: "t-old",
        confirmName: "Old practice",
        reason: "Abandoned self-signup",
      },
      at,
    ).catch((e: ApiError) => e);
    expect((error as ApiError).status).toBe(409);
    for (const table of tables)
      expect(count(sqlite, table, "t-old"), table).toBeGreaterThan(0);
    expect(await operatorEvents(db)).toEqual([]);
  });
});

// The retention decision of 13 Nov 2026 (#151): a practice with issued work
// is never hard-deleted; it is archived instead.
describe("practices with issued work", () => {
  const request = (tenantId: string, confirmName: string) => ({
    tenantId,
    confirmName,
    reason: "Abandoned after its engagement closed",
  });
  const failure = (run: Promise<unknown>) =>
    run.then(
      () => null,
      (error: ApiError) => [error.status, error.message],
    );

  it.each(["released", "superseded", "withdrawn"] as const)(
    "never deletes a practice whose only issued work is a %s report",
    async (state) => {
      const { db, sqlite } = sqliteD1();
      await seed(sqlite, "t-report", "Report practice", old, state);
      const [practice] = await listPractices(db, at);
      expect(practice).toMatchObject({
        id: "t-report",
        retained: true,
        abandoned: false,
        archivable: true,
      });
      const { bucket, objects } = fakeBucket([
        "t-report/ENG-1/immutable/report/abc",
      ]);
      expect(
        await failure(
          deletePractice(
            db,
            bucket,
            operator,
            request("t-report", "Report practice"),
            at,
          ),
        ),
      ).toEqual([
        409,
        "This practice released a report or signed a dossier, which must be retained. It cannot be deleted; archive it instead.",
      ]);
      for (const table of tables)
        expect(count(sqlite, table, "t-report"), table).toBeGreaterThan(0);
      expect(objects.size).toBe(1);
      expect(await operatorEvents(db)).toEqual([]);
    },
  );

  it("counts neither an internal nor an approved report as issued", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-internal", "Internal practice", old, "internal");
    await seed(sqlite, "t-approved", "Approved practice", old, "approved");
    expect(
      (await listPractices(db, at)).map((p) => [p.id, p.retained, p.abandoned]),
    ).toEqual([
      ["t-approved", false, true],
      ["t-internal", false, true],
    ]);
  });

  it("archives one: its members lose access and its issued records stay retained and verifiable", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-report", "Report practice", old, "released");
    await seed(sqlite, "t-new", "Busy practice", recent);
    sqlite
      .prepare(
        "INSERT INTO runner_workers(id,tenant_id,engagement_id,name,token_hash,image_digest,capabilities,created_by,created_at) VALUES('W-1','t-report','ENG-1','Runner','th','sha256:x','[]','user-t-report',?)",
      )
      .run(old);
    sqlite
      .prepare(
        "INSERT INTO dossier_keys(tenant_id,id,public_key,active,created_at) VALUES('t-report','KEY-1','MCowBQYDK2VwAyEA',1,?)",
      )
      .run(old);
    const before = Object.fromEntries(
      tables.map((table) => [table, count(sqlite, table, "t-report")]),
    );
    const result = await archivePractice(
      db,
      operator,
      request("t-report", "Report practice"),
      at,
    );
    expect(result).toMatchObject({
      tenantId: "t-report",
      archivedAt: at,
      members: 1,
      invitations: 1,
      workers: 1,
    });
    // Access is gone: no active membership, invitation or runner worker.
    expect(
      sqlite
        .prepare("SELECT status FROM memberships WHERE tenant_id='t-report'")
        .all(),
    ).toEqual([{ status: "archived" }]);
    expect(
      sqlite
        .prepare(
          "SELECT status,closed_at FROM invitations WHERE tenant_id='t-report'",
        )
        .all(),
    ).toEqual([{ status: "cancelled", closed_at: at }]);
    expect(
      sqlite.prepare("SELECT active FROM runner_workers WHERE id='W-1'").get(),
    ).toEqual({ active: 0 });
    // Every row is retained; the other practice is untouched.
    for (const table of tables)
      expect(count(sqlite, table, "t-report"), table).toBe(before[table]);
    expect(
      sqlite
        .prepare("SELECT status FROM memberships WHERE tenant_id='t-new'")
        .get(),
    ).toEqual({ status: "active" });
    // It is no longer offered for deletion or archive, and stays undeletable;
    // the default listing keeps it as archived, so its issued work stays one
    // click away.
    const [archived, ...others] = await listPractices(db, at);
    expect(others).toEqual([]);
    expect(archived).toMatchObject({
      id: "t-report",
      archivedAt: at,
      archivable: false,
      abandoned: false,
      activeMembers: 0,
    });
    const { bucket, objects } = fakeBucket([
      "t-report/ENG-1/immutable/report/abc",
    ]);
    expect(
      (
        await failure(
          deletePractice(
            db,
            bucket,
            operator,
            request("t-report", "Report practice"),
            at,
          ),
        )
      )?.[0],
    ).toBe(409);
    expect(objects.size).toBe(1);
    expect(
      await failure(
        archivePractice(
          db,
          operator,
          request("t-report", "Report practice"),
          at,
        ),
      ),
    ).toEqual([409, "This practice was archived on 2026-11-12."]);
    // The database keeps it archived and closed to new members.
    expect(() =>
      sqlite.exec("UPDATE tenants SET archived_at=NULL WHERE id='t-report'"),
    ).toThrow(/stays archived/);
    expect(() =>
      sqlite.exec(
        "UPDATE memberships SET status='active' WHERE tenant_id='t-report'",
      ),
    ).toThrow(/archived/);
    expect(() =>
      sqlite.exec(
        "INSERT INTO memberships(tenant_id,user_id,role,display_name) VALUES('t-report','user-new','Auditor','New')",
      ),
    ).toThrow(/archived/);
    expect(() =>
      sqlite.exec(
        "INSERT INTO invitations(tenant_id,id,email,role,invited_by,created_at,expires_at) VALUES('t-report','INV-9','n@example.test','Auditor','u','x','x')",
      ),
    ).toThrow(/archived/);
    expect(() =>
      sqlite.exec(
        "DELETE FROM engagement_snapshots WHERE tenant_id='t-report'",
      ),
    ).toThrow(/append-only/);
    // Its issued work is still verifiable.
    const issued = await issuedWork(db, r2.bucket, "t-report");
    expect(issued).toMatchObject({
      name: "Report practice",
      archivedAt: at,
      reports: [
        {
          engagementId: "ENG-1",
          reportId: "RPT-1",
          kind: "final",
          state: "released",
          releasedAt: old,
          sha256: reportIn("released", old).sha256,
          clientSha256: reportIn("released", old).clientSha256,
          internal: "valid",
          client: "valid",
          valid: true,
        },
      ],
      dossiers: [],
      keys: [
        { keyId: "KEY-1", publicKeySPKI: "MCowBQYDK2VwAyEA", status: "active" },
      ],
    });
    const events = await operatorEvents(db);
    expect(events.map((e) => [e.action, e.tenantId])).toEqual([
      ["archivePractice", "t-report"],
    ]);
    expect(events[0].details).toMatchObject({
      name: "Report practice",
      reason: "Abandoned after its engagement closed",
      members: 1,
      invitations: 1,
      workers: 1,
    });
  });

  it("loads a released report's packages from R2, as the app stores them, and reports each failing part", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-report", "Report practice", old, "released");
    await archivePractice(
      db,
      operator,
      request("t-report", "Report practice"),
      at,
    );
    // The stored record holds no snapshot: dehydrate() moved both to R2.
    const stored = JSON.parse(
      (
        sqlite
          .prepare("SELECT body FROM engagements WHERE tenant_id='t-report'")
          .get() as { body: string }
      ).body,
    ) as { reports: Report[]; storageRefs: unknown };
    expect(stored.reports[0].snapshot).toEqual({});
    expect(stored.reports[0].clientSnapshot).toBeUndefined();
    expect(stored.storageRefs).toBeDefined();
    const key = (type: string) =>
      [...r2.objects.keys()].find((k) =>
        k.startsWith("t-report/ENG-1/immutable/" + type + "/"),
      )!;
    const internalKey = key("report"),
      clientKey = key("client-report");
    const check = async () => {
      const [report] = (await issuedWork(db, r2.bucket, "t-report")).reports;
      return [report.internal, report.client, report.valid];
    };
    expect(await check()).toEqual(["valid", "valid", true]);
    // The client package is checked too: an altered one is reported.
    const client = r2.objects.get(clientKey)!;
    r2.objects.set(clientKey, '{"conclusion":"Adverse"}');
    expect(await check()).toEqual(["valid", "mismatch", false]);
    r2.objects.set(clientKey, client);
    // A missing or unreachable part is its own state, never an error.
    const internal = r2.objects.get(internalKey)!;
    r2.objects.delete(internalKey);
    expect(await check()).toEqual(["missing", "valid", false]);
    r2.objects.set(internalKey, internal);
    const get = r2.bucket.get.bind(r2.bucket);
    r2.bucket.get = (async (k: string) => {
      if (k === internalKey) throw new Error("R2 timeout");
      return get(k);
    }) as typeof r2.bucket.get;
    expect(await check()).toEqual(["unavailable", "valid", false]);
    r2.bucket.get = get;
    r2.objects.set(internalKey, "not json");
    expect(await check()).toEqual(["mismatch", "valid", false]);
    r2.objects.set(internalKey, internal);
    expect(await check()).toEqual(["valid", "valid", true]);
    // A record stored before dehydrate() holds its snapshots inline.
    const inline = reportIn("released", old);
    const setBody = (report: Report) =>
      sqlite
        .prepare("UPDATE engagements SET body=? WHERE tenant_id='t-report'")
        .run(JSON.stringify({ reports: [report] }));
    setBody(inline);
    expect(await check()).toEqual(["valid", "valid", true]);
    setBody({ ...inline, snapshot: { conclusion: "Changed" } });
    expect(await check()).toEqual(["mismatch", "valid", false]);
    setBody({ ...inline, clientSnapshot: undefined });
    expect(await check()).toEqual(["valid", "missing", false]);
    // No client package was issued: only the internal one is checked.
    setBody({
      ...inline,
      clientSnapshot: undefined,
      clientSha256: undefined,
    });
    expect(await check()).toEqual(["valid", null, true]);
  });

  it("rechecks a dossier's record digest and its signed archive in R2", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-kept", "Kept practice", old, "dossier");
    await archivePractice(db, operator, request("t-kept", "Kept practice"), at);
    expect((await issuedWork(db, r2.bucket, "t-kept")).dossiers).toEqual([
      {
        engagementId: "ENG-1",
        recordId: "REC-1",
        reportId: "RPT-1",
        audience: "client",
        createdAt: old,
        sha256: hex(dossierBody("t-kept")),
        record: "valid",
        archive: "valid",
        valid: true,
      },
    ]);
    const check = async () => {
      const [d] = (await issuedWork(db, r2.bucket, "t-kept")).dossiers;
      return [d.record, d.archive, d.valid];
    };
    r2.objects.set(dossierKey("t-kept"), '{"manifest":{"files":["x"]}}');
    expect(await check()).toEqual(["valid", "mismatch", false]);
    r2.objects.delete(dossierKey("t-kept"));
    expect(await check()).toEqual(["valid", "missing", false]);
    r2.objects.set(dossierKey("t-kept"), dossierArchive);
    expect(await check()).toEqual(["valid", "valid", true]);
    // An edit beneath the append-only guard shows in the record check.
    sqlite.exec("DROP TRIGGER assurance_records_no_update");
    sqlite
      .prepare("UPDATE assurance_records SET body=? WHERE id='REC-1'")
      .run(dossierBody("t-kept").replace('"client"', '"internal"'));
    expect(await check()).toEqual(["mismatch", "valid", false]);
  });

  it("refuses to archive a practice without issued work, an active one, a wrong name and an unknown one", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-old", "Old practice", old);
    await seed(sqlite, "t-busy", "Busy practice", recent, "released");
    const archive = (tenantId: string, name: string) =>
      failure(archivePractice(db, operator, request(tenantId, name), at));
    expect(await archive("t-old", "Old practice")).toEqual([
      409,
      "This practice released no report and signed no dossier. Only a practice with issued work is archived; delete it instead.",
    ]);
    expect(await archive("t-busy", "Busy practice")).toEqual([
      409,
      "This practice recorded activity on 2026-11-01. Only a practice without activity for 90 days can be archived.",
    ]);
    expect(await archive("t-busy", "busy practice")).toEqual([
      400,
      "Type the practice name exactly to confirm the archive",
    ]);
    expect(await archive("t-none", "x")).toEqual([404, "Practice not found"]);
    expect(await failure(issuedWork(db, r2.bucket, "t-busy"))).toEqual([
      409,
      "Only an archived practice's issued work is shown here",
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM tenants WHERE archived_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(await operatorEvents(db)).toEqual([]);
  });

  it("changes nothing when the practice became active before the batch ran", async () => {
    const { db, sqlite } = sqliteD1();
    await seed(sqlite, "t-report", "Report practice", old, "released");
    const batch = db.batch.bind(db);
    db.batch = (async (statements: D1PreparedStatement[]) => {
      sqlite
        .prepare(
          "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES('t-report','ME-2','u','renamePractice','{}','h',?)",
        )
        .run(recent);
      return batch(statements);
    }) as typeof db.batch;
    expect(
      (
        await failure(
          archivePractice(
            db,
            operator,
            request("t-report", "Report practice"),
            at,
          ),
        )
      )?.[0],
    ).toBe(409);
    expect(
      sqlite
        .prepare(
          "SELECT t.archived_at,m.status FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE t.id='t-report'",
        )
        .get(),
    ).toEqual({ archived_at: null, status: "active" });
    expect(await operatorEvents(db)).toEqual([]);
  });
});
