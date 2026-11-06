// "A new pack as data alone" (docs/design/criteria-model.md section 12 and
// test 8 of section 16): the EN 18286 + ISO/IEC 42001 sample documents,
// loaded through an injected registry with no code change, run through
// engagement creation, seeding, paper templates and report capture, without
// any AI Act behaviour. Pack #1 keeps today's behaviour.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assessments } from "../commands/assurance/assessments";
import { classification } from "../commands/classification";
import { reports } from "../commands/reports";
import { caller } from "../commands/test-fixtures";
import { completionGates, stageGates, type Engagement } from "../domain";
import { freshEngagement, templatePaper } from "../factories";
import { withSamplePack } from "./test-bundles";
import {
  criteriaView,
  packFeatures,
  recordVersions,
  resolveNew,
  injectRegistry,
} from "./pin";
import { registry, selectablePacks } from "./registry";

vi.mock("../assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  jobs: vi.fn(async () => []),
  assuranceGates: vi.fn(async () => []),
}));

let restore: () => void;
beforeAll(() => {
  restore = injectRegistry(registry(withSamplePack()));
});
afterAll(() => restore());

const capture = async (e: Engagement) => {
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
  return e.reports.at(-1)!;
};

describe("the EN 18286 + ISO/IEC 42001 pack, from data alone", () => {
  const resolved = () => resolveNew("en18286-iso42001");
  const engagement = () =>
    freshEngagement(resolved(), "CL-1", "AIMS audit", "user-lead", true);

  it("is offered at engagement creation with its clause-numbers-only note", () => {
    expect(
      selectablePacks(registry(withSamplePack())).find(
        (p) => p.id === "en18286-iso42001",
      ),
    ).toMatchObject({
      version: "2027.1.0",
      workingPapers: 1,
      memos: 1,
      clauseNumbersOnly: true,
      legalReviewPending: false,
      phases: ["Stage 1", "Stage 2"],
      crosswalksTo: ["EU AI Act (amended)"],
    });
  });

  it("seeds its programme and templates without an AI Act stamp", () => {
    const e = engagement();
    expect(e.criteria?.pin).toMatchObject({
      packId: "en18286-iso42001",
      packVersion: "2027.1.0",
    });
    expect(e.rulePack).toBeUndefined();
    expect(e.classification).toMatchObject({ version: "", asOf: "" });
    expect(e.workflow!.procedures.map((p) => p.templateId)).toEqual([
      "AIMS-S2-01",
    ]);
    const p = e.workflow!.procedures[0];
    // No catalogue refs: the linked requirements, as "<shortTitle> <ref>".
    expect(p.candidateRefs).toEqual([
      "ISO/IEC 42001:2023 6.1.2",
      "ISO/IEC 42001:2023 8.2",
      "EN 18286:2026 6",
    ]);
    expect(p.sourceVersion).toBe("2026; 2023");
    const memo = templatePaper(resolved(), "MEM-EX-01", "user-lead");
    expect(memo.templateId).toBe("MEM-EX-01");
    expect(() => templatePaper(resolved(), "WP-A09-01", "u")).toThrow(
      "Unknown methodology template",
    );
  });

  it("has no classification gate and no AI Act commands", async () => {
    const e = engagement();
    const features = packFeatures(e);
    expect(features).toEqual({
      annexIvIndex: false,
      aiActClassification: false,
      obligationAssessments: false,
      statementOfApplicability: false,
      nonconformityGrading: false,
      certificationRecommendation: false,
    });
    expect(
      completionGates(e, "readiness", undefined, features).filter(
        (g) => g.kind === "classification",
      ),
    ).toEqual([]);
    expect(
      stageGates(e, "Fieldwork", features).filter(
        (g) => g.kind === "classification",
      ),
    ).toEqual([]);
    // Pack #1's features would still gate the provisional classification.
    expect(
      stageGates(e, "Fieldwork").some((g) => g.kind === "classification"),
    ).toBe(true);
    await expect(
      (async () => classification.run(e, "classify", {}, caller("Auditor")))(),
    ).rejects.toMatchObject({
      status: 409,
      message: "This criteria pack has no AI Act classification",
    });
    await expect(
      (async () =>
        assessments.run(
          { e } as never,
          "obligationDecision",
          {},
          caller("Auditor"),
        ))(),
    ).rejects.toMatchObject({
      status: 409,
      message: "This criteria pack has no AI Act obligation assessments",
    });
  });

  it("captures reports with the pack's texts and stamp and no AI Act sections", async () => {
    const e = engagement();
    const r = await capture(e);
    for (const s of [r.snapshot, r.clientSnapshot!]) {
      expect(s.limitations).toMatch(/^Assurance conclusions do not constitute/);
      expect(s.criteriaPack).toMatchObject({
        packId: "en18286-iso42001",
        packVersion: "2027.1.0",
        legalReviewPending: false,
      });
      expect(s).not.toHaveProperty("regulatorySource");
      expect(s).not.toHaveProperty("annexIV");
      expect(s).not.toHaveProperty("annexMapVersion");
      expect(s.rulePack).toBeUndefined();
      expect(s.methodologyVersion).toBe("2027.1.0");
      expect(s.engagement as object).not.toHaveProperty("classification");
    }
    expect(recordVersions(e)).toEqual({ methodologyVersion: "2027.1.0" });
  });

  it("offers its requirements as assertion criteria", () => {
    const view = criteriaView(engagement());
    expect(view.features.obligationAssessments).toBe(false);
    expect(view.requirements).toContainEqual({
      reference: "iso-iec-42001:6.1.2",
      citation: "ISO/IEC 42001:2023 6.1.2",
      title: "AI risk assessment (planning)",
    });
    expect(view.frameworks.every((f) => !f.legalReviewPending)).toBe(true);
  });
});

