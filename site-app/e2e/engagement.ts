// Setup steps shared by the specs whose flow needs an engagement of its own:
// a new engagement of the demo client, its team, an approved scope and
// program, and the whole structured workflow up to Sign-off. Each step goes
// through the persona's API client, which makes the same calls as the UI;
// the spec drives the step it is about through the UI. A spec that changes
// an engagement's lifecycle works on its own engagement, so the shared demo
// engagement keeps the state the other specs expect.
import { releaseChecklist } from "../lib/domain/release-time";
import {
  attest,
  expect,
  persona,
  unique,
  type Api,
  type PersonaId,
} from "./fixtures";

/** The ids of an engagement a spec created for itself. */
export type Engagement = { tenantId: string; engagementId: string };

/** A new engagement of the demo client, opened by the Lead Auditor. */
export async function newEngagement(
  lead: Api,
  tenantId: string,
  clientId: string,
  title: string,
): Promise<Engagement> {
  const { engagementId } = await lead.manage(tenantId, "createEngagement", {
    clientId,
    title: `${title} ${unique()}`,
  });
  return { tenantId, engagementId };
}

/**
 * Grants the personas access to the engagement. Their role and name stay as
 * seeded, so the listed engagement is added to their earlier grants.
 */
export async function joinTeam(lead: Api, e: Engagement, ids: PersonaId[]) {
  for (const id of ids) {
    const who = persona(id);
    await lead.manage(e.tenantId, "updateMember", {
      userId: who.userId,
      displayName: who.name,
      role: who.role,
      clientId: null,
      engagementIds: [e.engagementId],
    });
  }
}

export async function engagementOf(api: Api, e: Engagement) {
  return (await api.workspace(e.tenantId, e.engagementId)).engagement;
}

/** Runs an engagement command of `e` at its current version. */
export const run = (
  api: Api,
  e: Engagement,
  op: string,
  data: Record<string, unknown> = {},
) => api.command(e.tenantId, e.engagementId, op, data);

/** An engagement command at the current version, for checks that expect a refusal. */
export async function attempt(
  api: Api,
  e: Engagement,
  op: string,
  data: Record<string, unknown> = {},
) {
  const current = await engagementOf(api, e);
  const response = await api.post("/api/workspace", {
    tenantId: e.tenantId,
    engagementId: e.engagementId,
    expectedVersion: current.version,
    op,
    data,
  });
  return {
    status: response.status(),
    error: ((await response.json()) as { error?: string }).error,
  };
}

const practices = ["a", "b", "ba", "bb", "c", "d", "e", "f", "g", "h"];

/** A deployer's credit scoring system on the Annex III route, every fact answered. */
export const CLASSIFICATION = {
  annexRoute: "Annex III — sensitive use case",
  operatorRole: "Deployer",
  intendedPurpose: "Creditworthiness assessment of consumer loan applicants",
  rationale: "Credit scoring of natural persons is listed in Annex III.",
  facts: {
    ...Object.fromEntries(practices.map((p) => ["art5_1_" + p, "no"])),
    annexIIIProfiling: "yes",
    smeStatus: "neither",
    deployerUsesEmotionRecognition: "no",
    deployerUsesBiometricCategorisation: "no",
    deployerGeneratesDeepFakes: "no",
    deployerPublishesAiTextOnPublicInterest: "no",
  },
};

export const BRIEF = {
  systemName: "Credit scoring model",
  intendedUse: "Creditworthiness assessment of consumer loan applicants",
  boundary: "Scoring service and its decision-support interface",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  actorResponsibilities: "The provider develops; the bank deploys",
  audience: "Board risk committee",
  deliverables: "Readiness report",
  basis: "Persona suite methodology; readiness against the criteria",
  constraints: "Synthetic and anonymized data only",
  independence: "",
  changeImpact: "",
};

/** The one procedure the specs take into scope: manual, so no run is pinned. */
export const PROCEDURE = "WP-A09-01";

/** The brief, saved and submitted by the Lead Auditor. */
export async function submittedBrief(lead: Api, e: Engagement) {
  await run(lead, e, "saveBrief", BRIEF);
  await run(lead, e, "submitBrief");
  return (await engagementOf(lead, e)).workflow.brief as {
    revision: number;
    status: string;
  };
}

/** The brief, approved by the independent Reviewer. */
export async function approvedScope(lead: Api, reviewer: Api, e: Engagement) {
  const brief = await submittedBrief(lead, e);
  await run(reviewer, e, "approveBrief", {
    revision: brief.revision,
    reason: "Scope, responsibilities and period reviewed (persona suite)",
  });
}

