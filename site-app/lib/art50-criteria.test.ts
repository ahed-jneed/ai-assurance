import { describe, expect, it } from "vitest";
import {
  art50BandText,
  art50Criteria,
  art50CriteriaSource,
  libraryRef,
} from "./art50-criteria";
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
