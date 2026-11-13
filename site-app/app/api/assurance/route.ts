import { z } from "zod";
import { assuranceTarget, dispatchAssurance } from "@/lib/commands/assurance";
import { short } from "@/lib/commands/fields";
import { getEngagement } from "@/lib/engagement-repo";
import { ApiError, checkOrigin, readJson, responseError } from "@/lib/http";
import {
  assuranceRecord,
  assuranceRecordPage,
  assuranceReviewQueue,
  assuranceSearch,
  assuranceView,
} from "@/lib/read-models/assurance-view";
import { genaiComputation, genaiView } from "@/lib/read-models/genai-view";
import { context, refuseReadOnly } from "@/lib/tenancy";
import { isClientRole } from "@/lib/workflow-state";
export const dynamic = "force-dynamic";
/**
 * The workbench view (counts, queue, jobs and telemetry; no records) or, with
 * `view=records`, a `cursor` from a previous page or a record `kind`, one page
 * of records. `view=search` (`kinds`, `q`, `review`, `cursor`, `limit`)
 * answers one page of a search over every record; `view=queue` the caller's
 * review queue, or with `state` one page of it; `view=record` (`id`) one
 * record with its review state and the records its details read. `view=genai`
 * lists the GenAI evidence and its readiness, and with `recordId` returns one
 * result's verified computation.
 */
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      param = (name: string) => u.searchParams.get(name) ?? "",
      ctx = await context(param("tenantId")),
      engagementId = param("engagementId"),
      view = param("view"),
      kind = param("kind"),
      cursor = param("cursor"),
      limit = param("limit") ? Number(param("limit")) : undefined;
    if (
      view &&
      !["search", "queue", "record", "records", "genai"].includes(view)
    )
      throw new ApiError(400, "Unknown assurance view");
    return Response.json(
      view === "record"
        ? await assuranceRecord(ctx, engagementId, param("id"))
        : view === "genai"
          ? param("recordId")
            ? await genaiComputation(ctx, engagementId, param("recordId"))
            : await genaiView(ctx, engagementId)
          : view === "search"
            ? await assuranceSearch(ctx, engagementId, {
                kinds: param("kinds") ? param("kinds").split(",") : [],
                term: param("q"),
                review: param("review"),
                cursor,
                limit,
              })
            : view === "queue"
              ? await assuranceReviewQueue(ctx, engagementId, {
                  state: param("state"),
                  cursor,
                  limit,
                })
              : view === "records" || kind || cursor
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
    const a = command.parse(await readJson(request, 1024 * 1024)),
      ctx = await context(a.tenantId);
    refuseReadOnly(ctx);
    if (isClientRole(ctx.role))
      throw new ApiError(403, "The assurance workbench is internal");
    const e = await getEngagement(ctx, a.engagementId);
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
