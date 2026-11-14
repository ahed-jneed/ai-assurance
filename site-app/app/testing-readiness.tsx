"use client";
import { useState } from "react";
import { can, canQueueAuditorModel } from "@/lib/permissions";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  testingReadiness,
  type ExecutionSelection,
} from "@/lib/testing-readiness";
import type { Engagement, Role } from "@/lib/domain/types";
import type { AssuranceRecord } from "@/lib/assurance-core";
export function ExecutionPlanner({
  engagement: e,
  role,
  records,
  workers,
  onPlan,
  onHosted,
  initialProcedure,
  onNavigate,
  onSystems,
}: {
  engagement: Engagement;
  role: Role;
  records: AssuranceRecord[];
  workers: { active: number; capabilities: string }[];
  onPlan: (v: Record<string, string>) => void;
  onHosted: (procedureId: string, datasetCardRecordId: string) => void;
  initialProcedure?: string;
  onNavigate?: (view: string) => void;
  onSystems?: () => void;
}) {
  const [selection, setSelection] = useState<ExecutionSelection>({
      procedureId: initialProcedure ?? "",
      systemId: "",
      mode: "saved_predictions",
      predictionId: "",
      securityReviewId: "",
      predictionOutput: "",
      datasetCardRecordId: "",
    }),
    r = testingReadiness(e, records, workers, role, selection),
    writer = can(role, "queueRun");
  const remaining = r.checks.filter((c) => !c.done).length;
  const setupAction =
    e.workflow?.brief?.status !== "approved" ||
    e.workflow?.program.status !== "approved"
      ? {
          label: "Review scope and audit program",
          open: () => onNavigate?.("Audit program"),
        }
      : !r.p
        ? {
            label: "Plan an audit procedure",
            open: () => onNavigate?.("Audit program"),
          }
        : !r.model || !r.profile
          ? {
              label: "Review model and evaluation protocol",
              open: () => onNavigate?.("Testing lab"),
            }
          : !r.data || r.data.status !== "accepted"
            ? {
                label: "Review dataset evidence",
                open: () => onNavigate?.("Evidence vault"),
              }
            : !records.some(
                  (x) =>
                    x.kind === "dataset" &&
                    x.body.artifactId === r.data?.id &&
                    x.body.artifactSha256 === r.data?.sha256,
                )
              ? {
                  label: "Register a dataset card",
                  open: () => onNavigate?.("Testing lab"),
                }
              : selection.mode !== "saved_predictions" && !selection.systemId
                ? {
                    label: "Review system revisions",
                    open: () => onSystems?.(),
                  }
                : undefined;
  function choose(
    key: keyof ExecutionSelection,
    label: string,
    options: { id: string; label: string }[],
  ) {
    return (
      <label>
        {label}
        <select
          name={key}
          aria-label={label}
          value={selection[key]}
          onChange={(ev) =>
            setSelection((s) => ({
              ...s,
              [key]: ev.target.value,
              ...(key === "procedureId"
                ? { predictionId: "", datasetCardRecordId: "" }
                : {}),
            }))
          }
        >
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <section className="testing-readiness">
      <h2>Evaluation readiness</h2>
      <div className="workbench-execution-status">
        <span>
          {remaining
            ? remaining + " setup checks remaining"
            : "Pinned inputs ready for evaluation"}
        </span>
        {remaining > 0 && setupAction && onNavigate && (
          <Button variant="outline" size="sm" onClick={setupAction.open}>
            {setupAction.label}
          </Button>
        )}
      </div>
      <div className="testing-selection">
        {choose(
          "procedureId",
          "Planned audit procedure",
          (e.workflow?.procedures ?? [])
            .filter((p) => p.selected && p.method !== "manual")
            .map((p) => ({ id: p.id, label: p.templateId + " · " + p.title })),
        )}
        {choose("mode", "Execution method", [
          { id: "saved_predictions", label: "Interactive saved predictions" },
          {
            id: "provided_predictions",
            label: "External supplied predictions",
          },
          { id: "client_local", label: "Client local predictions" },
          // queueExternal admits writers; the auditor_model mode alone
          // narrows to the Lead Auditor (lib/commands/assurance/execution.ts).
          ...(canQueueAuditorModel(role)
            ? [
                {
                  id: "auditor_model",
                  label: "Reviewed portable model inference",
                },
              ]
            : []),
        ])}
        {choose(
          "datasetCardRecordId",
          "Dataset card version",
          records
            .filter(
              (x) =>
                x.kind === "dataset" &&
                x.body.artifactId === r.data?.id &&
                x.body.artifactSha256 === r.data?.sha256,
            )
            .map((x) => ({
              id: x.id,
              label: x.body.name + " · " + x.body.version,
            })),
        )}
      </div>
      {selection.mode !== "saved_predictions" && (
        <div className="testing-selection">
          {choose(
            "systemId",
            "System revision",
            records
              .filter(
                (x) =>
                  x.kind === "system" && x.body.modelIds.includes(r.model?.id),
              )
              .map((x) => ({
                id: x.id,
                label: x.body.name + " · " + x.body.version,
              })),
          )}
          {selection.mode === "auditor_model" ? (
            <>
              {choose(
                "securityReviewId",
                "Accepted security review",
                e.artifacts
                  .filter(
                    (a) => a.category === "Security" && a.status === "accepted",
                  )
                  .map((a) => ({ id: a.id, label: a.name })),
              )}
              <label>
                Prediction output
                <Input
                  value={selection.predictionOutput}
                  onChange={(ev) =>
                    setSelection({
                      ...selection,
                      predictionOutput: ev.target.value,
                    })
                  }
                />
              </label>
            </>
          ) : (
            choose(
              "predictionId",
              "Exact prediction lineage",
              records
                .filter(
                  (x) =>
                    x.kind === "prediction" &&
                    x.body.modelId === r.model?.id &&
                    x.body.systemId === selection.systemId &&
                    x.body.datasetId === r.data?.id,
                )
                .map((x) => ({ id: x.id, label: x.body.version ?? x.id })),
            )
          )}
        </div>
      )}
      {r.p && (
        <p className="subtle">
          {r.model?.name ?? "Model needed"} · {r.data?.name ?? "Dataset needed"}{" "}
          · {r.profile?.name ?? "Protocol needed"}
        </p>
      )}
      <ul className="readiness-checks">
        {r.checks.map((c) => (
          <li key={c.label}>
            {c.done ? (
              <CheckCircle2 size={16} color="#477a59" aria-hidden="true" />
            ) : (
              <Circle size={16} color="#6f757d" aria-hidden="true" />
            )}
            <span className="sr-only">{c.done ? "Done: " : "Not done: "}</span>
            {c.label}
          </li>
        ))}
      </ul>
      {selection.mode !== "saved_predictions" && (
        <p className="subtle">
          {r.workerReady
            ? "A compatible runner is enrolled. Execution starts when it connects."
            : "No compatible runner enrolled. A frozen request will wait for a configured runner."}
        </p>
      )}
      <div className="row-actions">
        {writer && (
          <Button
            disabled={!r.ready}
            onClick={() => {
              if (selection.mode === "saved_predictions")
                onHosted(selection.procedureId, selection.datasetCardRecordId);
              else
                onPlan({
                  ...selection,
                  modelId: r.model!.id,
                  datasetId: r.data!.id,
                  profileId: r.profile!.id,
                });
            }}
          >
            {selection.mode === "saved_predictions"
              ? "Review & run evaluation"
              : "Review external execution plan"}
          </Button>
        )}
      </div>
    </section>
  );
}
