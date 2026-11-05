import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { sourceURL } from "./ts-modules.mjs";
const compiled = async (file) =>
  ts.transpileModule(await fs.readFile(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asURL = (js) =>
  "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const domain = await sourceURL("lib/domain.ts");
const { paperChecklist, paperNextAction, personalPaperQueue } = await import(
  asURL(
    (await compiled("lib/paper-workflow.ts")).replace(
      /from (['"])\.\/domain\1/,
      "from " + JSON.stringify(domain),
    ),
  )
);
const { parseResume, permittedAuditView, resumeKey } = await import(
  asURL(await compiled("lib/workspace-preferences.ts"))
);
const artifact = { id: "evidence", status: "accepted" };
const base = {
  id: "paper",
  title: "Assessment",
  templateId: "WP-1",
  status: "draft",
  required: true,
  revision: 2,
  authorId: "author",
  contributors: ["contributor"],
  body: {
    results: "Recorded tests",
    conclusion: "Supported by evidence",
    conclusionStatus: "supported",
    criteria: "Assessment criteria",
  },
  evidenceIds: ["evidence"],
  comments: [],
  reviews: [],
  signatures: [],
};
const next = (paper = base, role = "Auditor", userId = "author", extra = {}) =>
  paperNextAction({ paper, artifacts: [artifact], role, userId, ...extra });
assert.equal(next().op, "submitPaper");
assert.equal(next().enabled, true);
assert.equal(
  next({ ...base, body: { ...base.body, results: "" } }).target,
  "results",
);
assert.equal(
  paperChecklist(base, []).find((item) => item.target === "evidence").done,
  false,
);
assert.equal(next(base, "Auditor", "author", { dirty: true }).op, "editPaper");
assert.equal(
  next(base, "Auditor", "author", { pendingComment: true }).op,
  null,
);
assert.equal(
  next({ ...base, comments: [{ authorId: "reviewer", resolved: false }] })
    .target,
  "review",
);
const submitted = { ...base, status: "in_review" };
assert.equal(next(submitted, "Reviewer", "contributor").enabled, false);
assert.equal(next(submitted, "Lead Auditor", "author").enabled, false);
assert.equal(next(submitted, "Reviewer", "independent").op, "reviewPaper");
const reviewed = {
  ...base,
  status: "reviewed",
  reviews: [{ userId: "independent", revision: 2 }],
};
assert.equal(next(reviewed, "Lead Auditor", "independent").enabled, false);
assert.equal(
  next(reviewed, "Lead Auditor", "author").enabled,
  true,
  "Server permits an author who is a Lead to sign after a different independent review",
);
assert.equal(
  next(
    { ...reviewed, reviews: [{ userId: "independent", revision: 1 }] },
    "Lead Auditor",
    "signer",
  ).enabled,
  false,
);
assert.equal(next({ ...base, status: "signed" }, "Auditor").op, null);
assert.equal(
  next({ ...base, status: "signed" }, "Lead Auditor").op,
  "reopenPaper",
);
const excluded = {
  ...base,
  required: false,
  body: { ...base.body, conclusionStatus: "not_applicable" },
};
assert.equal(
  next(excluded, "Auditor", "author", { dirty: true, saved: base }).enabled,
  false,
);
assert.equal(
  next(
    { ...excluded, body: { ...excluded.body, criteria: "" } },
    "Lead Auditor",
    "author",
    { dirty: true, saved: base },
  ).enabled,
  false,
);
const supplementary = { ...base, required: false };
assert.equal(
  next(supplementary, "Auditor", "author", {
    dirty: true,
    saved: supplementary,
  }).enabled,
  true,
);
const queue = personalPaperQueue(
  [base, submitted, reviewed],
  [artifact],
  "Lead Auditor",
  "author",
);
assert.equal(queue.actionable.length, 2);
assert.equal(queue.waiting.length, 1);
const reviewerQueue = personalPaperQueue(
  [base, submitted, reviewed],
  [artifact],
  "Reviewer",
  "independent",
);
assert.equal(reviewerQueue.actionable.length, 1);
assert.equal(reviewerQueue.actionable[0].paper.status, "in_review");
console.log(
  "PASS next-action guidance, preparation/review independence, revision-bound signing and applicability exclusions",
);
assert.equal(parseResume("{broken"), null);
assert.equal(
  parseResume(
    JSON.stringify({
      tenantId: "tenant",
      engagementId: "engagement",
      view: "Unknown",
    }),
  ),
  null,
);
assert.deepEqual(
  parseResume(
    JSON.stringify({
      tenantId: "tenant",
      engagementId: "engagement",
      view: "Evidence vault",
      body: "must not persist",
    }),
  ),
  { tenantId: "tenant", engagementId: "engagement", view: "Evidence vault" },
);
assert.equal(permittedAuditView("Working papers", "Client Viewer"), "Overview");
assert.equal(
  permittedAuditView("Reports & sign-off", "Client Viewer"),
  "Reports & sign-off",
);
assert.notEqual(resumeKey("person-a"), resumeKey("person-b"));
console.log(
  "PASS bounded resume preferences, identity separation and role-allowed page restoration",
);

const {
  parseNavigationPreferences,
  parseRecentEngagements,
  navigationPreferenceKey,
  permittedNavigationRoutes,
} = await import(asURL(await compiled("lib/navigation-preferences.ts")));
assert.equal(parseNavigationPreferences("{broken"), null);
assert.equal(parseNavigationPreferences("null"), null);
assert.equal(
  parseNavigationPreferences(
    JSON.stringify({ compact: "true", width: 272, pins: [], recent: [] }),
  ),
  null,
);
assert.equal(
  parseNavigationPreferences(
    JSON.stringify({ compact: false, width: "272", pins: [], recent: [] }),
  ),
  null,
);
assert.equal(parseNavigationPreferences(" ".repeat(4097)), null);
assert.deepEqual(
  parseNavigationPreferences(
    JSON.stringify({
      compact: true,
      width: 1000,
      pins: [
        "Working papers",
        "Working papers",
        "Unknown",
        "Findings",
        null,
        "Evidence vault",
        "Testing lab",
        "Clients",
      ],
      recent: [
        "Overview",
        "Findings",
        "Overview",
        "Clients",
        "Engagements",
        "Users & access",
        "Testing lab",
      ],
      paperBody: "never store this",
    }),
  ),
  {
    compact: true,
    width: 360,
    pins: ["Working papers", "Findings", "Evidence vault", "Testing lab"],
    recent: [
      "Overview",
      "Findings",
      "Clients",
      "Engagements",
      "Users & access",
    ],
  },
);
assert.equal(
  parseNavigationPreferences(
    JSON.stringify({ compact: false, width: 200, pins: [], recent: [] }),
  ).width,
  248,
);
assert.equal(
  parseNavigationPreferences(
    JSON.stringify({ compact: false, width: 279.8, pins: [], recent: [] }),
  ).width,
  280,
);
assert.notEqual(
  navigationPreferenceKey("user-a", "tenant-a"),
  navigationPreferenceKey("user-b", "tenant-a"),
);
assert.notEqual(
  navigationPreferenceKey("user-a", "tenant-a"),
  navigationPreferenceKey("user-a", "tenant-b"),
);
for (const role of ["Client Viewer", "Client Contributor"]) {
  const allowed = permittedNavigationRoutes(role, true);
  assert(!allowed.includes("Working papers"));
  assert(!allowed.includes("Testing lab"));
  assert(allowed.includes("Evidence vault"));
  assert(allowed.includes("Reports & sign-off"));
  assert.deepEqual(
    ["Working papers", "Evidence vault"].filter((route) =>
      allowed.includes(route),
    ),
    ["Evidence vault"],
    "Restored pins must be filtered against the current role",
  );
}
assert(permittedNavigationRoutes("Reviewer", true).includes("Working papers"));
assert.deepEqual(permittedNavigationRoutes("Auditor", false), [
  "My work",
  "Clients",
  "Engagements",
  "Users & access",
]);
assert.deepEqual(
  parseRecentEngagements(
    JSON.stringify([
      "first",
      "first",
      null,
      5,
      "",
      "x".repeat(200),
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
    ]),
  ),
  ["first", "second", "third", "fourth", "fifth"],
);
assert.deepEqual(
  parseRecentEngagements(
    JSON.stringify({ engagementTitle: "do not store content" }),
  ),
  [],
);
assert.deepEqual(parseRecentEngagements(" ".repeat(4097)), []);
console.log(
  "PASS bounded sidebar preferences, identity/practice separation, role-filtered shortcuts and engagement IDs only",
);

const { findingWorkflow } = await import(
  asURL(
    (await compiled("lib/finding-workflow.ts")).replace(
      /from (['"])\.\/domain\1/,
      "from " + JSON.stringify(domain),
    ),
  )
);
const finding = {
  id: "finding",
  status: "ready_for_retest",
  createdBy: "author",
  remediationBy: "remediator",
  remediation: "Independent retest recorded",
  retestEvidenceIds: ["evidence"],
};
assert.equal(
  findingWorkflow(finding, [artifact], "Reviewer", "independent").canRetest,
  true,
);
assert.equal(
  findingWorkflow(finding, [artifact], "Lead Auditor", "author").canRetest,
  false,
);
assert.equal(
  findingWorkflow(finding, [artifact], "Reviewer", "remediator").canRetest,
  false,
);
assert.equal(
  findingWorkflow(finding, [], "Reviewer", "independent").canRetest,
  false,
);
assert.equal(
  findingWorkflow(
    finding,
    [{ ...artifact, status: "unverified" }],
    "Reviewer",
    "independent",
  ).canRetest,
  false,
);
assert.equal(
  findingWorkflow(
    { ...finding, remediation: "" },
    [artifact],
    "Reviewer",
    "independent",
  ).canRetest,
  false,
);
assert.equal(
  findingWorkflow(finding, [artifact], "Client Viewer", "independent")
    .canRemediate,
  false,
);
assert.equal(
  findingWorkflow(finding, [artifact], "Client Viewer", "independent")
    .showRetest,
  false,
);
assert.equal(
  findingWorkflow(
    { ...finding, status: "closed" },
    [artifact],
    "Lead Auditor",
    "independent",
  ).canRemediate,
  false,
);
assert.equal(
  findingWorkflow(
    { ...finding, status: "open" },
    [artifact],
    "Auditor",
    "author",
  ).canRemediate,
  true,
);
assert.equal(
  findingWorkflow(
    { ...finding, status: "open" },
    [artifact],
    "Reviewer",
    "independent",
  ).showRetest,
  false,
);
console.log(
  "PASS contextual finding actions, independent retest and accepted-evidence prerequisites",
);

// The lifecycle, final-issuance and conclusion gates are unit-tested in
// lib/domain/gates.test.ts; the evidence request flow below still uses them.
const { completionGates } = await import(domain);
const paperWorkflow = asURL(
  (await compiled("lib/paper-workflow.ts")).replaceAll(
    /from (['"])\.\/domain\1/g,
    "from " + JSON.stringify(domain),
  ),
);
const { stagePaperQueue, auditStageIndex, paperEvidenceReferences } =
  await import(
    asURL(
      (await compiled("lib/auditor-workflow.ts"))
        .replaceAll(
          /from (['"])\.\/domain\1/g,
          "from " + JSON.stringify(domain),
        )
        .replaceAll(
          /from (['"])\.\/paper-workflow\1/g,
          "from " + JSON.stringify(paperWorkflow),
        ),
    )
  );
const planning = { ...base, id: "planning", stage: "Planning" };
const fieldwork = { ...base, id: "fieldwork", stage: "Fieldwork" };
const evaluation = { ...base, id: "evaluation", stage: "Evidence Evaluation" };
const monitoring = {
  ...base,
  id: "monitoring",
  stage: "Remediation and Monitoring",
};
const audit = {
  workflow: {
    brief: { revision: 1, status: "approved" },
    program: { revision: 1, briefRevision: 1, status: "approved" },
    procedures: [],
  },
  id: "engagement",
  stage: "Planning",
  classification: { status: "approved" },
  papers: [evaluation, fieldwork, planning, monitoring],
  artifacts: [artifact],
  findings: [],
  models: [],
  runs: [],
};
let stageQueue = stagePaperQueue(audit, "Auditor", "author");
assert.deepEqual(
  stageQueue.active.map((i) => i.paper.id),
  ["planning"],
);
assert.deepEqual(
  stageQueue.later.map((i) => i.paper.id),
  ["fieldwork", "evaluation", "monitoring"],
);
assert.equal(stageQueue.teamOutstanding, 1);
stageQueue = stagePaperQueue(
  { ...audit, stage: "Evidence evaluation" },
  "Auditor",
  "author",
);
assert.deepEqual(
  stageQueue.active.map((i) => i.paper.id),
  ["planning", "fieldwork", "evaluation"],
);
assert.equal(stageQueue.earlierOutstanding, 2);
assert.equal(auditStageIndex("Evidence Evaluation"), 2);
assert.equal(auditStageIndex(" Remediation and Monitoring "), -1);
assert.equal(stagePaperQueue(audit, "Auditor", "another").active.length, 0);
assert.equal(
  stagePaperQueue(audit, "Auditor", "another").teamOutstanding,
  1,
  "An empty personal queue must not hide team obligations",
);
assert.equal(
  stagePaperQueue(
    { ...audit, papers: [{ ...evaluation, status: "in_review" }] },
    "Reviewer",
    "independent",
  ).active.length,
  1,
  "Review handoffs remain active even for future-labelled papers",
);
assert.equal(
  stagePaperQueue(
    {
      ...audit,
      papers: [
        { ...monitoring, comments: [{ authorId: "author", resolved: false }] },
      ],
    },
    "Auditor",
    "author",
  ).active.length,
  1,
  "Comment resolution cannot disappear with an unrecognized stage",
);
assert.deepEqual(
  paperEvidenceReferences(
    { ...base, evidenceIds: ["evidence", "pending", "missing", "pending"] },
    [artifact, { id: "pending", status: "quarantined" }],
  ).map((r) => [r.id, r.artifact?.status ?? "missing"]),
  [
    ["evidence", "accepted"],
    ["pending", "quarantined"],
    ["missing", "missing"],
  ],
);
assert.equal(
  paperChecklist({ ...base, evidenceIds: ["evidence", "missing"] }, [
    artifact,
  ]).find((c) => c.target === "evidence").done,
  false,
);
console.log("PASS stage-focused work and visible unavailable evidence");

const requestModule = asURL(
  (await compiled("lib/evidence-requests.ts"))
    .replaceAll(/from (['"])\.\/domain\1/g, "from " + JSON.stringify(domain))
    .replace(
      /from (['"])zod\1/,
      "from " +
        JSON.stringify(
          new URL("../node_modules/zod/index.js", import.meta.url).href,
        ),
    ),
);
const { evidenceRequestCommand, requestLabel, requestOverdue } = await import(
  requestModule
);
let requestNumber = 0;
const requestContext = {
  role: "Auditor",
  userId: "author",
  at: "2026-10-07T10:00:00Z",
  id: () => `request-${++requestNumber}`,
  makeLimitationPaper: () => ({
    ...structuredClone(base),
    id: `memo-${++requestNumber}`,
    title: "Limitations",
    templateId: "MEM-EX-01",
    stage: "Evidence Evaluation",
    history: [],
  }),
};
const requestSpec = {
  subject: "Validation population coverage",
  description:
    "Obtain population and sampling support for the planned evaluation.",
  responsibleParty: "Client validation owner",
  periodVersion: "2026 Q3; model 1.0",
  handling: "Approved controlled collection; aggregate evidence only.",
  dueDate: "2026-10-10",
  paperIds: ["planning"],
};
const requestAudit = { ...structuredClone(audit), evidenceRequests: [] };
const requestCall = (op, data, role = "Auditor") =>
  evidenceRequestCommand(requestAudit, op, data, { ...requestContext, role });
const rejected = (fn, status) =>
  assert.throws(fn, (error) => error.status === status);
rejected(
  () => requestCall("createEvidenceRequest", requestSpec, "Client Viewer"),
  403,
);
rejected(
  () => requestCall("createEvidenceRequest", requestSpec, "Reviewer"),
  403,
);
assert.throws(() =>
  requestCall("createEvidenceRequest", {
    ...requestSpec,
    dueDate: "2026-02-30",
  }),
);
rejected(
  () =>
    requestCall("createEvidenceRequest", {
      ...requestSpec,
      paperIds: ["other-engagement-paper"],
    }),
  400,
);
const createdRequest = requestCall("createEvidenceRequest", requestSpec),
  requestId = createdRequest.requestId;
assert.equal(requestAudit.evidenceRequests[0].status, "open");
rejected(
  () =>
    requestCall("recordEvidenceResponse", {
      requestId,
      response: "Other engagement file",
      evidenceIds: ["other-engagement-evidence"],
    }),
  400,
);
rejected(
  () =>
    requestCall("assessEvidenceRequest", {
      requestId,
      decision: "accepted",
      assessment: "No recorded response",
    }),
  409,
);
requestAudit.artifacts.push({ id: "quarantined", status: "quarantined" });
requestCall("recordEvidenceResponse", {
  requestId,
  response: "Auditor recorded receipt from client channel.",
  evidenceIds: ["quarantined"],
});
rejected(
  () =>
    requestCall("assessEvidenceRequest", {
      requestId,
      decision: "accepted",
      assessment: "Cannot accept quarantined evidence as sufficient",
    }),
  400,
);
requestCall("assessEvidenceRequest", {
  requestId,
  decision: "returned",
  assessment: "The material lacks the requested population coverage.",
});
assert.equal(requestAudit.evidenceRequests[0].status, "returned");
requestCall("recordEvidenceResponse", {
  requestId,
  response: "Revised aggregate population support received.",
  evidenceIds: ["evidence"],
});
assert.throws(() =>
  requestCall("assessEvidenceRequest", {
    requestId,
    decision: "accepted",
    assessment: " ",
  }),
);
requestCall("assessEvidenceRequest", {
  requestId,
  decision: "accepted",
  assessment:
    "Source, period, population coverage and relevance checked for the planned procedure.",
});
const sufficientRequest = requestAudit.evidenceRequests[0];
assert.equal(sufficientRequest.status, "accepted");
assert.equal(requestLabel(sufficientRequest), "Sufficient for procedure");
assert(sufficientRequest.history.some((h) => h.status === "returned"));
assert.equal(
  requestOverdue({ ...sufficientRequest, status: "open" }, "2026-10-11"),
  true,
);
assert.equal(requestOverdue(sufficientRequest, "2026-10-11"), false);
assert.equal(
  completionGates({ ...requestAudit, papers: [] }).filter(
    (g) => g.kind === "request",
  ).length,
  0,
);
rejected(
  () => requestCall("updateEvidenceRequest", { ...requestSpec, requestId }),
  409,
);
rejected(
  () =>
    requestCall(
      "reopenEvidenceRequest",
      { requestId, reason: "Changed audit population" },
      "Auditor",
    ),
  403,
);
requestCall(
  "reopenEvidenceRequest",
  { requestId, reason: "Changed audit population" },
  "Lead Auditor",
);
assert.equal(requestAudit.evidenceRequests[0].status, "returned");
assert(
  requestAudit.evidenceRequests[0].history.some((h) => h.status === "accepted"),
);
rejected(
  () =>
    requestCall("closeEvidenceRequest", {
      requestId,
      disposition: "unobtainable",
      assessment: "Records no longer available",
    }),
  403,
);
requestCall(
  "closeEvidenceRequest",
  {
    requestId,
    disposition: "unobtainable",
    assessment:
      "Attempts were exhausted; the scope limitation needs a reasoned opinion.",
  },
  "Lead Auditor",
);
const limited = requestAudit.evidenceRequests[0],
  memo = requestAudit.papers.find((p) => p.id === limited.limitationPaperId);
assert.equal(limited.disposition, "unobtainable");
assert.equal(memo.required, true);
assert.equal(memo.body.conclusionStatus, "not_evaluated");
assert.equal(memo.status, "draft");
assert(
  completionGates(requestAudit, "Readiness assessment").some(
    (g) => g.kind === "request",
  ),
);
assert(
  !completionGates(requestAudit, "Adverse conclusion").some(
    (g) => g.kind === "request",
  ),
);
assert(
  completionGates(requestAudit, "Adverse conclusion").some(
    (g) => g.recordId === memo.id,
  ),
  "Limitation memo still requires independent review/signature",
);
console.log(
  "PASS evidence request states, scoped sufficiency, real dates, same-engagement references, Lead exceptions and positive-opinion safeguards",
);
