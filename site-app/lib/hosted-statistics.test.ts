import { describe, expect, it } from "vitest";
import type { Result } from "./domain";
import {
  defaultPlanForm,
  describePlan,
  evaluateHostedPlan,
  explainResult,
  formFromPlan,
  planFromForm,
  planGroupFields,
  planSuite,
  REASON_TEXT,
  requestedCriteria,
  stratumOf,
  validateHostedPlan,
} from "./hosted-statistics";
import { criterionPower } from "./statistics";

const thresholds = {
  minimumSampleSize: 40,
  minimumClassCount: 12,
  minimumGroupSize: 35,
  maximumParityGap: 0.08,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.85,
  minimumRecall: 0.75,
  maximumOddsGap: 0.1,
};

describe("the protocol form's plan", () => {
  it("pre-registers the bands, the chance baseline and the library entries", () => {
    const plan = validateHostedPlan(
      "Binary classification",
      planFromForm(
        "Binary classification",
        ["performance", "demographic_parity", "disparate_impact"],
        thresholds,
        { ...defaultPlanForm, impactBasis: "screen.us.four-fifths" },
        null,
      ),
    );
    expect(plan.minimums).toEqual({
      sampleSize: 40,
      groupSize: 35,
      classCount: 12,
    });
    expect(plan.criteria.map((c) => c.id)).toEqual([
      "performance",
      "demographic_parity",
      "disparate_impact",
    ]);
    expect(plan.criteria[0].members!.at(-1)).toEqual({
      metric: "balanced_accuracy",
      band: { lower: 0.5, upper: null },
    });
    expect(plan.criteria[1].libraryEntry?.id).toBe(
      "policy.eu-aia.selection-rate-difference",
    );
    expect(plan.criteria[2]).toMatchObject({
      band: { lower: 0.8, upper: 1.25 },
      libraryEntry: { id: "screen.us.four-fifths", overriddenParameters: [] },
    });
    expect(planSuite(plan)).toEqual([
      "performance",
      "demographic_parity",
      "disparate_impact",
    ]);
    expect(describePlan(plan).join("\n")).toMatch(
      /disparate_impact: selection-rate ratio within \[0\.8, 1\.25\].*screening heuristic/,
    );
  });

  it("round-trips a saved plan into the form for a revised version", () => {
    const form = {
      ...defaultPlanForm,
      confidenceLevel: 0.99 as const,
      minimumCoverage: 0.9,
      coverageRationale: "One small region is reported separately",
    };
    const plan = validateHostedPlan(
      "Binary classification",
      planFromForm(
        "Binary classification",
        ["performance", "equalized_odds"],
        thresholds,
        form,
        null,
      ),
    );
    const back = formFromPlan(plan);
    expect(back.form).toMatchObject({
      confidenceLevel: 0.99,
      minimumCoverage: 0.9,
      coverageRationale: form.coverageRationale,
    });
    expect(back.thresholds).toMatchObject({
      minimumAccuracy: 0.85,
      minimumRecall: 0.75,
      maximumOddsGap: 0.1,
      minimumGroupSize: 35,
    });
  });

  it("sets the multiclass chance baseline at 1/k for the reference column's k classes", () => {
    const plan = validateHostedPlan(
      "Multiclass classification",
      planFromForm(
        "Multiclass classification",
        ["performance"],
        { ...thresholds, minimumMacroF1: 0.6 },
        defaultPlanForm,
        3,
      ),
    );
    expect(plan.criteria[0].members![1]).toEqual({
      metric: "balanced_accuracy",
      band: { lower: 1 / 3, upper: null },
    });
    // Without the class count the plan cannot state its baseline.
    expect(() =>
      validateHostedPlan(
        "Multiclass classification",
        planFromForm(
          "Multiclass classification",
          ["performance"],
          thresholds,
          defaultPlanForm,
          null,
        ),
      ),
    ).toThrow(/1\/k/);
  });

  it("freezes power assumptions and computes the approval check from them", () => {
    const plan = validateHostedPlan(
      "Binary classification",
      planFromForm(
        "Binary classification",
        ["demographic_parity"],
        { ...thresholds, maximumParityGap: 0.1 },
        {
          ...defaultPlanForm,
          powerAssumptions: {
            demographic_parity: {
              groupSizes: { G1: 388, G2: 388 },
              baselineRate: 0.5,
            },
          },
        },
        null,
      ),
    );
    const power = criterionPower(
      plan.criteria[0],
      plan.confidenceLevel,
      plan.power.targetPower,
      1,
      plan.minimums,
    );
    expect(power.status).toBe("computed");
    expect(power.passProbability).toBeGreaterThan(0);
    expect(power.requiredGroupSizeForPass).toBeGreaterThan(388);
  });

  it("rejects hosted plans the hosted runner cannot evaluate", () => {
    expect(() =>
      validateHostedPlan("Regression", {
        criteria: [
          {
            id: "p",
            kind: "performance",
            members: [{ metric: "accuracy", band: { lower: 0.8 } }],
          },
        ],
      }),
    ).toThrow(/not available for Regression/);
  });

  it("decides a clustered plan by the cluster bootstrap, as the engine does (#136)", () => {
    const plan = validateHostedPlan("Binary classification", {
      clusterField: "person",
      criteria: [
        {
          id: "recall-minimum",
          kind: "performance",
          members: [
            { metric: "recall", band: { lower: 0.7 } },
            { metric: "balanced_accuracy", band: { lower: 0.5 } },
          ],
        },
        {
          id: "parity",
          kind: "group_comparison",
          metric: "selection_rate_difference",
          band: { lower: -0.2, upper: 0.2 },
        },
      ],
    });
    expect(plan.clusterField).toBe("person");
    // 40 people with 3 positive and 3 negative rows; every fifth person's positives are all missed.
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < 40; i++)
      for (let r = 0; r < 6; r++)
        rows.push({
          label: r < 3 ? "1" : "0",
          prediction: r < 3 && i % 5 !== 0 ? "1" : "0",
          group: i < 20 ? "A" : "B",
          person: ` p${String(i).padStart(2, "0")} `,
        });
    const columns = {
      labelColumn: "label",
      predictionColumn: "prediction",
      groupColumn: "group",
      positiveLabel: "1",
      negativeLabel: "0",
    };
    const run = (seed: number) =>
      evaluateHostedPlan(plan, rows, columns, "Binary classification", seed);
    const { evaluation, results } = run(1729);
    const recall = evaluation.criteria[0].members[0];
    expect(recall.interval?.method).toBe("cluster_percentile_bootstrap");
    expect(recall.bootstrap).toEqual({
      replicates: 2000,
      validReplicates: 2000,
      clusters: 40,
    });
    // Recall 0.8 with independent rows would pass 0.70; with people as the unit it does not.
    expect(evaluation.criteria[0].outcome).toBe("inconclusive");
    expect(evaluation.criteria[0].decision.reasons).toContain(
      "interval_straddles_band",
    );
    const metric = results[0].metrics.find((m) => m.name === "recall")!;
    expect((metric.details as { bootstrap: unknown }).bootstrap).toEqual(
      recall.bootstrap,
    );
    expect(results[0].limitations).toContain(
      "Rows are clustered by 'person': every member and descriptive interval is a cluster percentile bootstrap over 40 clusters (2000 replicates, seed 1729). The per-group rates are cluster percentile intervals too.",
    );
    for (const view of evaluation.criteria[1].groups!)
      expect(view.selection!.interval!.method).toBe(
        "cluster_percentile_bootstrap",
      );
    // The run seed draws the replicates: the same seed repeats, another differs.
    expect(run(1729).evaluation.criteria[0].members[0].interval).toEqual(
      recall.interval,
    );
    expect(run(7).evaluation.criteria[0].members[0].interval).not.toEqual(
      recall.interval,
    );
    // Every evaluated row needs a cluster id.
    const blank = rows.map((r, i) => (i === 3 ? { ...r, person: " " } : r));
    expect(() =>
      evaluateHostedPlan(plan, blank, columns, "Binary classification"),
    ).toThrow(/needs a cluster id in column 'person'/);
    expect(() =>
      evaluateHostedPlan(
        plan,
        rows.map(({ person: _, ...r }) => r),
        columns,
        "Binary classification",
      ),
    ).toThrow(/Required column missing: person/);
  });

  it("explains the clustered and bootstrap reason codes in plain language", () => {
    for (const code of [
      "small_cell_clustered",
      "below_minimum_cluster_count",
      "bootstrap_insufficient_valid_replicates",
      "bootstrap_budget_exceeded",
      "clustered_design_requires_engine",
      "interval_requires_engine",
    ])
      expect(REASON_TEXT[code], code).toMatch(/\w{4}.*\./);
  });

  it("compares the intersectional strata of several group columns (#30)", () => {
    const plan = validateHostedPlan("Binary classification", {
      criteria: [
        {
          id: "g",
          kind: "group_comparison",
          metric: "selection_rate_difference",
          band: { lower: -0.2, upper: 0.2 },
          groupFields: ["sex", "race"],
          minimumCoverage: 0.9,
        },
      ],
    });
    expect(planGroupFields(plan)).toEqual(["sex", "race"]);
    const rows: Record<string, string>[] = [];
    const add = (sex: string, race: string, selected: number, n: number) => {
      for (let i = 0; i < n; i++)
        rows.push({
          sex,
          race,
          label: i < selected ? "1" : "0",
          prediction: i < selected ? "1" : "0",
          group: sex,
        });
    };
    add("F", "A", 20, 40);
    add("F", "B", 18, 40);
    add("M", "A", 22, 40);
    add("M", "B", 21, 40);
    add("M", " ", 2, 5);
    const columns = {
      labelColumn: "label",
      predictionColumn: "prediction",
      groupColumn: "group",
      positiveLabel: "1",
      negativeLabel: "0",
    };
    const { evaluation, results } = evaluateHostedPlan(
      plan,
      rows,
      columns,
      "Binary classification",
    );
    const c = evaluation.criteria[0];
    // Labels are the engine's: a compact JSON array, in code-point order.
    expect(c.groups!.map((g) => [g.group, g.n])).toEqual([
      ['["F","A"]', 40],
      ['["F","B"]', 40],
      ['["M","A"]', 40],
      ['["M","B"]', 40],
    ]);
    expect(c.decision.coverage).toMatchObject({
      unknownGroupRows: 5,
      populationRows: 165,
    });
    expect(results).toHaveLength(1);
    expect(stratumOf({ a: "x", b: "" }, ["a", "b"])).toBeNull();
    expect(stratumOf({ a: " x " }, ["a"])).toBe("x");
    expect(() =>
      evaluateHostedPlan(
        plan,
        rows.map(({ race: _race, ...r }) => r),
        columns,
        "Binary classification",
      ),
    ).toThrow(/Required column missing: race/);
  });
});

