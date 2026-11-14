// The hosted runner's decision path under statistics 1.0.0
// (docs/design/audit-statistics.md, step H2). lib/statistics.ts decides on
// counts; this module resolves the plan a run is decided by, turns validated
// prediction rows into the counts each criterion needs, and maps every
// evaluated criterion to a hosted 1.4 result (section 11.4, hosted names).
// It mirrors engine/criteria.py, so a hosted run and the engine report on
// the same rows carry the same decisions.
import type { Metric, Result } from "./domain/types";
import { humanLabel, valueLabel } from "./presentation";
import {
  LIBRARY,
  StatisticsError,
  clusterKey,
  codePointCompare,
  deriveHosted,
  evaluateCriteria,
  normalizePlan,
  validatePlan,
  type Band,
  type Confusion,
  type CriterionData,
  type Clustered,
  type CriterionResult,
  type GroupView,
  type Member,
  type Plan,
  type PlanCriterion,
  type PlanEvaluation,
} from "./statistics";

export type Rows = Record<string, string>[];
/** The column mappings and declared labels a run reads, whatever its profile version. */
export type HostedColumns = {
  labelColumn: string;
  predictionColumn: string;
  groupColumn: string;
  positiveLabel: string;
  performancePositiveLabel?: string;
  negativeLabel?: string;
};

const KIND_LABELS: Record<string, string> = {
  performance: "Binary classification performance",
  multiclass_performance: "Multiclass classification performance",
  regression_performance: "Regression performance",
};
const GROUP_LABELS: Record<string, string> = {
  selection_rate_difference: "Demographic parity",
  selection_rate_ratio: "Disparate impact",
  equalized_odds: "Equalized odds",
};
const UNITS: Record<string, string> = {
  mae: "target units",
  rmse: "target units",
  r2: "score",
  baseline_rmse: "target units",
  mse_reduction: "target units squared",
};
/** The hosted suite family of each criterion (section 11.2). */
export function criterionFamily(c: Pick<PlanCriterion, "kind" | "metric">) {
  if (c.kind === "performance" || c.kind === "multiclass_performance")
    return "performance";
  if (c.kind === "regression_performance") return "regression";
  return (
    {
      selection_rate_difference: "demographic_parity",
      selection_rate_ratio: "disparate_impact",
      equalized_odds: "equalized_odds",
    } as Record<string, string>
  )[c.metric!];
}
/** A plan's suite: the families its criteria use, in the hosted suite order. */
export function planSuite(plan: Pick<Plan, "criteria">) {
  const used = new Set(plan.criteria.map(criterionFamily));
  return [
    "performance",
    "regression",
    "demographic_parity",
    "disparate_impact",
    "equalized_odds",
  ].filter((family) => used.has(family));
}
const TASK_KINDS: Record<string, string[]> = {
  "Binary classification": ["performance", "group_comparison"],
  "Multiclass classification": ["multiclass_performance"],
  Regression: ["regression_performance"],
};

