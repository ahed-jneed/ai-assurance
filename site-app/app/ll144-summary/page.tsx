import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { answerPrintFailure, resolvePrintTree } from "@/app/print-failure";
import { ll144SummaryView } from "@/lib/read-models/ll144-summary";
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
  // Called, not rendered as an element: a refusal then throws while the page
  // itself renders, so the response status is set before anything streams.
  return await summaryBody(params);
}
async function summaryBody(params: Record<string, string | undefined>) {
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
    // The whole markup, its tables included, renders inside the try block
    // (#234 item 8).
    return resolvePrintTree(
      summaryMarkup(view, "/api/ll144-summary?" + query + "&download=1"),
    );
  } catch (error) {
    // The status /api/ll144-summary gives for the same inputs, as /report
    // does (#220): 403 renders forbidden.tsx with the refusal's own message,
    // 404 not-found.tsx; anything else is logged and answered below.
    answerPrintFailure(error, "/ll144-summary");
    return (
      <main className="print-report">
        <h1>Summary unavailable</h1>
        <p>The summary could not be loaded.</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full-page navigation back to the workspace */}
        <a href="/">Return to workspace</a>
      </main>
    );
  }
}
