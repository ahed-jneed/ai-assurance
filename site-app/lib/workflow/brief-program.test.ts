import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import catalog from "../catalog.json";
import type { Engagement } from "../domain/types";
import type { Procedure, ProcedurePlan } from "../workflow-types";
import {
  approveProgram,
  approveScope,
  at,
  briefInput,
  changeScope,
  command,
  engagement,
  executionInput,
  expectFailure,
  model,
  planInput,
  planProgram,
  planSave,
  procedureEntries,
  procedureId,
  procedureOf,
  profile,
  artifact,
  sha256,
  structuredEngagement,
  submittedProcedure,
  templatePaper,
  workflowOf,
} from "./test-fixtures";

const writerOnly = "An Auditor or Lead Auditor must record this audit work";
const leadOnly = "A Lead Auditor must authorize this decision";
const reviewerOnly = "An independent Reviewer or Lead Auditor must approve";
const ownWork = "A preparer or contributor cannot approve their own work";
const unauthorized =
  "Select an active authorized person with the required role";
const scopeLimit =
  "The scope reached its return limit; start a follow-up engagement";
const programLimit =
  "The program reached its return limit; start a follow-up engagement";
/** Returned scope revisions as returnBrief keeps them. */
function scopeReturns(e: Engagement, length: number) {
  const { history, ...revision } = workflowOf(e).brief!;
  return Array.from({ length }, () => ({
    ...revision,
    status: "submitted" as const,
    returnReason: "Date the change",
    returnedBy: "reviewer",
    returnedAt: at,
  }));
}
/** Program history entries of one status, to fill a history. */
const programEntries = (length: number, status: string) =>
  Array.from({ length }, () => ({
    revision: 1,
    briefRevision: 1,
    status,
    procedureRevisions: [],
    at,
    actor: "auditor",
  }));
// The fields an approved program hashes, in the order it hashes them.
const planKeys = [
  "selected",
  "applicability",
  "rationale",
  "criterion",
  "sourceVersion",
  "periodAnalysis",
  "population",
  "sampling",
  "ownerId",
  "reviewerId",
  "dueDate",
  "method",
  "modelId",
  "datasetId",
  "profileId",
] as const;
const planOf = (p: Procedure) =>
  Object.fromEntries(planKeys.map((key) => [key, p[key]])) as ProcedurePlan;
// The plan hash: the procedure and its plan without the preparer, reviewer
// and due date, in this order.
const planHashOf = (p: Procedure) =>
  sha256(
    JSON.stringify({
      procedureId: p.id,
      objective: p.objective,
      instructions: p.instructions,
      ...Object.fromEntries(
        planKeys
          .filter((key) => !["ownerId", "reviewerId", "dueDate"].includes(key))
          .map((key) => [key, p[key]]),
      ),
    }),
  );
const bindingsOf = (e: Engagement) =>
  workflowOf(e).procedures.map((p) => ({
    id: p.id,
    revision: p.revision,
    planHash: p.planHash,
  }));

describe("adoptWorkflow", () => {
  it("lets only a Lead adopt the workflow, once", async () => {
    const e = engagement();
    await expectFailure(
      command(e, "adoptWorkflow", {}, "auditor"),
      403,
      leadOnly,
    );
    expect(e.workflow).toBeUndefined();
    expect(await command(e, "adoptWorkflow", {}, "lead")).toEqual({
      workflow: "adopted",
    });
    await expectFailure(
      command(e, "adoptWorkflow", {}, "lead"),
      409,
      "This engagement already uses the workflow",
    );
  });

  it("seeds the catalog program and links existing papers by template", async () => {
    const planningPaper = templatePaper("WP-PL-01"),
      dataPaper = templatePaper("WP-A10-01");
    const e = engagement({ papers: [planningPaper, dataPaper] });
    await command(e, "adoptWorkflow", {}, "lead");
    const w = workflowOf(e);
    expect(w).toMatchObject({
      adoptedBy: "lead",
      adoptedAt: at,
      program: {
        revision: 1,
        briefRevision: 0,
        status: "draft",
        contributors: ["lead"],
      },
    });
    expect(w.brief).toBeUndefined();
    expect(w.procedures.map((p) => p.templateId)).toEqual(
      catalog.items.filter((t) => t.kind === "working_paper").map((t) => t.id),
    );
    expect(procedureOf(e, "PROC-WP-PL-01").paperId).toBe(planningPaper.id);
    expect(procedureOf(e, procedureId).paperId).toBe(dataPaper.id);
    expect(procedureOf(e, "PROC-WP-A12-01").paperId).toBeUndefined();
  });
});

