// The access lifecycle of the built Worker (#12, docs/security/identity.md):
// self-signup off by default outside dev and limited by SELF_SIGNUP;
// invitations by email consumed at the invitee's next sign-in; revocation and
// role changes withdraw engagement grants and sponsored runner workers, which
// a re-grant never restores (F-24); practice administration granted, revoked
// and transferred while one active administrator remains (F-43); practice
// rename and per-practice quotas (F-44 / F-09); every write refused to a
// Client Viewer (F-56); and drizzle 0007 withdrawing what earlier revocations
// left active. Needs `npm run build` first.
import assert from "node:assert/strict";
import "./harness/env.mjs";
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
const lifecycle = migrationFiles.find((f) =>
  f.endsWith("_access_lifecycle.sql"),
);
assert(lifecycle, "drizzle/*_access_lifecycle.sql is missing");

const trusted = {
  IDENTITY_MODE: "trusted-headers",
  IDENTITY_TRUSTED_HEADERS: "loopback-tests",
};
/** The trusted-headers identity of a fixture user. */
const as = (user) => ({
  "x-assurance-user-id": "user-" + user,
  "x-assurance-user-email": user + "@fixture.invalid",
  "x-assurance-user-name": encodeURIComponent(
    user[0].toUpperCase() + user.slice(1),
  ),
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
    bindings: { ...trusted, ...bindings },
    d1Databases: { DB: "access-lifecycle" },
    r2Buckets: { BUCKET: "access-lifecycle-evidence" },
    d1Persist: false,
    r2Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
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
    await check({ call, rows });
  } finally {
    await mf.dispose();
  }
}

// --- Self-signup is off by default outside dev ------------------------------
for (const [label, bindings, allowed] of [
  ["unset in trusted-headers mode", {}, false],
  ["off", { SELF_SIGNUP: "off" }, false],
  [
    "an allowlist without the user",
    { SELF_SIGNUP: "boss@firm.example" },
    false,
  ],
  ["open", { SELF_SIGNUP: "open" }, true],
  ["an allowlist naming the domain", { SELF_SIGNUP: "@fixture.invalid" }, true],
])
  await withWorker(bindings, async ({ call, rows }) => {
    const response = await call("/api/workspace", as("visitor"));
    if (allowed) {
      assert.equal(response.status, 200, label);
      assert.equal(response.body.memberships[0].name, "Visitor practice");
    } else {
      assert.deepEqual(
        response,
        {
          status: 403,
          body: {
            error:
              "You have no practice membership or pending invitation. Ask a practice administrator to invite visitor@fixture.invalid.",
            // The signed-in account, for the minimal shell (#225).
            account: { name: "Visitor" },
          },
        },
        label,
      );
      assert.deepEqual(await rows("SELECT id FROM tenants"), [], label);
    }
  });
console.log(
  "PASS self-signup is off unless SELF_SIGNUP opens it or lists the user; a provisioned practice is named after its founder",
);

