// The loader and the lossless projections of pack #1 (docs/design/criteria-model.md
// sections 11.3, 11.4 and 14.4; tests 3 to 5 of section 16).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digest } from "../../../schemas/validate-criteria.mjs";
import catalog from "../catalog.json";
import obligations from "../obligation-subitems.json";
import {
  criteriaFor,
  defaultPin,
  displayRefs,
  features,
  legacyCatalog,
  legacyPin,
  obligationCatalog,
  pinOf,
  registry,
  resolve,
  selectablePacks,
} from "./registry";
import type { Bundle } from "./types";

const r = registry();
/** Pack #1 2026.11.2, which every legacy class resolves to. */
const pack1 = resolve(r, legacyPin(r, {}));
const PACK_SHA =
  "63fd1dfa21b1df4bf860776dbbddb4cf885abf53ecdd3b6add96d2c582229c81";
/** Pack #1 2026.11.3 (phase 2, #61): 2026.11.2 plus its Annex IV map. */
const PACK_SHA_2026_11_3 =
  "a92288fa3921dedd0099fd64152f05a063269280a9bc426e4380f075d6864554";
const legacyPinValue = {
  packId: "eu-ai-act-amended",
  packVersion: "2026.11.2",
  packSha256: PACK_SHA,
};

/**
 * JCS digests of templates/catalog.json and docs/obligation-subitems.json at
 * main@f6d2a8e, the build #27 started from (methodology and rule pack
 * 2026.11.2, obligation catalogue 2026.11.06-proposed, #19's edits included).
 * They stand in for committed copies of the two files: pack #1 2026.11.2 must
 * project to exactly this content for as long as it exists.
 */
const CATALOG_2026_11_2 =
  "6d5601ca3cc06105f4b7048343450e890945ffb56fe46b3ab6643286b4f7cf7b";
const OBLIGATIONS_2026_11_2 =
  "2b44539b1b71321b5f251e8294db5152990a9726b34e58bcc578dbe814dd641c";

describe("pack #1 projections", () => {
  it("projects the pack back to the 2026.11.2 catalogue exactly", () => {
    expect(digest(legacyCatalog(pack1.pack))).toBe(CATALOG_2026_11_2);
    expect(legacyCatalog(pack1.pack)).toEqual(catalog);
    // Item order is kept. Key order is not: the bundle is in JCS order, and
    // nothing reads catalogue objects by key position.
    expect(legacyCatalog(pack1.pack).items.map((i) => i.id)).toEqual(
      catalog.items.map((i) => i.id),
    );
  });

  it("projects the framework back to the whole obligation file", () => {
    const projected = obligationCatalog(pack1.frameworks[0]);
    expect(digest(JSON.parse(JSON.stringify(projected)))).toBe(
      OBLIGATIONS_2026_11_2,
    );
    expect(projected).toEqual(obligations);
    expect(projected!.items.map((i) => i.code)).toEqual(
      obligations.items.map((i) => i.code),
    );
  });

  it("keeps the 2026.11.2 programme and framework in pack #1 2026.11.3", () => {
    const next = resolve(r, defaultPin(r));
    expect(next.pin.packVersion).toBe("2026.11.3");
    expect(digest(legacyCatalog(next.pack))).toBe(CATALOG_2026_11_2);
    expect(next.frameworks).toEqual(pack1.frameworks);
    const { version, supersedes, annexIvMap, notes, ...rest } = next.pack;
    const { version: v0, notes: n0, ...before } = pack1.pack;
    expect([version, supersedes, v0]).toEqual([
      "2026.11.3",
      "2026.11.2",
      "2026.11.2",
    ]);
    expect(rest).toEqual(before);
    expect(annexIvMap?.mapVersion).toBe("2026.11.1");
    expect(notes).not.toEqual(n0);
  });

  it("switches every AI Act feature on and keeps the route roles", () => {
    expect(features(pack1.pack)).toEqual({
      annexIvIndex: true,
      aiActClassification: true,
      obligationAssessments: true,
      statementOfApplicability: false,
      nonconformityGrading: false,
      certificationRecommendation: false,
      ll144BiasAudit: false,
    });
    expect(pack1.pack.roles).toEqual({
      limitationMemo: "MEM-EX-01",
      diagnosticPaperByResultArticle: { 10: "WP-A10-02", "*": "WP-A15-01" },
      externalExecutionPaper: "WP-A15-01",
    });
  });

  it("derives display references and links from the pin", () => {
    const wp = pack1.pack.items.find((i) => i.id === "WP-A09-01")!;
    expect(displayRefs(pack1, wp)).toEqual(wp.regulatoryRefs);
    expect(criteriaFor(pack1.pack, "WP-A09-01")).toEqual([
      expect.objectContaining({
        requirement: "eu-ai-act:AIA-ART-9",
        relationship: "intersects_with",
        origin: "migrated",
        objectiveId: "CO-WP-A09-01",
      }),
    ]);
    expect(criteriaFor(pack1.pack, "MEM-EX-01")).toEqual([]);
  });
});

