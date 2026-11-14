// The Annex IV index a report captures: for each section of the pinned pack's
// Annex IV map (lib/criteria/pin.ts `annexIvMapOf`), the current papers of its
// mapped templates, the accepted candidate evidence and the explicit gaps a
// human reviewer must still assess.
import type { AnnexIvMap } from "./criteria/types";
import { paperCurrent, paperRequired } from "./domain/gates";
import type { Engagement } from "./domain/types";

/**
 * A section counts a mapped template's current papers: not superseded or
 * retired, and either signed or required. Unsigned supplementary drafts,
 * such as automatic diagnostic papers, are not assessments of the section,
 * so they are neither matched nor reported as gaps. A mapped template without
 * a current paper is an explicit gap.
 */
export function annexIVIndex(e: Engagement, annexMap: AnnexIvMap) {
  return annexMap.sections.map((section) => {
    const matching = e.papers.filter(
        (p) =>
          section.paperIds.includes(p.templateId) &&
          paperCurrent(p) &&
          (p.status === "signed" || paperRequired(e, p)),
      ),
      candidates = e.artifacts.filter(
        (a) =>
          a.status === "accepted" &&
          section.evidenceCategories.includes(a.category),
      );
    return {
      number: section.number,
      title: section.title,
      reference: section.reference,
      state: candidates.length ? "candidate_evidence_present" : "unassessed",
      paperIds: matching.map((p) => p.id),
      candidateEvidenceIds: candidates.map((a) => a.id),
      gaps: [
        ...(!candidates.length ? ["No accepted candidate evidence"] : []),
        ...section.paperIds
          .filter((t) => !matching.some((p) => p.templateId === t))
          .map(
            (t) => t + ": no current working paper for this mapped template",
          ),
        ...matching
          .filter((p) => p.status !== "signed")
          .map((p) => p.templateId + ": independent signed assessment missing"),
        "Human assessment of legal subitems, scope, currency and version remains required",
      ],
      checklist: section.evidenceChecklist,
    };
  });
}
