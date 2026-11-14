"use client";
// Evaluation setup, step 2 (Data): the inspected dataset, its column
// mappings and labels, and the declared dataset context.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import type { Draft } from "./drafts";
import { Field, SelectField } from "./lab-ui";
import type { LabSetup } from "./use-lab-setup";

const contextFields = {
  population: "Population / collection scope",
  predictionProvenance: "How these predictions were generated",
  independence: "Holdout independence / known leakage",
} as const;

export function DataStep({ setup }: { setup: LabSetup }) {
  const { inspect, inspecting, draft, setDraft, config, locked, model, cols } =
    setup;
  return (
    <>
      {inspect ? (
        <>
          <div className="ml-inspection">
            <span>{inspect.rowCount.toLocaleString()} rows</span>
            <span>{inspect.columns.length} columns</span>
            <span>SHA-256 verified</span>
          </div>
          <div className="ml-form-grid">
            <SelectField
              label="Reference target"
              value={draft.config.labelColumn}
              disabled={locked}
              onChange={(v) => config("labelColumn", v)}
              options={cols}
            />
            <SelectField
              label="Saved prediction"
              value={draft.config.predictionColumn}
              disabled={locked}
              onChange={(v) => config("predictionColumn", v)}
              options={cols}
            />
          </div>
          {model?.task === "Binary classification" && (
            <Field
              label="Favourable class label"
              help="The outcome fairness tests count as selection."
            >
              <Input
                disabled={locked}
                required
                value={draft.config.positiveLabel}
                onChange={(ev) => config("positiveLabel", ev.target.value)}
              />
            </Field>
          )}
          {model?.task === "Binary classification" && (
            <Field
              label="Other class label"
              help="Declaring both labels lets data in which only one occurs be evaluated; the statistics gates then decide."
            >
              <Input
                disabled={locked}
                required
                value={draft.config.negativeLabel ?? ""}
                onChange={(ev) => config("negativeLabel", ev.target.value)}
              />
            </Field>
          )}
          <details className="ml-more">
            <summary>Column profile (no raw row preview)</summary>
            <Table>
              <TableHeader>
                <TableRow>
                  {["Column", "Type", "Missing", "Distinct"].map((x) => (
                    <TableHead key={x}>{x}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspect.columns.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.type}</TableCell>
                    <TableCell>{c.missing}</TableCell>
                    <TableCell>{c.uniqueCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        </>
      ) : (
        <p className="subtle">
          {inspecting
            ? "Inspecting dataset…"
            : "Dataset inspection is unavailable."}
        </p>
      )}
      <SelectField
        label="Declared dataset role"
        value={draft.datasetContext.split}
        disabled={locked}
        onChange={(v) =>
          setDraft({
            ...draft,
            datasetContext: {
              ...draft.datasetContext,
              split: v as Draft["datasetContext"]["split"],
            },
          })
        }
        options={["test", "validation", "training", "unknown"].map((v) => ({
          value: v,
          label: v,
        }))}
      />
      {(Object.keys(contextFields) as (keyof typeof contextFields)[]).map(
        (key) => (
          <Field
            key={key}
            label={contextFields[key]}
            help={
              key === "independence"
                ? "State what is verified and what remains unknown."
                : undefined
            }
          >
            <Textarea
              disabled={locked}
              required
              value={draft.datasetContext[key]}
              onChange={(ev) =>
                setDraft({
                  ...draft,
                  datasetContext: {
                    ...draft.datasetContext,
                    [key]: ev.target.value,
                  },
                })
              }
            />
          </Field>
        ),
      )}
    </>
  );
}
