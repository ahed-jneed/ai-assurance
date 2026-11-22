// Audit statistics core: statistics specification 1.0.0
// (docs/design/audit-statistics.md), the hosted runner's port of
// engine/statistics.py.
//
// The interval decides, never the point estimate: a criterion passes only
// when its interval lies inside the pre-registered band, fails only when it
// lies outside, and is inconclusive otherwise (section 4). Confirmatory
// criteria are adjusted with Bonferroni and exploratory criteria with
// Benjamini-Hochberg (section 6). schemas/fixtures/statistics-golden.json is
// the arbiter: lib/statistics.test.ts runs every case through this module,
// and the engine runs the same cases, so both runners decide alike.
//
// Every function mirrors its Python namesake line for line, including the
// order of members, reasons and keys, so a difference between the runners
// is a bug in one of them. Functions work on counts; lib/diagnostics.ts
// turns rows into counts and results.

/* eslint-disable @typescript-eslint/no-explicit-any -- plans and legacy
   configurations are untyped JSON validated here, as in the Python core. */

import { PythonRandom } from "./python-random";
import {
  StatisticsError,
  require_,
  SPEC_VERSION,
  FLOORS,
  type Minimums,
  EPS,
  POWER_SEARCH_LIMIT,
  BINARY_DESCRIPTIVE,
  MULTICLASS_METRICS,
  REGRESSION_DESCRIPTIVE,
  PERFORMANCE_KINDS,
  BASELINE_TOLERANCE,
  RATE_KEYS,
  HEADLINE_NAMES,
  get,
} from "./statistics/core";
import {
  SQRT2,
  erfc,
  normalQuantile,
  zcrit,
  codePointCompare,
  byCodePoint,
  phi,
  sum,
  fsum,
  tupleMin,
} from "./statistics/numerics";
import {
  type Interval,
  wilson,
  katz,
  koopman,
  ratioMethod,
  f1FromJ,
  perClassZ,
} from "./statistics/intervals";
import {
  type Band,
  type Direction,
  bound,
  directionOf,
  squareBand,
  jaccardBand,
  logBand,
} from "./statistics/pvalues";
import { bonferroni, benjaminiHochberg } from "./statistics/exact-tests";
import { jcs, planSha256 } from "./statistics/plan-hash";
import {
  LIBRARY,
  type PlanCriterion,
  type Plan,
  normalizeCriterion,
} from "./statistics/plan";
import { criterionBandProblem } from "./statistics/plan-validation";
import {
  memberId,
  type CriterionInterval,
  type Member,
  statEntry,
} from "./statistics/members";
import {
  type Confusion,
  binaryStat,
  type MulticlassData,
  multiclassStat,
  type RegressionData,
  regressionStat,
  meanBaseline,
} from "./statistics/metric-stats";
import {
  type GroupData,
  rateCounts,
  type RateEntry,
  groupRows,
  type Coverage,
  type GroupView,
  type Context,
  type CriterionData,
  groupMembers,
} from "./statistics/group-comparisons";

export {
  StatisticsError,
  SPEC_VERSION,
  FLOORS,
  EPS,
  BINARY_METRICS,
  MULTICLASS_METRICS,
  REGRESSION_METRICS,
  PERFORMANCE_KINDS,
  HEADLINE_NAMES,
} from "./statistics/core";
export {
  erfc,
  normalQuantile,
  zcrit,
  pFromZ,
  codePointCompare,
  phi,
  fsum,
} from "./statistics/numerics";
export {
  wilson,
  newcombe,
  katz,
  koopman,
  ratioMethod,
} from "./statistics/intervals";
export { invert, wilsonZstar } from "./statistics/pvalues";
export type { Band } from "./statistics/pvalues";
export {
  fisherTwoSided,
  fisherGreater,
  bonferroni,
  benjaminiHochberg,
} from "./statistics/exact-tests";
export { jcs, sha256Hex, planSha256 } from "./statistics/plan-hash";
export {
  THRESHOLD_LIBRARY,
  LIBRARY,
  normalizeCriterion,
  normalizePlan,
} from "./statistics/plan";
export type {
  LibraryEntry,
  LibraryRecord,
  PlanMember,
  PlanCriterion,
  Plan,
} from "./statistics/plan";
export {
  ID_PATTERN,
  bandProblem,
  criterionBandProblem,
  validatePlan,
} from "./statistics/plan-validation";
export {
  chanceLevel,
  deriveHosted,
  deriveEngine,
  planFor,
} from "./statistics/plan-legacy";
export { memberId } from "./statistics/members";
export type { CriterionInterval, Member } from "./statistics/members";
export type {
  Confusion,
  MulticlassData,
  RegressionData,
} from "./statistics/metric-stats";
export type {
  GroupData,
  RateEntry,
  Coverage,
  GroupView,
  CriterionData,
} from "./statistics/group-comparisons";

// ------------------------------------------------------------ criteria and plans
export type Headline = {
  names: { engine: string; hosted: string | null };
  estimate: number;
  interval: CriterionInterval;
  band: Band;
};

function headline(
  members: Member[],
  context: Context,
  level: number,
): Headline | null {
  const alpha = 1.0 - level;
  const pool = members.filter((m) => m.status !== "suppressed");
  const evaluable = pool.filter((m) => m.status === "evaluated");
  if (!evaluable.length || context.headlineMetric === undefined) return null;
  const band = evaluable[0].band!;
  const log = context.scale === "log";
  const tr = log
    ? (v: number) => (v > 0 ? Math.log(v) : -Infinity)
    : (v: number) => v;
  const lower = band.lower,
    upper = band.upper;
  const zNom = zcrit(level),
    zBon = zcrit(1.0 - alpha / evaluable.length);
  const complete = pool.every((m) => m.status === "evaluated");
  const names = HEADLINE_NAMES[context.headlineMetric];
  const dev = (m: Member, z: number): Interval => {
    const [lo, hi] = m._ciAt!(z);
    return [tr(lo), tr(hi)];
  };
  const out = (
    value: number,
    lo: number,
    hi: number,
    headlineBand: Band,
  ): Headline => ({
    names,
    estimate: value,
    interval: { lower: lo, upper: hi, level, method: "worst_member_bounds" },
    band: headlineBand,
  });
  // A pass-side bound that cannot be computed (some pool member is not
  // evaluated) is reported as the statistic's natural limit: 1 for a gap,
  // 0 for a ratio.
  if (lower !== null && upper !== null) {
    const absBounds = ([lo, hi]: Interval): Interval => [
      Math.max(0.0, lo, -hi),
      Math.max(Math.abs(lo), Math.abs(hi)),
    ];
    const value = Math.max(...evaluable.map((m) => Math.abs(tr(m.estimate!))));
    const failSide = Math.max(
      ...evaluable.map((m) => absBounds(dev(m, zBon))[0]),
    );
    const passSide = complete
      ? Math.max(...evaluable.map((m) => absBounds(dev(m, zNom))[1]))
      : Infinity;
    if (log)
      return out(Math.exp(-value), Math.exp(-passSide), Math.exp(-failSide), {
        lower,
        upper: null,
      });
    return out(value, failSide, Math.min(passSide, 1.0), {
      lower: null,
      upper,
    });
  }
  if (log) {
    // One-sided ratio band {lower: tau} (reference mode): the smallest ratio.
    const value = Math.min(...evaluable.map((m) => tr(m.estimate!)));
    const passSide = complete
      ? Math.min(...evaluable.map((m) => dev(m, zNom)[0]))
      : -Infinity;
    const failSide = Math.min(...evaluable.map((m) => dev(m, zBon)[1]));
    return out(Math.exp(value), Math.exp(passSide), Math.exp(failSide), {
      lower,
      upper: null,
    });
  }
  // One-sided difference band (reference mode): the largest gap in the
  // constrained direction, so the headline band is always {upper: delta}.
  const sign = lower !== null ? -1.0 : 1.0;
  const gap = (m: Member, z: number): Interval => {
    const [lo, hi] = m._ciAt!(z);
    return sign > 0 ? [lo, hi] : [-hi, -lo];
  };
  const value = Math.max(...evaluable.map((m) => sign * m.estimate!));
  const failSide = Math.max(...evaluable.map((m) => gap(m, zBon)[0]));
  const passSide = complete
    ? Math.max(...evaluable.map((m) => gap(m, zNom)[1]))
    : 1.0;
  return out(value, failSide, Math.min(passSide, 1.0), {
    lower: null,
    upper: sign > 0 ? upper : -lower!,
  });
}

export type LibraryView = {
  id: string;
  version: number;
  legalStatus: string;
  caveat: string;
};
function libraryView(entry: PlanCriterion["libraryEntry"]): LibraryView | null {
  if (entry === null) return null;
  const spec = LIBRARY[entry.id];
  return {
    id: entry.id,
    version: entry.version,
    legalStatus: spec.legalStatus,
    caveat: spec.caveat,
  };
}

