import { describe, expect, it } from "vitest";
import type { Engagement } from "./domain";
import { seedWorkflow } from "./workflow-seed";
import {
  approvalReserve,
  approvalStatus,
  metadataLimit,
  metadataReserve,
  metadataWarning,
  planPinsCurrent,
  procedureDraftRevision,
  revisionWarnings,
  runBindsProcedure,
} from "./workflow-state";
import type { Workflow } from "./workflow-types";
import {
  approveProgram,
  approvedWorkflow,
  at,
  briefInput,
  command,
  planProgram,
  planSave,
  procedureId,
  procedureOf,
  run,
  structuredEngagement,
  workflowOf,
} from "./workflow/test-fixtures";
import { resolveNew } from "./criteria/pin";

const workflow = () =>
  approvedWorkflow(seedWorkflow(resolveNew(), "lead", at).procedures);
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
    // revisions (without a reason) that older histories keep.
    w.brief!.history = (["approved", "draft", "submitted"] as const).flatMap(
      (status) => Array.from({ length: 40 }, () => ({ ...revision, status })),
    );
    // Submissions and their other outcomes, and the drafts that older
    // histories keep.
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

describe("metadata reserve", () => {
  /** The room save() keeps for `op`, run on the engagement as loaded. */
  async function reserveFor(
    e: Engagement,
    op: string,
    data: unknown,
    userId: string,
  ) {
    const loaded = approvalStatus(e.workflow);
    await command(e, op, data, userId);
    return metadataReserve(loaded, e.workflow, op);
  }
  const resample = (e: Engagement, sampling = "Stratified sample of 40") =>
    planSave(e, { sampling });
  const reassign = {
    procedureIds: [procedureId],
    patch: { dueDate: "2026-12-15" },
  };
  const scopeChange = {
    ...briefInput,
    boundary: "Scoring service, decision support and appeals",
    changeImpact: "Appeals handling is now in scope",
  };
  const whole = { bytes: approvalReserve, whole: true };
  const held = { bytes: approvalReserve, whole: false };
  const size = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  /** What a decision adds to the engagement, with a 2,000-character reason. */
  async function decisionSize(e: Engagement, op: string, data: unknown) {
    const decided = structuredClone(e);
    await command(
      decided,
      op,
      { ...(data as object), reason: "r".repeat(2_000) },
      "reviewer",
    );
    return size(decided) - size(e);
  }
  async function changedProgram() {
    const e = structuredEngagement();
    await approveProgram(e);
    await command(e, "saveProcedurePlan", resample(e), "lead");
    return e;
  }

  it("keeps none once the scope and program are approved", async () => {
    const e = structuredEngagement();
    await approveProgram(e);
    expect(
      await reserveFor(e, "bulkPlanProcedures", reassign, "lead"),
    ).toBeUndefined();
    expect(
      metadataReserve(approvalStatus(undefined), undefined, "renameEngagement"),
    ).toBeUndefined();
  });

  it("makes a change that needs the scope or program approved leave the whole reserve", async () => {
    // A plan change to the approved program.
    let e = structuredEngagement();
    await approveProgram(e);
    expect(
      await reserveFor(e, "saveProcedurePlan", resample(e), "lead"),
    ).toMatchObject(whole);
    // A change to the approved scope.
    e = structuredEngagement();
    await approveProgram(e);
    expect(await reserveFor(e, "saveBrief", scopeChange, "lead")).toMatchObject(
      whole,
    );
    // A Lead's change that withdraws the submitted program.
    e = await changedProgram();
    await command(e, "submitProgram", {}, "auditor");
    expect(
      await reserveFor(
        e,
        "saveProcedurePlan",
        resample(e, "All 12 datasets"),
        "lead",
      ),
    ).toMatchObject(whole);
    expect(workflowOf(e).program.history.at(-1)?.status).toBe("withdrawn");
    // Adopting the workflow starts its first approval.
    e = structuredEngagement({ workflow: undefined });
    expect(await reserveFor(e, "adoptWorkflow", {}, "lead")).toMatchObject(
      whole,
    );
  });

  it("keeps room for the reviewer to approve or return each submission", async () => {
    const e = structuredEngagement(),
      w = () => workflowOf(e);
    await command(e, "saveBrief", briefInput, "auditor");
    const scope = await reserveFor(e, "submitBrief", {}, "auditor");
    expect(scope).toMatchObject({ whole: true });
    expect(scope!.bytes).toBe(
      size({ ...w().brief, history: undefined }) + 5_000,
    );
    const revision = { revision: w().brief!.revision };
    for (const [op, data] of [
      ["approveBrief", revision],
      ["returnBrief", {}],
    ] as const)
      expect(await decisionSize(e, op, data)).toBeLessThan(scope!.bytes);
    await command(
      e,
      "approveBrief",
      { ...revision, reason: "Scope agreed" },
      "reviewer",
    );
    await planProgram(e);
    const program = await reserveFor(e, "submitProgram", {}, "auditor");
    expect(program).toMatchObject({ whole: true });
    expect(program!.bytes).toBe(size(w().program.history.at(-1)) + 5_000);
    for (const [op, data] of [
      ["approveProgram", { revision: w().program.revision }],
      ["returnProgram", {}],
    ] as const)
      expect(await decisionSize(e, op, data)).toBeLessThan(program!.bytes);
  });

  it("lets the scope and program be drafted and decided with the reserve, and keeps it from other writes", async () => {
    const e = await changedProgram(),
      w = workflowOf(e);
    expect(
      metadataReserve(approvalStatus(w), w, "createFinding"),
    ).toMatchObject(held);
    expect(
      await reserveFor(
        e,
        "saveProcedurePlan",
        resample(e, "Stratified sample of 60"),
        "lead",
      ),
    ).toBeUndefined();
    await command(e, "submitProgram", {}, "auditor");
    // While the submission awaits a decision, an assignment change is held
    // to the reserve too.
    expect(
      await reserveFor(e, "bulkPlanProcedures", reassign, "lead"),
    ).toMatchObject(held);
    expect(
      await reserveFor(
        e,
        "returnProgram",
        { reason: "Size the sample" },
        "reviewer",
      ),
    ).toBeUndefined();
    await command(e, "submitProgram", {}, "auditor");
    expect(
      await reserveFor(
        e,
        "approveProgram",
        { revision: w.program.revision, reason: "Program agreed" },
        "reviewer",
      ),
    ).toBeUndefined();
    // A scope change that awaits approval holds the program's drafting to
    // the reserve, and the reviewer's decision on it may use it.
    await command(e, "saveBrief", scopeChange, "lead");
    await command(e, "submitBrief", {}, "lead");
    expect(
      await reserveFor(
        e,
        "saveProcedurePlan",
        resample(e, "All 12 datasets"),
        "lead",
      ),
    ).toMatchObject(held);
    expect(
      await reserveFor(
        e,
        "returnBrief",
        { reason: "Name the appeals channel" },
        "reviewer",
      ),
    ).toBeUndefined();
    expect(
      await reserveFor(e, "saveBrief", scopeChange, "lead"),
    ).toBeUndefined();
  });
});

