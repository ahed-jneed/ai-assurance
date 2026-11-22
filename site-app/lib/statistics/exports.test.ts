import { describe, expect, it } from "vitest";

// lib/statistics.ts re-exports the public names of the modules in this
// folder (#272). The helpers the modules share stay internal, so the
// module's runtime exports must not grow or shrink while the code moves.
// tsc checks the 26 public types.
const PUBLIC_VALUES = [
  "BINARY_METRICS",
  "EPS",
  "FLOORS",
  "HEADLINE_NAMES",
  "ID_PATTERN",
  "LIBRARY",
  "LL144_RATE_KEYS",
  "MAX_DECISION_DRAWS",
  "MULTICLASS_METRICS",
  "PERFORMANCE_KINDS",
  "REGRESSION_METRICS",
  "SPEC_VERSION",
  "StatisticsError",
  "THRESHOLD_LIBRARY",
  "aggregate",
  "bandProblem",
  "benjaminiHochberg",
  "bonferroni",
  "chanceLevel",
  "clusterKey",
  "codePointCompare",
  "criterionBandProblem",
  "criterionPower",
  "deriveEngine",
  "deriveHosted",
  "erfc",
  "evaluateCriteria",
  "evaluateCriterion",
  "evaluateLl144",
  "evaluatePlan",
  "evaluatePower",
  "fisherGreater",
  "fisherTwoSided",
  "fsum",
  "invert",
  "jcs",
  "katz",
  "koopman",
  "memberId",
  "newcombe",
  "normalQuantile",
  "normalizeCriterion",
  "normalizePlan",
  "pFromZ",
  "phi",
  "planFor",
  "planSha256",
  "ratioMethod",
  "sha256Hex",
  "validatePlan",
  "wilson",
  "wilsonZstar",
  "zcrit",
];

describe("lib/statistics exports", () => {
  it("exports exactly the 53 public values", async () => {
    const names = Object.keys(await import("../statistics")).sort();
    expect(PUBLIC_VALUES).toHaveLength(53);
    expect(names).toEqual([...PUBLIC_VALUES].sort());
  });
});