/** Plain-language limitation text for each reason code (section 4.4); the codes stay in decision.reasons. */
export const REASON_TEXT: Record<string, string> = {
  below_minimum_sample_size:
    "Fewer rows were evaluated than the pre-registered minimum sample size, so no claim is made either way.",
  undefined_zero_denominator:
    "A metric has a zero denominator (for example no predicted positives), so it is undefined and blocks a pass.",
  single_class:
    "A class is absent from the evaluated rows, so a class-conditional metric is undefined and blocks a pass.",
  below_minimum_class_count:
    "A class-conditional denominator is below the pre-registered minimum class count, so that metric cannot support a pass.",
  group_suppressed_below_minimum:
    "Groups below the minimum group size are suppressed: they are reported but never decide.",
  group_below_minimum_size:
    "A comparison involves a suppressed group and is reported descriptively.",
  insufficient_coverage:
    "The eligible groups cover less of the population than the pre-registered minimum coverage, so a pass is not possible.",
  empty_declared_group:
    "A pre-registered group has no rows, so there is no evidence for it and a pass is not possible.",
  insufficient_groups:
    "Fewer than two eligible groups (or no eligible reference group) remain, so no comparison can pass or fail.",
  too_many_groups:
    "The number of groups exceeds the limit for this comparison mode; per-group rates are reported without a decision.",
  small_cell_exact_test_not_significant:
    "A comparison has a cell under 5 and Fisher's exact test does not confirm the disparity, so the fail is not claimed.",
  chance_exact_test_not_significant:
    "The exact test of independence between predictions and truth is not significant, so performance above chance is not claimed.",
  mean_baseline_not_beaten:
    "The model's mean squared error is not shown to be below that of predicting the mean of the reference values on every row (the mean-prediction baseline), so a pass is not claimed.",
  interval_straddles_band:
    "The confidence interval straddles the acceptable band, so the evidence is inconclusive.",
  within_criterion_multiplicity:
    "A comparison is outside the band on its own, but not after the Bonferroni adjustment over the criterion's comparisons.",
  multiplicity_adjustment:
    "The claim does not survive the adjustment for the number of criteria in its family.",
  estimate_on_band_boundary:
    "An estimate lies exactly on a band bound, which supports no claim.",
  degenerate_interval:
    "The errors have zero variance, so no interval can be estimated.",
  no_threshold:
    "The plan sets no threshold that statistics 1.0.0 can decide, so every metric is descriptive and no conclusion is drawn.",
  undecidable_metric:
    "The plan depends on a metric that statistics 1.0.0 cannot decide by an interval, so a pass is not possible.",
  invalid_band:
    "The configured acceptance band is not a valid band for this metric, so the criterion cannot decide.",
  // Clustered designs (section 5.11): both runners decide them by the cluster bootstrap (#136).
  bootstrap_budget_exceeded:
    "The cluster bootstrap would exceed its budget of 50,000,000 cluster draws (replicates times clusters), so no bootstrap interval is reported and no member can decide.",
  bootstrap_insufficient_valid_replicates:
    "Fewer than 90% of the bootstrap replicates define the metric, so no bootstrap interval is reported and it cannot decide.",
  small_cell_clustered:
    "A comparison has a cell under 5 in a clustered design. Fisher's exact test assumes independent rows, so that comparison supports no claim.",
  below_minimum_cluster_count:
    "A metric or compared group has fewer than 10 independent clusters, so it cannot support a pass.",
  clustered_design_requires_engine:
    "The plan declares a cluster design that this runner cannot evaluate, so the criterion is inconclusive; the engine decides it by the cluster bootstrap.",
  interval_requires_engine:
    "The required interval needs score columns that this runner does not evaluate, so the criterion is inconclusive; the engine computes it.",
};
/** Section 5.11: the limitation every result of a clustered plan carries (engine/criteria.py CLUSTER_NOTE, without the engine-only supplementary entries). */
const clusterNote = (
  field: string,
  clusters: number,
  replicates: number,
  seed: number,
) =>
  `Rows are clustered by '${field}': every member and descriptive interval is a cluster percentile bootstrap over ${clusters} clusters (${replicates} replicates, seed ${seed}). The per-group rates are cluster percentile intervals too.`;
const BASE_NOTES: Record<string, string> = {
  performance:
    "Saved-prediction evaluation; no independent model inference, cross-validation or holdout verification. Performance is measured on supplied labels and predictions; independence, representativeness and target leakage require review.",
  multiclass_performance:
    "Saved-prediction evaluation; saved predictions do not establish cross-validation, dataset independence or freedom from leakage. Balanced accuracy is macro recall over the observed classes.",
  regression_performance:
    "Saved-prediction evaluation; saved predictions do not establish cross-validation, dataset independence or freedom from leakage. R² is descriptive and has no interval in the hosted runner. A pass also needs the model to beat the mean-prediction baseline (baseline_rmse).",
  group_comparison:
    "Group comparisons are not a causal finding of discrimination or a legal compliance verdict; intervals assume independent observations unless the plan declares a cluster design. Protected-data processing requires a separately reviewed basis.",
};

// ------------------------------------------------------------ plans
/** A legacy (schemaVersion 1.0) profile's configuration, from which the plan is derived per run. */
type LegacyConfig = HostedColumns & {
  minimumGroupSize: number;
  maximumParityGap: number;
  minimumImpactRatio: number;
  minimumAccuracy: number;
  minimumSampleSize?: number;
  minimumClassCount?: number;
  maximumOddsGap?: number;
  minimumRecall?: number;
  minimumMacroF1?: number;
  maximumRmse?: number;
};

/**
 * The plan that decides a hosted evaluation: the profile's stored plan
 * (schemaVersion 1.1), or the section 9.3 derivation of a legacy profile or
 * explicit configuration. A multiclass derivation reads k, the number of
 * labels in the target column, from the rows (GC-49).
 */
export function resolvePlan(
  task: string,
  suite: string[],
  config: HostedColumns | LegacyConfig,
  statistics: Plan | undefined,
  rows: Rows,
): Plan {
  if (statistics) return statistics;
  const data =
    task === "Multiclass classification" ? multiclassData(rows, config) : null;
  // Normalisation fills the defaults; a derived band, even an invalid one,
  // is kept and evaluates as invalid_band (section 3).
  return normalizePlan(deriveHosted({ task, suite, config }, data));
}

/**
 * Validates the explicit plan of a new (schemaVersion 1.1) hosted profile:
 * the section 9.1 rules, the hosted limits of section 12 (no score columns;
 * a group criterion may compare the intersectional strata of up to five
 * group columns, #30; a cluster design is decided by the cluster bootstrap,
 * as in the engine, #136), the task's criterion kinds,
 * and the chance baseline of the 6 November 2026 decision: an explicit
 * performance criterion carries balanced accuracy at or above chance unless
 * its rationale records why it is left out. A binary criterion without one
 * gets `balanced_accuracy >= 0.5` inserted; a multiclass baseline depends on
 * the number of classes, so the plan must state it.
 */