describe("pack #1 keeps today's behaviour", () => {
  it("gates the classification and captures the AI Act sections", async () => {
    const e = freshEngagement(
      resolveNew(),
      "CL-1",
      "AI Act",
      "user-lead",
      true,
    );
    expect(packFeatures(e).aiActClassification).toBe(true);
    expect(
      stageGates(e, "Fieldwork", packFeatures(e)).some(
        (g) => g.kind === "classification",
      ),
    ).toBe(true);
    const r = await capture(e);
    expect(r.snapshot.regulatorySource).toBe(
      "https://eur-lex.europa.eu/eli/reg/2024/1689",
    );
    expect(r.snapshot.annexIV).toBeDefined();
    expect(r.snapshot.annexMapVersion).toBeDefined();
    expect(r.snapshot.engagement).toHaveProperty("classification");
    expect(r.clientSnapshot!.engagement).toHaveProperty("classification");
    expect(r.snapshot.criteriaPack).toMatchObject({
      packId: "eu-ai-act-amended",
      packVersion: "2026.11.2",
      legalReviewPending: true,
    });
    expect(String(r.snapshot.limitations)).toMatch(
      /^Diagnostic and assurance conclusions do not constitute a notified-body/,
    );
  });

  it("states the pending legal review until the approval is appended", async () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "user-lead");
    const issued = await capture(e);
    expect(criteriaView(e).frameworks[0].legalReviewPending).toBe(true);
    const reviewed = withSamplePack();
    const entry = reviewed.index.documents.find(
      (d) => d.documentType === "framework" && d.id === "eu-ai-act",
    )!;
    entry.approvals!.push({
      role: "legal_reviewer",
      by: "Counsel",
      at: "2026-12-01",
    });
    entry.legalReview = "completed";
    const back = injectRegistry(registry(reviewed));
    try {
      expect(criteriaView(e).frameworks[0].legalReviewPending).toBe(false);
      const later = await capture(e);
      expect(later.snapshot.criteriaPack).toMatchObject({
        legalReviewPending: false,
      });
      // The issued snapshot keeps the status it was captured with.
      expect(issued.snapshot.criteriaPack).toMatchObject({
        legalReviewPending: true,
      });
    } finally {
      back();
    }
  });
});
