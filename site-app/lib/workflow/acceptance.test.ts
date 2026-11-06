import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { stageGates, type Engagement, type Role } from "../domain";
import { engagementWork } from "../work-items";
import { seedWorkflow } from "../workflow-seed";
import {
  accessConflict,
  acceptancePrompt,
  acceptanceApplies,
  acceptanceTasks,
  declarationStatus,
  engagementTeam,
  gateTitle,
} from "./acceptance";
import {
  acceptanceInput,
  approvedWorkflow,
  at,
  command,
  declaration,
  declarationInput,
  engagement,
  expectFailure,
  planSave,
  procedureId,
  procedureOf,
  structuredEngagement,
  workflowOf,
} from "./test-fixtures";

const leadOnly = "A Lead Auditor must authorize this decision";
const writerOnly = "An Auditor or Lead Auditor must record this audit work";

/** A Planning engagement whose only open Planning-exit gates are acceptance. */
function planned(): Engagement {
  const w = approvedWorkflow([
    {
      ...seedWorkflow("lead", at).procedures.find((p) => p.id === procedureId)!,
      selected: true,
      applicability: "applicable",
      ownerId: "auditor",
      reviewerId: "reviewer",
    },
  ]);
  return engagement({ workflow: w });
}
const fieldworkGates = (e: Engagement) =>
  stageGates(e, "Fieldwork").map((g) => g.id);

