// The report release commands beyond their role check (#52): approval of
// both exact packages, release and withdrawal, each refusal and the state
// each leaves. A refused command leaves the engagement exactly as it was.
// report-release.test.ts covers superseding and the completion checklist.
import { describe, expect, it } from "vitest";
import { legacyPackageMessage } from "../client-projection";
import { releaseChecklist } from "../domain/gates";
import type { Engagement, Report } from "../domain/types";
import {
  approvedWorkflow,
  at,
  command,
  completedQualityReview,
  engagement,
  expectFailure,
} from "./test-fixtures";

const confirmed = Object.fromEntries(
  releaseChecklist.map((i) => [i.id, "confirmed"]),
);

/** R1, a captured final report: internal, created by the auditor. */
function captured(overrides: Partial<Report> = {}): Report {
  return {
    id: "R1",
    kind: "final",
    createdAt: at,
    actor: "auditor",
    sha256: "R1-internal",
    snapshot: { opinion: "Adverse conclusion", workflow: approvedWorkflow() },
    clientSnapshot: { contractVersion: "2.0", opinion: "Adverse conclusion" },
    clientSha256: "R1-client",
    release: { state: "internal", history: [] },
    ...overrides,
  };
}

/** R1 approved by the reviewer against both of its hashes. */
function approved(overrides: Partial<Report> = {}): Report {
  return captured({
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
    ...overrides,
  });
}

function signOff(...reports: Report[]): Engagement {
  return engagement({
    workflow: approvedWorkflow(),
    stage: "Sign-off",
    reports,
  });
}

const r1 = (e: Engagement) => e.reports.find((r) => r.id === "R1")!;

async function refused(
  e: Engagement,
  run: () => Promise<unknown>,
  status: number,
  message?: string,
) {
  const before = structuredClone(e);
  await expectFailure(run(), status, message);
  expect(e).toEqual(before);
}

describe("approveReportPackage", () => {
  const approval = {
    reportId: "R1",
    internalHash: "R1-internal",
    clientHash: "R1-client",
    reason: "Both packages reviewed",
    checklist: confirmed,
  };
  const approve = (e: Engagement, user = "reviewer", data = {}) =>
    command(e, "approveReportPackage", { ...approval, ...data }, user);

  it.each(["reviewer", "lead"])(
    "lets an independent %s approve both exact packages",
    async (user) => {
      const e = signOff(captured());
      expect(await approve(e, user)).toEqual({ reportId: "R1" });
      expect(r1(e).release).toEqual({
        state: "approved",
        approval: {
          userId: user,
          at,
          internalHash: "R1-internal",
          clientHash: "R1-client",
          reason: "Both packages reviewed",
          checklist: {
            items: releaseChecklist.map((i) => ({
              id: i.id,
              answer: "confirmed",
            })),
            note: "",
          },
        },
        history: [
          {
            actor: user,
            at,
            action: "approve",
            reason: "Both packages reviewed",
          },
        ],
      });
    },
  );

  it("approves a captured report again after an earlier approval", async () => {
    const e = signOff(approved());
    await approve(e, "second-reviewer");
    expect(r1(e).release!.approval!.userId).toBe("second-reviewer");
    expect(r1(e).release!.state).toBe("approved");
  });

  it("starts the release record of a package captured without one", async () => {
    const e = signOff(captured({ release: undefined }));
    await approve(e);
    expect(r1(e).release!.state).toBe("approved");
  });

  it.each(["auditor", "viewer", "contributor", "quality-reviewer"])(
    "refuses %s",
    async (user) => {
      const e = signOff(captured());
      await refused(
        e,
        () => approve(e, user),
        403,
        "An independent Reviewer or Lead Auditor must approve",
      );
    },
  );

  it("refuses an unknown report", async () => {
    const e = signOff(captured());
    await refused(
      e,
      () => approve(e, "reviewer", { reportId: "R9" }),
      404,
      "Report not found",
    );
  });

  it.each([
    ["a draft report", { kind: "draft" }],
    [
      "a released report",
      { release: { state: "released", history: [] } } as Partial<Report>,
    ],
    [
      "a withdrawn report",
      { release: { state: "withdrawn", history: [] } } as Partial<Report>,
    ],
  ])("refuses %s", async (_, overrides) => {
    const e = signOff(captured(overrides as Partial<Report>));
    await refused(
      e,
      () => approve(e),
      409,
      "Approve an internal final package",
    );
  });

  it("refuses a package that captured no approved scope and program", async () => {
    const e = signOff(
      captured({ snapshot: { opinion: "Adverse conclusion" } }),
    );
    await refused(
      e,
      () => approve(e),
      409,
      "Prepare a current final package capturing the approved scope and audit program",
    );
  });

  it("refuses a package with a legacy client snapshot", async () => {
    const e = signOff(
      captured({ clientSnapshot: { opinion: "Adverse conclusion" } }),
    );
    await refused(e, () => approve(e), 409, legacyPackageMessage);
  });

  it("refuses the report's creator", async () => {
    const e = signOff(captured({ actor: "reviewer" }));
    await refused(
      e,
      () => approve(e),
      403,
      "The report creator cannot approve its package",
    );
  });

  it.each([
    ["internal", { internalHash: "R1-stale" }],
    ["client", { clientHash: "R1-stale" }],
  ])("refuses a stale %s package hash", async (_, data) => {
    const e = signOff(captured());
    await refused(
      e,
      () => approve(e, "reviewer", data),
      409,
      "Review both exact package hashes",
    );
  });

  it("refuses a not-applicable answer without its basis", async () => {
    const e = signOff(captured());
    await refused(
      e,
      () =>
        approve(e, "reviewer", {
          checklist: { ...confirmed, subsequentEvents: "not_applicable" },
        }),
      400,
      "State why each completion checklist item marked not applicable does not apply",
    );
  });
});

