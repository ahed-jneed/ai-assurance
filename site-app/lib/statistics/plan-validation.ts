// Audit statistics: band checks and plan validation.
// Part of lib/statistics.ts (#272), which re-exports the public names.

/* eslint-disable @typescript-eslint/no-explicit-any -- plans and legacy
   configurations are untyped JSON validated here, as in the Python core. */

import {
  StatisticsError,
  require_,
  FLOORS,
  type Minimums,
  MAX_GROUPS,
  BINARY_METRICS,
  MULTICLASS_METRICS,
  REGRESSION_MEMBERS,
  PERFORMANCE_KINDS,
  get,
} from "./core";
import { byCodePoint } from "./numerics";
import { LIBRARY, type PlanCriterion, type Plan, normalizePlan } from "./plan";

const PROPORTION_METRICS = new Set<string>([
  ...BINARY_METRICS,
  ...MULTICLASS_METRICS,
]);
const ERROR_METRICS = new Set(["mae", "rmse", "brier_score"]);
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const real = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Section 3: why a band is not allowed for this metric, or null. */
export function bandProblem(
  metric: string,
  band: any,
  mode = "all_pairs",
): string | null {
  if (
    band === null ||
    typeof band !== "object" ||
    Array.isArray(band) ||
    Object.keys(band).some((k) => k !== "lower" && k !== "upper")
  )
    return "a band is an object with lower and upper";
  const lower = get(band, "lower"),
    upper = get(band, "upper");
  if (lower === null && upper === null)
    return "a band needs at least one bound";
  if ([lower, upper].some((v) => v !== null && !real(v)))
    return "band bounds must be finite numbers";
  if (PROPORTION_METRICS.has(metric)) {
    if ([lower, upper].some((v) => v !== null && !(0.0 < v && v < 1.0)))
      return "proportion bounds must lie strictly inside (0, 1)";
    if (lower !== null && upper !== null && !(lower < upper))
      return "the lower bound must be below the upper bound";
    return null;
  }
  if (ERROR_METRICS.has(metric))
    return lower === null && upper !== null && upper > 0
      ? null
      : "error metrics take an upper bound above 0 only";
  if (metric === "mse_reduction")
    return upper === null && lower !== null && lower >= 0
      ? null
      : "the MSE reduction takes a lower bound of 0 or more only";
  if (
    [
      "selection_rate_difference",
      "equalized_odds",
      "tpr_difference",
      "fpr_difference",
      "calibration_gap",
    ].includes(metric)
  ) {
    if (lower !== null && upper !== null)
      return lower === -upper && 0.0 < upper && upper < 1.0
        ? null
        : "a difference band is symmetric, {lower: -delta, upper: delta} with 0 < delta < 1";
    if (mode !== "reference" || metric === "calibration_gap")
      return "a difference band in all_pairs mode is symmetric";
    return (lower !== null && -1.0 < lower && lower < 0.0) ||
      (upper !== null && 0.0 < upper && upper < 1.0)
      ? null
      : "a one-sided difference band needs 0 < delta < 1";
  }
  if (metric === "selection_rate_ratio") {
    if (lower === null || !(0.0 < lower && lower < 1.0))
      return "a ratio band needs a lower bound tau with 0 < tau < 1";
    if (upper === null)
      return mode === "reference"
        ? null
        : "a ratio band in all_pairs mode is [tau, 1/tau]";
    return upper === 1.0 / lower
      ? null
      : "a ratio band's upper bound is exactly 1/tau";
  }
  return "unknown metric " + metric;
}

/** The first section 3 violation among a normalised criterion's bands, or null. */
export function criterionBandProblem(c: PlanCriterion): string | null {
  for (const item of c.members ?? []) {
    const problem = bandProblem(item.metric, item.band);
    if (problem) return `${item.metric}: ${problem}`;
  }
  if (c.kind === "group_comparison" && c.band !== null) {
    const problem = bandProblem(c.metric!, c.band, c.comparison!.mode);
    if (problem) return `${c.metric}: ${problem}`;
  }
  if (c.kind === "calibration" && c.band !== null) {
    const problem = bandProblem("calibration_gap", c.band);
    if (problem) return `calibration_gap: ${problem}`;
  }
  return null;
}

function keys(
  value: any,
  allowed: readonly string[],
  required: readonly string[],
  where: string,
) {
  require_(
    value !== null && typeof value === "object" && !Array.isArray(value),
    where + " must be an object",
  );
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  require_(
    !unknown.length,
    where + " has unknown fields: " + byCodePoint(unknown).join(", "),
  );
  const missing = required.filter((k) => !(k in value));
  require_(!missing.length, where + " is missing " + missing.join(", "));
}

