"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { RecordPicker, type SearchScope } from "../assurance-record-search";
import { FeatureEditor } from "./feature-editor";
import { FieldInput, visibleField } from "./field-input";
import {
  formDescription,
  formGroups,
  formTitles,
  saveLabels,
} from "./form-config";
import { SourceRelations } from "./source-relations";
import { label, type Field } from "./types";
import type { WorkbenchForm } from "./use-workbench-form";

/** The dialog of the open workbench form. */
export function FormDialog({
  state,
  fields,
  busy,
  dirty,
  error,
  scope,
  refreshKey,
  onSubmit,
  onDirty,
  onClose,
  remember,
  describeRecord,
}: {
  state: WorkbenchForm;
  fields: Record<string, Field[]>;
  busy: boolean;
  dirty: boolean;
  error: string;
  scope: SearchScope;
  refreshKey: unknown;
  onSubmit: (ev: FormEvent<HTMLFormElement>) => void;
  onDirty: () => void;
  /** Closes the form and clears its unsaved flag. */
  onClose: () => void;
  remember: (...records: AssuranceRecord[]) => void;
  describeRecord: (id: string) => string;
}) {
  const {
    form,
    revision,
    preset,
    executionMode,
    setExecutionMode,
    exclusions,
    setExclusions,
  } = state;
  return (
    <Dialog
      open={!!form}
      onOpenChange={(v) => {
        if (!v && !busy && (!dirty || window.confirm("Discard unsaved setup?")))
          onClose();
      }}
    >
      <DialogContent className="audit-dialog workbench-dialog">
        <DialogHeader>
          <DialogTitle>{formTitles[form]}</DialogTitle>
          <DialogDescription>{formDescription(form)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} onChange={onDirty}>
          <fieldset disabled={busy}>
            {(
              formGroups[form] ?? [
                { title: "", names: fields[form]?.map((f) => f.name) ?? [] },
              ]
            ).map((group) => (
              <section className="workbench-form-group" key={group.title}>
                {group.title && <h3>{group.title}</h3>}
                <div className="workbench-form-grid">
                  {fields[form]
                    ?.filter(
                      (f) =>
                        group.names.includes(f.name) &&
                        visibleField(form, executionMode, f),
                    )
                    .map((f) => (
                      <FieldInput
                        key={f.name}
                        field={f}
                        form={form}
                        value={
                          revision?.body[f.name] ??
                          preset[f.name] ??
                          f.initial ??
                          ""
                        }
                        onExecutionMode={setExecutionMode}
                      />
                    ))}
                </div>
                {form === "registerSystem" &&
                  group.title === "Input contract" && (
                    <FeatureEditor
                      features={state.features}
                      setFeatures={state.setFeatures}
                      onDirty={onDirty}
                    />
                  )}
              </section>
            ))}
            {revision && (
              <p className="workbench-notice">
                Revises {revision.id}. The prior assessment and its review
                remain in the audit history.
              </p>
            )}
            {form === "addAssertion" && (
              <SourceRelations
                scope={scope}
                refreshKey={refreshKey}
                relations={state.relations}
                setRelations={state.setRelations}
                onDirty={onDirty}
                remember={remember}
                describeRecord={describeRecord}
              />
            )}
            {form === "sample" && (
              <details>
                <summary>Population exclusions</summary>
                <p className="subtle">
                  Each exclusion must identify an actual unique record and
                  retain its reason.
                </p>
                {exclusions.map((x, i) => (
                  <div className="feature-row" key={i}>
                    <Input
                      aria-label="Excluded record ID"
                      placeholder="Record ID"
                      value={x.recordId}
                      onChange={(ev) =>
                        setExclusions(
                          exclusions.map((r, j) =>
                            i === j ? { ...r, recordId: ev.target.value } : r,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label="Exclusion reason"
                      placeholder="Reason"
                      value={x.reason}
                      onChange={(ev) =>
                        setExclusions(
                          exclusions.map((r, j) =>
                            i === j ? { ...r, reason: ev.target.value } : r,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setExclusions([
                      ...exclusions,
                      { recordId: "", reason: "" },
                    ]);
                    onDirty();
                  }}
                >
                  Add exclusion
                </Button>
              </details>
            )}
            {form === "impact" && (
              <section>
                <h3>Affected assurance records</h3>
                <RecordPicker
                  scope={scope}
                  kinds={["system", "assertion", "obligation", "location"]}
                  refreshKey={refreshKey}
                  selected={state.affectedIds}
                  onChange={state.setAffectedIds}
                  label="Affected assurance records"
                  empty="No systems, assertions, obligations or source locations recorded yet."
                  title={(r) =>
                    String(
                      r.body.name ??
                        r.body.statement ??
                        r.body.label ??
                        r.body.code ??
                        r.id,
                    )
                  }
                  describe={describeRecord}
                  onPick={remember}
                />
              </section>
            )}
            {form === "enrollWorker" && (
              <section>
                <h3>Approved adapter scope</h3>
                {[
                  "provided_predictions",
                  "ONNX",
                  "XGBoost",
                  "LightGBM",
                  "PMML",
                ].map((f) => (
                  <label className="check-row" key={f}>
                    <input
                      type="checkbox"
                      name="formats"
                      value={f}
                      defaultChecked={f === "provided_predictions"}
                    />
                    {label(f)}
                  </label>
                ))}
              </section>
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
                onClick={() => {
                  if (!dirty || window.confirm("Discard unsaved setup?"))
                    onClose();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                {busy ? "Saving…" : (saveLabels[form] ?? "Save assessment")}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
