// Audit statistics: power probability models at assumed true values.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { type Minimums, EPS, RATE_KEYS } from "./core";
import { byCodePoint, phi, sum, fsum } from "./numerics";
import { wilson, f1FromJ, perClassZ } from "./intervals";
import { type Band, bound, squareBand, jaccardBand, logBand } from "./pvalues";
import { type PlanCriterion } from "./plan";
import { memberId } from "./members";

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
export function normalProbs(
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a criterion's assumptions are untyped plan JSON, as in the Python core.
export const assumed = (value: any, group: string) =>
  value !== null && typeof value === "object" ? value[group] : value;

export type PowerModel = {
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

export function performanceModels(
  crit: PlanCriterion,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a criterion's assumptions are untyped plan JSON, as in the Python core.
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

export function groupModels(
  crit: PlanCriterion,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a criterion's assumptions are untyped plan JSON, as in the Python core.
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
