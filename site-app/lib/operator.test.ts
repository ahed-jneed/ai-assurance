import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import type { Identity } from "./identity";
import {
  abandonedAfterDays,
  deletePractice,
  isOperator,
  listPractices,
  operatorEvents,
  requireOperator,
} from "./operator";
import { sqliteD1 } from "./test-d1";

const operator: Identity = {
  userId: "user-ops",
  email: "ops@platform.example",
  displayName: "Ops",
  fullName: "Ops",
};
const at = "2026-11-12T00:00:00.000Z";
const old = "2026-01-05T00:00:00.000Z";
const recent = "2026-11-01T00:00:00.000Z";

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
 * `dossier` adds a signed dossier, which must be retained.
 */
function seed(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  tenant: string,
  name: string,
  when: string,
  dossier = false,
) {
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
    '{"reports":[]}',
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
    "{}",
    "h",
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
    seed(sqlite, "t-kept", "Kept practice", old, true);
    const abandoned = await listPractices(db, at);
    expect(abandoned.map((p) => p.id)).toEqual(["t-old"]);
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
    expect(await listPractices(db, at)).toEqual([]);
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
    seed(sqlite, "t-kept", "Kept practice", old, true);
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
