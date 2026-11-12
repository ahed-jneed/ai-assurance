// Where coverage evidence comes from (docs/design/criteria-model.md section
// 9.1): one source per procedure of a structured engagement, or per required
// or not-applicable paper without a workflow, plus the current obligation
// records on packs with obligation assessments. Unresolved findings linked
// to a source keep it open. Pure, like the engine it feeds.
import { paperCurrent, paperRequired } from "../domain/gates";
import type { Engagement, Finding } from "../domain/types";
import { currentExecution } from "../workflow-state";
import type { CoverageSource, LinkInput, SourceState } from "./coverage";

/** A current obligation record with its latest review (lib/assurance-store.ts). */
export type ObligationRecord = {
  id: string;
  code: string;
  applicability: string;
  outcome: string;
  /** Its latest independent review confirmed it. */
  confirmed: boolean;
};

const open = (f: Finding) => f.status !== "closed";
const findingRefs = (fs: Finding[]) =>
  fs.map((f) => ({ id: f.id, title: f.title, severity: f.severity }));
/**
 * A source with an unresolved linked finding is open, whatever its
 * conclusion, unless it is already not supported or out of scope.
 */
function withFindings(s: CoverageSource, findings: Finding[]): CoverageSource {
  if (!findings.length) return s;
  const state: SourceState =
    s.state === "not_supported" ||
    s.state === "excluded" ||
    s.state === "not_applicable"
      ? s.state
      : "open";
  return {
    ...s,
    state,
    evidence: { ...s.evidence, findings: findingRefs(findings) },
  };
}

export type SourceResult = {
  sources: CoverageSource[];
  /** Obligation records whose code the pinned framework lacks. */
  unusable: ObligationRecord[];
  /** Obligation records as direct links: their code, relationship equal. */
  obligationLinks: LinkInput[];
  /**
   * Unresolved findings linked to no source but with criteria (phase 2):
   * one open source each, placed directly on every requirement reference.
   */
  findingLinks: { sourceId: string; requirement: string }[];
  /** Unresolved findings linked to no source and with no criteria. */
  unplacedFindings: number;
  /** The program is not approved: the proposed scope is used. */
  proposedScope: boolean;
  /** No workflow: every paper source counts as readiness. */
  noApplicability: boolean;
};

/**
 * The coverage sources of an engagement. `obligationCodes` are the codes of
 * the pinned AI Act framework's obligation subitems (compat.obligations.order),
 * or null on a pack without obligation assessments.
 */
export function coverageSources(
  e: Engagement,
  records: readonly ObligationRecord[],
  obligationCodes: readonly string[] | null,
): SourceResult {
  const unresolved = e.findings.filter(open);
  const placed = new Set<string>();
  const sources: CoverageSource[] = [];
  if (e.workflow) {
    for (const p of e.workflow.procedures) {
      const paper = p.paperId
        ? e.papers.find((x) => x.id === p.paperId)
        : undefined;
      const outcome = p.execution?.assessment?.outcome;
      const concluded =
        p.state === "reviewed" &&
        currentExecution(e, p) &&
        !!p.review &&
        !!paper &&
        paper.status === "signed" &&
        paper.revision === p.paperRevision &&
        !!outcome;
      const state: SourceState =
        p.applicability === "not_applicable"
          ? "not_applicable"
          : !p.selected
            ? "excluded"
            : concluded
              ? outcome!
              : "open";
      const linked = unresolved.filter(
        (f) =>
          f.support?.procedureId === p.id ||
          (!!p.paperId && !!f.support?.paperIds.includes(p.paperId)),
      );
      for (const f of linked) placed.add(f.id);
      sources.push(
        withFindings(
          {
            id: p.id,
            kind: "procedure",
            state,
            readiness: p.applicability === "readiness",
            label: p.title,
            templateId: p.templateId,
            evidence: {
              paperId: p.paperId,
              paperRevision: p.paperRevision,
              reviewer: p.review?.userId,
              reviewedAt: p.review?.at,
              conclusion: outcome,
              applicability: p.applicability,
            },
          },
          state === "excluded" || state === "not_applicable" ? [] : linked,
        ),
      );
    }
  } else {
    for (const p of e.papers) {
      if (
        p.kind === "memo" ||
        !paperCurrent(p) ||
        !(paperRequired(e, p) || p.body.conclusionStatus === "not_applicable")
      )
        continue;
      const c = p.body.conclusionStatus;
      const state: SourceState =
        p.status !== "signed"
          ? "open"
          : c === "supported" || c === "qualified" || c === "not_supported"
            ? c
            : c === "not_applicable"
              ? "not_applicable"
              : "open";
      const linked = unresolved.filter((f) =>
        f.support?.paperIds.includes(p.id),
      );
      for (const f of linked) placed.add(f.id);
      sources.push(
        withFindings(
          {
            id: p.id,
            kind: "paper",
            state,
            // A paper records no applicability: understate, never overstate.
            readiness: true,
            label: p.title,
            templateId: p.templateId,
            evidence: {
              paperId: p.id,
              paperRevision: p.revision,
              reviewer: p.reviews.at(-1)?.userId,
              reviewedAt: p.reviews.at(-1)?.at,
              conclusion: c,
            },
          },
          state === "not_applicable" ? [] : linked,
        ),
      );
    }
  }
  const unusable: ObligationRecord[] = [];
  const obligationLinks: LinkInput[] = [];
  if (obligationCodes) {
    const codes = new Set(obligationCodes);
    for (const r of records) {
      if (!codes.has(r.code)) {
        unusable.push(r);
        continue;
      }
      const state: SourceState =
        !r.confirmed ||
        r.applicability === "needs_information" ||
        r.outcome === "unassessed"
          ? "open"
          : r.applicability === "not_applicable"
            ? "not_applicable"
            : r.outcome === "supported"
              ? "supported"
              : r.outcome === "qualified"
                ? "qualified"
                : r.outcome === "unsupported"
                  ? "not_supported"
                  : "open";
      sources.push({
        id: r.id,
        kind: "obligation",
        state,
        readiness: r.applicability === "readiness",
        label: "Obligation assessment " + r.code,
        evidence: { applicability: r.applicability, conclusion: r.outcome },
      });
      obligationLinks.push({
        sourceId: r.id,
        target: r.code,
        relationship: "equal",
        rationale: "semantic",
        via: "obligation",
      });
    }
  }
  // An unresolved finding that no source carries is placed through its
  // criteria as open work on those requirements (design section 7).
  const findingLinks: SourceResult["findingLinks"] = [];
  let unplacedFindings = 0;
  for (const f of unresolved) {
    if (placed.has(f.id)) continue;
    if (!f.criteriaRefs?.length) {
      unplacedFindings++;
      continue;
    }
    sources.push({
      id: f.id,
      kind: "finding",
      state: "open",
      readiness: false,
      label: "Unresolved finding " + f.title,
      evidence: { findings: findingRefs([f]) },
    });
    for (const requirement of f.criteriaRefs)
      findingLinks.push({ sourceId: f.id, requirement });
  }
  return {
    sources,
    unusable,
    obligationLinks,
    findingLinks,
    unplacedFindings,
    proposedScope: !!e.workflow && e.workflow.program.status !== "approved",
    noApplicability: !e.workflow,
  };
}