export type Decision = {
  statisticsVersion: string;
  confidenceLevel: number;
  role: "confirmatory" | "exploratory";
  kind: string;
  direction: Direction;
  pValue: number;
  adjustedPValue: number | null;
  adjustment: "bonferroni" | "benjamini_hochberg" | null;
  familySize: number | null;
  unadjustedOutcome: "pass" | "fail" | "inconclusive";
  decidingMemberId: string | null;
  sampleSize: number;
  coverage: Coverage | null;
  /** n is null in a run on a client-held dataset, which withholds groups below the minimum (#102). */
  suppressedGroups: { group: string; n: number | null }[] | null;
  libraryEntry: LibraryView | null;
  reasons: string[];
};
export type CriterionResult = {
  id: string;
  outcome: "pass" | "fail" | "inconclusive" | null;
  headline: Headline | null;
  members: Member[];
  descriptive: Member[];
  groups: GroupView[] | null;
  decision: Decision;
};

export function evaluateCriterion(
  spec: PlanCriterion,
  data: CriterionData,
  level: number,
  mins: Minimums,
  derived = false,
): CriterionResult {
  return decideCriterion(
    buildCriterion(spec, data, level, mins, derived),
    level,
    mins,
  );
}

/** One criterion's members, descriptive entries and gates before its decision (section 4.3). */
type CriterionState = {
  spec: PlanCriterion;
  kind: string;
  members: Member[];
  descriptive: Member[];
  groups: GroupView[] | null;
  context: Context;
  invalidBand: boolean;
};

/**
 * Builds a criterion's entries; the cluster bootstrap (section 5.11) replaces
 * the members' intervals and p-values between this step and the decision.
 */
function buildCriterion(
  spec: PlanCriterion,
  data: CriterionData,
  level: number,
  mins: Minimums,
  derived = false,
): CriterionState {
  const kind = spec.kind;
  // Section 3: a derived legacy plan keeps a band the table rejects; that
  // criterion is inconclusive (invalid_band).
  const invalidBand = derived && criterionBandProblem(spec) !== null;
  if (invalidBand) spec = { ...spec, _decide: false };
  const decide = !invalidBand;
  let descriptive: Member[] = [],
    groups: GroupView[] | null = null,
    members: Member[],
    context: Context;
  if (kind === "performance") {
    const cm = Object.fromEntries(
      (["tp", "fp", "fn", "tn"] as const).map((k) => [
        k,
        sum(data.groups!.map((g) => (g as Confusion)[k])) +
          (data.unknownGroup?.[k] ?? 0),
      ]),
    ) as Confusion;
    const planned = spec.members!.map((item) => item.metric);
    members = spec.members!.map((item) =>
      statEntry(
        item.metric,
        item.band,
        binaryStat(item.metric, cm, mins),
        level,
        false,
        decide,
      ),
    );
    descriptive = BINARY_DESCRIPTIVE.filter((m) => !planned.includes(m)).map(
      (m) => statEntry(m, null, binaryStat(m, cm, mins), level, true),
    );
    context = {
      sampleSize: cm.tp + cm.fp + cm.fn + cm.tn,
      passBlocked: false,
      reasons: [],
    };
  } else if (kind === "multiclass_performance") {
    const d = data as MulticlassData;
    const planned = spec.members!.map((item) => item.metric);
    members = spec.members!.map((item) =>
      statEntry(
        item.metric,
        item.band,
        multiclassStat(item.metric, d, mins),
        level,
        false,
        decide,
      ),
    );
    descriptive = MULTICLASS_METRICS.filter((m) => !planned.includes(m)).map(
      (m) => statEntry(m, null, multiclassStat(m, d, mins), level, true),
    );
    context = {
      sampleSize: sum(d.matrix.map(sum)),
      passBlocked: false,
      reasons: [],
    };
  } else if (kind === "regression_performance") {
    const d = data as RegressionData;
    const planned = spec.members!.map((item) => item.metric);
    members = spec.members!.map((item) =>
      statEntry(
        item.metric,
        item.band,
        regressionStat(item.metric, d, mins),
        level,
        false,
        decide,
      ),
    );
    descriptive = REGRESSION_DESCRIPTIVE.filter(
      (m) => !planned.includes(m),
    ).map((m) => statEntry(m, null, regressionStat(m, d, mins), level, true));
    const [baseline, baselineP] = meanBaseline(d, mins);
    descriptive.push(statEntry("baseline_rmse", null, baseline, level, true));
    context = {
      sampleSize: d.errors.length,
      passBlocked: false,
      reasons: [],
      baselineP,
    };
  } else if (kind === "group_comparison") {
    [members, context] = groupMembers(spec, data, mins, level);
    groups = context.groups!;
  } else
    // Calibration needs score columns, which hosted profiles do not map
    // (section 12): the engine computes it.
    throw new StatisticsError(
      "calibration criteria need score columns; the engine evaluates them",
    );
  return { spec, kind, members, descriptive, groups, context, invalidBand };
}

function decideCriterion(
  state: CriterionState,
  level: number,
  mins: Minimums,
): CriterionResult {
  const alpha = 1.0 - level;
  const { spec, kind, members, descriptive, groups, context, invalidBand } =
    state;
  // Section 5.11: a clustered member with a small 2x2 cell makes no claim; its
  // own code explains the outcome.
  const smallClustered = members.some(
    (m) =>
      m.status !== "suppressed" && m.reasons.includes("small_cell_clustered"),
  );
  const reasons = [...context.reasons];
  if (
    (PERFORMANCE_KINDS.includes(kind) && !spec.members!.length) ||
    (kind === "group_comparison" && spec.band === null)
  )
    reasons.push("no_threshold");
  if (spec.passBlockedBy?.length) {
    // Section 4.8: a metric today's rule needs and 1.0.0 cannot decide blocks a pass.
    context.passBlocked = true;
    reasons.push("undecidable_metric");
    for (const entry of descriptive)
      if (spec.passBlockedBy.includes(entry.metric))
        entry.reasons.push("undecidable_metric");
  }
  let gated = context.sampleSize < mins.sampleSize;
  if (gated) reasons.unshift("below_minimum_sample_size");
  if (invalidBand) {
    reasons.push("invalid_band");
    gated = true;
  }
  const pool = members.filter((m) => m.status !== "suppressed");
  const evaluable = pool.filter((m) => m.status === "evaluated");
  const fails = evaluable.filter((m) => m.direction === "fail");
  let deciding: Member | null = null,
    direction: Direction,
    p: number;
  if (gated || !evaluable.length) {
    direction = "none";
    p = 1.0;
  } else if (fails.length) {
    direction = "fail";
    deciding = tupleMin(fails, (m) => [m.pValue!, m.memberId]);
    p = Math.min(1.0, evaluable.length * deciding.pValue!);
    const ungated = Math.min(
      1.0,
      evaluable.length *
        Math.min(...fails.map((m) => m._pInterval ?? m.pValue!)),
    );
    if (p > alpha + EPS && ungated <= alpha + EPS)
      reasons.push("small_cell_exact_test_not_significant");
    else if (p > alpha + EPS && deciding.pValue! <= alpha + EPS)
      reasons.push("within_criterion_multiplicity");
    else if (p > alpha + EPS && !smallClustered)
      reasons.push("interval_straddles_band");
  } else {
    const complete =
      pool.length > 0 &&
      pool.every((m) => m.status === "evaluated" && m.direction === "pass");
    direction = evaluable.some((m) => m.direction === "pass") ? "pass" : "none";
    if (complete && !context.passBlocked) {
      deciding = tupleMin(pool, (m) => [-m.pValue!, m.memberId]);
      p = deciding.pValue!;
      if (p > alpha + EPS && !smallClustered) {
        // Without the chance gate of section 5.2.
        const ungated = Math.max(...pool.map((m) => m._pInterval!));
        reasons.push(
          ungated <= alpha + EPS
            ? "chance_exact_test_not_significant"
            : "interval_straddles_band",
        );
      }
      // The mean baseline gate (section 5.9) gates passes only.
      p = Math.max(p, context.baselineP ?? 0.0);
    } else p = 1.0;
    if ((context.baselineP ?? 0.0) > alpha + EPS)
      reasons.push("mean_baseline_not_beaten");
  }
  for (const m of pool)
    for (const r of m.reasons) if (!reasons.includes(r)) reasons.push(r);
  const decision: Decision = {
    statisticsVersion: SPEC_VERSION,
    confidenceLevel: level,
    role: spec.role,
    kind,
    direction,
    pValue: p,
    adjustedPValue: null,
    adjustment: null,
    familySize: null,
    unadjustedOutcome:
      (direction === "pass" || direction === "fail") && p <= alpha + EPS
        ? direction
        : "inconclusive",
    decidingMemberId: deciding ? deciding.memberId : null,
    sampleSize: context.sampleSize,
    coverage: context.coverage ?? null,
    suppressedGroups: context.suppressedGroups ?? null,
    libraryEntry: libraryView(spec.libraryEntry),
    reasons,
  };
  return {
    id: spec.id,
    outcome: null,
    headline:
      kind === "group_comparison" ? headline(members, context, level) : null,
    members,
    descriptive,
    groups,
    decision,
  };
}

export function aggregate(outcomes: readonly (string | null)[]) {
  for (const state of ["fail", "inconclusive", "pass"] as const)
    if (outcomes.includes(state)) return state;
  return "not_applicable" as const;
}

export type PlanEvaluation = {
  planSha256: string;
  normalizedPlan: Plan;
  criteria: CriterionResult[];
  overallOutcome: "pass" | "fail" | "inconclusive" | "not_applicable";
  reviewFlags: string[];
};

