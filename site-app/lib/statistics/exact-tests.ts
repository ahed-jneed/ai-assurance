// Audit statistics: exact tests and multiplicity adjustments.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { onBoundary, sum } from "./numerics";
import { type Band, bound } from "./pvalues";

// ------------------------------------------------------------ exact tests and multiplicity
const LOG_FACTORIALS = [0];
for (let i = 1, total = 0; i < 64; i++)
  LOG_FACTORIALS.push((total += Math.log(i)));
/** ln(n!): a table below 64, Stirling's series above (absolute error near the rounding of n ln n). */
function logFactorial(n: number) {
  if (n < 64) return LOG_FACTORIALS[n];
  const n1 = n + 1,
    inv = 1 / n1,
    inv2 = inv * inv;
  return (
    (n1 - 0.5) * Math.log(n1) -
    n1 +
    0.5 * Math.log(2 * Math.PI) +
    inv * (1 / 12 - inv2 * (1 / 360 - inv2 * (1 / 1260 - inv2 / 1680)))
  );
}
const logChoose = (n: number, k: number) =>
  logFactorial(n) - logFactorial(k) - logFactorial(n - k);

/** Hypergeometric weights over the support, scaled by the largest (log space, section 5.12). */
function hypergeometric(successes: number, draws: number, total: number) {
  const lo = Math.max(0, draws - (total - successes)),
    hi = Math.min(successes, draws);
  const logs: number[] = [];
  for (let k = lo; k <= hi; k++)
    logs.push(
      logChoose(successes, k) + logChoose(total - successes, draws - k),
    );
  const top = Math.max(...logs);
  return { lo, weights: logs.map((v) => Math.exp(v - top)) };
}

/** Two-sided Fisher exact p: the tables with the same margins whose probability is at most the observed one's (within a relative 1e-7). */
export function fisherTwoSided(x1: number, n1: number, x2: number, n2: number) {
  const { lo, weights } = hypergeometric(n1, x1 + x2, n1 + n2);
  const observed = weights[x1 - lo];
  let below = 0,
    all = 0;
  for (const w of weights) {
    all += w;
    if (w <= observed * (1 + 1e-7)) below += w;
  }
  return Math.min(1.0, below / all);
}

/** One-sided Fisher exact p for positive association: P(X >= x) for X ~ Hypergeometric(total, successes, draws). */
export function fisherGreater(
  x: number,
  successes: number,
  draws: number,
  total: number,
) {
  const { lo, weights } = hypergeometric(successes, draws, total);
  if (x <= lo) return 1.0;
  const tail = sum(weights.slice(x - lo));
  return Math.min(1.0, tail / sum(weights));
}

export type Table = [number, number, number, number];
/** The chance gate of section 5.2: one-sided Fisher per one-vs-rest table (tp, support, predicted, n), Bonferroni over k >= 3 tables, on the two-sided scale. */
export function chanceExactP(tables: Table[]) {
  const tests = tables.length <= 2 ? 1 : tables.length;
  return Math.min(
    1.0,
    2.0 *
      tests *
      Math.min(...tables.map(([tp, s, p, n]) => fisherGreater(tp, s, p, n))),
  );
}

export type Chance = [number, Table[]];
export function chanceGated(band: Partial<Band> | null, chance: Chance | null) {
  const lower = band ? bound(band, "lower") : null;
  return (
    chance !== null &&
    lower !== null &&
    (lower > chance[0] || onBoundary(lower, chance[0]))
  );
}

export function bonferroni(pvalues: number[]) {
  const m = pvalues.length;
  return pvalues.map((p) => Math.min(1.0, m * p));
}

export function benjaminiHochberg(pvalues: number[]) {
  const m = pvalues.length;
  const order = [...pvalues.keys()].sort((a, b) => pvalues[a] - pvalues[b]);
  const adjusted = new Array<number>(m).fill(1.0);
  let running = 1.0;
  for (let rank = m - 1; rank >= 0; rank--) {
    const i = order[rank];
    running = Math.min(running, (m * pvalues[i]) / (rank + 1));
    adjusted[i] = Math.min(1.0, running);
  }
  return adjusted;
}