describe("engagement brief", () => {
  it("records the first scope draft for an Auditor or Lead", async () => {
    const e = structuredEngagement();
    await expectFailure(
      command(e, "saveBrief", briefInput, "reviewer"),
      403,
      writerOnly,
    );
    expect(await command(e, "saveBrief", briefInput, "auditor")).toEqual({
      briefRevision: "1",
    });
    expect(workflowOf(e).brief).toEqual({
      ...briefInput,
      revision: 1,
      status: "draft",
      contributors: ["auditor"],
      updatedBy: "auditor",
      updatedAt: at,
      history: [],
    });
    expect(workflowOf(e).program.revision).toBe(1);
  });

  it("needs an adopted workflow", async () => {
    await expectFailure(
      command(engagement(), "saveBrief", briefInput, "auditor"),
      409,
      "Adopt the engagement workflow first",
    );
  });

  it("validates the fields, real calendar dates and the period", async () => {
    const e = structuredEngagement();
    for (const invalid of [
      { ...briefInput, periodStart: "2026-02-30" },
      { ...briefInput, periodEnd: "30.09.2026" },
      { ...briefInput, systemName: " " },
      { ...briefInput, changeImpact: undefined },
      { ...briefInput, unexpected: "field" },
    ])
      await expect(
        command(e, "saveBrief", invalid, "auditor"),
      ).rejects.toBeInstanceOf(ZodError);
    await expectFailure(
      command(
        e,
        "saveBrief",
        { ...briefInput, periodStart: "2026-10-01" },
        "auditor",
      ),
      400,
      "The audit period ends before it starts",
    );
    expect(workflowOf(e).brief).toBeUndefined();
  });

  it("supersedes a draft that was never submitted without a history entry", async () => {
    const e = structuredEngagement();
    await command(e, "saveBrief", briefInput, "auditor");
    expect(
      await command(
        e,
        "saveBrief",
        { ...briefInput, audience: "Supervisory board" },
        "second-auditor",
      ),
    ).toEqual({ briefRevision: "2" });
    const brief = workflowOf(e).brief!;
    expect(brief).toMatchObject({
      revision: 2,
      status: "draft",
      audience: "Supervisory board",
      contributors: ["auditor", "second-auditor"],
      updatedBy: "second-auditor",
    });
    expect(brief.history).toEqual([]);
  });

  it("counts scope returns only, so an approved scope can always be revised and approved again", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const brief = () => workflowOf(e).brief!;
    // 39 returns, besides approved revisions a Lead revised, and the drafts
    // and returned revisions without a reason that older histories keep.
    const { history, ...revision } = brief();
    brief().history = [
      ...scopeReturns(e, 39),
      ...(["approved", "draft", "submitted"] as const).flatMap((status) =>
        Array.from({ length: 40 }, () => ({ ...revision, status })),
      ),
    ];
    // A Lead revises the approved scope, which is submitted and approved
    // again, and the program binds it.
    await changeScope(e);
    expect(brief()).toMatchObject({ revision: 2, status: "approved" });
    expect(workflowOf(e).program).toMatchObject({
      status: "approved",
      briefRevision: 2,
    });
    expect(
      await command(
        e,
        "recordProcedureExecution",
        executionInput(e),
        "auditor",
      ),
    ).toEqual({ procedureId });
    // The 40th return is not refused either. A scope returned 40 times can
    // still be drafted, but not submitted again.
    const revised = { ...briefInput, changeImpact: "Appeals are out of scope" };
    await command(e, "saveBrief", revised, "lead");
    await command(e, "submitBrief", {}, "lead");
    await command(e, "returnBrief", { reason: "Date the change" }, "reviewer");
    await command(e, "saveBrief", { ...revised, audience: "Board" }, "lead");
    await expectFailure(command(e, "submitBrief", {}, "lead"), 413, scopeLimit);
    expect(brief()).toMatchObject({ revision: 4, status: "draft" });
  });

  it("refuses to revise an approved scope that could not be submitted again", async () => {
    // Commands never leave a scope or program in force without a submission,
    // since only returns count; a lowered limit could.
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const w = workflowOf(e),
      approved = structuredClone(w);
    const revise = () =>
      command(
        e,
        "saveBrief",
        { ...briefInput, changeImpact: "Appeals are now in scope" },
        "lead",
      );
    w.brief!.history = scopeReturns(e, 40);
    await expectFailure(revise(), 413, scopeLimit);
    // A scope change also needs the program submitted again.
    w.brief!.history = [];
    w.program.history.push(...programEntries(75, "returned"));
    await expectFailure(revise(), 413, programLimit);
    // The scope and the program stay approved.
    expect(w.brief).toEqual(approved.brief);
    expect(w.program).toMatchObject({
      status: "approved",
      revision: approved.program.revision,
      approval: approved.program.approval,
    });
  });

  it("freezes a submitted scope until it is returned", async () => {
    const e = structuredEngagement();
    await expectFailure(
      command(e, "submitBrief", {}, "auditor"),
      400,
      "Complete the engagement brief first",
    );
    await command(e, "saveBrief", briefInput, "auditor");
    await expectFailure(
      command(e, "submitBrief", {}, "reviewer"),
      403,
      writerOnly,
    );
    expect(await command(e, "submitBrief", {}, "auditor")).toEqual({
      briefRevision: "1",
    });
    expect(workflowOf(e).brief?.status).toBe("submitted");
    await expectFailure(
      command(e, "submitBrief", {}, "auditor"),
      409,
      "Only a scope draft can be submitted",
    );
    await expectFailure(
      command(e, "saveBrief", briefInput, "auditor"),
      409,
      "Return the submitted scope before revising it",
    );
  });

  it("needs an independent Reviewer or Lead to approve the submitted revision", async () => {
    const e = structuredEngagement();
    const approve = (userId: string, revision = 1) =>
      command(e, "approveBrief", { revision, reason: "Scope agreed" }, userId);
    await expectFailure(approve("reviewer"), 400, "Complete the brief first");
    await command(e, "saveBrief", briefInput, "lead");
    await expectFailure(
      approve("reviewer"),
      409,
      "Review the submitted scope revision",
    );
    await command(e, "submitBrief", {}, "lead");
    await expectFailure(approve("auditor"), 403, reviewerOnly);
    await expectFailure(approve("lead"), 403, ownWork);
    await expectFailure(
      approve("reviewer", 2),
      409,
      "Review the submitted scope revision",
    );
    expect(await approve("second-lead")).toEqual({ briefRevision: "1" });
    const brief = workflowOf(e).brief!;
    expect(brief.status).toBe("approved");
    // The approval hashes the submitted brief without history or approval.
    expect(brief.approval).toEqual({
      userId: "second-lead",
      at,
      revision: 1,
      hash: await sha256(
        JSON.stringify({
          ...brief,
          status: "submitted",
          history: undefined,
          approval: undefined,
        }),
      ),
      reason: "Scope agreed",
    });
    await expectFailure(
      approve("reviewer"),
      409,
      "Review the submitted scope revision",
    );
  });

  it("returns a submitted scope with the reason kept apart from the preparer's text", async () => {
    const e = structuredEngagement();
    const prepared = { ...briefInput, changeImpact: "No earlier work exists" };
    const send = (userId: string) =>
      command(e, "returnBrief", { reason: "Clarify the boundary" }, userId);
    await expectFailure(send("reviewer"), 400, "Complete the brief first");
    await command(e, "saveBrief", prepared, "auditor");
    await expectFailure(send("reviewer"), 409, "Return a submitted scope");
    await command(e, "submitBrief", {}, "auditor");
    await expectFailure(send("auditor"), 403, reviewerOnly);
    expect(await send("reviewer")).toEqual({ reason: "Clarify the boundary" });
    const returned = {
      returnReason: "Clarify the boundary",
      returnedBy: "reviewer",
      returnedAt: at,
    };
    const brief = workflowOf(e).brief!;
    expect(brief).toMatchObject({
      ...returned,
      revision: 1,
      status: "draft",
      changeImpact: "No earlier work exists",
      contributors: ["auditor"],
    });
    expect(brief.approval).toBeUndefined();
    expect(brief.history).toEqual([
      {
        ...prepared,
        ...returned,
        revision: 1,
        status: "submitted",
        contributors: ["auditor"],
        updatedBy: "auditor",
        updatedAt: at,
      },
    ]);
    // The revision answering the return shows it until it is resubmitted,
    // in the preparer's own words.
    await command(
      e,
      "saveBrief",
      { ...prepared, boundary: "Scoring service only" },
      "auditor",
    );
    expect(workflowOf(e).brief).toMatchObject({
      ...returned,
      revision: 2,
      changeImpact: "No earlier work exists",
    });
    await command(e, "submitBrief", {}, "auditor");
    const resubmitted = workflowOf(e).brief!;
    expect(resubmitted).toMatchObject({
      status: "submitted",
      changeImpact: "No earlier work exists",
    });
    for (const key of ["returnReason", "returnedBy", "returnedAt"])
      expect(resubmitted).not.toHaveProperty(key);
    expect(resubmitted.history).toHaveLength(1);
  });

  it("lets only a Lead revise an approved scope, explaining its impact", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const approved = structuredClone(workflowOf(e).program);
    const revised = {
      ...briefInput,
      boundary: "Scoring service, decision support and appeals",
    };
    await expectFailure(
      command(e, "saveBrief", revised, "auditor"),
      403,
      leadOnly,
    );
    await expectFailure(
      command(e, "saveBrief", revised, "lead"),
      400,
      "Explain the scope change and its impact",
    );
    expect(
      await command(
        e,
        "saveBrief",
        { ...revised, changeImpact: "Appeals are now in scope" },
        "lead",
      ),
    ).toEqual({ briefRevision: "2" });
    const w = workflowOf(e);
    expect(w.brief).toMatchObject({
      revision: 2,
      status: "draft",
      contributors: ["auditor", "lead"],
    });
    expect(w.brief?.history.at(-1)).toMatchObject({
      revision: 1,
      status: "approved",
    });
    // The approved program no longer binds the current scope: it becomes
    // the draft of its next revision, and its history keeps the approval.
    expect(w.program).toMatchObject({
      revision: approved.revision + 1,
      status: "draft",
      contributors: ["lead", "auditor"],
      updatedBy: "lead",
      history: approved.history,
    });
    expect(w.program.approval).toBeUndefined();
    expect(w.program.history.at(-1)).toMatchObject({
      revision: approved.revision,
      status: "approved",
      approval: approved.approval,
    });
  });
});

