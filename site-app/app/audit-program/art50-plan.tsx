"use client";
// The plan of an Art 50 working paper (WP-XC-07, WP-XC-10 to WP-XC-12;
// #120): the applicability the classification suggests through the research
// procedures, and the procedures' statistical criteria with the
// threshold-library entries that hold their bands. A suggestion never
// applies itself: "Use in plan" opens the plan form with the applicability
// and rationale filled in, and the auditor saves, edits or discards it.
import { Button } from "@/components/ui/button";
import {
  ART50_GENAI_METRICS,
  art50BandText,
  art50Criteria,
  art50CriteriaSource,
  libraryRef,
} from "@/lib/art50-criteria";
import type { PaperSuggestion } from "@/lib/domain/art50-papers";

const suggestionLabels: Record<
  PaperSuggestion["applicability"],
  [string, string]
> = {
  applicable: ["Suggested: applicable", "blue"],
  not_applicable: ["Suggested: not applicable", "neutral"],
  pending: ["Needs information", "amber"],
  readiness: ["Suggested: readiness", "blue"],
};
const periodLabels: Record<
  NonNullable<PaperSuggestion["timing"]>["items"][number]["period"],
  string
> = {
  readiness: "starts after the period ends",
  applicable: "applies for the whole period",
  starts_in_period: "starts within the period",
  undetermined: "date depends on facts not yet recorded",
};
const procedureLabels: Record<
  PaperSuggestion["procedures"][number]["status"],
  string
> = {
  candidate: "Applies: an item is a candidate",
  needs_information: "Needs information",
  not_applicable: "Does not apply on the recorded facts",
};
const itemLabels: Record<string, string> = {
  candidate: "candidate",
  excluded: "excluded",
  not_triggered: "not triggered",
  needs_information: "needs information",
  role_not_held: "role not held",
};
const legalStatusLabels: Record<string, string> = {
  no_legal_safe_harbour: "No legal safe harbour",
  screening_heuristic: "Screening heuristic",
  reporting_only: "Reporting only",
};

/** The applicability the classification suggests for an Art 50 paper. */
export function Art50Suggestion({
  suggestion: s,
  current,
  canUse,
  onUse,
  useLabel = "Use in plan",
  decision = "in the plan for independent review",
}: {
  suggestion: PaperSuggestion;
  /** The plan's recorded applicability; "" when there is no plan. */
  current: string;
  canUse: boolean;
  onUse: (s: PaperSuggestion) => void;
  useLabel?: string;
  /** Where the auditor records the decision, in the explanation. */
  decision?: string;
}) {
  const [text, color] = suggestionLabels[s.applicability];
  const recorded = current === s.applicability;
  return (
    <section
      className="readable-section art50-suggestion"
      aria-labelledby={"art50-suggestion-" + s.templateId}
      data-testid={"art50-suggestion-" + s.templateId}
    >
      <h3 id={"art50-suggestion-" + s.templateId}>
        Suggested from the classification
      </h3>
      <p>
        <span className={"badge " + color}>{text}</span>
        {recorded && (
          <>
            {" "}
            <span className="badge neutral">Recorded in the plan</span>
          </>
        )}
      </p>
      <p className="subtle">
        From the {s.basis.status} classification
        {s.basis.rulePackVersion
          ? " (rule pack " + s.basis.rulePackVersion + ")"
          : ""}
        , through the Art 50 items each research procedure tests. A suggestion
        is not an applicability decision: record the decision and its rationale{" "}
        {decision}.
        {s.basis.status !== "approved" &&
          " The classification is not approved yet, so the suggestion may change."}
      </p>
      <ul className="record-list">
        {s.procedures.map((p) => (
          <li key={p.procedureId}>
            <b>
              {p.procedureId} · {p.title}
            </b>{" "}
            · {procedureLabels[p.status]}
            <small className="block subtle">
              {p.items
                .map((i) => i.code + " " + itemLabels[i.status])
                .join(" · ")}
              {p.claimedExceptions.length > 0 &&
                " · Claimed exceptions to test per item: " +
                  p.claimedExceptions.join(", ")}
            </small>
          </li>
        ))}
      </ul>
      {s.timing === null && (
        <p className="subtle" data-testid="art50-timing">
          Timing not considered: the engagement period is not set in the brief.
        </p>
      )}
      {s.timing && (
        <div data-testid="art50-timing">
          <p className="subtle">
            Timing for the engagement period {s.timing.period.start} to{" "}
            {s.timing.period.end}:
          </p>
          <ul className="record-list">
            {s.timing.items.map((t) => (
              <li key={t.code}>
                <b>{t.code}</b> ·{" "}
                {t.date
                  ? "applies from " +
                    t.date +
                    (t.transition ? " (" + t.transition + " transition)" : "")
                  : "the " + t.transition + " transition may apply"}{" "}
                · {periodLabels[t.period]}
              </li>
            ))}
          </ul>
          {s.timing.pendingReview.length > 0 && (
            <p className="subtle">
              Pending legal review: {s.timing.pendingReview.join(", ")}
            </p>
          )}
        </div>
      )}
      {s.missingFacts.length > 0 && (
        <p className="subtle">Waits for: {s.missingFacts.join("; ")}</p>
      )}
      {canUse && !recorded && s.applicability !== "pending" && (
        <Button variant="outline" size="sm" onClick={() => onUse(s)}>
          {useLabel}
        </Button>
      )}
    </section>
  );
}

/** The statistical criteria of a paper's research procedures. */
export function Art50StatisticalCriteria({
  procedureIds,
}: {
  procedureIds: readonly string[];
}) {
  const criteria = art50Criteria(procedureIds);
  if (!criteria.length) return null;
  const notes = [
    ...new Map(
      criteria
        .flatMap((c) => c.entry?.statusNotes ?? [])
        .map((n) => [n.text, n]),
    ).values(),
  ];
  return (
    <section
      className="readable-section"
      aria-labelledby="art50-criteria-title"
      data-testid="art50-criteria"
    >
      <h3 id="art50-criteria-title">Statistical criteria</h3>
      <ul className="record-list">
        {criteria.map((c) => (
          <li key={c.id} data-testid={"art50-criterion-" + c.id}>
            <b>{c.id}</b> · {c.metric.replaceAll("_", " ")} · {art50BandText(c)}
            <small className="block subtle">
              {c.role} · {c.members} · at least {c.minimumN} per member ·{" "}
              {libraryRef(c)}
              {c.entry &&
                " · " +
                  (legalStatusLabels[c.entry.legalStatus] ??
                    c.entry.legalStatus)}
            </small>
            {c.band && c.role !== "descriptive" && (
              <small className="block subtle">
                {c.metric in ART50_GENAI_METRICS
                  ? "Decided by GenAI marking evidence (" +
                    ART50_GENAI_METRICS[c.metric] +
                    "): pre-register it in a GenAI plan in the Testing lab."
                  : "Attribute sampling: the auditor records the sample and its result."}
              </small>
            )}
          </li>
        ))}
      </ul>
      <p className="subtle">{art50CriteriaSource.caveat}</p>
      {notes.map((n) => (
        <p className="subtle" key={n.text}>
          As of {n.asOf}: {n.text}
        </p>
      ))}
    </section>
  );
}
