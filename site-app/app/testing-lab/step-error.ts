// Why the evaluation setup cannot leave its current step yet ("" when it can).
import type { Model } from "@/lib/domain";
import type { Plan } from "@/lib/statistics";
import { powerShortfalls } from "../power-check";
import type { Draft, Inspection } from "./drafts";
import { modelCapability } from "./model-helpers";

export type StepState = {
  step: number;
  model: Model | undefined;
  draft: Draft;
  inspect: Inspection | null;
  /** The suite holds a fairness test. */
  fair: boolean;
  /** A saved protocol is reused, so its criteria are frozen. */
  locked: boolean;
  planned: { plan: Plan; error: "" } | { plan: null; error: string };
  saveOnly: boolean;
  special: boolean;
  hostedRoute: boolean;
  acknowledged: boolean;
};
export function stepError({
  step,
  model,
  draft,
  inspect,
  fair,
  locked,
  planned,
  saveOnly,
  special,
  hostedRoute,
  acknowledged,
}: StepState) {
  if (step === 0)
    return !model
      ? "Choose a registered saved-prediction model."
      : modelCapability(model) !== "Saved predictions ready"
        ? modelCapability(model)
        : draft.task !== model.task
          ? "Protocol and model tasks must match."
          : "";
  if (step === 1) {
    if (!inspect) return "Inspect the dataset before continuing.";
    const required = [
      draft.config.labelColumn,
      draft.config.predictionColumn,
      ...(fair ? [draft.config.groupColumn] : []),
    ];
    if (required.some((c) => !inspect.columns.some((x) => x.name === c)))
      return "Map each required column.";
    if (new Set(required).size !== required.length)
      return "Target, prediction and group must use different columns.";
    if (
      required.some((c) => inspect.columns.find((x) => x.name === c)!.missing)
    )
      return "Mapped columns contain missing values. Correct and register a new prediction artifact.";
    if (
      model?.task === "Regression" &&
      required
        .slice(0, 2)
        .some(
          (c) => inspect.columns.find((x) => x.name === c)?.type !== "numeric",
        )
    )
      return "Regression requires numeric target and prediction columns.";
    if (
      !draft.datasetContext.population.trim() ||
      !draft.datasetContext.predictionProvenance.trim() ||
      !draft.datasetContext.independence.trim()
    )
      return "Record population, prediction provenance and independence.";
    if (
      model?.task === "Binary classification" &&
      !draft.config.positiveLabel.trim()
    )
      return "Record the favourable class label.";
    if (
      !locked &&
      model?.task === "Binary classification" &&
      (!draft.config.negativeLabel?.trim() ||
        draft.config.negativeLabel === draft.config.positiveLabel)
    )
      return "Record the other class label, distinct from the favourable label.";
  }
  if (step === 2) {
    if (fair) {
      const required = [
        draft.config.labelColumn,
        draft.config.predictionColumn,
        draft.config.groupColumn,
      ];
      if (new Set(required).size !== 3)
        return "Target, prediction and protected-group columns must be distinct.";
      if (
        required.some(
          (c) =>
            !inspect?.columns.some((x) => x.name === c) ||
            inspect?.columns.find((x) => x.name === c)?.missing,
        )
      )
        return "Fairness mappings need present, nonmissing columns.";
    }
    if (!draft.suite.length) return "Choose at least one available procedure.";
    if (!draft.name.trim() || !draft.version.trim() || !draft.rationale.trim())
      return "Name the protocol, version and rationale for its criteria.";
    if (
      fair &&
      (!draft.config.groupColumn ||
        !draft.datasetContext.sensitiveDataBasis.trim())
    )
      return "Fairness requires a protected-group column and handling basis.";
    if (!locked && planned.error) return planned.error;
    if (
      !locked &&
      draft.plan.minimumCoverage < 1 &&
      !draft.plan.coverageRationale.trim()
    )
      return "Record why a coverage below 100% is acceptable.";
    if (special && !saveOnly && !hostedRoute)
      return "Special-category fairness tests run client-side by default: save the protocol only and queue it for the external worker or the runtime package, or choose the hosted route with the client's recorded basis.";
  }
  if (
    step === 3 &&
    !locked &&
    planned.plan &&
    powerShortfalls(planned.plan).length &&
    !draft.plan.acknowledgement.trim()
  )
    return "Acknowledge the power shortfall before saving the protocol.";
  if (step === 3 && special && !saveOnly && !acknowledged)
    return "Acknowledge that this run processes special-category data on the platform.";
  return "";
}
