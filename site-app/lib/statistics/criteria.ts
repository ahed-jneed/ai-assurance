// Audit statistics: evaluating, building and deciding one criterion.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import {
  StatisticsError,
  SPEC_VERSION,
  type Minimums,
  EPS,
  BINARY_DESCRIPTIVE,
  MULTICLASS_METRICS,
  REGRESSION_DESCRIPTIVE,
  PERFORMANCE_KINDS,
  HEADLINE_NAMES,
} from "./core";
import { zcrit, sum, tupleMin } from "./numerics";
import { type Interval } from "./intervals";
import { type Band, type Direction } from "./pvalues";
import { LIBRARY, type PlanCriterion } from "./plan";
import { criterionBandProblem } from "./plan-validation";
import { type CriterionInterval, type Member, statEntry } from "./members";
import {
  type Confusion,
  binaryStat,
  type MulticlassData,
  multiclassStat,
  type RegressionData,
  regressionStat,
  meanBaseline,
} from "./metric-stats";
import {
  type Coverage,
  type GroupView,
  type Context,
  type CriterionData,
  groupMembers,
} from "./group-comparisons";

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
export type CriterionState = {
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
export function buildCriterion(
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

export function decideCriterion(
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
