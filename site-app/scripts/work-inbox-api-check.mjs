// The work inbox API: accessible-engagement counts, engagement isolation,
// client-role refusal, invalid pages and exhausted pagination, against the
// built Worker in Miniflare. Split out of the former
// scripts/integration-check.mjs (#52).
import assert from "node:assert/strict";
import { apiClient, fixtureUsers, startWorker } from "./harness/worker.mjs";

const { mf, transport } = await startWorker("audit-work-inbox");
try {
  const { owner, reviewer, viewer } = fixtureUsers();
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
  await request("/api/work-inbox?" + new URLSearchParams({ tenantId }), {
    user: viewer,
    status: 403,
  });
  const inboxPath = "/api/work-inbox?" + new URLSearchParams({ tenantId });
  const ownerInboxBefore = await request(inboxPath),
    reviewerInboxBefore = await request(inboxPath, { user: reviewer });
  assert.equal(
    ownerInboxBefore.loadedEngagements,
    workspace.engagements.length,
    "Inbox counts accessible engagements, independently of work-item count",
  );
  assert.equal(
    reviewerInboxBefore.loadedEngagements,
    1,
    "Reviewer has only the explicitly assigned engagement",
  );
  const privateInboxEngagement = await management("createEngagement", {
    clientId: e.clientId,
    title: "Owner-only work inbox fixture",
  });
  const ownerInboxAfter = await request(inboxPath),
    reviewerInboxAfter = await request(inboxPath, { user: reviewer });
  assert.equal(
    ownerInboxAfter.loadedEngagements,
    ownerInboxBefore.loadedEngagements + 1,
  );
  assert(
    ownerInboxAfter.items.some(
      (i) => i.engagementId === privateInboxEngagement.details.engagementId,
    ),
    "Accessible newly created engagement contributes planning work",
  );
  assert.equal(
    reviewerInboxAfter.loadedEngagements,
    reviewerInboxBefore.loadedEngagements,
    "Inaccessible engagements do not enter the loaded-engagement count",
  );
  assert(
    reviewerInboxAfter.items.every((i) => i.engagementId === e.id),
    "Inbox never exposes another user’s inaccessible engagement IDs",
  );
  await request(
    "/api/workspace?" +
      new URLSearchParams({
        tenantId,
        engagementId: privateInboxEngagement.details.engagementId,
      }),
    { user: reviewer, status: 404 },
  );
  for (const page of ["-1", "1.5", "invalid", "10001"])
    await request(
      "/api/work-inbox?" + new URLSearchParams({ tenantId, page }),
      { status: 400 },
    );
  const emptyInboxPage = await request(
    "/api/work-inbox?" + new URLSearchParams({ tenantId, page: "1" }),
  );
  assert.equal(emptyInboxPage.loadedEngagements, 0);
  assert.deepEqual(emptyInboxPage.items, []);
  assert.equal(emptyInboxPage.nextPage, null);
  console.log(
    "PASS inbox accessible-engagement counts, engagement isolation, invalid pages and exhausted pagination",
  );
} finally {
  await mf.dispose();
}
