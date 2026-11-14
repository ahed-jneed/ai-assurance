import { responseError } from "@/lib/http";
import { auditTrailPage } from "@/lib/read-models/audit-trail";
import { parseEventQuery } from "@/lib/read-models/event-pages";
import { context } from "@/lib/tenancy";
export const dynamic = "force-dynamic";
/**
 * GET /api/audit-trail?tenantId&engagementId[&actor][&action][&from][&to]
 * [&cursor][&limit]: a page of the engagement's audit trail, newest first
 * (#181). The practice's engagement staff with a grant to the engagement
 * only; client roles get 403.
 */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams,
      ctx = await context(q.get("tenantId") ?? undefined),
      query = parseEventQuery(q);
    return Response.json(
      await auditTrailPage(ctx, q.get("engagementId") ?? "", query),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
