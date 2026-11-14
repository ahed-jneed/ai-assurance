// The print view's refusal page (#209): app/report/page.tsx calls forbidden()
// for a caller without access to the practice or engagement, so the response
// carries HTTP 403, like /api/report-package for the same request.
export default function ReportForbidden() {
  return (
    <main className="print-report">
      <h1>Report unavailable</h1>
      <p>You do not have access to this report.</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