describe("procedure planning", () => {
  const save = (
    e: Engagement,
    plan: Record<string, unknown> = {},
    userId = "auditor",
  ) => command(e, "saveProcedurePlan", planSave(e, plan), userId);

  it("plans a procedure, keeps its prior plan once and amends the draft program", async () => {
    const e = structuredEngagement();
    const before = structuredClone(procedureOf(e, procedureId));
    expect(await save(e)).toEqual({ procedureId });
    const p = procedureOf(e, procedureId);
    expect(p).toMatchObject({
      ...planInput(),
      revision: 2,
      assignmentRevision: 2,
      planHash: await planHashOf(p),
      planAmended: true,
      contributors: ["lead", "auditor"],
      updatedBy: "auditor",
      updatedAt: at,
    });
    expect(p.review).toBeUndefined();
    expect(p.history).toEqual([
      {
        action: "plan",
        plan: planOf(before),
        revision: 1,
        at,
        actor: "auditor",
      },
    ]);
    // Drafting further revises the plan or its assignment, each counted
    // apart, without history entries.
    await save(e, { sampling: "Stratified sample of 40" });
    await save(e, { sampling: "Stratified sample of 40", dueDate: "" });
    expect(p).toMatchObject({
      revision: 3,
      assignmentRevision: 3,
      planHash: await planHashOf(p),
      dueDate: "",
    });
    expect(p.history).toHaveLength(1);
    expect(workflowOf(e).program).toMatchObject({
      revision: 1,
      status: "draft",
      contributors: ["lead", "auditor"],
      history: [],
    });
  });

  it("leaves an unchanged plan alone", async () => {
    const e = structuredEngagement();
    await save(e);
    const saved = structuredClone(workflowOf(e));
    expect(await save(e, {}, "second-auditor")).toEqual({ procedureId });
    expect(workflowOf(e)).toEqual(saved);
  });

  // The next two tests run a workflow through many commands: three approved
  // programs, or 400 draft saves. They take 0.05 to 0.1 s on an idle
  // machine but passed the default 5 s timeout with three suites running at
  // once (#174). They check results, not speed, so the timeout only ends a
  // run that never finishes.
  const heavy = 60_000;

  it(
    "refuses a plan read before another change to its assignment, instead of reverting it",
    async () => {
      const resample = { sampling: "Stratified sample of 40" };
      for (const reassignment of [
        { ownerId: "second-auditor" },
        { reviewerId: "second-reviewer" },
        { dueDate: "2026-12-15" },
      ]) {
        const e = structuredEngagement();
        await approveProgram(e);
        const p = procedureOf(e, procedureId),
          revision = p.revision;
        // A Lead opens the plan to change the sample while another Lead
        // reassigns the work, which leaves the plan revision as it was.
        const opened = planSave(e, resample);
        await command(
          e,
          "bulkPlanProcedures",
          { procedureIds: [procedureId], patch: reassignment },
          "second-lead",
        );
        expect(p).toMatchObject({
          ...reassignment,
          revision,
          assignmentRevision: opened.assignmentRevision + 1,
        });
        const reassigned = structuredClone(workflowOf(e));
        await expectFailure(
          command(e, "saveProcedurePlan", opened, "lead"),
          409,
          "The preparer, reviewer or due date of " +
            p.title +
            " changed after this plan was opened. Reload and apply your changes again.",
        );
        expect(workflowOf(e)).toEqual(reassigned);
        // Read again, the plan keeps the other Lead's change.
        await command(
          e,
          "saveProcedurePlan",
          planSave(e, { ...resample, ...reassignment }),
          "lead",
        );
        expect(p).toMatchObject({ ...resample, ...reassignment });
        expect(workflowOf(e).program.status).toBe("draft");
      }
    },
    heavy,
  );

  it(
    "lets 200 draft saves amend the program and its plans without using their history",
    async () => {
      const e = structuredEngagement();
      await approveScope(e);
      await planProgram(e);
      for (let i = 0; i < 200; i++)
        await save(e, {
          sampling: "Sample design " + i,
          dueDate: i % 2 ? "2026-11-30" : "2026-12-15",
        });
      const p = procedureOf(e, procedureId),
        program = workflowOf(e).program;
      expect(program).toMatchObject({ revision: 1, status: "draft" });
      expect(program.history).toEqual([]);
      expect(p.history).toHaveLength(1);
      await command(e, "submitProgram", {}, "auditor");
      await command(
        e,
        "returnProgram",
        { reason: "Size the sample" },
        "reviewer",
      );
      for (let i = 0; i < 200; i++)
        await save(e, { sampling: "Sample of " + (40 + i) });
      await command(e, "submitProgram", {}, "auditor");
      await command(
        e,
        "approveProgram",
        { revision: 2, reason: "Program agreed" },
        "reviewer",
      );
      expect(program.history.map((h) => h.revision + " " + h.status)).toEqual([
        "1 submitted",
        "1 returned",
        "2 submitted",
        "2 approved",
      ]);
      // The seed plan, then the plan as returned.
      expect(p.history.map((h) => h.plan.sampling)).toEqual([
        "",
        "Sample design 199",
      ]);
    },
    heavy,
  );

  it("is recorded by an Auditor or Lead for a known procedure", async () => {
    const e = structuredEngagement();
    await expectFailure(save(e, {}, "reviewer"), 403, writerOnly);
    await expectFailure(
      command(
        e,
        "saveProcedurePlan",
        {
          procedureId: "PROC-unknown",
          assignmentRevision: 1,
          plan: planInput(),
        },
        "auditor",
      ),
      404,
      "Procedure not found in this engagement",
    );
    for (const plan of [
      { applicability: "maybe" },
      { dueDate: "2026-11-31" },
      { method: "scripted" },
      { unexpected: true },
    ])
      await expect(save(e, plan)).rejects.toBeInstanceOf(ZodError);
  });

  it("needs an active owner and an independent active reviewer", async () => {
    const e = structuredEngagement();
    await expectFailure(save(e, { ownerId: "reviewer" }), 400, unauthorized);
    await expectFailure(save(e, { ownerId: "contributor" }), 400, unauthorized);
    await expectFailure(save(e, { ownerId: "nobody" }), 400, unauthorized);
    await expectFailure(
      save(e, { reviewerId: "second-auditor" }),
      400,
      unauthorized,
    );
    await expectFailure(
      save(e, { reviewerId: "revoked-reviewer" }),
      400,
      unauthorized,
    );
    const dependent =
      "Choose a reviewer independent of this procedure's preparers";
    await expectFailure(
      save(e, { ownerId: "second-lead", reviewerId: "second-lead" }),
      400,
      dependent,
    );
    // The Lead who adopted the workflow contributed to every procedure.
    await expectFailure(save(e, { reviewerId: "lead" }), 400, dependent);
    expect(procedureOf(e, procedureId).revision).toBe(1);
    expect(await save(e, { ownerId: "", reviewerId: "" })).toEqual({
      procedureId,
    });
  });

  it("pins only this engagement's models, accepted datasets and protocols", async () => {
    const e = structuredEngagement({
      artifacts: [
        artifact({ id: "dataset", category: "Dataset" }),
        artifact({ id: "pending", category: "Dataset", status: "unverified" }),
        artifact({ id: "report", category: "Validation" }),
      ],
      models: [model()],
      evaluationProfiles: [profile()],
    });
    await expectFailure(
      save(e, { modelId: "other" }),
      400,
      "Choose a model from this engagement",
    );
    for (const datasetId of ["pending", "report", "other"])
      await expectFailure(
        save(e, { datasetId }),
        400,
        "Choose an accepted dataset from this engagement",
      );
    await expectFailure(
      save(e, { profileId: "other" }),
      400,
      "Choose a protocol from this engagement",
    );
    await save(e, {
      method: "automated",
      modelId: "model",
      datasetId: "dataset",
      profileId: "protocol",
    });
    expect(procedureOf(e, procedureId)).toMatchObject({
      method: "automated",
      modelId: "model",
      datasetId: "dataset",
      profileId: "protocol",
    });
  });

  it("lets only a Lead replan a submitted or approved program", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const approved = structuredClone(workflowOf(e).program),
      p = procedureOf(e, procedureId),
      plan = { revision: p.revision, planHash: p.planHash };
    const later = { dueDate: "2026-12-15" };
    await expectFailure(save(e, later), 403, leadOnly);
    // An assignment change keeps the plan revision and the approval.
    await save(e, later, "lead");
    expect(p).toMatchObject({ ...plan, dueDate: "2026-12-15" });
    expect(workflowOf(e).program).toMatchObject({
      revision: approved.revision,
      status: "approved",
      approval: approved.approval,
      contributors: ["lead", "auditor"],
    });
    // A substantive change returns the program to draft as its next revision.
    await save(e, { ...later, sampling: "Stratified sample of 40" }, "lead");
    expect(p.revision).toBe(plan.revision + 1);
    expect(workflowOf(e).program).toMatchObject({
      revision: approved.revision + 1,
      status: "draft",
    });
    expect(workflowOf(e).program.approval).toBeUndefined();
  });

  it("keeps approved work assigned and scheduled", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    for (const change of [{ ownerId: "" }, { reviewerId: "" }, { dueDate: "" }])
      await expectFailure(
        save(e, change, "lead"),
        400,
        "WP-A10-01: approved work needs a preparer, a reviewer and a deadline",
      );
    // A program back in draft can be incomplete until it is submitted.
    await save(e, { dueDate: "", sampling: "Stratified sample of 40" }, "lead");
    expect(procedureOf(e, procedureId).dueDate).toBe("");
  });

  it("never refuses a plan change for a procedure's history limit", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const p = procedureOf(e, procedureId);
    // Work recorded up to the limit, and the entries without an action that
    // older draft saves kept.
    p.history = [
      ...procedureEntries(p, 30, "execute"),
      ...procedureEntries(p, 30),
    ];
    // A Lead can still reassign the procedure and change its plan. Each
    // program submission adds at most one plan entry.
    await save(e, { reviewerId: "second-reviewer" }, "lead");
    await save(
      e,
      { reviewerId: "second-reviewer", sampling: "Stratified sample of 40" },
      "lead",
    );
    expect(p).toMatchObject({
      reviewerId: "second-reviewer",
      sampling: "Stratified sample of 40",
    });
    expect(p.history).toHaveLength(61);
    expect(p.history.at(-1)).toMatchObject({
      action: "plan",
      plan: { reviewerId: "reviewer", sampling: planInput().sampling },
    });
  });
});

