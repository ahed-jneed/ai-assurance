import { describe, expect, it } from "vitest";
import {
  aggregateOutcome,
  atLeast,
  atMost,
  decideBinaryPerformance,
  decideEqualizedOdds,
  decideImpact,
  decideMulticlassPerformance,
  decideParity,
  decideRegression,
  exceeds,
  type BinaryCriteria,
  type GroupSupport,
} from "./diagnostic-decisions";

const binary: BinaryCriteria = {
  minimumSampleSize: 20,
  minimumClassCount: 5,
  minimumAccuracy: 0.8,
  minimumRecall: 0.7,
};
/** Counts for 100 rows with `positives` reference positives. */
function counts(positives: number, sensitivity: number, specificity: number) {
  const negatives = 100 - positives,
    tp = Math.round(positives * sensitivity),
    tn = Math.round(negatives * specificity);
  return {
    positiveLabel: "approved",
    negativeLabel: "declined",
    tp,
    fn: positives - tp,
    tn,
    fp: negatives - tn,
  };
}

describe("tolerant comparisons", () => {
  it("accept floating-point noise at an inclusive bound, not beyond it", () => {
    expect(atMost(0.1 + 1e-15, 0.1)).toBe(true);
    expect(atLeast(0.8 - 1e-15, 0.8)).toBe(true);
    expect(atLeast(0.7999, 0.8)).toBe(false);
  });
  it("treat noise as equality when strictly exceeding", () => {
    expect(exceeds(0.5 + 1e-15, 0.5)).toBe(false);
    expect(exceeds(0.5001, 0.5)).toBe(true);
  });
});

describe("decideBinaryPerformance", () => {
  it("fails a constant prediction of the majority class that meets accuracy and recall", () => {
    // 85% approved, always predicted approved: accuracy 85%, recall 100%,
    // which passed the old accuracy and recall criterion.
    const decision = decideBinaryPerformance(counts(85, 1, 0), binary);
    expect(decision.outcome).toBe("fail");
    expect(decision.reasons).toEqual([
      expect.stringContaining("Balanced accuracy 50.00% does not exceed 50%"),
    ]);
  });

  it("fails a constant prediction of either class at any class balance", () => {
    for (const positives of [10, 50, 90])
      for (const constant of [counts(positives, 1, 0), counts(positives, 0, 1)])
        expect(decideBinaryPerformance(constant, binary).outcome).toBe("fail");
  });

  it("passes a model that beats the majority baseline and meets both criteria", () => {
    expect(decideBinaryPerformance(counts(60, 0.9, 0.8), binary)).toEqual({
      outcome: "pass",
      reasons: [],
    });
  });

  it("is inconclusive when accuracy meets its criterion but not the majority baseline", () => {
    // 90% positives: accuracy 88% is above the 80% criterion but below the
    // 90% of always predicting the majority class.
    const decision = decideBinaryPerformance(counts(90, 0.9, 0.7), binary);
    expect(decision.outcome).toBe("inconclusive");
    expect(decision.reasons[0]).toContain(
      "Accuracy 88.00% does not exceed the 90.00% of always predicting the majority class 'approved'",
    );
  });

  it("names every missed criterion", () => {
    const decision = decideBinaryPerformance(counts(50, 0.6, 0.7), binary);
    expect(decision.outcome).toBe("fail");
    expect(decision.reasons).toEqual([
      "Accuracy 65.00% is below the 80.00% criterion.",
      "Recall of 'approved' 60.00% is below the 70.00% criterion.",
    ]);
  });

  it("is inconclusive below the total or per-class support minimum", () => {
    const thin = decideBinaryPerformance(counts(3, 1, 1), binary);
    expect(thin.outcome).toBe("inconclusive");
    expect(thin.reasons[0]).toBe(
      "Reference support is below the protocol minimum: 100 rows (minimum 20), 3 'approved' and 97 'declined' rows (minimum 5 per class).",
    );
    expect(
      decideBinaryPerformance(
        { ...counts(50, 1, 1), tp: 5, tn: 5 },
        { ...binary, minimumSampleSize: 20 },
      ).outcome,
    ).toBe("inconclusive");
  });

  it("needs one row of each class even when the protocol allows none", () => {
    expect(
      decideBinaryPerformance(counts(0, 1, 1), {
        ...binary,
        minimumClassCount: 0,
      }).outcome,
    ).toBe("inconclusive");
  });
});

describe("decideMulticlassPerformance", () => {
  const criteria = {
    minimumSampleSize: 2,
    minimumClassCount: 1,
    minimumAccuracy: 0.5,
    minimumMacroF1: 0.2,
  };
  it("fails a constant prediction of the majority class", () => {
    const decision = decideMulticlassPerformance(
      {
        classes: [
          { label: "A", support: 80, tp: 80 },
          { label: "B", support: 10, tp: 0 },
          { label: "C", support: 10, tp: 0 },
        ],
        correct: 80,
        macroF1: 0.296,
      },
      criteria,
    );
    expect(decision.outcome).toBe("fail");
    expect(decision.reasons[0]).toBe(
      "Balanced accuracy 33.33% does not exceed the 33.33% of a constant prediction across 3 reference classes.",
    );
  });

  it("judges class support on the reference classes only", () => {
    expect(
      decideMulticlassPerformance(
        {
          classes: [
            { label: "A", support: 3, tp: 3 },
            { label: "B", support: 1, tp: 1 },
          ],
          correct: 4,
          macroF1: 1,
        },
        { ...criteria, minimumClassCount: 2 },
      ),
    ).toEqual({
      outcome: "inconclusive",
      reasons: [
        "Reference classes below the protocol minimum of 2 rows: 'B' (1).",
      ],
    });
    expect(
      decideMulticlassPerformance(
        {
          classes: [{ label: "A", support: 4, tp: 4 }],
          correct: 4,
          macroF1: 1,
        },
        criteria,
      ).reasons,
    ).toEqual(["The reference column contains fewer than two classes."]);
  });

  it("is inconclusive when accuracy does not beat the majority baseline", () => {
    const decision = decideMulticlassPerformance(
      {
        classes: [
          { label: "A", support: 90, tp: 80 },
          { label: "B", support: 5, tp: 4 },
          { label: "C", support: 5, tp: 4 },
        ],
        correct: 88,
        macroF1: 0.8,
      },
      criteria,
    );
    expect(decision.outcome).toBe("inconclusive");
    expect(decision.reasons[0]).toContain("majority reference class");
  });
});

