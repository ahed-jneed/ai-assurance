// Audit statistics: the cluster bootstrap (section 5.11).
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { PythonRandom } from "../python-random";
import { require_, type Minimums, BASELINE_TOLERANCE, RATE_KEYS } from "./core";
import { SQRT2, erfc, byCodePoint, sum, fsum } from "./numerics";
import { type Band, type Direction, directionOf } from "./pvalues";
import { jcs } from "./plan-hash";
import { type PlanCriterion, type Plan } from "./plan";
import { type Member } from "./members";
import {
  type Confusion,
  binaryStat,
  type MulticlassData,
  multiclassStat,
} from "./metric-stats";
import {
  type GroupData,
  rateCounts,
  type RateEntry,
  groupRows,
  type CriterionData,
} from "./group-comparisons";
import {
  type CriterionResult,
  type CriterionState,
  buildCriterion,
  decideCriterion,
} from "./criteria";

// ------------------------------------------------------------ cluster bootstrap (section 5.11)
// The engine's cluster_bootstrap_criteria, step for step, so that both
// runners decide a clustered plan on the same replicates (#136).

/** A clustered evaluation: the clusters in clusterKey order, one data object per cluster in that order, and the run seed. */
export type Clustered = {
  ids: unknown[];
  partsFor: (criterion: PlanCriterion) => CriterionData[];
  seed: number;
};

export const MAX_DECISION_DRAWS = 50_000_000; // B x C cluster draws per run
const MIN_CLUSTERS = 10;
const VALID_REPLICATE_SHARE = 0.9;
const U_TOLERANCE = 1e-9;
const UNBOOTSTRAPPED = new Set([
  "r2",
  "expected_calibration_error",
  "baseline_rmse",
]);

/** Clusters are ordered by the UTF-8 bytes (code points) of their canonical JSON, as the engine's cluster_key. */
export function clusterKey(cluster: unknown) {
  return typeof cluster === "string" ? JSON.stringify(cluster) : jcs(cluster);
}

/** Type-7 (linear interpolation) quantile of an ascending list. */
function quantile(ordered: number[], probability: number) {
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position),
    upper = Math.ceil(position);
  return (
    ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
  );
}

/** One criterion's data over all clusters: counts summed by group or class label, regression rows concatenated in cluster order. */
function mergeParts(parts: CriterionData[]): CriterionData {
  const first = parts[0];
  if (first.groups) {
    const cells = new Map<string, Record<string, number>>();
    for (const part of parts)
      for (const g of part.groups!) {
        const { group, ...counts } = g as unknown as Record<string, number> & {
          group: string;
        };
        let acc = cells.get(group);
        if (!acc) {
          acc = Object.fromEntries(Object.keys(counts).map((k) => [k, 0]));
          cells.set(group, acc);
        }
        require_(
          Object.keys(acc).sort().join() === Object.keys(counts).sort().join(),
          "a group mixes selection-only and confusion-matrix counts",
        );
        for (const [k, v] of Object.entries(counts)) acc[k] += v;
      }
    const out: CriterionData = {
      groups: byCodePoint(cells.keys()).map(
        (group) => ({ group, ...cells.get(group)! }) as unknown as GroupData,
      ),
    };
    if (parts.some((part) => part.unknownGroupRows !== undefined))
      out.unknownGroupRows = sum(parts.map((p) => p.unknownGroupRows ?? 0));
    return out;
  }
  if (first.matrix) {
    const labels = byCodePoint(new Set(parts.flatMap((p) => p.labels!)));
    const position = new Map(labels.map((label, i) => [label, i]));
    const matrix = labels.map(() => labels.map(() => 0));
    for (const part of parts)
      part.matrix!.forEach((row, i) =>
        row.forEach((count, j) => {
          matrix[position.get(part.labels![i])!][
            position.get(part.labels![j])!
          ] += count;
        }),
      );
    return { kind: "multiclass", labels, matrix };
  }
  const out: CriterionData = {
    kind: "regression",
    errors: parts.flatMap((p) => p.errors!),
  };
  if (parts.every((p) => p.targets !== undefined))
    out.targets = parts.flatMap((p) => p.targets!);
  return out;
}

