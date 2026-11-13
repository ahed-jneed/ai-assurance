// Phase 2 of docs/design/criteria-model.md (section 17, #61): explicit pins
// (M1), the framework and crosswalk stamps of report and dossier snapshots,
// the generated obligation file and Annex IV map, obligation codes from the
// pinned framework, and findings that reference criteria.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalize,
  checkMethodologyDrift,
  readCriteria,
  servedAnnexMap,
} from "../../../schemas/validate-criteria.mjs";
import { serialise } from "../../../templates/criteria/tools/convert-catalog.mjs";
import annexMapFile from "../annex-iv-map.json";
import obligationFile from "../obligation-subitems.json";
import { engagement } from "../commands/engagement";
import { findings } from "../commands/findings";
import { reports } from "../commands/reports";
import { caller } from "../commands/test-fixtures";
import type { Engagement, Finding, Report } from "../domain";
import { criterionRollup } from "../domain/report-gates";
import { buildDossier } from "../dossier";
import { freshEngagement } from "../factories";
import {
  command,
  artifact,
  finding as fixtureFinding,
  structuredEngagement,
} from "../workflow/test-fixtures";
import { coverageSources } from "./coverage-sources";
import {
  annexIvMapOf,
  criteriaLookup,
  criteriaRegistry,
  criteriaStamp,
  criteriaView,
  defaultFindingCriteria,
  injectRegistry,
  pinned,
  pinnedObligations,
  resolveNew,
} from "./pin";
import { entryOf, legacyPin, obligationCatalog, registry } from "./registry";
import { withSamplePack } from "./test-bundles";
import type { Bundle, CriteriaStamp } from "./types";
import { coverageFor } from "./views";