const integerIn = (v: unknown, lower: number, upper: number) =>
  Number.isInteger(v) && lower <= (v as number) && (v as number) <= upper;

const CRITERION_FIELDS: Record<string, readonly string[]> = {
  performance: ["members", "powerAssumptions"],
  multiclass_performance: ["members", "powerAssumptions"],
  regression_performance: ["members", "passBlockedBy", "powerAssumptions"],
  group_comparison: [
    "metric",
    "band",
    "comparison",
    "groupFields",
    "declaredGroups",
    "minimumCoverage",
    "powerAssumptions",
  ],
  calibration: [
    "band",
    "members",
    "minimumCoverage",
    "subgroup",
    "passBlockedBy",
    "powerAssumptions",
  ],
};
const MEMBER_METRICS: Record<string, readonly string[]> = {
  performance: BINARY_METRICS,
  multiclass_performance: MULTICLASS_METRICS,
  regression_performance: REGRESSION_MEMBERS,
  calibration: ["brier_score"],
};
const MEMBER_LIMITS: Record<string, number> = {
  performance: 7,
  multiclass_performance: 4,
  regression_performance: 3,
  calibration: 1,
};
const PLAN_FIELDS = [
  "statisticsVersion",
  "confidenceLevel",
  "minimums",
  "configuredMinimums",
  "multiplicity",
  "clusterField",
  "bootstrap",
  "calibrationBins",
  "power",
  "derivedFrom",
  "criteria",
];
const textOf = (v: unknown, min: number, max: number) =>
  typeof v === "string" && min <= v.length && v.length <= max;

function validateGroupFields(c: any, where: string) {
  require_(
    [
      "selection_rate_difference",
      "selection_rate_ratio",
      "equalized_odds",
    ].includes(c.metric),
    where + ".metric is not a group metric",
  );
  const comparison = get(c, "comparison", { mode: "all_pairs" });
  keys(comparison, ["mode", "referenceGroup"], ["mode"], where + ".comparison");
  require_(
    comparison.mode in MAX_GROUPS,
    where + ".comparison.mode must be all_pairs or reference",
  );
  const reference = get(comparison, "referenceGroup");
  require_(
    (comparison.mode === "reference") === (reference !== null),
    where +
      ".comparison.referenceGroup is required in reference mode, and only there",
  );
  require_(
    reference === null || textOf(reference, 1, 5000),
    where + ".comparison.referenceGroup must be a group label",
  );
  const fields = get(c, "groupFields");
  require_(
    fields === null ||
      (Array.isArray(fields) &&
        fields.length >= 1 &&
        fields.length <= 5 &&
        new Set(fields).size === fields.length &&
        fields.every((f) => textOf(f, 1, 300))),
    where + ".groupFields must be null or 1 to 5 unique column names",
  );
  const declared = get(c, "declaredGroups");
  require_(
    declared === null ||
      (Array.isArray(declared) &&
        declared.length >= 1 &&
        declared.length <= 1000 &&
        new Set(declared).size === declared.length &&
        declared.every((g) => textOf(g, 1, 5000))),
    where + ".declaredGroups must be null or unique group labels",
  );
  require_(
    get(c, "band") !== null || get(c, "libraryEntry") !== null,
    where + ".band is required",
  );
}

