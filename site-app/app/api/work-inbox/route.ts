import {
  ApiError,
  context,
  db,
  getEngagement,
  requireRole,
  responseError,
} from "@/lib/store";
import { engagementWork, orderWork } from "@/lib/work-items";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      ctx = await context(u.searchParams.get("tenantId") ?? undefined);
    requireRole(ctx, [
      "Auditor",
      "Lead Auditor",
      "Reviewer",
      "Engagement Quality Reviewer",
    ]);
    const page = Number(u.searchParams.get("page") ?? 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000)
      throw new ApiError(400, "Invalid inbox page");
    const rows = (
      await db()
        .prepare(
          "SELECT e.id,e.client_id,c.name AS client FROM engagements e JOIN clients c ON c.tenant_id=e.tenant_id AND c.id=e.client_id JOIN engagement_access a ON a.tenant_id=e.tenant_id AND a.engagement_id=e.id WHERE e.tenant_id=? AND a.user_id=? AND a.active=1 ORDER BY e.id LIMIT 26 OFFSET ?",
        )
        .bind(ctx.tenantId, ctx.user.userId, page * 25)
        .all<{ id: string; client_id: string; client: string }>()
    ).results;
    const items = [];
    for (const row of rows.slice(0, 25)) {
      try {
        const e = await getEngagement(ctx, row.id);
        items.push(...engagementWork(e, ctx.role, ctx.user.userId, row.client));
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
      }
    }
    return Response.json(
      {
        items: orderWork(items),
        loadedEngagements: rows.slice(0, 25).length,
        nextPage: rows.length > 25 ? page + 1 : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return responseError(e);
  }
}
