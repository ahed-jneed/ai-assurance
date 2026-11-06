import { z } from "zod";
export const tasks = [
  "Binary classification",
  "Multiclass classification",
  "Regression",
  "Classical NLP",
] as const;
// Bump both when a metric or decision rule changes: a run queued under one
// definition cannot execute under another, and its manifest names the
// definition that produced its results.
// 3.0.0: statistics 1.0.0 decides every criterion by its interval against
// the pre-registered band (hosted run contract 1.4).
export const runnerVersion = "interactive-predictions-3.0.0";
export const testDefinitionVersion = "traditional-ml-3.0.0";
export const tests = [
  {
    id: "performance",
    label: "Classification performance",
    tasks: ["Binary classification", "Multiclass classification"],
    mode: "interactive",
    requires: "Observed labels and saved predictions",
    article: "15",
  },
  {
    id: "regression",
    label: "Regression performance",
    tasks: ["Regression"],
    mode: "interactive",
    requires: "Numeric targets and saved predictions",
    article: "15",
  },
  {
    id: "demographic_parity",
    label: "Demographic parity",
    tasks: ["Binary classification"],
    mode: "interactive",
    requires: "Protected groups and a favourable label",
    article: "10",
  },
  {
    id: "disparate_impact",
    label: "Disparate impact",
    tasks: ["Binary classification"],
    mode: "interactive",
    requires: "Protected groups and a favourable label",
    article: "10",
  },
  {
    id: "equalized_odds",
    label: "Equalized odds",
    tasks: ["Binary classification"],
    mode: "interactive",
    requires: "Positive and negative reference support in every group",
    article: "10",
  },
  {
    id: "drift",
    label: "Drift: PSI, KS and Wasserstein",
    tasks: ["Binary classification", "Multiclass classification", "Regression"],
    mode: "external",
    requires: "Reference and current numeric features; Python worker",
    article: "10",
  },
  {
    id: "permutation",
    label: "Permutation importance",
    tasks: ["Binary classification", "Multiclass classification", "Regression"],
    mode: "external",
    requires: "Trusted model adapter and feature schema; Python worker",
    article: "15",
  },
  {
    id: "perturbation",
    label: "Approved-range perturbation",
    tasks: ["Binary classification", "Multiclass classification", "Regression"],
    mode: "external",
    requires: "Trusted adapter and approved feature ranges; Python worker",
    article: "15",
  },
  {
    id: "explainability",
    label: "SHAP / LIME",
    tasks: [
      "Binary classification",
      "Multiclass classification",
      "Regression",
      "Classical NLP",
    ],
    mode: "unavailable",
    requires: "Adapter/runtime integration still required",
    article: "15",
  },
  {
    id: "cross_validation",
    label: "Cross-validation / adversarial robustness",
    tasks: ["Binary classification", "Multiclass classification", "Regression"],
    mode: "unavailable",
    requires:
      "Training pipeline, split plan and validated runner still required",
    article: "15",
  },
] as const;
const column = z.string().trim().max(300);
export const configSchema = z
  .object({
    labelColumn: column.min(1),
    predictionColumn: column.min(1),
    groupColumn: column.default(""),
    /** The favourable outcome: what fairness tests count as selection. */
    positiveLabel: column.default(""),
    /**
     * The class binary performance measures recall (sensitivity) on, which
     * need not be the favourable outcome. Empty means the favourable label.
     */
    performancePositiveLabel: column.default(""),
    minimumGroupSize: z.number().int().min(2).max(1000),
    maximumParityGap: z.number().min(0).max(1),
    minimumImpactRatio: z.number().min(0).max(1),
    minimumAccuracy: z.number().min(0).max(1),
    minimumSampleSize: z.number().int().min(2).max(10000).default(20),
    minimumClassCount: z.number().int().min(1).max(1000).default(5),
    maximumOddsGap: z.number().min(0).max(1).default(0.1),
    minimumRecall: z.number().min(0).max(1).default(0.7),
    minimumMacroF1: z.number().min(0).max(1).default(0.7),
    maximumRmse: z.number().positive().max(1e100).default(1),
  })
  .strict();
