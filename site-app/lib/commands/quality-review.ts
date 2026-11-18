import { z } from "../zod";
import type { Engagement } from "../domain/types";
import {
  checklistItemIds,
  checklistProblem,
  qualityReviewerRole,
  type QualityReview,
} from "../domain/quality-review";
import { db } from "../bindings";
import { now } from "../ids";
import { ApiError } from "../http";
import { canBeAssigned } from "../permissions";
import { appointmentRefusal, onRecordedTeam } from "../quality-review-records";
import { qualityReviewPolicy } from "../quality-review-policy";
import type { Context } from "../tenancy";
import { releaseState } from "../workflow-state";
import { defineCommands } from "./command";
import { short, text } from "./fields";

/** The appointed reviewer's quality review, for the reviewer's own commands. */
async function ownReview(e: Engagement, ctx: Context) {
  const q = e.qualityReview;
  if (!q)
    throw new ApiError(409, "No engagement quality reviewer is appointed");
  if (q.reviewerId !== ctx.user.userId)
    throw new ApiError(
      403,
      "Only the appointed engagement quality reviewer can record this review",
    );
  if (await onRecordedTeam(ctx, e, q.reviewerId))
    throw new ApiError(
      409,
      "You are on the engagement team and cannot act as its quality reviewer",
    );
  return q;
}

/**
 * The engagement quality review (ISQM 2, lib/domain/quality-review.ts): a
 * Lead Auditor appoints an eligible Engagement Quality Reviewer, who records
 * the stand-back checklist and signs off the exact final package. The
 * reviewer reads the engagement but cannot change any of its work.
 */
export const qualityReview = defineCommands({
  appointQualityReviewer: {
    roles: ["Lead Auditor"],
    async handle(e, d, ctx) {
      const a = z.object({ userId: short, reason: text }).strict().parse(d);
      if (e.qualityReview?.reviewerId === a.userId)
        throw new ApiError(409, "This reviewer is already appointed");
      const member = await db()
        .prepare(
          "SELECT m.role,m.status,m.display_name,EXISTS(SELECT 1 FROM engagement_access x WHERE x.tenant_id=m.tenant_id AND x.user_id=m.user_id AND x.engagement_id=? AND x.active=1) AS access FROM memberships m WHERE m.tenant_id=? AND m.user_id=?",
        )
        .bind(e.id, ctx.tenantId, a.userId)
        .first<{
          role: string;
          status: string;
          display_name: string | null;
          access: number;
        }>();
      // The same rule the browser's reviewer picker applies
      // (app/quality-review-panel.tsx): lib/permissions.ts assignableRoles.
      if (
        !member ||
        member.status !== "active" ||
        !canBeAssigned(member.role, "qualityReviewer")
      )
        throw new ApiError(
          400,
          "Select an active member with the Engagement Quality Reviewer role",
        );
      if (!member.access)
        throw new ApiError(
          400,
          "Grant the reviewer access to this engagement in Users & access first",
        );
      const days = (await qualityReviewPolicy(ctx.tenantId)).coolingOffDays,
        at = now();
      const refused = await appointmentRefusal(ctx, e, a.userId, days, at);
      if (refused) throw new ApiError(refused.status, refused.message);
      const previous = e.qualityReview;
      const q: QualityReview = {
        reviewerId: a.userId,
        appointedBy: ctx.user.userId,
        appointedAt: at,
        reason: a.reason,
        coolingOffDays: days,
        // A new reviewer starts their own checklist; earlier sign-offs stay
        // as history but cover nothing for the new reviewer.
        revision: (previous?.revision ?? 0) + 1,
        items: [],
        signOffs: previous?.signOffs ?? [],
        history: [
          ...(previous?.history ?? []),
          {
            action: previous ? "replace" : "appoint",
            actor: ctx.user.userId,
            at,
            reviewerId: a.userId,
            reason: a.reason,
          },
        ],
      };
      e.qualityReview = q;
      return {
        details: {
          reviewerId: a.userId,
          coolingOffDays: days,
          ...(previous && { replaces: previous.reviewerId }),
        },
      };
    },
  },
  saveQualityReview: {
    roles: [qualityReviewerRole],
    async handle(e, d, ctx) {
      const q = await ownReview(e, ctx);
      const a = z
        .object({
          items: z
            .array(
              z
                .object({
                  id: z.enum(checklistItemIds),
                  status: z.enum(["satisfied", "concern"]),
                  notes: z.string().trim().max(5000),
                })
                .strict(),
            )
            .max(checklistItemIds.length)
            .refine(
              (v) => new Set(v.map((i) => i.id)).size === v.length,
              "Answer each checklist item once",
            ),
        })
        .strict()
        .parse(d);
      const at = now();
      q.items = a.items;
      q.revision++;
      q.updatedBy = ctx.user.userId;
      q.updatedAt = at;
      q.history.push({
        action: "save",
        actor: ctx.user.userId,
        at,
        reviewerId: q.reviewerId,
        revision: q.revision,
      });
      return {
        details: {
          revision: q.revision,
          complete: !checklistProblem(q),
        },
      };
    },
  },
  signOffQualityReview: {
    roles: [qualityReviewerRole],
    async handle(e, d, ctx) {
      const q = await ownReview(e, ctx);
      const a = z
        .object({
          reportId: short,
          internalHash: short,
          clientHash: short,
          conclusion: text,
        })
        .strict()
        .parse(d);
      const r = e.reports.find((r) => r.id === a.reportId);
      if (!r) throw new ApiError(404, "Report not found");
      if (
        r.kind !== "final" ||
        !["internal", "approved"].includes(releaseState(r))
      )
        throw new ApiError(409, "Sign off an unreleased final package");
      if (r.sha256 !== a.internalHash || r.clientSha256 !== a.clientHash)
        throw new ApiError(409, "Review both exact package hashes");
      const problem = checklistProblem(q);
      if (problem) throw new ApiError(409, problem);
      const at = now();
      q.signOffs.push({
        reportId: r.id,
        internalHash: r.sha256,
        clientHash: r.clientSha256!,
        checklistRevision: q.revision,
        conclusion: a.conclusion,
        userId: ctx.user.userId,
        at,
      });
      q.history.push({
        action: "sign_off",
        actor: ctx.user.userId,
        at,
        reviewerId: q.reviewerId,
        revision: q.revision,
        reportId: r.id,
      });
      return { details: { reportId: r.id, checklistRevision: q.revision } };
    },
  },
});
