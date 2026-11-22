// Audit statistics: plan types, the threshold library and plan normalisation.
// Part of lib/statistics.ts (#272), which re-exports the public names.

/* eslint-disable @typescript-eslint/no-explicit-any -- plans and legacy
   configurations are untyped JSON validated here, as in the Python core. */

import library from "../threshold-library.json";
import {
  StatisticsError,
  require_,
  SPEC_VERSION,
  FLOORS,
  type Minimums,
  PERFORMANCE_KINDS,
  UNDECIDABLE,
  get,
} from "./core";
import { byCodePoint, fsum } from "./numerics";
import { type Band } from "./pvalues";
import { jcs } from "./plan-hash";

// ------------------------------------------------------------ plan normalisation, library and legacy derivation

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
  if (kind === "regression_performance") {
    const out: Record<string, unknown> = pick(["n", "errorSd"]);
    // Optional: models the mean baseline gate and the mse_reduction member (section 8).
    if (get(assumptions, "targetSd") !== null)
      out.targetSd = assumptions.targetSd;
    return out;
  }
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
