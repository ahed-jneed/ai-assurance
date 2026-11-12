// The EN 18286 + ISO/IEC 42001 management-system pack (#28): its committed
// documents stay drafts until the owner actions of #57 (licences, clause
// structure, Annex ZA scope); its projections and coverage as the release
// would serve them; the local draft preview; and an engagement taken through
// Stage 1 and Stage 2 papers, a graded nonconformity with a corrective
// action plan and the Statement of Applicability to a recommendation.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  checkCriteria,
  loadValidator,
  readCriteria,
} from "../../../schemas/validate-criteria.mjs";
import { managementSystem } from "../commands/management-system";
import { papers } from "../commands/papers";
import { reports } from "../commands/reports";
import { caller } from "../commands/test-fixtures";
import { finalReportGates, type Engagement } from "../domain";
import { managementSystemGates, soaRows } from "../domain/management-system";
import { freshEngagement } from "../factories";
import generated from "./bundle.generated.json";
import {
  criteriaView,
  gateFeatures,
  injectRegistry,
  managementSystemView,
  packFeatures,
  pinned,
  resolveNew,
} from "./pin";
import { registry, selectablePacks } from "./registry";
import { draftPreviewBundle, withManagementSystemPack } from "./test-bundles";
import type { Bundle } from "./types";
import { coverageFor } from "./views";

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

const PACK = "en18286-iso42001";
const as = (userId: string, role: Parameters<typeof caller>[0]) => {
  const c = caller(role);
  return { ...c, user: { ...c.user, userId } };
};

describe("the committed #28 documents", () => {
  const criteria = readCriteria();
  const entries = criteria.index.documents.filter((e: { id: string }) =>
    [
      PACK,
      "iso-iec-42001",
      "en-18286",
      "iso-iec-42001-to-eu-ai-act",
      "en-18286-to-eu-ai-act",
    ].includes(e.id),
  );

  it("validate, and stay drafts that no production bundle carries", () => {
    expect(checkCriteria({ ...criteria, validate: loadValidator() })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(entries.map((e: { status: string }) => e.status)).toEqual([
      "draft",
      "draft",
      "draft",
      "draft",
      "draft",
    ]);
    const bundled = (generated as unknown as Bundle).documents.map((d) => d.id);
    for (const e of entries) expect(bundled).not.toContain(e.id);
    expect(selectablePacks(registry()).map((p) => p.id)).not.toContain(PACK);
  });

  it("cite clause numbers with our own titles only, and say what is unverified", () => {
    for (const e of entries.filter(
      (e: { documentType: string }) => e.documentType === "framework",
    )) {
      const fw = criteria.documents.get(e.path);
      expect(fw.licence).toMatchObject({
        textPolicy: "paraphrased_titles",
        status: "unconfirmed",
      });
      // The data claims only what was done: our own wording, with the
      // whole title list still going to counsel (Q1), since a generic
      // title may coincide with a heading of the standard.
      expect(fw.defaultProvenance.note).toMatch(/Titles are our own/);
      expect(fw.defaultProvenance.note).toMatch(/may still coincide/);
      expect(fw.defaultProvenance.note).toMatch(/Q1/);
      for (const n of fw.requirements) {
        expect(n).not.toHaveProperty("text");
        expect(n.title.length).toBeLessThanOrEqual(80);
      }
    }
    const iso = criteria.documents.get(
      "frameworks/iso-iec-42001/2023/2026.11.1.json",
    );
    expect(iso.defaultProvenance.verification).toBe("unverified");
    expect(
      iso.requirements
        .filter(
          (n: { provenance?: { verification: string } }) =>
            n.provenance?.verification === "verified",
        )
        .map((n: { id: string }) => n.id),
    ).toEqual(["6.1.2", "6.1.4", "8.2"]);
    const en = criteria.documents.get(
      "frameworks/en-18286/2026/2026.11.1.json",
    );
    expect(en.defaultProvenance.verification).toBe("secondary_only");
  });

  it("cannot be released before the owner actions", () => {
    const c = structuredClone(criteria) as typeof criteria;
    for (const e of c.index.documents)
      if (e.status === "draft")
        Object.assign(e, {
          status: "released",
          releasedAt: "2026-12-01",
          approvals: [
            { role: "methodology_owner", by: "Owner", at: "2026-12-01" },
          ],
          sha256: "0".repeat(64),
        });
    const { errors } = checkCriteria({ ...c, validate: loadValidator() });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /rule 12b: framework iso-iec-42001@2023 2026.11.1: a framework with an unconfirmed licence cannot be released/,
        ),
        expect.stringMatching(
          /rule 12b: framework en-18286@2026 2026.11.1: a framework with an unconfirmed licence/,
        ),
        expect.stringMatching(
          /rule 10: crosswalk en-18286-to-eu-ai-act 2026.11.1: entry X1 has a legal effect whose legal review is not completed/,
        ),
      ]),
    );
  });

  it("rejects management-system features without what they need (rule 8)", () => {
    const run = (mutate: (pack: Record<string, unknown>) => void) => {
      const c = structuredClone(criteria) as typeof criteria;
      mutate(c.documents.get(`packs/${PACK}/2026.11.1.json`));
      return checkCriteria({ ...c, validate: loadValidator() }).errors;
    };
    expect(run((p) => delete p.soaControls)).toEqual([
      expect.stringMatching(/statementOfApplicability needs soaControls/),
    ]);
    expect(run((p) => (p.soaControls = "iso-iec-42001:6.1.2"))).toEqual([
      expect.stringMatching(/naming a group/),
    ]);
    expect(run((p) => (p.engagementTypes = ["readiness_assessment"]))).toEqual([
      expect.stringMatching(/needs the certification_audit engagement type/),
    ]);
    expect(
      run((p) => {
        p.features = { certificationRecommendation: true };
        delete p.soaControls;
      }),
    ).toEqual([
      expect.stringMatching(
        /certificationRecommendation needs nonconformityGrading and statementOfApplicability/,
      ),
    ]);
    expect(
      run((p) => {
        p.features = {};
      }),
    ).toEqual([
      expect.stringMatching(
        /soaControls needs features.statementOfApplicability/,
      ),
    ]);
  });
});