describe("bulk planning", () => {
  const ids = [procedureId, "PROC-WP-A12-01"];
  const bulk = (
    e: Engagement,
    patch: Record<string, unknown>,
    userId = "auditor",
    procedureIds = ids,
  ) => command(e, "bulkPlanProcedures", { procedureIds, patch }, userId);

  it("assigns owners, reviewers and deadlines without revising the plans", async () => {
    const e = structuredEngagement();
    expect(
      await bulk(e, {
        ownerId: "auditor",
        reviewerId: "reviewer",
        dueDate: "2026-11-30",
      }),
    ).toEqual({ count: "2" });
    for (const id of ids)
      expect(procedureOf(e, id)).toMatchObject({
        ownerId: "auditor",
        reviewerId: "reviewer",
        dueDate: "2026-11-30",
        revision: 1,
        assignmentRevision: 2,
        contributors: ["lead", "auditor"],
        updatedBy: "auditor",
      });
    expect(procedureOf(e, "PROC-WP-A11-01").assignmentRevision).toBeUndefined();
    expect(workflowOf(e).program).toMatchObject({
      revision: 1,
      contributors: ["lead", "auditor"],
    });
  });

  it("keeps an approved program approved", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const approved = structuredClone(workflowOf(e).program);
    await bulk(e, { ownerId: "second-auditor" }, "lead");
    expect(procedureOf(e, procedureId).ownerId).toBe("second-auditor");
    expect(workflowOf(e).program).toMatchObject({
      revision: approved.revision,
      status: "approved",
      approval: approved.approval,
    });
  });

  it("validates the whole batch before changing any procedure", async () => {
    const e = structuredEngagement();
    // A Lead who plans one procedure cannot then review it.
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, {}, "PROC-WP-A12-01"),
      "second-lead",
    );
    await expectFailure(
      bulk(e, { reviewerId: "second-lead" }),
      400,
      "Choose an independent reviewer for " +
        procedureOf(e, "PROC-WP-A12-01").title,
    );
    const untouched = procedureOf(e, procedureId);
    expect(untouched.reviewerId).toBe("");
    expect(untouched.assignmentRevision).toBeUndefined();
    await expectFailure(bulk(e, { ownerId: "reviewer" }), 400, unauthorized);
  });

  it("keeps the acting planner from assigning themselves as reviewer", async () => {
    const e = structuredEngagement();
    await expectFailure(
      bulk(e, { reviewerId: "second-lead" }, "second-lead"),
      400,
      "Choose an independent reviewer for " + procedureOf(e, procedureId).title,
    );
  });

  it("accepts each procedure once and at least one change", async () => {
    const e = structuredEngagement();
    for (const [patch, procedureIds] of [
      [{}, ids],
      [{ ownerId: "auditor" }, [procedureId, procedureId]],
      [{ ownerId: "auditor" }, []],
      [{ selected: true }, ids],
    ] as const)
      await expect(
        bulk(e, patch, "auditor", [...procedureIds]),
      ).rejects.toBeInstanceOf(ZodError);
  });

  it("needs a Lead once the program left draft, however full the histories", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    await expectFailure(bulk(e, { dueDate: "2026-12-01" }), 403, leadOnly);
    const full = procedureOf(e, "PROC-WP-A12-01"),
      program = workflowOf(e).program;
    full.history = procedureEntries(full, 30, "execute");
    program.history.push(
      ...programEntries(150, "draft"),
      ...programEntries(75, "submitted"),
    );
    await bulk(e, { dueDate: "2026-12-01" }, "lead");
    for (const id of ids) expect(procedureOf(e, id).dueDate).toBe("2026-12-01");
    expect(full.history).toHaveLength(31);
    expect(program.status).toBe("approved");
  });

  it("keeps the reviewer of reviewed work", async () => {
    const e = await submittedProcedure();
    await command(
      e,
      "reviewProcedure",
      { procedureId, reason: "The evidence supports the conclusion" },
      "reviewer",
    );
    await expectFailure(
      bulk(e, { reviewerId: "second-reviewer" }, "lead", [procedureId]),
      409,
      "The assigned reviewer already approved " +
        procedureOf(e, procedureId).title +
        "; record new work before reassigning its review",
    );
    await bulk(e, { dueDate: "2026-12-01" }, "lead", [procedureId]);
    expect(procedureOf(e, procedureId)).toMatchObject({
      state: "reviewed",
      review: { userId: "reviewer" },
    });
  });
});

