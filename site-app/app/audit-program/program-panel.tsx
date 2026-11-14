"use client";
import { ArrowUpRight, ClipboardList, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isReleaseTimeRecord } from "@/lib/domain/gates";
import { procedureLabel } from "@/lib/workflow-state";
import { decisionState } from "@/lib/permissions";
import { procedureWork } from "@/lib/work-items";
import { DecisionButton } from "../workspace/decision-button";
import { label, reason } from "./fields";
import type { ProgramScope } from "./program-scope";
/** The program tab: the procedure register with its filters and bulk actions. */
export function ProgramPanel({
  scope,
  filter,
  onFilter: setFilter,
  query,
  onQuery: setQuery,
  batchIds,
  onBatch: setBatchIds,
  onOpen,
}: {
  scope: ProgramScope;
  filter: string;
  onFilter: (filter: string) => void;
  query: string;
  onQuery: (query: string) => void;
  batchIds: string[];
  onBatch: React.Dispatch<React.SetStateAction<string[]>>;
  /** Opens a procedure at a section. */
  onOpen: (id: string, section: string) => void;
}) {
  const {
      e,
      w,
      uid,
      role,
      busy,
      act,
      writer,
      reviewer,
      name,
      warningCards,
      art50Suggestion,
    } = scope,
    { bulk, staffing, command } = scope.forms,
    b = w.brief,
    // Planning narrows to a Lead Auditor once the program is submitted.
    bulkPlan = decisionState(role, uid, {
      action: "bulkPlanProcedures",
      engagement: e,
    });
  const rows = w.procedures.filter(
    (p) =>
      ((filter === "waiting" && procedureWork(e, p.id)!.waiting) ||
        (filter === "corrections" && procedureWork(e, p.id)!.corrections) ||
        (filter === "overdue" && procedureWork(e, p.id)!.overdue) ||
        (filter === "ready" && procedureWork(e, p.id)!.readyToEvaluate) ||
        filter === "all" ||
        (filter === "selected" && p.selected) ||
        (filter === "pending" && p.applicability === "pending") ||
        (filter === "mine" && p.ownerId === uid) ||
        (filter === "review" &&
          p.state === "submitted" &&
          p.reviewerId === uid)) &&
      (!query ||
        (p.title + " " + p.templateId)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const inScope = w.procedures.filter((p) => p.selected).length;
  const lastProgramEntry = w.program.history.at(-1),
    programReturn =
      w.program.status === "draft" && lastProgramEntry?.status === "returned"
        ? lastProgramEntry
        : undefined;
  return (
    <section className="panel">
      <div className="workflow-toolbar">
        <div>
          <b>Program revision {w.program.revision}</b>
          <small className="subtle block">
            {w.program.status} · scope revision{" "}
            {w.program.briefRevision || "not bound"} · {inScope} selected
          </small>
        </div>
        <div className="row-actions">
          <DecisionButton
            state={decisionState(role, uid, {
              action: "scopeProgramCandidates",
              engagement: e,
            })}
            variant="outline"
            disabled={busy}
            onClick={bulk}
          >
            Assess candidates
          </DecisionButton>
          {writer && w.program.status === "draft" && (
            <Button
              disabled={busy || b?.status !== "approved"}
              title={
                b?.status !== "approved"
                  ? "Approve the engagement brief first"
                  : undefined
              }
              onClick={() => void act("submitProgram", {}).catch(() => {})}
            >
              Submit program
            </Button>
          )}
          {reviewer && w.program.status === "submitted" && (
            <>
              <Button
                disabled={busy || w.program.contributors.includes(uid)}
                onClick={() =>
                  command(
                    "Approve program revision " + w.program.revision,
                    "approveProgram",
                    reason(),
                    { revision: w.program.revision },
                    "Approve program",
                  )
                }
              >
                Approve program
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  command(
                    "Return program for correction",
                    "returnProgram",
                    reason(),
                  )
                }
              >
                Request changes
              </Button>
            </>
          )}
        </div>
      </div>
      {programReturn && (
        <div className="comment-box">
          <b>
            Revision {programReturn.revision} returned by{" "}
            {name(programReturn.actor)}
          </b>
          <p className="record-text">{programReturn.reason}</p>
          <small>{new Date(programReturn.at).toLocaleString()}</small>
        </div>
      )}
      {warningCards((id) => id !== "brief")}
      <div className="workflow-toolbar">
        <div className="workflow-filters">
          {[
            ["selected", "In scope"],
            ["pending", "Decisions needed"],
            ["mine", "Assigned to me"],
            ["review", "My reviews"],
            ["waiting", "Waiting on evidence"],
            ["corrections", "Corrections"],
            ["overdue", "Overdue"],
            ["ready", "Ready to evaluate"],
            ["all", "All candidates"],
          ].map(([v, t]) => (
            <button
              className={v === filter ? "active" : ""}
              aria-pressed={v === filter}
              key={v}
              onClick={() => setFilter(v)}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="workflow-search">
          <Search size={15} />
          <Input
            aria-label="Search audit procedures"
            placeholder="Find a procedure…"
            value={query}
            onChange={(v) => setQuery(v.target.value)}
          />
        </label>
      </div>
      {writer && (
        <div className="planning-selection">
          <label>
            <input
              type="checkbox"
              checked={
                rows.length > 0 && rows.every((p) => batchIds.includes(p.id))
              }
              onChange={(ev) =>
                setBatchIds(
                  ev.target.checked
                    ? [...new Set([...batchIds, ...rows.map((p) => p.id)])]
                    : batchIds.filter((id) => !rows.some((p) => p.id === id)),
                )
              }
            />
            Select visible procedures
          </label>
          <span>{batchIds.length} selected</span>
          <DecisionButton
            size="sm"
            variant="outline"
            state={bulkPlan}
            disabled={busy || !batchIds.length}
            onClick={staffing}
          >
            Assign & schedule
          </DecisionButton>
          {!!batchIds.length && (
            <Button size="sm" variant="ghost" onClick={() => setBatchIds([])}>
              Clear selection
            </Button>
          )}
        </div>
      )}
      <div className="workflow-table">
        <table className="compact-register">
          <thead>
            <tr>
              <th scope="col">Procedure</th>
              <th scope="col">Applicability</th>
              <th scope="col">Owner / due</th>
              <th scope="col">Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {writer && (
                    <input
                      type="checkbox"
                      aria-label={"Select " + p.templateId}
                      checked={batchIds.includes(p.id)}
                      onChange={(ev) =>
                        setBatchIds((ids) =>
                          ev.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                  )}
                  <button
                    className="paper-link"
                    onClick={() => {
                      onOpen(p.id, p.execution ? "execute" : "plan");
                    }}
                  >
                    <small className="subtle block">
                      {p.templateId} · {p.stage}
                    </small>
                    <b>{p.title}</b>
                  </button>
                </td>
                <td data-label="Applicability">
                  {label(p.applicability)}
                  {p.applicability === "pending" &&
                    (() => {
                      const s = art50Suggestion(p);
                      return s && s.applicability !== "pending" ? (
                        <small
                          className="subtle block"
                          data-testid={"art50-suggested-" + p.templateId}
                        >
                          Suggested: {label(s.applicability)}
                        </small>
                      ) : null;
                    })()}
                </td>
                <td data-label="Owner & due date">
                  {name(p.ownerId)}
                  <small className="subtle block">
                    {p.dueDate ||
                      (isReleaseTimeRecord(p.templateId)
                        ? "Recorded at release"
                        : "Deadline needed")}
                  </small>
                </td>
                <td data-label="Next step">
                  <button
                    className="workflow-next"
                    onClick={() => {
                      onOpen(
                        p.id,
                        p.state === "submitted"
                          ? "review"
                          : p.state === "executed"
                            ? "evaluate"
                            : p.execution
                              ? "execute"
                              : "plan",
                      );
                    }}
                  >
                    {procedureLabel(e, p)}
                    <ArrowUpRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>
            {filter === "selected"
              ? "Choose the procedures this audit needs"
              : "No matching procedures"}
          </h3>
          <p>
            {filter === "selected"
              ? "Start with the engagement brief, then assess methodology candidates."
              : "Choose another view or clear the search."}
          </p>
          {writer && filter === "selected" && (
            <Button variant="outline" onClick={() => setFilter("all")}>
              Review all candidates
            </Button>
          )}
        </div>
      )}
      <details className="provenance workflow-history">
        <summary>Program approval and revision history</summary>
        {w.program.approval && (
          <p>
            Approved by {name(w.program.approval.userId)} ·{" "}
            {w.program.approval.reason}
          </p>
        )}
        {w.program.history
          .slice()
          .reverse()
          .map((h, i) => (
            <p key={i}>
              Revision {h.revision} · {h.status} · scope {h.briefRevision} ·{" "}
              {new Date(h.at).toLocaleString()} · {name(h.actor)}
              {h.reason && " · " + h.reason}
            </p>
          ))}
      </details>
    </section>
  );
}
