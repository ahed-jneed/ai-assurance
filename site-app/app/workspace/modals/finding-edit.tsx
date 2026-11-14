"use client";
import type { Finding } from "@/lib/domain/types";
import { RemediationForm } from "../../finding-forms";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** The remediation form starts from the finding's status and retest files. */
export function remediationDefaults(finding: Finding) {
  return {
    choices: {
      status: finding.status === "open" ? "in_progress" : finding.status,
    },
    checks: Object.fromEntries(
      finding.retestEvidenceIds.map((id) => [id, true]),
    ),
  };
}
function RemediationFields({
  finding,
  engagement: e,
  choices,
  choice,
  checks,
  check,
}: ModalFieldsProps) {
  return (
    finding && (
      <RemediationForm
        finding={finding}
        artifacts={e?.artifacts ?? []}
        choices={choices}
        onChoice={choice}
        checks={checks}
        onCheck={check}
      />
    )
  );
}
/** Records the remediation and retest evidence of a finding. */
export const findingEditModal: ModalDefinition = {
  title: "Remediation & retest",
  submitLabel: "Save remediation",
  Fields: RemediationFields,
  submit: ({ act, finding, choices, checks, values: v, engagement: e }) =>
    finding
      ? act("updateFinding", {
          findingId: finding.id,
          status: choices.status,
          response: v.response,
          remediation: v.remediation,
          retestEvidenceIds: e!.artifacts
            .filter((a) => checks[a.id])
            .map((a) => a.id),
        })
      : undefined,
};