/** Evaluates a normalised plan on one data object (the golden cases' shape). */
export function evaluatePlan(plan: Plan, data: CriterionData) {
  // A plan with a clusterField takes the clustered shape
  // {seed, clusters: [{cluster, ...one cluster's data}]} (section 5.11).
  if (plan.clusterField !== null) {
    const clustered = data as ClusteredData;
    require_(
      Array.isArray(clustered.clusters) &&
        clustered.clusters.length > 0 &&
        Number.isInteger(clustered.seed),
      "a clustered plan needs data.clusters and data.seed",
    );
    const ordered = [...clustered.clusters].sort((a, b) =>
      codePointCompare(clusterKey(a.cluster), clusterKey(b.cluster)),
    );
    const parts = ordered.map(({ cluster: _, ...part }) => part);
    return evaluateCriteria(plan, () => data, {
      ids: ordered.map((part) => part.cluster),
      partsFor: () => parts,
      seed: clustered.seed,
    });
  }
  return evaluateCriteria(plan, () => data);
}

/** The golden cases' clustered data shape (section 5.11). */
export type ClusteredData = {
  seed: number;
  clusters: (CriterionData & { cluster: unknown })[];
};
/** A clustered evaluation: the clusters in clusterKey order, one data object per cluster in that order, and the run seed. */
export type Clustered = {
  ids: unknown[];
  partsFor: (criterion: PlanCriterion) => CriterionData[];
  seed: number;
};

/**
 * Evaluates every criterion of a normalised plan on the data `dataFor`
 * returns, then applies the family adjustments (section 4.5) and the run
 * aggregation over confirmatory criteria (section 4.6). With `clustered`,
 * every member is decided by the cluster bootstrap instead (section 5.11).
 */
export function evaluateCriteria(
  plan: Plan,
  dataFor: (criterion: PlanCriterion) => CriterionData,
  clustered?: Clustered,
): PlanEvaluation {
  require_(
    plan.clusterField === null || clustered !== undefined,
    "a clustered plan is decided by the cluster bootstrap and needs its cluster data",
  );
  const level = plan.confidenceLevel;
  const alpha = 1.0 - level;
  const derived = plan.derivedFrom !== null;
  const results = clustered
    ? clusterBootstrapCriteria(plan, clustered)
    : plan.criteria.map((c) =>
        evaluateCriterion(c, dataFor(c), level, plan.minimums, derived),
      );
  for (const [role, method, adjust] of [
    ["confirmatory", "bonferroni", bonferroni],
    ["exploratory", "benjamini_hochberg", benjaminiHochberg],
  ] as const) {
    const family = results.filter((r) => r.decision.role === role);
    const adjusted = adjust(family.map((r) => r.decision.pValue));
    family.forEach((r, i) => {
      const d = r.decision;
      d.adjustedPValue = adjusted[i];
      d.adjustment = method;
      d.familySize = family.length;
      r.outcome =
        (d.direction === "pass" || d.direction === "fail") &&
        adjusted[i] <= alpha + EPS
          ? d.direction
          : "inconclusive";
      if (
        d.unadjustedOutcome !== "inconclusive" &&
        r.outcome === "inconclusive"
      )
        d.reasons.push("multiplicity_adjustment");
    });
  }
  const confirmatory = results
    .filter((r) => r.decision.role === "confirmatory")
    .map((r) => r.outcome);
  return {
    planSha256: planSha256(plan),
    normalizedPlan: plan,
    criteria: results,
    overallOutcome: aggregate(confirmatory),
    reviewFlags: results
      .filter((r) => r.decision.role === "exploratory" && r.outcome === "fail")
      .map((r) => r.id),
  };
}

// ------------------------------------------------------------ cluster bootstrap (section 5.11)
// The engine's cluster_bootstrap_criteria, step for step, so that both
// runners decide a clustered plan on the same replicates (#136).
export const MAX_DECISION_DRAWS = 50_000_000; // B x C cluster draws per run
const MIN_CLUSTERS = 10;
const VALID_REPLICATE_SHARE = 0.9;
const U_TOLERANCE = 1e-9;
const UNBOOTSTRAPPED = new Set([
  "r2",
  "expected_calibration_error",
  "baseline_rmse",
]);

/** Clusters are ordered by the UTF-8 bytes (code points) of their canonical JSON, as the engine's cluster_key. */
export function clusterKey(cluster: unknown) {
  return typeof cluster === "string" ? JSON.stringify(cluster) : jcs(cluster);
}

/** Type-7 (linear interpolation) quantile of an ascending list. */
function quantile(ordered: number[], probability: number) {
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position),
    upper = Math.ceil(position);
  return (
    ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
  );
}

/** One criterion's data over all clusters: counts summed by group or class label, regression rows concatenated in cluster order. */
function mergeParts(parts: CriterionData[]): CriterionData {
  const first = parts[0];
  if (first.groups) {
    const cells = new Map<string, Record<string, number>>();
    for (const part of parts)
      for (const g of part.groups!) {
        const { group, ...counts } = g as unknown as Record<string, number> & {
          group: string;
        };
        let acc = cells.get(group);
        if (!acc) {
          acc = Object.fromEntries(Object.keys(counts).map((k) => [k, 0]));
          cells.set(group, acc);
        }
        require_(
          Object.keys(acc).sort().join() === Object.keys(counts).sort().join(),
          "a group mixes selection-only and confusion-matrix counts",
        );
        for (const [k, v] of Object.entries(counts)) acc[k] += v;
      }
    const out: CriterionData = {
      groups: byCodePoint(cells.keys()).map(
        (group) => ({ group, ...cells.get(group)! }) as unknown as GroupData,
      ),
    };
    if (parts.some((part) => part.unknownGroupRows !== undefined))
      out.unknownGroupRows = sum(parts.map((p) => p.unknownGroupRows ?? 0));
    return out;
  }
  if (first.matrix) {
    const labels = byCodePoint(new Set(parts.flatMap((p) => p.labels!)));
    const position = new Map(labels.map((label, i) => [label, i]));
    const matrix = labels.map(() => labels.map(() => 0));
    for (const part of parts)
      part.matrix!.forEach((row, i) =>
        row.forEach((count, j) => {
          matrix[position.get(part.labels![i])!][
            position.get(part.labels![j])!
          ] += count;
        }),
      );
    return { kind: "multiclass", labels, matrix };
  }
  const out: CriterionData = {
    kind: "regression",
    errors: parts.flatMap((p) => p.errors!),
  };
  if (parts.every((p) => p.targets !== undefined))
    out.targets = parts.flatMap((p) => p.targets!);
  return out;
}

type Unit = string | null;
/** The cells of one criterion that every replicate sums: one count vector per cluster. */
class ClusterLayout {
  size: number;
  labels: string[] = [];
  position = new Map<string, number>();
  centre = 0.0;
  groups: string[] = [];
  cells: string[] = [];
  offset = new Map<string, number>();

  constructor(
    readonly kind: string,
    merged: CriterionData,
  ) {
    if (kind === "performance") this.size = 4;
    else if (kind === "multiclass_performance") {
      this.labels = merged.labels!;
      this.labels.forEach((label, i) => this.position.set(label, i));
      this.size = this.labels.length ** 2;
    } else if (kind === "regression_performance") {
      const targets =
        merged.targets ?? new Array<number>(merged.errors!.length).fill(0.0);
      this.centre = targets.length ? fsum(targets) / targets.length : 0.0;
      this.size = 5;
    } else {
      this.groups = merged.groups!.map((g) => g.group);
      this.cells = merged.groups!.some((g) => "selected" in g)
        ? ["selected", "n"]
        : ["tp", "fp", "fn", "tn"];
      this.groups.forEach((name, i) =>
        this.offset.set(name, i * this.cells.length),
      );
      this.size = this.groups.length * this.cells.length;
    }
  }

  /** A cluster's cells, and its rows per unit (the whole criterion, null, or a group). */
  vector(part: CriterionData): [number[], Map<Unit, number>] {
    let cells = new Array<number>(this.size).fill(0);
    const units = new Map<Unit, number>();
    if (this.kind === "performance") {
      for (const g of part.groups!)
        (["tp", "fp", "fn", "tn"] as const).forEach((key, i) => {
          cells[i] += (g as Confusion)[key];
        });
      units.set(null, sum(cells));
    } else if (this.kind === "multiclass_performance") {
      const k = this.labels.length;
      part.matrix!.forEach((row, i) =>
        row.forEach((count, j) => {
          cells[
            this.position.get(part.labels![i])! * k +
              this.position.get(part.labels![j])!
          ] += count;
        }),
      );
      units.set(null, sum(cells));
    } else if (this.kind === "regression_performance") {
      const errors = part.errors!;
      const targets = part.targets ?? new Array<number>(errors.length).fill(0);
      const shifted = targets.map((t) => t - this.centre);
      cells = [
        errors.length,
        fsum(errors.map((e) => Math.abs(e))),
        fsum(errors.map((e) => e * e)),
        fsum(shifted),
        fsum(shifted.map((t) => t * t)),
      ];
      units.set(null, errors.length);
    } else
      for (const g of part.groups!) {
        const base = this.offset.get(g.group)!;
        this.cells.forEach((key, i) => {
          cells[base + i] += (g as unknown as Record<string, number>)[key];
        });
        units.set(g.group, (units.get(g.group) ?? 0) + groupRows(g));
      }
    return [cells, units];
  }

