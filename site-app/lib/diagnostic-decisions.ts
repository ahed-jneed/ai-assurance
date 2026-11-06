// The pass, fail and inconclusive rules of the interactive diagnostics.
// diagnostics.ts computes the statistics; each rule here turns them and the
// frozen protocol criteria into an outcome and the reasons a reviewer needs.
// The rules compare point estimates. They are kept apart from the metric
// calculations so interval-based rules can replace them in one place.
import type { Outcome } from "./domain";

export type Decision = {
  outcome: "pass" | "fail" | "inconclusive";
  /** Why the outcome is not a pass, for the result's limitations. */
  reasons: string[];
};

// Inclusive criteria tolerate floating-point arithmetic noise, never rounded UI values.
const tolerance = (a: number, b: number) =>
  1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
export const atMost = (a: number, b: number) => a <= b + tolerance(a, b);
export const atLeast = (a: number, b: number) => a >= b - tolerance(a, b);
/** `a` is greater than `b` by more than floating-point noise. */
export const exceeds = (a: number, b: number) => a > b + tolerance(a, b);

const percent = (v: number) => (v * 100).toFixed(2) + "%";
const pass: Decision = { outcome: "pass", reasons: [] };
const fail = (reasons: string[]): Decision => ({ outcome: "fail", reasons });
const inconclusive = (reasons: string[]): Decision => ({
  outcome: "inconclusive",
  reasons,
});

/**
 * The outcome of a run from its results: fail when any result fails, pass
 * only when every result passes (or does not apply) and at least one passes,
 * otherwise inconclusive. No results, or an unknown outcome, never pass.
 */
export function aggregateOutcome(
  outcomes: readonly (string | null | undefined)[],
): Outcome {
  if (outcomes.includes("fail")) return "fail";
  if (
    !outcomes.length ||
    outcomes.some((o) => o !== "pass" && o !== "not_applicable")
  )
    return "inconclusive";
  return outcomes.includes("pass") ? "pass" : "not_applicable";
}

export type SupportCriteria = {
  minimumSampleSize: number;
  minimumClassCount: number;
};

/** Confusion counts for a binary task, relative to its positive class. */
export type BinaryPerformance = {
  positiveLabel: string;
  negativeLabel: string;
  tp: number;
  fn: number;
  tn: number;
  fp: number;
};
export type BinaryCriteria = SupportCriteria & {
  minimumAccuracy: number;
  minimumRecall: number;
};

/**
 * Binary performance. Inconclusive below the protocol's support minimums.
 * Fails when balanced accuracy does not exceed 50%, so a constant prediction
 * of either class fails whatever the class balance, and when accuracy or the
 * positive-class recall misses its criterion. Inconclusive when accuracy does
 * not exceed the majority-class baseline: the accuracy criterion then cannot
 * show that the model performs.
 */
export function decideBinaryPerformance(
  s: BinaryPerformance,
  c: BinaryCriteria,
): Decision {
  const n = s.tp + s.fn + s.tn + s.fp,
    positives = s.tp + s.fn,
    negatives = s.tn + s.fp,
    p = "'" + s.positiveLabel + "'",
    q = "'" + s.negativeLabel + "'";
  // Every class needs at least one reference row for its recall to exist.
  const perClass = Math.max(1, c.minimumClassCount);
  if (n < c.minimumSampleSize || positives < perClass || negatives < perClass)
    return inconclusive([
      `Reference support is below the protocol minimum: ${n} rows (minimum ${c.minimumSampleSize}), ${positives} ${p} and ${negatives} ${q} rows (minimum ${perClass} per class).`,
    ]);
  const accuracy = (s.tp + s.tn) / n,
    sensitivity = s.tp / positives,
    specificity = s.tn / negatives,
    balanced = (sensitivity + specificity) / 2,
    majority = Math.max(positives, negatives) / n,
    majorityLabel = positives >= negatives ? p : q,
    failures: string[] = [];
  if (!exceeds(balanced, 0.5))
    failures.push(
      `Balanced accuracy ${percent(balanced)} does not exceed 50%: the predictions separate ${p} from ${q} no better than a constant prediction (recall of ${p} ${percent(sensitivity)}, specificity ${percent(specificity)}).`,
    );
  if (!atLeast(accuracy, c.minimumAccuracy))
    failures.push(
      `Accuracy ${percent(accuracy)} is below the ${percent(c.minimumAccuracy)} criterion.`,
    );
  if (!atLeast(sensitivity, c.minimumRecall))
    failures.push(
      `Recall of ${p} ${percent(sensitivity)} is below the ${percent(c.minimumRecall)} criterion.`,
    );
  if (failures.length) return fail(failures);
  if (!exceeds(accuracy, majority))
    return inconclusive([
      `Accuracy ${percent(accuracy)} does not exceed the ${percent(majority)} of always predicting the majority class ${majorityLabel}; at this class balance the accuracy criterion does not show that the model performs.`,
    ]);
  return pass;
}

