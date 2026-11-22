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

import {
  require_,
  FLOORS,
  type Minimums,
  EPS,
  POWER_SEARCH_LIMIT,
  PERFORMANCE_KINDS,
  RATE_KEYS,
  get,
} from "./statistics/core";
import {
  normalQuantile,
  zcrit,
  byCodePoint,
  phi,
  sum,
  fsum,
  tupleMin,
} from "./statistics/numerics";
import {
  wilson,
  katz,
  koopman,
  ratioMethod,
  f1FromJ,
  perClassZ,
} from "./statistics/intervals";
import {
  type Band,
  bound,
  squareBand,
  jaccardBand,
  logBand,
} from "./statistics/pvalues";
import { type PlanCriterion, normalizeCriterion } from "./statistics/plan";
import { memberId, type CriterionInterval } from "./statistics/members";

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
export { evaluateCriterion } from "./statistics/criteria";
export type {
  Headline,
  LibraryView,
  Decision,
  CriterionResult,
} from "./statistics/criteria";
export { MAX_DECISION_DRAWS, clusterKey } from "./statistics/cluster-bootstrap";
export type { Clustered } from "./statistics/cluster-bootstrap";
export {
  aggregate,
  evaluatePlan,
  evaluateCriteria,
} from "./statistics/evaluation";
export type { PlanEvaluation, ClusteredData } from "./statistics/evaluation";

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