/**
 * The preparer's draft program: every candidate out of scope except one
 * manual procedure, which the preparer (the Auditor, unless a spec chooses
 * another) prepares and the Reviewer reviews.
 */
export async function draftProgram(preparer: Api, e: Engagement) {
  const w = (await engagementOf(preparer, e)).workflow;
  await run(preparer, e, "scopeProgramCandidates", {
    procedureIds: w.procedures.map((p: { id: string }) => p.id),
    selected: false,
    applicability: "not_applicable",
    rationale:
      "Persona suite: outside this engagement's agreed scope; no legal exclusion claim",
    periodAnalysis: "Assessed for the audit period of the brief",
  });
  const p = (await engagementOf(preparer, e)).workflow.procedures.find(
    (q: { templateId: string }) => q.templateId === PROCEDURE,
  );
  await run(preparer, e, "saveProcedurePlan", {
    procedureId: p.id,
    assignmentRevision: p.assignmentRevision ?? 1,
    plan: {
      selected: true,
      applicability: "readiness",
      rationale: "Selected for the persona suite's readiness assessment",
      criterion: p.criterion || "Risk management system is established",
      sourceVersion: p.sourceVersion,
      periodAnalysis: "Applies throughout the audit period",
      population: "The complete risk register for the audit period",
      sampling: "Every entry; the register is small",
      ownerId: preparer.who.userId,
      reviewerId: persona("qa-reviewer").userId,
      dueDate: "2026-12-31",
      method: "manual",
      modelId: "",
      datasetId: "",
      profileId: "",
    },
  });
  return p.id as string;
}

/** The program, submitted by its preparer and approved by the Reviewer. */
export async function approvedProgram(
  preparer: Api,
  reviewer: Api,
  e: Engagement,
) {
  const procedureId = await draftProgram(preparer, e);
  await run(preparer, e, "submitProgram");
  const program = (await engagementOf(preparer, e)).workflow.program;
  await run(reviewer, e, "approveProgram", {
    revision: program.revision,
    reason: "Selection, criteria, sample and assignments reviewed",
  });
  return procedureId;
}

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

/** The acceptance record with every team member's declaration, approved. */
export async function acceptedEngagement(members: Api[], e: Engagement) {
  const [lead] = members;
  const team = members.filter(
    (m, i) => members.findIndex((n) => n.who.id === m.who.id) === i,
  );
  const met = (basis: string) => ({ met: true, basis });
  await run(lead, e, "saveAcceptance", {
    decision: "acceptance",
    preconditions: {
      subjectMatter: met("The credit scoring model is identifiable"),
      criteria: met("Persona suite methodology criteria"),
      evidence: met("Synthetic evidence access agreed"),
      purpose: met("Readiness decision of the board risk committee"),
    },
    scope: "Readiness assessment of the credit scoring model",
    periodStart: BRIEF.periodStart,
    periodEnd: BRIEF.periodEnd,
    systemBoundary: BRIEF.boundary,
    accessLevel: "grey",
    engagementLetter: "EL-E2E-1",
    team: team.map((t) => t.who.userId),
    competenceConclusion: "The team covers assurance and statistics",
    changeReason: "",
  });
  for (const member of team)
    await run(member, e, "saveDeclaration", {
      priorWork: "",
      threats: [],
      exclusions: [],
      competence,
      expertField: "",
      confirmed: true,
    });
  const acceptance = (await engagementOf(lead, e)).workflow.acceptance;
  await run(lead, e, "approveAcceptance", {
    revision: acceptance.revision,
    reason: "Preconditions met and declarations current",
  });
}

/**
 * The in-scope procedure executed and evaluated by the Auditor, reviewed by
 * the Reviewer, and its compiled paper signed by the Lead Auditor.
 */
export async function completedProcedure(
  [lead, auditor, reviewer]: Api[],
  e: Engagement,
  procedureId: string,
) {
  await submittedProcedure(auditor, e, procedureId);
  await run(reviewer, e, "reviewProcedure", {
    procedureId,
    reason: "Work, evidence and conclusion independently inspected",
  });
  const paperId = (await engagementOf(lead, e)).workflow.procedures.find(
    (q: { id: string }) => q.id === procedureId,
  ).paperId;
  await run(lead, e, "signPaper", { paperId, ...attest });
}