describe("program scoping", () => {
  it("records applicability decisions and fills a missing criterion", async () => {
    const e = structuredEngagement();
    // The seed copies each criterion from the template's regulatory
    // references. WP-PL-01 cites none; WP-A10-01 does.
    const { objective, criterion } = procedureOf(e, "PROC-WP-PL-01");
    const cited = procedureOf(e, procedureId).criterion;
    expect(criterion).toBe("");
    expect(cited).not.toBe("");
    expect(
      await command(
        e,
        "scopeProgramCandidates",
        {
          procedureIds: ["PROC-WP-PL-01", procedureId],
          selected: true,
          applicability: "applicable",
          rationale: "Within the agreed scope",
          periodAnalysis: "Covers the whole period",
        },
        "auditor",
      ),
    ).toEqual({ count: "2" });
    expect(procedureOf(e, "PROC-WP-PL-01")).toMatchObject({
      selected: true,
      applicability: "applicable",
      rationale: "Within the agreed scope",
      periodAnalysis: "Covers the whole period",
      criterion: "Approved engagement methodology: " + objective,
      revision: 2,
      contributors: ["lead", "auditor"],
    });
    expect(procedureOf(e, procedureId).criterion).toBe(cited);
    expect(workflowOf(e).program).toMatchObject({ revision: 1, history: [] });
  });

  it("decides each procedure once", async () => {
    const e = structuredEngagement();
    await expect(
      command(
        e,
        "scopeProgramCandidates",
        {
          procedureIds: [procedureId, procedureId],
          selected: true,
          applicability: "applicable",
          rationale: "Within the agreed scope",
          periodAnalysis: "Covers the whole period",
        },
        "auditor",
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(procedureOf(e, procedureId)).toMatchObject({
      revision: 1,
      history: [],
    });
  });

  it("needs a decision, not a pending state, and a Lead after submission", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    const scope = (applicability: string, userId = "auditor") =>
      command(
        e,
        "scopeProgramCandidates",
        {
          procedureIds: [procedureId],
          selected: false,
          applicability,
          rationale: "Out of scope",
          periodAnalysis: "Not relevant",
        },
        userId,
      );
    await expect(scope("pending")).rejects.toBeInstanceOf(ZodError);
    await approveProgram(e);
    await expectFailure(scope("not_applicable"), 403, leadOnly);
    await expectFailure(scope("not_applicable", "reviewer"), 403, writerOnly);
  });
});

describe("program submission", () => {
  const prepared = async (
    plan: Record<string, unknown> = {},
    userId = "auditor",
  ) => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    await command(e, "saveProcedurePlan", planSave(e, plan), userId);
    return e;
  };
  const submit = (e: Engagement) => command(e, "submitProgram", {}, "auditor");

  it("submits a complete draft program against the approved scope", async () => {
    const e = structuredEngagement();
    await expectFailure(submit(e), 409, "Approve scope before the program");
    await approveScope(e);
    await planProgram(e);
    await expectFailure(
      command(e, "submitProgram", {}, "reviewer"),
      403,
      writerOnly,
    );
    expect(await submit(e)).toEqual({ programRevision: "1" });
    const w = workflowOf(e);
    expect(w.program).toMatchObject({
      status: "submitted",
      revision: 1,
      briefRevision: 1,
    });
    // The submission records every plan it binds; each plan's next change
    // keeps it in that procedure's history.
    for (const p of w.procedures) {
      expect(p.planHash).toBe(await planHashOf(p));
      expect(p.planAmended).toBeUndefined();
    }
    expect(w.program.history).toEqual([
      {
        revision: 1,
        briefRevision: 1,
        status: "submitted",
        procedureRevisions: bindingsOf(e),
        at,
        actor: "auditor",
      },
    ]);
    await expectFailure(
      submit(e),
      409,
      "Only a draft program can be submitted",
    );
  });

  it("counts program returns only", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    const program = workflowOf(e).program;
    // 74 returns, besides submissions, approvals and withdrawals, and the
    // drafts that older histories keep.
    program.history = [
      ...programEntries(74, "returned"),
      ...["submitted", "approved", "withdrawn", "draft"].flatMap((status) =>
        programEntries(100, status),
      ),
    ];
    expect(await submit(e)).toEqual({ programRevision: "1" });
    // The 75th return is not refused. A program returned 75 times can still
    // be drafted, but not submitted again.
    await command(
      e,
      "returnProgram",
      { reason: "Size the sample" },
      "reviewer",
    );
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, { sampling: "Stratified sample of 40" }),
      "auditor",
    );
    await expectFailure(submit(e), 413, programLimit);
  });

  it("needs a procedure in scope and a documented decision for every candidate", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await expectFailure(
      submit(e),
      400,
      "Select at least one applicable or readiness procedure",
    );
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, { applicability: "readiness" }),
      "auditor",
    );
    await expectFailure(
      submit(e),
      400,
      "WP-PL-01: record applicability, criterion, period analysis and scope rationale",
    );
  });

  it("needs population, sampling, a deadline and assigned people for work in scope", async () => {
    const incomplete = "WP-A10-01: record population, sampling and deadline";
    for (const plan of [{ population: " " }, { sampling: "" }, { dueDate: "" }])
      await expectFailure(submit(await prepared(plan)), 400, incomplete);
    await expectFailure(
      submit(await prepared({ reviewerId: "" })),
      400,
      unauthorized,
    );
    await expectFailure(
      submit(await prepared({ ownerId: "" })),
      400,
      unauthorized,
    );
  });

  it("asks a release-time procedure for its applicability only (#94)", async () => {
    const e = await prepared();
    const rp02 = workflowOf(e).procedures.find(
      (p) => p.templateId === "WP-RP-02",
    )!;
    const unassigned = {
      selected: true,
      applicability: "applicable",
      population: "",
      sampling: "",
      ownerId: "",
      reviewerId: "",
      dueDate: "",
    };
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, unassigned, rp02.id),
      "auditor",
    );
    expect(await submit(e)).toEqual({ programRevision: "1" });
    await command(
      e,
      "approveProgram",
      { revision: 1, reason: "Program agreed" },
      "reviewer",
    );
    // An approved program keeps asking ordinary work for its assignment,
    // but not the release-time record.
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, { ...unassigned, ownerId: "auditor" }, rp02.id),
      "lead",
    );
    expect(workflowOf(e).program.status).toBe("approved");
    await expectFailure(
      command(e, "saveProcedurePlan", planSave(e, { dueDate: "" }), "lead"),
      400,
      "WP-A10-01: approved work needs a preparer, a reviewer and a deadline",
    );
  });

  it("still checks an assignment a release-time procedure carries", async () => {
    const e = await prepared();
    const rp02 = workflowOf(e).procedures.find(
      (p) => p.templateId === "WP-RP-02",
    )!;
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, { ownerId: "", reviewerId: "", dueDate: "" }, rp02.id),
      "auditor",
    );
    rp02.reviewerId = "reviewer";
    rp02.contributors.push("reviewer");
    await expectFailure(
      submit(e),
      400,
      "WP-RP-02: reviewer must be independent",
    );
  });

  it("checks reviewer independence when planning and again at submission", async () => {
    // Saving makes the editor a contributor, so a Lead cannot name
    // themselves reviewer: assignment changes need no renewed approval.
    await expectFailure(
      prepared({ reviewerId: "second-lead" }, "second-lead"),
      400,
      "Choose a reviewer independent of this procedure's preparers",
    );
    // Submission rechecks the plans it binds.
    const e = await prepared();
    procedureOf(e, procedureId).contributors.push("reviewer");
    await expectFailure(
      submit(e),
      400,
      "WP-A10-01: reviewer must be independent",
    );
  });

  it("needs pinned model, dataset and protocol for automated work", async () => {
    for (const method of ["automated", "mixed"])
      await expectFailure(
        submit(await prepared({ method })),
        400,
        "WP-A10-01: pin model, dataset and protocol for automated work",
      );
  });
});

