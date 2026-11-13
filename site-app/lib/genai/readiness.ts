// The GenAI readiness gate (docs/design/genai-evidence.md sections 4.2 and
// 12.3): for each GenAI result linked to a procedure, its effective evidence
// level, what blocks a positive conclusion, and the claim-scope statements a
// positive conclusion carries. The engine decides the statistics; this gate
// decides whether the evidence may support a conclusion at all. Pure.
import type { GenaiCustody, GenaiLevel, GenaiSummary } from "./summary";

/**
 * The procedure templates of the `genai-evaluation` pack: a procedure on one
 * of them is a GenAI programme item, which needs a linked GenAI result before
 * it can conclude `supported` or `qualified`. A test keeps this list equal to
 * the pack's working papers.
 */
export const GENAI_PROGRAMME_ITEMS = [
  "WP-GA-01",
  "WP-GA-02",
  "WP-GA-03",
  "WP-GA-04",
  "WP-GA-05",
  "WP-GA-06",
  "WP-GA-07",
] as const;
export const isGenaiProgrammeItem = (templateId: string) =>
  (GENAI_PROGRAMME_ITEMS as readonly string[]).includes(templateId);

/**
 * Judge-validation floors of decisions D-10 and D-16: a plan may raise them,
 * never lower them. The sample floors are the defaults of design section 8.1.
 */
export const GENAI_FLOORS = {
  minimumItems: 50,
  minimumKappaLowerBound: 0.6,
  pairwiseMinimumConsistencyLowerBound: 0.8,
  sampleSize: 30,
  memberSize: 10,
  clusters: 10,
  maxUnscoredFraction: 0.05,
  maxErrorFraction: 0.05,
} as const;

/** The flags a reviewer acknowledges (design section 12.1). */
export const GENAI_ACK_FLAGS = [
  "post_run_edits",
  "tool_aggregate_mismatch",
  "declaration_conflict",
  "family_declaration_conflict",
  "judge_validation_scope",
  "scorer_kind_declared",
] as const;
export type GenaiAckFlag = (typeof GENAI_ACK_FLAGS)[number];
export type GenaiAcknowledgement = {
  flag: GenaiAckFlag;
  runKey: string;
  judgeRef?: string | null;
  score?: string | null;
};

/** One GenAI result as the gate reads it: the record and what refers to it. */
export type GenaiResultContext = {
  recordId: string;
  artifactId: string;
  custody: GenaiCustody;
  summary: GenaiSummary;
  acknowledgements: GenaiAcknowledgement[];
  /** A genai_rerun_attestation by an auditor pins every input of the bundle. */
  attested: boolean;
  /**
   * For an uploaded envelope: a worker result of this engagement with the
   * same computationSha256, which authenticates the computation (4.2).
   */
  authenticatedBy?: string | null;
};

export const GENAI_BLOCKERS = {
  genai_result_missing:
    "This GenAI programme item links no GenAI result; link one through the execution's evidence",
  genai_no_deciding_criterion:
    "The plan has no confirmatory criterion, so the result decides nothing",
  genai_level_below_l2:
    "The evidence level is below L2: the statistics were not recomputed by an authenticated worker from per-item records",
  genai_below_minimum_items:
    "A deciding criterion has fewer scored items than the plan's minimum, or no sample size",
  genai_interval_missing:
    "A deciding member has no interval or no standard error",
  genai_judge_not_validated:
    "A model-graded or unclassified score decides, and its judge is not validated (kappa lower bound at least 0.60 on at least 50 items, bound label file)",
  genai_judge_same_family:
    "The judge's model family equals the system's family, or a family is undeclared",
  genai_metadata_incomplete:
    "Required run metadata is missing for the criteria present",
  genai_agentic_permissions_unknown:
    "An agentic run offers tools whose permissions are unknown",
  genai_run_incomplete: "A deciding run did not finish",
  genai_flag_unacknowledged:
    "Post-run edits, a tool-aggregate mismatch, a declaration or family conflict, or a deterministic declaration awaits a reviewer's acknowledgement",
  genai_plan_floor_lowered:
    "The plan lowers a floor of the methodology (D-10, D-16 or the sample minimums)",
} as const;
export type GenaiBlockerCode = keyof typeof GENAI_BLOCKERS;
export type GenaiBlocker = {
  code: GenaiBlockerCode;
  message: string;
  runKey?: string;
  criterionId?: string;
  detail?: string;
};

const ORDER: GenaiLevel[] = ["L0", "L1", "L2", "L3"];
const lower = (a: GenaiLevel, b: GenaiLevel) =>
  ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;

/**
 * The effective level of one run (design section 4.2): an upload counts as at
 * most L1 until a worker recomputation with the same computationSha256
 * authenticates it; a worker result of an auditor re-run with an attestation
 * pinning every input is L3; any other worker result keeps the engine level.
 */
