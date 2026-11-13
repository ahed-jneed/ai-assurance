// Management-system audits (#28): the Statement of Applicability, graded
// nonconformities with corrective action plans, programme phases (Stage 1
// before Stage 2) and the gates of an audit recommendation to a
// certification decision. Pure functions over the engagement and what its
// criteria pack switches on, so the client can show the same checklist the
// server enforces. The grading follows the common certification practice of
// ISO/IEC 17021-1 (major, minor, opportunity for improvement); the wording is
// our own and no standard text is reproduced (D-03).
import type { ManagementSystemView, SoaControl } from "../criteria/types";
import type { AuditGate } from "./gates";
import { isCertificationConclusion, requiresSupport } from "./report-model";
import type {
  Engagement,
  Finding,
  NonconformityGrade,
  Paper,
  SoaEntry,
} from "./types";

export const nonconformityGrades: Record<
  NonconformityGrade,
  { label: string; short: string; guidance: string }
> = {
  major: {
    label: "Major nonconformity",
    short: "Major",
    guidance:
      "A requirement is not fulfilled in a way that puts the management system's ability to achieve its intended results in doubt, for example a missing process or a systemic failure. Correction and corrective action must be verified before a recommendation.",
  },
  minor: {
    label: "Minor nonconformity",
    short: "Minor",
    guidance:
      "A requirement is not fulfilled, but the system's ability to achieve its intended results is not in doubt. An accepted corrective action plan is enough for a recommendation.",
  },
  opportunity: {
    label: "Opportunity for improvement",
    short: "OFI",
    guidance:
      "Not a nonconformity: a suggestion the organisation may take up. Needs no corrective action and never blocks a recommendation.",
  },
};
export const nonconformityGradeIds = ["major", "minor", "opportunity"] as const;

export const implementationStates: Record<
  NonNullable<SoaEntry["implementation"]>,
  string
> = {
  implemented: "Implemented",
  partially_implemented: "Partly implemented",
  planned: "Planned",
  not_implemented: "Not implemented",
};

const unresolved = (f: Finding) => f.status !== "closed";
/** Whether a finding is a nonconformity (major or minor). */
export const isNonconformity = (f: Finding) =>
  f.grade === "major" || f.grade === "minor";
export const planAccepted = (f: Finding) => !!f.correctiveAction?.accepted;

/** One row of the Statement of Applicability: a control and its decision. */
export type SoaRow = SoaControl & { entry?: SoaEntry; problem: string };
/** The Statement of Applicability rows, one per control, with what is missing. */
export function soaRows(
  controls: readonly SoaControl[],
  e: Pick<Engagement, "statementOfApplicability">,
): SoaRow[] {
  const entries = new Map(
    (e.statementOfApplicability?.entries ?? []).map((x) => [x.control, x]),
  );
  return controls.map((c) => {
    const entry = entries.get(c.id);
    return {
      ...c,
      entry,
      problem: !entry
        ? "No inclusion or exclusion decision"
        : !entry.justification.trim()
          ? "No justification"
          : entry.included && !entry.implementation
            ? "No implementation status"
            : "",
    };
  });
}
/** Counts of the Statement of Applicability for summaries. */
export function soaSummary(rows: readonly SoaRow[]) {
  return {
    controls: rows.length,
    decided: rows.filter((r) => r.entry).length,
    included: rows.filter((r) => r.entry?.included).length,
    excluded: rows.filter((r) => r.entry && !r.entry.included).length,
    incomplete: rows.filter((r) => r.problem).length,
  };
}
/** Whether the current revision of the Statement of Applicability was reviewed. */
export function soaReviewed(e: Pick<Engagement, "statementOfApplicability">) {
  const s = e.statementOfApplicability;
  return !!s?.review && s.review.revision === s.revision;
}

/**
 * The current, required papers of the phases before a paper's phase that are
 * not signed yet: Stage 2 work is signed only once Stage 1 is concluded.
 * Empty for a paper without a phase or in the first phase.
 */
export function earlierPhasePapers(
  e: Pick<Engagement, "papers">,
  phases: ManagementSystemView["phases"],
  paper: Pick<Paper, "templateId">,
) {
  const index = phases.findIndex((p) =>
    p.templateIds.includes(paper.templateId),
  );
  if (index <= 0) return [];
  const earlier = new Set(phases.slice(0, index).flatMap((p) => p.templateIds));
  return e.papers.filter(
    (p) =>
      !p.supersededBy &&
      !p.retired &&
      p.required &&
      earlier.has(p.templateId) &&
      p.status !== "signed",
  );
}

