// The data the guided classification is evaluated with (#19): the Art 5
// practices and guidance register of a rule pack (templates/catalog.json
// regulatorySnapshot), and the Art 50 items, trigger profiles and fact
// derivations of docs/obligation-subitems.json (its generated copy). Client
// views pass the catalog the workspace API sends; the server passes its own.
import type {
  ClassificationRules,
  GuidanceCitation,
  ObligationRule,
  TriggerProfile,
} from "./domain/classification";
import obligations from "./obligation-subitems.json";
import { openReviewItems, type RegulatorySnapshot } from "./rule-pack";

/** The Art 50 items of the obligation catalogue. */
export const art50Items: ObligationRule[] = (
  obligations.items as unknown as ObligationRule[]
).filter((i) => i.article.startsWith("50"));
/** The obligation items of the catalogue, as the trigger evaluator reads them. */
export const obligationItems =
  obligations.items as unknown as readonly ObligationRule[];
export const triggerProfiles = obligations.triggerProfiles as Record<
  string,
  TriggerProfile
>;

/**
 * The guidance a classification cites, from the pack's guidance register.
 * Entries revised from later research (the Art 50 guidelines and Code since
 * rule pack 2026.11.2, A50-ED-05, A50-ED-10) carry their own reference and
 * dated history; older entries a draft or listing date.
 */
function guidanceCitation(
  pack: Pick<RegulatorySnapshot, "guidanceDocuments">,
  id: string,
): GuidanceCitation[] {
  const g = pack.guidanceDocuments.find((x) => x.id === id);
  if (!g) return [];
  const date = g.dates?.at(-1)?.date ?? g.draftPublished ?? g.listedDate;
  return [
    {
      id: g.id,
      title: g.title,
      status: g.status,
      reference:
        g.reference ??
        (g.draftPublished ? "Draft for consultation" : "Commission guidance"),
      ...(date ? { date } : {}),
      ...(g.legalEffect ? { legalEffect: g.legalEffect } : {}),
    },
  ];
}

/** The guidance register entries a classification cites, in order. */
export const citedGuidanceIds = [
  "GUID-ART6-HIGH-RISK-CLASSIFICATION",
  "GUID-PROHIBITED-PRACTICES",
  "GUID-ART50-TRANSPARENCY",
  "GUID-ART50-COP",
] as const;

/**
 * The rules of a rule pack. Criteria without an EU AI Act rule pack have no
 * Art 5 practices or guidance; the Art 50 items still apply.
 */
export function classificationRules(
  pack: Pick<
    RegulatorySnapshot,
    | "rulePackVersion"
    | "celex"
    | "prohibitedPractices"
    | "applicationDates"
    | "guidanceDocuments"
    | "legalReviewItems"
  > | null,
): ClassificationRules {
  if (!pack)
    return {
      rulePackVersion: "",
      legalVersion: "",
      practices: [],
      art50Items,
      profiles: triggerProfiles,
      guidance: [],
    };
  const entries = new Map(pack.applicationDates.map((e) => [e.id, e]));
  return {
    rulePackVersion: pack.rulePackVersion,
    legalVersion: pack.celex,
    practices: pack.prohibitedPractices.map((p) => {
      const entry = entries.get(p.entryId);
      return {
        point: p.point,
        label: p.label,
        appliesFrom: p.appliesFrom,
        pendingReview: entry ? openReviewItems(pack, entry.legalReview) : [],
      };
    }),
    art50Items,
    profiles: triggerProfiles,
    guidance: citedGuidanceIds.flatMap((id) => guidanceCitation(pack, id)),
  };
}
