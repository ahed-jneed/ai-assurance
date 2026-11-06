// Three-valued fact logic shared by the rule pack (lib/rule-pack.ts) and the
// guided classification (lib/domain/classification.ts): a fact is true, false
// or unknown, and an unknown never counts as a pass or as "not applicable"
// (the rule pack's predicateRule). Pure, without data imports, so the check
// harnesses can load it through lib/domain.ts.

export type Predicate = {
  fact: string;
  op: "eq" | "in" | "before" | "onOrAfter";
  value: unknown;
};
/** Recorded fact values; an absent, null or "unknown" value is unknown. */
export type Facts = Readonly<Record<string, unknown>>;
export type Truth = boolean | "unknown";

export function truth(p: Predicate, facts: Facts): Truth {
  const v = Object.hasOwn(facts, p.fact) ? facts[p.fact] : undefined;
  if (v === undefined || v === null || v === "unknown") return "unknown";
  switch (p.op) {
    case "eq":
      return v === p.value;
    case "in":
      return Array.isArray(p.value) && p.value.includes(v);
    case "before":
      return typeof v === "string" && typeof p.value === "string"
        ? v < p.value
        : "unknown";
    case "onOrAfter":
      return typeof v === "string" && typeof p.value === "string"
        ? v >= p.value
        : "unknown";
  }
}
/** A conjunction in three-valued logic; an absent list counts as `absent`. */
export function conjunction(
  predicates: Predicate[] | undefined,
  facts: Facts,
  absent: boolean,
): Truth {
  if (!predicates?.length) return absent;
  let unknown = false;
  for (const p of predicates) {
    const t = truth(p, facts);
    if (t === false) return false;
    if (t === "unknown") unknown = true;
  }
  return unknown ? "unknown" : true;
}
/** Three-valued AND, OR and NOT over truth values. */
export function all(values: Truth[]): Truth {
  if (values.includes(false)) return false;
  return values.includes("unknown") ? "unknown" : true;
}
export function any(values: Truth[]): Truth {
  if (values.includes(true)) return true;
  return values.includes("unknown") ? "unknown" : false;
}
export function not(value: Truth): Truth {
  return value === "unknown" ? "unknown" : !value;
}
/** The truth of a boolean fact: anything but true or false is unknown. */
export function factTruth(facts: Facts, fact: string): Truth {
  const v = Object.hasOwn(facts, fact) ? facts[fact] : undefined;
  return v === true || v === false ? v : "unknown";
}
/**
 * Candidate selection (predicateRule): a candidate needs appliesIf true and
 * exceptIf false; any unknown yields needs_information. Selection never
 * approves applicability, which stays a reviewed human decision.
 */
export type Selection = "candidate" | "not_selected" | "needs_information";
export function select(
  rule: { appliesIf?: Predicate[]; exceptIf?: Predicate[] },
  facts: Facts,
): { selection: Selection; missingFacts: string[] } {
  const applies = conjunction(rule.appliesIf, facts, true),
    excepted = conjunction(rule.exceptIf, facts, false);
  if (applies === false || excepted === true)
    return { selection: "not_selected", missingFacts: [] };
  if (applies === true && excepted === false)
    return { selection: "candidate", missingFacts: [] };
  return {
    selection: "needs_information",
    missingFacts: unknownFacts(
      [...(rule.appliesIf ?? []), ...(rule.exceptIf ?? [])],
      facts,
    ),
  };
}
/** The distinct facts a predicate list reads as unknown. */
export function unknownFacts(predicates: Predicate[], facts: Facts) {
  return [
    ...new Set(
      predicates
        .filter((p) => truth(p, facts) === "unknown")
        .map((p) => p.fact),
    ),
  ];
}