export function effectiveLevel(
  engineLevel: GenaiLevel,
  r: Pick<GenaiResultContext, "custody" | "attested" | "authenticatedBy"> & {
    summary: Pick<GenaiSummary, "origin">;
  },
): GenaiLevel {
  const authenticated = r.custody === "worker" || !!r.authenticatedBy;
  if (!authenticated) return lower(engineLevel, "L1");
  if (
    engineLevel === "L2" &&
    r.summary.origin === "auditor_rerun" &&
    r.attested
  )
    return "L3";
  return engineLevel;
}

const ACK_FOR_WARNING: Partial<Record<string, GenaiAckFlag>> = {
  declaration_conflict: "declaration_conflict",
  family_declaration_conflict: "family_declaration_conflict",
};
/** Judge-flag reasons an acknowledgement may clear, and by which flag. */
const CLEARABLE: Partial<Record<string, GenaiAckFlag>> = {
  judge_validation_unbound: "judge_validation_scope",
  family_declaration_conflict: "family_declaration_conflict",
};

export type GenaiReadiness = {
  recordId: string;
  effectiveLevel: GenaiLevel;
  runs: { runKey: string; effectiveLevel: GenaiLevel }[];
  blockers: GenaiBlocker[];
  /** Flags awaiting acknowledgement, for the review UI. */
  pendingAcknowledgements: GenaiAcknowledgement[];
  claimScope: string[];
};

