import { canWrite } from "./domain";
import type { Artifact, Finding, Role } from "./domain";
import { can } from "./permissions";

export function findingWorkflow(
  finding: Finding,
  artifacts: Artifact[],
  role: Role,
  userId: string,
) {
  const showRetest =
    can(role, "recordFindingRetest") && finding.status === "ready_for_retest";
  const independent =
    finding.createdBy !== userId && finding.remediationBy !== userId;
  const evidenceReady =
    finding.retestEvidenceIds.length > 0 &&
    finding.retestEvidenceIds.every((id) =>
      artifacts.some((a) => a.id === id && a.status === "accepted"),
    );
  const reason = !showRetest
    ? ""
    : !independent
      ? "An independent reviewer must confirm this retest."
      : !finding.remediation.trim()
        ? "Record the remediation and retest procedures first."
        : !evidenceReady
          ? "Link accepted retest evidence before confirming closure."
          : "";
  return {
    canRemediate: canWrite(role) && finding.status !== "closed",
    showRetest,
    canRetest: showRetest && !reason,
    reason,
  };
}
