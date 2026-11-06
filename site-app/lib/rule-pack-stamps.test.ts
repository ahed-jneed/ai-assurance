import { describe, expect, it, vi } from "vitest";
import catalog from "./catalog.json";
import { classification } from "./commands/classification";
import { reports } from "./commands/reports";
import { caller } from "./commands/test-fixtures";
import type { Engagement, Report } from "./domain";
import { freshEngagement } from "./factories";
import { sha256 } from "./ids";
import { engagementRulePack } from "./rule-pack";
import { currentRulePack, recordVersions } from "./rule-pack-current";

// Report capture reads assurance records and jobs from D1; none exist here.
vi.mock("./assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  jobs: vi.fn(async () => []),
  assuranceGates: vi.fn(async () => []),
}));

const stamp2026_11_1 = {
  version: "2026.11.1",
  legalVersion: "02024R1689-20260727",
  researchedAsOf: "2026-11-05",
  legalReview: "pending",
};
/** An engagement saved before rule-pack stamps, pinned to 02024R1689-20260727. */
function pinnedBeforeStamps(): Engagement {
  const e: Engagement = JSON.parse(
    JSON.stringify(freshEngagement("CL-1", "Legacy audit", "user-lead")),
  );
  delete e.rulePack;
  e.classification.version = "02024R1689-20260727";
  e.classification.asOf = "2026-10-05";
  return e;
}
async function capture(e: Engagement) {
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

describe("the engagement rule-pack stamp", () => {
  it("stamps new engagements with rule pack 2026.11.1 read from the catalog", () => {
    expect(currentRulePack).toEqual(stamp2026_11_1);
    for (const structured of [false, true]) {
      const e = freshEngagement("CL-1", "New audit", "user-lead", structured);
      expect(e.rulePack).toEqual(stamp2026_11_1);
      expect(e.rulePack?.version).toBe(catalog.methodologyVersion);
      expect(e.classification.version).toBe(catalog.regulatorySnapshot.celex);
      expect(e.classification.asOf).toBe(
        catalog.regulatorySnapshot.researchedAsOf,
      );
      expect(engagementRulePack(e, currentRulePack)).toEqual({
        kind: "current",
        stamp: stamp2026_11_1,
      });
      // The stamp is the engagement's own copy.
      e.rulePack!.version = "edited";
      expect(currentRulePack.version).toBe("2026.11.1");
    }
  });

  it("keeps the pinned version of an engagement created before stamps", async () => {
    const e = pinnedBeforeStamps();
    await classification.run(
      e,
      "classify",
      {
        prohibited: false,
        highRisk: true,
        transparency: false,
        profiling: false,
        annexRoute: "Annex III — sensitive use case",
        operatorRole: "Provider",
        intendedPurpose: "Credit scoring",
        rationale: "Annex III point 5(b)",
      },
      caller("Auditor"),
    );
    expect(e.classification).toMatchObject({
      annexRoute: "Annex III — sensitive use case",
      version: "02024R1689-20260727",
      asOf: "2026-10-05",
    });
    expect(e.rulePack).toBeUndefined();
    expect(engagementRulePack(e, currentRulePack)).toEqual({
      kind: "legacy",
      recordedLegalVersion: "02024R1689-20260727",
      recordedResearchedAsOf: "2026-10-05",
    });
    // A later revision of the pack does not move a stamped engagement.
    const stamped = freshEngagement("CL-1", "New audit", "user-lead");
    expect(engagementRulePack(stamped, { version: "2027.1.1" }).kind).toBe(
      "other",
    );
  });
});

describe("version stamps on captured records", () => {
  it("records the rule pack and methodology versions in report snapshots", async () => {
    const e = freshEngagement("CL-1", "New audit", "user-lead");
    const r = await capture(e);
    expect(r.snapshot.rulePack).toEqual(stamp2026_11_1);
    expect(r.snapshot.methodologyVersion).toBe("2026.11.1");
    expect(r.clientSnapshot?.rulePack).toEqual(stamp2026_11_1);
    expect(r.clientSnapshot?.methodologyVersion).toBe("2026.11.1");
    expect(r.sha256).toBe(await sha256(JSON.stringify(r.snapshot)));
    expect(recordVersions()).toEqual({
      rulePack: stamp2026_11_1,
      methodologyVersion: "2026.11.1",
    });
  });

  it("captures a pinned engagement under the current pack without changing its classification", async () => {
    const r = await capture(pinnedBeforeStamps());
    expect(r.snapshot.rulePack).toEqual(stamp2026_11_1);
    expect((r.snapshot.engagement as Engagement).classification).toMatchObject({
      version: "02024R1689-20260727",
      asOf: "2026-10-05",
    });
  });

  it("never changes an issued snapshot when the rule pack changes", async () => {
    const e = freshEngagement("CL-1", "New audit", "user-lead");
    const issued = await capture(e),
      frozen = JSON.stringify(issued.snapshot);
    const saved = { ...currentRulePack };
    try {
      Object.assign(currentRulePack, {
        version: "2026.12.1",
        researchedAsOf: "2026-12-05",
      });
      const later = await capture(e);
      expect(later.snapshot.rulePack).toMatchObject({ version: "2026.12.1" });
      expect(JSON.stringify(issued.snapshot)).toBe(frozen);
      expect(issued.sha256).toBe(await sha256(frozen));
      expect(e.rulePack).toEqual(stamp2026_11_1);
    } finally {
      Object.assign(currentRulePack, saved);
    }
  });
});
