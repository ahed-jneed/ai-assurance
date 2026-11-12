// Migration 0011 (#127): earlier engagement grants are rebuilt from the
// management and audit events that made them, existing grants are copied
// into engagement_access_history, a grant held now with its holder's current
// role and a withdrawn one with an unknown (NULL) role, and every later change
// of a grant is recorded by the triggers with the role held at that moment.
import { env } from "cloudflare:workers";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { grantInvolvement } from "./quality-review-records";

const migrations = new URL("../drizzle/", import.meta.url);
const files = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const apply = (sqlite: DatabaseSync, file: string) => {
  for (const sql of readFileSync(new URL(file, migrations), "utf8").split(
    "--> statement-breakpoint",
  ))
    if (sql.trim()) sqlite.exec(sql);
};
const at = "2026-10-01T00:00:00.000Z";
/** Applies the migrations before this one, then `seed`, then the rest. */
function migrate(seed: string) {
  const sqlite = new DatabaseSync(":memory:");
  const target = files.findIndex((f) =>
    f.endsWith("_quality_review_policy.sql"),
  );
  expect(target).toBeGreaterThan(0);
  for (const file of files.slice(0, target)) apply(sqlite, file);
  sqlite.exec(seed);
  for (const file of files.slice(target)) apply(sqlite, file);
  return sqlite;
}

