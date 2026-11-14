// Coverage from an engagement's own records (docs/design/criteria-model.md
// sections 9.1, 9.9, 12 and 15.2): the truth-table cases about sources (12,
// 13, 37, 38, 43 to 45), pack #1 on day one, the section 12 coverage table
// and the views an engagement offers.
import { afterEach, describe, expect, it } from "vitest";
import type { Engagement, Finding } from "../domain/types";
import { freshEngagement } from "../factories";
import { evaluate, place, type CellState } from "./coverage";
import { coverageSources, type ObligationRecord } from "./coverage-sources";
import { criteriaRegistry, pinned, resolveNew, injectRegistry } from "./pin";
import { registry } from "./registry";
import { withSamplePack } from "./test-bundles";
import type { Bundle, RequirementNode } from "./types";
import { coverageFor, offeredViews } from "./views";

const leaf: RequirementNode[] = [{ id: "r", ref: "r", type: "requirement" }];
const record = (over: Partial<ObligationRecord>): ObligationRecord => ({
  id: "OB-1",
  code: "r",
  applicability: "applicable",
  outcome: "supported",
  confirmed: true,
  ...over,
});
function obligationCell(over: Partial<ObligationRecord>) {
  const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
  const result = coverageSources(e, [record(over)], ["r"]);
  const ev = evaluate(
    leaf,
    place(
      result.obligationLinks,
      new Map(result.sources.map((s) => [s.id, s])),
    ),
  );
  const { state, readiness } = ev.nodes.get("r")!.cell;
  return state + (readiness ? " (R)" : "");
}

/** Makes procedure `PROC-<templateId>` reviewed, signed and concluded. */
function conclude(
  e: Engagement,
  templateId: string,
  outcome: "supported" | "qualified" | "not_supported" = "supported",
  applicability: "applicable" | "readiness" = "applicable",
) {
  const w = e.workflow!;
  w.brief = { revision: 1 } as never;
  const p = w.procedures.find((x) => x.templateId === templateId)!;
  Object.assign(p, {
    selected: true,
    applicability,
    state: "reviewed",
    paperId: "WP-" + templateId,
    paperRevision: 2,
    execution: {
      id: "EX-1",
      revision: 1,
      briefRevision: 1,
      programRevision: 1,
      procedureRevision: p.revision,
      performed: "Done",
      steps: [],
      sampling: "",
      results: "",
      limitations: "",
      evidenceIds: [],
      runIds: [],
      actor: "auditor",
      at: "2026-11-06T10:00:00.000Z",
      assessment: {
        relevance: "",
        reliability: "",
        coverage: "",
        contradictions: "",
        conclusion: "",
        outcome,
        actor: "auditor",
        at: "2026-11-06T10:00:00.000Z",
      },
    },
    review: {
      userId: "reviewer",
      at: "2026-11-06T11:00:00.000Z",
      revision: 1,
      hash: "h",
      reason: "",
    },
  });
  e.papers.push({
    ...(structuredClone(e.papers[0] ?? {}) as Engagement["papers"][number]),
    id: "WP-" + templateId,
    templateId,
    title: p.title,
    kind: "working_paper",
    stage: p.stage,
    articleRefs: [],
    required: true,
    revision: 2,
    status: "signed",
    body: { conclusionStatus: outcome },
    reviews: [],
    signatures: [],
    history: [],
    comments: [],
    evidenceIds: [],
    runIds: [],
    contributors: [],
    authorId: "auditor",
    updatedAt: "2026-11-06T11:00:00.000Z",
  });
  w.program.status = "approved";
  return p;
}
const finding = (over: Partial<Finding>): Finding =>
  ({
    id: "F-1",
    title: "Gap",
    article: "Art. 9",
    severity: "High",
    status: "open",
    ...over,
  }) as Finding;

