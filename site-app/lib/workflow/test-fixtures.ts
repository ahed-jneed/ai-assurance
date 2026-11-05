// Builders shared by the domain and workflow unit tests; the app never imports
// this module. The tests go through the public lib/domain.ts and
// lib/workflow-service.ts entry points that the app uses, so they pin
// behaviour rather than module layout.
import { expect } from "vitest";
import catalog from "../catalog.json";
import type {
  Artifact,
  Engagement,
  EvaluationProfile,
  EvidenceRequest,
  Finding,
  Model,
  Paper,
  Run,
} from "../domain";
import { seedWorkflow } from "../workflow-seed";
import { WorkflowError, workflowCommand } from "../workflow-service";
import type { Procedure, Workflow } from "../workflow-types";

export type WorkflowContext = Parameters<typeof workflowCommand>[3];
type Member = NonNullable<Awaited<ReturnType<WorkflowContext["member"]>>>;

export const at = "2026-11-05T10:00:00.000Z";

// Practice members known to the fake membership lookup. The user ID doubles
// as the role a test acts in.
export const people: Record<string, Member> = {
  lead: { role: "Lead Auditor", client_id: null, status: "active" },
  "second-lead": { role: "Lead Auditor", client_id: null, status: "active" },
  auditor: { role: "Auditor", client_id: null, status: "active" },
  "second-auditor": { role: "Auditor", client_id: null, status: "active" },
  reviewer: { role: "Reviewer", client_id: null, status: "active" },
  "second-reviewer": { role: "Reviewer", client_id: null, status: "active" },
  "revoked-reviewer": { role: "Reviewer", client_id: null, status: "revoked" },
  viewer: { role: "Client Viewer", client_id: "client", status: "active" },
  contributor: {
    role: "Client Contributor",
    client_id: "client",
    status: "active",
  },
};

let sequence = 0;
const nextId = (prefix: string) => prefix + "-" + ++sequence;

// The digest of sha256 in lib/store.ts, which the workspace route passes to
// the commands. Like it, this rejects a value that is neither text nor bytes,
// such as JSON.stringify(undefined), instead of hashing it as empty text.
export async function sha256(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/** The command context the workspace route builds, for one practice member. */
export function context(userId: string): WorkflowContext {
  const person = people[userId];
  if (!person) throw new Error("Unknown fixture member " + userId);
  return {
    role: person.role,
    userId,
    at,
    id: nextId,
    sha256,
    makePaper: (templateId) => templatePaper(templateId, userId),
    member: async (id) => people[id] ?? null,
  };
}

export function command(
  e: Engagement,
  op: string,
  data: unknown,
  userId: string,
) {
  return workflowCommand(e, op, data, context(userId));
}

/** Expects a command to fail with a WorkflowError of this status. */
export async function expectFailure(
  result: Promise<unknown>,
  status: number,
  message?: string,
) {
  const error = await result.then(
    () => {
      throw new Error("Expected the command to fail");
    },
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(WorkflowError);
  expect(error).toMatchObject(
    message === undefined ? { status } : { status, message },
  );
}

/** A working paper as the store creates it from a methodology template. */
export function templatePaper(templateId: string, userId = "auditor"): Paper {
  const t = catalog.items.find((t) => t.id === templateId);
  if (!t) throw new Error("Unknown methodology template " + templateId);
  return {
    id: nextId("WP"),
    templateId: t.id,
    title: t.title,
    kind: t.kind,
    stage: t.stage,
    articleRefs: t.regulatoryRefs,
    required:
      t.kind === "working_paper" && t.stage !== "Remediation and Monitoring",
    revision: 1,
    authorId: userId,
    contributors: [],
    updatedAt: at,
    status: "draft",
    plannedGuidance: t.procedures.map((p) => p.text).join("\n"),
    body: {
      objective: t.objective,
      scope: "",
      criteria: t.regulatoryRefs.join("; "),
      procedures: "",
      sampling: "",
      results: "",
      limitations: "",
      conclusion: "",
      conclusionStatus: "not_evaluated",
    },
    evidenceIds: [],
    runIds: [],
    comments: [],
    reviews: [],
    signatures: [],
    history: [],
  };
}

export function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "paper",
    templateId: "WP-1",
    title: "Assessment",
    kind: "working_paper",
    stage: "Fieldwork",
    articleRefs: [],
    required: true,
    revision: 1,
    authorId: "auditor",
    contributors: [],
    updatedAt: at,
    status: "draft",
    body: {},
    evidenceIds: [],
    runIds: [],
    comments: [],
    reviews: [],
    signatures: [],
    history: [],
    ...overrides,
  };
}

export function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "evidence",
    name: "Validation record",
    category: "Validation",
    size: 1024,
    sha256: "a".repeat(64),
    key: "evidence/validation-record.pdf",
    createdAt: at,
    uploadedBy: "auditor",
    visibility: "internal",
    status: "accepted",
    mediaType: "application/pdf",
    ...overrides,
  };
}

