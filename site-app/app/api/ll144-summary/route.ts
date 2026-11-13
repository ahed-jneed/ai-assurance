import { responseError } from "@/lib/http";
import { ll144SummaryView } from "@/lib/read-models/ll144-summary";
import { context } from "@/lib/tenancy";
export const dynamic = "force-dynamic";
/**
 * GET /api/ll144-summary?tenantId&engagementId&auditId[&reportId]: the
 * publishable NYC Local Law 144 summary of one bias audit (6 RCNY 5-303) as
 * JSON, from a captured report or, for the engagement team, the live audit.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      q = url.searchParams,
      ctx = await context(q.get("tenantId") ?? undefined);
    const view = await ll144SummaryView(
      ctx,
      q.get("engagementId") ?? "",
      q.get("auditId") ?? "",
      q.get("reportId"),
    );
    return Response.json(view, {
      headers: {
        "Cache-Control": "no-store",
        ...(q.get("download") === "1"
          ? {
              "Content-Disposition": `attachment; filename="ll144-summary-${view.summary.auditId.replace(/[^A-Za-z0-9-]/g, "")}.json"`,
            }
          : {}),
      },
    });
  } catch (error) {
    return responseError(error);
  }
}
