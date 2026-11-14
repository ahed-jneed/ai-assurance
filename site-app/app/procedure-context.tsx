"use client";
import { useMemo } from "react";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { recordsQuery } from "@/lib/assurance-query";
import { CheckCircle2, Circle } from "lucide-react";
import { procedureReadiness } from "@/lib/procedure-readiness";
import { procedureWork } from "@/lib/work-items";
import { planPinsCurrent } from "@/lib/workflow-state";
import type { Engagement } from "@/lib/domain";
import type { Procedure } from "@/lib/workflow-types";
const sampleRecords = recordsQuery("sample");

export function ProcedureContext({
  tenantId,
  engagement: e,
  procedure: p,
  onRecord,
}: {
  tenantId: string;
  engagement: Engagement;
  procedure: Procedure;
  onRecord: (title: string, value: unknown) => void;
}) {
  // The engagement's samples, read once per engagement version and shared
  // by every procedure (lib/assurance-query.ts); a failed read shows none.
  const all = useAssuranceQuery(
      { tenantId, engagementId: e.id, version: e.version },
      sampleRecords,
    ).data,
    samples = useMemo(
      () => (all ?? []).filter((r) => r.body.procedureId === p.id),
      [all, p.id],
    );
  const x = procedureWork(e, p.id)!,
    ids = new Set([
      ...(p.execution?.evidenceIds ?? []),
      ...x.requests.flatMap((r) => r.evidenceIds),
    ]),
    artifacts = e.artifacts.filter((a) => ids.has(a.id)),
    runs = e.runs.filter(
      (r) =>
        p.execution?.runIds.includes(r.id) ||
        r.procedureBinding?.procedureId === p.id,
    ),
    findings = e.findings.filter((f) => f.support?.procedureId === p.id);
  const readiness = procedureReadiness(e, p);
  return (
    <div className="procedure-work-context">
      {readiness.kind === "checks" ? (
        <details open>
          <summary>Procedure readiness</summary>
          <ul>
            {readiness.checks.map(([text, done]) => (
              <li key={text}>
                {done ? (
                  <CheckCircle2 size={16} color="#477a59" aria-hidden="true" />
                ) : (
                  <Circle size={16} color="#6f757d" aria-hidden="true" />
                )}
                <span className="sr-only">
                  {done ? "Done: " : "Not done: "}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <details open>
          <summary>Release record</summary>
          <ul>
            <li>
              {readiness.recorded ? (
                <CheckCircle2 size={16} color="#477a59" aria-hidden="true" />
              ) : (
                <Circle size={16} color="#6f757d" aria-hidden="true" />
              )}
              <span className="sr-only">
                {readiness.recorded ? "Done: " : "Not done: "}
              </span>
              <span>{readiness.text}</span>
            </li>
          </ul>
        </details>
      )}
      <details>
        <summary>
          Connected evidence & decisions (
          {artifacts.length +
            x.requests.length +
            runs.length +
            findings.length +
            samples.length}
          )
        </summary>
        {x.requests.map((r) => (
          <button
            key={r.id}
            className="related-record-button"
            onClick={() => onRecord(r.subject, r)}
          >
            {r.subject}
            <small>
              Request · {r.status}
              {r.dueDate ? " · due " + r.dueDate : ""}
            </small>
          </button>
        ))}
        {artifacts.map((a) => (
          <button
            key={a.id}
            className="related-record-button"
            onClick={() => onRecord(a.name, a)}
          >
            {a.name}
            <small>Evidence · {a.status}</small>
          </button>
        ))}
        {runs.map((r) => (
          <button
            key={r.id}
            className="related-record-button"
            onClick={() => onRecord("Evaluation · " + r.id, r)}
          >
            {e.models.find((m) => m.id === r.modelId)?.name ?? "Evaluation"}
            <small>
              {r.state} · {r.outcome ?? "No diagnostic outcome"}
            </small>
          </button>
        ))}
        {findings.map((f) => (
          <button
            key={f.id}
            className="related-record-button"
            onClick={() => onRecord(f.title, f)}
          >
            {f.title}
            <small>
              Finding · {f.severity} · {f.status}
            </small>
          </button>
        ))}
        {samples.map((s) => (
          <button
            key={s.id}
            className="related-record-button"
            onClick={() => onRecord("Sample manifest", s)}
          >
            Sample · {s.body.method}
            <small>
              {planPinsCurrent(e, p, s.body)
                ? "Current planning pins"
                : "Earlier planning pins"}{" "}
              · {new Date(s.createdAt).toLocaleString()}
            </small>
          </button>
        ))}
        {!samples.length &&
          !artifacts.length &&
          !x.requests.length &&
          !runs.length &&
          !findings.length && <p className="subtle">No related records yet.</p>}
      </details>
    </div>
  );
}
