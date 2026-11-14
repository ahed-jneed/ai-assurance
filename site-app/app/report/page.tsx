import { forbidden, notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { sanitize } from "@/lib/client-projection";
import { getEngagement } from "@/lib/engagement-repo";
import { ApiError } from "@/lib/http";
import { context } from "@/lib/tenancy";
import { reportMarkup, type ReportSnapshot } from "./report-markup";
export const dynamic = "force-dynamic";
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  // Called, not rendered as an element: a refusal then throws while the page
  // itself renders, so the response status is set before anything streams.
  return await reportBody(params);
}
async function reportBody(params: Record<string, string | undefined>) {
  await requireChatGPTUser(
    "/report?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter((v): v is [string, string] => !!v[1]),
        ),
      ),
  );
  let refusal: number | undefined;
  try {
    const ctx = await context(params.tenantId),
      engagement = await getEngagement(ctx, params.engagementId ?? ""),
      e = sanitize(engagement, ctx),
      report = e.reports.find((r) => r.id === params.reportId);
    if (!report) throw new ApiError(404, "Released report not found");
    // Build the markup inside the try block so that a malformed snapshot still
    // renders the "Report unavailable" fallback below.
    return reportMarkup(
      report,
      report.snapshot as ReportSnapshot,
      ctx.tenantId,
    );
  } catch (error) {
    if (!(error instanceof ApiError)) return unavailable();
    refusal = error.status;
  }
  // A refused report answers with the status /api/report-package gives for
  // the same inputs (#209): 403 when access is denied, 404 for a missing,
  // withdrawn or unreleased report. Both throw, so they stay outside the
  // try block above; the segment's forbidden.tsx and not-found.tsx render.
  if (refusal === 403) forbidden();
  notFound();
}

/** The fallback for a report that exists but could not be rendered. */
function unavailable() {
  return (
    <main className="print-report">
      <h1>Report unavailable</h1>
      <p>The report could not be loaded.</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
