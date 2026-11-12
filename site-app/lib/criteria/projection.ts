// The pure projections of criteria documents (docs/design/criteria-model.md
// sections 7 and 11.3): what a pack switches on, its items and links, and the
// catalogue and obligation shapes the existing code reads. No bundle import,
// so factories, the workflow seed and tests can use it without the loader.
import type { RulePackStamp } from "../domain";
import { rulePackStamp } from "../rule-pack";
import type {
  CatalogItem,
  CriteriaPin,
  FrameworkDocument,
  IndexEntry,
  Link,
  PackDocument,
  PackFeatures,
  PackItem,
} from "./types";

const LEGISLATION = new Set(["legislation", "implementing_act", "local_law"]);

/** Compares two YEAR.MONTH.SEQUENCE versions numerically, part by part. */
export function compareVersions(a: string, b: string) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The pack's switches for AI Act behaviour (design section 7.1); absent = off. */
export function features(pack: PackDocument): PackFeatures {
  return {
    annexIvIndex: pack.features?.annexIvIndex === true,
    aiActClassification: pack.features?.aiActClassification === true,
    obligationAssessments: pack.features?.obligationAssessments === true,
  };
}
export const item = (
  pack: PackDocument,
  templateId: string,
): PackItem | undefined => pack.items.find((i) => i.id === templateId);

/** The pinned pack and the framework documents of its criteria sets. */
export type Resolved = {
  pin: CriteriaPin;
  entry: IndexEntry;
  pack: PackDocument;
  frameworks: FrameworkDocument[];
  frameworkEntries: IndexEntry[];
};
/** The catalogue shape of templates/catalog.json a pack projects to (section 11.3). */
export type Catalog = {
  schemaVersion: string;
  methodologyVersion: string;
  regulatorySnapshot: Record<string, unknown>;
  defaults: Record<string, unknown>;
  items: CatalogItem[];
};
export function legacyCatalog(pack: PackDocument): Catalog {
  return {
    schemaVersion: pack.compat?.catalog?.schemaVersion ?? "1.0.0",
    methodologyVersion: pack.methodologyVersion,
    regulatorySnapshot: pack.compat?.catalog?.regulatorySnapshot ?? {},
    defaults: pack.defaults,
    items: pack.items.map(
      ({ objectiveIds, phase, derivedFrom, ...item }) => item,
    ),
  };
}
/** One item of the obligation catalogue, with the node's extensions. */
export type ObligationItem = {
  code: string;
  article: string;
  title: string;
  actor: string[];
  trigger: unknown;
  evidenceCategories: string[];
  reviewNote?: string;
  /** The consolidated version the item reads (extensions.version). */
  version?: string;
  legalReview?: { required: boolean; itemIds: string[] };
} & Record<string, unknown>;
/** The docs/obligation-subitems.json shape; the fields the app reads are typed. */
export type ObligationCatalog = Record<string, unknown> & {
  catalogVersion: string;
  scope: string;
  source: { url: string; version: string } & Record<string, unknown>;
  decisionPolicy: { providerResponsibility: string } & Record<string, unknown>;
  items: ObligationItem[];
};
/** The obligation catalogue (docs/obligation-subitems.json shape) of a framework. */
export function obligationCatalog(
  framework: FrameworkDocument,
): ObligationCatalog | null {
  const compat = framework.compat?.obligations;
  if (!compat) return null;
  const { order, ...fields } = compat;
  const nodes = new Map(framework.requirements.map((n) => [n.id, n]));
  return {
    ...fields,
    triggerProfiles: framework.triggerProfiles,
    factTypes: framework.factTypes,
    items: order.map((code) => {
      const n = nodes.get(code)!;
      return {
        code: n.id,
        article: n.ref.startsWith("Art. ") ? n.ref.slice(5) : n.ref,
        title: n.title,
        actor: n.actors,
        trigger: n.trigger,
        evidenceCategories: n.evidenceCategories,
        ...(n.reviewNote !== undefined ? { reviewNote: n.reviewNote } : {}),
        ...n.extensions,
      } as ObligationItem;
    }),
  } as unknown as ObligationCatalog;
}

/** The requirement links of an item, through its control objectives (section 7). */
export function criteriaFor(
  pack: PackDocument,
  templateId: string,
): (Link & { objectiveId: string })[] {
  const it = item(pack, templateId);
  if (!it) return [];
  return it.objectiveIds.flatMap((objectiveId) =>
    (
      pack.controlObjectives.find((o) => o.id === objectiveId)?.addresses ?? []
    ).map((link) => ({ ...link, objectiveId })),
  );
}
/**
 * An item's display references: its catalogue refs or, without them, its
 * linked requirements as "<framework shortTitle> <ref>" (section 7).
 */
export function displayRefs(
  resolved: Pick<Resolved, "pack" | "frameworks">,
  it: PackItem,
) {
  if (it.regulatoryRefs.length) return [...it.regulatoryRefs];
  return criteriaFor(resolved.pack, it.id).map((link) => {
    const [framework, requirement] = link.requirement.split(":");
    const fw = resolved.frameworks.find((f) => f.id === framework);
    const node = fw?.requirements.find((n) => n.id === requirement);
    return `${fw?.shortTitle ?? framework} ${node?.ref ?? requirement}`;
  });
}

/** Whether a framework is legislation (it records a qualified legal review). */
export const legislation = (frameworkDoc: FrameworkDocument) =>
  LEGISLATION.has(frameworkDoc.kind);
/** Whether a framework is legislation with its qualified legal review pending. */
export const legalReviewPending = (
  frameworkDoc: FrameworkDocument,
  e: IndexEntry | undefined,
) => legislation(frameworkDoc) && e?.legalReview !== "completed";

/** The pack's AI Act framework, when it has an eu-ai-act criteria set. */
export const aiActFramework = (resolved: Pick<Resolved, "frameworks">) =>
  resolved.frameworks.find((f) => f.id === "eu-ai-act");

/**
 * The rule-pack stamp (#18) of a pack: only a pack with an AI Act criteria
 * set and the catalogue's rule pack has one.
 */
export function packRulePack(
  resolved: Pick<Resolved, "frameworks" | "pack">,
): RulePackStamp | undefined {
  const snapshot = resolved.pack.compat?.catalog?.regulatorySnapshot as
    Parameters<typeof rulePackStamp>[0]["regulatorySnapshot"] | undefined;
  if (!aiActFramework(resolved) || !snapshot?.celex) return undefined;
  return rulePackStamp({
    methodologyVersion: resolved.pack.methodologyVersion,
    regulatorySnapshot: snapshot,
  });
}
