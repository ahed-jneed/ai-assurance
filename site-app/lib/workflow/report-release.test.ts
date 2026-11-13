import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { legacyPackageMessage } from "../client-projection";
import { releaseChecklist, type Report } from "../domain";
import { seedWorkflow } from "../workflow-seed";
import {
  approvedWorkflow,
  at,
  command,
  engagement,
  expectFailure,
} from "./test-fixtures";
import { resolveNew } from "../criteria/pin";

/** A captured final report whose two packages the reviewer approved. */
function approvedReport(id: string): Report {
  return {
    id,
    kind: "final",
    createdAt: at,
    actor: "auditor",
    sha256: id + "-internal",
    snapshot: { opinion: "Adverse conclusion" },
    clientSnapshot: { contractVersion: "2.0", opinion: "Adverse conclusion" },
    clientSha256: id + "-client",
    release: {
      state: "approved",
      approval: {
        userId: "reviewer",
        at,
        internalHash: id + "-internal",
        clientHash: id + "-client",
        reason: "Both packages reviewed",
      },
      history: [],
    },
  };
}
const release = (reportId: string, supersedes?: string) =>
  command(
    engagementWith,
    "releaseReport",
    {
      reportId,
      recipientScope: "Client members",
      reason: "Authorized release",
      ...(supersedes !== undefined && { supersedes }),
    },
    "lead",
  );
let engagementWith = engagement();
function setup(...ids: string[]) {
  engagementWith = engagement({
    workflow: approvedWorkflow(),
    stage: "Sign-off",
    reports: ids.map(approvedReport),
  });
  return engagementWith;
}
const reportOf = (id: string) =>
  engagementWith.reports.find((r) => r.id === id)!;
/** Every completion checklist item confirmed, as the approval form sends it. */
const confirmed = Object.fromEntries(
  releaseChecklist.map((i) => [i.id, "confirmed"]),
);
/** R1 captured with a current client snapshot, not yet approved. */
function internalReport() {
  const r = reportOf("R1");
  r.release = { state: "internal", history: [] };
  r.snapshot = { opinion: "Adverse conclusion", workflow: approvedWorkflow() };
  return r;
}
const approve = (data: Record<string, unknown>) =>
  command(
    engagementWith,
    "approveReportPackage",
    {
      reportId: "R1",
      internalHash: "R1-internal",
      clientHash: "R1-client",
      reason: "Both packages reviewed",
      ...data,
    },
    "reviewer",
  );

