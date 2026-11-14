import { assessmentFields, type FieldContext } from "./assessment-fields";
import { executionFields } from "./execution-fields";
import type { Field } from "./types";

/** Every form's fields, by operation. */
export const workbenchFields = (
  ctx: FieldContext,
): Record<string, Field[]> => ({
  ...assessmentFields(ctx),
  ...executionFields(ctx),
});

export const formTitles: Record<string, string> = {
  cancelJob: "Cancel execution",
  revokeWorker: "Revoke runner",
  registerSystem: "Register a system revision",
  registerPrediction: "Link prediction lineage",
  queueExternal: "Freeze external execution",
  addLocation: "Locate evidence precisely",
  addAssertion: "Record an assertion",
  sample: "Select a reproducible sample",
  impact: "Assess a change",
  enrollWorker: "Enroll a scoped runner",
  setAccess: "Manage engagement access",
  importPacket: "Import an assurance packet",
  obligationDecision: "Assess an obligation subitem",
  exportBriefing: "Export authorized briefing sources",
  importBriefing: "Import a cited model draft",
};

/** The dialog description of a form. */
export const formDescription = (form: string) =>
  form === "registerSystem"
    ? "Define the complete system around a registered model version."
    : form === "queueExternal"
      ? "Pin an approved procedure and its inputs for reproducible external evaluation."
      : form === "addAssertion"
        ? "Record a claim, link precise sources, and explain your assessment."
        : form === "cancelJob"
          ? "Stop this execution and retain the cancellation reason in its history."
          : form === "revokeWorker"
            ? "Revoke this runner’s engagement access and record why."
            : "Saved to this engagement with your name and a version history.";

export const saveLabels: Record<string, string> = {
  registerSystem: "Register system",
  registerPrediction: "Link predictions",
  queueExternal: "Freeze execution request",
  addLocation: "Record source location",
  addAssertion: "Save assertion",
  sample: "Generate sample manifest",
  impact: "Save change assessment",
  enrollWorker: "Enroll runner",
  setAccess: "Save access decision",
  importPacket: "Import packet",
  obligationDecision: "Save obligation assessment",
  exportBriefing: "Export selected sources",
  importBriefing: "Import cited draft",
  cancelJob: "Cancel execution",
  revokeWorker: "Revoke runner",
};

export const formGroups: Record<string, { title: string; names: string[] }[]> =
  {
    registerSystem: [
      {
        title: "System identity & purpose",
        names: ["name", "version", "modelId", "intendedUse", "population"],
      },
      {
        title: "Input contract",
        names: ["pipelineArtifactId", "deploymentArtifactId"],
      },
      {
        title: "Outputs & decisions",
        names: ["semantics", "classOrder", "threshold"],
      },
      {
        title: "Human oversight & runtime",
        names: ["humanDecision", "runtime", "limitations"],
      },
    ],

    registerPrediction: [
      {
        title: "System & source evidence",
        names: ["systemId", "modelId", "datasetId", "sourceDatasetId"],
      },
      {
        title: "Prediction origin",
        names: ["mode", "producedAt", "producingRun", "inferenceConfiguration"],
      },
      { title: "Verification limits", names: ["limitations"] },
    ],

    queueExternal: [
      {
        title: "Approved audit context",
        names: ["systemId", "procedureId", "modelId", "datasetId", "profileId"],
      },
      {
        title: "Execution method",
        names: ["mode", "predictionId", "securityReviewId"],
      },
      {
        title: "Output configuration",
        names: ["negativeLabel", "predictionOutput", "predictionKind"],
      },
    ],

    addAssertion: [
      {
        title: "Claim & audit criterion",
        names: ["criterion", "statement", "procedureId", "paperId"],
      },
      {
        title: "Auditor assessment",
        names: ["missingEvidence", "assessment", "conclusion"],
      },
    ],

    obligationDecision: [
      {
        title: "Scope & applicability",
        names: [
          "code",
          "actor",
          "applicability",
          "rationale",
          "periodAnalysis",
        ],
      },
      {
        title: "Evidence & assessment",
        names: ["evidenceId", "assessment", "outcome"],
      },
    ],

    impact: [
      {
        title: "Changed source",
        names: ["sourceType", "previousId", "newId", "description"],
      },
      {
        title: "Impact & proposed action",
        names: ["assessment", "decision", "reason"],
      },
    ],
  };
