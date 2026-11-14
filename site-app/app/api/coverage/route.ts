import { responseError } from "@/lib/http";
import { coverageExport, coverageView } from "@/lib/read-models/coverage-view";
import { context } from "@/lib/tenancy";
export const dynamic = "force-dynamic";
/**
 * GET /api/coverage?tenantId&engagementId[&framework=<id>@<edition>]: the
 * coverage views of the engagement's pinned criteria, or one of them
 * (docs/design/criteria-model.md section 10). With `format=csv` and a
 * framework, that view as CSV, filtered by `state`, `actor` and `date`
 * (section 15.2); a filter value the view does not offer is 400. Internal
 * roles only; client roles get 403.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      q = url.searchParams,
      ctx = await context(q.get("tenantId") ?? undefined),
      engagementId = q.get("engagementId") ?? "";
    if (q.get("format") === "csv") {
      const { filename, csv } = await coverageExport(
        ctx,
        engagementId,
        q.get("framework"),
        // An empty parameter is absent; an unknown value is 400 (#201).
        {
          state: q.get("state") || "all",
          actor: q.get("actor") || "all",
          date: q.get("date") || "all",
        },
      );
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return Response.json(
      await coverageView(ctx, engagementId, q.get("framework")),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
