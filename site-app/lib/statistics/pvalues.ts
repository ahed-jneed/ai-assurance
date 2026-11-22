// Audit statistics: decision directions and z* inversions.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { Z_MAX } from "./core";
import { onBoundary } from "./numerics";
import { type Interval, koopmanZ, jFromF1 } from "./intervals";

// ------------------------------------------------------------ decision p-values
export type Band = { lower: number | null; upper: number | null };
export type Direction = "pass" | "fail" | "none";

export const bound = (
  band: Partial<Band> | null | undefined,
  key: keyof Band,
) => band?.[key] ?? null;

export function directionOf(estimate: number, band: Partial<Band>): Direction {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  if (
    (lower !== null && onBoundary(estimate, lower)) ||
    (upper !== null && onBoundary(estimate, upper))
  )
    return "none";
  if (
    (lower !== null && estimate < lower) ||
    (upper !== null && estimate > upper)
  )
    return "fail";
  return "pass";
}

export type CiAt = (z: number) => Interval;

/** z* = sup{z >= 0 : the interval at z decides `direction`}; bisection, normative for composite methods. */
export function invert(ciAt: CiAt, band: Partial<Band>, direction: Direction) {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const holds = (z: number) => {
    const [lo, hi] = ciAt(z);
    if (direction === "pass")
      return (lower === null || lo >= lower) && (upper === null || hi <= upper);
    return (lower !== null && hi < lower) || (upper !== null && lo > upper);
  };
  if (!holds(0.0)) return 0.0;
  if (holds(Z_MAX)) return Z_MAX;
  let lo = 0.0,
    hi = Z_MAX;
  while (hi - lo > 1e-12) {
    const mid = (lo + hi) / 2.0;
    if (holds(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Closed form: the Wilson interval is the inversion of the score test, z(T) = (p - T)/sqrt(T(1-T)/n). */
export function wilsonZstar(
  x: number,
  n: number,
  band: Partial<Band>,
  direction: Direction,
) {
  const p = x / n;
  let lower = bound(band, "lower"),
    upper = bound(band, "upper");
  if (lower !== null && lower <= 0.0) lower = null;
  if (upper !== null && upper >= 1.0) upper = null;
  const score = (t: number) => (p - t) / Math.sqrt((t * (1.0 - t)) / n);
  if (direction === "pass") {
    const candidates = [
      ...(lower !== null ? [score(lower)] : []),
      ...(upper !== null ? [-score(upper)] : []),
    ];
    return candidates.length ? Math.min(...candidates) : Z_MAX;
  }
  if (lower !== null && p < lower) return -score(lower);
  return score(upper as number);
}

export function logZstar(
  estimate: number,
  se: number,
  band: Partial<Band>,
  direction: Direction,
) {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const le = Math.log(estimate);
  if (direction === "pass")
    return Math.min(
      ...(lower !== null ? [(le - Math.log(lower)) / se] : []),
      ...(upper !== null ? [(Math.log(upper) - le) / se] : []),
    );
  if (lower !== null && estimate < lower) return (Math.log(lower) - le) / se;
  return (le - Math.log(upper as number)) / se;
}

export function koopmanZstar(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  band: Partial<Band>,
  direction: Direction,
) {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  if (direction === "pass")
    return Math.min(
      ...(lower !== null ? [koopmanZ(x1, n1, x2, n2, lower)] : []),
      ...(upper !== null ? [-koopmanZ(x1, n1, x2, n2, upper)] : []),
    );
  const estimate = x1 / n1 / (x2 / n2);
  if (lower !== null && estimate < lower)
    return -koopmanZ(x1, n1, x2, n2, lower);
  return koopmanZ(x1, n1, x2, n2, upper as number);
}

export function normalZstar(
  mean: number,
  se: number,
  band: Partial<Band>,
  direction: Direction,
) {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  if (direction === "pass")
    return Math.min(
      ...(lower !== null ? [(mean - lower) / se] : []),
      ...(upper !== null ? [(upper - mean) / se] : []),
    );
  if (lower !== null && mean < lower) return (lower - mean) / se;
  return (mean - (upper as number)) / se;
}

const mapBand = (band: Partial<Band>, f: (v: number) => number): Band => ({
  lower: bound(band, "lower") === null ? null : f(band.lower!),
  upper: bound(band, "upper") === null ? null : f(band.upper!),
});
export const squareBand = (band: Partial<Band>) => mapBand(band, (v) => v ** 2);
export const jaccardBand = (band: Partial<Band>) => mapBand(band, jFromF1);
export const logBand = (band: Partial<Band>) => mapBand(band, Math.log);
