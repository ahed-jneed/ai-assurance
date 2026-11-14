"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Field } from "./types";

// Fields that take the full width of the form grid besides the multiline ones.
const wideFields = [
  "modelId",
  "systemId",
  "procedureId",
  "profileId",
  "criterion",
  "code",
  "paperId",
];

/** Whether `field` shows in `form` for the chosen execution mode. */
export const visibleField = (form: string, executionMode: string, f: Field) =>
  form !== "queueExternal" ||
  (f.name === "predictionId"
    ? executionMode !== "auditor_model"
    : ["securityReviewId", "predictionOutput", "predictionKind"].includes(
          f.name,
        )
      ? executionMode === "auditor_model"
      : true);

/** One labelled input, select or text area of a workbench form. */
export function FieldInput({
  field: f,
  form,
  value,
  onExecutionMode,
}: {
  field: Field;
  form: string;
  value: string;
  onExecutionMode: (mode: string) => void;
}) {
  const required =
      f.required ||
      (form === "queueExternal" &&
        ["predictionId", "securityReviewId"].includes(f.name)),
    id = "assurance-field-" + f.name;

  return (
    <label
      className={
        "workbench-field " +
        (f.multiline || wideFields.includes(f.name) ? "wide" : "")
      }
      htmlFor={id}
    >
      <span className="workbench-field-label">
        <span>{f.label}</span>
        {!required && <span className="field-optional">Optional</span>}
      </span>
      {f.options ? (
        <select
          id={id}
          aria-label={f.label}
          aria-describedby={f.help ? id + "-help" : undefined}
          name={f.name}
          required={required}
          defaultValue={value}
          onChange={
            form === "queueExternal" && f.name === "mode"
              ? (ev) => onExecutionMode(ev.target.value)
              : undefined
          }
        >
          <option value="">Choose…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.multiline ? (
        <Textarea
          id={id}
          aria-label={f.label}
          aria-describedby={f.help ? id + "-help" : undefined}
          name={f.name}
          required={required}
          defaultValue={value}
        />
      ) : (
        <Input
          id={id}
          aria-label={f.label}
          aria-describedby={f.help ? id + "-help" : undefined}
          name={f.name}
          type={f.type ?? "text"}
          required={required}
          defaultValue={value}
          step={f.type === "number" ? "any" : undefined}
        />
      )}{" "}
      {f.help && <small id={id + "-help"}>{f.help}</small>}
    </label>
  );
}
