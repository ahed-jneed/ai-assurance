import {
  ApiError,
  context,
  getEngagement,
  responseError,
  sha256,
} from "@/lib/store";
import { isClientRole, isClientVisible } from "@/lib/workflow-state";
import { verifyPackage } from "@/lib/report-package";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? ""),
      e = await getEngagement(ctx, url.searchParams.get("engagementId") ?? ""),
      r = e.reports.find((r) => r.id === url.searchParams.get("reportId")),
      client = isClientRole(ctx.role);
    if (!r || (client && !isClientVisible(r)))
      throw new ApiError(404, "Report package not found");
    const proof = await verifyPackage(r, sha256, client);
    if (url.searchParams.get("download") === "1") {
      if (!proof.valid)
        throw new ApiError(
          409,
          "Package integrity check failed; contact the audit lead",
        );
      const body = JSON.stringify(
        {
          contractVersion: "1.1",
          reportId: r.id,
          kind: r.kind,
          createdAt: r.createdAt,
          snapshot: client ? r.clientSnapshot : r.snapshot,
          sha256: proof.expectedSha256,
          proof,
        },
        null,
        2,
      );
      return new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="audit-package-' + r.id + '.json"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Report-SHA256": proof.expectedSha256,
        },
      });
    }
    return Response.json(proof, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return responseError(error);
  }
}
