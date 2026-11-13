import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { ll144SummaryView } from "@/lib/read-models/ll144-summary";
import { ApiError } from "@/lib/http";
import { context } from "@/lib/tenancy";
import { summaryMarkup } from "./summary-markup";
export const dynamic = "force-dynamic";
/** /ll144-summary?tenantId&engagementId&auditId[&reportId]: the standalone LL144 summary. */
export default async function Ll144SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter((v): v is [string, string] => !!v[1]),
    ),
  );
  await requireChatGPTUser("/ll144-summary?" + query);
  try {
    const ctx = await context(params.tenantId),
      view = await ll144SummaryView(
        ctx,
        params.engagementId ?? "",
        params.auditId ?? "",
        params.reportId ?? null,
      );
    return summaryMarkup(view, "/api/ll144-summary?" + query + "&download=1");
  } catch (error) {
    return (
      <main className="print-report">
        <h1>Summary unavailable</h1>
        <p>
          {error instanceof ApiError
            ? error.message
            : "The summary could not be loaded."}
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full-page navigation back to the workspace */}
        <a href="/">Return to workspace</a>
      </main>
    );
  }
}