export function genaiReadiness(r: GenaiResultContext): GenaiReadiness {
  const s = r.summary,
    blockers: GenaiBlocker[] = [],
    pending: GenaiAcknowledgement[] = [];
  const block = (code: GenaiBlockerCode, extra: Partial<GenaiBlocker> = {}) => {
    if (
      !blockers.some(
        (b) =>
          b.code === code &&
          b.runKey === extra.runKey &&
          b.criterionId === extra.criterionId &&
          b.detail === extra.detail,
      )
    )
      blockers.push({ code, message: GENAI_BLOCKERS[code], ...extra });
  };
  const same = (a: GenaiAcknowledgement, k: GenaiAcknowledgement) =>
    k.flag === a.flag &&
    k.runKey === a.runKey &&
    (k.judgeRef ?? null) === (a.judgeRef ?? null) &&
    (k.score ?? null) === (a.score ?? null);
  /** Whether a reviewer acknowledged the flag; otherwise it becomes pending. */
  const cleared = (a: GenaiAcknowledgement) => {
    if (r.acknowledgements.some((k) => same(a, k))) return true;
    if (!pending.some((p) => same(a, p))) pending.push(a);
    return false;
  };

  const p = s.plan,
    jv = p.judgeValidation;
  if (
    jv.minimumItems < GENAI_FLOORS.minimumItems ||
    jv.minimumKappaLowerBound < GENAI_FLOORS.minimumKappaLowerBound ||
    jv.pairwiseMinimumConsistencyLowerBound <
      GENAI_FLOORS.pairwiseMinimumConsistencyLowerBound ||
    !jv.requireDifferentFamily ||
    p.minimums.sampleSize < GENAI_FLOORS.sampleSize ||
    p.minimums.memberSize < GENAI_FLOORS.memberSize ||
    p.minimums.clusters < GENAI_FLOORS.clusters ||
    p.maxUnscoredFraction > GENAI_FLOORS.maxUnscoredFraction ||
    p.maxErrorFraction > GENAI_FLOORS.maxErrorFraction
  )
    block("genai_plan_floor_lowered");

  const deciding = s.criteria.filter((k) => k.role === "confirmatory");
  if (!deciding.length) block("genai_no_deciding_criterion");
  const runKeys = new Set(deciding.flatMap((k) => k.runKeys));
  const runs = s.runs.filter((x) => runKeys.has(x.runKey));
  const levels = runs.map((x) => ({
    runKey: x.runKey,
    effectiveLevel: effectiveLevel(x.engineLevel, r),
  }));

  for (const x of levels)
    if (ORDER.indexOf(x.effectiveLevel) < ORDER.indexOf("L2"))
      block("genai_level_below_l2", {
        runKey: x.runKey,
        detail:
          r.custody === "uploaded" && !r.authenticatedBy
            ? "auditor-prepared, unauthenticated computation (custody cap L1)"
            : runs.find((y) => y.runKey === x.runKey)!.levelReasons.join(", "),
      });

  for (const k of deciding) {
    const reasons = new Set([
      ...k.reasons,
      ...k.members.flatMap((m) => m.reasons),
    ]);
    if (
      reasons.has("below_minimum_sample_size") ||
      !k.sampleSize ||
      k.members.some((m) => m.n == null)
    )
      block("genai_below_minimum_items", { criterionId: k.id });
    if (reasons.has("run_incomplete"))
      block("genai_run_incomplete", { criterionId: k.id });
    // Every deciding member needs an interval and a standard error (design
    // 12.3): the engine gives each criterion kind one (seIid, or sePaired).
    if (
      !k.members.length ||
      k.members.some(
        (m) =>
          !m.interval ||
          m.interval.lower == null ||
          m.interval.upper == null ||
          m.se == null,
      )
    )
      block("genai_interval_missing", { criterionId: k.id });
    for (const f of k.flags) {
      if (f.flag === "scorer_kind_declared") {
        if (
          !cleared({
            flag: "scorer_kind_declared",
            runKey: f.runKey,
            score: f.score,
          })
        )
          block("genai_flag_unacknowledged", {
            criterionId: k.id,
            runKey: f.runKey,
            detail: "scorer_kind_declared: " + f.score,
          });
        continue;
      }
      if (f.flag !== "judge_not_validated") continue;
      if (
        f.reasons.includes("same_family") ||
        f.reasons.includes("family_undeclared")
      )
        block("genai_judge_same_family", {
          criterionId: k.id,
          runKey: f.runKey,
          detail: f.judgeRef ?? undefined,
        });
      const open = f.reasons.filter((reason) => {
        const flag = CLEARABLE[reason];
        return (
          !flag || !cleared({ flag, runKey: f.runKey, judgeRef: f.judgeRef })
        );
      });
      if (open.length)
        block("genai_judge_not_validated", {
          criterionId: k.id,
          runKey: f.runKey,
          detail: (f.judgeRef ? f.judgeRef + ": " : "") + open.join(", "),
        });
    }
  }

  for (const x of runs) {
    if (x.missing.length)
      block("genai_metadata_incomplete", {
        runKey: x.runKey,
        detail: x.missing.join(", "),
      });
    if (
      x.tools.agentic === true &&
      x.tools.offered.some((t) => t.permission === "unknown")
    )
      block("genai_agentic_permissions_unknown", { runKey: x.runKey });
    if (x.incomplete) block("genai_run_incomplete", { runKey: x.runKey });
    const e = x.postRunEdits;
    if (
      (e.scoreEdits || e.logUpdates || e.invalidated || e.logInvalidated) &&
      !cleared({ flag: "post_run_edits", runKey: x.runKey })
    )
      block("genai_flag_unacknowledged", {
        runKey: x.runKey,
        detail: "post_run_edits",
      });
    if (
      x.reconciliation.some((row) => row.status === "mismatch") &&
      !cleared({ flag: "tool_aggregate_mismatch", runKey: x.runKey })
    )
      block("genai_flag_unacknowledged", {
        runKey: x.runKey,
        detail: "tool_aggregate_mismatch",
      });
    for (const w of x.warnings) {
      const flag = ACK_FOR_WARNING[w];
      if (flag && !cleared({ flag, runKey: x.runKey }))
        block("genai_flag_unacknowledged", { runKey: x.runKey, detail: w });
    }
  }

  const claimScope = [...new Set(runs.flatMap((x) => x.claimScope))];
  const marked = runs.filter((x) =>
    x.warnings.includes("marking_signature_unverified"),
  );
  if (marked.length)
    claimScope.push(
      "Signature verdicts in the marking records are as the provider's validator reported them; the platform did not verify the signatures.",
    );
  return {
    recordId: r.recordId,
    effectiveLevel: levels.length
      ? levels.map((x) => x.effectiveLevel).reduce(lower)
      : "L0",
    runs: levels,
    blockers,
    pendingAcknowledgements: pending,
    claimScope,
  };
}

/**
 * The gate of one procedure submission (design section 12.3): the blockers of
 * every linked result, plus genai_result_missing for a GenAI programme item
 * without one. Empty means a positive conclusion may be submitted.
 */
export function procedureGenaiBlockers(
  templateId: string,
  results: readonly GenaiReadiness[],
): GenaiBlocker[] {
  const out = results.flatMap((r) => r.blockers);
  if (isGenaiProgrammeItem(templateId) && !results.length)
    out.unshift({
      code: "genai_result_missing",
      message: GENAI_BLOCKERS.genai_result_missing,
    });
  return out;
}

/** One line per blocker, as a paper's limitations list them. */
export const blockerLine = (b: GenaiBlocker) =>
  "GenAI gate (" +
  b.code +
  "): " +
  b.message +
  (b.criterionId ? " [criterion " + b.criterionId + "]" : "") +
  (b.runKey ? " [run " + b.runKey + "]" : "") +
  (b.detail ? " (" + b.detail + ")" : "");
