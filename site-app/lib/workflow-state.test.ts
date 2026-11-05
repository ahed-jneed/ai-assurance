import { describe, expect, it } from "vitest";
import type { Engagement } from "./domain";
import { seedWorkflow } from "./workflow-seed";
import {
  procedureDraftRevision,
  revisionWarnings,
  runBindsProcedure,
} from "./workflow-state";
import type { Workflow } from "./workflow-types";
import {
  approveProgram,
  approvedWorkflow,
  at,
  command,
  planSave,
  procedureId,
  procedureOf,
  run,
  structuredEngagement,
  workflowOf,
} from "./workflow/test-fixtures";

const workflow = () => approvedWorkflow(seedWorkflow("lead", at).procedures);
const procedure = (w: Workflow) => {
  const p = w.procedures.find((p) => p.id === procedureId);
  if (!p) throw new Error("Unknown procedure " + procedureId);
  return p;
};
/** Records this many scope and program returns and procedure work revisions. */
function used(w: Workflow, brief: number, program: number, work: number) {
  const { history, ...revision } = w.brief!;
  w.brief!.history = Array.from({ length: brief }, () => ({
    ...revision,
    status: "submitted" as const,
    returnReason: "Clarify the boundary",
    returnedBy: "reviewer",
    returnedAt: at,
  }));
  w.program.history = Array.from({ length: program }, () => ({
    revision: 1,
    briefRevision: 1,
    status: "returned",
    reason: "Size the sample",
    procedureRevisions: [],
    at,
    actor: "reviewer",
  }));
  const p = procedure(w);
  p.history = Array.from({ length: work }, (_, i) => ({
    action: (["execute", "evaluate", "reaffirm"] as const)[i % 3],
    plan: p,
    revision: p.revision,
    at,
    actor: "auditor",
  }));
}

describe("revision limit warnings", () => {
  it("warns from five returns or work revisions before each limit", () => {
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
          "5 of 40 scope returns left. Drafting, approval and changes to the approved scope use none; once none are left, a returned scope cannot be submitted again, so continue in a follow-up engagement.",
      },
      {
        id: "program",
        title: "Audit program",
        message:
          "4 of 75 program returns left. Drafting, approval and changes to the approved program use none; once none are left, a returned program cannot be submitted again, so continue in a follow-up engagement.",
      },
      {
        id: p.id,
        recordId: p.id,
        title: p.title,
        message:
          "WP-A10-01: 5 of 30 work revisions left. Each execution, evaluation and impact review uses one; plan changes and returns do not. Once none are left, current work cannot be recorded, evaluated or reaffirmed again, while work that a plan or scope change requires is still accepted.",
      },
    ]);
  });

  it("counts none left at and beyond a limit", () => {
    const w = workflow();
    used(w, 41, 80, 31);
    expect(
      revisionWarnings(w).map((warning) => warning.message.split(" left")[0]),
    ).toEqual([
      "0 of 40 scope returns",
      "0 of 75 program returns",
      "WP-A10-01: 0 of 30 work revisions",
    ]);
  });

  it("ignores submissions, approvals, withdrawals, plan changes, procedure returns and older entries", () => {
    const w = workflow();
    const { history, ...revision } = w.brief!;
    // Approved revisions a Lead revised, and the drafts and returned
    // revisions (without a reason) that engagements kept before November 2026.
    w.brief!.history = (["approved", "draft", "submitted"] as const).flatMap(
      (status) => Array.from({ length: 40 }, () => ({ ...revision, status })),
    );
    // Submissions and their other outcomes, and the drafts kept before
    // November 2026.
    w.program.history = ["submitted", "approved", "withdrawn", "draft"].flatMap(
      (status) =>
        Array.from({ length: 75 }, () => ({
          revision: 1,
          briefRevision: 1,
          status,
          procedureRevisions: [],
          at,
          actor: "auditor",
        })),
    );
    const p = procedure(w);
    p.history = ([undefined, "plan", "return"] as const).flatMap((action) =>
      Array.from({ length: 30 }, () => ({
        action,
        plan: p,
        revision: p.revision,
        at,
        actor: "auditor",
      })),
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

describe("recovery draft revisions", () => {
  const kinds = [
    "procedure-plan",
    "procedure-execution",
    "procedure-assessment",
  ] as const;
  const bases = (e: Engagement) =>
    kinds.map((kind) =>
      procedureDraftRevision(workflowOf(e), procedureOf(e, procedureId), kind),
    );

  it("dates a plan draft by its assignment, and every procedure draft by the plan, execution, program and scope", async () => {
    const e = structuredEngagement();
    await approveProgram(e);
    const p = procedureOf(e, procedureId),
      [plan, execution, assessment] = bases(e),
      shared = [p.revision, 0, workflowOf(e).program.revision, 1].join(":");
    expect([plan, execution, assessment]).toEqual([
      shared + ":" + p.assignmentRevision,
      shared,
      shared,
    ]);
    // Another Lead moves the due date: only a saved plan draft, which holds
    // the earlier one, is out of date.
    await command(
      e,
      "bulkPlanProcedures",
      { procedureIds: [procedureId], patch: { dueDate: "2026-12-15" } },
      "second-lead",
    );
    const reassigned = bases(e);
    expect(reassigned[0]).not.toBe(plan);
    expect(reassigned.slice(1)).toEqual([execution, assessment]);
    // A change to what the procedure tests dates every procedure draft.
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, {
        sampling: "Stratified sample of 40",
        dueDate: "2026-12-15",
      }),
      "lead",
    );
    bases(e).forEach((base, i) => expect(base).not.toBe(reassigned[i]));
  });

  it("keeps the base of drafts saved before assignment revisions", () => {
    // Saved before assignment revisions, a draft's base had four parts.
    const w = workflow(),
      p = procedure(w);
    expect(p.assignmentRevision).toBeUndefined();
    for (const kind of kinds)
      expect(procedureDraftRevision(w, p, kind)).toBe(
        [p.revision, 0, w.program.revision, w.brief!.revision].join(":"),
      );
  });
});
