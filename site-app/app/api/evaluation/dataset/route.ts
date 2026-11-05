import {
  context,
  getEngagement,
  requireRole,
  responseError,
  ApiError,
} from "@/lib/store";
import { datasetCSV, inspectCSV } from "@/lib/evaluation-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? "");
    requireRole(ctx, ["Auditor", "Lead Auditor", "Reviewer"]);
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
      profile = inspectCSV(csv);
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
