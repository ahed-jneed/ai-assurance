// The release-time completion and issue records (WP-RP-02 and MEM-SO-01).
// Their evidence is the final package itself, so requiring them before
// capture would be circular: approving and releasing the package records
// them, bound to the captured package hashes (Release.completion). They are
// never prepared, executed or signed as working papers or procedures, and no
// gate or progress count asks for them. Kept apart from gates.ts so the
// workflow state module can use it without an import cycle.
export const releaseTimeTemplates: readonly string[] = [
  "WP-RP-02",
  "MEM-SO-01",
];
export const isReleaseTimeRecord = (templateId: string) =>
  releaseTimeTemplates.includes(templateId);
/** Why a release-time record refuses preparation, execution and signing. */
export const releaseTimeMessage = (templateId: string) =>
  templateId +
  " is recorded at release: approving and releasing the final package records it against both package hashes, so it is not prepared, executed or signed here";
