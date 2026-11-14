"use client";
// Evaluation setup, step 4 (Review): the frozen request, its pre-registered
// plan and power check, and the acknowledgements a run may need.
import type { Engagement } from "@/lib/domain";
import { describePlan } from "@/lib/hosted-statistics";
import { planSha256 } from "@/lib/statistics";
import { PowerCheck } from "../power-check";
import type { LabSetup } from "./use-lab-setup";

export function ReviewStep({
  engagement: e,
  tenantId,
  busy,
  resolve,
  setup,
}: {
  engagement: Engagement;
  tenantId: string;
  busy: boolean;
  resolve: (id: string) => string;
  setup: LabSetup;
}) {
  const {
    model,
    inspect,
    draft,
    selectedTests,
    planned,
    locked,
    fair,
    special,
    saveOnly,
    acknowledged,
    planForm,
  } = setup;
  return (
    <>
      <dl className="record-fields">
        <div>
          <dt>Model version</dt>
          <dd>
            {model?.name} · {model?.version}
          </dd>
        </div>
        <div>
          <dt>Prediction evidence</dt>
          <dd>
            {model && resolve(model.artifactId)} · {inspect?.rowCount} rows
          </dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>
            {draft.name} · {draft.version} · {draft.datasetContext.split}
          </dd>
        </div>
        <div>
          <dt>Procedures</dt>
          <dd>{selectedTests.map((t) => t.label).join(", ")}</dd>
        </div>
        <div>
          <dt>Pre-registered plan</dt>
          <dd>
            {planned.plan ? (
              <>
                <ul className="record-list">
                  {describePlan(planned.plan).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <small className="subtle">
                  Plan SHA-256 {planSha256(planned.plan)}
                </small>
              </>
            ) : (
              planned.error
            )}
          </dd>
        </div>
        <div>
          <dt>Acceptance rationale</dt>
          <dd>{draft.rationale}</dd>
        </div>
      </dl>
      {planned.plan && !locked && inspect && (
        <PowerCheck
          plan={planned.plan}
          rows={inspect.rowCount}
          dataset={{
            tenantId,
            engagementId: e.id,
            artifactId: inspect.artifactId,
          }}
          groupColumn={
            fair && draft.config.groupColumn ? draft.config.groupColumn : null
          }
          labelColumn={
            draft.task === "Multiclass classification" &&
            draft.suite.includes("performance") &&
            draft.config.labelColumn
              ? draft.config.labelColumn
              : null
          }
          assumptions={draft.plan.powerAssumptions}
          acknowledgement={draft.plan.acknowledgement}
          disabled={busy}
          onAssumptions={(powerAssumptions) => planForm({ powerAssumptions })}
          onAcknowledgement={(acknowledgement) => planForm({ acknowledgement })}
        />
      )}
      <p className="ml-notice">
        Saving freezes the plan: the interval decides each criterion against its
        band, and changing the plan later needs a new protocol version. The run
        freezes the card, artifact hash, protocol and runner definition.
        Supplied predictions and independence declarations require audit
        corroboration. Results create draft working papers for human review.
      </p>
      {draft.datasetContext.split === "training" && (
        <p className="ml-notice">
          Training data measures fit; this run cannot establish independent
          generalization.
        </p>
      )}
      {special && !saveOnly && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(ev) => setup.setAcknowledged(ev.target.checked)}
          />{" "}
          I acknowledge that this run processes the special-category column{" "}
          {draft.config.groupColumn} on this platform under the client&apos;s
          recorded basis, which the run and the report will state.
        </label>
      )}
    </>
  );
}