describe("the local draft preview", () => {
  it("offers the draft pack, labelled, and clamps its coverage", () => {
    const r = registry(draftPreviewBundle());
    const card = selectablePacks(r).find((p) => p.id === PACK);
    expect(card).toMatchObject({ draft: true, version: "2026.11.1" });
    expect(
      selectablePacks(r).find((p) => p.id === "eu-ai-act-amended")?.draft,
    ).toBe(false);
    const back = injectRegistry(r);
    try {
      const e = freshEngagement(resolveNew(PACK), "CL-1", "AIMS", "u");
      expect(criteriaView(e).draft).toBe(true);
      const view = coverageFor(
        r,
        pinned(e),
        signedRiskPaper(e),
        [],
        "iso-iec-42001@2023",
      )!;
      // A draft link never shows Covered (design section 9.2).
      expect(cell(view, "6.1.2").state).toBe("partial");
    } finally {
      back();
    }
  });
});

/** A non-structured engagement whose risk paper is signed, supported. */
function signedRiskPaper(e: Engagement) {
  const p = e.papers.find((p) => p.templateId === "AIMS-S2-02")!;
  Object.assign(p, {
    status: "signed",
    body: { ...p.body, conclusionStatus: "supported" },
    reviews: [{ userId: "reviewer", revision: 1, at: "2026-11-07" }],
    signatures: [
      { userId: "lead", revision: 1, at: "2026-11-07", hash: "0".repeat(64) },
    ],
  });
  return e;
}
const cell = (view: { cells: unknown[] }, id: string) =>
  (view.cells as { id: string; state: string; readiness: boolean }[]).find(
    (c) => c.id === id,
  )!;

