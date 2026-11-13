// Applicability suggestions for the Art 50 working papers (#120). The program
// seeds WP-XC-07 and WP-XC-10 to WP-XC-12 as pending; each paper takes its
// steps from research procedures (catalogue researchProcedures), and each
// procedure tests Art 50 obligation items (AIA-50-x). The classification's
// Art 50 assessment of those items, through the procedures, suggests the
// paper's applicability:
//
// - applicable when a procedure tests an item that is a candidate;
// - pending (needs information) when none is a candidate and an item needs
//   information, naming the facts it waits for;
// - not applicable when every item is excluded, not triggered or for a role
//   the operator does not hold.
//
// A suggestion is never an applicability decision and never applied by
// itself: the auditor records the decision with its rationale in the
// procedure plan, for independent review (the program approval), as with the
// obligation-subitem suggestions of #104. Pure and without data imports.
import {
  art50Assessment,
  factLabel,
  type Art50Result,
  type Art50Status,
  type Classification,
  type ClassificationRules,
} from "./classification";

/** The catalogue fields a suggestion reads (lib/catalog-criteria.ts). */
export type ResearchPaper = {
  id: string;
  researchProcedures?: {
    data: string;
    procedures: { procedureId: string; title: string; items: string[] }[];
  };
};
export type SuggestedApplicability =
  "applicable" | "not_applicable" | "pending";
export type ProcedureSuggestion = {
  procedureId: string;
  title: string;
  /** candidate when an item is; else needs_information when one does. */
  status: "candidate" | "needs_information" | "not_applicable";
  items: Pick<Art50Result, "code" | "article" | "status" | "missingFacts">[];
  /** Exceptions the facts claim, tested per item in fieldwork. */
  claimedExceptions: string[];
};
export type PaperSuggestion = {
  templateId: string;
  applicability: SuggestedApplicability;
  procedures: ProcedureSuggestion[];
  /** The facts a pending suggestion waits for, in words. */
  missingFacts: string[];
  /** The classification it was derived from. */
  basis: {
    status: Classification["status"];
    rulePackVersion: string;
    legalVersion: string;
  };
  /** A rationale the auditor may adopt, edit or replace in the plan. */
  rationale: string;
};

const itemStatusText: Record<Art50Status, string> = {
  candidate: "candidate",
  excluded: "excluded",
  not_triggered: "not triggered",
  needs_information: "needs information",
  role_not_held: "role not held",
};
const applicabilityText: Record<SuggestedApplicability, string> = {
  applicable: "applicable",
  not_applicable: "not applicable",
  pending: "pending: the classification needs information",
};

/** Whether a catalogue item is a paper built from Art 50 research procedures. */
export function isArt50Paper(
  item: ResearchPaper,
  rules: Pick<ClassificationRules, "art50Items">,
) {
  const codes = new Set(rules.art50Items.map((i) => i.code));
  const procedures = item.researchProcedures?.procedures ?? [];
  return (
    procedures.length > 0 &&
    procedures.every((p) => p.items.some((code) => codes.has(code)))
  );
}

/**
 * The suggested applicability of an Art 50 paper, or null when the item is
 * not one or the classification predates the tri-state model (#19), whose
 * facts it would need.
 */
export function art50PaperSuggestion(
  c: Pick<
    Classification,
    | "operatorRole"
    | "annexRoute"
    | "answers"
    | "status"
    | "model"
    | "version"
    | "rulePackVersion"
  >,
  rules: ClassificationRules,
  item: ResearchPaper,
): PaperSuggestion | null {
  if (c.model !== 2 || !isArt50Paper(item, rules)) return null;
  const results = new Map(art50Assessment(c, rules).map((r) => [r.code, r]));
  const procedures = item.researchProcedures!.procedures.map(
    (p): ProcedureSuggestion => {
      const items = p.items.flatMap((code) => {
        const r = results.get(code);
        return r ? [r] : [];
      });
      return {
        procedureId: p.procedureId,
        title: p.title,
        status: items.some((r) => r.status === "candidate")
          ? "candidate"
          : items.some((r) => r.status === "needs_information")
            ? "needs_information"
            : "not_applicable",
        items: items.map(({ code, article, status, missingFacts }) => ({
          code,
          article,
          status,
          missingFacts,
        })),
        claimedExceptions: [
          ...new Set(
            items
              .filter((r) => r.status === "candidate")
              .flatMap((r) => r.claimedExceptions.map((x) => x.id)),
          ),
        ],
      };
    },
  );
  const applicability: SuggestedApplicability = procedures.some(
    (p) => p.status === "candidate",
  )
    ? "applicable"
    : procedures.some((p) => p.status === "needs_information")
      ? "pending"
      : "not_applicable";
  const missingFacts =
    applicability === "pending"
      ? [
          ...new Set(
            procedures
              .flatMap((p) => p.items)
              .filter((i) => i.status === "needs_information")
              .flatMap((i) => i.missingFacts),
          ),
        ].map((f) => factLabel(rules, f))
      : [];
  const basis = {
    status: c.status,
    rulePackVersion: c.rulePackVersion ?? rules.rulePackVersion,
    legalVersion: c.version,
  };
  return {
    templateId: item.id,
    applicability,
    procedures,
    missingFacts,
    basis,
    rationale: suggestionRationale(
      applicability,
      procedures,
      missingFacts,
      basis,
    ),
  };
}

function suggestionRationale(
  applicability: SuggestedApplicability,
  procedures: ProcedureSuggestion[],
  missingFacts: string[],
  basis: PaperSuggestion["basis"],
) {
  const lines = [
    "Suggested from the " +
      basis.status +
      " classification" +
      (basis.rulePackVersion
        ? " (rule pack " + basis.rulePackVersion + ")"
        : "") +
      ": " +
      applicabilityText[applicability] +
      ".",
    ...procedures.map(
      (p) =>
        p.procedureId +
        " " +
        p.title +
        ": " +
        (p.items
          .map((i) => i.code + " " + itemStatusText[i.status])
          .join(", ") || "no Art 50 item") +
        (p.claimedExceptions.length
          ? "; claimed exceptions to test per item: " +
            p.claimedExceptions.join(", ")
          : "") +
        ".",
    ),
  ];
  if (missingFacts.length)
    lines.push("Waits for: " + missingFacts.join("; ") + ".");
  if (
    applicability === "applicable" &&
    procedures.some((p) => p.status !== "candidate")
  )
    lines.push(
      "Steps of procedures that do not apply are recorded as not performed with the reason.",
    );
  return lines.join("\n");
}
