import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { completionGates, finalReportGates, type Engagement } from "../domain";
import { currentExecution } from "../workflow-state";
import {
  approveProgram,
  approveScope,
  artifact,
  assessmentInput,
  at,
  briefInput,
  changeScope,
  command,
  engagement,
  evidenceRequest,
  executionInput,
  expectFailure,
  model,
  planInput,
  planProgram,
  procedureId,
  procedureOf,
  profile,
  run,
  sha256,
  structuredEngagement,
  submittedProcedure,
  templatePaper,
  workflowOf,
} from "./test-fixtures";

const writerOnly = "An Auditor or Lead Auditor must record this audit work";
const reviewerOnly = "An independent Reviewer or Lead Auditor must approve";
const ownWork = "A preparer or contributor cannot approve their own work";
const notReady = "Approve the current scope and audit program before execution";
const unaccepted = "Link accepted evidence from this engagement";

/** An engagement whose approved program is ready for execution. */
async function ready(overrides: Partial<Engagement> = {}) {
  const e = structuredEngagement({ artifacts: [artifact()], ...overrides });
  await approveProgram(e);
  return e;
}
const record = (
  e: Engagement,
  overrides: Record<string, unknown> = {},
  userId = "auditor",
) =>
  command(e, "recordProcedureExecution", executionInput(e, overrides), userId);
const evaluate = (e: Engagement, userId = "auditor") =>
  command(e, "evaluateProcedure", assessmentInput, userId);
const paperOf = (e: Engagement) => {
  const id = procedureOf(e, procedureId).paperId;
  const paper = e.papers.find((q) => q.id === id);
  if (!paper) throw new Error("The procedure has no working paper");
  return paper;
};

describe("procedure working papers", () => {
  it("creates a supplementary paper once and then reuses it", async () => {
    const e = structuredEngagement();
    await command(
      e,
      "saveProcedurePlan",
      { procedureId, plan: planInput() },
      "auditor",
    );
    await expectFailure(
      command(e, "ensureProcedurePaper", { procedureId }, "reviewer"),
      403,
      writerOnly,
    );
    const first = await command(
      e,
      "ensureProcedurePaper",
      { procedureId },
      "auditor",
    );
    expect(first).toEqual({ paperId: paperOf(e).id, procedureId });
    expect(paperOf(e)).toMatchObject({
      templateId: "WP-A10-01",
      required: false,
      status: "draft",
      body: {
        scope: "All 2026 training and validation datasets",
        criteria: "Art. 10(2)-(5)",
      },
    });
    expect(
      await command(e, "ensureProcedurePaper", { procedureId }, "auditor"),
    ).toEqual(first);
    expect(e.papers).toHaveLength(1);
  });
});