// Report capture reads assurance records and jobs from D1; none exist here.
vi.mock("../assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  pendingJobCount: vi.fn(async () => 0),
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

const AI_ACT = "eu-ai-act@02024R1689-20260727";
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

/** A command run as a promise, whether its handler throws or rejects. */
const attempt = (run: () => unknown) => Promise.resolve().then(run);
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
/** An engagement stored before pins: it resolves the legacy pin (M0). */
function legacyEngagement(): Engagement {
  const e = freshEngagement(resolveNew(), "CL-1", "Legacy", "user-lead", true);
  delete e.criteria;
  delete e.rulePack;
  return e;
}
/** Every stamp field is present and agrees with the index. */
function expectCompleteStamp(stamp: unknown) {
  const s = stamp as CriteriaStamp;
  const r = criteriaRegistry();
  expect(s.packId).toBeTruthy();
  expect(s.packVersion).toBeTruthy();
  expect(s.packSha256).toBe(
    entryOf(r, "pack", s.packId, s.packVersion)?.sha256,
  );
  expect(typeof s.legalReviewPending).toBe("boolean");
  expect(s.frameworks.length).toBeGreaterThan(0);
  for (const f of s.frameworks) {
    expect(f.sha256).toBe(
      entryOf(r, "framework", f.id, f.version, f.edition)?.sha256,
    );
    expect(["pending", "completed", "not_required"]).toContain(f.legalReview);
    expect(["primary", "supporting"]).toContain(f.role);
  }
  expect(Array.isArray(s.crosswalks)).toBe(true);
  for (const c of s.crosswalks)
    expect(c.sha256).toBe(entryOf(r, "crosswalk", c.id, c.version)?.sha256);
}

describe("explicit pins (M1)", () => {
  it("writes the legacy pin with origin legacy, and refuses a second pin", async () => {
    const e = legacyEngagement();
    const expected = legacyPin(criteriaRegistry(), e);
    const result = await engagement.run(e, "pinCriteria", {}, caller());
    expect(e.criteria).toMatchObject({
      pin: expected,
      origin: "legacy",
      pinnedBy: "user-lead",
      history: [],
    });
    expect(result).toEqual({
      details: {
        packId: expected.packId,
        packVersion: "2026.11.2",
        packSha256: expected.packSha256,
        origin: "legacy",
      },
    });
    // Behaviour is unchanged: the same pin resolves.
    expect(pinned(e).pin).toEqual(expected);
    await expect(
      attempt(() => engagement.run(e, "pinCriteria", {}, caller())),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("is for practice administrators only", async () => {
    const e = legacyEngagement();
    await expect(
      attempt(() =>
        engagement.run(e, "pinCriteria", {}, caller("Lead Auditor", false)),
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "Practice administration permission is required",
    });
    expect(e.criteria).toBeUndefined();
  });

  it("removes an explicit legacy pin that never moved, and nothing else", async () => {
    const e = legacyEngagement();
    await engagement.run(e, "pinCriteria", {}, caller());
    await engagement.run(e, "unpinCriteria", {}, caller());
    expect(e.criteria).toBeUndefined();
    await expect(
      attempt(() => engagement.run(e, "unpinCriteria", {}, caller())),
    ).rejects.toMatchObject({ status: 409 });
    // A pin written at creation is not a legacy pin.
    const created = freshEngagement(resolveNew(), "CL-1", "New", "u", true);
    await expect(
      attempt(() => engagement.run(created, "unpinCriteria", {}, caller())),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      attempt(() => engagement.run(created, "pinCriteria", {}, caller())),
    ).rejects.toMatchObject({ status: 409 });
  });
});

/** The crosswalk stamps of a pack #1 engagement in the committed bundle. */
const NIST_CROSSWALKS = [
  ["nist-ai-600-1-to-eu-ai-act", "nist-ai-600-1@2024-07"],
  ["nist-ai-rmf-to-eu-ai-act", "nist-ai-rmf@1.0"],
].map(([id, source]) => ({
  id,
  version: "2026.11.0",
  sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  source,
  target: "eu-ai-act@02024R1689-20260727",
}));

describe("report and dossier stamps", () => {
  it("stamps every report and client snapshot with the pack, frameworks and crosswalks", async () => {
    for (const e of [
      freshEngagement(resolveNew(), "CL-1", "New", "user-lead", true),
      legacyEngagement(),
    ]) {
      const r = await capture(e);
      expectCompleteStamp(r.snapshot.criteriaPack);
      expectCompleteStamp(r.clientSnapshot!.criteriaPack);
      expect(r.clientSnapshot!.criteriaPack).toEqual(r.snapshot.criteriaPack);
      expect(r.snapshot.criteriaPack).toMatchObject({
        frameworks: [
          {
            id: "eu-ai-act",
            edition: "02024R1689-20260727",
            version: "2026.11.2",
            role: "primary",
            legalReview: "pending",
          },
        ],
        // The released NIST crosswalks (#29) into pack #1's edition.
        crosswalks: NIST_CROSSWALKS,
      });
    }
  });

  it("stamps the crosswalks the pin's coverage views use", async () => {
    restore = injectRegistry(registry(withSamplePack() as Bundle));
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const stamp = criteriaStamp(e);
    expect(stamp.crosswalks.map((c) => c.id)).toEqual([
      "en-18286-to-eu-ai-act",
      "iso-iec-42001-to-eu-ai-act",
      "nist-ai-600-1-to-eu-ai-act",
      "nist-ai-rmf-to-eu-ai-act",
    ]);
    expectCompleteStamp((await capture(e)).snapshot.criteriaPack);
  });

  it("fails the stamp test when a stamp is missing", () => {
    const stamp = criteriaStamp(legacyEngagement());
    const { frameworks, ...withoutFrameworks } = stamp;
    expect(frameworks.length).toBe(1);
    expect(() => expectCompleteStamp(withoutFrameworks)).toThrow();
    const { crosswalks, ...withoutCrosswalks } = stamp;
    expect(crosswalks).toEqual(NIST_CROSSWALKS);
    expect(() => expectCompleteStamp(withoutCrosswalks)).toThrow();
  });

  it("carries the stamps into the dossier's report.json and readable report", async () => {
    const e = freshEngagement(resolveNew(), "CL-1", "New", "user-lead", true);
    const r = await capture(e);
    for (const client of [true, false]) {
      const dossier = await buildDossier(caller(), e, r, client, "KEY-1");
      const file = (path: string) =>
        atob(dossier.files.find((f) => f.path === path)!.contentBase64);
      const report = JSON.parse(file("report.json"));
      expectCompleteStamp(report.criteriaPack);
      expect(file("report.html")).toContain(
        "assessed against eu-ai-act 02024R1689-20260727 (data 2026.11.2)",
      );
    }
  });
});

describe("generated obligation file and Annex IV map", () => {
  it("generates both files from the default pack, without loss", () => {
    const resolved = resolveNew();
    const framework = resolved.frameworks[0];
    expect(obligationCatalog(framework)).toEqual(obligationFile);
    expect(annexIvMapOf(resolved)).toEqual(annexMapFile);
    // The committed files are exactly what `npm run sync` writes from the
    // documents as authored (check:sync compares the same bytes).
    const criteria = readCriteria();
    const doc = (path: string) => criteria.documents.get(path);
    const d = criteria.index.defaults.pack;
    const pack = doc(`packs/${d.id}/${d.version}.json`);
    const set = pack.criteria[0];
    const fw = doc(
      `frameworks/${set.framework}/${set.edition}/${set.version}.json`,
    );
    const committed = (file: string) =>
      readFileSync(new URL("../../../" + file, import.meta.url), "utf8");
    expect(committed("docs/obligation-subitems.json")).toBe(
      serialise(obligationCatalog(fw)),
    );
    expect(committed("templates/annex-iv-map.json")).toBe(
      serialise(servedAnnexMap(criteria, pack)),
    );
  });

  it("serves pack #1 2026.11.2 the map of the current pack #1 version", async () => {
    const e = legacyEngagement();
    expect(pinned(e).pack.annexIvMap).toBeUndefined();
    expect(annexIvMapOf(pinned(e))).toBe(annexIvMapOf(resolveNew()));
    const r = await capture(e);
    expect(r.snapshot.annexMapVersion).toBe("2026.11.1");
    expect(Array.isArray(r.snapshot.annexIV)).toBe(true);
  });

  it("reports a hand edit of either generated file as drift", async () => {
    const criteria = readCriteria();
    expect(await checkMethodologyDrift(criteria)).toEqual([]);
    const obligations = structuredClone(obligationFile) as {
      items: { title: string }[];
    };
    obligations.items[0].title = "Edited by hand";
    const annexMap = structuredClone(annexMapFile);
    annexMap.sections[0].paperIds.push("WP-PL-01");
    const found = await checkMethodologyDrift(criteria, {
      obligations,
      annexMap,
    });
    expect(found).toEqual([
      expect.stringMatching(
        /^drift: docs\/obligation-subitems.json .* run npm run sync/,
      ),
      expect.stringMatching(
        /^drift: templates\/annex-iv-map.json .* run npm run sync/,
      ),
    ]);
    // Canonical comparison: key order alone is not drift.
    expect(canonicalize(obligationFile)).toBe(
      canonicalize(JSON.parse(JSON.stringify(obligationFile))),
    );
  });
});

describe("obligation subitems from the pinned framework", () => {
  it("serves the workbench its options from GET /api/workspace", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const view = criteriaView(e);
    const catalog = pinnedObligations(e)!;
    expect(view.obligations?.items.map((o) => o.code)).toEqual(
      catalog.items.map((o) => o.code),
    );
    expect(view.obligations).toMatchObject({
      scope: catalog.scope,
      source: { url: catalog.source.url, version: catalog.source.version },
      catalogVersion: catalog.catalogVersion,
    });
    expect(
      view.obligations!.items.find((o) => o.code === "AIA-AIV-8")!.legalReview,
    ).toMatchObject({ required: true });
    // Client roles get neither the options nor the finding criteria.
    expect(criteriaView(e, false)).not.toHaveProperty("obligations");
    expect(criteriaView(e, false)).not.toHaveProperty("findingCriteria");
  });

  it("reads the codes of the pinned framework, not the build's file", () => {
    const changed = structuredClone(withSamplePack()) as Bundle;
    const fw = changed.documents.find(
      (d) => d.documentType === "framework" && d.id === "eu-ai-act",
    )!;
    if (fw.documentType !== "framework") throw new Error("framework");
    fw.compat!.obligations!.order = ["AIA-9-1"];
    restore = injectRegistry(registry(changed));
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    expect(pinnedObligations(e)!.items.map((o) => o.code)).toEqual(["AIA-9-1"]);
    expect(criteriaView(e).obligations!.items).toHaveLength(1);
  });

  it("has no obligation options on a pack without obligation assessments", () => {
    restore = injectRegistry(registry(withSamplePack() as Bundle));
    const e = freshEngagement(
      resolveNew("en18286-iso42001"),
      "CL-1",
      "AIMS",
      "lead",
      true,
    );
    expect(pinnedObligations(e)).toBeNull();
    expect(criteriaView(e)).not.toHaveProperty("obligations");
    expect(criteriaView(e).findingCriteria!.length).toBeGreaterThan(0);
  });
});

describe("findings that reference criteria", () => {
  const base = {
    title: "Risk register incomplete",
    article: "9",
    condition: "Two risks lack treatment",
    criteria: "Art. 9(2)",
    cause: "",
    effect: "Untreated risk",
    likelihood: 4,
    impact: 4,
    owner: "Provider",
    dueDate: "2026-12-31",
    visibility: "client",
  };
  const last = (e: Engagement) => e.findings.at(-1) as Finding;

  it("validates references against the pin", async () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    await findings.run(
      e,
      "createFinding",
      { ...base, criteriaRefs: ["eu-ai-act:AIA-9-1", "eu-ai-act:AIA-9-1"] },
      caller(),
    );
    expect(last(e).criteriaRefs).toEqual(["eu-ai-act:AIA-9-1"]);
    await expect(
      attempt(() =>
        findings.run(
          e,
          "createFinding",
          { ...base, criteriaRefs: ["iso-iec-42001:6.1.2"] },
          caller(),
        ),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await findings.run(e, "createFinding", base, caller());
    expect(last(e)).not.toHaveProperty("criteriaRefs");
  });

  it("defaults the references from the item of the finding's procedure", async () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const p = e.workflow!.procedures.find((x) => x.templateId === "WP-A09-01")!;
    p.execution = { evidenceIds: [], runIds: [] } as never;
    await findings.run(
      e,
      "createFinding",
      { ...base, procedureId: p.id },
      caller(),
    );
    expect(last(e).criteriaRefs).toEqual(["eu-ai-act:AIA-ART-9"]);
    expect(defaultFindingCriteria(e, "MEM-EX-01")).toEqual([]);
  });

  it("defaults the references when support links a procedure later", async () => {
    const e = structuredEngagement({
      findings: [fixtureFinding()],
      artifacts: [artifact()],
    });
    const p = e.workflow!.procedures.find((x) => x.templateId === "WP-A10-01")!;
    await command(
      e,
      "linkFindingSupport",
      {
        findingId: "finding",
        procedureId: p.id,
        paperIds: [],
        evidenceIds: ["evidence"],
        runIds: [],
      },
      "auditor",
    );
    expect(e.findings[0].criteriaRefs).toEqual(
      defaultFindingCriteria(e, "WP-A10-01"),
    );
    expect(e.findings[0].criteriaRefs).toContain("eu-ai-act:AIA-ART-10");
    // References already chosen are kept.
    const chosen = structuredEngagement({
      findings: [fixtureFinding({ criteriaRefs: ["eu-ai-act:AIA-10-3"] })],
      artifacts: [artifact()],
    });
    await command(
      chosen,
      "linkFindingSupport",
      {
        findingId: "finding",
        procedureId: p.id,
        paperIds: [],
        evidenceIds: ["evidence"],
        runIds: [],
      },
      "auditor",
    );
    expect(chosen.findings[0].criteriaRefs).toEqual(["eu-ai-act:AIA-10-3"]);
  });

  it("sets references on an existing finding without touching remediation", async () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    await findings.run(e, "createFinding", base, caller());
    const f = last(e);
    await findings.run(
      e,
      "setFindingCriteria",
      { findingId: f.id, criteriaRefs: ["eu-ai-act:AIA-ART-10"] },
      caller("Auditor"),
    );
    expect(f.criteriaRefs).toEqual(["eu-ai-act:AIA-ART-10"]);
    expect(f.remediationBy).toBeUndefined();
    await findings.run(
      e,
      "setFindingCriteria",
      { findingId: f.id, criteriaRefs: [] },
      caller(),
    );
    expect(f).not.toHaveProperty("criteriaRefs");
  });

  it("places an unlinked unresolved finding on its criteria as open work", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    e.findings.push(
      { ...base, id: "F-1", status: "open", severity: "High" } as Finding,
      {
        ...base,
        id: "F-2",
        status: "open",
        severity: "Low",
        criteriaRefs: ["eu-ai-act:AIA-9-1"],
      } as Finding,
      {
        ...base,
        id: "F-3",
        status: "closed",
        severity: "Low",
        criteriaRefs: ["eu-ai-act:AIA-9-2"],
      } as Finding,
    );
    const result = coverageSources(e, [], null);
    expect(result.unplacedFindings).toBe(1);
    expect(result.findingLinks).toEqual([
      { sourceId: "F-2", requirement: "eu-ai-act:AIA-9-1" },
    ]);
    const view = coverageFor(criteriaRegistry(), pinned(e), e, [], AI_ACT)!;
    const cell = view.cells.find((c) => c.id === "AIA-9-1")!;
    expect(cell.state).toBe("open");
    expect(cell.contributions).toEqual([
      expect.objectContaining({
        sourceId: "F-2",
        state: "open",
        path: expect.objectContaining({ via: "finding" }),
        source: expect.objectContaining({ kind: "finding" }),
      }),
    ]);
    expect(view.notes.unplacedFindings).toBe(1);
  });

  it("rolls unlinked findings up by criterion through their references", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const p = e.workflow!.procedures.find((x) => x.templateId === "WP-A09-01")!;
    p.selected = true;
    p.applicability = "applicable";
    e.findings.push(
      {
        ...base,
        id: "F-1",
        status: "open",
        severity: "High",
        visibility: "internal",
        criteriaRefs: ["eu-ai-act:AIA-9-1"],
      } as Finding,
      {
        ...base,
        id: "F-2",
        status: "open",
        severity: "Low",
        criteriaRefs: ["eu-ai-act:AIA-ART-50"],
      } as Finding,
    );
    const lookup = criteriaLookup(e);
    const rollup = criterionRollup(e, undefined, lookup);
    // AIA-9-1 sits under Art. 9, which WP-A09-01 links: the High finding
    // counts there and gives the criterion exceptions.
    expect(rollup.find((c) => c.criterion === p.criterion)).toMatchObject({
      procedures: 1,
      openFindings: 1,
      openHighFindings: 1,
      result: "exceptions",
    });
    // No selected procedure links Art. 50: a criterion of its own.
    expect(
      rollup.find((c) => c.criterion === "EU AI Act (amended) Art. 50"),
    ).toEqual(
      expect.objectContaining({
        procedures: 0,
        openFindings: 1,
        result: "not_evaluated",
      }),
    );
    // The client report counts only client-visible findings.
    const client = criterionRollup(e, (f) => f.visibility === "client", lookup);
    expect(client.find((c) => c.criterion === p.criterion)).toMatchObject({
      openFindings: 0,
      result: "exceptions",
    });
    // Without the lookup the roll-up is as before phase 2.
    expect(criterionRollup(e).map((c) => c.criterion)).not.toContain(
      "EU AI Act (amended) Art. 50",
    );
  });

  it("opens no client criterion for an internal finding below High", () => {
    const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
    const p = e.workflow!.procedures.find((x) => x.templateId === "WP-A09-01")!;
    p.selected = true;
    p.applicability = "applicable";
    e.findings.push({
      ...base,
      id: "F-1",
      status: "open",
      severity: "Low",
      visibility: "internal",
      criteriaRefs: ["eu-ai-act:AIA-ART-50"],
    } as Finding);
    const lookup = criteriaLookup(e);
    const art50 = "EU AI Act (amended) Art. 50";
    // The internal roll-up keeps the criterion of its own.
    expect(
      criterionRollup(e, undefined, lookup).find((c) => c.criterion === art50),
    ).toMatchObject({ procedures: 0, openFindings: 1 });
    // The client report does not show a criterion nothing it lists supports.
    const clientOnly = (f: Finding) => f.visibility === "client";
    expect(
      criterionRollup(e, clientOnly, lookup).map((c) => c.criterion),
    ).not.toContain(art50);
    // An internal High finding still reaches the client result.
    (e.findings.at(-1) as Finding).severity = "High";
    expect(
      criterionRollup(e, clientOnly, lookup).find((c) => c.criterion === art50),
    ).toMatchObject({ openFindings: 0, result: "exceptions" });
  });
});
