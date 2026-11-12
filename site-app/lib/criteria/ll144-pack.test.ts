// The NYC Local Law 144 bias audit pack (#30), released as data alone: an
// engagement on it seeds its programme with no AI Act behaviour, its rule
// references resolve, and reports carry its limitation and pending review.
import { describe, expect, it, vi } from "vitest";
import { reports } from "../commands/reports";
import { caller } from "../commands/test-fixtures";
import { stageGates } from "../domain";
import { freshEngagement, templatePaper } from "../factories";
import { criteriaView, packFeatures, resolveNew } from "./pin";

vi.mock("../assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  jobs: vi.fn(async () => []),
  assuranceGates: vi.fn(async () => []),
}));

// The practice's report settings are read from D1; none are set here.
vi.mock("../report-settings", () => ({
  practiceReportSettings: vi.fn(async () => ({
    signatory: "",
    location: "",
    qualityStatement: "",
  })),
}));

const engagement = () =>
  freshEngagement(
    resolveNew("nyc-ll144-bias-audit"),
    "CL-1",
    "LL144 bias audit",
    "user-lead",
    true,
  );

describe("the NYC Local Law 144 pack", () => {
  it("seeds its programme with the rule references and no AI Act stamp", () => {
    const e = engagement();
    expect(e.criteria?.pin).toMatchObject({
      packId: "nyc-ll144-bias-audit",
      packVersion: "2026.11.0",
    });
    expect(e.rulePack).toBeUndefined();
    expect(packFeatures(e)).toEqual({
      annexIvIndex: false,
      aiActClassification: false,
      obligationAssessments: false,
      statementOfApplicability: false,
      nonconformityGrading: false,
      certificationRecommendation: false,
    });
    expect(
      stageGates(e, "Fieldwork", packFeatures(e)).some(
        (g) => g.kind === "classification",
      ),
    ).toBe(false);
    const procedures = e.workflow!.procedures;
    expect(procedures.map((p) => p.templateId)).toEqual([
      "LL144-PL-01",
      "LL144-PL-02",
      "LL144-FW-01",
      "LL144-FW-02",
      "LL144-FW-03",
      "LL144-FW-04",
      "LL144-RP-01",
    ]);
    const rates = procedures.find((p) => p.templateId === "LL144-FW-03")!;
    expect(rates.expectedEvidence).toContain(
      "Justification for each excluded category",
    );
    expect(
      templatePaper(resolveNew("nyc-ll144-bias-audit"), "MEM-LL144-01", "u")
        .templateId,
    ).toBe("MEM-LL144-01");
  });

  it("offers the rule sections as criteria, pending legal review", () => {
    const view = criteriaView(engagement());
    expect(view.requirements).toContainEqual(
      expect.objectContaining({
        reference: "nyc-ll144:LL144-5-301-C",
        title: "Full-sample median, scoring rates and impact ratios for scores",
      }),
    );
    expect(view.frameworks.every((f) => f.legalReviewPending)).toBe(true);
  });

  it("captures reports with its limitation and no AI Act sections", async () => {
    const e = engagement();
    await reports.run(
      e,
      "createReport",
      {
        kind: "draft",
        engagementType: "readiness",
        conclusion: "readiness",
        summary: "Draft",
      },
      caller(),
    );
    const r = e.reports.at(-1)!;
    for (const s of [r.snapshot, r.clientSnapshot!]) {
      expect(String(s.limitations)).toMatch(/^A bias audit reports the rates/);
      expect(s.criteriaPack).toMatchObject({
        packId: "nyc-ll144-bias-audit",
        legalReviewPending: true,
      });
      expect(s).not.toHaveProperty("annexIV");
    }
  });
});
