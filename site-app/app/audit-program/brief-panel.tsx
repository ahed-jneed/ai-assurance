"use client";
import { Button } from "@/components/ui/button";
import type { BriefFields } from "@/lib/workflow-types";
import { decisionState } from "@/lib/permissions";
import { DecisionButton } from "../workspace/decision-button";
import { reason } from "./fields";
import type { ProgramScope } from "./program-scope";
/** The engagement brief tab: the scope document and its review. */
export function BriefPanel({ scope }: { scope: ProgramScope }) {
  const { e, w, uid, role, busy, act, writer, reviewer, name, warningCards } =
      scope,
    { brief, command } = scope.forms,
    b = w.brief;
  return (
    <section className="panel workflow-document">
      <div className="panel-head">
        <h2>{b?.systemName ?? "Engagement scope"}</h2>
        <span className="badge neutral">
          {b ? b.status + " · revision " + b.revision : "Draft needed"}
        </span>
      </div>
      {b ? (
        <>
          <dl className="document-properties">
            <div>
              <dt>Period</dt>
              <dd>
                {b.periodStart} — {b.periodEnd}
              </dd>
            </div>
            <div>
              <dt>Updated by</dt>
              <dd>{name(b.updatedBy)}</dd>
            </div>
            <div>
              <dt>Approval</dt>
              <dd>
                {b.approval
                  ? name(b.approval.userId) +
                    " · " +
                    new Date(b.approval.at).toLocaleString()
                  : "Independent approval needed"}
              </dd>
            </div>
          </dl>
          {b.returnReason && (
            <div className="comment-box">
              <b>Changes requested by {name(b.returnedBy ?? "")}</b>
              <p className="record-text">{b.returnReason}</p>
              {b.returnedAt && (
                <small>{new Date(b.returnedAt).toLocaleString()}</small>
              )}
            </div>
          )}
          {warningCards((id) => id === "brief" || id === "metadata")}
          {[
            ["intendedUse", "Intended use"],
            ["boundary", "Boundary and exclusions"],
            ["actorResponsibilities", "Actor responsibilities"],
            ["basis", "Applicable criteria and dates"],
            ["deliverables", "Deliverables"],
            ["audience", "Report audience"],
            ["constraints", "Constraints"],
            [
              "independence",
              "Competence and independence (free text recorded before declarations)",
            ],
            ["changeImpact", "Change impact"],
          ].map(
            ([k, t]) =>
              b[k as keyof BriefFields] && (
                <section className="readable-section" key={k}>
                  <h3>{t}</h3>
                  <p className="record-text">{b[k as keyof BriefFields]}</p>
                </section>
              ),
          )}
          {b.approval && (
            <p className="record-text">Review rationale: {b.approval.reason}</p>
          )}
          <details className="provenance">
            <summary>Scope revision history ({b.history.length})</summary>
            {b.history.map((h, i) => (
              <div className="comment-box" key={i}>
                <b>
                  Revision {h.revision} · {h.status}
                </b>
                <p>{h.boundary}</p>
                <p>{h.changeImpact}</p>
                {h.returnReason && (
                  <p>
                    Changes requested by {name(h.returnedBy ?? "")}:{" "}
                    {h.returnReason}
                  </p>
                )}
                <small>
                  {name(h.updatedBy)} · {new Date(h.updatedAt).toLocaleString()}
                </small>
              </div>
            ))}
          </details>
        </>
      ) : (
        <p className="empty-result">
          Define the AI system, audit period, responsibilities and criteria.
        </p>
      )}
      <div className="row-actions">
        {b?.status !== "submitted" && (
          <DecisionButton
            state={decisionState(role, uid, {
              action: "saveBrief",
              engagement: e,
            })}
            disabled={busy}
            onClick={brief}
          >
            {b ? "Revise scope" : "Complete brief"}
          </DecisionButton>
        )}
        {writer && b?.status === "draft" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act("submitBrief", {}).catch(() => {})}
          >
            Submit for review
          </Button>
        )}
        {reviewer && b?.status === "submitted" && (
          <>
            <Button
              disabled={busy || b.contributors.includes(uid)}
              onClick={() =>
                command(
                  "Approve scope revision " + b.revision,
                  "approveBrief",
                  reason(),
                  { revision: b.revision },
                  "Approve scope",
                )
              }
            >
              Approve scope
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                command("Return scope for correction", "returnBrief", reason())
              }
            >
              Request changes
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