/**
 * The config of a profile with a stored statistics plan (schemaVersion 1.1):
 * only the column mappings and the declared labels; bands and minimums live
 * in the plan (docs/design/audit-statistics.md section 9.1).
 */
export const planConfigSchema = z
  .object({
    labelColumn: column.min(1),
    predictionColumn: column.min(1),
    groupColumn: column.default(""),
    positiveLabel: column.default(""),
    performancePositiveLabel: column.default(""),
    /** The other declared binary label: with both declared, data with one observed label is evaluated. */
    negativeLabel: column.default(""),
  })
  .strict();
export const suiteSchema = z
  .array(
    z.enum([
      "performance",
      "regression",
      "demographic_parity",
      "disparate_impact",
      "equalized_odds",
    ]),
  )
  .min(1)
  .max(5)
  .refine((x) => new Set(x).size === x.length, "Tests must be unique");
export const contextSchema = z
  .object({
    split: z.enum(["test", "validation", "training", "unknown"]),
    population: z.string().trim().min(1).max(5000),
    predictionProvenance: z.string().trim().min(1).max(5000),
    independence: z.string().trim().min(1).max(5000),
    sensitiveDataBasis: z.string().trim().max(5000),
  })
  .strict();
export const profileSchema = z
  .object({
    name: column.min(1),
    version: column.min(1),
    task: z.enum(tasks),
    suite: suiteSchema,
    config: configSchema,
    datasetContext: contextSchema,
    rationale: z.string().trim().min(1).max(5000),
  })
  .strict();
/**
 * A protocol with a pre-registered statistics plan (schemaVersion 1.1). Its
 * suite follows from the plan's criteria; a stated suite must equal it.
 */
export const planProfileSchema = z
  .object({
    name: column.min(1),
    version: column.min(1),
    task: z.enum(tasks),
    suite: suiteSchema.optional(),
    config: planConfigSchema,
    statistics: z.record(z.string(), z.unknown()),
    datasetContext: contextSchema,
    rationale: z.string().trim().min(1).max(5000),
  })
  .strict();
/** The class binary performance measures recall on. */
export function performancePositiveLabel(c: {
  positiveLabel: string;
  performancePositiveLabel?: string;
}) {
  return c.performancePositiveLabel || c.positiveLabel;
}
export function fairnessSelected(suite: string[]) {
  return suite.some((x) =>
    ["demographic_parity", "disparate_impact", "equalized_odds"].includes(x),
  );
}
export function assertSuite(task: string, suite: string[]) {
  for (const test of suite)
    if (
      !tests.some(
        (t) =>
          t.id === test &&
          t.mode === "interactive" &&
          (t.tasks as readonly string[]).includes(task),
      )
    )
      throw Error("Test " + test + " is not available for " + task);
}
export function protocolConfigKeys(task: string, suite: string[]) {
  return [
    "labelColumn",
    "predictionColumn",
    "minimumSampleSize",
    ...(task !== "Regression" ? ["minimumClassCount"] : []),
    ...(task === "Binary classification" ? ["positiveLabel"] : []),
    ...(suite.includes("performance")
      ? [
          "minimumAccuracy",
          ...(task === "Binary classification"
            ? ["performancePositiveLabel", "minimumRecall"]
            : ["minimumMacroF1"]),
        ]
      : []),
    ...(suite.includes("regression") ? ["maximumRmse"] : []),
    ...(fairnessSelected(suite) ? ["groupColumn", "minimumGroupSize"] : []),
    ...(suite.includes("demographic_parity") ? ["maximumParityGap"] : []),
    ...(suite.includes("disparate_impact") ? ["minimumImpactRatio"] : []),
    ...(suite.includes("equalized_odds") ? ["maximumOddsGap"] : []),
  ];
}