describe("external requests", () => {
  it("expect the plan's criteria for engineConfig 1.4 and the suite for 1.1", () => {
    expect(
      requestedCriteria({
        profile: { suite: ["performance", "demographic_parity"] },
        engineConfig: {
          task: "Binary classification",
          statistics: {
            criteria: [
              { id: "gate", kind: "performance" },
              { id: "parity", kind: "group_comparison" },
            ] as never,
          },
        },
      }),
    ).toEqual([
      { id: "gate", kind: "performance" },
      { id: "parity", kind: "group_comparison" },
    ]);
    expect(
      requestedCriteria({
        profile: { suite: ["performance"] },
        engineConfig: { task: "Multiclass classification" },
      }),
    ).toEqual([{ id: "performance", kind: "multiclass_performance" }]);
  });
});

describe("plain-language explanations", () => {
  const groupResult = (outcome: Result["outcome"], n: number): Result => ({
    testId: "demographic_parity",
    label: "Demographic parity",
    article: "10",
    outcome,
    limitations: [],
    metrics: [
      {
        name: "maximum_selection_rate_gap",
        value: 0.1,
        unit: "ratio",
        sampleSize: 2 * n,
        confidenceInterval: {
          lower: 0.02,
          upper: 0.3,
          level: 0.95,
          method: "worst_member_bounds",
        },
        slices: [
          { slice: "A", n, suppressed: false },
          { slice: "B", n, suppressed: false },
        ],
        details: { role: "headline", band: { lower: null, upper: 0.1 } },
      },
    ],
    decision: {
      confidenceLevel: 0.95,
      reasons: ["interval_straddles_band"],
      sampleSize: 2 * n,
    } as never,
  });

  it("say when a small sample cannot tell a gap from noise", () => {
    expect(explainResult(groupResult("inconclusive", 40))).toBe(
      "With 40 people in the smallest compared group, the 95% interval runs from 2 points to 30 points, so this test cannot tell whether the gap is within 10 points or beyond it.",
    );
  });
});
