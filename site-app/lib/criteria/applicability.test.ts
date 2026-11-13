// Requirement-level applicability derived from the rule pack's dated entries
// (#135, docs/design/criteria-model.md sections 5.1 and 11.1): the provision
// parser, the mapping onto pack #1's framework, inheritance by subitems, the
// "derived, not reviewed" marking and the coverage view that carries them.
import { describe, expect, it } from "vitest";
import { freshEngagement } from "../factories";
import {
  datesFramework,
  deriveApplicability,
  effectiveRows,
  provisionTargets,
  type DatedSnapshot,
} from "./applicability";
import { criteriaRegistry, pinned, resolveNew } from "./pin";
import type { FrameworkDocument } from "./types";
import { coverageFor } from "./views";

const KEY = "eu-ai-act@02024R1689-20260727";
const current = () => {
  const resolved = resolveNew();
  return {
    fw: resolved.frameworks[0],
    snapshot: resolved.pack.compat!.catalog!
      .regulatorySnapshot as unknown as DatedSnapshot,
  };
};

describe("provisionTargets", () => {
  it.each([
    ["Art 4", [{ kind: "article", article: "4", paragraphs: [] }]],
    ["Art 4a(1)", [{ kind: "article", article: "4a", paragraphs: ["1"] }]],
    [
      "Art 5(2) to (8)",
      [
        {
          kind: "article",
          article: "5",
          paragraphs: ["2", "3", "4", "5", "6", "7", "8"],
        },
      ],
    ],
    [
      "Art 50(5) and (6)",
      [{ kind: "article", article: "50", paragraphs: ["5", "6"] }],
    ],
    [
      "Chapter III Section 2 (Arts 8 to 15)",
      ["8", "9", "10", "11", "12", "13", "14", "15"].map((article) => ({
        kind: "article",
        article,
        paragraphs: [],
      })),
    ],
    [
      "Chapter XII (Arts 99 and 100)",
      [
        { kind: "article", article: "99", paragraphs: [] },
        { kind: "article", article: "100", paragraphs: [] },
      ],
    ],
    ["Annex I", [{ kind: "annex", annex: "I" }]],
  ])("%s", (provision, targets) => {
    expect(provisionTargets(provision)).toEqual(targets);
  });

  it("ignores the carve-out after 'except'", () => {
    expect(
      provisionTargets("Chapter III Section 1 (Arts 6 and 7, except Art 6(5))"),
    ).toEqual([
      { kind: "article", article: "6", paragraphs: [] },
      { kind: "article", article: "7", paragraphs: [] },
    ]);
  });

  it("does not date a deleted provision", () => {
    expect(provisionTargets("Art 10(5) deleted")).toEqual([]);
  });

  it("names nothing for a provision of another act", () => {
    expect(provisionTargets("Regulation (EU) 2026/1744, Art 4")).toEqual([]);
    expect(
      provisionTargets("Regulation (EU) 2024/1689, Arts 102 to 103"),
    ).toHaveLength(2);
  });

  it("names nothing for a provision without article or annex numbers", () => {
    // Art 113 is the cross reference, not the provision dated.
    expect(
      provisionTargets(
        "Every provision not covered by Art 113, third paragraph, points (a) to (d)",
      ),
    ).toEqual([]);
    expect(provisionTargets("Chapter V")).toEqual([]);
  });
});

