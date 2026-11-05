"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkflowDialog } from "./audit-program";
import type { Engagement, Role } from "@/lib/domain";
import type { AssuranceRecord } from "@/lib/assurance-core";
type Form = NonNullable<Parameters<typeof WorkflowDialog>[0]["form"]>;
export function DatasetRegistry({
  engagement: e,
  tenantId,
  role,
  onEditing,
  onRefresh,
  onCards,
}: {
  engagement: Engagement;
  tenantId: string;
  role: Role;
  onEditing: (v: boolean) => void;
  onRefresh: () => Promise<unknown>;
  onCards: (cards: AssuranceRecord[]) => void;
}) {
  const [cards, setCards] = useState<AssuranceRecord[]>([]),
    [form, setForm] = useState<Form | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch(
          "/api/assurance?" +
            new URLSearchParams({ tenantId, engagementId: e.id }),
          { cache: "no-store" },
        ),
        v = (await r.json()) as { records: AssuranceRecord[]; error?: string };
      if (!r.ok) throw Error(v.error);
      const datasets = v.records.filter((r) => r.kind === "dataset");
      setCards(datasets);
      onCards(datasets);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Dataset cards unavailable",
      );
    }
  }, [tenantId, e.id, onCards]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the dataset cards from the API whenever the engagement version changes
    void load();
  }, [load, e.version]);
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
          const r = await fetch("/api/assurance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenantId,
                engagementId: e.id,
                op: "registerDataset",
                data: {
                  schemaVersion: "1.0",
                  ...rest,
                  ...(baselineDatasetRecordId
                    ? { baselineDatasetRecordId }
                    : {}),
                },
              }),
            }),
            v = (await r.json()) as { error?: string };
          if (!r.ok) throw Error(v.error);
          await onRefresh();
          await load();
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
        {["Auditor", "Lead Auditor"].includes(role) && (
          <Button variant="outline" onClick={() => register()} disabled={busy}>
            Register dataset
          </Button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
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
            {["Auditor", "Lead Auditor"].includes(role) && (
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
      {!cards.length && !error && (
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
