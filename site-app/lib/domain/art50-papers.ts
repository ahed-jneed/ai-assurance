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
//
// Timing (#152): with the engagement period and the rule pack's Art 50
// dates, an applicable paper becomes readiness when every candidate item
// starts applying after the period ends: Art 50 from 2 August 2026, and
// Art 50(2) from 2 December 2026 for a generative system placed on the
// market before 2 August 2026 (Art 111(4)). When the transition's facts are
// unknown and they alone decide between readiness and applicable, the paper
// waits for them (pending).
import {
  select,
  type Facts,
  type Predicate,
  type Selection,
} from "../predicates";
import {
  art50Assessment,
  classificationFactValues,
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
  "applicable" | "not_applicable" | "pending" | "readiness";
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
  /**
   * When each candidate item starts applying against the engagement period
   * (#152); absent when the caller gives no timing, null without a period.
   */
  timing?: PaperTiming;
};

/** The rule-pack fields the dating reads (lib/rule-pack.ts ApplicationDate). */
export type DatedEntry = {
  id: string;
  date: string;
  dateType: string;
  provisions: string[];
  appliesIf?: Predicate[];
  exceptIf?: Predicate[];
  transitional?: { reference: string; entryId?: string }[];
  legalReview: { itemIds: string[] };
};
/** The Art 50 dates of a rule pack: the general start and its transitions. */
export type Art50Dating = {
  appliesFrom: { entryId: string; date: string; pendingReview: string[] };
  transitions: {
    entryId: string;
    reference: string;
    date: string;
    provisions: string[];
    appliesIf?: Predicate[];
    exceptIf?: Predicate[];
    pendingReview: string[];
  }[];
};
export type EngagementPeriod = { start: string; end: string };
/** Where the period falls against an item's date (lib/rule-pack.ts periodStatus). */
export type ItemPeriod =
  "readiness" | "applicable" | "starts_in_period" | "undetermined";
export type ItemTiming = {
  code: string;
  /** null while the transition's facts are unknown. */
  date: string | null;
  /** The transition the date comes from, when one applies or may apply. */
  transition: string | null;
  period: ItemPeriod;
  missingFacts: string[];
};
export type PaperTiming = {
  period: EngagementPeriod;
  items: ItemTiming[];
  /** Legal-review items still open for the dates used. */
  pendingReview: string[];
} | null;

/**
 * The Art 50 dates of a rule pack: the applies_from entry whose provisions
 * name Art 50 paragraphs, and the entries its transitional records link to.
 * Null when the pack has none.
 */
