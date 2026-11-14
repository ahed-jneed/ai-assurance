"use client";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monitoringClosureRefusal } from "@/lib/preconditions";
import type { MonitoringCase } from "@/lib/workflow-types";
import { area, choice, evidence, label, options } from "./fields";
import type { ProgramScope } from "./program-scope";
/** The follow-up tab: monitoring, change, incident and remediation cases. */
export function FollowupPanel({
  scope,
  onFollowup,
}: {
  scope: ProgramScope;
  onFollowup: (id: string) => void;
}) {
  const { e, w, uid, busy, writer, lead, reviewer, name } = scope,
    { monitoring, command } = scope.forms;
  // Review closure is disabled with the server's reason (#210): the closer's
  // independence first, then what the case still needs.
  const closureBlocked = (m: MonitoringCase) =>
    m.contributors.includes(uid) || m.ownerId === uid
      ? "A preparer or contributor cannot approve their own work"
      : (monitoringClosureRefusal(e, m)?.message ?? "");
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Monitoring, changes & incidents</h2>
        {writer && (
          <Button variant="outline" disabled={busy} onClick={monitoring}>
            <Plus size={14} />
            New case
          </Button>
        )}
      </div>
      {w.monitoring.map((m) => (
        <details className="captured-record" key={m.id}>
          <summary>
            <span>
              {m.title}
              <small className="block subtle">
                {label(m.kind)} · {name(m.ownerId)} · due {m.dueDate} ·{" "}
                {label(m.cadence)}
              </small>
            </span>
            <span className="badge neutral">{label(m.state)}</span>
          </summary>
          <p className="record-text">{m.description}</p>
          <p>Decision: {label(m.decision)}</p>
          <p className="record-text">{m.assessment || "Assessment needed"}</p>
          {m.closure && <p className="record-text">Closure: {m.closure}</p>}
          {m.successorEngagementId && (
            <Button
              variant="link"
              onClick={() => onFollowup(m.successorEngagementId!)}
            >
              Open successor engagement <ArrowUpRight size={14} />
            </Button>
          )}
          <div className="row-actions">
            {writer && m.state !== "closed" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  command(
                    "Assess follow-up case",
                    "assessMonitoringCase",
                    [
                      choice(
                        "decision",
                        "Reassessment decision",
                        options([
                          "follow_up",
                          "no_reassessment",
                          "reassessment_required",
                        ]),
                        m.decision === "not_assessed" ? "" : m.decision,
                      ),
                      area(
                        "assessment",
                        "Assessment, impact and next action",
                        m.assessment,
                      ),
                      {
                        name: "dueDate",
                        label: "Next action due",
                        type: "date",
                        value: m.dueDate,
                      },
                      evidence(e, m.evidenceIds),
                    ],
                    { caseId: m.id },
                  )
                }
              >
                Record assessment
              </Button>
            )}
            {lead &&
              m.decision === "reassessment_required" &&
              !m.successorEngagementId &&
              m.state !== "closed" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    command(
                      "Open successor engagement",
                      "openFollowup",
                      [
                        {
                          name: "title",
                          label: "Engagement title",
                          value: e.title + " · reassessment",
                        },
                        {
                          name: "dueDate",
                          label: "Due date",
                          type: "date",
                          value: m.dueDate,
                        },
                      ],
                      { caseId: m.id },
                      "Create linked engagement",
                    )
                  }
                >
                  Open reassessment
                </Button>
              )}
            {reviewer && m.state === "in_progress" && (
              <Button
                variant="outline"
                disabled={busy || !!closureBlocked(m)}
                aria-describedby={
                  closureBlocked(m) ? "closure-blocked-" + m.id : undefined
                }
                onClick={() =>
                  command(
                    "Independently close case",
                    "closeMonitoringCase",
                    [area("closure", "Evidence-backed closure decision")],
                    { caseId: m.id },
                    "Close case",
                  )
                }
              >
                Review closure
              </Button>
            )}
            {reviewer && m.state === "in_progress" && closureBlocked(m) && (
              <p className="subtle" id={"closure-blocked-" + m.id}>
                {closureBlocked(m)}
              </p>
            )}
            {writer &&
              m.state === "closed" &&
              m.cadence !== "one_off" &&
              !m.nextCaseId && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    command(
                      "Plan next monitoring cycle",
                      "createMonitoringCase",
                      [
                        {
                          name: "title",
                          label: "Next cycle subject",
                          value: m.title,
                        },
                        area("description", "Monitoring scope", m.description),
                        {
                          name: "dueDate",
                          label: "Next cycle due date",
                          type: "date",
                        },
                      ],
                      {
                        previousCaseId: m.id,
                        kind: "monitoring",
                        ownerId: m.ownerId,
                        cadence: m.cadence,
                        findingId: m.findingId,
                        reportId: m.reportId,
                      },
                      "Create next cycle",
                    )
                  }
                >
                  Plan next cycle
                </Button>
              )}
          </div>
          <details className="provenance">
            <summary>Case history</summary>
            {m.history.map((h, i) => (
              <p key={i}>
                {new Date(h.at).toLocaleString()} · {name(h.actor)} ·{" "}
                {label(h.action)} · {h.assessment}
              </p>
            ))}
          </details>
        </details>
      ))}
      {!w.monitoring.length && (
        <p className="empty-result">
          Record monitoring commitments, material changes, incidents and
          remediation follow-up here.
        </p>
      )}
    </section>
  );
}
