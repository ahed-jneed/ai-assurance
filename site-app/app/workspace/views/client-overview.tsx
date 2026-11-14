"use client";
import type { Engagement, Role } from "@/lib/domain/types";
import { clientPortalTitle } from "@/lib/navigation-preferences";
import { canSee } from "@/lib/permissions";
import { clientNotices } from "@/lib/report-presentation";

/**
 * What the client overview counts (#36, F-72). Accepted evidence is what the
 * audit team accepted and shared with the client; a contributor's own
 * uploads that are not accepted yet are counted apart, as submissions
 * awaiting the audit team. A contributor is shown no findings, so the count
 * is left out for them instead of reading zero.
 */
export function clientOverviewStats(e: Engagement, role: Role) {
  const stats: [string, number][] = [["Released reports", e.reports.length]];
  if (canSee(role, "clientFindings"))
    stats.push([
      "Shared findings",
      e.findings.filter((f) => f.status !== "closed").length,
    ]);
  stats.push([
    "Accepted evidence",
    e.artifacts.filter(
      (a) => a.status === "accepted" && a.visibility === "client",
    ).length,
  ]);
  if (canSee(role, "clientPortal"))
    stats.push([
      "Your submissions awaiting review",
      e.artifacts.filter((a) => a.status !== "accepted").length,
    ]);
  return stats;
}

/** The overview a client viewer or contributor sees. */
export function ClientOverview({
  engagement: e,
  role,
  onView,
}: {
  engagement: Engagement;
  role: Role;
  onView: (view: string) => void;
}) {
  // What each release told the client (#94).
  const notices = clientNotices(e.reports);
  const records: [string, string][] = [
    ["Reports", "Reports & sign-off"],
    ...(canSee(role, "clientFindings")
      ? ([["Findings & remediation", "Findings"]] as [string, string][])
      : []),
    ["Shared evidence", "Evidence vault"],
  ];
  return (
    <>
      <div className="stat-grid client-stat-grid">
        {clientOverviewStats(e, role).map(([label, count]) => (
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
      <section className="panel" aria-labelledby="client-records">
        <div className="panel-head">
          <h2 id="client-records">What your auditor has shared</h2>
        </div>
        {records.map(([title, view]) => (
          <button
            className="attention-row"
            key={view}
            onClick={() => onView(view)}
          >
            <span>{title}</span>
            <span>Open {clientPortalTitle(view).toLowerCase()}</span>
          </button>
        ))}
      </section>
    </>
  );
}
