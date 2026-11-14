import type { Engagement, Report, Role } from "./domain/types";
import { can, isClientRole } from "./permissions";
import { releaseRefusal } from "./preconditions";

/**
 * The date a captured report states: its report date element, else the
 * snapshot's capture time. Never the release time, which the client
 * projection shows as the record's createdAt.
 */
export function reportDate(snapshot: Record<string, unknown>) {
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [],
    element = elements.find(
      (el): el is { id: string; value: string } =>
        !!el && typeof el === "object" && el.id === "date",
    );
  return (
    element?.value ||
    (typeof snapshot.createdAt === "string" ? snapshot.createdAt : "")
  );
}

/**
 * The time a report row shows and its label (#210): the client projection
 * carries the release time, which the client sees as "Released"; a staff
 * record shows its capture time.
 */
export function reportTime(report: {
  createdAt?: string;
  releasedAt?: string;
}) {
  return report.releasedAt
    ? { label: "Released", at: report.releasedAt }
    : { label: "Captured", at: report.createdAt ?? "" };
}

export function packageStatus(report: Report, clientView = false) {
  if (clientView) return report.supersededBy ? "superseded" : "released";
  return report.kind === "draft"
    ? "draft"
    : (report.release?.state ?? "internal");
}

export function packageStatusLabel(report: Report, clientView = false) {
  const labels: Record<string, string> = {
    draft: "Draft snapshot",
    internal: "Awaiting approval",
    approved: "Approved for release",
    released: "Released to client",
    superseded: "Superseded",
    withdrawn: "Withdrawn",
  };
  const state = packageStatus(report, clientView);
  // The client projection names the successor on the report itself.
  const successor = report.supersededBy ?? report.release?.supersededBy;
  if (state === "superseded" && successor) return "Superseded by " + successor;
  return labels[state] ?? "Internal package";
}

/**
 * What comes next for a captured package, by its state (#202): the
 * pre-release guidance only while a final package awaits approval. With the
 * engagement, an approved package that the server would still refuse to
 * release (an Engagement Quality Reviewer's sign-off outstanding, open
 * completion work) names what it awaits, in the server's words (#210).
 */
export function packageGuidance(report: Report, engagement?: Engagement) {
  switch (packageStatus(report)) {
    case "draft":
      return "Drafts are internal review snapshots.";
    case "approved": {
      const refusal = engagement && releaseRefusal(engagement, report);
      return refusal
        ? "Both package versions are approved. " + refusal.message + "."
        : "Both package versions are approved. A Lead Auditor other than the approver authorizes the client release.";
    }
    case "released":
      return "Released to the client. A newer released report supersedes it; a Lead Auditor can withdraw it.";
    case "superseded":
      return "Superseded by a newer released report. It stays readable as it was issued.";
    case "withdrawn":
      return "Withdrawn. Capture a new final package to report again.";
    default:
      return "Approve both package versions before client release.";
  }
}

export function packageOpenLabel(report: Report, role: Role, userId: string) {
  if (isClientRole(role)) return "View report";
  const state = packageStatus(report);
  if (
    state === "internal" &&
    can(role, "approveReportPackage") &&
    report.actor !== userId &&
    report.snapshot.workflow
  )
    return "Review approval";
  if (
    state === "approved" &&
    can(role, "releaseReport") &&
    report.release?.approval?.userId !== userId
  )
    return "Review release";
  return state === "released" ? "View released report" : "Review package";
}

/**
 * The release notifications a client sees on its overview (#94), newest
 * first: one per released report whose release notified the client. Each
 * names the reports it replaces, so a client sees why an earlier report is
 * now superseded.
 */
export function clientNotices(reports: Report[]) {
  return reports
    .flatMap((r) => (r.notification ? [{ r, n: r.notification }] : []))
    .map(({ r, n }) => ({
      reportId: r.id,
      at: n.at,
      text:
        "Report " +
        r.id +
        " was released to " +
        (n.recipients || "your organisation") +
        (r.replaces?.length ? "; it replaces " + r.replaces.join(", ") : "") +
        (r.supersededBy ? ". It has since been superseded" : "") +
        ".",
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
