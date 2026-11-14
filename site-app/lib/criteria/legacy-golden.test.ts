// Seeding and paper templates per legacy class (docs/design/criteria-model.md
// section 11.3, test 4 of section 16). legacy-golden.json holds the JCS
// digests of seedWorkflow, templatePaper (every item) and freshEngagement as
// main@f6d2a8e produced them, with ids and time stubbed: the build just before
// the refactor onto the pinned pack. Each legacy class must resolve to a pack
// version that reproduces them exactly.
import { describe, expect, it, vi } from "vitest";

let n = 0;
vi.mock("../ids", () => ({
  id: (prefix: string) => prefix + "-" + String(++n).padStart(4, "0"),
  now: () => "2026-11-06T12:00:00.000Z",
  sha256: async () => "0".repeat(64),
}));

import { digest } from "../../../schemas/validate-criteria.mjs";
import type { Engagement } from "../domain/types";
import { freshEngagement, templatePaper } from "../factories";
import { seedWorkflow } from "../workflow-seed";
import golden from "./legacy-golden.json";
import { pinned } from "./pin";

const classes: [string, Pick<Engagement, "criteria" | "rulePack">][] = [
  ["no rule-pack stamp", {}],
  [
    "stamp 2026.11.1",
    {
      rulePack: {
        version: "2026.11.1",
        legalVersion: "02024R1689-20260727",
        researchedAsOf: "2026-11-05",
        legalReview: "pending",
      },
    },
  ],
  [
    "stamp 2026.11.2",
    {
      rulePack: {
        version: "2026.11.2",
        legalVersion: "02024R1689-20260727",
        researchedAsOf: "2026-11-05",
        legalReview: "pending",
      },
    },
  ],
];

describe.each(classes)("legacy class: %s", (_, legacy) => {
  const resolved = pinned(legacy);
  it("resolves to pack #1 2026.11.2", () => {
    expect(resolved.pin).toMatchObject({
      packId: "eu-ai-act-amended",
      packVersion: "2026.11.2",
    });
  });
  it("seeds the workflow the build before #27 seeded", () => {
    expect(
      digest(seedWorkflow(resolved, "lead", "2026-11-06T12:00:00.000Z")),
    ).toBe(golden.seedWorkflow);
  });
  it("creates every template's paper as before", () => {
    const papers = Object.fromEntries(
      resolved.pack.items.map((t) => {
        n = 0;
        return [t.id, digest(templatePaper(resolved, t.id, "auditor"))];
      }),
    );
    expect(papers).toEqual(golden.templatePapers);
  });
});

describe("new engagements on pack #1", () => {
  it.each([false, true])(
    "are as before, plus the pin (structured: %s)",
    (structured) => {
      n = 0;
      const e = freshEngagement(
        pinned({}),
        "CL-1",
        "Golden",
        "lead",
        structured,
      );
      expect(e.criteria).toEqual({
        pin: pinned({}).pin,
        pinnedAt: "2026-11-06T12:00:00.000Z",
        pinnedBy: "lead",
        origin: "created",
        history: [],
      });
      delete e.criteria;
      expect(digest(e)).toBe(
        structured ? golden.freshStructured : golden.freshEngagement,
      );
    },
  );
});
