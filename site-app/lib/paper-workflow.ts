import type { Artifact, Paper, Role } from "./domain";
import { canWrite, isReleaseTimeRecord } from "./domain";
export type PaperTarget =
  | "objective"
  | "scope"
  | "criteria"
  | "procedures"
  | "sampling"
  | "results"
  | "limitations"
  | "conclusion"
  | "conclusionStatus"
  | "evidence"
  | "review";
export type PaperAction = {
  label: string;
  op:
    | "editPaper"
    | "submitPaper"
    | "reviewPaper"
    | "signPaper"
    | "reopenPaper"
    | null;
  enabled: boolean;
  reason: string;
  target?: PaperTarget;
};
export function paperChecklist(p: Paper, artifacts: Artifact[]) {
  return [
    {
      label: "Results recorded",
      done: !!p.body.results.trim(),
      target: "results" as PaperTarget,
    },
    {
      label: "Conclusion recorded",
      done: !!p.body.conclusion.trim(),
      target: "conclusion" as PaperTarget,
    },
    {
      label: "Conclusion evaluated",
      done:
        !!p.body.conclusionStatus &&
        p.body.conclusionStatus !== "not_evaluated",
      target: "conclusionStatus" as PaperTarget,
    },
    {
      label: "Accepted evidence linked",
      done:
        !!p.evidenceIds.length &&
        p.evidenceIds.every((id) =>
          artifacts.some((a) => a.id === id && a.status === "accepted"),
        ),
      target: "evidence" as PaperTarget,
    },
  ];
}
/**
 * Why a paper is read only for good (#94): a superseded paper and a retired
 * limitation memo are history, and a release-time record (WP-RP-02,
 * MEM-SO-01) is recorded by the release. The paper editor shows it as a
 * banner; null for every paper that can still change.
 */
