import type { Report } from "@/lib/domain";
import {
  IntegrityError,
  recordIntegrityIncident,
} from "@/lib/engagement-storage";
import { integrityMessage } from "@/lib/read-models/workspace-view";
import {
  ApiError,
  context,
  db,
  getEngagement,
  requireRole,
  responseError,
} from "@/lib/store";
import { engagementWork, orderWork, type WorkItem } from "@/lib/work-items";
export const dynamic = "force-dynamic";
/**
 * The only immutable parts work items read: the snapshots of final reports
 * still awaiting approval or release (whether the package captured the
 * workflow). Everything else stays in R2.
 */
const openFinalReport = (r: Report) =>
  r.kind === "final" &&
  (!r.release || ["internal", "approved"].includes(r.release.state));
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      ctx = await context(u.searchParams.get("tenantId") ?? undefined);
    requireRole(ctx, ["Auditor", "Lead Auditor", "Reviewer"]);
    const page = Number(u.searchParams.get("page") ?? 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000)
      throw new ApiError(400, "Invalid inbox page");
    const rows = (
      await db()
        .prepare(
          "SELECT e.id,e.client_id,e.title,c.name AS client FROM engagements e JOIN clients c ON c.tenant_id=e.tenant_id AND c.id=e.client_id JOIN engagement_access a ON a.tenant_id=e.tenant_id AND a.engagement_id=e.id WHERE e.tenant_id=? AND a.user_id=? AND a.active=1 ORDER BY e.id LIMIT 26 OFFSET ?",
        )
        .bind(ctx.tenantId, ctx.user.userId, page * 25)
        .all<{ id: string; client_id: string; title: string; client: string }>()
    ).results;
    // Items that name a team member show their display name.
    const names = new Map(
      rows.length
        ? (
            await db()
              .prepare(
                "SELECT user_id,display_name FROM memberships WHERE tenant_id=?",
              )
              .bind(ctx.tenantId)
              .all<{ user_id: string; display_name: string }>()
          ).results.map((m) => [m.user_id, m.display_name])
        : [],
    );
    const nameOf = (userId: string) => names.get(userId);
    // Engagements load in parallel, each on its own: one that fails to load
    // intact is reported beside the queue instead of failing it for everyone.
    const loaded = await Promise.all(
      rows.slice(0, 25).map(async (row) => {
        try {
          const e = await getEngagement(ctx, row.id, {
            reports: openFinalReport,
          });
          return {
            items: engagementWork(
              e,
              ctx.role,
              ctx.user.userId,
              row.client,
              undefined,
              nameOf,
            ),
          };
        } catch (error) {
          if (error instanceof IntegrityError) {
            await recordIntegrityIncident(ctx, error);
            return {
              items: [] as WorkItem[],
              integrityError: {
                engagementId: row.id,
                engagement: row.title,
                client: row.client,
                error: integrityMessage(error),
              },
            };
          }
          if (error instanceof ApiError && error.status === 404)
            return { items: [] as WorkItem[] };
          throw error;
        }
      }),
    );
    return Response.json(
      {
        items: orderWork(loaded.flatMap((l) => l.items)),
        integrityErrors: loaded.flatMap((l) =>
          l.integrityError ? [l.integrityError] : [],
        ),
        loadedEngagements: rows.slice(0, 25).length,
        nextPage: rows.length > 25 ? page + 1 : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return responseError(e);
  }
}
