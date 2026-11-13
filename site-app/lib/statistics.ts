// Audit statistics core: statistics specification 1.0.0
// (docs/design/audit-statistics.md), the hosted runner's port of
// engine/statistics.py.
//
// The interval decides, never the point estimate: a criterion passes only
// when its interval lies inside the pre-registered band, fails only when it
// lies outside, and is inconclusive otherwise (section 4). Confirmatory
// criteria are adjusted with Bonferroni and exploratory criteria with
// Benjamini-Hochberg (section 6). schemas/fixtures/statistics-golden.json is
// the arbiter: lib/statistics.test.ts runs every case through this module,
// and the engine runs the same cases, so both runners decide alike.
//
// Every function mirrors its Python namesake line for line, including the
// order of members, reasons and keys, so a difference between the runners
// is a bug in one of them. Functions work on counts; lib/diagnostics.ts
// turns rows into counts and results.

/* eslint-disable @typescript-eslint/no-explicit-any -- plans and legacy
   configurations are untyped JSON validated here, as in the Python core. */

import library from "./threshold-library.json";

export class StatisticsError extends Error {}

function require_(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StatisticsError(message);
}

export const SPEC_VERSION = "1.0.0";
const Z_MAX = 37.0;
export const FLOORS = { sampleSize: 30, groupSize: 30, classCount: 10 };
type Minimums = typeof FLOORS;
export const EPS = 1e-12;
const MAX_GROUPS: Record<string, number> = { all_pairs: 50, reference: 1000 };
const POWER_SEARCH_LIMIT = 10_000_000;
export const BINARY_METRICS = [
  "accuracy",
  "precision",
  "recall",
  "specificity",
  "false_positive_rate",
  "balanced_accuracy",
  "f1",
] as const;
const BINARY_DESCRIPTIVE = [
  "accuracy",
  "precision",
  "recall",
  "specificity",
  "balanced_accuracy",
  "f1",
];
export const MULTICLASS_METRICS = [
  "accuracy",
  "balanced_accuracy",
  "macro_precision",
  "macro_f1",
] as const;
export const REGRESSION_METRICS = ["mae", "rmse"] as const;
const REGRESSION_DESCRIPTIVE = ["mae", "rmse", "r2"];
export const PERFORMANCE_KINDS = [
  "performance",
  "multiclass_performance",
  "regression_performance",
];
// Metrics that today's engine rule makes a pass depend on but that 1.0.0
// cannot decide by an interval (section 4.8).
const UNDECIDABLE: Record<string, string> = {
  regression_performance: "r2",
  calibration: "expected_calibration_error",
};
// Section 5.9: a regression pass also needs the model to beat the
// mean-prediction baseline; an MSE reduction of at most this share of the
// baseline MSE is floating-point rounding and never counts as beating it.
const BASELINE_TOLERANCE = 1e-9;
const RATE_KEYS: Record<string, "selection" | "tpr" | "fpr"> = {
  selection_rate_difference: "selection",
  selection_rate_ratio: "selection",
  tpr_difference: "tpr",
  fpr_difference: "fpr",
};
// Headline names keep each runner's existing metric names (section 11).
export const HEADLINE_NAMES: Record<
  string,
  { engine: string; hosted: string | null }
> = {
  selection_rate_difference: {
    engine: "demographic_parity_difference",
    hosted: "maximum_selection_rate_gap",
  },
  selection_rate_ratio: {
    engine: "disparate_impact_ratio",
    hosted: "minimum_selection_rate_ratio",
  },
  equalized_odds: {
    engine: "equalized_odds_difference",
    hosted: "maximum_tpr_fpr_gap",
  },
  calibration: { engine: "maximum_calibration_gap", hosted: null },
};

// ------------------------------------------------------------ numerics
const SQRT2 = Math.SQRT2;
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

