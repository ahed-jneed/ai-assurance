// The coverage views of a pinned engagement (docs/design/criteria-model.md
// sections 9.6, 10 and 15.2): which views it offers, and each view computed
// from the pinned documents, the engagement's sources and the current
// crosswalks. Server-only (it reads the registry).
import type { Engagement } from "../domain";
import {
  crosswalkEvaluation,
  evaluate,
  place,
  summarise,
  type Cap,
  type CellState,
  type Contribution,
  type CoverageSource,
  type CrosswalkInput,
  type Evaluation,
  type LinkInput,
  type StateCounts,
  type Unusable,
} from "./coverage";
import {
  datesFramework,
  deriveApplicability,
  effectiveRows,
  type DatedSnapshot,
  type DerivedApplicabilityRow,
} from "./applicability";
import { coverageSources, type ObligationRecord } from "./coverage-sources";
import { criteriaFor, features, legalReviewPending } from "./projection";
import {
  crosswalkDocument,
  currentVersion,
  entryOf,
  frameworkEntry,
  latestFramework,
  packDocument,
  type Registry,
  type Resolved,
} from "./registry";
import type {
  CrosswalkDocument,
  FrameworkDocument,
  IndexEntry,
  RequirementNode,
} from "./types";

export type ViewInfo = {
  /** "<framework-id>@<edition>", the `framework` query parameter. */
  key: string;
  kind: "criteria" | "crosswalk";
  framework: string;
  edition: string;
  version: string;
  shortTitle: string;
  title: string;
  role?: "primary" | "supporting";
};

const statusClamp = (label: string, e: IndexEntry | undefined) =>
  !e
    ? [label + " is not indexed"]
    : e.status === "released"
      ? []
      : [label + " is " + e.status];
const viewKey = (framework: string, edition: string) =>
  framework + "@" + edition;

/** The criteria editions of every current pack, audit programmes and crosswalk-only packs. */
function currentPackEditions(r: Registry) {
  const ids = [
    ...new Set(
      r.entries.filter((e) => e.documentType === "pack").map((e) => e.id),
    ),
  ];
  return ids.flatMap((id) => {
    const current = currentVersion(r, "pack", id);
    if (!current) return [];
    const pack = packDocument(r, id, current.version)!;
    return pack.criteria.map((s) => ({
      framework: s.framework,
      edition: s.edition,
    }));
  });
}
/** The current version of every crosswalk id. */
function currentCrosswalks(r: Registry): CrosswalkDocument[] {
  const ids = [
    ...new Set(
      r.entries.filter((e) => e.documentType === "crosswalk").map((e) => e.id),
    ),
  ];
  return ids.flatMap((id) => {
    const current = currentVersion(r, "crosswalk", id);
    const doc = current && crosswalkDocument(r, id, current.version);
    return doc ? [doc] : [];
  });
}
const connects = (
  c: CrosswalkDocument,
  a: { framework: string; edition: string },
  t: { framework: string; edition: string },
) =>
  (c.source.framework === a.framework &&
    c.source.edition === a.edition &&
    c.target.framework === t.framework &&
    c.target.edition === t.edition) ||
  (c.target.framework === a.framework &&
    c.target.edition === a.edition &&
    c.source.framework === t.framework &&
    c.source.edition === t.edition);

/**
 * The crosswalk versions the coverage views of a pin use: the current
 * version of every crosswalk that connects one of its criteria editions with
 * the edition of a crosswalk view it offers, in crosswalk id order. Report
 * snapshots stamp them (phase 2).
 */