  /** A replicate's data in the shape the estimators read. */
  replicate(cells: number[]): unknown {
    if (this.kind === "performance")
      return { tp: cells[0], fp: cells[1], fn: cells[2], tn: cells[3] };
    if (this.kind === "multiclass_performance") {
      const k = this.labels.length;
      return {
        labels: this.labels,
        matrix: this.labels.map((_, i) => cells.slice(i * k, (i + 1) * k)),
      };
    }
    if (this.kind === "regression_performance") return cells;
    return Object.fromEntries(
      this.groups.map((name) => {
        const base = this.offset.get(name)!;
        return [
          name,
          Object.fromEntries(
            this.cells.map((key, i) => [key, cells[base + i]]),
          ),
        ];
      }),
    ) as unknown as Record<string, GroupData>;
  }

  unitsOf(entry: Member): Unit[] {
    return this.kind === "group_comparison"
      ? [entry.subject, entry.comparator]
      : [null];
  }
}

/** mean d = MSE − SST/n on a regression replicate: the statistic of the mean baseline gate (section 5.9). */
function meanDifference(rep: number[]) {
  const n = rep[0];
  if (n === 0) return null;
  const centred = rep[3] / n;
  return rep[2] / n - (rep[4] / n - centred * centred);
}

/** A replicate's shape differs by criterion kind (ClusterLayout.replicate). */
type Estimator = (rep: any) => number | null;
/** The estimate of one entry on a replicate (null where undefined), or null for the entries that keep their own treatment (R², the baseline RMSE). */
function clusterEstimator(
  layout: ClusterLayout,
  entry: Member,
  mins: Minimums,
): Estimator | null {
  const metric = entry.metric;
  if (UNBOOTSTRAPPED.has(metric)) return null;
  if (layout.kind === "performance")
    return (rep: Confusion) => binaryStat(metric, rep, mins).estimate;
  if (layout.kind === "multiclass_performance")
    return (rep: MulticlassData) => multiclassStat(metric, rep, mins).estimate;
  if (layout.kind === "regression_performance") {
    if (metric === "mae")
      return (rep: number[]) => (rep[0] ? rep[1] / rep[0] : null);
    if (metric === "mse_reduction")
      return (rep: number[]) =>
        rep[0] === 0 ? null : 0.0 - meanDifference(rep)!;
    return (rep: number[]) => (rep[0] ? Math.sqrt(rep[2] / rep[0]) : null);
  }
  const key = RATE_KEYS[metric],
    subject = entry.subject!,
    comparator = entry.comparator!;
  return (rep: Record<string, GroupData>) => {
    const [xs, ns] = rateCounts(key, rep[subject]),
      [xc, nc] = rateCounts(key, rep[comparator]);
    if (ns === 0 || nc === 0) return null;
    if (metric === "selection_rate_ratio")
      return xc === 0 ? null : xs / ns / (xc / nc);
    return xs / ns - xc / nc;
  };
}

/** Whether an interval (lo, hi) lies inside the band (pass, inclusive bounds) or outside it (fail, strict). */
function bandHolds(band: Band, direction: Direction) {
  const { lower, upper } = band;
  if (direction === "pass")
    return (lo: number, hi: number) =>
      (lower === null || lo >= lower) && (upper === null || hi <= upper);
  return (lo: number, hi: number) =>
    (lower !== null && hi < lower) || (upper !== null && lo > upper);
}

