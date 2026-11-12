// New records built from the engagement's criteria pack: working papers from
// a template of the pinned pack and engagements in their initial state.
import { templateCriterion } from "./catalog-criteria";
import {
  aiActFramework,
  displayRefs,
  item,
  packRulePack,
  type Resolved,
} from "./criteria/projection";
import type { CriteriaPin } from "./criteria/types";
import type { Engagement, Paper } from "./domain";
import { id, now } from "./ids";
import { ApiError } from "./http";
import { seedWorkflow } from "./workflow-seed";

/** A paper from a template of the pinned pack; 400 for an unknown template. */
export function templatePaper(
  resolved: Pick<Resolved, "pack" | "frameworks">,
  templateId: string,
  userId: string,
): Paper {
  const t = item(resolved.pack, templateId);
  if (!t) throw new ApiError(400, "Unknown methodology template");
  const refs = displayRefs(resolved, t);
  return {
    id: id("WP"),
    templateId: t.id,
    title: t.title,
    kind: t.kind,
    stage: t.stage,
    articleRefs: refs,
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
      criteria: templateCriterion({ ...t, regulatoryRefs: refs }),
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

/**
 * A new engagement pinned to a criteria pack. Every engagement carries a
 * classification, so every build can read every aggregate; on a pack
 * without features.aiActClassification it is inert, and its version and
 * date are empty without an AI Act criteria set (design section 7.1). Only
 * a pack with an AI Act criteria set stamps the #18 rule pack.
 */
export function freshEngagement(
  resolved: Resolved & { pin: CriteriaPin },
  clientId: string,
  title: string,
  userId: string,
  structured = false,
): Engagement {
  const at = now();
  const aiAct = aiActFramework(resolved);
  const rulePack = packRulePack(resolved);
  return {
    ...(structured ? { workflow: seedWorkflow(resolved, userId, at) } : {}),
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
      version: aiAct?.edition ?? "",
      asOf: aiAct?.researchedAsOf ?? "",
      model: 2,
      answers: {},
      history: [],
    },
    ...(rulePack ? { rulePack } : {}),
    criteria: {
      pin: { ...resolved.pin },
      pinnedAt: at,
      pinnedBy: userId,
      origin: "created",
      history: [],
    },
    papers: structured
      ? []
      : resolved.pack.items
          .filter((t) => t.kind === "working_paper")
          .map((t) => templatePaper(resolved, t.id, userId)),
    artifacts: [],
    evidenceRequests: [],
    models: [],
    findings: [],
    runs: [],
    reports: [],
    eventHead: "0".repeat(64),
    createdAt: at,
  };
}
