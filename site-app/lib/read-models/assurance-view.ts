import {
  queueStates,
  recordContext,
  reviewQueuePage,
  reviewQueueSummary,
  searchRecords,
  type QueueState,
} from "../assurance-search";
import {
  compiledJobIds,
  jobs,
  jobTelemetry,
  recordKindCounts,
  recordPage,
} from "../assurance-store";
import { db } from "../bindings";
import { loadEngagement } from "../engagement-repo";
import { ApiError } from "../http";
import { assignableRoles } from "../permissions";
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
 * What the assurance workbench loads for an internal member. It returns no
 * records: only how many the engagement holds in all and of each kind, its
 * 100 most recent external
 * jobs (each marked when already compiled into a draft paper), enrolled
 * workers and access grants, the members a Lead Auditor may grant access to
 * (every active staff member, the Engagement Quality Reviewer included),
 * the caller's review queue (counts and the next assessment of each), what
 * the platform can and cannot attest, and the external queue's telemetry over
 * every job. Client roles are refused. The workbench reads records by search,
 * by kind and by id from here on; it never loads all of them.
 */
export async function assuranceView(ctx: Context, engagementId: string) {
  const e = await internalEngagement(ctx, engagementId),
    [recent, compiled, telemetry, kindCounts] = await Promise.all([
      jobs(ctx, e.id),
      compiledJobIds(ctx, e.id),
      jobTelemetry(ctx, e.id),
      recordKindCounts(ctx, e.id),
    ]),
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
    total: Object.values(kindCounts).reduce((sum, n) => sum + n, 0),
    kindCounts,
    queue: await reviewQueueSummary(ctx, e.id),
    jobs: recent.map((j) => ({
      ...j,
      compiled: compiled.includes(String(j.id)),
    })),
    workers,
    access,
    eligibleMembers:
      ctx.role === "Lead Auditor"
        ? (
            await db()
              .prepare(
                "SELECT user_id,display_name,role FROM memberships WHERE tenant_id=? AND status='active' AND role IN (SELECT value FROM json_each(?))",
              )
              .bind(
                ctx.tenantId,
                JSON.stringify(assignableRoles.engagementAccess),
              )
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
        "Application Ed25519 signing; practice keys wrapped at rest, independent trust pin required",
      anchor: "External timestamp anchor not configured",
    },
    telemetry,
  };
}
/**
 * One page of the engagement's assurance records, optionally of one kind:
 * `{ records, nextCursor }`, from the first page or after `cursor`. The
 * workbench pages through the few kinds its forms and planner offer (systems,
 * predictions, dataset cards, obligation assessments).
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
/** One record with its review state and the records its details read. */
export async function assuranceRecord(
  ctx: Context,
  engagementId: string,
  recordId: string,
) {
  const e = await internalEngagement(ctx, engagementId);
  if (!recordId) throw new ApiError(400, "Name the assurance record");
  return recordContext(ctx, e.id, recordId);
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