type Unit = string | null;
/** The cells of one criterion that every replicate sums: one count vector per cluster. */
class ClusterLayout {
  size: number;
  labels: string[] = [];
  position = new Map<string, number>();
  centre = 0.0;
  groups: string[] = [];
  cells: string[] = [];
  offset = new Map<string, number>();

  constructor(
    readonly kind: string,
    merged: CriterionData,
  ) {
    if (kind === "performance") this.size = 4;
    else if (kind === "multiclass_performance") {
      this.labels = merged.labels!;
      this.labels.forEach((label, i) => this.position.set(label, i));
      this.size = this.labels.length ** 2;
    } else if (kind === "regression_performance") {
      const targets =
        merged.targets ?? new Array<number>(merged.errors!.length).fill(0.0);
      this.centre = targets.length ? fsum(targets) / targets.length : 0.0;
      this.size = 5;
    } else {
      this.groups = merged.groups!.map((g) => g.group);
      this.cells = merged.groups!.some((g) => "selected" in g)
        ? ["selected", "n"]
        : ["tp", "fp", "fn", "tn"];
      this.groups.forEach((name, i) =>
        this.offset.set(name, i * this.cells.length),
      );
      this.size = this.groups.length * this.cells.length;
    }
  }

  /** A cluster's cells, and its rows per unit (the whole criterion, null, or a group). */
  vector(part: CriterionData): [number[], Map<Unit, number>] {
    let cells = new Array<number>(this.size).fill(0);
    const units = new Map<Unit, number>();
    if (this.kind === "performance") {
      for (const g of part.groups!)
        (["tp", "fp", "fn", "tn"] as const).forEach((key, i) => {
          cells[i] += (g as Confusion)[key];
        });
      units.set(null, sum(cells));
    } else if (this.kind === "multiclass_performance") {
      const k = this.labels.length;
      part.matrix!.forEach((row, i) =>
        row.forEach((count, j) => {
          cells[
            this.position.get(part.labels![i])! * k +
              this.position.get(part.labels![j])!
          ] += count;
        }),
      );
      units.set(null, sum(cells));
    } else if (this.kind === "regression_performance") {
      const errors = part.errors!;
      const targets = part.targets ?? new Array<number>(errors.length).fill(0);
      const shifted = targets.map((t) => t - this.centre);
      cells = [
        errors.length,
        fsum(errors.map((e) => Math.abs(e))),
        fsum(errors.map((e) => e * e)),
        fsum(shifted),
        fsum(shifted.map((t) => t * t)),
      ];
      units.set(null, errors.length);
    } else
      for (const g of part.groups!) {
        const base = this.offset.get(g.group)!;
        this.cells.forEach((key, i) => {
          cells[base + i] += (g as unknown as Record<string, number>)[key];
        });
        units.set(g.group, (units.get(g.group) ?? 0) + groupRows(g));
      }
    return [cells, units];
  }

  /** A replicate's data in the shape the estimators read. */
  replicate(cells: number[]): unknown {
    if (this.kind === "performance")
      return { tp: cells[0], fp: cells[1], fn: cells[2], tn: cells[3] };
    if (this.kind === "multiclass_performance") {
      const k = this.labels.length;
      return {
        labels: this.labels,
        matrix: this.labels.map((_, i) => cells.slice(i * k, (i + 1) * k)),
      };
    }
    if (this.kind === "regression_performance") return cells;
    return Object.fromEntries(
      this.groups.map((name) => {
        const base = this.offset.get(name)!;
        return [
          name,
          Object.fromEntries(
            this.cells.map((key, i) => [key, cells[base + i]]),
          ),
        ];
      }),
    ) as unknown as Record<string, GroupData>;
  }

  unitsOf(entry: Member): Unit[] {
    return this.kind === "group_comparison"
      ? [entry.subject, entry.comparator]
      : [null];
  }
}

/** mean d = MSE − SST/n on a regression replicate: the statistic of the mean baseline gate (section 5.9). */
function meanDifference(rep: number[]) {
  const n = rep[0];
  if (n === 0) return null;
  const centred = rep[3] / n;
  return rep[2] / n - (rep[4] / n - centred * centred);
}