/** u* = inf{u in (0, 0.5] : [q(u), q(1 − u)] decides}, by bisection to 1e-9; null when even the median does not decide. */
function bootstrapUStar(
  ordered: number[],
  holds: (lo: number, hi: number) => boolean,
) {
  const middle = quantile(ordered, 0.5);
  if (!holds(middle, middle)) return null;
  if (holds(ordered[0], ordered[ordered.length - 1])) return 0.0;
  let lo = 0.0,
    hi = 0.5;
  while (hi - lo > U_TOLERANCE) {
    const mid = (lo + hi) / 2.0;
    if (holds(quantile(ordered, mid), quantile(ordered, 1.0 - mid))) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** p = max(2u*, 2/(B_valid + 1)), and 1 when no u decides. */
function bootstrapP(
  ordered: number[],
  holds: (lo: number, hi: number) => boolean,
) {
  const u = bootstrapUStar(ordered, holds);
  return u === null ? 1.0 : Math.max(2.0 * u, 2.0 / (ordered.length + 1));
}

const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

/** Replaces an entry's analytic interval, direction and p-value by the cluster percentile bootstrap. */
function applyClusterBootstrap(
  entry: Member,
  values: number[],
  clusters: number,
  replicates: number,
  level: number,
  descriptive: boolean,
  within: boolean,
  decide: boolean,
) {
  delete entry._ciAt;
  delete entry._pInterval;
  entry.interval = null;
  entry.reasons = entry.reasons.filter(
    (r) => r !== "estimate_on_band_boundary",
  );
  if (!descriptive) {
    entry.direction = "none";
    entry.pValue = 1.0;
  }
  entry.bootstrap = {
    replicates,
    validReplicates: within ? values.length : 0,
    clusters,
  };
  if (!within) {
    entry.reasons.push("bootstrap_budget_exceeded");
    if (entry.status !== "suppressed") entry.status = "undefined";
    return;
  }
  if (entry.estimate === null) return; // its own status and reason stand
  if (clusters < MIN_CLUSTERS && entry.status === "evaluated") {
    entry.status = "insufficient_support";
    entry.reasons.push("below_minimum_cluster_count");
  }
  if (values.length < VALID_REPLICATE_SHARE * replicates) {
    if (entry.status !== "suppressed") entry.status = "undefined";
    entry.reasons.push("bootstrap_insufficient_valid_replicates");
    return;
  }
  const ordered = ascending(values);
  const tail = (1.0 - level) / 2.0;
  entry.interval = {
    lower: quantile(ordered, tail),
    upper: quantile(ordered, 1.0 - tail),
    level,
    method: "cluster_percentile_bootstrap",
  };
  // The percentile interval at the two-sided level of critical value z, for the headline.
  entry._ciAt = (z) => {
    const u = 0.5 * erfc(z / SQRT2);
    return [quantile(ordered, u), quantile(ordered, 1.0 - u)];
  };
  if (descriptive || entry.status !== "evaluated" || !decide) return;
  const direction = directionOf(quantile(ordered, 0.5), entry.band!); // from the median replicate
  entry.direction = direction;
  if (direction === "none") {
    entry.reasons.push("estimate_on_band_boundary");
    return;
  }
  const p = bootstrapP(ordered, bandHolds(entry.band!, direction));
  entry.pValue = entry._pInterval = p;
  if (entry.smallCell) {
    // Fisher assumes independent rows, so a small cell supports no claim either way.
    entry.pValue = entry._pInterval = 1.0;
    entry.reasons.push("small_cell_clustered");
  } else if (direction === "pass" && entry.chanceExactP !== null)
    entry.pValue = Math.max(p, entry.chanceExactP); // the chance gate (section 5.2) stays a pass condition
}

/**
 * A per-group rate's cluster percentile interval (#136): null beyond the
 * budget, for an undefined rate and with fewer than 0.9 B valid replicates.
 * Rates are descriptive, so there is no minimum-cluster rule.
 */
function applyRateBootstrap(
  entry: RateEntry,
  values: number[],
  replicates: number,
  level: number,
  within: boolean,
) {
  entry.interval = null;
  if (
    !within ||
    entry.estimate === null ||
    values.length < VALID_REPLICATE_SHARE * replicates
  )
    return;
  const ordered = ascending(values);
  const tail = (1.0 - level) / 2.0;
  entry.interval = {
    lower: quantile(ordered, tail),
    upper: quantile(ordered, 1.0 - tail),
    level,
    method: "cluster_percentile_bootstrap",
  };
}

/**
 * The mean baseline gate on the shared replicates (sections 5.9 and 5.11):
 * p = max(2u*, 2/(B_valid + 1)) with u* = inf{u : q(1 − u) of mean d < 0}.
 * The rounding rule, fewer than 10 clusters or 0.9 B valid replicates, or a
 * run beyond the budget give p = 1.
 */
function clusterGate(
  state: CriterionState,
  values: number[],
  clusters: number,
  replicates: number,
  within: boolean,
) {
  const entry = state.descriptive.find((e) => e.metric === "baseline_rmse")!;
  const counts = entry.counts as Record<string, number | string>;
  let p = 1.0;
  const beaten =
    "meanSquaredErrorReduction" in counts &&
    (counts.meanSquaredErrorReduction as number) >
      BASELINE_TOLERANCE * (counts.meanSquaredError as number);
  if (
    beaten &&
    within &&
    clusters >= MIN_CLUSTERS &&
    values.length >= VALID_REPLICATE_SHARE * replicates
  )
    p = bootstrapP(ascending(values), (_, hi) => hi < 0.0);
  if ("gatePValue" in counts) {
    counts.gatePValue = p;
    counts.gateMethod = "cluster_percentile_bootstrap";
  }
  state.context.baselineP = p;
}

type ClusterState = {
  state: CriterionState;
  layout: ClusterLayout;
  cells: number[][];
  offset: number;
  entries: {
    entry: Member;
    estimator: Estimator;
    clusters: number;
    descriptive: boolean;
    values: number[];
  }[];
  rates: { entry: RateEntry; estimator: Estimator; values: number[] }[];
  gate: number[] | null;
  clusters: number;
};

/**
 * Section 5.11: every member of a clustered plan is decided by one shared set
 * of B cluster-bootstrap replicates. Clusters come in clusterKey order; a
 * replicate draws C indices with randrange(C) from one random.Random(seed)
 * stream (PythonRandom) and sums the drawn clusters' count vectors.
 */
function clusterBootstrapCriteria(
  plan: Plan,
  { ids, partsFor, seed }: Clustered,
): CriterionResult[] {
  const level = plan.confidenceLevel,
    mins = plan.minimums,
    derived = plan.derivedFrom !== null;
  const replicates = plan.bootstrap.replicates,
    count = ids.length;
  const within = replicates * count <= MAX_DECISION_DRAWS;
  const states: ClusterState[] = [];
  let width = 0;
  for (const spec of plan.criteria) {
    const parts = partsFor(spec);
    require_(
      parts.length === count,
      "every criterion needs one data object per cluster",
    );
    const merged = mergeParts(parts);
    const state = buildCriterion(spec, merged, level, mins, derived);
    const layout = new ClusterLayout(spec.kind, merged);
    const vectors = parts.map((part) => layout.vector(part));
    const clustersIn = new Map<Unit, number>();
    for (const [, units] of vectors)
      for (const [unit, rows] of units)
        if (rows) clustersIn.set(unit, (clustersIn.get(unit) ?? 0) + 1);
    const entries: ClusterState["entries"] = [];
    for (const [descriptive, items] of [
      [false, state.members],
      [true, state.descriptive],
    ] as const)
      for (const entry of items) {
        const estimator = clusterEstimator(layout, entry, mins);
        if (estimator !== null)
          entries.push({
            entry,
            estimator,
            clusters: Math.min(
              ...layout.unitsOf(entry).map((unit) => clustersIn.get(unit) ?? 0),
            ),
            descriptive,
            values: [],
          });
      }
    const rates: ClusterState["rates"] = [];
    for (const view of state.groups ?? [])
      for (const key of ["selection", "tpr", "fpr"] as const) {
        const entry = view[key];
        if (entry)
          rates.push({
            entry,
            estimator: (rep: Record<string, GroupData>) => {
              const [x, n] = rateCounts(key, rep[view.group]);
              return n ? x / n : null;
            },
            values: [],
          });
      }
    states.push({
      state,
      layout,
      cells: vectors.map(([cells]) => cells),
      offset: width,
      entries,
      rates,
      gate: spec.kind === "regression_performance" ? [] : null,
      clusters: clustersIn.get(null) ?? 0,
    });
    width += layout.size;
  }
  if (within) {
    // Each cell's nonzero clusters and values: a replicate's cell is
    // sum(multiplicity × value) over them, in cluster order, which equals the
    // sum of the drawn clusters' vectors.
    const columns = Array.from({ length: width }, () => ({
      clusters: [] as number[],
      values: [] as number[],
    }));
    for (const s of states)
      s.cells.forEach((cells, c) =>
        cells.forEach((value, i) => {
          if (value) {
            columns[s.offset + i].clusters.push(c);
            columns[s.offset + i].values.push(value);
          }
        }),
      );
    const rng = new PythonRandom(seed);
    const multiplicity = new Float64Array(count);
    const dense = new Array<number>(width);
    for (let b = 0; b < replicates; b++) {
      multiplicity.fill(0);
      for (let i = 0; i < count; i++) multiplicity[rng.randrange(count)] += 1;
      for (let col = 0; col < width; col++) {
        const { clusters, values } = columns[col];
        let total = 0;
        for (let i = 0; i < clusters.length; i++)
          total += multiplicity[clusters[i]] * values[i];
        dense[col] = total;
      }
      for (const s of states) {
        const rep = s.layout.replicate(
          dense.slice(s.offset, s.offset + s.layout.size),
        );
        for (const e of s.entries) {
          const value = e.estimator(rep);
          if (value !== null) e.values.push(value);
        }
        for (const r of s.rates) {
          const value = r.estimator(rep);
          if (value !== null) r.values.push(value);
        }
        if (s.gate !== null) {
          const value = meanDifference(rep as number[]);
          if (value !== null) s.gate.push(value);
        }
      }
    }
  }
  return states.map((s) => {
    for (const e of s.entries)
      applyClusterBootstrap(
        e.entry,
        e.values,
        e.clusters,
        replicates,
        level,
        e.descriptive,
        within,
        !s.state.invalidBand,
      );
    for (const r of s.rates)
      applyRateBootstrap(r.entry, r.values, replicates, level, within);
    if (s.gate !== null)
      clusterGate(s.state, s.gate, s.clusters, replicates, within);
    return decideCriterion(s.state, level, mins);
  });
}

// ------------------------------------------------------------ power (normal approximations at assumed true values)
function twoSides(terms: number[]) {
  return terms.length === 1
    ? terms[0]
    : Math.max(0.0, terms[0] + terms[1] - 1.0);
}

type Probs = (z: number) => [number, number];

/** Pass and fail probability of the Wilson (score-test) rule for a true proportion p with denominator n. */
function proportionProbs(
  p: number,
  n: number,
  band: Partial<Band>,
  z: number,
): [number, number] {
  const s = Math.sqrt((p * (1.0 - p)) / n);
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const passing: number[] = [];
  let failing = 0.0;
  if (lower !== null) {
    const edge = lower + z * Math.sqrt((lower * (1.0 - lower)) / n);
    passing.push(phi((p - edge) / s));
    failing += phi(
      (lower - z * Math.sqrt((lower * (1.0 - lower)) / n) - p) / s,
    );
  }
  if (upper !== null) {
    const edge = upper - z * Math.sqrt((upper * (1.0 - upper)) / n);
    passing.push(phi((edge - p) / s));
    failing += phi(
      (p - upper - z * Math.sqrt((upper * (1.0 - upper)) / n)) / s,
    );
  }
  return [twoSides(passing), failing];
}

/** Pass and fail probability of an interval theta-hat +/- z*se (normal approximation) against a band. */
function normalProbs(
  theta: number,
  se: number,
  band: Partial<Band>,
  z: number,
): [number, number] {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const passing: number[] = [];
  let failing = 0.0;
  if (lower !== null) {
    passing.push(phi((theta - lower) / se - z));
    failing += phi((lower - theta) / se - z);
  }
  if (upper !== null) {
    passing.push(phi((upper - theta) / se - z));
    failing += phi((theta - upper) / se - z);
  }
  return [twoSides(passing), failing];
}

/**
 * Section 8 (#152): the expected confusion matrix, as shares of n, when class
 * c is recognised with its assumed recall and its errors are spread evenly
 * over the other k - 1 classes (row c is the truth, column j the prediction).
 */
function evenSpreadCells(shares: number[], recalls: number[]) {
  const k = shares.length;
  return shares.map((s, c) =>
    shares.map((_, j) =>
      j === c ? s * recalls[c] : (s * (1.0 - recalls[c])) / (k - 1),
    ),
  );
}

/**
 * Per class: [TP share, denominator share]. Macro precision: TP of the
 * predicted count; macro F1: the Jaccard index TP of TP + FP + FN (section 5.4).
 */
function macroParts(metric: string, cells: number[][]): [number, number][] {
  const rows = cells.map((row) => fsum(row));
  const cols = cells.map((_, c) => fsum(cells.map((row) => row[c])));
  return cells.map((row, c) => [
    row[c],
    metric === "macro_precision" ? cols[c] : rows[c] + cols[c] - row[c],
  ]);
}

/** d(Wilson bound)/d(x-hat) at the proportion x with denominator n; side -1 is the lower bound, +1 the upper. */
function wilsonSlope(x: number, n: number, z: number, side: number) {
  const root = Math.sqrt((x * (1.0 - x)) / n + (z * z) / (4.0 * n * n));
  return (
    (1.0 + (side * z * (1.0 - 2.0 * x)) / (2.0 * n * root)) /
    (1.0 + (z * z) / n)
  );
}

/**
 * Section 8 (#152): a macro bound (side -1 lower, +1 upper) of section 5.4 at
 * critical value z, as it would be computed at the expected counts, and its
 * standard deviation by the delta method over the multinomial confusion
 * matrix: the gradient of the mean of the per-class bounds in the cell
 * shares, through each class's Wilson slope.
 */
function macroBound(
  metric: string,
  n: number,
  cells: number[][],
  z: number,
  side: number,
): [number, number] {
  const k = cells.length;
  const zk = perClassZ(z, k);
  const values: number[] = [];
  const gradient = cells.map((row) => row.map(() => 0.0));
  macroParts(metric, cells).forEach(([tp, share], c) => {
    const x = tp / share;
    const [lo, hi] = wilson(n * tp, n * share, zk);
    const b = side < 0 ? lo : hi;
    let slope = wilsonSlope(x, n * share, zk, side);
    if (metric === "macro_f1") {
      // the Jaccard bound maps to F1 through 2J/(1 + J)
      values.push(f1FromJ(b));
      slope *= 2.0 / (1.0 + b) ** 2;
    } else values.push(b);
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        const counted =
          metric === "macro_precision" ? j === c : i === c || j === c;
        gradient[i][j] +=
          (slope * ((i === c && j === c ? 1.0 : 0.0) - (counted ? x : 0.0))) /
          share /
          k;
      }
  });
  const terms = (power: number) =>
    fsum(
      gradient.flatMap((row, i) =>
        row.map((g, j) => (power === 1 ? g : g ** 2) * cells[i][j]),
      ),
    );
  const first = terms(1),
    second = terms(2);
  return [
    fsum(values) / k,
    Math.sqrt(Math.max(0.0, second - first * first) / n),
  ];
}

/** Phi(distance / sd); a bound without variance decides by its sign. */
function normalTail(distance: number, sd: number) {
  if (sd > 0.0) return phi(distance / sd);
  return distance > 0.0 ? 1.0 : distance < 0.0 ? 0.0 : 0.5;
}

/**
 * Pass and fail probability of a macro F1 or macro precision member: the
 * macro bounds at z are taken as normal around their values at the expected
 * counts (section 8).
 */
function macroProbs(
  metric: string,
  n: number,
  cells: number[][],
  band: Partial<Band>,
  z: number,
): [number, number] {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const [lo, sdLo] = macroBound(metric, n, cells, z, -1),
    [hi, sdHi] = macroBound(metric, n, cells, z, 1);
  const passing: number[] = [];
  let failing = 0.0;
  if (lower !== null) {
    passing.push(normalTail(lo - lower, sdLo));
    failing += normalTail(lower - hi, sdHi);
  }
  if (upper !== null) {
    passing.push(normalTail(upper - hi, sdHi));
    failing += normalTail(lo - upper, sdLo);
  }
  return [twoSides(passing), failing];
}

const assumed = (value: any, group: string) =>
  value !== null && typeof value === "object" ? value[group] : value;

type PowerModel = {
  memberId: string;
  metric: string;
  subject: string | null;
  comparator: string | null;
  assumedValue: number | null;
  denominator: unknown;
  probs: Probs | null;
  supported: boolean;
  computed: boolean;
};
const powerModel = (
  id: string,
  metric: string,
  value: number | null,
  denominator: unknown,
  probs: Probs | null,
  supported: boolean,
  computed = true,
  subject: string | null = null,
  comparator: string | null = null,
): PowerModel => ({
  memberId: id,
  metric,
  subject,
  comparator,
  assumedValue: value,
  denominator,
  probs,
  supported,
  computed,
});

function performanceModels(
  crit: PlanCriterion,
  a: any,
  n: number,
  mins: Minimums,
) {
  const cls = mins.classCount,
    models: PowerModel[] = [];
  if (crit.kind === "performance") {
    const pi = a.prevalence,
      tpr = a.truePositiveRate,
      tnr = a.trueNegativeRate;
    const positives = n * pi,
      negatives = n * (1.0 - pi);
    const predicted = n * (pi * tpr + (1.0 - pi) * (1.0 - tnr));
    const union = n * (pi + (1.0 - pi) * (1.0 - tnr)); // expected TP + FP + FN
    for (const { metric, band } of crit.members!) {
      if (metric === "balanced_accuracy") {
        const theta = (tpr + tnr) / 2.0,
          se =
            0.5 *
            Math.sqrt(
              (tpr * (1.0 - tpr)) / positives + (tnr * (1.0 - tnr)) / negatives,
            );
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            { positives, negatives },
            (z) => normalProbs(theta, se, band, z),
            Math.min(positives, negatives) >= cls,
          ),
        );
      } else if (metric === "f1") {
        const j = (n * pi * tpr) / union;
        const jb = jaccardBand(band);
        models.push(
          powerModel(
            metric,
            metric,
            f1FromJ(j),
            union,
            (z) => proportionProbs(j, union, jb, z),
            positives >= cls,
          ),
        );
      } else {
        const [p, d, minimum] = (
          {
            accuracy: [pi * tpr + (1.0 - pi) * tnr, n, mins.sampleSize],
            precision: [(n * pi * tpr) / predicted, predicted, cls],
            recall: [tpr, positives, cls],
            specificity: [tnr, negatives, cls],
            false_positive_rate: [1.0 - tnr, negatives, cls],
          } as Record<string, [number, number, number]>
        )[metric];
        models.push(
          powerModel(
            metric,
            metric,
            p,
            d,
            (z) => proportionProbs(p, d, band, z),
            d >= minimum,
          ),
        );
      }
    }
  } else if (crit.kind === "multiclass_performance") {
    const labels = byCodePoint(Object.keys(a.classShares));
    const shares: number[] = labels.map((l) => a.classShares[l]),
      recalls: number[] = labels.map((l) => a.perClassRecall[l]);
    const k = labels.length;
    for (const { metric, band } of crit.members!) {
      if (metric === "accuracy") {
        const p = fsum(shares.map((s, i) => s * recalls[i]));
        models.push(
          powerModel(
            metric,
            metric,
            p,
            n,
            (z) => proportionProbs(p, n, band, z),
            n >= mins.sampleSize,
          ),
        );
      } else if (metric === "balanced_accuracy") {
        const theta = fsum(recalls) / k;
        const se =
          Math.sqrt(
            fsum(
              shares.map((s, i) => (recalls[i] * (1.0 - recalls[i])) / (n * s)),
            ),
          ) / k;
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            {
              perClass: Object.fromEntries(
                labels.map((l, i) => [l, n * shares[i]]),
              ),
            },
            (z) => normalProbs(theta, se, band, z),
            Math.min(...shares.map((s) => n * s)) >= cls,
          ),
        );
      } else if (metric === "macro_f1" || metric === "macro_precision") {
        // Section 8 (#152): the errors of each class spread evenly over the other classes.
        const cells = evenSpreadCells(shares, recalls);
        const parts = macroParts(metric, cells);
        const theta =
          fsum(
            parts.map(([tp, share]) =>
              metric === "macro_f1"
                ? (2.0 * tp) / (tp + share)
                : share > 0.0
                  ? tp / share
                  : 0.0,
            ),
          ) / k;
        // Recalls lie strictly inside (0, 1), so each predicted column holds
        // at least s_c * r_c > 0; the share guard is defensive only. Support
        // counts the predicted column of each class.
        const supported =
          metric === "macro_f1"
            ? Math.min(...shares.map((s) => n * s)) >= cls
            : Math.min(...parts.map(([, share]) => n * share)) >= cls;
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            {
              perClass: Object.fromEntries(
                labels.map((l, i) => [l, n * parts[i][1]]),
              ),
            },
            (z) => macroProbs(metric, n, cells, band, z),
            supported,
          ),
        );
      } else
        models.push(powerModel(metric, metric, null, null, null, false, false));
    }
  } else {
    const sigma = a.errorSd; // errors assumed normal with mean zero
    for (const { metric, band } of crit.members!) {
      if (metric === "mae") {
        const theta = sigma * Math.sqrt(2.0 / Math.PI),
          se = (sigma * Math.sqrt(1.0 - 2.0 / Math.PI)) / Math.sqrt(n);
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            n,
            (z) => normalProbs(theta, se, band, z),
            n >= mins.sampleSize,
          ),
        );
      } else if (metric === "mse_reduction")
        models.push(
          mseReductionModel(band, sigma, a.targetSd ?? null, n, mins),
        );
      else {
        const q = sigma * sigma,
          se = (Math.SQRT2 * sigma * sigma) / Math.sqrt(n);
        const sb = squareBand(band);
        models.push(
          powerModel(
            metric,
            metric,
            sigma,
            n,
            (z) => normalProbs(q, se, sb, z),
            n >= mins.sampleSize,
          ),
        );
      }
    }
    // An mse_reduction member (#136) passes only where the gate does, so the
    // gate adds no condition beside it.
    if (
      (a.targetSd ?? null) !== null &&
      crit.members!.every((m) => m.metric !== "mse_reduction")
    )
      models.push(baselineGateModel(sigma, a.targetSd, n, mins));
  }
  return models;
}

