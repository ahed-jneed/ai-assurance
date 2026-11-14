"use client";
import { useState } from "react";
import { postJson } from "@/lib/fetch-json";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { WorkflowDialog } from "./audit-program/workflow-dialog";
import type { Engagement, Role } from "@/lib/domain/types";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { recordsQuery, refreshAfterMutation } from "@/lib/assurance-query";
import { ViewLoading } from "./view-loading";
type Form = NonNullable<Parameters<typeof WorkflowDialog>[0]["form"]>;
const datasetCards = recordsQuery("dataset");
/**
 * The engagement's dataset cards, from the shared dataset query
 * (lib/assurance-query.ts) that the Testing lab, the planned evaluations and
 * the workbench also read: read once per engagement version, and again after
 * a card is registered here.
 */
export function DatasetRegistry({
  engagement: e,
  tenantId,
  role,
  onEditing,
  onRefresh,
}: {
  engagement: Engagement;
  tenantId: string;
  role: Role;
  onEditing: (v: boolean) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<Form | null>(null),
    [busy, setBusy] = useState(false);
  const datasets = useAssuranceQuery(
      { tenantId, engagementId: e.id, version: e.version },
      datasetCards,
    ),
    cards = datasets.data ?? [],
    error = datasets.error;
  function register(previous?: AssuranceRecord) {
    const c = previous?.body ?? {},
      fields: Form["fields"] = [
        { name: "name", label: "Dataset name", value: c.name ?? "" },
        { name: "version", label: "Version", value: previous ? "" : "1.0" },
        {
          name: "artifactId",
          label: "Accepted dataset evidence",
          type: "select",
          value: c.artifactId ?? "",
          options: e.artifacts
            .filter((a) => a.category === "Dataset" && a.status === "accepted")
            .map((a) => ({ value: a.id, label: a.name })),
        },
        { name: "owner", label: "Data owner", value: c.owner ?? "" },
        {
          name: "split",
          label: "Dataset role",
          type: "select",
          value: c.split ?? "",
          options: [
            "training",
            "validation",
            "test",
            "reference",
            "unknown",
          ].map((v) => ({ value: v, label: v })),
        },
        {
          name: "periodStart",
          label: "Period from",
          type: "date",
          value: c.periodStart ?? "",
        },
        {
          name: "periodEnd",
          label: "Period to",
          type: "date",
          value: c.periodEnd ?? "",
        },
        ...[
          "population",
          "collectionMethod",
          "independence",
          "sensitiveDataBasis",
          "limitations",
        ].map((name) => ({
          name,
          label: (
            {
              population: "Population and coverage",
              collectionMethod: "Collection and selection method",
              independence: "Independence from model training",
              sensitiveDataBasis: "Sensitive data handling basis",
              limitations: "Known limitations",
            } as Record<string, string>
          )[name],
          type: "area" as const,
          value: c[name] ?? "",
          optional: name === "sensitiveDataBasis",
        })),
        {
          name: "baselineDatasetRecordId",
          label: "Reference baseline version",
          type: "select",
          optional: true,
          options: cards.map((r) => ({
            value: r.id,
            label: r.body.name + " · " + r.body.version,
          })),
        },
        {
          name: "baselineRationale",
          label: "Baseline selection rationale",
          type: "area",
          optional: true,
        },
      ];
    setForm({
      title: previous
        ? "Register corrected dataset version"
        : "Register dataset version",
      action: "Register immutable card",
      description:
        "Describe the population, provenance and limitations of the exact accepted evidence bytes.",
      fields,
      save: async (values) => {
        setBusy(true);
        try {
          const { baselineDatasetRecordId, ...rest } = values;
          await postJson<unknown>("/api/assurance", {
            tenantId,
            engagementId: e.id,
            op: "registerDataset",
            data: {
              schemaVersion: "1.0",
              ...rest,
              ...(baselineDatasetRecordId ? { baselineDatasetRecordId } : {}),
            },
          });
          await refreshAfterMutation(
            { tenantId, engagementId: e.id },
            onRefresh,
          );
        } finally {
          setBusy(false);
        }
      },
    });
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Dataset versions <span className="count-label">{cards.length}</span>
        </h2>
        {can(role, "registerDataset") && (
          <Button variant="outline" onClick={() => register()} disabled={busy}>
            Register dataset
          </Button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={() => void datasets.reload()}>
            Retry
          </Button>
        </p>
      )}
      {datasets.loading && <ViewLoading label="Loading dataset versions" />}
      <div className="dataset-cards">
        {cards.map((r) => (
          <article className="dataset-card" key={r.id}>
            <header>
              <h3>
                {r.body.name} · {r.body.version}
              </h3>
              <span className="badge neutral">{r.body.split}</span>
            </header>
            <dl>
              {[
                ["Source", r.body.artifactName],
                ["Owner", r.body.owner],
                ["Period", r.body.periodStart + " — " + r.body.periodEnd],
                ["Population", r.body.population],
                ["Collection", r.body.collectionMethod],
                ["Independence", r.body.independence],
                [
                  "Handling basis",
                  r.body.sensitiveDataBasis ||
                    "No sensitive data basis declared",
                ],
                ["Limitations", r.body.limitations],
                [
                  "Baseline",
                  cards.find((x) => x.id === r.body.baselineDatasetRecordId)
                    ?.body.name ?? "Not selected",
                ],
              ].map(([label, value]) => (
                <div className="dataset-property" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {can(role, "registerDataset") && (
              <Button variant="ghost" size="sm" onClick={() => register(r)}>
                Create corrected version
              </Button>
            )}
            <details className="provenance">
              <summary>Immutable source pins</summary>
              <p className="hash-text">Card {r.sha256}</p>
              <p className="hash-text">Evidence {r.body.artifactSha256}</p>
            </details>
          </article>
        ))}
      </div>
      {!cards.length && !error && !datasets.loading && (
        <p className="empty-result">
          Register an accepted dataset to capture its population, independence
          and reference baseline.
        </p>
      )}
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </section>
  );
}
