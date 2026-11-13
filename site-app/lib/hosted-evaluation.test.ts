/* eslint-disable @typescript-eslint/no-explicit-any -- the golden fixture is untyped JSON. */
// The hosted runner against the statistics 1.0.0 golden fixture and the CSV
// safeguards of saved-prediction evaluation (docs/design/audit-statistics.md,
// #22). Ported from scripts/ml-evaluation-check.mjs (#52), which transpiled
// these modules the way the Worker loads them.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { evaluate as evaluateRun, inspectCSV, parseCSV } from "./diagnostics";
import { configSchema, assertSuite } from "./evaluation";
import {
  validateHostedPlan as validatePlan,
  explainResult,
} from "./hosted-statistics";
import * as st from "./statistics";
import { GOLDEN as golden } from "./statistics.fixture";

// The results are read as the JSON the workspace stores.
const evaluate = (...args: Parameters<typeof evaluateRun>): any =>
  evaluateRun(...args);
const validateHostedPlan = (...args: Parameters<typeof validatePlan>): any =>
  validatePlan(...args);

const closeP = (a: any, b: any) => Math.abs(a - b) <= 1e-9 + 1e-5 * Math.abs(b);

const config = configSchema.parse({
  labelColumn: "actual",
  predictionColumn: "predicted",
  groupColumn: "",
  positiveLabel: "1",
  minimumGroupSize: 30,
  maximumParityGap: 0.1,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.7,
  minimumSampleSize: 30,
  minimumClassCount: 10,
  minimumRecall: 0.7,
  minimumMacroF1: 0.5,
  maximumRmse: 2,
});
const run = (
  task = "Binary classification",
  suite = ["performance"],
  extra = {},
) => ({ task, suite, config: { ...config, ...extra } });
const csv = (rows: any) =>
  "actual,predicted,group\n" +
  rows
    .flatMap(([a, p, g, n]: any) => Array(n).fill(`${a},${p},${g}`))
    .join("\n");
const good = csv([
  ["1", "1", "A", 45],
  ["1", "0", "A", 5],
  ["0", "0", "A", 45],
  ["0", "1", "A", 5],
  ["1", "1", "B", 44],
  ["1", "0", "B", 6],
  ["0", "0", "B", 46],
  ["0", "1", "B", 4],
]);

