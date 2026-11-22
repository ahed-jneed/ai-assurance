// Audit statistics: normal distribution, code-point order and exact sums.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { Z_MAX, EPS } from "./core";

// ------------------------------------------------------------ numerics
export const SQRT2 = Math.SQRT2;
const SQRTPI = Math.sqrt(Math.PI);

/** erfc for x >= 0: a positive series below 2, Lentz's continued fraction above (relative error below 1e-12 on [0, 27]). */
function erfcPositive(x: number) {
  if (x < 2) {
    let term = x,
      sum = x;
    for (let n = 1; n < 200; n++) {
      term *= (2 * x * x) / (2 * n + 1);
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    return 1 - (2 / SQRTPI) * Math.exp(-x * x) * sum;
  }
  const tiny = 1e-300;
  let f = x,
    c = x,
    d = 0;
  for (let n = 1; n < 500; n++) {
    const a = n / 2;
    d = x + a * d;
    if (d === 0) d = tiny;
    d = 1 / d;
    c = x + a / c;
    if (c === 0) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / SQRTPI / f;
}
export function erfc(x: number) {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 2;
  return x >= 0 ? erfcPositive(x) : 2 - erfcPositive(-x);
}
function erf(x: number) {
  return x >= 0 ? 1 - erfcPositive(x) : erfcPositive(-x) - 1;
}

/** Wichura's AS241 (PPND16), as Python's statistics.NormalDist.inv_cdf implements it. */
export function normalQuantile(p: number) {
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const num =
      (((((((2.5090809287301226727e3 * r + 3.3430575583588128105e4) * r +
        6.7265770927008700853e4) *
        r +
        4.5921953931549871457e4) *
        r +
        1.3731693765509461125e4) *
        r +
        1.9715909503065514427e3) *
        r +
        1.3314166789178437745e2) *
        r +
        3.387132872796366608) *
      q;
    const den =
      ((((((5.226495278852854561e3 * r + 2.8729085735721942674e4) * r +
        3.930789580009271061e4) *
        r +
        2.1213794301586595867e4) *
        r +
        5.3941960214247511077e3) *
        r +
        6.871870074920579083e2) *
        r +
        4.2313330701600911252e1) *
        r +
      1.0;
    return num / den;
  }
  let r = q <= 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let num: number, den: number;
  if (r <= 5) {
    r -= 1.6;
    num =
      ((((((7.7454501427834140764e-4 * r + 2.27238449892691845833e-2) * r +
        2.4178072517745061177e-1) *
        r +
        1.27045825245236838258) *
        r +
        3.64784832476320460504) *
        r +
        5.7694972214606914055) *
        r +
        4.6303378461565452959) *
        r +
      1.42343711074968357734;
    den =
      ((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r +
        1.51986665636164571966e-2) *
        r +
        1.4810397642748007459e-1) *
        r +
        6.8976733498510000455e-1) *
        r +
        1.6763848301838038494) *
        r +
        2.05319162663775882187) *
        r +
      1.0;
  } else {
    r -= 5;
    num =
      ((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r +
        1.2426609473880784386e-3) *
        r +
        2.6532189526576123093e-2) *
        r +
        2.9656057182850489123e-1) *
        r +
        1.7848265399172913358) *
        r +
        5.4637849111641143699) *
        r +
      6.6579046435011037772;
    den =
      ((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r +
        1.8463183175100546818e-5) *
        r +
        7.868691311456132591e-4) *
        r +
        1.4875361290850614852e-2) *
        r +
        1.3692988092273580531e-1) *
        r +
        5.9983220655588793769e-1) *
        r +
      1.0;
  }
  const x = num / den;
  return q < 0 ? -x : x;
}

export function zcrit(level: number) {
  return normalQuantile(1.0 - (1.0 - level) / 2.0);
}

/** Decision p-value 2*(1 - Phi(z)) for z >= 0. */
export function pFromZ(z: number) {
  return erfc(Math.min(Math.max(z, 0), Z_MAX) / SQRT2);
}

export function onBoundary(value: number, bound: number) {
  return Math.abs(value - bound) <= EPS * Math.max(1.0, Math.abs(bound));
}

/** Unicode code-point order (section 5.10), not the UTF-16 order of the default sort. */
export function codePointCompare(a: string, b: string) {
  const x = [...a],
    y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}
export const byCodePoint = (values: Iterable<string>) =>
  [...values].sort(codePointCompare);

/** Standard normal CDF, as NormalDist().cdf: 0.5 * (1 + erf(x / sqrt 2)). */
export function phi(x: number) {
  return 0.5 * (1.0 + erf(x / SQRT2));
}

/** Plain left-to-right sum, as Python's sum(). */
export function sum(values: number[]) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Exactly rounded sum, as Python's math.fsum (Shewchuk's algorithm). */
export function fsum(values: number[]) {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  let n = partials.length;
  if (!n) return 0;
  let hi = partials[--n],
    lo = 0;
  while (n > 0) {
    const x = hi,
      y = partials[--n];
    hi = x + y;
    const yr = hi - x;
    lo = y - yr;
    if (lo) break;
  }
  if (
    n > 0 &&
    ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))
  ) {
    const y = lo * 2,
      x = hi + y,
      yr = x - hi;
    if (y === yr) hi = x;
  }
  return hi;
}

export function meanSd(values: number[]): [number, number] {
  const n = values.length;
  const mean = fsum(values) / n;
  const sd = Math.sqrt(fsum(values.map((v) => (v - mean) ** 2)) / (n - 1));
  return [mean, sd];
}

export const tupleMin = <T>(items: T[], key: (item: T) => [number, string]) =>
  items.reduce((best, item) => {
    const [a, b] = key(item),
      [c, d] = key(best);
    return a < c || (a === c && codePointCompare(b, d) < 0) ? item : best;
  });
