import { describe, expect, it } from "vitest";
import {
  defaultPlanForm,
  planFromForm,
  validateHostedPlan,
} from "@/lib/hosted-statistics";
import {
  criterionPower,
  evaluatePower,
  type CriterionPower,
  StatisticsError,
  type Plan,
} from "@/lib/statistics";
import {
  assumptionsFor,
  classKeys,
  fieldsFor,
  inputsFrom,
  plannedText,
  powerSentence,
  type Planned,
} from "./power-assumptions";

const thresholds = {
  minimumSampleSize: 30,
  minimumClassCount: 10,
  minimumGroupSize: 30,
  maximumParityGap: 0.1,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.75,
  minimumMacroF1: 0.7,
};

function labPlan(
  task: string,
  suite: string[],
  powerAssumptions: Record<string, unknown> = {},
  classCount: number | null = null,
) {
  return validateHostedPlan(
    task,
    planFromForm(
      task,
      suite,
      thresholds,
      { ...defaultPlanForm, powerAssumptions },
      classCount,
    ),
  );
}
const power = (plan: Plan, c = plan.criteria[0]) =>
  criterionPower(c, plan.confidenceLevel, 0.8, 1, plan.minimums);

// engine/tests/test_multiclass_power.py runs the same criterion through
// engine/statistics.py and expects the same numbers.
const SHARED = {
  kind: "criterion",
  criterion: {
    id: "performance",
    kind: "multiclass_performance",
    members: [
      { metric: "accuracy", band: { lower: 0.75, upper: null } },
      { metric: "balanced_accuracy", band: { lower: 0.7, upper: null } },
    ],
    powerAssumptions: {
      n: 300,
      classShares: { a: 0.5, b: 0.3, c: 0.2 },
      perClassRecall: { a: 0.85, b: 0.8, c: 0.7 },
    },
  },
};

describe("multiclass power assumptions in both runners", () => {
  it("gives the engine's numbers for per-class shares and recalls", () => {
    const out = evaluatePower(SHARED) as CriterionPower;
    expect(out.status).toBe("computed");
    expect(out.reasons).toEqual([]);
    expect(out.passProbability).toBeCloseTo(0.4948113668931178, 12);
    expect(out.passProbabilityUpperBound).toBeCloseTo(0.6034697048198907, 12);
    expect(out.requiredNForPass).toBe(483);
    expect(out.members.map((m) => [m.assumedValue, m.passProbability])).toEqual(
      [
        [expect.closeTo(0.805, 12), expect.closeTo(0.6034697048198907, 12)],
        [
          expect.closeTo(0.7833333333333333, 12),
          expect.closeTo(0.8913416620732271, 12),
        ],
      ],
    );
  });

  it("refuses assumptions that miss a class or give one no share", () => {
    const withAssumptions = (changes: Record<string, unknown>) => ({
      ...SHARED,
      criterion: {
        ...SHARED.criterion,
        powerAssumptions: { ...SHARED.criterion.powerAssumptions, ...changes },
      },
    });
    for (const [changes, message] of [
      [
        { perClassRecall: { a: 0.85, b: 0.8 } },
        "perClassRecall must name exactly the classes of classShares",
      ],
      [
        { perClassRecall: { a: 0.85, b: 0.8, c: 0.7, d: 0.9 } },
        "perClassRecall must name exactly the classes of classShares",
      ],
      [
        { classShares: { a: 0.8, b: 0.2, c: 0 } },
        "every class share must be above 0",
      ],
    ] as const)
      expect(() => evaluatePower(withAssumptions(changes))).toThrow(
        new StatisticsError(message),
      );
  });
});

