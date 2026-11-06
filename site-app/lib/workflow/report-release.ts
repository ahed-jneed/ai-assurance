// Report release commands: independent approval of both exact final
// packages, their release to the client and withdrawal. Only one final
// report is released at a time: releasing one supersedes the one released
// before and records the client notification.
import { z } from "zod";
import { releaseRequirements, releaseTimeTemplates } from "../domain/gates";
import {
  currentClientSnapshot,
  legacyPackageMessage,
} from "../client-projection";
import { releaseState } from "../workflow-state";
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
    if (!currentClientSnapshot(r)) fail(409, legacyPackageMessage);
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
    if (releaseRequirements(e).length)
      fail(409, "Resolve current scope/program completion before release");
    // Every released report is superseded, so the client never holds two
    // released opinions. A named predecessor must be one of them; without
    // one, the latest is recorded as the predecessor.
    const released = e.reports.filter(
      (q) => q.id !== r.id && releaseState(q) === "released",
    );
    if (a.supersedes && !released.some((q) => q.id === a.supersedes))
      fail(400, "Select a released predecessor from this engagement");
    const predecessor =
      released.find((q) => q.id === a.supersedes) ?? released.at(-1);
    for (const old of released) {
      old.release!.state = "superseded";
      old.release!.supersededBy = r.id;
      old.release!.history.push({
        actor: c.userId,
        at: c.at,
        action: "supersede",
        reason: a.reason,
      });
    }
    if (predecessor) release.supersedes = predecessor.id;
    Object.assign(release, {
      state: "released",
      recipientScope: a.recipientScope,
      releasedBy: c.userId,
      releasedAt: c.at,
      completion: {
        templateIds: [...releaseTimeTemplates],
        internalHash: release.approval.internalHash,
        clientHash: release.approval.clientHash,
        approvedBy: release.approval.userId,
        approvedAt: release.approval.at,
        releasedBy: c.userId,
        releasedAt: c.at,
      },
    });
    release.history.push(
      {
        actor: c.userId,
        at: c.at,
        action: "release",
        reason: a.reason,
      },
      {
        actor: c.userId,
        at: c.at,
        action: "notify_client",
        reason:
          (released.length
            ? "Released to " +
              a.recipientScope +
              "; replaces " +
              released.map((q) => q.id).join(", ")
            : "Released to " + a.recipientScope) +
          ". Notify the recipients that this report is available.",
      },
    );
    return {
      reportId: r.id,
      ...(predecessor && {
        supersedes: released.map((q) => q.id).join(","),
      }),
      clientNotification: release.recipientScope!,
    };
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
