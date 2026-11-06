// The report parts of final issuance: whether the report terms are a valid
// combination, the ISAE 3000 (Revised) report elements (para. 69) and the
// roll-up of results by criterion. The evidence gates of final issuance stay
// in gates.ts.
import type { Engagement, Finding } from "./types";
import {
  conclusionStatement,
  conclusionTypes,
  engagementTypes,
  practitionerResponsibility,
  qualityStatement,
  reportTitle,
  termsProblem,
  type ReportParticulars,
  type ReportTerms,
} from "./report-model";
import { acceptanceApplies, acceptanceGates } from "../workflow/acceptance";

/** One element a report must contain, with its value and what is missing. */
export type ReportElement = {
  id:
    | "title"
    | "addressee"
    | "subject"
    | "criteria"
    | "responsibilities"
    | "standard"
    | "independence"
    | "work"
    | "conclusion"
    | "signature"
    | "date"
    | "location";
  label: string;
  value: string;
  /** Why the element is incomplete; empty when it is complete. */
  problem: string;
};

/**
 * Why the independence element is incomplete when the acceptance gate
 * applies and its record or a team member's declaration is not in order.
 */
export const independenceProblem =
  "Approve the acceptance record and obtain a current, conflict-free declaration from every team member";

/**
 * Why the independence element is incomplete for a workflow adopted before
 * acceptance records whose brief has no independence note. Briefs no longer
 * ask for the note, so the acceptance record is the only way to record it.
 */
export const legacyIndependenceProblem =
  "Record the independence assessment: start the acceptance record and obtain a declaration from every team member";

/** How the conclusion names the subject matter of the approved brief. */
export function subjectPhrase(e: Engagement) {
  const b = e.workflow?.brief;
  return b?.systemName
    ? "the AI system " +
        b.systemName +
        " for the period " +
        b.periodStart +
        " to " +
        b.periodEnd
    : "the AI system of engagement " + e.title;
}
/** How the conclusion refers to the criteria the report sets out. */
export const criteriaPhrase = "the criteria set out in this report";

/**
 * The selected, applicable procedures of the program grouped by the criterion
 * they test, with how far their results support it. A procedure without a
 * recorded criterion is grouped under its own template id.
 *
 * `counted` limits which findings the open-finding counts include: the client
 * report counts only client-visible findings, so its counts match the
 * findings it lists. The result still reflects every open High or Critical
 * finding, because it states the practitioner's view of the criterion.
 *
 * With `lookup` (the pinned criteria, docs/design/criteria-model.md section 7,
 * phase 2), an open finding linked to no selected procedure is rolled up
 * through its `criteriaRefs`: into every criterion whose procedures' items
 * link one of those requirements or an ancestor group of one, or, when none
 * does, into a criterion of its own named by the reference's citation, which
 * no procedure evaluated.
 */
export function criterionRollup(
  e: Engagement,
  counted: (f: Finding) => boolean = () => true,
  lookup?: CriteriaLookup,
) {
  const groups = new Map<
    string,
    {
      criterion: string;
      procedures: number;
      supported: number;
      exceptions: number;
      notEvaluated: number;
      openFindings: number;
      openHighFindings: number;
    }
  >();
  const highCriteria = new Set<string>();
  const group = (criterion: string) =>
    groups.get(criterion) ?? {
      criterion,
      procedures: 0,
      supported: 0,
      exceptions: 0,
      notEvaluated: 0,
      openFindings: 0,
      openHighFindings: 0,
    };
  // The requirement references each criterion's procedures link.
  const linked = new Map<string, Set<string>>();
  const rolledUp = new Set<string>();
  const addFinding = (criterion: string, f: Finding) => {
    const g = group(criterion);
    const high = ["High", "Critical"].includes(f.severity);
    if (high) highCriteria.add(criterion);
    if (counted(f)) {
      g.openFindings++;
      if (high) g.openHighFindings++;
    }
    groups.set(criterion, g);
  };
  for (const p of e.workflow?.procedures ?? []) {
    if (!p.selected || p.applicability === "not_applicable") continue;
    const criterion = p.criterion.trim() || p.templateId;
    const g = group(criterion);
    if (lookup) {
      const refs = linked.get(criterion) ?? new Set<string>();
      for (const ref of lookup.refsOf(p.templateId)) refs.add(ref);
      linked.set(criterion, refs);
    }
    const paper = e.papers.find((q) => q.id === p.paperId);
    const outcome =
      p.execution?.assessment?.outcome ??
      paper?.body.conclusionStatus ??
      "not_evaluated";
    g.procedures++;
    if (["supported", "not_applicable"].includes(outcome)) g.supported++;
    else if (["qualified", "not_supported"].includes(outcome)) g.exceptions++;
    else g.notEvaluated++;
    groups.set(criterion, g);
    for (const f of e.findings)
      if (f.status !== "closed" && f.support?.procedureId === p.id) {
        rolledUp.add(f.id);
        addFinding(criterion, f);
      }
  }
  if (lookup)
    for (const f of e.findings) {
      if (f.status === "closed" || rolledUp.has(f.id)) continue;
      const refs = f.criteriaRefs ?? [];
      const related = new Set(refs.flatMap((ref) => lookup.ancestorsOf(ref)));
      const matching = [...linked].filter(([, set]) =>
        [...set].some((ref) => related.has(ref)),
      );
      if (matching.length)
        for (const [criterion] of matching) addFinding(criterion, f);
      else for (const ref of refs) addFinding(lookup.citation(ref), f);
    }
  return [...groups.values()].map((g) => ({
    ...g,
    result:
      g.exceptions || highCriteria.has(g.criterion)
        ? ("exceptions" as const)
        : g.notEvaluated || !g.procedures
          ? ("not_evaluated" as const)
          : ("no_exceptions" as const),
  }));
}
export type CriterionResult = ReturnType<typeof criterionRollup>[number];
/**
 * What the criterion roll-up needs of the pinned criteria: the requirement
 * references an item links, a reference with its ancestor groups, and the
 * citation of a reference.
 */
