// Engagement-level criteria: the pack an engagement is pinned to, what that
// pack switches on, and the projections the commands and read models use
// (docs/design/criteria-model.md sections 7, 10 and 11.4). Server-only.
import type { Engagement, RulePackStamp } from "../domain";
import type { CriteriaLookup } from "../domain/report-gates";
import { ApiError } from "../http";
import {
  aiActFramework,
  criteriaFor,
  features,
  legacyCatalog,
  legalReviewPending,
  legislation,
  obligationCatalog,
  packRulePack,
  type Resolved,
} from "./projection";
import {
  currentVersion,
  defaultPin,
  entryOf,
  frameworkEntry,
  legacyPin,
  packDocument,
  pinFor,
  pinOf,
  registry,
  resolve,
  selectable,
  type Registry,
} from "./registry";
import type {
  AnnexIvMap,
  CriteriaStamp,
  CriteriaView,
  CriterionOption,
  EngagementCriteria,
  FrameworkDocument,
  ObligationOptions,
  PackDocument,
  PackFeatures,
  PackRoles,
} from "./types";
import { pinCrosswalks } from "./views";

let active: Registry | undefined;
/** The registry the server uses: the generated bundle, or one a test injected. */
export const criteriaRegistry = () => (active ??= registry());
/** Injects a registry (tests only). Returns a function that restores the previous one. */
export function injectRegistry(r: Registry) {
  const previous = active;
  active = r;
  return () => {
    active = previous;
  };
}

/** The resolved pack of an engagement: its pin, or the legacy pin (M0). */
export function pinned(e: Pick<Engagement, "criteria" | "rulePack">): Resolved {
  const r = criteriaRegistry();
  return resolve(r, pinOf(r, e));
}
export const pinnedPack = (e: Pick<Engagement, "criteria" | "rulePack">) =>
  pinned(e).pack;
export const packFeatures = (
  e: Pick<Engagement, "criteria" | "rulePack">,
): PackFeatures => features(pinnedPack(e));

/**
 * The pack a new engagement is pinned to: index.defaults.pack, or the
 * current version of the chosen pack id, optionally an exact version; 400
 * "Choose a released criteria pack" unless it is released, selectable, not
 * withdrawn and backed by confirmed licences.
 */
export function resolveNew(packId?: string, packVersion?: string) {
  const r = criteriaRegistry();
  return resolve(r, defaultPin(r, packId, packVersion));
}
/**
 * The pack of a follow-up engagement: the predecessor's pack id at its
 * current version (design section 10), 409 when no version can be pinned.
 */
export function resolveFollowup(e: Pick<Engagement, "criteria" | "rulePack">) {
  const r = criteriaRegistry();
  const packId = pinOf(r, e).packId;
  const current = currentVersion(r, "pack", packId);
  if (!current || !selectable(r, packId, current.version))
    throw new ApiError(
      409,
      "Choose a criteria pack for the follow-up engagement",
    );
  return resolve(r, pinFor(r, packId, current.version));
}

/**
 * What a captured record states about the rules it was made under: the
 * pinned pack's methodology version and, for a pack with an AI Act criteria
 * set, its rule-pack stamp (#18).
 */
export function recordVersions(e: Pick<Engagement, "criteria" | "rulePack">): {
  rulePack?: RulePackStamp;
  methodologyVersion: string;
} {
  const resolved = pinned(e);
  const rulePack = packRulePack(resolved);
  return {
    ...(rulePack ? { rulePack } : {}),
    methodologyVersion: resolved.pack.methodologyVersion,
  };
}

/** Whether a legislation framework of the pin has its legal review pending. */
export function pinLegalReviewPending(resolved: Resolved) {
  return resolved.frameworks.some((f, i) =>
    legalReviewPending(f, resolved.frameworkEntries[i]),
  );
}
/**
 * The report snapshot stamp of the pin (design sections 6.7 and 10): the
 * pack, each framework data version of its criteria sets and each crosswalk
 * version its coverage views use at capture, with their digests, so that a
 * later release of any of them never alters what an issued report states.
 */