describe("procedure execution", () => {
  it("needs the approved scope and program before anything else", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveScope(e);
    await planProgram(e);
    await expectFailure(record(e), 409, notReady);
    await expectFailure(
      command(e, "recordProcedureExecution", {}, "auditor"),
      409,
      notReady,
    );
    await expectFailure(record(e, {}, "reviewer"), 403, writerOnly);
  });

  it("records the preparer's work against the approved revisions", async () => {
    const e = await ready();
    expect(await record(e)).toEqual({ procedureId });
    const p = procedureOf(e, procedureId),
      w = workflowOf(e);
    const { procedureId: omitted, ...performed } = executionInput(e);
    expect(omitted).toBe(procedureId);
    expect(p.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.execution).toEqual({
      ...performed,
      id: expect.stringMatching(/^EXEC-\d+$/),
      revision: 1,
      procedureRevision: p.revision,
      planHash: p.planHash,
      briefRevision: w.brief?.revision,
      programRevision: w.program.revision,
      actor: "auditor",
      at,
    });
    expect(p).toMatchObject({
      state: "executed",
      contributors: ["lead", "auditor"],
    });
    expect(p.history.at(-1)).toMatchObject({
      revision: p.revision,
      execution: undefined,
      actor: "auditor",
    });
    await record(e, { results: "One exception, remediated" });
    expect(p.execution).toMatchObject({
      revision: 2,
      results: "One exception, remediated",
    });
    expect(p.history.at(-1)?.execution?.revision).toBe(1);
  });

  it("lets only the assigned preparer or a Lead record execution", async () => {
    const e = await ready();
    await expectFailure(
      record(e, {}, "second-auditor"),
      403,
      "The assigned preparer or Lead must record execution",
    );
    await record(e, {}, "second-lead");
    expect(procedureOf(e, procedureId).execution?.actor).toBe("second-lead");
  });

  it("refuses procedures outside the approved program", async () => {
    const e = await ready();
    await expectFailure(
      record(e, { procedureId: "PROC-WP-A12-01" }),
      409,
      "This procedure is outside the approved execution program",
    );
    await expectFailure(
      record(e, { procedureId: "PROC-unknown" }),
      404,
      "Procedure not found in this engagement",
    );
  });

  it("needs accepted evidence from this engagement", async () => {
    const e = await ready({
      artifacts: [
        artifact(),
        artifact({ id: "pending", status: "unverified" }),
      ],
    });
    await expectFailure(
      record(e, { evidenceIds: ["pending"] }),
      400,
      unaccepted,
    );
    await expectFailure(
      record(e, { evidenceIds: ["evidence", "elsewhere"] }),
      400,
      unaccepted,
    );
    await expect(record(e, { evidenceIds: [] })).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it("needs every planned step once and a reason for omitted work", async () => {
    const e = await ready();
    const steps = executionInput(e).steps;
    const omitted = "Record every planned step once; explain omitted work";
    for (const invalid of [
      steps.slice(1),
      [...steps.slice(1), steps[1]],
      [...steps.slice(1), { ...steps[0], id: "WP-A10-01-P99" }],
      [{ ...steps[0], state: "not_performed" }, ...steps.slice(1)],
      [{ ...steps[0], state: "not_performed", notes: " " }, ...steps.slice(1)],
    ])
      await expectFailure(record(e, { steps: invalid }), 400, omitted);
    await record(e, {
      steps: [
        {
          ...steps[0],
          state: "not_performed",
          notes: "Superseded by population testing",
        },
        ...steps.slice(1),
      ],
    });
    expect(procedureOf(e, procedureId).state).toBe("executed");
  });

  it("needs completed runs bound to the approved procedure for automated work", async () => {
    const e = structuredEngagement({
      artifacts: [artifact(), artifact({ id: "dataset", category: "Dataset" })],
      models: [model()],
      evaluationProfiles: [profile()],
    });
    await approveScope(e);
    await planProgram(e);
    await command(
      e,
      "saveProcedurePlan",
      {
        procedureId,
        plan: planInput({
          method: "automated",
          modelId: "model",
          datasetId: "dataset",
          profileId: "protocol",
        }),
      },
      "auditor",
    );
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "approveProgram",
      { revision: workflowOf(e).program.revision, reason: "Program agreed" },
      "reviewer",
    );
    await expectFailure(
      record(e),
      400,
      "Include the planned automated evaluation",
    );
    const p = procedureOf(e, procedureId),
      w = workflowOf(e);
    const approved = {
      procedureId,
      procedureRevision: p.revision,
      briefRevision: w.brief!.revision,
      programRevision: w.program.revision,
    };
    // A succeeded run of the planned model, dataset and protocol whose
    // provenance carries a valid hash of its own binding.
    const boundRun = async (
      id: string,
      change: Partial<typeof approved> = {},
    ) => {
      const procedureBinding = { ...approved, ...change };
      return run({
        id,
        modelId: "model",
        datasetId: "dataset",
        profileId: "protocol",
        procedureBinding,
        provenance: {
          inputHashes: {
            auditBinding: await sha256(JSON.stringify(procedureBinding)),
          },
          runnerVersion: "1.0",
          policyVersion: "1.0",
        },
      });
    };
    const bound = await boundRun("RUN-bound");
    e.runs.push(
      bound,
      { ...bound, id: "RUN-failed", state: "failed" },
      { ...bound, id: "RUN-unbound", procedureBinding: undefined },
      {
        ...bound,
        id: "RUN-forged",
        provenance: { ...bound.provenance, inputHashes: { auditBinding: "0" } },
      },
      // Runs queued for another procedure or under an earlier revision: their
      // hashes are valid, so only the binding comparison can reject them.
      await boundRun("RUN-other-procedure", { procedureId: "PROC-WP-A12-01" }),
      await boundRun("RUN-stale-procedure", {
        procedureRevision: p.revision - 1,
      }),
      await boundRun("RUN-stale-brief", {
        briefRevision: w.brief!.revision - 1,
      }),
      // Program revisions do not bind runs: one queued under an earlier
      // revision counts while this plan and the scope are unchanged.
      await boundRun("RUN-earlier-program", {
        programRevision: w.program.revision - 1,
      }),
      { ...bound, id: "RUN-other-model", modelId: "other" },
      { ...bound, id: "RUN-other-data", datasetId: "other" },
      { ...bound, id: "RUN-other-protocol", profileId: "other" },
    );
    for (const runId of [
      "RUN-failed",
      "RUN-unbound",
      "RUN-forged",
      "RUN-other-procedure",
      "RUN-stale-procedure",
      "RUN-stale-brief",
      "RUN-other-model",
      "RUN-other-data",
      "RUN-other-protocol",
      "RUN-missing",
    ])
      await expectFailure(
        record(e, { runIds: [runId] }),
        400,
        "Link completed runs bound to this approved procedure and scope",
      );
    await record(e, { runIds: ["RUN-bound", "RUN-earlier-program"] });
    expect(procedureOf(e, procedureId).execution?.runIds).toEqual([
      "RUN-bound",
      "RUN-earlier-program",
    ]);
  });

  it("keeps submitted work unchanged until the review is resolved", async () => {
    const e = await submittedProcedure();
    await expectFailure(
      record(e),
      409,
      "Resolve the submitted review before changing execution",
    );
  });
});

