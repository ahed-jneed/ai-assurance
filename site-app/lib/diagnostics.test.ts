import { describe, expect, it } from "vitest";
import { evaluate, inspectCSV, parseCSV } from "./diagnostics";
import type { EvaluationConfig, Result, Run } from "./domain";

const config: EvaluationConfig = {
  labelColumn: "actual",
  predictionColumn: "predicted",
  groupColumn: "group",
  positiveLabel: "1",
  performancePositiveLabel: "",
  minimumGroupSize: 5,
  maximumParityGap: 0.2,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.8,
  minimumSampleSize: 20,
  minimumClassCount: 5,
  maximumOddsGap: 0.2,
  minimumRecall: 0.7,
  minimumMacroF1: 0.5,
  maximumRmse: 1,
};
function run(
  suite: string[],
  overrides: Partial<EvaluationConfig> = {},
  task = "Binary classification",
) {
  return { task, suite, config: { ...config, ...overrides } } as Run;
}
/** A CSV with `count` copies of each [actual, predicted, group] row. */
function csv(rows: [string, string, string, number][]) {
  return (
    "actual,predicted,group\n" +
    rows
      .flatMap(([actual, predicted, group, count]) =>
        Array(count).fill(`${actual},${predicted},${group}`),
      )
      .join("\n")
  );
}
const metric = (result: Result, name: string) =>
  result.metrics.find((m) => m.name === name)?.value;

describe("binary performance", () => {
  // 85 favourable and 15 other reference rows; every prediction favourable.
  const constant = csv([
    ["1", "1", "A", 85],
    ["0", "1", "A", 15],
  ]);

  it("fails a constant majority-class predictor that meets accuracy and recall", () => {
    const [performance] = evaluate(run(["performance"]), constant);
    expect(performance.outcome).toBe("fail");
    expect(metric(performance, "accuracy")).toBe(0.85);
    expect(metric(performance, "recall")).toBe(1);
    expect(metric(performance, "specificity")).toBe(0);
    expect(metric(performance, "balanced_accuracy")).toBe(0.5);
    expect(metric(performance, "prevalence")).toBe(0.85);
    expect(metric(performance, "majority_baseline_accuracy")).toBe(0.85);
    expect(performance.limitations).toContainEqual(
      expect.stringContaining("no better than a constant prediction"),
    );
  });

  it("reports accuracy first and per-class recall for both classes", () => {
    const [performance] = evaluate(run(["performance"]), constant);
    expect(performance.metrics.map((m) => m.name)).toEqual([
      "accuracy",
      "precision",
      "recall",
      "f1",
      "specificity",
      "balanced_accuracy",
      "prevalence",
      "majority_baseline_accuracy",
    ]);
    expect(performance.metrics[0].details).toEqual({
      tp: 85,
      tn: 0,
      fp: 15,
      fn: 0,
      n: 100,
      rate: 1,
      tpr: 1,
      fpr: 1,
    });
    expect(
      performance.metrics.find((m) => m.name === "balanced_accuracy")?.details,
    ).toEqual([
      expect.objectContaining({ label: "1", support: 85, recall: 1 }),
      expect.objectContaining({ label: "0", support: 15, recall: 0 }),
    ]);
  });

  it("passes a model that beats the majority baseline", () => {
    const [performance] = evaluate(
      run(["performance"]),
      csv([
        ["1", "1", "A", 45],
        ["1", "0", "A", 5],
        ["0", "0", "A", 42],
        ["0", "1", "A", 8],
      ]),
    );
    expect(performance.outcome).toBe("pass");
    expect(metric(performance, "balanced_accuracy")).toBeCloseTo(0.87, 12);
  });

  it("is inconclusive when accuracy meets its criterion but not the majority baseline", () => {
    // 90% positive: accuracy 88% against a 90% majority baseline.
    const [performance] = evaluate(
      run(["performance"]),
      csv([
        ["1", "1", "A", 81],
        ["1", "0", "A", 9],
        ["0", "0", "A", 7],
        ["0", "1", "A", 3],
      ]),
    );
    expect(performance.outcome).toBe("inconclusive");
    expect(performance.limitations).toContainEqual(
      expect.stringContaining(
        "does not exceed the 90.00% of always predicting the majority class '1'",
      ),
    );
  });

  it("measures recall on the performance positive class, apart from the favourable outcome", () => {
    // Favourable outcome "1" (approved); the event of interest is "0".
    const data = csv([
      ["1", "1", "A", 40],
      ["1", "0", "A", 10],
      ["0", "0", "B", 45],
      ["0", "1", "B", 5],
    ]);
    const [performance, parity] = evaluate(
      run(["performance", "demographic_parity"], {
        performancePositiveLabel: "0",
      }),
      data,
    );
    expect(metric(performance, "recall")).toBe(0.9);
    expect(metric(performance, "specificity")).toBe(0.8);
    expect(metric(performance, "prevalence")).toBe(0.5);
    expect(performance.limitations).toContainEqual(
      "Fairness tests count the favourable outcome '1', not the performance positive class.",
    );
    // Selection rates still count the favourable "1": A 40/50, B 5/50.
    expect(metric(parity, "maximum_selection_rate_gap")).toBeCloseTo(0.7, 12);
    const [favourable] = evaluate(run(["performance"]), data);
    expect(metric(favourable, "recall")).toBe(0.8);
  });

  it("requires the performance positive class to be one of the two labels", () => {
    expect(() =>
      evaluate(
        run(["performance"], { performancePositiveLabel: "fraud" }),
        constant,
      ),
    ).toThrow(/performance positive class/);
  });

  it("is inconclusive without reference rows of both classes and flags the other label", () => {
    const [performance] = evaluate(
      run(["performance"]),
      csv([
        ["1", "1", "A", 30],
        ["1", "0", "A", 10],
      ]),
    );
    expect(performance.outcome).toBe("inconclusive");
    expect(performance.limitations).toContainEqual(
      "Predicted labels absent from the reference column: '0' (10 rows). They count as errors.",
    );
  });
});