/**
 * Section 8: the mean baseline gate (section 5.9) as a pass-only condition at
 * the planned size. The model is assumed to predict the conditional mean, so
 * e and the deviation from the mean r are jointly normal with Var e = σ²,
 * Var r = targetSd² and Cov(e, r) = σ²: the MSE reduction is targetSd² − σ²
 * and SD(e² − r²) = sqrt(2 (targetSd⁴ − σ⁴)). The gate never fails a
 * criterion; with σ ≥ targetSd it never passes either.
 */
function baselineGateModel(
  sigma: number,
  targetSd: number,
  n: number,
  mins: Minimums,
): PowerModel {
  const reduction = targetSd * targetSd - sigma * sigma;
  let probs: Probs = () => [0.0, 0.0];
  if (reduction > 0.0) {
    const se = Math.sqrt(2.0 * (targetSd ** 4 - sigma ** 4)) / Math.sqrt(n);
    probs = (z) => [phi(reduction / se - z), 0.0];
  }
  return powerModel(
    "mean_baseline_gate",
    "baseline_rmse",
    targetSd,
    n,
    probs,
    n >= mins.sampleSize,
  );
}

/**
 * Section 8 (#136): the "beats the mean baseline" member under the gate's
 * conditional-mean model. It needs targetSd above errorSd; otherwise its
 * power is not computed.
 */