export function criteriaStamp(
  e: Pick<Engagement, "criteria" | "rulePack">,
): CriteriaStamp {
  const r = criteriaRegistry();
  const resolved = pinned(e);
  return {
    packId: resolved.pin.packId,
    packVersion: resolved.pin.packVersion,
    packSha256: resolved.pin.packSha256,
    legalReviewPending: pinLegalReviewPending(resolved),
    frameworks: resolved.frameworks.map((fw, i) => {
      const entry = resolved.frameworkEntries[i];
      return {
        id: fw.id,
        edition: fw.edition,
        version: fw.version,
        sha256: entry.sha256 ?? "",
        role: resolved.pack.criteria[i].role,
        legalReview: !legislation(fw)
          ? ("not_required" as const)
          : entry.legalReview === "completed"
            ? ("completed" as const)
            : ("pending" as const),
      };
    }),
    crosswalks: pinCrosswalks(r, resolved).map((c) => ({
      id: c.id,
      version: c.version,
      sha256: entryOf(r, "crosswalk", c.id, c.version)?.sha256 ?? "",
      source: c.source.framework + "@" + c.source.edition,
      target: c.target.framework + "@" + c.target.edition,
    })),
  };
}

/**
 * The Annex IV map of a pin with features.annexIvIndex: the pack's own map
 * or, for a version released before phase 2 embedded one (pack #1
 * 2026.11.2), the map of the current version of the same pack id, which is
 * what the build served it until then (schemas/validate-criteria.mjs
 * `servedAnnexMap`, rule 8). 500 when there is none, which rule 8 prevents.
 */
export function annexIvMapOf(resolved: Resolved): AnnexIvMap {
  if (resolved.pack.annexIvMap) return resolved.pack.annexIvMap;
  const r = criteriaRegistry();
  const current = currentVersion(r, "pack", resolved.pack.id);
  const map =
    current && packDocument(r, resolved.pack.id, current.version)?.annexIvMap;
  if (!map)
    throw new ApiError(
      500,
      `The criteria pack ${resolved.pack.id} ${resolved.pack.version} has no Annex IV map in this build`,
    );
  return map;
}

/**
 * The obligation subitems of the pinned AI Act framework (its
 * compat.obligations, design section 7.1, phase 2), or null on a pack
 * without obligation assessments.
 */
export function pinnedObligations(
  e: Pick<Engagement, "criteria" | "rulePack">,
) {
  const resolved = pinned(e);
  const fw = aiActFramework(resolved);
  return features(resolved.pack).obligationAssessments && fw
    ? obligationCatalog(fw)
    : null;
}

/** The template a platform feature instantiates, or 409 when the pack defines none. */
export function roleTemplate(
  pack: PackDocument,
  role: keyof PackRoles,
  article?: string,
): string {
  const value = pack.roles?.[role];
  const templateId =
    typeof value === "string"
      ? value
      : value
        ? (value[article ?? "*"] ?? value["*"])
        : undefined;
  if (!templateId)
    throw new ApiError(
      409,
      `This criteria pack defines no template for ${role}`,
    );
  return templateId;
}

/** 409 unless the pinned pack switches the feature on. */
export function requireFeature(
  e: Pick<Engagement, "criteria" | "rulePack">,
  feature: keyof PackFeatures,
) {
  if (packFeatures(e)[feature]) return;
  throw new ApiError(
    409,
    feature === "aiActClassification"
      ? "This criteria pack has no AI Act classification"
      : feature === "obligationAssessments"
        ? "This criteria pack has no AI Act obligation assessments"
        : "This criteria pack has no Annex IV index",
  );
}

