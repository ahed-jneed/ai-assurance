import { z } from "zod";
import { assuranceTarget, dispatchAssurance } from "@/lib/commands/assurance";
import { short } from "@/lib/commands/fields";
import { getEngagement } from "@/lib/engagement-repo";
import { ApiError, checkOrigin, readBounded, responseError } from "@/lib/http";
import {
  assuranceRecordPage,
  assuranceView,
} from "@/lib/read-models/assurance-view";
import { context } from "@/lib/tenancy";
import { isClientRole } from "@/lib/workflow-state";
export const dynamic = "force-dynamic";
/**
 * The workbench view with the first page of records or, given a `cursor` from
 * a previous page or a record `kind`, just that page of records.
 */
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      ctx = await context(u.searchParams.get("tenantId") ?? ""),
      engagementId = u.searchParams.get("engagementId") ?? "",
      kind = u.searchParams.get("kind") ?? "",
      cursor = u.searchParams.get("cursor") ?? "";
    return Response.json(
      kind || cursor
        ? await assuranceRecordPage(ctx, engagementId, { kind, cursor })
        : await assuranceView(ctx, engagementId),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return responseError(e);
  }
}
const command = z
  .object({
    tenantId: short,
    engagementId: short,
    op: short,
    data: z.record(z.unknown()),
  })
  .strict();
/**
 * Parse → context → dispatch (lib/commands/assurance). Nothing loads the
 * engagement's assurance records up front: each op loads the records it names.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = command.parse(
        JSON.parse(
          new TextDecoder().decode(await readBounded(request, 1024 * 1024)),
        ),
      ),
      ctx = await context(a.tenantId),
      e = await getEngagement(ctx, a.engagementId);
    if (isClientRole(ctx.role))
      throw new ApiError(403, "The assurance workbench is internal");
    const result = await dispatchAssurance(
      assuranceTarget(e, ctx),
      a.op,
      a.data,
      ctx,
    );
    if (result instanceof Response) return result;
    return Response.json(
      { record: result.record },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    return responseError(e);
  }
}
