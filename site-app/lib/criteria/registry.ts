// The criteria loader (docs/design/criteria-model.md section 14.4): the
// generated bundle of templates/criteria, indexed in maps, with pin
// resolution, the read-time legacy pin (M0) and the projections the existing
// code reads. Server-only: the client receives projections from the API.
// Documents are deep-frozen and never carry indexes of their own, because
// attaching anything to a document would change its digest.
import generated from "./bundle.generated.json";
import { ApiError } from "../http";
import {
  compareVersions,
  legalReviewPending,
  type Resolved,
} from "./projection";
import type {
  Bundle,
  CriteriaPin,
  CrosswalkDocument,
  FrameworkDocument,
  IndexEntry,
  PackDocument,
  PackSummary,
} from "./types";

export type Registry = {
  bundle: Bundle;
  entries: readonly IndexEntry[];
  /** Documents by index entry key (see `keyOf`). */
  documents: ReadonlyMap<
    string,
    FrameworkDocument | PackDocument | CrosswalkDocument
  >;
};

const keyOf = (e: {
  documentType: string;
  id: string;
  edition?: string;
  version: string;
}) => `${e.documentType}:${e.id}@${e.edition ?? ""}#${e.version}`;
const released = (e: IndexEntry) =>
  e.status === "released" || e.status === "withdrawn";
/**
 * A draft in a local draft preview: only a bundle built with
 * CRITERIA_INCLUDE_DRAFTS=1 gives drafts a digest, and check:sync keeps such
 * a bundle out of the repository, so production never has one. A preview
 * draft can be pinned and selected, is labelled a draft, and coverage clamps
 * its links to partial (design section 9.2).
 */
export const previewDraft = (e: IndexEntry) =>
  e.status === "draft" && e.sha256 !== undefined;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const memo = new WeakMap<object, Registry>();
/**
 * The registry of a bundle (default: the generated bundle). Memoised per
 * bundle object; tests pass fixture bundles to inject packs.
 */
export function registry(bundle: Bundle = generated as unknown as Bundle) {
  let r = memo.get(bundle);
  if (r) return r;
  deepFreeze(bundle);
  const documents = new Map<
    string,
    FrameworkDocument | PackDocument | CrosswalkDocument
  >();
  for (const d of bundle.documents) documents.set(keyOf(d), d);
  // Only entries whose document the bundle carries (drafts are left out of
  // the production bundle).
  const entries = bundle.index.documents.filter((e) => documents.has(keyOf(e)));
  r = { bundle, entries, documents };
  memo.set(bundle, r);
  return r;
}

export const entryOf = (
  r: Registry,
  documentType: IndexEntry["documentType"],
  id: string,
  version: string,
  edition?: string,
) =>
  r.entries.find(
    (e) =>
      e.documentType === documentType &&
      e.id === id &&
      e.version === version &&
      (edition === undefined || e.edition === edition),
  );
export function packDocument(r: Registry, id: string, version: string) {
  const e = entryOf(r, "pack", id, version);
  return e ? (r.documents.get(keyOf(e)) as PackDocument) : undefined;
}
export function crosswalkDocument(r: Registry, id: string, version: string) {
  const e = entryOf(r, "crosswalk", id, version);
  return e ? (r.documents.get(keyOf(e)) as CrosswalkDocument) : undefined;
}
export function frameworkDocument(
  r: Registry,
  id: string,
  edition: string,
  version: string,
) {
  const e = entryOf(r, "framework", id, version, edition);
  return e ? (r.documents.get(keyOf(e)) as FrameworkDocument) : undefined;
}
export const frameworkEntry = (
  r: Registry,
  f: { id: string; edition: string; version: string },
) => entryOf(r, "framework", f.id, f.version, f.edition);

/**
 * The highest released, non-withdrawn version of a pack or crosswalk; in a
 * local draft preview, the highest preview draft when none is released.
 */
export function currentVersion(
  r: Registry,
  documentType: "pack" | "crosswalk",
  id: string,
) {
  const versions = r.entries
    .filter((e) => e.documentType === documentType && e.id === id)
    .sort((a, b) => compareVersions(b.version, a.version));
  return (
    versions.find((e) => e.status === "released") ?? versions.find(previewDraft)
  );
}
/** The latest released, non-withdrawn data version of a framework edition. */
export function latestFramework(r: Registry, id: string, edition: string) {
  const e = r.entries
    .filter(
      (e) =>
        e.documentType === "framework" &&
        e.id === id &&
        e.edition === edition &&
        e.status === "released",
    )
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  return e ? (r.documents.get(keyOf(e)) as FrameworkDocument) : undefined;
}

/**
 * Resolves a pin. The pin's digest must equal the index digest: the runtime
 * trusts the bundle CI checked and compares the digest string only.
 */
export function resolve(r: Registry, pin: CriteriaPin): Resolved {
  const entry = entryOf(r, "pack", pin.packId, pin.packVersion);
  if (
    !entry ||
    !(released(entry) || previewDraft(entry)) ||
    entry.sha256 !== pin.packSha256
  )
    throw new ApiError(
      500,
      `The criteria pack ${pin.packId} ${pin.packVersion} this engagement is pinned to is not available in this build`,
    );
  const pack = r.documents.get(keyOf(entry)) as PackDocument;
  const frameworkEntries = pack.criteria.map((s) => {
    const e = entryOf(r, "framework", s.framework, s.version, s.edition);
    if (!e)
      throw new ApiError(
        500,
        `The framework ${s.framework} ${s.version} of the criteria pack ${pack.id} ${pack.version} is not available in this build`,
      );
    return e;
  });
  return {
    pin,
    entry,
    pack,
    frameworks: frameworkEntries.map(
      (e) => r.documents.get(keyOf(e)) as FrameworkDocument,
    ),
    frameworkEntries,
  };
}

