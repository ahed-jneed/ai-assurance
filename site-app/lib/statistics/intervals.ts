// Audit statistics: confidence intervals at a critical value z.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { Z_MAX } from "./core";
import { SQRT2, erfc, normalQuantile, sum } from "./numerics";

// ------------------------------------------------------------ intervals at critical value z
export type Interval = [number, number];
export function wilson(x: number, n: number, z: number): Interval {
  const p = x / n;
  const denominator = 1.0 + (z * z) / n;
  const center = (p + (z * z) / (2.0 * n)) / denominator;
  const half =
    (z * Math.sqrt((p * (1.0 - p)) / n + (z * z) / (4.0 * n * n))) /
    denominator;
  const lower = x === 0 ? 0.0 : Math.max(0.0, center - half);
  const upper = x === n ? 1.0 : Math.min(1.0, center + half);
  return [lower, upper];
}

export function newcombe(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  z: number,
): Interval {
  const p1 = x1 / n1,
    p2 = x2 / n2;
  const [l1, u1] = wilson(x1, n1, z);
  const [l2, u2] = wilson(x2, n2, z);
  const d = p1 - p2;
  return [
    d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2),
    d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2),
  ];
}

export function katz(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  z: number,
): Interval {
  const r = x1 / n1 / (x2 / n2);
  const se = Math.sqrt(1.0 / x1 - 1.0 / n1 + 1.0 / x2 - 1.0 / n2);
  return [r * Math.exp(-z * se), r * Math.exp(z * se)];
}

/** Score statistic for H0: p1/p2 = phi (Koopman 1984; Farrington-Manning/Miettinen-Nurminen without n/(n-1)). */
export function koopmanZ(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  f: number,
) {
  const a = (n1 + n2) * f;
  const b = -(n1 * f + x1 + n2 + x2 * f);
  const c = x1 + x2;
  const p2 = (2.0 * c) / (-b + Math.sqrt(Math.max(b * b - 4.0 * a * c, 0.0)));
  const p1 = f * p2;
  const variance = (p1 * (1.0 - p1)) / n1 + (f * f * p2 * (1.0 - p2)) / n2;
  const numerator = x1 / n1 - (f * x2) / n2;
  if (variance <= 0.0)
    return numerator === 0 ? 0.0 : Math.sign(numerator) * Infinity;
  return numerator / Math.sqrt(variance);
}

function koopmanSolve(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  target: number,
  lo: number,
  hi: number,
) {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2.0;
    if (koopmanZ(x1, n1, x2, n2, Math.exp(mid)) > target) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-13) break;
  }
  return Math.exp((lo + hi) / 2.0);
}

export function koopman(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  z: number,
): Interval {
  const estimate = x1 / n1 / (x2 / n2);
  if (z === 0.0) return [estimate, estimate];
  const anchor = x1 > 0 ? Math.log(estimate) : -60.0;
  const lower =
    x1 === 0 ? 0.0 : koopmanSolve(x1, n1, x2, n2, z, anchor - 60.0, anchor);
  const upper = koopmanSolve(x1, n1, x2, n2, -z, anchor, anchor + 120.0);
  return [lower, upper];
}

export function ratioMethod(x1: number, n1: number, x2: number, n2: number) {
  if (x2 === 0) return null;
  if (x1 >= 1 && !(x1 === n1 && x2 === n2)) return "katz_log";
  return "koopman_score";
}

/** MOVER (Zou & Donner 2008) interval for the mean of independent proportions, Wilson limits. */
export function moverMean(parts: [number, number][], z: number): Interval {
  const k = parts.length;
  const estimates = parts.map(([x, n]) => x / n);
  const limits = parts.map(([x, n]) => wilson(x, n, z));
  const mean = sum(estimates) / k;
  const lower =
    mean - Math.sqrt(sum(estimates.map((p, i) => (p - limits[i][0]) ** 2))) / k;
  const upper =
    mean + Math.sqrt(sum(estimates.map((p, i) => (limits[i][1] - p) ** 2))) / k;
  return [lower, upper];
}

export const f1FromJ = (j: number) => (2.0 * j) / (1.0 + j);
export const jFromF1 = (f: number) => f / (2.0 - f);

export function jaccardF1(tp: number, m: number, z: number): Interval {
  const [lo, hi] = wilson(tp, m, z);
  return [f1FromJ(lo), f1FromJ(hi)];
}

/** Critical value for each of k per-class intervals when the macro interval uses Bonferroni at the level of z. */
export function perClassZ(z: number, k: number) {
  const tail = erfc(z / SQRT2) / 2.0;
  return tail / k > 0 ? Math.min(Z_MAX, -normalQuantile(tail / k)) : Z_MAX;
}

export function macroF1Interval(
  classes: [number, number][],
  z: number,
): Interval {
  const zk = z > 0 ? perClassZ(z, classes.length) : 0.0;
  const bounds = classes.map(([tp, m]) => jaccardF1(tp, m, zk));
  return [
    sum(bounds.map((b) => b[0])) / bounds.length,
    sum(bounds.map((b) => b[1])) / bounds.length,
  ];
}

/** Macro precision: per-class Wilson intervals at the Bonferroni level, averaged (conservative, any dependence). */
export function meanBonferroniWilson(
  parts: [number, number][],
  z: number,
): Interval {
  const zk = z > 0 ? perClassZ(z, parts.length) : 0.0;
  const bounds = parts.map(([x, n]) => wilson(x, n, zk));
  return [
    sum(bounds.map((b) => b[0])) / bounds.length,
    sum(bounds.map((b) => b[1])) / bounds.length,
  ];
}
