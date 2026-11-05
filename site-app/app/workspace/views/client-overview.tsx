"use client";
import type { Engagement } from "@/lib/domain";

/** The overview a client viewer or contributor sees. */
export function ClientOverview({
  engagement: e,
  onView,
}: {
  engagement: Engagement;
  onView: (view: string) => void;
}) {
  return (
    <>
      <div className="stat-grid client-stat-grid">
        {[
          ["Released reports", e.reports.length],
          [
            "Shared findings",
            e.findings.filter((f) => f.status !== "closed").length,
          ],
          ["Accepted evidence", e.artifacts.length],
        ].map(([label, count]) => (
          <section className="stat" key={label}>
            <p>{label}</p>
            <strong>{count}</strong>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Engagement records</h2>
        </div>
        {[
          ["Reports", "Reports & sign-off"],
          ["Findings & remediation", "Findings"],
          ["Evidence", "Evidence vault"],
        ].map(([title, view]) => (
          <button
            className="attention-row"
            key={view}
            onClick={() => onView(view)}
          >
            <span>{title}</span>
            <span>View</span>
          </button>
        ))}
      </section>
    </>
  );
}