describe("releaseReport", () => {
  const releaseInput = {
    reportId: "R1",
    recipientScope: "Client board",
    reason: "Authorized release",
  };
  const release = (e: Engagement, user = "lead", data = {}) =>
    command(e, "releaseReport", { ...releaseInput, ...data }, user);

  it("releases the approved package and records the notification", async () => {
    const e = signOff(approved());
    expect(await release(e)).toEqual({
      reportId: "R1",
      clientNotification: "Client board",
    });
    expect(r1(e).release).toMatchObject({
      state: "released",
      recipientScope: "Client board",
      releasedBy: "lead",
      releasedAt: at,
      history: [
        { actor: "lead", at, action: "release", reason: "Authorized release" },
        {
          actor: "lead",
          at,
          action: "notify_client",
          reason:
            "Released to Client board. Notify the recipients that this report is available.",
        },
      ],
    });
  });

  it.each(["auditor", "reviewer", "viewer", "contributor"])(
    "refuses %s",
    async (user) => {
      const e = signOff(approved());
      await refused(
        e,
        () => release(e, user),
        403,
        "A Lead Auditor must authorize this decision",
      );
    },
  );

  it("refuses an unknown report", async () => {
    const e = signOff(approved());
    await refused(
      e,
      () => release(e, "lead", { reportId: "R9" }),
      404,
      "Report not found",
    );
  });

  const independentApproval =
    "A different independent approver must approve both exact packages before release";
  it.each([
    ["an internal package", () => captured()],
    [
      "a package without a release record",
      () => approved({ release: undefined }),
    ],
    [
      "a package recaptured since its approval",
      () => approved({ sha256: "R1-recaptured" }),
    ],
    [
      "a client package recaptured since its approval",
      () => approved({ clientSha256: "R1-client-recaptured" }),
    ],
  ])("refuses %s", async (_, report) => {
    const e = signOff(report());
    await refused(e, () => release(e), 409, independentApproval);
  });

  it("refuses the Lead who approved the package", async () => {
    const e = signOff(approved());
    r1(e).release!.approval!.userId = "lead";
    await refused(e, () => release(e), 409, independentApproval);
  });

  it("refuses while the scope or program is not approved", async () => {
    const e = signOff(approved());
    e.workflow!.program.status = "submitted";
    await refused(
      e,
      () => release(e),
      409,
      "Resolve current scope/program completion before release",
    );
  });

  it("refuses an assurance package without an engagement quality reviewer", async () => {
    const terms = { engagementType: "attestation", conclusion: "qualified" };
    const e = signOff(
      approved({
        snapshot: {
          opinion: "Qualified conclusion",
          workflow: approvedWorkflow(),
          terms,
        },
      }),
    );
    await refused(
      e,
      () => release(e),
      409,
      "Appoint an engagement quality reviewer and obtain their sign-off before release",
    );
    e.qualityReview = completedQualityReview();
    await refused(
      e,
      () => release(e),
      409,
      "The engagement quality reviewer must sign off both exact packages before release",
    );
  });

  it("refuses a predecessor that is not released", async () => {
    const e = signOff(approved());
    await refused(
      e,
      () => release(e, "lead", { supersedes: "R0" }),
      400,
      "Select a released predecessor from this engagement",
    );
  });
});

describe("withdrawReport", () => {
  const withdraw = (e: Engagement, user = "lead", data = {}) =>
    command(
      e,
      "withdrawReport",
      { reportId: "R1", reason: "Material misstatement found", ...data },
      user,
    );

  it.each([
    ["an approved", () => approved()],
    [
      "a released",
      () =>
        approved({
          release: { ...approved().release!, state: "released" },
        }),
    ],
  ])("withdraws %s report and records why", async (_, report) => {
    const e = signOff(report());
    expect(await withdraw(e)).toEqual({ reportId: "R1" });
    expect(r1(e).release!.state).toBe("withdrawn");
    expect(r1(e).release!.history.at(-1)).toEqual({
      actor: "lead",
      at,
      action: "withdraw",
      reason: "Material misstatement found",
    });
  });

  it.each(["auditor", "reviewer", "viewer"])("refuses %s", async (user) => {
    const e = signOff(approved());
    await refused(
      e,
      () => withdraw(e, user),
      403,
      "A Lead Auditor must authorize this decision",
    );
  });

  it("refuses an unknown report", async () => {
    const e = signOff(approved());
    await refused(
      e,
      () => withdraw(e, "lead", { reportId: "R9" }),
      404,
      "Report not found",
    );
  });

  it.each([
    ["an internal", () => captured()],
    [
      "a superseded",
      () =>
        approved({ release: { ...approved().release!, state: "superseded" } }),
    ],
    [
      "a withdrawn",
      () =>
        approved({ release: { ...approved().release!, state: "withdrawn" } }),
    ],
  ])("refuses %s report", async (_, report) => {
    const e = signOff(report());
    await refused(
      e,
      () => withdraw(e),
      409,
      "Only an approved or released report can be withdrawn",
    );
  });
});
