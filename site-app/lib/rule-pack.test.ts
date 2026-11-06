import { describe, expect, it } from "vitest";
import catalog from "./catalog.json";
import type { Engagement } from "./domain";
import { freshEngagement } from "./factories";
import {
  annexRouteFacts,
  asRulePack,
  engagementFacts,
  engagementPeriod,
  isIsoDate,
  laterRevisions,
  legalDate,
  obligationsByDate,
  openReviewItems,
  periodStatus,
  researchAge,
  select,
  upcomingDates,
  type ApplicationDate,
  type Facts,
} from "./rule-pack";
import { seedWorkflow } from "./workflow-seed";
import { resolveNew } from "./criteria/pin";

const pack = asRulePack(catalog.regulatorySnapshot)!;
const entry = (id: string) =>
  pack.applicationDates.find((e) => e.id === id) as ApplicationDate;
/** A structured engagement whose brief covers `start` to `end`. */
function auditOf(
  start: string,
  end: string,
  annexRoute = "Unassessed",
): Engagement {
  const e = freshEngagement(
    resolveNew(),
    "CL-1",
    "Model risk audit",
    "user-lead",
  );
  e.workflow = seedWorkflow(
    resolveNew(),
    "user-lead",
    "2026-11-05T10:00:00.000Z",
  );
  e.workflow.brief = {
    systemName: "Credit scoring",
    intendedUse: "Consumer credit decisions",
    boundary: "",
    periodStart: start,
    periodEnd: end,
    actorResponsibilities: "",
    audience: "",
    deliverables: "",
    basis: "",
    constraints: "",
    independence: "",
    changeImpact: "",
    revision: 1,
    status: "draft",
    contributors: [],
    updatedBy: "user-lead",
    updatedAt: "2026-11-05T10:00:00.000Z",
    history: [],
  };
  e.classification.annexRoute = annexRoute;
  return e;
}
const rowOf = (e: Engagement, id: string) =>
  obligationsByDate(pack, e)
    .flatMap((g) => g.rows)
    .find((r) => r.entry.id === id)!;

