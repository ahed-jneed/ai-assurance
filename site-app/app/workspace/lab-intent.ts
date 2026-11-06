import { useCallback, useEffect, useReducer } from "react";
import type { Engagement, EvaluationProfile, Model, Run } from "@/lib/domain";
import { activeProcedureRun } from "@/lib/workflow-state";

/**
 * Work another module hands to the Testing lab. The lab opens with it once:
 * it consumes the intent when it has applied it, and the workspace drops it
 * on an engagement or practice change and when another view opens. Nothing
 * of it stays selected for a later evaluation.
 *
 * - `evaluate`: the Assurance workbench's "Review & run evaluation" opens
 *   the evaluation setup for an approved procedure, pinning the dataset card
 *   chosen there to that one evaluation.
 * - `showRun`: shows a run, such as the one "Queue planned evaluation" in
 *   the audit program just queued, or a queued run that blocks issuance.
 */
export type PendingLabIntent =
  | {
      kind: "evaluate";
      engagementId: string;
      procedureId: string;
      datasetCardRecordId: string;
    }
  | { kind: "showRun"; engagementId: string; runId: string };

export type LabIntentEvent =
  | { type: "request"; intent: PendingLabIntent }
  | { type: "consume"; intent: PendingLabIntent }
  | { type: "clear" };

export function labIntentReducer(
  pending: PendingLabIntent | null,
  event: LabIntentEvent,
): PendingLabIntent | null {
  if (event.type === "request") return event.intent;
  // A newer request made while the lab applied an older one stays pending.
  if (event.type === "consume")
    return pending === event.intent ? null : pending;
  return null;
}

/** What the lab does with an intent for the engagement it shows. */
export type LabIntentAction =
  | {
      kind: "evaluate";
      procedureId: string;
      datasetCardRecordId: string;
      model: Model;
      profile: EvaluationProfile;
    }
  | { kind: "showRun"; run: Run }
  | { kind: "none" };

export function resolveLabIntent(
  intent: PendingLabIntent,
  e: Engagement,
): LabIntentAction {
  if (intent.engagementId !== e.id) return { kind: "none" };
  if (intent.kind === "showRun") {
    const run = e.runs.find((r) => r.id === intent.runId);
    return run ? { kind: "showRun", run } : { kind: "none" };
  }
  // A planned evaluation already waiting for this procedure is shown rather
  // than queueing a duplicate that would block final issuance.
  const pending = activeProcedureRun(e, intent.procedureId);
  if (pending) return { kind: "showRun", run: pending };
  const p = e.workflow?.procedures.find((p) => p.id === intent.procedureId),
    model = e.models.find((m) => m.id === p?.modelId),
    profile = e.evaluationProfiles?.find((x) => x.id === p?.profileId);
  return p && model && profile
    ? {
        kind: "evaluate",
        procedureId: p.id,
        datasetCardRecordId: intent.datasetCardRecordId,
        model,
        profile,
      }
    : { kind: "none" };
}

/** The pending lab intent; `view` is the open workspace view. */
export function useLabIntent(view: string) {
  const [intent, dispatch] = useReducer(labIntentReducer, null);
  const request = useCallback(
    (next: PendingLabIntent) => dispatch({ type: "request", intent: next }),
    [],
  );
  const consume = useCallback(
    (used: PendingLabIntent) => dispatch({ type: "consume", intent: used }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  // An intent the lab never opened with, for example because another view
  // was chosen while the lab loaded, must not apply on a later visit.
  useEffect(() => {
    if (view !== "Testing lab") clear();
  }, [view, clear]);
  return { intent, request, consume, clear };
}
export type LabIntentState = ReturnType<typeof useLabIntent>;
