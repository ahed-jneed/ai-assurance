/* eslint-disable @typescript-eslint/no-explicit-any -- the golden fixture is untyped JSON. */
import { describe, expect, it } from "vitest";
import { evaluate, inspectCSV, parseCSV } from "./diagnostics";
import type { EvaluationConfig, PlanConfig, Result, Run } from "./domain";
import { explainResult, planSuite } from "./hosted-statistics";
import {
  HEADLINE_NAMES,
  planFor,
  planSha256,
  validatePlan,
} from "./statistics";
import { GOLDEN, differences, publicView } from "./statistics.fixture";

// ------------------------------------------------------------ end to end: the golden cases through the hosted runner
const TASKS: Record<string, string> = {
  multiclass: "Multiclass classification",
  regression: "Regression",
};
const repr = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** Rows from the case data, exactly as howToUse.rowExpansion states; clustered data adds each cluster's id in a column cluster. */
function expand(data: any): string {
  if (data.clusters) {
    const lines = data.clusters.flatMap((part: any) =>
      expand({ kind: data.kind, ...part })
        .split("\n")
        .slice(1)
        .map((line) => `${line},${part.cluster}`),
    );
    return "actual,predicted,group,cluster\n" + lines.join("\n");
  }
  const rows: string[][] = [];
  if (data.groups)
    for (const g of data.groups) {
      const pairs: [string, string, number][] =
        "selected" in g
          ? [
              ["1", "1", g.selected],
              ["0", "0", g.n - g.selected],
            ]
          : [
              ["1", "1", g.tp],
              ["0", "1", g.fp],
              ["1", "0", g.fn],
              ["0", "0", g.tn],
            ];
      for (const [a, p, count] of pairs)
        for (let i = 0; i < count; i++) rows.push([a, p, g.group]);
    }
  else if (data.kind === "multiclass")
    data.labels.forEach((label: string, i: number) =>
      data.matrix[i].forEach((count: number, j: number) => {
        for (let k = 0; k < count; k++) rows.push([label, data.labels[j], ""]);
      }),
    );
  else {
    const targets: number[] = data.targets ?? data.errors.map(() => 0);
    targets.forEach((t, i) =>
      rows.push([repr(t), repr(t + data.errors[i]), ""]),
    );
  }
  return (
    "actual,predicted,group\n" +
    rows.map((r) => r.map((v) => v || "x").join(",")).join("\n")
  );
}

/** A frozen run for a case: an explicit plan as a 1.1 profile, a hosted_config case as its legacy configuration. */
function goldenRun(c: any) {
  const legacy = c.legacy;
  if (legacy)
    return {
      task: legacy.task,
      suite: legacy.suite,
      config: legacy.config,
    } as Run;
  const plan = planFor(c);
  const task = TASKS[c.data.kind] ?? "Binary classification";
  const grouped = c.data.groups ?? c.data.clusters?.[0]?.groups;
  const config: PlanConfig = {
    labelColumn: "actual",
    predictionColumn: "predicted",
    groupColumn: grouped ? "group" : "",
    positiveLabel: task === "Binary classification" ? "1" : "",
    negativeLabel: task === "Binary classification" ? "0" : "",
  };
  return {
    task,
    suite: planSuite(plan),
    config,
    // A clustered case's run seed is data.seed (section 5.11).
    ...(c.data.seed !== undefined ? { seed: c.data.seed } : {}),
    manifest: { statistics: plan },
  } as unknown as Run;
}

