// Invariant 3 of docs/design/criteria-model.md section 9.7, property-tested
// with the two seeded generators of section 9.8 (no new dependency): a
// weakening never turns a cell, a group endpoint or a roll-up into "full",
// in the criteria view or the crosswalk view, and never turns a readiness
// "full" into an applicable-law one, except in a scenario where the
// weakening moves some requirement from full (readiness) to not applicable.
import { describe, expect, it } from "vitest";
import {
  crosswalkEvaluation,
  endpointOf,
  evaluate,
  place,
  type CoverageSource,
  type CrosswalkInput,
  type Evaluation,
  type LinkInput,
  type SourceState,
} from "./coverage";
import type { Relationship, RequirementNode } from "./types";

/** mulberry32: a small seeded PRNG. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = ReturnType<typeof prng>;
const pick = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

type Scenario = {
  a: RequirementNode[];
  t: RequirementNode[];
  sources: CoverageSource[];
  links: LinkInput[];
  entries: (CrosswalkInput["entries"][number] & { backward?: boolean })[];
  /** Index of the planted link to weaken, if any. */
  planted?: number;
};
const node = (
  id: string,
  type: "group" | "requirement",
  parent?: string,
  exhaustive?: boolean,
): RequirementNode => ({
  id,
  ref: id,
  type,
  ...(parent ? { parent } : {}),
  ...(type === "group" ? { exhaustive: !!exhaustive } : {}),
});
const src = (
  id: string,
  state: SourceState,
  readiness = false,
): CoverageSource => ({ id, kind: "procedure", state, readiness, label: id });
const lnk = (
  sourceId: string,
  target: string,
  relationship: Relationship,
): LinkInput => ({
  sourceId,
  target,
  relationship,
  rationale: "semantic",
  objectiveId: "CO-" + sourceId + "-" + target,
});

function tree(r: Rand, prefix: string, dense: boolean): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  const groups = 1 + Math.floor(r() * (dense ? 3 : 2));
  for (let g = 0; g < groups; g++) {
    const gid = `${prefix}g${g}`;
    nodes.push(node(gid, "group", undefined, r() < 0.5));
    const children = 1 + Math.floor(r() * 3);
    for (let c = 0; c < children; c++) {
      if (r() < (dense ? 0.4 : 0.25)) {
        const nid = `${gid}n${c}`;
        nodes.push(node(nid, "group", gid, r() < 0.5));
        const leaves = 1 + Math.floor(r() * 2);
        for (let l = 0; l < leaves; l++)
          nodes.push(node(`${nid}l${l}`, "requirement", nid));
      } else nodes.push(node(`${gid}c${c}`, "requirement", gid));
    }
  }
  for (let l = 0; l < Math.floor(r() * 3); l++)
    nodes.push(node(`${prefix}leaf${l}`, "requirement"));
  return nodes;
}
const STATES: SourceState[] = [
  "supported",
  "supported",
  "supported",
  "qualified",
  "not_supported",
  "open",
  "excluded",
  "not_applicable",
];
const RELS: Relationship[] = [
  "equal",
  "superset_of",
  "subset_of",
  "intersects_with",
];

function randomScenario(r: Rand, dense: boolean): Scenario {
  const a = tree(r, "a", dense),
    t = tree(r, "t", dense);
  const sources = Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) =>
    src(
      "s" + i,
      pick(r, dense ? [...STATES, "qualified", "not_applicable"] : STATES),
      r() < (dense ? 0.4 : 0.25),
    ),
  );
  const groupBias = dense ? 0.5 : 0.3;
  const aGroups = a.filter((n) => n.type === "group");
  const links = Array.from({ length: 2 + Math.floor(r() * 7) }, () => {
    const target =
      aGroups.length && r() < groupBias ? pick(r, aGroups) : pick(r, a);
    const l = lnk(pick(r, sources).id, target.id, pick(r, RELS));
    if (r() < 0.1) l.clamps = ["draft"];
    return l;
  });
  const entries: Scenario["entries"] = [];
  const tTargets = dense
    ? t.slice(0, Math.max(2, Math.floor(t.length / 2)))
    : t;
  for (let i = 0; i < 1 + Math.floor(r() * 5); i++) {
    const backward = r() < 0.25;
    const sourcesOf = backward
      ? [pick(r, a).id]
      : Array.from({ length: r() < 0.25 ? 2 : 1 }, () => pick(r, a).id);
    entries.push({
      sources: [...new Set(sourcesOf)],
      target: pick(r, tTargets).id,
      relationship: pick(r, RELS),
      rationale: "semantic",
      backward,
    });
  }
  return { a, t, sources, links, entries };
}

