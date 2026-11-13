// Authentication, practice isolation and same-origin mutations, private
// preferences and recoverable paper drafts, against the built Worker in
// Miniflare. Split out of the former scripts/integration-check.mjs (#52).
import assert from "node:assert/strict";
import {
  apiClient,
  base,
  fixtureUsers,
  identity,
  startWorker,
} from "./harness/worker.mjs";

const { mf, transport } = await startWorker("audit-workspace-access");
try {
  const { stamp, owner, reviewer, other } = fixtureUsers();
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
  await request("/api/workspace?tenantId=" + tenantId, {
    user: other,
    status: 403,
  });
  const unauth = await transport(base + "/api/workspace");
  assert.equal(unauth.status, 401);
  const csrf = await transport(base + "/api/workspace", {
    method: "POST",
    headers: {
      ...h(owner),
      Origin: "https://untrusted.invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(csrf.status, 403);
  console.log(
    "PASS authentication, tenant isolation and same-origin mutations",
  );
  const stateQ = new URLSearchParams({ tenantId, kind: "preferences" });
  let prefs = await request("/api/workspace-state?" + stateQ);
  assert.equal(prefs.version, 0);
  const prefBody = {
    tenantId,
    kind: "preferences",
    expectedVersion: 0,
    preferences: {
      views: [
        {
          id: "view1",
          name: "My findings",
          module: "Findings",
          search: "risk",
          filter: "open",
          facet: "all",
          sort: "risk",
        },
      ],
      reminderDays: 3,
      snoozed: [],
    },
  };
  await request("/api/workspace-state", { method: "POST", body: prefBody });
  await request("/api/workspace-state", {
    method: "POST",
    body: prefBody,
    status: 409,
  });
  prefs = await request("/api/workspace-state?" + stateQ);
  assert.equal(prefs.version, 1);
  await request("/api/workspace-state", {
    method: "POST",
    body: {
      ...prefBody,
      expectedVersion: 1,
      preferences: { ...prefBody.preferences, reminderDays: 7 },
    },
  });
  assert.equal((await request("/api/workspace-state?" + stateQ)).version, 2);
  const recoveryPaper = e.papers[0],
    draftScope = {
      tenantId,
      engagementId: e.id,
      kind: "paper",
      recordId: recoveryPaper.id,
      baseRevision: recoveryPaper.revision + ":" + recoveryPaper.updatedAt,
    };
  const recoveryContent = {
      body: { ...recoveryPaper.body, results: "Unsubmitted recovery draft" },
      evidenceIds: [],
      required: true,
    },
    savedRevision = e.version;
  await request("/api/workspace-state", {
    method: "POST",
    body: { ...draftScope, expectedVersion: 0, content: recoveryContent },
  });
  await refresh();
  assert.equal(e.version, savedRevision);
  assert.notEqual(e.papers[0].body.results, recoveryContent.body.results);
  const ownDraft = await request(
    "/api/workspace-state?" + new URLSearchParams(draftScope),
  );
  assert.equal(ownDraft.draft.current, true);
  assert.equal(
    ownDraft.draft.content.body.results,
    recoveryContent.body.results,
  );
  await request("/api/workspace-state", {
    method: "POST",
    body: { ...draftScope, expectedVersion: 0, content: recoveryContent },
    status: 409,
  });
  await request("/api/workspace-state", {
    method: "POST",
    body: {
      ...draftScope,
      baseRevision: "stale",
      expectedVersion: 1,
      content: recoveryContent,
    },
    status: 409,
  });
  await request("/api/workspace-state", {
    method: "POST",
    body: { ...draftScope, expectedVersion: 1, content: { body: 7 } },
    status: 400,
  });
  await request("/api/workspace-state?" + new URLSearchParams(draftScope), {
    user: other,
    status: 403,
  });
  console.log(
    "PASS private preferences CAS and recoverable drafts without audit mutation",
  );
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
  await request("/api/workspace-state?" + new URLSearchParams(draftScope), {
    user: reviewer,
    status: 200,
  }).then((v) => assert.equal(v.draft, null));
  await request("/api/workspace-state", {
    method: "POST",
    user: reviewer,
    body: { ...draftScope, expectedVersion: 0, content: recoveryContent },
    status: 403,
  });
  const onboarded = "onboarded-" + stamp;
  await management("grantMember", {
    userId: onboarded,
    displayName: "Guided auditor fixture",
    role: "Auditor",
    clientId: null,
    engagementIds: [e.id],
  });
  await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: onboarded },
  );
  await request("/api/workspace-state?" + new URLSearchParams(draftScope), {
    user: onboarded,
  }).then((v) => assert.equal(v.draft, null));
  console.log(
    "PASS a draft stays private to its author: an assigned reviewer and a newly onboarded auditor see none and cannot write it",
  );
} finally {
  await mf.dispose();
}