describe("decideRegression", () => {
  it("explains an inconclusive sample and a missed RMSE criterion", () => {
    expect(
      decideRegression(
        { n: 3, rmse: 0.2 },
        { minimumSampleSize: 20, maximumRmse: 1 },
      ),
    ).toEqual({
      outcome: "inconclusive",
      reasons: ["3 rows are below the protocol minimum of 20."],
    });
    expect(
      decideRegression(
        { n: 30, rmse: 1.25 },
        { minimumSampleSize: 20, maximumRmse: 1 },
      ),
    ).toEqual({
      outcome: "fail",
      reasons: ["RMSE 1.25 exceeds the maximum of 1 target units."],
    });
  });
});

describe("group fairness decisions", () => {
  const criteria = { minimumSampleSize: 20, minimumGroupSize: 10 };
  const group = (
    name: string,
    n: number,
    favourable = n / 2,
  ): GroupSupport => ({
    group: name,
    n,
    favourable,
    unfavourable: n - favourable,
  });

  it("give the reason when parity and impact are inconclusive", () => {
    const groups = [group("A", 30), group("B", 4)];
    const reasons = ["Groups below the protocol minimum of 10 rows: 'B' (4)."];
    expect(
      decideParity(0.05, groups, { ...criteria, maximumParityGap: 0.1 }),
    ).toEqual({ outcome: "inconclusive", reasons });
    expect(
      decideImpact(0.9, groups, { ...criteria, minimumImpactRatio: 0.8 }),
    ).toEqual({ outcome: "inconclusive", reasons });
    expect(
      decideParity(0, [group("A", 8)], { ...criteria, maximumParityGap: 0.1 })
        .reasons,
    ).toEqual([
      "8 rows are below the protocol minimum of 20.",
      "Fewer than two protected groups are present.",
      "Groups below the protocol minimum of 10 rows: 'A' (8).",
    ]);
  });

  it("explains an undefined impact ratio", () => {
    expect(
      decideImpact(null, [group("A", 20), group("B", 20)], {
        ...criteria,
        minimumImpactRatio: 0.8,
      }),
    ).toEqual({
      outcome: "inconclusive",
      reasons: [
        "No group received the favourable prediction, so the selection-rate ratio is undefined.",
      ],
    });
  });

  it("pass and fail on the criterion when support is adequate", () => {
    const groups = [group("A", 20), group("B", 20)];
    expect(
      decideParity(0.1, groups, { ...criteria, maximumParityGap: 0.1 }).outcome,
    ).toBe("pass");
    expect(
      decideImpact(0.75, groups, { ...criteria, minimumImpactRatio: 0.8 }),
    ).toEqual({
      outcome: "fail",
      reasons: [
        "The selection-rate ratio of 0.750 is below the 0.8 criterion.",
      ],
    });
  });

  it("require both outcomes in every group for equalized odds", () => {
    expect(
      decideEqualizedOdds(null, [group("A", 20, 2), group("B", 20)], {
        ...criteria,
        minimumClassCount: 5,
        maximumOddsGap: 0.1,
      }),
    ).toEqual({
      outcome: "inconclusive",
      reasons: [
        "Groups without 5 favourable and 5 unfavourable reference rows: 'A' (2 and 18).",
      ],
    });
    expect(
      decideEqualizedOdds(0.25, [group("A", 20), group("B", 20)], {
        ...criteria,
        minimumClassCount: 5,
        maximumOddsGap: 0.1,
      }).outcome,
    ).toBe("fail");
  });
});

describe("aggregateOutcome", () => {
  it("fails when any result fails", () => {
    expect(aggregateOutcome(["pass", "inconclusive", "fail"])).toBe("fail");
  });
  it("passes only when every result passes", () => {
    expect(aggregateOutcome(["pass", "pass"])).toBe("pass");
    expect(aggregateOutcome(["pass", "not_applicable"])).toBe("pass");
    expect(aggregateOutcome(["pass", "inconclusive"])).toBe("inconclusive");
  });
  it("never defaults to pass", () => {
    expect(aggregateOutcome([])).toBe("inconclusive");
    expect(aggregateOutcome(["pass", undefined])).toBe("inconclusive");
    expect(aggregateOutcome(["pass", "skipped"])).toBe("inconclusive");
    expect(aggregateOutcome([null])).toBe("inconclusive");
    expect(aggregateOutcome(["not_applicable"])).toBe("not_applicable");
  });
});