export function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding",
    title: "Representativeness gap",
    article: "10",
    condition: "Two applicant groups are under-represented",
    criteria: "Art. 10(3)",
    cause: "Sampling frame excludes online applicants",
    effect: "Error rates may differ between groups",
    likelihood: 3,
    impact: 4,
    riskScore: 12,
    severity: "High",
    status: "open",
    owner: "client",
    dueDate: "2026-12-31",
    response: "",
    remediation: "",
    retestEvidenceIds: [],
    createdBy: "auditor",
    visibility: "internal",
    ...overrides,
  };
}

export function run(overrides: Partial<Run> = {}): Run {
  return {
    contractVersion: "1.2",
    id: "run",
    engagementId: "ENG-1",
    modelId: "model",
    datasetId: "dataset",
    suite: ["performance"],
    seed: 7,
    thresholds: {},
    state: "succeeded",
    outcome: "pass",
    results: [],
    paperIds: [],
    createdAt: at,
    provenance: { inputHashes: {}, runnerVersion: "1.0", policyVersion: "1.0" },
    config: {
      labelColumn: "label",
      predictionColumn: "prediction",
      groupColumn: "",
      positiveLabel: "1",
      minimumGroupSize: 30,
      maximumParityGap: 0.1,
      minimumImpactRatio: 0.8,
      minimumAccuracy: 0.7,
    },
    ...overrides,
  };
}

export function model(overrides: Partial<Model> = {}): Model {
  return {
    id: "model",
    name: "Credit scorer",
    version: "1.0",
    format: "onnx",
    task: "binary_classification",
    intendedPurpose: "Creditworthiness assessment",
    artifactId: "model-file",
    status: "registered",
    ...overrides,
  };
}

export function profile(
  overrides: Partial<EvaluationProfile> = {},
): EvaluationProfile {
  return {
    id: "protocol",
    schemaVersion: "1.0",
    name: "Binary classification protocol",
    version: "1.0",
    task: "binary_classification",
    suite: ["performance"],
    config: run().config,
    datasetContext: {
      split: "test",
      population: "2026 applicants",
      predictionProvenance: "Provider scoring service",
      independence: "Held-out test split",
      sensitiveDataBasis: "Art. 10(5)",
    },
    rationale: "Agreed acceptance thresholds",
    createdAt: at,
    createdBy: "auditor",
    ...overrides,
  };
}

export function evidenceRequest(
  overrides: Partial<EvidenceRequest> = {},
): EvidenceRequest {
  return {
    id: "REQ-1",
    subject: "Validation population",
    description: "Population and sampling support for the evaluation",
    responsibleParty: "Client validation owner",
    periodVersion: "2026 Q3; model 1.0",
    handling: "Aggregate evidence only",
    dueDate: "2026-11-30",
    paperIds: [],
    evidenceIds: ["evidence"],
    required: true,
    status: "accepted",
    response: "Population extract delivered",
    assessment: "Source, period and coverage checked",
    createdBy: "auditor",
    createdAt: at,
    updatedBy: "auditor",
    updatedAt: at,
    revision: 1,
    history: [],
    ...overrides,
  };
}

/** A legacy engagement: no structured workflow until a Lead adopts one. */
export function engagement(overrides: Partial<Engagement> = {}): Engagement {
  return {
    id: "ENG-1",
    clientId: "client",
    title: "Credit scoring assurance",
    stage: "Planning",
    dueDate: "2026-12-31",
    version: 1,
    classification: {
      prohibited: false,
      highRisk: true,
      transparency: false,
      profiling: true,
      annexRoute: "Annex III point 5(b)",
      operatorRole: "Provider",
      intendedPurpose: "Creditworthiness assessment of consumer applicants",
      rationale: "Credit scoring of natural persons",
      status: "approved",
      approvedBy: "lead",
      version: "02024R1689-20260727",
      asOf: "2026-10-05",
    },
    papers: [],
    artifacts: [],
    evidenceRequests: [],
    models: [],
    findings: [],
    runs: [],
    reports: [],
    eventHead: "0".repeat(64),
    createdAt: at,
    ...overrides,
  };
}

/** A structured engagement as created today: seeded workflow, no papers. */
export function structuredEngagement(
  overrides: Partial<Engagement> = {},
): Engagement {
  return engagement({ workflow: seedWorkflow("lead", at), ...overrides });
}

export function workflowOf(e: Engagement): Workflow {
  if (!e.workflow) throw new Error("The engagement has no workflow");
  return e.workflow;
}

export function procedureOf(e: Engagement, id: string): Procedure {
  const p = workflowOf(e).procedures.find((p) => p.id === id);
  if (!p) throw new Error("Unknown procedure " + id);
  return p;
}