/** The patterns of cases 50 to 53, 56 and 57 before their weakening (section 9.8). */
function plant(r: Rand, s: Scenario): Scenario {
  const k = Math.floor(r() * 6);
  const a: RequirementNode[] = [],
    t: RequirementNode[] = [];
  const sources = [
    src("ps", "supported"),
    src("pq", "qualified"),
    src("pna", "not_applicable"),
  ];
  const links: LinkInput[] = [];
  const entries: Scenario["entries"] = [];
  let planted = 0;
  const leafPo = () => {
    a.push(node("po", "requirement"));
    links.push(lnk("ps", "po", "superset_of"));
  };
  if (k === 0) {
    a.push(node("pr", "requirement"));
    leafPo();
    t.push(node("pt", "requirement"));
    planted = links.push(lnk("ps", "pr", "superset_of")) - 1;
    links.push(lnk("pq", "pr", "intersects_with"));
    entries.push(
      {
        sources: ["pr"],
        target: "pt",
        relationship: "superset_of",
        rationale: "semantic",
      },
      {
        sources: ["po"],
        target: "pt",
        relationship: "superset_of",
        rationale: "semantic",
      },
    );
  } else if (k === 1 || k === 2 || k === 3) {
    a.push(node("pg", "group", undefined, k === 3));
    a.push(node("pa", "requirement", "pg"));
    if (k !== 1) {
      a.push(node("pn", "group", "pg", k === 3));
      a.push(node("pnc", "requirement", "pn"));
      links.push(lnk("ps", "pa", "superset_of"));
      if (k === 3) links.push(lnk("pna", "pnc", "equal"));
      else links.push(lnk("ps", "pnc", "superset_of"));
    }
    leafPo();
    t.push(node("pt", "requirement"));
    planted = links.push(lnk("pq", k === 1 ? "pg" : "pn", "superset_of")) - 1;
    entries.push(
      {
        sources: [k === 1 ? "pa" : "pg"],
        target: "pt",
        relationship: "equal",
        rationale: "semantic",
      },
      {
        sources: ["po"],
        target: "pt",
        relationship: "superset_of",
        rationale: "semantic",
      },
    );
  } else {
    a.push(node("pg", "group", undefined, false));
    if (k === 4) a.push(node("pc", "requirement", "pg"));
    else {
      a.push(node("pn", "group", "pg", false));
      a.push(node("pnc", "requirement", "pn"));
    }
    a.push(node("pL", "requirement"));
    links.push(lnk("pna", k === 4 ? "pc" : "pnc", "equal"));
    links.push(lnk("ps", "pL", "superset_of"));
    planted = links.push(lnk("ps", k === 4 ? "pg" : "pn", "superset_of")) - 1;
    t.push(node("ptg", "group", undefined, true));
    t.push(node("pt1", "requirement", "ptg"));
    t.push(node("pt2", "requirement", "ptg"));
    entries.push(
      {
        sources: [k === 4 ? "pc" : "pg"],
        target: "pt1",
        relationship: k === 4 ? "intersects_with" : "equal",
        rationale: "semantic",
      },
      {
        sources: ["pL"],
        target: "pt2",
        relationship: "equal",
        rationale: "semantic",
      },
    );
  }
  return {
    a: [...s.a, ...a],
    t: [...s.t, ...t],
    sources: [...s.sources, ...sources],
    links: [...s.links, ...links],
    entries: [...s.entries, ...entries],
    planted: s.links.length + planted,
  };
}

function run(s: Scenario) {
  const A = evaluate(
    s.a,
    place(s.links, new Map(s.sources.map((x) => [x.id, x]))),
  );
  const forward = s.entries.filter((e) => !e.backward);
  const backward = s.entries
    .filter((e) => e.backward)
    .map((e) => ({ ...e, sources: [e.target], target: e.sources[0] }));
  const T = crosswalkEvaluation(
    { id: "T", requirements: s.t },
    new Map([["A", A]]),
    [
      {
        id: "a-to-t",
        version: "2027.1.0",
        source: { framework: "A" },
        target: { framework: "T" },
        entries: forward,
      },
      // Authored T→A: the engine inverts them.
      {
        id: "t-to-a",
        version: "2027.1.0",
        source: { framework: "T" },
        target: { framework: "A" },
        entries: backward,
      },
    ],
  ).evaluation;
  return { A, T };
}