export function art50Dating(
  pack: {
    applicationDates: DatedEntry[];
    legalReviewItems: { id: string; status: string }[];
  } | null,
): Art50Dating | null {
  if (!pack) return null;
  const resolved = new Set(
    pack.legalReviewItems
      .filter((i) => i.status === "resolved")
      .map((i) => i.id),
  );
  const open = (e: DatedEntry) =>
    e.legalReview.itemIds.filter((id) => !resolved.has(id));
  const entry = pack.applicationDates.find(
    (e) =>
      e.dateType === "applies_from" &&
      e.provisions.some((x) => /^Art 50\(/.test(x)),
  );
  if (!entry) return null;
  return {
    appliesFrom: {
      entryId: entry.id,
      date: entry.date,
      pendingReview: open(entry),
    },
    transitions: (entry.transitional ?? []).flatMap((t) => {
      const target = pack.applicationDates.find((e) => e.id === t.entryId);
      return target
        ? [
            {
              entryId: target.id,
              reference: t.reference,
              date: target.date,
              provisions: target.provisions,
              appliesIf: target.appliesIf,
              exceptIf: target.exceptIf,
              pendingReview: open(target),
            },
          ]
        : [];
    }),
  };
}

function periodOf(date: string, period: EngagementPeriod): ItemPeriod {
  if (period.end < date) return "readiness";
  if (period.start >= date) return "applicable";
  return "starts_in_period";
}

/** When a candidate item starts applying, against the engagement period. */
function itemTiming(
  item: Pick<Art50Result, "code" | "article">,
  dating: Art50Dating,
  facts: Facts,
  period: EngagementPeriod,
): ItemTiming & { pendingReview: string[] } {
  const paragraph = /^50\(\d+\)/.exec(item.article)?.[0];
  const transition = paragraph
    ? dating.transitions.find((t) => t.provisions.includes("Art " + paragraph))
    : undefined;
  const general = {
    code: item.code,
    date: dating.appliesFrom.date,
    transition: null,
    period: periodOf(dating.appliesFrom.date, period),
    missingFacts: [],
    pendingReview: dating.appliesFrom.pendingReview,
  };
  if (!transition) return general;
  const chosen: { selection: Selection; missingFacts: string[] } = select(
    transition,
    facts,
  );
  if (chosen.selection === "not_selected") return general;
  const deferred = periodOf(transition.date, period);
  const pendingReview = [
    ...new Set([...general.pendingReview, ...transition.pendingReview]),
  ];
  if (chosen.selection === "candidate")
    return {
      ...general,
      date: transition.date,
      transition: transition.reference,
      period: deferred,
      pendingReview,
    };
  // The transition's facts are unknown: both dates are possible.
  return deferred === general.period
    ? { ...general, transition: transition.reference, pendingReview }
    : {
        ...general,
        date: null,
        transition: transition.reference,
        period: "undetermined",
        missingFacts: chosen.missingFacts,
        pendingReview,
      };
}

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
  readiness:
    "readiness: the obligations start applying after the engagement period",
};
const periodText: Record<ItemPeriod, string> = {
  readiness: "after the period ends",
  applicable: "before the period starts",
  starts_in_period: "within the period",
  undetermined: "undetermined",
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
 * facts it would need. With `timing`, an applicable paper is dated against
 * the engagement period (#152).
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
  timing?: { period: EngagementPeriod | null; dating: Art50Dating | null },
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
  let applicability: SuggestedApplicability = procedures.some(
    (p) => p.status === "candidate",
  )
    ? "applicable"
    : procedures.some((p) => p.status === "needs_information")
      ? "pending"
      : "not_applicable";
  let waitsFor =
    applicability === "pending"
      ? procedures
          .flatMap((p) => p.items)
          .filter((i) => i.status === "needs_information")
          .flatMap((i) => i.missingFacts)
      : [];
  // #152: date the candidate items against the engagement period.
  let paperTiming: PaperTiming | undefined;
  if (timing && applicability === "applicable" && timing.dating) {
    const candidates = [
      ...new Map(
        procedures
          .filter((p) => p.status === "candidate")
          .flatMap((p) => p.items)
          .filter((i) => i.status === "candidate")
          .map((i) => [i.code, i]),
      ).values(),
    ];
    if (timing.period) {
      const facts = classificationFactValues(c),
        dated = candidates.map((i) =>
          itemTiming(i, timing.dating!, facts, timing.period!),
        );
      paperTiming = {
        period: timing.period,
        items: dated.map(({ pendingReview: _, ...t }) => t),
        pendingReview: [...new Set(dated.flatMap((t) => t.pendingReview))],
      };
      const periods = dated.map((t) => t.period);
      if (periods.every((x) => x === "readiness")) applicability = "readiness";
      else if (
        periods.every((x) => x === "readiness" || x === "undetermined")
      ) {
        applicability = "pending";
        waitsFor = dated.flatMap((t) => t.missingFacts);
      }
    } else paperTiming = null;
  }
  const missingFacts = [...new Set(waitsFor)].map((f) => factLabel(rules, f));
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
      paperTiming,
    ),
    ...(paperTiming !== undefined ? { timing: paperTiming } : {}),
  };
}

function suggestionRationale(
  applicability: SuggestedApplicability,
  procedures: ProcedureSuggestion[],
  missingFacts: string[],
  basis: PaperSuggestion["basis"],
  timing: PaperTiming | undefined,
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
  if (timing === null)
    lines.push(
      "Timing not considered: the engagement period is not set in the brief.",
    );
  if (timing)
    lines.push(
      "Timing for the period " +
        timing.period.start +
        " to " +
        timing.period.end +
        ": " +
        timing.items
          .map(
            (t) =>
              t.code +
              (t.date
                ? " applies from " +
                  t.date +
                  (t.transition ? " (" + t.transition + " transition)" : "")
                : " applies from a date that depends on the " +
                  t.transition +
                  " transition") +
              ", " +
              periodText[t.period],
          )
          .join("; ") +
        "." +
        (timing.pendingReview.length
          ? " The dates are pending legal review (" +
            timing.pendingReview.join(", ") +
            ")."
          : ""),
    );
  if (missingFacts.length)
    lines.push("Waits for: " + missingFacts.join("; ") + ".");
  if (
    (applicability === "applicable" || applicability === "readiness") &&
    procedures.some((p) => p.status !== "candidate")
  )
    lines.push(
      "Steps of procedures that do not apply are recorded as not performed with the reason.",
    );
  return lines.join("\n");
}
