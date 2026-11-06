// The binary performance cases shared with the external worker (#65):
// engine/tests/test_performance_rules.py runs the same file through
// translate_config, the engine and hosted_results. Both runners decide by
// statistics 1.0.0, so each case has one outcome and one decision.
import { describe, expect, it } from "vitest";
import golden from "../../schemas/fixtures/performance-rules-golden.json";
import { evaluate } from "./diagnostics";
import type { EvaluationConfig, Run } from "./domain";
import { performanceBaselines } from "./evaluation";

describe("shared performance golden cases", () => {
  it("covers every outcome", () => {
    expect(new Set(golden.cases.map((c) => c.outcome))).toEqual(
      new Set(["pass", "fail", "inconclusive"]),
    );
  });

  for (const c of golden.cases)
    it(`${c.id}: the hosted runner reports the shared decision and metrics`, () => {
      const csv = [
        golden.columns.join(","),
        ...c.rows.flatMap(([actual, predicted, count]) =>
          Array<string>(Number(count)).fill(`${actual},${predicted}`),
        ),
      ].join("\n");
      const {
        results: [result],
      } = evaluate(
        {
          task: "Binary classification",
          suite: ["performance"],
          config: c.config as EvaluationConfig,
        } as Run,
        csv,
      );
      expect(result.outcome).toBe(c.outcome);
      const decision = result.decision!;
      expect({
        direction: decision.direction,
        decidingMemberId: decision.decidingMemberId,
        reasons: decision.reasons,
      }).toEqual({
        direction: c.decision.direction,
        decidingMemberId: c.decision.decidingMemberId,
        reasons: c.decision.reasons,
      });
      expect(
        Math.abs(decision.pValue! - c.decision.pValue) /
          Math.max(c.decision.pValue, 1e-300),
      ).toBeLessThan(1e-9);
      for (const [name, value] of Object.entries(c.metrics))
        expect(
          result.metrics.find((m) => m.name === name)?.value,
          name,
        ).toBeCloseTo(value, 12);
    });
});

describe("performanceBaselines", () => {
  const hosted = (version: string, task = "Binary classification") => ({
    task,
    manifest: { testDefinitionVersion: version },
  });
  const external = (version: string) => ({
    task: "Binary classification",
    externalJobId: "JOB-1",
    manifest: { testDefinitionVersion: version },
  });

  it("names the chance and majority-class baselines of hosted 2.1.0 runs", () => {
    expect(performanceBaselines(hosted("traditional-ml-2.1.0"))).toEqual([
      "Balanced accuracy above 50% (chance)",
      "Accuracy above the majority-class baseline",
    ]);
    expect(
      performanceBaselines(
        hosted("traditional-ml-2.1.0", "Multiclass classification"),
      )[0],
    ).toBe("Balanced accuracy above 1/k (chance)");
    expect(performanceBaselines(hosted("traditional-ml-2.0.3"))).toEqual([]);
    // Statistics-era hosted runs state their plan in the decision instead.
    expect(performanceBaselines(hosted("traditional-ml-3.0.0"))).toEqual([]);
    expect(performanceBaselines({ task: "Binary classification" })).toEqual([]);
  });

  it("names only the chance baseline of statistics-era external runs", () => {
    for (const version of ["2.0.0", "2.1.0"])
      expect(
        performanceBaselines(
          external("hosted-1.1-1.4-to-engine-1.3/" + version),
        ),
      ).toEqual(["Balanced accuracy above 50% (chance)"]);
    expect(
      performanceBaselines(external("hosted-1.1-to-engine-1.0/1.1.0")),
    ).toEqual([]);
  });
});
