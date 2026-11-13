import { getEngagement } from "@/lib/engagement-repo";
import { responseError, ApiError } from "@/lib/http";
import { context, requireRole } from "@/lib/tenancy";
import { datasetCSV, inspectCSV } from "@/lib/evaluation-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? "");
    requireRole(ctx, [
      "Auditor",
      "Lead Auditor",
      "Reviewer",
      "Engagement Quality Reviewer",
    ]);
    const e = await getEngagement(
        ctx,
        url.searchParams.get("engagementId") ?? "",
      ),
      { a, csv } = await datasetCSV(
        e,
        url.searchParams.get("artifactId") ?? "",
      );
    let profile;
    try {
      // values=<column> lists a column's distinct values and counts=<column>
      // their row counts, for the power check's classes and planned group
      // sizes; at most two of each (the mapped target and group columns).
      profile = inspectCSV(csv, {
        values: url.searchParams.getAll("values").slice(0, 2),
        counts: url.searchParams.getAll("counts").slice(0, 2),
      });
    } catch (error) {
      throw new ApiError(400, (error as Error).message);
    }
    return Response.json(
      { artifactId: a.id, sha256: a.sha256, ...profile },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