describe("rule pack 2026.11.2 data", () => {
  it("is the catalogue's rule pack, researched 5 November 2026 against 02024R1689-20260727", () => {
    expect(pack.rulePackVersion).toBe(catalog.methodologyVersion);
    expect(pack.rulePackVersion).toBe("2026.11.2");
    expect(pack.celex).toBe("02024R1689-20260727");
    expect(pack.researchedAsOf).toBe("2026-11-05");
    expect(pack.applicationDates).toHaveLength(19);
    expect(pack.authorityDeadlines).toHaveLength(6);
  });

  it("makes every date data with a source and a verified-at date", () => {
    const sources = new Map(pack.sources.map((s) => [s.id, s]));
    for (const e of pack.applicationDates) {
      expect(isIsoDate(e.date), e.id).toBe(true);
      expect(e.effectiveFrom, e.id).toBe(e.date);
      expect(e.effectiveTo, e.id).toBeNull();
      expect(isIsoDate(e.verification.verifiedOn), e.id).toBe(true);
      expect(e.sourceIds.length, e.id).toBeGreaterThan(0);
      for (const id of e.sourceIds) {
        const source = sources.get(id);
        expect(source, id).toBeDefined();
        expect(source!.canonicalUrl ?? source!.accessUrl).toMatch(/^https?:/);
        expect(source!.kind, id).not.toBe("secondary");
      }
    }
    for (const d of pack.authorityDeadlines)
      expect(
        d.sourceIds.every((id) => sources.has(id)),
        d.id,
      ).toBe(true);
  });

  it("includes both 2 December 2026 milestones and dates Art 5(1)(ba) and (bb) from them", () => {
    expect(entry("aia-2026-12-02-art5-new-prohibitions").date).toBe(
      "2026-12-02",
    );
    expect(entry("aia-2026-12-02-art50-2-legacy-transition")).toMatchObject({
      date: "2026-12-02",
      dateType: "compliance_deadline",
      provisions: ["Art 111(4)", "Art 50(2)"],
    });
    const practices = Object.fromEntries(
      pack.prohibitedPractices.map((p) => [p.point, p.appliesFrom]),
    );
    expect(practices["Art 5(1)(ba)"]).toBe("2026-12-02");
    expect(practices["Art 5(1)(bb)"]).toBe("2026-12-02");
    expect(practices["Art 5(1)(a)"]).toBe("2025-02-02");
    // The Art 50 entry links the Art 111(4) deadline instead of restating it.
    expect(entry("aia-2026-08-02-art50-transparency").transitional).toEqual([
      {
        reference: "Art 111(4)",
        entryId: "aia-2026-12-02-art50-2-legacy-transition",
      },
    ]);
  });

  it("shows every legal-review item as pending and approves nothing (D-02)", () => {
    expect(pack.approval).toMatchObject({
      status: "pending_legal_review",
      reviewer: null,
      approvedAt: null,
    });
    expect(pack.legalReviewItems.map((i) => i.id)).toEqual([
      ...Array.from(
        { length: 10 },
        (_, i) => "LR-" + String(i + 1).padStart(2, "0"),
      ),
      "LR-A50-01",
      "LR-A50-10",
    ]);
    expect(pack.legalReviewItems.every((i) => i.status === "pending")).toBe(
      true,
    );
    for (const e of pack.applicationDates)
      expect(e.approval, e.id).toEqual({
        status: "pending_legal_review",
        reviewer: null,
        approvedAt: null,
      });
    const flagged = obligationsByDate(
      pack,
      freshEngagement(resolveNew(), "C", "T", "u"),
    )
      .flatMap((g) => g.rows)
      .filter((r) => r.pendingReview.length)
      .map((r) => [r.entry.id, r.pendingReview]);
    expect(flagged).toContainEqual([
      "aia-2026-12-02-art5-new-prohibitions",
      ["LR-05"],
    ]);
    expect(flagged).toContainEqual([
      "aia-2026-12-02-art50-2-legacy-transition",
      ["LR-04"],
    ]);
    expect(flagged).toHaveLength(
      pack.applicationDates.filter((e) => e.legalReview.required).length,
    );
  });

  it("limits the EN 18286 presumption to its clauses and gives ISO/IEC standards and drafts none", () => {
    const cited = pack.standards.filter(
      (s) => s.category === "harmonised_standard_cited",
    );
    expect(cited.map((s) => s.reference)).toEqual(["EN 18286:2026"]);
    expect(cited[0].ojCitation?.decisionNumber).toBe("(EU) 2026/2274");
    expect(cited[0].presumptionOfConformity).toMatchObject({
      status: "limited_to_covered_clauses",
      from: "2026-10-14",
      clauseScope: {
        covers: ["Art 17(1)", "Art 11(1), first sentence"],
        excludes: ["Art 17(2)", "Art 17(3)", "Art 17(4)"],
        status: "secondary_only",
      },
    });
    expect(cited[0].legalReview.itemIds).toEqual(["LR-01"]);
    for (const s of pack.standards) {
      expect(s.title.length, s.id).toBeLessThanOrEqual(80);
      if (s.category !== "harmonised_standard_cited")
        expect(s.presumptionOfConformity.status, s.id).toBe("none");
      if (s.category === "draft_not_harmonised")
        expect(s.label, s.id).toBe("Not harmonised — state of the art");
    }
    expect(
      pack.standards.find((s) => s.reference === "ISO/IEC 42001:2023")?.label,
    ).toBe("Not cited in the OJ: no presumption of conformity");
  });

  it("carries the Art 4a conditions under the Art 4a entry, flagged LR-06", () => {
    const row = rowOf(
      freshEngagement(resolveNew(), "C", "T", "u"),
      "aia-2026-07-27-art4a-bias-data",
    );
    const d = row.specialCategoryData!;
    expect(d.inForceFrom).toBe(row.entry.date);
    expect(d.paragraph1.allConditionsRequired.map((c) => c.point)).toEqual([
      "(a)",
      "(b)",
      "(c)",
      "(d)",
      "(e)",
      "(f)",
    ]);
    expect(d.paragraph2.conditions.map((c) => c.point)).toEqual(["(a)", "(b)"]);
    expect(d.legalReview.itemIds).toEqual(["LR-06"]);
    expect(
      pack.legalReviewItems.find((i) => i.id === "LR-06")?.relatedIds,
    ).toContain("specialCategoryData");
    // Only the Art 4a entry carries them.
    expect(
      obligationsByDate(pack, freshEngagement(resolveNew(), "C", "T", "u"))
        .flatMap((g) => g.rows)
        .filter((r) => r.specialCategoryData)
        .map((r) => r.entry.id),
    ).toEqual(["aia-2026-07-27-art4a-bias-data"]);
  });

  it("points auditors only at content the product shows, never at a data key", () => {
    for (const e of pack.applicationDates)
      expect(
        [e.summary, ...(e.conditions ?? []), e.notes ?? ""].join(" "),
        e.id,
      ).not.toMatch(/\bSee [a-z]+[A-Z]\w*/);
  });

  it("reads a resolved legal-review item as no longer pending", () => {
    const resolved = {
      ...pack,
      legalReviewItems: pack.legalReviewItems.map((i) =>
        i.id === "LR-01" ? { ...i, status: "resolved" as const } : i,
      ),
    };
    const en = pack.standards.find((s) => s.reference === "EN 18286:2026")!;
    expect(openReviewItems(pack, en.legalReview)).toEqual(["LR-01"]);
    expect(openReviewItems(resolved, en.legalReview)).toEqual([]);
  });
});

