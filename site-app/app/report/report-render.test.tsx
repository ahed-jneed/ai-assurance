// The two report renderers on snapshots of a pack without the AI Act
// classification and of pack #1 (docs/design/criteria-model.md section 7.1
// and test 8 of section 16): neither may throw, and only pack #1 shows the
// AI Act sections.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reports } from "@/lib/commands/reports";
import { caller } from "@/lib/commands/test-fixtures";
import { resolveNew, injectRegistry } from "@/lib/criteria/pin";
import { registry } from "@/lib/criteria/registry";
import { withSamplePack } from "@/lib/criteria/test-bundles";
import type { Engagement, Report } from "@/lib/domain";
import { freshEngagement } from "@/lib/factories";
import { FrozenReportDetails } from "../report-details";
import { reportMarkup, type ReportSnapshot } from "./report-markup";

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

let restore: () => void;
beforeAll(() => {
  restore = injectRegistry(registry(withSamplePack()));
});
afterAll(() => restore());

async function captured(packId?: string) {
  const e: Engagement = freshEngagement(
    resolveNew(packId),
    "CL-1",
    "Audit",
    "user-lead",
    true,
  );
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
  return e.reports.at(-1) as Report;
}
const printed = (r: Report, snapshot: Record<string, unknown>) =>
  renderToStaticMarkup(reportMarkup(r, snapshot as ReportSnapshot));
const details = (r: Report, snapshot: Record<string, unknown>) =>
  renderToStaticMarkup(<FrozenReportDetails value={{ ...r, snapshot }} />);

describe("report renderers", () => {
  it("render a pack without the classification with its pack stamp only", async () => {
    const r = await captured("en18286-iso42001");
    for (const snapshot of [r.snapshot, r.clientSnapshot!]) {
      for (const html of [printed(r, snapshot), details(r, snapshot)]) {
        expect(html).not.toContain("Report unavailable");
        expect(html).not.toContain("Regulatory assessment");
        expect(html).not.toContain(
          "Captured classification &amp; regulatory basis",
        );
        expect(html).not.toContain("Annex map");
        expect(html).not.toContain("Recorded regulatory source");
        expect(html).toContain("en18286-iso42001");
        expect(html).toContain("2027.1.0");
      }
    }
  });

  it("render pack #1 as before, stating the pending legal review", async () => {
    const r = await captured();
    for (const snapshot of [r.snapshot, r.clientSnapshot!]) {
      const html = printed(r, snapshot);
      expect(html).toContain("Regulatory assessment");
      expect(html).toContain("legal content is pending qualified legal review");
      const frozen = details(r, snapshot);
      expect(frozen).toContain(
        "Captured classification &amp; regulatory basis",
      );
      expect(frozen).toContain("Recorded regulatory source");
      expect(frozen).toContain("pending qualified legal review");
    }
    expect(details(r, r.snapshot)).toContain("Annex map");
  });

  it("state the framework and crosswalk versions of the criteria stamp", async () => {
    // The injected sample bundle releases two crosswalks to the AI Act.
    for (const [r, framework] of [
      [await captured(), /eu-ai-act 02024R1689-20260727 \(data [\d.]+\)/],
      [
        await captured("en18286-iso42001"),
        /en-18286 2026 \(data 2027\.1\.0\); iso-iec-42001 2023 \(data 2027\.1\.0\)/,
      ],
    ] as const)
      for (const snapshot of [r.snapshot, r.clientSnapshot!]) {
        for (const html of [printed(r, snapshot), details(r, snapshot)]) {
          expect(html).toMatch(framework);
          expect(html).toContain("en-18286-to-eu-ai-act 2027.1.0");
          expect(html).toContain("iso-iec-42001-to-eu-ai-act 2027.1.0");
        }
      }
  });

  it("render a snapshot captured before the stamps had frameworks", async () => {
    const r = await captured();
    const { frameworks, crosswalks, ...phase1 } = r.snapshot
      .criteriaPack as Record<string, unknown>;
    expect([frameworks, crosswalks].every(Array.isArray)).toBe(true);
    const snapshot = { ...r.snapshot, criteriaPack: phase1 };
    for (const html of [printed(r, snapshot), details(r, snapshot)]) {
      expect(html).not.toContain("Report unavailable");
      expect(html).toContain("eu-ai-act-amended");
      expect(html).not.toContain("Assessed against");
    }
  });
});
