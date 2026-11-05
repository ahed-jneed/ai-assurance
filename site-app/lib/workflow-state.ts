import type { Engagement, Report, Role } from "./domain";
import type { Procedure, Workflow } from "./workflow-types";
export const isClientRole = (role: Role | string) =>
  role === "Client Viewer" || role === "Client Contributor";
export const isInternalRole = (role: Role | string) =>
  ["Auditor", "Lead Auditor", "Reviewer"].includes(role);
export const releaseState = (report: Report) =>
  report.release?.state ?? "internal";
export const isReleased = (report: Report) =>
  report.kind === "final" &&
  releaseState(report) === "released" &&
  !!report.clientSnapshot &&
  !!report.clientSha256;
export function activeGrant(
  w: Workflow | undefined,
  userId: string,
  requestId?: string,
  at = Date.now(),
) {
  return (
    w?.clientGrants.filter(
      (g) =>
        g.active &&
        g.userId === userId &&
        (!requestId || g.requestId === requestId) &&
        Date.parse(g.expiresAt) > at,
    ) ?? []
  );
}
export function currentExecution(e: Engagement, p: Procedure) {
  const x = p.execution,
    w = e.workflow;
  return (
    !!x &&
    !!w &&
    ((x.briefRevision === w.brief?.revision &&
      x.programRevision === w.program.revision &&
      x.procedureRevision === p.revision) ||
      (x.impactReview?.briefRevision === w.brief?.revision &&
        x.impactReview?.programRevision === w.program.revision &&
        x.procedureRevision === p.revision))
  );
}
export function workflowRequirements(e: Engagement, final = false) {
  const w = e.workflow;
  if (!w)
    return final
      ? [
          {
            id: "workflow",
            title: "Adopt the engagement workflow",
            message:
              "Review the engagement brief and audit program before final issuance",
          },
        ]
      : [];
  const gates: {
    id: string;
    title: string;
    message: string;
    recordId?: string;
  }[] = [];
  if (w.brief?.status !== "approved")
    gates.push({
      id: "brief",
      title: "Approve engagement scope",
      message: "The current engagement brief needs independent approval",
    });
  if (
    w.program.status !== "approved" ||
    w.program.briefRevision !== w.brief?.revision
  )
    gates.push({
      id: "program",
      title: "Approve the audit program",
      message: "The audit program must bind the approved scope revision",
    });
  if (final)
    for (const p of w.procedures.filter(
      (p) =>
        p.selected &&
        ["applicable", "readiness"].includes(p.applicability) &&
        p.stage !== "Remediation and Monitoring",
    )) {
      if (p.state !== "reviewed" || !currentExecution(e, p) || !p.review)
        gates.push({
          id: p.id,
          recordId: p.id,
          title: p.title,
          message:
            p.templateId +
            ": current execution and independent review required",
        });
      else {
        const paper = e.papers.find((q) => q.id === p.paperId);
        if (
          !paper ||
          paper.revision !== p.paperRevision ||
          paper.status !== "signed"
        )
          gates.push({
            id: p.id,
            recordId: p.id,
            title: p.title,
            message:
              p.templateId + ": sign the procedure working-paper revision",
          });
      }
    }
  return gates;
}
export function procedureLabel(e: Engagement, p: Procedure) {
  if (p.applicability === "pending") return "Applicability decision needed";
  if (!p.selected)
    return e.workflow?.program.status === "approved"
      ? "Outside agreed scope"
      : "Outside proposed scope";
  if (p.applicability === "not_applicable") return "Not applicable";
  if (p.execution && !currentExecution(e, p))
    return "Scope or plan reassessment needed";
  const paper = e.papers.find((q) => q.id === p.paperId);
  if (paper?.comments.some((c) => !c.resolved)) return "Changes requested";
  return {
    planned: "Planned",
    executed: "Executed · evaluate results",
    evaluated: "Ready for review",
    submitted: "Awaiting assigned review",
    reviewed: "Independently reviewed",
  }[p.state];
}
