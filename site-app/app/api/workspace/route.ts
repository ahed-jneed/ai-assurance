import { z } from "zod";
import { sanitize } from "@/lib/client-projection";
import { dispatch } from "@/lib/commands";
import { short } from "@/lib/commands/fields";
import { getEngagement, save } from "@/lib/engagement-repo";
import { ApiError, checkOrigin, readJson, responseError } from "@/lib/http";
import {
  engagementTrail,
  workspaceView,
} from "@/lib/read-models/workspace-view";
import { context, refuseReadOnly, type Context } from "@/lib/tenancy";
import type { Engagement } from "@/lib/domain/types";
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
/**
 * The saved engagement's audit trail and stored size, or nothing when they
 * cannot be read: the save is already committed, so the response still
 * confirms it and the UI reloads the workspace instead.
 */
async function savedTrail(ctx: Context, e: Engagement) {
  try {
    return await engagementTrail(ctx, e);
  } catch {
    return {};
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
    const payload = command.parse(await readJson(request, 2 * 1024 * 1024)),
      ctx = await context(payload.tenantId);
    refuseReadOnly(ctx);
    const e = await getEngagement(ctx, payload.engagementId);
    if (e.version !== payload.expectedVersion)
      throw new ApiError(409, "The engagement changed. Reload before saving.");
    const result = await dispatch(e, payload.op, payload.data, ctx);
    // The response carries what the save changed (the engagement, its audit
    // trail and stored size), so the UI applies it without a reload.
    if ("saved" in result)
      return Response.json({
        engagement: sanitize(result.saved, ctx),
        ...(await savedTrail(ctx, result.saved)),
      });
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
      ...(await savedTrail(ctx, e)),
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
