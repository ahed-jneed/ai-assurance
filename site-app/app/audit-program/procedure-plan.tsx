"use client";
import type { Procedure } from "@/lib/workflow-types";
import { decisionState } from "@/lib/permissions";
import { DecisionButton } from "../workspace/decision-button";
import { Art50StatisticalCriteria, Art50Suggestion } from "./art50-plan";
import { label } from "./fields";
import type { ProgramScope } from "./program-scope";
/** The plan section of a procedure. */
export function ProcedurePlan({
  scope,
  p,
}: {
  scope: ProgramScope;
  p: Procedure;
}) {
  const { e, uid, role, busy, name, art50Suggestion, catalogItem } = scope,
    { planForm } = scope.forms,
    // Planning narrows to a Lead Auditor once the program is submitted.
    planState = decisionState(role, uid, {
      action: "saveProcedurePlan",
      engagement: e,
    });
  return (
    <>
      <dl className="document-properties">
        <div>
          <dt>Preparer</dt>
          <dd>{name(p.ownerId)}</dd>
        </div>
        <div>
          <dt>Reviewer</dt>
          <dd>{name(p.reviewerId)}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{p.dueDate || "Not set"}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>
            {p.selected ? "Selected" : "Outside agreed scope"} ·{" "}
            {label(p.applicability)}
          </dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{label(p.method)}</dd>
        </div>
      </dl>
      {[
        ["Objective", p.objective],
        ["Criterion", p.criterion],
        ["Source", p.sourceVersion],
        ["Applicability and scope rationale", p.rationale],
        ["Period analysis", p.periodAnalysis],
        ["Population", p.population],
        ["Planned sampling", p.sampling],
      ].map(([title, value]) => (
        <section className="readable-section" key={title}>
          <h3>{title}</h3>
          <p className="record-text">{value || "Needs planning"}</p>
        </section>
      ))}
      {(() => {
        const s = art50Suggestion(p);
        return s ? (
          <Art50Suggestion
            suggestion={s}
            current={p.applicability}
            canUse={planState.allowed && !busy}
            onUse={(s) => planForm(p, s)}
          />
        ) : null;
      })()}
      <Art50StatisticalCriteria
        procedureIds={
          catalogItem(p.templateId)?.researchProcedures?.procedures.map(
            (r) => r.procedureId,
          ) ?? []
        }
      />
      <DecisionButton
        state={planState}
        disabled={busy}
        onClick={() => planForm(p)}
      >
        Edit plan
      </DecisionButton>
    </>
  );
}
