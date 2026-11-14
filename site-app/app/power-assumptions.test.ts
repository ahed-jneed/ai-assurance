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

  it("gives the engine's macro F1 and macro precision numbers (#152)", () => {
    // engine/tests/test_multiclass_power.py: the same criterion with both
    // macro members, under the even-spread assumption of section 8.
    const out = evaluatePower({
      ...SHARED,
      criterion: {
        ...SHARED.criterion,
        members: [
          ...SHARED.criterion.members,
          { metric: "macro_f1", band: { lower: 0.7, upper: null } },
          { metric: "macro_precision", band: { lower: 0.7, upper: null } },
        ],
      },
    }) as CriterionPower;
    expect(out.status).toBe("computed");
    expect(out.passProbability).toBe(0);
    expect(out.passProbabilityUpperBound).toBeCloseTo(0.07755466798616595, 12);
    expect(out.requiredNForPass).toBe(969);
    expect(
      out.members.slice(2).map((m) => [m.assumedValue, m.passProbability]),
    ).toEqual([
      [
        expect.closeTo(0.7800613945479498, 12),
        expect.closeTo(0.3629895303213081, 12),
      ],
      [
        expect.closeTo(0.777158419950862, 12),
        expect.closeTo(0.07755466798616595, 12),
      ],
    ]);
    expect(out.members[3].denominator).toEqual({
      perClass: {
        a: expect.closeTo(145.5, 9),
        b: expect.closeTo(92.25, 9),
        c: expect.closeTo(62.25, 9),
      },
    });
    expect(powerSentence(out, 0.8)).toContain(
      "For macro F1 and macro precision the check assumes that each class's errors are spread evenly over the other classes.",
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

  it("states one probability when the bounds are equal, and why a pass is blocked (#211)", () => {
    const plan = (groupSizes: Record<string, number>) =>
      power(
        labPlan("Binary classification", ["demographic_parity"], {
          demographic_parity: { groupSizes, baselineRate: 0.5 },
        }),
      );
    // One comparison: the lower and upper bounds are the same number.
    const one = plan({ A: 500, B: 500 });
    expect(one.passProbability).toBe(one.passProbabilityUpperBound);
    expect(one.passProbability!).toBeGreaterThan(0);
    const sentence = powerSentence(one, 0.8);
    expect(sentence).toMatch(
      /^If the assumptions hold, a system meeting them would pass with probability \d+%\./,
    );
    expect(sentence).not.toContain("between");
    expect(sentence).not.toContain("cannot pass");
    // 20 planned rows: below the minimum sample size of 30, and neither group
    // reaches the minimum group size, so no pair is compared (no members,
    // null bounds) and the reasons block the pass. It passes with
    // probability 0, and the sentence says why.
    const blocked = plan({ A: 10, B: 10 });
    expect(blocked.status).toBe("computed");
    expect(blocked.members).toEqual([]);
    expect([
      blocked.passProbability,
      blocked.passProbabilityUpperBound,
    ]).toEqual([null, null]);
    expect(blocked.reasons).toEqual(
      expect.arrayContaining([
        "below_minimum_sample_size",
        "insufficient_groups",
      ]),
    );
    const words = powerSentence(blocked, 0.8);
    expect(words).toContain("would pass with probability 0%.");
    expect(words).not.toContain("between 0% and 0%");
    expect(words).toContain(
      "It cannot pass at the planned size because the planned rows are fewer than the minimum sample size, the groups large enough to compare cover less of the data than the criterion requires and fewer than two groups (or not the reference group) reach the minimum group size.",
    );
    // A blocked pass with members (bounds exactly 0) reads the same way.
    expect(
      powerSentence(
        {
          ...one,
          passProbability: 0,
          passProbabilityUpperBound: 0,
          reasons: ["below_minimum_sample_size"],
        },
        0.8,
      ),
    ).toContain(
      "would pass with probability 0%. It cannot pass at the planned size because the planned rows are fewer than the minimum sample size.",
    );
    // Distinct bounds still read as a range.
    expect(
      powerSentence(
        { ...one, passProbability: 0.4, passProbabilityUpperBound: 0.6 },
        0.8,
      ),
    ).toContain("would pass with probability between 40% and 60%.");
    // A group criterion's required size counts rows in each group (#216).
    expect(
      powerSentence(
        {
          ...one,
          passProbability: 0.4,
          passProbabilityUpperBound: 0.4,
          requiredGroupSizeForPass: 1200,
        },
        0.8,
      ),
    ).toContain("Reaching 80% needs about 1,200 rows per group.");
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
    // The lab's plan keeps macro F1, which has a power formula since #152
    // (GC-43): every member is computed, so is the criterion, and the
    // sentence names the even-spread assumption.
    const withPower = labPlan(
      "Multiclass classification",
      ["performance"],
      { performance: made.value },
      3,
    );
    const result = power(withPower);
    expect(result.status).toBe("computed");
    expect(result.members.map((m) => [m.metric, m.status])).toEqual([
      ["accuracy", "computed"],
      ["balanced_accuracy", "computed"],
      ["macro_f1", "computed"],
    ]);
    expect(powerSentence(result, 0.8)).toMatch(
      /^If the assumptions hold, a system meeting them would pass with probability (between \d+% and )?\d+%\.( Reaching 80% needs about [\d,]+ rows\.)? For macro F1 the check assumes that each class's errors are spread evenly over the other classes\.$/,
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
