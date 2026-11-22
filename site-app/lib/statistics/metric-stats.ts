// Audit statistics: binary, multiclass and regression statistics.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import {
  StatisticsError,
  Z_MAX,
  type Minimums,
  BASELINE_TOLERANCE,
} from "./core";
import { pFromZ, sum, fsum, meanSd } from "./numerics";
import {
  moverMean,
  jaccardF1,
  macroF1Interval,
  meanBonferroniWilson,
} from "./intervals";
import { wilsonZstar, normalZstar, squareBand, jaccardBand } from "./pvalues";
import { type Table } from "./exact-tests";
import { type Member, type Stat, stat, support, wilsonStat } from "./members";

export type Confusion = { tp: number; fp: number; fn: number; tn: number };

export function binaryStat(
  metric: string,
  cm: Confusion,
  mins: Minimums,
): Stat {
  const { tp, fp, fn, tn } = cm;
  const pos = tp + fn,
    neg = fp + tn,
    total = tp + fp + fn + tn;
  const cls = mins.classCount;
  if (metric === "accuracy")
    return wilsonStat(
      tp + tn,
      total,
      mins.sampleSize,
      "undefined_zero_denominator",
      "below_minimum_sample_size",
    );
  if (metric === "precision")
    return wilsonStat(tp, tp + fp, cls, "undefined_zero_denominator");
  if (metric === "recall") return wilsonStat(tp, pos, cls, "single_class");
  if (metric === "specificity") return wilsonStat(tn, neg, cls, "single_class");
  if (metric === "false_positive_rate")
    return wilsonStat(fp, neg, cls, "single_class");
  if (metric === "balanced_accuracy") {
    const counts = { tp, positives: pos, tn, negatives: neg };
    if (pos === 0 || neg === 0)
      return stat(null, "mover_wilson", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    return stat(
      (tp / pos + tn / neg) / 2.0,
      "mover_wilson",
      (z) =>
        moverMean(
          [
            [tp, pos],
            [tn, neg],
          ],
          z,
        ),
      null,
      counts,
      support(Math.min(pos, neg), cls),
      [0.5, [[tp, pos, tp + fp, total]]],
    );
  }
  if (metric === "f1") {
    const m = tp + fp + fn;
    const counts = { tp, tpPlusFpPlusFn: m, positives: pos };
    if (pos === 0)
      return stat(null, "jaccard_wilson", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    return stat(
      (2.0 * tp) / (2 * tp + fp + fn),
      "jaccard_wilson",
      (z) => jaccardF1(tp, m, z),
      (band) => (d) => wilsonZstar(tp, m, jaccardBand(band), d),
      counts,
      support(pos, cls),
    );
  }
  throw new StatisticsError("unknown binary metric " + metric);
}

export type MulticlassData = { labels: string[]; matrix: number[][] };

export function multiclassStat(
  metric: string,
  data: MulticlassData,
  mins: Minimums,
): Stat {
  const { labels, matrix } = data;
  const k = labels.length,
    total = sum(matrix.map(sum));
  const supports = labels.map((_, i) => sum(matrix[i]));
  const predicted = labels.map((_, i) => sum(matrix.map((row) => row[i])));
  const tps = labels.map((_, i) => matrix[i][i]);
  const cls = mins.classCount;
  if (metric === "accuracy")
    return wilsonStat(
      sum(tps),
      total,
      mins.sampleSize,
      "undefined_zero_denominator",
      "below_minimum_sample_size",
    );
  if (metric === "balanced_accuracy") {
    const parts = tps.map((x, i) => [x, supports[i]] as [number, number]);
    const counts = {
      perClass: labels.map((label, i) => ({
        label,
        tp: tps[i],
        support: supports[i],
        predicted: predicted[i],
      })),
    };
    if (k < 2 || Math.min(...supports) === 0)
      return stat(null, "mover_wilson", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    const tables = labels.map(
      (_, i) => [tps[i], supports[i], predicted[i], total] as Table,
    );
    return stat(
      sum(parts.map(([x, n]) => x / n)) / k,
      "mover_wilson",
      (z) => moverMean(parts, z),
      null,
      counts,
      support(Math.min(...supports), cls),
      [1.0 / k, tables],
    );
  }
  if (metric === "macro_f1") {
    const classes = labels.map(
      (_, i) =>
        [tps[i], supports[i] + predicted[i] - tps[i]] as [number, number],
    );
    const counts = {
      perClass: labels.map((label, i) => ({
        label,
        tp: classes[i][0],
        tpPlusFpPlusFn: classes[i][1],
      })),
    };
    if (k < 2 || Math.min(...supports) === 0)
      return stat(null, "jaccard_wilson_bonferroni", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    const estimate =
      sum(labels.map((_, i) => (2 * tps[i]) / (supports[i] + predicted[i]))) /
      k;
    return stat(
      estimate,
      "jaccard_wilson_bonferroni",
      (z) => macroF1Interval(classes, z),
      null,
      counts,
      support(Math.min(...supports), cls),
    );
  }
  if (metric === "macro_precision") {
    const parts = tps.map((x, i) => [x, predicted[i]] as [number, number]);
    const counts = {
      perClass: labels.map((label, i) => ({
        label,
        tp: tps[i],
        predicted: predicted[i],
      })),
    };
    if (k < 2)
      return stat(null, "wilson_bonferroni_mean", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    if (Math.min(...predicted) === 0)
      return stat(null, "wilson_bonferroni_mean", null, null, counts, [
        "undefined",
        ["undefined_zero_denominator"],
      ]);
    return stat(
      sum(parts.map(([x, n]) => x / n)) / k,
      "wilson_bonferroni_mean",
      (z) => meanBonferroniWilson(parts, z),
      null,
      counts,
      support(Math.min(...predicted), cls),
    );
  }
  throw new StatisticsError("unknown multiclass metric " + metric);
}

export type RegressionData = { errors: number[]; targets?: number[] };

export function regressionStat(
  metric: string,
  data: RegressionData,
  mins: Minimums,
): Stat {
  const errors = data.errors;
  const n = errors.length;
  const status = support(n, mins.sampleSize, "below_minimum_sample_size");
  if (n < 2) {
    // No rows, or one row without a sample standard deviation.
    const undefinedMetric =
      n === 0 || metric === "r2" || metric === "mse_reduction";
    return stat(
      undefinedMetric ? null : Math.abs(errors[0]),
      metric === "r2" ? null : "normal_approximation",
      null,
      null,
      { n },
      [
        "undefined",
        [
          undefinedMetric
            ? "undefined_zero_denominator"
            : "degenerate_interval",
        ],
      ],
    );
  }
  if (metric === "mse_reduction") return mseReductionStat(data, status);
  if (metric === "r2") {
    const targets = data.targets ?? new Array<number>(n).fill(0.0);
    const meanT = fsum(targets) / n;
    const sst = fsum(targets.map((t) => (t - meanT) ** 2));
    if (sst === 0.0)
      return stat(null, null, null, null, { n }, [
        "undefined",
        ["undefined_zero_denominator"],
      ]);
    return stat(
      1.0 - fsum(errors.map((e) => e * e)) / sst,
      null,
      null,
      null,
      { n },
      status,
    );
  }
  const values =
    metric === "mae"
      ? errors.map((e) => Math.abs(e))
      : errors.map((e) => e * e);
  const [mean, sd] = meanSd(values);
  const se = sd / Math.sqrt(n);
  if (metric === "mae") {
    const counts = { n, meanAbsoluteError: mean, sdAbsoluteError: sd };
    if (se === 0.0)
      return stat(mean, "normal_approximation", null, null, counts, [
        "undefined",
        ["degenerate_interval"],
      ]);
    return stat(
      mean,
      "normal_approximation",
      (z) => [Math.max(0.0, mean - z * se), mean + z * se],
      (band) => (d) => normalZstar(mean, se, band, d),
      counts,
      status,
    );
  }
  const counts = { n, meanSquaredError: mean, sdSquaredError: sd };
  if (se === 0.0)
    return stat(
      Math.sqrt(mean),
      "normal_approximation_mse",
      null,
      null,
      counts,
      ["undefined", ["degenerate_interval"]],
    );
  return stat(
    Math.sqrt(mean),
    "normal_approximation_mse",
    (z) => [Math.sqrt(Math.max(0.0, mean - z * se)), Math.sqrt(mean + z * se)],
    (band) => (d) => normalZstar(mean, se, squareBand(band), d),
    counts,
    status,
  );
}

/**
 * The "beats the mean baseline" member (section 5.9, #136): the MSE reduction
 * over the mean-prediction baseline, SST/n − MSE = −mean(d) with
 * d_i = e_i² − (mean − y_i)², and a normal approximation on mean(d). Its band
 * {lower: L ≥ 0} passes when the reduction is shown to exceed L and fails
 * when it is shown to lie below L; with L = 0 a fail means the model is
 * significantly worse than predicting the mean.
 */
function mseReductionStat(
  data: RegressionData,
  status: [Member["status"], string[]],
): Stat {
  const { errors, targets } = data;
  const n = errors.length;
  const undefinedStat = () =>
    stat(null, "normal_approximation", null, null, { n }, [
      "undefined",
      ["undefined_zero_denominator"],
    ]);
  if (targets === undefined) return undefinedStat();
  const meanT = fsum(targets) / n;
  const residuals = targets.map((t) => meanT - t);
  const sst = fsum(residuals.map((r) => r * r));
  if (sst === 0.0) return undefinedStat();
  const [meanD, sdD] = meanSd(
    errors.map((e, i) => e * e - residuals[i] * residuals[i]),
  );
  const reduction = 0.0 - meanD; // never -0
  const se = sdD / Math.sqrt(n);
  const counts = {
    n,
    meanSquaredError: fsum(errors.map((e) => e * e)) / n,
    baselineMeanSquaredError: sst / n,
    sdSquaredErrorDifference: sdD,
  };
  if (se === 0.0)
    return stat(reduction, "normal_approximation", null, null, counts, [
      "undefined",
      ["degenerate_interval"],
    ]);
  return stat(
    reduction,
    "normal_approximation",
    (z) => [reduction - z * se, reduction + z * se],
    (band) => (d) => normalZstar(reduction, se, band, d),
    counts,
    status,
  );
}

/**
 * Section 5.9: the mean-prediction baseline (the descriptive `baseline_rmse`)
 * and its gate p. The baseline predicts the mean of the evaluated targets on
 * every row; no constant prediction has a lower RMSE. The gate tests that the
 * model's MSE lies below the baseline's: d_i = e_i² − (mean − y_i)², one-sided
 * normal approximation on the decision scale. A reduction of at most
 * BASELINE_TOLERANCE of the baseline MSE is rounding, so the gate does not
 * reject.
 */
export function meanBaseline(
  data: RegressionData,
  mins: Minimums,
): [Stat, number] {
  const errors = data.errors;
  const n = errors.length;
  const targets = data.targets;
  const undefinedStat = (): [Stat, number] => [
    stat(null, null, null, null, { n }, [
      "undefined",
      ["undefined_zero_denominator"],
    ]),
    1.0,
  ];
  if (n < 2 || targets === undefined) return undefinedStat();
  const meanT = fsum(targets) / n;
  const residuals = targets.map((t) => meanT - t);
  const sst = fsum(residuals.map((r) => r * r));
  if (sst === 0.0) return undefinedStat();
  const baselineMse = sst / n;
  const [meanD, sdD] = meanSd(
    errors.map((e, i) => e * e - residuals[i] * residuals[i]),
  );
  const se = sdD / Math.sqrt(n);
  const reduction = 0.0 - meanD; // never -0
  const p =
    reduction <= BASELINE_TOLERANCE * baselineMse
      ? 1.0
      : pFromZ(se === 0.0 ? Z_MAX : reduction / se);
  return [
    stat(
      Math.sqrt(baselineMse),
      null,
      null,
      null,
      {
        n,
        meanSquaredError: baselineMse,
        meanSquaredErrorReduction: reduction,
        sdSquaredErrorDifference: sdD,
        gatePValue: p,
      },
      support(n, mins.sampleSize, "below_minimum_sample_size"),
    ),
    p,
  ];
}
