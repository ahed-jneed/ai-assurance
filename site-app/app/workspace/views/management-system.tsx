"use client";
// Management-system audits (#28): programme phases (Stage 1 before Stage 2)
// and the organisation's Statement of Applicability in the Regulatory mapping
// view, and graded nonconformities with corrective action plans in Findings.
// The server enforces every rule shown here (lib/commands/management-system.ts
// and lib/domain/management-system.ts).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ManagementSystemView } from "@/lib/criteria/types";
import type { Engagement, Finding } from "@/lib/domain";
import {
  gradeSummary,
  implementationStates,
  isNonconformity,
  nonconformityGradeIds,
  nonconformityGrades,
  soaReviewed,
  soaRows,
  soaSummary,
  type SoaRow,
} from "@/lib/domain/management-system";
import type { SoaEntry } from "@/lib/domain/types";

type Act = (op: string, values: Record<string, unknown>) => void;
type Implementation = NonNullable<SoaEntry["implementation"]>;
const implementationIds = Object.keys(implementationStates) as Implementation[];

/** Stage 1 and Stage 2 with the papers of each and how many are signed. */
export function ProgrammePhases({
  engagement: e,
  view,
}: {
  engagement: Engagement;
  view: ManagementSystemView;
}) {
  if (!view.phases.length) return null;
  return (
    <section className="panel management-phases" aria-label="Programme phases">
      <div className="panel-head">
        <h2>Programme phases</h2>
        <span className="subtle">
          Papers of a later phase are signed once every paper of the earlier
          phase is signed.
        </span>
      </div>
      <ol className="content-pad phase-list">
        {view.phases.map((phase) => {
          const papers = e.papers.filter(
            (p) =>
              !p.supersededBy &&
              !p.retired &&
              phase.templateIds.includes(p.templateId),
          );
          const signed = papers.filter((p) => p.status === "signed").length;
          return (
            <li key={phase.id}>
              <strong>{phase.title}</strong>{" "}
              <span className="subtle">
                {papers.length
                  ? `${signed} of ${papers.length} papers signed`
                  : "no papers yet"}
              </span>
              <ul>
                {phase.templateIds.map((id) => {
                  const p = papers.find((q) => q.templateId === id);
                  return (
                    <li key={id}>
                      <code>{id}</code> {p ? p.title : "not started"}
                      {p && <span className="badge">{p.status}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The organisation's Statement of Applicability as the auditors record it. */
export function StatementOfApplicability({
  engagement: e,
  view,
  writer,
  reviewer,
  userId,
  busy,
  act,
}: {
  engagement: Engagement;
  view: ManagementSystemView;
  writer: boolean;
  reviewer: boolean;
  userId: string;
  busy: boolean;
  act: Act;
}) {
  const rows = soaRows(view.controls, e);
  const summary = soaSummary(rows);
  const soa = e.statementOfApplicability;
  const reviewed = soaReviewed(e);
  const recorder = !!soa?.entries.some((x) => x.actor === userId);
  const [note, setNote] = useState("");
  if (!view.controls.length) return null;
  return (
    <section
      className="panel statement-of-applicability"
      aria-label="Statement of Applicability"
    >
      <div className="panel-head">
        <h2>Statement of Applicability</h2>
        <span className="subtle">
          {view.controlsFramework} Annex A · {summary.decided} of{" "}
          {summary.controls} controls decided · {summary.included} included ·{" "}
          {summary.excluded} excluded
        </span>
      </div>
      <div className="content-pad">
        <p className="subtle">
          Record the organisation&apos;s decision for each control as its
          Statement of Applicability states it, with the justification and the
          implementation status. Clause numbers and our own titles only: read
          each control in your licensed copy of the standard.
        </p>
        <p role="status">
          {reviewed
            ? `Revision ${soa!.revision} reviewed by ${soa!.review!.by} on ${soa!.review!.at.slice(0, 10)}.`
            : summary.incomplete
              ? `${summary.incomplete} of ${summary.controls} controls still need a justified decision.`
              : `Revision ${soa?.revision ?? 0} is complete and awaits an independent review.`}
        </p>
        {reviewer && !reviewed && !summary.incomplete && (
          <div className="soa-review">
            <label>
              Review note
              <input
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                maxLength={5000}
              />
            </label>
            <Button
              disabled={busy || recorder}
              title={
                recorder
                  ? "You recorded decisions in this Statement of Applicability; someone else reviews it"
                  : undefined
              }
              onClick={() => act("reviewSoa", { note })}
            >
              Review Statement of Applicability
            </Button>
          </div>
        )}
        <table className="soa-table">
          <thead>
            <tr>
              <th scope="col">Control</th>
              <th scope="col">Decision</th>
              <th scope="col">Implementation</th>
              <th scope="col">Justification</th>
              <th scope="col">
                <span className="sr-only">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SoaRowEditor
                key={row.id + ":" + (row.entry?.at ?? "")}
                row={row}
                writer={writer}
                busy={busy}
                act={act}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SoaRowEditor({
  row,
  writer,
  busy,
  act,
}: {
  row: SoaRow;
  writer: boolean;
  busy: boolean;
  act: Act;
}) {
  const [decision, setDecision] = useState(
    row.entry ? (row.entry.included ? "included" : "excluded") : "",
  );
  const [implementation, setImplementation] = useState<string>(
    row.entry?.implementation ?? "",
  );
  const [justification, setJustification] = useState(
    row.entry?.justification ?? "",
  );
  const included = decision === "included";
  const dirty =
    decision !==
      (row.entry ? (row.entry.included ? "included" : "excluded") : "") ||
    implementation !== (row.entry?.implementation ?? "") ||
    justification !== (row.entry?.justification ?? "");
  const label = row.ref + " " + row.title;
  return (
    <tr className={row.problem ? "soa-incomplete" : undefined}>
      <th scope="row">
        <code>{row.ref}</code> {row.title}
        <span className="subtle block">{row.group}</span>
        {row.problem && <span className="subtle block">{row.problem}</span>}
      </th>
      <td>
        <select
          aria-label={"Decision for " + label}
          value={decision}
          disabled={!writer || busy}
          onChange={(ev) => {
            setDecision(ev.target.value);
            if (ev.target.value !== "included") setImplementation("");
          }}
        >
          <option value="">Not decided</option>
          <option value="included">Included</option>
          <option value="excluded">Excluded</option>
        </select>
      </td>
      <td>
        <select
          aria-label={"Implementation of " + label}
          value={implementation}
          disabled={!writer || busy || !included}
          onChange={(ev) => setImplementation(ev.target.value)}
        >
          <option value="">{included ? "Not stated" : "Not applicable"}</option>
          {implementationIds.map((id) => (
            <option key={id} value={id}>
              {implementationStates[id]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          aria-label={"Justification for " + label}
          value={justification}
          maxLength={5000}
          disabled={!writer || busy}
          onChange={(ev) => setJustification(ev.target.value)}
        />
      </td>
      <td>
        {writer && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !dirty || !decision}
            aria-label={"Save the decision for " + label}
            onClick={() =>
              act("recordSoaEntry", {
                control: row.id,
                included,
                justification,
                ...(included && implementation ? { implementation } : {}),
              })
            }
          >
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Graded nonconformities and their corrective action plans. */
export function Nonconformities({
  engagement: e,
  writer,
  reviewer,
  userId,
  busy,
  act,
}: {
  engagement: Engagement;
  writer: boolean;
  reviewer: boolean;
  userId: string;
  busy: boolean;
  act: Act;
}) {
  const open = e.findings.filter((f) => f.status !== "closed");
  return (
    <section className="panel nonconformities" aria-label="Nonconformities">
      <div className="panel-head">
        <h2>Nonconformity grading</h2>
        <span className="subtle">
          {gradeSummary(e.findings)
            .map(
              (g) =>
                `${g.short} ${g.unresolved} open` +
                (g.awaitingPlan
                  ? ` (${g.awaitingPlan} without accepted plan)`
                  : ""),
            )
            .join(" · ")}
        </span>
      </div>
      <div className="content-pad">
        <dl className="grade-guidance">
          {nonconformityGradeIds.map((g) => (
            <div key={g}>
              <dt>{nonconformityGrades[g].label}</dt>
              <dd className="subtle">{nonconformityGrades[g].guidance}</dd>
            </div>
          ))}
        </dl>
        {open.length ? (
          <ul className="nonconformity-list">
            {open.map((f) => (
              <NonconformityRow
                key={f.id + ":" + (f.gradeHistory?.length ?? 0)}
                finding={f}
                writer={writer}
                reviewer={reviewer}
                userId={userId}
                busy={busy}
                act={act}
              />
            ))}
          </ul>
        ) : (
          <p className="subtle">No unresolved findings to grade.</p>
        )}
      </div>
    </section>
  );
}

function NonconformityRow({
  finding: f,
  writer,
  reviewer,
  userId,
  busy,
  act,
}: {
  finding: Finding;
  writer: boolean;
  reviewer: boolean;
  userId: string;
  busy: boolean;
  act: Act;
}) {
  const [grade, setGrade] = useState<string>(f.grade ?? "");
  const [rationale, setRationale] = useState("");
  const plan = f.correctiveAction;
  const [form, setForm] = useState({
    correction: plan?.correction ?? "",
    rootCause: plan?.rootCause ?? "",
    action: plan?.action ?? "",
    owner: plan?.owner ?? f.owner,
    dueDate: plan?.dueDate ?? f.dueDate,
  });
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={form[key]}
        disabled={!writer || busy}
        onChange={(ev) => setForm({ ...form, [key]: ev.target.value })}
      />
    </label>
  );
  const planComplete = Object.values(form).every((v) => v.trim());
  return (
    <li className="nonconformity">
      <div>
        <strong>{f.id}</strong> {f.title}{" "}
        <span className="badge">
          {f.grade ? nonconformityGrades[f.grade].label : "Not graded"}
        </span>{" "}
        <span className="subtle">
          {f.article} · {f.severity} risk · {f.status.replaceAll("_", " ")}
        </span>
      </div>
      {writer && (
        <div className="grade-form">
          <label>
            Grade
            <select
              aria-label={"Grade of " + f.id}
              value={grade}
              disabled={busy}
              onChange={(ev) => setGrade(ev.target.value)}
            >
              <option value="">Choose a grade</option>
              {nonconformityGradeIds.map((g) => (
                <option key={g} value={g}>
                  {nonconformityGrades[g].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason for the grade
            <input
              aria-label={"Reason for the grade of " + f.id}
              value={rationale}
              maxLength={5000}
              disabled={busy}
              onChange={(ev) => setRationale(ev.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !grade || !rationale.trim()}
            onClick={() =>
              act("gradeNonconformity", {
                findingId: f.id,
                grade,
                rationale,
              })
            }
          >
            Record grade
          </Button>
        </div>
      )}
      {isNonconformity(f) && (
        <details open={!plan?.accepted}>
          <summary>
            Corrective action plan:{" "}
            {plan?.accepted
              ? `accepted by ${plan.accepted.by} on ${plan.accepted.at.slice(0, 10)}`
              : plan
                ? "recorded, awaiting acceptance"
                : "not recorded"}
          </summary>
          <div className="corrective-action">
            {field("correction", "Correction")}
            {field("rootCause", "Root cause")}
            {field("action", "Corrective action")}
            {field("owner", "Owner")}
            {field("dueDate", "Due date", "date")}
            {writer && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !planComplete}
                onClick={() =>
                  act("recordCorrectiveAction", { findingId: f.id, ...form })
                }
              >
                Record plan
              </Button>
            )}
            {reviewer && plan && !plan.accepted && (
              <Button
                size="sm"
                disabled={busy || plan.recordedBy === userId}
                title={
                  plan.recordedBy === userId
                    ? "You recorded this plan; someone else accepts it"
                    : undefined
                }
                onClick={() =>
                  act("acceptCorrectiveAction", { findingId: f.id, note: "" })
                }
              >
                Accept plan
              </Button>
            )}
          </div>
        </details>
      )}
    </li>
  );
}
