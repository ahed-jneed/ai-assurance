// The NIST AI RMF 1.0 and AI 600-1 crosswalk-only pack (#29): the committed
// documents validate and every crosswalk endpoint exists; every entry is
// typed, justified and partial; and the coverage views they add to AI Act
// engagements (and, once #28 is released, to management-system engagements)
// never show a NIST outcome as fully covered (golden).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkCriteria,
  compareVersions,
  loadValidator,
  readCriteria,
} from "../../../schemas/validate-criteria.mjs";
import type { Engagement } from "../domain";
import { freshEngagement } from "../factories";
import type { ObligationRecord } from "./coverage-sources";
import generated from "./bundle.generated.json";
import { criteriaRegistry, injectRegistry, pinned, resolveNew } from "./pin";
import { registry, selectablePacks } from "./registry";
import { withManagementSystemPack } from "./test-bundles";
import type {
  Bundle,
  CrosswalkDocument,
  FrameworkDocument,
  IndexEntry,
  PackDocument,
} from "./types";
import { coverageFor, offeredViews } from "./views";

const AIA = "eu-ai-act@02024R1689-20260727";
const RMF = "nist-ai-rmf@1.0";
const GAI = "nist-ai-600-1@2024-07";
const criteria = readCriteria();
const ours = (e: IndexEntry) => e.id.startsWith("nist-");
const entries = (criteria.index.documents as IndexEntry[]).filter(ours);
const docOf = <T>(e: IndexEntry) => criteria.documents.get(e.path) as T;
const crosswalks = entries
  .filter((e) => e.documentType === "crosswalk")
  .map((e) => docOf<CrosswalkDocument>(e));

/** The latest data version of an edition, drafts included. */
function latest(framework: string, edition: string): FrameworkDocument {
  const e = (criteria.index.documents as IndexEntry[])
    .filter(
      (e) =>
        e.documentType === "framework" &&
        e.id === framework &&
        e.edition === edition,
    )
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  return docOf<FrameworkDocument>(e);
}