describe("the Planning-exit acceptance gate", () => {
  it("lets an accepted engagement with current declarations start Fieldwork", () => {
    const e = planned();
    expect(engagementTeam(workflowOf(e))).toEqual([
      "auditor",
      "lead",
      "reviewer",
    ]);
    expect(stageGates(e, "Fieldwork")).toEqual([]);
  });

  it("blocks Fieldwork without an approved acceptance record", () => {
    const e = planned();
    workflowOf(e).acceptance!.status = "draft";
    expect(fieldworkGates(e)).toEqual(["acceptance"]);
    expect(stageGates(e, "Fieldwork")[0]).toMatchObject({
      kind: "acceptance",
      message:
        "A Lead Auditor must approve the acceptance and continuance record",
    });
    delete workflowOf(e).acceptance;
    // Without a record there is no period, so nobody has declared for it.
    expect(fieldworkGates(e)).toEqual([
      "acceptance",
      "declaration:auditor",
      "declaration:reviewer",
    ]);
  });

  it("blocks Fieldwork while a team member's declaration is missing", () => {
    const e = planned();
    const w = workflowOf(e);
    w.declarations = w.declarations!.filter((d) => d.userId !== "reviewer");
    expect(stageGates(e, "Fieldwork")).toMatchObject([
      {
        id: "declaration:reviewer",
        recordId: "reviewer",
        message:
          "A team member has not declared independence and competence for this engagement period",
      },
    ]);
  });

  it("does not count a declaration for another engagement period", () => {
    const e = planned();
    const w = workflowOf(e);
    w.acceptance!.periodEnd = "2026-10-31";
    w.brief!.periodEnd = "2026-10-31";
    expect(fieldworkGates(e)).toEqual([
      "declaration:auditor",
      "declaration:lead",
      "declaration:reviewer",
    ]);
  });

  it("blocks Fieldwork on an unresolved threat or a disqualifying relationship", () => {
    const e = planned();
    const w = workflowOf(e);
    w.declarations!.push(
      declaration("auditor", {
        id: "DEC-auditor-2",
        threats: [
          {
            kind: "familiarity",
            description: "Former colleague of the model owner",
            safeguards: "Rotate the review of WP-A10-01",
          },
        ],
      }),
      declaration("reviewer", {
        id: "DEC-reviewer-2",
        exclusions: ["financial_interest"],
      }),
    );
    expect(stageGates(e, "Fieldwork").map((g) => g.message)).toEqual([
      "A team member declared an independence threat that nobody has resolved",
      "A team member declared a disqualifying relationship and must leave the team",
    ]);
    w.declarations!.at(-2)!.threats[0].resolution = {
      userId: "lead",
      at,
      reason: "Rotation removes the threat",
    };
    expect(fieldworkGates(e)).toEqual(["declaration:reviewer"]);
  });

  it("re-requires declarations when someone joins the team", () => {
    const e = planned();
    const w = workflowOf(e);
    // Declarations made before the second auditor was a possible member.
    for (const d of w.declarations!) d.team = ["auditor", "lead", "reviewer"];
    procedureOf(e, procedureId).ownerId = "second-auditor";
    // The auditor left the team; the others declared for a team without
    // the newcomer, who never declared at all.
    expect(stageGates(e, "Fieldwork").map((g) => [g.id, g.message])).toEqual([
      [
        "declaration:lead",
        "A declaration predates a change to the engagement team and must be renewed",
      ],
      [
        "declaration:reviewer",
        "A declaration predates a change to the engagement team and must be renewed",
      ],
      [
        "declaration:second-auditor",
        "A declaration predates a change to the engagement team and must be renewed",
      ],
    ]);
    // Someone leaving the team does not make a declaration outdated.
    procedureOf(e, procedureId).ownerId = "auditor";
    expect(stageGates(e, "Fieldwork")).toEqual([]);
  });

  it("needs the accepted period to agree with the engagement brief", () => {
    const e = planned();
    workflowOf(e).brief!.periodStart = "2025-10-01";
    expect(fieldworkGates(e)).toEqual(["acceptance-period"]);
  });

  it("does not gate older workflows or later stages, and prompts instead", () => {
    // An older structured engagement: adopted before the gate existed.
    const older = planned();
    const w = workflowOf(older);
    delete w.acceptanceRequired;
    delete w.acceptance;
    w.declarations = [];
    expect(acceptanceApplies(w)).toBe(false);
    expect(stageGates(older, "Fieldwork")).toEqual([]);
    expect(acceptancePrompt(older)).toMatch(/started before acceptance/);
    // A structured engagement past Planning keeps working: its later gates
    // never ask for acceptance, but it is prompted to complete the record.
    const later = planned();
    later.stage = "Fieldwork";
    workflowOf(later).acceptance!.status = "draft";
    expect(stageGates(later, "Evidence evaluation")).toEqual([]);
    expect(acceptancePrompt(later)).toMatch(/left Planning/);
    expect(acceptancePrompt(planned())).toBeUndefined();
    // Legacy engagements without a workflow are untouched.
    expect(acceptancePrompt(engagement())).toBeUndefined();
    expect(stageGates(engagement(), "Fieldwork")).toEqual([]);
  });

  it("applies to every workflow adopted or created from now on", async () => {
    expect(seedWorkflow("lead", at).acceptanceRequired).toBe(true);
    const e = engagement();
    await command(e, "adoptWorkflow", {}, "lead");
    expect(workflowOf(e).acceptanceRequired).toBe(true);
    expect(fieldworkGates(e)).toContain("acceptance");
  });
});