export function pinFor(r: Registry, id: string, version: string): CriteriaPin {
  const e = entryOf(r, "pack", id, version);
  if (!e?.sha256)
    throw new ApiError(500, `Unknown criteria pack ${id} ${version}`);
  return { packId: id, packVersion: version, packSha256: e.sha256 };
}

/** Whether a pack version may be pinned by a new engagement. */
export function selectable(r: Registry, id: string, version: string) {
  const e = entryOf(r, "pack", id, version);
  if (!e || !(e.status === "released" || previewDraft(e)) || !e.selectable)
    return false;
  const pack = packDocument(r, id, version)!;
  // A preview draft's frameworks are drafts whose licences may be
  // unconfirmed: that is what keeps them drafts.
  return (
    pack.kind === "audit_programme" &&
    (previewDraft(e) ||
      pack.criteria.every(
        (s) =>
          frameworkDocument(r, s.framework, s.edition, s.version)?.licence
            .status === "confirmed",
      ))
  );
}

/**
 * The pin of a new engagement: index.defaults.pack, or the current version
 * of the chosen pack id (optionally an exact version), which must be
 * selectable (400 otherwise).
 */
export function defaultPin(
  r: Registry,
  packId?: string,
  packVersion?: string,
): CriteriaPin {
  const id = packId ?? r.bundle.index.defaults.pack.id;
  const version =
    packVersion ??
    (packId
      ? currentVersion(r, "pack", packId)?.version
      : r.bundle.index.defaults.pack.version);
  if (!version || !selectable(r, id, version))
    throw new ApiError(400, "Choose a released criteria pack");
  return pinFor(r, id, version);
}

/**
 * The read-time legacy pin (M0, design section 11.4) of an engagement
 * stored before pins existed: #18's rule-pack stamp through index.legacy,
 * the fallback without a stamp. An unknown stamp fails closed.
 */
export function legacyPin(
  r: Registry,
  e: { rulePack?: { version: string } },
): CriteriaPin {
  const legacy = r.bundle.index.legacy;
  const stamp = e.rulePack?.version;
  if (stamp !== undefined && !Object.hasOwn(legacy.stamps, stamp))
    throw new ApiError(
      500,
      `This engagement's rule-pack stamp ${stamp} has no criteria pack in this build`,
    );
  return pinFor(
    r,
    legacy.packId,
    stamp === undefined ? legacy.fallbackVersion : legacy.stamps[stamp],
  );
}
/** The pin an engagement uses: its stored pin or, before pins, the legacy pin. */
export const pinOf = (
  r: Registry,
  e: { criteria?: { pin: CriteriaPin }; rulePack?: { version: string } },
) => e.criteria?.pin ?? legacyPin(r, e);

/** The packs offered at engagement creation (design section 15.1). */
export function selectablePacks(r: Registry): PackSummary[] {
  const defaults = r.bundle.index.defaults.pack;
  const ids = [
    ...new Set(
      r.entries.filter((e) => e.documentType === "pack").map((e) => e.id),
    ),
  ];
  return ids.flatMap((id) => {
    const current = currentVersion(r, "pack", id);
    if (!current || !selectable(r, id, current.version)) return [];
    const pack = packDocument(r, id, current.version)!;
    const frameworks = pack.criteria.map((s) => ({
      doc: frameworkDocument(r, s.framework, s.edition, s.version)!,
      entry: entryOf(r, "framework", s.framework, s.version, s.edition),
    }));
    const editions = new Set(
      pack.criteria.map((s) => s.framework + "@" + s.edition),
    );
    const crosswalksTo = [
      ...new Set(
        r.entries
          .filter(
            (e) =>
              e.documentType === "crosswalk" &&
              (e.status === "released" || previewDraft(e)),
          )
          .map((e) => r.documents.get(keyOf(e)) as CrosswalkDocument)
          .flatMap((c) => {
            const s = c.source.framework + "@" + c.source.edition,
              t = c.target.framework + "@" + c.target.edition;
            return editions.has(s) && !editions.has(t)
              ? [t]
              : editions.has(t) && !editions.has(s)
                ? [s]
                : [];
          }),
      ),
    ].map((key) => {
      const [fid, edition] = key.split("@");
      return latestFramework(r, fid, edition)?.shortTitle ?? fid;
    });
    return [
      {
        id,
        version: current.version,
        title: pack.title,
        summary: pack.summary ?? "",
        isDefault: defaults.id === id && defaults.version === current.version,
        draft: previewDraft(current),
        workingPapers: pack.items.filter((i) => i.kind === "working_paper")
          .length,
        memos: pack.items.filter((i) => i.kind === "memo").length,
        frameworks: frameworks.map(({ doc }) => ({
          shortTitle: doc.shortTitle,
          edition: doc.edition,
          title: doc.title,
        })),
        legalReviewPending: frameworks.some(({ doc, entry }) =>
          legalReviewPending(doc, entry),
        ),
        clauseNumbersOnly: frameworks.some(
          ({ doc }) => doc.licence.textPolicy !== "full_text",
        ),
        phases: (pack.phases ?? []).map((p) => p.title),
        crosswalksTo,
      },
    ];
  });
}

export {
  compareVersions,
  criteriaFor,
  displayRefs,
  features,
  item,
  legacyCatalog,
  legalReviewPending,
  obligationCatalog,
  type Catalog,
  type Resolved,
} from "./projection";
