import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Engagement } from "../domain";
import type { Procedure, ProcedurePlan } from "../workflow-types";
import {
  approveProgram,
  approveScope,
  at,
  briefInput,
  command,
  engagement,
  expectFailure,
  model,
  planInput,
  planProgram,
  procedureId,
  procedureOf,
  profile,
  artifact,
  sha256,
  structuredEngagement,
  templatePaper,
  workflowOf,
} from "./test-fixtures";

const writerOnly = "An Auditor or Lead Auditor must record this audit work";
const leadOnly = "A Lead Auditor must authorize this decision";
const reviewerOnly = "An independent Reviewer or Lead Auditor must approve";
const ownWork = "A preparer or contributor cannot approve their own work";
const unauthorized =
  "Select an active authorized person with the required role";
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
    expect(w.procedures).toHaveLength(33);
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

  it("keeps each earlier revision in the history", async () => {
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
    expect(brief.history).toEqual([
      {
        ...briefInput,
        revision: 1,
        status: "draft",
        contributors: ["auditor"],
        updatedBy: "auditor",
        updatedAt: at,
      },
    ]);
  });

  it("caps the scope revision history", async () => {
    const e = structuredEngagement();
    await command(e, "saveBrief", briefInput, "auditor");
    const brief = workflowOf(e).brief!;
    const { history, ...snapshot } = brief;
    brief.history = Array.from({ length: 40 }, () => ({ ...snapshot }));
    await expectFailure(
      command(e, "saveBrief", briefInput, "auditor"),
      413,
      "Scope revision limit reached",
    );
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

  it("returns a submitted scope with the reason as its change impact", async () => {
    const e = structuredEngagement();
    const send = (userId: string) =>
      command(e, "returnBrief", { reason: "Clarify the boundary" }, userId);
    await expectFailure(send("reviewer"), 400, "Complete the brief first");
    await command(e, "saveBrief", briefInput, "auditor");
    await expectFailure(send("reviewer"), 409, "Return a submitted scope");
    await command(e, "submitBrief", {}, "auditor");
    await expectFailure(send("auditor"), 403, reviewerOnly);
    expect(await send("reviewer")).toEqual({ reason: "Clarify the boundary" });
    const brief = workflowOf(e).brief!;
    expect(brief).toMatchObject({
      revision: 1,
      status: "draft",
      changeImpact: "Clarify the boundary",
      contributors: ["auditor"],
    });
    expect(brief.approval).toBeUndefined();
    expect(brief.history).toEqual([
      {
        ...briefInput,
        revision: 1,
        status: "submitted",
        contributors: ["auditor"],
        updatedBy: "auditor",
        updatedAt: at,
      },
    ]);
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
    // The approved program no longer binds the current scope.
    expect(w.program).toMatchObject({
      revision: approved.revision + 1,
      status: "draft",
      contributors: ["lead", "auditor"],
      updatedBy: "lead",
    });
    expect(w.program.approval).toBeUndefined();
    expect(w.program.history.at(-1)).toEqual({
      revision: approved.revision,
      briefRevision: 1,
      status: "approved",
      approval: approved.approval,
      procedureRevisions: w.procedures.map((p) => ({
        id: p.id,
        revision: p.revision,
      })),
      at,
      actor: "lead",
    });
  });
});