/** Maps a hosted result back to the fixture's criterion shape (the inverse of section 11.4). */
function fixtureView(result: Result) {
  const metrics = result.metrics as any[];
  let headline = null,
    groups = null;
  if (result.decision!.kind === "group_comparison") {
    const top = metrics[0];
    const metric = top.details.metric;
    if (top.value !== null)
      headline = {
        names: HEADLINE_NAMES[metric],
        estimate: top.value,
        interval: top.confidenceInterval,
        band: top.details.band,
      };
    groups = top.slices.map((s: any) => {
      const out: any = {
        group: s.slice,
        n: s.n,
        declared: s.declared,
        suppressed: s.suppressed,
      };
      for (const [key, estimate] of [
        ["selection", "selectionRate"],
        ["tpr", "tpr"],
        ["fpr", "fpr"],
      ])
        if (`${key}Numerator` in s)
          out[key] = {
            x: s[`${key}Numerator`],
            n: s[`${key}Denominator`],
            estimate: s[estimate],
            interval: s[`${key}ConfidenceInterval`],
          };
      return out;
    });
  }
  const entry = (m: any) => ({
    memberId: m.name,
    metric: m.details.metric,
    subject: m.details.subject,
    comparator: m.details.comparator,
    counts: m.details.counts,
    estimate: m.value,
    interval: m.confidenceInterval,
    band: m.details.band,
    status: m.details.status,
    direction: m.details.direction,
    pValue: m.pValue,
    smallCell: m.details.smallCell,
    fisherExactP: m.details.fisherExactP,
    chanceExactP: m.details.chanceExactP,
    reasons: m.details.reasons,
    ...(m.details.bootstrap ? { bootstrap: m.details.bootstrap } : {}),
  });
  return {
    id: result.testId,
    outcome: result.outcome,
    headline,
    members: metrics.filter((m) => m.details.role === "member").map(entry),
    descriptive: metrics
      .filter((m) => m.details.role === "descriptive")
      .map(entry),
    groups,
    decision: result.decision,
  };
}

const END_TO_END = (GOLDEN.cases as any[]).filter((c) => c.endToEnd.hosted);

describe("statistics golden cases through the hosted runner (end to end)", () => {
  it("covers every case the fixture marks for the hosted runner", () => {
    expect(END_TO_END.length).toBeGreaterThanOrEqual(25);
  });

  it.each(END_TO_END.map((c) => [c.id, c]))(
    "%s reproduces the engine's decisions",
    (_, c: any) => {
      const { results, evaluation } = evaluate(goldenRun(c), expand(c.data));
      const expected = c.expected;
      expect(publicView(evaluation.normalizedPlan)).toEqual(
        expected.normalizedPlan,
      );
      expect(evaluation.planSha256).toBe(expected.planSha256);
      expect(results.map((r) => r.testId)).toEqual(
        expected.criteria.map((x: any) => x.id),
      );
      results.forEach((result, i) =>
        expect(
          differences(publicView(fixtureView(result)), expected.criteria[i]),
          result.testId,
        ).toEqual([]),
      );
      expect(evaluation.overallOutcome).toBe(expected.overallOutcome);
      expect(evaluation.reviewFlags).toEqual(expected.reviewFlags);
      // Every result explains its interval in plain language.
      for (const result of results)
        expect(explainResult(result).length).toBeGreaterThan(20);
    },
  );
});