describe("report release", () => {
  it("records the release-time completion records against both hashes", async () => {
    setup("R1");
    await release("R1");
    expect(reportOf("R1").release).toMatchObject({
      state: "released",
      releasedBy: "lead",
      completion: {
        templateIds: ["WP-RP-02", "MEM-SO-01"],
        internalHash: "R1-internal",
        clientHash: "R1-client",
        approvedBy: "reviewer",
        approvedAt: at,
        releasedBy: "lead",
        releasedAt: at,
      },
    });
    expect(reportOf("R1").release!.supersedes).toBeUndefined();
  });

  it("records a client notification with every release", async () => {
    setup("R1");
    const details = await release("R1");
    expect(details.clientNotification).toBe("Client members");
    expect(reportOf("R1").release!.history.map((h) => h.action)).toEqual([
      "release",
      "notify_client",
    ]);
  });

  it("supersedes the released report automatically", async () => {
    setup("R1", "R2");
    await release("R1");
    const details = await release("R2");
    expect(details.supersedes).toBe("R1");
    expect(reportOf("R1").release).toMatchObject({
      state: "superseded",
      supersededBy: "R2",
    });
    expect(reportOf("R1").release!.history.at(-1)!.action).toBe("supersede");
    expect(reportOf("R2").release).toMatchObject({
      state: "released",
      supersedes: "R1",
    });
    const notice = reportOf("R2").release!.history.at(-1)!;
    expect(notice.action).toBe("notify_client");
    expect(notice.reason).toContain("replaces R1");
    expect(
      engagementWith.reports.filter((r) => r.release?.state === "released"),
    ).toHaveLength(1);
  });

  it("treats an empty predecessor choice as none chosen", async () => {
    setup("R1", "R2");
    await release("R1");
    await release("R2", "");
    expect(reportOf("R2").release!.supersedes).toBe("R1");
  });

  it("supersedes every report an earlier version left released", async () => {
    setup("R1", "R2", "R3");
    await release("R1");
    // Before this rule, two reports could be released at the same time.
    reportOf("R2").release = {
      ...reportOf("R2").release!,
      state: "released",
    };
    await release("R3", "R1");
    for (const id of ["R1", "R2"])
      expect(reportOf(id).release).toMatchObject({
        state: "superseded",
        supersededBy: "R3",
      });
    expect(reportOf("R3").release!.supersedes).toBe("R1");
  });

  it("accepts only a released predecessor", async () => {
    setup("R1", "R2");
    await expectFailure(
      release("R2", "R1"),
      400,
      "Select a released predecessor from this engagement",
    );
    await release("R1");
    await expectFailure(release("R2", "R2"), 400);
    await expectFailure(release("R2", "unknown"), 400);
    expect(reportOf("R1").release!.state).toBe("released");
  });

  it("refuses to approve a package captured before report model v2", async () => {
    setup("R1");
    const r = reportOf("R1");
    r.release = { state: "internal", history: [] };
    // The old client snapshot: no contract version.
    r.clientSnapshot = { opinion: "Adverse conclusion" };
    r.snapshot = {
      opinion: "Adverse conclusion",
      workflow: approvedWorkflow(),
    };
    await expectFailure(
      command(
        engagementWith,
        "approveReportPackage",
        {
          reportId: "R1",
          internalHash: "R1-internal",
          clientHash: "R1-client",
          reason: "Both packages reviewed",
          checklist: confirmed,
        },
        "reviewer",
      ),
      409,
      legacyPackageMessage,
    );
    expect(r.release.state).toBe("internal");
  });

  it("ignores the release-time procedures but not other unfinished work", async () => {
    const e = setup("R1");
    const seeded = seedWorkflow(resolveNew(), "lead", at).procedures;
    const rp02 = seeded.find((p) => p.templateId === "WP-RP-02")!;
    e.workflow!.procedures = [
      { ...rp02, selected: true, applicability: "applicable" },
    ];
    await release("R1");
    expect(reportOf("R1").release!.state).toBe("released");
    const rp01 = seeded.find((p) => p.templateId === "WP-RP-01")!;
    setup("R2").workflow!.procedures = [
      { ...rp01, selected: true, applicability: "applicable" },
    ];
    await expectFailure(release("R2"), 409);
  });
});

describe("the MEM-SO-01 completion checklist (#94)", () => {
  it("records the approver's answers with the approval and the release", async () => {
    setup("R1");
    internalReport();
    await approve({
      checklist: { ...confirmed, representations: "not_applicable" },
      checklistNote: "The engaging party is the responsible party.",
    });
    const checklist = {
      items: releaseChecklist.map((i) => ({
        id: i.id,
        answer: i.id === "representations" ? "not_applicable" : "confirmed",
      })),
      note: "The engaging party is the responsible party.",
    };
    expect(reportOf("R1").release!.approval!.checklist).toEqual(checklist);
    await release("R1");
    expect(reportOf("R1").release!.completion!.checklist).toEqual(checklist);
  });

  it("needs every item answered, and a basis for not-applicable answers", async () => {
    setup("R1");
    const r = internalReport();
    await expect(approve({})).rejects.toBeInstanceOf(ZodError);
    const { independence: _, ...partial } = confirmed;
    await expect(approve({ checklist: partial })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      approve({ checklist: { ...confirmed, independence: "no" } }),
    ).rejects.toBeInstanceOf(ZodError);
    await expectFailure(
      approve({ checklist: { ...confirmed, distribution: "not_applicable" } }),
      400,
      "State why each completion checklist item marked not applicable does not apply",
    );
    expect(r.release!.state).toBe("internal");
    await approve({ checklist: confirmed });
    expect(r.release!.approval!.checklist!.note).toBe("");
  });

  it("releases an approval recorded before the checklist without one", async () => {
    setup("R1");
    await release("R1");
    expect(reportOf("R1").release!.completion).not.toHaveProperty("checklist");
  });
});