describe("evidence evaluation", () => {
  it("records the preparer's assessment of the current execution", async () => {
    const e = await ready();
    await expectFailure(
      evaluate(e),
      409,
      "Record current execution before evaluation",
    );
    await record(e);
    await expectFailure(evaluate(e, "reviewer"), 403, writerOnly);
    expect(await evaluate(e)).toEqual({ procedureId });
    const p = procedureOf(e, procedureId);
    const { procedureId: omitted, ...assessment } = assessmentInput;
    expect(omitted).toBe(procedureId);
    expect(p.execution?.assessment).toEqual({
      ...assessment,
      actor: "auditor",
      at,
    });
    expect(p.state).toBe("evaluated");
    expect(p.history.at(-1)?.execution?.assessment).toBeUndefined();
  });

  it("validates the conclusion", async () => {
    const e = await ready();
    await record(e);
    for (const invalid of [
      { ...assessmentInput, outcome: "partly" },
      { ...assessmentInput, coverage: "" },
      { ...assessmentInput, extra: "field" },
    ])
      await expect(
        command(e, "evaluateProcedure", invalid, "auditor"),
      ).rejects.toBeInstanceOf(ZodError);
  });

  it("needs evidence that is still accepted", async () => {
    const e = await ready();
    await record(e);
    e.artifacts[0].status = "quarantined";
    await expectFailure(evaluate(e), 400, unaccepted);
  });

  it("refuses an execution that predates a scope change", async () => {
    const e = await ready();
    await record(e);
    await changeScope(e);
    await expectFailure(
      evaluate(e),
      409,
      "Record current execution before evaluation",
    );
  });
});