export function validateHostedPlan(task: string, input: unknown): Plan {
  const written = structuredClone(input) as {
    criteria?: Record<string, unknown>[];
  };
  for (const c of written?.criteria ?? []) {
    const members = c.members as { metric: string; band: Band }[] | undefined;
    if (!Array.isArray(members) || c.rationale) continue;
    const baseline = members.find((m) => m.metric === "balanced_accuracy");
    if (c.kind === "performance") {
      if (!baseline)
        c.members = [
          ...members,
          { metric: "balanced_accuracy", band: { lower: 0.5, upper: null } },
        ];
      else if ((baseline.band?.lower ?? 0) < 0.5)
        throw new StatisticsError(
          `criterion ${String(c.id)}: balanced accuracy below the chance baseline of 0.5 needs a rationale`,
        );
    } else if (c.kind === "multiclass_performance" && !baseline)
      throw new StatisticsError(
        `criterion ${String(c.id)}: add balanced accuracy (macro recall) at or above 1/k for your k classes, or record a rationale for leaving the chance baseline out`,
      );
  }
  const plan = validatePlan(written);
  for (const c of plan.criteria) {
    if (!(TASK_KINDS[task] ?? []).includes(c.kind))
      throw new StatisticsError(
        `criterion ${c.id}: ${c.kind} criteria are not available for ${task}`,
      );
  }
  return plan;
}

// ------------------------------------------------------------ counts
/** Intersectional strata above this many distinct labels are refused, as in the engine (MAX_GROUP_LABELS). */
export const MAX_STRATA = 1000;
/**
 * A row's stratum in `fields`, as engine/criteria.py `stratum`: one column
 * gives its value, several a compact JSON array of the values; null when a
 * value is blank (the row then counts in `unknownGroupRows`).
 */
export function stratumOf(row: Record<string, string>, fields: string[]) {
  const values = fields.map((f) => (row[f] ?? "").trim());
  if (values.some((v) => !v)) return null;
  return values.length === 1 ? values[0] : JSON.stringify(values);
}
/** Every column the plan's intersectional strata compare, in first-use order. */
export function planGroupFields(
  plan:
    | { criteria: Pick<PlanCriterion, "kind" | "groupFields">[] }
    | null
    | undefined,
) {
  return [
    ...new Set(
      (plan?.criteria ?? []).flatMap((c) =>
        c.kind === "group_comparison" ? (c.groupFields ?? []) : [],
      ),
    ),
  ];
}
/**
 * Checks the intersectional group columns of a plan against the rows: each
 * column exists, and each criterion has at most MAX_STRATA strata.
 */
export function assertGroupFields(plan: Plan, rows: Rows) {
  for (const criterion of plan.criteria) {
    const fields = criterion.groupFields;
    if (criterion.kind !== "group_comparison" || !fields) continue;
    for (const f of fields)
      if (rows.length && !(f in rows[0]))
        throw Error("Required column missing: " + f);
    const strata = new Set(rows.map((r) => stratumOf(r, fields)));
    strata.delete(null);
    if (strata.size > MAX_STRATA)
      throw Error(
        `Group comparisons are limited to ${MAX_STRATA} strata per criterion; revise the grouping protocol`,
      );
  }
}
const positiveOf = (c: HostedColumns) =>
  c.performancePositiveLabel || c.positiveLabel;

function confusion(rows: Rows, c: HostedColumns, positive: string): Confusion {
  const cm = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of rows) {
    const actual = r[c.labelColumn] === positive,
      predicted = r[c.predictionColumn] === positive;
    cm[actual && predicted ? "tp" : actual ? "fn" : predicted ? "fp" : "tn"]++;
  }
  return cm;
}