describe("the committed #29 documents", () => {
  it("validate against the schema and the integrity rules", () => {
    expect(checkCriteria({ ...criteria, validate: loadValidator() })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("release the NIST frameworks, the AI Act crosswalks and the pack; keep the crosswalks into the #28 drafts as drafts", () => {
    expect(
      entries.map((e) => [e.documentType, e.id, e.status, e.approvals?.[0]]),
    ).toEqual([
      ["framework", "nist-ai-rmf", "released", expect.anything()],
      ["framework", "nist-ai-600-1", "released", expect.anything()],
      ["crosswalk", "nist-ai-rmf-to-eu-ai-act", "released", expect.anything()],
      [
        "crosswalk",
        "nist-ai-600-1-to-eu-ai-act",
        "released",
        expect.anything(),
      ],
      ["crosswalk", "nist-ai-rmf-to-iso-iec-42001", "draft", undefined],
      ["crosswalk", "nist-ai-rmf-to-en-18286", "draft", undefined],
      ["pack", "nist-ai-rmf", "released", expect.anything()],
    ]);
    // D-08: the methodology owner releases packs, crosswalks and
    // non-legislation frameworks; no entry has a legal effect.
    for (const e of entries.filter((e) => e.status === "released")) {
      expect(e.approvals).toEqual([
        expect.objectContaining({ role: "methodology_owner" }),
      ]);
      expect(e).not.toHaveProperty("legalReview");
    }
    const bundled = (generated as unknown as Bundle).documents.map((d) => d.id);
    expect(bundled).toEqual(
      expect.arrayContaining([
        "nist-ai-rmf",
        "nist-ai-600-1",
        "nist-ai-rmf-to-eu-ai-act",
        "nist-ai-600-1-to-eu-ai-act",
      ]),
    );
    expect(bundled).not.toContain("nist-ai-rmf-to-iso-iec-42001");
    expect(bundled).not.toContain("nist-ai-rmf-to-en-18286");
  });

  it("hold the AI RMF Core structure checked against NIST AI 100-1", () => {
    const rmf = latest("nist-ai-rmf", "1.0");
    const by = (type: string) =>
      rmf.requirements.filter((n) => n.type === type);
    expect(by("requirement")).toHaveLength(72);
    expect(by("group").map((n) => n.id)).toEqual([
      "GV",
      "GV-1",
      "GV-2",
      "GV-3",
      "GV-4",
      "GV-5",
      "GV-6",
      "MP",
      "MP-1",
      "MP-2",
      "MP-3",
      "MP-4",
      "MP-5",
      "MS",
      "MS-1",
      "MS-2",
      "MS-3",
      "MS-4",
      "MG",
      "MG-1",
      "MG-2",
      "MG-3",
      "MG-4",
    ]);
    const count = (prefix: string) =>
      by("requirement").filter((n) => n.parent === prefix).length;
    expect(
      ["GV", "MP", "MS", "MG"].map((f) =>
        [1, 2, 3, 4, 5, 6, 7].map((c) => count(`${f}-${c}`)),
      ),
    ).toEqual([
      [7, 3, 2, 3, 2, 2, 0],
      [6, 3, 5, 2, 2, 0, 0],
      [3, 13, 3, 3, 0, 0, 0],
      [4, 4, 2, 3, 0, 0, 0],
    ]);
    expect(rmf.requirements.find((n) => n.id === "MS-2.11")).toMatchObject({
      ref: "MEASURE 2.11",
      parent: "MS-2",
    });
    expect(rmf.defaultProvenance).toMatchObject({
      verification: "verified",
      sourceKind: "authentic_text",
      source: "https://doi.org/10.6028/NIST.AI.100-1",
    });
    const gai = latest("nist-ai-600-1", "2024-07");
    expect(
      gai.requirements
        .filter((n) => n.type === "requirement")
        .map((n) => n.ref),
    ).toEqual([
      "2.1",
      "2.2",
      "2.3",
      "2.4",
      "2.5",
      "2.6",
      "2.7",
      "2.8",
      "2.9",
      "2.10",
      "2.11",
      "2.12",
    ]);
    for (const fw of [rmf, gai]) {
      expect(fw.licence).toMatchObject({
        textPolicy: "full_text",
        status: "confirmed",
      });
      // Short and sourced: our own titles, no publication text.
      for (const n of fw.requirements) {
        expect(n).not.toHaveProperty("text");
        expect(n.title!.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it("give every entry a relationship, a rationale and a justification, and never a full one", () => {
    expect(crosswalks.map((c) => [c.id, c.entries.length])).toEqual([
      ["nist-ai-rmf-to-eu-ai-act", 39],
      ["nist-ai-600-1-to-eu-ai-act", 12],
      ["nist-ai-rmf-to-iso-iec-42001", 30],
      ["nist-ai-rmf-to-en-18286", 6],
    ]);
    for (const c of crosswalks) {
      expect(c.method).toBe("human");
      expect(
        (c as unknown as { useCase: { assumptions: string } }).useCase
          .assumptions,
      ).toMatch(/intersects_with/);
      for (const x of c.entries) {
        // Single-source, so each entry can be read in both directions.
        expect(x.sources).toHaveLength(1);
        expect(x.relationship).toBe("intersects_with");
        expect(x.rationale).toBe("semantic");
        expect(x.justification.length).toBeGreaterThan(40);
        expect(["medium", "low"]).toContain(x.confidence);
        expect(x).not.toHaveProperty("legalEffect");
      }
    }
    // Clause structure from a secondary source: low confidence only.
    expect(
      crosswalks
        .find((c) => c.id === "nist-ai-rmf-to-en-18286")!
        .entries.every((x) => x.confidence === "low"),
    ).toBe(true);
  });

  it("resolve every source and target in the latest data version of its edition", () => {
    for (const c of crosswalks) {
      const ids = (side: { framework: string; edition: string }) =>
        new Set(
          latest(side.framework, side.edition).requirements.map((n) => n.id),
        );
      const sources = ids(c.source),
        targets = ids(c.target);
      const targetNodes = latest(
        c.target.framework,
        c.target.edition,
      ).requirements;
      for (const x of c.entries) {
        for (const s of x.sources)
          expect(sources, `${c.id} ${x.id}`).toContain(s);
        expect(targets, `${c.id} ${x.id}`).toContain(x.target);
        // Requirement endpoints only: no group roll-up through a NIST link.
        expect(targetNodes.find((n) => n.id === x.target)!.type).toBe(
          "requirement",
        );
      }
    }
  });

  it("rejects an entry whose target does not exist (rule 9)", () => {
    const c = structuredClone(criteria);
    const doc = c.documents.get(
      "crosswalks/nist-ai-600-1-to-eu-ai-act/2026.11.0.json",
    );
    doc.entries[0].target = "AIA-ART-55";
    doc.entries[1].sources = ["2.13"];
    expect(checkCriteria({ ...c, validate: loadValidator() }).errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /rule 9: crosswalk nist-ai-600-1-to-eu-ai-act 2026.11.0: entry X1 target AIA-ART-55 is not in eu-ai-act/,
        ),
        expect.stringMatching(
          /entry X2 source 2.13 is not in nist-ai-600-1@2024-07/,
        ),
      ]),
    );
  });

  it("is a crosswalk-only pack that lists only released crosswalks and is never selectable", () => {
    const pack = docOf<PackDocument>(
      entries.find((e) => e.documentType === "pack")!,
    );
    expect(pack).toMatchObject({
      kind: "crosswalk_only",
      items: [],
      controlObjectives: [],
      crosswalks: [
        { id: "nist-ai-rmf-to-eu-ai-act", version: "2026.11.0" },
        { id: "nist-ai-600-1-to-eu-ai-act", version: "2026.11.0" },
      ],
    });
    expect(selectablePacks(registry()).map((p) => p.id)).not.toContain(
      "nist-ai-rmf",
    );
  });
});

/** Confirmed, supported obligation records on the given AI Act codes. */
const records = (codes: string[]): ObligationRecord[] =>
  codes.map((code, i) => ({
    id: `OB-${i + 1}`,
    code,
    applicability: "applicable",
    outcome: "supported",
    confirmed: true,
  }));
const cellsOf = (view: { cells: unknown[] }) =>
  view.cells as {
    id: string;
    type: string;
    state: string;
    readiness: boolean;
  }[];
const state = (view: { cells: unknown[] }, id: string) =>
  cellsOf(view).find((c) => c.id === id)!.state;

describe("the NIST views of an AI Act engagement (golden)", () => {
  const aiAct = () =>
    freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
  const view = (e: Engagement, rs: ObligationRecord[], key: string) =>
    coverageFor(criteriaRegistry(), pinned(e), e, rs, key)!;

  it("offers both NIST views and names the crosswalks it uses", () => {
    const e = aiAct();
    expect(
      offeredViews(criteriaRegistry(), pinned(e)).map((v) => [v.key, v.kind]),
    ).toEqual([
      [AIA, "criteria"],
      [RMF, "crosswalk"],
      [GAI, "crosswalk"],
    ]);
    const rmf = view(e, [], RMF);
    expect(rmf.versions).toEqual({
      framework: "2026.11.0",
      crosswalks: [{ id: "nist-ai-rmf-to-eu-ai-act", version: "2026.11.0" }],
    });
    expect(rmf.unusableEntries).toEqual([]);
    expect(rmf.banners.find((b) => b.id === "crosswalk")!.text).toContain(
      "It does not assess whether NIST AI RMF 1.0 applies to the client.",
    );
    // NIST is not legislation: no legal review banner on its views.
    expect(rmf.legalReviewPending).toBe(false);
  });

  it("shows a fully covered AI Act subitem as only partly covering NIST", () => {
    const e = aiAct();
    const rs = records(["AIA-9-1", "AIA-15-5"]);
    expect(state(view(e, rs, AIA), "AIA-9-1")).toBe("full");
    const rmf = view(e, rs, RMF);
    expect(state(rmf, "GV-1.4")).toBe("partial");
    expect(state(rmf, "GV-1.5")).toBe("partial");
    expect(state(rmf, "MS-2.7")).toBe("partial");
    // Partial members never roll a category or function up to covered.
    const group = (id: string) => rmf.groups.find((g) => g.id === id)!;
    expect(group("GV-1")).toMatchObject({
      counts: expect.objectContaining({ partial: 2, full: 0 }),
      rollup: null,
    });
    expect(group("GV").rollup).toBeNull();
    expect(rmf.groups.every((g) => g.rollup === null)).toBe(true);
    // Unmapped is shown as such, never as a gap or a pass.
    expect(state(rmf, "GV-1.1")).toBe("unmapped");
    expect(state(rmf, "MS-2.10")).toBe("unmapped");
    expect(rmf.summary.full).toBe(0);
    const gai = view(e, rs, GAI);
    expect(state(gai, "2.9")).toBe("partial");
    expect(state(gai, "2.1")).toBe("unmapped");
    expect(gai.summary.full).toBe(0);
  });

  it("never shows a NIST outcome as fully covered, even with every obligation supported", () => {
    const e = aiAct();
    const rs = records(pinned(e).frameworks[0].compat!.obligations!.order);
    for (const key of [RMF, GAI]) {
      const v = view(e, rs, key);
      expect(cellsOf(v).filter((c) => c.state === "full")).toEqual([]);
      expect(v.summary.full).toBe(0);
    }
  });
});

describe("the NIST view of a management-system engagement once #28 is released (golden)", () => {
  let restore: () => void;
  const r = registry(withManagementSystemPack());
  beforeAll(() => {
    restore = injectRegistry(r);
  });
  afterAll(() => restore());

  it("relates full ISO/IEC 42001 results to NIST outcomes as partial", () => {
    const e = freshEngagement(
      resolveNew("en18286-iso42001"),
      "CL-1",
      "AIMS",
      "lead",
    );
    const p = e.papers.find((p) => p.templateId === "AIMS-S2-02")!;
    Object.assign(p, {
      status: "signed",
      body: { ...p.body, conclusionStatus: "supported" },
      reviews: [{ userId: "reviewer", revision: 1, at: "2026-11-13" }],
      signatures: [
        { userId: "lead", revision: 1, at: "2026-11-13", hash: "0".repeat(64) },
      ],
    });
    const resolved = pinned(e);
    expect(offeredViews(r, resolved).map((v) => v.key)).toEqual([
      "iso-iec-42001@2023",
      "en-18286@2026",
      AIA,
      RMF,
    ]);
    const iso = coverageFor(r, resolved, e, [], "iso-iec-42001@2023")!;
    expect(state(iso, "6.1.1")).toBe("full");
    expect(state(iso, "8.2")).toBe("full");
    const rmf = coverageFor(r, resolved, e, [], RMF)!;
    expect(rmf.versions.crosswalks).toEqual([
      { id: "nist-ai-rmf-to-iso-iec-42001", version: "2026.11.0" },
      { id: "nist-ai-rmf-to-en-18286", version: "2026.11.0" },
    ]);
    expect(cellsOf(rmf).find((c) => c.id === "GV-1.3")).toMatchObject({
      state: "partial",
      readiness: true,
    });
    expect(state(rmf, "MS-3.1")).toBe("partial");
    // 8.3 is covered but 6.1.3 still has open work: open wins.
    expect(state(iso, "6.1.3")).toBe("open");
    expect(state(rmf, "MG-1.3")).toBe("open");
    expect(state(rmf, "GV-1.6")).toBe("open");
    expect(state(rmf, "MS-2.10")).toBe("unmapped");
    expect(rmf.summary.full).toBe(0);
  });
});
