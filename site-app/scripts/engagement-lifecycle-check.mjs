// One engagement through its lifecycle over the API, against the built
// Worker in Miniflare: evidence custody and runs, classification, evidence
// requests, the structured workflow from adoption to procedure review,
// client requests, planning exit, scale past 1,000 assurance records, the
// engagement quality review, report capture, release and dossiers,
// remediation and withdrawal. Each part builds on the state the earlier ones
// leave, so they stay one scenario. Split out of the former
// scripts/integration-check.mjs (#52), whose access, criteria, inbox and
// practice-management checks are now workspace-access-check.mjs,
// criteria-pins-check.mjs, work-inbox-api-check.mjs and
// practice-management-check.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { python } from "./harness/env.mjs";
import {
  apiClient,
  base,
  fixtureUsers,
  identity,
  startWorker,
} from "./harness/worker.mjs";
// Scoped dossiers are checked with the separately reviewed verifier
// (`python -m engine.assurance verify`); ASSURANCE_TEST_PYTHON names the Python.
// lib/assurance-core.ts canonical(): sorted keys, no whitespace.
const canonicalJson = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonicalJson).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k]))
          .join(",") +
        "}";
const manifestDigest = (manifest) =>
  createHash("sha256").update(canonicalJson(manifest)).digest("hex");
const verifyDossier = (dossierPath, trustPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [
        "-m",
        "engine.assurance",
        "verify",
        "--dossier",
        dossierPath,
        "--trusted-keys",
        trustPath,
        "--require-trusted-signature",
      ],
      { cwd: path.resolve(".."), windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (out += x));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, out }));
  });
