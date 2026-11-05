// The EU AI Act rule pack of templates/catalog.json (`regulatorySnapshot`,
// schema in schemas/rule-pack.schema.json): its types, the stamps engagements
// and captured records carry, the dating of each obligation against an
// engagement period, and three-valued predicate selection. Pure and without the
// catalog import, so client views can use it with the catalog the workspace
// API sends (lib/rule-pack-current.ts binds the build's own catalog).
import type { Engagement, RulePackStamp } from "./domain";

export type Verification = {
  status: "verified" | "secondary_only";
  verifiedOn: string;
  except?: string;
};
export type LegalReviewFlag = { required: boolean; itemIds: string[] };
export type Approval = {
  status: "pending_legal_review" | "approved";
  reviewer: string | null;
  approvedAt: string | null;
};
export type Predicate = {
  fact: string;
  op: "eq" | "in" | "before" | "onOrAfter";
  value: unknown;
};
/** An inline transitional rule, or a link to the entry that states it. */
export type TransitionalRule = {
  reference: string;
  rule?: string;
  deadline?: string;
  entryId?: string;
  appliesIf?: Predicate[];
  exceptIf?: Predicate[];
  obligationsApplyOnlyIf?: Predicate[];
};
export type ApplicationDate = {
  id: string;
  title: string;
  date: string;
  dateType: "entry_into_force" | "applies_from" | "compliance_deadline";
  provisions: string[];
  scope: string;
  actors: string[];
  summary: string;
  conditions?: string[];
  appliesIf?: Predicate[];
  exceptIf?: Predicate[];
  transitional?: TransitionalRule[];
  legalBasis: {
    reference: string;
    amendedBy: string | null;
    previousValue?: string;
  };
  notes?: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceIds: string[];
  verification: Verification;
  legalReview: LegalReviewFlag;
  approval: Approval;
  history: { rulePackVersion: string; change: string; note: string }[];
};
export type AuthorityDeadline = {
  id: string;
  date: string;
  provision: string;
  actor: string;
  summary: string;
  sourceIds: string[];
  verification: Verification;
};
export type ProhibitedPractice = {
  point: string;
  label: string;
  appliesFrom: string;
  conditions?: string[];
  entryId: string;
  sourceIds: string[];
  verification: Verification;
};
export type SecondaryOnly = {
  status: "secondary_only";
  sourceIds: string[];
};
export type Standard = {
  id: string;
  reference: string;
  /** Our own title of at most 80 characters (D-03). */
  title: string;
  body: string;
  category:
    | "harmonised_standard_cited"
    | "international_standard_not_cited"
    | "draft_not_harmonised";
  label: string;
  cenPublicationDate?: string;
  ojCitation?: {
    decisionNumber: string;
    ojReference: string;
    publicationDate: string;
    eli: string;
    restrictions: string;
  };
  presumptionOfConformity: {
    status: "limited_to_covered_clauses" | "none";
    from?: string;
    clauseScope?: {
      clause: string;
      covers: string[];
      excludes: string[];
      status: "verified" | "secondary_only";
      sourceIds: string[];
      verificationGap: string;
    };
    statutoryBasis?: string;
    applicationNote?: string;
    note?: string;
  };
  isoStatus?: { published: string; edition: number; stage: string };
  europeanAdoption?: { reference: string | null; citedInOJ: false };
  aiActArticleIndicative?: string;
  cen?: {
    status: string;
    currentStageDate: string;
    forecastVotingDate: string;
    note?: string;
  };
  reportedOutcome?: SecondaryOnly & { text: string };
  useInAudits: string;
  sourceIds: string[];
  verification: Verification;
  legalReview: LegalReviewFlag;
};
export type GuidanceDocument = {
  id: string;
  title: string;
  status: string;
  url?: string;
  note?: string;
  platformUse?: string;
  sourceIds: string[];
  verification: Verification;
};
export type LegalReviewItem = {
  id: string;
  topic: string;
  question: string;
  relatedIds: string[];
  status: "pending" | "resolved";
  tracking: string;
};
export type UnverifiedClaim = {
  id: string;
  claim: string;
  status: "secondary_only";
  reason: string;
  sourceIds?: string[];
};
export type Source = {
  id: string;
  title: string;
  publisher: string;
  kind: string;
  canonicalUrl?: string;
  accessUrl?: string;
  sha256?: string;
  retrievedOn: string;
  notes?: string;
};
export type RegulatorySnapshot = {
  rulePackVersion: string;
  jurisdiction: string;
  celex: string;
  consolidatedAsOf: string;
  researchedAsOf: string;
  /** Research older than this many days shows the staleness banner. */
  staleAfterDays: number;
  research: { issue: string; report: string; data: string };
  approval: Approval & { tracking: string; note: string };
  amendingRegulation: string;
  baseAct: { title: string; celex: string; ojReference: string; eli: string };
  amendingActs: {
    number: string;
    shortName: string;
    ojReference: string;
    adopted: string;
    entryIntoForce: string;
    eli: string;
    alsoAmends: string[];
  }[];
  consolidatedTextUrl: string;
  consolidatedTextLegalEffect: string;
  authenticAmendmentUrl: string;
  authenticAmendmentEli: string;
  authenticBaseActEli: string;
  explorerUrl: string;
  timelineUrl: string;
  guidance: string;
  predicateRule: string;
  crossReferenceRule: string;
  applicationDates: ApplicationDate[];
  authorityDeadlines: AuthorityDeadline[];
  prohibitedPractices: ProhibitedPractice[];
  standardsCitationRule: string;
  standards: Standard[];
  guidanceDocuments: GuidanceDocument[];
  legalReviewItems: LegalReviewItem[];
  unverified: UnverifiedClaim[];
  sources: Source[];
};

