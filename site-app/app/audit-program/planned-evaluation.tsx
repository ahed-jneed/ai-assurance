"use client";
import { Button } from "@/components/ui/button";
import type { Engagement } from "@/lib/domain/types";
import type { Procedure } from "@/lib/workflow-types";
import { activeProcedureRun } from "@/lib/workflow-state";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { recordsQuery } from "@/lib/assurance-query";
import { datasetCardFor } from "@/lib/dataset-card";
import type { WorkflowAct } from "./workflow-dialog";
const datasetCards = recordsQuery("dataset");
/**
 * "Queue planned evaluation" for an automated procedure. The run pins the
 * dataset card that describes the procedure's accepted dataset bytes, as the
 * Testing lab does, and the note says when no card does. While a run of the
 * procedure is queued or running the button is disabled and "Open queued
 * evaluation" shows that run: the server refuses a duplicate, which would
 * block final issuance.
 */
export function PlannedEvaluation({
  e,
  p,
  tenantId,
  busy,
  act,
  onQueuedRun,
}: {
  e: Engagement;
  p: Procedure;
  tenantId: string;
  busy: boolean;
  act: WorkflowAct;
  onQueuedRun: (runId: string) => void;
}) {
  // The dataset cards, one read shared by every planned evaluation and the
  // Testing lab (lib/assurance-query.ts). A card registered in another tab
  // need not bump the engagement version, so they are read again when the
  // window regains focus.
  const datasets = useAssuranceQuery(
      { tenantId, engagementId: e.id, version: e.version },
      datasetCards,
      { revalidateOnFocus: true },
    ),
    cards = datasets.data ?? null,
    unavailable = !!datasets.error;
  const active = activeProcedureRun(e, p.id),
    dataset = e.artifacts.find(
      (a) => a.id === p.datasetId && a.status === "accepted",
    ),
    card = cards ? datasetCardFor(cards, dataset) : undefined,
    planned = !!p.modelId && !!p.datasetId && !!p.profileId;
  return (
    <>
      <Button
        variant="outline"
        disabled={
          busy ||
          !!active ||
          cards === null ||
          unavailable ||
          e.workflow?.program.status !== "approved" ||
          !planned
        }
        title={
          active
            ? `Evaluation ${active.id} of this procedure is ${active.state}`
            : undefined
        }
        onClick={() =>
          void act("queueRun", {
            procedureId: p.id,
            modelId: p.modelId!,
            datasetId: p.datasetId!,
            profileId: p.profileId!,
            ...(card ? { datasetCardRecordId: card.id } : {}),
          })
            .then((r) => {
              // Shows the queued run; opening the setup again would queue a
              // duplicate.
              if (r.details?.runId) onQueuedRun(r.details.runId);
            })
            .catch(() => {})
        }
      >
        Queue planned evaluation
      </Button>
      {active && (
        <Button variant="outline" onClick={() => onQueuedRun(active.id)}>
          Open {active.state} evaluation
        </Button>
      )}
      {planned && !active && unavailable && (
        <p className="subtle workflow-note" role="alert">
          Dataset cards could not be loaded, so the card to pin is unknown.
          Reload to queue the planned evaluation.
        </p>
      )}
      {planned && !active && cards !== null && !unavailable && (
        <p className="subtle workflow-note" data-testid="planned-card-pin">
          {card
            ? `Pins dataset card ${String(card.body.name ?? card.id)} v${String(card.body.version ?? "")} (${card.id}).`
            : "No dataset card describes the accepted dataset bytes; the run pins no card."}
        </p>
      )}
    </>
  );
}
