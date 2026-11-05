// Report release commands: independent approval of both exact final
// packages, their release to the client and withdrawal.
import { z } from "zod";
import { releaseState, workflowRequirements } from "../workflow-state";
import { fail, short, text, uid, type WorkflowHandler } from "./command";
export const reportReleaseCommands: Record<string, WorkflowHandler> = {
  async approveReportPackage({ e, c, reviewer }, data) {
    reviewer();
    const a = z
        .object({
          reportId: short,
          internalHash: short,
          clientHash: short,
          reason: text,
        })
        .strict()
        .parse(data),
      r =
        e.reports.find((r) => r.id === a.reportId) ??
        fail(404, "Report not found");
    if (
      r.kind !== "final" ||
      !["internal", "approved"].includes(releaseState(r))
    )
      fail(409, "Approve an internal final package");
    if (!r.snapshot.workflow)
      fail(
        409,
        "Prepare a current final package capturing the approved scope and audit program",
      );
    if (r.actor === c.userId)
      fail(403, "The report creator cannot approve its package");
    if (r.sha256 !== a.internalHash || r.clientSha256 !== a.clientHash)
      fail(409, "Review both exact package hashes");
    r.release ??= { state: "internal", history: [] };
    r.release.approval = {
      userId: c.userId,
      at: c.at,
      internalHash: r.sha256,
      clientHash: r.clientSha256!,
      reason: a.reason,
    };
    r.release.state = "approved";
    r.release.history.push({
      actor: c.userId,
      at: c.at,
      action: "approve",
      reason: a.reason,
    });
    return { reportId: r.id };
  },
  async releaseReport({ e, c, lead }, data) {
    lead();
    const a = z
        .object({
          reportId: short,
          recipientScope: text,
          reason: text,
          supersedes: uid.optional(),
        })
        .strict()
        .parse(data),
      r =
        e.reports.find((r) => r.id === a.reportId) ??
        fail(404, "Report not found"),
      release = r.release;
    if (
      release?.state !== "approved" ||
      release.approval?.internalHash !== r.sha256 ||
      release.approval.clientHash !== r.clientSha256 ||
      release.approval.userId === c.userId
    )
      fail(
        409,
        "A different independent approver must approve both exact packages before release",
      );
    if (workflowRequirements(e, true).length)
      fail(409, "Resolve current scope/program completion before release");
    if (a.supersedes) {
      const old = e.reports.find((q) => q.id === a.supersedes);
      if (!old || releaseState(old) !== "released" || old.id === r.id)
        fail(400, "Select a released predecessor from this engagement");
      old.release!.state = "superseded";
      old.release!.supersededBy = r.id;
      old.release!.history.push({
        actor: c.userId,
        at: c.at,
        action: "supersede",
        reason: a.reason,
      });
      release.supersedes = old.id;
    }
    Object.assign(release, {
      state: "released",
      recipientScope: a.recipientScope,
      releasedBy: c.userId,
      releasedAt: c.at,
    });
    release.history.push({
      actor: c.userId,
      at: c.at,
      action: "release",
      reason: a.reason,
    });
    return { reportId: r.id };
  },
  async withdrawReport({ e, c, lead }, data) {
    lead();
    const a = z.object({ reportId: short, reason: text }).strict().parse(data),
      r =
        e.reports.find((r) => r.id === a.reportId) ??
        fail(404, "Report not found");
    if (!["released", "approved"].includes(releaseState(r)))
      fail(409, "Only an approved or released report can be withdrawn");
    r.release!.state = "withdrawn";
    r.release!.history.push({
      actor: c.userId,
      at: c.at,
      action: "withdraw",
      reason: a.reason,
    });
    return { reportId: r.id };
  },
};