describe("multiclass performance", () => {
  const multiclass = (rows: [string, string, number][]) =>
    "actual,predicted\n" +
    rows.flatMap(([a, p, n]) => Array(n).fill(a + "," + p)).join("\n");

  it("fails rather than turns inconclusive when a predicted label is outside the reference set", () => {
    const [performance] = evaluate(
      run(["performance"], {}, "Multiclass classification"),
      multiclass([
        ["A", "A", 6],
        ["A", "B", 4],
        ["B", "Z", 7],
        ["B", "B", 3],
        ["C", "C", 5],
        ["C", "A", 5],
      ]),
    );
    expect(performance.outcome).toBe("fail");
    expect(performance.limitations).toContainEqual(
      "Predicted labels absent from the reference column: 'Z' (7 rows). They count as errors.",
    );
    // Balanced accuracy averages the reference classes A, B and C only.
    expect(metric(performance, "balanced_accuracy")).toBeCloseTo(
      (0.6 + 0.3 + 0.5) / 3,
      12,
    );
    expect(metric(performance, "majority_baseline_accuracy")).toBeCloseTo(
      10 / 30,
      12,
    );
  });

  it("fails a constant prediction of the majority class", () => {
    const [performance] = evaluate(
      run(["performance"], { minimumMacroF1: 0 }, "Multiclass classification"),
      multiclass([
        ["A", "A", 24],
        ["B", "A", 5],
        ["C", "A", 5],
      ]),
    );
    expect(performance.outcome).toBe("fail");
    expect(metric(performance, "balanced_accuracy")).toBeCloseTo(1 / 3, 12);
  });
});

describe("fairness", () => {
  const groups = csv([
    ["1", "1", "A", 20],
    ["0", "0", "A", 20],
    ["1", "1", "B", 2],
    ["0", "0", "B", 1],
  ]);

  it("gives the reason when parity and impact are inconclusive", () => {
    const results = evaluate(
      run(["demographic_parity", "disparate_impact", "equalized_odds"]),
      groups,
    );
    for (const result of results) {
      expect(result.outcome).toBe("inconclusive");
      expect(result.limitations).toContainEqual(
        "Groups below the protocol minimum of 5 rows: 'B' (3).",
      );
    }
  });

  it("fails a zero impact ratio and explains an undefined one", () => {
    const [impact] = evaluate(
      run(["disparate_impact"]),
      csv([
        ["1", "1", "A", 10],
        ["0", "0", "A", 10],
        ["1", "0", "B", 10],
        ["0", "0", "B", 10],
      ]),
    );
    expect(impact.outcome).toBe("fail");
    expect(metric(impact, "minimum_selection_rate_ratio")).toBe(0);
    // Nobody is predicted the favourable "0".
    const [none] = evaluate(
      run(["disparate_impact"], { positiveLabel: "0" }),
      csv([
        ["0", "1", "A", 10],
        ["1", "1", "A", 10],
        ["0", "1", "B", 10],
        ["1", "1", "B", 10],
      ]),
    );
    expect(none.outcome).toBe("inconclusive");
    expect(none.limitations).toContainEqual(
      "No group received the favourable prediction, so the selection-rate ratio is undefined.",
    );
  });

  it("ignore a performance positive class when no performance test is selected", () => {
    // A configuration frozen with the class of a deselected performance test.
    const results = evaluate(
      run(["demographic_parity", "disparate_impact"], {
        performancePositiveLabel: "fraud",
      }),
      groups,
    );
    expect(results.map((r) => r.testId)).toEqual([
      "demographic_parity",
      "disparate_impact",
    ]);
    // Only the favourable label must be one of the two observed labels.
    expect(() =>
      evaluate(run(["demographic_parity"], { positiveLabel: "yes" }), groups),
    ).toThrow(
      /^Binary evaluation requires two class labels, including the favourable label 'yes'$/,
    );
    expect(() =>
      evaluate(
        run(["performance"], { performancePositiveLabel: "fraud" }),
        groups,
      ),
    ).toThrow("and the performance positive class 'fraud'");
  });
});

describe("blank rows", () => {
  const rows = "actual,predicted\n1,1\n0,0";

  it("are rejected inside the data rather than dropped", () => {
    expect(() => inspectCSV("actual,predicted\n1,1\n\n0,0")).toThrow(
      "Blank data row 2: remove empty rows; missing values are not silently dropped",
    );
    expect(() => inspectCSV("actual,predicted\n1,1\n,\n0,0\n")).toThrow(
      /Blank data row 2/,
    );
    expect(() => inspectCSV('actual,predicted\n1,1\n"",""')).toThrow(
      /Blank data row 2/,
    );
    expect(() => inspectCSV("\nactual,predicted\n1,1")).toThrow(
      "The CSV must start with its header row",
    );
    expect(() =>
      evaluate(
        run(["performance"], { minimumSampleSize: 2, minimumClassCount: 1 }),
        "actual,predicted\n1,1\n\n0,0",
      ),
    ).toThrow(/Blank data row/);
  });

  it("allow line breaks that end the file", () => {
    expect(inspectCSV(rows + "\n").rowCount).toBe(2);
    expect(inspectCSV(rows + "\r\n\r\n").rowCount).toBe(2);
  });

  it("are still skipped by the default parse that audit sampling uses", () => {
    expect(parseCSV("actual,predicted\n1,1\n\n,\n0,0")).toHaveLength(2);
  });
});
