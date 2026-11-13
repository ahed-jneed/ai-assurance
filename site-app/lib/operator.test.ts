import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Report } from "./domain";
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
  requireOperator,
} from "./operator";
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
const dossierBody = '{"reportId":"RPT-1","audience":"client"}';
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

/** An R2 stand-in with the list and delete calls purgeObjects makes. */
function fakeBucket(keys: string[]) {
  const objects = new Map(keys.map((k) => [k, 10]));
  const bucket = {
    async list({ prefix, limit }: { prefix: string; limit: number }) {
      const page = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .slice(0, limit);
      return {
        objects: page.map((key) => ({ key, size: objects.get(key)! })),
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
 * A practice with a row in every table it owns, last active at `when`;
 * `issued` adds work it must retain: a signed dossier, or a report in the
 * given release state as the engagement's only report.
 */
function seed(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  tenant: string,
  name: string,
  when: string,
  issued?: "dossier" | Release["state"],
) {
  const dossier = issued === "dossier";
  const body =
    issued && !dossier
      ? JSON.stringify({ reports: [reportIn(issued, when)] })
      : '{"reports":[]}';
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
    dossierBody,
    hex(dossierBody),
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

describe("abandoned practices", () => {
  it("lists practices without activity for the period, oldest first", async () => {
    const { db, sqlite } = sqliteD1();
    seed(sqlite, "t-old", "Old practice", old);
    seed(sqlite, "t-new", "Busy practice", recent);
    seed(sqlite, "t-kept", "Kept practice", old, "dossier");
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
    seed(sqlite, "t-old", "Old practice", old);
    seed(sqlite, "t-new", "Busy practice", recent);
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
    seed(sqlite, "t-old", "Old practice", old);
    seed(sqlite, "t-new", "Busy practice", recent);
    seed(sqlite, "t-kept", "Kept practice", old, "dossier");
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
    seed(sqlite, "t-old", "Old practice", old);
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
      seed(sqlite, "t-report", "Report practice", old, state);
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
    seed(sqlite, "t-internal", "Internal practice", old, "internal");
    seed(sqlite, "t-approved", "Approved practice", old, "approved");
    expect(
      (await listPractices(db, at)).map((p) => [p.id, p.retained, p.abandoned]),
    ).toEqual([
      ["t-approved", false, true],
      ["t-internal", false, true],
    ]);
  });

  it("archives one: its members lose access and its issued records stay retained and verifiable", async () => {
    const { db, sqlite } = sqliteD1();
    seed(sqlite, "t-report", "Report practice", old, "released");
    seed(sqlite, "t-new", "Busy practice", recent);
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
    // It is no longer offered for deletion or archive, and stays undeletable.
    expect((await listPractices(db, at)).map((p) => p.id)).toEqual([]);
    const [archived] = (await listPractices(db, at, { all: true })).filter(
      (p) => p.id === "t-report",
    );
    expect(archived).toMatchObject({
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
    const issued = await issuedWork(db, "t-report");
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

  it("rechecks a dossier's digest and reports a changed package", async () => {
    const { db, sqlite } = sqliteD1();
    seed(sqlite, "t-kept", "Kept practice", old, "dossier");
    await archivePractice(db, operator, request("t-kept", "Kept practice"), at);
    expect((await issuedWork(db, "t-kept")).dossiers).toEqual([
      {
        engagementId: "ENG-1",
        recordId: "REC-1",
        reportId: "RPT-1",
        audience: "client",
        createdAt: old,
        sha256: hex(dossierBody),
        valid: true,
      },
    ]);
    // A report whose captured snapshot no longer matches its digest.
    const tampered = reportIn("released", old);
    tampered.snapshot = { conclusion: "Changed" };
    sqlite
      .prepare("UPDATE engagements SET body=? WHERE tenant_id='t-kept'")
      .run(JSON.stringify({ reports: [tampered] }));
    expect((await issuedWork(db, "t-kept")).reports).toMatchObject([
      { reportId: "RPT-1", valid: false },
    ]);
  });

  it("refuses to archive a practice without issued work, an active one, a wrong name and an unknown one", async () => {
    const { db, sqlite } = sqliteD1();
    seed(sqlite, "t-old", "Old practice", old);
    seed(sqlite, "t-busy", "Busy practice", recent, "released");
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
    expect(await failure(issuedWork(db, "t-busy"))).toEqual([
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
    seed(sqlite, "t-report", "Report practice", old, "released");
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