describe("pins", () => {
  it("pins new engagements to the default pack", () => {
    expect(defaultPin(r)).toEqual({
      packId: "eu-ai-act-amended",
      packVersion: "2026.11.3",
      packSha256: PACK_SHA_2026_11_3,
    });
    // The legacy version stays selectable by its exact version.
    expect(defaultPin(r, "eu-ai-act-amended", "2026.11.2")).toEqual(
      legacyPinValue,
    );
    expect(defaultPin(r, "eu-ai-act-amended")).toEqual(defaultPin(r));
    expect(() => defaultPin(r, "no-such-pack")).toThrow(
      "Choose a released criteria pack",
    );
    expect(() => defaultPin(r, "eu-ai-act-amended", "2026.10.1")).toThrow(
      "Choose a released criteria pack",
    );
  });

  // Each legacy class (section 11.4): no #18 stamp, and every stamp value
  // #18 and #77 write. The build before #27 served all of them the 2026.11.2
  // catalogue, so all resolve to pack #1 2026.11.2.
  it.each([
    ["no stamp", {}],
    ["stamp 2026.11.1", { rulePack: { version: "2026.11.1" } }],
    ["stamp 2026.11.2", { rulePack: { version: "2026.11.2" } }],
  ])("resolves an engagement with %s to pack #1 2026.11.2", (_, e) => {
    expect(legacyPin(r, e)).toEqual(legacyPinValue);
    expect(pinOf(r, e)).toEqual(legacyPinValue);
  });

  it("fails closed on an unknown stamp", () => {
    expect(() => legacyPin(r, { rulePack: { version: "2026.12.9" } })).toThrow(
      "rule-pack stamp 2026.12.9 has no criteria pack",
    );
  });

  it("prefers the stored pin and checks its digest", () => {
    const pin = { ...defaultPin(r) };
    expect(pinOf(r, { criteria: { pin } })).toBe(pin);
    expect(() => resolve(r, { ...pin, packSha256: "0".repeat(64) })).toThrow(
      "is not available in this build",
    );
  });
});

describe("registry", () => {
  it("deep-freezes documents and keeps indexes outside them", () => {
    expect(Object.isFrozen(pack1.pack)).toBe(true);
    expect(Object.isFrozen(pack1.pack.items[0].procedures[0])).toBe(true);
    expect(digest(pack1.pack)).toBe(PACK_SHA);
  });

  it("offers pack #1, the GenAI pack and the LL144 pack at engagement creation, with their legal review pending", () => {
    expect(selectablePacks(r)).toEqual([
      expect.objectContaining({
        id: "eu-ai-act-amended",
        version: "2026.11.3",
        isDefault: true,
        workingPapers: 36,
        memos: 12,
        legalReviewPending: true,
        clauseNumbersOnly: false,
      }),
      expect.objectContaining({
        id: "genai-evaluation",
        version: "2026.11.2",
        isDefault: false,
        workingPapers: 7,
        memos: 1,
        legalReviewPending: true,
        clauseNumbersOnly: true,
      }),
      expect.objectContaining({
        id: "nyc-ll144-bias-audit",
        version: "2026.11.1",
        isDefault: false,
        workingPapers: 7,
        memos: 2,
        legalReviewPending: true,
        clauseNumbersOnly: true,
        phases: ["Planning", "Fieldwork", "Reporting"],
      }),
    ]);
  });

  it("injects fixture bundles; drafts and unconfirmed licences are not selectable", () => {
    const sample = JSON.parse(
      readFileSync(
        new URL(
          "../../../schemas/fixtures/criteria-pack.en18286-iso42001.sample.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Bundle;
    const injected = registry(sample);
    expect(injected).toBe(registry(sample));
    expect(selectablePacks(injected)).toEqual([]);
  });
});
