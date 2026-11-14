import { printRefusal } from "@/app/print-refusal";

// The summary's refusal page (#220): app/ll144-summary/page.tsx calls
// forbidden() for a caller without access to the practice or engagement, so
// the response carries HTTP 403, like /api/ll144-summary for the same
// request, and shows the refusal's own message, which only describes the
// viewer's own access.
export default function Ll144SummaryForbidden() {
  const message =
    printRefusal().message ?? "You do not have access to this summary.";
  return (
    <main className="print-report">
      <h1>Summary unavailable</h1>
      <p>{message}</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full-page navigation back to the workspace */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
