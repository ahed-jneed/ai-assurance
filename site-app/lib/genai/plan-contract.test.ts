// The genai-plan/0.1 contract with the engine (#248): the workspace's check
// before it freezes a plan (plan-check.ts) and the engine's normalize_plan
// (engine/genai/plan.py) agree on the shared cases of
// engine/tests/fixtures/genai/plan-contract.json, which
// engine/tests/test_genai_plan_contract.py runs on the engine side. The
// vocabularies here are compared with the engine's source, so a new metric
// or key in the engine fails this test until the workspace knows it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CRITERION_KEYS,
  CRITERION_KINDS,
  EXCERPTS,
  GENAI_PLAN_TEMPLATE,
  GROUP_BY,
  ITEM_TYPES,
  MARKING_METRICS,
  MEAN_METRICS,
  PLAN_FLOORS,
  PLAN_KEYS,
  REDUCERS,
  STATISTICS_VERSION,
  genaiPlanProblems,
} from "./plan-check";
import { genaiPlan } from "./requests";

const engine = (path: string) =>
  readFileSync(
    new URL("../../../engine/" + path, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
const planSource = engine("genai/plan.py");
const contract = JSON.parse(
  engine("tests/fixtures/genai/plan-contract.json"),
) as {
  valid: { name: string; plan: Record<string, unknown> }[];
  invalid: {
    name: string;
    criterion: string | null;
    plan: Record<string, unknown>;
  }[];
};

/** The quoted strings of a Python tuple assignment in plan.py. */
const tuple = (source: string, pattern: RegExp) =>
  [...pattern.exec(source)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe("the plan contract shared with the engine", () => {
  it.each(contract.valid.map((c) => [c.name, c.plan] as const))(
    "accepts the valid plan %s, as the engine does",
    (_, plan) => {
      expect(genaiPlanProblems(plan)).toEqual([]);
      expect(genaiPlan.safeParse(plan).success).toBe(true);
    },
  );

  it.each(contract.invalid.map((c) => [c.name, c] as const))(
    "refuses the invalid plan %s, as the engine does, naming the criterion",
    (_, c) => {
      const problems = genaiPlanProblems(c.plan);
      expect(problems.length).toBeGreaterThan(0);
      expect(genaiPlan.safeParse(c.plan).success).toBe(false);
      if (c.criterion)
        expect(problems.join("\n")).toContain("Criterion " + c.criterion);
    },
  );

  it("starts the Freeze plan dialog from a plan the engine accepts", () => {
    expect(
      contract.valid.find((c) => c.name === "default-template")!.plan,
    ).toEqual(GENAI_PLAN_TEMPLATE);
    expect(genaiPlanProblems(GENAI_PLAN_TEMPLATE)).toEqual([]);
  });

  it("names the criterion without a band and how to write one", () => {
    expect(
      genaiPlanProblems({
        schemaVersion: "genai-plan/0.1",
        criteria: [{ id: "C1", kind: "genai_mean" }],
      }),
    ).toEqual([
      'Criterion C1 needs a band, for example "band": {"lower": 0.9}',
    ]);
  });

  it("refuses what only the workspace limits: no criteria, too many", () => {
    const criterion = (i: number) => ({
      id: "C" + i,
      kind: "genai_mean",
      band: { lower: 0.9 },
    });
    expect(
      genaiPlanProblems({ schemaVersion: "genai-plan/0.1", criteria: [] }),
    ).toEqual(["The plan needs at least one criterion"]);
    expect(
      genaiPlanProblems({
        schemaVersion: "genai-plan/0.1",
        criteria: Array.from({ length: 51 }, (_, i) => criterion(i)),
      }),
    ).toEqual(["The plan has at most 50 criteria"]);
  });

  it("uses the engine's vocabularies, keys and floors", () => {
    expect(tuple(planSource, /^CRITERION_KINDS = \(([^)]*)\)/m)).toEqual([
      ...CRITERION_KINDS,
    ]);
    expect(tuple(planSource, /^MEAN_METRICS = \(([^)]*)\)/m)).toEqual([
      ...MEAN_METRICS,
    ]);
    expect(tuple(planSource, /^GROUP_BY = \(([^)]*)\)/m)).toEqual([
      ...GROUP_BY,
    ]);
    expect(tuple(planSource, /^REDUCERS = \(([^)]*)\)/m)).toEqual([
      ...REDUCERS,
    ]);
    expect(tuple(planSource, /^MARKING_METRICS = \(([^)]*)\)/m)).toEqual([
      ...MARKING_METRICS,
    ]);
    expect(tuple(planSource, /^ITEM_TYPES = \(([^)]*)\)/m)).toEqual([
      ...ITEM_TYPES,
    ]);
    expect(tuple(planSource, /^EXCERPTS = \(([^)]*)\)/m)).toEqual([
      ...EXCERPTS,
    ]);
    expect(tuple(planSource, /allowed = \(([^)]*)\)/)).toEqual([
      ...CRITERION_KEYS,
    ]);
    // DEFAULT_PLAN's top-level keys, one per line.
    const defaults = /^DEFAULT_PLAN = \{\n([\s\S]*?)\n\}/m.exec(planSource)![1];
    expect(
      [...defaults.matchAll(/^ {4}"([A-Za-z]+)":/gm)].map((m) => m[1]).sort(),
    ).toEqual([...PLAN_KEYS].sort());
    expect(defaults).toContain(
      `"minimums": {"sampleSize": ${PLAN_FLOORS.minimums.sampleSize}, "memberSize": ${PLAN_FLOORS.minimums.memberSize}, "clusters": ${PLAN_FLOORS.minimums.clusters}}`,
    );
    expect(defaults).toContain(
      `"maxUnscoredFraction": ${PLAN_FLOORS.maxUnscoredFraction},`,
    );
    expect(defaults).toContain(
      `"maxErrorFraction": ${PLAN_FLOORS.maxErrorFraction},`,
    );
    const jv = PLAN_FLOORS.judgeValidation;
    expect(defaults).toContain(
      `"judgeValidation": {"minimumItems": ${jv.minimumItems}, "minimumKappaLowerBound": ${jv.minimumKappaLowerBound.toFixed(2)}, "requireDifferentFamily": True, "pairwiseMinimumConsistencyLowerBound": ${jv.pairwiseMinimumConsistencyLowerBound.toFixed(2)}}`,
    );
    expect(engine("statistics.py")).toContain(
      `SPEC_VERSION = "${STATISTICS_VERSION}"`,
    );
    const categories = /^CATEGORIES = \{\n([\s\S]*?)\n\}/m.exec(
      engine("genai/taxonomy.py"),
    )![1];
    expect(
      [...categories.matchAll(/^ {4}"([a-z_]+)":/gm)].map((m) => m[1]),
    ).toEqual([...CATEGORIES]);
  });
});
