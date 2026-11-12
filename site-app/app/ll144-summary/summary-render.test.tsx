// The publishable LL144 summary (#30) as a standalone page and as captured by
// a report: both snapshots hold it, the report links to it, and the page
// states every element 6 RCNY 5-303 requires.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { reports } from "@/lib/commands/reports";
import { caller } from "@/lib/commands/test-fixtures";
import { resolveNew } from "@/lib/criteria/pin";
import type { Engagement, Report } from "@/lib/domain";
import { freshEngagement } from "@/lib/factories";
import {
  computeAudit,
  ll144InputSchema,
  publishableSummary,
} from "@/lib/ll144-audit";
import { reportMarkup, type ReportSnapshot } from "../report/report-markup";
import { summaryMarkup } from "./summary-markup";

vi.mock("@/lib/assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  jobs: vi.fn(async () => []),
  assuranceGates: vi.fn(async () => []),
}));

// The practice's report settings are read from D1; none are set here.
vi.mock("@/lib/report-settings", () => ({
  practiceReportSettings: vi.fn(async () => ({
    signatory: "",
    location: "",
    qualityStatement: "",
  })),
}));

const csv =
  "sex,ethnic_group,score\n" +
  [
    "Female,Asian,1",
    "Female,Asian,2",
    "Female,Asian,3",
    "Female,White,5",
    "Female,White,5",
    "Male,Asian,4",
    "Male,Asian,6",
    "Male,White,7",
    ",,5",
    ",,8",
  ].join("\n");

function engagement() {
  const e: Engagement = freshEngagement(
    resolveNew(),
    "CL-1",
    "LL144 audit",
    "user-lead",
    true,
  );
  e.specialCategoryBases = [
    {
      id: "BASIS-1",
      kind: "gdpr_art9",
      point: "g",
      statement: "Equality monitoring",
      columns: ["ethnic_group"],
      confirmedBy: "Client DPO",
      confirmedOn: "2026-11-01",
      recordedBy: "user-lead",
      recordedAt: "2026-11-02T09:00:00.000Z",
    },
  ];
  const input = ll144InputSchema.parse({
    datasetId: "EV-1",
    toolName: "Culture-fit scorer",
    distributionDate: "2026-01-15",
    auditDate: "2026-11-02",
    rate: "scoring",
    sexColumn: "sex",
    raceEthnicityColumn: "ethnic_group",
    scoreColumn: "score",
    dataSource: {
      kind: "test",
      source: "Vendor test bank",
      explanation: "Ten synthetic candidate profiles scored by the tool.",
      whyNotHistorical: "The employer has not used the tool yet.",
      testDataGeneration: "The vendor generated the profiles in 2026.",
    },
    demographicsNotInferred: true,
    demographicsStatement: "Declared by the test profiles; none inferred.",
    acknowledgeHostedProcessing: true,
  });
  const audit = computeAudit(
    e,
    input,
    { id: "EV-1", name: "scores.csv", sha256: "0".repeat(64) },
    csv,
    { id: "LL144-1", actor: "user-auditor", at: "2026-11-03T10:00:00.000Z" },
  );
  e.ll144Audits = [
    {
      ...audit,
      status: "approved",
      approvedBy: "user-reviewer",
      approvedAt: "2026-11-04T10:00:00.000Z",
    },
  ];
  return e;
}

describe("the LL144 summary page", () => {
  it("renders every required element, the median and the intersectional table", () => {
    const e = engagement();
    const html = renderToStaticMarkup(
      summaryMarkup(
        { summary: publishableSummary(e.ll144Audits![0]), source: "live" },
        "/api/ll144-summary?x=1",
      ),
    );
    for (const text of [
      "Culture-fit scorer",
      "Date of the most recent bias audit",
      "2026-11-02",
      "Distribution date of the AEDT",
      "2026-01-15",
      "Number of individuals in an unknown category",
      "sex 2; race/ethnicity 2; intersectional 2",
      "Why historical data was not used:",
      "Median score of the full sample: <strong>5</strong>",
      "Intersectional categories (sex and race/ethnicity)",
      "Male / White (reference)",
      "2027-11-02",
      "pending qualified legal review",
      "Download this summary as JSON",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Draft: this audit is not approved");
  });

  it("marks no reference category when every rate is zero", () => {
    const summary = publishableSummary(engagement().ll144Audits![0]);
    for (const table of summary.tables)
      table.notes = [...table.notes, "reference_rate_zero"];
    const html = renderToStaticMarkup(
      summaryMarkup({ summary, source: "live" }, "/api/ll144-summary?x=1"),
    );
    expect(html).not.toContain("(reference)");
    expect(html).toContain("no impact ratio is defined");
  });

  it("is captured by a report in both snapshots, which link to it", async () => {
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
    const r = e.reports.at(-1) as Report;
    for (const snapshot of [r.snapshot, r.clientSnapshot!]) {
      const summaries = snapshot.ll144Summaries as { auditId: string }[];
      expect(summaries.map((s) => s.auditId)).toEqual(["LL144-1"]);
      expect(JSON.stringify(summaries)).not.toContain("user-");
      const html = renderToStaticMarkup(
        reportMarkup(r, snapshot as ReportSnapshot, "tenant-1"),
      );
      expect(html).toContain("NYC Local Law 144 bias audit summaries");
      expect(html).toContain("auditId=LL144-1");
      expect(html).toContain("tenantId=tenant-1");
    }
  });
});
