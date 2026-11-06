import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
const base = process.argv[2] ?? "http://127.0.0.1:5173";
assert(
  ["127.0.0.1", "localhost", "::1"].includes(new URL(base).hostname),
  "This fixture identity test may run only against loopback development",
);
const moduleFiles = [
  "index.js",
  ...(await fs.readdir("dist/server", { recursive: true })).filter(
    (p) => p !== "index.js" && (p.endsWith(".js") || p.endsWith(".mjs")),
  ),
];
const mf = new Miniflare({
  modules: moduleFiles.map((p) => ({
    type: "ESModule",
    path: path.resolve("dist/server", p),
  })),
  modulesRoot: path.resolve("dist/server"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  // The fixture identity headers below are trusted only because this opts in
  // to the loopback-only test mode (docs/security/identity.md).
  bindings: {
    IDENTITY_MODE: "trusted-headers",
    IDENTITY_TRUSTED_HEADERS: "loopback-tests",
  },
  d1Databases: { DB: "audit-integration" },
  r2Buckets: { BUCKET: "audit-integration-evidence" },
  d1Persist: false,
  r2Persist: false,
});
const testDb = await mf.getD1Database("DB");
for (const file of (await fs.readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  for (const statement of (await fs.readFile("drizzle/" + file, "utf8"))
    .split("--> statement-breakpoint")
    .filter((x) => x.trim()))
    await testDb.prepare(statement.trim()).run();
const transport = async (url, options) => {
  const request = new Request(url, options);
  return mf.dispatchFetch(url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: request.body ? await request.arrayBuffer() : undefined,
  });
};
try {
  const stamp = Date.now(),
    owner = "fixture-owner-" + stamp,
    reviewer = "fixture-reviewer-" + stamp,
    viewer = "fixture-viewer-" + stamp,
    other = "fixture-other-" + stamp;
  const h = (user) => ({
    "oai-authenticated-user-id": user,
    "oai-authenticated-user-email": user + "@fixture.invalid",
    Origin: base,
  });
  const request = async (
    path,
    { user = owner, body, method = "GET", status = 200 } = {},
  ) => {
    const r = await transport(base + path, {
      method,
      headers: {
        ...h(user),
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
    });
    const value = await r.json();
    assert.equal(r.status, status, JSON.stringify(value));
    return value;
  };
  let workspace = await request("/api/workspace");
  let e = workspace.engagement;
  const tenantId = workspace.tenantId;
  async function refresh(user = owner) {
    workspace = await request(
      "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
      { user },
    );
    e = workspace.engagement;
    return workspace;
  }
  async function management(
    op,
    data,
    user = owner,
    status = 200,
    version = workspace.managementVersion,
  ) {
    const result = await request("/api/management", {
      method: "POST",
      user,
      status,
      body: { op, data, tenantId, expectedVersion: version },
    });
    if (status === 200) await refresh();
    return result;
  }
  async function command(
    op,
    data,
    user = owner,
    status = 200,
    version = e.version,
  ) {
    if (["grantMember", "createClient", "createEngagement"].includes(op))
      return management(op, data, user, status);
    const result = await request("/api/workspace", {
      method: "POST",
      user,
      status,
      body: {
        op,
        data,
        tenantId,
        engagementId: e.id,
        expectedVersion: version,
      },
    });
    if (status === 200) e = result.engagement;
    return result;
  }
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
  });
  await command("reviewPaper", { paperId: e.papers[0].id }, reviewer, 403);
  await management("updateMember", {
    userId: reviewer,
    displayName: "Independent Reviewer",
    role: "Reviewer",
    clientId: null,
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
  const form = new FormData();
  form.set("tenantId", tenantId);
  form.set("engagementId", e.id);
  form.set("expectedVersion", String(e.version));
  form.set("category", "Dataset");
  form.set("visibility", "internal");
  form.set("handlingBasis", "synthetic");
  form.set(
    "file",
    new File(
      [await fs.readFile("../engine/examples/predictions.csv")],
      "predictions.csv",
      { type: "text/csv" },
    ),
  );
  const uploaded = await request("/api/evidence", {
    method: "POST",
    body: form,
  });
  await refresh();
  await command("acceptEvidence", { artifactId: uploaded.artifactId });
  await request(
    "/api/evidence?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        artifactId: uploaded.artifactId,
      }),
    { user: viewer, status: 404 },
  );
  await command("createModel", {
    name: "Synthetic predictor",
    version: "1",
    format: "Prediction file",
    task: "Binary classification",
    intendedPurpose: "Numerical synthetic fixture validation",
    artifactId: uploaded.artifactId,
  });
  const runInput = {
    modelId: e.models[0].id,
    datasetId: uploaded.artifactId,
    suite: [
      "performance",
      "demographic_parity",
      "disparate_impact",
      "equalized_odds",
    ],
    config: {
      labelColumn: "actual",
      predictionColumn: "predicted",
      groupColumn: "group",
      positiveLabel: "1",
      minimumGroupSize: 5,
      maximumParityGap: 0.2,
      minimumImpactRatio: 0.7,
      minimumAccuracy: 0.8,
    },
  };
  // A new run needs a saved protocol; an explicit suite and configuration
  // would skip its checks, such as the fairness data-handling basis.
  await command("queueRun", runInput, owner, 400);
  const fairnessProtocol = {
    name: "Synthetic performance and fairness",
    version: "1.0",
    task: "Binary classification",
    suite: runInput.suite,
    config: runInput.config,
    datasetContext: {
      split: "test",
      population: "Synthetic full fixture population",
      predictionProvenance: "Controlled synthetic predictions",
      independence: "Synthetic fixture; no real holdout independence claim",
      sensitiveDataBasis: "Synthetic groups; no personal data",
    },
    rationale: "Fixture acceptance rules assess arithmetic, not conformity",
  };
  await command(
    "createEvaluationProfile",
    { ...fairnessProtocol, suite: ["performance", "performance"] },
    owner,
    400,
  );
  const fairnessProfile = await command(
    "createEvaluationProfile",
    fairnessProtocol,
  );
  const queued = await command("queueRun", {
    modelId: runInput.modelId,
    datasetId: runInput.datasetId,
    profileId: fairnessProfile.details.profileId,
  });
  await command("executeRun", { runId: queued.details.runId });
  const run = e.runs.at(-1);
  assert.equal(
    run.state,
    "succeeded",
    JSON.stringify({ state: run.state, error: run.error }),
  );
  assert.equal(run.results.length, 4);
  assert.equal(run.paperIds.length, 2);
  assert.equal(run.results[0].metrics[0].value, 0.85);
  assert(
    run.paperIds.every(
      (id) => e.papers.find((p) => p.id === id).status === "draft",
    ),
  );
  assert(
    run.paperIds.every((id) =>
      e.papers.find((p) => p.id === id).body.results.includes("Limitation:"),
    ),
  );
  console.log(
    "PASS evidence custody, real metric execution and readable automatic draft papers",
  );

  const inspectPath =
    "/api/evaluation/dataset?" +
    new URLSearchParams({
      tenantId,
      engagementId: e.id,
      artifactId: uploaded.artifactId,
    });
  const inspected = await request(inspectPath);
  assert.equal(inspected.rowCount, 80);
  assert.equal(inspected.sha256, uploaded.sha256);
  assert(inspected.columns.some((c) => c.name === "actual"));
  await request(inspectPath, { user: viewer, status: 403 });
  await request(inspectPath, { user: other, status: 403 });
  await command(
    "createModel",
    {
      name: "Synthetic predictor",
      version: "1",
      format: "Prediction file",
      task: "Binary classification",
      intendedPurpose: "Duplicate",
      artifactId: uploaded.artifactId,
    },
    owner,
    409,
  );
  await command(
    "createModel",
    {
      name: "Unsafe binary link",
      version: "1",
      format: "ONNX",
      task: "Binary classification",
      intendedPurpose: "Wrong artifact role",
      artifactId: uploaded.artifactId,
    },
    owner,
    400,
  );
  const hubCard = {
    schemaVersion: "1.0",
    owner: "Fixture developer",
    framework: "Supplied predictions",
    license: "Fixture-only",
    population: "Synthetic population",
    outOfScope: "Real decisions",
    limitations: "No real inference",
    inputSchema: "Not applicable to saved predictions",
    outputSemantics: "1 is favourable; 0 is the other class",
    preprocessing: "Fixture",
    source: {
      kind: "huggingface",
      repoId: "fixture/model",
      revision: "main",
      filename: "predictions.csv",
    },
  };
  await command(
    "createModel",
    {
      name: "Invalid mutable Hub pin",
      version: "1",
      format: "Prediction file",
      task: "Binary classification",
      intendedPurpose: "Metadata pin validation",
      artifactId: uploaded.artifactId,
      card: hubCard,
    },
    owner,
    400,
  );
  await command("createModel", {
    name: "Pinned metadata fixture",
    version: "1",
    format: "Prediction file",
    task: "Binary classification",
    intendedPurpose: "Metadata pin validation; no Hub network request",
    artifactId: uploaded.artifactId,
    card: {
      ...hubCard,
      source: { ...hubCard.source, revision: "a".repeat(40) },
    },
  });
  assert.equal(e.models.at(-1).sourceSha256, uploaded.sha256);
  assert.equal(e.models.at(-1).card.source.revision, "a".repeat(40));
  await command(
    "queueRun",
    {
      modelId: runInput.modelId,
      datasetId: "different-artifact",
      profileId: fairnessProfile.details.profileId,
    },
    owner,
    400,
  );
  await command(
    "createEvaluationProfile",
    {
      ...fairnessProtocol,
      version: "1.1",
      config: { ...runInput.config, predictionColumn: "actual" },
    },
    owner,
    400,
  );
  const profileInput = {
    name: "Binary acceptance",
    version: "1.0",
    task: "Binary classification",
    suite: ["performance"],
    config: { ...runInput.config, groupColumn: "" },
    datasetContext: {
      split: "test",
      population: "Synthetic full fixture population",
      predictionProvenance:
        "Controlled synthetic predictions generated for fixture validation",
      independence: "Synthetic fixture; no real holdout independence claim",
      sensitiveDataBasis: "",
    },
    rationale:
      "Fixture acceptance rules assess arithmetic and workflow, not legal conformity",
  };
  await command("createEvaluationProfile", profileInput, viewer, 403);
  const made = await command("createEvaluationProfile", profileInput),
    profileId = made.details.profileId;
  const cardQueue = await command("queueRun", {
    modelId: e.models.find((m) => m.name === "Pinned metadata fixture").id,
    datasetId: uploaded.artifactId,
    profileId,
  });
  await command("cancelRun", { runId: cardQueue.details.runId });
  assert.equal(e.runs.at(-1).manifest.model.card.source.kind, "huggingface");
  assert.equal(e.runs.at(-1).state, "cancelled");
  const retry = await command("retryRun", { runId: cardQueue.details.runId });
  assert.equal(e.runs.at(-1).retryOf, cardQueue.details.runId);
  await command("cancelRun", { runId: retry.details.runId });
  await command("createEvaluationProfile", profileInput, owner, 409);
  await command(
    "createEvaluationProfile",
    {
      ...profileInput,
      name: "Fair without handling",
      suite: ["demographic_parity"],
    },
    owner,
    400,
  );
  await command(
    "queueRun",
    {
      modelId: runInput.modelId,
      datasetId: uploaded.artifactId,
      profileId,
      suite: ["performance"],
    },
    owner,
    400,
  );
  const protocolRun = await command("queueRun", {
    modelId: runInput.modelId,
    datasetId: uploaded.artifactId,
    profileId,
  });
  const pinned = e.runs.at(-1);
  assert.equal(pinned.contractVersion, "1.1");
  assert.equal(pinned.manifest.model.version, "1");
  assert.equal(pinned.manifest.dataset.rowCount, 80);
  assert.equal(pinned.manifest.profile.name, "Binary acceptance");
  assert.equal(pinned.provenance.inputHashes.modelArtifact, uploaded.sha256);
  assert.equal(pinned.provenance.inputHashes.configuration.length, 64);
  await command("executeRun", { runId: protocolRun.details.runId });
  assert.equal(e.runs.at(-1).state, "succeeded");
  assert.equal(e.runs.at(-1).results.length, 1);
  await command("executeRun", { runId: protocolRun.details.runId }, owner, 409);
  const frozenManifest = JSON.stringify(e.runs.at(-1).manifest);
  await command("createEvaluationProfile", {
    ...profileInput,
    version: "2.0",
    rationale: "A revised criterion rationale",
  });
  assert.equal(
    JSON.stringify(
      e.runs.find((r) => r.id === protocolRun.details.runId).manifest,
    ),
    frozenManifest,
  );
  async function predictionArtifact(name, csv) {
    const f = new FormData();
    f.set("tenantId", tenantId);
    f.set("engagementId", e.id);
    f.set("expectedVersion", String(e.version));
    f.set("category", "Dataset");
    f.set("visibility", "internal");
    f.set("handlingBasis", "synthetic");
    f.set("file", new File([csv], name, { type: "text/csv" }));
    const u = await request("/api/evidence", { method: "POST", body: f });
    await refresh();
    await command("acceptEvidence", { artifactId: u.artifactId });
    return u.artifactId;
  }
  for (const item of [
    {
      task: "Regression",
      suite: ["regression"],
      csv: "actual,predicted\n1,2\n2,2\n3,4",
      expected: Math.sqrt(2 / 3),
    },
    {
      task: "Multiclass classification",
      suite: ["performance"],
      csv: "actual,predicted\nA,A\nA,B\nB,B\nC,C",
      expected: 0.75,
    },
  ]) {
    const artifactId = await predictionArtifact(
      item.task + ".csv",
      item.csv.replaceAll("\\n", "\n"),
    );
    await command("createModel", {
      name: item.task + " fixture",
      version: "1",
      format: "Prediction file",
      task: item.task,
      intendedPurpose: "Task expansion fixture",
      artifactId,
    });
    const modelId = e.models.at(-1).id;
    const protocol = await command("createEvaluationProfile", {
      ...profileInput,
      name: item.task + " acceptance",
      task: item.task,
      suite: item.suite,
      config: {
        ...runInput.config,
        groupColumn: "",
        minimumSampleSize: 2,
        minimumClassCount: 1,
        maximumRmse: 2,
        minimumMacroF1: 0.5,
      },
    });
    const q = await command("queueRun", {
      modelId,
      datasetId: artifactId,
      profileId: protocol.details.profileId,
    });
    await command("executeRun", { runId: q.details.runId });
    const tested = e.runs.at(-1);
    assert.equal(tested.state, "succeeded", tested.error);
    assert(
      Math.abs(
        tested.results[0].metrics[item.task === "Regression" ? 1 : 0].value -
          item.expected,
      ) < 1e-12,
    );
  }
  const corruptQueue = await command("queueRun", {
    modelId: runInput.modelId,
    datasetId: uploaded.artifactId,
    profileId,
  });
  const evidenceBucket = await mf.getR2Bucket("BUCKET"),
    pinnedArtifact = e.artifacts.find((a) => a.id === uploaded.artifactId),
    originalBytes = await (
      await evidenceBucket.get(pinnedArtifact.key)
    ).arrayBuffer();
  await evidenceBucket.put(pinnedArtifact.key, "tampered");
  await command("executeRun", { runId: corruptQueue.details.runId });
  assert.equal(e.runs.at(-1).state, "failed");
  assert.equal(e.runs.at(-1).results.length, 0);
  assert(e.runs.at(-1).error.includes("integrity"));
  await evidenceBucket.put(pinnedArtifact.key, originalBytes);
  await fs.mkdir(".sites-runtime", { recursive: true });
  await fs.writeFile(
    ".sites-runtime/run-schema-fixtures.json",
    JSON.stringify([pinned, ...e.runs], null, 2),
  );
  console.log(
    "PASS model/version lineage, bounded authorized dataset inspection, immutable reusable protocols, pinned manifests, actual multiclass/regression API execution and tampered-byte rejection",
  );

  const auditor = "fixture-auditor-" + stamp;
  await management("grantMember", {
    userId: auditor,
    displayName: "Fixture Auditor",
    role: "Auditor",
    clientId: null,
  });
  await request("/api/assurance", {
    method: "POST",
    body: {
      tenantId,
      engagementId: e.id,
      op: "setAccess",
      data: {
        userId: auditor,
        active: true,
        reason: "Assigned preparer fixture",
      },
    },
  });
  await refresh();
  const generated = e.papers.find((p) => p.id === run.paperIds[0]);
  await command(
    "editPaper",
    {
      paperId: generated.id,
      body: {
        ...generated.body,
        conclusion: "Supplementary diagnostic evidence reviewed.",
        conclusionStatus: "supported",
      },
      evidenceIds: generated.evidenceIds,
      required: false,
    },
    auditor,
  );
  assert.equal(e.papers.find((p) => p.id === generated.id).required, false);
  const supplementary = e.papers.find((p) => p.templateId === "WP-RM-01");
  await command(
    "editPaper",
    {
      paperId: supplementary.id,
      body: {
        ...supplementary.body,
        results: "Supplementary fixture inspection",
        conclusion: "Scoped supplementary result.",
        conclusionStatus: "supported",
      },
      evidenceIds: [uploaded.artifactId],
      required: false,
    },
    auditor,
  );
  assert.equal(e.papers.find((p) => p.id === supplementary.id).required, false);
  const requiredPaper = e.papers.find((p) => p.required);
  await command(
    "editPaper",
    {
      paperId: requiredPaper.id,
      body: {
        ...requiredPaper.body,
        criteria: "Fixture criterion",
        conclusion: "Excluded for fixture.",
        conclusionStatus: "not_applicable",
      },
      evidenceIds: [uploaded.artifactId],
      required: false,
    },
    auditor,
    403,
  );
  console.log(
    "PASS supplementary draft editing and Lead-only applicability exclusions",
  );

  const requestSpec = {
    subject: "Internal population request fixture",
    description: "Synthetic coverage support for the planned procedure.",
    responsibleParty: "Internal fixture supplier",
    periodVersion: "Synthetic 2026 population, version 1.0",
    handling: "Internal fixture-only collection instructions",
    dueDate: "2026-12-31",
    paperIds: [e.papers[0].id],
  };
  await command("createEvidenceRequest", requestSpec, viewer, 403);
  await command("createEvidenceRequest", requestSpec, reviewer, 403);
  await command(
    "createEvidenceRequest",
    { ...requestSpec, dueDate: "2026-02-30" },
    owner,
    400,
  );
  await command(
    "createEvidenceRequest",
    { ...requestSpec, paperIds: ["unrelated-paper"] },
    owner,
    400,
  );
  await command("createEvidenceRequest", requestSpec, auditor);
  const sufficientRequest = e.evidenceRequests.at(-1).id;
  await command(
    "recordEvidenceResponse",
    {
      requestId: sufficientRequest,
      response: "Other engagement file",
      evidenceIds: ["unrelated-artifact"],
    },
    owner,
    400,
  );
  await command(
    "assessEvidenceRequest",
    {
      requestId: sufficientRequest,
      decision: "accepted",
      assessment: "No response yet",
    },
    owner,
    409,
  );
  await command(
    "recordEvidenceResponse",
    {
      requestId: sufficientRequest,
      response: "Synthetic controlled receipt with recorded provenance.",
      evidenceIds: [uploaded.artifactId],
    },
    auditor,
  );
  await command(
    "assessEvidenceRequest",
    {
      requestId: sufficientRequest,
      decision: "returned",
      assessment: "Fixture: missing population context.",
    },
    auditor,
  );
  await command(
    "recordEvidenceResponse",
    {
      requestId: sufficientRequest,
      response: "Synthetic revised receipt; provenance and coverage supplied.",
      evidenceIds: [uploaded.artifactId],
    },
    auditor,
  );
  await command(
    "assessEvidenceRequest",
    {
      requestId: sufficientRequest,
      decision: "accepted",
      assessment:
        "Synthetic fixture relevance, reliability and coverage assessed.",
    },
    auditor,
  );
  assert.equal(
    e.evidenceRequests.find((r) => r.id === sufficientRequest).history.length,
    4,
  );
  await command(
    "createEvidenceRequest",
    { ...requestSpec, subject: "Internal unavailable evidence fixture" },
    auditor,
  );
  const unavailableRequest = e.evidenceRequests.at(-1).id,
    preMemoCount = e.papers.length;
  await command(
    "closeEvidenceRequest",
    {
      requestId: unavailableRequest,
      disposition: "unobtainable",
      assessment: "Internal restriction secret",
    },
    auditor,
    403,
  );
  await command(
    "closeEvidenceRequest",
    {
      requestId: unavailableRequest,
      disposition: "unobtainable",
      assessment: "Internal restriction secret",
    },
    owner,
    409,
    e.version - 1,
  );
  assert.equal(e.papers.length, preMemoCount);
  await command("closeEvidenceRequest", {
    requestId: unavailableRequest,
    disposition: "unobtainable",
    assessment:
      "Internal restriction secret; fixture attempts exhausted and a scope limitation remains.",
  });
  const limitationMemo = e.papers.find(
    (p) =>
      p.id ===
      e.evidenceRequests.find((r) => r.id === unavailableRequest)
        .limitationPaperId,
  );
  assert.equal(limitationMemo.templateId, "MEM-EX-01");
  assert.equal(limitationMemo.required, true);
  assert.equal(limitationMemo.body.conclusionStatus, "not_evaluated");
  console.log(
    "PASS evidence request authorization, real dates, receipt/assessment states and atomic Lead limitation memos",
  );

  const p = e.papers.find((p) => p.templateId === "WP-PL-01");
  const body = {
    ...p.body,
    scope: "Synthetic engagement test",
    sampling: "Controlled synthetic data",
    results: "Reviewed fixture evidence",
    conclusion: "The synthetic control is supported for this fixture.",
    conclusionStatus: "supported",
  };
  await command("editPaper", {
    paperId: p.id,
    body,
    evidenceIds: [uploaded.artifactId],
    required: true,
  });
  await command(
    "comment",
    { paperId: p.id, text: "Fixture comment needs confirmation" },
    reviewer,
  );
  await command("submitPaper", { paperId: p.id }, owner, 400);
  await command(
    "resolveComment",
    {
      paperId: p.id,
      commentId: e.papers.find((x) => x.id === p.id).comments[0].id,
    },
    reviewer,
    400,
  );
  await command("respondComment", {
    paperId: p.id,
    commentId: e.papers.find((x) => x.id === p.id).comments[0].id,
    text: "The preparer corroborated the fixture population and updated the explanation.",
  });
  await command(
    "resolveComment",
    {
      paperId: p.id,
      commentId: e.papers.find((x) => x.id === p.id).comments[0].id,
    },
    reviewer,
  );
  await command("submitPaper", { paperId: p.id });
  await command("reviewPaper", { paperId: p.id }, owner, 403);
  await command("reviewPaper", { paperId: p.id }, reviewer);
  await command("signPaper", { paperId: p.id });
  assert.equal(e.papers.find((x) => x.id === p.id).status, "signed");
  await command(
    "editPaper",
    { paperId: p.id, body, evidenceIds: [uploaded.artifactId], required: true },
    owner,
    409,
  );
  await command("createReport", {
    kind: "draft",
    opinion: "Readiness assessment",
    summary: "Fixture draft snapshot; internal evidence remains restricted.",
  });
  const report = e.reports.at(-1),
    frozen = JSON.stringify(report.snapshot);
  assert.equal(report.snapshot.evidenceRequests.length, 2);
  await command(
    "reopenEvidenceRequest",
    { requestId: sufficientRequest, reason: "Synthetic coverage change" },
    owner,
  );
  assert.equal(
    JSON.stringify(e.reports.find((r) => r.id === report.id).snapshot),
    frozen,
  );
  await command("recordEvidenceResponse", {
    requestId: sufficientRequest,
    response: "Synthetic updated response after scope change.",
    evidenceIds: [uploaded.artifactId],
  });
  await command("assessEvidenceRequest", {
    requestId: sufficientRequest,
    decision: "accepted",
    assessment: "Synthetic changed coverage was assessed for the procedure.",
  });
  assert.equal(report.snapshot.annexIV.length, 9);
  assert.equal(report.snapshot.models.length, e.models.length);
  assert.equal(
    report.snapshot.evaluationProfiles.length,
    e.evaluationProfiles.length,
  );
  await command("reopenPaper", { paperId: p.id });
  assert.equal(e.papers.find((x) => x.id === p.id).signatures.length, 0);
  assert.equal(
    JSON.stringify(e.reports.find((r) => r.id === report.id).snapshot),
    frozen,
  );
  await command(
    "createReport",
    {
      kind: "final",
      opinion: "Adverse conclusion",
      summary: "Blocked fixture final",
    },
    owner,
    400,
  );
  const client = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: viewer },
  );
  assert.equal(client.engagement.evidenceRequests.length, 0);
  assert.equal(client.engagement.papers.length, 0);
  assert.equal(client.engagement.runs.length, 0);
  assert.equal(client.engagement.evaluationProfiles.length, 0);
  assert.equal(client.engagement.reports.length, 0);
  assert.equal(client.engagement.artifacts.length, 0);
  console.log(
    "PASS review independence, exact revision sign-off, immutable draft and client redaction",
  );

  await command("classify", {
    prohibited: false,
    highRisk: true,
    transparency: true,
    profiling: false,
    annexRoute: "Annex III — sensitive use case",
    operatorRole: "Provider",
    intendedPurpose: "Synthetic scoring fixture",
    rationale: "Fixture-only classification record for workflow validation.",
  });
  await command("approveClassification", {}, owner, 403);
  await command("approveClassification", {}, reviewer);
  for (const id of e.papers.filter((p) => p.required).map((p) => p.id)) {
    const current = e.papers.find((p) => p.id === id);
    if (current.status === "signed") continue;
    await command("editPaper", {
      paperId: id,
      body: {
        ...current.body,
        scope: "Synthetic control fixture",
        criteria: "Internal fixture criterion",
        sampling: "Synthetic complete population",
        results: "Fixture evidence inspected",
        conclusion: "Scoped synthetic fixture conclusion",
        conclusionStatus: "supported",
      },
      evidenceIds: [uploaded.artifactId],
      required: true,
    });
    await command("submitPaper", { paperId: id });
    await command("reviewPaper", { paperId: id }, reviewer);
    await command("signPaper", { paperId: id });
  }
  await command("createFinding", {
    title: "Unresolved synthetic high-risk finding",
    article: "15",
    condition: "Fixture nonconformity",
    criteria: "Fixture criterion",
    cause: "Fixture cause",
    effect: "Fixture impact",
    likelihood: 4,
    impact: 4,
    owner: "Fixture management",
    dueDate: "2026-12-31",
    visibility: "internal",
  });
  await command("createEvidenceRequest", {
    ...requestSpec,
    subject: "Required open evidence fixture",
  });
  const outstandingRequest = e.evidenceRequests.at(-1).id;

  const datasetDeclaration = {
    schemaVersion: "1.0",
    name: "Synthetic evaluation data",
    version: "1.0",
    artifactId: uploaded.artifactId,
    owner: "Fixture owner",
    split: "test",
    population: "80 synthetic records",
    periodStart: "2026-01-01",
    periodEnd: "2026-10-07",
    collectionMethod: "Controlled synthetic fixture",
    independence: "No real training data; synthetic only",
    sensitiveDataBasis: "Synthetic non-personal data",
    limitations: "Fixture-only assurance",
    baselineRationale: "",
  };
  async function assurance(op, data, status = 200, user = owner) {
    const v = await request("/api/assurance", {
      method: "POST",
      user,
      status,
      body: { tenantId, engagementId: e.id, op, data },
    });
    if (status === 200) await refresh();
    return v;
  }
  await assurance(
    "registerDataset",
    { ...datasetDeclaration, periodStart: "2026-02-31" },
    400,
  );
  const datasetCard = (await assurance("registerDataset", datasetDeclaration))
    .record;
  await assurance("registerDataset", datasetDeclaration, 409);
  await assurance(
    "registerDataset",
    {
      ...datasetDeclaration,
      version: "2",
      baselineDatasetRecordId: "other-engagement",
      baselineRationale: "Invalid reference",
    },
    400,
  );
  await assurance("registerDataset", {
    ...datasetDeclaration,
    version: "2",
    baselineDatasetRecordId: datasetCard.id,
    baselineRationale: "Comparable synthetic baseline",
  });
  await assurance(
    "registerDataset",
    { ...datasetDeclaration, version: "3" },
    403,
    reviewer,
  );
  const preview = await request(
    "/api/evidence?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        artifactId: uploaded.artifactId,
        preview: "1",
      }),
  );
  assert.equal(typeof preview.text, "string");
  assert.equal(preview.sha256, datasetCard.body.artifactSha256);
  console.log(
    "PASS immutable dataset versions, valid periods, pinned baselines and authorized text preview",
  );
  // Adopt a legacy engagement without rewriting papers, then exercise every connected workflow.
  const legacySigned = JSON.stringify(
    e.papers
      .filter((p) => p.status === "signed")
      .map((p) => ({ id: p.id, body: p.body, signatures: p.signatures })),
  );
  await command("adoptWorkflow", {});
  assert.equal(e.workflow.procedures.length, 33);
  assert(
    e.workflow.procedures.every(
      (p) => p.applicability === "pending" && !p.selected,
    ),
  );
  assert.equal(
    JSON.stringify(
      e.papers
        .filter((p) => p.status === "signed")
        .map((p) => ({ id: p.id, body: p.body, signatures: p.signatures })),
    ),
    legacySigned,
  );
  const brief = {
    systemName: "Synthetic scoring v1",
    intendedUse: "Synthetic fixture decisions only",
    boundary:
      "Synthetic population and controlled workflow; no real conformity claim",
    periodStart: "2026-01-01",
    periodEnd: "2026-10-07",
    actorResponsibilities:
      "Fixture provider owns governance; deployer use excluded",
    audience: "Fixture client users",
    deliverables: "Scoped assurance report",
    basis:
      "Fixture methodology and pinned legal source; human applicability analysis",
    constraints: "Synthetic evidence only",
    independence: "Preparer and independent Reviewer separated",
    changeImpact: "",
  };
  await command("saveBrief", brief);
  await command("submitBrief", {});
  await command(
    "approveBrief",
    { revision: e.workflow.brief.revision, reason: "Own work rejected" },
    owner,
    403,
  );
  await command("returnBrief", { reason: "Clarify the boundary" }, reviewer);
  await command("saveBrief", {
    ...brief,
    boundary: brief.boundary + "; fixed version only",
  });
  await command("submitBrief", {});
  await command(
    "approveBrief",
    {
      revision: e.workflow.brief.revision,
      reason:
        "Scope, responsibilities, dates and competence independently reviewed",
    },
    reviewer,
  );
  await command("scopeProgramCandidates", {
    procedureIds: e.workflow.procedures.map((p) => p.id),
    selected: false,
    applicability: "not_applicable",
    rationale:
      "Synthetic fixture: these candidate controls are outside this test engagement; no legal exclusion claim",
    periodAnalysis: "Fixture period and scope assessed explicitly",
  });
  const proc = e.workflow.procedures.find((p) => p.templateId === "WP-A09-01");
  const plan = {
    selected: true,
    applicability: "readiness",
    rationale: "Selected to validate the controlled audit workflow",
    criterion: "Synthetic risk-management fixture criterion",
    sourceVersion: proc.sourceVersion,
    periodAnalysis: "Synthetic readiness procedure for the fixture period",
    population: "Complete synthetic fixture records",
    sampling: "All records; no real generalization claim",
    ownerId: owner,
    reviewerId: reviewer,
    dueDate: "2026-12-31",
    method: "mixed",
    modelId: runInput.modelId,
    datasetId: uploaded.artifactId,
    profileId,
  };
  await command("saveProcedurePlan", { procedureId: proc.id, plan });
  const beforeBulk = e.workflow.program.revision;
  await command(
    "bulkPlanProcedures",
    { procedureIds: [proc.id, proc.id], patch: { dueDate: "2026-12-30" } },
    owner,
    400,
  );
  await command(
    "bulkPlanProcedures",
    { procedureIds: [proc.id], patch: { reviewerId: owner } },
    owner,
    400,
  );
  await command("bulkPlanProcedures", {
    procedureIds: [proc.id],
    patch: { dueDate: "2026-12-30" },
  });
  assert.equal(e.workflow.program.revision, beforeBulk + 1);
  const tasks = await request(
    "/api/work-inbox?" + new URLSearchParams({ tenantId }),
  );
  assert(
    tasks.items.some((i) => i.kind === "procedure" && i.recordId === proc.id),
  );
  await command("submitProgram", {});
  await command(
    "returnProgram",
    { reason: "Clarify sample completeness" },
    reviewer,
  );
  assert(!e.workflow.program.contributors.includes(reviewer));
  await command("saveProcedurePlan", {
    procedureId: proc.id,
    plan: {
      ...plan,
      sampling: "All 80 synthetic records, checked against source manifest",
    },
  });
  await command("submitProgram", {});
  await command(
    "approveProgram",
    {
      revision: e.workflow.program.revision,
      reason:
        "Scope selection, criterion, sample and independent assignments reviewed",
    },
    reviewer,
  );
  await command(
    "queueRun",
    {
      procedureId: proc.id,
      modelId: e.models.at(-1).id,
      datasetId: uploaded.artifactId,
      profileId,
    },
    owner,
    409,
  );
  const planned = await command("queueRun", {
    procedureId: proc.id,
    modelId: runInput.modelId,
    datasetId: uploaded.artifactId,
    profileId,
    datasetCardRecordId: datasetCard.id,
  });
  assert.equal(
    e.runs.at(-1).manifest.dataset.cardPin.sha256,
    datasetCard.sha256,
  );
  assert.equal(e.runs.at(-1).provenance.inputHashes.auditBinding.length, 64);
  await command("executeRun", { runId: planned.details.runId });
  const actual = {
    procedureId: proc.id,
    performed:
      "Inspected synthetic risk register and corroborated source evidence",
    steps: proc.instructions.map((i) => ({
      id: i.id,
      state: "performed",
      notes: "Synthetic fixture inspection documented",
    })),
    sampling: "All 80 synthetic records inspected",
    results: "Source records reconcile; fixture control result supported",
    limitations: "Synthetic test only",
    evidenceIds: [uploaded.artifactId],
    runIds: [planned.details.runId],
  };
  await command(
    "recordProcedureExecution",
    { ...actual, runIds: [] },
    owner,
    400,
  );
  await command(
    "recordProcedureExecution",
    { ...actual, runIds: [run.id] },
    owner,
    400,
  );
  await command("recordProcedureExecution", actual);
  await command("evaluateProcedure", {
    procedureId: proc.id,
    relevance: "Evidence addresses the fixture criterion",
    reliability: "Hash-pinned synthetic source inspected",
    coverage: "Complete fixture population and period",
    contradictions: "No contradictions in the fixture; limitations documented",
    conclusion: "Synthetic fixture procedure supported",
    outcome: "supported",
  });
  await command("submitProcedure", { procedureId: proc.id });
  await command(
    "reviewPaper",
    { paperId: e.workflow.procedures.find((p) => p.id === proc.id).paperId },
    reviewer,
    409,
  );
  await command(
    "returnProcedure",
    {
      procedureId: proc.id,
      reason: "Corroborate the source population in the recorded response",
    },
    reviewer,
  );
  const procedurePaper = e.workflow.procedures.find(
      (p) => p.id === proc.id,
    ).paperId,
    question = e.papers.find((p) => p.id === procedurePaper).comments.at(-1).id;
  await command("respondComment", {
    paperId: procedurePaper,
    commentId: question,
    text: "Population matches the accepted source manifest; all 80 rows included",
  });
  await command(
    "resolveComment",
    { paperId: procedurePaper, commentId: question },
    reviewer,
  );
  await command("submitProcedure", { procedureId: proc.id });
  await command(
    "reviewProcedure",
    {
      procedureId: proc.id,
      reason:
        "Actual work, evidence sufficiency and conclusion independently inspected",
    },
    reviewer,
  );
  await command("signPaper", { paperId: procedurePaper });
  const compiled = e.papers.find((p) => p.id === procedurePaper);
  await command(
    "editPaper",
    {
      paperId: procedurePaper,
      body: compiled.body,
      evidenceIds: compiled.evidenceIds,
      required: true,
    },
    owner,
    409,
  );
  await command("reopenPaper", { paperId: procedurePaper }, owner, 409);
  console.log(
    "PASS versioned engagement brief, return/rework, explicit program selection, actual execution, evidence evaluation and assigned review/sign-off",
  );
  const contributor = "fixture-contributor-" + stamp,
    crossContributor = "fixture-cross-contributor-" + stamp;
  await management("grantMember", {
    userId: contributor,
    displayName: "Scoped Client Contributor",
    role: "Client Contributor",
    clientId: e.clientId,
  });
  await management("grantMember", {
    userId: crossContributor,
    displayName: "Other client contributor",
    role: "Client Contributor",
    clientId: managedClient.id,
  });
  await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: contributor, status: 404 },
  );
  await command("createEvidenceRequest", {
    ...requestSpec,
    paperIds: [procedurePaper],
    subject: "INTERNAL_REQUEST_SECRET",
    description: "INTERNAL_PROCEDURE_SECRET",
  });
  const portalRequest = e.evidenceRequests.at(-1).id;
  const grant = {
    userId: contributor,
    requestId: portalRequest,
    prompt: "Client validation support",
    instructions: "Provide synthetic validation support only",
    category: "Validation",
    handlingBasis: "synthetic",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  await command("grantClientRequest", { ...grant, userId: viewer }, owner, 400);
  await command(
    "grantClientRequest",
    { ...grant, userId: crossContributor },
    owner,
    400,
  );
  await command("grantClientRequest", grant);
  const grantId = e.workflow.clientGrants.at(-1).id;
  await command("publishClientClarification", {
    grantId,
    text: "Client-safe clarification",
  });
  await request("/api/client-submission", {
    method: "POST",
    user: contributor,
    body: {
      tenantId,
      engagementId: e.id,
      grantId,
      expectedVersion: e.version,
      text: "Client-side clarification reply",
    },
  });
  await refresh();
  assert.equal(e.workflow.clientGrants.at(-1).communications.length, 2);

  await command("updateClientRequest", {
    grantId,
    prompt: "Client validation support",
    instructions:
      "Provide the missing synthetic population support; no raw personal data",
  });
  const portal = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: contributor },
  );
  assert.equal(portal.engagement.portalRequests.length, 1);
  assert.equal(portal.engagement.workflow, undefined);
  assert.equal(portal.people.length, 0);
  assert.equal(portal.events.length, 0);
  assert.equal(portal.catalog, null);
  assert(!JSON.stringify(portal).includes("INTERNAL_REQUEST_SECRET"));
  assert(!JSON.stringify(portal).includes("INTERNAL_PROCEDURE_SECRET"));
  await command(
    "acceptEvidence",
    { artifactId: uploaded.artifactId },
    contributor,
    403,
  );
  async function clientUpload(delivery, remaining) {
    const f = new FormData();
    for (const [key, value] of Object.entries({
      tenantId,
      engagementId: e.id,
      expectedVersion: String(e.version),
      grantId,
      note: "Synthetic validation receipt",
      delivery,
      remaining,
    }))
      f.set(key, value);
    f.append(
      "file",
      new File(["synthetic support"], "client-validation.txt", {
        type: "text/plain",
      }),
    );
    f.append(
      "file",
      new File(["second synthetic file"], "support.txt", {
        type: "text/plain",
      }),
    );
    const receipt = await request("/api/client-submission", {
      method: "POST",
      user: contributor,
      body: f,
    });
    await refresh();
    return receipt.artifactId;
  }
  await clientUpload("partial", "One fixture record remains");
  const delivered = e.workflow.submissions.at(-1);
  assert.equal(delivered.evidenceIds.length, 2);
  await command("acknowledgeClientSubmission", {
    submissionId: delivered.id,
    note: "Receipt received; audit assessment pending",
  });
  await command(
    "acknowledgeClientSubmission",
    { submissionId: delivered.id, note: "Duplicate" },
    owner,
    409,
  );
  const portalReceipt = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: contributor },
  );
  assert.equal(
    portalReceipt.engagement.portalRequests[0].communications.length,
    2,
  );
  assert.equal(
    portalReceipt.engagement.portalRequests[0].submissions.at(-1).receipt.note,
    "Receipt received; audit assessment pending",
  );
  for (const artifactId of delivered.evidenceIds)
    await command("acceptEvidence", { artifactId });
  await command(
    "assessEvidenceRequest",
    {
      requestId: portalRequest,
      decision: "accepted",
      assessment: "Must reject partial delivery",
    },
    owner,
    400,
  );
  const completeSubmission = await clientUpload("complete", "");
  for (const artifactId of e.workflow.submissions.at(-1).evidenceIds)
    await command("acceptEvidence", { artifactId });
  await command("assessEvidenceRequest", {
    requestId: portalRequest,
    decision: "accepted",
    assessment:
      "Client files independently checked for source, period and completeness",
  });
  const dl = await transport(
    base +
      "/api/evidence?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        artifactId: completeSubmission,
      }),
    { headers: h(contributor) },
  );
  assert.equal(dl.status, 200);
  await request(
    "/api/evidence?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        artifactId: uploaded.artifactId,
      }),
    { user: contributor, status: 404 },
  );
  await request("/api/client-submission", {
    method: "POST",
    user: viewer,
    body: new FormData(),
    status: 400,
  });
  await command("revokeClientRequest", {
    grantId,
    reason: "Fixture collaboration completed",
  });
  await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: contributor, status: 404 },
  );
  console.log(
    "PASS scoped client grants, safe request projection, own-file downloads, partial deliveries, client role isolation and revocation",
  );
  await command("setStage", { stage: "Fieldwork" });
  await command("setStage", { stage: "Evidence evaluation" });
  await command("setStage", { stage: "Reporting" }, owner, 400);
  await command("recordEvidenceResponse", {
    requestId: outstandingRequest,
    response: "Synthetic received support before reporting.",
    evidenceIds: [uploaded.artifactId],
  });
  await command("assessEvidenceRequest", {
    requestId: outstandingRequest,
    decision: "accepted",
    assessment: "Synthetic requested support was assessed.",
  });
  await command("setStage", { stage: "Reporting" });
  await command("setStage", { stage: "Sign-off" });
  await command(
    "createReport",
    {
      kind: "final",
      opinion: "Readiness assessment",
      summary: "Positive readiness blocked by unresolved high finding",
    },
    owner,
    400,
  );
  await command("createReport", {
    kind: "final",
    opinion: "Adverse conclusion",
    summary:
      "Synthetic adverse report with unresolved nonconformity disclosed.",
  });
  const internalFinal = e.reports.at(-1);
  const immutableFinal = JSON.stringify({
    snapshot: internalFinal.snapshot,
    clientSnapshot: internalFinal.clientSnapshot,
    sha256: internalFinal.sha256,
    clientSha256: internalFinal.clientSha256,
  });
  const beforeRelease = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: viewer },
  );
  assert.equal(beforeRelease.engagement.reports.length, 0);
  await command(
    "releaseReport",
    {
      reportId: internalFinal.id,
      recipientScope: "Fixture client members",
      reason: "Must reject before independent approval",
    },
    owner,
    409,
  );
  await command(
    "approveReportPackage",
    {
      reportId: internalFinal.id,
      internalHash: internalFinal.sha256,
      clientHash: internalFinal.clientSha256,
      reason: "Creator cannot approve",
    },
    owner,
    403,
  );
  await command(
    "approveReportPackage",
    {
      reportId: internalFinal.id,
      internalHash: "incorrect",
      clientHash: internalFinal.clientSha256,
      reason: "Reject wrong pin",
    },
    reviewer,
    409,
  );
  await command(
    "approveReportPackage",
    {
      reportId: internalFinal.id,
      internalHash: internalFinal.sha256,
      clientHash: internalFinal.clientSha256,
      reason: "Both captured packages and projection independently reviewed",
    },
    reviewer,
  );
  const releaseInbox = await request(inboxPath),
    approvalInbox = await request(inboxPath, { user: reviewer });
  const leadReleaseTask = releaseInbox.items.find(
    (i) =>
      i.kind === "report" &&
      i.recordId === internalFinal.id &&
      i.engagementId === e.id,
  );
  const reviewerReleaseDependency = approvalInbox.items.find(
    (i) =>
      i.kind === "report" &&
      i.recordId === internalFinal.id &&
      i.engagementId === e.id,
  );
  assert(
    leadReleaseTask,
    "An independent Lead receives the approved report release handoff",
  );
  assert.equal(leadReleaseTask.personal, true);
  assert.equal(leadReleaseTask.state, "review");
  assert.equal(leadReleaseTask.action, "Authorize client release");
  assert(
    reviewerReleaseDependency,
    "The package approver can still inspect the pending release dependency",
  );
  assert.equal(reviewerReleaseDependency.personal, false);
  assert.equal(reviewerReleaseDependency.state, "waiting");
  assert.equal(reviewerReleaseDependency.action, "View package dependency");
  console.log(
    "PASS inbox report release handoff and non-actionable approver dependency",
  );
  // Controlled ephemeral source revisions prove every captured technical collection blocks stale release.
  const approvedSource = structuredClone(e);
  for (const amend of [
    (s) => {
      s.artifacts[0].name += " amended";
    },
    (s) => {
      s.models[0].intendedPurpose += " amended";
    },
    (s) => {
      s.evaluationProfiles[0].name += " amended";
    },
    (s) => {
      s.runs[0].completedAt = "2026-10-07T10:00:00.000Z";
    },
  ]) {
    const changed = structuredClone(approvedSource);
    amend(changed);
    await testDb
      .prepare("UPDATE engagements SET body=? WHERE tenant_id=? AND id=?")
      .bind(JSON.stringify(changed), tenantId, e.id)
      .run();
    await refresh();
    await command(
      "releaseReport",
      {
        reportId: internalFinal.id,
        recipientScope: "Fixture client members",
        reason: "Stale technical source must block release",
      },
      owner,
      409,
    );
    await testDb
      .prepare("UPDATE engagements SET body=? WHERE tenant_id=? AND id=?")
      .bind(JSON.stringify(approvedSource), tenantId, e.id)
      .run();
    await refresh();
  }
  await command("releaseReport", {
    reportId: internalFinal.id,
    recipientScope: "Authorized fixture client members",
    reason: "Lead authorizes the exact approved package for client access",
  });
  assert.equal(
    JSON.stringify({
      snapshot: e.reports.at(-1).snapshot,
      clientSnapshot: e.reports.at(-1).clientSnapshot,
      sha256: e.reports.at(-1).sha256,
      clientSha256: e.reports.at(-1).clientSha256,
    }),
    immutableFinal,
  );
  const released = await request(
      "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
      { user: viewer },
    ),
    clientFinal = released.engagement.reports[0];
  assert.equal(clientFinal.snapshot.evidenceRequests, undefined);
  assert(
    !JSON.stringify(clientFinal.snapshot).includes(
      "Internal restriction secret",
    ),
  );
  assert(
    !JSON.stringify(clientFinal.snapshot).includes(
      "Internal unavailable evidence fixture",
    ),
  );
  assert.equal(internalFinal.snapshot.evidenceRequests.length, 4);
  assert.equal(released.engagement.reports.length, 1);
  assert.equal(clientFinal.snapshot.findings.length, 0);
  assert.equal(clientFinal.snapshot.evidence.length, 0);
  assert.equal(clientFinal.snapshot.runs, undefined);
  assert.notEqual(clientFinal.sha256, internalFinal.sha256);
  assert.equal(clientFinal.sha256, internalFinal.clientSha256);
  const internalProof = await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
  );
  assert.equal(internalProof.valid, true);
  assert.equal(internalProof.expectedSha256, internalFinal.sha256);
  const clientProof = await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
    { user: viewer },
  );
  assert.equal(clientProof.valid, true);
  assert.equal(clientProof.expectedSha256, internalFinal.clientSha256);
  assert(!JSON.stringify(clientProof).includes("INTERNAL_REQUEST_SECRET"));
  const clientBundle = await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
        download: "1",
      }),
    { user: viewer },
  );
  assert.equal(clientBundle.snapshot.evidenceRequests, undefined);
  assert.equal(clientBundle.proof.valid, true);
  const print = await transport(
    base +
      "/report?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
    { headers: h(viewer) },
  );
  assert.equal(print.status, 200);
  const html = await print.text();
  assert(html.includes("Adverse conclusion"));
  assert(!html.includes("Internal restriction secret"));
  assert(!html.includes("Internal unavailable evidence fixture"));
  assert(!html.includes("predictions.csv"));
  assert(!html.includes("Unresolved synthetic high-risk finding"));
  // Verify independently assessed remediation and linked reassessment without rewriting the baseline report.
  const findingId = e.findings.find(
    (f) => f.title === "Unresolved synthetic high-risk finding",
  ).id;
  await command("linkFindingSupport", {
    findingId,
    procedureId: proc.id,
    paperIds: [procedurePaper],
    evidenceIds: [uploaded.artifactId],
    runIds: [],
  });
  await command("updateFinding", {
    findingId,
    status: "ready_for_retest",
    response: "Fixture management accepts the action",
    remediation: "Synthetic control corrected and validation evidence supplied",
    retestEvidenceIds: [uploaded.artifactId],
  });
  await command("closeFinding", { findingId }, reviewer, 400);
  await command(
    "recordFindingRetest",
    {
      findingId,
      performed: "Repeated the synthetic control check independently",
      results: "Corrected fixture control passed",
      rationale:
        "Accepted evidence supports effectiveness for the scoped fixture",
      evidenceIds: [uploaded.artifactId],
      conclusion: "effective",
    },
    reviewer,
  );
  await command("closeFinding", { findingId }, reviewer);
  assert.equal(e.findings.find((f) => f.id === findingId).status, "closed");
  await command("reopenFinding", {
    findingId,
    reason: "Subsequent fixture change invalidates remediation",
  });
  assert.equal(
    e.findings.find((f) => f.id === findingId).closureHistory.length,
    1,
  );
  await command("createMonitoringCase", {
    kind: "change",
    title: "Synthetic model material change",
    description: "Fixture version change requires an impact decision",
    ownerId: owner,
    dueDate: "2026-12-31",
    cadence: "quarterly",
    findingId,
    reportId: internalFinal.id,
  });
  const caseId = e.workflow.monitoring.at(-1).id;
  await command("assessMonitoringCase", {
    caseId,
    decision: "reassessment_required",
    assessment: "The changed version exceeds the frozen baseline scope",
    evidenceIds: [uploaded.artifactId],
    dueDate: "2026-12-31",
  });
  await command(
    "closeMonitoringCase",
    { caseId, closure: "Must require linked reassessment" },
    reviewer,
    400,
  );
  const successor = await command("openFollowup", {
    caseId,
    title: "Synthetic successor audit",
    dueDate: "2026-12-31",
  });
  await command(
    "openFollowup",
    { caseId, title: "Duplicate successor", dueDate: "2026-12-31" },
    owner,
    409,
  );
  const successorWorkspace = await request(
    "/api/workspace?" +
      new URLSearchParams({
        tenantId,
        engagementId: successor.details.engagementId,
      }),
  );
  assert.equal(
    successorWorkspace.engagement.workflow.successorOf.engagementId,
    e.id,
  );
  assert.equal(successorWorkspace.engagement.papers.length, 0);
  await command(
    "closeMonitoringCase",
    {
      caseId,
      closure:
        "Impact assessed and successor engagement opened with accountable owner",
    },
    reviewer,
  );
  await command("createMonitoringCase", {
    kind: "monitoring",
    title: "Next synthetic monitoring cycle",
    description:
      "Quarterly fixture monitoring, linked to its completed predecessor",
    ownerId: owner,
    dueDate: "2027-03-31",
    cadence: "quarterly",
    findingId,
    reportId: internalFinal.id,
    previousCaseId: caseId,
  });
  assert.equal(e.workflow.monitoring.at(-1).previousCaseId, caseId);
  assert.equal(
    e.workflow.monitoring.find((c) => c.id === caseId).state,
    "closed",
  );
  assert.equal(
    JSON.stringify(e.reports.find((r) => r.id === internalFinal.id).snapshot),
    JSON.parse(immutableFinal).snapshot
      ? JSON.stringify(JSON.parse(immutableFinal).snapshot)
      : "",
  );
  await command("withdrawReport", {
    reportId: internalFinal.id,
    reason: "Synthetic test withdrawal; preserve all captured bytes",
  });
  const afterWithdrawal = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: viewer },
  );
  assert.equal(afterWithdrawal.engagement.reports.length, 0);
  await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
    { user: viewer, status: 404 },
  );
  console.log(
    "PASS exact package approval/release/withdrawal, independent retest, case assessment and atomic linked successor engagement",
  );
  await command("classify", {
    prohibited: true,
    highRisk: false,
    transparency: false,
    profiling: false,
    annexRoute: "Prohibited practice fixture",
    operatorRole: "Provider",
    intendedPurpose: "Synthetic prohibited-use fixture",
    rationale: "Fixture-only prohibited route for positive-opinion rejection.",
  });
  await command("approveClassification", {}, reviewer);
  const prohibitedReadiness = await command(
    "createReport",
    {
      kind: "final",
      opinion: "Readiness assessment",
      summary: "Must reject a positive prohibited-practice opinion",
    },
    owner,
    400,
  );
  assert(JSON.stringify(prohibitedReadiness).includes("prohibited practice"));
  assert.equal(
    e.reports.find((r) => r.id === internalFinal.id).snapshot.engagement
      .classification.prohibited,
    false,
    "Later classification changes cannot rewrite an issued snapshot",
  );
  await assert.rejects(
    () =>
      testDb
        .prepare("UPDATE audit_events SET action='tampered' WHERE tenant_id=?")
        .bind(tenantId)
        .run(),
    /append-only/,
  );
  await assert.rejects(
    () =>
      testDb
        .prepare("DELETE FROM engagement_snapshots WHERE tenant_id=?")
        .bind(tenantId)
        .run(),
    /append-only/,
  );
  console.log(
    "PASS all lifecycle gates, adverse final issuance, released report projection and database immutability",
  );

  await fs.writeFile(
    ".sites-runtime/run-schema-fixtures.json",
    JSON.stringify([pinned, ...e.runs], null, 2),
  );
  await fs.writeFile(
    ".sites-runtime/execution-schema-fixture.json",
    JSON.stringify(
      e.workflow.procedures.find((p) => p.id === proc.id).execution,
      null,
      2,
    ),
  );
  console.log("Integration checks passed. Fixture practice: " + tenantId);
} finally {
  await mf.dispose();
}