/** What a management-system gate needs to know about the pinned pack. */
export type ManagementSystemFeatures = {
  statementOfApplicability?: boolean;
  nonconformityGrading?: boolean;
  certificationRecommendation?: boolean;
};

const gate = (
  id: string,
  title: string,
  message: string,
  recordId?: string,
): AuditGate => ({
  id,
  kind: recordId ? "finding" : "management_system",
  ...(recordId ? { recordId } : {}),
  title,
  message,
});

/**
 * The gates the management-system features add to a final report with this
 * conclusion (#28):
 * - with nonconformity grading, every unresolved finding is graded, and an
 *   unresolved major nonconformity prevents an unmodified or readiness
 *   conclusion;
 * - a certification recommendation needs the pack's feature, a complete and
 *   reviewed Statement of Applicability, and by recommendation:
 *   recommended: no unresolved major nonconformity and an accepted plan for
 *   every unresolved minor one; deferred: an unresolved major nonconformity
 *   and an accepted plan for every unresolved nonconformity; not
 *   recommended: no further gate.
 */
export function managementSystemGates(
  e: Engagement,
  conclusion: string,
  features: ManagementSystemFeatures,
  controls: readonly SoaControl[] = [],
): AuditGate[] {
  const gates: AuditGate[] = [];
  const certification = isCertificationConclusion(conclusion);
  if (certification && !features.certificationRecommendation)
    return [
      gate(
        "certification:feature",
        "Certification recommendation",
        "This criteria pack has no certification recommendation; choose another engagement type",
      ),
    ];
  const open = e.findings.filter(unresolved);
  if (features.nonconformityGrading) {
    for (const f of open.filter((f) => !f.grade))
      gates.push(
        gate(
          "grade:" + f.id,
          f.title,
          f.id +
            ": grade the finding as a major or minor nonconformity or an opportunity for improvement",
          f.id,
        ),
      );
    if (requiresSupport(conclusion))
      for (const f of open.filter((f) => f.grade === "major"))
        gates.push(
          gate(
            "major:" + f.id,
            f.title,
            f.id +
              ": an unresolved major nonconformity prevents an unmodified or readiness conclusion",
            f.id,
          ),
        );
  }
  if (!certification) return gates;
  if (features.statementOfApplicability) {
    const rows = soaRows(controls, e);
    const incomplete = rows.filter((r) => r.problem);
    if (!controls.length || incomplete.length)
      gates.push(
        gate(
          "soa:complete",
          "Statement of Applicability",
          incomplete.length
            ? "Record a justified decision for every control of the Statement of Applicability (" +
                incomplete.length +
                " of " +
                rows.length +
                " incomplete, first " +
                incomplete[0].ref +
                ")"
            : "The criteria pack names no Statement of Applicability controls",
        ),
      );
    else if (!soaReviewed(e))
      gates.push(
        gate(
          "soa:review",
          "Statement of Applicability",
          "Review the current revision of the Statement of Applicability",
        ),
      );
  }
  const nonconformities = open.filter(isNonconformity);
  const majors = nonconformities.filter((f) => f.grade === "major");
  if (conclusion === "certification_recommended")
    for (const f of nonconformities)
      if (f.grade === "major")
        gates.push(
          gate(
            "major:" + f.id,
            f.title,
            f.id +
              ": an unresolved major nonconformity prevents a recommendation; close it after verifying its correction and corrective action, or defer the recommendation",
            f.id,
          ),
        );
      else if (!planAccepted(f))
        gates.push(
          gate(
            "plan:" + f.id,
            f.title,
            f.id +
              ": accept the corrective action plan of the minor nonconformity",
            f.id,
          ),
        );
  if (conclusion === "certification_deferred") {
    if (!majors.length)
      gates.push(
        gate(
          "deferral",
          "Recommendation deferred",
          "A deferral needs an unresolved major nonconformity awaiting verification; otherwise recommend or do not recommend",
        ),
      );
    for (const f of nonconformities.filter((f) => !planAccepted(f)))
      gates.push(
        gate(
          "plan:" + f.id,
          f.title,
          f.id +
            ": accept the corrective action plan before deferring the recommendation",
          f.id,
        ),
      );
  }
  return gates;
}

/** Counts of findings by grade, with how many are unresolved, for summaries. */
export function gradeSummary(findings: readonly Finding[]) {
  return nonconformityGradeIds.map((grade) => {
    const graded = findings.filter((f) => f.grade === grade);
    return {
      grade,
      ...nonconformityGrades[grade],
      total: graded.length,
      unresolved: graded.filter(unresolved).length,
      awaitingPlan: graded.filter(
        (f) => grade !== "opportunity" && unresolved(f) && !planAccepted(f),
      ).length,
    };
  });
}
