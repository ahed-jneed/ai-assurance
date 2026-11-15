// The workspace disables Release and Review closure with exactly the refusal
// the server answers (#210): each case runs the shared precondition and the
// command itself, and compares them.
import { describe, expect, it } from "vitest";
import type { Engagement, Report } from "./domain/types";
import { releaseChecklist } from "./domain/gates";
import {
  reviewerInactiveMessage,
  reviewerOnTeamMessage,
} from "./domain/quality-review";
import { decisionState } from "./permissions";
import {
  monitoringClosureRefusal,
  ownWorkRefusal,
  packageApprovalRefusal,
  releaseRefusal,
} from "./preconditions";
import {
  approveScope,
  approvedWorkflow,
  artifact,
  at,
  briefInput,
  command,
  completedQualityReview,
  engagement,
  expectFailure,
  planProgram,
  structuredEngagement,
  workflowOf,
} from "./workflow/test-fixtures";

function approvedReport(): Report {
  return {
    id: "R1",
    kind: "final",
    createdAt: at,
    actor: "auditor",
    sha256: "R1-internal",
    snapshot: { opinion: "Adverse conclusion" },
    clientSnapshot: { contractVersion: "2.0", opinion: "Adverse conclusion" },
    clientSha256: "R1-client",
    release: {
      state: "approved",
      approval: {
        userId: "reviewer",
        at,
        internalHash: "R1-internal",
        clientHash: "R1-client",
        reason: "Both packages reviewed",
      },
      history: [],
    },
  };
}
const released = (overrides: Partial<Engagement> = {}) =>
  engagement({
    workflow: approvedWorkflow(),
    stage: "Sign-off",
    reports: [approvedReport()],
    ...overrides,
  });
const release = (e: Engagement, userId = "lead") =>
  command(
    e,
    "releaseReport",
    { reportId: "R1", recipientScope: "Client members", reason: "Release" },
    userId,
  );
/** The shared refusal, and that the command refuses with it. */
async function refusedAlike(
  refusal: { status: number; message: string } | null,
  result: Promise<unknown>,
) {
  expect(refusal).not.toBeNull();
  await expectFailure(result, refusal!.status, refusal!.message);
}

describe("the release precondition", () => {
  it("lets an approved package without a quality review be released", async () => {
    const e = released();
    expect(releaseRefusal(e, e.reports[0], "lead")).toBeNull();
    await release(e);
    expect(e.reports[0].release?.state).toBe("released");
  });

  it("refuses while the appointed EQR has not signed off both packages", async () => {
    const e = released({ qualityReview: completedQualityReview() });
    const refusal = releaseRefusal(e, e.reports[0], "lead");
    expect(refusal?.message).toBe(
      "The engagement quality reviewer must sign off both exact packages before release",
    );
    // The guidance (no releaser) names the same reason.
    expect(releaseRefusal(e, e.reports[0])).toEqual(refusal);
    await refusedAlike(refusal, release(e));
  });

  it("releases once the EQR signed off the exact packages", async () => {
    const e = released({
      qualityReview: completedQualityReview({
        signOffs: [
          {
            reportId: "R1",
            userId: "quality-reviewer",
            at,
            internalHash: "R1-internal",
            clientHash: "R1-client",
            checklistRevision: 2,
            conclusion: "Stand-back review complete",
          },
        ],
      }),
    });
    expect(releaseRefusal(e, e.reports[0], "lead")).toBeNull();
    await release(e);
  });

  it("applies the EQR's release-time re-checks from the reviewer's standing (#244 item 1)", () => {
    const e = released({
      qualityReview: completedQualityReview({
        signOffs: [
          {
            reportId: "R1",
            userId: "quality-reviewer",
            at,
            internalHash: "R1-internal",
            clientHash: "R1-client",
            checklistRevision: 2,
            conclusion: "Stand-back review complete",
          },
        ],
      }),
    });
    const standing = {
      reviewerId: "quality-reviewer",
      activeReviewer: true,
      onRecordedTeam: false,
    };
    expect(releaseRefusal(e, e.reports[0], "lead", standing)).toBeNull();
    // Revoked or moved to another role after their sign-off.
    const inactive = { ...standing, activeReviewer: false };
    expect(releaseRefusal(e, e.reports[0], "lead", inactive)).toEqual({
      status: 409,
      message: reviewerInactiveMessage,
    });
    expect(reviewerInactiveMessage).toContain("appoint an eligible reviewer");
    // The guidance (no releaser) names the same reason.
    expect(releaseRefusal(e, e.reports[0], undefined, inactive)).toEqual(
      releaseRefusal(e, e.reports[0], "lead", inactive),
    );
    // On the team by recorded work: the independence re-check comes first,
    // as release runs it before the signer's.
    expect(
      releaseRefusal(e, e.reports[0], "lead", {
        ...inactive,
        onRecordedTeam: true,
      }),
    ).toEqual({ status: 409, message: reviewerOnTeamMessage });
    // A standing of another reviewer than the one appointed counts for
    // nothing.
    expect(
      releaseRefusal(e, e.reports[0], "lead", {
        ...inactive,
        reviewerId: "someone-else",
      }),
    ).toBeNull();
  });

  it("refuses the approver as releaser, but not in the guidance", async () => {
    const e = released();
    e.reports[0].release!.approval!.userId = "lead";
    expect(releaseRefusal(e, e.reports[0])).toBeNull();
    await refusedAlike(releaseRefusal(e, e.reports[0], "lead"), release(e));
  });

  it("refuses a package that is not approved", async () => {
    const e = released();
    e.reports[0].release = { state: "internal", history: [] };
    await refusedAlike(releaseRefusal(e, e.reports[0], "lead"), release(e));
  });
});

