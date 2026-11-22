// Audit statistics: member ids, members and their statistics.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { Z_MAX } from "./core";
import { zcrit, pFromZ } from "./numerics";
import { wilson } from "./intervals";
import {
  type Band,
  type Direction,
  directionOf,
  type CiAt,
  invert,
  wilsonZstar,
} from "./pvalues";
import { chanceExactP, type Chance, chanceGated } from "./exact-tests";

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
  /** A clustered plan's entries (section 5.11): the cluster bootstrap behind the interval. */
  bootstrap?: { replicates: number; validReplicates: number; clusters: number };
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

export function member(
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
export type Stat = {
  estimate: number | null;
  method: string | null;
  ciAt: CiAt | null;
  closed: ((band: Band) => (d: Direction) => number) | null;
  counts: Record<string, unknown>;
  status: Member["status"];
  reasons: string[];
  chance: Chance | null;
};
export const stat = (
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

export function support(
  n: number,
  minimum: number,
  reason = "below_minimum_class_count",
): [Member["status"], string[]] {
  return n >= minimum ? ["evaluated", []] : ["insufficient_support", [reason]];
}

export function statEntry(
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

export function wilsonStat(
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
