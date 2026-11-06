import type { Report, Role } from "./domain";

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

export function packageOpenLabel(report: Report, role: Role, userId: string) {
  if (["Client Viewer", "Client Contributor"].includes(role))
    return "View report";
  const state = packageStatus(report);
  if (
    state === "internal" &&
    ["Reviewer", "Lead Auditor"].includes(role) &&
    report.actor !== userId &&
    report.snapshot.workflow
  )
    return "Review approval";
  if (
    state === "approved" &&
    role === "Lead Auditor" &&
    report.release?.approval?.userId !== userId
  )
    return "Review release";
  return state === "released" ? "View released report" : "Review package";
}
