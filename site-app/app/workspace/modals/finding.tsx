"use client";
import type { Procedure } from "@/lib/workflow-types";
import { NewFindingForm } from "../../finding-forms";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** Choices a new finding opens with. */
export const newFindingDefaults = () => ({
  article: "10",
  likelihood: "3",
  impact: "3",
  visibility: "internal",
});
/** A finding raised from a procedure's exception, prefilled from it. */
export const procedureFindingDefaults = (p: Procedure) => ({
  procedureId: p.id,
  title: p.title + " — exception",
  condition: p.execution?.results ?? "",
  criteria: p.criterion,
  article:
    p.candidateRefs.join(" ").match(/(?:Art\.?|Article)\s*(\d+)/i)?.[1] ?? "10",
  likelihood: "3",
  impact: "3",
  visibility: "internal",
});
function FindingFields({ choices, choice, data }: ModalFieldsProps) {
  return (
    <NewFindingForm
      choices={choices}
      onChoice={choice}
      criteria={data?.criteria?.findingCriteria}
    />
  );
}
export const findingModal: ModalDefinition = {
  title: "Record audit finding",
  submitLabel: "Record finding",
  Fields: FindingFields,
  submit: ({ act, choices, values: v, data }) => {
    // A chosen criterion (docs/design/criteria-model.md section 7) also
    // gives the article the registers show; without one, a finding raised
    // from a procedure takes the criteria of its item on the server.
    const criterion = data?.criteria?.findingCriteria?.find(
      (c) => c.reference === choices.criterion,
    );
    return act("createFinding", {
      title: v.title,
      procedureId: choices.procedureId || undefined,
      ...(criterion ? { criteriaRefs: [criterion.reference] } : {}),
      article: criterion?.article ?? choices.article,
      condition: v.condition,
      criteria: v.criteria,
      cause: v.cause,
      effect: v.effect,
      likelihood: Number(choices.likelihood),
      impact: Number(choices.impact),
      owner: v.owner,
      dueDate: v.dueDate,
      visibility: choices.visibility,
    });
  },
};