/** One class of the reference column: its rows and correct predictions. */
export type ReferenceClass = { label: string; support: number; tp: number };
export type MulticlassPerformance = {
  /** Every class in the reference column (support of at least one row). */
  classes: ReferenceClass[];
  /** Rows whose prediction equals the reference label. */
  correct: number;
  macroF1: number;
};
export type MulticlassCriteria = SupportCriteria & {
  minimumAccuracy: number;
  minimumMacroF1: number;
};

/**
 * Multiclass performance, by the binary rules generalised: support is
 * judged on the reference classes only, and balanced accuracy must exceed
 * the 1/k of a constant prediction.
 */
export function decideMulticlassPerformance(
  s: MulticlassPerformance,
  c: MulticlassCriteria,
): Decision {
  const n = s.classes.reduce((sum, g) => sum + g.support, 0),
    small = s.classes.filter((g) => g.support < c.minimumClassCount);
  if (n < c.minimumSampleSize || s.classes.length < 2 || small.length)
    return inconclusive([
      n < c.minimumSampleSize
        ? `${n} rows are below the protocol minimum of ${c.minimumSampleSize}.`
        : s.classes.length < 2
          ? "The reference column contains fewer than two classes."
          : `Reference classes below the protocol minimum of ${c.minimumClassCount} rows: ${small.map((g) => `'${g.label}' (${g.support})`).join(", ")}.`,
    ]);
  const accuracy = s.correct / n,
    balanced =
      s.classes.reduce((sum, g) => sum + g.tp / g.support, 0) /
      s.classes.length,
    chance = 1 / s.classes.length,
    majority = Math.max(...s.classes.map((g) => g.support)) / n,
    failures: string[] = [];
  if (!exceeds(balanced, chance))
    failures.push(
      `Balanced accuracy ${percent(balanced)} does not exceed the ${percent(chance)} of a constant prediction across ${s.classes.length} reference classes.`,
    );
  if (!atLeast(accuracy, c.minimumAccuracy))
    failures.push(
      `Accuracy ${percent(accuracy)} is below the ${percent(c.minimumAccuracy)} criterion.`,
    );
  if (!atLeast(s.macroF1, c.minimumMacroF1))
    failures.push(
      `Macro F1 ${percent(s.macroF1)} is below the ${percent(c.minimumMacroF1)} criterion.`,
    );
  if (failures.length) return fail(failures);
  if (!exceeds(accuracy, majority))
    return inconclusive([
      `Accuracy ${percent(accuracy)} does not exceed the ${percent(majority)} of always predicting the majority reference class; at this class balance the accuracy criterion does not show that the model performs.`,
    ]);
  return pass;
}

