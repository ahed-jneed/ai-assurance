// The summary's not-found page (#220): app/ll144-summary/page.tsx calls
// notFound() for a missing audit, a report that holds no such summary, or a
// live summary a client role may not read before it is published in a
// released report, so the response carries HTTP 404, like /api/ll144-summary
// for the same request.
export default function Ll144SummaryNotFound() {
  return (
    <main className="print-report">
      <h1>Summary unavailable</h1>
      <p>This summary does not exist or has not been published to you.</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full-page navigation back to the workspace */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
