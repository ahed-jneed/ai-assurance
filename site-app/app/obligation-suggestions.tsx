"use client";
// Applicability candidates for the Art 9 to 26 obligation subitems (#104):
// the classification's facts run through the subitems' trigger profiles with
// the evaluator of the Art 50 items. A suggestion opens the obligation
// assessment with the subitem and role filled in; the applicability decision
// and its rationale stay the auditor's, for independent review.
import { Button } from "@/components/ui/button";
import { obligationItems } from "@/lib/classification-rules";
import {
  factLabel,
  obligationSuggestions,
  subitemFactLabels,
  type Classification,
  type ClassificationRules,
  type ObligationSuggestion,
} from "@/lib/domain/classification";
import obligations from "@/lib/obligation-subitems.json";

const reviewFlags = new Map(
  obligations.items.flatMap((o) =>
    o.legalReview?.required ? [[o.code, o.legalReview.itemIds] as const] : [],
  ),
);
/** The unknown facts a suggestion waits for, in words. */
export function missingFactsText(
  s: Pick<ObligationSuggestion, "missingFacts">,
  rules: ClassificationRules,
) {
  return s.missingFacts
    .map((f) => subitemFactLabels[f] ?? factLabel(rules, f))
    .join("; ");
}

export function ObligationSuggestions({
  classification: c,
  rules,
  assessed,
  writer,
  onAssess,
}: {
  classification: Classification;
  rules: ClassificationRules;
  /** Subitem codes with a recorded obligation assessment. */
  assessed: ReadonlySet<string>;
  writer: boolean;
  onAssess: (code: string, actor: string) => void;
}) {
  const all = obligationSuggestions(c, rules, obligationItems),
    suggested = all.filter((s) => s.status === "candidate"),
    open = all.filter((s) => s.status === "needs_information"),
    other = all.length - suggested.length - open.length;
  const row = (s: ObligationSuggestion) => {
    const flags = reviewFlags.get(s.code);
    return (
      <div key={s.code} data-testid={"obligation-suggestion-" + s.code}>
        <b>
          {s.article} · {s.title}
        </b>{" "}
        <span
          className={"badge " + (s.status === "candidate" ? "blue" : "amber")}
        >
          {s.status === "candidate" ? "Suggested" : "Needs information"}
        </span>
        {flags && (
          <>
            {" "}
            <span className="badge amber">
              Pending legal review · {flags.join(", ")}
            </span>
          </>
        )}
        {assessed.has(s.code) && (
          <>
            {" "}
            <span className="badge neutral">Assessment recorded</span>
          </>
        )}
        <small className="block subtle">
          {s.code}
          {s.actor.length ? " · " + s.actor.join(", ") : ""}
          {s.status === "needs_information" &&
            " · Waits for: " + missingFactsText(s, rules)}
        </small>
        {writer && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAssess(s.code, s.actor[0] ?? "")}
          >
            Assess
          </Button>
        )}
      </div>
    );
  };
  return (
    <section
      className="obligation-suggestions"
      aria-labelledby="obligation-suggestions-title"
    >
      <h2 className="workbench-subhead" id="obligation-suggestions-title">
        Suggested from the classification
      </h2>
      <p className="subtle">
        Candidates from the classification&apos;s facts and the subitems&apos;
        trigger profiles (Articles 9 to 26). A suggestion is not an
        applicability decision: record the decision with its rationale for
        independent review.
        {c.status !== "approved" &&
          " The high-risk route counts only once the classification is approved."}
      </p>
      {suggested.length + open.length ? (
        <div className="obligation-list">
          {suggested.map(row)}
          {open.map(row)}
        </div>
      ) : (
        <p className="subtle">
          No Article 9 to 26 subitem is suggested by the recorded facts.
        </p>
      )}
      {other > 0 && (
        <small className="block subtle">
          {other} other subitem{other === 1 ? "" : "s"}: not triggered or
          excluded by the recorded facts, or for a role the operator does not
          hold.
        </small>
      )}
    </section>
  );
}
