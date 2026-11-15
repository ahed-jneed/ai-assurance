// What the workspace's quality review needs from the server's stores (#244
// items 1 and 2), for internal members: the appointed reviewer's standing,
// which disables Release with the refusal release would answer, and for a
// Lead Auditor every member the reviewer picker lists, each with the
// refusal appointQualityReviewer would answer them with.
import type { QualityReviewerStanding } from "../domain/quality-review";
import type { Engagement } from "../domain/types";
import { now } from "../ids";
import { can, canBeAssigned } from "../permissions";
import {
  appointmentRefusal,
  clientEngagements,
  reviewerStanding,
} from "../quality-review-records";
import type { Context } from "../tenancy";
import { isInternalRole } from "../workflow-state";

export type QualityReviewView = {
  standing: QualityReviewerStanding | null;
  /**
   * The active members with the reviewer role and access to the engagement,
   * except the appointed reviewer, with why the server refuses each (null
   * when eligible). Empty for anyone who may not appoint.
   */
  candidates: { user_id: string; refusal: string | null }[];
};

export async function qualityReviewView(
  ctx: Context,
  e: Engagement | null,
  people: readonly { user_id: string; role: string; status: string }[],
  coolingOffDays: number,
): Promise<QualityReviewView | null> {
  if (!e || !isInternalRole(ctx.role)) return null;
  const standing = await reviewerStanding(ctx, e);
  if (!can(ctx.role, "appointQualityReviewer"))
    return { standing, candidates: [] };
  const eligible = people.filter(
    (p) =>
      canBeAssigned(p.role, "qualityReviewer") &&
      p.status === "active" &&
      p.user_id !== e.qualityReview?.reviewerId,
  );
  if (!eligible.length) return { standing, candidates: [] };
  const others = await clientEngagements(ctx, e),
    at = now(),
    candidates = [];
  for (const p of eligible) {
    const refused = await appointmentRefusal(
      ctx,
      e,
      p.user_id,
      coolingOffDays,
      at,
      others,
    );
    candidates.push({ user_id: p.user_id, refusal: refused?.message ?? null });
  }
  return { standing, candidates };
}