describe("acceptance commands", () => {
  const save = (e: Engagement, overrides = {}, userId = "auditor") =>
    command(e, "saveAcceptance", { ...acceptanceInput, ...overrides }, userId);
  const approve = (e: Engagement, userId = "lead") =>
    command(
      e,
      "approveAcceptance",
      {
        revision: workflowOf(e).acceptance?.revision,
        reason: "Preconditions met",
      },
      userId,
    );
  const declare = (e: Engagement, userId: string, overrides = {}) =>
    command(e, "saveDeclaration", declarationInput(overrides), userId);

  it("records a draft that only a Lead Auditor approves", async () => {
    const e = structuredEngagement();
    await expectFailure(save(e, {}, "reviewer"), 403, writerOnly);
    expect(await save(e)).toEqual({ acceptanceRevision: "1" });
    const a = workflowOf(e).acceptance!;
    expect(a).toMatchObject({
      status: "draft",
      revision: 1,
      contributors: ["auditor"],
      team: ["lead"],
      accessLevel: "grey",
      history: [],
    });
    await expectFailure(approve(e, "auditor"), 403, leadOnly);
    await expectFailure(approve(e, "reviewer"), 403, leadOnly);
    expect(await approve(e)).toEqual({ acceptanceRevision: "1" });
    expect(a.status).toBe("approved");
    expect(a.approval).toMatchObject({
      userId: "lead",
      revision: 1,
      reason: "Preconditions met",
      stage: "Planning",
    });
    expect(a.approval!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validates the record", async () => {
    const e = structuredEngagement();
    await expectFailure(
      save(e, { periodStart: "2026-10-01" }),
      400,
      "The engagement period ends before it starts",
    );
    for (const overrides of [
      { accessLevel: "glass" },
      { team: [] },
      { team: ["lead", "lead"] },
      { engagementLetter: "" },
      { preconditions: { ...acceptanceInput.preconditions, extra: {} } },
      { unexpected: true },
    ])
      await expect(save(e, overrides)).rejects.toBeInstanceOf(ZodError);
    await expectFailure(
      save(e, { team: ["viewer"] }),
      400,
      "Select an active authorized person with the required role",
    );
  });

  it("accepts only when every precondition is met and the approver is on the team", async () => {
    const e = structuredEngagement();
    await save(e, {
      preconditions: {
        ...acceptanceInput.preconditions,
        evidence: { met: false, basis: "Black-box access only so far" },
      },
    });
    await expectFailure(
      approve(e),
      400,
      "Every ISAE 3000 precondition must be met before the engagement is accepted",
    );
    await save(e, { team: ["auditor"] });
    await expectFailure(
      approve(e),
      400,
      "Name yourself on the engagement team before accepting it",
    );
    await save(e);
    await expectFailure(
      command(
        e,
        "approveAcceptance",
        { revision: 1, reason: "Stale revision" },
        "lead",
      ),
      409,
      "Review the current draft of the acceptance record",
    );
  });

  it("refuses acceptance while a declared threat is unresolved", async () => {
    const e = structuredEngagement();
    await save(e);
    await declare(e, "lead", {
      priorWork: "Advised on the provider's AI governance policy in 2025",
      threats: [
        {
          kind: "self_review",
          description: "Advice on the governance policy under audit",
          safeguards: "A second Lead reviews the governance procedures",
        },
      ],
    });
    await expectFailure(
      approve(e),
      409,
      "A team member declared an unresolved independence threat or a disqualifying relationship; resolve it before accepting the engagement",
    );
    const d = workflowOf(e).declarations![0];
    // The declarant never evaluates their own threat.
    await expectFailure(
      command(
        e,
        "resolveDeclaredThreat",
        { declarationId: d.id, kind: "self_review", reason: "Fine" },
        "lead",
      ),
      403,
      "Someone other than the declarant must evaluate the threat",
    );
    await expectFailure(
      command(
        e,
        "resolveDeclaredThreat",
        { declarationId: d.id, kind: "self_review", reason: "Fine" },
        "auditor",
      ),
      403,
      "An independent Reviewer or Lead Auditor must approve",
    );
    await expectFailure(
      command(
        e,
        "resolveDeclaredThreat",
        { declarationId: d.id, kind: "advocacy", reason: "Fine" },
        "reviewer",
      ),
      404,
      "This threat was not declared",
    );
    await command(
      e,
      "resolveDeclaredThreat",
      {
        declarationId: d.id,
        kind: "self_review",
        reason: "The second Lead's review is an effective safeguard",
      },
      "reviewer",
    );
    expect(d.threats[0].resolution).toEqual({
      userId: "reviewer",
      at,
      reason: "The second Lead's review is an effective safeguard",
    });
    await expectFailure(
      command(
        e,
        "resolveDeclaredThreat",
        { declarationId: d.id, kind: "self_review", reason: "Again" },
        "second-lead",
      ),
      409,
      "This threat is already resolved",
    );
    expect(await approve(e)).toEqual({ acceptanceRevision: "1" });
  });

  it("refuses acceptance when a team member is disqualified", async () => {
    const e = structuredEngagement();
    await save(e, { team: ["lead", "auditor"] });
    await declare(e, "auditor", { exclusions: ["employment"] });
    await expectFailure(approve(e), 409);
  });

  it("keeps the approved revision when a Lead revises it", async () => {
    const e = structuredEngagement();
    await save(e);
    await approve(e);
    await expectFailure(
      save(e, { changeReason: "Team change" }, "auditor"),
      403,
      leadOnly,
    );
    await expectFailure(
      save(e, {}, "lead"),
      400,
      "Explain why the approved acceptance record changes",
    );
    await save(
      e,
      { team: ["lead", "second-auditor"], changeReason: "Team change" },
      "lead",
    );
    const a = workflowOf(e).acceptance!;
    expect(a).toMatchObject({ status: "draft", revision: 2 });
    expect(a.approval).toBeUndefined();
    expect(a.history).toHaveLength(1);
    expect(a.history[0]).toMatchObject({
      revision: 1,
      status: "approved",
      approval: { userId: "lead" },
    });
    expect(fieldworkGates(e)).toContain("acceptance");
  });

  it("records approval after Planning with the stage it happened in", async () => {
    const e = structuredEngagement({ stage: "Fieldwork" });
    await save(e);
    await approve(e);
    expect(workflowOf(e).acceptance!.approval!.stage).toBe("Fieldwork");
  });
});

describe("independence and competence declarations", () => {
  const declare = (e: Engagement, userId: string, overrides = {}) =>
    command(e, "saveDeclaration", declarationInput(overrides), userId);
  const accepted = async (team = ["lead"]) => {
    const e = structuredEngagement();
    await command(e, "saveAcceptance", { ...acceptanceInput, team }, "lead");
    return e;
  };

  it("are dated, per person and for the accepted period", async () => {
    const e = structuredEngagement();
    await expectFailure(
      declare(e, "auditor"),
      409,
      "Record the acceptance record and its engagement period before declaring",
    );
    await command(e, "saveAcceptance", acceptanceInput, "lead");
    await expectFailure(
      declare(e, "viewer"),
      403,
      "Only Auditors, Lead Auditors and Reviewers declare independence",
    );
    expect(await declare(e, "reviewer", { expertField: "" })).toEqual({
      declarationId: expect.any(String),
    });
    expect(workflowOf(e).declarations).toEqual([
      {
        id: expect.any(String),
        userId: "reviewer",
        role: "Reviewer",
        declaredAt: at,
        periodStart: "2026-01-01",
        periodEnd: "2026-09-30",
        // The seeded procedures are prepared by the Lead who adopted the
        // workflow, but none is selected yet.
        team: ["lead", "reviewer"],
        priorWork: "",
        threats: [],
        exclusions: [],
        competence: declarationInput().competence,
        expertField: "",
      },
    ]);
    // A renewed declaration supersedes the earlier one, which stays.
    await declare(e, "reviewer", { expertField: "Fairness statistics" });
    expect(workflowOf(e).declarations).toHaveLength(2);
  });

  it("validate the declaration", async () => {
    const e = await accepted();
    await expectFailure(
      declare(e, "auditor", {
        priorWork: "Implemented the provider's monitoring pipeline",
      }),
      400,
      "Declare the self-review threat that earlier work on the system creates",
    );
    for (const overrides of [
      { confirmed: false },
      { exclusions: ["employment", "employment"] },
      { exclusions: ["friendship"] },
      {
        threats: [
          { kind: "advocacy", description: "a", safeguards: "" },
          { kind: "advocacy", description: "b", safeguards: "" },
        ],
      },
      { threats: [{ kind: "advocacy", description: "", safeguards: "" }] },
      { competence: { assurance: "expert" } },
    ])
      await expect(declare(e, "auditor", overrides)).rejects.toBeInstanceOf(
        ZodError,
      );
  });

  it("only the declarant's current declaration can be resolved", async () => {
    const e = await accepted();
    const threat = {
      kind: "intimidation",
      description: "Fee dispute with the client",
      safeguards: "",
    };
    await declare(e, "auditor", { threats: [threat] });
    const first = workflowOf(e).declarations![0].id;
    await declare(e, "auditor", { threats: [threat] });
    await expectFailure(
      command(
        e,
        "resolveDeclaredThreat",
        { declarationId: first, kind: "intimidation", reason: "Settled" },
        "lead",
      ),
      409,
      "Evaluate the person's current declaration",
    );
    await expectFailure(
      command(
        e,
        "resolveDeclaredThreat",
        { declarationId: "DEC-x", kind: "intimidation", reason: "Settled" },
        "lead",
      ),
      404,
      "Declaration not found in this engagement",
    );
  });

  it("block assigning a conflicted person to the team or a procedure", async () => {
    const e = await accepted();
    await declare(e, "second-auditor", {
      threats: [
        {
          kind: "self_interest",
          description: "Spouse works for the vendor",
          safeguards: "",
        },
      ],
    });
    await declare(e, "second-reviewer", { exclusions: ["system_involvement"] });
    const threat =
      "This person declared an unresolved independence threat; resolve it before assigning them";
    const excluded =
      "This person declared a disqualifying relationship with the engagement and cannot be assigned";
    await expectFailure(
      command(
        e,
        "saveAcceptance",
        { ...acceptanceInput, team: ["lead", "second-auditor"] },
        "lead",
      ),
      400,
      threat,
    );
    await expectFailure(
      command(
        e,
        "saveProcedurePlan",
        planSave(e, { ownerId: "second-auditor" }),
        "auditor",
      ),
      400,
      threat,
    );
    await expectFailure(
      command(
        e,
        "saveProcedurePlan",
        planSave(e, { reviewerId: "second-reviewer" }),
        "auditor",
      ),
      400,
      excluded,
    );
    await expectFailure(
      command(
        e,
        "bulkPlanProcedures",
        {
          procedureIds: [procedureId],
          patch: { reviewerId: "second-reviewer" },
        },
        "auditor",
      ),
      400,
      excluded,
    );
    // People without a conflict, or not yet declared, can be assigned; the
    // gate then asks for their declaration.
    await command(
      e,
      "saveProcedurePlan",
      planSave(e, { ownerId: "auditor", reviewerId: "reviewer" }),
      "auditor",
    );
    expect(procedureOf(e, procedureId).reviewerId).toBe("reviewer");
    // Once the threat is resolved, the person can be assigned.
    const d = workflowOf(e).declarations![0];
    await command(
      e,
      "resolveDeclaredThreat",
      { declarationId: d.id, kind: "self_interest", reason: "Spouse left" },
      "lead",
    );
    await command(
      e,
      "saveAcceptance",
      { ...acceptanceInput, team: ["lead", "second-auditor"] },
      "lead",
    );
    expect(workflowOf(e).acceptance!.team).toEqual(["lead", "second-auditor"]);
  });

  const approve = (e: Engagement) =>
    command(
      e,
      "approveAcceptance",
      { revision: workflowOf(e).acceptance!.revision, reason: "Accepted" },
      "lead",
    );
  const conflicted =
    "A team member declared an unresolved independence threat or a disqualifying relationship; resolve it before accepting the engagement";

  it("a renewal cannot clear a disqualifying relationship", async () => {
    const e = await accepted(["lead", "reviewer"]);
    await declare(e, "lead");
    await declare(e, "reviewer", { exclusions: ["employment"] });
    await expectFailure(approve(e), 409, conflicted);
    // Declaring again without the relationship is refused, so the gate, the
    // approval and the assignment check still see it.
    const removed =
      "A renewal cannot remove a disqualifying relationship you declared; a Lead Auditor or Reviewer other than you withdraws it with a reason";
    await expectFailure(
      declare(e, "reviewer", { exclusions: [] }),
      409,
      removed,
    );
    await expectFailure(
      declare(e, "reviewer", { exclusions: ["financial_interest"] }),
      409,
      removed,
    );
    expect(workflowOf(e).declarations).toHaveLength(2);
    await expectFailure(approve(e), 409, conflicted);
    expect(declarationStatus(workflowOf(e), "reviewer")).toBe("excluded");
    await expectFailure(
      command(
        e,
        "saveProcedurePlan",
        planSave(e, { reviewerId: "reviewer" }),
        "auditor",
      ),
      400,
      "This person declared a disqualifying relationship with the engagement and cannot be assigned",
    );
    // A renewal may add to what was declared.
    await declare(e, "reviewer", {
      exclusions: ["employment", "financial_interest"],
    });
    const d = workflowOf(e).declarations!.at(-1)!;
    const withdraw = (kind: string, userId: string) =>
      command(
        e,
        "withdrawDeclaredExclusion",
        { declarationId: d.id, kind, reason: "Declared in error" },
        userId,
      );
    await expectFailure(
      withdraw("employment", "reviewer"),
      403,
      "Someone other than the declarant must withdraw a disqualifying relationship",
    );
    await expectFailure(
      withdraw("employment", "auditor"),
      403,
      "An independent Reviewer or Lead Auditor must approve",
    );
    await expectFailure(
      withdraw("system_involvement", "lead"),
      404,
      "This relationship is not declared",
    );
    await expectFailure(
      command(
        e,
        "withdrawDeclaredExclusion",
        {
          declarationId: workflowOf(e).declarations![1].id,
          kind: "employment",
          reason: "Declared in error",
        },
        "lead",
      ),
      409,
      "Withdraw from the person's latest declaration",
    );
    await withdraw("employment", "lead");
    await expectFailure(approve(e), 409, conflicted);
    await withdraw("financial_interest", "second-lead");
    expect(d.exclusions).toEqual([]);
    expect(d.exclusionWithdrawals).toEqual([
      { kind: "employment", userId: "lead", at, reason: "Declared in error" },
      {
        kind: "financial_interest",
        userId: "second-lead",
        at,
        reason: "Declared in error",
      },
    ]);
    expect(await approve(e)).toEqual({ acceptanceRevision: "1" });
    // After the withdrawal, a renewal without the relationship is allowed,
    // and the withdrawals carry forward so the record keeps showing them.
    await declare(e, "reviewer");
    expect(declarationStatus(workflowOf(e), "reviewer")).toBe("current");
    expect(workflowOf(e).declarations!.at(-1)!.exclusionWithdrawals).toEqual(
      d.exclusionWithdrawals,
    );
  });

  it("a period change does not clear a disqualifying relationship", async () => {
    const e = await accepted(["lead", "auditor"]);
    await declare(e, "lead");
    await declare(e, "auditor", { exclusions: ["employment"] });
    // The conflicted Auditor moves the draft's period, so they have no
    // declaration for the new one yet: the relationship still stands.
    const moved = { ...acceptanceInput, team: ["lead", "auditor"] };
    moved.periodEnd = "2026-10-31";
    const assign =
      "This person declared a disqualifying relationship with the engagement and cannot be assigned";
    await expectFailure(
      command(e, "saveAcceptance", moved, "auditor"),
      400,
      assign,
    );
    // The Lead moves it instead (with someone else on the team); the
    // Auditor's relationship carries over to the new period.
    await command(e, "saveAcceptance", { ...moved, team: ["lead"] }, "lead");
    const w = workflowOf(e);
    expect(declarationStatus(w, "auditor", ["lead", "auditor"])).toBe(
      "excluded",
    );
    await expectFailure(
      declare(e, "auditor", { exclusions: [] }),
      409,
      "A renewal cannot remove a disqualifying relationship you declared; a Lead Auditor or Reviewer other than you withdraws it with a reason",
    );
    await expectFailure(
      command(e, "saveAcceptance", moved, "lead"),
      400,
      assign,
    );
    await expectFailure(
      command(
        e,
        "saveProcedurePlan",
        planSave(e, { reviewerId: "auditor" }),
        "lead",
      ),
      400,
      assign,
    );
    // Declaring for the new period with the relationship keeps it, and the
    // Lead cannot approve with the Auditor on the team.
    await declare(e, "lead");
    await declare(e, "auditor", { exclusions: ["employment"] });
    expect(w.declarations!.at(-1)!.periodEnd).toBe("2026-10-31");
    w.acceptance!.team = ["lead", "auditor"];
    await expectFailure(approve(e), 409, conflicted);
    // Back to the first period: the stale declaration there does not matter
    // once someone else withdraws the relationship from the latest one.
    await command(
      e,
      "withdrawDeclaredExclusion",
      {
        declarationId: w.declarations!.at(-1)!.id,
        kind: "employment",
        reason: "Declared in error",
      },
      "lead",
    );
    expect(declarationStatus(w, "auditor")).toBe("current");
    await command(
      e,
      "saveAcceptance",
      { ...moved, periodEnd: acceptanceInput.periodEnd },
      "lead",
    );
    expect(declarationStatus(w, "auditor")).toBe("current");
    expect(await approve(e)).toEqual({ acceptanceRevision: "3" });
  });

  it("a renewal cannot drop an unresolved threat and keeps unchanged evaluations", async () => {
    const e = await accepted(["lead", "reviewer"]);
    const familiarity = {
      kind: "familiarity",
      description: "Ten years auditing this client",
      safeguards: "Rotation of the engagement partner",
    };
    await declare(e, "lead");
    await declare(e, "reviewer", { threats: [familiarity] });
    const dropped =
      "A renewal cannot drop an independence threat nobody has resolved; a Lead Auditor or Reviewer other than you evaluates it";
    await expectFailure(declare(e, "reviewer", { threats: [] }), 409, dropped);
    await expectFailure(approve(e), 409, conflicted);
    // Restating the threat is allowed; it stays unresolved.
    const restated = { ...familiarity, description: "Eleven years" };
    await declare(e, "reviewer", { threats: [restated] });
    expect(declarationStatus(workflowOf(e), "reviewer")).toBe("unresolved");
    await command(
      e,
      "resolveDeclaredThreat",
      {
        declarationId: workflowOf(e).declarations!.at(-1)!.id,
        kind: "familiarity",
        reason: "Rotation is effective",
      },
      "lead",
    );
    // Renewing with the threat unchanged keeps its evaluation.
    await declare(e, "reviewer", {
      threats: [restated],
      expertField: "Fairness statistics",
    });
    expect(workflowOf(e).declarations!.at(-1)!.threats[0].resolution).toEqual({
      userId: "lead",
      at,
      reason: "Rotation is effective",
    });
    expect(await approve(e)).toEqual({ acceptanceRevision: "1" });
    // Changing the threat's circumstances or safeguards needs a new
    // evaluation, and the changed threat cannot then be dropped.
    await declare(e, "reviewer", {
      threats: [{ ...restated, safeguards: "" }],
    });
    expect(declarationStatus(workflowOf(e), "reviewer")).toBe("unresolved");
    await expectFailure(declare(e, "reviewer", { threats: [] }), 409, dropped);
    // A threat someone resolved may be dropped when it no longer applies.
    await command(
      e,
      "resolveDeclaredThreat",
      {
        declarationId: workflowOf(e).declarations!.at(-1)!.id,
        kind: "familiarity",
        reason: "Acceptable without rotation for this period",
      },
      "second-lead",
    );
    await declare(e, "reviewer", { threats: [] });
    expect(declarationStatus(workflowOf(e), "reviewer")).toBe("current");
  });
});

describe("independence work, names and access grants (#112)", () => {
  const names: Record<string, string> = {
    lead: "Lea Lead",
    reviewer: "Rae Reviewer",
  };
  const nameOf = (id: string) => names[id];
  const acceptanceWork = (e: Engagement, role: Role, userId: string) =>
    engagementWork(e, role, userId, "", "2026-11-05", nameOf).filter(
      (i) => i.kind === "acceptance",
    );
  const threat = () => ({
    kind: "familiarity" as const,
    description: "Former colleague of the model owner",
    safeguards: "Rotate the review of WP-A10-01",
  });

  it("names the team member of a declaration gate", () => {
    const e = planned();
    const w = workflowOf(e);
    w.declarations = w.declarations!.filter((d) => d.userId !== "reviewer");
    w.acceptance!.status = "draft";
    const [acceptance, declarationGate] = stageGates(e, "Fieldwork");
    expect(gateTitle(declarationGate, nameOf)).toBe(
      "Independence and competence declaration · Rae Reviewer",
    );
    // Someone no longer in the practice keeps their user id.
    expect(gateTitle(declarationGate)).toBe(
      "Independence and competence declaration · reviewer",
    );
    expect(gateTitle(acceptance, nameOf)).toBe(acceptance.title);
  });

  it("puts a missing or outdated declaration in the declarant's inbox", () => {
    const e = planned();
    const w = workflowOf(e);
    w.declarations = w.declarations!.filter((d) => d.userId !== "reviewer");
    expect(acceptanceWork(e, "Reviewer", "reviewer")).toMatchObject([
      {
        id: e.id + ":acceptance:declaration:reviewer",
        recordId: "declaration:reviewer",
        title: "Independence and competence declaration · Rae Reviewer",
        action: "Declare independence",
        module: "Audit program",
        section: "acceptance",
        ownerId: "reviewer",
        state: "ready",
        personal: true,
      },
    ]);
    // The team sees it; only the declarant owes it.
    expect(acceptanceWork(e, "Lead Auditor", "lead")).toMatchObject([
      { recordId: "declaration:reviewer", personal: false },
    ]);
    // Someone joining the team leaves the earlier declarations outdated.
    for (const d of w.declarations!) d.team = ["auditor", "lead", "reviewer"];
    procedureOf(e, procedureId).ownerId = "second-auditor";
    expect(acceptanceTasks(w)).toEqual([
      { kind: "declaration", userId: "lead", status: "outdated" },
      { kind: "declaration", userId: "reviewer", status: "missing" },
      { kind: "declaration", userId: "second-auditor", status: "outdated" },
    ]);
    expect(acceptanceWork(e, "Lead Auditor", "lead")[0]).toMatchObject({
      recordId: "declaration:lead",
      action: "Renew declaration",
      personal: true,
    });
  });

  it("puts a declared threat in an independent reviewer's inbox until it is resolved", () => {
    const e = planned();
    const w = workflowOf(e);
    w.declarations!.push(
      declaration("lead", { id: "DEC-lead-2", threats: [threat()] }),
    );
    const item = {
      recordId: "threat:DEC-lead-2",
      title: "Declared independence threat · Lea Lead",
      action: "Evaluate declared threat",
      state: "review",
      section: "acceptance",
    };
    expect(acceptanceWork(e, "Reviewer", "reviewer")).toMatchObject([
      { ...item, personal: true },
    ]);
    // The declarant never evaluates their own threat; an Auditor cannot.
    expect(acceptanceWork(e, "Lead Auditor", "lead")).toMatchObject([
      { ...item, personal: false },
    ]);
    expect(acceptanceWork(e, "Auditor", "auditor")).toMatchObject([
      { ...item, personal: false },
    ]);
    w.declarations!.at(-1)!.threats[0].resolution = {
      userId: "reviewer",
      at,
      reason: "Rotation removes the threat",
    };
    expect(acceptanceWork(e, "Reviewer", "reviewer")).toEqual([]);
  });

  it("asks for nothing before the acceptance record states the period", () => {
    const w = workflowOf(planned());
    delete w.acceptance;
    w.declarations = [];
    expect(acceptanceTasks(w)).toEqual([]);
    expect(acceptanceTasks(undefined)).toEqual([]);
  });

  it("refuses access where assignment is refused", () => {
    const e = planned();
    const w = workflowOf(e);
    expect(accessConflict(e, "reviewer")).toBeUndefined();
    expect(accessConflict(engagement(), "reviewer")).toBeUndefined();
    w.declarations!.push(
      declaration("reviewer", {
        id: "DEC-reviewer-2",
        exclusions: ["financial_interest"],
      }),
      declaration("auditor", { id: "DEC-auditor-2", threats: [threat()] }),
    );
    expect(accessConflict(e, "reviewer")).toBe(
      "This person declared a disqualifying relationship with the engagement and cannot be assigned",
    );
    expect(accessConflict(e, "auditor")).toBe(
      "This person declared an unresolved independence threat; resolve it before assigning them",
    );
    // A person who never declared on the engagement may be given access.
    expect(accessConflict(e, "second-auditor")).toBeUndefined();
  });
});
