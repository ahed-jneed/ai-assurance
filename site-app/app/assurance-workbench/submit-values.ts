import type { AssuranceRecord } from "@/lib/assurance-core";
import type { Exclusion, FeatureRow, Field, Relation } from "./types";

/** The form state that the submitted values take besides the form's inputs. */
export type FormState = {
  fields: Field[] | undefined;
  known: ReadonlyMap<string, AssuranceRecord>;
  sourceIds: string[];
  features: FeatureRow[];
  relations: Relation[];
  exclusions: Exclusion[];
  affectedIds: string[];
  preset: Record<string, string>;
  revision: AssuranceRecord | null;
};

/**
 * The POST /api/assurance data of a submitted form, or the error that keeps
 * it from being sent. `formData` is the submitted form's data.
 */
export function submitValues(
  form: string,
  formData: FormData,
  state: FormState,
): { values: Record<string, unknown> } | { error: string } {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  let values: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(raw))
    if (!v && !state.fields?.find((f) => f.name === k)?.required)
      delete values[k];

  if (form === "obligationDecision") {
    const { evidenceId, ...rest } = raw;
    values = { ...rest, evidenceIds: evidenceId ? [evidenceId] : [] };
  }

  if (form === "exportBriefing")
    values = {
      ...raw,
      sourceIds: state.sourceIds.filter(
        (id) => state.known.get(id)?.kind === "location",
      ),
    };

  if (form === "registerSystem") {
    const { modelId, semantics, classOrder, threshold, ...rest } = raw;
    values = {
      ...rest,
      pipelineArtifactId: raw.pipelineArtifactId || undefined,
      deploymentArtifactId: raw.deploymentArtifactId || undefined,
      modelIds: [modelId],
      features: state.features,
      outputs: {
        semantics,
        classOrder: classOrder
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        threshold: threshold ? Number(threshold) : null,
      },
    };
  }

  if (form === "registerPrediction")
    values = {
      ...raw,
      producedAt: new Date(raw.producedAt + "Z").toISOString(),
    };

  if (form === "addAssertion" && state.relations.some((r) => !r.locationId))
    return {
      error:
        "Choose the precise source of each source relationship, or remove it.",
    };
  if (form === "addAssertion")
    values = {
      ...values,
      missingEvidence: raw.missingEvidence ?? "",
      procedureId: raw.procedureId || undefined,
      paperId: raw.paperId || undefined,
      relations: state.relations.filter((r) => r.locationId),
    };

  if (form === "addLocation")
    values = { ...raw, parser: "manual-transcription" };

  if (form === "queueExternal")
    values = {
      ...values,
      ...(state.preset.datasetCardRecordId
        ? { datasetCardRecordId: state.preset.datasetCardRecordId }
        : {}),
    };

  if (form === "sample")
    values = {
      ...raw,
      procedureId: raw.procedureId || undefined,
      size: Number(raw.size),
      seed: Number(raw.seed),
      exclusions: state.exclusions.filter((x) => x.recordId || x.reason),
    };

  if (form === "impact") values = { ...raw, affectedIds: state.affectedIds };

  if (form === "setAccess") values = { ...raw, active: raw.active === "true" };

  if (form === "enrollWorker")
    values = { ...raw, formats: [...formData.getAll("formats")] };

  if (state.revision) values.supersedesId = state.revision.id;
  return { values };
}

/** Saves the exported briefing packet and its exporter trust as JSON files. */
export function downloadPacket(packet: unknown, trust: unknown) {
  for (const [name, value] of [
    ["authorized-source-packet.json", packet],
    ["exporter-trust.json", trust],
  ]) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = String(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
