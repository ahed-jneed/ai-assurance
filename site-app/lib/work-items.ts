import type { Engagement, Role } from "./domain";
import {
  checklistProblem,
  qualityReviewSignedOff,
} from "./domain/quality-review";
import { isReleaseTimeRecord } from "./domain/release-time";
import { currentExecution } from "./workflow-state";
import { stagePaperQueue } from "./auditor-workflow";
import { paperNextAction } from "./paper-workflow";
import { paperRegisterRow } from "./paper-presentation";
import { localWorkDay } from "./work-inbox";

export type WorkItem = {
  id: string;
  engagementId: string;
  engagement: string;
  client: string;
  kind:
    | "scope"
    | "program"
    | "procedure"
    | "paper"
    | "request"
    | "finding"
    | "report"
    | "monitoring";
  recordId: string;
  module: string;
  section?: string;
  title: string;
  action: string;
  reason: string;
  ownerId: string;
  dueDate: string;
  state: "ready" | "waiting" | "review" | "planning";
  priority: number;
  personal: boolean;
};
export function procedureRequests(e: Engagement, procedureId: string) {
  const p = e.workflow?.procedures.find((p) => p.id === procedureId);
  return (e.evidenceRequests ?? []).filter(
    (r) => p?.paperId && r.paperIds.includes(p.paperId),
  );
}
export function procedureWork(
  e: Engagement,
  id: string,
  today = localWorkDay(),
) {
  const p = e.workflow?.procedures.find((p) => p.id === id);
  if (!p) return null;
  const requests = procedureRequests(e, id),
    outstanding = requests.filter(
      (r) => !["accepted", "waived"].includes(r.status),
    );
  const paper = e.papers.find((q) => q.id === p.paperId);
  const current = !!p.execution && currentExecution(e, p);
  const approved =
    e.workflow?.brief?.status === "approved" &&
    e.workflow.program.status === "approved" &&
    e.workflow.program.briefRevision === e.workflow.brief.revision;
  const compiled =
    !!paper &&
    p.paperRevision !== undefined &&
    paper.revision === p.paperRevision;
  const reviewed =
    !!p.review &&
    p.review.revision === p.revision &&
    p.review.userId === p.reviewerId &&
    !p.contributors.includes(p.review.userId) &&
    !!paper &&
    paper.authorId !== p.review.userId &&
    !paper.contributors.includes(p.review.userId) &&
    paper.reviews.some(
      (r) => r.revision === paper.revision && r.userId === p.review!.userId,
    );
  const accepted =
    !!p.execution?.evidenceIds.length &&
    p.execution.evidenceIds.every((id) =>
      e.artifacts.some((a) => a.id === id && a.status === "accepted"),
    );
  const corrections =
    paper?.comments.some((c) => !c.resolved) ||
    (p.state === "evaluated" && !!p.history.at(-1)?.review);
  const complete =
    approved &&
    current &&
    compiled &&
    reviewed &&
    accepted &&
    !outstanding.length &&
    !paper?.comments.some((c) => !c.resolved) &&
    p.state === "reviewed" &&
    paper?.status === "signed";
  // WP-RP-02 and MEM-SO-01 are recorded when the final package is approved
  // and released, never executed here: no execution work is due, ready,
  // waiting or overdue for them.
  const releaseTime = isReleaseTimeRecord(p.templateId);
  return {
    p,
    requests,
    outstanding,
    paper,
    current,
    approved,
    compiled,
    reviewed,
    accepted,
    complete,
    releaseTime,
    corrections: !releaseTime && corrections,
    overdue: !releaseTime && !!p.dueDate && p.dueDate < today && !complete,
    readyToEvaluate:
      !releaseTime &&
      approved &&
      current &&
      accepted &&
      p.state === "executed" &&
      !outstanding.length,
    waiting:
      !releaseTime &&
      (outstanding.length > 0 ||
        !approved ||
        (!current && (!!p.execution || p.state !== "planned")) ||
        (!!p.execution && !accepted) ||
        (p.state === "submitted" &&
          (!compiled || paper?.status !== "in_review")) ||
        (p.state === "reviewed" &&
          (!compiled ||
            !reviewed ||
            !["reviewed", "signed"].includes(paper?.status ?? "")))),
  };
}
export function engagementWork(
  e: Engagement,
  role: Role,
  userId: string,
  client = "",
  today = localWorkDay(),
): WorkItem[] {
  if (["Client Viewer", "Client Contributor"].includes(role)) return [];
  const result: WorkItem[] = [],
    lead = role === "Lead Auditor",
    reviewer = ["Reviewer", "Lead Auditor"].includes(role),
    writer = ["Auditor", "Lead Auditor"].includes(role);
  const add = (
    kind: WorkItem["kind"],
    recordId: string,
    title: string,
    action: string,
    reason: string,
    module: string,
    ownerId = "",
    dueDate = "",
    state: WorkItem["state"] = "ready",
    priority = 3,
    section?: string,
    personal = ownerId === userId || (!ownerId && lead),
  ) =>
    result.push({
      id: e.id + ":" + kind + ":" + recordId,
      engagementId: e.id,
      engagement: e.title,
      client,
      kind,
      recordId,
      title,
      action,
      reason,
      module,
      ownerId,
      dueDate,
      state,
      priority,
      section,
      personal,
    });
  const w = e.workflow,
    b = w?.brief;
  if (w) {
    if (!b || b.status === "draft")
      add(
        "scope",
        "brief",
        "Engagement scope",
        "Complete scope",
        b
          ? "Record the current scope and submit for independent review."
          : "Establish the system boundary and audit mandate.",
        "Audit program",
        b?.updatedBy ?? w.adoptedBy,
        e.dueDate,
        "planning",
        1,
        "brief",
        writer && (lead || b?.updatedBy === userId || !b),
      );
    else if (b.status === "submitted")
      add(
        "scope",
        "brief",
        "Scope approval",
        "Review scope",
        "The exact submitted scope needs independent approval.",
        "Audit program",
        "",
        e.dueDate,
        "review",
        1,
        "brief",
        reviewer && !b.contributors.includes(userId),
      );
    if (
      w.program.status !== "approved" ||
      w.program.briefRevision !== b?.revision
    ) {
      const currentScope =
        b?.status === "approved" && w.program.briefRevision === b.revision;
      const submitted = w.program.status === "submitted";
      add(
        "program",
        "program",
        "Audit program",
        submitted && currentScope
          ? "Review program"
          : w.program.status === "approved"
            ? "Reassess audit program"
            : "Plan & assign procedures",
        submitted && currentScope
          ? "Approve the selected criteria and procedure revisions."
          : !currentScope
            ? "Bind the audit program to the current approved scope before independent approval."
            : "Resolve applicability, assignments and audit criteria.",
        "Audit program",
        submitted ? "" : w.program.updatedBy,
        e.dueDate,
        submitted && !currentScope
          ? "waiting"
          : submitted
            ? "review"
            : "planning",
        1,
        "program",
        submitted
          ? reviewer && !w.program.contributors.includes(userId)
          : writer && (lead || w.program.updatedBy === userId),
      );
    }
    for (const p of w.procedures.filter(
      (p) => p.selected && p.applicability !== "not_applicable",
    )) {
      const x = procedureWork(e, p.id, today)!;
      if (x.complete) continue;
      let action = "Record work performed",
        reason = "Carry out the approved procedure.",
        section = "execute",
        state: WorkItem["state"] = "ready",
        owner = p.ownerId,
        personal = writer && (p.ownerId === userId || (lead && !p.ownerId));
      const conflictingPaperReviewer =
        x.compiled &&
        ["submitted", "reviewed"].includes(p.state) &&
        !!x.paper &&
        (x.paper.authorId === p.reviewerId ||
          x.paper.contributors.includes(p.reviewerId));
      if (
        !p.ownerId ||
        !p.reviewerId ||
        p.ownerId === p.reviewerId ||
        p.contributors.includes(p.reviewerId) ||
        conflictingPaperReviewer ||
        p.applicability === "pending"
      ) {
        action = "Complete procedure plan";
        reason = "Assign eligible preparer/reviewer and resolve applicability.";
        section = "plan";
        state = "planning";
        personal = writer && lead;
      } else if (x.releaseTime) {
        // Program submission still asks for its assignment and deadline
        // (above); once planned, approving and releasing the final package
        // records it, so the server refuses execution and no task is due.
        continue;
      } else if (!x.approved) {
        action = "Open procedure plan";
        reason =
          "Waiting for scope approval and an audit program bound to its current revision.";
        section = "plan";
        state = "waiting";
      } else if (
        (p.execution && !x.current) ||
        (!p.execution && p.state !== "planned")
      ) {
        action = "Assess changed scope";
        reason = p.execution
          ? "The previous execution no longer matches the current approved plan."
          : "Record current execution before evaluation, review or sign-off.";
        section = "execute";
        state = "waiting";
      } else if (x.paper?.comments.some((c) => !c.resolved)) {
        const comments = x.paper.comments.filter((c) => !c.resolved),
          own = comments.filter((c) => c.authorId === userId),
          response = own.some((c) => c.responses?.length);
        const row = paperRegisterRow(x.paper, e, role, userId, today);
        add(
          "paper",
          x.paper.id,
          p.title,
          row.label,
          row.reason,
          "Working papers",
          own.length ? userId : p.ownerId,
          p.dueDate,
          own.length
            ? response
              ? "review"
              : "waiting"
            : writer
              ? "ready"
              : "waiting",
          x.overdue ? 0 : 2,
          "review",
          own.length > 0 || (writer && (p.ownerId === userId || lead)),
        );
        continue;
      } else if (x.outstanding.length) {
        action = "Follow up evidence";
        reason =
          x.outstanding.length + " evidence request(s) remain unresolved.";
        section = "execute";
        state = "waiting";
      } else if (p.execution && !x.accepted) {
        action = "Verify execution evidence";
        reason =
          "The recorded execution needs accepted evidence from this engagement.";
        section = "execute";
        state = "waiting";
      } else if (p.state === "submitted") {
        const row = x.paper
          ? paperRegisterRow(x.paper, e, role, userId, today)
          : undefined;
        const eligible = !!row?.reviewable;
        const independent =
          reviewer &&
          p.reviewerId === userId &&
          !p.contributors.includes(userId) &&
          !!x.paper &&
          x.paper.authorId !== userId &&
          !x.paper.contributors.includes(userId);
        const valid = x.compiled && x.paper?.status === "in_review";
        action = valid ? "Review submitted work" : "Inspect submitted revision";
        reason = valid
          ? "The assigned independent reviewer assesses the current execution, evidence and compiled revision."
          : "The source procedure and working paper do not match the submitted revision.";
        section = "review";
        state = valid ? "review" : "waiting";
        owner = p.reviewerId;
        personal = valid ? eligible : independent;
      } else if (p.state === "reviewed") {
        const next = x.paper
          ? paperNextAction({
              paper: x.paper,
              artifacts: e.artifacts,
              role,
              userId,
            })
          : undefined;
        const valid =
          x.compiled && x.reviewed && x.paper?.status === "reviewed";
        const eligible = valid && next?.op === "signPaper" && next.enabled;
        action = eligible
          ? "Sign reviewed paper"
          : valid
            ? "Await independent sign-off"
            : "Reassess independent review";
        reason = valid
          ? (next?.reason ??
            "The reviewed revision needs independent Lead sign-off.")
          : "Review metadata and the compiled working-paper revision need reconciliation before sign-off.";
        section = "review";
        state = eligible ? "ready" : "waiting";
        owner = "";
        personal = eligible || (!valid && lead);
      } else if (
        p.state === "executed" ||
        (p.state === "evaluated" && !p.execution?.assessment)
      ) {
        action = "Evaluate evidence";
        reason = "Assess relevance, reliability, coverage and contradictions.";
        section = "evaluate";
      } else if (p.state === "evaluated") {
        action = "Send for review";
        reason = "Compile the evaluated work and submit its exact revision.";
        section = "evaluate";
      }
      add(
        "procedure",
        p.id,
        p.title,
        action,
        reason,
        "Audit program",
        owner,
        p.dueDate,
        state,
        x.overdue ? 0 : 2,
        section,
        personal,
      );
    }
    for (const c of w.monitoring.filter((c) => c.state !== "closed"))
      add(
        "monitoring",
        c.id,
        c.title,
        c.decision === "reassessment_required"
          ? "Open follow-up engagement"
          : "Assess follow-up",
        c.description,
        "Audit program",
        c.ownerId,
        c.dueDate,
        "ready",
        2,
        "followup",
        writer && (c.ownerId === userId || lead),
      );
  }
  const bound = new Set(w?.procedures.map((p) => p.paperId).filter(Boolean));
  const q = stagePaperQueue(e, role, userId);
  for (const item of [...q.active, ...q.waiting].filter(
    (i) => !bound.has(i.paper.id),
  )) {
    const comments = item.paper.comments.filter((c) => !c.resolved),
      own = comments.filter((c) => c.authorId === userId),
      response = own.some((c) => c.responses?.length);
    const row = paperRegisterRow(item.paper, e, role, userId, today);
    add(
      "paper",
      item.paper.id,
      item.paper.title,
      row.label,
      row.reason,
      "Working papers",
      own.length ? userId : item.paper.authorId,
      e.dueDate,
      own.length
        ? response
          ? "review"
          : "waiting"
        : q.waiting.includes(item)
          ? "waiting"
          : item.target === "review"
            ? "review"
            : "ready",
      3,
      comments.length ? "review" : item.target,
      q.active.includes(item) || own.length > 0,
    );
  }
  for (const r of (e.evidenceRequests ?? []).filter(
    (r) => !["accepted", "waived"].includes(r.status),
  ))
    add(
      "request",
      r.id,
      r.subject,
      r.status === "submitted"
        ? "Assess received package"
        : r.status === "returned"
          ? "Review follow-up"
          : "Follow up evidence",
      r.status === "submitted"
        ? "Receipt and evidential sufficiency require separate decisions."
        : "Responsible party: " + r.responsibleParty,
      "Evidence vault",
      r.createdBy,
      r.dueDate,
      r.status === "submitted" ? "ready" : "waiting",
      2,
      "requests",
      writer && (r.createdBy === userId || lead),
    );
  for (const f of e.findings.filter((f) => f.status !== "closed"))
    add(
      "finding",
      f.id,
      f.title,
      f.status === "ready_for_retest"
        ? "Retest remediation"
        : "Review remediation",
      f.status === "ready_for_retest"
        ? "Verify fresh evidence and record the independent retest."
        : "Accountable party: " + f.owner,
      "Findings",
      f.createdBy,
      f.dueDate,
      "ready",
      ["High", "Critical"].includes(f.severity) ? 0 : 3,
      undefined,
      f.status === "ready_for_retest"
        ? reviewer && userId !== f.remediationBy && userId !== f.createdBy
        : writer && (lead || f.createdBy === userId),
    );
  for (const r of e.reports.filter(
    (r) =>
      r.kind === "final" &&
      (!r.release || ["internal", "approved"].includes(r.release.state)),
  )) {
    const approved = r.release?.state === "approved",
      eligible = approved
        ? lead && r.release?.approval?.userId !== userId
        : reviewer && r.actor !== userId && !!r.snapshot.workflow;
    add(
      "report",
      r.id,
      "Final report package",
      eligible
        ? approved
          ? "Authorize client release"
          : "Approve captured package"
        : "View package dependency",
      approved
        ? "Client release requires a Lead Auditor other than the package approver."
        : r.snapshot.workflow
          ? "The captured package needs independent approval."
          : "A current package capturing the approved scope and program is required.",
      "Reports & sign-off",
      "",
      e.dueDate,
      eligible ? "review" : "waiting",
      1,
      undefined,
      eligible,
    );
  }
  // The engagement quality review is the appointed reviewer's own work, and
  // the only work an Engagement Quality Reviewer sees: they change nothing else.
  const eqr = e.qualityReview;
  if (role === "Engagement Quality Reviewer") result.length = 0;
  if (
    eqr &&
    role === "Engagement Quality Reviewer" &&
    eqr.reviewerId === userId
  ) {
    const problem = checklistProblem(eqr),
      unsigned = e.reports.filter(
        (r) =>
          r.kind === "final" &&
          (!r.release || ["internal", "approved"].includes(r.release.state)) &&
          !qualityReviewSignedOff(eqr, r),
      );
    if (problem || unsigned.length)
      add(
        "report",
        problem ? "quality-review" : unsigned[0].id,
        "Engagement quality review",
        problem
          ? "Complete the stand-back checklist"
          : "Sign off final package",
        problem ||
          "The captured final package needs your quality review sign-off before release.",
        "Reports & sign-off",
        userId,
        e.dueDate,
        "review",
        1,
        "quality",
      );
  }
  return result;
}
export function orderWork(items: WorkItem[], today = localWorkDay()) {
  return [...items].sort(
    (a, b) =>
      Number(!!b.dueDate && b.dueDate < today) -
        Number(!!a.dueDate && a.dueDate < today) ||
      a.priority - b.priority ||
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
      a.title.localeCompare(b.title),
  );
}
