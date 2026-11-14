import { responseError } from "@/lib/http";
import { accessLogCsv, accessLogPage } from "@/lib/read-models/access-log";
import { parseEventQuery } from "@/lib/read-models/event-pages";
import { context } from "@/lib/tenancy";
export const dynamic = "force-dynamic";
/**
 * GET /api/access-log?tenantId[&actor][&action][&from][&to][&cursor][&limit]:
 * a page of the practice's Access log, newest first (#181). With
 * `format=csv`, every event the filters match as CSV. Practice
 * administrators only, of any staff role; everyone else, a Lead Auditor who
 * is not an administrator included, gets 403.
 */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams,
      ctx = await context(q.get("tenantId") ?? undefined),
      query = parseEventQuery(q);
    if (q.get("format") === "csv") {
      const { filename, csv } = await accessLogCsv(ctx, query);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return Response.json(await accessLogPage(ctx, query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return responseError(error);
  }
}
