"use client";
// The power and minimum-detectable-effect check at plan approval
// (docs/design/audit-statistics.md section 8). The auditor enters the
// assumed true values; planned sizes come from the registered dataset: its
// row count, the rows of each group in the protected-group column, and the
// classes of the target column (power-assumptions.ts). A shortfall needs a
// recorded acknowledgement, not a block.
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { criterionPower, type Plan } from "@/lib/statistics";
import {
  assumptionsFor,
  fieldsFor,
  inputsFrom,
  plannedText,
  powerSentence,
  type Planned,
} from "./power-assumptions";

const share = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : Math.round(v * 100) + "%";

/** The criteria whose power is short of the target or not computed. */
export function powerShortfalls(plan: Plan) {
  const family = plan.criteria.filter((c) => c.role === "confirmatory").length;
  return plan.criteria
    .filter((c) => c.role === "confirmatory")
    .map((c) => ({
      c,
      power: criterionPower(
        c,
        plan.confidenceLevel,
        plan.power.targetPower,
        Math.max(1, family),
        plan.minimums,
      ),
    }))
    .filter(
      ({ power }) =>
        power.status !== "computed" ||
        (power.passProbability ?? 0) < plan.power.targetPower,
    );
}

type Inspection = {
  values?: Record<string, string[] | null>;
  counts?: Record<string, { value: string; count: number }[] | null>;
  error?: string;
};

export function PowerCheck({
  plan,
  rows,
  dataset,
  groupColumn,
  labelColumn,
  assumptions,
  acknowledgement,
  disabled,
  onAssumptions,
  onAcknowledgement,
}: {
  plan: Plan;
  rows: number;
  /** The registered dataset whose group sizes and classes plan the check. */
  dataset: { tenantId: string; engagementId: string; artifactId: string };
  /** The protected-group column, when the plan compares groups. */
  groupColumn: string | null;
  /** The target column, when the plan has a multiclass criterion. */
  labelColumn: string | null;
  assumptions: Record<string, unknown>;
  acknowledgement: string;
  disabled: boolean;
  onAssumptions: (value: Record<string, unknown>) => void;
  onAcknowledgement: (value: string) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>(
    () =>
      Object.fromEntries(
        Object.entries(assumptions).map(([id, a]) => [id, inputsFrom(a)]),
      ),
  );
  const [read, setRead] = useState<{
    key: string;
    groupSizes: Record<string, number> | null;
    classes: string[] | null;
    unavailable?: string;
  } | null>(null);
  const key = JSON.stringify([
    dataset.artifactId,
    groupColumn ?? "",
    labelColumn ?? "",
  ]);
  const planned: Planned =
    read?.key === key
      ? { rows, ...read }
      : { rows, groupSizes: null, classes: null };
  const family = plan.criteria.filter((c) => c.role === "confirmatory").length;
  const shortfalls = powerShortfalls(plan);
  // The latest inputs and plan, for recomputing the assumptions once the
  // dataset's group sizes and classes arrive.
  const latest = useRef({ inputs, plan, onAssumptions });
  useEffect(() => {
    latest.current = { inputs, plan, onAssumptions };
  });

  function emit(
    next: Record<string, Record<string, string>>,
    sizes: Planned,
    criteria: Plan["criteria"],
    send: (value: Record<string, unknown>) => void,
  ) {
    const out: Record<string, unknown> = {};
    for (const c of criteria) {
      const a = assumptionsFor(c, next[c.id] ?? {}, sizes).value;
      if (a) out[c.id] = a;
    }
    send(out);
  }

  useEffect(() => {
    if (!groupColumn && !labelColumn) return;
    let active = true;
    const controller = new AbortController();
    const query = new URLSearchParams(dataset);
    if (groupColumn) query.append("counts", groupColumn);
    if (labelColumn) query.append("values", labelColumn);
    fetch("/api/evaluation/dataset?" + query, { signal: controller.signal })
      .then(async (r) => {
        const value = (await r.json()) as Inspection;
        if (!r.ok) throw Error(value.error ?? "Dataset inspection failed");
        return value;
      })
      .then((value) => {
        if (!active) return;
        const counts = groupColumn ? value.counts?.[groupColumn] : undefined,
          classes = labelColumn ? value.values?.[labelColumn] : undefined;
        const next = {
          key,
          groupSizes: counts
            ? Object.fromEntries(counts.map((g) => [g.value, g.count]))
            : null,
          classes: classes ?? null,
          unavailable:
            (groupColumn && !counts) || (labelColumn && !classes)
              ? "The dataset has more than 50 groups or classes in the mapped column, so the planned sizes cannot be listed."
              : undefined,
        };
        setRead(next);
        const { inputs, plan, onAssumptions } = latest.current;
        emit(inputs, { rows, ...next }, plan.criteria, onAssumptions);
      })
      .catch((err: Error) => {
        if (!active || err.name === "AbortError") return;
        setRead({
          key,
          groupSizes: null,
          classes: null,
          unavailable: `The planned sizes could not be read: ${err.message}`,
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key identifies the dataset and mapped columns
  }, [key]);

  function change(id: string, field: string, value: string) {
    const next = { ...inputs, [id]: { ...inputs[id], [field]: value } };
    setInputs(next);
    emit(next, planned, plan.criteria, onAssumptions);
  }
  return (
    <section className="readable-section power-check">
      <h3>Power check</h3>
      <p className="subtle">
        Enter the values you expect to be true; planned sizes are the dataset’s{" "}
        {plannedText(planned, !!groupColumn)}. The check uses the{" "}
        {Math.round(plan.confidenceLevel * 100)}% level adjusted for {family}{" "}
        confirmatory {family === 1 ? "criterion" : "criteria"}.
      </p>
      {plan.criteria
        .filter((c) => c.role === "confirmatory")
        .map((c) => {
          const power = criterionPower(
            c,
            plan.confidenceLevel,
            plan.power.targetPower,
            Math.max(1, family),
            plan.minimums,
          );
          const { problem } = assumptionsFor(c, inputs[c.id] ?? {}, planned);
          return (
            <div key={c.id} className="power-criterion">
              <b>{c.id.replaceAll("_", " ")}</b>
              <div className="ml-form-grid">
                {fieldsFor(c, planned).map((f) => (
                  <label key={f.key} className="ml-field">
                    <span>{f.label}</span>
                    <Input
                      type="number"
                      min={0}
                      max={f.kind === "sd" ? undefined : 1}
                      step="any"
                      disabled={disabled}
                      value={inputs[c.id]?.[f.key] ?? ""}
                      onChange={(ev) => change(c.id, f.key, ev.target.value)}
                    />
                  </label>
                ))}
              </div>
              {problem && <p className="subtle">{problem}</p>}
              <p>{powerSentence(power, plan.power.targetPower)}</p>
            </div>
          );
        })}
      {shortfalls.length > 0 && (
        <label className="ml-field">
          <span>
            Acknowledge the shortfall: why evaluate with less than{" "}
            {share(plan.power.targetPower)} power
          </span>
          <Textarea
            disabled={disabled}
            value={acknowledgement}
            onChange={(ev) => onAcknowledgement(ev.target.value)}
          />
        </label>
      )}
    </section>
  );
}
