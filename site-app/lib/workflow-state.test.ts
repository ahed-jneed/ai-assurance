import { describe, expect, it } from "vitest";
import { seedWorkflow } from "./workflow-seed";
import { revisionWarnings, runBindsProcedure } from "./workflow-state";
import type { Workflow } from "./workflow-types";
import {
  approvedWorkflow,
  at,
  procedureId,
  run,
  structuredEngagement,
} from "./workflow/test-fixtures";

const workflow = () => approvedWorkflow(seedWorkflow("lead", at).procedures);
const procedure = (w: Workflow) => {
  const p = w.procedures.find((p) => p.id === procedureId);
  if (!p) throw new Error("Unknown procedure " + procedureId);
  return p;
};
/** Fills the brief, program and procedure histories to these lengths. */
function used(
  w: Workflow,
  brief: number,
  program: number,
  entries: number,
  status: "draft" | "submitted" = "submitted",
) {
  const { history, ...revision } = w.brief!;
  w.brief!.history = Array.from({ length: brief }, () => ({
    ...revision,
    status,
  }));
  w.program.history = Array.from({ length: program }, () => ({
    revision: 1,
    briefRevision: 1,
    status,
    procedureRevisions: [],
    at,
    actor: "auditor",
  }));
  const p = procedure(w);
  p.history = Array.from({ length: entries }, () => ({
    plan: p,
    revision: p.revision,
    at,
    actor: "auditor",
  }));
}

describe("revision limit warnings", () => {
  it("warns from five submissions or entries before each limit", () => {
    const w = workflow();
    used(w, 34, 69, 24);
    expect(revisionWarnings(w)).toEqual([]);
    used(w, 35, 71, 25);
    const p = procedure(w);
    expect(revisionWarnings(w)).toEqual([
      {
        id: "brief",
        title: "Engagement brief",
        message:
          "5 of 40 scope submissions left. Drafting does not use them; at the limit, continue in a follow-up engagement.",
      },
      {
        id: "program",
        title: "Audit program",
        message:
          "4 of 75 program submissions left. Drafting and returns do not use them; at the limit, continue in a follow-up engagement.",
      },
      {
        id: p.id,
        recordId: p.id,
        title: p.title,
        message:
          "WP-A10-01: 5 of 30 history entries left. Executions, evaluations and the first plan change after each program submission use one; returns do not.",
      },
    ]);
  });

  it("counts none left at and beyond a limit", () => {
    const w = workflow();
    used(w, 41, 80, 31);
    expect(
      revisionWarnings(w).map((warning) => warning.message.split(" left")[0]),
    ).toEqual([
      "0 of 40 scope submissions",
      "0 of 75 program submissions",
      "WP-A10-01: 0 of 30 history entries",
    ]);
  });

  it("ignores the drafts and outcomes that submissions do not count", () => {
    const w = workflow();
    // Drafts as saved before November 2026, and returns.
    used(w, 40, 75, 0, "draft");
    w.program.history.push(
      ...w.program.history.map((h) => ({ ...h, status: "returned" })),
    );
    expect(revisionWarnings(w)).toEqual([]);
    expect(revisionWarnings(undefined)).toEqual([]);
  });
});

describe("run bindings", () => {
  it("binds a run to the procedure's plan revision and scope revision only", () => {
    const e = structuredEngagement({ workflow: workflow() }),
      p = procedure(e.workflow!);
    const bound = (change = {}) =>
      run({
        procedureBinding: {
          procedureId,
          procedureRevision: p.revision,
          briefRevision: 1,
          programRevision: 7,
          ...change,
        },
      });
    expect(runBindsProcedure(e, p, bound())).toBe(true);
    for (const change of [
      { procedureId: "PROC-WP-A12-01" },
      { procedureRevision: p.revision + 1 },
      { briefRevision: 2 },
    ])
      expect(runBindsProcedure(e, p, bound(change))).toBe(false);
    expect(runBindsProcedure(e, p, run())).toBe(false);
  });
});