describe("scope change impact review", () => {
  const reaffirm = (e: Engagement, userId: string) =>
    command(
      e,
      "reaffirmExecution",
      { procedureId, reason: "The appeals change does not affect this work" },
      userId,
    );

  it("lets an independent reviewer reaffirm work after a scope change", async () => {
    const e = await ready();
    await record(e);
    await evaluate(e);
    await changeScope(e);
    await expectFailure(
      command(e, "submitProcedure", { procedureId }, "auditor"),
      409,
      "Evaluate current execution before review",
    );
    await expectFailure(reaffirm(e, "auditor"), 403, reviewerOnly);
    await expectFailure(reaffirm(e, "lead"), 403, ownWork);
    expect(await reaffirm(e, "reviewer")).toEqual({ procedureId });
    const p = procedureOf(e, procedureId),
      w = workflowOf(e);
    expect(p.execution?.impactReview).toEqual({
      briefRevision: 2,
      programRevision: w.program.revision,
      actor: "reviewer",
      at,
      reason: "The appeals change does not affect this work",
    });
    expect(p.state).toBe("evaluated");
    expect(p.contributors).not.toContain("reviewer");
    expect(
      await command(e, "submitProcedure", { procedureId }, "auditor"),
    ).toMatchObject({ procedureId });
  });

  it("returns unevaluated work to the executed state", async () => {
    const e = await ready();
    await record(e);
    await changeScope(e);
    await reaffirm(e, "reviewer");
    expect(procedureOf(e, procedureId).state).toBe("executed");
    expect(await evaluate(e)).toEqual({ procedureId });
  });

  it("needs a new execution once the procedure plan changed", async () => {
    const changed = "A changed procedure plan requires a new execution";
    const e = await ready();
    await expectFailure(reaffirm(e, "reviewer"), 409, changed);
    await record(e);
    await command(
      e,
      "saveProcedurePlan",
      { procedureId, plan: planInput({ sampling: "Stratified sample of 40" }) },
      "lead",
    );
    await expectFailure(reaffirm(e, "reviewer"), 409, notReady);
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "approveProgram",
      { revision: workflowOf(e).program.revision, reason: "Agreed" },
      "reviewer",
    );
    await expectFailure(reaffirm(e, "reviewer"), 409, changed);
  });
});