describe("program approval", () => {
  it("needs an independent approver of the current submitted revision", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    const approve = (userId: string, revision = 1) =>
      command(
        e,
        "approveProgram",
        { revision, reason: "Program agreed" },
        userId,
      );
    const stale = "Review the current submitted program against approved scope";
    await expectFailure(approve("reviewer"), 409, stale);
    await command(e, "submitProgram", {}, "auditor");
    await expectFailure(approve("auditor"), 403, reviewerOnly);
    await expectFailure(approve("lead"), 403, ownWork);
    await expectFailure(approve("reviewer", 2), 409, stale);
    expect(await approve("reviewer")).toEqual({ programRevision: "1" });
    const w = workflowOf(e);
    expect(w.program.status).toBe("approved");
    // The approval hashes every procedure's plan revision and plan hash,
    // the bindings its history entry records.
    const approval = {
      userId: "reviewer",
      at,
      revision: 1,
      hash: await sha256(JSON.stringify(bindingsOf(e))),
      reason: "Program agreed",
    };
    expect(w.program.approval).toEqual(approval);
    expect(w.program.history.at(-1)).toEqual({
      revision: 1,
      briefRevision: 1,
      status: "approved",
      approval,
      procedureRevisions: bindingsOf(e),
      at,
      actor: "reviewer",
    });
    await expectFailure(approve("reviewer"), 409, stale);
  });

  it("refuses a program bound to a scope that is no longer approved", async () => {
    // Commands cannot reach these states, since a scope change redrafts the
    // program; approval still checks the scope the program binds.
    for (const change of [{ status: "submitted" as const }, { revision: 2 }]) {
      const e = structuredEngagement();
      await approveScope(e);
      await planProgram(e);
      await command(e, "submitProgram", {}, "auditor");
      Object.assign(workflowOf(e).brief!, change);
      await expectFailure(
        command(
          e,
          "approveProgram",
          { revision: 1, reason: "Agreed" },
          "reviewer",
        ),
        409,
        "Review the current submitted program against approved scope",
      );
    }
  });

  it("returns a submitted program without making the reviewer a preparer", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    const send = (userId: string) =>
      command(e, "returnProgram", { reason: "Add the sampling basis" }, userId);
    await expectFailure(send("reviewer"), 409, "Return a submitted program");
    await command(e, "submitProgram", {}, "auditor");
    await expectFailure(send("auditor"), 403, reviewerOnly);
    expect(await send("reviewer")).toEqual({
      reason: "Add the sampling basis",
    });
    const program = workflowOf(e).program;
    expect(program).toMatchObject({
      status: "draft",
      revision: 2,
      contributors: ["lead", "auditor"],
      updatedBy: "reviewer",
    });
    expect(program.history.at(-1)).toEqual({
      revision: 1,
      briefRevision: 1,
      status: "returned",
      reason: "Add the sampling basis",
      procedureRevisions: bindingsOf(e),
      at,
      actor: "reviewer",
    });
    await command(e, "submitProgram", {}, "auditor");
    expect(
      await command(
        e,
        "approveProgram",
        { revision: 2, reason: "Program agreed" },
        "reviewer",
      ),
    ).toEqual({ programRevision: "2" });
  });

  it("never refuses a return", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    await command(e, "submitProgram", {}, "auditor");
    // More returns than the limit, as a lowered limit could leave them.
    const program = workflowOf(e).program;
    program.history.unshift(...programEntries(200, "returned"));
    await command(
      e,
      "returnProgram",
      { reason: "Size the sample" },
      "reviewer",
    );
    expect(program).toMatchObject({ status: "draft", revision: 2 });
    expect(program.history).toHaveLength(202);
  });
});

