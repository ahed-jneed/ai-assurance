"use client";
// NYC Local Law 144 bias audits in the Testing lab (#30): compute the DCWP
// tables from an accepted dataset with the data-source attestation, approve
// another preparer's audit, and open the publishable summary. The reading of
// the rules is pending qualified legal review (#57).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement } from "@/lib/domain/types";

type Act = (op: string, data: Record<string, unknown>) => Promise<unknown>;

const emptyForm = {
  datasetId: "",
  toolName: "",
  distributionDate: "",
  auditDate: "",
  rate: "selection" as "selection" | "scoring",
  sexColumn: "",
  raceEthnicityColumn: "",
  outcomeColumn: "",
  selectedValues: "",
  /** The tool classifies into several groups (6 RCNY 5-301(b)(4), #144). */
  perGroup: false,
  classificationGroups: "",
  scoreColumn: "",
  unknownValues: "",
  kind: "historical" as "historical" | "test",
  source: "",
  explanation: "",
  whyNotHistorical: "",
  testDataGeneration: "",
  demographicsNotInferred: false,
  demographicsStatement: "",
  acknowledgeHostedProcessing: false,
};
/**
 * Where the Testing lab shows the LL144 panel (#144): on engagements whose
 * pack switches the feature on, and elsewhere only to show and approve the
 * audits an engagement already holds, without computing new ones.
 */
export const ll144PanelAccess = (
  feature: boolean,
  e: Pick<Engagement, "ll144Audits">,
) => ({ shown: feature || !!e.ll144Audits?.length, compute: feature });

