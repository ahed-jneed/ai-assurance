import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ART50_GENAI_METRICS,
  art50BandText,
  art50Criteria,
  art50CriteriaSource,
  art50GenaiPlan,
  libraryRef,
} from "./art50-criteria";
import { genaiPlan } from "./genai/requests";
import catalog from "./catalog.json";
import type { CriteriaTemplate } from "./catalog-criteria";
import library from "./threshold-library.json";

// The Art 50 statistical criteria as data (#120): each deciding criterion
// names the threshold-library entry (A50-ED-40) whose parameters give its band.
const items = catalog.items as ((typeof catalog.items)[number] &
  CriteriaTemplate)[];

describe("Art 50 statistical criteria", () => {
  it("resolve every criterion the catalogue's Art 50 papers name", () => {
    const named = items.flatMap(
      (i) =>
        i.researchProcedures?.procedures.flatMap((p) => p.criterionIds) ?? [],
    );
    const resolved = art50Criteria(
      items.flatMap(
        (i) => i.researchProcedures?.procedures.map((p) => p.procedureId) ?? [],
      ),
    );
    expect(resolved.map((c) => c.id)).toEqual(named);
    expect(named).toEqual([
      "A50-P-01-C01",
      "A50-P-02A-C01",
      "A50-P-04A-C01",
      "A50-P-04A-C02",
      "A50-P-04B-C01",
      "A50-P-02C-C01",
      "A50-P-02C-C02",
      "A50-P-02C-C03",
      "A50-P-02F-C01",
    ]);
    for (const c of resolved)
      if (c.role === "descriptive") expect(c.entry, c.id).toBeNull();
      else
        expect(c.entry, c.id).toMatchObject({
          legalStatus: "no_legal_safe_harbour",
          caveat: art50CriteriaSource.caveat,
        });
  });

  it("take each band from its threshold-library entry", () => {
    const [probe] = art50Criteria(["A50-P-01"]);
    expect(probe).toMatchObject({
      id: "A50-P-01-C01",
      band: { lower: 0.98 },
      libraryEntry: {
        id: "policy.eu-aia.art50-disclosure-probe",
        version: 1,
        parameters: { lower: 0.98 },
      },
    });
    const entry = library.entries.find((e) => e.id === probe.libraryEntry!.id);
    expect(probe.libraryEntry!.parameters.lower).toBe(
      entry!.parameters.lower!.default,
    );
    expect(libraryRef(probe)).toBe("policy.eu-aia.art50-disclosure-probe@1");
    expect(art50BandText(probe)).toBe("lower bound 0.98");
  });

  it("describe declared-rate bands and descriptive members", () => {
    const [detection, falsePositive, robustness] = art50Criteria(["A50-P-02C"]);
    expect(art50BandText(detection)).toBe(
      "lower bound 0.95 when no rate is declared; otherwise the declared rate minus 0.02",
    );
    expect(art50BandText(falsePositive)).toBe(
      "upper bound 0.01 when no rate is declared; otherwise the declared rate plus 0.005",
    );
    expect(art50BandText(robustness)).toBe("Descriptive: no band");
    expect(libraryRef(robustness)).toBe("none");
    expect(art50Criteria(["A50-P-00", "A50-P-99"])).toEqual([]);
  });
});

// #152: the criteria GenAI marking evidence decides (genai_marking, #32) are
// pre-registered in a GenAI plan; the others stay attribute sampling.
const genaiPlanSource = readFileSync(
  new URL("../../engine/genai/plan.py", import.meta.url),
  "utf8",
);

describe("Art 50 criteria in a GenAI plan", () => {
  it("pre-register the marking and detection criteria of WP-XC-12 and leave the rest", () => {
    const g = art50GenaiPlan("WP-XC-12")!;
    expect(g.plan).toEqual({
      schemaVersion: "genai-plan/0.1",
      minimums: { memberSize: 30 },
      criteria: [
        {
          id: "A50-P-02C-C01",
          kind: "genai_marking",
          role: "confirmatory",
          metric: "detection_rate",
          band: { lower: 0.95 },
        },
        {
          id: "A50-P-02C-C02",
          kind: "genai_marking",
          role: "confirmatory",
          metric: "false_positive_rate",
          band: { upper: 0.01 },
        },
      ],
    });
    expect(g.notDecided.map((c) => c.id)).toEqual([
      "A50-P-02C-C03",
      "A50-P-02F-C01",
    ]);
    // The workspace's own check of a plan before it freezes it.
    expect(genaiPlan.safeParse(g.plan).success).toBe(true);
  });

  it("pre-register marking presence and the self-identification probe, and nothing for the deep-fake paper", () => {
    expect(art50GenaiPlan("WP-XC-10")!.plan.criteria).toEqual([
      expect.objectContaining({
        id: "A50-P-02A-C01",
        metric: "marking_presence",
        band: { lower: 0.95 },
      }),
    ]);
    expect(art50GenaiPlan("WP-XC-07")!.plan.criteria).toEqual([
      expect.objectContaining({
        id: "A50-P-01-C01",
        metric: "self_identification_rate",
        band: { lower: 0.98 },
      }),
    ]);
    expect(art50GenaiPlan("WP-XC-11")).toBeNull();
    expect(art50GenaiPlan("WP-A10-01")).toBeNull();
  });

  it("use only metrics and criterion keys the engine's genai-plan/0.1 accepts", () => {
    const marking = /MARKING_METRICS = \(([^)]*)\)/.exec(genaiPlanSource)![1];
    for (const metric of Object.values(ART50_GENAI_METRICS))
      expect(marking).toContain('"' + metric + '"');
    const allowed = /allowed = \(([^)]*)\)/.exec(genaiPlanSource)![1];
    for (const key of ["id", "kind", "role", "metric", "band"])
      expect(allowed).toContain('"' + key + '"');
    // The engine's floor of 10 per member may be raised, never lowered.
    expect(genaiPlanSource).toContain('"memberSize": 10');
  });
});
