import { jobs, records } from "../assurance-store";
import { db } from "../bindings";
import { getEngagement } from "../engagement-repo";
import { ApiError } from "../http";
import type { Context } from "../tenancy";
import { isClientRole } from "../workflow-state";
/**
 * What the assurance workbench loads for an internal member: the engagement's
 * assurance records and external jobs, its enrolled workers and access grants,
 * the members a Lead Auditor may grant access to, what the platform can and
 * cannot attest, and the external queue's telemetry. Client roles are refused.
 */
export async function assuranceView(ctx: Context, engagementId: string) {
  const e = await getEngagement(ctx, engagementId);
  if (isClientRole(ctx.role))
    throw new ApiError(403, "The assurance workbench is internal");
  const all = await records(ctx, e.id),
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
    records: all,
    jobs: await jobs(ctx, e.id),
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
      queued: (await jobs(ctx, e.id)).filter((j) => j.state === "queued")
        .length,
      stalled: (await jobs(ctx, e.id)).filter(
        (j) =>
          j.state === "running" &&
          Date.parse(String(j.lease_until)) < Date.now(),
      ).length,
    },
  };
}
