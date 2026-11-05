"use client";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

function PaperFields({ choices, choice, data }: ModalFieldsProps) {
  return (
    <label>
      Methodology template
      <Choice
        value={choices.templateId ?? ""}
        onChange={(v) => choice("templateId", v)}
        label="Template"
        values={
          data?.catalog?.items.map((t) => ({
            value: t.id,
            label: t.id + " · " + t.title,
          })) ?? []
        }
      />
    </label>
  );
}
export const paperModal: ModalDefinition = {
  title: "New working paper or memo",
  submitLabel: "Create paper",
  Fields: PaperFields,
  validate: ({ choices }) => {
    if (!choices.templateId)
      throw Error("Choose a methodology template before creating the paper.");
  },
  submit: async ({ act, choices, followUps }) => {
    const result = await act("createPaper", {
      templateId: choices.templateId,
    });
    const paper = result.engagement.papers.find(
      (p) => p.id === result.details?.paperId,
    );
    if (paper) followUps.showCreatedPaper(paper);
  },
};