describe("the testing lab's power inputs", () => {
  const planned = (over: Partial<Planned> = {}): Planned => ({
    rows: 1000,
    groupSizes: null,
    classes: null,
    ...over,
  });

  it("plans group criteria with the dataset's real group sizes", () => {
    const plan = labPlan("Binary classification", ["demographic_parity"]);
    const sizes = { A: 900, B: 100 };
    const made = assumptionsFor(
      plan.criteria[0],
      { baselineRate: "0.5" },
      planned({ groupSizes: sizes }),
    );
    expect(made).toEqual({
      value: { groupSizes: sizes, baselineRate: 0.5 },
      problem: "",
    });
    const real = power(
      labPlan("Binary classification", ["demographic_parity"], {
        demographic_parity: made.value,
      }),
    );
    const equal = power(
      labPlan("Binary classification", ["demographic_parity"], {
        demographic_parity: {
          groupSizes: { A: 500, B: 500 },
          baselineRate: 0.5,
        },
      }),
    );
    // 100 people in the smaller group make the screen much less likely to
    // pass than an equal split of the same 1,000 rows suggested.
    expect(real.members[0]).toMatchObject({
      subject: "A",
      comparator: "B",
      denominator: { subject: 900, comparator: 100 },
    });
    expect(real.passProbability!).toBeLessThan(equal.passProbability! - 0.3);
    expect(plannedText(planned({ groupSizes: sizes }), true)).toBe(
      "1,000 rows; rows per group: A 900, B 100",
    );
  });

  it("waits for the group sizes and needs two groups", () => {
    const [c] = labPlan("Binary classification", ["disparate_impact"]).criteria;
    expect(assumptionsFor(c, { baselineRate: "0.5" }, planned())).toEqual({
      value: null,
      problem: "Reading the group sizes from the dataset…",
    });
    expect(
      assumptionsFor(
        c,
        { baselineRate: "0.5" },
        planned({ unavailable: "Too many groups." }),
      ).problem,
    ).toBe("Too many groups.");
    expect(
      assumptionsFor(
        c,
        { baselineRate: "0.5" },
        planned({ groupSizes: { A: 1000 } }),
      ).problem,
    ).toMatch(/fewer than two groups/);
  });

  it("asks a share and a recall for every class of the target column", () => {
    const plan = labPlan("Multiclass classification", ["performance"], {}, 3);
    const c = plan.criteria[0];
    const sized = planned({ classes: ["a", "b", "c"] });
    expect(fieldsFor(c, sized).map((f) => f.label)).toEqual([
      "Assumed share of class a",
      "Assumed true recall of class a",
      "Assumed share of class b",
      "Assumed true recall of class b",
      "Assumed share of class c",
      "Assumed true recall of class c",
    ]);
    const inputs = Object.fromEntries(
      ["a", "b", "c"].flatMap((l) => [
        [classKeys(l).share, "0.333"],
        [classKeys(l).recall, "0.9"],
      ]),
    );
    const made = assumptionsFor(c, inputs, sized);
    expect(made.problem).toBe("");
    // Rounded shares are scaled to sum to 1, as the plan requires.
    const shares = (made.value as { classShares: Record<string, number> })
      .classShares;
    expect(Object.values(shares).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
    expect(made.value).toMatchObject({
      n: 1000,
      perClassRecall: { a: 0.9, b: 0.9, c: 0.9 },
    });
    // The lab's plan keeps macro F1, which has no power formula in 1.0.0
    // (GC-43): the criterion is not computed, but accuracy and balanced
    // accuracy are, and the sentence reports them.
    const withPower = labPlan(
      "Multiclass classification",
      ["performance"],
      { performance: made.value },
      3,
    );
    const result = power(withPower);
    expect(result.status).toBe("not_computed");
    expect(result.members.map((m) => [m.metric, m.status])).toEqual([
      ["accuracy", "computed"],
      ["balanced_accuracy", "computed"],
      ["macro_f1", "not_computed"],
    ]);
    expect(powerSentence(result, 0.8)).toMatch(
      /^Power is not computed \(member power not computed\): statistics 1\.0\.0 has no power formula for macro F1\. If the assumptions hold, accuracy would pass with probability \d+%, balanced accuracy would pass with probability \d+%\.$/,
    );
  });

  it("explains shares that do not add up and values out of range", () => {
    const [c] = labPlan(
      "Multiclass classification",
      ["performance"],
      {},
      2,
    ).criteria;
    const sized = planned({ classes: ["x", "y"] });
    const entries = (sx: string, sy: string, recall = "0.8") => ({
      [classKeys("x").share]: sx,
      [classKeys("y").share]: sy,
      [classKeys("x").recall]: recall,
      [classKeys("y").recall]: recall,
    });
    expect(assumptionsFor(c, entries("0.6", "0.6"), sized).problem).toBe(
      "The assumed class shares add up to 120%; they must add up to 100%.",
    );
    expect(assumptionsFor(c, entries("1", "0"), sized).problem).toBe(
      "Every class needs an assumed share above 0.",
    );
    expect(assumptionsFor(c, entries("0.5", "0.5", "1.2"), sized).problem).toBe(
      "Assumed true recall of class x must lie between 0 and 1.",
    );
    expect(assumptionsFor(c, entries("0.5", ""), sized)).toEqual({
      value: null,
      problem: "",
    });
  });

  it("refills the inputs from stored assumptions", () => {
    expect(
      inputsFrom({
        n: 300,
        classShares: { a: 0.5, b: 0.5 },
        perClassRecall: { a: 0.9, b: 0.8 },
      }),
    ).toEqual({
      "share:a": "0.5",
      "share:b": "0.5",
      "recall:a": "0.9",
      "recall:b": "0.8",
    });
    expect(
      inputsFrom({ groupSizes: { G1: 500, G2: 500 }, baselineRate: 0.4 }),
    ).toEqual({ baselineRate: "0.4" });
  });
});