/** What GET /api/workspace tells the client about the pin (section 10). */
export function criteriaView(e: Engagement, internal = true): CriteriaView {
  const r = criteriaRegistry();
  const resolved = pinned(e);
  const { pack } = resolved;
  const f = features(pack);
  return {
    pin: resolved.pin,
    origin: e.criteria?.origin ?? "legacy",
    title: pack.title,
    kind: pack.kind,
    methodologyVersion: pack.methodologyVersion,
    features: f,
    frameworks: resolved.frameworks.map((fw, i) => ({
      id: fw.id,
      edition: fw.edition,
      version: fw.version,
      shortTitle: fw.shortTitle,
      role: pack.criteria[i].role,
      kind: fw.kind,
      legalReviewPending: legalReviewPending(fw, resolved.frameworkEntries[i]),
      textPolicy: fw.licence.textPolicy,
    })),
    withdrawn:
      resolved.entry.status === "withdrawn" ||
      resolved.frameworks.some(
        (fw) => frameworkEntry(r, fw)?.status === "withdrawn",
      ),
    ...(f.obligationAssessments || !internal
      ? {}
      : {
          requirements: criterionOptions(resolved, ["requirement"]),
        }),
    ...(internal
      ? {
          findingCriteria: criterionOptions(resolved, [
            "group",
            "requirement",
          ]).map((o) => ({ ...o, article: findingArticle(resolved, o) })),
        }
      : {}),
    ...(internal && f.obligationAssessments
      ? { obligations: obligationOptions(resolved) }
      : {}),
  };
}

/**
 * The nodes of the pack's criteria sets in scope (`include` and its
 * descendants) of the given types, as requirement references.
 */
function criterionOptions(
  resolved: Resolved,
  types: FrameworkDocument["requirements"][number]["type"][],
): CriterionOption[] {
  return resolved.frameworks.flatMap((fw, i) => {
    const include = resolved.pack.criteria[i].include;
    const nodes = new Map(fw.requirements.map((n) => [n.id, n]));
    const inScope = (id: string): boolean => {
      if (!include) return true;
      for (
        let n = nodes.get(id);
        n;
        n = n.parent ? nodes.get(n.parent) : undefined
      )
        if (include.includes(n.id)) return true;
      return false;
    };
    return fw.requirements
      .filter((n) => types.includes(n.type) && !n.deprecated && inScope(n.id))
      .map((n) => ({
        reference: fw.id + ":" + n.id,
        citation: fw.shortTitle + " " + n.ref,
        title: n.title ?? "",
      }));
  });
}

/**
 * The `article` text of a finding on a criterion: the AI Act article or annex
 * point without "Art. " (as findings record it today), otherwise the citation.
 */
function findingArticle(resolved: Resolved, o: CriterionOption) {
  const [framework, id] = o.reference.split(":");
  if (framework !== "eu-ai-act") return o.citation;
  const ref = aiActFramework(resolved)?.requirements.find(
    (n) => n.id === id,
  )?.ref;
  return ref ? (ref.startsWith("Art. ") ? ref.slice(5) : ref) : o.citation;
}

/** The workbench's obligation options: the pinned framework's subitems. */
function obligationOptions(resolved: Resolved): ObligationOptions | undefined {
  const fw = aiActFramework(resolved);
  const c = fw && obligationCatalog(fw);
  if (!c) return undefined;
  return {
    scope: c.scope,
    providerResponsibility: c.decisionPolicy.providerResponsibility,
    source: { url: c.source.url, version: c.source.version },
    catalogVersion: c.catalogVersion,
    items: c.items.map((o) => ({
      code: o.code,
      article: o.article,
      title: o.title,
      actor: o.actor,
      evidenceCategories: o.evidenceCategories,
      ...(o.reviewNote !== undefined ? { reviewNote: o.reviewNote } : {}),
      ...(o.legalReview ? { legalReview: o.legalReview } : {}),
    })),
  };
}

/**
 * Validates finding criteria references against the pin: each must be a
 * group or requirement node of one of the pack's criteria sets in scope
 * (400 otherwise). Returns them without duplicates.
 */
