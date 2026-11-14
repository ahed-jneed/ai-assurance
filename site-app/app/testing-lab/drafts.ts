// The testing lab's form state: the protocol draft, its defaults and the
// requests it becomes, plus the shapes the lab's dialogs share.
import type {
  Engagement,
  EvaluationConfig,
  EvaluationProfile,
  ModelCard,
} from "@/lib/domain";
import { legacyConfig } from "@/lib/domain";
import {
  defaultPlanForm,
  formFromPlan,
  planFromForm,
  validateHostedPlan,
  type PlanForm,
} from "@/lib/hosted-statistics";
import type { Plan } from "@/lib/statistics";
import { specialCategoryGroupFloor } from "@/lib/special-category";

/** The workspace command the lab runs through. */
export type LabAct = (
  op: string,
  data: Record<string, unknown>,
  override?: Engagement,
) => Promise<{
  engagement: Engagement;
  details?: Record<string, string>;
}>;
export type Inspection = {
  artifactId: string;
  sha256: string;
  rowCount: number;
  columns: {
    name: string;
    type: string;
    missing: number;
    uniqueCount: number;
  }[];
};
/** The protocol form: legacy-style threshold fields plus the plan options; saving pre-registers a plan (schemaVersion 1.1). */
export type Draft = Omit<
  EvaluationProfile,
  "id" | "schemaVersion" | "createdAt" | "createdBy" | "config" | "statistics"
> & { config: EvaluationConfig; plan: PlanForm };
/** An evaluation set up for an approved procedure, with its dataset card. */
export type ProcedureBinding = {
  procedureId: string;
  datasetCardRecordId: string;
};
const initialConfig: EvaluationConfig = {
  labelColumn: "",
  predictionColumn: "",
  groupColumn: "",
  positiveLabel: "1",
  negativeLabel: "0",
  performancePositiveLabel: "",
  // The statistics 1.0.0 floors (section 7): a plan may raise them, never lower them.
  minimumSampleSize: 30,
  minimumClassCount: 10,
  // A fairness group column is special-category data unless declared
  // otherwise, and such protocols need at least this many rows (#134).
  minimumGroupSize: specialCategoryGroupFloor,
  maximumParityGap: 0.1,
  maximumOddsGap: 0.1,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.8,
  minimumRecall: 0.7,
  minimumMacroF1: 0.7,
  maximumRmse: 1,
};
/** A form for a saved protocol: a revision starts from its plan, or from a legacy protocol's thresholds raised to the floors. */
export const profileDraft = (p: EvaluationProfile): Draft => {
  const legacy = legacyConfig(p.config);
  const base = {
    name: p.name,
    version: p.version,
    task: p.task,
    suite: [...p.suite],
    datasetContext: { ...p.datasetContext },
    rationale: p.rationale,
  };
  if (legacy || !p.statistics)
    return {
      ...base,
      config: {
        ...initialConfig,
        ...p.config,
        minimumSampleSize: Math.max(30, legacy?.minimumSampleSize ?? 20),
        minimumClassCount: Math.max(10, legacy?.minimumClassCount ?? 5),
        minimumGroupSize: Math.max(30, legacy?.minimumGroupSize ?? 30),
      },
      plan: { ...defaultPlanForm, powerAssumptions: {} },
    };
  const { thresholds, form } = formFromPlan(p.statistics);
  return {
    ...base,
    config: { ...initialConfig, ...p.config, ...thresholds },
    plan: form,
  };
};
/** The createEvaluationProfile request for a form: its mappings, labels and pre-registered plan. */
export function profileRequest(d: Draft, classCount: number | null) {
  const c = d.config;
  return {
    name: d.name,
    version: d.version,
    task: d.task,
    suite: d.suite,
    config: {
      labelColumn: c.labelColumn,
      predictionColumn: c.predictionColumn,
      groupColumn: c.groupColumn,
      positiveLabel: c.positiveLabel,
      performancePositiveLabel: c.performancePositiveLabel ?? "",
      negativeLabel: c.negativeLabel ?? "",
    },
    statistics: planFromForm(d.task, d.suite, c, d.plan, classCount),
    datasetContext: d.datasetContext,
    rationale: d.rationale,
  };
}
/** The normalised plan a form pre-registers, or the reason it is not valid. */
export function draftPlan(
  d: Draft,
  classCount: number | null,
): { plan: Plan; error: "" } | { plan: null; error: string } {
  try {
    return {
      plan: validateHostedPlan(
        d.task,
        planFromForm(d.task, d.suite, d.config, d.plan, classCount),
      ),
      error: "",
    };
  } catch (err) {
    return { plan: null, error: (err as Error).message };
  }
}
export const emptyDraft = (task = "Binary classification"): Draft => ({
  name: "",
  version: "1.0",
  task,
  suite: [task === "Regression" ? "regression" : "performance"],
  config: { ...initialConfig },
  plan: { ...defaultPlanForm, powerAssumptions: {} },
  datasetContext: {
    split: "unknown",
    population: "",
    predictionProvenance: "",
    independence: "",
    sensitiveDataBasis: "",
  },
  rationale: "",
});
export const emptyCard: ModelCard = {
  schemaVersion: "1.0",
  owner: "",
  framework: "",
  license: "",
  population: "",
  outOfScope: "",
  limitations: "",
  inputSchema: "",
  outputSemantics: "",
  preprocessing: "",
  source: { kind: "internal", repoId: "", revision: "", filename: "" },
};
