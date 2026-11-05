import type { Report, Role } from "./domain";

export function packageStatus(report: Report, clientView = false) {
  if (clientView) return "released";
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
  return labels[packageStatus(report, clientView)] ?? "Internal package";
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