describe("migration 0011: engagement access history", () => {
  it("copies existing grants and records later changes with the role held", () => {
    const sqlite = migrate(
      `INSERT INTO tenants(id,name,created_at) VALUES('t','P','${at}');
       INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('c','t','C','S','${at}');
       INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES('E','t','c','A',1,'{}','init');
       INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('t','lead','Lead Auditor',NULL,'L','active'),('t','eqr','Engagement Quality Reviewer',NULL,'Q','active'),('t','gone','Auditor',NULL,'G','active');
       INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('t','E','lead',1,'lead','${at}'),('t','E','eqr',1,'lead','${at}'),('t','E','gone',0,'lead','${at}');`,
    );
    const history = () =>
      sqlite
        .prepare(
          "SELECT user_id,active,role FROM engagement_access_history ORDER BY id",
        )
        .all();
    expect(history()).toEqual([
      { user_id: "eqr", active: 1, role: "Engagement Quality Reviewer" },
      { user_id: "gone", active: 0, role: null },
      { user_id: "lead", active: 1, role: "Lead Auditor" },
    ]);
    // Later grants and withdrawals are recorded with the role at the time.
    sqlite.exec(
      `UPDATE engagement_access SET active=0 WHERE user_id='lead';
       UPDATE memberships SET role='Engagement Quality Reviewer' WHERE user_id='lead';
       UPDATE engagement_access SET active=1 WHERE user_id='lead';`,
    );
    expect(history().slice(3)).toEqual([
      { user_id: "lead", active: 0, role: "Lead Auditor" },
      { user_id: "lead", active: 1, role: "Engagement Quality Reviewer" },
    ]);
    expect(
      sqlite.prepare("SELECT eqr_cooling_off_days FROM tenants").get(),
    ).toEqual({ eqr_cooling_off_days: null });
  });

  it("rebuilds earlier grants that a re-grant overwrote from the events", async () => {
    const ev = (n: number, action: string, details: object) =>
      `('t','ME-${n}','lead','${action}','${JSON.stringify(details)}','h','2026-0${n}-01T00:00:00.000Z')`;
    const eqrRole = "Engagement Quality Reviewer";
    const sqlite = migrate(
      `INSERT INTO tenants(id,name,created_at) VALUES('t','P','${at}');
       INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('c','t','C','S','${at}');
       INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES('E','t','c','A',1,'{}','init'),('F','t','c','B',1,'{}','init');
       INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('t','lead','Lead Auditor',NULL,'L','active'),('t','q','${eqrRole}',NULL,'Q','active'),('t','r','${eqrRole}',NULL,'R','active');
       INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES
         ${ev(1, "grantMember", { userId: "q", role: "Auditor", engagementIds: ["E"] })},
         ${ev(2, "updateMember", { userId: "q", role: eqrRole, engagementIds: ["E"], withdrawn: { engagementIds: ["E"], workerIds: [] } })},
         ${ev(3, "grantMember", { userId: "r", role: eqrRole, engagementIds: ["E"] })};
       INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) VALUES
         ('t','F','EV-1','lead','setEngagementAccess','0','h1','2026-01-15T00:00:00.000Z','{"userId":"r","active":true}'),
         ('t','F','EV-2','lead','setEngagementAccess','h1','h2','2026-02-15T00:00:00.000Z','{"userId":"r","active":false}');
       INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('t','E','q',1,'lead','2026-02-01T00:00:00.000Z'),('t','E','r',1,'lead','2026-03-01T00:00:00.000Z'),('t','F','r',0,'lead','2026-02-15T00:00:00.000Z');`,
    );
    const row = (
      e: string,
      u: string,
      active: number,
      role: string | null,
      when: string,
    ) => ({ e, u, active, role, at: when + "T00:00:00.000Z" });
    expect(
      sqlite
        .prepare(
          "SELECT engagement_id AS e,user_id AS u,active,role,at FROM engagement_access_history ORDER BY id",
        )
        .all(),
    ).toEqual([
      row("E", "q", 1, "Auditor", "2026-01-01"),
      row("F", "r", 1, null, "2026-01-15"),
      // The role change withdraws the Auditor grant before the re-grant.
      row("E", "q", 0, "Auditor", "2026-02-01"),
      row("E", "q", 1, eqrRole, "2026-02-01"),
      row("F", "r", 0, null, "2026-02-15"),
      row("E", "r", 1, eqrRole, "2026-03-01"),
      // The current rows follow the rebuilt ones.
      row("E", "q", 1, eqrRole, "2026-02-01"),
      row("F", "r", 0, null, "2026-02-15"),
      row("E", "r", 1, eqrRole, "2026-03-01"),
    ]);
    // The Auditor tenure on E counts as team membership until the role
    // change, and the access change on F until its withdrawal; reviewer
    // grants do not count.
    const settings = env as { DB?: unknown };
    const prepared = (sql: string, values: SQLInputValue[] = []) => ({
      bind: (...bound: SQLInputValue[]) => prepared(sql, bound),
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    });
    settings.DB = { prepare: (sql: string) => prepared(sql) };
    try {
      expect(Object.fromEntries(await grantInvolvement("t", "c", "q"))).toEqual(
        { E: "2026-02-01T00:00:00.000Z" },
      );
      expect(Object.fromEntries(await grantInvolvement("t", "c", "r"))).toEqual(
        { F: "2026-02-15T00:00:00.000Z" },
      );
    } finally {
      delete settings.DB;
    }
  });

  it("counts a withdrawal under another role whose grant left no event", async () => {
    const eqrRole = "Engagement Quality Reviewer";
    const ev = (n: number, action: string, details: object) =>
      `('t','ME-${n}','lead','${action}','${JSON.stringify(details)}','h','2026-0${n}-01T00:00:00.000Z')`;
    // q was granted as Auditor with no engagements and held a grant on E
    // adopted by migration 0005, which left no event. The change to reviewer
    // withdrew E, and a later update re-granted E as reviewer.
    const sqlite = migrate(
      `INSERT INTO tenants(id,name,created_at) VALUES('t','P','${at}');
       INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('c','t','C','S','${at}');
       INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES('E','t','c','A',1,'{}','init');
       INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('t','lead','Lead Auditor',NULL,'L','active'),('t','q','${eqrRole}',NULL,'Q','active');
       INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES
         ${ev(1, "grantMember", { userId: "q", role: "Auditor", engagementIds: [] })},
         ${ev(2, "updateMember", { userId: "q", role: eqrRole, engagementIds: [], withdrawn: { engagementIds: ["E"], workerIds: [] } })},
         ${ev(3, "updateMember", { userId: "q", role: eqrRole, engagementIds: ["E"], withdrawn: { engagementIds: [], workerIds: [] } })};
       INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('t','E','q',1,'lead','2026-03-01T00:00:00.000Z');`,
    );
    expect(
      sqlite
        .prepare(
          "SELECT active,role FROM engagement_access_history WHERE user_id='q' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { active: 0, role: "Auditor" },
      { active: 1, role: eqrRole },
      { active: 1, role: eqrRole },
    ]);
    const settings = env as { DB?: unknown };
    const prepared = (sql: string, values: SQLInputValue[] = []) => ({
      bind: (...bound: SQLInputValue[]) => prepared(sql, bound),
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    });
    settings.DB = { prepare: (sql: string) => prepared(sql) };
    try {
      // The withdrawal of the Auditor grant is team membership until then.
      expect(Object.fromEntries(await grantInvolvement("t", "c", "q"))).toEqual(
        { E: "2026-02-01T00:00:00.000Z" },
      );
    } finally {
      delete settings.DB;
    }
  });
});