export function multiclassData(rows: Rows, c: HostedColumns) {
  const labels = [
    ...new Set(rows.flatMap((r) => [r[c.labelColumn], r[c.predictionColumn]])),
  ].sort(codePointCompare);
  const position = new Map(labels.map((label, i) => [label, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const r of rows)
    matrix[position.get(r[c.labelColumn])!][
      position.get(r[c.predictionColumn])!
    ]++;
  return { kind: "multiclass", labels, matrix };
}

/** The counts one criterion needs: performance counts its own positive class, group criteria the favourable label. */
function dataFor(rows: Rows, c: HostedColumns) {
  return (criterion: PlanCriterion): CriterionData => {
    if (criterion.kind === "performance")
      return {
        groups: [{ group: "all", ...confusion(rows, c, positiveOf(c)) }],
      };
    if (criterion.kind === "multiclass_performance")
      return multiclassData(rows, c);
    if (criterion.kind === "regression_performance") {
      const targets = rows.map((r) => Number(r[c.labelColumn]));
      return {
        errors: rows.map((r, i) => Number(r[c.predictionColumn]) - targets[i]),
        targets,
      };
    }
    // One group column keeps today's grouping by the validated cell; the
    // strata of several columns follow the engine, blank values unknown.
    const fields = criterion.groupFields;
    const byGroup = new Map<string, Rows>();
    let unknown = 0;
    for (const r of rows) {
      const group = fields ? stratumOf(r, fields) : r[c.groupColumn];
      if (group === null) {
        unknown++;
        continue;
      }
      const members = byGroup.get(group);
      if (members) members.push(r);
      else byGroup.set(group, [r]);
    }
    return {
      groups: [...byGroup.keys()].sort(codePointCompare).map((group) => ({
        group,
        ...confusion(byGroup.get(group)!, c, c.positiveLabel),
      })),
      unknownGroupRows: unknown,
    };
  };
}

// ------------------------------------------------------------ results
const single = (m: Member) =>
  m.interval?.method === "wilson" &&
  m.counts !== null &&
  Object.keys(m.counts).sort().join() === "n,x";

function entryMetric(
  m: Member,
  role: "member" | "descriptive",
  sampleSize: number,
): Metric {
  return {
    name: m.memberId,
    value: m.estimate,
    unit: UNITS[m.metric] ?? "ratio",
    sampleSize,
    numerator: single(m) ? (m.counts!.x as number) : null,
    denominator: single(m) ? (m.counts!.n as number) : null,
    threshold: null,
    confidenceInterval: m.interval,
    slices: [],
    details: {
      role,
      metric: m.metric,
      subject: m.subject,
      comparator: m.comparator,
      counts: m.counts,
      band: m.band,
      status: m.status,
      direction: m.direction,
      smallCell: m.smallCell,
      fisherExactP: m.fisherExactP,
      chanceExactP: m.chanceExactP,
      reasons: [...m.reasons],
      ...(m.bootstrap ? { bootstrap: { ...m.bootstrap } } : {}),
    },
    pValue: m.pValue,
  };
}

function slice(g: GroupView) {
  const out: Record<string, unknown> = {
    slice: g.group,
    n: g.n,
    declared: g.declared,
    suppressed: g.suppressed,
  };
  for (const key of ["selection", "tpr", "fpr"] as const) {
    const rate = g[key];
    if (rate)
      Object.assign(out, {
        [`${key}Numerator`]: rate.x,
        [`${key}Denominator`]: rate.n,
        [key === "selection" ? "selectionRate" : key]: rate.estimate,
        [`${key}ConfidenceInterval`]: rate.interval,
      });
  }
  return out;
}

/** A number to `digits` significant digits without trailing zeros (Python's `{:.4g}` for ordinary magnitudes). */
const short = (v: number, digits: number) =>
  String(Number(v.toPrecision(digits)));

/** Section 5.9: when the mean baseline gate stops a regression pass, name the model's RMSE and the baseline's (engine/criteria.py baseline_note). */
export function baselineNote(outcome: CriterionResult): string[] {
  if (!outcome.decision.reasons.includes("mean_baseline_not_beaten")) return [];
  const entries = new Map(
    [...outcome.members, ...outcome.descriptive].map((e) => [e.metric, e]),
  );
  const rmse = entries.get("rmse"),
    base = entries.get("baseline_rmse");
  if (rmse?.estimate == null || base?.estimate == null) return [];
  const gate = (base.counts as { gatePValue: number }).gatePValue;
  return [
    `RMSE ${short(rmse.estimate, 4)} does not beat the mean-prediction baseline RMSE ${short(base.estimate, 4)} (gate p ${short(gate, 3)}): the model is not shown to predict better than the mean of the reference values.`,
  ];
}

/**
 * Section 5.11: a clustered plan's data, one object per cluster in clusterKey
 * order. Every evaluated row needs a cluster id (trimmed, as the engine reads
 * cells); a blank one rejects the run.
 */
export function clusteredData(
  field: string,
  rows: Rows,
  c: HostedColumns,
  seed: number,
): Clustered {
  if (rows.length && !(field in rows[0]))
    throw Error("Required column missing: " + field);
  const byCluster = new Map<string, Rows>();
  for (const r of rows) {
    const id = (r[field] ?? "").trim();
    if (!id)
      throw Error(
        `Every evaluated row needs a cluster id in column '${field}' (statistics.clusterField)`,
      );
    const members = byCluster.get(id);
    if (members) members.push(r);
    else byCluster.set(id, [r]);
  }
  const ids = [...byCluster.keys()].sort((a, b) =>
    codePointCompare(clusterKey(a), clusterKey(b)),
  );
  const readers = ids.map((id) => dataFor(byCluster.get(id)!, c));
  return {
    ids,
    partsFor: (criterion) => readers.map((read) => read(criterion)),
    seed,
  };
}

/** Maps one evaluated criterion to a hosted 1.4 result (section 11.4). */
export function criterionResult(
  spec: PlanCriterion,
  outcome: CriterionResult,
  notes: string[] = [],
): Result {
  const decision = outcome.decision;
  const sampleSize = decision.sampleSize;
  const metrics: Metric[] = [];
  if (spec.kind === "group_comparison") {
    const h = outcome.headline;
    metrics.push({
      name: {
        selection_rate_difference: "maximum_selection_rate_gap",
        selection_rate_ratio: "minimum_selection_rate_ratio",
        equalized_odds: "maximum_tpr_fpr_gap",
      }[spec.metric as "equalized_odds"],
      value: h ? h.estimate : null,
      unit: "ratio",
      sampleSize,
      numerator: null,
      denominator: null,
      threshold: null,
      confidenceInterval: h ? h.interval : null,
      slices: outcome.groups!.map(slice),
      details: {
        role: "headline",
        metric: spec.metric!,
        subject: null,
        comparator: null,
        counts: null,
        band: h ? h.band : null,
        status: h ? "evaluated" : "undefined",
        direction: decision.direction,
        smallCell: false,
        fisherExactP: null,
        chanceExactP: null,
        reasons: [],
      },
      pValue: null,
    });
  }
  for (const m of outcome.members)
    metrics.push(entryMetric(m, "member", sampleSize));
  for (const m of outcome.descriptive)
    metrics.push(entryMetric(m, "descriptive", sampleSize));
  const limitations = [
    BASE_NOTES[spec.kind],
    ...notes,
    ...decision.reasons.flatMap((r) =>
      r in REASON_TEXT ? [REASON_TEXT[r]] : [],
    ),
    ...baselineNote(outcome),
  ];
  if (decision.libraryEntry)
    limitations.push(
      `${decision.libraryEntry.legalStatus}: ${decision.libraryEntry.caveat}`,
    );
  return {
    testId: spec.id,
    label: KIND_LABELS[spec.kind] ?? GROUP_LABELS[spec.metric!],
    article: spec.kind === "group_comparison" ? "10" : "15",
    outcome: outcome.outcome!,
    metrics,
    limitations: [...new Set(limitations)],
    decision,
  };
}

/** Labels the prediction column uses that the reference column never does. */
function unexpectedPredictions(rows: Rows, c: HostedColumns) {
  const reference = new Set(rows.map((r) => r[c.labelColumn])),
    counts = new Map<string, number>();
  for (const r of rows)
    if (!reference.has(r[c.predictionColumn]))
      counts.set(
        r[c.predictionColumn],
        (counts.get(r[c.predictionColumn]) ?? 0) + 1,
      );
  return counts.size
    ? [
        "Predicted labels absent from the reference column: " +
          [...counts]
            .sort(([a], [b]) => codePointCompare(a, b))
            .map(([value, n]) => `'${value}' (${n} rows)`)
            .join(", ") +
          ". They count as errors, and the class without reference rows leaves macro recall undefined.",
      ]
    : [];
}

export type HostedEvaluation = {
  results: Result[];
  evaluation: PlanEvaluation;
};

/** Evaluates a normalised plan on validated rows and maps each criterion to a result. */
export function evaluateHostedPlan(
  plan: Plan,
  rows: Rows,
  c: HostedColumns,
  task: string,
  seed = 42,
): HostedEvaluation {
  assertGroupFields(plan, rows);
  const clustered =
    plan.clusterField === null
      ? undefined
      : clusteredData(plan.clusterField, rows, c, seed);
  const evaluation = evaluateCriteria(plan, dataFor(rows, c), clustered);
  const unexpected =
    task === "Multiclass classification" ? unexpectedPredictions(rows, c) : [];
  const results = plan.criteria.map((spec, i) => {
    const notes: string[] = [];
    if (spec.kind === "performance") {
      const positive = positiveOf(c);
      notes.push(
        `Recall, precision and F1 refer to the performance positive class '${positive}'; specificity is the recall of the other class.`,
      );
      if (positive !== c.positiveLabel)
        notes.push(
          `Fairness criteria count the favourable outcome '${c.positiveLabel}', not the performance positive class.`,
        );
    }
    if (spec.kind === "multiclass_performance") notes.push(...unexpected);
    if (clustered)
      notes.push(
        clusterNote(
          plan.clusterField!,
          clustered.ids.length,
          plan.bootstrap.replicates,
          seed,
        ),
      );
    return criterionResult(spec, evaluation.criteria[i], notes);
  });
  return { results, evaluation };
}

// ------------------------------------------------------------ plain language
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const pp = (v: number) => `${Math.round(v * 1000) / 10} points`;

/**
 * One sentence per result that says what the interval means for the
 * decision, for example "With 20 people per group, this test cannot tell a
 * 10-point gap from noise."
 */
export function explainResult(result: Result): string {
  const d = result.decision;
  if (!d) return "";
  const level = Math.round(d.confidenceLevel * 100) + "%";
  const headline = result.metrics.find(
    (m) => (m.details as { role?: string })?.role === "headline",
  );
  if (d.reasons.includes("below_minimum_sample_size"))
    return `Only ${d.sampleSize} rows were evaluated, fewer than the pre-registered minimum, so this test makes no claim.`;
  if (d.reasons.includes("no_threshold"))
    return "No acceptance band was pre-registered, so the figures are descriptive only.";
  if (headline) {
    const slices = (headline.slices ?? []) as {
      n: number;
      suppressed: boolean;
    }[];
    const eligible = slices.filter((s) => !s.suppressed);
    const smallest = eligible.length
      ? Math.min(...eligible.map((s) => s.n))
      : 0;
    const band = (headline.details as { band: Band | null }).band;
    const ci = headline.confidenceInterval;
    if (!ci || !band) return "Too few eligible groups remain to compare.";
    const ratio = headline.name === "minimum_selection_rate_ratio";
    const limit = ratio ? band.lower! : band.upper!;
    const show = ratio ? (v: number) => v.toFixed(2) : pp;
    if (result.outcome === "inconclusive")
      return `With ${smallest} people in the smallest compared group, the ${level} interval runs from ${show(ci.lower)} to ${show(ci.upper)}, so this test cannot tell whether the ${ratio ? "ratio" : "gap"} is within ${show(limit)} or beyond it.`;
    if (result.outcome === "pass")
      return `Across groups of at least ${smallest} people, the whole ${level} interval (${show(ci.lower)} to ${show(ci.upper)}) lies within the band of ${show(limit)}.`;
    return `The whole ${level} interval (${show(ci.lower)} to ${show(ci.upper)}) lies beyond the band of ${show(limit)}: the disparity is larger than noise would explain.`;
  }
  if (
    result.outcome !== "fail" &&
    d.reasons.includes("mean_baseline_not_beaten")
  ) {
    const value = (name: string) =>
      result.metrics.find((m) => m.name === name)?.value;
    const rmse = value("rmse"),
      base = value("baseline_rmse");
    return typeof rmse === "number" && typeof base === "number"
      ? `RMSE ${short(rmse, 3)} is not shown to beat ${short(base, 3)}, the RMSE of predicting the mean of the reference values on every row, so the model is not shown to be better than a constant prediction.`
      : "The model is not shown to beat predicting the mean of the reference values on every row, so no pass is claimed.";
  }
  // Without a deciding member (an open criterion), the sentence names the
  // first member not shown inside its band, the one that keeps the outcome
  // open, never a member whose interval already settles (#233).
  const members = result.metrics.filter(
      (m) => (m.details as { role?: string })?.role === "member",
    ),
    settled = (m: (typeof members)[number]) => {
      const x = m.details as { status?: string; direction?: string };
      return x.status === "evaluated" && x.direction === "pass";
    };
  const deciding =
    result.metrics.find((m) => m.name === d.decidingMemberId) ??
    (result.outcome === "pass"
      ? undefined
      : members.find((m) => !settled(m))) ??
    members[0];
  if (!deciding?.confidenceInterval)
    return "A deciding metric is undefined on these rows, so no claim is made.";
  const { lower, upper } = deciding.confidenceInterval;
  const share = deciding.unit === "ratio";
  const show = share ? pct : (v: number) => v.toPrecision(3);
  const name = deciding.name.replaceAll("_", " ");
  if (result.outcome === "pass")
    return `Every pre-registered metric's ${level} interval lies inside its band; the closest call is ${name}, ${show(lower)} to ${show(upper)}.`;
  if (result.outcome === "fail")
    return `The ${level} interval for ${name} (${show(lower)} to ${show(upper)}) lies wholly outside its band.`;
  return `The ${level} interval for ${name} runs from ${show(lower)} to ${show(upper)} on ${deciding.denominator ?? d.sampleSize} rows, so the evidence cannot settle the criterion.`;
}

const METRIC_NAMES: Record<string, string> = {
  accuracy: "accuracy",
  precision: "precision",
  recall: "recall",
  specificity: "specificity",
  false_positive_rate: "false positive rate",
  balanced_accuracy: "balanced accuracy",
  f1: "F1",
  macro_precision: "macro precision",
  macro_f1: "macro F1",
  mae: "MAE",
  rmse: "RMSE",
  baseline_rmse: "mean-prediction baseline RMSE",
  mse_reduction: "MSE reduction over the mean-prediction baseline",
  selection_rate_difference: "selection-rate difference",
  selection_rate_ratio: "selection-rate ratio",
  equalized_odds: "TPR and FPR differences",
};
const num = (v: number) => String(Math.round(v * 10000) / 10000);
/** A band in words, for example "≥ 0.8" or "within ±0.1". */
export function bandText(metric: string, band: Band | null | undefined) {
  if (!band) return "no band";
  const { lower, upper } = band;
  if (lower !== null && upper !== null)
    return metric === "selection_rate_ratio"
      ? `within [${num(lower)}, ${num(upper)}]`
      : lower === -upper
        ? `within ±${num(upper)}`
        : `within [${num(lower)}, ${num(upper)}]`;
  return lower !== null ? `≥ ${num(lower)}` : `≤ ${num(upper!)}`;
}
/** One line per criterion of a plan, for the protocol summary and working papers. */
export function describePlan(plan: Plan) {
  const level = Math.round(plan.confidenceLevel * 100);
  const lines = plan.criteria.map((c) => {
    const terms =
      c.kind === "group_comparison"
        ? [
            `${METRIC_NAMES[c.metric!]} ${bandText(c.metric!, c.band)} (${c.comparison!.mode === "reference" ? `against ${c.comparison!.referenceGroup}` : "every pair of groups"}${c.minimumCoverage !== 1 ? `, coverage ≥ ${c.minimumCoverage}` : ""})`,
          ]
        : c.members!.map(
            (m) =>
              `${METRIC_NAMES[m.metric] ?? m.metric} ${bandText(m.metric, m.band)}`,
          );
    const library = c.libraryEntry ? LIBRARY[c.libraryEntry.id] : null;
    return (
      // The criterion and its role by their labels (#234 item 6).
      `${humanLabel(c.id)}: ${terms.join(", ") || "no threshold"} [${valueLabel(c.role)}]` +
      (library
        ? ` — ${c.libraryEntry!.id}@${c.libraryEntry!.version} (${library.legalStatus.replaceAll("_", " ")})`
        : "")
    );
  });
  return [
    ...lines,
    `${level}% intervals decide; Bonferroni over the confirmatory criteria, Benjamini–Hochberg over exploratory ones; minimums ${plan.minimums.sampleSize} rows, ${plan.minimums.groupSize} per group, ${plan.minimums.classCount} per class` +
      (plan.configuredMinimums
        ? ` (configured ${plan.configuredMinimums.sampleSize}/${plan.configuredMinimums.groupSize}/${plan.configuredMinimums.classCount}, raised to the floors)`
        : ""),
  ];
}

// ------------------------------------------------------------ the protocol form's plan (step H3)
/** What the protocol form adds to the legacy threshold fields to pre-register a plan. */
export type PlanForm = {
  confidenceLevel: 0.9 | 0.95 | 0.99;
  /** The library entry the disparate-impact band comes from. */
  impactBasis: "policy.eu-aia.impact-ratio" | "screen.us.four-fifths";
  /** Share of rows the eligible groups must cover for a pass (0.5 to 1). */
  minimumCoverage: number;
  /** Why coverage below 1 is acceptable; required when it is. */
  coverageRationale: string;
  /** Planning assumptions per criterion id (section 8), entered by the auditor. */
  powerAssumptions: Record<string, unknown>;
  /** The recorded acknowledgement of a power shortfall (section 8). */
  acknowledgement: string;
};
export const defaultPlanForm: PlanForm = {
  confidenceLevel: 0.95,
  impactBasis: "policy.eu-aia.impact-ratio",
  minimumCoverage: 1,
  coverageRationale: "",
  powerAssumptions: {},
  acknowledgement: "",
};
type FormThresholds = {
  minimumGroupSize: number;
  maximumParityGap: number;
  minimumImpactRatio: number;
  minimumAccuracy: number;
  minimumSampleSize?: number;
  minimumClassCount?: number;
  maximumOddsGap?: number;
  minimumRecall?: number;
  minimumMacroF1?: number;
  maximumRmse?: number;
};
const inRange = (entry: string, name: string, value: number) => {
  const rule = LIBRARY[entry].parameters[name];
  return rule.minimum! <= value && value <= rule.maximum!;
};

/**
 * The explicit plan a protocol form pre-registers. Binary performance carries
 * the chance baseline balanced accuracy >= 0.5, multiclass performance
 * macro recall >= 1/k for the k classes of the reference column, and each
 * group band comes from its threshold-library entry when the value lies in
 * the entry's range, so every result shows the entry's legal status.
 */
export function planFromForm(
  task: string,
  suite: string[],
  t: FormThresholds,
  form: PlanForm,
  classCount: number | null,
) {
  const coverage =
    form.minimumCoverage < 1
      ? {
          minimumCoverage: form.minimumCoverage,
          rationale: form.coverageRationale.trim() || null,
        }
      : {};
  const assumptions = (id: string) =>
    form.powerAssumptions[id]
      ? { powerAssumptions: form.powerAssumptions[id] }
      : {};
  const criteria: Record<string, unknown>[] = [];
  for (const test of suite) {
    if (test === "performance" && task === "Binary classification")
      criteria.push({
        id: "performance",
        kind: "performance",
        members: [
          {
            metric: "accuracy",
            band: { lower: t.minimumAccuracy, upper: null },
          },
          {
            metric: "recall",
            band: { lower: t.minimumRecall ?? 0.7, upper: null },
          },
          { metric: "balanced_accuracy", band: { lower: 0.5, upper: null } },
        ],
        ...assumptions("performance"),
      });
    else if (test === "performance")
      criteria.push({
        id: "performance",
        kind: "multiclass_performance",
        members: [
          {
            metric: "accuracy",
            band: { lower: t.minimumAccuracy, upper: null },
          },
          ...(classCount
            ? [
                {
                  metric: "balanced_accuracy",
                  band: { lower: 1 / Math.max(2, classCount), upper: null },
                },
              ]
            : []),
          {
            metric: "macro_f1",
            band: { lower: t.minimumMacroF1 ?? 0.7, upper: null },
          },
        ],
        ...assumptions("performance"),
      });
    else if (test === "regression")
      criteria.push({
        id: "regression",
        kind: "regression_performance",
        members: [
          { metric: "rmse", band: { lower: null, upper: t.maximumRmse ?? 1 } },
        ],
        ...assumptions("regression"),
      });
    else {
      const [metric, entry, name, value] = (
        {
          demographic_parity: [
            "selection_rate_difference",
            "policy.eu-aia.selection-rate-difference",
            "delta",
            t.maximumParityGap,
          ],
          disparate_impact: [
            "selection_rate_ratio",
            form.impactBasis,
            "tau",
            t.minimumImpactRatio,
          ],
          equalized_odds: [
            "equalized_odds",
            "policy.eu-aia.equalized-odds",
            "delta",
            t.maximumOddsGap ?? t.maximumParityGap,
          ],
        } as Record<string, [string, string, string, number]>
      )[test];
      const band =
        metric === "selection_rate_ratio"
          ? { lower: value, upper: 1 / value }
          : { lower: -value, upper: value };
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric,
        band,
        ...(inRange(entry, name, value)
          ? {
              libraryEntry: {
                id: entry,
                version: 1,
                parameters: { [name]: value },
              },
            }
          : {}),
        ...coverage,
        ...assumptions(test),
      });
    }
  }
  return {
    confidenceLevel: form.confidenceLevel,
    minimums: {
      sampleSize: t.minimumSampleSize ?? 30,
      groupSize: t.minimumGroupSize,
      classCount: t.minimumClassCount ?? 10,
    },
    power: {
      targetPower: 0.8,
      acknowledgement: form.acknowledgement.trim() || null,
    },
    criteria,
  };
}

