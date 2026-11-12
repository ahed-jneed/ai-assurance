// The coverage engine (docs/design/criteria-model.md section 9): for each
// requirement, a state computed from reviewed conclusions and typed links,
// which never shows partial coverage as full. Pure: no bundle import, so the
// truth-table and property tests drive it with small trees, and the
// coverage read model (lib/read-models/coverage-view.ts) feeds it the pinned
// documents and the engagement's sources.
import type { Relationship, Rationale, RequirementNode } from "./types";

export type SourceState =
  | "supported"
  | "qualified"
  | "not_supported"
  | "open"
  | "excluded"
  | "not_applicable";
/** One source of evidence (section 9.1): a procedure, a paper, an obligation record or an unresolved finding placed through its criteria (phase 2). */
export type CoverageSource = {
  id: string;
  kind: "procedure" | "paper" | "obligation" | "finding";
  state: SourceState;
  /** Concluded before the provision applies; never shown as an applicable-law result. */
  readiness: boolean;
  label: string;
  templateId?: string;
  /** What the drawer shows of the evidence chain. */
  evidence?: {
    paperId?: string;
    paperRevision?: number;
    reviewer?: string;
    reviewedAt?: string;
    conclusion?: string;
    applicability?: string;
    findings?: { id: string; title: string; severity: string }[];
  };
};
export type Strength = "full" | "partial";
/** How a contribution reached a node: the link path the drawer shows. */
export type LinkPath = {
  via: "objective" | "obligation" | "finding" | "crosswalk";
  relationship: Relationship;
  rationale: Rationale;
  objectiveId?: string;
  origin?: "authored" | "migrated";
  /** The group whose link reached this node. */
  inheritedFrom?: string;
  /** Why a full-strength link counts as partial (section 9.2). */
  clamps?: string[];
  crosswalk?: {
    id: string;
    version: string;
    entryId?: string;
    sources: string[];
    framework: string;
  };
};
export type Contribution = {
  sourceId: string;
  state: SourceState;
  strength: Strength;
  readiness: boolean;
  path: LinkPath;
};
/** A qualification an ancestor group or a crosswalk entry passes down; not evidence. */
export type Cap = {
  sourceId: string;
  reason: string;
  inheritedFrom?: string;
};
export type CellState =
  | "full"
  | "partial"
  | "exception"
  | "open"
  | "parent_only"
  | "unmapped"
  | "excluded"
  | "not_applicable";
export type Cell = {
  state: CellState;
  readiness: boolean;
  /** A partial cell with a qualified contribution or a cap (section 9.4). */
  qualified: boolean;
  /** The node inherits a cap, whatever its state. */
  capped: boolean;
  /** A not-applicable cell reached by a full-strength not-applicable contribution. */
  naFull: boolean;
};

const FULL: ReadonlySet<Relationship> = new Set(["equal", "superset_of"]);
export const strengthOf = (relationship: Relationship): Strength | null =>
  relationship === "no_relationship"
    ? null
    : FULL.has(relationship)
      ? "full"
      : "partial";
export const inverse: Record<Relationship, Relationship> = {
  equal: "equal",
  superset_of: "subset_of",
  subset_of: "superset_of",
  intersects_with: "intersects_with",
  no_relationship: "no_relationship",
};
const blocks = (s: SourceState) => s === "not_supported" || s === "open";
const outOfScope = (s: SourceState) =>
  s === "excluded" || s === "not_applicable";

/** The cell function of section 9.4. */
export function cellState(
  C: readonly Contribution[],
  K: readonly Cap[],
  parentOnly: boolean,
): Cell {
  const capped = K.length > 0;
  const cell = (state: CellState, extra: Partial<Cell> = {}): Cell => ({
    state,
    readiness: false,
    qualified: false,
    capped,
    naFull: false,
    ...extra,
  });
  if (!C.length) return cell(parentOnly ? "parent_only" : "unmapped");
  const S = C.filter((c) => !outOfScope(c.state));
  if (!S.length)
    return C.some((c) => c.state === "not_applicable")
      ? cell("not_applicable", {
          naFull: C.some(
            (c) => c.state === "not_applicable" && c.strength === "full",
          ),
        })
      : cell("excluded");
  if (S.some((c) => c.state === "not_supported")) return cell("exception");
  if (S.some((c) => c.state === "open")) return cell("open");
  const F = S.filter((c) => c.strength === "full" && c.state === "supported");
  const qualified = S.some((c) => c.state === "qualified") || capped;
  if (F.length && !qualified)
    return cell("full", { readiness: F.every((c) => c.readiness) });
  return cell("partial", {
    readiness: S.every((c) => c.readiness),
    qualified,
  });
}

