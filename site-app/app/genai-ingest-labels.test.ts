import { describe, expect, it } from "vitest";
import { jobName, jobNames, modeLabel } from "./assurance-workbench/types";
import {
  bundleOptionLabel,
  distinctOptions,
  planOptionLabel,
  stamp,
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
      `WP-GA-01 Accuracy of answers · 2 criteria · ${stamp("2026-11-03T09:00:00.000Z")}`,
    );
    expect(
      planOptionLabel(
        { ...plan, plan: { criteria: [{ id: "C1" }] } },
        procedures,
      ),
    ).toBe(
      `WP-GA-01 Accuracy of answers · 1 criterion · ${stamp("2026-11-03T09:00:00.000Z")}`,
    );
    // A procedure no longer in scope still reads as a label.
    expect(
      planOptionLabel({ ...plan, procedureId: "PROC-X" }, procedures),
    ).toBe(`GenAI plan · 2 criteria · ${stamp("2026-11-03T09:00:00.000Z")}`);
  });

  it("labels a declared bundle by its input names and date, not its id", () => {
    const at = "2026-11-04T10:00:00.000Z";
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "judged_qa_30.eval" }, { name: "judge.jsonl" }],
        inputArtifactIds: ["EV-1", "EV-2"],
      }),
    ).toBe(
      `judged_qa_30.eval, judge.jsonl · ${stamp("2026-11-04T10:00:00.000Z")}`,
    );
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ name: "a.eval" }, { name: "b.eval" }, { name: "c.jsonl" }],
        inputArtifactIds: ["EV-1", "EV-2", "EV-3"],
      }),
    ).toBe(
      `a.eval, b.eval and 1 more input · ${stamp("2026-11-04T10:00:00.000Z")}`,
    );
    // Unnamed inputs: the count.
    expect(
      bundleOptionLabel({
        createdAt: at,
        inputs: [{ sha256: "a" }, { sha256: "b" }],
        inputArtifactIds: ["EV-1", "EV-2"],
      }),
    ).toBe(`2 inputs · ${stamp("2026-11-04T10:00:00.000Z")}`);
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
        label: `WP-GA-01 Accuracy of answers · 1 criterion · ${stamp("2026-11-03T09:00:00.000Z")}`,
      },
      {
        value: "GP-bbbbbb222222",
        label: `WP-GA-01 Accuracy of answers · 1 criterion · ${stamp("2026-11-03T14:30:00.000Z")}`,
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
      `WP-GA-01 Accuracy of answers · 1 criterion · ${stamp("2026-11-03T09:00:00.000Z")} · 111111`,
      `WP-GA-01 Accuracy of answers · 1 criterion · ${stamp("2026-11-03T09:00:00.000Z")} · 222222`,
      `WP-GA-01 Accuracy of answers · 1 criterion · ${stamp("2026-11-04T08:00:00.000Z")}`,
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
      `a.eval · ${stamp("2026-11-03T09:00:00.000Z")} · aaaaaa`,
      `a.eval · ${stamp("2026-11-03T09:00:00.000Z")} · bbbbbb`,
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
      `WP-GA-01 Accuracy of answers · 2 criteria · ${stamp("2026-11-03T09:15:00.000Z")}`,
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
    expect(modeLabel("provided_predictions")).toBe("Provided predictions");
  });
});

describe("label times and execution request names (#227)", () => {
  it("states label times in the viewer's local time and format, not UTC", () => {
    const at = "2026-11-03T09:15:00.000Z";
    expect(stamp(at)).toBe(
      new Date(at).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    // Never the record's raw ISO time.
    expect(stamp(at)).not.toContain("2026-11-03");
    expect(stamp("")).toBe("");
    expect(stamp(null)).toBe("");
    expect(stamp("not a time")).toBe("");
  });

  it("tells execution requests of different plans apart like the dialog does", () => {
    const ingest = (id: string, planId: string) => ({
      id,
      mode: "genai_ingest",
      system_name: null,
      plan_id: planId,
      procedure_id: "PROC-1",
      plan_criteria: 2,
      plan_created_at: "2026-11-03T09:15:00.000Z",
    });
    const rows = [
      ingest("JOB-1", "AS-plan-aaaaaa"),
      ingest("JOB-2", "AS-plan-bbbbbb"),
      // A second job of the first plan reads as that plan.
      ingest("JOB-3", "AS-plan-aaaaaa"),
      {
        ...ingest("JOB-4", ""),
        mode: "provided_predictions",
        system_name: "Credit",
      },
    ];
    const plan = `WP-GA-01 Accuracy of answers · 2 criteria · ${stamp("2026-11-03T09:15:00.000Z")}`;
    expect(jobNames(rows, procedures)).toEqual([
      plan + " · aaaaaa",
      plan + " · bbbbbb",
      plan + " · aaaaaa",
      "Credit",
    ]);
    // The labels the Queue ingest dialog gives the same two plans.
    expect(
      distinctOptions(
        [
          {
            id: "AS-plan-aaaaaa",
            procedureId: "PROC-1",
            createdAt: "2026-11-03T09:15:00.000Z",
            plan: { criteria: [1, 2] },
          },
          {
            id: "AS-plan-bbbbbb",
            procedureId: "PROC-1",
            createdAt: "2026-11-03T09:15:00.000Z",
            plan: { criteria: [1, 2] },
          },
        ],
        (p) => planOptionLabel(p, procedures),
      ).map((o) => o.label),
    ).toEqual([plan + " · aaaaaa", plan + " · bbbbbb"]);
    // A single plan keeps its plain label.
    expect(jobNames([rows[0], rows[2]], procedures)).toEqual([plan, plan]);
  });
});