describe("procedure submission", () => {
  it("compiles the evaluated execution into a working paper for review", async () => {
    const e = await submittedProcedure();
    const p = procedureOf(e, procedureId),
      paper = paperOf(e);
    expect(p).toMatchObject({ state: "submitted", paperRevision: 1 });
    expect(paper).toMatchObject({
      templateId: "WP-A10-01",
      revision: 1,
      status: "in_review",
      required: true,
      authorId: "auditor",
      contributors: ["lead", "auditor"],
      evidenceIds: ["evidence"],
      runIds: [],
      reviews: [],
      signatures: [],
      updatedAt: at,
      plannedGuidance: p.instructions.map((i) => i.text).join("\n"),
    });
    expect(paper.body).toEqual({
      objective: p.objective,
      scope:
        "All 2026 training and validation datasets\nApproved engagement brief revision 1",
      criteria:
        "Art. 10(2)-(5)\nSource 02024R1689-20260727\nTraining data used throughout the audit period",
      procedures: [
        "Inspected lineage records and reperformed coverage checks",
        ...p.instructions.map((i) => i.text + ": performed "),
      ].join("\n"),
      sampling: "All datasets",
      results: [
        "No exceptions noted",
        "Relevance: The records cover the training population",
        "Reliability: System-generated lineage logs",
        "Coverage: Every dataset used in the period",
        "Contradictions: None identified",
      ].join("\n"),
      limitations: "",
      conclusion: "Data governance operates as described",
      conclusionStatus: "supported",
    });
  });

  it("needs an evaluated current execution", async () => {
    const e = await ready();
    const submit = () =>
      command(e, "submitProcedure", { procedureId }, "auditor");
    await expectFailure(
      command(e, "submitProcedure", { procedureId }, "reviewer"),
      403,
      writerOnly,
    );
    await expectFailure(
      submit(),
      409,
      "Evaluate current execution before review",
    );
    await record(e);
    await expectFailure(
      submit(),
      409,
      "Evaluate current execution before review",
    );
    await evaluate(e);
    e.artifacts[0].status = "quarantined";
    await expectFailure(submit(), 400, unaccepted);
  });

  it("waits for related evidence requests and open review questions", async () => {
    const e = await ready();
    await record(e);
    await evaluate(e);
    const { paperId } = await command(
      e,
      "ensureProcedurePaper",
      { procedureId },
      "auditor",
    );
    const submit = () =>
      command(e, "submitProcedure", { procedureId }, "auditor");
    e.evidenceRequests = [
      evidenceRequest({ paperIds: [paperId], status: "submitted" }),
    ];
    await expectFailure(
      submit(),
      400,
      "Resolve related evidence requests before procedure review",
    );
    e.evidenceRequests[0].status = "waived";
    paperOf(e).comments.push({
      id: "Q-1",
      authorId: "reviewer",
      text: "Which datasets were excluded?",
      resolved: false,
      createdAt: at,
    });
    await expectFailure(
      submit(),
      400,
      "Respond to and resolve open review questions",
    );
    paperOf(e).comments[0].resolved = true;
    expect(await submit()).toEqual({ procedureId, paperId });
    // The supplementary paper becomes a revision of the required paper.
    expect(paperOf(e)).toMatchObject({
      revision: 2,
      required: true,
      status: "in_review",
    });
    expect(paperOf(e).history).toHaveLength(1);
  });

  it("compiles a fresh paper instead of reopening a signed one", async () => {
    const signed = { ...templatePaper("WP-A10-01"), status: "signed" as const };
    const e = engagement({ papers: [signed], artifacts: [artifact()] });
    await command(e, "adoptWorkflow", {}, "lead");
    await approveProgram(e);
    await record(e);
    await evaluate(e);
    const { paperId } = await command(
      e,
      "submitProcedure",
      { procedureId },
      "auditor",
    );
    expect(paperId).not.toBe(signed.id);
    expect(signed).toMatchObject({ status: "signed", revision: 1 });
    expect(e.papers.map((q) => q.id)).toEqual([signed.id, paperId]);
  });
});

describe("procedure review", () => {
  const review = (e: Engagement, userId = "reviewer") =>
    command(
      e,
      "reviewProcedure",
      { procedureId, reason: "The evidence supports the conclusion" },
      userId,
    );

  it("records the assigned independent reviewer's approval", async () => {
    const e = await submittedProcedure();
    const p = procedureOf(e, procedureId),
      paper = paperOf(e);
    expect(await review(e)).toEqual({ procedureId, paperId: paper.id });
    expect(paper).toMatchObject({
      status: "reviewed",
      reviews: [{ userId: "reviewer", revision: 1, at }],
    });
    expect(p.review).toEqual({
      userId: "reviewer",
      at,
      revision: p.revision,
      hash: await sha256(JSON.stringify(p.execution)),
      reason: "The evidence supports the conclusion",
    });
    expect(p.state).toBe("reviewed");
    await expectFailure(
      review(e),
      409,
      "Review the current submitted revision with resolved questions",
    );
  });

  it("accepts only the assigned, independent reviewer", async () => {
    const e = await submittedProcedure();
    await expectFailure(review(e, "auditor"), 403, reviewerOnly);
    await expectFailure(review(e, "lead"), 403, ownWork);
    await expectFailure(
      review(e, "second-reviewer"),
      403,
      "Only the assigned independent reviewer can approve this procedure",
    );
    paperOf(e).contributors.push("reviewer");
    await expectFailure(
      review(e),
      403,
      "The paper reviewer must be independent",
    );
  });

  it("reviews only the current submitted revision with resolved questions", async () => {
    const stale =
      "Review the current submitted revision with resolved questions";
    const questioned = await submittedProcedure();
    paperOf(questioned).comments.push({
      id: "Q-1",
      authorId: "reviewer",
      text: "Explain the exclusions",
      resolved: false,
      createdAt: at,
    });
    await expectFailure(review(questioned), 409, stale);
    const edited = await submittedProcedure();
    paperOf(edited).revision = 2;
    await expectFailure(review(edited), 409, stale);
    const reopened = await submittedProcedure();
    paperOf(reopened).status = "draft";
    await expectFailure(review(reopened), 409, stale);
    const changed = await submittedProcedure();
    await command(
      changed,
      "saveBrief",
      { ...briefInput, changeImpact: "Appeals are now in scope" },
      "lead",
    );
    await expectFailure(review(changed), 409, notReady);
  });
});