function mseReductionModel(
  band: Band,
  sigma: number,
  targetSd: number | null,
  n: number,
  mins: Minimums,
): PowerModel {
  if (targetSd === null || targetSd <= sigma)
    return powerModel(
      "mse_reduction",
      "mse_reduction",
      null,
      null,
      null,
      false,
      false,
    );
  const theta = targetSd * targetSd - sigma * sigma;
  const se = Math.sqrt(2.0 * (targetSd ** 4 - sigma ** 4)) / Math.sqrt(n);
  return powerModel(
    "mse_reduction",
    "mse_reduction",
    theta,
    n,
    (z) => normalProbs(theta, se, band, z),
    n >= mins.sampleSize,
  );
}

function groupModels(
  crit: PlanCriterion,
  a: any,
  sizes: Record<string, number>,
  mins: Minimums,
): [PowerModel[], string[]] {
  const names = byCodePoint(Object.keys(sizes));
  const metric = crit.metric!,
    band = crit.band!,
    mode = crit.comparison!;
  const metrics =
    metric === "equalized_odds"
      ? ["tpr_difference", "fpr_difference"]
      : [metric];
  const eligible = names.filter((g) => sizes[g] >= mins.groupSize);
  const rate = (key: string, g: string) =>
    key === "selection"
      ? ((a.assumedRates ?? {})[g] ?? a.baselineRate)
      : assumed(key === "tpr" ? a.truePositiveRate : a.falsePositiveRate, g);
  const denominator = (key: string, g: string) => {
    if (key === "selection") return sizes[g];
    const prevalence = assumed(a.prevalence, g);
    return key === "tpr"
      ? sizes[g] * prevalence
      : sizes[g] * (1.0 - prevalence);
  };
  const models: PowerModel[] = [];
  for (const mt of metrics) {
    const key = RATE_KEYS[mt];
    let pairs: [string, string][];
    if (mode.mode === "reference") {
      const ref = mode.referenceGroup!;
      pairs = eligible.includes(ref)
        ? eligible.filter((g) => g !== ref).map((g) => [g, ref])
        : [];
    } else
      pairs = eligible.flatMap((x, i) =>
        eligible
          .slice(i + 1)
          .map((y): [string, string] =>
            rate(key, y) < rate(key, x) ? [y, x] : [x, y],
          ),
      );
    for (const [s, c] of pairs) {
      const rs = rate(key, s),
        rc = rate(key, c),
        ns = denominator(key, s),
        nc = denominator(key, c);
      const supported =
        key === "selection" || Math.min(ns, nc) >= mins.classCount;
      let probs: Probs, value: number;
      if (mt === "selection_rate_ratio") {
        const theta = Math.log(rs / rc),
          se = Math.sqrt((1.0 - rs) / (ns * rs) + (1.0 - rc) / (nc * rc));
        const lb = logBand(band);
        probs = (z) => normalProbs(theta, se, lb, z);
        value = rs / rc;
      } else {
        const theta = rs - rc,
          se = Math.sqrt((rs * (1.0 - rs)) / ns + (rc * (1.0 - rc)) / nc);
        probs = (z) => normalProbs(theta, se, band, z);
        value = theta;
      }
      models.push(
        powerModel(
          memberId(mt, s, c),
          mt,
          value,
          { subject: ns, comparator: nc },
          probs,
          supported,
          true,
          s,
          c,
        ),
      );
    }
  }
  const total = sum(Object.values(sizes));
  const coverage = sum(eligible.map((g) => sizes[g])) / total;
  const reasons: string[] = [];
  if (total < mins.sampleSize) reasons.push("below_minimum_sample_size");
  if (coverage < crit.minimumCoverage! - EPS)
    reasons.push("insufficient_planned_coverage");
  if (
    eligible.length < 2 ||
    (mode.mode === "reference" && !eligible.includes(mode.referenceGroup!))
  )
    reasons.push("insufficient_groups");
  return [models, reasons];
}

export type PowerMember = {
  memberId: string;
  metric: string;
  subject?: string;
  comparator?: string;
  assumedValue: number | null;
  denominator: unknown;
  status: "computed" | "not_computed";
  passProbability: number | null;
  failProbability: number | null;
  reasons: string[];
};
function summarize(
  models: PowerModel[],
  zPass: number,
  zFail: number,
  blockedPass: boolean,
  blockedFail: boolean,
): [PowerMember[], number | null, number | null, number | null] {
  const members: PowerMember[] = models.map((m) => {
    const entry: any = { memberId: m.memberId, metric: m.metric };
    if (m.subject !== null)
      Object.assign(entry, { subject: m.subject, comparator: m.comparator });
    Object.assign(entry, {
      assumedValue: m.assumedValue,
      denominator: m.denominator,
    });
    if (!m.computed)
      Object.assign(entry, {
        status: "not_computed",
        passProbability: null,
        failProbability: null,
        reasons: ["power_not_specified_for_metric"],
      });
    else if (!m.supported)
      Object.assign(entry, {
        status: "computed",
        passProbability: 0.0,
        failProbability: 0.0,
        reasons: ["planned_below_minimum"],
      });
    else
      Object.assign(entry, {
        status: "computed",
        passProbability: m.probs!(zPass)[0],
        failProbability: m.probs!(zFail)[1],
        reasons: [],
      });
    return entry;
  });
  if (!members.length || members.some((e) => e.status !== "computed"))
    return [members, null, null, null];
  const lower = blockedPass
    ? 0.0
    : Math.max(0.0, 1.0 - fsum(members.map((e) => 1.0 - e.passProbability!)));
  const upper = blockedPass
    ? 0.0
    : Math.min(...members.map((e) => e.passProbability!));
  const fail = blockedFail
    ? 0.0
    : Math.max(...members.map((e) => e.failProbability!));
  return [members, lower, upper, fail];
}

