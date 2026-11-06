// New records built from the methodology catalog: working papers from a
// template and engagements in their initial state.
import catalog from "./catalog.json";
import type { Engagement, Paper } from "./domain";
import { id, now } from "./ids";
import { ApiError } from "./http";
import { currentRulePack } from "./rule-pack-current";
import { seedWorkflow } from "./workflow-seed";
export function templatePaper(templateId: string, userId: string): Paper {
  const t = catalog.items.find((t) => t.id === templateId);
  if (!t) throw new ApiError(400, "Unknown methodology template");
  return {
    id: id("WP"),
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
    updatedAt: now(),
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
export function freshEngagement(
  clientId: string,
  title: string,
  userId: string,
  structured = false,
): Engagement {
  return {
    ...(structured ? { workflow: seedWorkflow(userId, now()) } : {}),
    id: id("ENG"),
    clientId,
    title,
    stage: "Planning",
    dueDate: "",
    version: 1,
    classification: {
      prohibited: false,
      highRisk: false,
      transparency: false,
      profiling: false,
      annexRoute: "Unassessed",
      operatorRole: "Provider",
      intendedPurpose: "",
      rationale: "",
      status: "provisional",
      version: currentRulePack.legalVersion,
      asOf: currentRulePack.researchedAsOf,
      model: 2,
      answers: {},
      history: [],
    },
    rulePack: { ...currentRulePack },
    papers: structured
      ? []
      : catalog.items
          .filter((t) => t.kind === "working_paper")
          .map((t) => templatePaper(t.id, userId)),
    artifacts: [],
    evidenceRequests: [],
    models: [],
    findings: [],
    runs: [],
    reports: [],
    eventHead: "0".repeat(64),
    createdAt: now(),
  };
}