describe("returning submitted work", () => {
  const send = (e: Engagement, userId = "reviewer") =>
    command(
      e,
      "returnProcedure",
      { procedureId, reason: "Explain the sampling basis" },
      userId,
    );

  it("returns submitted work to its preparer with the question on the paper", async () => {
    const e = await submittedProcedure();
    await expect(
      command(e, "returnProcedure", { procedureId }, "reviewer"),
    ).rejects.toBeInstanceOf(ZodError);
    await expectFailure(send(e, "auditor"), 403, reviewerOnly);
    await expectFailure(
      send(e, "second-reviewer"),
      409,
      "The assigned reviewer can return submitted work",
    );
    expect(await send(e)).toEqual({ procedureId });
    const p = procedureOf(e, procedureId),
      paper = paperOf(e);
    expect(p.state).toBe("evaluated");
    expect(p.review).toBeUndefined();
    expect(paper).toMatchObject({
      status: "draft",
      reviews: [],
      signatures: [],
    });
    expect(paper.comments).toEqual([
      {
        id: expect.stringMatching(/^COMMENT-\d+$/),
        authorId: "reviewer",
        text: "Explain the sampling basis",
        resolved: false,
        createdAt: at,
      },
    ]);
    await expectFailure(
      send(e),
      409,
      "The assigned reviewer can return submitted work",
    );
  });

  it("revises the same paper when the answered work is resubmitted", async () => {
    const e = await submittedProcedure();
    await send(e);
    const submit = () =>
      command(e, "submitProcedure", { procedureId }, "auditor");
    await expectFailure(
      submit(),
      400,
      "Respond to and resolve open review questions",
    );
    paperOf(e).comments[0].resolved = true;
    await submit();
    expect(paperOf(e)).toMatchObject({ revision: 2, status: "in_review" });
    expect(procedureOf(e, procedureId).paperRevision).toBe(2);
  });
});

describe("structured engagement completion", () => {
  it("clears the final gates once the reviewed working paper is signed", async () => {
    const e = await submittedProcedure();
    e.stage = "Sign-off";
    expect(completionGates(e).map((g) => g.message)).toEqual([
      "WP-A10-01: current execution and independent review required",
      "WP-A10-01 is not signed",
    ]);
    await command(
      e,
      "reviewProcedure",
      { procedureId, reason: "The evidence supports the conclusion" },
      "reviewer",
    );
    expect(completionGates(e).map((g) => g.message)).toEqual([
      "WP-A10-01: sign the procedure working-paper revision",
      "WP-A10-01 is not signed",
    ]);
    // Signing is a working-paper command of the workspace route.
    paperOf(e).status = "signed";
    for (const opinion of ["Readiness assessment", "Adverse conclusion"])
      expect(finalReportGates(e, opinion)).toEqual([]);
  });
});

