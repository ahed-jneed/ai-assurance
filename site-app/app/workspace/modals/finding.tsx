"use client";
import type { Procedure } from "@/lib/workflow-types";
import { citesPackClauses, NewFindingForm } from "../../finding-forms";
import type { WorkspaceData } from "../../workspace-types";
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
/** The pack's primary criteria sets, as the finding form names them. */
const primaryOf = (data: WorkspaceData | null) =>
  data?.criteria?.frameworks.filter((f) => f.role === "primary") ?? [];
/** The pack's clauses are the primary reference (#144). */
const clauseReferences = (data: WorkspaceData | null) =>
  citesPackClauses(primaryOf(data), data?.criteria?.findingCriteria);
function FindingFields({ choices, choice, data }: ModalFieldsProps) {
  return (
    <NewFindingForm
      choices={choices}
      onChoice={choice}
      criteria={data?.criteria?.findingCriteria}
      primary={primaryOf(data)}
    />
  );
}
export const findingModal: ModalDefinition = {
  title: "Record audit finding",
  submitLabel: "Record finding",
  Fields: FindingFields,
  validate: ({ choices, data }) => {
    if (
      clauseReferences(data) &&
      !choices.procedureId &&
      !data?.criteria?.findingCriteria?.some(
        (c) => c.reference === choices.criterion,
      )
    )
      throw Error(
        "Choose the clause of " +
          primaryOf(data)
            .map((f) => f.shortTitle)
            .join(" or ") +
          " the finding concerns.",
      );
  },
  submit: ({ act, choices, values: v, data }) => {
    // A chosen criterion (docs/design/criteria-model.md section 7) also
    // gives the article the registers show; without one, a finding raised
    // from a procedure takes the criteria of its item on the server, and on
    // a pack that cites its clauses (#144) the first of them as its
    // primary reference.
    const criterion = data?.criteria?.findingCriteria?.find(
      (c) => c.reference === choices.criterion,
    );
    return act("createFinding", {
      title: v.title,
      procedureId: choices.procedureId || undefined,
      ...(criterion ? { criteriaRefs: [criterion.reference] } : {}),
      article:
        criterion?.article ??
        (clauseReferences(data) ? undefined : choices.article),
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