// The report elements a final report states at capture (report model v2).
// Sign-offs, approvals, stage changes, acceptance and closure carry the
// person's attestation (lib/attestation.ts).
const attest = { attestation: { rationale: "Reviewed for the harness" } };
const reportParticulars = {
  addressee: "Fixture client board",
  location: "Vienna, Austria",
  signatory: "Fixture Assurance GmbH",
  basisForModification:
    "Synthetic unresolved nonconformity whose effects are material and pervasive.",
};
// The MEM-SO-01 completion checklist the approver answers (#94).
const releaseChecklist = {
  checklist: {
    independence: "confirmed",
    subsequentEvents: "confirmed",
    representations: "not_applicable",
    limitations: "confirmed",
    distribution: "confirmed",
  },
  checklistNote:
    "Synthetic fixture: the engaging party is the responsible party",
};
const { mf, testDb, transport } = await startWorker("audit-integration");
try {
  const { stamp, owner, reviewer, viewer, other } = fixtureUsers();
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
  // The practice's latest management event, read from D1: the workspace
  // load no longer lists them (#185), and the Access log lists only the
  // events about access.
  const latestManagementEvent = async () =>
    await testDb
      .prepare(
        "SELECT action,details FROM management_events WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
      )
      .bind(tenantId)
      .first();
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
  // The rule pack the catalog serves, which classification records cite.
  const rulePack = workspace.catalog.regulatorySnapshot;
  // A second client of the practice, for cross-client isolation checks.
  await management("createClient", {
    name: "Edited fixture client",
    sector: "Manufacturing",
  });
  const managedClient = workspace.clients.find(
    (c) => c.name === "Edited fixture client",
  );
  const inboxPath = "/api/work-inbox?" + new URLSearchParams({ tenantId });
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
  await command("acceptEvidence", {
    artifactId: uploaded.artifactId,
    ...attest,
  });
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
    // Synthetic groups hold no special-category data (#60).
    specialCategory: { specialCategory: false },
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
  assert.equal(pinned.contractVersion, "1.4");
  assert.equal(
    pinned.provenance.inputHashes.statisticsPlan.length,
    64,
    "the run freezes its statistics plan",
  );
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
    await command("acceptEvidence", { artifactId: u.artifactId, ...attest });
    return u.artifactId;
  }
  // A dataset with a special-category column needs the client's recorded
  // basis before upload (#60, D-11).
  const specialUpload = () => {
    const f = new FormData();
    f.set("tenantId", tenantId);
    f.set("engagementId", e.id);
    f.set("expectedVersion", String(e.version));
    f.set("category", "Dataset");
    f.set("visibility", "internal");
    f.set("handlingBasis", "synthetic");
    f.set(
      "file",
      new File(["actual,predicted,ethnicity\n1,1,A\n0,0,B"], "special.csv", {
        type: "text/csv",
      }),
    );
    return f;
  };
  const refusedUpload = await request("/api/evidence", {
    method: "POST",
    body: specialUpload(),
    status: 409,
  });
  assert.match(refusedUpload.error, /recorded basis before upload: ethnicity/);
  await command("recordSpecialCategoryBasis", {
    kind: "gdpr_art9",
    point: "g",
    statement: "Fixture: substantial public interest basis named by the client",
    columns: ["ethnicity"],
    confirmedBy: "Fixture DPO",
    confirmedOn: "2026-11-01",
  });
  await request("/api/evidence", { method: "POST", body: specialUpload() });
  await refresh();
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
        tested.results[0].metrics.find(
          (m) => m.name === (item.task === "Regression" ? "rmse" : "accuracy"),
        ).value - item.expected,
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
  for (const run of e.runs) assert.deepEqual(run.rulePack, e.rulePack);
  await fs.mkdir(".test-output", { recursive: true });
  await fs.writeFile(
    ".test-output/run-schema-fixtures.json",
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
  await command("signPaper", { paperId: p.id, ...attest });
  assert.equal(e.papers.find((x) => x.id === p.id).status, "signed");
  await command(
    "editPaper",
    { paperId: p.id, body, evidenceIds: [uploaded.artifactId], required: true },
    owner,
    409,
  );
  await command("createReport", {
    kind: "draft",
    engagementType: "readiness",
    conclusion: "readiness",
    summary: "Fixture draft snapshot; internal evidence remains restricted.",
  });
  const report = e.reports.at(-1),
    frozen = JSON.stringify(report.snapshot);
  assert.equal(report.snapshot.evidenceRequests.length, 2);
  assert.deepEqual(report.snapshot.rulePack, e.rulePack);
  assert.equal(
    report.snapshot.methodologyVersion,
    workspace.catalog.methodologyVersion,
  );
  assert.deepEqual(report.clientSnapshot.rulePack, e.rulePack);
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
      engagementType: "attestation",
      assuranceLevel: "reasonable",
      conclusion: "adverse",
      ...reportParticulars,
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

  // #19: tri-state facts. Every required fact unknown keeps the
  // classification at "Needs information" and blocks the approval.
  const art5Facts = (answer) =>
    Object.fromEntries(
      workspace.catalog.regulatorySnapshot.prohibitedPractices.map((p) => [
        "art5_" +
          p.point
            .replace(/^Art\s*5/, "")
            .replace(/[()]+/g, "_")
            .replace(/^_+|_+$/g, ""),
        answer,
      ]),
    );
  const providerFacts = {
    ...art5Facts("no"),
    annexIIIProfiling: "no",
    gpaiModelProvider: "no",
    gpaiDownstreamProvider: "no",
    smeStatus: "neither",
    interactsDirectlyWithNaturalPersons: "yes",
    scientificResearchOnly: "no",
    authorisedByLawForCriminalOffences: "no",
    generatesSyntheticText: "no",
    generatesSyntheticImage: "no",
    generatesSyntheticAudio: "no",
    generatesSyntheticVideo: "no",
    placedOnMarketDate: "2026-03-01",
  };
  const scoring = {
    annexRoute: "Annex III — sensitive use case",
    operatorRole: "Provider",
    intendedPurpose: "Synthetic scoring fixture",
    rationale: "Fixture-only classification record for workflow validation.",
  };
  await command("classify", { ...scoring, facts: {} });
  assert.equal(e.classification.assessment.label, "Needs information");
  assert(
    JSON.stringify(
      await command("approveClassification", attest, reviewer, 400),
    ).includes("Integrates a general-purpose AI model"),
    "Unknown required facts block the approval",
  );
  assert(
    JSON.stringify(
      await command(
        "classify",
        {
          ...scoring,
          annexRoute: "Outside high-risk scope",
          facts: { annexIIIProfiling: "yes" },
        },
        owner,
        400,
      ),
    ).includes("applies only on"),
    "Contradictory route and facts are rejected",
  );
  await command("classify", { ...scoring, facts: providerFacts });
  assert.equal(e.classification.assessment.label, "High risk");
  assert.equal(e.classification.highRisk, true);
  assert.equal(e.classification.transparency, true);
  assert.equal(
    e.classification.answers.placedOnMarketDate.legalVersion,
    rulePack.celex,
  );
  await command("approveClassification", attest, owner, 403);
  await command("approveClassification", attest, reviewer);
  assert.equal(e.classification.status, "approved");
  // An engagement whose classification predates #19 still loads: its facts
  // are unknown and its earlier approval stays readable.
  {
    const row = await testDb
      .prepare("SELECT body FROM engagements WHERE tenant_id=? AND id=?")
      .bind(tenantId, e.id)
      .first();
    const body = JSON.parse(row.body);
    const current = body.classification;
    body.classification = {
      prohibited: false,
      highRisk: true,
      transparency: true,
      profiling: false,
      annexRoute: "Annex III point 5(b)",
      operatorRole: "Provider",
      intendedPurpose: "Legacy scoring",
      rationale: "Approved under four flags",
      status: "approved",
      approvedBy: reviewer,
      version: rulePack.celex,
      asOf: "2026-10-05",
    };
    await testDb
      .prepare("UPDATE engagements SET body=? WHERE tenant_id=? AND id=?")
      .bind(JSON.stringify(body), tenantId, e.id)
      .run();
    await refresh();
    assert.equal(e.classification.model, 2);
    assert.equal(e.classification.status, "provisional");
    assert.deepEqual(e.classification.answers, {});
    assert.equal(e.classification.legacy.approvedBy, reviewer);
    assert.equal(e.classification.history[0].action, "approved_v1");
    body.classification = current;
    await testDb
      .prepare("UPDATE engagements SET body=? WHERE tenant_id=? AND id=?")
      .bind(JSON.stringify(body), tenantId, e.id)
      .run();
    await refresh();
    assert.equal(e.classification.status, "approved");
  }
  console.log(
    "PASS tri-state classification: unknown facts block approval, contradictions rejected, legacy classification loads",
  );
  // Reopening a closed request retires its limitation memo; closing it again
  // revises the same memo instead of adding a second one.
  const memoCount = e.papers.length;
  await command("reopenEvidenceRequest", {
    requestId: unavailableRequest,
    reason: "Synthetic provider located further records",
  });
  const retiredMemo = e.papers.find((p) => p.id === limitationMemo.id);
  assert.equal(retiredMemo.retired.requestId, unavailableRequest);
  assert.equal(retiredMemo.required, false);
  await command(
    "editPaper",
    {
      paperId: limitationMemo.id,
      body: retiredMemo.body,
      evidenceIds: [],
      required: true,
    },
    owner,
    409,
  );
  const reclosed = await command("closeEvidenceRequest", {
    requestId: unavailableRequest,
    disposition: "unobtainable",
    assessment:
      "Internal restriction secret; the located records do not cover the period, so the limitation remains.",
  });
  assert.equal(reclosed.details.paperId, limitationMemo.id);
  assert.equal(e.papers.length, memoCount);
  const revisedMemo = e.papers.find((p) => p.id === limitationMemo.id);
  assert.equal(revisedMemo.retired, undefined);
  assert.equal(revisedMemo.required, true);
  assert.equal(revisedMemo.revision, limitationMemo.revision + 1);
  console.log(
    "PASS reopened limitation memo is retired and revised, not duplicated, on re-close",
  );
  // The release-time records (WP-RP-02, MEM-SO-01) are recorded by the
  // release and refuse preparation and signing.
  const releaseTime = ["WP-RP-02", "MEM-SO-01"];
  for (const id of e.papers.filter((p) => p.required).map((p) => p.id)) {
    const current = e.papers.find((p) => p.id === id);
    if (releaseTime.includes(current.templateId)) {
      await command("submitPaper", { paperId: id }, owner, 409);
      continue;
    }
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
    await command("signPaper", { paperId: id, ...attest });
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
  assert.equal(e.workflow.procedures.length, 36);
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
  await command("saveProcedurePlan", {
    procedureId: proc.id,
    assignmentRevision: proc.assignmentRevision ?? 1,
    plan,
  });
  const currentPlan = () => e.workflow.procedures.find((p) => p.id === proc.id);
  // The assignment revision a plan form opened now would send.
  const openedAt = currentPlan().assignmentRevision;
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
  // Drafting amends the program revision; only submissions are revisions.
  assert.equal(e.workflow.program.revision, beforeBulk);
  assert.equal(e.workflow.program.history.length, 0);
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
  const resampled = {
    ...plan,
    sampling: "All 80 synthetic records, checked against source manifest",
  };
  // A plan opened before the bulk due-date change would revert it.
  await command(
    "saveProcedurePlan",
    { procedureId: proc.id, assignmentRevision: openedAt, plan: resampled },
    owner,
    409,
  );
  assert.equal(currentPlan().dueDate, "2026-12-30");
  await command("saveProcedurePlan", {
    procedureId: proc.id,
    assignmentRevision: currentPlan().assignmentRevision,
    plan: { ...resampled, dueDate: currentPlan().dueDate },
  });
  assert.equal(currentPlan().dueDate, "2026-12-30");
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
  // Retries bind the procedure's plan and the scope, not the program
  // revision (#69): a change to another procedure, approved in a new program
  // revision, leaves a cancelled run of this procedure retryable; a change
  // to this procedure's own plan does not.
  const planOf = (p, change = {}) => ({
    selected: p.selected,
    applicability: p.applicability,
    rationale: p.rationale ?? "",
    criterion: p.criterion ?? "",
    sourceVersion: p.sourceVersion,
    periodAnalysis: p.periodAnalysis ?? "",
    population: p.population ?? "",
    sampling: p.sampling ?? "",
    ownerId: p.ownerId ?? "",
    reviewerId: p.reviewerId ?? "",
    dueDate: p.dueDate ?? "",
    method: p.method,
    modelId: p.modelId ?? "",
    datasetId: p.datasetId ?? "",
    profileId: p.profileId ?? "",
    ...change,
  });
  const replan = async (p, change) => {
    await command("saveProcedurePlan", {
      procedureId: p.id,
      assignmentRevision: p.assignmentRevision ?? 1,
      plan: planOf(p, change),
    });
    await command("submitProgram", {});
    await command(
      "approveProgram",
      {
        revision: e.workflow.program.revision,
        reason: "Changed plan independently reviewed",
      },
      reviewer,
    );
  };
  const early = await command("queueRun", {
    procedureId: proc.id,
    modelId: runInput.modelId,
    datasetId: uploaded.artifactId,
    profileId,
  });
  assert.equal(e.runs.at(-1).procedureBinding.planHash, currentPlan().planHash);
  await command("cancelRun", { runId: early.details.runId });
  const neighbour = e.workflow.procedures.find(
    (p) => p.id !== proc.id && !p.selected,
  );
  const programBefore = e.workflow.program.revision;
  await replan(neighbour, {
    rationale: neighbour.rationale + "; boundary confirmed again",
  });
  assert(e.workflow.program.revision > programBefore);
  const retried = await command("retryRun", { runId: early.details.runId });
  assert.equal(e.runs.at(-1).retryOf, early.details.runId);
  await command("cancelRun", { runId: retried.details.runId });
  await replan(currentPlan(), {
    sampling: currentPlan().sampling + "; source manifest reconciled",
  });
  await command("retryRun", { runId: early.details.runId }, owner, 409);
  // A procedure has one queued or running planned run at a time, and a
  // retry keeps the dataset card its source pinned (#67).
  const plannedInput = {
    procedureId: proc.id,
    modelId: runInput.modelId,
    datasetId: uploaded.artifactId,
    profileId,
  };
  const cardRun = await command("queueRun", {
    ...plannedInput,
    datasetCardRecordId: datasetCard.id,
  });
  assert.match(
    (await command("queueRun", plannedInput, owner, 409)).error,
    /is already queued/,
  );
  await command("cancelRun", { runId: cardRun.details.runId });
  const cardRetry = await command("retryRun", {
    runId: cardRun.details.runId,
  });
  assert.equal(e.runs.at(-1).retryOf, cardRun.details.runId);
  assert.deepEqual(
    e.runs.at(-1).manifest.dataset.cardPin,
    e.runs.find((r) => r.id === cardRun.details.runId).manifest.dataset.cardPin,
  );
  assert.equal(e.runs.at(-1).manifest.dataset.cardPin.recordId, datasetCard.id);
  assert.match(
    (await command("retryRun", { runId: cardRun.details.runId }, owner, 409))
      .error,
    /is already queued/,
  );
  await command("cancelRun", { runId: cardRetry.details.runId });
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
  await command("signPaper", { paperId: procedurePaper, ...attest });
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
  // Sign → recompile: new work on a procedure whose paper is signed compiles a
  // new paper and supersedes the signed one instead of orphaning it.
  await command("recordProcedureExecution", {
    ...actual,
    results: actual.results + "; re-performed after sign-off",
  });
  await command("evaluateProcedure", {
    procedureId: proc.id,
    relevance: "Evidence addresses the fixture criterion",
    reliability: "Hash-pinned synthetic source inspected again",
    coverage: "Complete fixture population and period",
    contradictions: "No contradictions in the fixture; limitations documented",
    conclusion: "Synthetic fixture procedure supported after re-performance",
    outcome: "supported",
  });
  const recompile = await command("submitProcedure", { procedureId: proc.id });
  const recompiledPaper = recompile.details.paperId;
  assert.notEqual(recompiledPaper, procedurePaper);
  const supersededPaper = e.papers.find((p) => p.id === procedurePaper);
  assert.equal(supersededPaper.status, "signed");
  assert.equal(supersededPaper.supersededBy, recompiledPaper);
  assert.equal(supersededPaper.required, false);
  assert.equal(
    e.papers.find((p) => p.id === recompiledPaper).supersedes,
    procedurePaper,
  );
  for (const [op, data] of [
    ["reopenPaper", { paperId: procedurePaper }],
    ["comment", { paperId: procedurePaper, text: "Must stay as signed" }],
    [
      "editPaper",
      {
        paperId: procedurePaper,
        body: supersededPaper.body,
        evidenceIds: supersededPaper.evidenceIds,
        required: true,
      },
    ],
  ])
    await command(op, data, owner, 409);
  await command(
    "reviewProcedure",
    {
      procedureId: proc.id,
      reason: "Re-performed work and conclusion independently inspected",
    },
    reviewer,
  );
  await command("signPaper", { paperId: recompiledPaper, ...attest });
  console.log(
    "PASS sign → recompile supersedes the signed paper, which stays immutable",
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
    paperIds: [recompiledPaper],
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
    { artifactId: uploaded.artifactId, ...attest },
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
    await command("acceptEvidence", { artifactId, ...attest });
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
    await command("acceptEvidence", { artifactId, ...attest });
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
  // Planning exit: acceptance, independence and competence (#23).
  await command("setStage", { stage: "Fieldwork", ...attest }, owner, 400);
  const met = (basis) => ({ met: true, basis });
  await command("saveAcceptance", {
    decision: "acceptance",
    preconditions: {
      subjectMatter: met("Synthetic scoring v1 is identifiable"),
      criteria: met("Fixture methodology criteria"),
      evidence: met("Synthetic evidence access agreed"),
      purpose: met("Fixture readiness decision"),
    },
    scope: "Synthetic fixture readiness engagement",
    periodStart: brief.periodStart,
    periodEnd: brief.periodEnd,
    systemBoundary: brief.boundary,
    accessLevel: "grey",
    engagementLetter: "EL-FIXTURE-1",
    team: [owner],
    competenceConclusion: "Fixture team covers assurance and statistics",
    changeReason: "",
  });
  const competence = {
    assurance: "proficient",
    ai_systems: "foundation",
    statistics: "proficient",
    regulation: "foundation",
    management_systems: "none",
    data_protection: "foundation",
    security: "none",
    domain: "none",
  };
  const declaration = {
    priorWork: "",
    threats: [],
    exclusions: [],
    competence,
    expertField: "",
    confirmed: true,
  };
  await command("saveDeclaration", declaration);
  await command(
    "saveDeclaration",
    {
      ...declaration,
      threats: [
        {
          kind: "familiarity",
          description: "Fixture: earlier joint project with the provider",
          safeguards: "Fixture: review rotated",
        },
      ],
    },
    reviewer,
  );
  await command(
    "approveAcceptance",
    { revision: e.workflow.acceptance.revision, reason: "Blocked by threat" },
    owner,
    409,
  );
  // Declaring again cannot clear the declarant's own unresolved threat.
  await command("saveDeclaration", declaration, reviewer, 409);
  await command("resolveDeclaredThreat", {
    declarationId: e.workflow.declarations.at(-1).id,
    kind: "familiarity",
    reason: "Rotation reduces the threat to an acceptable level",
  });
  await command("approveAcceptance", {
    revision: e.workflow.acceptance.revision,
    reason: "Preconditions met and declarations current",
  });
  console.log(
    "PASS acceptance record, per-person declarations and threat resolution gate Fieldwork",
  );
  await command("setStage", { stage: "Fieldwork", ...attest });
  await command("setStage", { stage: "Evidence evaluation", ...attest });
  await command("setStage", { stage: "Reporting", ...attest }, owner, 400);
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
  await command("setStage", { stage: "Reporting", ...attest });
  await command("setStage", { stage: "Sign-off", ...attest });
  await command(
    "createReport",
    {
      kind: "final",
      engagementType: "readiness",
      conclusion: "readiness",
      summary: "Positive readiness blocked by unresolved high finding",
    },
    owner,
    400,
  );
  // #17: past 1,000 assurance records an engagement keeps its workbench,
  // access changes, report capture and release, and dossiers. The bulk goes
  // straight into D1 (each op's own path is checked above and in
  // assurance-integration-check.mjs): source locations, reviewed assessments,
  // a superseded revision and unpinned events, in runs of seven records that
  // share a timestamp so that page breaks fall inside a run.
  const hex = async (bytes) =>
    Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const bulkSource = e.artifacts.find((a) => a.id === uploaded.artifactId),
    bulkStart = Date.now() - 2 * 3600 * 1000,
    bulk = [];
  assert.equal(bulkSource.status, "accepted");
  const bulkRecord = (kind, body, actor = owner) => {
    const record = {
      id: "AS-" + crypto.randomUUID().slice(0, 12),
      kind,
      body: JSON.stringify(body),
      actor,
      createdAt: new Date(
        bulkStart + Math.floor(bulk.length / 7) * 1000,
      ).toISOString(),
    };
    bulk.push(record);
    return record;
  };
  const bulkLocations = Array.from({ length: 1100 }, (_, i) =>
    bulkRecord("location", {
      artifactId: bulkSource.id,
      label: "Bulk source " + i,
      kind: "dataset",
      locator: "row " + (i + 1),
      excerpt: "Synthetic excerpt " + i,
      parser: "manual-transcription",
      quality: "Synthetic scale fixture",
      artifactSha256: bulkSource.sha256,
      artifactName: bulkSource.name,
      visibility: bulkSource.visibility,
    }),
  );
  const superseded = bulkRecord("assertion", {
    statement: "Superseded scale assertion",
    criterion: "AIA-15-1",
    relations: [],
    missingEvidence: "",
    assessment: "First revision",
    conclusion: "unassessed",
    status: "draft",
    revision: 1,
  });
  for (let i = 0; i < 30; i++) {
    const assertion = bulkRecord("assertion", {
      ...(i === 0 ? { supersedesId: superseded.id } : {}),
      statement: "Scale assertion " + i,
      criterion: "AIA-15-1",
      // What a scoped dossier selects by procedure (#83).
      procedureId: proc.id,
      relations: [],
      missingEvidence: "",
      assessment: "Synthetic assessment",
      conclusion: "supported",
      status: "draft",
      revision: i === 0 ? 2 : 1,
    });
    bulkRecord(
      "assertion_review",
      {
        assertionId: assertion.id,
        decision: "approve",
        reason: "Synthetic independent review",
      },
      reviewer,
    );
  }
  for (const [kind, review, body] of [
    [
      "obligation",
      { decision: "confirmed" },
      { code: "AIA-14-123", applicability: "readiness", outcome: "supported" },
    ],
    [
      "impact",
      { decision: "confirmed" },
      { description: "Synthetic change", decision: "no_effect" },
    ],
  ])
    for (let i = 0; i < 10; i++) {
      const assessment = bulkRecord(kind, { ...body, rationale: "Scale " + i });
      bulkRecord(
        kind + "_review",
        { [kind + "Id"]: assessment.id, ...review, reason: "Synthetic" },
        reviewer,
      );
    }
  for (let i = 0; i < 40; i++)
    bulkRecord(["access_event", "worker_event", "assistant"][i % 3], {
      reason: "Unpinned scale event " + i,
    });
  for (let i = 0; i < bulk.length; i += 100)
    await testDb.batch(
      await Promise.all(
        bulk
          .slice(i, i + 100)
          .map(async (r) =>
            testDb
              .prepare(
                "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) VALUES(?,?,?,?,?,?,?,?)",
              )
              .bind(
                tenantId,
                e.id,
                r.id,
                r.kind,
                r.body,
                await hex(new TextEncoder().encode(r.body)),
                r.createdAt,
                r.actor,
              ),
          ),
      ),
    );
  const recordIds = (
    await testDb
      .prepare(
        "SELECT id FROM assurance_records WHERE tenant_id=? AND engagement_id=? ORDER BY created_at,id",
      )
      .bind(tenantId, e.id)
      .all()
  ).results.map((r) => r.id);
  assert(recordIds.length > 1200);
  // The workbench view counts the records and holds none of them (#121);
  // view=records answers the first page and its cursor walks the rest.
  const assurancePath = (query = {}) =>
    "/api/assurance?" +
    new URLSearchParams({ tenantId, engagementId: e.id, ...query });
  const workbench = await request(assurancePath());
  assert.equal(workbench.total, recordIds.length);
  assert.equal(
    Object.values(workbench.kindCounts).reduce((sum, n) => sum + n, 0),
    recordIds.length,
  );
  assert(!("records" in workbench) && !("nextCursor" in workbench));
  assert(Array.isArray(workbench.jobs) && workbench.capabilities);
  const first = await request(assurancePath({ view: "records" }));
  assert.equal(first.records.length, 200);
  const listed = [...first.records],
    pageBreaks = [];
  for (let cursor = first.nextCursor; cursor;) {
    const page = await request(assurancePath({ cursor }));
    assert.deepEqual(Object.keys(page).sort(), ["nextCursor", "records"]);
    assert(page.records.length > 0 && page.records.length <= 200);
    pageBreaks.push(listed.at(-1).createdAt === page.records[0].createdAt);
    listed.push(...page.records);
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    listed.map((r) => r.id),
    recordIds,
  );
  assert.equal(pageBreaks.length + 1, Math.ceil(recordIds.length / 200));
  assert(pageBreaks.includes(true), "A page break splits equal timestamps");
  const locations = [];
  for (let page = { nextCursor: "" }; page.nextCursor !== null;) {
    page = await request(
      assurancePath({
        kind: "location",
        ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
      }),
    );
    locations.push(...page.records);
  }
  assert(locations.length >= 1100);
  assert(locations.every((r) => r.kind === "location"));
  assert(locations.some((r) => r.id === bulkLocations.at(-1).id));
  assert.equal(
    (await request(assurancePath({ cursor: "not-a-cursor" }), { status: 400 }))
      .error,
    "Invalid page cursor",
  );
  // Writes no longer load every record: an assessment citing a bulk source
  // gates final capture until it is independently reviewed, and a briefing
  // reads it and the source it cites.
  const lateAssertion = (
    await assurance("addAssertion", {
      statement: "Scale sources remain covered",
      criterion: "AIA-15-1",
      relations: [
        {
          locationId: bulkLocations.at(-1).id,
          relation: "supports",
          rationale: "Synthetic citation of the newest bulk source",
        },
      ],
      missingEvidence: "",
      assessment: "Synthetic assessment past 1,000 records",
      conclusion: "supported",
    })
  ).record;
  assert.equal(
    lateAssertion.body.relations[0].locationSha256,
    await hex(new TextEncoder().encode(bulkLocations.at(-1).body)),
  );
  const ungated = await command(
    "createReport",
    {
      kind: "final",
      engagementType: "attestation",
      assuranceLevel: "reasonable",
      conclusion: "adverse",
      ...reportParticulars,
      summary: "Must wait for the independent review",
    },
    owner,
    409,
  );
  assert.equal(
    ungated.error,
    "Independent review required: Scale sources remain covered",
  );
  await assurance(
    "reviewAssertion",
    {
      assertionId: lateAssertion.id,
      decision: "approve",
      reason: "Independent review of the scale citation",
    },
    200,
    reviewer,
  );
  const scaleBriefing = (
    await assurance("assist", {
      sourceIds: [lateAssertion.id],
      action: "summary",
    })
  ).record;
  assert.deepEqual(
    scaleBriefing.body.citations.map((c) => c.recordId),
    [lateAssertion.id, bulkLocations.at(-1).id],
  );
  await assurance(
    "assist",
    { sourceIds: [lateAssertion.id], action: "summary" },
    403,
    reviewer,
  );
  console.log(
    "PASS " +
      recordIds.length +
      " assurance records: cursor-paged workbench and kind listings, record lookups, review gate and cited briefing",
  );
  // #24: an assurance package needs an engagement quality review. The
  // reviewer gets the role and engagement access through member management,
  // and a Lead appoints them; nobody on the team can be appointed.
  const quality = "fixture-quality-reviewer-" + stamp;
  await management("grantMember", {
    userId: quality,
    displayName: "Fixture Quality Reviewer",
    role: "Engagement Quality Reviewer",
    engagementIds: [e.id],
  });
  assert.deepEqual(
    (
      await request(
        "/api/access-log?" +
          new URLSearchParams({ tenantId, action: "grantMember", limit: "1" }),
      )
    ).events.map((event) => [event.subject, event.role]),
    [[quality, "Engagement Quality Reviewer"]],
    "The role grant is a recorded management event in the Access log",
  );
  const unreviewed = await command(
    "createReport",
    {
      kind: "final",
      engagementType: "attestation",
      assuranceLevel: "reasonable",
      conclusion: "adverse",
      ...reportParticulars,
      summary: "Must wait for the engagement quality review",
    },
    owner,
    400,
  );
  assert.equal(
    unreviewed.error,
    "An assurance engagement needs an engagement quality reviewer before final issuance",
  );
  assert.equal(
    (
      await command(
        "appointQualityReviewer",
        { userId: reviewer, reason: "A team member is not eligible" },
        owner,
        400,
      )
    ).error,
    "Select an active member with the Engagement Quality Reviewer role",
  );
  // A team member who is given the role is still on the team: the reviewer
  // commented on and reviewed this engagement's papers above.
  const asRole = (role) =>
    management("updateMember", {
      userId: reviewer,
      displayName: "Independent Reviewer",
      role,
      clientId: null,
      engagementIds: [e.id],
    });
  await asRole("Engagement Quality Reviewer");
  assert.equal(
    (
      await command(
        "appointQualityReviewer",
        { userId: reviewer, reason: "A former team member is not eligible" },
        owner,
        409,
      )
    ).error,
    "This person is on the engagement team (a preparer, reviewer or Lead of this engagement) and cannot be its quality reviewer",
  );
  await asRole("Reviewer");
  // #127: an engagement grant held under another role is team membership,
  // even without any recorded work and after a re-grant as reviewer.
  const secondLead = "fixture-second-lead-" + stamp;
  await management("grantMember", {
    userId: secondLead,
    displayName: "Fixture Second Lead",
    role: "Lead Auditor",
    engagementIds: [e.id],
  });
  await management("updateMember", {
    userId: secondLead,
    displayName: "Fixture Second Lead",
    role: "Engagement Quality Reviewer",
    clientId: null,
    engagementIds: [e.id],
  });
  assert.equal(
    (
      await command(
        "appointQualityReviewer",
        { userId: secondLead, reason: "Held access as a Lead" },
        owner,
        409,
      )
    ).error,
    "This person is on the engagement team (a preparer, reviewer or Lead of this engagement) and cannot be its quality reviewer",
  );
  await management("revokeMember", { userId: secondLead });
  // #127: the cooling-off period is a practice policy, set with a reason and
  // recorded as a management event; an appointment records the period.
  assert.equal(workspace.qualityReviewPolicy.coolingOffDays, 730);
  await management("setQualityReviewPolicy", {
    coolingOffDays: 1095,
    reason: "Firm policy: three years for assurance clients",
  });
  const policyEvent = await latestManagementEvent();
  assert.deepEqual(
    [policyEvent.action, JSON.parse(policyEvent.details)],
    [
      "setQualityReviewPolicy",
      {
        coolingOffDays: 1095,
        previousCoolingOffDays: 730,
        reason: "Firm policy: three years for assurance clients",
      },
    ],
  );
  assert.deepEqual(workspace.qualityReviewPolicy, {
    coolingOffDays: 1095,
    practiceSet: true,
  });
  await command("appointQualityReviewer", {
    userId: quality,
    reason: "Independent of the fixture engagement team",
  });
  assert.equal(e.qualityReview.coolingOffDays, 1095);
  assert.equal(
    (
      await command(
        "editPaper",
        { paperId: e.papers[0].id, body: {} },
        quality,
        403,
      )
    ).error,
    "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work",
  );
  await command(
    "saveQualityReview",
    {
      items: [
        "understanding",
        "judgments",
        "documentation",
        "independence",
        "consultation",
        "involvement",
        "report",
      ].map((id) => ({
        id,
        status: "satisfied",
        notes: "Evaluated for the fixture",
      })),
    },
    quality,
  );
  const qualitySignOff = (report) =>
    command(
      "signOffQualityReview",
      {
        reportId: report.id,
        internalHash: report.sha256,
        clientHash: report.clientSha256,
        conclusion: "Significant judgments and the conclusion are appropriate",
      },
      quality,
    );
  console.log(
    "PASS engagement quality reviewer: role grant, a former team member and a former grant holder refused, practice cooling-off policy, eligible appointment, no paper edits, stand-back checklist",
  );
  // The practice's report settings (#111): a report that leaves the
  // signatory, location and quality statement blank states them.
  const practiceStatement =
    "Fixture practice statement: we comply with the IESBA Code and apply ISQM 1.";
  await management(
    "setReportSettings",
    {
      signatory: reportParticulars.signatory,
      location: reportParticulars.location,
      qualityStatement: practiceStatement,
    },
    viewer,
    403,
  );
  await management("setReportSettings", {
    signatory: reportParticulars.signatory,
    location: reportParticulars.location,
    qualityStatement: practiceStatement,
  });
  assert.deepEqual(workspace.reportSettings, {
    signatory: reportParticulars.signatory,
    location: reportParticulars.location,
    qualityStatement: practiceStatement,
  });
  const settingsEvent = await latestManagementEvent();
  assert.equal(settingsEvent.action, "setReportSettings");
  assert.equal(
    JSON.parse(settingsEvent.details).qualityStatement,
    practiceStatement,
  );
  await command("createReport", {
    kind: "final",
    engagementType: "attestation",
    assuranceLevel: "reasonable",
    conclusion: "adverse",
    ...reportParticulars,
    signatory: "",
    location: "",
    summary:
      "Synthetic adverse report with unresolved nonconformity disclosed.",
  });
  const internalFinal = e.reports.at(-1);
  assert.deepEqual(internalFinal.snapshot.particulars, {
    ...reportParticulars,
    qualityStatement: practiceStatement,
  });
  console.log(
    "PASS practice report settings: admin-only op with a management event, blank particulars filled at capture",
  );
  // Every pinned record is captured, past the old 1,000-record limit.
  const pinnedIds = (
    await testDb
      .prepare(
        "SELECT id FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind NOT IN ('assistant','assistant_export','assistant_acceptance','key_rotation','dossier','access_event','worker_event') ORDER BY created_at,id",
      )
      .bind(tenantId, e.id)
      .all()
  ).results.map((r) => r.id);
  assert(pinnedIds.length > 1100);
  assert.deepEqual(
    internalFinal.snapshot.assurancePins.map((p) => p.id),
    pinnedIds,
  );
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
      ...releaseChecklist,
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
      ...releaseChecklist,
    },
    reviewer,
    409,
  );
  // The completion checklist is part of the approval (#94).
  await command(
    "approveReportPackage",
    {
      reportId: internalFinal.id,
      internalHash: internalFinal.sha256,
      clientHash: internalFinal.clientSha256,
      reason: "Approval without the completion checklist",
    },
    reviewer,
    400,
  );
  await command(
    "approveReportPackage",
    {
      reportId: internalFinal.id,
      internalHash: internalFinal.sha256,
      clientHash: internalFinal.clientSha256,
      reason: "Both captured packages and projection independently reviewed",
      ...releaseChecklist,
    },
    reviewer,
  );
  // Release waits for the quality reviewer's sign-off of both exact packages.
  const qualityInbox = await request(inboxPath, { user: quality });
  assert.equal(
    qualityInbox.items.find(
      (i) => i.engagementId === e.id && i.title === "Engagement quality review",
    )?.action,
    "Sign off final package",
  );
  assert.equal(
    (
      await command(
        "releaseReport",
        {
          reportId: internalFinal.id,
          recipientScope: "Fixture client members",
          reason: "Must reject before the quality review sign-off",
        },
        owner,
        409,
      )
    ).error,
    "The engagement quality reviewer must sign off both exact packages before release",
  );
  await qualitySignOff(internalFinal);
  // #127: at release the signer must still be an active Engagement Quality
  // Reviewer; a revoked reviewer's sign-off releases nothing.
  await management("revokeMember", { userId: quality });
  assert.equal(
    (
      await command(
        "releaseReport",
        {
          reportId: internalFinal.id,
          recipientScope: "Fixture client members",
          reason: "Must reject while the signer is revoked",
        },
        owner,
        409,
      )
    ).error,
    "The engagement quality reviewer is no longer an active member with the Engagement Quality Reviewer role; appoint an eligible reviewer and obtain their sign-off before release",
  );
  await management("grantMember", {
    userId: quality,
    displayName: "Fixture Quality Reviewer",
    role: "Engagement Quality Reviewer",
    engagementIds: [e.id],
  });
  console.log(
    "PASS engagement quality reviewer: a revoked signer blocks release until restored",
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
  // Revoking access past 1,000 records works, and the access event it records
  // is not a pinned source, so the approved package can still be released.
  await assurance("setAccess", {
    userId: auditor,
    active: false,
    reason: "Preparer rotated off before release",
  });
  await request(assurancePath(), { user: auditor, status: 404 });
  await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: auditor, status: 404 },
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
  assert.deepEqual(e.reports.at(-1).snapshot.rulePack, e.rulePack);
  assert.deepEqual(e.reports.at(-1).clientSnapshot.rulePack, e.rulePack);
  // The released package seals into both audiences' dossiers. Past the
  // verifier's 500 files the full internal dossier is refused before any
  // record body is read; scoped internal exports (#83) by record type,
  // procedure and period carry the pinned records within their scope byte for
  // byte, sign the scope in manifest 1.2 and verify offline.
  const sealBody = (audience, extra = {}) => ({
    tenantId,
    engagementId: e.id,
    reportId: internalFinal.id,
    audience,
    withheld: [],
    ...extra,
  });
  const seals = {
    client: (
      await request("/api/dossier", {
        method: "POST",
        body: sealBody("client"),
      })
    ).record,
  };
  const refused = await request("/api/dossier", {
    method: "POST",
    body: sealBody("internal"),
    status: 413,
  });
  assert.match(
    refused.error,
    new RegExp(
      "^This dossier would hold \\d+ files \\(" +
        pinnedIds.length +
        " pinned assurance records\\); the verifier accepts at most 500\\. Seal scoped exports by procedure, period or record type instead\\.$",
    ),
  );
  const clientResealed = await request("/api/dossier", {
    method: "POST",
    body: sealBody("client"),
  });
  assert.equal(clientResealed.existing, true);
  assert.equal(clientResealed.record.id, seals.client.id);
  const downloadDossier = async (audience, user, scope) => {
    const download = await transport(
      base +
        "/api/dossier?" +
        new URLSearchParams({
          tenantId,
          engagementId: e.id,
          reportId: internalFinal.id,
          audience,
          ...(scope ? { scope } : {}),
        }),
      { headers: h(user) },
    );
    assert.equal(download.status, 200);
    const bytes = new Uint8Array(await download.arrayBuffer()),
      hash = await hex(bytes);
    assert.equal(download.headers.get("X-Dossier-SHA256"), hash);
    return {
      bytes,
      hash,
      dossier: JSON.parse(new TextDecoder().decode(bytes)),
    };
  };
  // The internal dossier's paper leaves, which the package proof's document
  // leaves must match (#137).
  let internalPaperLeaves;
  const checkDossier = async (dossier, audience) => {
    assert.equal(dossier.manifest.audience, audience);
    assert.equal(dossier.manifest.schemaVersion, "1.2");
    for (const file of dossier.files)
      assert.equal(
        await hex(Buffer.from(file.contentBase64, "base64")),
        dossier.manifest.files.find((leaf) => leaf.path === file.path).sha256,
      );
    // The released report keeps the rule-pack and methodology versions it
    // was captured under (#18), in both the hashed and the readable copy.
    const dossierText = (name) =>
        Buffer.from(
          dossier.files.find((f) => f.path === name).contentBase64,
          "base64",
        ).toString("utf8"),
      dossierReport = JSON.parse(dossierText("report.json"));
    assert.deepEqual(dossierReport.rulePack, e.rulePack);
    assert.equal(
      dossierReport.methodologyVersion,
      workspace.catalog.methodologyVersion,
    );
    assert(
      dossierText("report.html").includes(
        "Rule pack " +
          e.rulePack.version +
          " (legal text " +
          e.rulePack.legalVersion,
      ),
      "released report.html names the rule pack",
    );
    // An internal dossier, full or scoped, files each paper as a
    // working-paper contract document and adds the released package's
    // completion memo (#51); check:fixtures validates them. The client
    // dossier keeps conclusions.
    const paperFiles = dossier.files
      .filter((f) => f.path.startsWith("papers/"))
      .map((f) => JSON.parse(dossierText(f.path)));
    assert(paperFiles.length > 0);
    if (audience === "internal") {
      assert(paperFiles.every((d) => d.schemaVersion === "1.1.0"));
      const memo = paperFiles.find((d) => d.catalogId === "MEM-SO-01");
      assert.equal(memo.records.releaseCompletion.reportId, internalFinal.id);
      assert.equal(
        memo.records.releaseCompletion.internalHash,
        internalFinal.sha256,
      );
      internalPaperLeaves = dossier.manifest.files.filter((f) =>
        f.path.startsWith("papers/"),
      );
      await fs.writeFile(
        ".test-output/dossier-papers.json",
        JSON.stringify(paperFiles, null, 2),
      );
    } else
      assert(paperFiles.every((d) => d.schemaVersion === undefined && !d.body));
    return {
      dossierText,
      dossierReport,
      pinnedFiles: dossier.files.filter((f) => f.path.startsWith("assurance/")),
    };
  };
  {
    const { hash, dossier } = await downloadDossier("client", viewer);
    assert.equal(hash, seals.client.body.sha256);
    const { pinnedFiles } = await checkDossier(dossier, "client");
    assert.equal(pinnedFiles.length, 0);
    assert.equal(dossier.manifest.scope, null);
  }
  const pins = internalFinal.snapshot.assurancePins,
    assessmentKinds = [
      "assertion",
      "assertion_review",
      "impact",
      "impact_review",
      "obligation",
      "obligation_review",
    ],
    procedurePinned = new Set(
      (
        await testDb
          .prepare(
            "SELECT id FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND json_extract(body,'$.procedureId')=?",
          )
          .bind(tenantId, e.id, proc.id)
          .all()
      ).results.map((r) => r.id),
    ),
    day = (offset) =>
      new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const scopes = [
    {
      name: "record types",
      scope: { recordKinds: [...assessmentKinds].reverse() },
      ids: pins
        .filter((p) => assessmentKinds.includes(p.kind))
        .map((p) => p.id),
      evidence: true,
    },
    {
      name: "procedure",
      scope: { procedureIds: [proc.id] },
      ids: pins.filter((p) => procedurePinned.has(p.id)).map((p) => p.id),
      evidence: true,
    },
    {
      name: "period and record types, evidence withheld",
      scope: {
        recordKinds: ["assertion"],
        period: { from: day(-2), to: day(1) },
        evidence: "withheld",
      },
      ids: pins.filter((p) => p.kind === "assertion").map((p) => p.id),
      evidence: false,
    },
  ];
  assert(scopes[0].ids.length > 100 && scopes[0].ids.length < 490);
  assert(scopes[1].ids.length > 0 && scopes[1].ids.length < pins.length);
  // A scope that selects nothing, a client scope and a scope that still
  // passes the file bound are refused; nothing is sealed.
  const nothing = await request("/api/dossier", {
    method: "POST",
    body: sealBody("internal", {
      scope: { period: { from: "2020-01-01", to: "2020-12-31" } },
    }),
    status: 409,
  });
  assert.equal(
    nothing.error,
    "The scope selects none of the report's " +
      pins.length +
      " pinned assurance records",
  );
  await request("/api/dossier", {
    method: "POST",
    body: sealBody("client", { scope: { recordKinds: ["assertion"] } }),
    status: 400,
  });
  await request("/api/dossier", {
    method: "POST",
    body: sealBody("internal", {
      scope: {
        recordKinds: ["location"],
        period: { from: day(-2), to: day(1) },
      },
    }),
    status: 413,
  });
  await request("/api/dossier", {
    method: "POST",
    body: sealBody("internal", { scope: { procedureIds: ["PROC-missing"] } }),
    status: 400,
  });
  const temp = path.resolve("../tmp/scoped-dossier-fixture");
  await fs.mkdir(temp, { recursive: true });
  try {
    for (const s of scopes) {
      const sealed = (
        await request("/api/dossier", {
          method: "POST",
          body: sealBody("internal", { scope: s.scope }),
        })
      ).record;
      assert.match(sealed.body.scopeSha256, /^[a-f0-9]{64}$/);
      assert.equal(sealed.body.scope.includedRecords, s.ids.length, s.name);
      // The same scope, listed in another order, finds the same seal.
      const again = await request("/api/dossier", {
        method: "POST",
        body: sealBody("internal", {
          scope: {
            ...s.scope,
            ...(s.scope.recordKinds
              ? { recordKinds: [...s.scope.recordKinds].reverse() }
              : {}),
          },
        }),
      });
      assert.equal(again.existing, true);
      assert.equal(again.record.id, sealed.id);
      const { hash, dossier, bytes } = await downloadDossier(
        "internal",
        owner,
        sealed.body.scopeSha256,
      );
      assert.equal(hash, sealed.body.sha256);
      const { pinnedFiles, dossierText, dossierReport } = await checkDossier(
        dossier,
        "internal",
      );
      assert.deepEqual(dossier.manifest.scope, sealed.body.scope);
      assert.deepEqual(dossier.manifest.scope, {
        procedureIds: s.scope.procedureIds ?? null,
        recordKinds: s.scope.recordKinds
          ? [...s.scope.recordKinds].sort()
          : null,
        period: s.scope.period ?? null,
        evidence: s.evidence ? "included" : "withheld",
        pinnedRecords: pins.length,
        includedRecords: s.ids.length,
      });
      // Exactly the pinned records in scope, byte for byte; report.json still
      // lists every pin, so the records outside the scope stay identifiable.
      assert.deepEqual(
        pinnedFiles.map((f) => f.path),
        s.ids.map((id) => "assurance/" + id + ".json"),
      );
      const stored = new Map(
        (
          await testDb
            .prepare(
              "SELECT r.id,r.body FROM json_each(?) j JOIN assurance_records r ON r.id=j.value",
            )
            .bind(JSON.stringify(s.ids))
            .all()
        ).results.map((r) => [r.id, r.body]),
      );
      for (const f of pinnedFiles)
        assert.equal(
          Buffer.from(f.contentBase64, "base64").toString(),
          stored.get(f.path.slice("assurance/".length, -".json".length)),
        );
      assert.deepEqual(dossierReport.assurancePins, pins);
      assert(
        dossierText("report.html").includes(
          "Includes " +
            s.ids.length +
            " of " +
            pins.length +
            " pinned assurance records",
        ),
      );
      assert.equal(
        dossier.files.some((f) => f.path.startsWith("evidence/")),
        s.evidence,
      );
      if (!s.evidence)
        assert(
          dossier.manifest.withheld.some(
            (w) =>
              w.id === uploaded.artifactId &&
              w.reason.startsWith("Outside this scoped export"),
          ),
        );
      // The separately reviewed verifier accepts it under a pinned key.
      const dossierPath = path.join(temp, "dossier.json"),
        trustPath = path.join(temp, "trust.json");
      await fs.writeFile(dossierPath, bytes);
      await fs.writeFile(
        trustPath,
        JSON.stringify({
          [dossier.signature.keyId]: dossier.signature.publicKeySPKI,
        }),
      );
      const verified = await verifyDossier(dossierPath, trustPath);
      assert.equal(verified.code, 0, s.name + ": " + verified.out);
      const proof = JSON.parse(verified.out);
      assert.equal(proof.outcome, "pass");
      // The verifier states the scope, so a part never reads as the whole file.
      assert.deepEqual(proof.scope, dossier.manifest.scope);
      assert(
        proof.limitations.some((l) =>
          l.startsWith(
            "Scoped export: includes " +
              s.ids.length +
              " of " +
              pins.length +
              " pinned assurance records",
          ),
        ),
        verified.out,
      );
      // Presenting it as a wider scope, with a consistent manifest digest,
      // breaks the signature itself.
      assert.equal(manifestDigest(dossier.manifest), dossier.manifestSha256);
      dossier.manifest.scope.period = { from: "2000-01-01", to: day(1) };
      dossier.manifestSha256 = manifestDigest(dossier.manifest);
      await fs.writeFile(dossierPath, JSON.stringify(dossier));
      const widened = await verifyDossier(dossierPath, trustPath);
      assert.notEqual(widened.code, 0);
      assert.deepEqual(JSON.parse(widened.out).errors, [
        "Ed25519 signature verification failed",
      ]);
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  // A scoped export is named by its scope digest, for the internal audience.
  for (const [query, status] of [
    [{ audience: "internal", scope: "0".repeat(64) }, 409],
    [{ audience: "internal", scope: "not-a-digest" }, 400],
    [{ audience: "client", scope: "0".repeat(64) }, 404],
    [{ audience: "internal" }, 409],
  ]) {
    const r = await transport(
      base +
        "/api/dossier?" +
        new URLSearchParams({
          tenantId,
          engagementId: e.id,
          reportId: internalFinal.id,
          ...query,
        }),
      { headers: h(owner) },
    );
    assert.equal(r.status, status, JSON.stringify(query));
  }
  // Each seal is a saved engagement change.
  await refresh();
  console.log(
    "PASS " +
      pinnedIds.length +
      " pinned records captured and released; the full internal dossier is refused past 500 files, and scoped exports by record type, procedure and period sign their scope (manifest 1.2) and verify offline",
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
  // Proof 1.1 lists every exported working-paper document with the digest of
  // the bytes the signed dossier files under papers/ (#137): the captured
  // documents inside the snapshot digest, the completion memo bound to the
  // package through the release record.
  assert.equal(internalProof.schemaVersion, "1.1");
  const documentLeaves = internalProof.items.filter(
    (i) => i.kind === "working_paper_document",
  );
  assert.equal(documentLeaves.length, internalPaperLeaves.length);
  for (const leaf of documentLeaves)
    assert.equal(
      internalPaperLeaves.find(
        (f) => f.path === "papers/" + leaf.id + "-r" + leaf.revision + ".json",
      )?.sha256,
      leaf.sha256,
      leaf.id,
    );
  assert.deepEqual(
    documentLeaves
      .filter((l) => l.basis === "release_record")
      .map((l) => [l.catalogId, l.bindsPackage]),
    [["MEM-SO-01", true]],
  );
  assert(
    documentLeaves.every(
      (l) => l.catalogId === "MEM-SO-01" || l.basis === "snapshot",
    ),
  );
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
  assert(!clientProof.items.some((i) => i.kind === "working_paper_document"));
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
  // The client's print view shows the ISAE 3000 report elements (#20).
  for (const element of [
    "Independent reasonable assurance report",
    "To: Fixture client board",
    "ISAE 3000 (Revised), attestation engagement",
    "Basis for adverse opinion",
    "Adverse opinion",
    "In our opinion, because of the significance",
    "Signed: Fixture Assurance GmbH",
    "Location: Vienna, Austria",
    // The practice's quality statement, from its report settings (#111).
    practiceStatement,
    "Results by criterion",
    "Executive summary",
    // The report date is the capture date, not the release date.
    new Date(internalFinal.createdAt).toLocaleDateString("en-GB", {
      timeZone: "Europe/Vienna",
      dateStyle: "long",
    }),
  ])
    assert(html.includes(element), element);
  assert(!html.includes("Internal restriction secret"));
  assert(!html.includes("Internal unavailable evidence fixture"));
  assert(!html.includes("predictions.csv"));
  assert(!html.includes("Unresolved synthetic high-risk finding"));
  // The sign → recompile → issue scenario: only the current paper is captured.
  const capturedIds = (papers) => papers.map((p) => p.id);
  assert(capturedIds(internalFinal.snapshot.papers).includes(recompiledPaper));
  assert(!capturedIds(internalFinal.snapshot.papers).includes(procedurePaper));
  assert(
    !capturedIds(internalFinal.clientSnapshot.papers).includes(procedurePaper),
  );
  // The adopted legacy WP-A09-01 paper was signed, so the first compilation
  // already superseded it; the recompile superseded the first compilation.
  const adoptedPaper = supersededPaper.supersedes;
  assert(adoptedPaper);
  assert.deepEqual(
    internalFinal.snapshot.supersededPapers.map((p) => [p.id, p.supersededBy]),
    [
      [adoptedPaper, procedurePaper],
      [procedurePaper, recompiledPaper],
    ],
  );
  assert(!capturedIds(internalFinal.snapshot.papers).includes(adoptedPaper));
  assert(
    internalFinal.snapshot.annexIV.every(
      (s) => !s.paperIds.includes(procedurePaper),
    ),
  );
  const firstRelease = e.reports.find((r) => r.id === internalFinal.id).release;
  assert.deepEqual(firstRelease.completion.templateIds, [
    "WP-RP-02",
    "MEM-SO-01",
  ]);
  assert.equal(firstRelease.completion.internalHash, internalFinal.sha256);
  assert.equal(firstRelease.completion.clientHash, internalFinal.clientSha256);
  // The approver's completion checklist travels into the completion record.
  assert.deepEqual(
    firstRelease.completion.checklist,
    firstRelease.approval.checklist,
  );
  assert.deepEqual(
    firstRelease.completion.checklist.items.find(
      (i) => i.id === "representations",
    ),
    { id: "representations", answer: "not_applicable" },
  );
  assert.equal(
    firstRelease.completion.checklist.note,
    releaseChecklist.checklistNote,
  );
  assert.deepEqual(firstRelease.history.map((h) => h.action).slice(-2), [
    "release",
    "notify_client",
  ]);
  // A newer final report supersedes the released one automatically.
  await command("createReport", {
    kind: "final",
    engagementType: "attestation",
    assuranceLevel: "reasonable",
    conclusion: "adverse",
    ...reportParticulars,
    summary: "Synthetic amended adverse report replacing the first release.",
  });
  const replacement = e.reports.at(-1);
  await command(
    "approveReportPackage",
    {
      reportId: replacement.id,
      internalHash: replacement.sha256,
      clientHash: replacement.clientSha256,
      reason: "Amended packages independently reviewed",
      ...releaseChecklist,
    },
    reviewer,
  );
  await qualitySignOff(replacement);
  const replaced = await command("releaseReport", {
    reportId: replacement.id,
    recipientScope: "Authorized fixture client members",
    reason: "Lead releases the amended package",
  });
  assert.equal(replaced.details.supersedes, internalFinal.id);
  const supersededRelease = e.reports.find(
    (r) => r.id === internalFinal.id,
  ).release;
  assert.equal(supersededRelease.state, "superseded");
  assert.equal(supersededRelease.supersededBy, replacement.id);
  assert.equal(e.reports.at(-1).release.supersedes, internalFinal.id);
  assert(
    e.reports
      .at(-1)
      .release.history.some(
        (h) =>
          h.action === "notify_client" && h.reason.includes(internalFinal.id),
      ),
  );
  assert.equal(
    e.reports.filter((r) => r.release?.state === "released").length,
    1,
  );
  const clientReports = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: viewer },
  );
  // The superseded report stays readable to the client, which was issued
  // that opinion, labelled with its successor.
  assert.deepEqual(
    clientReports.engagement.reports.map((r) => [r.id, r.supersededBy]),
    [
      [internalFinal.id, replacement.id],
      [replacement.id, undefined],
    ],
  );
  // The client sees which earlier report the released one replaced.
  assert.deepEqual(clientReports.engagement.reports[1].replaces, [
    internalFinal.id,
  ]);
  // ... and when each release notified it, without the internal note (#94).
  assert.deepEqual(clientReports.engagement.reports[1].notification, {
    at: e.reports
      .at(-1)
      .release.history.findLast((h) => h.action === "notify_client").at,
    recipients: "Authorized fixture client members",
  });
  assert(
    !JSON.stringify(clientReports.engagement.reports).includes(
      "Notify the recipients",
    ),
  );
  // The release-time records are recorded by the release, never prepared.
  await command("createPaper", { templateId: "WP-RP-02" }, undefined, 409);
  console.log(
    "PASS sign → recompile → issue captures only current papers; a newer release supersedes the older one with a client notification",
  );
  // Verify independently assessed remediation and linked reassessment without rewriting the baseline report.
  const findingId = e.findings.find(
    (f) => f.title === "Unresolved synthetic high-risk finding",
  ).id;
  await command("linkFindingSupport", {
    findingId,
    procedureId: proc.id,
    paperIds: [recompiledPaper],
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
  await command("closeFinding", { findingId, ...attest }, reviewer, 400);
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
  await command("closeFinding", { findingId, ...attest }, reviewer);
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
  // A case assessed without evidence is closed once an assessment links it;
  // concluding that no reassessment is needed requires the evidence upfront.
  const nextCycle = e.workflow.monitoring.at(-1).id;
  const assessCycle = (decision, evidenceIds, status) =>
    command(
      "assessMonitoringCase",
      {
        caseId: nextCycle,
        decision,
        assessment: "Quarterly fixture monitoring assessed",
        evidenceIds,
        dueDate: "2027-03-31",
      },
      owner,
      status,
    );
  await assessCycle("no_reassessment", [], 400);
  await assessCycle("follow_up", [], 200);
  await command(
    "closeMonitoringCase",
    { caseId: nextCycle, closure: "Must wait for evidence" },
    reviewer,
    400,
  );
  await assessCycle("no_reassessment", [uploaded.artifactId], 200);
  await command(
    "closeMonitoringCase",
    { caseId: nextCycle, closure: "Evidence shows no reassessment is needed" },
    reviewer,
  );
  assert.equal(
    e.workflow.monitoring.find((c) => c.id === nextCycle).state,
    "closed",
  );
  assert.equal(
    JSON.stringify(e.reports.find((r) => r.id === internalFinal.id).snapshot),
    JSON.parse(immutableFinal).snapshot
      ? JSON.stringify(JSON.parse(immutableFinal).snapshot)
      : "",
  );
  await command("withdrawReport", {
    reportId: replacement.id,
    reason: "Synthetic test withdrawal; preserve all captured bytes",
  });
  const afterWithdrawal = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: viewer },
  );
  // The withdrawn report leaves the client's view; the report it superseded
  // was issued to the client and stays readable, labelled as superseded
  // without naming the withdrawn successor the client cannot read.
  assert.deepEqual(
    afterWithdrawal.engagement.reports.map((r) => [r.id, r.supersededBy]),
    [[internalFinal.id, "a later report, since withdrawn"]],
  );
  await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
    { user: viewer },
  );
  await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: replacement.id,
      }),
    { user: viewer, status: 404 },
  );
  // #201: the superseded report the client still reads can be withdrawn
  // too, by a Lead Auditor only; then the client holds no report.
  await command(
    "withdrawReport",
    { reportId: internalFinal.id, reason: "Superseded report withdrawn" },
    reviewer,
    403,
  );
  await command("withdrawReport", {
    reportId: internalFinal.id,
    reason: "Superseded report withdrawn",
  });
  const afterBoth = await request(
    "/api/workspace?" + new URLSearchParams({ tenantId, engagementId: e.id }),
    { user: viewer },
  );
  assert.deepEqual(afterBoth.engagement.reports, []);
  await request(
    "/api/report-package?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
    { user: viewer, status: 404 },
  );
  // #209: the print view refuses what the package refuses, with the same
  // status: 404 for a withdrawn, unreleased or missing report, 403 for a
  // caller outside the practice.
  const refusedStatus = async (path, query, user) =>
    (
      await transport(base + path + "?" + new URLSearchParams(query), {
        headers: h(user),
      })
    ).status;
  for (const [user, reportId, status] of [
    [viewer, internalFinal.id, 404],
    [viewer, replacement.id, 404],
    [viewer, "RPT-missing", 404],
    [owner, "RPT-missing", 404],
    [other, internalFinal.id, 403],
  ]) {
    const query = { tenantId, engagementId: e.id, reportId };
    const label = user + " " + reportId;
    assert.equal(
      await refusedStatus("/api/report-package", query, user),
      status,
      "package " + label,
    );
    assert.equal(
      await refusedStatus("/report", query, user),
      status,
      "print view " + label,
    );
  }
  const refusedPrint = await transport(
    base +
      "/report?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: replacement.id,
      }),
    { headers: h(viewer) },
  );
  assert.match(await refusedPrint.text(), /Report unavailable/);
  // #216: the 403 page shows the refusal's own message, which describes only
  // the caller's own access.
  const forbiddenPrint = await transport(
    base +
      "/report?" +
      new URLSearchParams({
        tenantId,
        engagementId: e.id,
        reportId: internalFinal.id,
      }),
    { headers: h(other) },
  );
  assert.equal(forbiddenPrint.status, 403);
  const forbiddenHtml = await forbiddenPrint.text();
  assert.match(forbiddenHtml, /You do not have access to this practice/);
  assert.doesNotMatch(forbiddenHtml, /You do not have access to this report/);
  // #220: /ll144-summary answers refusals like /report and like
  // /api/ll144-summary: 403 with the refusal's own message, 404 for a
  // missing or unpublished summary.
  for (const [user, query, status] of [
    [other, { auditId: "LL144-missing" }, 403],
    [viewer, { auditId: "LL144-missing" }, 404],
    [owner, { auditId: "LL144-missing" }, 404],
    [viewer, { auditId: "LL144-missing", reportId: internalFinal.id }, 404],
  ]) {
    const full = { tenantId, engagementId: e.id, ...query };
    const label = user + " " + JSON.stringify(query);
    assert.equal(
      await refusedStatus("/api/ll144-summary", full, user),
      status,
      "LL144 API " + label,
    );
    assert.equal(
      await refusedStatus("/ll144-summary", full, user),
      status,
      "LL144 page " + label,
    );
  }
  const forbiddenSummary = await (
    await transport(
      base +
        "/ll144-summary?" +
        new URLSearchParams({
          tenantId,
          engagementId: e.id,
          auditId: "LL144-missing",
        }),
      { headers: h(other) },
    )
  ).text();
  assert.match(forbiddenSummary, /You do not have access to this practice/);
  console.log(
    "PASS the /ll144-summary page answers 403 or 404 like /api/ll144-summary",
  );
  console.log(
    "PASS the /report print view answers 403 or 404 like /api/report-package, with the refusal's own message",
  );
  console.log(
    "PASS exact package approval/release/withdrawal, independent retest, case assessment and atomic linked successor engagement",
  );
  await command("classify", {
    annexRoute: "Outside high-risk scope",
    operatorRole: "Provider",
    intendedPurpose: "Synthetic prohibited-use fixture",
    rationale: "Fixture-only prohibited route for positive-opinion rejection.",
    facts: { ...providerFacts, annexIIIProfiling: "unknown", art5_1_c: "yes" },
  });
  assert.equal(e.classification.prohibited, true);
  await command("approveClassification", attest, reviewer);
  const prohibitedReadiness = await command(
    "createReport",
    {
      kind: "final",
      engagementType: "readiness",
      conclusion: "readiness",
      summary: "Must reject a positive prohibited-practice opinion",
    },
    owner,
    400,
  );
  assert(JSON.stringify(prohibitedReadiness).includes("prohibited practice"));
  // The readiness output with gaps (#111) reports what strict readiness
  // cannot: it must describe the gaps and is labelled as not assurance.
  const readinessGaps = {
    kind: "final",
    engagementType: "readiness",
    conclusion: "readiness_gaps",
    ...reportParticulars,
    basisForModification: "",
    summary: "Readiness with the prohibited practice reported as a gap",
  };
  const undescribedGaps = await command(
    "createReport",
    readinessGaps,
    owner,
    400,
  );
  assert(JSON.stringify(undescribedGaps).includes("Describe the gaps"));
  await command("createReport", {
    ...readinessGaps,
    basisForModification:
      "The intended use falls under a prohibited practice (Art 5(1)(c)).",
  });
  const gapsReport = e.reports.at(-1);
  assert.equal(
    gapsReport.snapshot.opinion,
    "Readiness assessment, gaps identified (not assurance)",
  );
  assert.equal(
    gapsReport.clientSnapshot.conclusionStatement.notAssurance,
    true,
  );
  assert.equal(
    gapsReport.clientSnapshot.conclusionStatement.basisHeading,
    "Gaps identified",
  );
  assert(
    gapsReport.snapshot.reportTitle.includes("not an assurance report"),
    gapsReport.snapshot.reportTitle,
  );
  console.log(
    "PASS readiness assessment with gaps: captured over a prohibited practice, gaps required, labelled not assurance",
  );
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
    ".test-output/run-schema-fixtures.json",
    JSON.stringify([pinned, ...e.runs], null, 2),
  );
  await fs.writeFile(
    ".test-output/execution-schema-fixture.json",
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
