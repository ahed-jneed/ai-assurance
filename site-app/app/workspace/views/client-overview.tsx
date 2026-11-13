"use client";
import type { Engagement } from "@/lib/domain";
import { clientNotices } from "@/lib/report-presentation";

/** The overview a client viewer or contributor sees. */
export function ClientOverview({
  engagement: e,
  onView,
}: {
  engagement: Engagement;
  onView: (view: string) => void;
}) {
  // What each release told the client (#94).
  const notices = clientNotices(e.reports);
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
      {notices.length > 0 && (
        <section className="panel" aria-labelledby="client-notices">
          <div className="panel-head">
            <h2 id="client-notices">Notifications</h2>
          </div>
          {notices.map((n) => (
            <button
              className="attention-row"
              key={n.reportId}
              onClick={() => onView("Reports & sign-off")}
            >
              <span>
                {n.text}
                <small className="subtle block">
                  <time dateTime={n.at}>{new Date(n.at).toLocaleString()}</time>
                </small>
              </span>
              <span>View</span>
            </button>
          ))}
        </section>
      )}
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
