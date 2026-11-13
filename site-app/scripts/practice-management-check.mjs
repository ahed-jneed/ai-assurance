// Practice management over the API: role checks, the atomic concurrent
// command guard, client and member management, revocation and restoration,
// and the immutable access history, against the built Worker in Miniflare.
// Split out of the former scripts/integration-check.mjs (#52).
import assert from "node:assert/strict";
import {
  apiClient,
  base,
  fixtureUsers,
  identity,
  startWorker,
} from "./harness/worker.mjs";

const { mf, testDb, transport } = await startWorker(
  "audit-practice-management",
);
try {
  const { owner, reviewer, viewer, other } = fixtureUsers();
  const h = identity;
  let workspace, e, tenantId;
  const { request, refresh, management, command } = apiClient(
    transport,
    owner,
    {
      get tenantId() {
        return tenantId;
      },
      get workspace() {
        return workspace;
      },
      set workspace(value) {
        workspace = value;
      },
      get e() {
        return e;
      },
      set e(value) {
        e = value;
      },
    },
  );
  workspace = await request("/api/workspace");
  e = workspace.engagement;
  tenantId = workspace.tenantId;
  await request("/api/workspace", { status: 200, user: other });
  await command("grantMember", {
    userId: reviewer,
    displayName: "Independent Reviewer",
    role: "Reviewer",
    clientId: null,
  });
  await request("/api/assurance", {
    method: "POST",
    body: {
      tenantId,
      engagementId: e.id,
      op: "setAccess",
      data: {
        userId: reviewer,
        active: true,
        reason: "Independent review fixture engagement assignment",
      },
    },
  });
  await refresh();
  await command("grantMember", {
    userId: viewer,
    displayName: "Client Viewer",
    role: "Client Viewer",
    clientId: e.clientId,
  });
  await command(
    "createClient",
    { name: "Unauthorized client", sector: "Test" },
    viewer,
    403,
  );
  const before = workspace.clients.length,
    version = workspace.managementVersion;
  const races = await Promise.all(
    ["Concurrent A", "Concurrent B"].map((name) =>
      transport(base + "/api/management", {
        method: "POST",
        headers: { ...h(owner), "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "createClient",
          data: { name, sector: "Test" },
          tenantId,
          expectedVersion: version,
        }),
      }),
    ),
  );
  for (const r of races) {
    if (![200, 409].includes(r.status))
      console.log(
        "Unexpected concurrency response:",
        r.status,
        await r.clone().text(),
      );
  }
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  await refresh();
  assert.equal(workspace.clients.length, before + 1);
  console.log("PASS RBAC and atomic concurrent command guard");
  const auditVersion = e.version,
    managedClient = workspace.clients.find((c) =>
      c.name.startsWith("Concurrent"),
    );
  await management("updateClient", {
    clientId: managedClient.id,
    name: "Edited fixture client",
    sector: "Manufacturing",
  });
  assert.equal(e.version, auditVersion);
  await management(
    "updateClient",
    { clientId: "CL-other-tenant", name: "Invalid", sector: "Test" },
    owner,
    404,
  );
  await management(
    "grantMember",
    { userId: owner, displayName: "Self", role: "Auditor", clientId: null },
    owner,
    400,
  );
  await management(
    "updateMember",
    {
      userId: "nonexistent",
      displayName: "Nobody",
      role: "Reviewer",
      clientId: null,
    },
    owner,
    404,
  );
  await management("updateMember", {
    userId: reviewer,
    displayName: "Independent Reviewer",
    role: "Auditor",
    clientId: null,
    // A role change withdraws earlier grants; the engagement is kept by
    // listing it (F-24).
    engagementIds: [e.id],
  });
  await command("reviewPaper", { paperId: e.papers[0].id }, reviewer, 403);
  await management("updateMember", {
    userId: reviewer,
    displayName: "Independent Reviewer",
    role: "Reviewer",
    clientId: null,
    // A role change withdraws earlier grants; the engagement is kept by
    // listing it (F-24).
    engagementIds: [e.id],
  });
  await management("revokeMember", { userId: viewer });
  await request("/api/workspace?tenantId=" + tenantId, {
    user: viewer,
    status: 403,
  });
  assert.equal(
    workspace.members.find((m) => m.user_id === viewer).status,
    "revoked",
  );
  await management(
    "updateMember",
    {
      userId: viewer,
      displayName: "Client Viewer",
      role: "Client Viewer",
      clientId: e.clientId,
    },
    owner,
    409,
  );
  await management("grantMember", {
    userId: viewer,
    displayName: "Client Viewer",
    role: "Client Viewer",
    clientId: e.clientId,
  });
  await request("/api/workspace", {
    method: "POST",
    status: 400,
    body: {
      op: "grantMember",
      data: {},
      tenantId,
      engagementId: e.id,
      expectedVersion: e.version,
    },
  });
  await testDb
    .prepare("UPDATE memberships SET status='revoked' WHERE user_id=?")
    .bind(other)
    .run();
  await request("/api/workspace", { user: other, status: 403 });
  await assert.rejects(
    () =>
      testDb
        .prepare("DELETE FROM management_events WHERE tenant_id=?")
        .bind(tenantId)
        .run(),
    /immutable/,
  );
  console.log(
    "PASS independent client management, role edits, revocation, safe restoration and immutable access history",
  );
} finally {
  await mf.dispose();
}