/**
 * The rule pack of a catalog, or null for a catalog without one (a criteria
 * pack without AI Act content sends an empty snapshot).
 */
export function asRulePack(value: unknown): RegulatorySnapshot | null {
  const s = value as Partial<RegulatorySnapshot> | null | undefined;
  return s &&
    typeof s.rulePackVersion === "string" &&
    Array.isArray(s.applicationDates) &&
    Array.isArray(s.standards) &&
    Array.isArray(s.sources)
    ? (s as RegulatorySnapshot)
    : null;
}

/** The only methodology version that shipped before engagements were stamped. */
export const legacyRulePackVersion = "2026.10.1";

/** The stamp of the rule pack a catalog serves. */
export function rulePackStamp(catalog: {
  methodologyVersion: string;
  regulatorySnapshot: {
    celex: string;
    researchedAsOf: string;
    approval: { status: string };
  };
}): RulePackStamp {
  const s = catalog.regulatorySnapshot;
  return {
    version: catalog.methodologyVersion,
    legalVersion: s.celex,
    researchedAsOf: s.researchedAsOf,
    legalReview: s.approval.status === "approved" ? "approved" : "pending",
  };
}

/**
 * How an engagement relates to the rule pack the build serves: stamped with
 * it, created before stamps (its classification keeps the legal version and
 * research date it was recorded against), or stamped with another revision.
 */
export type EngagementRulePack =
  | { kind: "current"; stamp: RulePackStamp }
  | {
      kind: "legacy";
      recordedLegalVersion: string;
      recordedResearchedAsOf: string;
    }
  | { kind: "other"; stamp: RulePackStamp };
