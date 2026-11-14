"use client";
// Evaluation setup, step 1 (Model): the model version and the protocol.
import type { Engagement } from "@/lib/domain/types";
import { emptyDraft, profileDraft } from "./drafts";
import { SelectField } from "./lab-ui";
import type { LabSetup } from "./use-lab-setup";

export function ModelStep({
  engagement: e,
  resolve,
  setup,
}: {
  engagement: Engagement;
  resolve: (id: string) => string;
  setup: LabSetup;
}) {
  const { binding, modelId, profileId, model, profiles, runnable } = setup;
  return (
    <>
      {binding && (
        <p className="ml-notice">
          Planned procedure{" "}
          {e.workflow?.procedures.find((p) => p.id === binding.procedureId)
            ?.title ?? binding.procedureId}
          : the approved audit program fixes this model version and protocol.
        </p>
      )}
      <SelectField
        label="Registered model version"
        value={modelId}
        disabled={!!binding}
        onChange={(v) => {
          const m = e.models.find((x) => x.id === v);
          setup.setModelId(v);
          setup.setProfileId("");
          setup.setDraft(emptyDraft(m?.task));
          setup.setError("");
        }}
        options={runnable.map((m) => ({
          value: m.id,
          label: m.name + " · " + m.version + " · " + m.task,
        }))}
      />
      <SelectField
        label="Evaluation protocol"
        value={profileId || "new"}
        disabled={!!binding}
        onChange={(v) => {
          const p = profiles.find((x) => x.id === v);
          setup.setProfileId(p?.id ?? "");
          setup.setDraft(p ? profileDraft(p) : emptyDraft(model?.task));
        }}
        options={[
          { value: "new", label: "Create a new protocol" },
          ...profiles
            .filter((p) => p.task === model?.task)
            .map((p) => ({
              value: p.id,
              label: p.name + " · " + p.version,
            })),
        ]}
      />
      {model && (
        <div className="ml-notice">
          <b>{resolve(model.artifactId)}</b>
          <p>
            Evaluation is bound to this version’s registered prediction file. Up
            to 1 MB, 10,000 rows and 200 columns.
          </p>
        </div>
      )}
    </>
  );
}