describe("the pack as the release would serve it", () => {
  let restore: () => void;
  const r = registry(withManagementSystemPack());
  beforeAll(() => {
    restore = injectRegistry(r);
  });
  afterAll(() => restore());
  const engagement = (structured = false) =>
    freshEngagement(
      resolveNew(PACK),
      "CL-1",
      "AIMS audit",
      "user-lead",
      structured,
    );

  it("is offered with its phases, crosswalks and clause-numbers-only note", () => {
    expect(selectablePacks(r).find((p) => p.id === PACK)).toEqual({
      id: PACK,
      version: "2026.11.1",
      title: "EN 18286 + ISO/IEC 42001 management system",
      summary: expect.stringMatching(/^One management-system programme/),
      isDefault: false,
      draft: false,
      workingPapers: 9,
      memos: 3,
      frameworks: [
        expect.objectContaining({ shortTitle: "ISO/IEC 42001:2023" }),
        expect.objectContaining({ shortTitle: "EN 18286:2026" }),
      ],
      legalReviewPending: false,
      clauseNumbersOnly: true,
      phases: ["Stage 1", "Stage 2"],
      crosswalksTo: ["EU AI Act (amended)"],
    });
  });

  it("projects its programme, phases and Statement of Applicability", () => {
    const e = engagement(true);
    expect(e.workflow!.procedures.map((p) => p.templateId)).toEqual([
      "AIMS-S1-01",
      "AIMS-S1-02",
      "AIMS-S2-01",
      "AIMS-S2-02",
      "AIMS-S2-03",
      "AIMS-S2-04",
      "AIMS-S2-05",
      "AIMS-S2-06",
      "AIMS-S2-07",
    ]);
    const risk = e.workflow!.procedures.find(
      (p) => p.templateId === "AIMS-S2-02",
    )!;
    expect(risk.candidateRefs).toEqual([
      "ISO/IEC 42001:2023 6.1.1",
      "ISO/IEC 42001:2023 6.1.2",
      "ISO/IEC 42001:2023 6.1.3",
      "ISO/IEC 42001:2023 8.2",
      "ISO/IEC 42001:2023 8.3",
      "EN 18286:2026 6",
    ]);
    expect(packFeatures(e)).toEqual({
      annexIvIndex: false,
      aiActClassification: false,
      obligationAssessments: false,
      statementOfApplicability: true,
      nonconformityGrading: true,
      certificationRecommendation: true,
    });
    const view = managementSystemView(pinned(e))!;
    expect(view.phases).toEqual([
      {
        id: "stage-1",
        title: "Stage 1",
        templateIds: ["AIMS-S1-01", "AIMS-S1-02"],
      },
      {
        id: "stage-2",
        title: "Stage 2",
        templateIds: [
          "AIMS-S2-01",
          "AIMS-S2-02",
          "AIMS-S2-03",
          "AIMS-S2-04",
          "AIMS-S2-05",
          "AIMS-S2-06",
          "AIMS-S2-07",
          "MEM-AIMS-NC-01",
        ],
      },
    ]);
    expect(view.controls).toHaveLength(38);
    expect(view.controls[0]).toEqual({
      id: "A.2.2",
      ref: "A.2.2",
      title: "A written AI policy",
      group: "A.2 Policies that direct AI work",
    });
    expect(view.controls.map((c) => c.id)).toContain("A.6.2.8");
    expect(criteriaView(e).managementSystem).toEqual(view);
    expect(criteriaView(e, false).managementSystem).toBeUndefined();
  });

  it("covers ISO/IEC 42001 fully and the AI Act only partly (golden)", () => {
    const e = signedRiskPaper(engagement());
    const resolved = pinned(e);
    const iso = coverageFor(r, resolved, e, [], "iso-iec-42001@2023")!;
    // A paper source is readiness (no applicability per paper).
    expect(cell(iso, "6.1.2")).toMatchObject({
      state: "full",
      readiness: true,
    });
    expect(cell(iso, "8.3")).toMatchObject({ state: "full" });
    expect(cell(iso, "6.1.4").state).toBe("open");
    expect(cell(iso, "A.2.2").state).toBe("open");
    const en = coverageFor(r, resolved, e, [], "en-18286@2026")!;
    expect(cell(en, "6").state).toBe("partial");
    expect(cell(en, "4").state).toBe("open");
    const aiAct = coverageFor(
      r,
      resolved,
      e,
      [],
      "eu-ai-act@02024R1689-20260727",
    )!;
    expect(aiAct.versions.crosswalks).toEqual([
      { id: "iso-iec-42001-to-eu-ai-act", version: "2026.11.1" },
      { id: "en-18286-to-eu-ai-act", version: "2026.11.1" },
    ]);
    // Only intersects_with entries: a full ISO result stays partial.
    expect(cell(aiAct, "AIA-9-1")).toMatchObject({
      state: "partial",
      readiness: true,
    });
    // Art. 17 is open through EN 18286 clauses whose papers are open, and
    // its presumption basis is a badge, never a state.
    const art17 = cell(aiAct, "AIA-ART-17") as unknown as {
      state: string;
      legalEffects?: { basis: string }[];
    };
    expect(art17.state).toBe("open");
    expect(art17.legalEffects?.[0]?.basis).toMatch(/Annex ZA/);
    expect(cell(aiAct, "AIA-ART-50").state).toBe("unmapped");
  });

  it("takes an engagement through Stage 1 and 2, a nonconformity and its plan, to a recommendation", async () => {
    const e = engagement();
    e.stage = "Sign-off";
    const lead = as("lead", "Lead Auditor"),
      auditor = as("auditor", "Auditor"),
      reviewer = as("reviewer", "Reviewer");
    const ready = (templateId: string) => {
      const p = e.papers.find((p) => p.templateId === templateId)!;
      Object.assign(p, {
        authorId: "auditor",
        status: "reviewed",
        body: { ...p.body, conclusionStatus: "supported" },
        reviews: [{ userId: "reviewer", revision: p.revision, at: "x" }],
      });
      return p;
    };
    const sign = (templateId: string) =>
      papers.run(e, "signPaper", { paperId: ready(templateId).id }, lead);
    // Stage 2 work waits for Stage 1.
    await expect(sign("AIMS-S2-01")).rejects.toMatchObject({
      status: 409,
      message:
        "Sign the papers of the earlier programme phase first: AIMS-S1-01, AIMS-S1-02",
    });
    await sign("AIMS-S1-01");
    await sign("AIMS-S1-02");
    for (const id of [
      "AIMS-S2-01",
      "AIMS-S2-02",
      "AIMS-S2-03",
      "AIMS-S2-04",
      "AIMS-S2-05",
      "AIMS-S2-06",
      "AIMS-S2-07",
    ])
      await sign(id);

    // A nonconformity, graded major.
    e.findings.push({
      id: "F-1",
      title: "Risk assessments not repeated after changes",
      article: "ISO/IEC 42001:2023 8.2",
      condition: "c",
      criteria: "c",
      cause: "c",
      effect: "e",
      likelihood: 2,
      impact: 2,
      riskScore: 4,
      severity: "Low",
      status: "open",
      owner: "CISO",
      dueDate: "2027-01-31",
      response: "",
      remediation: "",
      retestEvidenceIds: [],
      createdBy: "auditor",
      visibility: "client",
    });
    const controls = gateFeatures(e).soaControls!;
    const certification = (conclusion: string) =>
      managementSystemGates(e, conclusion, gateFeatures(e), controls).map(
        (g) => g.id,
      );
    expect(certification("certification_recommended")).toEqual([
      "grade:F-1",
      "soa:complete",
    ]);
    await managementSystem.run(
      e,
      "gradeNonconformity",
      {
        findingId: "F-1",
        grade: "major",
        rationale: "Systemic: no repeat in 4 of 5 samples.",
      },
      auditor,
    );
    expect(certification("certification_recommended")).toEqual([
      "soa:complete",
      "major:F-1",
    ]);
    expect(certification("certification_deferred")).toEqual([
      "soa:complete",
      "plan:F-1",
    ]);
    // A major nonconformity also blocks an unmodified ISAE 3000 conclusion.
    expect(certification("unmodified")).toEqual(["major:F-1"]);

    // The corrective action plan, accepted by someone else.
    await managementSystem.run(
      e,
      "recordCorrectiveAction",
      {
        findingId: "F-1",
        correction: "Reassessed the three changed systems.",
        rootCause: "Change procedure does not trigger reassessment.",
        action: "Add a reassessment trigger to the change procedure.",
        owner: "CISO",
        dueDate: "2027-01-31",
      },
      auditor,
    );
    await expect(
      (async () =>
        managementSystem.run(
          e,
          "acceptCorrectiveAction",
          { findingId: "F-1" },
          as("auditor", "Lead Auditor"),
        ))(),
    ).rejects.toMatchObject({ status: 403 });
    await managementSystem.run(
      e,
      "acceptCorrectiveAction",
      { findingId: "F-1", note: "Plan addresses the cause." },
      reviewer,
    );

    // The Statement of Applicability: every control, then the review.
    for (const c of controls)
      await managementSystem.run(
        e,
        "recordSoaEntry",
        c.id === "A.10.4"
          ? {
              control: c.id,
              included: false,
              justification: "No customers receive AI systems.",
            }
          : {
              control: c.id,
              included: true,
              justification: "Needed to treat the assessed AI risks.",
              implementation: "implemented",
            },
        auditor,
      );
    expect(soaRows(controls, e).filter((r) => r.problem)).toEqual([]);
    await expect(
      (async () =>
        managementSystem.run(
          e,
          "reviewSoa",
          {},
          as("auditor", "Lead Auditor"),
        ))(),
    ).rejects.toMatchObject({ status: 403 });
    expect(certification("certification_deferred")).toEqual(["soa:review"]);
    await managementSystem.run(
      e,
      "reviewSoa",
      { note: "Agrees to the SoA v3." },
      reviewer,
    );
    expect(certification("certification_deferred")).toEqual([]);
    expect(certification("certification_recommended")).toEqual(["major:F-1"]);
    // Regrading needs the plan accepted again.
    await managementSystem.run(
      e,
      "gradeNonconformity",
      {
        findingId: "F-1",
        grade: "minor",
        rationale: "Isolated after the correction.",
      },
      auditor,
    );
    expect(certification("certification_recommended")).toEqual(["plan:F-1"]);
    await managementSystem.run(
      e,
      "acceptCorrectiveAction",
      { findingId: "F-1" },
      reviewer,
    );
    expect(certification("certification_recommended")).toEqual([]);
    expect(
      finalReportGates(
        e,
        {
          engagementType: "certification",
          assuranceLevel: null,
          conclusion: "certification_recommended",
        },
        gateFeatures(e),
      ).filter((g) => g.kind === "management_system" || g.kind === "finding"),
    ).toEqual([]);
    // A changed decision needs a new review.
    await managementSystem.run(
      e,
      "recordSoaEntry",
      {
        control: "A.10.4",
        included: true,
        justification: "Now sold to customers.",
        implementation: "planned",
      },
      auditor,
    );
    expect(certification("certification_recommended")).toEqual(["soa:review"]);
    await managementSystem.run(e, "reviewSoa", {}, reviewer);

    // The recommendation, captured as a report with the SoA it rests on.
    await reports.run(
      e,
      "createReport",
      {
        kind: "draft",
        engagementType: "certification",
        conclusion: "certification_recommended",
        summary: "Stage 2 complete.",
      },
      lead,
    );
    const s = e.reports.at(-1)!.snapshot as Record<string, unknown>;
    expect(s.terms).toEqual({
      engagementType: "certification",
      assuranceLevel: null,
      conclusion: "certification_recommended",
    });
    expect(s.reportTitle).toBe(
      "AI management system certification audit report",
    );
    expect((s.conclusionStatement as { heading: string }).heading).toBe(
      "Audit recommendation: certification recommended",
    );
    expect(s.statementOfApplicability).toEqual(e.statementOfApplicability);
    expect(s.limitations).toMatch(
      /only an accredited certification body grants/,
    );
    const client = e.reports.at(-1)!.clientSnapshot as {
      findings: { grade?: string; gradeHistory?: unknown }[];
    };
    expect(client.findings[0].grade).toBe("minor");
    expect(client.findings[0]).not.toHaveProperty("gradeHistory");
    expect(client).not.toHaveProperty("statementOfApplicability");
  });

  it("answers 409 for the management-system ops on a pack without them", async () => {
    restore();
    try {
      const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "u");
      e.findings.push({ id: "F-1" } as never);
      for (const [op, message] of [
        [
          "recordSoaEntry",
          "This criteria pack has no Statement of Applicability",
        ],
        [
          "gradeNonconformity",
          "This criteria pack has no nonconformity grading",
        ],
      ])
        await expect(
          (async () => managementSystem.run(e, op, {}, caller("Auditor")))(),
        ).rejects.toMatchObject({ status: 409, message });
      await expect(
        (async () =>
          reports.run(
            e,
            "createReport",
            {
              kind: "draft",
              engagementType: "certification",
              conclusion: "certification_recommended",
              summary: "x",
            },
            caller(),
          ))(),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      restore = injectRegistry(r);
    }
  });
});
