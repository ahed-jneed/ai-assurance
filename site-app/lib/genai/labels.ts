// Plain-language labels for the GenAI reason codes, levels and custody the
// results view shows (docs/design/genai-evidence.md sections 8.9 and 12.2).
// Pure; an unknown code is shown as it is.
import type { GenaiRunSummary, GenaiSummary } from "./summary";

export const REASON_LABELS: Record<string, string> = {
  below_minimum_sample_size: "fewer scored items than the plan's minimum",
  below_minimum_member_size: "fewer scored attacks than the member minimum",
  below_minimum_clusters: "fewer clusters than the plan's minimum",
  missing_cluster_id: "a scored item has no cluster id",
  unscored_fraction_exceeded: "too many unscored items",
  error_fraction_exceeded: "too many errored items",
  run_incomplete: "the run did not finish",
  member_key_missing: "an attack has no technique or variant",
  unsupported_aggregation:
    "the tool aggregates this score by other than a mean",
  below_k_trials: "a task has fewer trials than k",
  degenerate_interval: "no variance, so no interval",
  interval_straddles_band: "the interval straddles the band",
  multiplicity_adjustment: "not significant after the multiplicity adjustment",
  within_criterion_multiplicity:
    "not significant across the criterion's members",
  descriptive_only: "descriptive only, decides nothing",
  same_family: "the judge is from the same model family as the system",
  family_undeclared: "a model family is undeclared",
  family_declaration_conflict: "the declared family contradicts the model name",
  judge_validation_unbound: "the label file is not bound to this judge and run",
  kappa_undefined: "kappa is undefined (a single label value)",
  below_minimum_items: "fewer than 50 labelled items",
  kappa_lower_bound_below_floor: "kappa's lower bound is below 0.60",
  position_consistency_below_floor:
    "position-swap consistency is below the 0.80 floor",
  no_validation_labels: "no label file validates this judge",
  judge_unknown: "the judge of a model-graded score is unknown",
  scorer_kind_unknown: "the score's kind is unknown and undeclared",
  acknowledgement_required: "a reviewer must acknowledge the declaration",
  unverified_format_version: "the tool's format version is unverified",
  tool_hash_mismatch: "a hash the tool recorded does not match",
  no_scored_items: "no item was scored",
  no_scored_groups: "no group was scored",
  judge_not_validated: "the judge is not validated",
  unverified_tool_version: "the tool's version is unverified",
  tool_aggregate_mismatch:
    "the tool's aggregate differs from the recomputation",
};
export const reasonLabel = (code: string) => REASON_LABELS[code] ?? code;

export const LEVEL_LABELS: Record<string, string> = {
  L0: "L0 · reported aggregate",
  L1: "L1 · hashed tool log",
  L2: "L2 · recomputed by the engine",
  L3: "L3 · auditor re-run with attestation",
};

export const ACK_LABELS: Record<string, string> = {
  post_run_edits: "Post-run edits",
  tool_aggregate_mismatch: "Tool aggregate mismatch",
  declaration_conflict: "Declaration conflict",
  family_declaration_conflict: "Family declaration conflict",
  judge_validation_scope: "Judge validation scope",
  scorer_kind_declared: "Deterministic scorer declaration",
};

export const custodyLabel = (custody: string, authenticated: boolean) =>
  custody === "worker"
    ? "Authenticated worker result"
    : authenticated
      ? "Uploaded envelope, authenticated by a matching worker result"
      : "Uploaded envelope: auditor-prepared, unauthenticated computation";

/** A number to at most `digits` decimals, or an em dash. */
export const fmt = (v: number | null | undefined, digits = 4) =>
  typeof v === "number" && Number.isFinite(v)
    ? String(Number(v.toFixed(digits)))
    : "—";

type JudgeValidations = Pick<GenaiSummary, "judgeValidation">;
type RunJudge = GenaiRunSummary["judges"][number];
/**
 * A judge's validation as the results view lists it (design section 12.2):
 * kappa with its lower bound and n for every judge and, for a pairwise judge,
 * the position-consistency bound and the number of swapped pairs (#233).
 */
export function judgeValidationText(
  s: JudgeValidations,
  runKey: string,
  j: RunJudge,
) {
  const kappa =
    "kappa " +
    fmt(j.kappa, 3) +
    ", lower bound " +
    fmt(j.lower, 3) +
    " on " +
    (j.n ?? "—") +
    " items";
  if (j.role !== "pairwise_judge") return kappa;
  const v =
    s.judgeValidation.find((x) =>
      x.bindings.some((b) => b.runKey === runKey && b.judgeRef === j.ref),
    ) ?? s.judgeValidation.find((x) => x.judgeRef === j.ref);
  return v?.pairs
    ? kappa +
        " · position consistency lower bound " +
        fmt(v.positionConsistencyLower, 3) +
        " on " +
        v.pairs +
        " swapped pairs"
    : kappa + " · position consistency: no swapped (AB/BA) pairs";
}