describe("transitions", () => {
  it.each([
    ["aia-2026-12-02-art5-new-prohibitions", "2026-12-01", "2026-12-02"],
    ["aia-2026-12-02-art50-2-legacy-transition", "2026-12-01", "2026-12-02"],
    ["aia-2027-12-02-high-risk-annex-iii", "2027-12-01", "2027-12-02"],
    ["aia-2028-08-02-high-risk-annex-i", "2028-08-01", "2028-08-02"],
  ])("%s is not in application on %s and applies from %s", (id, before, on) => {
    const day = (d: string) => ({ start: d, end: d });
    expect(periodStatus(entry(id).date, day(before))).toBe("readiness");
    expect(periodStatus(entry(id).date, day(on))).toBe("applicable");
  });

  it.each([
    ["2026-12-02", "2026-01-01", "2026-12-01", "readiness"],
    ["2026-12-02", "2026-12-02", "2027-06-30", "applicable"],
    ["2026-12-02", "2026-11-01", "2026-12-31", "starts_in_period"],
    ["2027-12-02", "2027-01-01", "2027-12-01", "readiness"],
    ["2027-12-02", "2027-12-02", "2028-03-31", "applicable"],
    ["2027-12-02", "2027-06-01", "2028-05-31", "starts_in_period"],
    ["2028-08-02", "2028-01-01", "2028-08-01", "readiness"],
    ["2028-08-02", "2028-08-02", "2029-07-31", "applicable"],
    ["2028-08-02", "2028-02-01", "2029-01-31", "starts_in_period"],
  ])("dates %s against a period %s to %s as %s", (date, start, end, status) => {
    expect(periodStatus(date, { start, end })).toBe(status);
  });

  it("places each milestone against the engagement period in Obligations by date", () => {
    const before = auditOf("2026-01-01", "2026-12-01"),
      after = auditOf("2028-08-02", "2029-07-31"),
      across = auditOf("2026-11-01", "2027-12-31");
    for (const id of [
      "aia-2026-12-02-art5-new-prohibitions",
      "aia-2027-12-02-high-risk-annex-iii",
      "aia-2028-08-02-high-risk-annex-i",
    ]) {
      expect(rowOf(before, id).period, id).toBe("readiness");
      expect(rowOf(after, id).period, id).toBe("applicable");
    }
    expect(rowOf(across, "aia-2026-12-02-art5-new-prohibitions").period).toBe(
      "starts_in_period",
    );
    expect(rowOf(across, "aia-2027-12-02-high-risk-annex-iii").period).toBe(
      "starts_in_period",
    );
    expect(rowOf(across, "aia-2028-08-02-high-risk-annex-i").period).toBe(
      "readiness",
    );
    expect(rowOf(across, "aia-2025-02-02-prohibitions").period).toBe(
      "applicable",
    );
    // Without a period in the brief nothing is dated against the engagement.
    const unset = freshEngagement(
      resolveNew(),
      "CL-1",
      "Unscoped",
      "user-lead",
      true,
    );
    expect(engagementPeriod(unset)).toBeNull();
    expect(
      obligationsByDate(pack, unset)
        .flatMap((g) => g.rows)
        .every((r) => r.period === "period_not_set"),
    ).toBe(true);
    expect(engagementPeriod(auditOf("2027-01-01", "2026-01-01"))).toBeNull();
  });

  it("orders the view by date, lists cross-referenced rules once and keeps authority deadlines apart", () => {
    const groups = obligationsByDate(
      pack,
      freshEngagement(resolveNew(), "C", "T", "u"),
    );
    const dates = groups.map((g) => g.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates).toEqual([
      "2025-02-02",
      "2025-08-02",
      "2026-07-27",
      "2026-08-02",
      "2026-12-02",
      "2027-08-02",
      "2027-12-02",
      "2028-08-02",
      "2030-08-02",
      "2030-12-31",
    ]);
    const rows = groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(19);
    const annexI = rows.find(
      (r) => r.entry.id === "aia-2028-08-02-high-risk-annex-i",
    )!;
    expect(annexI.links.map((l) => [l.entryId, l.date, l.authority])).toEqual([
      ["aia-2030-08-02-public-authority-legacy-annex-i", "2030-08-02", false],
      ["aia-2030-12-31-annex-x-large-scale-it", "2030-12-31", false],
      ["aia-auth-2027-08-02-art2-13-delegated-acts", "2027-08-02", true],
      ["aia-auth-2028-01-28-art43-3-notified-bodies", "2028-01-28", true],
    ]);
    expect(annexI.rules.map((r) => r.reference)).toEqual([
      "Art 111(2), first sentence, as replaced",
    ]);
    expect(
      rows.find((r) => r.entry.id === "aia-2025-02-02-prohibitions")!.practices,
    ).toHaveLength(8);
  });

  it("lists the milestones still ahead on a day", () => {
    const ahead = upcomingDates(pack, "2026-11-05");
    expect(ahead[0]).toEqual({
      date: "2026-12-02",
      entries: [
        {
          title: "New Art 5 prohibitions, points (ba) and (bb)",
          pendingReview: ["LR-05"],
        },
        {
          title:
            "Art 50(2) marking for generative systems already on the market",
          pendingReview: ["LR-04"],
        },
      ],
    });
    expect(upcomingDates(pack, "2026-12-03")[0].date).toBe("2027-08-02");
  });
});

