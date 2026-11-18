// drizzle/*_legacy_access_adoption.sql adopts, once, the practice access that
// predates engagement grants, which context() used to re-run on every request
// (F-53). This applies the earlier migrations to a local D1 database, writes
// legacy rows, then runs the adoption twice and checks what it adopted, what
// it left alone and that a second run changes nothing.
import assert from "node:assert/strict";
import "./harness/env.mjs";
import fs from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const files = (await fs.readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const adoption = files.find((f) => f.endsWith("_legacy_access_adoption.sql"));
assert(adoption, "drizzle/*_legacy_access_adoption.sql is missing");
const statements = async (file) =>
  (await fs.readFile("drizzle/" + file, "utf8"))
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script:
      "export default { fetch() { return new Response(null, { status: 404 }); } };",
    compatibilityDate: "2026-05-15",
    d1Databases: { DB: "access-adoption" },
  }),
);
try {
  const db = await mf.getD1Database("DB");
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  const rows = async (sql, ...args) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all()
    ).results;
  for (const file of files.filter((f) => f < adoption))
    for (const sql of await statements(file)) await run(sql);

  const at = "2026-10-01T00:00:00.000Z";
  // Practice A predates practice administrators and engagement grants.
  await run(
    "INSERT INTO tenants(id,name,created_at) VALUES('tenant-a','Legacy practice',?),('tenant-b','Current practice',?)",
    at,
    at,
  );
  for (const [tenant, user, role, client, status] of [
    ["tenant-a", "user-b-lead", "Lead Auditor", null, "active"],
    ["tenant-a", "user-a-lead", "Lead Auditor", null, "active"],
    ["tenant-a", "user-auditor", "Auditor", null, "active"],
    ["tenant-a", "user-reviewer", "Reviewer", null, "active"],
    ["tenant-a", "user-revoked", "Auditor", null, "revoked"],
    ["tenant-a", "user-client", "Client Viewer", "CL-a", "active"],
    ["tenant-b", "user-admin", "Lead Auditor", null, "active"],
    ["tenant-b", "user-former", "Auditor", null, "active"],
  ])
    await run(
      "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES(?,?,?,?,?,?)",
      tenant,
      user,
      role,
      client,
      user,
      status,
    );
  await run(
    "INSERT INTO clients(tenant_id,id,name,sector,created_at) VALUES('tenant-a','CL-a','Client A','Health',?),('tenant-b','CL-b','Client B','Retail',?)",
    at,
    at,
  );
  await run(
    "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) VALUES('tenant-a','ENG-a','CL-a','Legacy',1,'{}','init'),('tenant-b','ENG-b','CL-b','Current',1,'{}','init')",
  );
  // Practice B already manages access explicitly, including a revoked grant.
  await run(
    "INSERT INTO practice_admins(tenant_id,user_id,active) VALUES('tenant-b','user-admin',1)",
  );
  await run(
    "INSERT INTO engagement_access_policies(tenant_id,engagement_id,created_at) VALUES('tenant-b','ENG-b',?)",
    at,
  );
  await run(
    "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('tenant-b','ENG-b','user-admin',1,'user-admin',?),('tenant-b','ENG-b','user-former',0,'user-admin',?)",
    at,
    at,
  );

  const snapshot = async () => ({
    admins: await rows(
      "SELECT tenant_id,user_id,active FROM practice_admins ORDER BY tenant_id,user_id",
    ),
    access: await rows(
      "SELECT tenant_id,engagement_id,user_id,active,actor FROM engagement_access ORDER BY tenant_id,user_id",
    ),
    policies: await rows(
      "SELECT tenant_id,engagement_id FROM engagement_access_policies ORDER BY tenant_id",
    ),
  });
  for (const sql of await statements(adoption)) await run(sql);
  const adopted = await snapshot();

  assert.deepEqual(adopted.admins, [
    { tenant_id: "tenant-a", user_id: "user-a-lead", active: 1 },
    { tenant_id: "tenant-b", user_id: "user-admin", active: 1 },
  ]);
  assert.deepEqual(
    adopted.access
      .filter((a) => a.tenant_id === "tenant-a")
      .map((a) => [a.user_id, a.active, a.actor]),
    ["user-a-lead", "user-auditor", "user-b-lead", "user-reviewer"].map(
      (user) => [user, 1, "legacy-access-adoption"],
    ),
    "legacy engagements keep every active internal member, and only them",
  );
  assert.deepEqual(
    adopted.access
      .filter((a) => a.tenant_id === "tenant-b")
      .map((a) => [a.user_id, a.active]),
    [
      ["user-admin", 1],
      ["user-former", 0],
    ],
    "explicitly managed engagements are left alone; a revoked grant stays revoked",
  );
  assert.deepEqual(adopted.policies, [
    { tenant_id: "tenant-a", engagement_id: "ENG-a" },
    { tenant_id: "tenant-b", engagement_id: "ENG-b" },
  ]);

  for (const sql of await statements(adoption)) await run(sql);
  assert.deepEqual(await snapshot(), adopted, "a second run changes nothing");
  console.log(
    "PASS legacy access adoption runs once as a migration: first Lead administers, internal members keep legacy engagements, managed access untouched, idempotent",
  );
} finally {
  await mf.dispose();
}