describe("procedure planning", () => {
  const save = (
    e: Engagement,
    plan: Record<string, unknown> = {},
    userId = "auditor",
  ) =>
    command(
      e,
      "saveProcedurePlan",
      { procedureId, plan: planInput(plan) },
      userId,
    );

  it("plans a procedure, keeps its prior plan and redrafts the program", async () => {
    const e = structuredEngagement();
    const before = structuredClone(procedureOf(e, procedureId));
    expect(await save(e)).toEqual({ procedureId });
    const p = procedureOf(e, procedureId);
    expect(p).toMatchObject({
      ...planInput(),
      revision: 2,
      contributors: ["lead", "auditor"],
      updatedBy: "auditor",
      updatedAt: at,
    });
    expect(p.review).toBeUndefined();
    expect(p.history).toEqual([
      { plan: planOf(before), revision: 1, at, actor: "auditor" },
    ]);
    expect(workflowOf(e).program).toMatchObject({
      revision: 2,
      status: "draft",
      contributors: ["lead", "auditor"],
    });
  });

  it("is recorded by an Auditor or Lead for a known procedure", async () => {
    const e = structuredEngagement();
    await expectFailure(save(e, {}, "reviewer"), 403, writerOnly);
    await expectFailure(
      command(
        e,
        "saveProcedurePlan",
        { procedureId: "PROC-unknown", plan: planInput() },
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
    const later = { dueDate: "2026-12-15" };
    await expectFailure(save(e, later), 403, leadOnly);
    await save(e, later, "lead");
    expect(procedureOf(e, procedureId).dueDate).toBe("2026-12-15");
    expect(workflowOf(e).program.status).toBe("draft");
    expect(workflowOf(e).program.approval).toBeUndefined();
  });

  it("caps the procedure revision history", async () => {
    const e = structuredEngagement();
    const p = procedureOf(e, procedureId);
    p.history = Array.from({ length: 30 }, () => ({
      plan: planOf(p),
      revision: 1,
      at,
      actor: "auditor",
    }));
    await expectFailure(
      save(e),
      413,
      "This procedure reached its revision limit; start a follow-up engagement",
    );
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

  it("assigns owners, reviewers and deadlines in one program revision", async () => {
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
        revision: 2,
        contributors: ["lead", "auditor"],
        updatedBy: "auditor",
      });
    expect(procedureOf(e, "PROC-WP-A11-01").revision).toBe(1);
    expect(workflowOf(e).program.revision).toBe(2);
  });

  it("validates the whole batch before changing any procedure", async () => {
    const e = structuredEngagement();
    // A Lead who plans one procedure cannot then review it.
    await command(
      e,
      "saveProcedurePlan",
      { procedureId: "PROC-WP-A12-01", plan: planInput() },
      "second-lead",
    );
    await expectFailure(
      bulk(e, { reviewerId: "second-lead" }),
      400,
      "Choose an independent reviewer for " +
        procedureOf(e, "PROC-WP-A12-01").title,
    );
    expect(procedureOf(e, procedureId).revision).toBe(1);
    expect(workflowOf(e).program.revision).toBe(2);
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

  it("needs a Lead once the program left draft and respects revision limits", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    await expectFailure(bulk(e, { dueDate: "2026-12-01" }), 403, leadOnly);
    workflowOf(e).program.history.length = 150;
    await expectFailure(
      bulk(e, { dueDate: "2026-12-01" }, "lead"),
      413,
      "Revision limit reached",
    );
  });
});

describe("program scoping", () => {
  it("records applicability decisions and fills a missing criterion", async () => {
    const e = structuredEngagement();
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
      criterion:
        "Approved engagement methodology: Establish a defensible engagement mandate, competence and independence.",
      revision: 2,
      contributors: ["lead", "auditor"],
    });
    expect(procedureOf(e, procedureId).criterion).toBe("Art.10; Art.4a");
    expect(workflowOf(e).program.revision).toBe(2);
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
    await command(
      e,
      "saveProcedurePlan",
      { procedureId, plan: planInput(plan) },
      userId,
    );
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
    expect(await submit(e)).toEqual({ programRevision: "3" });
    expect(workflowOf(e).program).toMatchObject({
      status: "submitted",
      revision: 3,
      briefRevision: 1,
    });
    await expectFailure(
      submit(e),
      409,
      "Only a draft program can be submitted",
    );
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
      { procedureId, plan: planInput({ applicability: "readiness" }) },
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

  it("rechecks reviewer independence at submission", async () => {
    // A Lead who names themselves reviewer while editing the plan becomes
    // one of its contributors.
    await expectFailure(
      submit(await prepared({ reviewerId: "second-lead" }, "second-lead")),
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
    const approve = (userId: string, revision = 3) =>
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
    expect(await approve("reviewer")).toEqual({ programRevision: "3" });
    const w = workflowOf(e);
    expect(w.program.status).toBe("approved");
    // The approval hashes every procedure's revision and plan.
    expect(w.program.approval).toEqual({
      userId: "reviewer",
      at,
      revision: 3,
      hash: await sha256(
        JSON.stringify(
          w.procedures.map((p) => ({
            id: p.id,
            revision: p.revision,
            plan: planOf(p),
          })),
        ),
      ),
      reason: "Program agreed",
    });
    await expectFailure(approve("reviewer"), 409, stale);
  });

  it("refuses a program bound to a scope that is no longer approved", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    await command(e, "submitProgram", {}, "auditor");
    workflowOf(e).brief!.status = "submitted";
    await expectFailure(
      command(
        e,
        "approveProgram",
        { revision: 3, reason: "Agreed" },
        "reviewer",
      ),
      409,
      "Review the current submitted program against approved scope",
    );
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
      revision: 4,
      contributors: ["lead", "auditor"],
      updatedBy: "reviewer",
    });
    expect(program.history.at(-1)).toMatchObject({
      revision: 3,
      status: "submitted",
      actor: "reviewer",
    });
    await command(e, "submitProgram", {}, "auditor");
    expect(
      await command(
        e,
        "approveProgram",
        { revision: 4, reason: "Program agreed" },
        "reviewer",
      ),
    ).toEqual({ programRevision: "4" });
  });
});