/** The procedure executed, evaluated and submitted for review by its preparer. */
export async function submittedProcedure(
  auditor: Api,
  e: Engagement,
  procedureId: string,
) {
  const { artifactId } = await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    `risk-register-${unique()}.txt`,
    "Risk register extract: 12 risks, owners and treatments (synthetic).",
    "Governance",
  );
  await run(auditor, e, "acceptEvidence", { artifactId, ...attest });
  const p = (await engagementOf(auditor, e)).workflow.procedures.find(
    (q: { id: string }) => q.id === procedureId,
  );
  await run(auditor, e, "recordProcedureExecution", {
    procedureId,
    performed: "Inspected the risk register and its treatment records",
    steps: p.instructions.map((i: { id: string }) => ({
      id: i.id,
      state: "performed",
      notes: "Inspected (persona suite)",
    })),
    sampling: "Every register entry inspected",
    results: "Each risk has an owner, a treatment and a review date",
    limitations: "Synthetic evidence only",
    evidenceIds: [artifactId],
    runIds: [],
  });
  await run(auditor, e, "evaluateProcedure", {
    procedureId,
    relevance: "The register addresses the criterion",
    reliability: "Hash-pinned register extract inspected",
    coverage: "Complete register for the audit period",
    contradictions: "None found",
    conclusion: "The risk management criterion is met",
    outcome: "supported",
  });
  await run(auditor, e, "submitProcedure", { procedureId });
}

/**
 * A new engagement taken through classification, scope, program, acceptance
 * and its one procedure to Sign-off, where a final report can be captured.
 */
export async function engagementInSignOff(
  [lead, auditor, reviewer]: Api[],
  tenantId: string,
  clientId: string,
  title: string,
) {
  const e = await engagementInFieldwork(
    [lead, auditor, reviewer],
    tenantId,
    clientId,
    title,
  );
  await run(lead, e, "setStage", { stage: "Evidence evaluation", ...attest });
  await completedProcedure([lead, auditor, reviewer], e, e.procedureId);
  for (const stage of ["Reporting", "Sign-off"])
    await run(lead, e, "setStage", { stage, ...attest });
  expect((await engagementOf(lead, e)).stage).toBe("Sign-off");
  return e;
}

/**
 * A new engagement with its classification, scope, program and acceptance
 * approved, in Fieldwork, where `preparer` executes its one procedure.
 */
export async function engagementInFieldwork(
  [lead, preparer, reviewer]: Api[],
  tenantId: string,
  clientId: string,
  title: string,
) {
  const e = await newEngagement(lead, tenantId, clientId, title);
  await joinTeam(
    lead,
    e,
    [preparer, reviewer]
      .map((member) => member.who.id)
      .filter((id) => id !== lead.who.id),
  );
  await run(lead, e, "classify", CLASSIFICATION);
  await run(reviewer, e, "approveClassification", attest);
  await approvedScope(lead, reviewer, e);
  const procedureId = await approvedProgram(preparer, reviewer, e);
  await acceptedEngagement([lead, preparer, reviewer], e);
  await run(lead, e, "setStage", { stage: "Fieldwork", ...attest });
  return { ...e, procedureId };
}

/** The particulars a final readiness report states. */
export const FINAL_REPORT = {
  kind: "final",
  engagementType: "readiness",
  conclusion: "readiness",
  addressee: "Acme board risk committee",
  location: "Vienna, Austria",
  signatory: "E2E Assurance GmbH",
  summary: "Readiness of the credit scoring model (persona suite).",
};

/**
 * The completion checklist (MEM-SO-01) an approval of both exact packages
 * answers, every item confirmed.
 */
export const RELEASE_CHECKLIST = Object.fromEntries(
  releaseChecklist.map((item) => [item.id, "confirmed"]),
);

/** A final readiness report captured by the Lead Auditor. */
export async function finalReport(
  lead: Api,
  e: Engagement,
  summary = FINAL_REPORT.summary,
) {
  const { reportId } = await run(lead, e, "createReport", {
    ...FINAL_REPORT,
    summary,
  });
  const report = (await engagementOf(lead, e)).reports.find(
    (r: { id: string }) => r.id === reportId,
  );
  expect(report, "createReport returns the report id").toBeTruthy();
  return report as { id: string; sha256: string; clientSha256: string };
}

/** Runs an assurance workbench command (/api/assurance) of `e`. */
export async function assurance(
  api: Api,
  e: Engagement,
  op: string,
  data: Record<string, unknown>,
) {
  const response = await api.post("/api/assurance", {
    tenantId: e.tenantId,
    engagementId: e.engagementId,
    op,
    data,
  });
  expect(response.status(), `${op}: ${await response.text()}`).toBe(200);
  return ((await response.json()) as { record: { id: string } }).record;
}