/** A workflow whose brief (revision 1) and program (bound to it) are approved. */
export function approvedWorkflow(procedures: Procedure[] = []): Workflow {
  const w = seedWorkflow("lead", at);
  w.brief = {
    ...briefInput,
    revision: 1,
    status: "approved",
    contributors: ["auditor"],
    updatedBy: "auditor",
    updatedAt: at,
    approval: {
      userId: "reviewer",
      at,
      revision: 1,
      hash: "b".repeat(64),
      reason: "Scope agreed",
    },
    history: [],
  };
  w.program = {
    ...w.program,
    briefRevision: 1,
    status: "approved",
    approval: {
      userId: "reviewer",
      at,
      revision: 1,
      hash: "c".repeat(64),
      reason: "Program agreed",
    },
  };
  w.procedures = procedures;
  return w;
}

// The procedure the command tests plan, execute and review.
export const procedureId = "PROC-WP-A10-01";

export const briefInput = {
  systemName: "Credit scoring model",
  intendedUse: "Creditworthiness assessment of consumer loan applicants",
  boundary: "Scoring service and its decision-support interface",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  actorResponsibilities: "The provider develops; the bank deploys",
  audience: "Board risk committee",
  deliverables: "Readiness report",
  basis: "ISAE 3000 (Revised) limited assurance",
  constraints: "Synthetic and anonymized data only",
  independence: "No prior implementation services",
  changeImpact: "",
};

export function planInput(overrides: Record<string, unknown> = {}) {
  return {
    selected: true,
    applicability: "applicable",
    rationale: "Article 10 applies to the high-risk system",
    criterion: "Art. 10(2)-(5)",
    sourceVersion: "02024R1689-20260727",
    periodAnalysis: "Training data used throughout the audit period",
    population: "All 2026 training and validation datasets",
    sampling: "All datasets (population testing)",
    ownerId: "auditor",
    reviewerId: "reviewer",
    dueDate: "2026-11-30",
    method: "manual",
    modelId: "",
    datasetId: "",
    profileId: "",
    ...overrides,
  };
}

/** Saves, submits and independently approves the engagement brief. */
export async function approveScope(e: Engagement) {
  await command(e, "saveBrief", briefInput, "auditor");
  await command(e, "submitBrief", {}, "auditor");
  await command(
    e,
    "approveBrief",
    { revision: workflowOf(e).brief?.revision, reason: "Scope agreed" },
    "reviewer",
  );
}

/** Scopes every candidate out, then plans `procedureId` for execution. */
export async function planProgram(e: Engagement) {
  await command(
    e,
    "scopeProgramCandidates",
    {
      procedureIds: workflowOf(e).procedures.map((p) => p.id),
      selected: false,
      applicability: "not_applicable",
      rationale: "Outside the agreed engagement scope",
      periodAnalysis: "Not relevant to the audit period",
    },
    "auditor",
  );
  await command(
    e,
    "saveProcedurePlan",
    { procedureId, plan: planInput() },
    "auditor",
  );
}

/** Approved brief and program: what procedure execution requires. */
export async function approveProgram(e: Engagement) {
  await approveScope(e);
  await planProgram(e);
  await command(e, "submitProgram", {}, "auditor");
  await command(
    e,
    "approveProgram",
    { revision: workflowOf(e).program.revision, reason: "Program agreed" },
    "reviewer",
  );
}

/** A Lead revises the approved scope; brief and program are re-approved. */
export async function changeScope(e: Engagement) {
  await command(
    e,
    "saveBrief",
    {
      ...briefInput,
      boundary: "Scoring service, decision support and appeals",
      changeImpact: "Appeals handling is now in scope",
    },
    "lead",
  );
  await command(e, "submitBrief", {}, "lead");
  await command(
    e,
    "approveBrief",
    { revision: workflowOf(e).brief?.revision, reason: "Revised scope agreed" },
    "reviewer",
  );
  await command(e, "submitProgram", {}, "auditor");
  await command(
    e,
    "approveProgram",
    { revision: workflowOf(e).program.revision, reason: "Program re-approved" },
    "reviewer",
  );
}

export function executionInput(
  e: Engagement,
  overrides: Record<string, unknown> = {},
) {
  return {
    procedureId,
    performed: "Inspected lineage records and reperformed coverage checks",
    steps: procedureOf(e, procedureId).instructions.map((i) => ({
      id: i.id,
      state: "performed",
      notes: "",
    })),
    sampling: "All datasets",
    results: "No exceptions noted",
    limitations: "",
    evidenceIds: ["evidence"],
    runIds: [],
    ...overrides,
  };
}

export const assessmentInput = {
  procedureId,
  relevance: "The records cover the training population",
  reliability: "System-generated lineage logs",
  coverage: "Every dataset used in the period",
  contradictions: "None identified",
  conclusion: "Data governance operates as described",
  outcome: "supported",
};

/** An engagement whose `procedureId` is executed, evaluated and submitted. */
export async function submittedProcedure() {
  const e = structuredEngagement({ artifacts: [artifact()] });
  await approveProgram(e);
  await command(e, "recordProcedureExecution", executionInput(e), "auditor");
  await command(e, "evaluateProcedure", assessmentInput, "auditor");
  await command(e, "submitProcedure", { procedureId }, "auditor");
  return e;
}
