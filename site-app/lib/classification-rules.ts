// The data the guided classification is evaluated with (#19): the Art 5
// practices and guidance register of a rule pack (templates/catalog.json
// regulatorySnapshot), and the Art 50 items, trigger profiles and fact
// derivations of docs/obligation-subitems.json (its generated copy). Client
// views pass the catalog the workspace API sends; the server passes its own.
import type {
  ClassificationRules,
  ObligationRule,
  TriggerProfile,
} from "./domain/classification";
import obligations from "./obligation-subitems.json";
import { openReviewItems, type RegulatorySnapshot } from "./rule-pack";

/**
 * Guidance versions the Art 50 facts were researched against
 * (docs/research/art50-transparency-2026-11.json, GUID-A50-GUIDELINES and
 * GUID-A50-COP; A50-ED-05). The rule pack lists the guidelines as published
 * on 20 July 2026; the research records their formal adoption.
 */
const art50Guidance = [
  {
    id: "GUID-ART50-TRANSPARENCY",
    title: "Commission guidelines on the Art 50 transparency obligations",
    status: "adopted (non-binding)",
    reference: "C(2026) 7702 final",
    date: "2026-11-05",
  },
  {
    id: "GUID-ART50-COP",
    title: "Code of Practice on Transparency of AI-Generated Content",
    status: "published (voluntary; no presumption of conformity)",
    reference: "Final code of 10 June 2026",
    date: "2026-06-10",
  },
];

/** The Art 50 items of the obligation catalogue. */
export const art50Items: ObligationRule[] = (
  obligations.items as unknown as ObligationRule[]
).filter((i) => i.article.startsWith("50"));
export const triggerProfiles = obligations.triggerProfiles as Record<
  string,
  TriggerProfile
>;

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
  const guidance = (id: string) => {
    const g = pack.guidanceDocuments.find((x) => x.id === id) as
      | (RegulatorySnapshot["guidanceDocuments"][number] & {
          draftPublished?: string;
          listedDate?: string;
        })
      | undefined;
    return g
      ? [
          {
            id: g.id,
            title: g.title,
            status: g.status,
            reference: g.draftPublished
              ? "Draft of " + g.draftPublished
              : g.title,
            ...(g.draftPublished || g.listedDate
              ? { date: g.draftPublished ?? g.listedDate }
              : {}),
          },
        ]
      : [];
  };
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
    guidance: [
      ...guidance("GUID-ART6-HIGH-RISK-CLASSIFICATION"),
      ...guidance("GUID-PROHIBITED-PRACTICES"),
      ...art50Guidance,
    ],
  };
}
