// Engagement-level criteria: the pack an engagement is pinned to, what that
// pack switches on, and the projections the commands and read models use
// (docs/design/criteria-model.md sections 7, 10 and 11.4). Server-only.
import type { Engagement, RulePackStamp } from "../domain";
import { ApiError } from "../http";
import {
  features,
  legacyCatalog,
  legalReviewPending,
  packRulePack,
  type Resolved,
} from "./projection";
import {
  defaultPin,
  frameworkEntry,
  pinOf,
  registry,
  resolve,
  type Registry,
} from "./registry";
import type {
  CriteriaPin,
  CriteriaView,
  EngagementCriteria,
  PackDocument,
  PackFeatures,
  PackRoles,
} from "./types";

let active: Registry | undefined;
/** The registry the server uses: the generated bundle, or one a test injected. */
export const criteriaRegistry = () => (active ??= registry());
/** Injects a registry (tests only). Returns a function that restores the previous one. */
export function useRegistry(r: Registry) {
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

/** The pin a new engagement stores. */
export function newCriteria(
  pin: CriteriaPin,
  userId: string,
  at: string,
): EngagementCriteria {
  return {
    pin,
    pinnedAt: at,
    pinnedBy: userId,
    origin: "created",
    history: [],
  };
}
/** The default pin, or the current version of a chosen pack (400 if not selectable). */
export const chooseCriteria = (packId?: string, packVersion?: string) =>
  defaultPin(criteriaRegistry(), packId, packVersion);

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
/** The report snapshot stamp of the pin (design section 10). */
export function criteriaStamp(e: Pick<Engagement, "criteria" | "rulePack">) {
  const resolved = pinned(e);
  return {
    packId: resolved.pin.packId,
    packVersion: resolved.pin.packVersion,
    packSha256: resolved.pin.packSha256,
    legalReviewPending: pinLegalReviewPending(resolved),
  };
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
export function criteriaView(e: Engagement): CriteriaView {
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
    ...(f.obligationAssessments
      ? {}
      : {
          requirements: resolved.frameworks.flatMap((fw, i) => {
            const include = pack.criteria[i].include;
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
              .filter((n) => n.type === "requirement" && inScope(n.id))
              .map((n) => ({
                reference: fw.id + ":" + n.id,
                citation: fw.shortTitle + " " + n.ref,
                title: n.title ?? "",
              }));
          }),
        }),
  };
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