export function engagementRulePack(
  e: Pick<Engagement, "rulePack" | "classification">,
  current: Pick<RulePackStamp, "version">,
): EngagementRulePack {
  if (!e.rulePack)
    return {
      kind: "legacy",
      recordedLegalVersion: e.classification.version,
      recordedResearchedAsOf: e.classification.asOf,
    };
  return e.rulePack.version === current.version
    ? { kind: "current", stamp: e.rulePack }
    : { kind: "other", stamp: e.rulePack };
}

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
/** "2 December 2026": the form legal dates are cited in, whatever the locale. */
export function legalDate(iso: string) {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return d + " " + months[m - 1] + " " + y;
}
/** Today's date (UTC) in YYYY-MM-DD form. */
export function isoToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
/** Whole days from one ISO date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** The staleness banner shows once the research is older than the configured age. */
export function researchAge(
  snapshot: Pick<RegulatorySnapshot, "researchedAsOf" | "staleAfterDays">,
  on: string,
) {
  const days = daysBetween(snapshot.researchedAsOf, on);
  return {
    days,
    maxAgeDays: snapshot.staleAfterDays,
    stale: days > snapshot.staleAfterDays,
  };
}

/** Whether a dated entry applies (or has fallen due) on a day. */
export function inApplicationOn(entry: { date: string }, day: string) {
  return entry.date <= day;
}

export type EngagementPeriod = { start: string; end: string };
/** The engagement's assessment period from its brief, when both ends are set. */
export function engagementPeriod(
  e: Pick<Engagement, "workflow">,
): EngagementPeriod | null {
  const start = e.workflow?.brief?.periodStart,
    end = e.workflow?.brief?.periodEnd;
  return isIsoDate(start) && isIsoDate(end) && start <= end
    ? { start, end }
    : null;
}
/**
 * Where the engagement period falls against an application date: wholly
 * before it (readiness), on or after it (applicable), or across it.
 */
export type PeriodStatus =
  "readiness" | "applicable" | "starts_in_period" | "period_not_set";
export function periodStatus(
  date: string,
  period: EngagementPeriod | null,
): PeriodStatus {
  if (!period) return "period_not_set";
  if (period.end < date) return "readiness";
  if (period.start >= date) return "applicable";
  return "starts_in_period";
}

/**
 * Facts the date predicates can read from an engagement today. Until
 * classification records them (#19), only highRiskRoute is known, mapped from
 * the reviewed classification route (RD-27); every other fact is unknown.
 */
export const annexRouteFacts: Readonly<Record<string, string>> = {
  "Annex III — sensitive use case": "annex_iii",
  "Annex I Section A — regulated product": "annex_i_section_a",
  "Annex I Section B — sector-specific review": "annex_i_section_b",
  "Article 50 only": "not_high_risk",
  "Outside high-risk scope": "not_high_risk",
};
export type Facts = Readonly<Record<string, unknown>>;
export function engagementFacts(e: Pick<Engagement, "classification">): Facts {
  const route = Object.hasOwn(annexRouteFacts, e.classification.annexRoute)
    ? annexRouteFacts[e.classification.annexRoute]
    : undefined;
  return route ? { highRiskRoute: route } : {};
}

