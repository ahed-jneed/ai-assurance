// Follow-ups of the management-system pack (#28) and the LL144 pack (#30),
// issue #144: findings cite the pinned pack's clauses, a certification
// draft captured with open gates says so, and the LL144 Testing lab panel
// is a pack feature.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findings } from "../commands/findings";
import { reports } from "../commands/reports";
import { caller } from "../commands/test-fixtures";
import { freshEngagement } from "../factories";
import {
  criteriaView,
  findingArticleOf,
  injectRegistry,
  packFeatures,
  resolveNew,
} from "./pin";
import { registry } from "./registry";
import { withManagementSystemPack } from "./test-bundles";

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

const finding = {
  title: "Impact assessments not repeated after changes",
  condition: "Two changes went live without a repeated impact assessment.",
  criteria: "Impact assessments are repeated when systems change.",
  cause: "",
  effect: "Impacts of changed systems are not assessed.",
  likelihood: 3,
  impact: 3,
  owner: "CISO",
  dueDate: "2027-01-31",
  visibility: "internal",
};

describe("the management-system pack's findings and drafts (#144)", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = injectRegistry(registry(withManagementSystemPack()));
  });
  afterAll(() => restore());
  const engagement = () =>
    freshEngagement(
      resolveNew("en18286-iso42001"),
      "CL-1",
      "AIMS audit",
      "user-lead",
    );

  it("offers the pack's clauses as finding criteria", () => {
    const options = criteriaView(engagement()).findingCriteria!;
    expect(options).toContainEqual(
      expect.objectContaining({
        reference: "iso-iec-42001:8.4",
        citation: "ISO/IEC 42001:2023 8.4",
        article: "ISO/IEC 42001:2023 8.4",
      }),
    );
    expect(options.some((o) => o.reference.startsWith("eu-ai-act:"))).toBe(
      false,
    );
  });

  it("records a clause as a finding's primary reference without an AI Act article", async () => {
    const e = engagement();
    await findings.run(
      e,
      "createFinding",
      { ...finding, criteriaRefs: ["iso-iec-42001:8.4"] },
      caller("Auditor"),
    );
    expect(e.findings.at(-1)).toMatchObject({
      article: "ISO/IEC 42001:2023 8.4",
      criteriaRefs: ["iso-iec-42001:8.4"],
    });
    expect(findingArticleOf(e, "iso-iec-42001:8.4")).toBe(
      "ISO/IEC 42001:2023 8.4",
    );
    expect(findingArticleOf(e, "eu-ai-act:AIA-ART-10")).toBeUndefined();
  });

  it("refuses a finding with neither an article nor a criterion", async () => {
    const e = engagement();
    await expect(
      (async () =>
        findings.run(e, "createFinding", finding, caller("Auditor")))(),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "State the finding's primary reference: an article or a criterion of the pack",
    });
  });

  it("marks a certification draft captured while its gates are open", async () => {
    const e = engagement();
    await reports.run(
      e,
      "createReport",
      {
        kind: "draft",
        engagementType: "certification",
        conclusion: "certification_recommended",
        summary: "Stage 2 in progress",
      },
      caller(),
    );
    const r = e.reports.at(-1)!;
    for (const s of [r.snapshot, r.clientSnapshot!]) {
      const c = s.conclusionStatement as {
        heading: string;
        draftCaveat?: string;
      };
      expect(c.heading).toBe("Audit recommendation: certification recommended");
      expect(c.draftCaveat).toMatch(
        /^Draft, gates open: \d+ completion requirements were open when this draft was captured/,
      );
    }
  });
});

describe("the LL144 Testing lab feature (#144)", () => {
  it("is on for the LL144 pack's current version only", () => {
    const pinned = (id?: string, version?: string) =>
      packFeatures(freshEngagement(resolveNew(id, version), "CL-1", "x", "u"))
        .ll144BiasAudit;
    expect(pinned("nyc-ll144-bias-audit")).toBe(true);
    expect(pinned()).toBe(false);
    // Released before the feature existed: no switch, so the panel shows
    // only the audits such an engagement already holds.
    expect(pinned("nyc-ll144-bias-audit", "2026.11.0")).toBe(false);
  });
});
