import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError, context, getEngagement, sanitize } from "@/lib/store";
import { reportMarkup, type ReportSnapshot } from "./report-markup";
export const dynamic = "force-dynamic";
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return <ReportBody params={params} />;
}
async function ReportBody({
  params,
}: {
  params: Record<string, string | undefined>;
}) {
  await requireChatGPTUser(
    "/report?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter((v): v is [string, string] => !!v[1]),
        ),
      ),
  );
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
    return (
      <main className="print-report">
        <h1>Report unavailable</h1>
        <p>
          {error instanceof ApiError
            ? error.message
            : "The report could not be loaded."}
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
        <a href="/">Return to workspace</a>
      </main>
    );
  }
}
