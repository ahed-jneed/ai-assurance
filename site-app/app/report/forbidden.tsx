import { printRefusal } from "@/app/print-refusal";

// The print view's refusal page (#209): app/report/page.tsx calls forbidden()
// for a caller without access to the practice or engagement, so the response
// carries HTTP 403, like /api/report-package for the same request. It shows
// the refusal's own message, which only describes the viewer's own access
// (#216), for example that the practice was archived.
export default function ReportForbidden() {
  const message =
    printRefusal().message ?? "You do not have access to this report.";
  return (
    <main className="print-report">
      <h1>Report unavailable</h1>
      <p>{message}</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