describe("predicate selection", () => {
  const art111_4 = entry("aia-2026-12-02-art50-2-legacy-transition");
  it.each<[string, Facts, string]>([
    ["no facts recorded", {}, "needs_information"],
    [
      "a generative system placed on the market before 2 August 2026",
      { generatesSyntheticContent: true, placedOnMarketDate: "2026-07-31" },
      "candidate",
    ],
    [
      "a generative system placed on the market on 2 August 2026",
      { generatesSyntheticContent: true, placedOnMarketDate: "2026-08-02" },
      "not_selected",
    ],
    [
      "a system that generates no synthetic content",
      { generatesSyntheticContent: false },
      "not_selected",
    ],
    [
      "a generative system with no placing date",
      { generatesSyntheticContent: true },
      "needs_information",
    ],
  ])("Art 111(4) for %s: %s", (_, facts, selection) => {
    expect(select(art111_4, facts).selection).toBe(selection);
  });

  it("names the facts that are missing", () => {
    expect(select(art111_4, { generatesSyntheticContent: true })).toEqual({
      selection: "needs_information",
      missingFacts: ["placedOnMarketDate"],
    });
  });

  it("applies the Art 111(2) cut-off per route and leaves out the Art 111(1) systems", () => {
    const annexIII = entry("aia-2030-08-02-public-authority-legacy-annex-iii");
    const legacy = {
      highRiskRoute: "annex_iii",
      firstPlacedOnMarketOrPutIntoServiceDate: "2027-09-01",
      intendedForUseByPublicAuthorities: true,
      annexXLargeScaleItComponent: false,
    };
    expect(select(annexIII, legacy).selection).toBe("candidate");
    // First placed after the Annex III cut-off: not a legacy system.
    expect(
      select(annexIII, {
        ...legacy,
        firstPlacedOnMarketOrPutIntoServiceDate: "2028-01-01",
      }).selection,
    ).toBe("not_selected");
    // An Annex X component placed before 2 August 2027 falls under Art 111(1).
    expect(
      select(annexIII, {
        ...legacy,
        annexXLargeScaleItComponent: true,
        firstPlacedOnMarketOrPutIntoServiceDate: "2027-07-01",
      }).selection,
    ).toBe("not_selected");
    expect(
      select(entry("aia-2030-12-31-annex-x-large-scale-it"), {
        annexXLargeScaleItComponent: true,
        firstPlacedOnMarketOrPutIntoServiceDate: "2027-07-01",
      }).selection,
    ).toBe("candidate");
    // Annex I routes test their own cut-off.
    expect(
      select(entry("aia-2030-08-02-public-authority-legacy-annex-i"), {
        ...legacy,
        highRiskRoute: "annex_i_section_b",
        firstPlacedOnMarketOrPutIntoServiceDate: "2028-05-01",
      }).selection,
    ).toBe("candidate");
  });

  it("maps the classification route to highRiskRoute and nothing else (RD-27)", () => {
    expect(annexRouteFacts).toEqual({
      "Annex III — sensitive use case": "annex_iii",
      "Annex I Section A — regulated product": "annex_i_section_a",
      "Annex I Section B — sector-specific review": "annex_i_section_b",
      "Article 50 only": "not_high_risk",
      "Outside high-risk scope": "not_high_risk",
    });
    for (const route of [
      "Unassessed",
      "Article 6(3) exception assessment",
      "Prohibited practice fixture",
      "toString",
    ])
      expect(
        engagementFacts(auditOf("2027-01-01", "2027-12-31", route)),
        route,
      ).toEqual({});
    const annexIII = auditOf(
      "2027-01-01",
      "2027-12-31",
      "Annex III — sensitive use case",
    );
    expect(engagementFacts(annexIII)).toEqual({ highRiskRoute: "annex_iii" });
    // The route alone selects the Annex III legacy rule only once the
    // placing date is known; the Annex I rule is not selected.
    const legacyRule = (id: string) => rowOf(annexIII, id).rules[0];
    expect(legacyRule("aia-2027-12-02-high-risk-annex-iii")).toMatchObject({
      selection: "needs_information",
      missingFacts: [
        "firstPlacedOnMarketOrPutIntoServiceDate",
        "annexXLargeScaleItComponent",
      ],
    });
    expect(legacyRule("aia-2028-08-02-high-risk-annex-i").selection).toBe(
      "not_selected",
    );
    expect(
      rowOf(annexIII, "aia-2026-12-02-art50-2-legacy-transition").selection,
    ).toBe("needs_information");
  });
});