/** The form fields of a stored plan made by planFromForm, to start a revised protocol version from it. */
export function formFromPlan(plan: Plan): {
  thresholds: Partial<FormThresholds>;
  form: PlanForm;
} {
  const thresholds: Partial<FormThresholds> = {
    minimumSampleSize: plan.minimums.sampleSize,
    minimumGroupSize: plan.minimums.groupSize,
    minimumClassCount: plan.minimums.classCount,
  };
  const form: PlanForm = {
    ...defaultPlanForm,
    confidenceLevel: plan.confidenceLevel as PlanForm["confidenceLevel"],
    powerAssumptions: {},
  };
  for (const c of plan.criteria) {
    if (c.powerAssumptions) form.powerAssumptions[c.id] = c.powerAssumptions;
    for (const m of c.members ?? []) {
      if (m.metric === "accuracy") thresholds.minimumAccuracy = m.band.lower!;
      if (m.metric === "recall") thresholds.minimumRecall = m.band.lower!;
      if (m.metric === "macro_f1") thresholds.minimumMacroF1 = m.band.lower!;
      if (m.metric === "rmse") thresholds.maximumRmse = m.band.upper!;
    }
    if (c.kind !== "group_comparison" || !c.band) continue;
    if (c.minimumCoverage !== undefined && c.minimumCoverage < 1) {
      form.minimumCoverage = c.minimumCoverage;
      form.coverageRationale = c.rationale ?? "";
    }
    if (c.metric === "selection_rate_difference")
      thresholds.maximumParityGap = c.band.upper!;
    if (c.metric === "equalized_odds")
      thresholds.maximumOddsGap = c.band.upper!;
    if (c.metric === "selection_rate_ratio") {
      thresholds.minimumImpactRatio = c.band.lower!;
      if (c.libraryEntry?.id === "screen.us.four-fifths")
        form.impactBasis = "screen.us.four-fifths";
    }
  }
  form.acknowledgement = plan.power.acknowledgement ?? "";
  return { thresholds, form };
}

/**
 * The criteria a frozen external request asks for, in order (section 11.2):
 * an engineConfig 1.4 request's plan, or for 1.1 the derived plan's
 * criteria, whose ids are the suite names.
 */
export function requestedCriteria(frozen: {
  profile: { suite: string[]; task?: string };
  engineConfig: { task?: string; statistics?: Pick<Plan, "criteria"> };
}): { id: string; kind: string }[] {
  if (frozen.engineConfig.statistics)
    return frozen.engineConfig.statistics.criteria.map((c) => ({
      id: c.id,
      kind: c.kind,
    }));
  const task = frozen.engineConfig.task ?? frozen.profile.task;
  return frozen.profile.suite.map((id) => ({
    id,
    kind:
      id === "performance"
        ? task === "Multiclass classification"
          ? "multiclass_performance"
          : "performance"
        : id === "regression"
          ? "regression_performance"
          : "group_comparison",
  }));
}
