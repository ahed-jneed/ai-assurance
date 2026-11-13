// The power check's inputs (docs/design/audit-statistics.md section 8): what
// the auditor enters per criterion, and the powerAssumptions those entries
// make. Planned sizes come from the registered dataset: its row count, the
// row count of every group in the protected-group column and the classes of
// the target column. Outcome-derived quantities (prevalence, class shares,
// rates and recalls) are always entered by the auditor, never read from the
// data being tested.
import type { CriterionPower, Plan } from "@/lib/statistics";

type Criterion = Plan["criteria"][number];
export type Field = { key: string; label: string; kind: "share" | "sd" };

/** What the registered dataset gives the plan: rows, group sizes and classes. */
export type Planned = {
  rows: number;
  /** Rows per group of the protected-group column; null while unknown. */
  groupSizes: Record<string, number> | null;
  /** The target column's classes (multiclass); null while unknown. */
  classes: string[] | null;
  /** Why groupSizes or classes are unknown, when they are. */
  unavailable?: string;
};

const FIELDS: Record<string, Field[]> = {
  performance: [
    {
      key: "prevalence",
      label: "Assumed share of the positive class",
      kind: "share",
    },
    { key: "truePositiveRate", label: "Assumed true recall", kind: "share" },
    {
      key: "trueNegativeRate",
      label: "Assumed true specificity",
      kind: "share",
    },
  ],
  regression_performance: [
    {
      key: "errorSd",
      label: "Assumed error standard deviation",
      kind: "sd",
    },
  ],
  selection: [
    {
      key: "baselineRate",
      label: "Assumed selection rate (every group)",
      kind: "share",
    },
  ],
  equalized_odds: [
    {
      key: "prevalence",
      label: "Assumed share of the favourable class",
      kind: "share",
    },
    {
      key: "truePositiveRate",
      label: "Assumed true positive rate",
      kind: "share",
    },
    {
      key: "falsePositiveRate",
      label: "Assumed false positive rate",
      kind: "share",
    },
  ],
};

/** The input keys of one class of a multiclass criterion. */
export const classKeys = (label: string) => ({
  share: "share:" + label,
  recall: "recall:" + label,
});

/** The fields the auditor fills in for a criterion. */
export function fieldsFor(c: Criterion, planned: Planned): Field[] {
  if (c.kind === "multiclass_performance")
    return (planned.classes ?? []).flatMap((label) => [
      {
        key: classKeys(label).share,
        label: `Assumed share of class ${label}`,
        kind: "share" as const,
      },
      {
        key: classKeys(label).recall,
        label: `Assumed true recall of class ${label}`,
        kind: "share" as const,
      },
    ]);
  if (c.kind === "group_comparison")
    return FIELDS[
      c.metric === "equalized_odds" ? "equalized_odds" : "selection"
    ];
  return FIELDS[c.kind] ?? [];
}

/** Class shares may be rounded (three classes at 0.333 each) by this much; they are then scaled to sum to 1. */
export const SHARE_ROUNDING = 0.01;

/**
 * The powerAssumptions object a criterion's inputs make, or null with the
 * reason it cannot be made yet. Group criteria take the planned group sizes
 * from the dataset's group column; multiclass criteria need a share and a
 * recall for every class of the target column.
 */
