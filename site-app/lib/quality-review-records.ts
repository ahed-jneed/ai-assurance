// Team work recorded outside the engagement record, for the engagement quality
// reviewer's independence (lib/domain/quality-review.ts): every command on an
// engagement leaves an audit event with its actor, and assurance records
// (observations, test executions, attestations) carry theirs. Anyone who did
// either on an engagement is on its team, whatever the engagement record
// itself still shows. Only the reviewer's own checklist saves and sign-offs
// are not team work; appointing a reviewer is a Lead's act and counts.
import { db } from "./bindings";
import type { Engagement } from "./domain";
import { coolingOffConflicts, engagementTeam } from "./domain/quality-review";
import { ApiError } from "./http";
import type { Context } from "./tenancy";

const reviewerOps = ["saveQualityReview", "signOffQualityReview"];

/**
 * The user's latest recorded work on each of the client's engagements, from
 * the audit events and assurance records: engagement id to timestamp.
 */
export async function recordedInvolvement(
  tenantId: string,
  clientId: string,
  userId: string,
) {
  const rows = (
    await db()
      .prepare(
        "SELECT engagement_id AS id, MAX(created_at) AS last FROM (" +
          "SELECT engagement_id, created_at FROM audit_events WHERE tenant_id=? AND actor=? AND action NOT IN (" +
          reviewerOps.map(() => "?").join(",") +
          ") UNION ALL SELECT engagement_id, created_at FROM assurance_records WHERE tenant_id=? AND actor=?" +
          ") WHERE engagement_id IN (SELECT id FROM engagements WHERE tenant_id=? AND client_id=?) GROUP BY engagement_id",
      )
      .bind(
        tenantId,
        userId,
        ...reviewerOps,
        tenantId,
        userId,
        tenantId,
        clientId,
      )
      .all<{ id: string; last: string }>()
  ).results;
  return new Map(rows.map((r) => [r.id, r.last]));
}

const teamMessage =
  "The engagement quality reviewer is on the engagement team; appoint an eligible reviewer";

/**
 * Whether the user is on this engagement's team, by the engagement record or
 * by recorded work.
 */
export async function onRecordedTeam(
  ctx: Context,
  e: Engagement,
  userId: string,
) {
  if (engagementTeam(e).has(userId)) return true;
  return (await recordedInvolvement(ctx.tenantId, e.clientId, userId)).has(
    e.id,
  );
}

/**
 * Refuses capture or release while the appointed reviewer's recorded work
 * puts them on the engagement team. The pure gates cover the engagement
 * record; this covers the audit events and assurance records.
 */
export async function assertReviewerIndependent(ctx: Context, e: Engagement) {
  const q = e.qualityReview;
  if (q && (await onRecordedTeam(ctx, e, q.reviewerId)))
    throw new ApiError(409, teamMessage);
}

/**
 * The client's other engagements on whose team the user served within the
 * cooling-off period before `at`, by the engagement records and by recorded
 * work, whichever is later.
 */
export async function recordedCoolingOffConflicts(
  ctx: Context,
  e: Engagement,
  others: readonly Engagement[],
  userId: string,
  coolingOffDays: number,
  at: string,
) {
  const recorded = await recordedInvolvement(ctx.tenantId, e.clientId, userId);
  recorded.delete(e.id);
  const byRecord = coolingOffConflicts(others, userId, coolingOffDays, at);
  const since = new Date(Date.parse(at) - coolingOffDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const conflicts = new Map(byRecord.map((c) => [c.id, c]));
  for (const [id, last] of recorded) {
    if (last.slice(0, 10) < since) continue;
    const seen = conflicts.get(id);
    if (!seen || last > seen.last)
      conflicts.set(id, {
        id,
        title: others.find((o) => o.id === id)?.title ?? id,
        last,
      });
  }
  return [...conflicts.values()].sort((a, b) => a.id.localeCompare(b.id));
}
