// Keep runtime imports to small leaf modules (./domain/release-time): the
// harnesses scripts/paper-presentation-check.mjs and
// scripts/work-inbox-check.mjs load this module through sourceURL
// (scripts/ts-modules.mjs), which compiles it and its relative imports.
import type { Engagement, Report, Role, Run } from "./domain";
import { isReleaseTimeRecord } from "./domain/release-time";
import type { Brief, Procedure, Program, Workflow } from "./workflow-types";
import type { DraftKind } from "./workspace-state";
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
/**
 * Whether a client may read the report: the released one, and every report a
 * later release superseded. The client was issued that opinion, so it stays
 * readable, labelled with the report that superseded it.
 */
export const isClientVisible = (report: Report) =>
  report.kind === "final" &&
  ["released", "superseded"].includes(releaseState(report)) &&
  !!report.release?.releasedAt &&
  !!report.clientSnapshot &&
  !!report.clientSha256;
/**
 * The user's live client request grants: active, unexpired and, given
 * `since` (the start of the user's current membership grant), issued at or
 * after it, so a revoked or re-roled contributor never regains old requests.
 */
export function activeGrant(
  w: Workflow | undefined,
  userId: string,
  requestId?: string,
  at = Date.now(),
  since?: string | null,
) {
  return (
    w?.clientGrants.filter(
      (g) =>
        g.active &&
        g.userId === userId &&
        (!requestId || g.requestId === requestId) &&
        Date.parse(g.expiresAt) > at &&
        (!since || g.at >= since),
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
/**
 * Whether planning pins still name this procedure's current plan and the
 * current scope: the plan hash they recorded or, for pins recorded without
 * one, the plan revision, plus the brief revision. Program revisions do not
 * enter into it, so a change to another procedure, or to a preparer,
 * reviewer or due date, leaves the pins current.
 */
export function planPinsCurrent(
  e: Engagement,
  p: Procedure,
  pins: {
    procedureRevision?: number;
    planHash?: string;
    briefRevision?: number;
  },
) {
  const scope = e.workflow?.brief?.revision;
  return (
    scope !== undefined &&
    pins.briefRevision === scope &&
    (pins.planHash !== undefined && p.planHash !== undefined
      ? pins.planHash === p.planHash
      : pins.procedureRevision === p.revision)
  );
}
/**
 * Whether a run was queued for this procedure's current plan and scope, the
 * rule executions follow (see currentExecution): a run queued under an
 * earlier program revision still binds while both are unchanged.
 */
export function runBindsProcedure(e: Engagement, p: Procedure, r: Run) {
  const b = r.procedureBinding;
  return !!b && b.procedureId === p.id && planPinsCurrent(e, p, b);
}
/**
 * The latest queued or running run bound to this procedure. While one
 * exists, another planned run of the procedure is refused: duplicate queued
 * runs block final issuance until someone cancels them.
 */
export function activeProcedureRun(e: Engagement, procedureId: string) {
  return e.runs.findLast(
    (r) =>
      ["queued", "running"].includes(r.state) &&
      r.procedureBinding?.procedureId === procedureId,
  );
}
/**
 * The revision a recovery draft of a procedure form is based on. A saved
 * draft can be restored only while this is unchanged, so restoring it cannot
 * revert a change saved since. Every procedure form depends on the plan, the
 * execution, the program and the scope revisions. The plan form also holds
 * the preparer, reviewer and due date, which change the assignment revision
 * instead of the plan revision. The audit program and the workspace-state
 * route both use this, so the client and the server always agree.
 */
export function procedureDraftRevision(
  w: Workflow,
  p: Procedure,
  kind: DraftKind,
) {
  const revisions = [
    p.revision,
    p.execution?.revision ?? 0,
    w.program.revision,
    w.brief?.revision ?? 0,
  ];
  // Absent until the first assignment change, so a plan draft saved before
  // assignment revisions existed keeps its base until the assignment changes.
  if (kind === "procedure-plan" && p.assignmentRevision !== undefined)
    revisions.push(p.assignmentRevision);
  return revisions.join(":");
}
// History limits keep an engagement record bounded without stopping a change
// halfway. The scope and the program count returns only: a submission that is
// approved or withdrawn uses none, so a scope or program in force always has a
// submission left for a change to it. A procedure counts the work recorded on
// it, and its limit refuses only redoing current work. An entry's shape, never
// its date, decides whether it counts: entries in the shape written before
// these limits count towards no limit, whenever they were written. Those are
// procedure entries without an `action`, brief revisions returned without a
// `returnReason`, and program entries, which never had the "returned" status.
export const revisionLimits = { brief: 40, program: 75, procedure: 30 };
/** How close to a limit warnings start. */
export const revisionWarningLevel = 5;
/** Returns of the scope: the revisions its history keeps with a reason. */
export const briefReturns = (b: Brief) =>
  b.history.filter((h) => h.returnReason !== undefined).length;
export const programReturns = (p: Program) =>
  p.history.filter((h) => h.status === "returned").length;
/**
 * Work recorded on a procedure: executions, evaluations and impact reviews.
 * Every entry the commands write names the change that followed it; an entry
 * without an `action` has the shape written before, so it is not counted.
 */
export const procedureWorkRevisions = (p: Procedure) =>
  p.history.filter(
    (h) =>
      h.action === "execute" ||
      h.action === "evaluate" ||
      h.action === "reaffirm",
  ).length;
// The engagement metadata limit bounds approval cycles, which count towards no
// history limit. save() in lib/engagement-repo.ts refuses a write that would
// store more than `metadataLimit` bytes. So that the limit never stops an
// approval halfway, `approvalReserve` bytes under it are kept for approving
// the scope and the program: a change that needs them approved must leave the
// reserve free, and until they are approved only their own drafting,
// submissions, approvals and returns may use it.
export const metadataLimit = 1_500_000;
export const approvalReserve = 100_000;
/** How close to the metadata limit the audit program warns. */
export const metadataWarningLevel = 2 * approvalReserve;
/** Room for a reviewer's reason, in bytes, when a decision is reserved. */
const reasonRoom = 2_000;
const kb = (bytes: number) => bytes / 1000 + " KB",
  mb = (bytes: number) => bytes / 1_000_000 + " MB";
/** Whether the scope, or the program bound to it, awaits approval. */
export const approvalPending = (w: Workflow | undefined): w is Workflow =>
  !!w &&
  (w.brief?.status !== "approved" ||
    w.program.status !== "approved" ||
    w.program.briefRevision !== w.brief.revision);
/** The scope and program status of an engagement as it was loaded. */
export type ApprovalStatus = {
  brief?: Brief["status"];
  program?: Program["status"];
};
export const approvalStatus = (w: Workflow | undefined): ApprovalStatus => ({
  brief: w?.brief?.status,
  program: w?.program.status,
});
/**
 * Room a write must keep free under the metadata limit, and the refusal when
 * it does not. With `whole`, the record must keep all of it free after the
 * write; otherwise the write must only not grow the record into it.
 */
export type MetadataReserve = {
  bytes: number;
  whole: boolean;
  refusal: string;
};
// The scope's and program's own drafting and the reviewer's decisions, which
// may use the reserve while the scope or program awaits approval.
const approvalWrites = new Set([
  "saveBrief",
  "approveBrief",
  "returnBrief",
  "saveProcedurePlan",
  "bulkPlanProcedures",
  "scopeProgramCandidates",
  "approveProgram",
  "returnProgram",
]);
const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
/**
 * Room for the reviewer's approval or return of a submission. Either adds
 * about the submitted record (`submitted`: the program's submission entry, or
 * the brief) and the approval or reason twice.
 */
const decisionRoom = (submitted: unknown) =>
  byteLength(submitted) + 2 * (500 + reasonRoom);
/**
 * The room a write must keep under the metadata limit (save() in
 * lib/engagement-repo.ts), given the approval status the engagement was
 * loaded with (`loaded`), the workflow after the write and its op:
 * - Nothing awaits approval after it: none.
 * - It starts an approval: it adopts the workflow, or takes an approved scope
 *   or program, or a submitted program, back to draft. It must leave the
 *   whole approval reserve, or it is refused and the records stay as they
 *   were.
 * - It submits the scope or program: it must leave room for the reviewer to
 *   approve or return the submission.
 * - The scope's and program's drafting and the reviewer's decisions, while no
 *   submission awaits a decision: none, so they may use the reserve.
 * - Any other write while approval is pending must not take room from the
 *   reserve (or, while a submission awaits a decision, the room kept for it
 *   if that is larger): it may not grow the record into it.
 */
export function metadataReserve(
  loaded: ApprovalStatus,
  w: Workflow | undefined,
  op: string,
): MetadataReserve | undefined {
  if (!approvalPending(w)) return undefined;
  if (
    loaded.program === undefined ||
    (loaded.brief === "approved" && w.brief?.status !== "approved") ||
    (loaded.program !== "draft" &&
      w.program.status === "draft" &&
      op !== "returnProgram")
  )
    return {
      bytes: approvalReserve,
      whole: true,
      refusal:
        "This change would need the engagement scope or audit program to be approved, but would leave less than the " +
        kb(approvalReserve) +
        " that approval needs under the engagement's " +
        mb(metadataLimit) +
        " limit. Nothing was saved, and the scope and program stay as they were. Continue in a follow-up engagement.",
    };
  const submission = (record: string, room: number, shorten: string) => ({
    bytes: room,
    whole: true,
    refusal:
      "Submitting the " +
      record +
      " now would leave too little room under the engagement's " +
      mb(metadataLimit) +
      " limit for the reviewer to approve or return it. Nothing was saved. Shorten the " +
      shorten +
      ", or continue in a follow-up engagement.",
  });
  if (op === "submitBrief" && w.brief)
    return submission(
      "scope",
      decisionRoom({ ...w.brief, history: undefined }),
      "brief",
    );
  if (op === "submitProgram")
    return submission(
      "audit program",
      decisionRoom(w.program.history.at(-1)),
      "procedure plans you changed",
    );
  if (
    approvalWrites.has(op) &&
    w.brief?.status !== "submitted" &&
    w.program.status !== "submitted"
  )
    return undefined;
  // While a submission awaits a decision, the room kept for that decision is
  // held too, should a large program's submission need more than the reserve.
  const awaiting =
    w.program.status === "submitted"
      ? decisionRoom(w.program.history.at(-1))
      : w.brief?.status === "submitted"
        ? decisionRoom({ ...w.brief, history: undefined })
        : 0;
  return {
    bytes: Math.max(approvalReserve, awaiting),
    whole: false,
    refusal:
      "The engagement record is close to its " +
      mb(metadataLimit) +
      " limit, and the room left is kept for approving the engagement scope and audit program. Nothing was saved. Save this again once they are approved, or continue in a follow-up engagement.",
  };
}
/**
 * A warning once the stored engagement record (`bytes`, as last saved) comes
 * close to the metadata limit.
 */
export function metadataWarning(
  w: Workflow | undefined,
  bytes: number | null | undefined,
) {
  if (!w || bytes == null || metadataLimit - bytes > metadataWarningLevel)
    return undefined;
  const used =
    "The engagement record uses " +
    (bytes / 1_000_000).toFixed(2) +
    " MB of its " +
    mb(metadataLimit) +
    " limit. ";
  return {
    id: "metadata",
    title: "Engagement record",
    message:
      used +
      (metadataLimit - bytes >= approvalReserve
        ? "Once less than " +
          kb(approvalReserve) +
          " is left, a change that needs the scope or audit program approved again is refused, so that every approval started can be completed."
        : approvalPending(w)
          ? "The room left is kept for approving the scope and audit program: until they are approved, other changes that need more room are refused."
          : "Less than the " +
            kb(approvalReserve) +
            " an approval needs is left, so a change that needs the scope or audit program approved again is refused. Continue such changes in a follow-up engagement."),
  };
}
/**
 * The brief, program and procedures close to or at their history limit, and
 * the engagement record close to its metadata limit (`metadataBytes`, the
 * stored size when known).
 */
export function revisionWarnings(
  w: Workflow | undefined,
  metadataBytes?: number | null,
) {
  const warnings: {
    id: string;
    recordId?: string;
    title: string;
    message: string;
  }[] = [];
  const metadata = metadataWarning(w, metadataBytes);
  if (metadata) warnings.push(metadata);
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
/**
 * What the structured workflow still needs: the approved scope and program
 * and, for the in-scope procedures `gated` selects (all of them for final
 * issuance), current reviewed work compiled into a signed paper. Without a
 * workflow, only final issuance asks for its adoption. lib/domain/gates.ts
 * passes the lifecycle stage scope.
 */
export function workflowRequirements(
  e: Engagement,
  final = false,
  gated: (p: Procedure) => boolean = () => final,
) {
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
  for (const p of w.procedures.filter(
    (p) =>
      p.selected &&
      ["applicable", "readiness"].includes(p.applicability) &&
      p.stage !== "Remediation and Monitoring" &&
      gated(p),
  )) {
    if (p.state !== "reviewed" || !currentExecution(e, p) || !p.review)
      gates.push({
        id: p.id,
        recordId: p.id,
        title: p.title,
        message:
          p.templateId + ": current execution and independent review required",
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
          message: p.templateId + ": sign the procedure working-paper revision",
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
  if (isReleaseTimeRecord(p.templateId)) return "Recorded at release";
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