export function decideRegression(
  s: { n: number; rmse: number },
  c: { minimumSampleSize: number; maximumRmse: number },
): Decision {
  if (s.n < c.minimumSampleSize)
    return inconclusive([
      `${s.n} rows are below the protocol minimum of ${c.minimumSampleSize}.`,
    ]);
  return atMost(s.rmse, c.maximumRmse)
    ? pass
    : fail([
        `RMSE ${Number(s.rmse.toPrecision(6))} exceeds the maximum of ${c.maximumRmse} target units.`,
      ]);
}

/** One protected group: its rows and its reference rows of each outcome. */
export type GroupSupport = {
  group: string;
  n: number;
  /** Reference rows with the favourable outcome. */
  favourable: number;
  /** Reference rows with the other outcome. */
  unfavourable: number;
};
export type GroupCriteria = {
  minimumSampleSize: number;
  minimumGroupSize: number;
};

/** Why group contrasts cannot be assessed, empty when they can. */
function groupSupportGaps(groups: GroupSupport[], c: GroupCriteria) {
  const n = groups.reduce((sum, g) => sum + g.n, 0),
    small = groups.filter((g) => g.n < c.minimumGroupSize);
  return [
    ...(n < c.minimumSampleSize
      ? [`${n} rows are below the protocol minimum of ${c.minimumSampleSize}.`]
      : []),
    ...(groups.length < 2
      ? ["Fewer than two protected groups are present."]
      : []),
    ...(small.length
      ? [
          `Groups below the protocol minimum of ${c.minimumGroupSize} rows: ${small.map((g) => `'${g.group}' (${g.n})`).join(", ")}.`,
        ]
      : []),
  ];
}

/** Demographic parity: the largest selection-rate gap between groups. */
export function decideParity(
  gap: number,
  groups: GroupSupport[],
  c: GroupCriteria & { maximumParityGap: number },
): Decision {
  const gaps = groupSupportGaps(groups, c);
  if (gaps.length) return inconclusive(gaps);
  return atMost(gap, c.maximumParityGap)
    ? pass
    : fail([
        `The selection-rate gap of ${percent(gap)} exceeds the ${percent(c.maximumParityGap)} criterion.`,
      ]);
}

/** Disparate impact: the lowest to highest group selection-rate ratio. */
export function decideImpact(
  ratio: number | null,
  groups: GroupSupport[],
  c: GroupCriteria & { minimumImpactRatio: number },
): Decision {
  const gaps = groupSupportGaps(groups, c);
  if (gaps.length) return inconclusive(gaps);
  if (ratio === null)
    return inconclusive([
      "No group received the favourable prediction, so the selection-rate ratio is undefined.",
    ]);
  return atLeast(ratio, c.minimumImpactRatio)
    ? pass
    : fail([
        `The selection-rate ratio of ${ratio.toFixed(3)} is below the ${c.minimumImpactRatio} criterion.`,
      ]);
}

/**
 * Equalized odds: the largest true- or false-positive rate gap. Every group
 * needs the minimum number of reference rows of each outcome.
 */
export function decideEqualizedOdds(
  gap: number | null,
  groups: GroupSupport[],
  c: GroupCriteria & { minimumClassCount: number; maximumOddsGap: number },
): Decision {
  const thin = groups.filter(
    (g) =>
      g.favourable < c.minimumClassCount ||
      g.unfavourable < c.minimumClassCount,
  );
  const gaps = [
    ...groupSupportGaps(groups, c),
    ...(thin.length
      ? [
          `Groups without ${c.minimumClassCount} favourable and ${c.minimumClassCount} unfavourable reference rows: ${thin.map((g) => `'${g.group}' (${g.favourable} and ${g.unfavourable})`).join(", ")}.`,
        ]
      : []),
  ];
  if (gaps.length || gap === null)
    return inconclusive(
      gaps.length ? gaps : ["True- and false-positive rates are undefined."],
    );
  return atMost(gap, c.maximumOddsGap)
    ? pass
    : fail([
        `The largest true- or false-positive rate gap of ${percent(gap)} exceeds the ${percent(c.maximumOddsGap)} criterion.`,
      ]);
}
