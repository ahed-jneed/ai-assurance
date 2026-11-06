"use client";
// The power and minimum-detectable-effect check at plan approval
// (docs/design/audit-statistics.md section 8). The auditor enters the
// assumed true values; planned sizes come from the registered dataset's row
// count. A shortfall needs a recorded acknowledgement, not a block.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  criterionPower,
  type CriterionPower,
  type Plan,
} from "@/lib/statistics";

type Field = { key: string; label: string };
const FIELDS: Record<string, Field[]> = {
  performance: [
    { key: "prevalence", label: "Assumed share of the positive class" },
    { key: "truePositiveRate", label: "Assumed true recall" },
    { key: "trueNegativeRate", label: "Assumed true specificity" },
  ],
  regression_performance: [
    { key: "errorSd", label: "Assumed error standard deviation" },
  ],
  selection: [
    { key: "baselineRate", label: "Assumed selection rate (every group)" },
  ],
  equalized_odds: [
    { key: "prevalence", label: "Assumed share of the favourable class" },
    { key: "truePositiveRate", label: "Assumed true positive rate" },
    { key: "falsePositiveRate", label: "Assumed false positive rate" },
  ],
};
const fieldsFor = (c: Plan["criteria"][number]) =>
  c.kind === "group_comparison"
    ? FIELDS[c.metric === "equalized_odds" ? "equalized_odds" : "selection"]
    : (FIELDS[c.kind] ?? []);

/** Equal planned group sizes from the row count, labelled G1 to Gk. */
function plannedGroups(rows: number, groups: number) {
  const k = Math.max(2, groups);
  return Object.fromEntries(
    Array.from({ length: k }, (_, i) => [`G${i + 1}`, Math.floor(rows / k)]),
  );
}

/** The assumptions object a criterion's inputs make, or null while incomplete. */
export function assumptionsFor(
  c: Plan["criteria"][number],
  inputs: Record<string, string>,
  rows: number,
  groups: number,
) {
  const values: Record<string, number> = {};
  for (const f of fieldsFor(c)) {
    const v = Number(inputs[f.key]);
    if (
      inputs[f.key] === undefined ||
      inputs[f.key] === "" ||
      !Number.isFinite(v)
    )
      return null;
    values[f.key] = v;
  }
  if (!fieldsFor(c).length) return null;
  return c.kind === "group_comparison"
    ? { groupSizes: plannedGroups(rows, groups), ...values }
    : { n: rows, ...values };
}

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

function sentence(power: CriterionPower, target: number) {
  if (power.status !== "computed")
    return `Power is not computed (${power.reasons.join(", ").replaceAll("_", " ")}).`;
  const low = power.passProbability ?? 0,
    high = power.passProbabilityUpperBound ?? 0;
  const needed =
    power.requiredNForPass ?? power.requiredGroupSizeForPass ?? null;
  const unit =
    power.requiredGroupSizeForPass !== undefined ? "per group" : "rows";
  const mde = power.failMdeDifference ?? power.failMdeTprDifference ?? null;
  return (
    `If the assumptions hold, a system meeting them would pass with probability between ${share(low)} and ${share(high)}.` +
    (low < target
      ? needed
        ? ` Reaching ${share(target)} needs about ${needed.toLocaleString()} ${unit}.`
        : " The target cannot be reached at any size under these assumptions."
      : "") +
    (mde !== null
      ? ` A gap of ${Math.round(mde * 1000) / 10} points would fail with ${share(target)} probability.`
      : "") +
    (power.failMdeRatio
      ? ` A ratio of ${power.failMdeRatio.toFixed(2)} would fail with ${share(target)} probability.`
      : "")
  );
}

export function PowerCheck({
  plan,
  rows,
  groups,
  assumptions,
  acknowledgement,
  disabled,
  onAssumptions,
  onAcknowledgement,
}: {
  plan: Plan;
  rows: number;
  groups: number;
  assumptions: Record<string, unknown>;
  acknowledgement: string;
  disabled: boolean;
  onAssumptions: (value: Record<string, unknown>) => void;
  onAcknowledgement: (value: string) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>(
    () =>
      Object.fromEntries(
        Object.entries(assumptions).map(([id, a]) => [
          id,
          Object.fromEntries(
            Object.entries(a as Record<string, unknown>)
              .filter(([, v]) => typeof v === "number")
              .map(([k, v]) => [k, String(v)]),
          ),
        ]),
      ),
  );
  const family = plan.criteria.filter((c) => c.role === "confirmatory").length;
  const shortfalls = powerShortfalls(plan);
  function change(id: string, key: string, value: string) {
    const next = { ...inputs, [id]: { ...inputs[id], [key]: value } };
    setInputs(next);
    const out: Record<string, unknown> = {};
    for (const c of plan.criteria) {
      const a = assumptionsFor(c, next[c.id] ?? {}, rows, groups);
      if (a) out[c.id] = a;
    }
    onAssumptions(out);
  }
  return (
    <section className="readable-section power-check">
      <h3>Power check</h3>
      <p className="subtle">
        Enter the values you expect to be true; planned sizes are the dataset’s{" "}
        {rows.toLocaleString()} rows
        {groups > 1 ? `, split equally across ${groups} groups` : ""}. The check
        uses the {Math.round(plan.confidenceLevel * 100)}% level adjusted for{" "}
        {family} confirmatory {family === 1 ? "criterion" : "criteria"}.
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
          return (
            <div key={c.id} className="power-criterion">
              <b>{c.id.replaceAll("_", " ")}</b>
              <div className="ml-form-grid">
                {fieldsFor(c).map((f) => (
                  <label key={f.key} className="ml-field">
                    <span>{f.label}</span>
                    <Input
                      type="number"
                      min={0}
                      max={f.key === "errorSd" ? undefined : 1}
                      step="any"
                      disabled={disabled}
                      value={inputs[c.id]?.[f.key] ?? ""}
                      onChange={(ev) => change(c.id, f.key, ev.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p>{sentence(power, plan.power.targetPower)}</p>
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
