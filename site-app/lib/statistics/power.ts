// Audit statistics: criterion power, required sample sizes and detectable effects.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import {
  FLOORS,
  type Minimums,
  POWER_SEARCH_LIMIT,
  PERFORMANCE_KINDS,
  get,
} from "./core";
import { normalQuantile, zcrit, byCodePoint, fsum, tupleMin } from "./numerics";
import { type Band, logBand } from "./pvalues";
import { type PlanCriterion, normalizeCriterion } from "./plan";
import {
  normalProbs,
  assumed,
  type PowerModel,
  performanceModels,
  groupModels,
} from "./power-models";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the entry is built key by key in the engine's key order.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a criterion's assumptions are untyped plan JSON, as in the Python core.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the input is untyped JSON (golden cases and API bodies), as in the Python core.
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
