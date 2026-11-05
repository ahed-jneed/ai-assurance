// Only type imports: scripts/paper-presentation-check.mjs and
// scripts/work-inbox-check.mjs load this module without resolving imports.
import type { Engagement, Report, Role, Run } from "./domain";
import type { Brief, Procedure, Program, Workflow } from "./workflow-types";
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
/**
 * Whether the procedure's execution was performed against its current plan:
 * the plan hash it recorded or, for work recorded before plan hashes, its
 * plan revision. Preparer, reviewer and due-date changes never change
 * either; changes to other procedures are irrelevant.
 */
export function executionPlanCurrent(p: Procedure) {
  const x = p.execution;
  return (
    !!x &&
    (x.planHash === undefined
      ? x.procedureRevision === p.revision
      : x.planHash === p.planHash)
  );
}
/**
 * Whether the procedure's execution still counts: it binds the current plan
 * and the current scope revision, directly or through an independent impact
 * review after a scope change. Program revisions do not enter into it.
 */
export function currentExecution(e: Engagement, p: Procedure) {
  const x = p.execution,
    scope = e.workflow?.brief?.revision;
  return (
    !!x &&
    scope !== undefined &&
    executionPlanCurrent(p) &&
    (x.briefRevision === scope || x.impactReview?.briefRevision === scope)
  );
}
/** Whether a run was queued for this procedure's current plan and scope. */
export function runBindsProcedure(e: Engagement, p: Procedure, r: Run) {
  const b = r.procedureBinding;
  return (
    !!b &&
    b.procedureId === p.id &&
    b.procedureRevision === p.revision &&
    b.briefRevision === e.workflow?.brief?.revision
  );
}
// History limits keep an engagement record bounded without stopping a change
// halfway. The scope and the program count returns only: a submission that is
// approved or withdrawn uses none, so a scope or program in force always has a
// submission left for a change to it. A procedure counts the work recorded on
// it, and its limit refuses only redoing current work. Entries recorded before
// November 2026 count towards no limit.
export const revisionLimits = { brief: 40, program: 75, procedure: 30 };
/** How close to a limit warnings start. */
export const revisionWarningLevel = 5;
/** Returns of the scope: the revisions its history keeps with a reason. */
export const briefReturns = (b: Brief) =>
  b.history.filter((h) => h.returnReason !== undefined).length;
export const programReturns = (p: Program) =>
  p.history.filter((h) => h.status === "returned").length;
/** Work recorded on a procedure: executions, evaluations and impact reviews. */
export const procedureWorkRevisions = (p: Procedure) =>
  p.history.filter(
    (h) =>
      h.action === "execute" ||
      h.action === "evaluate" ||
      h.action === "reaffirm",
  ).length;
/** The brief, program and procedures close to or at their history limit. */
export function revisionWarnings(w: Workflow | undefined) {
  const warnings: {
    id: string;
    recordId?: string;
    title: string;
    message: string;
  }[] = [];
  const check = (
    id: string,
    title: string,
    used: number,
    limit: number,
    message: (left: string) => string,
    recordId?: string,
  ) => {
    const left = Math.max(0, limit - used);
    if (left <= revisionWarningLevel)
      warnings.push({
        id,
        ...(recordId && { recordId }),
        title,
        message: message(left + " of " + limit),
      });
  };
  if (!w) return warnings;
  if (w.brief)
    check(
      "brief",
      "Engagement brief",
      briefReturns(w.brief),
      revisionLimits.brief,
      (left) =>
        left +
        " scope returns left. Drafting, approval and changes to the approved scope use none; once none are left, a returned scope cannot be submitted again, so continue in a follow-up engagement.",
    );
  check(
    "program",
    "Audit program",
    programReturns(w.program),
    revisionLimits.program,
    (left) =>
      left +
      " program returns left. Drafting, approval and changes to the approved program use none; once none are left, a returned program cannot be submitted again, so continue in a follow-up engagement.",
  );
  for (const p of w.procedures)
    check(
      p.id,
      p.title,
      procedureWorkRevisions(p),
      revisionLimits.procedure,
      (left) =>
        p.templateId +
        ": " +
        left +
        " work revisions left. Each execution, evaluation and impact review uses one; plan changes and returns do not. Once none are left, current work cannot be recorded, evaluated or reaffirmed again, while work that a plan or scope change requires is still accepted.",
      p.id,
    );
  return warnings;
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
