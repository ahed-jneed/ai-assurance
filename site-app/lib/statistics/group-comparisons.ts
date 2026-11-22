// Audit statistics: group rates, pair members and coverage.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import {
  StatisticsError,
  type Minimums,
  EPS,
  MAX_GROUPS,
  RATE_KEYS,
} from "./core";
import { zcrit, byCodePoint, sum } from "./numerics";
import { wilson, newcombe, katz, koopman, ratioMethod } from "./intervals";
import { type Band, logZstar, koopmanZstar } from "./pvalues";
import { fisherTwoSided } from "./exact-tests";
import { type PlanCriterion } from "./plan";
import {
  type CriterionInterval,
  type Member,
  member,
  support,
} from "./members";
import { type Confusion } from "./metric-stats";

export type GroupData =
  | ({ group: string } & Confusion)
  | { group: string; selected: number; n: number };

export function rateCounts(
  key: "selection" | "tpr" | "fpr",
  g: GroupData | undefined,
): [number, number] {
  if (g === undefined) return [0, 0];
  if ("selected" in g) {
    if (key !== "selection")
      throw new StatisticsError("selection-only data cannot give TPR or FPR");
    return [g.selected, g.n];
  }
  const { tp, fp, fn, tn } = g;
  return {
    selection: [tp + fp, tp + fp + fn + tn] as [number, number],
    tpr: [tp, tp + fn] as [number, number],
    fpr: [fp, fp + tn] as [number, number],
  }[key];
}

export type RateEntry = {
  x: number;
  n: number;
  estimate: number | null;
  interval: CriterionInterval | null;
};
function rateEntry(x: number, n: number, level: number): RateEntry {
  if (n === 0) return { x: 0, n: 0, estimate: null, interval: null };
  const [lo, hi] = wilson(x, n, zcrit(level));
  return {
    x,
    n,
    estimate: x / n,
    interval: { lower: lo, upper: hi, level, method: "wilson" },
  };
}

function pairMember(
  metric: string,
  subject: string,
  comparator: string,
  [xs, ns]: [number, number],
  [xc, nc]: [number, number],
  band: Band,
  mins: Minimums,
  level: number,
  suppressed = false,
  decide = true,
) {
  const counts = { subject: { x: xs, n: ns }, comparator: { x: xc, n: nc } };
  const small = Math.min(xs, ns - xs, xc, nc - xc) < 5;
  if (ns === 0 || nc === 0) {
    const reason = ["tpr_difference", "fpr_difference"].includes(metric)
      ? "single_class"
      : "undefined_zero_denominator";
    return member(metric, band, null, "newcombe_hybrid_score", null, null, {
      subject,
      comparator,
      counts,
      status: suppressed ? "suppressed" : "undefined",
      reasons: [reason],
      level,
    });
  }
  const minimum = ["tpr_difference", "fpr_difference"].includes(metric)
    ? mins.classCount
    : mins.groupSize;
  const [status, reasons]: [Member["status"], string[]] = suppressed
    ? ["suppressed", ["group_below_minimum_size"]]
    : support(Math.min(ns, nc), minimum);
  const fisher = small ? fisherTwoSided(xs, ns, xc, nc) : null;
  const common = {
    subject,
    comparator,
    counts,
    status,
    reasons,
    smallCell: small,
    fisher,
    level,
    decide,
  };
  if (metric === "selection_rate_ratio") {
    const method = ratioMethod(xs, ns, xc, nc);
    if (method === null)
      return member(metric, band, null, "katz_log", null, null, {
        subject,
        comparator,
        counts,
        status: "undefined",
        reasons: ["undefined_zero_denominator"],
        smallCell: small,
        level,
      });
    const estimate = xs / ns / (xc / nc);
    if (method === "katz_log") {
      const se = Math.sqrt(1 / xs - 1 / ns + 1 / xc - 1 / nc);
      return member(
        metric,
        band,
        estimate,
        method,
        (z) => katz(xs, ns, xc, nc, z),
        (d) => logZstar(estimate, se, band, d),
        common,
      );
    }
    return member(
      metric,
      band,
      estimate,
      method,
      (z) => koopman(xs, ns, xc, nc, z),
      (d) => koopmanZstar(xs, ns, xc, nc, band, d),
      common,
    );
  }
  return member(
    metric,
    band,
    xs / ns - xc / nc,
    "newcombe_hybrid_score",
    (z) => newcombe(xs, ns, xc, nc, z),
    null,
    common,
  );
}

export const groupRows = (g: GroupData) =>
  "selected" in g ? g.n : g.tp + g.fp + g.fn + g.tn;

