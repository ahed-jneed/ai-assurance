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
/**
 * The release-time records need no preparer, reviewer, deadline, population
 * or sampling in the program: nobody prepares them, and their population is
 * the final package. Program submission asks only for their applicability.
 */
export const releaseTimeAssignmentNote =
  "Recorded at release: no preparer, reviewer, deadline, population or sampling is needed";

/**
 * The completion checklist of the issue-authorisation memo (MEM-SO-01). The
 * independent approver answers it with the approval of both exact packages,
 * and the release copies the answers into its completion record, so the memo
 * holds more than hashes and actors. Our own wording; no standard's text.
 */
export const releaseChecklist = [
  {
    id: "independence",
    label:
      "Independence and competence declarations of the engagement team are current",
  },
  {
    id: "subsequentEvents",
    label: "Events after the period up to this approval were considered",
  },
  {
    id: "representations",
    label: "Written representations from the responsible party were obtained",
  },
  {
    id: "limitations",
    label: "Every scope limitation and unobtainable evidence is disclosed",
  },
  {
    id: "distribution",
    label: "The intended users and any restriction on use are stated",
  },
] as const;
export type ReleaseChecklistId = (typeof releaseChecklist)[number]["id"];
/** An answer: confirmed, or not applicable to this engagement with a basis. */
export const releaseChecklistAnswers = ["confirmed", "not_applicable"] as const;
export type ReleaseChecklistAnswer = (typeof releaseChecklistAnswers)[number];
/** The answers as the approval and the completion record keep them. */
export type ReleaseChecklistRecord = {
  items: { id: ReleaseChecklistId; answer: ReleaseChecklistAnswer }[];
  /** The basis for every not-applicable answer; empty when none. */
  note: string;
};
/** One line per answer, for the memo and the release history. */
export const releaseChecklistLines = (c: ReleaseChecklistRecord) => [
  ...c.items.map(
    (i) =>
      (releaseChecklist.find((x) => x.id === i.id)?.label ?? i.id) +
      ": " +
      (i.answer === "confirmed" ? "confirmed" : "not applicable"),
  ),
  ...(c.note ? ["Basis for not-applicable answers: " + c.note] : []),
];