function validateCriterion(c: any, where: string) {
  require_(
    c !== null && typeof c === "object" && get(c, "kind") in CRITERION_FIELDS,
    where + ".kind is not a statistics 1.0.0 criterion kind",
  );
  const kind = c.kind;
  const required = [
    "id",
    "kind",
    ...(PERFORMANCE_KINDS.includes(kind)
      ? ["members"]
      : kind === "group_comparison"
        ? ["metric"]
        : []),
  ];
  keys(
    c,
    [
      "id",
      "kind",
      "role",
      "rationale",
      "libraryEntry",
      ...CRITERION_FIELDS[kind],
    ],
    required,
    where,
  );
  require_(
    typeof c.id === "string" && ID_PATTERN.test(c.id),
    where + ".id must match the run schema's id pattern",
  );
  require_(
    ["confirmatory", "exploratory"].includes(get(c, "role", "confirmatory")),
    where + ".role must be confirmatory or exploratory",
  );
  const rationale = get(c, "rationale");
  require_(
    rationale === null || textOf(rationale, 1, 5000),
    where + ".rationale must be null or text",
  );
  require_(
    !get(c, "passBlockedBy")?.length,
    where + ".passBlockedBy occurs only in derived plans",
  );
  if (kind in MEMBER_METRICS) {
    const items = get(c, "members", []);
    require_(
      Array.isArray(items) && items.length <= MEMBER_LIMITS[kind],
      `${where}.members holds at most ${MEMBER_LIMITS[kind]} members`,
    );
    for (const item of items) {
      keys(item, ["metric", "band"], ["metric", "band"], where + ".members[]");
      require_(
        MEMBER_METRICS[kind].includes(item.metric),
        `${where}: '${item.metric}' is not a ${kind} metric`,
      );
    }
    require_(
      kind === "calibration" || items.length,
      where + ".members must name at least one metric",
    );
  }
  if (kind === "group_comparison") validateGroupFields(c, where);
  if (["group_comparison", "calibration"].includes(kind)) {
    const coverage = get(c, "minimumCoverage", 1.0);
    require_(
      real(coverage) && 0.5 <= coverage && coverage <= 1.0,
      where + ".minimumCoverage must lie in [0.5, 1]",
    );
  }
  if (kind === "calibration") {
    const subgroup = get(c, "subgroup");
    if (subgroup !== null) {
      keys(
        subgroup,
        ["field", "value"],
        ["field", "value"],
        where + ".subgroup",
      );
      require_(
        ["field", "value"].every((k) => textOf(subgroup[k], 1, Infinity)),
        where + ".subgroup needs a field and a value",
      );
    }
    require_(
      get(c, "band") !== null ||
        get(c, "members", []).length ||
        get(c, "libraryEntry") !== null,
      where + " needs a gap band or a Brier member",
    );
    require_(
      get(c, "powerAssumptions") === null,
      where + ".powerAssumptions is not defined for calibration",
    );
  }
  if (get(c, "libraryEntry") !== null) {
    const entry = c.libraryEntry;
    keys(
      entry,
      ["id", "version", "parameters", "overriddenParameters"],
      ["id"],
      where + ".libraryEntry",
    );
    require_(
      entry.id in LIBRARY,
      where + ".libraryEntry.id is not a library entry",
    );
  }
}

/**
 * Validates a new plan as written (section 9.1, schemas/statistics-plan.schema.json
 * and the section 3 bands) and returns it normalised. Derived plans come from
 * deriveHosted() and deriveEngine() instead.
 */
export function validatePlan(p: any): Plan {
  keys(p, PLAN_FIELDS, ["criteria"], "statistics");
  require_(
    get(p, "derivedFrom") === null,
    "statistics.derivedFrom is set only by legacy derivation",
  );
  require_(
    get(p, "configuredMinimums") === null,
    "statistics.configuredMinimums is set only by legacy derivation",
  );
  if ("minimums" in p) {
    keys(p.minimums, Object.keys(FLOORS), [], "statistics.minimums");
    for (const [key, value] of Object.entries(p.minimums))
      require_(
        integerIn(value, FLOORS[key as keyof Minimums], 1_000_000),
        `statistics.minimums.${key} must be an integer from ${FLOORS[key as keyof Minimums]} (the platform floor) to 1000000`,
      );
  }
  if ("bootstrap" in p) {
    keys(p.bootstrap, ["replicates"], [], "statistics.bootstrap");
    require_(
      integerIn(get(p.bootstrap, "replicates", 2000), 1000, 10000),
      "statistics.bootstrap.replicates must be an integer from 1000 to 10000",
    );
  }
  require_(
    integerIn(get(p, "calibrationBins", 10), 2, 100),
    "statistics.calibrationBins must be an integer from 2 to 100",
  );
  if ("power" in p) {
    keys(p.power, ["targetPower", "acknowledgement"], [], "statistics.power");
    const target = get(p.power, "targetPower", 0.8);
    require_(
      real(target) && 0.5 <= target && target <= 0.99,
      "statistics.power.targetPower must lie in [0.5, 0.99]",
    );
    const note = get(p.power, "acknowledgement");
    require_(
      note === null || textOf(note, 1, 5000),
      "statistics.power.acknowledgement must be null or text",
    );
  }
  const cluster = get(p, "clusterField");
  require_(
    cluster === null || textOf(cluster, 1, 300),
    "statistics.clusterField must be null or a column name",
  );
  const criteria = p.criteria;
  require_(
    Array.isArray(criteria) && criteria.length >= 1 && criteria.length <= 20,
    "statistics.criteria must hold 1 to 20 criteria",
  );
  criteria.forEach((c: any, index: number) =>
    validateCriterion(c, `statistics.criteria[${index}]`),
  );
  let plan: Plan;
  try {
    plan = normalizePlan(p);
  } catch (error) {
    if (error instanceof StatisticsError) throw error;
    throw new StatisticsError(
      "statistics plan is malformed: " + (error as Error).message,
    );
  }
  for (const c of plan.criteria) {
    const problem = criterionBandProblem(c);
    require_(problem === null, `criterion ${c.id}: ${problem}`);
  }
  return plan;
}