export function assumptionsFor(
  c: Criterion,
  inputs: Record<string, string>,
  planned: Planned,
): { value: Record<string, unknown> | null; problem: string } {
  const fields = fieldsFor(c, planned);
  const none = (problem: string) => ({ value: null, problem });
  if (c.kind === "group_comparison" || c.kind === "multiclass_performance") {
    const known =
      c.kind === "group_comparison" ? planned.groupSizes : planned.classes;
    if (!known)
      return none(
        planned.unavailable ??
          (c.kind === "group_comparison"
            ? "Reading the group sizes from the dataset…"
            : "Reading the classes from the dataset…"),
      );
    const count = Array.isArray(known)
      ? known.length
      : Object.keys(known).length;
    if (count < 2)
      return none(
        c.kind === "group_comparison"
          ? "The protected-group column has fewer than two groups, so no pair can be compared."
          : "The target column has fewer than two classes.",
      );
  }
  if (!fields.length) return none("");
  const values: Record<string, number> = {};
  for (const f of fields) {
    const text = (inputs[f.key] ?? "").trim();
    const v = Number(text);
    if (!text || !Number.isFinite(v)) return none("");
    if (f.kind === "share" ? v < 0 || v > 1 : v <= 0)
      return none(
        f.kind === "share"
          ? `${f.label} must lie between 0 and 1.`
          : `${f.label} must be greater than 0.`,
      );
    values[f.key] = v;
  }
  if (c.kind === "group_comparison")
    return {
      value: { groupSizes: { ...planned.groupSizes! }, ...values },
      problem: "",
    };
  if (c.kind === "multiclass_performance") {
    const classes = planned.classes!;
    const shares = classes.map((l) => values[classKeys(l).share]);
    if (shares.some((s) => s <= 0))
      return none("Every class needs an assumed share above 0.");
    const total = shares.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > SHARE_ROUNDING)
      return none(
        `The assumed class shares add up to ${Math.round(total * 1000) / 10}%; they must add up to 100%.`,
      );
    return {
      value: {
        n: planned.rows,
        classShares: Object.fromEntries(
          classes.map((l, i) => [l, shares[i] / total]),
        ),
        perClassRecall: Object.fromEntries(
          classes.map((l) => [l, values[classKeys(l).recall]]),
        ),
      },
      problem: "",
    };
  }
  return { value: { n: planned.rows, ...values }, problem: "" };
}

/** The input texts a stored powerAssumptions object fills in (planned sizes are read again from the dataset). */
export function inputsFrom(assumptions: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!assumptions || typeof assumptions !== "object") return out;
  const a = assumptions as Record<string, unknown>;
  for (const [key, v] of Object.entries(a))
    if (typeof v === "number" && key !== "n") out[key] = String(v);
  for (const [source, key] of [
    ["classShares", "share"],
    ["perClassRecall", "recall"],
  ] as const) {
    const map = a[source];
    if (map && typeof map === "object")
      for (const [label, v] of Object.entries(map as Record<string, unknown>))
        if (typeof v === "number") out[classKeys(label)[key]] = String(v);
  }
  return out;
}

/** The planned sizes in words, for the check's introduction. */
export function plannedText(planned: Planned, fair: boolean) {
  const rows = `${planned.rows.toLocaleString()} rows`;
  if (!fair || !planned.groupSizes) return rows;
  const groups = Object.entries(planned.groupSizes)
    .map(([g, n]) => `${g} ${n.toLocaleString()}`)
    .join(", ");
  return `${rows}; rows per group: ${groups}`;
}

const share = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : Math.round(v * 100) + "%";
/** Members whose power formula assumes the errors of each class spread evenly over the others (section 8, #152). */
const MACRO = { macro_f1: true, macro_precision: true };
const METRIC_WORDS: Record<string, string> = {
  accuracy: "accuracy",
  balanced_accuracy: "balanced accuracy",
  macro_f1: "macro F1",
  macro_precision: "macro precision",
};

/** The plain-language result of a criterion's power check. */
export function powerSentence(power: CriterionPower, target: number) {
  if (power.status !== "computed") {
    const computed = power.members.filter(
      (m) => m.status === "computed" && m.passProbability !== null,
    );
    const missing = power.members
      .filter((m) => m.status !== "computed")
      .map((m) => METRIC_WORDS[m.metric] ?? m.metric.replaceAll("_", " "));
    return (
      `Power is not computed (${power.reasons.join(", ").replaceAll("_", " ")})` +
      (missing.length
        ? `: there is no power formula for ${missing.join(" and ")}.`
        : ".") +
      (computed.length
        ? " If the assumptions hold, " +
          computed
            .map(
              (m) =>
                `${METRIC_WORDS[m.metric] ?? m.metric.replaceAll("_", " ")} would pass with probability ${share(m.passProbability)}`,
            )
            .join(", ") +
          "."
        : "")
    );
  }
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
      : "") +
    (power.members.some((m) => Object.hasOwn(MACRO, m.metric))
      ? ` For ${power.members
          .filter((m) => Object.hasOwn(MACRO, m.metric))
          .map((m) => METRIC_WORDS[m.metric])
          .join(
            " and ",
          )} the check assumes that each class's errors are spread evenly over the other classes.`
      : "")
  );
}