// --- The lifecycle in one practice ------------------------------------------
await withWorker(
  { SELF_SIGNUP: "lead@fixture.invalid", TENANT_MAX_ENGAGEMENTS: "3" },
  async ({ call, rows }) => {
    const lead = as("lead"),
      auditor = as("auditor"),
      viewer = as("viewer"),
      stranger = as("stranger");
    let view = (await call("/api/workspace", lead)).body;
    const tenantId = view.tenantId;
    assert.equal(view.identity.practiceAdmin, true);
    const load = async (who = lead) =>
      (view = (await call("/api/workspace?tenantId=" + tenantId, who)).body);
    // The practice's Access log, newest first (#181, #185): the workspace
    // load no longer carries management events.
    const accessLog = async (who = lead) => {
      const response = await call(
        "/api/access-log?" + new URLSearchParams({ tenantId, limit: "50" }),
        who,
      );
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.events;
    };
    const manage = async (op, data, status = 200, who = lead) => {
      const fresh = (await call("/api/workspace?tenantId=" + tenantId, who))
        .body;
      const response = await call("/api/management", who, {
        tenantId,
        expectedVersion: fresh.managementVersion ?? 1,
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
    const { clientId } = await manage("createClient", {
      name: "Acme",
      sector: "Lending",
    });
    const { engagementId } = await manage("createEngagement", {
      clientId,
      title: "Credit model audit",
    });

    // F-44: invitations by email, consumed at the invitee's next sign-in.
    const invitation = await manage("inviteMember", {
      email: "Auditor@Fixture.invalid",
      displayName: "Avery Auditor",
      role: "Auditor",
      engagementIds: [engagementId],
    });
    assert.equal(invitation.email, "auditor@fixture.invalid");
    assert.equal(
      (
        await manage(
          "inviteMember",
          { email: "auditor@fixture.invalid", role: "Reviewer" },
          409,
        )
      ).error,
      "An invitation for this email is already pending. Cancel it to invite again.",
    );
    await manage("inviteMember", {
      email: "viewer@fixture.invalid",
      role: "Client Viewer",
      clientId,
    });
    const cancelled = await manage("inviteMember", {
      email: "stranger@fixture.invalid",
      role: "Auditor",
    });
    await manage("cancelInvitation", { invitationId: cancelled.invitationId });
    await load();
    assert.deepEqual(view.invitations.map((i) => [i.email, i.role]).sort(), [
      ["auditor@fixture.invalid", "Auditor"],
      ["viewer@fixture.invalid", "Client Viewer"],
    ]);
    const versionBefore = view.managementVersion;

    const joined = (await call("/api/workspace", auditor)).body;
    assert.equal(joined.tenantId, tenantId, JSON.stringify(joined));
    assert.equal(joined.identity.role, "Auditor");
    assert.deepEqual(
      joined.engagements.map((e) => e.id),
      [engagementId],
    );
    assert.deepEqual(
      await rows(
        "SELECT status,accepted_by FROM invitations WHERE tenant_id=? AND id=?",
        tenantId,
        invitation.invitationId,
      ),
      [{ status: "accepted", accepted_by: "user-auditor" }],
    );
    await load();
    assert.equal(view.managementVersion, versionBefore + 1);
    assert.equal(
      (await accessLog()).find((e) => e.action !== "signIn").action,
      "acceptInvitation",
    );
    assert.equal(
      view.members.find((m) => m.user_id === "user-auditor").display_name,
      "Avery Auditor",
    );
    // A cancelled invitation admits nobody; self-signup stays closed.
    assert.equal((await call("/api/workspace", stranger)).status, 403);
    console.log(
      "PASS an invitation by email joins the inviting practice with its role and engagements at the next sign-in; cancelled ones admit nobody",
    );

    // F-24: a Lead's grants and sponsored runner tokens stop on revoke and
    // are not restored by a re-grant.
    await manage("updateMember", {
      userId: "user-auditor",
      displayName: "Avery Auditor",
      role: "Lead Auditor",
      engagementIds: [engagementId],
    });
    const fresh = (
      await call(
        "/api/workspace?tenantId=" + tenantId + "&engagementId=" + engagementId,
        auditor,
      )
    ).body;
    const enrolled = await call("/api/assurance", auditor, {
      tenantId,
      engagementId,
      op: "enrollWorker",
      data: {
        name: "Sponsored runner",
        imageDigest: "sha256:" + "5".repeat(64),
        formats: ["provided_predictions"],
        securityReview: "Loopback fixture",
      },
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    assert(fresh.engagement);
    const runner = (token) => ({
      Authorization: "Bearer " + token,
    });
    const claim = {
      op: "claim",
      imageDigest: "sha256:" + "5".repeat(64),
      formats: ["provided_predictions"],
    };
    assert.deepEqual(
      await call("/api/runner", runner(enrolled.body.token), claim),
      { status: 200, body: { idle: true } },
    );
    await load();
    assert.deepEqual(
      view.members.find((m) => m.user_id === "user-auditor"),
      {
        user_id: "user-auditor",
        role: "Lead Auditor",
        client_id: null,
        display_name: "Avery Auditor",
        status: "active",
        email: "auditor@fixture.invalid",
        practice_admin: false,
        grants: [{ id: engagementId, title: "Credit model audit" }],
        sponsored_workers: 1,
      },
      "administrators see each member's grants and sponsored workers",
    );
    const revoked = await manage("revokeMember", { userId: "user-auditor" });
    assert.deepEqual(revoked.withdrawn, {
      engagementIds: [engagementId],
      workerIds: [enrolled.body.workerId],
    });
    assert.deepEqual(
      await call("/api/runner", runner(enrolled.body.token), claim),
      { status: 401, body: { error: "Runner credential invalid or revoked" } },
    );
    assert.equal((await call("/api/workspace", auditor)).status, 403);
    assert.equal(
      (
        await manage(
          "grantMember",
          {
            userId: "user-auditor",
            displayName: "Avery Auditor",
            role: "Lead Auditor",
          },
          400,
        )
      ).error,
      "List the engagements to grant again; earlier grants are not restored",
    );
    await manage("grantMember", {
      userId: "user-auditor",
      displayName: "Avery Auditor",
      role: "Lead Auditor",
      engagementIds: [],
    });
    const restored = (await call("/api/workspace", auditor)).body;
    assert.equal(restored.identity.role, "Lead Auditor");
    assert.deepEqual(restored.engagements, [], "no engagement comes back");
    assert.equal(
      (await call("/api/runner", runner(enrolled.body.token), claim)).status,
      401,
      "the sponsored runner token stays revoked",
    );
    assert.deepEqual(
      await rows(
        "SELECT active FROM engagement_access WHERE tenant_id=? AND user_id='user-auditor'",
        tenantId,
      ),
      [{ active: 0 }],
    );
    // A role change withdraws grants too.
    await manage("updateMember", {
      userId: "user-auditor",
      displayName: "Avery Auditor",
      role: "Lead Auditor",
      engagementIds: [engagementId],
    });
    await manage("updateMember", {
      userId: "user-auditor",
      displayName: "Avery Auditor",
      role: "Reviewer",
      engagementIds: [],
    });
    assert.deepEqual(
      (await call("/api/workspace", auditor)).body.engagements,
      [],
    );
    console.log(
      "PASS revoke and role change withdraw engagement grants and sponsored runner tokens in the same batch; re-grant lists engagements explicitly and restores nothing",
    );

    // An invitation issued before a revocation never restores access: it is
    // closed as superseded at the revoked member's next request. Revocation
    // cancels the invitations for a member's recorded email (#95,
    // scripts/access-followups-check.mjs), so this member's is cleared, as
    // for a member added by account ID who has not signed in since.
    await rows(
      "UPDATE memberships SET email=NULL WHERE tenant_id=? AND user_id='user-auditor'",
      tenantId,
    );
    const stale = await manage("inviteMember", {
      email: "auditor@fixture.invalid",
      role: "Lead Auditor",
      engagementIds: [engagementId],
    });
    await manage("revokeMember", { userId: "user-auditor" });
    for (const url of ["/api/workspace?tenantId=" + tenantId, "/api/workspace"])
      assert.equal((await call(url, auditor)).status, 403, url);
    assert.deepEqual(
      await rows(
        "SELECT status,accepted_by FROM invitations WHERE tenant_id=? AND id=?",
        tenantId,
        stale.invitationId,
      ),
      [{ status: "superseded", accepted_by: "user-auditor" }],
    );
    assert.deepEqual(
      await rows(
        "SELECT m.status,m.role,(SELECT COUNT(*) FROM engagement_access a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.active=1) AS grants FROM memberships m WHERE m.tenant_id=? AND m.user_id='user-auditor'",
        tenantId,
      ),
      [{ status: "revoked", role: "Reviewer", grants: 0 }],
    );
    await load();
    assert.equal(
      (await accessLog()).find((e) => e.action !== "signIn").action,
      "supersedeInvitation",
    );
    assert.deepEqual(
      view.invitations.map((i) => i.email),
      ["viewer@fixture.invalid"],
      "the superseded invitation is no longer pending",
    );
    // An invitation issued after the revocation admits the member again.
    await manage("inviteMember", {
      email: "auditor@fixture.invalid",
      role: "Reviewer",
    });
    const readmitted = (
      await call("/api/workspace?tenantId=" + tenantId, auditor)
    ).body;
    assert.equal(readmitted.identity.role, "Reviewer");
    assert.deepEqual(readmitted.engagements, []);
    console.log(
      "PASS an invitation issued before a revocation is superseded and restores nothing; one issued after it admits the member with the invited role",
    );

    // F-43: practice administration keeps one active administrator.
    assert.equal(
      (await manage("revokeAdmin", { userId: "user-lead" }, 409)).error,
      "A practice needs at least one active administrator. Grant or transfer administration first.",
    );
    await manage("transferAdmin", { userId: "user-auditor" });
    assert.equal(
      (await manage("renamePractice", { name: "Nope" }, 403)).error,
      "Practice administration permission is required",
      "the former administrator no longer manages",
    );
    await manage("grantAdmin", { userId: "user-lead" }, 200, auditor);
    await manage("revokeAdmin", { userId: "user-auditor" }, 200, auditor);
    assert.equal(
      (await manage("revokeAdmin", { userId: "user-lead" }, 409)).error,
      "A practice needs at least one active administrator. Grant or transfer administration first.",
    );
    assert.deepEqual(
      (await accessLog())
        .map((e) => e.action)
        .filter((a) => a.endsWith("Admin"))
        .reverse(),
      ["transferAdmin", "grantAdmin", "revokeAdmin"],
    );
    console.log(
      "PASS practice administration is granted, revoked and transferred as management events while one active administrator remains",
    );

    // F-44: practice rename and the engagement quota.
    await manage("renamePractice", { name: "Lea & Partners" });
    assert.equal(
      (await load()).memberships.find((m) => m.tenant_id === tenantId).name,
      "Lea & Partners",
    );
    await manage("createEngagement", { clientId, title: "Third" });
    assert.match(
      (await manage("createEngagement", { clientId, title: "Fourth" }, 429))
        .error,
      /^This practice has reached its limit of 3 engagements\. Nothing was created\./,
    );
    console.log(
      "PASS a practice can be renamed, and its engagement quota refuses more with a clear error",
    );

    // F-56: a Client Viewer reads and is refused every write.
    const viewerView = (await call("/api/workspace", viewer)).body;
    assert.equal(viewerView.identity.role, "Client Viewer");
    const readOnly = {
      status: 403,
      body: { error: "Client Viewers have read-only access" },
    };
    for (const op of [
      "renameEngagement",
      "createPaper",
      "comment",
      "createEvidenceRequest",
      "grantClientRequest",
      "createReport",
      "archiveEverything",
    ])
      assert.deepEqual(
        await call("/api/workspace", viewer, {
          tenantId,
          engagementId,
          expectedVersion: 1,
          op,
          data: {},
        }),
        readOnly,
        op,
      );
    for (const op of ["setAccess", "enrollWorker", "registerSystem"])
      assert.deepEqual(
        await call("/api/assurance", viewer, {
          tenantId,
          engagementId,
          op,
          data: {},
        }),
        readOnly,
        op,
      );
    const managementOps = (
      await call("/api/management", viewer, {
        tenantId,
        expectedVersion: 1,
        op: "x",
        data: {},
      })
    ).body.error
      .match(/Expected (.*), received/)[1]
      .split(" | ")
      .map((o) => o.slice(1, -1));
    assert(managementOps.includes("transferAdmin"), managementOps.join());
    for (const op of managementOps)
      assert.deepEqual(
        await call("/api/management", viewer, {
          tenantId,
          expectedVersion: 1,
          op,
          data: {},
        }),
        readOnly,
        op,
      );
    console.log(
      `PASS a Client Viewer is refused every management op (${managementOps.length}) and workspace and assurance writes with 403`,
    );
  },
);

// --- The hourly save quota --------------------------------------------------
await withWorker(
  { SELF_SIGNUP: "open", TENANT_MAX_SAVES_PER_HOUR: "2" },
  async ({ call, rows }) => {
    const lead = as("lead");
    const view = (await call("/api/workspace", lead)).body;
    const rename = (version) =>
      call("/api/workspace", lead, {
        tenantId: view.tenantId,
        engagementId: view.engagement.id,
        expectedVersion: version,
        op: "renameEngagement",
        data: { title: "Renamed " + version, dueDate: "" },
      });
    // The provisioned engagement's first snapshot counts as one save.
    assert.equal((await rename(1)).status, 200);
    assert.deepEqual(await rename(2), {
      status: 429,
      body: {
        error:
          "This practice has saved 2 engagement versions in the last hour, its hourly limit. Nothing was saved. Try again later.",
      },
    });
    assert.deepEqual(
      await rows("SELECT MAX(version) AS v FROM engagement_snapshots"),
      [{ v: 2 }],
    );
  },
);
console.log(
  "PASS each practice saves at most TENANT_MAX_SAVES_PER_HOUR engagement versions an hour, with a clear 429",
);

// --- drizzle 0007 withdraws what earlier revocations left active ------------
{
  const mf = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response(null, { status: 404 }); } };",
    compatibilityDate: "2026-05-15",
    d1Databases: { DB: "access-lifecycle-migration" },
    d1Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    const run = (sql) => db.prepare(sql).run();
    for (const file of migrationFiles.filter((f) => f < lifecycle))
      for (const sql of await statements(file)) await run(sql);
    const at = "2026-10-01T00:00:00.000Z";
    await run(
      `INSERT INTO tenants(id,name,created_at) VALUES('t','Practice','${at}')`,
    );
    await run(
      "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('t','lead','Lead Auditor',NULL,'Lead','active'),('t','gone','Lead Auditor',NULL,'Gone','revoked'),('t','aud','Auditor',NULL,'Aud','active')",
    );
    await run(
      `INSERT INTO clients(tenant_id,id,name,sector,created_at) VALUES('t','CL','Client','Retail','${at}')`,
    );
    await run(
      "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) VALUES('t','E','CL','E',1,'{}','init')",
    );
    await run(
      `INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('t','E','lead',1,'lead','${at}'),('t','E','gone',1,'lead','${at}'),('t','E','aud',1,'lead','${at}')`,
    );
    await run(
      "INSERT INTO practice_admins(tenant_id,user_id,active) VALUES('t','lead',1),('t','gone',1)",
    );
    await run(
      `INSERT INTO runner_workers(id,tenant_id,engagement_id,name,token_hash,image_digest,capabilities,active,created_by,created_at) VALUES('W-lead','t','E','w','h1','d','[]',1,'lead','${at}'),('W-gone','t','E','w','h2','d','[]',1,'gone','${at}'),('W-aud','t','E','w','h3','d','[]',1,'aud','${at}')`,
    );
    for (const sql of await statements(lifecycle)) await run(sql);
    const all = async (sql) => (await db.prepare(sql).all()).results;
    assert.deepEqual(
      await all(
        "SELECT user_id,active FROM engagement_access ORDER BY user_id",
      ),
      [
        { user_id: "aud", active: 1 },
        { user_id: "gone", active: 0 },
        { user_id: "lead", active: 1 },
      ],
    );
    assert.deepEqual(
      await all("SELECT id,active FROM runner_workers ORDER BY id"),
      [
        { id: "W-aud", active: 0 },
        { id: "W-gone", active: 0 },
        { id: "W-lead", active: 1 },
      ],
    );
    assert.deepEqual(
      await all("SELECT user_id,active FROM practice_admins ORDER BY user_id"),
      [
        { user_id: "gone", active: 0 },
        { user_id: "lead", active: 1 },
      ],
    );
    console.log(
      "PASS drizzle 0007 withdraws the grants, runner workers and administration that earlier revocations left active",
    );
  } finally {
    await mf.dispose();
  }
}