function onBoundary(value: number, bound: number) {
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
const byCodePoint = (values: Iterable<string>) =>
  [...values].sort(codePointCompare);

/** Standard normal CDF, as NormalDist().cdf: 0.5 * (1 + erf(x / sqrt 2)). */
export function phi(x: number) {
  return 0.5 * (1.0 + erf(x / SQRT2));
}

// ------------------------------------------------------------ intervals at critical value z
type Interval = [number, number];
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
function koopmanZ(x1: number, n1: number, x2: number, n2: number, f: number) {
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
function moverMean(parts: [number, number][], z: number): Interval {
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

const f1FromJ = (j: number) => (2.0 * j) / (1.0 + j);
const jFromF1 = (f: number) => f / (2.0 - f);

function jaccardF1(tp: number, m: number, z: number): Interval {
  const [lo, hi] = wilson(tp, m, z);
  return [f1FromJ(lo), f1FromJ(hi)];
}

/** Critical value for each of k per-class intervals when the macro interval uses Bonferroni at the level of z. */
function perClassZ(z: number, k: number) {
  const tail = erfc(z / SQRT2) / 2.0;
  return tail / k > 0 ? Math.min(Z_MAX, -normalQuantile(tail / k)) : Z_MAX;
}

function macroF1Interval(classes: [number, number][], z: number): Interval {
  const zk = z > 0 ? perClassZ(z, classes.length) : 0.0;
  const bounds = classes.map(([tp, m]) => jaccardF1(tp, m, zk));
  return [
    sum(bounds.map((b) => b[0])) / bounds.length,
    sum(bounds.map((b) => b[1])) / bounds.length,
  ];
}

/** Macro precision: per-class Wilson intervals at the Bonferroni level, averaged (conservative, any dependence). */
function meanBonferroniWilson(parts: [number, number][], z: number): Interval {
  const zk = z > 0 ? perClassZ(z, parts.length) : 0.0;
  const bounds = parts.map(([x, n]) => wilson(x, n, zk));
  return [
    sum(bounds.map((b) => b[0])) / bounds.length,
    sum(bounds.map((b) => b[1])) / bounds.length,
  ];
}

/** Plain left-to-right sum, as Python's sum(). */
function sum(values: number[]) {
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

function meanSd(values: number[]): [number, number] {
  const n = values.length;
  const mean = fsum(values) / n;
  const sd = Math.sqrt(fsum(values.map((v) => (v - mean) ** 2)) / (n - 1));
  return [mean, sd];
}

// ------------------------------------------------------------ decision p-values
export type Band = { lower: number | null; upper: number | null };
type Direction = "pass" | "fail" | "none";

const bound = (band: Partial<Band> | null | undefined, key: keyof Band) =>
  band?.[key] ?? null;

function directionOf(estimate: number, band: Partial<Band>): Direction {
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

type CiAt = (z: number) => Interval;

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

function logZstar(
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

function koopmanZstar(
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

function normalZstar(
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
const squareBand = (band: Partial<Band>) => mapBand(band, (v) => v ** 2);
const jaccardBand = (band: Partial<Band>) => mapBand(band, jFromF1);
const logBand = (band: Partial<Band>) => mapBand(band, Math.log);

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

type Table = [number, number, number, number];
/** The chance gate of section 5.2: one-sided Fisher per one-vs-rest table (tp, support, predicted, n), Bonferroni over k >= 3 tables, on the two-sided scale. */
function chanceExactP(tables: Table[]) {
  const tests = tables.length <= 2 ? 1 : tables.length;
  return Math.min(
    1.0,
    2.0 *
      tests *
      Math.min(...tables.map(([tp, s, p, n]) => fisherGreater(tp, s, p, n))),
  );
}

type Chance = [number, Table[]];
function chanceGated(band: Partial<Band> | null, chance: Chance | null) {
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

// ------------------------------------------------------------ canonical JSON (RFC 8785) and plan hash
/** RFC 8785 canonical JSON: keys sorted by UTF-16 code units, ECMAScript number serialisation, no whitespace. */
export function jcs(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            jcs((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  }
  throw new TypeError(typeof value);
}

const K256 = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** SHA-256 of a string's UTF-8 bytes, synchronous so plan hashing needs no Web Crypto round trip. */
export function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const padded = new Uint8Array(((length + 72) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

export function planSha256(plan: unknown) {
  return sha256Hex(jcs(plan));
}

// ------------------------------------------------------------ plan normalisation, library and legacy derivation
/** Python's dict.get: the value when the key is present (even null), else the default. */
function get(o: any, key: string, fallback: any = null) {
  return o !== null && typeof o === "object" && key in o ? o[key] : fallback;
}

type LibraryParameter = {
  default: any;
  minimum?: number;
  maximum?: number;
  enum?: readonly string[];
};
export type LibraryEntry = {
  version: number;
  kind: string;
  metric: string | null;
  parameters: Record<string, LibraryParameter>;
  legalStatus:
    "screening_heuristic" | "reporting_only" | "no_legal_safe_harbour";
  caveat: string;
};
/** One entry of schemas/threshold-library.json, with its sources and dated status notes. */
export type LibraryRecord = LibraryEntry & {
  id: string;
  sources: string[];
  statusNotes: { asOf: string; text: string; source: string }[];
  band?: "lower" | "upper";
  research?: string;
};
/** Section 10.1: the threshold library, shipped identically to both runners (schemas/threshold-library.json). */
export const THRESHOLD_LIBRARY = library.entries as unknown as LibraryRecord[];
/** The entries a plan criterion can reference; engine/statistics.py LIBRARY mirrors them. */
export const LIBRARY: Record<string, LibraryEntry> = Object.fromEntries(
  THRESHOLD_LIBRARY.filter((e) =>
    [...PERFORMANCE_KINDS, "group_comparison", "calibration"].includes(e.kind),
  ).map((e) => [
    e.id,
    {
      version: e.version,
      kind: e.kind,
      metric: e.metric,
      parameters: e.parameters,
      legalStatus: e.legalStatus,
      caveat: e.caveat,
    },
  ]),
);

function bandNorm(band: any): Band | null {
  return band === null || band === undefined
    ? null
    : { lower: get(band, "lower"), upper: get(band, "upper") };
}

function libraryBand(entryId: string, params: Record<string, number>): Band {
  if (["screen.us.four-fifths", "policy.eu-aia.impact-ratio"].includes(entryId))
    return { lower: params.tau, upper: 1.0 / params.tau };
  if (
    [
      "policy.eu-aia.selection-rate-difference",
      "policy.eu-aia.equalized-odds",
      "policy.eu-aia.calibration",
    ].includes(entryId)
  )
    return { lower: -params.delta, upper: params.delta };
  throw new Error(entryId);
}

const sameJson = (a: unknown, b: unknown) => jcs(a) === jcs(b);

function normalizeLibrary(entry: any, criterion: any) {
  if (entry === null || entry === undefined) return null;
  const spec = LIBRARY[entry.id];
  require_(spec, "unknown library entry");
  require_(
    get(entry, "version", spec.version) === spec.version,
    "unknown library version",
  );
  require_(
    criterion.kind === spec.kind &&
      (spec.metric === null || spec.metric === get(criterion, "metric")),
    "criterion does not match its library entry",
  );
  const params: Record<string, any> = {};
  for (const [name, rule] of Object.entries(spec.parameters)) {
    const value = get(get(entry, "parameters", {}), name, rule.default);
    require_(value !== null, `library parameter ${name} is required`);
    require_(
      rule.enum
        ? rule.enum.includes(value)
        : typeof value === "number" &&
            rule.minimum! <= value &&
            value <= rule.maximum!,
      `library parameter ${name} outside its range`,
    );
    params[name] = value;
  }
  const overridden = byCodePoint(
    Object.entries(spec.parameters)
      .filter(([name, rule]) => params[name] !== rule.default)
      .map(([name]) => name),
  );
  return {
    id: entry.id,
    version: spec.version,
    parameters: params,
    overriddenParameters: overridden,
  };
}

function normalizeAssumptions(criterion: any, assumptions: any) {
  if (assumptions === null || assumptions === undefined) return null;
  const kind = criterion.kind;
  const pick = (keys: string[]) =>
    Object.fromEntries(
      keys.map((key) => {
        require_(key in assumptions, `power assumption ${key} is required`);
        return [key, assumptions[key]];
      }),
    );
  if (kind === "group_comparison")
    return {
      groupSizes: { ...assumptions.groupSizes },
      baselineRate: get(assumptions, "baselineRate"),
      assumedRates: get(assumptions, "assumedRates"),
      prevalence: get(assumptions, "prevalence"),
      truePositiveRate: get(assumptions, "truePositiveRate"),
      falsePositiveRate: get(assumptions, "falsePositiveRate"),
    };
  if (kind === "performance")
    return pick(["n", "prevalence", "truePositiveRate", "trueNegativeRate"]);
  if (kind === "multiclass_performance") {
    require_(
      Math.abs(fsum(Object.values(assumptions.classShares as object)) - 1.0) <=
        1e-9,
      "class shares must sum to 1",
    );
    // Section 8: each class's expected support n*share is a denominator, and
    // every class needs its recall (#113).
    require_(
      Object.values(assumptions.classShares as Record<string, number>).every(
        (share) => share > 0,
      ),
      "every class share must be above 0",
    );
    const classes = Object.keys(assumptions.classShares),
      recalls = Object.keys(assumptions.perClassRecall ?? {});
    require_(
      recalls.length === classes.length &&
        recalls.every((label) => Object.hasOwn(assumptions.classShares, label)),
      "perClassRecall must name exactly the classes of classShares",
    );
    return pick(["n", "classShares", "perClassRecall"]);
  }
  if (kind === "regression_performance") return pick(["n", "errorSd"]);
  throw new StatisticsError("power assumptions are not defined for " + kind);
}

export type PlanMember = { metric: string; band: Band };
export type PlanCriterion = {
  id: string;
  kind: string;
  role: "confirmatory" | "exploratory";
  rationale: string | null;
  members?: PlanMember[];
  metric?: string;
  band?: Band | null;
  comparison?: { mode: string; referenceGroup: string | null };
  groupFields?: string[] | null;
  declaredGroups?: string[] | null;
  minimumCoverage?: number;
  subgroup?: { field: string; value: string } | null;
  passBlockedBy?: string[];
  libraryEntry: {
    id: string;
    version: number;
    parameters: Record<string, any>;
    overriddenParameters: string[];
  } | null;
  powerAssumptions: any;
  _decide?: boolean;
};
export type Plan = {
  statisticsVersion: string;
  confidenceLevel: number;
  minimums: Minimums;
  configuredMinimums: Minimums | null;
  multiplicity: { confirmatory: string; exploratory: string };
  clusterField: string | null;
  bootstrap: { replicates: number };
  calibrationBins: number;
  power: { targetPower: number; acknowledgement: string | null };
  derivedFrom: { source: string; contractVersion: string } | null;
  criteria: PlanCriterion[];
};

export function normalizeCriterion(c: any): PlanCriterion {
  const kind = c.kind;
  const out: any = {
    id: c.id,
    kind,
    role: get(c, "role", "confirmatory"),
    rationale: get(c, "rationale"),
  };
  if (PERFORMANCE_KINDS.includes(kind))
    out.members = (get(c, "members", []) as any[]).map((m) => ({
      metric: m.metric,
      band: bandNorm(m.band),
    }));
  else if (kind === "group_comparison") {
    const mode = get(c, "comparison") || { mode: "all_pairs" };
    Object.assign(out, {
      metric: c.metric,
      band: bandNorm(get(c, "band")),
      comparison: {
        mode: mode.mode,
        referenceGroup: get(mode, "referenceGroup"),
      },
      groupFields: get(c, "groupFields"),
      declaredGroups: get(c, "declaredGroups"),
      minimumCoverage: get(c, "minimumCoverage", 1.0),
    });
  } else if (kind === "calibration")
    Object.assign(out, {
      band: bandNorm(get(c, "band")),
      members: (get(c, "members", []) as any[]).map((m) => ({
        metric: m.metric,
        band: bandNorm(m.band),
      })),
      minimumCoverage: get(c, "minimumCoverage", 1.0),
      subgroup: get(c, "subgroup"),
    });
  else throw new StatisticsError("unknown criterion kind " + kind);
  if (kind in UNDECIDABLE) {
    out.passBlockedBy = [...get(c, "passBlockedBy", [])];
    require_(
      out.passBlockedBy.every((m: string) => m === UNDECIDABLE[kind]) &&
        new Set(out.passBlockedBy).size === out.passBlockedBy.length,
      "passBlockedBy names this kind's undecidable metric at most once",
    );
  }
  out.libraryEntry = normalizeLibrary(get(c, "libraryEntry"), out);
  if (
    out.libraryEntry !== null &&
    ["group_comparison", "calibration"].includes(kind)
  ) {
    const expected = libraryBand(
      out.libraryEntry.id,
      out.libraryEntry.parameters,
    );
    if (out.band === null) out.band = expected;
    require_(
      sameJson(out.band, expected),
      "the band must equal the one its library entry derives",
    );
  }
  out.powerAssumptions = normalizeAssumptions(out, get(c, "powerAssumptions"));
  return out;
}

export function normalizePlan(p: any): Plan {
  const minimums = Object.fromEntries(
    (Object.keys(FLOORS) as (keyof Minimums)[]).map((key) => [
      key,
      get(get(p, "minimums", {}), key, FLOORS[key]),
    ]),
  ) as Minimums;
  require_(
    (Object.keys(FLOORS) as (keyof Minimums)[]).every(
      (key) => minimums[key] >= FLOORS[key],
    ),
    "plan minimums below platform floors",
  );
  const multiplicity = {
    confirmatory: "bonferroni",
    exploratory: "benjamini_hochberg",
  };
  require_(
    sameJson(get(p, "multiplicity", multiplicity), multiplicity),
    "1.0.0 fixes the family adjustments",
  );
  const power = get(p, "power", {});
  const plan: Plan = {
    statisticsVersion: get(p, "statisticsVersion", SPEC_VERSION),
    confidenceLevel: get(p, "confidenceLevel", 0.95),
    minimums,
    configuredMinimums: get(p, "configuredMinimums"),
    multiplicity,
    clusterField: get(p, "clusterField"),
    bootstrap: { replicates: get(get(p, "bootstrap", {}), "replicates", 2000) },
    calibrationBins: get(p, "calibrationBins", 10),
    power: {
      targetPower: get(power, "targetPower", 0.8),
      acknowledgement: get(power, "acknowledgement"),
    },
    derivedFrom: get(p, "derivedFrom"),
    criteria: (p.criteria as any[]).map(normalizeCriterion),
  };
  require_(
    plan.statisticsVersion === SPEC_VERSION,
    "statisticsVersion must be 1.0.0",
  );
  require_(
    [0.9, 0.95, 0.99].includes(plan.confidenceLevel),
    "confidenceLevel must be 0.90, 0.95 or 0.99",
  );
  const ids = plan.criteria.map((c) => c.id);
  require_(new Set(ids).size === ids.length, "criterion ids must be unique");
  require_(
    plan.derivedFrom !== null ||
      !plan.criteria.some((c) => c.passBlockedBy?.length),
    "passBlockedBy occurs only in derived plans",
  );
  return plan;
}

const PROPORTION_METRICS = new Set<string>([
  ...BINARY_METRICS,
  ...MULTICLASS_METRICS,
]);
const ERROR_METRICS = new Set(["mae", "rmse", "brier_score"]);
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const real = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Section 3: why a band is not allowed for this metric, or null. */
export function bandProblem(
  metric: string,
  band: any,
  mode = "all_pairs",
): string | null {
  if (
    band === null ||
    typeof band !== "object" ||
    Array.isArray(band) ||
    Object.keys(band).some((k) => k !== "lower" && k !== "upper")
  )
    return "a band is an object with lower and upper";
  const lower = get(band, "lower"),
    upper = get(band, "upper");
  if (lower === null && upper === null)
    return "a band needs at least one bound";
  if ([lower, upper].some((v) => v !== null && !real(v)))
    return "band bounds must be finite numbers";
  if (PROPORTION_METRICS.has(metric)) {
    if ([lower, upper].some((v) => v !== null && !(0.0 < v && v < 1.0)))
      return "proportion bounds must lie strictly inside (0, 1)";
    if (lower !== null && upper !== null && !(lower < upper))
      return "the lower bound must be below the upper bound";
    return null;
  }
  if (ERROR_METRICS.has(metric))
    return lower === null && upper !== null && upper > 0
      ? null
      : "error metrics take an upper bound above 0 only";
  if (
    [
      "selection_rate_difference",
      "equalized_odds",
      "tpr_difference",
      "fpr_difference",
      "calibration_gap",
    ].includes(metric)
  ) {
    if (lower !== null && upper !== null)
      return lower === -upper && 0.0 < upper && upper < 1.0
        ? null
        : "a difference band is symmetric, {lower: -delta, upper: delta} with 0 < delta < 1";
    if (mode !== "reference" || metric === "calibration_gap")
      return "a difference band in all_pairs mode is symmetric";
    return (lower !== null && -1.0 < lower && lower < 0.0) ||
      (upper !== null && 0.0 < upper && upper < 1.0)
      ? null
      : "a one-sided difference band needs 0 < delta < 1";
  }
  if (metric === "selection_rate_ratio") {
    if (lower === null || !(0.0 < lower && lower < 1.0))
      return "a ratio band needs a lower bound tau with 0 < tau < 1";
    if (upper === null)
      return mode === "reference"
        ? null
        : "a ratio band in all_pairs mode is [tau, 1/tau]";
    return upper === 1.0 / lower
      ? null
      : "a ratio band's upper bound is exactly 1/tau";
  }
  return "unknown metric " + metric;
}

/** The first section 3 violation among a normalised criterion's bands, or null. */
export function criterionBandProblem(c: PlanCriterion): string | null {
  for (const item of c.members ?? []) {
    const problem = bandProblem(item.metric, item.band);
    if (problem) return `${item.metric}: ${problem}`;
  }
  if (c.kind === "group_comparison" && c.band !== null) {
    const problem = bandProblem(c.metric!, c.band, c.comparison!.mode);
    if (problem) return `${c.metric}: ${problem}`;
  }
  if (c.kind === "calibration" && c.band !== null) {
    const problem = bandProblem("calibration_gap", c.band);
    if (problem) return `calibration_gap: ${problem}`;
  }
  return null;
}

function keys(
  value: any,
  allowed: readonly string[],
  required: readonly string[],
  where: string,
) {
  require_(
    value !== null && typeof value === "object" && !Array.isArray(value),
    where + " must be an object",
  );
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  require_(
    !unknown.length,
    where + " has unknown fields: " + byCodePoint(unknown).join(", "),
  );
  const missing = required.filter((k) => !(k in value));
  require_(!missing.length, where + " is missing " + missing.join(", "));
}

const integerIn = (v: unknown, lower: number, upper: number) =>
  Number.isInteger(v) && lower <= (v as number) && (v as number) <= upper;

const CRITERION_FIELDS: Record<string, readonly string[]> = {
  performance: ["members", "powerAssumptions"],
  multiclass_performance: ["members", "powerAssumptions"],
  regression_performance: ["members", "passBlockedBy", "powerAssumptions"],
  group_comparison: [
    "metric",
    "band",
    "comparison",
    "groupFields",
    "declaredGroups",
    "minimumCoverage",
    "powerAssumptions",
  ],
  calibration: [
    "band",
    "members",
    "minimumCoverage",
    "subgroup",
    "passBlockedBy",
    "powerAssumptions",
  ],
};
const MEMBER_METRICS: Record<string, readonly string[]> = {
  performance: BINARY_METRICS,
  multiclass_performance: MULTICLASS_METRICS,
  regression_performance: REGRESSION_METRICS,
  calibration: ["brier_score"],
};
const MEMBER_LIMITS: Record<string, number> = {
  performance: 7,
  multiclass_performance: 4,
  regression_performance: 2,
  calibration: 1,
};
const PLAN_FIELDS = [
  "statisticsVersion",
  "confidenceLevel",
  "minimums",
  "configuredMinimums",
  "multiplicity",
  "clusterField",
  "bootstrap",
  "calibrationBins",
  "power",
  "derivedFrom",
  "criteria",
];
const textOf = (v: unknown, min: number, max: number) =>
  typeof v === "string" && min <= v.length && v.length <= max;

function validateGroupFields(c: any, where: string) {
  require_(
    [
      "selection_rate_difference",
      "selection_rate_ratio",
      "equalized_odds",
    ].includes(c.metric),
    where + ".metric is not a group metric",
  );
  const comparison = get(c, "comparison", { mode: "all_pairs" });
  keys(comparison, ["mode", "referenceGroup"], ["mode"], where + ".comparison");
  require_(
    comparison.mode in MAX_GROUPS,
    where + ".comparison.mode must be all_pairs or reference",
  );
  const reference = get(comparison, "referenceGroup");
  require_(
    (comparison.mode === "reference") === (reference !== null),
    where +
      ".comparison.referenceGroup is required in reference mode, and only there",
  );
  require_(
    reference === null || textOf(reference, 1, 5000),
    where + ".comparison.referenceGroup must be a group label",
  );
  const fields = get(c, "groupFields");
  require_(
    fields === null ||
      (Array.isArray(fields) &&
        fields.length >= 1 &&
        fields.length <= 5 &&
        new Set(fields).size === fields.length &&
        fields.every((f) => textOf(f, 1, 300))),
    where + ".groupFields must be null or 1 to 5 unique column names",
  );
  const declared = get(c, "declaredGroups");
  require_(
    declared === null ||
      (Array.isArray(declared) &&
        declared.length >= 1 &&
        declared.length <= 1000 &&
        new Set(declared).size === declared.length &&
        declared.every((g) => textOf(g, 1, 5000))),
    where + ".declaredGroups must be null or unique group labels",
  );
  require_(
    get(c, "band") !== null || get(c, "libraryEntry") !== null,
    where + ".band is required",
  );
}

function validateCriterion(c: any, where: string) {
  require_(
    c !== null && typeof c === "object" && get(c, "kind") in CRITERION_FIELDS,
    where + ".kind is not a statistics 1.0.0 criterion kind",
  );
  const kind = c.kind;
  const required = [
    "id",
    "kind",
    ...(PERFORMANCE_KINDS.includes(kind)
      ? ["members"]
      : kind === "group_comparison"
        ? ["metric"]
        : []),
  ];
  keys(
    c,
    [
      "id",
      "kind",
      "role",
      "rationale",
      "libraryEntry",
      ...CRITERION_FIELDS[kind],
    ],
    required,
    where,
  );
  require_(
    typeof c.id === "string" && ID_PATTERN.test(c.id),
    where + ".id must match the run schema's id pattern",
  );
  require_(
    ["confirmatory", "exploratory"].includes(get(c, "role", "confirmatory")),
    where + ".role must be confirmatory or exploratory",
  );
  const rationale = get(c, "rationale");
  require_(
    rationale === null || textOf(rationale, 1, 5000),
    where + ".rationale must be null or text",
  );
  require_(
    !get(c, "passBlockedBy")?.length,
    where + ".passBlockedBy occurs only in derived plans",
  );
  if (kind in MEMBER_METRICS) {
    const items = get(c, "members", []);
    require_(
      Array.isArray(items) && items.length <= MEMBER_LIMITS[kind],
      `${where}.members holds at most ${MEMBER_LIMITS[kind]} members`,
    );
    for (const item of items) {
      keys(item, ["metric", "band"], ["metric", "band"], where + ".members[]");
      require_(
        MEMBER_METRICS[kind].includes(item.metric),
        `${where}: '${item.metric}' is not a ${kind} metric`,
      );
    }
    require_(
      kind === "calibration" || items.length,
      where + ".members must name at least one metric",
    );
  }
  if (kind === "group_comparison") validateGroupFields(c, where);
  if (["group_comparison", "calibration"].includes(kind)) {
    const coverage = get(c, "minimumCoverage", 1.0);
    require_(
      real(coverage) && 0.5 <= coverage && coverage <= 1.0,
      where + ".minimumCoverage must lie in [0.5, 1]",
    );
  }
  if (kind === "calibration") {
    const subgroup = get(c, "subgroup");
    if (subgroup !== null) {
      keys(
        subgroup,
        ["field", "value"],
        ["field", "value"],
        where + ".subgroup",
      );
      require_(
        ["field", "value"].every((k) => textOf(subgroup[k], 1, Infinity)),
        where + ".subgroup needs a field and a value",
      );
    }
    require_(
      get(c, "band") !== null ||
        get(c, "members", []).length ||
        get(c, "libraryEntry") !== null,
      where + " needs a gap band or a Brier member",
    );
    require_(
      get(c, "powerAssumptions") === null,
      where + ".powerAssumptions is not defined for calibration",
    );
  }
  if (get(c, "libraryEntry") !== null) {
    const entry = c.libraryEntry;
    keys(
      entry,
      ["id", "version", "parameters", "overriddenParameters"],
      ["id"],
      where + ".libraryEntry",
    );
    require_(
      entry.id in LIBRARY,
      where + ".libraryEntry.id is not a library entry",
    );
  }
}

/**
 * Validates a new plan as written (section 9.1, schemas/statistics-plan.schema.json
 * and the section 3 bands) and returns it normalised. Derived plans come from
 * deriveHosted() and deriveEngine() instead.
 */
export function validatePlan(p: any): Plan {
  keys(p, PLAN_FIELDS, ["criteria"], "statistics");
  require_(
    get(p, "derivedFrom") === null,
    "statistics.derivedFrom is set only by legacy derivation",
  );
  require_(
    get(p, "configuredMinimums") === null,
    "statistics.configuredMinimums is set only by legacy derivation",
  );
  if ("minimums" in p) {
    keys(p.minimums, Object.keys(FLOORS), [], "statistics.minimums");
    for (const [key, value] of Object.entries(p.minimums))
      require_(
        integerIn(value, FLOORS[key as keyof Minimums], 1_000_000),
        `statistics.minimums.${key} must be an integer from ${FLOORS[key as keyof Minimums]} (the platform floor) to 1000000`,
      );
  }
  if ("bootstrap" in p) {
    keys(p.bootstrap, ["replicates"], [], "statistics.bootstrap");
    require_(
      integerIn(get(p.bootstrap, "replicates", 2000), 1000, 10000),
      "statistics.bootstrap.replicates must be an integer from 1000 to 10000",
    );
  }
  require_(
    integerIn(get(p, "calibrationBins", 10), 2, 100),
    "statistics.calibrationBins must be an integer from 2 to 100",
  );
  if ("power" in p) {
    keys(p.power, ["targetPower", "acknowledgement"], [], "statistics.power");
    const target = get(p.power, "targetPower", 0.8);
    require_(
      real(target) && 0.5 <= target && target <= 0.99,
      "statistics.power.targetPower must lie in [0.5, 0.99]",
    );
    const note = get(p.power, "acknowledgement");
    require_(
      note === null || textOf(note, 1, 5000),
      "statistics.power.acknowledgement must be null or text",
    );
  }
  const cluster = get(p, "clusterField");
  require_(
    cluster === null || textOf(cluster, 1, 300),
    "statistics.clusterField must be null or a column name",
  );
  const criteria = p.criteria;
  require_(
    Array.isArray(criteria) && criteria.length >= 1 && criteria.length <= 20,
    "statistics.criteria must hold 1 to 20 criteria",
  );
  criteria.forEach((c: any, index: number) =>
    validateCriterion(c, `statistics.criteria[${index}]`),
  );
  let plan: Plan;
  try {
    plan = normalizePlan(p);
  } catch (error) {
    if (error instanceof StatisticsError) throw error;
    throw new StatisticsError(
      "statistics plan is malformed: " + (error as Error).message,
    );
  }
  for (const c of plan.criteria) {
    const problem = criterionBandProblem(c);
    require_(problem === null, `criterion ${c.id}: ${problem}`);
  }
  return plan;
}

function legacyRatioBand(tau: number): Band {
  return { lower: tau, upper: tau > 0 ? 1.0 / tau : null };
}

/** k for the multiclass chance baseline: the labels that occur in the target column (section 4.8). */
function targetLabelCount(data: any) {
  if (!data || !("matrix" in data))
    throw new StatisticsError(
      "a multiclass derivation reads the number of target labels from the data",
    );
  return (data.matrix as number[][]).filter((row) => sum(row) > 0).length;
}

export function chanceLevel(data: any) {
  return 1.0 / Math.max(2, targetLabelCount(data));
}

/** Section 9.3: a hosted 1.1 profile (task, suite, config) without a stored plan. */
export function deriveHosted(legacy: any, data: any = null) {
  const task = legacy.task,
    suite: string[] = legacy.suite,
    c = legacy.config;
  const criteria: any[] = [];
  for (const test of suite) {
    if (test === "performance" && task === "Binary classification")
      criteria.push({
        id: "performance",
        kind: "performance",
        members: [
          { metric: "accuracy", band: { lower: c.minimumAccuracy } },
          { metric: "recall", band: { lower: get(c, "minimumRecall", 0.7) } },
          { metric: "balanced_accuracy", band: { lower: 0.5 } },
        ],
      });
    else if (test === "performance")
      criteria.push({
        id: "performance",
        kind: "multiclass_performance",
        members: [
          { metric: "accuracy", band: { lower: c.minimumAccuracy } },
          { metric: "balanced_accuracy", band: { lower: chanceLevel(data) } },
          {
            metric: "macro_f1",
            band: { lower: get(c, "minimumMacroF1", 0.7) },
          },
        ],
      });
    else if (test === "regression")
      criteria.push({
        id: "regression",
        kind: "regression_performance",
        members: [
          { metric: "rmse", band: { upper: get(c, "maximumRmse", 1.0) } },
        ],
      });
    else if (test === "demographic_parity")
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric: "selection_rate_difference",
        band: { lower: -c.maximumParityGap, upper: c.maximumParityGap },
      });
    else if (test === "disparate_impact")
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric: "selection_rate_ratio",
        band: legacyRatioBand(c.minimumImpactRatio),
      });
    else if (test === "equalized_odds") {
      const delta = get(c, "maximumOddsGap", c.maximumParityGap);
      criteria.push({
        id: test,
        kind: "group_comparison",
        metric: "equalized_odds",
        band: { lower: -delta, upper: delta },
      });
    }
  }
  const configured = {
    sampleSize: get(c, "minimumSampleSize", 20),
    groupSize: c.minimumGroupSize,
    classCount: get(c, "minimumClassCount", 5),
  };
  return {
    minimums: Object.fromEntries(
      (Object.keys(FLOORS) as (keyof Minimums)[]).map((k) => [
        k,
        Math.max(FLOORS[k], configured[k]),
      ]),
    ),
    configuredMinimums: configured,
    derivedFrom: { source: "hosted_config", contractVersion: "1.1" },
    criteria,
  };
}

/** Section 9.3: an engine 1.0 configuration whose thresholds.values define the criteria. */
export function deriveEngine(legacy: any, data: any = null) {
  const c = legacy.config;
  const task = c.task,
    suites: string[] = c.suite,
    values = c.thresholds.values;
  const bandOf = (name: string) => {
    const rule = values[name];
    return rule.operator === ">="
      ? { lower: rule.value, upper: null }
      : { lower: null, upper: rule.value };
  };
  const baseline = (name: string, chance: number) => {
    const rule = values[name];
    if (rule === undefined) return { lower: chance, upper: null };
    return rule.operator === ">="
      ? { lower: Math.max(chance, rule.value), upper: null }
      : { lower: chance, upper: rule.value };
  };
  const classificationMembers = (
    order: readonly string[],
    chance: number,
    aliases: Record<string, string> = {},
  ) => {
    const alias = (m: string) => aliases[m] ?? m;
    if (!order.some((m) => alias(m) in values)) return [];
    return order
      .filter((m) => m === "balanced_accuracy" || alias(m) in values)
      .map((m) => ({
        metric: m,
        band:
          m === "balanced_accuracy"
            ? baseline(alias(m), chance)
            : bandOf(alias(m)),
      }));
  };
  const membersFor = (order: readonly string[]) =>
    order
      .filter((m) => m in values)
      .map((m) => ({ metric: m, band: bandOf(m) }));
  const criteria: any[] = [];
  if (suites.includes("performance")) {
    if (task === "binary_classification") {
      criteria.push({
        id: "PERF-BINARY",
        kind: "performance",
        members: classificationMembers(BINARY_METRICS, 0.5),
      });
      if (get(c, "columns", {})?.score)
        criteria.push({
          id: "PERF-CAL",
          kind: "calibration",
          band: null,
          members: membersFor(["brier_score"]),
          passBlockedBy: [UNDECIDABLE.calibration],
        });
    } else if (task === "multiclass_classification")
      criteria.push({
        id: "PERF-MULTI",
        kind: "multiclass_performance",
        members: classificationMembers(MULTICLASS_METRICS, chanceLevel(data), {
          balanced_accuracy: "macro_recall",
        }),
      });
    else
      criteria.push({
        id: "PERF-REG",
        kind: "regression_performance",
        members: membersFor(REGRESSION_METRICS),
        passBlockedBy: [UNDECIDABLE.regression_performance],
      });
  }
  if (suites.includes("fairness") && task === "binary_classification")
    for (const [cid, metric, key] of [
      ["FAIR-DP", "selection_rate_difference", "demographic_parity_difference"],
      ["FAIR-DI", "selection_rate_ratio", "disparate_impact_ratio"],
      ["FAIR-EO", "equalized_odds", "equalized_odds_difference"],
    ]) {
      const rule = values[key];
      const band =
        rule === undefined
          ? null
          : metric === "selection_rate_ratio"
            ? legacyRatioBand(rule.value)
            : { lower: -rule.value, upper: rule.value };
      criteria.push({ id: cid, kind: "group_comparison", metric, band });
    }
  const configured = {
    sampleSize: get(c, "minSampleSize", 30),
    groupSize: get(c, "minGroupSize", 30),
    classCount: get(c, "minClassCount", 10),
  };
  return {
    minimums: Object.fromEntries(
      (Object.keys(FLOORS) as (keyof Minimums)[]).map((k) => [
        k,
        Math.max(FLOORS[k], configured[k]),
      ]),
    ),
    configuredMinimums: configured,
    derivedFrom: {
      source: "engine_thresholds",
      contractVersion: c.contractVersion,
    },
    criteria,
  };
}

export function planFor(c: any) {
  if (!("legacy" in c)) return normalizePlan(c.plan);
  const legacy = c.legacy;
  return normalizePlan(
    (legacy.source === "hosted_config" ? deriveHosted : deriveEngine)(
      legacy,
      get(c, "data"),
    ),
  );
}

// ------------------------------------------------------------ members
function escapeLabel(label: string) {
  return label.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

export function memberId(
  metric: string,
  subject: string | null = null,
  comparator: string | null = null,
) {
  return subject === null
    ? metric
    : `${metric}:${escapeLabel(subject)}|${escapeLabel(comparator!)}`;
}

export type CriterionInterval = {
  lower: number;
  upper: number;
  level: number;
  method: string;
};
export type Member = {
  memberId: string;
  metric: string;
  subject: string | null;
  comparator: string | null;
  counts: Record<string, unknown> | null;
  estimate: number | null;
  interval: CriterionInterval | null;
  band: Band | null;
  status: "evaluated" | "undefined" | "insufficient_support" | "suppressed";
  direction: Direction;
  pValue: number | null;
  smallCell: boolean;
  fisherExactP: number | null;
  chanceExactP: number | null;
  reasons: string[];
  _ciAt?: CiAt;
  _pInterval?: number;
};
type MemberOptions = {
  subject?: string | null;
  comparator?: string | null;
  counts?: Record<string, unknown> | null;
  status?: Member["status"];
  reasons?: string[];
  smallCell?: boolean;
  fisher?: number | null;
  chance?: Chance | null;
  level?: number;
  descriptive?: boolean;
  decide?: boolean;
};

function member(
  metric: string,
  band: Band | null,
  estimate: number | null,
  method: string | null,
  ciAt: CiAt | null,
  zstarClosed: ((d: Direction) => number) | null = null,
  {
    subject = null,
    comparator = null,
    counts = null,
    status = "evaluated",
    reasons = [],
    smallCell = false,
    fisher = null,
    chance = null,
    level = 0.95,
    descriptive = false,
    decide = true,
  }: MemberOptions = {},
): Member {
  const out: Member = {
    memberId: memberId(metric, subject, comparator),
    metric,
    subject,
    comparator,
    counts,
    estimate,
    interval: null,
    band: descriptive ? null : band,
    status,
    direction: "none",
    pValue: descriptive ? null : 1.0,
    smallCell,
    fisherExactP: fisher,
    chanceExactP: null,
    reasons: [...reasons],
  };
  if (estimate === null || ciAt === null) return out;
  if (!descriptive && chanceGated(band, chance))
    out.chanceExactP = chanceExactP(chance![1]);
  const [lo, hi] = ciAt(zcrit(level));
  out.interval = { lower: lo, upper: hi, level, method: method! };
  out._ciAt = ciAt;
  // decide=false: a derived band that section 3 rejects.
  if (descriptive || status !== "evaluated" || !decide) return out;
  const direction = directionOf(estimate, band!);
  out.direction = direction;
  if (direction === "none") {
    out.reasons.push("estimate_on_band_boundary");
    return out;
  }
  // Score-test inversions use their closed form (section 4.2); composite methods use bisection.
  const zs =
    zstarClosed !== null
      ? Math.min(Math.max(zstarClosed(direction), 0.0), Z_MAX)
      : invert(ciAt, band!, direction);
  out.pValue = pFromZ(zs);
  out._pInterval = out.pValue;
  if (smallCell && direction === "fail" && fisher !== null)
    out.pValue = Math.max(out.pValue, fisher);
  // The chance gate (section 5.2) gates passes only.
  if (direction === "pass" && out.chanceExactP !== null)
    out.pValue = Math.max(out.pValue, out.chanceExactP);
  return out;
}

/** Estimate, interval method and support status of one single-sample metric. */
type Stat = {
  estimate: number | null;
  method: string | null;
  ciAt: CiAt | null;
  closed: ((band: Band) => (d: Direction) => number) | null;
  counts: Record<string, unknown>;
  status: Member["status"];
  reasons: string[];
  chance: Chance | null;
};
const stat = (
  estimate: number | null,
  method: string | null,
  ciAt: CiAt | null,
  closed: Stat["closed"],
  counts: Record<string, unknown>,
  [status, reasons]: [Member["status"], string[]] = ["evaluated", []],
  chance: Chance | null = null,
): Stat => ({
  estimate,
  method,
  ciAt,
  closed,
  counts,
  status,
  reasons: [...reasons],
  chance,
});

function support(
  n: number,
  minimum: number,
  reason = "below_minimum_class_count",
): [Member["status"], string[]] {
  return n >= minimum ? ["evaluated", []] : ["insufficient_support", [reason]];
}

function statEntry(
  metric: string,
  band: Band | null,
  s: Stat,
  level: number,
  descriptive = false,
  decide = true,
) {
  const closed =
    descriptive || !decide || s.closed === null ? null : s.closed(band!);
  return member(metric, band, s.estimate, s.method, s.ciAt, closed, {
    counts: s.counts,
    status: s.status,
    reasons: s.reasons,
    chance: s.chance,
    level,
    descriptive,
    decide,
  });
}

function wilsonStat(
  x: number,
  n: number,
  minimum: number,
  zeroReason: string,
  shortReason = "below_minimum_class_count",
): Stat {
  const counts = { x, n };
  if (n === 0)
    return stat(null, "wilson", null, null, counts, [
      "undefined",
      [zeroReason],
    ]);
  return stat(
    x / n,
    "wilson",
    (z) => wilson(x, n, z),
    (band) => (d) => wilsonZstar(x, n, band, d),
    counts,
    support(n, minimum, shortReason),
  );
}

export type Confusion = { tp: number; fp: number; fn: number; tn: number };

function binaryStat(metric: string, cm: Confusion, mins: Minimums): Stat {
  const { tp, fp, fn, tn } = cm;
  const pos = tp + fn,
    neg = fp + tn,
    total = tp + fp + fn + tn;
  const cls = mins.classCount;
  if (metric === "accuracy")
    return wilsonStat(
      tp + tn,
      total,
      mins.sampleSize,
      "undefined_zero_denominator",
      "below_minimum_sample_size",
    );
  if (metric === "precision")
    return wilsonStat(tp, tp + fp, cls, "undefined_zero_denominator");
  if (metric === "recall") return wilsonStat(tp, pos, cls, "single_class");
  if (metric === "specificity") return wilsonStat(tn, neg, cls, "single_class");
  if (metric === "false_positive_rate")
    return wilsonStat(fp, neg, cls, "single_class");
  if (metric === "balanced_accuracy") {
    const counts = { tp, positives: pos, tn, negatives: neg };
    if (pos === 0 || neg === 0)
      return stat(null, "mover_wilson", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    return stat(
      (tp / pos + tn / neg) / 2.0,
      "mover_wilson",
      (z) =>
        moverMean(
          [
            [tp, pos],
            [tn, neg],
          ],
          z,
        ),
      null,
      counts,
      support(Math.min(pos, neg), cls),
      [0.5, [[tp, pos, tp + fp, total]]],
    );
  }
  if (metric === "f1") {
    const m = tp + fp + fn;
    const counts = { tp, tpPlusFpPlusFn: m, positives: pos };
    if (pos === 0)
      return stat(null, "jaccard_wilson", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    return stat(
      (2.0 * tp) / (2 * tp + fp + fn),
      "jaccard_wilson",
      (z) => jaccardF1(tp, m, z),
      (band) => (d) => wilsonZstar(tp, m, jaccardBand(band), d),
      counts,
      support(pos, cls),
    );
  }
  throw new StatisticsError("unknown binary metric " + metric);
}

export type MulticlassData = { labels: string[]; matrix: number[][] };

function multiclassStat(
  metric: string,
  data: MulticlassData,
  mins: Minimums,
): Stat {
  const { labels, matrix } = data;
  const k = labels.length,
    total = sum(matrix.map(sum));
  const supports = labels.map((_, i) => sum(matrix[i]));
  const predicted = labels.map((_, i) => sum(matrix.map((row) => row[i])));
  const tps = labels.map((_, i) => matrix[i][i]);
  const cls = mins.classCount;
  if (metric === "accuracy")
    return wilsonStat(
      sum(tps),
      total,
      mins.sampleSize,
      "undefined_zero_denominator",
      "below_minimum_sample_size",
    );
  if (metric === "balanced_accuracy") {
    const parts = tps.map((x, i) => [x, supports[i]] as [number, number]);
    const counts = {
      perClass: labels.map((label, i) => ({
        label,
        tp: tps[i],
        support: supports[i],
        predicted: predicted[i],
      })),
    };
    if (k < 2 || Math.min(...supports) === 0)
      return stat(null, "mover_wilson", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    const tables = labels.map(
      (_, i) => [tps[i], supports[i], predicted[i], total] as Table,
    );
    return stat(
      sum(parts.map(([x, n]) => x / n)) / k,
      "mover_wilson",
      (z) => moverMean(parts, z),
      null,
      counts,
      support(Math.min(...supports), cls),
      [1.0 / k, tables],
    );
  }
  if (metric === "macro_f1") {
    const classes = labels.map(
      (_, i) =>
        [tps[i], supports[i] + predicted[i] - tps[i]] as [number, number],
    );
    const counts = {
      perClass: labels.map((label, i) => ({
        label,
        tp: classes[i][0],
        tpPlusFpPlusFn: classes[i][1],
      })),
    };
    if (k < 2 || Math.min(...supports) === 0)
      return stat(null, "jaccard_wilson_bonferroni", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    const estimate =
      sum(labels.map((_, i) => (2 * tps[i]) / (supports[i] + predicted[i]))) /
      k;
    return stat(
      estimate,
      "jaccard_wilson_bonferroni",
      (z) => macroF1Interval(classes, z),
      null,
      counts,
      support(Math.min(...supports), cls),
    );
  }
  if (metric === "macro_precision") {
    const parts = tps.map((x, i) => [x, predicted[i]] as [number, number]);
    const counts = {
      perClass: labels.map((label, i) => ({
        label,
        tp: tps[i],
        predicted: predicted[i],
      })),
    };
    if (k < 2)
      return stat(null, "wilson_bonferroni_mean", null, null, counts, [
        "undefined",
        ["single_class"],
      ]);
    if (Math.min(...predicted) === 0)
      return stat(null, "wilson_bonferroni_mean", null, null, counts, [
        "undefined",
        ["undefined_zero_denominator"],
      ]);
    return stat(
      sum(parts.map(([x, n]) => x / n)) / k,
      "wilson_bonferroni_mean",
      (z) => meanBonferroniWilson(parts, z),
      null,
      counts,
      support(Math.min(...predicted), cls),
    );
  }
  throw new StatisticsError("unknown multiclass metric " + metric);
}

export type RegressionData = { errors: number[]; targets?: number[] };

function regressionStat(
  metric: string,
  data: RegressionData,
  mins: Minimums,
): Stat {
  const errors = data.errors;
  const n = errors.length;
  const status = support(n, mins.sampleSize, "below_minimum_sample_size");
  if (n < 2) {
    // No rows, or one row without a sample standard deviation.
    const estimate = n === 0 || metric === "r2" ? null : Math.abs(errors[0]);
    return stat(
      estimate,
      metric === "r2" ? null : "normal_approximation",
      null,
      null,
      { n },
      [
        "undefined",
        [
          n === 0 || metric === "r2"
            ? "undefined_zero_denominator"
            : "degenerate_interval",
        ],
      ],
    );
  }
  if (metric === "r2") {
    const targets = data.targets ?? new Array<number>(n).fill(0.0);
    const meanT = fsum(targets) / n;
    const sst = fsum(targets.map((t) => (t - meanT) ** 2));
    if (sst === 0.0)
      return stat(null, null, null, null, { n }, [
        "undefined",
        ["undefined_zero_denominator"],
      ]);
    return stat(
      1.0 - fsum(errors.map((e) => e * e)) / sst,
      null,
      null,
      null,
      { n },
      status,
    );
  }
  const values =
    metric === "mae"
      ? errors.map((e) => Math.abs(e))
      : errors.map((e) => e * e);
  const [mean, sd] = meanSd(values);
  const se = sd / Math.sqrt(n);
  if (metric === "mae") {
    const counts = { n, meanAbsoluteError: mean, sdAbsoluteError: sd };
    if (se === 0.0)
      return stat(mean, "normal_approximation", null, null, counts, [
        "undefined",
        ["degenerate_interval"],
      ]);
    return stat(
      mean,
      "normal_approximation",
      (z) => [Math.max(0.0, mean - z * se), mean + z * se],
      (band) => (d) => normalZstar(mean, se, band, d),
      counts,
      status,
    );
  }
  const counts = { n, meanSquaredError: mean, sdSquaredError: sd };
  if (se === 0.0)
    return stat(
      Math.sqrt(mean),
      "normal_approximation_mse",
      null,
      null,
      counts,
      ["undefined", ["degenerate_interval"]],
    );
  return stat(
    Math.sqrt(mean),
    "normal_approximation_mse",
    (z) => [Math.sqrt(Math.max(0.0, mean - z * se)), Math.sqrt(mean + z * se)],
    (band) => (d) => normalZstar(mean, se, squareBand(band), d),
    counts,
    status,
  );
}

/**
 * Section 5.9: the mean-prediction baseline (the descriptive `baseline_rmse`)
 * and its gate p. The baseline predicts the mean of the evaluated targets on
 * every row; no constant prediction has a lower RMSE. The gate tests that the
 * model's MSE lies below the baseline's: d_i = e_i² − (mean − y_i)², one-sided
 * normal approximation on the decision scale. A reduction of at most
 * BASELINE_TOLERANCE of the baseline MSE is rounding, so the gate does not
 * reject.
 */
function meanBaseline(data: RegressionData, mins: Minimums): [Stat, number] {
  const errors = data.errors;
  const n = errors.length;
  const targets = data.targets;
  const undefinedStat = (): [Stat, number] => [
    stat(null, null, null, null, { n }, [
      "undefined",
      ["undefined_zero_denominator"],
    ]),
    1.0,
  ];
  if (n < 2 || targets === undefined) return undefinedStat();
  const meanT = fsum(targets) / n;
  const residuals = targets.map((t) => meanT - t);
  const sst = fsum(residuals.map((r) => r * r));
  if (sst === 0.0) return undefinedStat();
  const baselineMse = sst / n;
  const [meanD, sdD] = meanSd(
    errors.map((e, i) => e * e - residuals[i] * residuals[i]),
  );
  const se = sdD / Math.sqrt(n);
  const reduction = 0.0 - meanD; // never -0
  const p =
    reduction <= BASELINE_TOLERANCE * baselineMse
      ? 1.0
      : pFromZ(se === 0.0 ? Z_MAX : reduction / se);
  return [
    stat(
      Math.sqrt(baselineMse),
      null,
      null,
      null,
      {
        n,
        meanSquaredError: baselineMse,
        meanSquaredErrorReduction: reduction,
        sdSquaredErrorDifference: sdD,
        gatePValue: p,
      },
      support(n, mins.sampleSize, "below_minimum_sample_size"),
    ),
    p,
  ];
}

export type GroupData =
  | ({ group: string } & Confusion)
  | { group: string; selected: number; n: number };

function rateCounts(
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

const groupRows = (g: GroupData) =>
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
type Context = {
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

function groupMembers(
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

// ------------------------------------------------------------ criteria and plans
export type Headline = {
  names: { engine: string; hosted: string | null };
  estimate: number;
  interval: CriterionInterval;
  band: Band;
};

function headline(
  members: Member[],
  context: Context,
  level: number,
): Headline | null {
  const alpha = 1.0 - level;
  const pool = members.filter((m) => m.status !== "suppressed");
  const evaluable = pool.filter((m) => m.status === "evaluated");
  if (!evaluable.length || context.headlineMetric === undefined) return null;
  const band = evaluable[0].band!;
  const log = context.scale === "log";
  const tr = log
    ? (v: number) => (v > 0 ? Math.log(v) : -Infinity)
    : (v: number) => v;
  const lower = band.lower,
    upper = band.upper;
  const zNom = zcrit(level),
    zBon = zcrit(1.0 - alpha / evaluable.length);
  const complete = pool.every((m) => m.status === "evaluated");
  const names = HEADLINE_NAMES[context.headlineMetric];
  const dev = (m: Member, z: number): Interval => {
    const [lo, hi] = m._ciAt!(z);
    return [tr(lo), tr(hi)];
  };
  const out = (
    value: number,
    lo: number,
    hi: number,
    headlineBand: Band,
  ): Headline => ({
    names,
    estimate: value,
    interval: { lower: lo, upper: hi, level, method: "worst_member_bounds" },
    band: headlineBand,
  });
  // A pass-side bound that cannot be computed (some pool member is not
  // evaluated) is reported as the statistic's natural limit: 1 for a gap,
  // 0 for a ratio.
  if (lower !== null && upper !== null) {
    const absBounds = ([lo, hi]: Interval): Interval => [
      Math.max(0.0, lo, -hi),
      Math.max(Math.abs(lo), Math.abs(hi)),
    ];
    const value = Math.max(...evaluable.map((m) => Math.abs(tr(m.estimate!))));
    const failSide = Math.max(
      ...evaluable.map((m) => absBounds(dev(m, zBon))[0]),
    );
    const passSide = complete
      ? Math.max(...evaluable.map((m) => absBounds(dev(m, zNom))[1]))
      : Infinity;
    if (log)
      return out(Math.exp(-value), Math.exp(-passSide), Math.exp(-failSide), {
        lower,
        upper: null,
      });
    return out(value, failSide, Math.min(passSide, 1.0), {
      lower: null,
      upper,
    });
  }
  if (log) {
    // One-sided ratio band {lower: tau} (reference mode): the smallest ratio.
    const value = Math.min(...evaluable.map((m) => tr(m.estimate!)));
    const passSide = complete
      ? Math.min(...evaluable.map((m) => dev(m, zNom)[0]))
      : -Infinity;
    const failSide = Math.min(...evaluable.map((m) => dev(m, zBon)[1]));
    return out(Math.exp(value), Math.exp(passSide), Math.exp(failSide), {
      lower,
      upper: null,
    });
  }
  // One-sided difference band (reference mode): the largest gap in the
  // constrained direction, so the headline band is always {upper: delta}.
  const sign = lower !== null ? -1.0 : 1.0;
  const gap = (m: Member, z: number): Interval => {
    const [lo, hi] = m._ciAt!(z);
    return sign > 0 ? [lo, hi] : [-hi, -lo];
  };
  const value = Math.max(...evaluable.map((m) => sign * m.estimate!));
  const failSide = Math.max(...evaluable.map((m) => gap(m, zBon)[0]));
  const passSide = complete
    ? Math.max(...evaluable.map((m) => gap(m, zNom)[1]))
    : 1.0;
  return out(value, failSide, Math.min(passSide, 1.0), {
    lower: null,
    upper: sign > 0 ? upper : -lower!,
  });
}

export type LibraryView = {
  id: string;
  version: number;
  legalStatus: string;
  caveat: string;
};
function libraryView(entry: PlanCriterion["libraryEntry"]): LibraryView | null {
  if (entry === null) return null;
  const spec = LIBRARY[entry.id];
  return {
    id: entry.id,
    version: entry.version,
    legalStatus: spec.legalStatus,
    caveat: spec.caveat,
  };
}

export type Decision = {
  statisticsVersion: string;
  confidenceLevel: number;
  role: "confirmatory" | "exploratory";
  kind: string;
  direction: Direction;
  pValue: number;
  adjustedPValue: number | null;
  adjustment: "bonferroni" | "benjamini_hochberg" | null;
  familySize: number | null;
  unadjustedOutcome: "pass" | "fail" | "inconclusive";
  decidingMemberId: string | null;
  sampleSize: number;
  coverage: Coverage | null;
  /** n is null in a run on a client-held dataset, which withholds groups below the minimum (#102). */
  suppressedGroups: { group: string; n: number | null }[] | null;
  libraryEntry: LibraryView | null;
  reasons: string[];
};
export type CriterionResult = {
  id: string;
  outcome: "pass" | "fail" | "inconclusive" | null;
  headline: Headline | null;
  members: Member[];
  descriptive: Member[];
  groups: GroupView[] | null;
  decision: Decision;
};

const tupleMin = <T>(items: T[], key: (item: T) => [number, string]) =>
  items.reduce((best, item) => {
    const [a, b] = key(item),
      [c, d] = key(best);
    return a < c || (a === c && codePointCompare(b, d) < 0) ? item : best;
  });

export function evaluateCriterion(
  spec: PlanCriterion,
  data: CriterionData,
  level: number,
  mins: Minimums,
  derived = false,
): CriterionResult {
  const alpha = 1.0 - level;
  const kind = spec.kind;
  // Section 3: a derived legacy plan keeps a band the table rejects; that
  // criterion is inconclusive (invalid_band).
  const invalidBand = derived && criterionBandProblem(spec) !== null;
  if (invalidBand) spec = { ...spec, _decide: false };
  const decide = !invalidBand;
  let descriptive: Member[] = [],
    groups: GroupView[] | null = null,
    members: Member[],
    context: Context;
  if (kind === "performance") {
    const cm = Object.fromEntries(
      (["tp", "fp", "fn", "tn"] as const).map((k) => [
        k,
        sum(data.groups!.map((g) => (g as Confusion)[k])) +
          (data.unknownGroup?.[k] ?? 0),
      ]),
    ) as Confusion;
    const planned = spec.members!.map((item) => item.metric);
    members = spec.members!.map((item) =>
      statEntry(
        item.metric,
        item.band,
        binaryStat(item.metric, cm, mins),
        level,
        false,
        decide,
      ),
    );
    descriptive = BINARY_DESCRIPTIVE.filter((m) => !planned.includes(m)).map(
      (m) => statEntry(m, null, binaryStat(m, cm, mins), level, true),
    );
    context = {
      sampleSize: cm.tp + cm.fp + cm.fn + cm.tn,
      passBlocked: false,
      reasons: [],
    };
  } else if (kind === "multiclass_performance") {
    const d = data as MulticlassData;
    const planned = spec.members!.map((item) => item.metric);
    members = spec.members!.map((item) =>
      statEntry(
        item.metric,
        item.band,
        multiclassStat(item.metric, d, mins),
        level,
        false,
        decide,
      ),
    );
    descriptive = MULTICLASS_METRICS.filter((m) => !planned.includes(m)).map(
      (m) => statEntry(m, null, multiclassStat(m, d, mins), level, true),
    );
    context = {
      sampleSize: sum(d.matrix.map(sum)),
      passBlocked: false,
      reasons: [],
    };
  } else if (kind === "regression_performance") {
    const d = data as RegressionData;
    const planned = spec.members!.map((item) => item.metric);
    members = spec.members!.map((item) =>
      statEntry(
        item.metric,
        item.band,
        regressionStat(item.metric, d, mins),
        level,
        false,
        decide,
      ),
    );
    descriptive = REGRESSION_DESCRIPTIVE.filter(
      (m) => !planned.includes(m),
    ).map((m) => statEntry(m, null, regressionStat(m, d, mins), level, true));
    const [baseline, baselineP] = meanBaseline(d, mins);
    descriptive.push(statEntry("baseline_rmse", null, baseline, level, true));
    context = {
      sampleSize: d.errors.length,
      passBlocked: false,
      reasons: [],
      baselineP,
    };
  } else if (kind === "group_comparison") {
    [members, context] = groupMembers(spec, data, mins, level);
    groups = context.groups!;
  } else
    // Calibration needs score columns, which hosted profiles do not map
    // (section 12): the engine computes it.
    throw new StatisticsError(
      "calibration criteria need score columns; the engine evaluates them",
    );
  const reasons = [...context.reasons];
  if (
    (PERFORMANCE_KINDS.includes(kind) && !spec.members!.length) ||
    (kind === "group_comparison" && spec.band === null)
  )
    reasons.push("no_threshold");
  if (spec.passBlockedBy?.length) {
    // Section 4.8: a metric today's rule needs and 1.0.0 cannot decide blocks a pass.
    context.passBlocked = true;
    reasons.push("undecidable_metric");
    for (const entry of descriptive)
      if (spec.passBlockedBy.includes(entry.metric))
        entry.reasons.push("undecidable_metric");
  }
  let gated = context.sampleSize < mins.sampleSize;
  if (gated) reasons.unshift("below_minimum_sample_size");
  if (invalidBand) {
    reasons.push("invalid_band");
    gated = true;
  }
  const pool = members.filter((m) => m.status !== "suppressed");
  const evaluable = pool.filter((m) => m.status === "evaluated");
  const fails = evaluable.filter((m) => m.direction === "fail");
  let deciding: Member | null = null,
    direction: Direction,
    p: number;
  if (gated || !evaluable.length) {
    direction = "none";
    p = 1.0;
  } else if (fails.length) {
    direction = "fail";
    deciding = tupleMin(fails, (m) => [m.pValue!, m.memberId]);
    p = Math.min(1.0, evaluable.length * deciding.pValue!);
    const ungated = Math.min(
      1.0,
      evaluable.length *
        Math.min(...fails.map((m) => m._pInterval ?? m.pValue!)),
    );
    if (p > alpha + EPS && ungated <= alpha + EPS)
      reasons.push("small_cell_exact_test_not_significant");
    else if (p > alpha + EPS && deciding.pValue! <= alpha + EPS)
      reasons.push("within_criterion_multiplicity");
    else if (p > alpha + EPS) reasons.push("interval_straddles_band");
  } else {
    const complete =
      pool.length > 0 &&
      pool.every((m) => m.status === "evaluated" && m.direction === "pass");
    direction = evaluable.some((m) => m.direction === "pass") ? "pass" : "none";
    if (complete && !context.passBlocked) {
      deciding = tupleMin(pool, (m) => [-m.pValue!, m.memberId]);
      p = deciding.pValue!;
      if (p > alpha + EPS) {
        // Without the chance gate of section 5.2.
        const ungated = Math.max(...pool.map((m) => m._pInterval!));
        reasons.push(
          ungated <= alpha + EPS
            ? "chance_exact_test_not_significant"
            : "interval_straddles_band",
        );
      }
      // The mean baseline gate (section 5.9) gates passes only.
      p = Math.max(p, context.baselineP ?? 0.0);
    } else p = 1.0;
    if ((context.baselineP ?? 0.0) > alpha + EPS)
      reasons.push("mean_baseline_not_beaten");
  }
  for (const m of pool)
    for (const r of m.reasons) if (!reasons.includes(r)) reasons.push(r);
  const decision: Decision = {
    statisticsVersion: SPEC_VERSION,
    confidenceLevel: level,
    role: spec.role,
    kind,
    direction,
    pValue: p,
    adjustedPValue: null,
    adjustment: null,
    familySize: null,
    unadjustedOutcome:
      (direction === "pass" || direction === "fail") && p <= alpha + EPS
        ? direction
        : "inconclusive",
    decidingMemberId: deciding ? deciding.memberId : null,
    sampleSize: context.sampleSize,
    coverage: context.coverage ?? null,
    suppressedGroups: context.suppressedGroups ?? null,
    libraryEntry: libraryView(spec.libraryEntry),
    reasons,
  };
  return {
    id: spec.id,
    outcome: null,
    headline:
      kind === "group_comparison" ? headline(members, context, level) : null,
    members,
    descriptive,
    groups,
    decision,
  };
}

export function aggregate(outcomes: readonly (string | null)[]) {
  for (const state of ["fail", "inconclusive", "pass"] as const)
    if (outcomes.includes(state)) return state;
  return "not_applicable" as const;
}

export type PlanEvaluation = {
  planSha256: string;
  normalizedPlan: Plan;
  criteria: CriterionResult[];
  overallOutcome: "pass" | "fail" | "inconclusive" | "not_applicable";
  reviewFlags: string[];
};

/** Evaluates a normalised plan on one data object (the golden cases' shape). */
export function evaluatePlan(plan: Plan, data: CriterionData) {
  return evaluateCriteria(plan, () => data);
}

/**
 * Evaluates every criterion of a normalised plan on the data `dataFor`
 * returns, then applies the family adjustments (section 4.5) and the run
 * aggregation over confirmatory criteria (section 4.6).
 */
export function evaluateCriteria(
  plan: Plan,
  dataFor: (criterion: PlanCriterion) => CriterionData,
): PlanEvaluation {
  const level = plan.confidenceLevel;
  const alpha = 1.0 - level;
  const derived = plan.derivedFrom !== null;
  const results = plan.criteria.map((c) =>
    evaluateCriterion(c, dataFor(c), level, plan.minimums, derived),
  );
  for (const [role, method, adjust] of [
    ["confirmatory", "bonferroni", bonferroni],
    ["exploratory", "benjamini_hochberg", benjaminiHochberg],
  ] as const) {
    const family = results.filter((r) => r.decision.role === role);
    const adjusted = adjust(family.map((r) => r.decision.pValue));
    family.forEach((r, i) => {
      const d = r.decision;
      d.adjustedPValue = adjusted[i];
      d.adjustment = method;
      d.familySize = family.length;
      r.outcome =
        (d.direction === "pass" || d.direction === "fail") &&
        adjusted[i] <= alpha + EPS
          ? d.direction
          : "inconclusive";
      if (
        d.unadjustedOutcome !== "inconclusive" &&
        r.outcome === "inconclusive"
      )
        d.reasons.push("multiplicity_adjustment");
    });
  }
  const confirmatory = results
    .filter((r) => r.decision.role === "confirmatory")
    .map((r) => r.outcome);
  return {
    planSha256: planSha256(plan),
    normalizedPlan: plan,
    criteria: results,
    overallOutcome: aggregate(confirmatory),
    reviewFlags: results
      .filter((r) => r.decision.role === "exploratory" && r.outcome === "fail")
      .map((r) => r.id),
  };
}

// ------------------------------------------------------------ power (normal approximations at assumed true values)
function twoSides(terms: number[]) {
  return terms.length === 1
    ? terms[0]
    : Math.max(0.0, terms[0] + terms[1] - 1.0);
}

type Probs = (z: number) => [number, number];

/** Pass and fail probability of the Wilson (score-test) rule for a true proportion p with denominator n. */
function proportionProbs(
  p: number,
  n: number,
  band: Partial<Band>,
  z: number,
): [number, number] {
  const s = Math.sqrt((p * (1.0 - p)) / n);
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const passing: number[] = [];
  let failing = 0.0;
  if (lower !== null) {
    const edge = lower + z * Math.sqrt((lower * (1.0 - lower)) / n);
    passing.push(phi((p - edge) / s));
    failing += phi(
      (lower - z * Math.sqrt((lower * (1.0 - lower)) / n) - p) / s,
    );
  }
  if (upper !== null) {
    const edge = upper - z * Math.sqrt((upper * (1.0 - upper)) / n);
    passing.push(phi((edge - p) / s));
    failing += phi(
      (p - upper - z * Math.sqrt((upper * (1.0 - upper)) / n)) / s,
    );
  }
  return [twoSides(passing), failing];
}

/** Pass and fail probability of an interval theta-hat +/- z*se (normal approximation) against a band. */
function normalProbs(
  theta: number,
  se: number,
  band: Partial<Band>,
  z: number,
): [number, number] {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const passing: number[] = [];
  let failing = 0.0;
  if (lower !== null) {
    passing.push(phi((theta - lower) / se - z));
    failing += phi((lower - theta) / se - z);
  }
  if (upper !== null) {
    passing.push(phi((upper - theta) / se - z));
    failing += phi((theta - upper) / se - z);
  }
  return [twoSides(passing), failing];
}

/**
 * Section 8 (#152): the expected confusion matrix, as shares of n, when class
 * c is recognised with its assumed recall and its errors are spread evenly
 * over the other k - 1 classes (row c is the truth, column j the prediction).
 */
function evenSpreadCells(shares: number[], recalls: number[]) {
  const k = shares.length;
  return shares.map((s, c) =>
    shares.map((_, j) =>
      j === c ? s * recalls[c] : (s * (1.0 - recalls[c])) / (k - 1),
    ),
  );
}

/**
 * Per class: [TP share, denominator share]. Macro precision: TP of the
 * predicted count; macro F1: the Jaccard index TP of TP + FP + FN (section 5.4).
 */
function macroParts(metric: string, cells: number[][]): [number, number][] {
  const rows = cells.map((row) => fsum(row));
  const cols = cells.map((_, c) => fsum(cells.map((row) => row[c])));
  return cells.map((row, c) => [
    row[c],
    metric === "macro_precision" ? cols[c] : rows[c] + cols[c] - row[c],
  ]);
}

/** d(Wilson bound)/d(x-hat) at the proportion x with denominator n; side -1 is the lower bound, +1 the upper. */
function wilsonSlope(x: number, n: number, z: number, side: number) {
  const root = Math.sqrt((x * (1.0 - x)) / n + (z * z) / (4.0 * n * n));
  return (
    (1.0 + (side * z * (1.0 - 2.0 * x)) / (2.0 * n * root)) /
    (1.0 + (z * z) / n)
  );
}

/**
 * Section 8 (#152): a macro bound (side -1 lower, +1 upper) of section 5.4 at
 * critical value z, as it would be computed at the expected counts, and its
 * standard deviation by the delta method over the multinomial confusion
 * matrix: the gradient of the mean of the per-class bounds in the cell
 * shares, through each class's Wilson slope.
 */
function macroBound(
  metric: string,
  n: number,
  cells: number[][],
  z: number,
  side: number,
): [number, number] {
  const k = cells.length;
  const zk = perClassZ(z, k);
  const values: number[] = [];
  const gradient = cells.map((row) => row.map(() => 0.0));
  macroParts(metric, cells).forEach(([tp, share], c) => {
    const x = tp / share;
    const [lo, hi] = wilson(n * tp, n * share, zk);
    const b = side < 0 ? lo : hi;
    let slope = wilsonSlope(x, n * share, zk, side);
    if (metric === "macro_f1") {
      // the Jaccard bound maps to F1 through 2J/(1 + J)
      values.push(f1FromJ(b));
      slope *= 2.0 / (1.0 + b) ** 2;
    } else values.push(b);
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        const counted =
          metric === "macro_precision" ? j === c : i === c || j === c;
        gradient[i][j] +=
          (slope * ((i === c && j === c ? 1.0 : 0.0) - (counted ? x : 0.0))) /
          share /
          k;
      }
  });
  const terms = (power: number) =>
    fsum(
      gradient.flatMap((row, i) =>
        row.map((g, j) => (power === 1 ? g : g ** 2) * cells[i][j]),
      ),
    );
  const first = terms(1),
    second = terms(2);
  return [
    fsum(values) / k,
    Math.sqrt(Math.max(0.0, second - first * first) / n),
  ];
}

/** Phi(distance / sd); a bound without variance decides by its sign. */
function normalTail(distance: number, sd: number) {
  if (sd > 0.0) return phi(distance / sd);
  return distance > 0.0 ? 1.0 : distance < 0.0 ? 0.0 : 0.5;
}

/**
 * Pass and fail probability of a macro F1 or macro precision member: the
 * macro bounds at z are taken as normal around their values at the expected
 * counts (section 8).
 */
function macroProbs(
  metric: string,
  n: number,
  cells: number[][],
  band: Partial<Band>,
  z: number,
): [number, number] {
  const lower = bound(band, "lower"),
    upper = bound(band, "upper");
  const [lo, sdLo] = macroBound(metric, n, cells, z, -1),
    [hi, sdHi] = macroBound(metric, n, cells, z, 1);
  const passing: number[] = [];
  let failing = 0.0;
  if (lower !== null) {
    passing.push(normalTail(lo - lower, sdLo));
    failing += normalTail(lower - hi, sdHi);
  }
  if (upper !== null) {
    passing.push(normalTail(upper - hi, sdHi));
    failing += normalTail(lo - upper, sdLo);
  }
  return [twoSides(passing), failing];
}

const assumed = (value: any, group: string) =>
  value !== null && typeof value === "object" ? value[group] : value;

type PowerModel = {
  memberId: string;
  metric: string;
  subject: string | null;
  comparator: string | null;
  assumedValue: number | null;
  denominator: unknown;
  probs: Probs | null;
  supported: boolean;
  computed: boolean;
};
const powerModel = (
  id: string,
  metric: string,
  value: number | null,
  denominator: unknown,
  probs: Probs | null,
  supported: boolean,
  computed = true,
  subject: string | null = null,
  comparator: string | null = null,
): PowerModel => ({
  memberId: id,
  metric,
  subject,
  comparator,
  assumedValue: value,
  denominator,
  probs,
  supported,
  computed,
});

function performanceModels(
  crit: PlanCriterion,
  a: any,
  n: number,
  mins: Minimums,
) {
  const cls = mins.classCount,
    models: PowerModel[] = [];
  if (crit.kind === "performance") {
    const pi = a.prevalence,
      tpr = a.truePositiveRate,
      tnr = a.trueNegativeRate;
    const positives = n * pi,
      negatives = n * (1.0 - pi);
    const predicted = n * (pi * tpr + (1.0 - pi) * (1.0 - tnr));
    const union = n * (pi + (1.0 - pi) * (1.0 - tnr)); // expected TP + FP + FN
    for (const { metric, band } of crit.members!) {
      if (metric === "balanced_accuracy") {
        const theta = (tpr + tnr) / 2.0,
          se =
            0.5 *
            Math.sqrt(
              (tpr * (1.0 - tpr)) / positives + (tnr * (1.0 - tnr)) / negatives,
            );
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            { positives, negatives },
            (z) => normalProbs(theta, se, band, z),
            Math.min(positives, negatives) >= cls,
          ),
        );
      } else if (metric === "f1") {
        const j = (n * pi * tpr) / union;
        const jb = jaccardBand(band);
        models.push(
          powerModel(
            metric,
            metric,
            f1FromJ(j),
            union,
            (z) => proportionProbs(j, union, jb, z),
            positives >= cls,
          ),
        );
      } else {
        const [p, d, minimum] = (
          {
            accuracy: [pi * tpr + (1.0 - pi) * tnr, n, mins.sampleSize],
            precision: [(n * pi * tpr) / predicted, predicted, cls],
            recall: [tpr, positives, cls],
            specificity: [tnr, negatives, cls],
            false_positive_rate: [1.0 - tnr, negatives, cls],
          } as Record<string, [number, number, number]>
        )[metric];
        models.push(
          powerModel(
            metric,
            metric,
            p,
            d,
            (z) => proportionProbs(p, d, band, z),
            d >= minimum,
          ),
        );
      }
    }
  } else if (crit.kind === "multiclass_performance") {
    const labels = byCodePoint(Object.keys(a.classShares));
    const shares: number[] = labels.map((l) => a.classShares[l]),
      recalls: number[] = labels.map((l) => a.perClassRecall[l]);
    const k = labels.length;
    for (const { metric, band } of crit.members!) {
      if (metric === "accuracy") {
        const p = fsum(shares.map((s, i) => s * recalls[i]));
        models.push(
          powerModel(
            metric,
            metric,
            p,
            n,
            (z) => proportionProbs(p, n, band, z),
            n >= mins.sampleSize,
          ),
        );
      } else if (metric === "balanced_accuracy") {
        const theta = fsum(recalls) / k;
        const se =
          Math.sqrt(
            fsum(
              shares.map((s, i) => (recalls[i] * (1.0 - recalls[i])) / (n * s)),
            ),
          ) / k;
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            {
              perClass: Object.fromEntries(
                labels.map((l, i) => [l, n * shares[i]]),
              ),
            },
            (z) => normalProbs(theta, se, band, z),
            Math.min(...shares.map((s) => n * s)) >= cls,
          ),
        );
      } else if (metric === "macro_f1" || metric === "macro_precision") {
        // Section 8 (#152): the errors of each class spread evenly over the other classes.
        const cells = evenSpreadCells(shares, recalls);
        const parts = macroParts(metric, cells);
        const theta =
          fsum(
            parts.map(([tp, share]) =>
              metric === "macro_f1"
                ? (2.0 * tp) / (tp + share)
                : share > 0.0
                  ? tp / share
                  : 0.0,
            ),
          ) / k;
        // Recalls lie strictly inside (0, 1), so each predicted column holds
        // at least s_c * r_c > 0; the share guard is defensive only. Support
        // counts the predicted column of each class.
        const supported =
          metric === "macro_f1"
            ? Math.min(...shares.map((s) => n * s)) >= cls
            : Math.min(...parts.map(([, share]) => n * share)) >= cls;
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            {
              perClass: Object.fromEntries(
                labels.map((l, i) => [l, n * parts[i][1]]),
              ),
            },
            (z) => macroProbs(metric, n, cells, band, z),
            supported,
          ),
        );
      } else
        models.push(powerModel(metric, metric, null, null, null, false, false));
    }
  } else {
    const sigma = a.errorSd; // errors assumed normal with mean zero
    for (const { metric, band } of crit.members!) {
      if (metric === "mae") {
        const theta = sigma * Math.sqrt(2.0 / Math.PI),
          se = (sigma * Math.sqrt(1.0 - 2.0 / Math.PI)) / Math.sqrt(n);
        models.push(
          powerModel(
            metric,
            metric,
            theta,
            n,
            (z) => normalProbs(theta, se, band, z),
            n >= mins.sampleSize,
          ),
        );
      } else {
        const q = sigma * sigma,
          se = (Math.SQRT2 * sigma * sigma) / Math.sqrt(n);
        const sb = squareBand(band);
        models.push(
          powerModel(
            metric,
            metric,
            sigma,
            n,
            (z) => normalProbs(q, se, sb, z),
            n >= mins.sampleSize,
          ),
        );
      }
    }
  }
  return models;
}

function groupModels(
  crit: PlanCriterion,
  a: any,
  sizes: Record<string, number>,
  mins: Minimums,
): [PowerModel[], string[]] {
  const names = byCodePoint(Object.keys(sizes));
  const metric = crit.metric!,
    band = crit.band!,
    mode = crit.comparison!;
  const metrics =
    metric === "equalized_odds"
      ? ["tpr_difference", "fpr_difference"]
      : [metric];
  const eligible = names.filter((g) => sizes[g] >= mins.groupSize);
  const rate = (key: string, g: string) =>
    key === "selection"
      ? ((a.assumedRates ?? {})[g] ?? a.baselineRate)
      : assumed(key === "tpr" ? a.truePositiveRate : a.falsePositiveRate, g);
  const denominator = (key: string, g: string) => {
    if (key === "selection") return sizes[g];
    const prevalence = assumed(a.prevalence, g);
    return key === "tpr"
      ? sizes[g] * prevalence
      : sizes[g] * (1.0 - prevalence);
  };
  const models: PowerModel[] = [];
  for (const mt of metrics) {
    const key = RATE_KEYS[mt];
    let pairs: [string, string][];
    if (mode.mode === "reference") {
      const ref = mode.referenceGroup!;
      pairs = eligible.includes(ref)
        ? eligible.filter((g) => g !== ref).map((g) => [g, ref])
        : [];
    } else
      pairs = eligible.flatMap((x, i) =>
        eligible
          .slice(i + 1)
          .map((y): [string, string] =>
            rate(key, y) < rate(key, x) ? [y, x] : [x, y],
          ),
      );
    for (const [s, c] of pairs) {
      const rs = rate(key, s),
        rc = rate(key, c),
        ns = denominator(key, s),
        nc = denominator(key, c);
      const supported =
        key === "selection" || Math.min(ns, nc) >= mins.classCount;
      let probs: Probs, value: number;
      if (mt === "selection_rate_ratio") {
        const theta = Math.log(rs / rc),
          se = Math.sqrt((1.0 - rs) / (ns * rs) + (1.0 - rc) / (nc * rc));
        const lb = logBand(band);
        probs = (z) => normalProbs(theta, se, lb, z);
        value = rs / rc;
      } else {
        const theta = rs - rc,
          se = Math.sqrt((rs * (1.0 - rs)) / ns + (rc * (1.0 - rc)) / nc);
        probs = (z) => normalProbs(theta, se, band, z);
        value = theta;
      }
      models.push(
        powerModel(
          memberId(mt, s, c),
          mt,
          value,
          { subject: ns, comparator: nc },
          probs,
          supported,
          true,
          s,
          c,
        ),
      );
    }
  }
  const total = sum(Object.values(sizes));
  const coverage = sum(eligible.map((g) => sizes[g])) / total;
  const reasons: string[] = [];
  if (total < mins.sampleSize) reasons.push("below_minimum_sample_size");
  if (coverage < crit.minimumCoverage! - EPS)
    reasons.push("insufficient_planned_coverage");
  if (
    eligible.length < 2 ||
    (mode.mode === "reference" && !eligible.includes(mode.referenceGroup!))
  )
    reasons.push("insufficient_groups");
  return [models, reasons];
}

export type PowerMember = {
  memberId: string;
  metric: string;
  subject?: string;
  comparator?: string;
  assumedValue: number | null;
  denominator: unknown;
  status: "computed" | "not_computed";
  passProbability: number | null;
  failProbability: number | null;
  reasons: string[];
};
function summarize(
  models: PowerModel[],
  zPass: number,
  zFail: number,
  blockedPass: boolean,
  blockedFail: boolean,
): [PowerMember[], number | null, number | null, number | null] {
  const members: PowerMember[] = models.map((m) => {
    const entry: any = { memberId: m.memberId, metric: m.metric };
    if (m.subject !== null)
      Object.assign(entry, { subject: m.subject, comparator: m.comparator });
    Object.assign(entry, {
      assumedValue: m.assumedValue,
      denominator: m.denominator,
    });
    if (!m.computed)
      Object.assign(entry, {
        status: "not_computed",
        passProbability: null,
        failProbability: null,
        reasons: ["power_not_specified_for_metric"],
      });
    else if (!m.supported)
      Object.assign(entry, {
        status: "computed",
        passProbability: 0.0,
        failProbability: 0.0,
        reasons: ["planned_below_minimum"],
      });
    else
      Object.assign(entry, {
        status: "computed",
        passProbability: m.probs!(zPass)[0],
        failProbability: m.probs!(zFail)[1],
        reasons: [],
      });
    return entry;
  });
  if (!members.length || members.some((e) => e.status !== "computed"))
    return [members, null, null, null];
  const lower = blockedPass
    ? 0.0
    : Math.max(0.0, 1.0 - fsum(members.map((e) => 1.0 - e.passProbability!)));
  const upper = blockedPass
    ? 0.0
    : Math.min(...members.map((e) => e.passProbability!));
  const fail = blockedFail
    ? 0.0
    : Math.max(...members.map((e) => e.failProbability!));
  return [members, lower, upper, fail];
}

function smallestN(
  probabilityAt: (n: number) => number | null,
  target: number,
  start = 2,
  limit = POWER_SEARCH_LIMIT,
) {
  if ((probabilityAt(limit) ?? -1) < target) return null;
  let lo = start,
    hi = limit;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((probabilityAt(mid) ?? -1) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Classic two-sided two-proportion z-test size per group (pooled null variance; Fleiss without continuity correction). */
function equalityTestN(p1: number, p2: number, level: number, power: number) {
  const za = zcrit(level),
    zb = normalQuantile(power);
  const pbar = (p1 + p2) / 2;
  const raw =
    (za * Math.sqrt(2 * pbar * (1 - pbar)) +
      zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
      2 /
    (p1 - p2) ** 2;
  return [raw, Math.ceil(raw - 1e-9)] as const;
}

function differenceMde(
  rc: number,
  ns: number,
  nc: number,
  band: Band,
  z: number,
  target: number,
  direction: number,
) {
  const failing = (gap: number) => {
    const rs = rc + direction * gap;
    return normalProbs(
      direction * gap,
      Math.sqrt((rs * (1.0 - rs)) / ns + (rc * (1.0 - rc)) / nc),
      band,
      z,
    )[1];
  };
  let lo = direction < 0 ? -band.lower! : band.upper!;
  let hi = (direction < 0 ? rc : 1.0 - rc) - 1e-12;
  if (failing(hi) < target) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (failing(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

function ratioMde(
  rc: number,
  ns: number,
  nc: number,
  band: Band,
  z: number,
  target: number,
) {
  const lb = logBand(band);
  const failing = (r: number) => {
    const rs = r * rc;
    return normalProbs(
      Math.log(r),
      Math.sqrt((1.0 - rs) / (ns * rs) + (1.0 - rc) / (nc * rc)),
      lb,
      z,
    )[1];
  };
  let peak = band.lower!,
    best = -Infinity;
  for (let i = 1; i <= 4000; i++) {
    const r = band.lower! * Math.exp((-12.0 * i) / 4000);
    const f = failing(r);
    if (f > best) {
      best = f;
      peak = r;
    }
  }
  let lo = peak,
    hi = band.lower!;
  if (failing(lo) < target) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (failing(mid) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

function failMdes(
  crit: PlanCriterion,
  a: any,
  sizes: Record<string, number>,
  z: number,
  target: number,
): Record<string, number | null> {
  const names = byCodePoint(Object.keys(sizes));
  const mode = crit.comparison!,
    metric = crit.metric!,
    band = crit.band!;
  const smallest = (candidates: string[], sign: number) =>
    tupleMin(candidates, (g) => [sign * sizes[g], g]);
  let subject: string, comparator: string;
  if (mode.mode === "reference") {
    comparator = mode.referenceGroup!;
    subject = smallest(
      names.filter((g) => g !== comparator),
      1,
    );
  } else {
    subject = smallest(names, 1);
    comparator = smallest(
      names.filter((g) => g !== subject),
      -1,
    );
  }
  if (metric === "selection_rate_difference") {
    const rc = (a.assumedRates ?? {})[comparator] ?? a.baselineRate;
    return {
      failMdeDifference: differenceMde(
        rc,
        sizes[subject],
        sizes[comparator],
        band,
        z,
        target,
        band.lower !== null ? -1 : 1,
      ),
    };
  }
  if (metric === "selection_rate_ratio") {
    const rc = (a.assumedRates ?? {})[comparator] ?? a.baselineRate;
    return {
      failMdeRatio: ratioMde(
        rc,
        sizes[subject],
        sizes[comparator],
        band,
        z,
        target,
      ),
    };
  }
  const ps = assumed(a.prevalence, subject),
    pc = assumed(a.prevalence, comparator);
  return {
    failMdeTprDifference: differenceMde(
      assumed(a.truePositiveRate, comparator),
      sizes[subject] * ps,
      sizes[comparator] * pc,
      band,
      z,
      target,
      -1,
    ),
    failMdeFprDifference: differenceMde(
      assumed(a.falsePositiveRate, comparator),
      sizes[subject] * (1.0 - ps),
      sizes[comparator] * (1.0 - pc),
      band,
      z,
      target,
      1,
    ),
  };
}

export type CriterionPower = {
  status: "computed" | "not_computed";
  passProbability: number | null;
  passProbabilityUpperBound: number | null;
  failProbability: number | null;
  requiredGroupSizeForPass?: number | null;
  requiredNForPass?: number | null;
  failMdeDifference?: number | null;
  failMdeRatio?: number | null;
  failMdeTprDifference?: number | null;
  failMdeFprDifference?: number | null;
  members: PowerMember[];
  reasons: string[];
};

const notComputed = (
  reason: string,
  members: PowerMember[] = [],
): CriterionPower => ({
  status: "not_computed",
  passProbability: null,
  passProbabilityUpperBound: null,
  failProbability: null,
  members: [...members],
  reasons: [reason],
});

/** Section 8: power and minimum detectable effects of one criterion at plan approval. */
export function criterionPower(
  crit: PlanCriterion,
  level: number,
  target: number,
  family: number,
  mins: Minimums,
): CriterionPower {
  const a = crit.powerAssumptions;
  if (a === null || a === undefined) return notComputed("missing_assumptions");
  const alpha = 1.0 - level;
  if (crit.kind === "group_comparison") {
    const sizes: Record<string, number> = a.groupSizes;
    const [models, reasons] = groupModels(crit, a, sizes, mins);
    const m = Math.max(1, models.length);
    const zPass = zcrit(1.0 - alpha / family),
      zFail = zcrit(1.0 - alpha / (family * m));
    const at = (sz: Record<string, number>) => {
      const [mods, rs] = groupModels(crit, a, sz, mins);
      return summarize(
        mods,
        zPass,
        zFail,
        rs.length > 0,
        rs.includes("below_minimum_sample_size") ||
          rs.includes("insufficient_groups"),
      );
    };
    const [members, lower, upper, fail] = at(sizes);
    const names = byCodePoint(Object.keys(sizes));
    const out: CriterionPower = {
      status: "computed",
      passProbability: lower,
      passProbabilityUpperBound: upper,
      failProbability: fail,
      requiredGroupSizeForPass: smallestN(
        (k) => at(Object.fromEntries(names.map((g) => [g, k])))[1],
        target,
      ),
      ...failMdes(crit, a, sizes, zFail, target),
      members,
      reasons: [...reasons],
    };
    if (out.requiredGroupSizeForPass === null)
      out.reasons.push("target_unreachable");
    if (
      Object.entries(out).some(
        ([key, value]) => key.startsWith("failMde") && value === null,
      )
    )
      out.reasons.push("fail_mde_unreachable");
    return out;
  }
  if (PERFORMANCE_KINDS.includes(crit.kind)) {
    const m = crit.members!.length;
    const zPass = zcrit(1.0 - alpha / family),
      zFail = zcrit(1.0 - alpha / (family * Math.max(1, m)));
    const undecidable = !!crit.passBlockedBy?.length;
    const at = (n: number) => {
      const blocked = n < mins.sampleSize;
      return summarize(
        performanceModels(crit, a, n, mins),
        zPass,
        zFail,
        blocked || undecidable,
        blocked,
      );
    };
    const [members, lower, upper, fail] = at(a.n);
    if (lower === null)
      return notComputed(
        members.length ? "member_power_not_computed" : "no_threshold",
        members,
      );
    const out: CriterionPower = {
      status: "computed",
      passProbability: lower,
      passProbabilityUpperBound: upper,
      failProbability: fail,
      requiredNForPass: smallestN((n) => at(n)[1], target),
      members,
      reasons: [],
    };
    if (a.n < mins.sampleSize) out.reasons.push("below_minimum_sample_size");
    if (undecidable) out.reasons.push("undecidable_metric");
    if (members.some((e) => e.reasons.includes("planned_below_minimum")))
      out.reasons.push("planned_below_minimum");
    if (out.requiredNForPass === null) out.reasons.push("target_unreachable");
    return out;
  }
  return notComputed("power_not_specified_for_metric");
}

export function evaluatePower(inp: any) {
  const level = get(inp, "confidenceLevel", 0.95),
    target = get(inp, "targetPower", 0.8);
  if (inp.kind === "equality_test") {
    const [raw, n] = equalityTestN(inp.p1, inp.p2, level, target);
    return { groupSizeExact: raw, groupSize: n };
  }
  const crit = normalizeCriterion(inp.criterion);
  return criterionPower(crit, level, target, get(inp, "familySize", 1), {
    ...FLOORS,
    ...get(inp, "minimums", {}),
  });
}

// ------------------------------------------------------------ NYC LL144 reporting (section 10.2)
export const LL144_RATE_KEYS = {
  selection: ["selected", "selectionRate", "selectionRateInterval"],
  scoring: ["scoredAboveMedian", "scoringRate", "scoringRateInterval"],
} as const;
export type Ll144Row = {
  category: string;
  n: number;
  shareOfData: number;
  shareOfKnown: number;
  eligibleForTwoPercentExclusion: boolean;
  excluded: boolean;
  impactRatio: number | null;
  impactRatioInterval: CriterionInterval | null;
} & Record<string, unknown>;
/**
 * One LL144 table (sex, race/ethnicity or intersectional categories) from
 * per-category counts, as engine/statistics.py evaluate_ll144. `selected`
 * counts the individuals selected (selection rates) or scoring above the
 * full-sample median (scoring rates). A category with no individuals has no
 * rate; when the reference category's rate is zero every impact ratio is
 * undefined (null).
 */
export function evaluateLl144(inp: any, level = 0.95) {
  const [countKey, rateKey, intervalKey] =
    LL144_RATE_KEYS[get(inp, "rate", "selection") as "selection" | "scoring"];
  const z = zcrit(level);
  const cats: { name: string; n: number; selected: number }[] = inp.categories;
  const known = sum(cats.map((c) => c.n));
  const unknown = get(inp, "unknownCount", 0);
  // "The data being used for the bias audit" includes the unknown category (section 10.2).
  const total = known + unknown;
  require_(total > 0, "an LL144 table needs at least one individual");
  const excluded = new Set<string>(get(inp, "excluded", []));
  const rows: Ll144Row[] = cats.map((c) => {
    const share = c.n / total;
    require_(
      !excluded.has(c.name) || share < 0.02,
      "2% exclusion only allowed below 2% of the data",
    );
    let rate: number | null = null,
      interval: CriterionInterval | null = null;
    if (c.n > 0) {
      const [lo, hi] = wilson(c.selected, c.n, z);
      rate = c.selected / c.n;
      interval = { lower: lo, upper: hi, level, method: "wilson" };
    }
    return {
      category: c.name,
      n: c.n,
      [countKey]: c.selected,
      [rateKey]: rate,
      [intervalKey]: interval,
      shareOfData: share,
      shareOfKnown: known ? c.n / known : 0,
      eligibleForTwoPercentExclusion: share < 0.02,
      excluded: excluded.has(c.name),
      impactRatio: null,
      impactRatioInterval: null,
    };
  });
  const included = rows.filter((r) => !r.excluded && r.n > 0);
  const rateOf = (r: Ll144Row) => r[rateKey] as number;
  // The first maximum in input order.
  const ref = included.length
    ? included.reduce((best, r) => (rateOf(r) > rateOf(best) ? r : best))
    : null;
  if (ref && (ref[countKey] as number) > 0)
    for (const r of included) {
      if (r === ref) {
        r.impactRatio = 1.0;
        continue;
      }
      const xs = r[countKey] as number,
        ns = r.n,
        xc = ref[countKey] as number,
        nc = ref.n;
      const method = ratioMethod(xs, ns, xc, nc)!;
      const [lo, hi] =
        method === "katz_log"
          ? katz(xs, ns, xc, nc, z)
          : koopman(xs, ns, xc, nc, z);
      r.impactRatio = xs / ns / (xc / nc);
      r.impactRatioInterval = { lower: lo, upper: hi, level, method };
    }
  return {
    referenceCategory: ref ? ref.category : null,
    totalIndividuals: total,
    totalAssessedKnown: known,
    unknownCategoryCount: unknown,
    categories: rows,
  };
}
