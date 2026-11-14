"use client";
import { Button } from "@/components/ui/button";
import type { Paper } from "@/lib/domain/types";
import { isReleaseTimeRecord } from "@/lib/domain/gates";
import type { Procedure } from "@/lib/workflow-types";
import { currentExecution, executionPlanCurrent } from "@/lib/workflow-state";
import { label, reason } from "./fields";
import { PlannedEvaluation } from "./planned-evaluation";
import type { ProgramScope } from "./program-scope";
/** The execute section of a procedure: guidance, recorded work and evaluations. */
export function ProcedureExecute({
  scope,
  p,
  onLeave,
  onContext,
  onRequest,
  onQueuedRun,
}: {
  scope: ProgramScope;
  p: Procedure;
  /** Closes the procedure sheet. */
  onLeave: () => void;
  onContext: (id: string) => void;
  onRequest: (p: Paper) => void;
  onQueuedRun: (procedureId: string, runId: string) => void;
}) {
  const { data, e, w, uid, busy, act, writer, lead, reviewer, name } = scope,
    { execute, command } = scope.forms,
    b = w.brief;
  return (
    <>
      <details className="captured-record" open={!p.execution}>
        <summary>Planned guidance and expected evidence</summary>
        <ol className="record-list">
          {p.instructions.map((i) => (
            <li key={i.id}>{i.text}</li>
          ))}
        </ol>
        <h3>Expected evidence</h3>
        <ul className="record-list">
          {p.expectedEvidence.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </details>
      {p.execution ? (
        <>
          <p className="subtle">
            Executed by {name(p.execution.actor)} ·{" "}
            {new Date(p.execution.at).toLocaleString()} · scope revision{" "}
            {p.execution.briefRevision} · plan revision{" "}
            {p.execution.procedureRevision}
          </p>
          {!currentExecution(e, p) && (
            <p className="form-error">
              {executionPlanCurrent(p)
                ? "The scope changed after this execution. Reperform it or obtain an independent impact assessment."
                : "This procedure's plan changed after this execution. Record the work performed against the current plan."}
            </p>
          )}
          {[
            ["Performed", p.execution.performed],
            ["Sample", p.execution.sampling],
            ["Results and exceptions", p.execution.results],
            ["Limitations", p.execution.limitations],
          ].map(([t, v]) => (
            <section className="readable-section" key={t}>
              <h3>{t}</h3>
              <p className="record-text">{v || "None recorded"}</p>
            </section>
          ))}
          <ul className="record-list">
            {p.execution.steps.map((s) => (
              <li key={s.id}>
                {p.instructions.find((i) => i.id === s.id)?.text}{" "}
                <b>{label(s.state)}</b>
                <p>{s.notes}</p>
              </li>
            ))}
          </ul>
          <h3>Evidence</h3>
          <ul className="record-list">
            {p.execution.evidenceIds.map((id) => (
              <li key={id}>
                {e.artifacts.find((a) => a.id === id)?.name ??
                  "Unavailable evidence"}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty-result">No execution has been recorded.</p>
      )}
      {isReleaseTimeRecord(p.templateId) && (
        <p className="subtle">
          Recorded at release. Approving and releasing the final package records{" "}
          {p.templateId} against both package hashes, so it is not executed or
          signed here and counts towards no gate.
        </p>
      )}
      <div className="row-actions">
        {writer && !isReleaseTimeRecord(p.templateId) && (
          <Button
            disabled={
              busy ||
              w.program.status !== "approved" ||
              b?.status !== "approved" ||
              !p.selected ||
              p.state === "submitted" ||
              (p.ownerId !== uid && !lead)
            }
            title={
              p.ownerId !== uid && !lead
                ? "Assigned preparer: " + name(p.ownerId)
                : undefined
            }
            onClick={() => execute(p)}
          >
            {p.execution ? "Record new execution" : "Record work performed"}
          </Button>
        )}
        {writer && !isReleaseTimeRecord(p.templateId) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act("ensureProcedurePaper", {
                procedureId: p.id,
              })
                .then((r) => {
                  const q = r.engagement.papers.find(
                    (q) => q.id === r.details?.paperId,
                  );
                  onContext(p.id);
                  onLeave();
                  if (q) onRequest(q);
                })
                .catch(() => {})
            }
          >
            Request evidence
          </Button>
        )}
        {writer && p.method !== "manual" && (
          <PlannedEvaluation
            e={e}
            p={p}
            tenantId={data.tenantId}
            busy={busy}
            act={act}
            onQueuedRun={(runId) => {
              onLeave();
              onQueuedRun(p.id, runId);
            }}
          />
        )}
        {reviewer &&
          p.execution &&
          !currentExecution(e, p) &&
          executionPlanCurrent(p) && (
            <Button
              variant="outline"
              disabled={busy || p.contributors.includes(uid)}
              onClick={() =>
                command(
                  "Review scope impact on previous execution",
                  "reaffirmExecution",
                  reason(),
                  { procedureId: p.id },
                )
              }
            >
              Assess scope impact
            </Button>
          )}
      </div>
      <p className="subtle workflow-note">
        Approve scope and program before recording execution. Automated methods
        require a completed evaluation using the pinned model, dataset and
        protocol.
      </p>
    </>
  );
}