/** One weakening of section 9.7, invariant 3; null when there is nothing to weaken. */
function weaken(r: Rand, s: Scenario, target?: number): Scenario | null {
  const next = structuredClone(s);
  const lower = (rel: Relationship): Relationship | null =>
    rel === "equal"
      ? "subset_of"
      : rel === "superset_of"
        ? "intersects_with"
        : null;
  if (target !== undefined) {
    const l = next.links[target];
    if (r() < 0.5) l.clamps = ["weakened"];
    else l.relationship = lower(l.relationship) ?? l.relationship;
    return next;
  }
  const kind = Math.floor(r() * 4);
  if (kind === 0) {
    const full = next.links.filter((l) => lower(l.relationship));
    if (!full.length) return null;
    const l = pick(r, full);
    if (r() < 0.5) l.clamps = ["weakened"];
    else l.relationship = lower(l.relationship)!;
  } else if (kind === 1) {
    const full = next.entries.filter((e) => lower(e.relationship));
    if (!full.length) return null;
    const e = pick(r, full);
    e.relationship = lower(e.relationship)!;
  } else if (kind === 2) {
    const concluded = next.sources.filter((x) =>
      ["supported", "qualified"].includes(x.state),
    );
    if (!concluded.length) return null;
    const x = pick(r, concluded);
    x.state =
      x.state === "supported" && r() < 0.5
        ? "qualified"
        : pick(r, ["not_supported", "open"] as const);
  } else {
    const law = next.sources.filter((x) => !x.readiness);
    if (!law.length) return null;
    pick(r, law).readiness = true;
  }
  return next;
}

type Check = { where: string; before: string; after: string };
function compare(
  before: ReturnType<typeof run>,
  after: ReturnType<typeof run>,
) {
  const violations: Check[] = [];
  let exempt = false;
  const readiness: Check[] = [];
  const visit = (name: string, b: Evaluation, a: Evaluation) => {
    for (const [id, x] of a.nodes) {
      const y = b.nodes.get(id)!;
      if (
        x.node.type === "requirement" &&
        y.cell.state === "full" &&
        y.cell.readiness &&
        x.cell.state === "not_applicable"
      )
        exempt = true;
      if (x.cell.state === "full" && y.cell.state !== "full")
        violations.push({
          where: name + " cell " + id,
          before: y.cell.state,
          after: "full",
        });
      else if (x.cell.state === "full" && y.cell.readiness && !x.cell.readiness)
        readiness.push({
          where: name + " cell " + id,
          before: "full (R)",
          after: "full",
        });
    }
    for (const [id, g] of a.groups) {
      const h = b.groups.get(id)!;
      if (g.rollup && !h.rollup)
        violations.push({
          where: name + " roll-up " + id,
          before: "none",
          after: "full",
        });
      else if (g.rollup && h.rollup?.readiness && !g.rollup.readiness)
        readiness.push({
          where: name + " roll-up " + id,
          before: "full (R)",
          after: "full",
        });
      const pa = endpointOf(a, id)!,
        pb = endpointOf(b, id)!;
      if (pa.state === "full" && pb.state !== "full")
        violations.push({
          where: name + " endpoint " + id,
          before: pb.state,
          after: "full",
        });
      else if (pa.state === "full" && pb.readiness && !pa.readiness)
        readiness.push({
          where: name + " endpoint " + id,
          before: "full (R)",
          after: "full",
        });
    }
  };
  visit("A", before.A, after.A);
  visit("T", before.T, after.T);
  return {
    violations: exempt ? violations : [...violations, ...readiness],
    exempt,
  };
}

function property(
  seeds: number[],
  scenarios: number,
  planted: boolean,
  dense: boolean,
) {
  let checks = 0,
    exemptions = 0;
  for (const seed of seeds) {
    const r = prng(seed);
    for (let i = 0; i < scenarios; i++) {
      let s = randomScenario(r, dense);
      let target: number | undefined;
      if (planted && r() < 0.6) {
        s = plant(r, s);
        if (r() < 0.5) target = s.planted;
      }
      const weaker = weaken(r, s, target);
      if (!weaker) continue;
      const before = run(s),
        after = run(weaker);
      const result = compare(before, after);
      checks +=
        before.A.nodes.size + before.T.nodes.size + 2 * before.A.groups.size;
      if (result.exempt) exemptions++;
      if (result.violations.length)
        throw new Error(
          `seed ${seed}, scenario ${i}: ${JSON.stringify(result.violations[0])}\n${JSON.stringify({ s, weaker })}`,
        );
    }
  }
  return { checks, exemptions };
}

describe("invariant 3: weakenings never raise coverage", () => {
  it("holds for the planted generator (seeds 20261105, 7 and 42)", () => {
    const { checks } = property([20261105, 7, 42], 2000, true, false);
    expect(checks).toBeGreaterThan(50000);
  });
  it("holds for the denser generator (seeds 1 to 8)", () => {
    const { checks } = property([1, 2, 3, 4, 5, 6, 7, 8], 1000, false, true);
    expect(checks).toBeGreaterThan(50000);
  });
});
