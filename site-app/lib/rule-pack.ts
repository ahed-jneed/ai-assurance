// The EU AI Act rule pack of templates/catalog.json (`regulatorySnapshot`,
// schema in schemas/rule-pack.schema.json): its types, the stamps engagements
// and captured records carry, the dating of each obligation against an
// engagement period, and three-valued predicate selection. Pure and without the
// catalog import, so client views can use it with the catalog the workspace
// API sends (lib/rule-pack-current.ts binds the build's own catalog).
import type { Engagement, RulePackStamp } from "./domain";
import { classificationFactValues } from "./domain/classification";
import {
  select,
  type Facts,
  type Predicate,
  type Selection,
} from "./predicates";
export { annexRouteFacts } from "./domain/classification";
export {
  conjunction,
  select,
  type Facts,
  type Predicate,
  type Selection,
} from "./predicates";

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
export type PointCondition = { point: string; condition: string };
/**
 * The Art 4a conditions for special-category data in bias detection: a
 * structured paraphrase of the OJ text, rendered under its entry (entryId).
 */
export type SpecialCategoryData = {
  provision: string;
  insertedBy: string;
  replaces: string;
  inForceFrom: string;
  entryId: string;
  paragraph1: {
    who: string;
    purpose: string;
    threshold: string;
    allConditionsRequired: PointCondition[];
  };
  paragraph2: {
    who: string;
    conditions: PointCondition[];
    noObligation: string;
  };
  relatedProvisions: string[];
  sourceIds: string[];
  verification: {
    status: Verification["status"];
    verifiedOn: string;
    method?: string;
  };
  legalReview: LegalReviewFlag;
};
/** A provision Regulation (EU) 2026/1744 changed (or left unchanged), with its effect. */
export type ProvisionReference = {
  provision: string;
  change: string;
  amendingProvision: string | null;
  appliesFrom?: string;
  effect?: string;
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
  draftPublished?: string;
  listedDate?: string;
  /** The document reference, for example "C(2026) 7702 final". */
  reference?: string;
  legalEffect?: string;
  /** The document's dated history, oldest first. */
  dates?: { event: string; date: string }[];
  /** The research entry a revised entry reproduces (research.revisions). */
  researchRef?: string;
  url?: string;
  note?: string;
  platformUse?: string;
  sourceIds: string[];
  verification: Verification;
};
/** A later revision of the pack from further verified research. */
export type ResearchRevision = {
  rulePackVersion: string;
  issue: string;
  report: string;
  data: string;
  edits: string[];
  amendments: { edit: string; target: string; fields: string[] }[];
  resolvesUnverified: string[];
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
  research: {
    issue: string;
    report: string;
    data: string;
    revisions?: ResearchRevision[];
  };
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
  specialCategoryData?: SpecialCategoryData;
  provisionReferences?: ProvisionReference[];
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

/** "2026.11.2" → a key that sorts revisions numerically. */
const versionKey = (v: string) =>
  v
    .split(".")
    .map((n) => n.padStart(6, "0"))
    .join(".");
/**
 * The revisions of the pack made after a stamped version: what changed since
 * an engagement was stamped. An unstamped or later stamp gets none.
 */
export function laterRevisions(
  pack: Pick<RegulatorySnapshot, "research">,
  stampVersion: string,
): ResearchRevision[] {
  return (pack.research.revisions ?? []).filter(
    (r) => versionKey(r.rulePackVersion) > versionKey(stampVersion),
  );
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
 * Facts the date predicates can read from an engagement: the classification's
 * answered tri-state facts, the derived facts and highRiskRoute, from the
 * reviewed route and the Art 6(3) derogation (#19). An unknown fact is absent.
 */
export function engagementFacts(e: Pick<Engagement, "classification">): Facts {
  return classificationFactValues(e.classification);
}

/**
 * The legal-review items of a flag that are still open: a resolved item no
 * longer reads "Pending legal review".
 */
export function openReviewItems(
  pack: Pick<RegulatorySnapshot, "legalReviewItems">,
  review: LegalReviewFlag,
) {
  const resolved = new Set(
    pack.legalReviewItems
      .filter((i) => i.status === "resolved")
      .map((i) => i.id),
  );
  return review.itemIds.filter((id) => !resolved.has(id));
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
  /** The Art 4a conditions, under the entry they belong to. */
  specialCategoryData: SpecialCategoryData | null;
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
      specialCategoryData:
        pack.specialCategoryData?.entryId === entry.id
          ? pack.specialCategoryData
          : null,
      pendingReview: openReviewItems(pack, entry.legalReview),
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
  return [...new Set(pack.applicationDates.map((e) => e.date))]
    .filter((date) => date >= day)
    .sort()
    .map((date) => ({
      date,
      entries: pack.applicationDates
        .filter((e) => e.date === date)
        .map((e) => ({
          title: e.title,
          pendingReview: openReviewItems(pack, e.legalReview),
        })),
    }));
}
