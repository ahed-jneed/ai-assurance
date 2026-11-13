// Access lifecycle follow-ups of the built Worker (#95, docs/security/identity.md):
// memberships record the identity email, so revoking a member cancels their
// pending invitations and inviting an active member is refused; pending
// invitations name who sent them; client request grants that lapsed with
// their contributor's membership show as lapsed and can no longer be
// updated; and the platform operator lists abandoned practices and deletes
// one with its snapshots and R2 objects, restricted to PLATFORM_OPERATORS
// and recorded in operator_events; a practice with issued work is never
// deleted but archived (#151): its users lose access and its issued records
// stay retained and verifiable. Also drizzle 0013's email backfill and its
// append-only triggers. Needs `npm run build` first.
import assert from "node:assert/strict";
import "./harness/env.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";

const local = "http://127.0.0.1:5173";
const modules = [
  "index.js",
  ...(await fs.readdir("dist/server", { recursive: true })).filter(
    (p) => p !== "index.js" && /\.m?js$/.test(p),
  ),
];
const migrationFiles = (await fs.readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const statements = async (file) =>
  (await fs.readFile("drizzle/" + file, "utf8"))
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
const followups = migrationFiles.find((f) =>
  f.endsWith("_access_followups.sql"),
);
assert(followups, "drizzle/*_access_followups.sql is missing");

/** The trusted-headers identity of a fixture user. */
const as = (user) => ({
  "oai-authenticated-user-id": "user-" + user,
  "oai-authenticated-user-email": user + "@fixture.invalid",
  "oai-authenticated-user-full-name": encodeURIComponent(
    user[0].toUpperCase() + user.slice(1),
  ),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  Origin: local,
});

async function withWorker(bindings, check) {
  const mf = new Miniflare({
    modules: modules.map((p) => ({
      type: "ESModule",
      path: path.resolve("dist/server", p),
    })),
    modulesRoot: path.resolve("dist/server"),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      IDENTITY_MODE: "trusted-headers",
      IDENTITY_TRUSTED_HEADERS: "loopback-tests",
      ...bindings,
    },
    d1Databases: { DB: "access-followups" },
    r2Buckets: { BUCKET: "access-followups-evidence" },
    d1Persist: false,
    r2Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    for (const file of migrationFiles)
      for (const sql of await statements(file)) await db.prepare(sql).run();
    const call = async (url, headers, body) => {
      const response = await mf.dispatchFetch(local + url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const type = response.headers.get("content-type") ?? "";
      return {
        status: response.status,
        body: type.includes("json")
          ? await response.json()
          : await response.text(),
      };
    };
    const rows = async (sql, ...args) =>
      (
        await db
          .prepare(sql)
          .bind(...args)
          .all()
      ).results;
    await check({ call, rows, db, bucket });
  } finally {
    await mf.dispose();
  }
}

/** Management and workspace calls of one practice's administrator. */
function practiceOf(call, tenantId, admin) {
  const view = async (who = admin, query = "") =>
    (await call("/api/workspace?tenantId=" + tenantId + query, who)).body;
  const manage = async (op, data, status = 200) => {
    const response = await call("/api/management", admin, {
      tenantId,
      expectedVersion: (await view()).managementVersion,
      op,
      data,
    });
    assert.equal(
      response.status,
      status,
      op + ": " + JSON.stringify(response.body),
    );
    return status === 200 ? response.body.details : response.body;
  };
  const command = async (engagementId, op, data, status = 200) => {
    const current = await view(admin, "&engagementId=" + engagementId);
    const response = await call("/api/workspace", admin, {
      tenantId,
      engagementId,
      expectedVersion: current.engagement.version,
      op,
      data,
    });
    assert.equal(
      response.status,
      status,
      op + ": " + JSON.stringify(response.body),
    );
    return response.body;
  };
  return { view, manage, command };
}

// --- Membership email, invitation sender and lapsed request grants ---------
await withWorker(
  { SELF_SIGNUP: "lead@fixture.invalid" },
  async ({ call, rows }) => {
    const lead = as("lead"),
      casey = as("casey"),
      cora = as("cora");
    const first = (await call("/api/workspace", lead)).body;
    const tenantId = first.tenantId;
    const { view, manage, command } = practiceOf(call, tenantId, lead);
    const member = async (userId) =>
      (await view()).members.find((m) => m.user_id === userId);
    assert.equal(
      (await member("user-lead")).email,
      "lead@fixture.invalid",
      "a provisioned practice records its founder's email",
    );

    // A member added by account ID has no email until they sign in.
    await manage("grantMember", {
      userId: "user-casey",
      displayName: "Casey",
      role: "Auditor",
      engagementIds: [],
    });
    assert.equal((await member("user-casey")).email, null);
    const invitation = await manage("inviteMember", {
      email: "Casey@Fixture.invalid",
      role: "Auditor",
    });
    const pending = (await view()).invitations;
    assert.deepEqual(
      pending.map((i) => [i.email, i.invited_by, i.invited_by_name]),
      [["casey@fixture.invalid", "user-lead", "Lead"]],
      "a pending invitation names the administrator who sent it",
    );
    console.log("PASS each pending invitation names who sent it");

    // Signing in records the email; the active member cannot be invited.
    assert.equal(
      (await call("/api/workspace?tenantId=" + tenantId, casey)).status,
      200,
    );
    assert.equal((await member("user-casey")).email, "casey@fixture.invalid");
    assert.equal(
      (
        await manage(
          "inviteMember",
          { email: "casey@fixture.invalid", role: "Reviewer" },
          409,
        )
      ).error,
      "Casey is already an active member with this email. Change their role or engagements in Members & access instead.",
    );
    // Revoking the member cancels their pending invitation in the same batch.
    const revoked = await manage("revokeMember", { userId: "user-casey" });
    assert.deepEqual(revoked.cancelledInvitations, [invitation.invitationId]);
    assert.deepEqual(
      await rows(
        "SELECT status,closed_at IS NOT NULL AS closed FROM invitations WHERE tenant_id=? AND id=?",
        tenantId,
        invitation.invitationId,
      ),
      [{ status: "cancelled", closed: 1 }],
    );
    assert.deepEqual((await view()).invitations, []);
    assert.equal(
      (await call("/api/workspace?tenantId=" + tenantId, casey)).status,
      403,
      "the cancelled invitation does not readmit the revoked member",
    );
    // A revoked member's email may be invited again, which readmits them.
    await manage("inviteMember", {
      email: "casey@fixture.invalid",
      role: "Reviewer",
    });
    const readmitted = (
      await call("/api/workspace?tenantId=" + tenantId, casey)
    ).body;
    assert.equal(readmitted.identity.role, "Reviewer");
    console.log(
      "PASS memberships record the identity email: revoking a member cancels their pending invitations and an active member cannot be invited",
    );

    // Lapsed client request grants.
    const engagementId = first.engagement.id;
    const clientId = first.engagement.clientId;
    await manage("grantMember", {
      userId: "user-cora",
      displayName: "Cora",
      role: "Client Contributor",
      clientId,
    });
    await command(engagementId, "adoptWorkflow", {});
    const { details: paper } = await command(engagementId, "createPaper", {
      templateId: "WP-A10-01",
    });
    await command(engagementId, "createEvidenceRequest", {
      subject: "Validation population",
      description: "Synthetic coverage support for the planned procedure.",
      responsibleParty: "Client validation owner",
      periodVersion: "Synthetic 2026 population, version 1.0",
      handling: "Synthetic data only",
      dueDate: "2026-12-31",
      paperIds: [paper.paperId],
    });
    let e = (await view(lead, "&engagementId=" + engagementId)).engagement;
    await command(engagementId, "grantClientRequest", {
      userId: "user-cora",
      requestId: e.evidenceRequests.at(-1).id,
      prompt: "Validation population",
      instructions: "Upload the synthetic extract",
      category: "Validation",
      handlingBasis: "synthetic",
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    let current = await view(lead, "&engagementId=" + engagementId);
    const grantId = current.engagement.workflow.clientGrants.at(-1).id;
    assert.deepEqual(current.lapsedClientGrants, []);
    const contributorView = (
      await call(
        "/api/workspace?tenantId=" + tenantId + "&engagementId=" + engagementId,
        cora,
      )
    ).body;
    assert.equal(contributorView.engagement.portalRequests.length, 1);
    assert.deepEqual(
      contributorView.lapsedClientGrants,
      [],
      "clients are never told about grants",
    );
    // Revoked and granted again: the old request grant lapses.
    await manage("revokeMember", { userId: "user-cora" });
    await manage("grantMember", {
      userId: "user-cora",
      displayName: "Cora",
      role: "Client Contributor",
      clientId,
    });
    current = await view(lead, "&engagementId=" + engagementId);
    assert.deepEqual(current.lapsedClientGrants, [grantId]);
    assert.equal(
      current.engagement.workflow.clientGrants.at(-1).active,
      true,
      "the lapsed grant is still marked active in the record",
    );
    const refused = await command(
      engagementId,
      "updateClientRequest",
      {
        grantId,
        prompt: "Validation population",
        instructions: "Updated instructions",
      },
      409,
    );
    assert.equal(
      refused.error,
      "This grant lapsed when the contributor's access changed. Assign the request again.",
    );
    // The contributor's only request grant lapsed, so the engagement is no
    // longer theirs to open.
    const lapsedView = await call(
      "/api/workspace?tenantId=" + tenantId + "&engagementId=" + engagementId,
      cora,
    );
    assert.equal(lapsedView.status, 404, JSON.stringify(lapsedView.body));
    e = (await call("/api/workspace?tenantId=" + tenantId, cora)).body;
    assert.deepEqual(e.engagements, [], "nor is it listed");
    console.log(
      "PASS a client request grant issued before its contributor's revocation and re-grant shows as lapsed to the Lead and can no longer be updated",
    );
  },
);

// --- The operator deletes abandoned practices -------------------------------
const old = "2026-01-05T00:00:00.000Z";
/** An abandoned practice written straight to D1, last active long ago. */
async function seedAbandoned(db, tenant) {
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  await run(
    "INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)",
    tenant,
    "Dormant practice",
    old,
  );
  await run(
    "INSERT INTO memberships(tenant_id,user_id,role,display_name,access_since,email) VALUES(?,'user-gone','Lead Auditor','Gone',?,'gone@fixture.invalid')",
    tenant,
    old,
  );
  await run(
    "INSERT INTO practice_admins(tenant_id,user_id,active) VALUES(?,'user-gone',1)",
    tenant,
  );
  await run(
    "INSERT INTO clients(tenant_id,id,name,sector,created_at) VALUES(?,'CL-1','Client','Retail',?)",
    tenant,
    old,
  );
  await run(
    "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) VALUES(?,'ENG-1','CL-1','Audit',2,'{\"reports\":[]}','c2')",
    tenant,
  );
  for (const version of [1, 2])
    await run(
      "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) VALUES(?,'ENG-1',?,'{\"reports\":[]}','h',?)",
      tenant,
      version,
      old,
    );
  await run(
    "INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) VALUES(?,'ENG-1','EV-1','user-gone','save','','h',?,'{}')",
    tenant,
    old,
  );
  await run(
    "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES(?,'ME-1','user-gone','createClient','{}','h',?)",
    tenant,
    old,
  );
  await run(
    "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES(?,'ENG-1','user-gone',1,'user-gone',?)",
    tenant,
    old,
  );
}

await withWorker(
  { SELF_SIGNUP: "open", PLATFORM_OPERATORS: "ops@fixture.invalid" },
  async ({ call, rows, db, bucket }) => {
    const lead = as("lead"),
      ops = as("ops");
    const active = (await call("/api/workspace", lead)).body.tenantId;
    await seedAbandoned(db, "t-dormant");
    for (const key of [
      "t-dormant/ENG-1/immutable/report/aaa",
      "t-dormant/ENG-1/ART-1/bbb",
      active + "/ENG-default/ART-1/ccc",
    ])
      await bucket.put(key, "stored object");

    // Only an operator may list or delete.
    const anonymous = { Origin: local };
    assert.equal((await call("/api/operator", anonymous)).status, 401);
    assert.deepEqual(await call("/api/operator", lead), {
      status: 403,
      body: { error: "Only a platform operator may use this console" },
    });
    const request = (tenantId, confirmName) => ({
      op: "deletePractice",
      data: { tenantId, confirmName, reason: "Abandoned self-signup trial" },
    });
    assert.equal(
      (
        await call(
          "/api/operator",
          lead,
          request("t-dormant", "Dormant practice"),
        )
      ).status,
      403,
      "a practice administrator cannot delete practices",
    );
    const { Origin: _origin, ...crossSite } = ops;
    void _origin;
    assert.equal(
      (
        await call(
          "/api/operator",
          crossSite,
          request("t-dormant", "Dormant practice"),
        )
      ).status,
      403,
      "the operator's deletion needs a same-origin request",
    );
    const listing = (await call("/api/operator", ops)).body;
    assert.equal(listing.abandonedAfterDays, 90);
    assert.deepEqual(
      listing.practices.map((p) => [p.id, p.snapshots, p.abandoned]),
      [["t-dormant", 2, true]],
    );
    assert.deepEqual(
      (await call("/api/operator?all=1", ops)).body.practices.map((p) => p.id),
      ["t-dormant", active],
    );
    // A typed name, an abandoned practice and a reason are required.
    assert.equal(
      (await call("/api/operator", ops, request("t-dormant", "Dormant")))
        .status,
      400,
    );
    assert.equal(
      (await call("/api/operator", ops, request(active, "Lead practice")))
        .status,
      409,
      "an active practice cannot be deleted",
    );
    assert.equal(
      (
        await call("/api/operator", ops, {
          ...request("t-dormant", "Dormant practice"),
          data: {
            tenantId: "t-dormant",
            confirmName: "Dormant practice",
            reason: "x",
          },
        })
      ).status,
      400,
    );
    assert.deepEqual(await rows("SELECT id FROM operator_events"), []);

    const deleted = await call(
      "/api/operator",
      ops,
      request("t-dormant", "Dormant practice"),
    );
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.details.objects, 2);
    assert.equal(deleted.body.details.rows.engagement_snapshots, 2);
    for (const table of [
      "tenants",
      "memberships",
      "engagements",
      "engagement_snapshots",
      "audit_events",
      "management_events",
      "engagement_access_history",
    ])
      assert.deepEqual(
        await rows(
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "tenants" ? "id" : "tenant_id"}='t-dormant'`,
        ),
        [{ n: 0 }],
        table,
      );
    assert.deepEqual(
      (await bucket.list()).objects.map((o) => o.key),
      [active + "/ENG-default/ART-1/ccc"],
    );
    assert.equal(
      (await call("/api/workspace", lead)).status,
      200,
      "other practices are untouched",
    );
    const trail = (await call("/api/operator", ops)).body.events;
    assert.deepEqual(
      trail.map((e) => [e.action, e.tenantId, e.actorEmail]),
      [
        ["purgePracticeObjects", "t-dormant", "ops@fixture.invalid"],
        ["deletePractice", "t-dormant", "ops@fixture.invalid"],
      ],
    );
    assert.equal(trail[1].details.reason, "Abandoned self-signup trial");
    assert.equal(trail[1].details.name, "Dormant practice");
    await assert.rejects(
      db.prepare("DELETE FROM operator_events").run(),
      /immutable/,
    );
    await assert.rejects(
      db.prepare("DELETE FROM engagement_snapshots").run(),
      /append-only/,
    );
    // The console page answers operators and turns everyone else away.
    assert.match(
      (await call("/operator", lead)).body,
      /Only a platform operator may use this page/,
    );
    const page = await call("/operator", ops);
    assert.equal(page.status, 200);
    assert.doesNotMatch(
      page.body,
      /Only a platform operator may use this page/,
    );
    console.log(
      "PASS only a platform operator lists abandoned practices and deletes one with its snapshots and stored objects, recorded in an immutable operator audit trail",
    );
  },
);

// --- The operator archives a practice with issued work (#151) --------------
await withWorker(
  { SELF_SIGNUP: "off", PLATFORM_OPERATORS: "ops@fixture.invalid" },
  async ({ call, rows, db, bucket }) => {
    const ops = as("ops"),
      gone = as("gone");
    await seedAbandoned(db, "t-issued");
    // Its issued work: one released report with consistent internal and
    // client packages, stored as dehydrate() (lib/engagement-storage.ts)
    // stores every saved report: the snapshots in R2 under content-addressed
    // keys, the record holding `snapshot: {}` and storage references.
    const hex = (text) => createHash("sha256").update(text).digest("hex");
    const snapshot = { conclusion: "Unmodified", papers: [], evidence: [] };
    const clientSnapshot = { conclusion: "Unmodified" };
    const part = async (type, value) => {
      const body = JSON.stringify(value),
        sha256 = hex(body),
        key = "t-issued/ENG-1/immutable/" + type + "/" + sha256;
      await bucket.put(key, body, { customMetadata: { sha256 } });
      return { key, sha256 };
    };
    const refs = {
      snapshot: await part("report", snapshot),
      clientSnapshot: await part("client-report", clientSnapshot),
    };
    const report = {
      id: "RPT-1",
      kind: "final",
      createdAt: old,
      actor: "user-gone",
      sha256: hex(JSON.stringify(snapshot)),
      clientSha256: hex(JSON.stringify(clientSnapshot)),
      snapshot: {},
      release: { state: "released", releasedAt: old },
    };
    await db
      .prepare(
        "UPDATE engagements SET body=? WHERE tenant_id='t-issued' AND id='ENG-1'",
      )
      .bind(
        JSON.stringify({
          reports: [report],
          papers: [],
          runs: [],
          storageRefs: {
            reports: { "RPT-1": refs },
            histories: {},
            results: {},
          },
        }),
      )
      .run();
    // And a signed dossier: the record names its archive in R2 by digest.
    const archive = '{"manifest":{"files":[]},"signature":{}}';
    const dossierKey = "t-issued/ENG-1/dossiers/RPT-1/client/" + hex(archive);
    await bucket.put(dossierKey, archive);
    const dossierRecord = JSON.stringify({
      reportId: "RPT-1",
      audience: "client",
      key: dossierKey,
      sha256: hex(archive),
    });
    await db
      .prepare(
        "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) VALUES('t-issued','ENG-1','AS-DOSSIER','dossier',?,?,?,'user-gone')",
      )
      .bind(dossierRecord, hex(dossierRecord), old)
      .run();
    await db
      .prepare(
        "INSERT INTO dossier_keys(tenant_id,id,public_key,active,created_at) VALUES('t-issued','KEY-1','MCowBQYDK2VwAyEA',1,?)",
      )
      .bind(old)
      .run();
    const keys = "/api/dossier/keys?tenantId=t-issued";
    assert.equal(
      (await call(keys, gone)).status,
      200,
      "its member still reads its verification keys before the archive",
    );

    const listing = (await call("/api/operator", ops)).body;
    assert.deepEqual(
      listing.practices.map((p) => [
        p.id,
        p.retained,
        p.abandoned,
        p.archivable,
      ]),
      [["t-issued", true, false, true]],
    );
    const request = (op) => ({
      op,
      data: {
        tenantId: "t-issued",
        confirmName: "Dormant practice",
        reason: "Abandoned after its engagement closed",
      },
    });
    const refused = await call("/api/operator", ops, request("deletePractice"));
    assert.equal(refused.status, 409);
    assert.equal(
      refused.body.error,
      "This practice released a report or signed a dossier, which must be retained. It cannot be deleted; archive it instead.",
    );
    assert.equal(
      (await call("/api/operator", gone, request("archivePractice"))).status,
      403,
      "a practice administrator cannot archive practices",
    );
    assert.equal(
      (await call("/api/operator?tenantId=t-issued", ops)).status,
      409,
      "the operator reads no issued work of a practice that is not archived",
    );
    const counts = async () =>
      (
        await rows(
          "SELECT (SELECT COUNT(*) FROM engagement_snapshots WHERE tenant_id='t-issued') AS snapshots,(SELECT COUNT(*) FROM audit_events WHERE tenant_id='t-issued') AS events,(SELECT COUNT(*) FROM engagements WHERE tenant_id='t-issued') AS engagements",
        )
      )[0];
    const before = await counts();

    const archived = await call(
      "/api/operator",
      ops,
      request("archivePractice"),
    );
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    assert.equal(archived.body.details.members, 1);
    // Its users lose access, with the reason.
    const archivedMessage =
      "This practice was archived by the platform operator after a long period without activity. Its released reports and signed dossiers are retained; contact the platform operator to verify them.";
    for (const url of [
      keys,
      "/api/workspace",
      "/api/workspace?tenantId=t-issued",
    ])
      assert.deepEqual(
        await call(url, gone),
        { status: 403, body: { error: archivedMessage } },
        url,
      );
    // Its issued records stay retained and verifiable.
    assert.deepEqual(await counts(), before);
    assert.deepEqual(
      (await bucket.list({ prefix: "t-issued/" })).objects
        .map((o) => o.key)
        .sort(),
      [dossierKey, refs.clientSnapshot.key, refs.snapshot.key].sort(),
    );
    const issuedWork = async () =>
      (await call("/api/operator?tenantId=t-issued", ops)).body.issued;
    const issued = await issuedWork();
    assert.deepEqual(
      issued.reports.map((r) => [
        r.reportId,
        r.state,
        r.sha256,
        r.internal,
        r.client,
        r.valid,
      ]),
      [["RPT-1", "released", report.sha256, "valid", "valid", true]],
      "the packages are read back from R2 and match the report's digests",
    );
    assert.deepEqual(
      issued.dossiers.map((d) => [d.recordId, d.record, d.archive, d.valid]),
      [["AS-DOSSIER", "valid", "valid", true]],
    );
    // An altered client package or a missing dossier archive shows as such.
    await bucket.put(refs.clientSnapshot.key, '{"conclusion":"Adverse"}');
    await bucket.delete(dossierKey);
    const damaged = await issuedWork();
    assert.deepEqual(
      [damaged.reports[0].internal, damaged.reports[0].client],
      ["valid", "mismatch"],
    );
    assert.equal(damaged.reports[0].valid, false);
    assert.deepEqual(
      [damaged.dossiers[0].archive, damaged.dossiers[0].valid],
      ["missing", false],
    );
    await bucket.put(refs.clientSnapshot.key, JSON.stringify(clientSnapshot));
    await bucket.put(dossierKey, archive);
    assert.equal((await issuedWork()).reports[0].valid, true);
    assert.deepEqual(
      issued.keys.map((k) => [k.keyId, k.status]),
      [["KEY-1", "active"]],
    );
    assert.equal(
      (await call("/api/operator?tenantId=t-issued", gone)).status,
      403,
    );
    // It is never deleted, and stays archived.
    assert.equal(
      (await call("/api/operator", ops, request("deletePractice"))).status,
      409,
    );
    assert.equal(
      (await call("/api/operator", ops, request("archivePractice"))).status,
      409,
    );
    // The default listing keeps it as archived, so its issued work stays
    // one click away; it is never offered for deletion or archive again.
    const afterArchive = (await call("/api/operator", ops)).body;
    assert.deepEqual(
      afterArchive.practices.map((p) => [
        p.id,
        !!p.archivedAt,
        p.abandoned,
        p.archivable,
      ]),
      [["t-issued", true, false, false]],
    );
    assert.equal(afterArchive.next, null);
    assert.equal(
      (await call("/api/operator?afterActivity=x", ops)).status,
      400,
      "a page cursor names both the last activity and the practice",
    );
    const trail = (await call("/api/operator", ops)).body.events;
    assert.deepEqual(
      trail.map((e) => [e.action, e.tenantId, e.actorEmail]),
      [["archivePractice", "t-issued", "ops@fixture.invalid"]],
    );
    await assert.rejects(
      db.prepare("UPDATE tenants SET archived_at=NULL").run(),
      /stays archived/,
    );
    await assert.rejects(
      db
        .prepare(
          "UPDATE memberships SET status='active' WHERE tenant_id='t-issued'",
        )
        .run(),
      /archived/,
    );
    console.log(
      "PASS a practice whose only issued work is a released report is never deleted; the operator archives it, its users lose access and its issued records stay retained and verifiable",
    );
  },
);

// --- drizzle 0013 -----------------------------------------------------------
{
  const mf = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response(null, { status: 404 }); } };",
    compatibilityDate: "2026-05-15",
    d1Databases: { DB: "access-followups-migration" },
    d1Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    const run = (sql) => db.prepare(sql).run();
    for (const file of migrationFiles.filter((f) => f < followups))
      for (const sql of await statements(file)) await run(sql);
    const at = "2026-10-01T00:00:00.000Z";
    await run(
      `INSERT INTO tenants(id,name,created_at) VALUES('t','Practice','${at}')`,
    );
    await run(
      "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('t','joined','Auditor',NULL,'Joined','active'),('t','added','Auditor',NULL,'Added','active')",
    );
    await run(
      `INSERT INTO invitations(tenant_id,id,email,role,status,invited_by,created_at,expires_at,accepted_by,closed_at) VALUES('t','INV-1','joined@fixture.invalid','Auditor','accepted','lead','${at}','${at}','joined','${at}')`,
    );
    await run(
      `INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES('t','ME-1','lead','x','{}','h','${at}')`,
    );
    for (const sql of await statements(followups)) await run(sql);
    assert.deepEqual(
      (
        await db
          .prepare("SELECT user_id,email FROM memberships ORDER BY user_id")
          .all()
      ).results,
      [
        { user_id: "added", email: null },
        { user_id: "joined", email: "joined@fixture.invalid" },
      ],
    );
    await assert.rejects(
      run("DELETE FROM management_events"),
      /Management events are immutable/,
    );
    console.log(
      "PASS drizzle 0013 records the email of members who joined by invitation and keeps history append-only outside an operator deletion",
    );
  } finally {
    await mf.dispose();
  }
}