describe("truth-table cases about sources (section 9.8)", () => {
  it("case 12: obligation record confirmed supported, applicable", () =>
    expect(obligationCell({})).toBe("full"));
  it("case 13: obligation record needing information", () =>
    expect(obligationCell({ applicability: "needs_information" })).toBe(
      "open",
    ));
  it("case 37: obligation record confirmed supported, readiness", () =>
    expect(obligationCell({ applicability: "readiness" })).toBe("full (R)"));
  it("an unconfirmed or unassessed record is open; one the framework lacks is unusable", () => {
    expect(obligationCell({ confirmed: false })).toBe("open");
    expect(obligationCell({ outcome: "unassessed" })).toBe("open");
    expect(obligationCell({ outcome: "unsupported" })).toBe("exception");
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    expect(
      coverageSources(e, [record({ code: "AIA-99" })], ["r"]).unusable,
    ).toHaveLength(1);
  });

  it("case 38: without a workflow a signed supported paper counts as readiness", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", false);
    const p = e.papers[1];
    Object.assign(p, {
      status: "signed",
      body: { ...p.body, conclusionStatus: "supported" },
    });
    const result = coverageSources(e, [], null);
    expect(result.noApplicability).toBe(true);
    const ev = evaluate(
      leaf,
      place(
        [
          {
            sourceId: p.id,
            target: "r",
            relationship: "superset_of",
            rationale: "semantic",
          },
        ],
        new Map(result.sources.map((s) => [s.id, s])),
      ),
    );
    expect(ev.nodes.get("r")!.cell).toMatchObject({
      state: "full",
      readiness: true,
    });
  });

  it.each<[string, Partial<Finding>, CellState]>([
    ["case 43: an unresolved linked finding keeps the source open", {}, "open"],
    ["case 44: a closed finding does not", { status: "closed" }, "full"],
  ])("%s", (_, over, state) => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const p = conclude(e, "WP-A09-01");
    e.findings.push(
      finding({
        ...over,
        support: {
          findingId: "F-1",
          procedureId: p.id,
          paperIds: [],
          evidenceIds: [],
          runIds: [],
          actor: "auditor",
          at: "",
        },
      }),
    );
    const result = coverageSources(e, [], null);
    const ev = evaluate(
      leaf,
      place(
        [
          {
            sourceId: p.id,
            target: "r",
            relationship: "superset_of",
            rationale: "semantic",
          },
        ],
        new Map(result.sources.map((s) => [s.id, s])),
      ),
    );
    expect(ev.nodes.get("r")!.cell.state).toBe(state);
  });

  it("counts unresolved findings linked to no source", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    e.findings.push(finding({}));
    expect(coverageSources(e, [], null).unplacedFindings).toBe(1);
  });
});

describe("pack #1 on day one (section 9.9)", () => {
  const key = "eu-ai-act@02024R1689-20260727";
  it("offers the AI Act criteria view, then the NIST crosswalk views (#29)", () => {
    expect(
      offeredViews(criteriaRegistry(), resolveNew()).map((v) => v.key),
    ).toEqual([key, "nist-ai-rmf@1.0", "nist-ai-600-1@2024-07"]);
  });

  it("shows at most Partly covered, with the migration and legal review notes", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    conclude(e, "WP-A09-01");
    conclude(e, "WP-XC-01");
    const view = coverageFor(criteriaRegistry(), pinned(e), e, [], key)!;
    const cell = (id: string) => view.cells.find((c) => c.id === id)!;
    expect(cell("AIA-ART-17").state).toBe("partial");
    expect(cell("AIA-ART-9").state).toBe("partial");
    expect(cell("AIA-9-1").state).toBe("parent_only");
    expect(view.summary.full).toBe(0);
    expect(view.summary.total).toBe(
      view.cells.filter((c) => c.type === "requirement").length,
    );
    expect(view.banners.map((b) => b.id)).toEqual(
      expect.arrayContaining(["migration", "legal-review"]),
    );
    expect(view.banners.find((b) => b.id === "migration")!.text).toContain(
      "Article coverage bars",
    );
    expect(cell("AIA-ART-17").contributions[0]).toMatchObject({
      strength: "partial",
      path: { origin: "migrated", objectiveId: "CO-WP-XC-01" },
      source: { templateId: "WP-XC-01" },
    });
  });

  it("places confirmed obligation records on their subitems", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const view = coverageFor(
      criteriaRegistry(),
      pinned(e),
      e,
      [record({ code: "AIA-9-1", applicability: "readiness" })],
      key,
    )!;
    expect(view.cells.find((c) => c.id === "AIA-9-1")).toMatchObject({
      state: "full",
      readiness: true,
    });
  });
});

describe("withdrawn packs (case 45)", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());
  it("caps coverage at Partly covered and says why", () => {
    const withdrawn = withSamplePack() as Bundle;
    const entry = withdrawn.index.documents.find(
      (d) =>
        d.documentType === "pack" &&
        d.id === "eu-ai-act-amended" &&
        d.version === withdrawn.index.defaults.pack.version,
    )!;
    Object.assign(entry, {
      status: "withdrawn",
      withdrawnAt: "2027-02-01",
      withdrawalReason: "Superseded by reviewed links.",
    });
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    restore = injectRegistry(registry(withdrawn));
    const view = coverageFor(
      criteriaRegistry(),
      pinned(e),
      e,
      [record({ code: "AIA-9-1" })],
      "eu-ai-act@02024R1689-20260727",
    )!;
    // A full obligation link is not clamped by the pack, only by its framework.
    expect(view.cells.find((c) => c.id === "AIA-9-1")!.state).toBe("full");
    expect(view.banners.find((b) => b.id === "withdrawn")!.text).toContain(
      "was withdrawn on 2027-02-01",
    );
  });
});