export type NodeResult = {
  node: RequirementNode;
  cell: Cell;
  contributions: Contribution[];
  caps: Cap[];
};
export type StateCounts = Record<CellState, number> & {
  /** Readiness results, counted apart and never added to the totals above. */
  readiness: { full: number; partial: number };
  total: number;
};
export type GroupRow = {
  node: RequirementNode;
  counts: StateCounts;
  /** The group-level contributions, summarised with the cell function. */
  summary: Cell;
  /** Only ever full: an exhaustive roll-up (section 9.5). */
  rollup: { readiness: boolean } | null;
};
export type Evaluation = {
  nodes: Map<string, NodeResult>;
  groups: Map<string, GroupRow>;
  order: RequirementNode[];
  children: Map<string, RequirementNode[]>;
};

export function emptyCounts(): StateCounts {
  return {
    full: 0,
    partial: 0,
    exception: 0,
    open: 0,
    parent_only: 0,
    unmapped: 0,
    excluded: 0,
    not_applicable: 0,
    readiness: { full: 0, partial: 0 },
    total: 0,
  };
}
function count(counts: StateCounts, cell: Cell) {
  counts[cell.state]++;
  counts.total++;
  if (cell.readiness && (cell.state === "full" || cell.state === "partial"))
    counts.readiness[cell.state]++;
}

/** Whether a descendant passes in a roll-up or a full group endpoint (section 9.5). */
const passes = (c: Cell) =>
  c.state === "full" || (c.state === "not_applicable" && !c.capped && c.naFull);

/**
 * Places contributions and caps on a tree and evaluates every node (sections
 * 9.3 to 9.5). `placed` and `placedCaps` are keyed by the node a link targets.
 */
export function evaluate(
  requirements: readonly RequirementNode[],
  placed: ReadonlyMap<string, Contribution[]>,
  placedCaps: ReadonlyMap<string, Cap[]> = new Map(),
): Evaluation {
  const byId = new Map(requirements.map((n) => [n.id, n]));
  const children = new Map<string, RequirementNode[]>();
  for (const n of requirements)
    if (n.parent !== undefined) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent)!.push(n);
    }
  const ancestors = (n: RequirementNode) => {
    const out: RequirementNode[] = [];
    for (
      let p = n.parent === undefined ? undefined : byId.get(n.parent);
      p;
      p = p.parent === undefined ? undefined : byId.get(p.parent)
    )
      out.push(p);
    return out;
  };
  const nodes = new Map<string, NodeResult>();
  for (const n of requirements) {
    if (n.type === "informative") continue;
    const contributions = [...(placed.get(n.id) ?? [])];
    const caps = [...(placedCaps.get(n.id) ?? [])];
    let parentOnly = false;
    for (const a of ancestors(n)) {
      const own = placed.get(a.id) ?? [];
      if (own.length) parentOnly = true;
      for (const c of own) {
        if (c.strength === "full" || blocks(c.state))
          contributions.push({
            ...c,
            path: { ...c.path, inheritedFrom: c.path.inheritedFrom ?? a.id },
          });
        else if (c.state === "qualified")
          caps.push({
            sourceId: c.sourceId,
            reason: "qualified conclusion linked to a parent group",
            inheritedFrom: a.id,
          });
      }
      for (const k of placedCaps.get(a.id) ?? [])
        caps.push({ ...k, inheritedFrom: k.inheritedFrom ?? a.id });
    }
    nodes.set(n.id, {
      node: n,
      cell: cellState(contributions, caps, parentOnly),
      contributions,
      caps,
    });
  }
  const descendants = (id: string): RequirementNode[] =>
    (children.get(id) ?? []).flatMap((c) => [c, ...descendants(c.id)]);
  const groups = new Map<string, GroupRow>();
  for (const n of requirements) {
    if (n.type !== "group") continue;
    const below = descendants(n.id);
    const leaves = below.filter((d) => d.type === "requirement");
    const counts = emptyCounts();
    for (const d of leaves) count(counts, nodes.get(d.id)!.cell);
    groups.set(n.id, {
      node: n,
      counts,
      summary: nodes.get(n.id)!.cell,
      rollup: null,
    });
  }
  for (const [id, row] of groups) {
    if (!row.node.exhaustive) continue;
    const below = descendants(id);
    const cells = below
      .filter((d) => d.type === "requirement")
      .map((d) => nodes.get(d.id)!.cell);
    if (!cells.length || !cells.every(passes)) continue;
    if (!cells.some((c) => c.state === "full")) continue;
    const nested = below.filter((d) => d.type === "group");
    if (
      !nested.every(
        (g) => g.exhaustive || groups.get(g.id)!.summary.state === "full",
      )
    )
      continue;
    row.rollup = {
      readiness:
        cells.some((c) => c.state === "full" && c.readiness) ||
        nested.some(
          (g) =>
            !g.exhaustive &&
            groups.get(g.id)!.summary.state === "full" &&
            groups.get(g.id)!.summary.readiness,
        ),
    };
  }
  return { nodes, groups, order: [...requirements], children };
}

