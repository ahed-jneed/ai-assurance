// Audit statistics: errors, constants, metric lists and get.
// Part of lib/statistics.ts (#272), which re-exports the public names.

export class StatisticsError extends Error {}

export function require_(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new StatisticsError(message);
}

export const SPEC_VERSION = "1.0.0";
export const Z_MAX = 37.0;
export const FLOORS = { sampleSize: 30, groupSize: 30, classCount: 10 };
export type Minimums = typeof FLOORS;
export const EPS = 1e-12;
export const MAX_GROUPS: Record<string, number> = {
  all_pairs: 50,
  reference: 1000,
};
export const POWER_SEARCH_LIMIT = 10_000_000;
export const BINARY_METRICS = [
  "accuracy",
  "precision",
  "recall",
  "specificity",
  "false_positive_rate",
  "balanced_accuracy",
  "f1",
] as const;
export const BINARY_DESCRIPTIVE = [
  "accuracy",
  "precision",
  "recall",
  "specificity",
  "balanced_accuracy",
  "f1",
];
export const MULTICLASS_METRICS = [
  "accuracy",
  "balanced_accuracy",
  "macro_precision",
  "macro_f1",
] as const;
export const REGRESSION_METRICS = ["mae", "rmse"] as const;
export const REGRESSION_DESCRIPTIVE = ["mae", "rmse", "r2"];
/** The optional "beats the mean baseline" member (#136): the MSE reduction over the mean-prediction baseline. */
export const REGRESSION_MEMBERS = [
  ...REGRESSION_METRICS,
  "mse_reduction",
] as const;
export const PERFORMANCE_KINDS = [
  "performance",
  "multiclass_performance",
  "regression_performance",
];
// Metrics that today's engine rule makes a pass depend on but that 1.0.0
// cannot decide by an interval (section 4.8).
export const UNDECIDABLE: Record<string, string> = {
  regression_performance: "r2",
  calibration: "expected_calibration_error",
};
// Section 5.9: a regression pass also needs the model to beat the
// mean-prediction baseline; an MSE reduction of at most this share of the
// baseline MSE is floating-point rounding and never counts as beating it.
export const BASELINE_TOLERANCE = 1e-9;
export const RATE_KEYS: Record<string, "selection" | "tpr" | "fpr"> = {
  selection_rate_difference: "selection",
  selection_rate_ratio: "selection",
  tpr_difference: "tpr",
  fpr_difference: "fpr",
};
// Headline names keep each runner's existing metric names (section 11).
export const HEADLINE_NAMES: Record<
  string,
  { engine: string; hosted: string | null }
> = {
  selection_rate_difference: {
    engine: "demographic_parity_difference",
    hosted: "maximum_selection_rate_gap",
  },
  selection_rate_ratio: {
    engine: "disparate_impact_ratio",
    hosted: "minimum_selection_rate_ratio",
  },
  equalized_odds: {
    engine: "equalized_odds_difference",
    hosted: "maximum_tpr_fpr_gap",
  },
  calibration: { engine: "maximum_calibration_gap", hosted: null },
};

/** Python's dict.get: the value when the key is present (even null), else the default. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reads untyped JSON plans and configurations, as in the Python core.
export function get(o: any, key: string, fallback: any = null) {
  return o !== null && typeof o === "object" && key in o ? o[key] : fallback;
}