/** A replicate's shape differs by criterion kind (ClusterLayout.replicate). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the replicate's shape depends on the criterion kind.
type Estimator = (rep: any) => number | null;
/** The estimate of one entry on a replicate (null where undefined), or null for the entries that keep their own treatment (R², the baseline RMSE). */
function clusterEstimator(
  layout: ClusterLayout,
  entry: Member,
  mins: Minimums,
): Estimator | null {
  const metric = entry.metric;
  if (UNBOOTSTRAPPED.has(metric)) return null;
  if (layout.kind === "performance")
    return (rep: Confusion) => binaryStat(metric, rep, mins).estimate;
  if (layout.kind === "multiclass_performance")
    return (rep: MulticlassData) => multiclassStat(metric, rep, mins).estimate;
  if (layout.kind === "regression_performance") {
    if (metric === "mae")
      return (rep: number[]) => (rep[0] ? rep[1] / rep[0] : null);
    if (metric === "mse_reduction")
      return (rep: number[]) =>
        rep[0] === 0 ? null : 0.0 - meanDifference(rep)!;
    return (rep: number[]) => (rep[0] ? Math.sqrt(rep[2] / rep[0]) : null);
  }
  const key = RATE_KEYS[metric],
    subject = entry.subject!,
    comparator = entry.comparator!;
  return (rep: Record<string, GroupData>) => {
    const [xs, ns] = rateCounts(key, rep[subject]),
      [xc, nc] = rateCounts(key, rep[comparator]);
    if (ns === 0 || nc === 0) return null;
    if (metric === "selection_rate_ratio")
      return xc === 0 ? null : xs / ns / (xc / nc);
    return xs / ns - xc / nc;
  };
}

/** Whether an interval (lo, hi) lies inside the band (pass, inclusive bounds) or outside it (fail, strict). */
function bandHolds(band: Band, direction: Direction) {
  const { lower, upper } = band;
  if (direction === "pass")
    return (lo: number, hi: number) =>
      (lower === null || lo >= lower) && (upper === null || hi <= upper);
  return (lo: number, hi: number) =>
    (lower !== null && hi < lower) || (upper !== null && lo > upper);
}

