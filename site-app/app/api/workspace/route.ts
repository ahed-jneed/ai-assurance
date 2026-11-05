import { z } from "zod";
import { sanitize } from "@/lib/client-projection";
import { dispatch } from "@/lib/commands";
import { short } from "@/lib/commands/fields";
import { getEngagement, save } from "@/lib/engagement-repo";
import { ApiError, checkOrigin, readBounded, responseError } from "@/lib/http";
import { workspaceView } from "@/lib/read-models/workspace-view";
import { context } from "@/lib/tenancy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? undefined);
    return Response.json(
      await workspaceView(ctx, url.searchParams.get("engagementId")),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
const command = z
  .object({
    tenantId: short,
    engagementId: short,
    expectedVersion: z.number().int().positive(),
    op: short,
    data: z.record(z.unknown()).default({}),
  })
  .strict();
/** Parse → context → load → dispatch (lib/commands) → save. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const payload = command.parse(
        JSON.parse(
          new TextDecoder().decode(await readBounded(request, 2 * 1024 * 1024)),
        ),
      ),
      ctx = await context(payload.tenantId),
      e = await getEngagement(ctx, payload.engagementId);
    if (e.version !== payload.expectedVersion)
      throw new ApiError(409, "The engagement changed. Reload before saving.");
    const result = await dispatch(e, payload.op, payload.data, ctx);
    if ("saved" in result)
      return Response.json({ engagement: sanitize(result.saved, ctx) });
    await save(
      ctx,
      e,
      payload.expectedVersion,
      payload.op,
      result.details,
      result.extras,
    );
    return Response.json({
      engagement: sanitize(e, ctx),
      details: result.details,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        },
        { status: 400 },
      );
    return responseError(error);
  }
}
