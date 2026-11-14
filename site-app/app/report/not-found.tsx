// The print view's refusal page (#209): app/report/page.tsx calls notFound()
// for a missing, withdrawn or unreleased report, so the response carries
// HTTP 404, like /api/report-package for the same request.
export default function ReportNotFound() {
  return (
    <main className="print-report">
      <h1>Report unavailable</h1>
      <p>This report does not exist or has not been released to you.</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