describe("changes to a program in force", () => {
  const replan = (e: Engagement, plan: Record<string, unknown>) =>
    command(e, "saveProcedurePlan", planSave(e, plan), "lead");
  const resample = { sampling: "Stratified sample of 40" };

  it("can be submitted and approved again one return short of the limit", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const program = workflowOf(e).program;
    program.history.unshift(
      ...programEntries(74, "returned"),
      ...programEntries(100, "submitted"),
      ...programEntries(100, "approved"),
    );
    await replan(e, resample);
    expect(program).toMatchObject({ status: "draft", revision: 2 });
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "approveProgram",
      { revision: 2, reason: "Revised sample agreed" },
      "reviewer",
    );
    expect(program.status).toBe("approved");
    expect(
      await command(
        e,
        "recordProcedureExecution",
        executionInput(e),
        "auditor",
      ),
    ).toEqual({ procedureId });
  });

  it("completes an approved scope change one return short of each limit", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const w = workflowOf(e);
    w.brief!.history = scopeReturns(e, 39);
    w.program.history.unshift(...programEntries(74, "returned"));
    await changeScope(e);
    expect(w).toMatchObject({
      brief: { revision: 2, status: "approved" },
      program: { status: "approved", briefRevision: 2 },
    });
    expect(
      await command(
        e,
        "recordProcedureExecution",
        executionInput(e),
        "auditor",
      ),
    ).toEqual({ procedureId });
  });

  it("is refused before it lands when the program could not be submitted again", async () => {
    // Commands never leave a program in force without a submission, since
    // only returns count; a lowered limit could. An assignment change needs
    // no submission.
    for (const status of ["approved", "submitted"]) {
      const e = structuredEngagement({ artifacts: [artifact()] });
      await approveScope(e);
      await planProgram(e);
      await command(e, "submitProgram", {}, "auditor");
      if (status === "approved")
        await command(
          e,
          "approveProgram",
          { revision: 1, reason: "Program agreed" },
          "reviewer",
        );
      const program = workflowOf(e).program,
        p = procedureOf(e, procedureId),
        before = structuredClone({ program, p });
      program.history.push(...programEntries(75, "returned"));
      await expectFailure(replan(e, resample), 413, programLimit);
      expect(p).toEqual(before.p);
      await replan(e, { dueDate: "2026-12-15" });
      expect(program).toMatchObject({ status, revision: 1 });
      expect(program.approval).toEqual(before.program.approval);
      expect(p).toMatchObject({
        dueDate: "2026-12-15",
        revision: before.p.revision,
      });
    }
  });

  it("records a submission that a Lead's change withdraws", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    await command(e, "submitProgram", {}, "auditor");
    const submitted = bindingsOf(e),
      program = workflowOf(e).program;
    // An assignment change leaves the submission pending.
    await replan(e, { dueDate: "2026-12-15" });
    expect(program.status).toBe("submitted");
    await replan(e, { dueDate: "2026-12-15", ...resample });
    expect(program).toMatchObject({ status: "draft", revision: 2 });
    expect(program.history.at(-1)).toEqual({
      revision: 1,
      briefRevision: 1,
      status: "withdrawn",
      procedureRevisions: submitted,
      at,
      actor: "lead",
    });
    // A scope change withdraws a pending submission too.
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "saveBrief",
      { ...briefInput, changeImpact: "Appeals are now in scope" },
      "lead",
    );
    expect(program).toMatchObject({ status: "draft", revision: 3 });
    expect(program.history.map((h) => h.revision + " " + h.status)).toEqual([
      "1 submitted",
      "1 withdrawn",
      "2 submitted",
      "2 withdrawn",
    ]);
  });
});