describe("the package approval precondition (#226 item 5)", () => {
  const internal = () => {
    const r = approvedReport();
    r.snapshot = { ...r.snapshot, workflow: approvedWorkflow() };
    r.release = { state: "internal", history: [] };
    return released({ reports: [r] });
  };
  const approve = (e: Engagement, userId: string) =>
    command(
      e,
      "approveReportPackage",
      {
        reportId: "R1",
        internalHash: "R1-internal",
        clientHash: "R1-client",
        reason: "Both packages reviewed",
        checklist: Object.fromEntries(
          releaseChecklist.map((i) => [i.id, "confirmed"]),
        ),
      },
      userId,
    );

  it("refuses the report's creator with the command's 403 and message", async () => {
    const e = internal();
    e.reports[0].actor = "reviewer";
    const refusal = packageApprovalRefusal(e.reports[0], "reviewer");
    expect(refusal).toEqual({
      status: 403,
      message: "The report creator cannot approve its package",
    });
    await refusedAlike(refusal, approve(e, "reviewer"));
  });

  it("admits a reviewer who did not create the package", async () => {
    const e = internal();
    expect(packageApprovalRefusal(e.reports[0], "reviewer")).toBeNull();
    await approve(e, "reviewer");
    expect(e.reports[0].release?.state).toBe("approved");
  });
});

describe("the follow-up closure precondition", () => {
  async function openCase(e: Engagement) {
    const { caseId } = await command(
      e,
      "createMonitoringCase",
      {
        kind: "change",
        title: "Model version change",
        description: "A new model version needs an impact decision",
        ownerId: "auditor",
        dueDate: "2026-12-31",
        cadence: "one_off",
        findingId: "",
        reportId: "",
      },
      "auditor",
    );
    return caseId as string;
  }
  const assess = (
    e: Engagement,
    caseId: string,
    decision: string,
    evidenceIds: string[],
  ) =>
    command(
      e,
      "assessMonitoringCase",
      {
        caseId,
        decision,
        assessment: "Impact assessed against the baseline scope",
        evidenceIds,
        dueDate: "2026-12-31",
      },
      "auditor",
    );
  const close = (e: Engagement, caseId: string) =>
    command(
      e,
      "closeMonitoringCase",
      { caseId, closure: "Independently reviewed closure" },
      "reviewer",
    );
  const caseOf = (e: Engagement, id: string) =>
    e.workflow!.monitoring.find((m) => m.id === id)!;
  const fresh = () =>
    engagement({ workflow: approvedWorkflow(), artifacts: [artifact()] });

  it("refuses a follow_up case without linked accepted evidence", async () => {
    const e = fresh(),
      id = await openCase(e);
    await assess(e, id, "follow_up", []);
    const refusal = monitoringClosureRefusal(e, caseOf(e, id));
    expect(refusal).toEqual({
      status: 400,
      message:
        "Record an assessment with the accepted evidence before independent closure",
    });
    await refusedAlike(refusal, close(e, id));
  });

  it("refuses a reassessment case without a successor engagement", async () => {
    const e = fresh(),
      id = await openCase(e);
    await assess(e, id, "reassessment_required", []);
    await refusedAlike(
      monitoringClosureRefusal(e, caseOf(e, id)),
      close(e, id),
    );
  });

  it("refuses evidence that is no longer accepted", async () => {
    const e = fresh(),
      id = await openCase(e);
    await assess(e, id, "follow_up", ["evidence"]);
    e.artifacts[0].status = "unverified";
    await refusedAlike(
      monitoringClosureRefusal(e, caseOf(e, id)),
      close(e, id),
    );
  });

  it("allows closure once accepted evidence is linked", async () => {
    const e = fresh(),
      id = await openCase(e);
    await assess(e, id, "follow_up", ["evidence"]);
    expect(monitoringClosureRefusal(e, caseOf(e, id))).toBeNull();
    await close(e, id);
    expect(caseOf(e, id).state).toBe("closed");
  });
});

describe("the own-work approval precondition (#234 item 1)", () => {
  it("refuses a contributor to the scope as the command does, on Approve scope", async () => {
    const e = structuredEngagement();
    await command(e, "saveBrief", briefInput, "lead");
    await command(e, "submitBrief", {}, "lead");
    const contributors = workflowOf(e).brief!.contributors;
    const refusal = ownWorkRefusal(contributors, "lead");
    expect(refusal).toEqual({
      status: 403,
      message: "A preparer or contributor cannot approve their own work",
    });
    expect(
      decisionState("Lead Auditor", "lead", {
        action: "approveBrief",
        engagement: e,
      }),
    ).toEqual({
      allowed: false,
      reason: refusal!.message,
      refusal: "independence",
    });
    await refusedAlike(
      refusal,
      command(e, "approveBrief", { revision: 1, reason: "Own" }, "lead"),
    );
    expect(ownWorkRefusal(contributors, "reviewer")).toBeNull();
    expect(
      decisionState("Reviewer", "reviewer", {
        action: "approveBrief",
        engagement: e,
      }),
    ).toEqual({ allowed: true });
  });

  it("refuses a contributor to the program alike, on Approve program", async () => {
    const e = structuredEngagement();
    await approveScope(e);
    await planProgram(e);
    await command(e, "submitProgram", {}, "auditor");
    const program = workflowOf(e).program;
    const contributor = program.contributors[0];
    const refusal = ownWorkRefusal(program.contributors, contributor);
    expect(
      decisionState("Lead Auditor", contributor, {
        action: "approveProgram",
        engagement: e,
      }).reason,
    ).toBe(refusal?.message);
    await refusedAlike(
      refusal,
      command(
        e,
        "approveProgram",
        { revision: program.revision, reason: "Own" },
        contributor,
      ),
    );
  });
});
