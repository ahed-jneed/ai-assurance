// Audit statistics: run aggregation and plan evaluation.
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { require_, EPS } from "./core";
import { codePointCompare } from "./numerics";
import { bonferroni, benjaminiHochberg } from "./exact-tests";
import { planSha256 } from "./plan-hash";
import { type PlanCriterion, type Plan } from "./plan";
import { type CriterionData } from "./group-comparisons";
import { type CriterionResult, evaluateCriterion } from "./criteria";
import {
  type Clustered,
  clusterKey,
  clusterBootstrapCriteria,
} from "./cluster-bootstrap";

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
  // A plan with a clusterField takes the clustered shape
  // {seed, clusters: [{cluster, ...one cluster's data}]} (section 5.11).
  if (plan.clusterField !== null) {
    const clustered = data as ClusteredData;
    require_(
      Array.isArray(clustered.clusters) &&
        clustered.clusters.length > 0 &&
        Number.isInteger(clustered.seed),
      "a clustered plan needs data.clusters and data.seed",
    );
    const ordered = [...clustered.clusters].sort((a, b) =>
      codePointCompare(clusterKey(a.cluster), clusterKey(b.cluster)),
    );
    const parts = ordered.map(({ cluster: _, ...part }) => part);
    return evaluateCriteria(plan, () => data, {
      ids: ordered.map((part) => part.cluster),
      partsFor: () => parts,
      seed: clustered.seed,
    });
  }
  return evaluateCriteria(plan, () => data);
}

/** The golden cases' clustered data shape (section 5.11). */
export type ClusteredData = {
  seed: number;
  clusters: (CriterionData & { cluster: unknown })[];
};

/**
 * Evaluates every criterion of a normalised plan on the data `dataFor`
 * returns, then applies the family adjustments (section 4.5) and the run
 * aggregation over confirmatory criteria (section 4.6). With `clustered`,
 * every member is decided by the cluster bootstrap instead (section 5.11).
 */
export function evaluateCriteria(
  plan: Plan,
  dataFor: (criterion: PlanCriterion) => CriterionData,
  clustered?: Clustered,
): PlanEvaluation {
  require_(
    plan.clusterField === null || clustered !== undefined,
    "a clustered plan is decided by the cluster bootstrap and needs its cluster data",
  );
  const level = plan.confidenceLevel;
  const alpha = 1.0 - level;
  const derived = plan.derivedFrom !== null;
  const results = clustered
    ? clusterBootstrapCriteria(plan, clustered)
    : plan.criteria.map((c) =>
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
