// Audit statistics: plans derived from legacy configurations.
// Part of lib/statistics.ts (#272), which re-exports the public names.

/* eslint-disable @typescript-eslint/no-explicit-any -- plans and legacy
   configurations are untyped JSON validated here, as in the Python core. */

import {
  StatisticsError,
  FLOORS,
  type Minimums,
  BINARY_METRICS,
  MULTICLASS_METRICS,
  REGRESSION_METRICS,
  UNDECIDABLE,
  get,
} from "./core";
import { sum } from "./numerics";
import { type Band } from "./pvalues";
import { normalizePlan } from "./plan";

function legacyRatioBand(tau: number): Band {
  return { lower: tau, upper: tau > 0 ? 1.0 / tau : null };
}

/** k for the multiclass chance baseline: the labels that occur in the target column (section 4.8). */
function targetLabelCount(data: any) {
  if (!data || !("matrix" in data))
    throw new StatisticsError(
      "a multiclass derivation reads the number of target labels from the data",
    );
  return (data.matrix as number[][]).filter((row) => sum(row) > 0).length;
}

export function chanceLevel(data: any) {
  return 1.0 / Math.max(2, targetLabelCount(data));
}

/** Section 9.3: a hosted 1.1 profile (task, suite, config) without a stored plan. */
export function deriveHosted(legacy: any, data: any = null) {
  const task = legacy.task,
    suite: string[] = legacy.suite,
    c = legacy.config;
  const criteria: any[] = [];
  for (const test of suite) {
    if (test === "performance" && task === "Binary classification")
      criteria.push({
        id: "performance",
        kind: "performance",
        members: [
          { metric: "accuracy", band: { lower: c.minimumAccuracy } },
          { metric: "recall", band: { lower: get(c, "minimumRecall", 0.7) } },
          { metric: "balanced_accuracy", band: { lower: 0.5 } },
        ],
      });
    else if (test === "performance")
      criteria.push({
        id: "performance",
        kind: "multiclass_performance",
        members: [
          { metric: "accuracy", band: { lower: c.minimumAccuracy } },
          { metric: "balanced_accuracy", band: { lower: chanceLevel(data) } },
          {
            metric: "macro_f1",
            band: { lower: get(c, "minimumMacroF1", 0.7) },
          },
        ],
      });
    else if (test === "regression")
      criteria.push({
        id: "regression",
        kind: "regression_performance",
        members: [
          { metric: "rmse", band: { upper: get(c, "maximumRmse", 1.0) } },
        ],
      });
    else if (test === "demographic_parity")
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric: "selection_rate_difference",
        band: { lower: -c.maximumParityGap, upper: c.maximumParityGap },
      });
    else if (test === "disparate_impact")
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric: "selection_rate_ratio",
        band: legacyRatioBand(c.minimumImpactRatio),
      });
    else if (test === "equalized_odds") {
      const delta = get(c, "maximumOddsGap", c.maximumParityGap);
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric: "equalized_odds",
        band: { lower: -delta, upper: delta },
      });
    }
  }
  const configured = {
    sampleSize: get(c, "minimumSampleSize", 20),
    groupSize: c.minimumGroupSize,
    classCount: get(c, "minimumClassCount", 5),
  };
  return {
    minimums: Object.fromEntries(
      (Object.keys(FLOORS) as (keyof Minimums)[]).map((k) => [
        k,
        Math.max(FLOORS[k], configured[k]),
      ]),
    ),
    configuredMinimums: configured,
    derivedFrom: { source: "hosted_config", contractVersion: "1.1" },
    criteria,
  };
}

/** Section 9.3: an engine 1.0 configuration whose thresholds.values define the criteria. */
export function deriveEngine(legacy: any, data: any = null) {
  const c = legacy.config;
  const task = c.task,
    suites: string[] = c.suite,
    values = c.thresholds.values;
  const bandOf = (name: string) => {
    const rule = values[name];
    return rule.operator === ">="
      ? { lower: rule.value, upper: null }
      : { lower: null, upper: rule.value };
  };
  const baseline = (name: string, chance: number) => {
    const rule = values[name];
    if (rule === undefined) return { lower: chance, upper: null };
    return rule.operator === ">="
      ? { lower: Math.max(chance, rule.value), upper: null }
      : { lower: chance, upper: rule.value };
  };
  const classificationMembers = (
    order: readonly string[],
    chance: number,
    aliases: Record<string, string> = {},
  ) => {
    const alias = (m: string) => aliases[m] ?? m;
    if (!order.some((m) => alias(m) in values)) return [];
    return order
      .filter((m) => m === "balanced_accuracy" || alias(m) in values)
      .map((m) => ({
        metric: m,
        band:
          m === "balanced_accuracy"
            ? baseline(alias(m), chance)
            : bandOf(alias(m)),
      }));
  };
  const membersFor = (order: readonly string[]) =>
    order
      .filter((m) => m in values)
      .map((m) => ({ metric: m, band: bandOf(m) }));
  const criteria: any[] = [];
  if (suites.includes("performance")) {
    if (task === "binary_classification") {
      criteria.push({
        id: "PERF-BINARY",
        kind: "performance",
        members: classificationMembers(BINARY_METRICS, 0.5),
      });
      if (get(c, "columns", {})?.score)
        criteria.push({
          id: "PERF-CAL",
          kind: "calibration",
          band: null,
          members: membersFor(["brier_score"]),
          passBlockedBy: [UNDECIDABLE.calibration],
        });
    } else if (task === "multiclass_classification")
      criteria.push({
        id: "PERF-MULTI",
        kind: "multiclass_performance",
        members: classificationMembers(MULTICLASS_METRICS, chanceLevel(data), {
          balanced_accuracy: "macro_recall",
        }),
      });
    else
      criteria.push({
        id: "PERF-REG",
        kind: "regression_performance",
        members: membersFor(REGRESSION_METRICS),
        passBlockedBy: [UNDECIDABLE.regression_performance],
      });
  }
  if (suites.includes("fairness") && task === "binary_classification")
    for (const [cid, metric, key] of [
      ["FAIR-DP", "selection_rate_difference", "demographic_parity_difference"],
      ["FAIR-DI", "selection_rate_ratio", "disparate_impact_ratio"],
      ["FAIR-EO", "equalized_odds", "equalized_odds_difference"],
    ]) {
      const rule = values[key];
      const band =
        rule === undefined
          ? null
          : metric === "selection_rate_ratio"
            ? legacyRatioBand(rule.value)
            : { lower: -rule.value, upper: rule.value };
      criteria.push({ id: cid, kind: "group_comparison", metric, band });
    }
  const configured = {
    sampleSize: get(c, "minSampleSize", 30),
    groupSize: get(c, "minGroupSize", 30),
    classCount: get(c, "minClassCount", 10),
  };
  return {
    minimums: Object.fromEntries(
      (Object.keys(FLOORS) as (keyof Minimums)[]).map((k) => [
        k,
        Math.max(FLOORS[k], configured[k]),
      ]),
    ),
    configuredMinimums: configured,
    derivedFrom: {
      source: "engine_thresholds",
      contractVersion: c.contractVersion,
    },
    criteria,
  };
}

export function planFor(c: any) {
  if (!("legacy" in c)) return normalizePlan(c.plan);
  const legacy = c.legacy;
  return normalizePlan(
    (legacy.source === "hosted_config" ? deriveHosted : deriveEngine)(
      legacy,
      get(c, "data"),
    ),
  );
}