describe("staleness", () => {
  it("flags research older than the configured age", () => {
    expect(pack.staleAfterDays).toBe(90);
    expect(researchAge(pack, "2026-11-05")).toEqual({
      days: 0,
      maxAgeDays: 90,
      stale: false,
    });
    expect(researchAge(pack, "2027-02-03").stale).toBe(false);
    expect(researchAge(pack, "2027-02-04")).toEqual({
      days: 91,
      maxAgeDays: 90,
      stale: true,
    });
    const strict = { ...pack, staleAfterDays: 30 };
    expect(researchAge(strict, "2026-12-05").stale).toBe(false);
    expect(researchAge(strict, "2026-12-06").stale).toBe(true);
  });
});

describe("legal dates", () => {
  it("formats real calendar dates the way legal texts cite them", () => {
    expect(legalDate("2026-12-02")).toBe("2 December 2026");
    expect(legalDate("2030-12-31")).toBe("31 December 2030");
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(legalDate("2026-02-30")).toBe("2026-02-30");
  });
});

describe("rule pack 2026.11.2: the Art 50 research edits (#77)", () => {
  const guidance = (id: string) =>
    pack.guidanceDocuments.find((g) => g.id === id)!;

  it("names the Art 50 research as the revision and applies A50-ED-10 to A50-ED-15", () => {
    expect(pack.research.revisions).toEqual([
      expect.objectContaining({
        rulePackVersion: "2026.11.2",
        data: "docs/research/art50-transparency-2026-11.json",
        edits: [
          "A50-ED-10",
          "A50-ED-11",
          "A50-ED-12",
          "A50-ED-13",
          "A50-ED-14",
          "A50-ED-15",
        ],
        resolvesUnverified: ["UV-05", "UV-07"],
      }),
    ]);
  });

  it("records the adopted Art 50 guidelines, the Code, its adequacy opinion and signatory list", () => {
    expect(guidance("GUID-ART50-TRANSPARENCY")).toMatchObject({
      status: "adopted",
      reference: "C(2026) 7702 final",
      researchRef: "GUID-A50-GUIDELINES",
    });
    expect(
      guidance("GUID-ART50-TRANSPARENCY").dates?.map((d) => d.date),
    ).toEqual(["2026-05-08", "2026-06-03", "2026-07-20", "2026-11-05"]);
    expect(guidance("GUID-ART50-COP-OPINION")).toMatchObject({
      status: "assessed_adequate",
      reference: "C(2026) 4839 final; AI Board conclusion",
    });
    expect(guidance("GUID-ART50-COP").dates?.at(-1)).toEqual({
      event: "Final code published",
      date: "2026-06-10",
    });
    expect(guidance("GUID-ART50-COP-SIGNATORIES").sourceIds).toContain(
      "SRC-EC-COP-SIGNATORIES",
    );
  });

  it("adds points 153 and 154, recital (41), LR-A50-01 and LR-A50-10 to the Art 50 entry and keeps the Art 111(4) predicate", () => {
    const art50 = entry("aia-2026-08-02-art50-transparency");
    expect(art50.date).toBe("2026-08-02");
    expect(art50.notes).toMatch(/point 153/);
    expect(art50.notes).toMatch(/Point 154/);
    expect(art50.notes).toMatch(/Recital \(41\)/);
    expect(art50.legalReview.itemIds).toEqual([
      "LR-03",
      "LR-04",
      "LR-A50-01",
      "LR-A50-10",
    ]);
    expect(art50.history.at(-1)).toMatchObject({
      rulePackVersion: "2026.11.2",
      change: "revised",
    });
    expect(
      entry("aia-2026-12-02-art50-2-legacy-transition").appliesIf,
    ).toContainEqual({
      fact: "placedOnMarketDate",
      op: "before",
      value: "2026-08-02",
    });
    const row = rowOf(
      auditOf("2026-09-01", "2026-12-31"),
      "aia-2026-08-02-art50-transparency",
    );
    expect(row.pendingReview).toEqual([
      "LR-03",
      "LR-04",
      "LR-A50-01",
      "LR-A50-10",
    ]);
  });

  it("drops UV-05 and UV-07 from the unverified claims", () => {
    expect(pack.unverified.map((u) => u.id)).toEqual([
      "UV-01",
      "UV-02",
      "UV-03",
      "UV-04",
      "UV-06",
    ]);
  });

  it("lists the revisions made after an engagement's stamp", () => {
    expect(
      laterRevisions(pack, "2026.11.1").map((r) => r.rulePackVersion),
    ).toEqual(["2026.11.2"]);
    expect(laterRevisions(pack, "2026.11.2")).toEqual([]);
    expect(laterRevisions(pack, "2026.10.1")).toHaveLength(1);
    expect(laterRevisions(pack, "2027.1.1")).toEqual([]);
  });
});