describe("metadata warning", () => {
  it("warns from 200 KB before the limit and says what the reserve refuses", async () => {
    const e = structuredEngagement();
    await approveProgram(e);
    const w = workflowOf(e);
    expect(metadataWarning(w, metadataLimit - 200_001)).toBeUndefined();
    expect(metadataWarning(w, undefined)).toBeUndefined();
    expect(metadataWarning(undefined, metadataLimit)).toBeUndefined();
    expect(metadataWarning(w, metadataLimit - 200_000)).toEqual({
      id: "metadata",
      title: "Engagement record",
      message:
        "The engagement record uses 1.30 MB of its 1.5 MB limit. Once less than 100 KB is left, a change that needs the scope or audit program approved again is refused, so that every approval started can be completed.",
    });
    expect(metadataWarning(w, metadataLimit - 99_999)?.message).toBe(
      "The engagement record uses 1.40 MB of its 1.5 MB limit. Less than the 100 KB an approval needs is left, so a change that needs the scope or audit program approved again is refused. Continue such changes in a follow-up engagement.",
    );
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, { sampling: "Stratified sample of 40" }),
      "lead",
    );
    expect(metadataWarning(w, metadataLimit - 50_000)?.message).toBe(
      "The engagement record uses 1.45 MB of its 1.5 MB limit. The room left is kept for approving the scope and audit program: until they are approved, other changes that need more room are refused.",
    );
    expect(revisionWarnings(w, metadataLimit - 50_000)).toEqual([
      metadataWarning(w, metadataLimit - 50_000),
    ]);
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

  it("binds a run that recorded a plan hash to the plan content, as executions do", () => {
    const e = structuredEngagement({ workflow: workflow() }),
      p = procedure(e.workflow!);
    p.planHash = "a".repeat(64);
    const bound = (change = {}) =>
      run({
        procedureBinding: {
          procedureId,
          procedureRevision: p.revision,
          planHash: "a".repeat(64),
          briefRevision: 1,
          programRevision: 1,
          ...change,
        },
      });
    expect(runBindsProcedure(e, p, bound())).toBe(true);
    // Another procedure's change moved the program revision only.
    e.workflow!.program.revision = 4;
    expect(runBindsProcedure(e, p, bound())).toBe(true);
    // A plan changed and then restored: the revision moved, the hash did not.
    p.revision += 2;
    expect(runBindsProcedure(e, p, bound())).toBe(true);
    // A different plan, or a different scope, no longer binds.
    expect(runBindsProcedure(e, p, bound({ planHash: "b".repeat(64) }))).toBe(
      false,
    );
    expect(runBindsProcedure(e, p, bound({ briefRevision: 2 }))).toBe(false);
  });
});

describe("planning pins", () => {
  it("follow the procedure's plan revision and the scope revision, not the program revision", () => {
    const e = structuredEngagement({ workflow: workflow() }),
      p = procedure(e.workflow!),
      pins = (change = {}) => ({
        procedureId,
        procedureRevision: p.revision,
        briefRevision: 1,
        programRevision: 1,
        ...change,
      });
    expect(planPinsCurrent(e, p, pins())).toBe(true);
    e.workflow!.program.revision = 3;
    expect(planPinsCurrent(e, p, pins())).toBe(true);
    expect(
      planPinsCurrent(e, p, pins({ procedureRevision: p.revision + 1 })),
    ).toBe(false);
    expect(planPinsCurrent(e, p, pins({ briefRevision: 2 }))).toBe(false);
    expect(planPinsCurrent(e, p, pins({ briefRevision: undefined }))).toBe(
      false,
    );
    // Without a scope no pin is current.
    e.workflow!.brief = undefined;
    expect(planPinsCurrent(e, p, pins({ briefRevision: undefined }))).toBe(
      false,
    );
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
