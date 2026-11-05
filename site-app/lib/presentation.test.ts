import { describe, expect, it } from "vitest";
import type { Result } from "./domain";
import {
  diagnosticNarrative,
  humanLabel,
  readableResults,
} from "./presentation";

const result: Result = {
  testId: "parity",
  label: "Demographic parity",
  outcome: "pass",
  article: "10",
  metrics: [
    { name: "maximumParityGap", value: 0.04321, unit: "", sampleSize: 120 },
    { name: "impact_ratio", value: null, unit: "", sampleSize: 3 },
  ],
  limitations: ["Small minority group"],
};

describe("humanLabel", () => {
  it("uses the curated names for known fields", () => {
    expect(humanLabel("evidenceIds")).toBe("Linked evidence");
    expect(humanLabel("sampleSize")).toBe("Rows");
  });

  it("turns camelCase and snake_case keys into sentence case", () => {
    expect(humanLabel("riskScore")).toBe("Risk Score");
    expect(humanLabel("not_applicable")).toBe("Not applicable");
    expect(humanLabel("sha256")).toBe("SHA-256");
  });
});

describe("diagnostic narratives", () => {
  it("renders outcomes, metrics, unestimable values and limitations", () => {
    expect(diagnosticNarrative([result])).toBe(
      [
        "Demographic parity — Pass",
        "Article 10",
        "Maximum parity gap: 0.0432 (n = 120)",
        "Impact ratio: Not estimable (n = 3)",
        "Limitation: Small minority group",
      ].join("\n"),
    );
  });

  it("narrates stored JSON results and leaves other text untouched", () => {
    expect(readableResults(JSON.stringify([result]))).toBe(
      diagnosticNarrative([result]),
    );
    expect(readableResults("Recorded tests")).toBe("Recorded tests");
    expect(readableResults('[{"label": 1}]')).toBe('[{"label": 1}]');
  });
});