/** Counts by state over the requirement nodes of an evaluation (invariant 8). */
export function summarise(ev: Evaluation): StateCounts {
  const counts = emptyCounts();
  for (const r of ev.nodes.values())
    if (r.node.type === "requirement") count(counts, r.cell);
  return counts;
}

// ---------------------------------------------------------------------------
// Criteria views: the pack's own links and the obligation records

/** A link from a source to a node of the viewed framework. */
export type LinkInput = {
  sourceId: string;
  target: string;
  relationship: Relationship;
  rationale: Rationale;
  via?: LinkPath["via"];
  objectiveId?: string;
  origin?: "authored" | "migrated";
  /** Reasons the chain is clamped to partial (draft or withdrawn documents). */
  clamps?: string[];
};

/**
 * Turns links into placed contributions (section 9.2): syntactic and
 * no_relationship links never contribute, migrated and clamped links are
 * partial, and the weakest strength wins per source, objective and target.
 */
export function place(
  links: readonly LinkInput[],
  sources: ReadonlyMap<string, CoverageSource>,
) {
  const best = new Map<string, Contribution & { target: string }>();
  for (const link of links) {
    const source = sources.get(link.sourceId);
    if (!source) continue;
    if (link.rationale === "syntactic") continue;
    let strength = strengthOf(link.relationship);
    if (!strength) continue;
    const clamps = [
      ...(link.origin === "migrated" ? ["migrated link"] : []),
      ...(link.clamps ?? []),
    ];
    if (clamps.length) strength = "partial";
    const key = `${link.sourceId}\u0000${link.objectiveId ?? ""}\u0000${link.target}`;
    const previous = best.get(key);
    if (previous && (previous.strength === "partial" || strength === "full"))
      continue;
    best.set(key, {
      target: link.target,
      sourceId: link.sourceId,
      state: source.state,
      strength,
      readiness: source.readiness,
      path: {
        via: link.via ?? "objective",
        relationship: link.relationship,
        rationale: link.rationale,
        objectiveId: link.objectiveId,
        origin: link.origin,
        ...(clamps.length ? { clamps } : {}),
      },
    });
  }
  const placed = new Map<string, Contribution[]>();
  for (const { target, ...c } of best.values()) {
    if (!placed.has(target)) placed.set(target, []);
    placed.get(target)!.push(c);
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Crosswalk views (section 9.6)

/** A source endpoint's state in the criteria view (step 3). */
export type Endpoint = {
  state: CellState | "none";
  readiness: boolean;
  qualified: boolean;
  capped: boolean;
};
const evidence = (s: Endpoint["state"]) => s === "full" || s === "partial";

export function endpointOf(ev: Evaluation, id: string): Endpoint | null {
  const r = ev.nodes.get(id);
  if (!r) return null;
  const asEndpoint = (c: Cell): Endpoint => ({
    state:
      c.state === "unmapped" || c.state === "parent_only" ? "none" : c.state,
    readiness: c.readiness,
    qualified: c.qualified,
    capped: c.capped,
  });
  if (r.node.type !== "group") return asEndpoint(r.cell);
  const row = ev.groups.get(id)!;
  const descendants = (g: string): RequirementNode[] =>
    (ev.children.get(g) ?? []).flatMap((c) => [c, ...descendants(c.id)]);
  const below = descendants(id);
  const members = below
    .filter((d) => d.type === "requirement")
    .map((d) => ev.nodes.get(d.id)!.cell);
  const all = [row.summary, ...members];
  const capped = all.some((c) => c.capped);
  const base = { capped, qualified: false, readiness: false };
  if (all.some((c) => c.state === "exception"))
    return { ...base, state: "exception" };
  if (all.some((c) => c.state === "open")) return { ...base, state: "open" };
  const rollupHolds =
    !!row.node.exhaustive &&
    below
      .filter((d) => d.type === "group")
      .every(
        (g) => g.exhaustive || ev.groups.get(g.id)!.summary.state === "full",
      );
  if (
    members.length &&
    members.every(passes) &&
    members.some((c) => c.state === "full") &&
    (rollupHolds || row.summary.state === "full")
  ) {
    const lawSummary = row.summary.state === "full" && !row.summary.readiness;
    const lawRollup =
      rollupHolds &&
      !members.some((c) => c.state === "full" && c.readiness) &&
      !below.some(
        (g) =>
          g.type === "group" &&
          !g.exhaustive &&
          ev.groups.get(g.id)!.summary.state === "full" &&
          ev.groups.get(g.id)!.summary.readiness,
      );
    return { ...base, state: "full", readiness: !(lawSummary || lawRollup) };
  }
  const withEvidence = all.filter(
    (c) => c.state === "full" || c.state === "partial",
  );
  if (withEvidence.length)
    return {
      capped,
      state: "partial",
      readiness: withEvidence.every((c) => c.readiness),
      qualified: withEvidence.some((c) => c.qualified) || capped,
    };
  if (all.some((c) => c.state === "not_applicable"))
    return { ...base, state: "not_applicable" };
  if (all.some((c) => c.state === "excluded"))
    return { ...base, state: "excluded" };
  return { ...base, state: "none" };
}

export type CrosswalkInput = {
  id: string;
  version: string;
  source: { framework: string };
  target: { framework: string };
  entries: {
    id?: string;
    sources: string[];
    target: string;
    relationship: Relationship;
    rationale: Rationale;
    legalEffect?: unknown;
  }[];
  /** Reasons its entries are clamped to partial (draft or withdrawn documents). */
  clamps?: string[];
};
export type Unusable = {
  crosswalk: string;
  entryId?: string;
  reason:
    "syntactic" | "not_invertible" | "unresolved_source" | "unresolved_target";
};

/**
 * Evaluates a framework T from the criteria views of the pinned pack through
 * the crosswalks between them (section 9.6, steps 1 to 6). `sides` maps each
 * criteria framework id to its evaluation; T is never transitive.
 */
export function crosswalkEvaluation(
  target: {
    id: string;
    requirements: readonly RequirementNode[];
    clamps?: string[];
  },
  sides: ReadonlyMap<string, Evaluation>,
  crosswalks: readonly CrosswalkInput[],
) {
  const unusable: Unusable[] = [];
  const targetIds = new Set(target.requirements.map((n) => n.id));
  type Oriented = {
    side: string;
    sources: string[];
    target: string;
    relationship: Relationship;
    rationale: Rationale;
    crosswalk: CrosswalkInput;
    entryId?: string;
    legalEffect?: unknown;
  };
  const oriented: Oriented[] = [];
  for (const cw of crosswalks) {
    const forward =
      cw.target.framework === target.id && sides.has(cw.source.framework);
    const backward =
      cw.source.framework === target.id && sides.has(cw.target.framework);
    if (!forward && !backward) continue;
    for (const entry of cw.entries) {
      const label = { crosswalk: cw.id, entryId: entry.id };
      if (entry.relationship === "no_relationship") continue;
      if (entry.rationale === "syntactic") {
        unusable.push({ ...label, reason: "syntactic" });
        continue;
      }
      if (forward)
        oriented.push({
          side: cw.source.framework,
          sources: entry.sources,
          target: entry.target,
          relationship: entry.relationship,
          rationale: entry.rationale,
          crosswalk: cw,
          entryId: entry.id,
          legalEffect: entry.legalEffect,
        });
      else if (entry.sources.length !== 1)
        unusable.push({ ...label, reason: "not_invertible" });
      else
        oriented.push({
          side: cw.target.framework,
          sources: [entry.target],
          target: entry.sources[0],
          relationship: inverse[entry.relationship],
          rationale: entry.rationale,
          crosswalk: cw,
          entryId: entry.id,
          legalEffect: entry.legalEffect,
        });
    }
  }
  // Step 2: the weakest strength wins per (sources, target).
  const weakest = new Map<string, Oriented>();
  for (const o of oriented) {
    const key = `${o.side}\u0000${[...o.sources].sort().join(",")}\u0000${o.target}`;
    const previous = weakest.get(key);
    if (
      !previous ||
      (strengthOf(previous.relationship) === "full" &&
        strengthOf(o.relationship) === "partial")
    )
      weakest.set(key, o);
  }
  const placed = new Map<string, Contribution[]>();
  const caps = new Map<string, Cap[]>();
  const legalEffects = new Map<
    string,
    { crosswalk: string; entryId?: string; legalEffect: unknown }[]
  >();
  for (const o of weakest.values()) {
    const label = { crosswalk: o.crosswalk.id, entryId: o.entryId };
    if (!targetIds.has(o.target)) {
      unusable.push({ ...label, reason: "unresolved_target" });
      continue;
    }
    const ev = sides.get(o.side)!;
    const endpoints = o.sources.map((s) => endpointOf(ev, s));
    if (endpoints.some((p) => p === null)) {
      unusable.push({ ...label, reason: "unresolved_source" });
      continue;
    }
    const ends = endpoints as Endpoint[];
    if (o.legalEffect) {
      if (!legalEffects.has(o.target)) legalEffects.set(o.target, []);
      legalEffects
        .get(o.target)!
        .push({ ...label, legalEffect: o.legalEffect });
    }
    const sourceId = `${o.crosswalk.id}#${o.entryId ?? o.sources.join("+")}`;
    const anyCapped = ends.some((p) => p.capped);
    let state: SourceState | null;
    if (ends.some((p) => p.state === "exception")) state = "not_supported";
    else if (ends.some((p) => p.state === "open")) state = "open";
    else if (!ends.some((p) => evidence(p.state))) {
      state = ends.every((p) => p.state === "none")
        ? null
        : ends.some((p) => p.state === "not_applicable")
          ? "not_applicable"
          : "excluded";
      if (anyCapped) {
        if (!caps.has(o.target)) caps.set(o.target, []);
        caps.get(o.target)!.push({
          sourceId,
          reason: "a crosswalk source is capped by a qualified conclusion",
        });
      }
    } else
      state = ends.some((p) => p.qualified || p.capped)
        ? "qualified"
        : "supported";
    if (!state) continue;
    const clamps = [...(o.crosswalk.clamps ?? []), ...(target.clamps ?? [])];
    const full =
      strengthOf(o.relationship) === "full" &&
      ends.every((p) => p.state === "full") &&
      !clamps.length;
    if (!placed.has(o.target)) placed.set(o.target, []);
    placed.get(o.target)!.push({
      sourceId,
      state,
      strength: full ? "full" : "partial",
      readiness: ends.some((p) => evidence(p.state) && p.readiness),
      path: {
        via: "crosswalk",
        relationship: o.relationship,
        rationale: o.rationale,
        ...(clamps.length ? { clamps } : {}),
        crosswalk: {
          id: o.crosswalk.id,
          version: o.crosswalk.version,
          entryId: o.entryId,
          sources: o.sources,
          framework: o.side,
        },
      },
    });
  }
  return {
    evaluation: evaluate(target.requirements, placed, caps),
    unusable,
    legalEffects,
  };
}