export type Coverage = {
  eligibleRows: number;
  populationRows: number;
  unknownGroupRows: number;
  value: number;
  minimum: number;
};
export type GroupView = {
  group: string;
  n: number;
  declared: boolean;
  suppressed: boolean;
  selection?: RateEntry;
  tpr?: RateEntry;
  fpr?: RateEntry;
};
export type Context = {
  sampleSize: number;
  passBlocked: boolean;
  reasons: string[];
  suppressedGroups?: { group: string; n: number }[];
  coverage?: Coverage;
  scale?: "log" | "linear";
  headlineMetric?: string;
  groups?: GroupView[];
  descriptive?: Member[];
  /** Regression only: the mean baseline gate p of section 5.9. */
  baselineP?: number;
};

export type CriterionData = {
  groups?: GroupData[];
  unknownGroupRows?: number;
  unknownGroup?: Partial<Confusion>;
  kind?: string;
  labels?: string[];
  matrix?: number[][];
  errors?: number[];
  targets?: number[];
};

export function groupMembers(
  spec: PlanCriterion,
  data: CriterionData,
  mins: Minimums,
  level: number,
): [Member[], Context] {
  const groups = new Map(data.groups!.map((g) => [g.group, g]));
  const declared = spec.declaredGroups ?? [];
  const names = byCodePoint(new Set([...groups.keys(), ...declared]));
  const size = new Map(
    names.map((name) => [
      name,
      groups.has(name) ? groupRows(groups.get(name)!) : 0,
    ]),
  );
  const present = names.filter((name) => size.get(name)! > 0);
  const eligible = present.filter((name) => size.get(name)! >= mins.groupSize);
  const suppressed = names
    .filter((name) => size.get(name)! < mins.groupSize)
    .map((name) => ({ group: name, n: size.get(name)! }));
  const unknown = data.unknownGroupRows ?? 0;
  const population = sum([...size.values()]) + unknown;
  const eligibleRows = sum(eligible.map((name) => size.get(name)!));
  const coverage: Coverage = {
    eligibleRows,
    populationRows: population,
    unknownGroupRows: unknown,
    value: population ? eligibleRows / population : 0.0,
    minimum: spec.minimumCoverage!,
  };
  const metrics =
    spec.metric === "equalized_odds"
      ? ["tpr_difference", "fpr_difference"]
      : [spec.metric!];
  const rateKeys = [...new Set(metrics.map((m) => RATE_KEYS[m]))];
  const perGroup: GroupView[] = names.map((name) => ({
    group: name,
    n: size.get(name)!,
    declared: declared.includes(name),
    suppressed: size.get(name)! < mins.groupSize,
    ...Object.fromEntries(
      rateKeys.map((key) => [
        key,
        rateEntry(...rateCounts(key, groups.get(name)), level),
      ]),
    ),
  }));
  const band = spec.band!,
    mode = spec.comparison!;
  const members: Member[] = [],
    reasons: string[] = [];
  let blocked = false;
  if (names.length > MAX_GROUPS[mode.mode]) {
    reasons.push("too_many_groups");
    blocked = true;
  } else if (band !== null)
    for (const metric of metrics) {
      const key = RATE_KEYS[metric];
      let pairs: [string, string][];
      if (mode.mode === "reference") {
        const ref = mode.referenceGroup!;
        pairs = present.includes(ref)
          ? present.filter((name) => name !== ref).map((name) => [name, ref])
          : [];
      } else {
        pairs = [];
        present.forEach((a, i) => {
          for (const b of present.slice(i + 1)) {
            const [xa, na] = rateCounts(key, groups.get(a)),
              [xb, nb] = rateCounts(key, groups.get(b));
            // An undefined rate sorts as +infinity.
            const rateA = na ? xa / na : Infinity,
              rateB = nb ? xb / nb : Infinity;
            pairs.push(rateB < rateA ? [b, a] : [a, b]);
          }
        });
      }
      for (const [s, c] of pairs)
        members.push(
          pairMember(
            metric,
            s,
            c,
            rateCounts(key, groups.get(s)),
            rateCounts(key, groups.get(c)),
            band,
            mins,
            level,
            !eligible.includes(s) || !eligible.includes(c),
            spec._decide ?? true,
          ),
        );
    }
  if (suppressed.length) reasons.push("group_suppressed_below_minimum");
  if (declared.length && declared.some((name) => size.get(name) === 0)) {
    reasons.push("empty_declared_group");
    blocked = true;
  }
  if (coverage.value < coverage.minimum - EPS) {
    reasons.push("insufficient_coverage");
    blocked = true;
  }
  if (
    eligible.length < 2 ||
    (mode.mode === "reference" && !eligible.includes(mode.referenceGroup!))
  ) {
    reasons.push("insufficient_groups");
    blocked = true;
  }
  return [
    members,
    {
      sampleSize: sum([...size.values()]),
      suppressedGroups: suppressed,
      coverage,
      passBlocked: blocked,
      reasons,
      scale: spec.metric === "selection_rate_ratio" ? "log" : "linear",
      headlineMetric: spec.metric,
      groups: perGroup,
      descriptive: [],
    },
  ];
}
