// Preconditions the server enforces and the workspace shows (#210): one
// function per decision, so a button is disabled with exactly the reason
// the server would refuse it with. Keep runtime imports to pure domain
// modules: the workspace runs them in the browser.
import { releaseRequirements } from "./domain/gates";
import {
  qualityReviewReleaseProblem,
  reviewerStandingProblem,
  type QualityReviewerStanding,
} from "./domain/quality-review";
import type { Engagement, Report } from "./domain/types";
import type { MonitoringCase } from "./workflow-types";

/** Why a decision is refused: the server's status and message. */
export type Refusal = { status: 400 | 403 | 409; message: string };

/**
 * Why `approverId` may not approve this captured package (#226 item 5):
 * approveReportPackage refuses its creator with 403 and this message, and
 * the report record sheet shows the same reason on its disabled "Approve
 * package". Null when the independence rule admits them.
 */
export function packageApprovalRefusal(
  r: Pick<Report, "actor">,
  approverId: string,
): Refusal | null {
  return r.actor === approverId
    ? { status: 403, message: "The report creator cannot approve its package" }
    : null;
}

/**
 * Why `approverId` may not approve work they prepared or contributed to
 * (#234 item 1): the workflow commands' independence check (approveBrief,
 * approveProgram, reviewProcedure, closeMonitoringCase) refuses with 403 and
 * this message, and the workspace shows the same reason on the disabled
 * "Approve scope" and "Approve program". Null when the rule admits them.
 */
export function ownWorkRefusal(
  contributors: readonly string[],
  approverId: string,
): Refusal | null {
  return contributors.includes(approverId)
    ? {
        status: 403,
        message: "A preparer or contributor cannot approve their own work",
      }
    : null;
}

export const releaseApprovalMessage =
  "A different independent approver must approve both exact packages before release";

/**
 * Why this captured final package may not be released to the client yet
 * (releaseReport refuses with 409 and this message); null when it may.
 * With `releaserId`, a Lead Auditor who approved the package cannot also
 * release it. With the appointed reviewer's `standing` (the workspace read
 * model's, from the server's stores), the release-time re-checks of the
 * Engagement Quality Reviewer apply too (#244 item 1): a reviewer revoked,
 * moved to another role or onto the team after their sign-off. The other
 * checks that need the server's stores (assurance pins, external jobs,
 * unchanged source records) run at release only.
 */
export function releaseRefusal(
  e: Engagement,
  r: Report,
  releaserId?: string,
  standing?: QualityReviewerStanding | null,
): Refusal | null {
  const approval = r.release?.approval;
  if (
    r.release?.state !== "approved" ||
    approval?.internalHash !== r.sha256 ||
    approval.clientHash !== r.clientSha256 ||
    (releaserId !== undefined && approval.userId === releaserId)
  )
    return { status: 409, message: releaseApprovalMessage };
  if (releaseRequirements(e).length)
    return {
      status: 409,
      message: "Resolve current scope/program completion before release",
    };
  const qualityReview =
    qualityReviewReleaseProblem(e, r) || reviewerStandingProblem(e, standing);
  return qualityReview ? { status: 409, message: qualityReview } : null;
}

/**
 * Why an open follow-up case may not be closed independently yet, after the
 * closer's role and independence: closeMonitoringCase
 * (lib/workflow/monitoring.ts) refuses with this status and message, which
 * preconditions.test.ts compares with the command. Null when it may. A
 * closed case is never offered for closure.
 */
export function monitoringClosureRefusal(
  e: Engagement,
  m: MonitoringCase,
): Refusal | null {
  if (m.decision === "not_assessed" || !m.assessment.trim())
    return {
      status: 409,
      message: "Assess the case before independent closure",
    };
  if (m.decision === "reassessment_required") {
    if (!m.successorEngagementId)
      return {
        status: 400,
        message:
          "Open a successor engagement before closing the reassessment case",
      };
    return m.evidenceIds.length ? acceptedRefusal(e, m.evidenceIds) : null;
  }
  if (!m.evidenceIds.length)
    return {
      status: 400,
      message:
        "Record an assessment with the accepted evidence before independent closure",
    };
  return acceptedRefusal(e, m.evidenceIds);
}

function acceptedRefusal(e: Engagement, ids: string[]): Refusal | null {
  return ids.some(
    (id) => !e.artifacts.some((a) => a.id === id && a.status === "accepted"),
  )
    ? { status: 400, message: "Link accepted evidence from this engagement" }
    : null;
}
