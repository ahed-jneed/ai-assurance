import {
  queueStates,
  reviewQueuePage,
  reviewQueueSummary,
  searchRecords,
  type QueueState,
} from "../assurance-search";
import { jobs, recordCount, recordPage } from "../assurance-store";
import { db } from "../bindings";
import { loadEngagement } from "../engagement-repo";
import { ApiError } from "../http";
import type { Context } from "../tenancy";
import { isClientRole } from "../workflow-state";
// Client roles never read the assurance workbench. The workbench needs the
// engagement's access and id only, so its R2 parts are never loaded here.
async function internalEngagement(ctx: Context, engagementId: string) {
  const e = await loadEngagement(ctx, engagementId);
  if (isClientRole(ctx.role))
    throw new ApiError(403, "The assurance workbench is internal");
  return e;
}
/**
 * What the assurance workbench loads for an internal member: the first page of
 * the engagement's assurance records (with their total and the cursor of the
 * next page), its external jobs, enrolled workers and access grants, the
 * members a Lead Auditor may grant access to, the caller's review queue
 * (counts and the next assessment of each), what the platform can and cannot
 * attest, and the external queue's telemetry. Client roles are refused.
 */
export async function assuranceView(ctx: Context, engagementId: string) {
  const e = await internalEngagement(ctx, engagementId),
    recent = await jobs(ctx, e.id),
    workers = (
      await db()
        .prepare(
          "SELECT id,name,image_digest,capabilities,active,created_at,last_seen FROM runner_workers WHERE tenant_id=? AND engagement_id=?",
        )
        .bind(ctx.tenantId, e.id)
        .all()
    ).results,
    access = (
      await db()
        .prepare(
          "SELECT a.user_id,a.active,a.updated_at,m.display_name,m.role,m.status FROM engagement_access a JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id WHERE a.tenant_id=? AND a.engagement_id=?",
        )
        .bind(ctx.tenantId, e.id)
        .all()
    ).results;
  return {
    ...(await recordPage(ctx, e.id)),
    total: await recordCount(ctx, e.id),
    queue: await reviewQueueSummary(ctx, e.id),
    jobs: recent,
    workers,
    access,
    eligibleMembers:
      ctx.role === "Lead Auditor"
        ? (
            await db()
              .prepare(
                "SELECT user_id,display_name,role FROM memberships WHERE tenant_id=? AND status='active' AND role IN ('Lead Auditor','Auditor','Reviewer')",
              )
              .bind(ctx.tenantId)
              .all()
          ).results
        : [],
    practiceAdmin: ctx.practiceAdmin,
    capabilities: {
      hosted:
        "Saved predictions, exact source citations and deterministic sampling ≤1 MB / 10,000 rows",
      external: "Requires an enrolled worker with validated local adapters",
      assistant:
        "Cited source assistant available; generative provider not configured",
      signing:
        "Application Ed25519 signing; server-held practice keys, independent trust pin required",
      anchor: "External timestamp anchor not configured",
    },
    telemetry: {
      queued: recent.filter((j) => j.state === "queued").length,
      stalled: recent.filter(
        (j) =>
          j.state === "running" &&
          Date.parse(String(j.lease_until)) < Date.now(),
      ).length,
    },
  };
}
/**
 * One page of the engagement's assurance records, optionally of one kind:
 * `{ records, nextCursor }`. The workbench follows `nextCursor` from its first
 * page; views that need one kind of record page through that kind only.
 */
export async function assuranceRecordPage(
  ctx: Context,
  engagementId: string,
  options: { kind?: string; cursor?: string },
) {
  const e = await internalEngagement(ctx, engagementId);
  return recordPage(ctx, e.id, options);
}
/**
 * One page of the engagement's records that match a search (kinds, text and
 * review state), each with its review state, and on the first page how many
 * match in all. Covers every record, not only those a browser has loaded.
 */
export async function assuranceSearch(
  ctx: Context,
  engagementId: string,
  options: {
    kinds?: string[];
    term?: string;
    review?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const e = await internalEngagement(ctx, engagementId);
  return searchRecords(ctx, e.id, options);
}
/**
 * The caller's review queue: without `state` its summary, with `state` one
 * page of the assessments in that part of the queue.
 */
export async function assuranceReviewQueue(
  ctx: Context,
  engagementId: string,
  options: { state?: string; cursor?: string; limit?: number },
) {
  const e = await internalEngagement(ctx, engagementId);
  if (!options.state) return reviewQueueSummary(ctx, e.id);
  if (!queueStates.includes(options.state as QueueState))
    throw new ApiError(400, "Invalid review queue");
  return reviewQueuePage(ctx, e.id, options.state as QueueState, options);
}
