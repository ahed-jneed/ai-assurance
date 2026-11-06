// Migration 0010 (#127): existing engagement grants are copied into
// engagement_access_history, a grant held now with its holder's current role
// and a withdrawn one with an unknown (NULL) role, and every later change of
// a grant is recorded by the triggers with the role held at that moment.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

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

describe("migration 0010: engagement access history", () => {
  it("copies existing grants and records later changes with the role held", () => {
    const sqlite = new DatabaseSync(":memory:");
    const target = files.findIndex((f) => f.startsWith("0010_"));
    expect(target).toBeGreaterThan(0);
    for (const file of files.slice(0, target)) apply(sqlite, file);
    sqlite.exec(
      `INSERT INTO tenants(id,name,created_at) VALUES('t','P','${at}');
       INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('c','t','C','S','${at}');
       INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES('E','t','c','A',1,'{}','init');
       INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('t','lead','Lead Auditor',NULL,'L','active'),('t','eqr','Engagement Quality Reviewer',NULL,'Q','active'),('t','gone','Auditor',NULL,'G','active');
       INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('t','E','lead',1,'lead','${at}'),('t','E','eqr',1,'lead','${at}'),('t','E','gone',0,'lead','${at}');`,
    );
    for (const file of files.slice(target)) apply(sqlite, file);
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
});