describe("deriveApplicability on pack #1", () => {
  const { fw, snapshot } = current();
  const { rows, unmapped } = deriveApplicability(fw, snapshot);
  const rowsOf = (id: string) => effectiveRows(fw, rows, id);

  it("dates the framework the rule pack is about, and no other", () => {
    expect(datesFramework(fw, snapshot)).toBe(true);
    expect(datesFramework({ ...fw, edition: "2023" }, snapshot)).toBe(false);
    expect(
      datesFramework({ ...fw, kind: "international_standard" }, snapshot),
    ).toBe(false);
    expect(datesFramework(fw, null)).toBe(false);
  });

  it("maps paragraph provisions to paragraph nodes", () => {
    const art50 = rowsOf("AIA-50-2");
    expect(art50.map((r) => [r.from, r.derived.entryId])).toEqual([
      ["2026-08-02", "aia-2026-08-02-art50-transparency"],
      ["2026-12-02", "aia-2026-12-02-art50-2-legacy-transition"],
    ]);
    // Art 50(1) is not named by the legacy transition.
    expect(rowsOf("AIA-50-1").map((r) => r.from)).toEqual(["2026-08-02"]);
    // "Art 50(5) and (6)" has a node for (5): (6) is not spread to Art 50.
    expect(rows.get("AIA-ART-50")).toBeUndefined();
  });

  it("does not spread a paragraph to sibling subitems", () => {
    // "Art 10(1) and (6) as replaced": only Art 10(6) has a node.
    expect(rowsOf("AIA-10-6").map((r) => r.derived.entryId)).toContain(
      "aia-2026-07-27-art4a-bias-data",
    );
    expect(rowsOf("AIA-10-3").map((r) => r.derived.entryId)).not.toContain(
      "aia-2026-07-27-art4a-bias-data",
    );
  });

  it("lets subitems inherit the dates of their article, marked as inherited", () => {
    const sub = rowsOf("AIA-9-1");
    expect(sub.map((r) => r.from)).toEqual(["2027-12-02", "2028-08-02"]);
    expect(sub.every((r) => r.inheritedFrom === "Art. 9")).toBe(true);
    // The article's own rows are not marked as inherited.
    expect(rowsOf("AIA-ART-9").every((r) => !r.inheritedFrom)).toBe(true);
  });

  it("marks every row as derived and not reviewed", () => {
    const all = [...rows.values()].flat();
    expect(all.length).toBeGreaterThan(20);
    for (const r of all) {
      expect(r.derived.reviewed).toBe(false);
      expect(r.derived.rulePackVersion).toBe(snapshot.rulePackVersion);
      expect(r.provenance).toMatchObject({
        verification: "unverified",
        legalReview: "required",
        sourceKind: "rule_pack_entry",
      });
      expect(r.provenance.note).toContain("has not been reviewed");
    }
  });

  it("lists the provisions no requirement matches, for review", () => {
    const provisions = unmapped.map((u) => u.provision);
    expect(provisions).toContain("Regulation (EU) 2026/1744, Art 4");
    expect(provisions).toContain("Arts 51 to 56 (Chapter V)");
    // Every unmapped provision really maps nowhere.
    for (const u of unmapped)
      expect(
        [...rows.values()]
          .flat()
          .some((r) => r.derived.provision === u.provision),
      ).toBe(false);
  });

  it("does not map one entry twice to a node", () => {
    for (const list of rows.values()) {
      const ids = list.map((r) => r.derived.entryId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("works on a framework without matching refs", () => {
    const empty = { ...fw, requirements: [] } as FrameworkDocument;
    const derived = deriveApplicability(empty, snapshot);
    expect(derived.rows.size).toBe(0);
    expect(derived.unmapped.length).toBe(
      snapshot.applicationDates.flatMap((e) => e.provisions).length,
    );
  });
});

describe("the coverage view carries derived rows", () => {
  it("adds actors, derived rows and a banner without changing any state", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const view = coverageFor(criteriaRegistry(), pinned(e), e, [], KEY)!;
    const cell = (id: string) => view.cells.find((c) => c.id === id)!;
    expect(cell("AIA-50-1").actors).toEqual(["Provider"]);
    expect(cell("AIA-9-1").derivedApplicability?.[0]).toMatchObject({
      from: "2027-12-02",
      inheritedFrom: "Art. 9",
      derived: { reviewed: false },
    });
    const banner = view.banners.find((b) => b.id === "derived-applicability");
    expect(banner?.text).toContain("derived, not reviewed");
    expect(banner?.text).toContain("do not change any coverage state");
    // Art 113 is only ever a cross reference in the rule pack's provisions.
    expect(cell("AIA-ART-113").derivedApplicability).toBeUndefined();
  });

  it("derives nothing for a pack without a rule pack", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const resolved = pinned(e);
    const bare = {
      ...resolved,
      pack: { ...resolved.pack, compat: undefined },
    };
    const view = coverageFor(criteriaRegistry(), bare, e, [], KEY)!;
    expect(view.cells.some((c) => c.derivedApplicability)).toBe(false);
    expect(view.banners.map((b) => b.id)).not.toContain(
      "derived-applicability",
    );
  });
});
