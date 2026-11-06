import { describe, expect, it } from "vitest";
import type { Report } from "../domain";
import { seedWorkflow } from "../workflow-seed";
import {
  approvedWorkflow,
  at,
  command,
  engagement,
  expectFailure,
} from "./test-fixtures";

/** A captured final report whose two packages the reviewer approved. */
function approvedReport(id: string): Report {
  return {
    id,
    kind: "final",
    createdAt: at,
    actor: "auditor",
    sha256: id + "-internal",
    snapshot: { opinion: "Adverse conclusion" },
    clientSnapshot: { opinion: "Adverse conclusion" },
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

  it("ignores the release-time procedures but not other unfinished work", async () => {
    const e = setup("R1");
    const seeded = seedWorkflow("lead", at).procedures;
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