export type CriteriaLookup = {
  refsOf(templateId: string): string[];
  ancestorsOf(reference: string): string[];
  citation(reference: string): string;
};

/**
 * The report elements for these terms. Without `particulars` (the completion
 * checklist, before a report is prepared) the elements the Lead Auditor
 * states at capture are not checked.
 */
export function reportElements(
  e: Engagement,
  t: ReportTerms,
  particulars?: ReportParticulars,
  at = "",
): ReportElement[] {
  const b = e.workflow?.brief,
    type = engagementTypes[t.engagementType],
    procedures = (e.workflow?.procedures ?? []).filter((p) => p.selected),
    statement = conclusionStatement(t, subjectPhrase(e), criteriaPhrase),
    stated = (value: string | undefined, problem: string) =>
      particulars && !value?.trim() ? problem : "",
    fromBrief = (value: string | undefined, problem: string) =>
      b && !value?.trim() ? problem : "";
  const criteria = criterionRollup(e).map((c) => c.criterion);
  return [
    {
      id: "title",
      label: "Title",
      value: type ? reportTitle(t) : "",
      problem: termsProblem(t),
    },
    {
      id: "addressee",
      label: "Addressee",
      value: particulars?.addressee ?? b?.audience ?? "",
      problem: stated(particulars?.addressee, "Name the report's addressee"),
    },
    {
      id: "subject",
      label: "Subject matter",
      value: b
        ? b.systemName +
          " — " +
          b.intendedUse +
          " Boundary: " +
          b.boundary +
          " Period: " +
          b.periodStart +
          " to " +
          b.periodEnd
        : "",
      problem: fromBrief(
        b?.systemName && b.boundary,
        "The approved brief must identify the subject matter and its boundary",
      ),
    },
    {
      id: "criteria",
      label: "Criteria",
      value:
        (b?.basis ?? "") +
        (criteria.length ? " Criteria tested: " + criteria.join("; ") : ""),
      problem: fromBrief(
        b?.basis,
        "The approved brief must state the applicable criteria",
      ),
    },
    {
      id: "responsibilities",
      label: "Responsibilities",
      value:
        (b?.actorResponsibilities ? b.actorResponsibilities + " " : "") +
        (type ? practitionerResponsibility[t.engagementType] : ""),
      problem: fromBrief(
        b?.actorResponsibilities,
        "The approved brief must state the responsible party's responsibilities",
      ),
    },
    {
      id: "standard",
      label: "Standard applied",
      value: type?.standard ?? "",
      problem: "",
    },
    {
      id: "independence",
      label: "Independence and quality management",
      // The independence assessment is internal: it gates the element, and
      // the report states the firm's fixed statement instead. Where the
      // acceptance gate applies, the approved acceptance record and every
      // team member's current, conflict-free declaration are that
      // assessment; an older workflow keeps its brief's free-text note.
      // Briefs no longer ask for that note, so an older workflow without
      // one is pointed to the acceptance record, which then applies.
      value: qualityStatement,
      problem: acceptanceApplies(e.workflow)
        ? acceptanceGates(e).length
          ? independenceProblem
          : ""
        : fromBrief(b?.independence, legacyIndependenceProblem),
    },
    {
      id: "work",
      label: "Summary of work performed",
      value: procedures.length
        ? procedures.length +
          " procedures under audit program revision " +
          e.workflow!.program.revision +
          (criteria.length ? ", across " + criteria.length + " criteria" : "") +
          ": " +
          procedures.map((p) => p.title).join("; ")
        : "",
      problem:
        e.workflow && !procedures.length
          ? "Select the procedures performed in the audit program"
          : "",
    },
    {
      id: "conclusion",
      label: statement.heading,
      value: statement.text,
      problem:
        particulars &&
        conclusionTypes[t.conclusion]?.modified &&
        !particulars.basisForModification.trim()
          ? "State the basis for the " +
            statement.heading.toLowerCase() +
            ", distinguishing material from pervasive effects"
          : "",
    },
    {
      id: "signature",
      label: "Signature",
      value: particulars?.signatory ?? "",
      problem: stated(
        particulars?.signatory,
        "Name the practitioner or firm signing the report",
      ),
    },
    { id: "date", label: "Report date", value: at, problem: "" },
    {
      id: "location",
      label: "Location",
      value: particulars?.location ?? "",
      problem: stated(
        particulars?.location,
        "State the location where the practitioner practises",
      ),
    },
  ];
}
