// The gates of final report capture that the engagement record decides: the
// final-report gates and the incomplete per-group LL144 runs (#144). The
// server's createReport refuses final capture on exactly these (plus the
// queued external execution and the assurance blockers, which it reads from
// the assurance store), and every UI list of what blocks final capture shows
// exactly these (#202): the completion checklist, the Reports & sign-off
// banner and the report dialog's "Outstanding at capture".
import { incompleteLl144Runs, incompleteRunMessage } from "../ll144-audit";
import {
  finalReportGates,
  type AuditGate,
  type FinalReport,
  type GateFeatures,
} from "./gates";
import type { Engagement } from "./types";

/**
 * One gate per LL144 per-group run with some but not all of its audits
 * approved: a final report would carry an incomplete bias audit.
 */
export function ll144RunGates(e: Pick<Engagement, "ll144Audits">): AuditGate[] {
  return incompleteLl144Runs(e.ll144Audits ?? []).map((r) => ({
    id: "ll144:" + r.runId,
    kind: "ll144",
    recordId: r.runId,
    title: `Approve every group of LL144 run ${r.runId} (${r.approved} of ${r.groups} approved)`,
    message: incompleteRunMessage(r),
  }));
}

/**
 * What blocks final capture in the engagement record: the final-report gates
 * (the stage gate first when there is one) followed by the incomplete LL144
 * runs.
 */
export function captureGates(
  e: Engagement,
  report: FinalReport | string = "readiness",
  features?: GateFeatures,
): AuditGate[] {
  return [...finalReportGates(e, report, features), ...ll144RunGates(e)];
}