export function findingCriteriaRefs(
  e: Pick<Engagement, "criteria" | "rulePack">,
  refs: readonly string[],
): string[] {
  const allowed = new Set(
    criterionOptions(pinned(e), ["group", "requirement"]).map(
      (o) => o.reference,
    ),
  );
  for (const ref of refs)
    if (!allowed.has(ref))
      throw new ApiError(
        400,
        `${ref} is not a criterion of this engagement's criteria pack`,
      );
  return [...new Set(refs)];
}

/**
 * The criteria a finding raised from a procedure defaults to (design
 * section 7, phase 2): the requirements the item of `templateId` links
 * through its control objectives, in the pack's criteria sets.
 */
export function defaultFindingCriteria(
  e: Pick<Engagement, "criteria" | "rulePack">,
  templateId: string,
): string[] {
  const resolved = pinned(e);
  const frameworks = new Set(resolved.pack.criteria.map((s) => s.framework));
  return [
    ...new Set(
      criteriaFor(resolved.pack, templateId)
        .filter(
          (l) =>
            l.relationship !== "no_relationship" &&
            frameworks.has(l.requirement.split(":")[0]),
        )
        .map((l) => l.requirement),
    ),
  ];
}

/** The pinned criteria as the report's criterion roll-up reads them. */
export function criteriaLookup(
  e: Pick<Engagement, "criteria" | "rulePack">,
): CriteriaLookup {
  const resolved = pinned(e);
  const nodes = new Map(
    resolved.frameworks.map((fw) => [
      fw.id,
      new Map(fw.requirements.map((n) => [n.id, n])),
    ]),
  );
  return {
    refsOf: (templateId) =>
      criteriaFor(resolved.pack, templateId).map((l) => l.requirement),
    ancestorsOf(reference) {
      const [framework, id] = reference.split(":");
      const byId = nodes.get(framework);
      const out: string[] = [];
      for (
        let n = byId?.get(id);
        n && out.length < 50;
        n = n.parent ? byId!.get(n.parent) : undefined
      )
        out.push(framework + ":" + n.id);
      return out.length ? out : [reference];
    },
    citation: (reference) => criterionCitation(resolved, reference),
  };
}

/**
 * The display citation of a requirement reference under the pin, such as
 * "EU AI Act (amended) Art. 9"; the reference itself when it does not
 * resolve.
 */
export function criterionCitation(
  resolved: Pick<Resolved, "frameworks">,
  reference: string,
) {
  const [framework, id] = reference.split(":");
  const fw = resolved.frameworks.find((f) => f.id === framework);
  const node = fw?.requirements.find((n) => n.id === id);
  return fw && node ? fw.shortTitle + " " + node.ref : reference;
}

/**
 * M1 (design section 11.4): the explicit legacy pin of an engagement stored
 * before pins, the same pin the read-time rule resolves. 409 when the
 * engagement already stores one.
 */
export function explicitLegacyPin(
  e: Pick<Engagement, "criteria" | "rulePack">,
  userId: string,
  at: string,
): EngagementCriteria {
  if (e.criteria)
    throw new ApiError(409, "This engagement already stores its criteria pin");
  return {
    pin: legacyPin(criteriaRegistry(), e),
    pinnedAt: at,
    pinnedBy: userId,
    origin: "legacy",
    history: [],
  };
}
/** The reversal of M1: allowed while the stored pin is a legacy pin never moved. */
export function assertLegacyUnpin(e: Pick<Engagement, "criteria">) {
  if (!e.criteria)
    throw new ApiError(409, "This engagement stores no criteria pin");
  if (e.criteria.origin !== "legacy" || e.criteria.history.length)
    throw new ApiError(
      409,
      "Only an explicit legacy pin that never moved can be removed",
    );
}

/** The catalogue projection the workspace sends for an engagement's pack. */
export const pinnedCatalog = (e: Pick<Engagement, "criteria" | "rulePack">) =>
  legacyCatalog(pinnedPack(e));
/** The catalogue projection of the default pack (no engagement selected). */
export function defaultCatalog() {
  const r = criteriaRegistry();
  const d = r.bundle.index.defaults.pack;
  return legacyCatalog(resolve(r, defaultPin(r, d.id, d.version)).pack);
}
