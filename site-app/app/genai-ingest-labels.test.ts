import { describe, expect, it } from "vitest";
import {
  bundleOptionLabel,
  count,
  planOptionLabel,
} from "./genai-ingest-labels";

it("pluralises the GenAI tab's counts", () => {
  expect(count(1, "frozen plan")).toBe("1 frozen plan");
  expect(count(0, "declared bundle")).toBe("0 declared bundles");
  expect(count(2, "criterion", "criteria")).toBe("2 criteria");
});

const procedures = [
  { id: "PROC-1", templateId: "WP-GA-01", title: "Accuracy of answers" },
];

describe("Queue ingest labels (#211)", () => {
  it("labels a frozen plan by its procedure, criteria and date, not its id", () => {
    const plan = {
      procedureId: "PROC-1",
      createdAt: "2026-11-03T09:00:00.000Z",
      plan: { criteria: [{ id: "C1" }, { id: "C2" }] },
    };
    expect(planOptionLabel(plan, procedures)).toBe(
      "WP-GA-01 Accuracy of answers · 2 criteria · 2026-11-03",
    );
    expect(
      planOptionLabel(
        { ...plan, plan: { criteria: [{ id: "C1" }] } },
        procedures,
      ),
    ).toBe("WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-03");
    // A procedure no longer in scope still reads as a label.
    expect(
      planOptionLabel({ ...plan, procedureId: "PROC-X" }, procedures),
    ).toBe("GenAI plan · 2 criteria · 2026-11-03");
  });

  it("labels a declared bundle by its input names and date, not its id", () => {
    const at = "2026-11-04T10:00:00.000Z";
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "judged_qa_30.eval" }, { name: "judge.jsonl" }],
        inputArtifactIds: ["EV-1", "EV-2"],
      }),
    ).toBe("judged_qa_30.eval, judge.jsonl · 2026-11-04");
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "a.eval" }, { name: "b.eval" }, { name: "c.jsonl" }],
        inputArtifactIds: ["EV-1", "EV-2", "EV-3"],
      }),
    ).toBe("a.eval, b.eval and 1 more input · 2026-11-04");
    // Unnamed inputs: the count.
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ sha256: "a" }, { sha256: "b" }],
        inputArtifactIds: ["EV-1", "EV-2"],
      }),
    ).toBe("2 inputs · 2026-11-04");
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "only.eval" }],
        inputArtifactIds: ["EV-1"],
      }),
    ).not.toContain("EV-1");
  });
});
