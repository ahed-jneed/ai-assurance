import { describe, expect, it } from "vitest";
import { jobName, modeLabel } from "./assurance-workbench/types";
import {
  bundleOptionLabel,
  distinctOptions,
  planOptionLabel,
} from "./genai-ingest-labels";

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
      "WP-GA-01 Accuracy of answers · 2 criteria · 2026-11-03 09:00",
    );
    expect(
      planOptionLabel(
        { ...plan, plan: { criteria: [{ id: "C1" }] } },
        procedures,
      ),
    ).toBe("WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-03 09:00");
    // A procedure no longer in scope still reads as a label.
    expect(
      planOptionLabel({ ...plan, procedureId: "PROC-X" }, procedures),
    ).toBe("GenAI plan · 2 criteria · 2026-11-03 09:00");
  });

  it("labels a declared bundle by its input names and date, not its id", () => {
    const at = "2026-11-04T10:00:00.000Z";
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "judged_qa_30.eval" }, { name: "judge.jsonl" }],
        inputArtifactIds: ["EV-1", "EV-2"],
      }),
    ).toBe("judged_qa_30.eval, judge.jsonl · 2026-11-04 10:00");
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "a.eval" }, { name: "b.eval" }, { name: "c.jsonl" }],
        inputArtifactIds: ["EV-1", "EV-2", "EV-3"],
      }),
    ).toBe("a.eval, b.eval and 1 more input · 2026-11-04 10:00");
    // Unnamed inputs: the count.
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ sha256: "a" }, { sha256: "b" }],
        inputArtifactIds: ["EV-1", "EV-2"],
      }),
    ).toBe("2 inputs · 2026-11-04 10:00");
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "only.eval" }],
        inputArtifactIds: ["EV-1"],
      }),
    ).not.toContain("EV-1");
  });
});

describe("same-day Queue ingest labels (#221)", () => {
  const plan = (id: string, createdAt: string) => ({
    id,
    procedureId: "PROC-1",
    createdAt,
    plan: { criteria: [{ id: "C1" }] },
  });

  it("tells two plans of one day apart by their time", () => {
    const options = distinctOptions(
      [
        plan("GP-aaaaaa111111", "2026-11-03T09:00:00.000Z"),
        plan("GP-bbbbbb222222", "2026-11-03T14:30:00.000Z"),
      ],
      (p) => planOptionLabel(p, procedures),
    );
    expect(options).toEqual([
      {
        value: "GP-aaaaaa111111",
        label: "WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-03 09:00",
      },
      {
        value: "GP-bbbbbb222222",
        label: "WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-03 14:30",
      },
    ]);
  });

  it("adds a short id suffix only to labels that still collide", () => {
    const at = "2026-11-03T09:00:20.000Z";
    const options = distinctOptions(
      [
        plan("GP-aaaaaa111111", at),
        plan("GP-bbbbbb222222", "2026-11-03T09:00:50.000Z"),
        plan("GP-cccccc333333", "2026-11-04T08:00:00.000Z"),
      ],
      (p) => planOptionLabel(p, procedures),
    );
    expect(options.map((o) => o.label)).toEqual([
      "WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-03 09:00 · 111111",
      "WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-03 09:00 · 222222",
      "WP-GA-01 Accuracy of answers · 1 criterion · 2026-11-04 08:00",
    ]);
    const bundle = (id: string) => ({
      id,
      createdAt: at,
      inputs: [{ name: "a.eval" }],
      inputArtifactIds: ["EV-1"],
    });
    expect(
      distinctOptions(
        [bundle("GB-000000aaaaaa"), bundle("GB-000000bbbbbb")],
        bundleOptionLabel,
      ).map((o) => o.label),
    ).toEqual([
      "a.eval · 2026-11-03 09:00 · aaaaaa",
      "a.eval · 2026-11-03 09:00 · bbbbbb",
    ]);
  });
});

describe("GenAI ingest job names (#221)", () => {
  const job = {
    mode: "genai_ingest",
    system_name: null,
    procedure_id: "PROC-1",
    plan_criteria: 2,
    plan_created_at: "2026-11-03T09:15:00.000Z",
  };
  it("names an ingest job by its plan's label, never null or a bare id", () => {
    expect(jobName(job, procedures)).toBe(
      "WP-GA-01 Accuracy of answers · 2 criteria · 2026-11-03 09:15",
    );
    expect(
      jobName(
        {
          ...job,
          procedure_id: null,
          plan_criteria: null,
          plan_created_at: null,
        },
        procedures,
      ),
    ).toBe("GenAI plan");
    expect(modeLabel("genai_ingest")).toBe("GenAI ingest");
  });
  it("names any other job by its system", () => {
    expect(
      jobName(
        { ...job, mode: "provided_predictions", system_name: "Credit" },
        [],
      ),
    ).toBe("Credit");
    expect(modeLabel("provided_predictions")).toBe("provided predictions");
  });
});