type Truth = boolean | "unknown";
function truth(p: Predicate, facts: Facts): Truth {
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
/**
 * Candidate selection (predicateRule): a candidate needs appliesIf true and
 * exceptIf false; any unknown yields needs_information. Selection never
 * approves applicability, which stays a reviewed human decision.
 */
export type Selection = "candidate" | "not_selected" | "needs_information";
export function select(
  rule: Pick<TransitionalRule, "appliesIf" | "exceptIf">,
  facts: Facts,
): { selection: Selection; missingFacts: string[] } {
  const applies = conjunction(rule.appliesIf, facts, true),
    excepted = conjunction(rule.exceptIf, facts, false);
  if (applies === false || excepted === true)
    return { selection: "not_selected", missingFacts: [] };
  if (applies === true && excepted === false)
    return { selection: "candidate", missingFacts: [] };
  const missing = [...(rule.appliesIf ?? []), ...(rule.exceptIf ?? [])]
    .filter((p) => truth(p, facts) === "unknown")
    .map((p) => p.fact);
  return {
    selection: "needs_information",
    missingFacts: [...new Set(missing)],
  };
}

export type ObligationLink = {
  reference: string;
  entryId: string;
  date: string | null;
  title: string;
  /** A Commission, Member State or notified-body deadline. */
  authority: boolean;
};
export type ObligationRow = {
  entry: ApplicationDate;
  period: PeriodStatus;
  /** null when the entry has no predicates and so selects every system. */
  selection: Selection | null;
  missingFacts: string[];
  /** Transitional records that restate another entry, shown as links. */
  links: ObligationLink[];
  /** Transitional rules stated here, with their own selection. */
  rules: (TransitionalRule & {
    selection: Selection | null;
    missingFacts: string[];
  })[];
  /** The Art 5(1) practices this entry dates. */
  practices: ProhibitedPractice[];
  /** Legal-review items still open for this entry. */
  pendingReview: string[];
};
/**
 * The "Obligations by date" view: each operator-facing application date with
 * where the engagement period falls against it and, where the entry has
 * predicates, whether the recorded facts select it. Authority deadlines are
 * listed separately; a cross-referenced rule appears once, under its entry.
 */
export function obligationsByDate(
  pack: RegulatorySnapshot,
  e: Pick<Engagement, "classification" | "workflow">,
): { date: string; rows: ObligationRow[] }[] {
  const facts = engagementFacts(e),
    period = engagementPeriod(e),
    open = new Set(
      pack.legalReviewItems
        .filter((i) => i.status !== "resolved")
        .map((i) => i.id),
    ),
    entries = new Map(pack.applicationDates.map((x) => [x.id, x])),
    authorities = new Map(pack.authorityDeadlines.map((x) => [x.id, x]));
  const rows = pack.applicationDates.map((entry): ObligationRow => {
    const predicates = !!(entry.appliesIf?.length || entry.exceptIf?.length),
      chosen = predicates ? select(entry, facts) : null;
    return {
      entry,
      period: periodStatus(entry.date, period),
      selection: chosen?.selection ?? null,
      missingFacts: chosen?.missingFacts ?? [],
      links: (entry.transitional ?? [])
        .filter((t) => t.entryId)
        .map((t) => {
          const target = entries.get(t.entryId!),
            authority = authorities.get(t.entryId!);
          return {
            reference: t.reference,
            entryId: t.entryId!,
            date: target?.date ?? authority?.date ?? null,
            title: target?.title ?? authority?.provision ?? t.entryId!,
            authority: !target && !!authority,
          };
        }),
      rules: (entry.transitional ?? [])
        .filter((t) => !t.entryId)
        .map((t) => {
          const ruled = t.appliesIf?.length || t.exceptIf?.length;
          const s = ruled ? select(t, facts) : null;
          return {
            ...t,
            selection: s?.selection ?? null,
            missingFacts: s?.missingFacts ?? [],
          };
        }),
      practices: pack.prohibitedPractices.filter((p) => p.entryId === entry.id),
      pendingReview: entry.legalReview.itemIds.filter((id) => open.has(id)),
    };
  });
  const byDate = new Map<string, ObligationRow[]>();
  for (const row of [...rows].sort((a, b) =>
    a.entry.date.localeCompare(b.entry.date),
  ))
    byDate.set(row.entry.date, [...(byDate.get(row.entry.date) ?? []), row]);
  return [...byDate].map(([date, rows]) => ({ date, rows }));
}

/**
 * The pack's milestones from a day on, nearest first, each entry with the
 * legal-review items still open for it.
 */
export function upcomingDates(pack: RegulatorySnapshot, day: string) {
  const open = new Set(
    pack.legalReviewItems
      .filter((i) => i.status !== "resolved")
      .map((i) => i.id),
  );
  return [...new Set(pack.applicationDates.map((e) => e.date))]
    .filter((date) => date >= day)
    .sort()
    .map((date) => ({
      date,
      entries: pack.applicationDates
        .filter((e) => e.date === date)
        .map((e) => ({
          title: e.title,
          pendingReview: e.legalReview.itemIds.filter((id) => open.has(id)),
        })),
    }));
}