describe("the section 12 pack", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());
  const show = (view: ReturnType<typeof coverageFor>, id: string) => {
    const c = view!.cells.find((x) => x.id === id)!;
    return c.state + (c.readiness ? " (R)" : "");
  };
  function aims(
    bundle: Bundle,
    outcome?: "supported" | "not_supported",
    applicability?: "applicable" | "readiness",
  ) {
    restore = injectRegistry(registry(bundle));
    const e = freshEngagement(
      resolveNew("en18286-iso42001"),
      "CL-1",
      "AIMS",
      "lead",
      true,
    );
    conclude(e, "AIMS-S2-01", outcome, applicability);
    return e;
  }

  it("gives the coverage table of section 12 once released", () => {
    const e = aims(withSamplePack());
    const r = criteriaRegistry(),
      resolved = pinned(e);
    expect(offeredViews(r, resolved).map((v) => v.key)).toEqual([
      "en-18286@2026",
      "iso-iec-42001@2023",
      "eu-ai-act@02024R1689-20260727",
    ]);
    const iso = coverageFor(r, resolved, e, [], "iso-iec-42001@2023");
    expect(show(iso, "6.1.2")).toBe("full");
    expect(show(iso, "8.2")).toBe("full");
    expect(show(iso, "6.1.4")).toBe("unmapped");
    const en = coverageFor(r, resolved, e, [], "en-18286@2026");
    expect(show(en, "6")).toBe("partial");
    expect(show(en, "4")).toBe("unmapped");
    const aiAct = coverageFor(
      r,
      resolved,
      e,
      [],
      "eu-ai-act@02024R1689-20260727",
    )!;
    expect(show(aiAct, "AIA-9-1")).toBe("partial");
    expect(show(aiAct, "AIA-ART-17")).toBe("partial");
    expect(
      aiAct.cells.find((c) => c.id === "AIA-ART-17")!.legalEffects,
    ).toEqual([expect.objectContaining({ verification: "secondary_only" })]);
    expect(show(aiAct, "AIA-ART-16")).toBe("unmapped");
    expect(show(aiAct, "AIA-ART-50")).toBe("unmapped");
    expect(aiAct.versions.crosswalks.map((c) => c.id).sort()).toEqual([
      "en-18286-to-eu-ai-act",
      "iso-iec-42001-to-eu-ai-act",
    ]);
    expect(aiAct.banners.map((b) => b.id)).toEqual(
      expect.arrayContaining(["crosswalk", "legal-review"]),
    );
  });

  it("is clamped while a document of the chain is still a draft", () => {
    // A draft pack cannot be pinned at all, so the clamp shows on a released
    // pack whose framework data version is (in this test registry) a draft.
    const bundle = withSamplePack();
    bundle.index.documents.find(
      (d) => d.documentType === "framework" && d.id === "iso-iec-42001",
    )!.status = "draft";
    const e = aims(bundle);
    const view = coverageFor(
      criteriaRegistry(),
      pinned(e),
      e,
      [],
      "iso-iec-42001@2023",
    );
    expect(show(view, "6.1.2")).toBe("partial");
  });

  it("shows exceptions everywhere for a conclusion of not supported", () => {
    const e = aims(withSamplePack(), "not_supported");
    const r = criteriaRegistry(),
      resolved = pinned(e);
    expect(
      show(coverageFor(r, resolved, e, [], "iso-iec-42001@2023"), "6.1.2"),
    ).toBe("exception");
    const aiAct = coverageFor(
      r,
      resolved,
      e,
      [],
      "eu-ai-act@02024R1689-20260727",
    );
    expect(show(aiAct, "AIA-9-1")).toBe("exception");
    expect(show(aiAct, "AIA-ART-17")).toBe("exception");
  });

  it("marks every result readiness for a readiness procedure", () => {
    const e = aims(withSamplePack(), "supported", "readiness");
    const r = criteriaRegistry(),
      resolved = pinned(e);
    expect(
      show(coverageFor(r, resolved, e, [], "iso-iec-42001@2023"), "6.1.2"),
    ).toBe("full (R)");
    expect(show(coverageFor(r, resolved, e, [], "en-18286@2026"), "6")).toBe(
      "partial (R)",
    );
  });
});
