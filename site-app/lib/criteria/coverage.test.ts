// The golden truth table of docs/design/criteria-model.md section 9.8: the 61
// cases, each on the smallest tree that shows it. Cases about where sources
// come from (12, 13, 37, 38, 43 to 45) are in coverage-sources.test.ts.
import { describe, expect, it } from "vitest";
import {
  crosswalkEvaluation,
  evaluate,
  place,
  type CellState,
  type CoverageSource,
  type CrosswalkInput,
  type Evaluation,
  type LinkInput,
  type SourceState,
} from "./coverage";
import type { Relationship, RequirementNode } from "./types";

export const req = (id: string, parent?: string): RequirementNode => ({
  id,
  ref: id,
  type: "requirement",
  ...(parent ? { parent } : {}),
});
export const grp = (
  id: string,
  exhaustive = false,
  parent?: string,
): RequirementNode => ({
  id,
  ref: id,
  type: "group",
  exhaustive,
  ...(parent ? { parent } : {}),
});
export const src = (
  id: string,
  state: SourceState = "supported",
  readiness = false,
): CoverageSource => ({ id, kind: "procedure", state, readiness, label: id });
export const link = (
  sourceId: string,
  target: string,
  relationship: Relationship = "superset_of",
  extra: Partial<LinkInput> = {},
): LinkInput => ({
  sourceId,
  target,
  relationship,
  rationale: "semantic",
  objectiveId: "CO-" + sourceId,
  ...extra,
});
export function view(
  nodes: RequirementNode[],
  sources: CoverageSource[],
  links: LinkInput[],
): Evaluation {
  return evaluate(nodes, place(links, new Map(sources.map((s) => [s.id, s]))));
}
export const entry = (
  sources: string[],
  target: string,
  relationship: Relationship = "superset_of",
  rationale: "semantic" | "functional" | "syntactic" = "semantic",
) => ({ sources, target, relationship, rationale });
export function cross(
  a: Evaluation,
  t: RequirementNode[],
  entries: CrosswalkInput["entries"],
  direction: "A->T" | "T->A" = "A->T",
  extra: Partial<CrosswalkInput> = {},
) {
  return crosswalkEvaluation(
    { id: "T", requirements: t },
    new Map([["A", a]]),
    [
      {
        id: direction === "A->T" ? "a-to-t" : "t-to-a",
        version: "2027.1.0",
        source: { framework: direction === "A->T" ? "A" : "T" },
        target: { framework: direction === "A->T" ? "T" : "A" },
        entries,
        ...extra,
      },
    ],
  );
}
/** "full", "full (R)", "partial", "partial (R)", ... */
export function show(ev: Evaluation, id: string) {
  const { state, readiness } = ev.nodes.get(id)!.cell;
  return state + (readiness ? " (R)" : "");
}
const rollup = (ev: Evaluation, id: string) => {
  const r = ev.groups.get(id)!.rollup;
  return r ? "full" + (r.readiness ? " (R)" : "") : "none";
};
const states = (ev: Evaluation, ids: string[]) =>
  ids.map((id) => show(ev, id) as CellState | string);