describe("plan changes after execution", () => {
  const other = "PROC-WP-A12-01";
  const plan = (id: string, change: Record<string, unknown> = {}) => ({
    procedureId: id,
    plan: planInput(
      id === other
        ? { criterion: "Art. 12", population: "2026 event logs", ...change }
        : change,
    ),
  });
  const workOn = (e: Engagement, id: string) =>
    executionInput(e, {
      procedureId: id,
      steps: procedureOf(e, id).instructions.map((i) => ({
        id: i.id,
        state: "performed",
        notes: "",
      })),
    });
  /**
   * An approved program of two procedures: `procedureId` executed, reviewed
   * and signed; WP-A12-01 executed and evaluated.
   */
  async function recorded() {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveScope(e);
    await planProgram(e);
    await command(e, "saveProcedurePlan", plan(other), "auditor");
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "approveProgram",
      { revision: workflowOf(e).program.revision, reason: "Program agreed" },
      "reviewer",
    );
    await record(e);
    await evaluate(e);
    await command(e, "submitProcedure", { procedureId }, "auditor");
    await command(
      e,
      "reviewProcedure",
      { procedureId, reason: "The evidence supports the conclusion" },
      "reviewer",
    );
    // Signing is a working-paper command of the workspace route.
    paperOf(e).status = "signed";
    await command(e, "recordProcedureExecution", workOn(e, other), "auditor");
    await command(
      e,
      "evaluateProcedure",
      { ...assessmentInput, procedureId: other },
      "auditor",
    );
    e.stage = "Sign-off";
    return e;
  }
  const current = (e: Engagement) =>
    workflowOf(e).procedures.filter(
      (p) => p.execution && currentExecution(e, p),
    );
  const outstanding = (e: Engagement) =>
    completionGates(e).map((g) => g.message);
  const reviewed =
    "WP-A12-01: current execution and independent review required";

  it("keeps executions, reviews and the program approval across due-date and owner changes", async () => {
    const e = await recorded();
    const approved = structuredClone(workflowOf(e).program),
      executions = workflowOf(e).procedures.map((p) => p.execution);
    expect(current(e).map((p) => p.id)).toEqual([procedureId, other]);
    expect(outstanding(e)).toEqual([reviewed]);
    await command(
      e,
      "saveProcedurePlan",
      plan(procedureId, { dueDate: "2026-12-15" }),
      "lead",
    );
    await command(
      e,
      "bulkPlanProcedures",
      {
        procedureIds: [procedureId, other],
        patch: { ownerId: "second-auditor" },
      },
      "lead",
    );
    // Pending review moves to another independent reviewer just as freely.
    await command(
      e,
      "bulkPlanProcedures",
      { procedureIds: [other], patch: { reviewerId: "second-reviewer" } },
      "lead",
    );
    const w = workflowOf(e);
    expect(w.program).toMatchObject({
      status: "approved",
      revision: approved.revision,
      approval: approved.approval,
      history: approved.history,
    });
    expect(w.procedures.map((p) => p.execution)).toEqual(executions);
    expect(current(e).map((p) => p.id)).toEqual([procedureId, other]);
    expect(procedureOf(e, procedureId)).toMatchObject({
      state: "reviewed",
      dueDate: "2026-12-15",
      ownerId: "second-auditor",
      review: { userId: "reviewer" },
    });
    expect(outstanding(e)).toEqual([reviewed]);
    await command(e, "submitProcedure", { procedureId: other }, "auditor");
    await command(
      e,
      "reviewProcedure",
      { procedureId: other, reason: "The evidence supports the conclusion" },
      "second-reviewer",
    );
    expect(outstanding(e)).toEqual([
      "WP-A12-01: sign the procedure working-paper revision",
      "WP-A12-01 is not signed",
    ]);
  });

  it("invalidates only the procedure whose content changed", async () => {
    const e = await recorded();
    const revision = workflowOf(e).program.revision;
    await command(
      e,
      "saveProcedurePlan",
      plan(other, { sampling: "Stratified sample of 40 days" }),
      "lead",
    );
    expect(workflowOf(e).program).toMatchObject({
      status: "draft",
      revision: revision + 1,
    });
    expect(current(e).map((p) => p.id)).toEqual([procedureId]);
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "approveProgram",
      { revision: revision + 1, reason: "Revised sample agreed" },
      "reviewer",
    );
    // The reviewed and signed procedure needs nothing more.
    expect(outstanding(e)).toEqual([reviewed]);
    expect(procedureOf(e, procedureId).review).toMatchObject({
      userId: "reviewer",
    });
    await expectFailure(
      command(
        e,
        "evaluateProcedure",
        { ...assessmentInput, procedureId: other },
        "auditor",
      ),
      409,
      "Record current execution before evaluation",
    );
    await command(e, "recordProcedureExecution", workOn(e, other), "auditor");
    expect(current(e).map((p) => p.id)).toEqual([procedureId, other]);
    // Changing the reviewed procedure's content invalidates it in turn.
    await command(
      e,
      "saveProcedurePlan",
      plan(procedureId, { population: "Training datasets only" }),
      "lead",
    );
    expect(current(e).map((p) => p.id)).toEqual([other]);
    expect(procedureOf(e, procedureId).review).toBeUndefined();
  });

  describe("in an engagement saved before plan hashes", () => {
    // The shape saved until November 2026: no plan hashes or assignment
    // revisions, a program revision and history entry for every plan save,
    // and executions bound to the program revision.
    async function saved() {
      const e = await recorded(),
        w = workflowOf(e);
      for (const p of w.procedures) {
        delete p.planHash;
        delete p.planAmended;
        delete p.assignmentRevision;
        if (p.execution) {
          delete p.execution.planHash;
          p.execution.programRevision = 151;
        }
      }
      const revisions = w.procedures.map((p) => ({
        id: p.id,
        revision: p.revision,
      }));
      w.program.history = Array.from({ length: 150 }, (_, i) => ({
        revision: i + 1,
        briefRevision: 1,
        status: "draft",
        procedureRevisions: revisions,
        at,
        actor: "auditor",
      }));
      w.program.revision = 151;
      w.program.approval!.revision = 151;
      // As the workspace route loads it from storage.
      return JSON.parse(JSON.stringify(e)) as Engagement;
    }

    it("keeps its executed and reviewed procedures valid", async () => {
      const e = await saved();
      expect(current(e).map((p) => p.id)).toEqual([procedureId, other]);
      expect(outstanding(e)).toEqual([reviewed]);
      await command(
        e,
        "bulkPlanProcedures",
        {
          procedureIds: [procedureId, other],
          patch: { dueDate: "2026-12-15" },
        },
        "lead",
      );
      expect(workflowOf(e).program).toMatchObject({
        status: "approved",
        revision: 151,
      });
      expect(current(e).map((p) => p.id)).toEqual([procedureId, other]);
      expect(outstanding(e)).toEqual([reviewed]);
      // Their executions keep the revision binding they were saved with.
      for (const p of current(e)) {
        expect(p.planHash).toMatch(/^[0-9a-f]{64}$/);
        expect(p.execution?.planHash).toBeUndefined();
      }
    });

    it("is no longer locked by its program history and invalidates only changed work", async () => {
      const e = await saved();
      await command(
        e,
        "saveProcedurePlan",
        plan(other, { sampling: "Stratified sample of 40 days" }),
        "lead",
      );
      expect(current(e).map((p) => p.id)).toEqual([procedureId]);
      await command(e, "submitProgram", {}, "auditor");
      await command(
        e,
        "returnProgram",
        { reason: "Explain the strata" },
        "reviewer",
      );
      await command(e, "submitProgram", {}, "auditor");
      await command(
        e,
        "approveProgram",
        { revision: 153, reason: "Revised sample agreed" },
        "reviewer",
      );
      expect(
        workflowOf(e)
          .program.history.slice(150)
          .map((h) => h.revision + " " + h.status),
      ).toEqual([
        "152 submitted",
        "152 returned",
        "153 submitted",
        "153 approved",
      ]);
      expect(current(e).map((p) => p.id)).toEqual([procedureId]);
      expect(outstanding(e)).toEqual([reviewed]);
      await command(
        e,
        "saveProcedurePlan",
        plan(procedureId, { population: "Training datasets only" }),
        "lead",
      );
      expect(current(e)).toEqual([]);
    });
  });
});
