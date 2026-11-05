import { useState } from "react";

/**
 * What the Testing lab opens with when another module hands work to it. The
 * only hand-off today is "run hosted evaluation" in the Assurance workbench
 * (handOffToLab in use-workspace-navigation.ts), which opens the lab on a
 * procedure with a dataset card.
 *
 * Known defects, fixed in #15 rather than in this refactor: neither field is
 * consumed. The dataset card stays selected for every later evaluation, also
 * after switching engagement or practice (F-07), and the procedure is the
 * shared procedure context, so the lab reopens its wizard on every visit
 * (F-33). The fix belongs here: keep the procedure in the intent itself and
 * clear the intent once the lab has used it and in openEngagement and
 * changePractice.
 */
export type PendingLabIntent = {
  procedureId: string | undefined;
  datasetCardRecordId: string;
};

export function useLabIntent(procedureContext: string | undefined) {
  const [datasetCardRecordId, setDatasetCardRecordId] = useState("");
  const intent: PendingLabIntent = {
    procedureId: procedureContext,
    datasetCardRecordId,
  };
  return { intent, setDatasetCardRecordId };
}
export type LabIntentState = ReturnType<typeof useLabIntent>;
