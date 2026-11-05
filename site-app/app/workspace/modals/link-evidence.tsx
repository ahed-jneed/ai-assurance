"use client";
import { editableDraft } from "../use-paper-editor";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

function LinkEvidenceFields({
  choices,
  choice,
  engagement: e,
  lead,
}: ModalFieldsProps) {
  return (
    <>
      <label>
        Working paper
        <Choice
          label="Working paper"
          value={choices.paperId ?? ""}
          onChange={(v) => choice("paperId", v)}
          values={
            e?.papers
              .filter(
                (p) =>
                  p.status !== "signed" &&
                  (lead ||
                    p.required ||
                    p.body.conclusionStatus !== "not_applicable"),
              )
              .map((p) => ({
                value: p.id,
                label: p.templateId + " · " + p.title,
              })) ?? []
          }
        />
      </label>
      <p className="subtle">
        The link opens as an unsaved edit. Save a revision to keep it.
      </p>
    </>
  );
}
/** Opens the chosen paper with the evidence linked as an unsaved edit. */
export const linkEvidenceModal: ModalDefinition = {
  title: "Link evidence to a paper",
  submitLabel: "Open paper",
  Fields: LinkEvidenceFields,
  blocked: ({ choices }) => !choices.paperId,
  submit: ({ engagement: e, choices, followUps }) => {
    const paper = e?.papers.find(
      (p) => p.id === choices.paperId && p.status !== "signed",
    );
    if (!paper) throw Error("Choose an unsigned paper");
    const draft = editableDraft(paper);
    draft.evidenceIds = [
      ...new Set([...draft.evidenceIds, choices.artifactId]),
    ];
    if (!followUps.openPaperWithEvidence(paper, draft)) return "keep-open";
  },
};
