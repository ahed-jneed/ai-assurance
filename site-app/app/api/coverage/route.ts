import { responseError } from "@/lib/http";
import { coverageView } from "@/lib/read-models/coverage-view";
import { context } from "@/lib/tenancy";
export const dynamic = "force-dynamic";
/**
 * GET /api/coverage?tenantId&engagementId[&framework=<id>@<edition>]: the
 * coverage views of the engagement's pinned criteria, or one of them
 * (docs/design/criteria-model.md section 10).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? undefined);
    return Response.json(
      await coverageView(
        ctx,
        url.searchParams.get("engagementId") ?? "",
        url.searchParams.get("framework"),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