/** u* = inf{u in (0, 0.5] : [q(u), q(1 − u)] decides}, by bisection to 1e-9; null when even the median does not decide. */
function bootstrapUStar(
  ordered: number[],
  holds: (lo: number, hi: number) => boolean,
) {
  const middle = quantile(ordered, 0.5);
  if (!holds(middle, middle)) return null;
  if (holds(ordered[0], ordered[ordered.length - 1])) return 0.0;
  let lo = 0.0,
    hi = 0.5;
  while (hi - lo > U_TOLERANCE) {
    const mid = (lo + hi) / 2.0;
    if (holds(quantile(ordered, mid), quantile(ordered, 1.0 - mid))) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** p = max(2u*, 2/(B_valid + 1)), and 1 when no u decides. */
function bootstrapP(
  ordered: number[],
  holds: (lo: number, hi: number) => boolean,
) {
  const u = bootstrapUStar(ordered, holds);
  return u === null ? 1.0 : Math.max(2.0 * u, 2.0 / (ordered.length + 1));
}

const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

/** Replaces an entry's analytic interval, direction and p-value by the cluster percentile bootstrap. */
function applyClusterBootstrap(
  entry: Member,
  values: number[],
  clusters: number,
  replicates: number,
  level: number,
  descriptive: boolean,
  within: boolean,
  decide: boolean,
) {
  delete entry._ciAt;
  delete entry._pInterval;
  entry.interval = null;
  entry.reasons = entry.reasons.filter(
    (r) => r !== "estimate_on_band_boundary",
  );
  if (!descriptive) {
    entry.direction = "none";
    entry.pValue = 1.0;
  }
  entry.bootstrap = {
    replicates,
    validReplicates: within ? values.length : 0,
    clusters,
  };
  if (!within) {
    entry.reasons.push("bootstrap_budget_exceeded");
    if (entry.status !== "suppressed") entry.status = "undefined";
    return;
  }
  if (entry.estimate === null) return; // its own status and reason stand
  if (clusters < MIN_CLUSTERS && entry.status === "evaluated") {
    entry.status = "insufficient_support";
    entry.reasons.push("below_minimum_cluster_count");
  }
  if (values.length < VALID_REPLICATE_SHARE * replicates) {
    if (entry.status !== "suppressed") entry.status = "undefined";
    entry.reasons.push("bootstrap_insufficient_valid_replicates");
    return;
  }
  const ordered = ascending(values);
  const tail = (1.0 - level) / 2.0;
  entry.interval = {
    lower: quantile(ordered, tail),
    upper: quantile(ordered, 1.0 - tail),
    level,
    method: "cluster_percentile_bootstrap",
  };
  // The percentile interval at the two-sided level of critical value z, for the headline.
  entry._ciAt = (z) => {
    const u = 0.5 * erfc(z / SQRT2);
    return [quantile(ordered, u), quantile(ordered, 1.0 - u)];
  };
  if (descriptive || entry.status !== "evaluated" || !decide) return;
  const direction = directionOf(quantile(ordered, 0.5), entry.band!); // from the median replicate
  entry.direction = direction;
  if (direction === "none") {
    entry.reasons.push("estimate_on_band_boundary");
    return;
  }
  const p = bootstrapP(ordered, bandHolds(entry.band!, direction));
  entry.pValue = entry._pInterval = p;
  if (entry.smallCell) {
    // Fisher assumes independent rows, so a small cell supports no claim either way.
    entry.pValue = entry._pInterval = 1.0;
    entry.reasons.push("small_cell_clustered");
  } else if (direction === "pass" && entry.chanceExactP !== null)
    entry.pValue = Math.max(p, entry.chanceExactP); // the chance gate (section 5.2) stays a pass condition
}

/**
 * A per-group rate's cluster percentile interval (#136): null beyond the
 * budget, for an undefined rate and with fewer than 0.9 B valid replicates.
 * Rates are descriptive, so there is no minimum-cluster rule.
 */
function applyRateBootstrap(
  entry: RateEntry,
  values: number[],
  replicates: number,
  level: number,
  within: boolean,
) {
  entry.interval = null;
  if (
    !within ||
    entry.estimate === null ||
    values.length < VALID_REPLICATE_SHARE * replicates
  )
    return;
  const ordered = ascending(values);
  const tail = (1.0 - level) / 2.0;
  entry.interval = {
    lower: quantile(ordered, tail),
    upper: quantile(ordered, 1.0 - tail),
    level,
    method: "cluster_percentile_bootstrap",
  };
}

/**
 * The mean baseline gate on the shared replicates (sections 5.9 and 5.11):
 * p = max(2u*, 2/(B_valid + 1)) with u* = inf{u : q(1 − u) of mean d < 0}.
 * The rounding rule, fewer than 10 clusters or 0.9 B valid replicates, or a
 * run beyond the budget give p = 1.
 */
function clusterGate(
  state: CriterionState,
  values: number[],
  clusters: number,
  replicates: number,
  within: boolean,
) {
  const entry = state.descriptive.find((e) => e.metric === "baseline_rmse")!;
  const counts = entry.counts as Record<string, number | string>;
  let p = 1.0;
  const beaten =
    "meanSquaredErrorReduction" in counts &&
    (counts.meanSquaredErrorReduction as number) >
      BASELINE_TOLERANCE * (counts.meanSquaredError as number);
  if (
    beaten &&
    within &&
    clusters >= MIN_CLUSTERS &&
    values.length >= VALID_REPLICATE_SHARE * replicates
  )
    p = bootstrapP(ascending(values), (_, hi) => hi < 0.0);
  if ("gatePValue" in counts) {
    counts.gatePValue = p;
    counts.gateMethod = "cluster_percentile_bootstrap";
  }
  state.context.baselineP = p;
}

type ClusterState = {
  state: CriterionState;
  layout: ClusterLayout;
  cells: number[][];
  offset: number;
  entries: {
    entry: Member;
    estimator: Estimator;
    clusters: number;
    descriptive: boolean;
    values: number[];
  }[];
  rates: { entry: RateEntry; estimator: Estimator; values: number[] }[];
  gate: number[] | null;
  clusters: number;
};

/**
 * Section 5.11: every member of a clustered plan is decided by one shared set
 * of B cluster-bootstrap replicates. Clusters come in clusterKey order; a
 * replicate draws C indices with randrange(C) from one random.Random(seed)
 * stream (PythonRandom) and sums the drawn clusters' count vectors.
 */
export function clusterBootstrapCriteria(
  plan: Plan,
  { ids, partsFor, seed }: Clustered,
): CriterionResult[] {
  const level = plan.confidenceLevel,
    mins = plan.minimums,
    derived = plan.derivedFrom !== null;
  const replicates = plan.bootstrap.replicates,
    count = ids.length;
  const within = replicates * count <= MAX_DECISION_DRAWS;
  const states: ClusterState[] = [];
  let width = 0;
  for (const spec of plan.criteria) {
    const parts = partsFor(spec);
    require_(
      parts.length === count,
      "every criterion needs one data object per cluster",
    );
    const merged = mergeParts(parts);
    const state = buildCriterion(spec, merged, level, mins, derived);
    const layout = new ClusterLayout(spec.kind, merged);
    const vectors = parts.map((part) => layout.vector(part));
    const clustersIn = new Map<Unit, number>();
    for (const [, units] of vectors)
      for (const [unit, rows] of units)
        if (rows) clustersIn.set(unit, (clustersIn.get(unit) ?? 0) + 1);
    const entries: ClusterState["entries"] = [];
    for (const [descriptive, items] of [
      [false, state.members],
      [true, state.descriptive],
    ] as const)
      for (const entry of items) {
        const estimator = clusterEstimator(layout, entry, mins);
        if (estimator !== null)
          entries.push({
            entry,
            estimator,
            clusters: Math.min(
              ...layout.unitsOf(entry).map((unit) => clustersIn.get(unit) ?? 0),
            ),
            descriptive,
            values: [],
          });
      }
    const rates: ClusterState["rates"] = [];
    for (const view of state.groups ?? [])
      for (const key of ["selection", "tpr", "fpr"] as const) {
        const entry = view[key];
        if (entry)
          rates.push({
            entry,
            estimator: (rep: Record<string, GroupData>) => {
              const [x, n] = rateCounts(key, rep[view.group]);
              return n ? x / n : null;
            },
            values: [],
          });
      }
    states.push({
      state,
      layout,
      cells: vectors.map(([cells]) => cells),
      offset: width,
      entries,
      rates,
      gate: spec.kind === "regression_performance" ? [] : null,
      clusters: clustersIn.get(null) ?? 0,
    });
    width += layout.size;
  }
  if (within) {
    // Each cell's nonzero clusters and values: a replicate's cell is
    // sum(multiplicity × value) over them, in cluster order, which equals the
    // sum of the drawn clusters' vectors.
    const columns = Array.from({ length: width }, () => ({
      clusters: [] as number[],
      values: [] as number[],
    }));
    for (const s of states)
      s.cells.forEach((cells, c) =>
        cells.forEach((value, i) => {
          if (value) {
            columns[s.offset + i].clusters.push(c);
            columns[s.offset + i].values.push(value);
          }
        }),
      );
    const rng = new PythonRandom(seed);
    const multiplicity = new Float64Array(count);
    const dense = new Array<number>(width);
    for (let b = 0; b < replicates; b++) {
      multiplicity.fill(0);
      for (let i = 0; i < count; i++) multiplicity[rng.randrange(count)] += 1;
      for (let col = 0; col < width; col++) {
        const { clusters, values } = columns[col];
        let total = 0;
        for (let i = 0; i < clusters.length; i++)
          total += multiplicity[clusters[i]] * values[i];
        dense[col] = total;
      }
      for (const s of states) {
        const rep = s.layout.replicate(
          dense.slice(s.offset, s.offset + s.layout.size),
        );
        for (const e of s.entries) {
          const value = e.estimator(rep);
          if (value !== null) e.values.push(value);
        }
        for (const r of s.rates) {
          const value = r.estimator(rep);
          if (value !== null) r.values.push(value);
        }
        if (s.gate !== null) {
          const value = meanDifference(rep as number[]);
          if (value !== null) s.gate.push(value);
        }
      }
    }
  }
  return states.map((s) => {
    for (const e of s.entries)
      applyClusterBootstrap(
        e.entry,
        e.values,
        e.clusters,
        replicates,
        level,
        e.descriptive,
        within,
        !s.state.invalidBand,
      );
    for (const r of s.rates)
      applyRateBootstrap(r.entry, r.values, replicates, level, within);
    if (s.gate !== null)
      clusterGate(s.state, s.gate, s.clusters, replicates, within);
    return decideCriterion(s.state, level, mins);
  });
}