const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function Ll144Panel({
  engagement: e,
  tenantId,
  writer,
  reviewer,
  userId,
  busy,
  act,
  onEditing,
}: {
  engagement: Engagement;
  tenantId: string;
  writer: boolean;
  /** Reviewer or lead auditor: may approve another preparer's audit. */
  reviewer: boolean;
  userId: string;
  busy: boolean;
  act: Act;
  onEditing: (editing: boolean) => void;
}) {
  const audits = e.ll144Audits ?? [],
    datasets = e.artifacts.filter(
      (a) =>
        a.category === "Dataset" &&
        a.status === "accepted" &&
        a.name.toLowerCase().endsWith(".csv"),
    ),
    [form, setForm] = useState<typeof emptyForm | null>(null),
    [error, setError] = useState(""),
    open = form !== null;
  useEffect(() => onEditing(open), [open, onEditing]);
  useEffect(() => () => onEditing(false), [onEditing]);
  const set = (patch: Partial<typeof emptyForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setError("");
    try {
      await act("computeLl144Audit", {
        datasetId: form.datasetId,
        toolName: form.toolName,
        distributionDate: form.distributionDate,
        auditDate: form.auditDate,
        rate: form.rate,
        sexColumn: form.sexColumn,
        raceEthnicityColumn: form.raceEthnicityColumn,
        ...(form.rate === "selection"
          ? {
              outcomeColumn: form.outcomeColumn,
              ...(form.perGroup
                ? { classificationGroups: list(form.classificationGroups) }
                : { selectedValues: list(form.selectedValues) }),
            }
          : { scoreColumn: form.scoreColumn }),
        unknownValues: list(form.unknownValues),
        dataSource: {
          kind: form.kind,
          source: form.source,
          explanation: form.explanation,
          ...(form.kind === "test"
            ? {
                whyNotHistorical: form.whyNotHistorical,
                testDataGeneration: form.testDataGeneration,
              }
            : {}),
        },
        demographicsNotInferred: form.demographicsNotInferred,
        demographicsStatement: form.demographicsStatement,
        acknowledgeHostedProcessing: form.acknowledgeHostedProcessing,
      });
      setForm(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const summaryHref = (auditId: string) =>
    "/ll144-summary?" +
    new URLSearchParams({ tenantId, engagementId: e.id, auditId });
  const field = (
    label: string,
    key: keyof typeof emptyForm,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <label className="ml-field">
      <span>{label}</span>
      <Input
        value={String(form?.[key] ?? "")}
        onChange={(ev) => set({ [key]: ev.target.value })}
        {...props}
      />
    </label>
  );
  return (
    <section className="panel ll144-panel" aria-labelledby="ll144-panel-head">
      <div className="panel-head">
        <h2 id="ll144-panel-head">NYC Local Law 144 bias audits</h2>
        <span className="badge amber" title="Pending qualified legal review">
          Pending legal review
        </span>
        {writer && !form && (
          <Button
            variant="ghost"
            disabled={busy || !datasets.length}
            onClick={() => setForm({ ...emptyForm })}
          >
            Compute LL144 audit
          </Button>
        )}
      </div>
      <p className="subtle">
        Selection or scoring rates and impact ratios for sex, race/ethnicity and
        intersectional categories (6 RCNY 5-301), with unknown counts and the
        optional 2% exclusion. A tool that classifies individuals into several
        groups gets one audit per group. Intervals are supplementary.
      </p>
      {audits.length ? (
        <ul className="record-list">
          {audits.map((a) => (
            <li key={a.id}>
              <strong>{a.toolName}</strong> · audit {a.auditDate} ·{" "}
              {a.mapping.rate} rates
              {a.classification
                ? ` · group ${a.classification.group} (${a.classification.groups.indexOf(a.classification.group) + 1} of ${a.classification.groups.length})`
                : ""}{" "}
              · {a.result.totalIndividuals} individuals ·{" "}
              <span className="badge">{a.status}</span>{" "}
              <a href={summaryHref(a.id)} target="_blank" rel="noreferrer">
                Open summary
              </a>
              {a.warnings.map((w) => (
                <p key={w} className="form-error">
                  {w}
                </p>
              ))}
              {reviewer && a.status === "draft" && a.createdBy !== userId && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act("approveLl144Audit", { auditId: a.id }).catch(
                      (err: Error) => setError(err.message),
                    )
                  }
                >
                  Approve
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtle">No LL144 audit computed.</p>
      )}
      {!form && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form onSubmit={submit} aria-label="Compute LL144 audit">
          <fieldset disabled={busy}>
            <div className="ml-form-grid">
              <label className="ml-field">
                <span>Dataset</span>
                <select
                  required
                  value={form.datasetId}
                  onChange={(ev) => set({ datasetId: ev.target.value })}
                >
                  <option value="">Select an accepted CSV</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {field("Tool (AEDT) name and version", "toolName", {
                required: true,
              })}
              {field("Distribution date (first use)", "distributionDate", {
                type: "date",
                required: true,
              })}
              {field("Audit date", "auditDate", {
                type: "date",
                required: true,
              })}
              <label className="ml-field">
                <span>Rates</span>
                <select
                  value={form.rate}
                  onChange={(ev) =>
                    set({ rate: ev.target.value as "selection" | "scoring" })
                  }
                >
                  <option value="selection">Selection rates</option>
                  <option value="scoring">Scoring rates</option>
                </select>
              </label>
              {field("Sex column", "sexColumn", { required: true })}
              {field("Race/ethnicity column", "raceEthnicityColumn", {
                required: true,
              })}
              {form.rate === "selection" ? (
                <>
                  {field("Outcome column", "outcomeColumn", {
                    required: true,
                  })}
                  {form.perGroup
                    ? field(
                        "Classification groups (comma-separated outcome values)",
                        "classificationGroups",
                        { required: true },
                      )
                    : field(
                        "Values meaning selected (comma-separated)",
                        "selectedValues",
                        { required: true },
                      )}
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={form.perGroup}
                      onChange={(ev) => set({ perGroup: ev.target.checked })}
                    />
                    <span>
                      The tool classifies individuals into several groups:
                      compute one audit per group (6 RCNY 5-301(b)(4)).
                    </span>
                  </label>
                </>
              ) : (
                field("Score column", "scoreColumn", { required: true })
              )}
              {field(
                "Values meaning unknown category (comma-separated)",
                "unknownValues",
              )}
              <label className="ml-field">
                <span>Data</span>
                <select
                  value={form.kind}
                  onChange={(ev) =>
                    set({ kind: ev.target.value as "historical" | "test" })
                  }
                >
                  <option value="historical">Historical data</option>
                  <option value="test">Test data</option>
                </select>
              </label>
              {field("Source of the data", "source", { required: true })}
            </div>
            <label className="ml-field">
              <span>Explanation of the data</span>
              <Textarea
                required
                value={form.explanation}
                onChange={(ev) => set({ explanation: ev.target.value })}
              />
            </label>
            {form.kind === "test" && (
              <>
                <label className="ml-field">
                  <span>Why historical data was not used</span>
                  <Textarea
                    required
                    value={form.whyNotHistorical}
                    onChange={(ev) =>
                      set({ whyNotHistorical: ev.target.value })
                    }
                  />
                </label>
                <label className="ml-field">
                  <span>How the test data was generated and obtained</span>
                  <Textarea
                    required
                    value={form.testDataGeneration}
                    onChange={(ev) =>
                      set({ testDataGeneration: ev.target.value })
                    }
                  />
                </label>
              </>
            )}
            <label className="ml-field">
              <span>How sex and race/ethnicity were collected</span>
              <Textarea
                required
                value={form.demographicsStatement}
                onChange={(ev) =>
                  set({ demographicsStatement: ev.target.value })
                }
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.demographicsNotInferred}
                onChange={(ev) =>
                  set({ demographicsNotInferred: ev.target.checked })
                }
              />
              <span>
                Every sex and race/ethnicity value was reported by the
                individual; none was inferred or imputed.
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.acknowledgeHostedProcessing}
                onChange={(ev) =>
                  set({ acknowledgeHostedProcessing: ev.target.checked })
                }
              />
              <span>
                I acknowledge that special-category columns are processed on the
                platform under the client&apos;s recorded basis.
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setForm(null);
                  setError("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Compute audit</Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