export function paperHistoryNotice(p: Paper): {
  kind: "superseded" | "retired" | "release_time";
  title: string;
  text: string;
} | null {
  const day = (iso?: string) => (iso ? " on " + iso.slice(0, 10) : "");
  if (p.supersededBy)
    return {
      kind: "superseded",
      title: "Superseded paper",
      text:
        "Superseded by " +
        p.supersededBy +
        day(p.supersededAt) +
        ". This revision is kept as history and can no longer change; the paper that replaced it carries the current work.",
    };
  if (p.retired)
    return {
      kind: "retired",
      title: "Retired memo",
      text:
        "Retired" +
        day(p.retired.at) +
        ": its evidence request " +
        p.retired.requestId +
        " was reopened (" +
        p.retired.reason +
        "). It is kept as history and can no longer change; closing the request again revises this memo.",
    };
  if (isReleaseTimeRecord(p.templateId))
    return {
      kind: "release_time",
      title: "Recorded at release",
      text:
        p.templateId +
        " is recorded when the final package is approved and released, against both package hashes. It is not prepared, submitted or signed here.",
    };
  return null;
}
export function paperNextAction({
  paper: p,
  saved = p,
  artifacts,
  role,
  userId,
  dirty = false,
  pendingComment = false,
}: {
  paper: Paper;
  saved?: Paper;
  artifacts: Artifact[];
  role: Role;
  userId: string;
  dirty?: boolean;
  pendingComment?: boolean;
}): PaperAction {
  const writer = canWrite(role),
    lead = role === "Lead Auditor",
    reviewer = lead || role === "Reviewer";
  // The server refuses every change to these papers, so none is offered.
  const notice = paperHistoryNotice(saved);
  if (notice)
    return {
      label: notice.title,
      op: null,
      enabled: false,
      reason: notice.text,
    };
  if (dirty && writer && p.status !== "signed") {
    const supplementary =
      !saved.required &&
      saved.body.conclusionStatus !== "not_applicable" &&
      p.body.conclusionStatus !== "not_applicable";
    if (!p.required && !supplementary) {
      if (!lead)
        return {
          label: "Save revision",
          op: "editPaper",
          enabled: false,
          reason: "A Lead Auditor must approve this applicability exclusion.",
          target: "conclusionStatus",
        };
      if (
        p.body.conclusionStatus !== "not_applicable" ||
        !p.body.conclusion.trim() ||
        !p.body.criteria.trim()
      )
        return {
          label: "Save revision",
          op: "editPaper",
          enabled: false,
          reason:
            "Record criteria and a reasoned not-applicable conclusion for this exclusion.",
          target: !p.body.criteria.trim()
            ? "criteria"
            : p.body.conclusionStatus !== "not_applicable"
              ? "conclusionStatus"
              : "conclusion",
        };
    }
    return {
      label: "Save revision",
      op: "editPaper",
      enabled: true,
      reason:
        p.status === "draft"
          ? "Save your changes before sending this paper for review."
          : "Saving changes returns this paper to draft and clears its approvals.",
    };
  }
  if (pendingComment)
    return {
      label: "Post your comment",
      op: null,
      enabled: false,
      reason:
        "Post or clear your unsent comment or response before moving this revision forward.",
      target: "review",
    };
  if (p.status === "signed")
    return lead
      ? {
          label: "Reopen as draft",
          op: "reopenPaper",
          enabled: true,
          reason: "This revision is signed. Reopen it to make changes.",
        }
      : {
          label: "Revision signed",
          op: null,
          enabled: false,
          reason: "This signed revision is read only.",
        };
  const unresolved = p.comments.filter((c) => !c.resolved);
  if (unresolved.length)
    return {
      label: "Review comments",
      op: null,
      enabled: false,
      reason: unresolved.some((c) => c.authorId === userId)
        ? "Confirm resolution of your open comments after checking the response."
        : "The comment authors must confirm resolution before this paper can move forward.",
      target: "review",
    };
  if (p.status === "draft") {
    if (!writer)
      return {
        label: "Await submission",
        op: null,
        enabled: false,
        reason: "An Auditor or Lead Auditor prepares and submits this draft.",
      };
    const missing = paperChecklist(p, artifacts).filter((item) => !item.done);
    return {
      label: "Submit for review",
      op: "submitPaper",
      enabled: !missing.length,
      reason: missing.length
        ? "Complete the remaining requirements before submitting."
        : "Ready for an independent reviewer.",
      target: missing[0]?.target,
    };
  }
  if (p.status === "in_review") {
    const independent =
      p.authorId !== userId && !(p.contributors ?? []).includes(userId);
    if (!reviewer || !independent)
      return {
        label: "Await independent review",
        op: null,
        enabled: false,
        reason: !independent
          ? "A person who did not prepare or contribute to this paper must review it."
          : "A Reviewer or Lead Auditor must approve this revision.",
      };
    return {
      label: "Approve review",
      op: "reviewPaper",
      enabled: true,
      reason: "Check the document and evidence before approving this revision.",
    };
  }
  const validReview = p.reviews.some(
    (r) =>
      r.revision === p.revision &&
      r.userId !== p.authorId &&
      r.userId !== userId,
  );
  if (!lead)
    return {
      label: "Await sign-off",
      op: null,
      enabled: false,
      reason:
        "A Lead Auditor who did not approve the review must sign this revision.",
    };
  return {
    label: "Sign revision",
    op: "signPaper",
    enabled: validReview,
    reason: validReview
      ? "The current revision has an independent review."
      : "Another Lead Auditor must sign this revision. If its independent review is missing or obsolete, reopen the paper and submit a new revision.",
  };
}
export function personalPaperQueue(
  papers: Paper[],
  artifacts: Artifact[],
  role: Role,
  userId: string,
) {
  const actionable: {
      paper: Paper;
      label: string;
      reason: string;
      target?: PaperTarget;
    }[] = [],
    waiting: typeof actionable = [];
  for (const paper of papers) {
    const own =
        paper.authorId === userId ||
        (paper.contributors ?? []).includes(userId),
      comment = paper.comments.some(
        (c) => !c.resolved && c.authorId === userId,
      );
    const next = paperNextAction({ paper, artifacts, role, userId });
    if (comment)
      actionable.push({
        paper,
        label: "Confirm comment resolution",
        reason: next.reason,
        target: "review",
      });
    else if (paper.status === "draft" && own && canWrite(role))
      actionable.push({
        paper,
        label: next.enabled
          ? "Ready to submit"
          : {
              results: "Add results",
              conclusion: "Add conclusion",
              conclusionStatus: "Evaluate conclusion",
              evidence: "Link evidence",
              review: "Review comments",
              criteria: "Record criteria",
              objective: "Record objective",
              scope: "Define scope",
              procedures: "Record procedures",
              sampling: "Record sampling",
              limitations: "Record limitations",
            }[next.target ?? "results"],
        reason: next.reason,
        target: next.target,
      });
    else if (
      ["reviewPaper", "signPaper"].includes(next.op ?? "") &&
      next.enabled
    )
      actionable.push({
        paper,
        label:
          next.label === "Approve review" ? "Review paper" : "Ready to sign",
        reason: next.reason,
      });
    else if (own && ["in_review", "reviewed"].includes(paper.status))
      waiting.push({ paper, label: next.label, reason: next.reason });
  }
  return { actionable, waiting };
}