export function pinCrosswalks(
  r: Registry,
  resolved: Resolved,
): CrosswalkDocument[] {
  const targets = offeredViews(r, resolved).filter(
    (v) => v.kind === "crosswalk",
  );
  return currentCrosswalks(r)
    .filter((c) =>
      targets.some((t) =>
        resolved.pack.criteria.some((a) => connects(c, a, t)),
      ),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The views an engagement offers: one criteria view per criteria set,
 * primary first, then one crosswalk view per framework edition that is the
 * criteria of a current pack, not of this one, and connected to one of its
 * criteria editions by a current crosswalk, in the order of those crosswalks.
 */
export function offeredViews(r: Registry, resolved: Resolved): ViewInfo[] {
  const sets = resolved.pack.criteria.map((s, i) => ({
    s,
    fw: resolved.frameworks[i],
  }));
  const criteria = [
    ...sets.filter((x) => x.s.role === "primary"),
    ...sets.filter((x) => x.s.role !== "primary"),
  ].map(({ s, fw }): ViewInfo => ({
    key: viewKey(s.framework, s.edition),
    kind: "criteria",
    framework: s.framework,
    edition: s.edition,
    version: s.version,
    shortTitle: fw.shortTitle,
    title: fw.title,
    role: s.role,
  }));
  const own = new Set(criteria.map((v) => v.key));
  const editions = currentPackEditions(r);
  const seen = new Set<string>();
  const crosswalkViews: ViewInfo[] = [];
  // In the index order of the first crosswalk that reaches each edition, so
  // that a new pack version listing a framework another pack already lists
  // (#161) does not reorder the views of existing engagements.
  for (const c of currentCrosswalks(r))
    for (const t of editions) {
      const key = viewKey(t.framework, t.edition);
      if (own.has(key) || seen.has(key)) continue;
      if (!resolved.pack.criteria.some((a) => connects(c, a, t))) continue;
      const fw = latestFramework(r, t.framework, t.edition);
      if (!fw) continue;
      seen.add(key);
      crosswalkViews.push({
        key,
        kind: "crosswalk",
        framework: t.framework,
        edition: t.edition,
        version: fw.version,
        shortTitle: fw.shortTitle,
        title: fw.title,
      });
    }
  return [...criteria, ...crosswalkViews];
}

/** The requirement nodes of a criteria set in scope (`include`, with descendants). */
function scoped(fw: FrameworkDocument, include?: string[]) {
  if (!include) return fw.requirements;
  const byId = new Map(fw.requirements.map((n) => [n.id, n]));
  const inScope = (n: RequirementNode): boolean =>
    include.includes(n.id) || (!!n.parent && inScope(byId.get(n.parent)!));
  const kept = fw.requirements.filter(inScope);
  const ids = new Set(kept.map((n) => n.id));
  // An included node whose parent is out of scope becomes a root.
  return kept.map((n) =>
    n.parent && !ids.has(n.parent) ? { ...n, parent: undefined } : n,
  );
}

function criteriaEvaluation(
  r: Registry,
  resolved: Resolved,
  e: Engagement,
  records: readonly ObligationRecord[],
  index: number,
) {
  const { pack } = resolved;
  const set = pack.criteria[index],
    fw = resolved.frameworks[index];
  const f = features(pack);
  const obligationCodes =
    f.obligationAssessments && fw.id === "eu-ai-act"
      ? (fw.compat?.obligations?.order ?? [])
      : null;
  const result = coverageSources(e, records, obligationCodes);
  const sources = new Map(result.sources.map((s) => [s.id, s]));
  const packClamps = statusClamp(
    "pack " + pack.id + " " + pack.version,
    resolved.entry,
  );
  const fwClamps = statusClamp(
    fw.shortTitle + " data " + fw.version,
    resolved.frameworkEntries[index],
  );
  let migrated = false;
  const links: LinkInput[] = [];
  for (const s of result.sources) {
    if (!s.templateId) continue;
    for (const link of criteriaFor(pack, s.templateId)) {
      const [framework, target] = link.requirement.split(":");
      if (framework !== set.framework) continue;
      if (link.origin === "migrated") migrated = true;
      links.push({
        sourceId: s.id,
        target,
        relationship: link.relationship,
        rationale: link.rationale,
        objectiveId: link.objectiveId,
        origin: link.origin,
        clamps: [...packClamps, ...fwClamps],
      });
    }
  }
  for (const link of result.obligationLinks)
    links.push({ ...link, clamps: fwClamps });
  for (const link of result.findingLinks) {
    const [framework, target] = link.requirement.split(":");
    if (framework !== set.framework) continue;
    links.push({
      sourceId: link.sourceId,
      target,
      relationship: "equal",
      rationale: "semantic",
      via: "finding",
      clamps: fwClamps,
    });
  }
  return {
    evaluation: evaluate(scoped(fw, set.include), place(links, sources)),
    sources,
    migrated,
    result,
  };
}

export type CellView = {
  id: string;
  ref: string;
  title?: string;
  type: RequirementNode["type"];
  parent?: string;
  state: CellState;
  readiness: boolean;
  qualified: boolean;
  capped: boolean;
  contributions: (Contribution & {
    source?: Pick<CoverageSource, "kind" | "label" | "templateId" | "evidence">;
  })[];
  caps: Cap[];
  /** The actors the framework data names for the requirement. */
  actors?: string[];
  /** Reviewed applicability rows of the framework data. */
  applicability?: RequirementNode["applicability"];
  /**
   * Rows derived from the pinned rule pack's dated entries (own or inherited
   * from a group): derived, not reviewed, never a coverage state.
   */
  derivedApplicability?: DerivedApplicabilityRow[];
  legalEffects?: {
    crosswalk: string;
    entryId?: string;
    basis: string;
    conditions: string;
    verification: string;
  }[];
};
export type CoverageResponse = {
  view: ViewInfo;
  views: ViewInfo[];
  pack: { id: string; version: string; title: string; sha256: string };
  programApproved: boolean;
  versions: {
    framework: string;
    crosswalks: { id: string; version: string }[];
  };
  summary: StateCounts;
  groups: {
    id: string;
    ref: string;
    title?: string;
    parent?: string;
    counts: StateCounts;
    summary: { state: CellState; readiness: boolean };
    rollup: { readiness: boolean } | null;
  }[];
  cells: CellView[];
  unusableEntries: Unusable[];
  notes: { unusableObligations: number; unplacedFindings: number };
  banners: { id: string; text: string }[];
  /** Links migrated from the catalogue: the view explains the change of #27. */
  migrated: boolean;
  legalReviewPending: boolean;
};

const MIGRATION_NOTE =
  "Coverage replaces the former Article coverage bars. Those bars counted signed papers per article; this view counts reviewed evidence per requirement. The links of this pack were migrated from the catalogue, which only says which article a paper relates to, so they claim partial overlap and show Partly covered at best. Reviewed links, a later methodology release, turn Partly covered into Covered. Paper sign-off and procedure review stay on the overview as progress.";

function toResponse(
  ev: Evaluation,
  sources: Map<string, CoverageSource>,
  legalEffects?: Map<
    string,
    { crosswalk: string; entryId?: string; legalEffect: unknown }[]
  >,
  derived?: (id: string) => DerivedApplicabilityRow[],
) {
  const cells: CellView[] = [];
  for (const n of ev.order) {
    const res = ev.nodes.get(n.id);
    if (!res) continue;
    const dated = derived?.(n.id) ?? [];
    cells.push({
      id: n.id,
      ref: n.ref,
      title: n.title,
      type: n.type,
      parent: n.parent,
      ...res.cell,
      contributions: res.contributions.map((c) => {
        const s = sources.get(c.sourceId);
        return s
          ? {
              ...c,
              source: {
                kind: s.kind,
                label: s.label,
                templateId: s.templateId,
                evidence: s.evidence,
              },
            }
          : c;
      }),
      caps: res.caps,
      ...(n.actors?.length ? { actors: n.actors } : {}),
      ...(n.applicability ? { applicability: n.applicability } : {}),
      ...(dated.length ? { derivedApplicability: dated } : {}),
      ...(legalEffects?.get(n.id)
        ? {
            legalEffects: legalEffects.get(n.id)!.map((x) => {
              const le = x.legalEffect as {
                basis: string;
                conditions: string;
                provenance: { verification: string };
              };
              return {
                crosswalk: x.crosswalk,
                entryId: x.entryId,
                basis: le.basis,
                conditions: le.conditions,
                verification: le.provenance.verification,
              };
            }),
          }
        : {}),
    });
  }
  const groups = [...ev.groups.values()].map((g) => ({
    id: g.node.id,
    ref: g.node.ref,
    title: g.node.title,
    parent: g.node.parent,
    counts: g.counts,
    summary: { state: g.summary.state, readiness: g.summary.readiness },
    rollup: g.rollup,
  }));
  return { cells, groups, summary: summarise(ev) };
}

/** One coverage view of an engagement; null for a view it does not offer. */
export function coverageFor(
  r: Registry,
  resolved: Resolved,
  e: Engagement,
  records: readonly ObligationRecord[],
  key: string,
): CoverageResponse | null {
  const views = offeredViews(r, resolved);
  const view = views.find((v) => v.key === key);
  if (!view) return null;
  const { pack } = resolved;
  const criteria = pack.criteria.map((_, i) =>
    criteriaEvaluation(r, resolved, e, records, i),
  );
  const first = criteria[0].result;
  const banners: { id: string; text: string }[] = [];
  if (first.proposedScope)
    banners.push({
      id: "proposed-scope",
      text: "The audit program is not approved: coverage uses the proposed scope.",
    });
  if (first.noApplicability)
    banners.push({
      id: "no-applicability",
      text: "This engagement records no applicability per paper, so its results are shown as readiness (R).",
    });
  const withdrawn = [
    resolved.entry,
    ...resolved.frameworks.map((fw) => frameworkEntry(r, fw)),
  ].filter((x): x is IndexEntry => x?.status === "withdrawn");
  for (const w of withdrawn)
    banners.push({
      id: "withdrawn",
      text: `${w.documentType === "pack" ? "Pack" : "Framework data"} ${w.id} ${w.version} was withdrawn on ${w.withdrawnAt}: ${w.withdrawalReason} Coverage is capped at Partly covered.`,
    });
  let response: Omit<CoverageResponse, "banners" | "legalReviewPending">;
  let pending = false;
  const snapshot = (pack.compat?.catalog?.regulatorySnapshot ??
    null) as DatedSnapshot | null;
  let derivation: ReturnType<typeof deriveApplicability> | null = null;
  if (view.kind === "criteria") {
    const i = pack.criteria.findIndex(
      (s) => viewKey(s.framework, s.edition) === key,
    );
    const c = criteria[i];
    const fw = resolved.frameworks[i];
    pending = legalReviewPending(fw, resolved.frameworkEntries[i]);
    derivation = datesFramework(fw, snapshot)
      ? deriveApplicability(fw, snapshot)
      : null;
    const rows = derivation?.rows;
    response = {
      view,
      views,
      pack: {
        id: pack.id,
        version: pack.version,
        title: pack.title,
        sha256: resolved.pin.packSha256,
      },
      programApproved: e.workflow?.program.status === "approved",
      versions: { framework: fw.version, crosswalks: [] },
      ...toResponse(
        c.evaluation,
        c.sources,
        undefined,
        rows ? (id) => effectiveRows(fw, rows, id) : undefined,
      ),
      unusableEntries: [],
      notes: {
        unusableObligations: c.result.unusable.length,
        unplacedFindings: c.result.unplacedFindings,
      },
      migrated: c.migrated,
    };
  } else {
    const t = latestFramework(r, view.framework, view.edition)!;
    pending = legalReviewPending(
      t,
      entryOf(r, "framework", t.id, t.version, t.edition),
    );
    const used = currentCrosswalks(r).filter((c) =>
      pack.criteria.some((a) => connects(c, a, view)),
    );
    const sides = new Map(
      pack.criteria.map((s, i) => [s.framework, criteria[i].evaluation]),
    );
    const inputs: CrosswalkInput[] = used.map((c) => ({
      id: c.id,
      version: c.version,
      source: c.source,
      target: c.target,
      entries: c.entries,
    }));
    const x = crosswalkEvaluation(
      { id: t.id, requirements: t.requirements },
      sides,
      inputs,
    );
    banners.push({
      id: "crosswalk",
      text: `This view shows how evidence on the engagement's criteria relates to ${t.shortTitle} (data ${t.version}) through ${used.map((c) => c.id + " " + c.version).join(", ")}. It does not assess whether ${t.shortTitle} applies to the client.`,
    });
    response = {
      view,
      views,
      pack: {
        id: pack.id,
        version: pack.version,
        title: pack.title,
        sha256: resolved.pin.packSha256,
      },
      programApproved: e.workflow?.program.status === "approved",
      versions: {
        framework: t.version,
        crosswalks: used.map((c) => ({ id: c.id, version: c.version })),
      },
      ...toResponse(x.evaluation, new Map(), x.legalEffects),
      unusableEntries: x.unusable,
      notes: {
        unusableObligations: criteria.reduce(
          (n, c) => n + c.result.unusable.length,
          0,
        ),
        unplacedFindings: first.unplacedFindings,
      },
      migrated: criteria.some((c) => c.migrated),
    };
  }
  if (pending)
    banners.push({
      id: "legal-review",
      text: `The legal content of ${view.shortTitle} (data ${response.versions.framework}) is pending qualified legal review. This does not change any coverage state.`,
    });
  if (response.notes.unusableObligations)
    banners.push({
      id: "unusable-obligations",
      text: `${response.notes.unusableObligations} obligation assessment(s) cite a code this framework data version lacks and are not placed.`,
    });
  if (response.notes.unplacedFindings)
    banners.push({
      id: "unplaced-findings",
      text: `${response.notes.unplacedFindings} unresolved finding(s) are linked to no procedure, paper or criterion and are not placed.`,
    });
  const dated = response.cells.filter(
    (c) => c.type === "requirement" && c.derivedApplicability?.length,
  ).length;
  if (derivation && snapshot && dated)
    banners.push({
      id: "derived-applicability",
      text: `Applicability dates on ${dated} requirement(s) are derived from the dated entries of rule pack ${snapshot.rulePackVersion} by an automatic mapping of provisions to requirements. They are derived, not reviewed: they inform review only and do not change any coverage state.${
        derivation.unmapped.length
          ? ` ${derivation.unmapped.length} dated provision(s) map to no requirement of this framework.`
          : ""
      }`,
    });
  if (response.migrated)
    banners.push({ id: "migration", text: MIGRATION_NOTE });
  return { ...response, banners, legalReviewPending: pending };
}