function smallestN(
  probabilityAt: (n: number) => number | null,
  target: number,
  start = 2,
  limit = POWER_SEARCH_LIMIT,
) {
  if ((probabilityAt(limit) ?? -1) < target) return null;
  let lo = start,
    hi = limit;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((probabilityAt(mid) ?? -1) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Classic two-sided two-proportion z-test size per group (pooled null variance; Fleiss without continuity correction). */
function equalityTestN(p1: number, p2: number, level: number, power: number) {
  const za = zcrit(level),
    zb = normalQuantile(power);
  const pbar = (p1 + p2) / 2;
  const raw =
    (za * Math.sqrt(2 * pbar * (1 - pbar)) +
      zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
      2 /
    (p1 - p2) ** 2;
  return [raw, Math.ceil(raw - 1e-9)] as const;
}

function differenceMde(
  rc: number,
  ns: number,
  nc: number,
  band: Band,
  z: number,
  target: number,
  direction: number,
) {
  const failing = (gap: number) => {
    const rs = rc + direction * gap;
    return normalProbs(
      direction * gap,
      Math.sqrt((rs * (1.0 - rs)) / ns + (rc * (1.0 - rc)) / nc),
      band,
      z,
    )[1];
  };
  let lo = direction < 0 ? -band.lower! : band.upper!;
  let hi = (direction < 0 ? rc : 1.0 - rc) - 1e-12;
  if (failing(hi) < target) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (failing(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

function ratioMde(
  rc: number,
  ns: number,
  nc: number,
  band: Band,
  z: number,
  target: number,
) {
  const lb = logBand(band);
  const failing = (r: number) => {
    const rs = r * rc;
    return normalProbs(
      Math.log(r),
      Math.sqrt((1.0 - rs) / (ns * rs) + (1.0 - rc) / (nc * rc)),
      lb,
      z,
    )[1];
  };
  let peak = band.lower!,
    best = -Infinity;
  for (let i = 1; i <= 4000; i++) {
    const r = band.lower! * Math.exp((-12.0 * i) / 4000);
    const f = failing(r);
    if (f > best) {
      best = f;
      peak = r;
    }
  }
  let lo = peak,
    hi = band.lower!;
  if (failing(lo) < target) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (failing(mid) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

function failMdes(
  crit: PlanCriterion,
  a: any,
  sizes: Record<string, number>,
  z: number,
  target: number,
): Record<string, number | null> {
  const names = byCodePoint(Object.keys(sizes));
  const mode = crit.comparison!,
    metric = crit.metric!,
    band = crit.band!;
  const smallest = (candidates: string[], sign: number) =>
    tupleMin(candidates, (g) => [sign * sizes[g], g]);
  let subject: string, comparator: string;
  if (mode.mode === "reference") {
    comparator = mode.referenceGroup!;
    subject = smallest(
      names.filter((g) => g !== comparator),
      1,
    );
  } else {
    subject = smallest(names, 1);
    comparator = smallest(
      names.filter((g) => g !== subject),
      -1,
    );
  }
  if (metric === "selection_rate_difference") {
    const rc = (a.assumedRates ?? {})[comparator] ?? a.baselineRate;
    return {
      failMdeDifference: differenceMde(
        rc,
        sizes[subject],
        sizes[comparator],
        band,
        z,
        target,
        band.lower !== null ? -1 : 1,
      ),
    };
  }
  if (metric === "selection_rate_ratio") {
    const rc = (a.assumedRates ?? {})[comparator] ?? a.baselineRate;
    return {
      failMdeRatio: ratioMde(
        rc,
        sizes[subject],
        sizes[comparator],
        band,
        z,
        target,
      ),
    };
  }
  const ps = assumed(a.prevalence, subject),
    pc = assumed(a.prevalence, comparator);
  return {
    failMdeTprDifference: differenceMde(
      assumed(a.truePositiveRate, comparator),
      sizes[subject] * ps,
      sizes[comparator] * pc,
      band,
      z,
      target,
      -1,
    ),
    failMdeFprDifference: differenceMde(
      assumed(a.falsePositiveRate, comparator),
      sizes[subject] * (1.0 - ps),
      sizes[comparator] * (1.0 - pc),
      band,
      z,
      target,
      1,
    ),
  };
}

export type CriterionPower = {
  status: "computed" | "not_computed";
  passProbability: number | null;
  passProbabilityUpperBound: number | null;
  failProbability: number | null;
  requiredGroupSizeForPass?: number | null;
  requiredNForPass?: number | null;
  failMdeDifference?: number | null;
  failMdeRatio?: number | null;
  failMdeTprDifference?: number | null;
  failMdeFprDifference?: number | null;
  members: PowerMember[];
  reasons: string[];
};

const notComputed = (
  reason: string,
  members: PowerMember[] = [],
): CriterionPower => ({
  status: "not_computed",
  passProbability: null,
  passProbabilityUpperBound: null,
  failProbability: null,
  members: [...members],
  reasons: [reason],
});

/** Section 8: power and minimum detectable effects of one criterion at plan approval. */
export function criterionPower(
  crit: PlanCriterion,
  level: number,
  target: number,
  family: number,
  mins: Minimums,
): CriterionPower {
  const a = crit.powerAssumptions;
  if (a === null || a === undefined) return notComputed("missing_assumptions");
  const alpha = 1.0 - level;
  if (crit.kind === "group_comparison") {
    const sizes: Record<string, number> = a.groupSizes;
    const [models, reasons] = groupModels(crit, a, sizes, mins);
    const m = Math.max(1, models.length);
    const zPass = zcrit(1.0 - alpha / family),
      zFail = zcrit(1.0 - alpha / (family * m));
    const at = (sz: Record<string, number>) => {
      const [mods, rs] = groupModels(crit, a, sz, mins);
      return summarize(
        mods,
        zPass,
        zFail,
        rs.length > 0,
        rs.includes("below_minimum_sample_size") ||
          rs.includes("insufficient_groups"),
      );
    };
    const [members, lower, upper, fail] = at(sizes);
    const names = byCodePoint(Object.keys(sizes));
    const out: CriterionPower = {
      status: "computed",
      passProbability: lower,
      passProbabilityUpperBound: upper,
      failProbability: fail,
      requiredGroupSizeForPass: smallestN(
        (k) => at(Object.fromEntries(names.map((g) => [g, k])))[1],
        target,
      ),
      ...failMdes(crit, a, sizes, zFail, target),
      members,
      reasons: [...reasons],
    };
    if (out.requiredGroupSizeForPass === null)
      out.reasons.push("target_unreachable");
    if (
      Object.entries(out).some(
        ([key, value]) => key.startsWith("failMde") && value === null,
      )
    )
      out.reasons.push("fail_mde_unreachable");
    return out;
  }
  if (PERFORMANCE_KINDS.includes(crit.kind)) {
    const m = crit.members!.length;
    const zPass = zcrit(1.0 - alpha / family),
      zFail = zcrit(1.0 - alpha / (family * Math.max(1, m)));
    const undecidable = !!crit.passBlockedBy?.length;
    const at = (n: number) => {
      const blocked = n < mins.sampleSize;
      return summarize(
        performanceModels(crit, a, n, mins),
        zPass,
        zFail,
        blocked || undecidable,
        blocked,
      );
    };
    const [members, lower, upper, fail] = at(a.n);
    if (lower === null)
      return notComputed(
        members.length ? "member_power_not_computed" : "no_threshold",
        members,
      );
    const out: CriterionPower = {
      status: "computed",
      passProbability: lower,
      passProbabilityUpperBound: upper,
      failProbability: fail,
      requiredNForPass: smallestN((n) => at(n)[1], target),
      members,
      reasons: [],
    };
    if (a.n < mins.sampleSize) out.reasons.push("below_minimum_sample_size");
    if (undecidable) out.reasons.push("undecidable_metric");
    if (members.some((e) => e.reasons.includes("planned_below_minimum")))
      out.reasons.push("planned_below_minimum");
    if (out.requiredNForPass === null) out.reasons.push("target_unreachable");
    return out;
  }
  return notComputed("power_not_specified_for_metric");
}

export function evaluatePower(inp: any) {
  const level = get(inp, "confidenceLevel", 0.95),
    target = get(inp, "targetPower", 0.8);
  if (inp.kind === "equality_test") {
    const [raw, n] = equalityTestN(inp.p1, inp.p2, level, target);
    return { groupSizeExact: raw, groupSize: n };
  }
  const crit = normalizeCriterion(inp.criterion);
  return criterionPower(crit, level, target, get(inp, "familySize", 1), {
    ...FLOORS,
    ...get(inp, "minimums", {}),
  });
}

// ------------------------------------------------------------ NYC LL144 reporting (section 10.2)
export const LL144_RATE_KEYS = {
  selection: ["selected", "selectionRate", "selectionRateInterval"],
  scoring: ["scoredAboveMedian", "scoringRate", "scoringRateInterval"],
} as const;
export type Ll144Row = {
  category: string;
  n: number;
  shareOfData: number;
  shareOfKnown: number;
  eligibleForTwoPercentExclusion: boolean;
  excluded: boolean;
  impactRatio: number | null;
  impactRatioInterval: CriterionInterval | null;
} & Record<string, unknown>;
/**
 * One LL144 table (sex, race/ethnicity or intersectional categories) from
 * per-category counts, as engine/statistics.py evaluate_ll144. `selected`
 * counts the individuals selected (selection rates) or scoring above the
 * full-sample median (scoring rates). A category with no individuals has no
 * rate; when the reference category's rate is zero every impact ratio is
 * undefined (null).
 */
export function evaluateLl144(inp: any, level = 0.95) {
  const [countKey, rateKey, intervalKey] =
    LL144_RATE_KEYS[get(inp, "rate", "selection") as "selection" | "scoring"];
  const z = zcrit(level);
  const cats: { name: string; n: number; selected: number }[] = inp.categories;
  const known = sum(cats.map((c) => c.n));
  const unknown = get(inp, "unknownCount", 0);
  // "The data being used for the bias audit" includes the unknown category (section 10.2).
  const total = known + unknown;
  require_(total > 0, "an LL144 table needs at least one individual");
  const excluded = new Set<string>(get(inp, "excluded", []));
  const rows: Ll144Row[] = cats.map((c) => {
    const share = c.n / total;
    require_(
      !excluded.has(c.name) || share < 0.02,
      "2% exclusion only allowed below 2% of the data",
    );
    let rate: number | null = null,
      interval: CriterionInterval | null = null;
    if (c.n > 0) {
      const [lo, hi] = wilson(c.selected, c.n, z);
      rate = c.selected / c.n;
      interval = { lower: lo, upper: hi, level, method: "wilson" };
    }
    return {
      category: c.name,
      n: c.n,
      [countKey]: c.selected,
      [rateKey]: rate,
      [intervalKey]: interval,
      shareOfData: share,
      shareOfKnown: known ? c.n / known : 0,
      eligibleForTwoPercentExclusion: share < 0.02,
      excluded: excluded.has(c.name),
      impactRatio: null,
      impactRatioInterval: null,
    };
  });
  const included = rows.filter((r) => !r.excluded && r.n > 0);
  const rateOf = (r: Ll144Row) => r[rateKey] as number;
  // The first maximum in input order.
  const ref = included.length
    ? included.reduce((best, r) => (rateOf(r) > rateOf(best) ? r : best))
    : null;
  if (ref && (ref[countKey] as number) > 0)
    for (const r of included) {
      if (r === ref) {
        r.impactRatio = 1.0;
        continue;
      }
      const xs = r[countKey] as number,
        ns = r.n,
        xc = ref[countKey] as number,
        nc = ref.n;
      const method = ratioMethod(xs, ns, xc, nc)!;
      const [lo, hi] =
        method === "katz_log"
          ? katz(xs, ns, xc, nc, z)
          : koopman(xs, ns, xc, nc, z);
      r.impactRatio = xs / ns / (xc / nc);
      r.impactRatioInterval = { lower: lo, upper: hi, level, method };
    }
  return {
    referenceCategory: ref ? ref.category : null,
    totalIndividuals: total,
    totalAssessedKnown: known,
    unknownCategoryCount: unknown,
    categories: rows,
  };
}