describe("the 61 cases of section 9.8", () => {
  const leaf = [req("r")];
  it.each<[number, string, () => string | string[], string | string[]]>([
    [
      1,
      "superset_of link, source supported",
      () => show(view(leaf, [src("s")], [link("s", "r")]), "r"),
      "full",
    ],
    [
      2,
      "equal link, readiness source supported",
      () =>
        show(
          view(leaf, [src("s", "supported", true)], [link("s", "r", "equal")]),
          "r",
        ),
      "full (R)",
    ],
    [
      3,
      "superset_of link, source qualified",
      () => show(view(leaf, [src("s", "qualified")], [link("s", "r")]), "r"),
      "partial",
    ],
    [
      4,
      "intersects_with link, source supported",
      () =>
        show(view(leaf, [src("s")], [link("s", "r", "intersects_with")]), "r"),
      "partial",
    ],
    [
      5,
      "full link supported, partial link not supported",
      () =>
        show(
          view(
            leaf,
            [src("s"), src("x", "not_supported")],
            [link("s", "r"), link("x", "r", "intersects_with")],
          ),
          "r",
        ),
      "exception",
    ],
    [
      6,
      "full link supported, partial link open",
      () =>
        show(
          view(
            leaf,
            [src("s"), src("x", "open")],
            [link("s", "r"), link("x", "r", "intersects_with")],
          ),
          "r",
        ),
      "open",
    ],
    [
      7,
      "only source excluded",
      () => show(view(leaf, [src("s", "excluded")], [link("s", "r")]), "r"),
      "excluded",
    ],
    [
      8,
      "one excluded, one not applicable",
      () =>
        show(
          view(
            leaf,
            [src("s", "excluded"), src("n", "not_applicable")],
            [link("s", "r"), link("n", "r")],
          ),
          "r",
        ),
      "not_applicable",
    ],
    [9, "no link", () => show(view(leaf, [], []), "r"), "unmapped"],
    [
      10,
      "partial link on a group, source supported",
      () => {
        const ev = view(
          [grp("g"), req("a", "g"), req("b", "g")],
          [src("s")],
          [link("s", "g", "intersects_with")],
        );
        return states(ev, ["a", "b"]);
      },
      ["parent_only", "parent_only"],
    ],
    [
      11,
      "superset_of link on a group, source supported",
      () => {
        const ev = view(
          [grp("g"), req("a", "g"), req("b", "g")],
          [src("s")],
          [link("s", "g")],
        );
        return states(ev, ["a", "b"]);
      },
      ["full", "full"],
    ],
    [
      14,
      "migrated link, source supported",
      () =>
        show(
          view(
            leaf,
            [src("s")],
            [link("s", "r", "intersects_with", { origin: "migrated" })],
          ),
          "r",
        ),
      "partial",
    ],
    [
      15,
      "superset_of link in a draft pack",
      () =>
        show(
          view(
            leaf,
            [src("s")],
            [link("s", "r", "superset_of", { clamps: ["pack draft"] })],
          ),
          "r",
        ),
      "partial",
    ],
    [
      16,
      "same objective links twice (semantic equal, functional intersects_with)",
      () =>
        show(
          view(
            leaf,
            [src("s")],
            [
              link("s", "r", "equal"),
              link("s", "r", "intersects_with", { rationale: "functional" }),
            ],
          ),
          "r",
        ),
      "partial",
    ],
    [
      17,
      "exhaustive group, every child full",
      () =>
        rollup(
          view(
            [grp("g", true), req("a", "g"), req("b", "g")],
            [src("s")],
            [link("s", "a"), link("s", "b")],
          ),
          "g",
        ),
      "full",
    ],
    [
      18,
      "non-exhaustive group, every listed child full",
      () =>
        rollup(
          view(
            [grp("g"), req("a", "g"), req("b", "g")],
            [src("s")],
            [link("s", "a"), link("s", "b")],
          ),
          "g",
        ),
      "none",
    ],
    [
      19,
      "crosswalk A→T superset_of, A cell full",
      () =>
        show(
          cross(
            view(leaf, [src("s")], [link("s", "r")]),
            [req("t")],
            [entry(["r"], "t")],
          ).evaluation,
          "t",
        ),
      "full",
    ],
    [
      20,
      "crosswalk A→T superset_of, A cell partial",
      () =>
        show(
          cross(
            view(leaf, [src("s")], [link("s", "r", "intersects_with")]),
            [req("t")],
            [entry(["r"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      21,
      "crosswalk A→T subset_of, A cell full",
      () =>
        show(
          cross(
            view(leaf, [src("s")], [link("s", "r")]),
            [req("t")],
            [entry(["r"], "t", "subset_of")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      22,
      "authored T→A 'T1 subset_of R5', used inverted, R5 full",
      () =>
        show(
          cross(
            view([req("R5")], [src("s")], [link("s", "R5")]),
            [req("T1")],
            [entry(["T1"], "R5", "subset_of")],
            "T->A",
          ).evaluation,
          "T1",
        ),
      "full",
    ],
    [
      23,
      "joint sources superset_of, every source full",
      () =>
        show(
          cross(
            view(
              [req("r1"), req("r2")],
              [src("s")],
              [link("s", "r1"), link("s", "r2")],
            ),
            [req("t")],
            [entry(["r1", "r2"], "t")],
          ).evaluation,
          "t",
        ),
      "full",
    ],
    [
      24,
      "joint sources superset_of, one source partial",
      () =>
        show(
          cross(
            view(
              [req("r1"), req("r2")],
              [src("s")],
              [link("s", "r1"), link("s", "r2", "intersects_with")],
            ),
            [req("t")],
            [entry(["r1", "r2"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      25,
      "authored T-side entry with two sources, viewed from A",
      () => {
        const result = cross(
          view([req("r")], [src("s")], [link("s", "r")]),
          [req("t1"), req("t2")],
          [entry(["t1", "t2"], "r", "subset_of")],
          "T->A",
        );
        return [show(result.evaluation, "t1"), result.unusable[0].reason];
      },
      ["unmapped", "not_invertible"],
    ],
    [
      26,
      "syntactic-only entry",
      () => {
        const result = cross(
          view(leaf, [src("s")], [link("s", "r")]),
          [req("t")],
          [entry(["r"], "t", "equal", "syntactic")],
        );
        return [show(result.evaluation, "t"), result.unusable[0].reason];
      },
      ["unmapped", "syntactic"],
    ],
    [
      27,
      "A-side exception through any relationship",
      () =>
        show(
          cross(
            view(
              leaf,
              [src("s", "not_supported")],
              [link("s", "r", "intersects_with")],
            ),
            [req("t")],
            [entry(["r"], "t", "intersects_with")],
          ).evaluation,
          "t",
        ),
      "exception",
    ],
    [
      28,
      "crosswalk to a T group with superset_of, A full",
      () => {
        const t = [grp("tg"), req("t1", "tg"), req("t2", "tg")];
        return states(
          cross(view(leaf, [src("s")], [link("s", "r")]), t, [
            entry(["r"], "tg"),
          ]).evaluation,
          ["t1", "t2"],
        );
      },
      ["full", "full"],
    ],
    [
      29,
      "crosswalk to a T group with intersects_with, A full",
      () => {
        const t = [grp("tg"), req("t1", "tg"), req("t2", "tg")];
        return states(
          cross(view(leaf, [src("s")], [link("s", "r")]), t, [
            entry(["r"], "tg", "intersects_with"),
          ]).evaluation,
          ["t1", "t2"],
        );
      },
      ["parent_only", "parent_only"],
    ],
    [
      30,
      "A→B and B→T exist, no A→T",
      () => {
        const a = view(leaf, [src("s")], [link("s", "r")]);
        const result = crosswalkEvaluation(
          { id: "T", requirements: [req("t")] },
          new Map([["A", a]]),
          [
            {
              id: "a-to-b",
              version: "2027.1.0",
              source: { framework: "A" },
              target: { framework: "B" },
              entries: [entry(["r"], "b")],
            },
            {
              id: "b-to-t",
              version: "2027.1.0",
              source: { framework: "B" },
              target: { framework: "T" },
              entries: [entry(["b"], "t")],
            },
          ],
        );
        return show(result.evaluation, "t");
      },
      "unmapped",
    ],
    [
      31,
      "exhaustive A group fully covered used as a crosswalk source",
      () =>
        show(
          cross(
            view(
              [grp("g", true), req("a", "g"), req("b", "g")],
              [src("s")],
              [link("s", "a"), link("s", "b")],
            ),
            [req("t")],
            [entry(["g"], "t")],
          ).evaluation,
          "t",
        ),
      "full",
    ],
    [
      32,
      "non-exhaustive A group, all listed children full, used as a source",
      () =>
        show(
          cross(
            view(
              [grp("g"), req("a", "g"), req("b", "g")],
              [src("s")],
              [link("s", "a"), link("s", "b")],
            ),
            [req("t")],
            [entry(["g"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      33,
      "partial group link not supported, child with its own full link",
      () =>
        show(
          view(
            [grp("g"), req("a", "g")],
            [src("x", "not_supported"), src("s")],
            [link("x", "g", "intersects_with"), link("s", "a")],
          ),
          "a",
        ),
      "exception",
    ],
    [
      34,
      "partial group link whose source is still open",
      () =>
        states(
          view(
            [grp("g"), req("a", "g"), req("b", "g")],
            [src("x", "open")],
            [link("x", "g", "intersects_with")],
          ),
          ["a", "b"],
        ),
      ["open", "open"],
    ],
    [
      35,
      "equal readiness + intersects_with applicable-law",
      () =>
        show(
          view(
            leaf,
            [src("r1", "supported", true), src("l")],
            [link("r1", "r", "equal"), link("l", "r", "intersects_with")],
          ),
          "r",
        ),
      "full (R)",
    ],
    [
      36,
      "equal readiness + superset_of applicable-law",
      () =>
        show(
          view(
            leaf,
            [src("r1", "supported", true), src("l")],
            [link("r1", "r", "equal"), link("l", "r")],
          ),
          "r",
        ),
      "full",
    ],
    [
      39,
      "equal supported + superset_of qualified",
      () =>
        show(
          view(
            leaf,
            [src("s"), src("q", "qualified")],
            [link("s", "r", "equal"), link("q", "r")],
          ),
          "r",
        ),
      "partial",
    ],
    [
      40,
      "equal supported + intersects_with qualified",
      () =>
        show(
          view(
            leaf,
            [src("s"), src("q", "qualified")],
            [link("s", "r", "equal"), link("q", "r", "intersects_with")],
          ),
          "r",
        ),
      "partial",
    ],
    [
      41,
      "intersects_with group link qualified, child with its own full link",
      () =>
        show(
          view(
            [grp("g"), req("a", "g")],
            [src("q", "qualified"), src("s")],
            [link("q", "g", "intersects_with"), link("s", "a")],
          ),
          "a",
        ),
      "partial",
    ],
    [
      42,
      "intersects_with group link qualified, child without a link",
      () =>
        show(
          view(
            [grp("g"), req("a", "g")],
            [src("q", "qualified")],
            [link("q", "g", "intersects_with")],
          ),
          "a",
        ),
      "parent_only",
    ],
    [
      46,
      "crosswalk A→T superset_of, A cell full (readiness)",
      () =>
        show(
          cross(
            view(leaf, [src("s", "supported", true)], [link("s", "r")]),
            [req("t")],
            [entry(["r"], "t")],
          ).evaluation,
          "t",
        ),
      "full (R)",
    ],
    [
      47,
      "joint sources superset_of, all full, one readiness",
      () =>
        show(
          cross(
            view(
              [req("r1"), req("r2")],
              [src("s"), src("z", "supported", true)],
              [link("s", "r1"), link("z", "r2")],
            ),
            [req("t")],
            [entry(["r1", "r2"], "t")],
          ).evaluation,
          "t",
        ),
      "full (R)",
    ],
    [
      48,
      "non-exhaustive A group with its own superset_of link, crossed equal",
      () =>
        show(
          cross(
            view([grp("g"), req("a", "g")], [src("s")], [link("s", "g")]),
            [req("t")],
            [entry(["g"], "t", "equal")],
          ).evaluation,
          "t",
        ),
      "full",
    ],
    [
      49,
      "A partial by a qualified source, crossed superset_of, plus another full entry",
      () =>
        show(
          cross(
            view(
              [req("r"), req("o")],
              [src("s"), src("q", "qualified")],
              [
                link("s", "r"),
                link("q", "r", "intersects_with"),
                link("s", "o"),
              ],
            ),
            [req("t")],
            [entry(["r"], "t"), entry(["o"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      50,
      "as 49 with the supported link weakened to intersects_with",
      () =>
        show(
          cross(
            view(
              [req("r"), req("o")],
              [src("s"), src("q", "qualified")],
              [
                link("s", "r", "intersects_with"),
                link("q", "r", "intersects_with"),
                link("s", "o"),
              ],
            ),
            [req("t")],
            [entry(["r"], "t"), entry(["o"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      51,
      "capped parent_only child crossed equal, plus another full entry",
      () =>
        show(
          cross(
            view(
              [grp("g"), req("a", "g"), req("o")],
              [src("q", "qualified"), src("s")],
              [link("q", "g", "intersects_with"), link("s", "o")],
            ),
            [req("t")],
            [entry(["a"], "t", "equal"), entry(["o"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      52,
      "group with a capped nested member crossed equal, plus another full entry",
      () =>
        show(
          cross(
            view(
              [
                grp("g"),
                req("a", "g"),
                grp("n", false, "g"),
                req("nc", "n"),
                req("o"),
              ],
              [src("s"), src("q", "qualified")],
              [
                link("s", "a"),
                link("q", "n", "intersects_with"),
                link("s", "nc"),
                link("s", "o"),
              ],
            ),
            [req("t")],
            [entry(["g"], "t", "equal"), entry(["o"], "t")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      53,
      "exhaustive nested group capped, its child only not applicable",
      () => {
        const ev = view(
          [grp("g", true), req("a", "g"), grp("n", true, "g"), req("nc", "n")],
          [src("s"), src("q", "qualified"), src("na", "not_applicable")],
          [
            link("s", "a"),
            link("q", "n", "intersects_with"),
            link("na", "nc", "equal"),
          ],
        );
        return [
          show(ev, "nc"),
          String(ev.nodes.get("nc")!.cell.capped),
          rollup(ev, "g"),
        ];
      },
      ["not_applicable", "true", "none"],
    ],
    [
      54,
      "exhaustive group with not-applicable and readiness group links",
      () => {
        const ev = view(
          [grp("g", true), req("c1", "g"), req("c2", "g")],
          [src("l"), src("na", "not_applicable"), src("rd", "supported", true)],
          [
            link("l", "c1", "equal"),
            link("na", "g", "equal"),
            link("rd", "g", "equal"),
          ],
        );
        return [show(ev, "c2"), rollup(ev, "g")];
      },
      ["full (R)", "full (R)"],
    ],
    [
      55,
      "as 54 with the readiness link weakened (the exception to invariant 3)",
      () => {
        const ev = view(
          [grp("g", true), req("c1", "g"), req("c2", "g")],
          [src("l"), src("na", "not_applicable"), src("rd", "supported", true)],
          [
            link("l", "c1", "equal"),
            link("na", "g", "equal"),
            link("rd", "g", "intersects_with"),
          ],
        );
        return [show(ev, "c2"), rollup(ev, "g")];
      },
      ["not_applicable", "full"],
    ],
    [
      56,
      "non-exhaustive A group, child not applicable crossed partially to t1",
      () => {
        const a = view(
          [grp("g"), req("c", "g"), req("L")],
          [src("s"), src("na", "not_applicable")],
          [
            link("s", "g", "intersects_with"),
            link("na", "c", "equal"),
            link("s", "L"),
          ],
        );
        const t = [grp("tg", true), req("t1", "tg"), req("t2", "tg")];
        const ev = cross(a, t, [
          entry(["c"], "t1", "intersects_with"),
          entry(["L"], "t2", "equal"),
        ]).evaluation;
        return [show(ev, "t1"), rollup(ev, "tg")];
      },
      ["not_applicable", "none"],
    ],
    [
      57,
      "nested group with a partial link, its child not applicable, G crossed equal",
      () => {
        const a = view(
          [grp("g"), grp("n", false, "g"), req("nc", "n"), req("L")],
          [src("s"), src("na", "not_applicable")],
          [
            link("s", "n", "intersects_with"),
            link("na", "nc", "equal"),
            link("s", "L"),
          ],
        );
        const t = [grp("tg", true), req("t1", "tg"), req("t2", "tg")];
        const ev = cross(a, t, [
          entry(["g"], "t1", "equal"),
          entry(["L"], "t2", "equal"),
        ]).evaluation;
        return [show(ev, "t1"), rollup(ev, "tg")];
      },
      ["not_applicable", "none"],
    ],
    [
      58,
      "exhaustive group, other child only partially not applicable",
      () => {
        const ev = view(
          [grp("g", true), req("c1", "g"), req("c2", "g")],
          [src("s"), src("na", "not_applicable")],
          [link("s", "c1"), link("na", "c2", "intersects_with")],
        );
        return [show(ev, "c2"), rollup(ev, "g")];
      },
      ["not_applicable", "none"],
    ],
    [
      59,
      "exhaustive group with a non-exhaustive nested group, crossed equal",
      () => {
        const a = view(
          [
            grp("g", true),
            req("c1", "g"),
            grp("n", false, "g"),
            req("nc", "n"),
          ],
          [src("s")],
          [link("s", "c1"), link("s", "nc")],
        );
        return [
          rollup(a, "g"),
          show(
            cross(a, [req("t")], [entry(["g"], "t", "equal")]).evaluation,
            "t",
          ),
        ];
      },
      ["none", "partial"],
    ],
    [
      60,
      "group whose only evidence is its own intersects_with link, crossed equal",
      () =>
        show(
          cross(
            view(
              [grp("g"), req("a", "g")],
              [src("s")],
              [link("s", "g", "intersects_with")],
            ),
            [req("t")],
            [entry(["g"], "t", "equal")],
          ).evaluation,
          "t",
        ),
      "partial",
    ],
    [
      61,
      "as 59 with an equal link on the nested group from a readiness source",
      () => {
        const a = view(
          [
            grp("g", true),
            req("c1", "g"),
            grp("n", false, "g"),
            req("nc", "n"),
          ],
          [src("s"), src("rd", "supported", true)],
          [link("s", "c1"), link("s", "nc"), link("rd", "n", "equal")],
        );
        return [
          rollup(a, "g"),
          show(
            cross(a, [req("t")], [entry(["g"], "t", "equal")]).evaluation,
            "t",
          ),
        ];
      },
      ["full (R)", "full (R)"],
    ],
  ])("case %i: %s", (_, __, run, expected) => {
    expect(run()).toEqual(expected);
  });
});

describe("crosswalk orientation and bookkeeping", () => {
  it("inverts single-source entries exactly and counts unresolved endpoints", () => {
    const a = view([req("r")], [src("s")], [link("s", "r")]);
    const result = cross(
      a,
      [req("t")],
      [
        entry(["t"], "r", "superset_of"),
        entry(["t"], "missing", "equal"),
        entry(["nope"], "r", "equal"),
      ],
      "T->A",
    );
    // t superset_of r inverts to r subset_of t: partial.
    expect(show(result.evaluation, "t")).toBe("partial");
    expect(result.unusable.map((u) => u.reason).sort()).toEqual([
      "unresolved_source",
      "unresolved_target",
    ]);
  });

  it("keeps the weakest strength per pair and never lets a legal effect raise a state", () => {
    const a = view([req("r")], [src("s")], [link("s", "r")]);
    const result = crosswalkEvaluation(
      { id: "T", requirements: [req("t")] },
      new Map([["A", a]]),
      [
        {
          id: "a-to-t",
          version: "2027.1.0",
          source: { framework: "A" },
          target: { framework: "T" },
          entries: [
            entry(["r"], "t", "equal", "semantic"),
            {
              ...entry(["r"], "t", "intersects_with", "functional"),
              legalEffect: { kind: "presumption_of_conformity" },
            },
          ],
        },
      ],
    );
    expect(show(result.evaluation, "t")).toBe("partial");
    expect(result.legalEffects.get("t")).toHaveLength(1);
  });

  it("clamps entries of a draft crosswalk", () => {
    const a = view([req("r")], [src("s")], [link("s", "r")]);
    expect(
      show(
        cross(a, [req("t")], [entry(["r"], "t")], "A->T", {
          clamps: ["crosswalk draft"],
        }).evaluation,
        "t",
      ),
    ).toBe("partial");
  });

  it("counts readiness apart and never adds partial to covered", () => {
    const ev = view(
      [req("a"), req("b"), req("c"), req("d")],
      [src("s"), src("rd", "supported", true)],
      [link("s", "a"), link("rd", "b"), link("s", "c", "intersects_with")],
    );
    const counts = [...ev.nodes.values()].reduce(
      (n, r) => ({ ...n, [r.cell.state]: (n[r.cell.state] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    expect(counts).toEqual({ full: 2, partial: 1, unmapped: 1 });
  });
});