// ------------------------------------------------------------ behaviour
const legacy: EvaluationConfig = {
  labelColumn: "actual",
  predictionColumn: "predicted",
  groupColumn: "group",
  positiveLabel: "1",
  performancePositiveLabel: "",
  minimumGroupSize: 30,
  maximumParityGap: 0.2,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.8,
  minimumSampleSize: 30,
  minimumClassCount: 10,
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
  return { task, suite, config: { ...legacy, ...overrides } } as Run;
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
  result.metrics.find((m) => m.name === name);

describe("hosted decisions by interval", () => {
  it("reports n and an interval for every headline and member metric, and no 'no confidence intervals' text", () => {
    const { results } = evaluate(
      run(["performance", "demographic_parity"]),
      csv([
        ["1", "1", "A", 160],
        ["0", "0", "A", 140],
        ["1", "0", "B", 20],
        ["1", "1", "B", 130],
        ["0", "0", "B", 150],
      ]),
    );
    for (const result of results) {
      expect(result.decision?.statisticsVersion).toBe("1.0.0");
      expect(result.limitations.join(" ")).not.toMatch(
        /No confidence intervals/,
      );
      for (const m of result.metrics) {
        expect(m.sampleSize).toBeGreaterThan(0);
        if ((m.details as any).status === "evaluated")
          expect(m.confidenceInterval).not.toBeNull();
      }
    }
    expect(metric(results[0], "accuracy")!.confidenceInterval!.level).toBe(
      0.95,
    );
  });

  it("never passes a constant majority-class predictor", () => {
    // 85 favourable and 15 other reference rows; every prediction favourable.
    const { results } = evaluate(
      run(["performance"]),
      csv([
        ["1", "1", "A", 85],
        ["0", "1", "A", 15],
      ]),
    );
    const [performance] = results;
    expect(performance.outcome).not.toBe("pass");
    // The chance baseline sits exactly on its bound.
    expect(metric(performance, "balanced_accuracy")!.value).toBe(0.5);
    expect(performance.decision!.reasons).toContain(
      "estimate_on_band_boundary",
    );
  });

  describe("regression against the mean-prediction baseline", () => {
    // 60 targets 10..21 (each five times): mean 15.5, population SD 3.452.
    const targets = Array.from({ length: 60 }, (_, i) => 10 + (i % 12));
    const regression = (predict: (target: number, i: number) => number) =>
      evaluate(
        run(["regression"], { maximumRmse: 5 }, "Regression"),
        csv(targets.map((t, i) => [String(t), String(predict(t, i)), "A", 1])),
      ).results[0];

    it("does not pass a constant mean prediction that meets maximumRmse, and names the baseline", () => {
      const result = regression(() => 15.5);
      const rmse = metric(result, "rmse")!;
      const baseline = metric(result, "baseline_rmse")!;
      // RMSE 3.452 <= 5 by its interval: the threshold alone would pass.
      expect(rmse.value).toBeCloseTo(3.452, 3);
      expect((rmse.details as any).direction).toBe("pass");
      expect(rmse.pValue!).toBeLessThan(0.05);
      // The baseline RMSE is the targets' SD, which the mean prediction equals.
      expect(baseline.value).toBeCloseTo(rmse.value!, 12);
      expect(baseline.unit).toBe("target units");
      expect((baseline.details as any).role).toBe("descriptive");
      expect((baseline.details as any).counts.gatePValue).toBe(1);
      expect(metric(result, "r2")!.value).toBeCloseTo(0, 12);
      expect(result.outcome).toBe("inconclusive");
      expect(result.decision!.reasons).toContain("mean_baseline_not_beaten");
      expect(result.decision!.pValue).toBe(1);
      expect(result.limitations.join(" ")).toMatch(
        /RMSE 3\.452 does not beat the mean-prediction baseline RMSE 3\.452/,
      );
      expect(explainResult(result)).toMatch(/not shown to beat 3\.45/);
    });

    it("does not pass any other constant prediction either", () => {
      for (const constant of [15, 16, 17.25]) {
        const result = regression(() => constant);
        expect(metric(result, "rmse")!.value!).toBeLessThan(5);
        expect(result.outcome, String(constant)).not.toBe("pass");
        expect(result.decision!.reasons).toContain("mean_baseline_not_beaten");
      }
    });

    it("passes a model with R² > 0 that meets maximumRmse", () => {
      const result = regression((t, i) => t + ((i % 5) - 2) * 0.25);
      expect(metric(result, "r2")!.value!).toBeGreaterThan(0.9);
      expect(
        (metric(result, "baseline_rmse")!.details as any).counts.gatePValue,
      ).toBeLessThan(1e-6);
      expect(result.outcome).toBe("pass");
      expect(result.decision!.reasons).not.toContain(
        "mean_baseline_not_beaten",
      );
    });
  });

  it("is inconclusive when a small sample cannot tell the gap from noise", () => {
    // 20 per group is below the floor of 30: the groups are suppressed.
    const { results } = evaluate(
      run(["demographic_parity"], { minimumGroupSize: 2 }),
      csv([
        ["1", "1", "A", 6],
        ["0", "0", "A", 14],
        ["1", "1", "B", 10],
        ["0", "0", "B", 10],
      ]),
    );
    expect(results[0].outcome).toBe("inconclusive");
    expect(results[0].decision!.reasons).toContain(
      "group_suppressed_below_minimum",
    );
  });

  it("measures recall on the performance positive class, apart from the favourable outcome", () => {
    const rows = csv([
      ["fraud", "fraud", "A", 40],
      ["fraud", "ok", "A", 10],
      ["ok", "ok", "A", 150],
    ]);
    const { results } = evaluate(
      run(["performance"], {
        positiveLabel: "ok",
        performancePositiveLabel: "fraud",
      }),
      rows,
    );
    const recall = metric(results[0], "recall")!;
    expect(recall.value).toBe(0.8);
    expect(recall.numerator).toBe(40);
    expect(recall.denominator).toBe(50);
    expect(results[0].limitations.join(" ")).toMatch(
      /performance positive class 'fraud'/,
    );
  });

  it("requires both labels in a legacy profile, but evaluates one observed label when both are declared", () => {
    const oneLabel = csv([["1", "1", "A", 60]]);
    expect(() => evaluate(run(["performance"]), oneLabel)).toThrow(
      /requires two class labels/,
    );
    const plan = validatePlan({
      criteria: [
        {
          id: "performance",
          kind: "performance",
          members: [{ metric: "recall", band: { lower: 0.7 } }],
        },
      ],
    });
    const config: PlanConfig = {
      labelColumn: "actual",
      predictionColumn: "predicted",
      groupColumn: "",
      positiveLabel: "1",
      negativeLabel: "0",
    };
    const declared = {
      task: "Binary classification",
      suite: ["performance"],
      config,
      manifest: { statistics: plan },
    } as unknown as Run;
    const { results } = evaluate(declared, oneLabel);
    expect(metric(results[0], "recall")!.value).toBe(1);
    expect(metric(results[0], "specificity")!.details).toMatchObject({
      status: "undefined",
    });
    expect(() => evaluate(declared, csv([["2", "1", "A", 60]]))).toThrow(
      /declares the labels '1' and '0'/,
    );
  });

  it("derives a legacy profile's plan with the floors raised and the configured minimums recorded", () => {
    const { evaluation } = evaluate(
      run(["performance"], {
        minimumSampleSize: 20,
        minimumClassCount: 5,
        minimumGroupSize: 2,
      }),
      csv([
        ["1", "1", "A", 80],
        ["0", "0", "A", 80],
      ]),
    );
    expect(evaluation.normalizedPlan.minimums).toEqual({
      sampleSize: 30,
      groupSize: 30,
      classCount: 10,
    });
    expect(evaluation.normalizedPlan.configuredMinimums).toEqual({
      sampleSize: 20,
      groupSize: 2,
      classCount: 5,
    });
    expect(evaluation.planSha256).toBe(planSha256(evaluation.normalizedPlan));
  });

  it("treats a predicted label outside the reference set as an undefined class in multiclass data", () => {
    const { results } = evaluate(
      run(["performance"], {}, "Multiclass classification"),
      csv([
        ["a", "a", "", 40],
        ["b", "b", "", 40],
        ["c", "c", "", 39],
        ["c", "z", "", 1],
      ]).replaceAll(",\n", ",x\n"),
    );
    expect(results[0].outcome).not.toBe("pass");
    expect(results[0].limitations.join(" ")).toMatch(/'z' \(1 rows\)/);
  });
});

describe("inspectCSV lists values and group sizes on request", () => {
  const csv = [
    "actual,predicted,group,id",
    ...["b,b,B,1", "a,a,A,2", "a,b,A,3", "c,c,,4", "b,a,B,5", "a,a,A,6"],
  ].join("\n");

  it("gives nothing but the column profile unless asked", () => {
    const profile = inspectCSV(csv);
    expect(profile).not.toHaveProperty("values");
    expect(profile).not.toHaveProperty("counts");
    expect(profile.columns.map((c) => c.uniqueCount)).toEqual([3, 3, 2, 6]);
  });

  it("lists the classes of a column and the rows of each group, by code point", () => {
    const profile = inspectCSV(csv, {
      values: ["actual"],
      counts: ["group", "missing", "__proto__"],
    });
    expect(profile.values).toEqual({ actual: ["a", "b", "c"] });
    // Missing cells are not a group; unknown columns list nothing.
    expect(profile.counts).toEqual(
      Object.fromEntries([
        [
          "group",
          [
            { value: "A", count: 3 },
            { value: "B", count: 2 },
          ],
        ],
        ["missing", null],
        ["__proto__", null],
      ]),
    );
  });

  it("lists no column with more than 50 distinct values", () => {
    const many = [
      "actual,predicted,group",
      ...Array.from({ length: 51 }, (_, i) => `1,1,g${i}`),
    ].join("\n");
    expect(inspectCSV(many, { counts: ["group"] }).counts).toEqual({
      group: null,
    });
    const fifty = many.split("\n").slice(0, 51).join("\n");
    expect(inspectCSV(fifty, { counts: ["group"] }).counts?.group).toHaveLength(
      50,
    );
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
      evaluate(run(["performance"]), "actual,predicted\n1,1\n\n0,0"),
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