describe("hosted evaluation (ported from ml-evaluation-check)", () => {
  it("hosted statistics 1.0.0: the 52 hosted golden criteria decide as the engine does", async () => {
    // Every hosted plan case of the golden fixture decides as the engine does.
    let decided = 0;
    for (const c of golden.cases) {
      if (c.type !== "plan" || !c.runners.includes("hosted")) continue;
      const out = st.evaluatePlan(st.planFor(c), c.data);
      assert.equal(out.planSha256, c.expected.planSha256, c.id + " plan hash");
      assert.equal(out.overallOutcome, c.expected.overallOutcome, c.id);
      out.criteria.forEach((r, i) => {
        const e = c.expected.criteria[i];
        assert.equal(r.outcome, e.outcome, `${c.id} ${r.id} outcome`);
        assert(
          closeP(r.decision.pValue, e.decision.pValue),
          `${c.id} ${r.id} p`,
        );
        assert(
          closeP(r.decision.adjustedPValue, e.decision.adjustedPValue),
          `${c.id} ${r.id} adjusted p`,
        );
        assert.equal(r.decision.decidingMemberId, e.decision.decidingMemberId);
        decided++;
      });
    }
    // 46 before #136, plus the clustered GC-54 to GC-57 (five criteria) and GC-59.
    assert.equal(decided, 52, "every hosted golden criterion is checked");
  });

  it("interval decisions with n and intervals, floors, chance baseline, suppression, multiclass/regression", async () => {
    // Saved-prediction evaluation decides by interval, with n and an interval for every metric.
    const binary = evaluate(run(), good);
    const [performance] = binary.results;
    assert.equal(performance.outcome, "pass");
    assert.equal(performance.decision.statisticsVersion, "1.0.0");
    assert.equal(performance.metrics[0].name, "accuracy");
    assert.equal(performance.metrics[0].numerator, 180);
    assert.equal(performance.metrics[0].denominator, 200);
    for (const m of performance.metrics)
      if (m.details.status === "evaluated")
        assert(m.confidenceInterval && m.confidenceInterval.lower <= m.value);
    assert(
      !performance.limitations.join(" ").includes("No confidence intervals"),
    );
    assert(explainResult(performance).includes("95%"));
    // A legacy profile's minimums below the floors are raised and recorded.
    assert.deepEqual(
      evaluate(
        run("Binary classification", ["performance"], {
          minimumSampleSize: 2,
          minimumClassCount: 1,
        }),
        good,
      ).evaluation.normalizedPlan.configuredMinimums,
      { sampleSize: 2, groupSize: 30, classCount: 1 },
    );
    // Too few rows: no claim either way.
    const small = evaluate(
      run(),
      csv([
        ["1", "1", "A", 8],
        ["0", "0", "A", 8],
      ]),
    );
    assert.equal(small.results[0].outcome, "inconclusive");
    assert(
      small.results[0].decision.reasons.includes("below_minimum_sample_size"),
    );
    // A constant majority-class prediction never passes: balanced accuracy sits on its chance baseline.
    const constant = evaluate(
      run(),
      csv([
        ["1", "1", "A", 85],
        ["0", "1", "A", 15],
      ]),
    ).results[0];
    assert.notEqual(constant.outcome, "pass");
    assert(constant.decision.reasons.includes("estimate_on_band_boundary"));
    // Group criteria compare every pair; small groups are suppressed, not voided.
    const fair = evaluate(
      run("Binary classification", ["demographic_parity", "disparate_impact"], {
        groupColumn: "group",
      }),
      good,
    ).results;
    assert.equal(fair[0].metrics[0].name, "maximum_selection_rate_gap");
    assert.equal(fair[0].metrics[0].slices.length, 2);
    assert.equal(fair[0].decision.adjustment, "bonferroni");
    assert.equal(fair[0].decision.familySize, 2);
    const suppressed = evaluate(
      run("Binary classification", ["demographic_parity"], {
        groupColumn: "group",
      }),
      csv([
        ["1", "1", "A", 50],
        ["0", "0", "A", 50],
        ["1", "1", "B", 50],
        ["0", "0", "B", 50],
        ["1", "1", "C", 5],
        ["0", "0", "C", 5],
      ]),
    ).results[0];
    assert.deepEqual(suppressed.decision.suppressedGroups, [
      { group: "C", n: 10 },
    ]);
    assert.notEqual(suppressed.outcome, "pass", "coverage 1.0 blocks a pass");
    // Multiclass and regression.
    const multi = evaluate(
      run("Multiclass classification"),
      "actual,predicted\n" +
        ["A", "B", "C"]
          .flatMap((l) => [
            ...Array(18).fill(`${l},${l}`),
            ...Array(2).fill(`${l},A`),
          ])
          .join("\n"),
    ).results[0];
    assert.equal(multi.decision.kind, "multiclass_performance");
    assert.equal(multi.metrics[1].name, "balanced_accuracy");
    assert.equal(multi.metrics[1].details.band.lower, 1 / 3);
    const reg = evaluate(
      run("Regression", ["regression"]),
      "actual,predicted\n" +
        Array.from({ length: 40 }, (_, i) => `${i},${i + (i % 3) - 1}`).join(
          "\n",
        ),
    ).results[0];
    assert.equal(reg.metrics[0].name, "rmse");
    assert.equal(reg.outcome, "pass");
    assert.equal(
      reg.metrics.find((m: any) => m.name === "r2").confidenceInterval,
      null,
    );
    // A new plan cannot lower the floors or omit the binary chance baseline silently.
    assert.throws(
      () =>
        validateHostedPlan("Binary classification", {
          minimums: { groupSize: 5 },
          criteria: [
            {
              id: "p",
              kind: "performance",
              members: [{ metric: "accuracy", band: { lower: 0.8 } }],
            },
          ],
        }),
      /floor/,
    );
    assert.equal(
      validateHostedPlan("Binary classification", {
        criteria: [
          {
            id: "p",
            kind: "performance",
            members: [{ metric: "accuracy", band: { lower: 0.8 } }],
          },
        ],
      }).criteria[0].members.at(-1).metric,
      "balanced_accuracy",
    );
  });

  it("strict mappings and bounded CSV preflight", async () => {
    assert.throws(
      () =>
        evaluate(
          run("Binary classification", ["performance"], {
            predictionColumn: "actual",
          }),
          good,
        ),
      /distinct/,
    );
    assert.throws(
      () =>
        evaluate(
          run("Binary classification", ["demographic_parity"]),
          "actual,predicted\n1,1\n0,0",
        ),
      /missing/,
    );
    assert.throws(
      () => evaluate(run(), "actual,predicted\n1,1\n\n0,0"),
      /Blank data row/,
    );
    assert.throws(
      () => evaluate(run(), "actual,predicted\n1,\n0,0"),
      /missing/,
    );
    assert.throws(
      () => evaluate(run(), "actual,predicted\n1,1\n1,1"),
      /two class labels/,
    );
    assert.throws(
      () =>
        evaluate(
          run("Regression", ["regression"]),
          "actual,predicted\n1,NaN\n2,3",
        ),
      /finite/,
    );
    assert.throws(
      () =>
        evaluate(
          run("Regression", ["regression"]),
          "actual,predicted\n1,1e101\n2,3",
        ),
      /finite/,
    );
    assert.throws(
      () =>
        evaluate(
          run("Regression", ["regression"]),
          "actual,predicted\n0x10,2\n2,3",
        ),
      /decimal/,
    );
    assert.throws(
      () => assertSuite("Regression", ["demographic_parity"]),
      /not available/,
    );
    assert.throws(
      () => assertSuite("Classical NLP", ["performance"]),
      /not available/,
    );
    assert.throws(() => parseCSV("actual,actual\n1,2"), /unique/);
    assert.throws(() => parseCSV("a,b\n1"), /mismatch/);
    assert.throws(() => parseCSV('a,b\n"1,2'), /Unclosed/);
    assert.throws(() => parseCSV('a,b\n"1"x,2'), /Unexpected/);
    assert.equal(parseCSV('a,b\n"a""b",2')[0].a, 'a"b');
    const inspection = inspectCSV(
      '﻿actual,predicted,note\r\n1,1,"comma, quote"\r\n0,0,',
    );
    assert.equal(inspection.rowCount, 2);
    assert.equal(inspection.columns[2].missing, 1);
  });
});
