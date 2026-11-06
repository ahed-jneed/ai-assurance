import { beforeEach, describe, expect, it } from "vitest";
import { activeJobGuard } from "./assurance-store";
import { sqliteD1 } from "./test-d1";

// activeJobGuard on the app's migrated schema: whether an external job of an
// unchanged procedure keeps running when the engagement changes.
const at = "2026-11-05T10:00:00.000Z";
type Body = {
  workflow: {
    brief: { revision: number; status: string };
    program: { revision: number; status: string };
    procedures: { id: string; revision: number; selected: boolean }[];
  };
};
let db: ReturnType<typeof sqliteD1>["db"];
const body = (): Body => ({
  workflow: {
    brief: { revision: 2, status: "approved" },
    program: { revision: 3, status: "approved" },
    procedures: [
      { id: "PROC-1", revision: 4, selected: true },
      { id: "PROC-2", revision: 1, selected: true },
    ],
  },
});
async function store(b: Body) {
  await db
    .prepare("UPDATE engagements SET body=? WHERE tenant_id='T-1' AND id='E-1'")
    .bind(JSON.stringify(b))
    .run();
}
const active = async () =>
  !!(await db
    .prepare(
      "SELECT id FROM execution_jobs WHERE id='JOB-1' AND " + activeJobGuard,
    )
    .first());
beforeEach(async () => {
  db = sqliteD1().db;
  for (const sql of [
    `INSERT INTO tenants(id,name,created_at) VALUES('T-1','Practice','${at}')`,
    `INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('CL-1','T-1','Client','Finance','${at}')`,
    `INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES('E-1','T-1','CL-1','Audit',1,'{}','init')`,
    `INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('T-1','auditor','Auditor',NULL,'Auditor','active')`,
    `INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('T-1','E-1','auditor',1,'lead','${at}')`,
  ])
    await db.prepare(sql).run();
  // Queued under program revision 3 for PROC-1 at plan revision 4, scope 2.
  await db
    .prepare(
      "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at) VALUES('JOB-1','T-1','E-1','queued',?,?,'auditor',?)",
    )
    .bind(
      JSON.stringify({
        procedure: {
          id: "PROC-1",
          revision: 4,
          briefRevision: 2,
          programRevision: 3,
        },
      }),
      "a".repeat(64),
      at,
    )
    .run();
  await store(body());
});

describe("activeJobGuard", () => {
  it("keeps an unchanged procedure's job after another procedure changed the program", async () => {
    expect(await active()).toBe(true);
    const b = body();
    b.workflow.procedures[1].revision = 2;
    b.workflow.program.revision = 4;
    await store(b);
    expect(await active()).toBe(true);
  });

  it("stops the job when the procedure's own plan or the scope changed", async () => {
    const own = body();
    own.workflow.procedures[0].revision = 5;
    own.workflow.program.revision = 4;
    await store(own);
    expect(await active()).toBe(false);
    const scope = body();
    scope.workflow.brief.revision = 3;
    await store(scope);
    expect(await active()).toBe(false);
  });

  it("stops the job while the scope or the program awaits approval, or the procedure is deselected", async () => {
    for (const change of [
      (b: Body) => (b.workflow.program.status = "draft"),
      (b: Body) => (b.workflow.brief.status = "submitted"),
      (b: Body) => (b.workflow.procedures[0].selected = false),
    ]) {
      const b = body();
      change(b);
      await store(b);
      expect(await active()).toBe(false);
    }
  });

  it("stops the job when its creator loses auditor access", async () => {
    await db
      .prepare(
        "UPDATE engagement_access SET active=0 WHERE tenant_id='T-1' AND user_id='auditor'",
      )
      .run();
    expect(await active()).toBe(false);
  });
});
