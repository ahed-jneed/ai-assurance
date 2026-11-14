"use client";
// The Register model version dialog: a model card pinned to an accepted
// prediction dataset or a quarantined model artifact.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tasks } from "@/lib/evaluation";
import type { Engagement } from "@/lib/domain/types";
import { Field, SelectField } from "./lab-ui";
import type { LabSetup } from "./use-lab-setup";

const formats = [
  "Prediction file",
  "Scikit-learn",
  "XGBoost",
  "LightGBM",
  "ONNX",
  "PMML",
  "Other model binary",
];
const cardFields = {
  population: "Intended population",
  outOfScope: "Out-of-scope uses",
  limitations: "Known limitations",
  inputSchema: "Ordered input features / types",
  preprocessing: "Preprocessing version / evidence",
  license: "License / usage rights",
} as const;
const sourceFields = {
  repoId: "Repository (owner/name)",
  revision: "Full commit hash (40 characters)",
  filename: "Relative source filename",
} as const;

export function RegistrationDialog({
  engagement: e,
  busy,
  setup,
}: {
  engagement: Engagement;
  busy: boolean;
  setup: LabSetup;
}) {
  const { register, setRegister, card, setCard, error, closeSetup } = setup;
  return (
    <Dialog
      open={!!register}
      onOpenChange={(v) => {
        if (!v) closeSetup("registration");
      }}
    >
      {register && (
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>Register model version</DialogTitle>
            <DialogDescription>
              Cards and artifact pins are immutable. Corrections use a new
              version.
            </DialogDescription>
          </DialogHeader>
          <form
            onChange={() => setup.setTouched(true)}
            onSubmit={setup.registerVersion}
          >
            <fieldset disabled={busy}>
              <div className="ml-form-grid">
                <Field label="Model name">
                  <Input
                    required
                    value={register.name ?? ""}
                    onChange={(ev) =>
                      setRegister({ ...register, name: ev.target.value })
                    }
                  />
                </Field>
                <Field label="Version">
                  <Input
                    required
                    value={register.version ?? ""}
                    onChange={(ev) =>
                      setRegister({ ...register, version: ev.target.value })
                    }
                  />
                </Field>
                <SelectField
                  label="Artifact format"
                  value={register.format ?? ""}
                  onChange={(v) =>
                    setRegister({ ...register, format: v, artifactId: "" })
                  }
                  options={formats.map((v) => ({
                    value: v,
                    label:
                      v === "Prediction file" ? "Saved predictions (CSV)" : v,
                  }))}
                />
                <SelectField
                  label="Evaluation task"
                  value={register.task ?? ""}
                  onChange={(v) => setRegister({ ...register, task: v })}
                  options={tasks.map((v) => ({ value: v, label: v }))}
                />
              </div>
              <SelectField
                label={
                  register.format === "Prediction file"
                    ? "Accepted prediction dataset"
                    : "Quarantined model artifact"
                }
                value={register.artifactId ?? ""}
                onChange={(v) => setRegister({ ...register, artifactId: v })}
                options={e.artifacts
                  .filter((a) =>
                    register.format === "Prediction file"
                      ? a.category === "Dataset" &&
                        a.status === "accepted" &&
                        a.name.toLowerCase().endsWith(".csv")
                      : a.category === "Model",
                  )
                  .map((a) => ({ value: a.id, label: a.name }))}
              />
              <div className="ml-form-grid">
                <Field label="Provider / model owner">
                  <Input
                    required
                    value={card.owner}
                    onChange={(ev) =>
                      setCard({ ...card, owner: ev.target.value })
                    }
                  />
                </Field>
                <Field label="Algorithm / framework">
                  <Input
                    required
                    placeholder="e.g. LightGBM classifier"
                    value={card.framework}
                    onChange={(ev) =>
                      setCard({ ...card, framework: ev.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Intended use">
                <Textarea
                  required
                  value={register.intendedPurpose ?? ""}
                  onChange={(ev) =>
                    setRegister({
                      ...register,
                      intendedPurpose: ev.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Output meaning"
                help="State what each class or numeric prediction represents."
              >
                <Textarea
                  required
                  value={card.outputSemantics}
                  onChange={(ev) =>
                    setCard({ ...card, outputSemantics: ev.target.value })
                  }
                />
              </Field>
              <details className="ml-more">
                <summary>Population, schema & source provenance</summary>
                {(Object.keys(cardFields) as (keyof typeof cardFields)[]).map(
                  (key) => (
                    <Field key={key} label={cardFields[key]}>
                      <Textarea
                        value={card[key]}
                        onChange={(ev) =>
                          setCard({ ...card, [key]: ev.target.value })
                        }
                      />
                    </Field>
                  ),
                )}
                <SelectField
                  label="Source reference"
                  value={card.source.kind}
                  onChange={(v) =>
                    setCard({
                      ...card,
                      source: {
                        ...card.source,
                        kind: v as "internal" | "huggingface",
                      },
                    })
                  }
                  options={[
                    { value: "internal", label: "Internal evidence" },
                    {
                      value: "huggingface",
                      label: "Hugging Face provenance reference",
                    },
                  ]}
                />
                {card.source.kind === "huggingface" && (
                  <>
                    <p className="subtle">
                      Reference only. Files are supplied through the evidence
                      vault; no Hub download or upload occurs.
                    </p>
                    {(
                      Object.keys(sourceFields) as (keyof typeof sourceFields)[]
                    ).map((key) => (
                      <Field key={key} label={sourceFields[key]}>
                        <Input
                          required
                          value={card.source[key]}
                          onChange={(ev) =>
                            setCard({
                              ...card,
                              source: {
                                ...card.source,
                                [key]: ev.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </>
                )}
              </details>
              {register.format !== "Prediction file" && (
                <p className="ml-notice">
                  This registers inventory and provenance. Model bytes remain
                  quarantined; execution needs a trusted external adapter.
                </p>
              )}
              {register.task === "Classical NLP" && (
                <p className="ml-notice">
                  For text classification predictions, choose Binary or
                  Multiclass classification. Other NLP tasks are inventory-only
                  here.
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="ml-footer">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => closeSetup("registration")}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !register.artifactId || !register.task || !register.format
                  }
                >
                  Register version
                </Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
