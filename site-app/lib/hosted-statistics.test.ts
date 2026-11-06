import { describe, expect, it } from "vitest";
import type { Result } from "./domain";
import {
  defaultPlanForm,
  describePlan,
  explainResult,
  formFromPlan,
  planFromForm,
  planSuite,
  requestedCriteria,
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
      validateHostedPlan("Binary classification", {
        clusterField: "person",
        criteria: [
          {
            id: "p",
            kind: "performance",
            members: [{ metric: "accuracy", band: { lower: 0.8 } }],
          },
        ],
      }),
    ).toThrow(/cluster/);
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
    expect(() =>
      validateHostedPlan("Binary classification", {
        criteria: [
          {
            id: "g",
            kind: "group_comparison",
            metric: "selection_rate_difference",
            band: { lower: -0.1, upper: 0.1 },
            groupFields: ["sex", "race"],
          },
        ],
      }),
    ).toThrow(/#30/);
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
