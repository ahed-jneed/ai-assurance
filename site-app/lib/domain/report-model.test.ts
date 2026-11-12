import { describe, expect, it } from "vitest";
import {
  conclusionStatement,
  conclusionTypes,
  emptyReportSettings,
  engagementTypeIds,
  engagementTypes,
  legacyConclusion,
  normalizeTerms,
  offeredEngagementTypes,
  opinionLabel,
  parseReportSettings,
  qualityStatement,
  reportTitle,
  requiresSupport,
  resolveParticulars,
  snapshotConclusion,
  snapshotParticulars,
  snapshotTerms,
  statesBasis,
  termsLabel,
  termsProblem,
  type AssuranceLevel,
  type ReportTerms,
} from "./report-model";

const assurance = (
  conclusion: ReportTerms["conclusion"],
  assuranceLevel: AssuranceLevel,
  engagementType: ReportTerms["engagementType"] = "attestation",
): ReportTerms => ({ engagementType, assuranceLevel, conclusion });
const statement = (t: ReportTerms) =>
  conclusionStatement(t, "the AI system Scorer", "the stated criteria");

describe("report terms", () => {
  it("requires a level for assurance engagements and none for the others", () => {
    for (const type of ["attestation", "direct"] as const) {
      expect(termsProblem(assurance("unmodified", "limited", type))).toBe("");
      expect(termsProblem(assurance("unmodified", "reasonable", type))).toBe(
        "",
      );
      expect(
        termsProblem({
          engagementType: type,
          assuranceLevel: null,
          conclusion: "unmodified",
        }),
      ).toMatch(/requires a limited or reasonable assurance level/);
    }
    expect(
      termsProblem({
        engagementType: "agreed_upon_procedures",
        assuranceLevel: "limited",
        conclusion: "factual_findings",
      }),
    ).toMatch(/provides no assurance/);
    expect(
      termsProblem({
        engagementType: "readiness",
        assuranceLevel: null,
        conclusion: "readiness",
      }),
    ).toBe("");
  });

  it("lets each engagement type express only its own conclusions", () => {
    expect(
      termsProblem({
        engagementType: "readiness",
        assuranceLevel: null,
        conclusion: "unmodified",
      }),
    ).toMatch(/cannot express an? unmodified/i);
    expect(termsProblem(assurance("readiness", "limited"))).toMatch(
      /cannot express/,
    );
    expect(
      termsProblem({
        engagementType: "agreed_upon_procedures",
        assuranceLevel: null,
        conclusion: "qualified",
      }),
    ).toMatch(/cannot express/);
    for (const type of engagementTypeIds)
      for (const c of engagementTypes[type].conclusions)
        expect(
          termsProblem(normalizeTerms({ engagementType: type, conclusion: c })),
        ).toBe("");
  });

  it("normalizes a picker choice to valid terms", () => {
    expect(normalizeTerms({})).toEqual({
      engagementType: "attestation",
      assuranceLevel: "limited",
      conclusion: "unmodified",
    });
    expect(
      normalizeTerms({
        engagementType: "readiness",
        assuranceLevel: "reasonable",
        conclusion: "qualified",
      }),
    ).toEqual({
      engagementType: "readiness",
      assuranceLevel: null,
      conclusion: "readiness",
    });
    expect(
      normalizeTerms({
        engagementType: "direct",
        assuranceLevel: "reasonable",
        conclusion: "disclaimer",
      }),
    ).toEqual(assurance("disclaimer", "reasonable", "direct"));
  });
});

describe("ISAE 3000 conclusion wording", () => {
  it("words reasonable assurance as an opinion", () => {
    const unmodified = statement(assurance("unmodified", "reasonable"));
    expect(unmodified.heading).toBe("Opinion");
    expect(unmodified.text).toMatch(/^In our opinion, /);
    expect(unmodified.text).toContain("in all material respects");
    expect(unmodified.basisHeading).toBe("");
    expect(unmodified.levelStatement).toContain("Reasonable assurance");
    expect(statement(assurance("qualified", "reasonable"))).toMatchObject({
      heading: "Qualified opinion",
      basisHeading: "Basis for qualified opinion",
    });
    expect(statement(assurance("qualified", "reasonable")).text).toMatch(
      /^In our opinion, except for the effects, or possible effects, of the matter/,
    );
  });

  it("covers the possible effects of a scope limitation in either qualified wording", () => {
    for (const level of ["limited", "reasonable"] as const)
      expect(statement(assurance("qualified", level)).text).toContain(
        "except for the effects, or possible effects, of the matter described",
      );
  });

  it("words limited assurance as a negative-form conclusion", () => {
    for (const c of ["unmodified", "qualified"] as const) {
      const s = statement(assurance(c, "limited"));
      expect(s.text).toContain(
        "nothing has come to our attention that causes us to believe",
      );
      expect(s.text).not.toContain("In our opinion");
      expect(s.levelStatement).toContain("substantially lower");
    }
    expect(statement(assurance("unmodified", "limited")).heading).toBe(
      "Conclusion",
    );
    expect(statement(assurance("qualified", "limited"))).toMatchObject({
      heading: "Qualified conclusion",
      basisHeading: "Basis for qualified conclusion",
    });
  });

  it("states an adverse conclusion as non-conformity at either level", () => {
    for (const level of ["limited", "reasonable"] as const) {
      const s = statement(assurance("adverse", level));
      expect(s.text).toContain("is not in accordance with the stated criteria");
      expect(s.text).not.toContain("nothing has come to our attention");
      expect(s.basisHeading).toMatch(
        /^Basis for adverse (opinion|conclusion)$/,
      );
    }
  });

  it("expresses no conclusion in a disclaimer", () => {
    const opinion = statement(assurance("disclaimer", "reasonable")),
      conclusion = statement(assurance("disclaimer", "limited"));
    expect(opinion.heading).toBe("Disclaimer of opinion");
    expect(opinion.text).toContain("we do not express an opinion");
    expect(conclusion.heading).toBe("Disclaimer of conclusion");
    expect(conclusion.text).toContain("we do not express a conclusion");
    for (const s of [opinion, conclusion])
      expect(s.text).toContain("sufficient appropriate evidence");
  });

  it("names the subject matter information in attestation engagements", () => {
    expect(statement(assurance("unmodified", "limited")).text).toContain(
      "the subject matter information on the AI system Scorer",
    );
    expect(
      statement(assurance("unmodified", "limited", "direct")).text,
    ).not.toContain("subject matter information");
  });

  it("labels readiness and agreed-upon procedures as not assurance", () => {
    const readiness = statement({
        engagementType: "readiness",
        assuranceLevel: null,
        conclusion: "readiness",
      }),
      aup = statement({
        engagementType: "agreed_upon_procedures",
        assuranceLevel: null,
        conclusion: "factual_findings",
      });
    for (const s of [readiness, aup]) {
      expect(s.notAssurance).toBe(true);
      expect(s.heading).toContain("not an assurance engagement");
      expect(s.levelStatement).toBe("");
    }
    expect(
      reportTitle({
        engagementType: "readiness",
        assuranceLevel: null,
        conclusion: "readiness",
      }),
    ).toContain("not an assurance report");
    expect(reportTitle(assurance("unmodified", "limited"))).toBe(
      "Independent limited assurance report",
    );
  });

  it("ends a certification audit in a recommendation, not an assurance conclusion", () => {
    const t = (conclusion: ReportTerms["conclusion"]): ReportTerms => ({
      engagementType: "certification",
      assuranceLevel: null,
      conclusion,
    });
    expect(engagementTypes.certification.assurance).toBe(false);
    expect(engagementTypes.certification.conclusions).toEqual([
      "certification_recommended",
      "certification_deferred",
      "certification_not_recommended",
    ]);
    expect(termsProblem(t("certification_recommended"))).toBe("");
    expect(
      termsProblem(assurance("unmodified", "reasonable", "certification")),
    ).toMatch(/provides no assurance/);
    expect(termsProblem(t("unmodified"))).toMatch(/cannot express/);
    expect(reportTitle(t("certification_recommended"))).toBe(
      "AI management system certification audit report",
    );
    const recommended = statement(t("certification_recommended"));
    expect(recommended.heading).toBe(
      "Audit recommendation: certification recommended",
    );
    expect(recommended.text).toContain("not a certificate");
    expect(recommended.basisHeading).toBe("");
    expect(statement(t("certification_deferred")).basisHeading).toBe(
      "Basis for deferral",
    );
    expect(termsLabel(t("certification_not_recommended"))).toBe(
      "Certification not recommended",
    );
    expect(conclusionTypes.certification_deferred.modified).toBe(true);
    expect(requiresSupport("certification_recommended")).toBe(false);
    expect(offeredEngagementTypes(false)).not.toContain("certification");
    expect(offeredEngagementTypes(true)).toContain("certification");
  });

  it("labels each conclusion and level", () => {
    expect(termsLabel(assurance("qualified", "limited"))).toBe(
      "Qualified conclusion · limited assurance",
    );
    expect(termsLabel(assurance("unmodified", "reasonable"))).toBe(
      "Unmodified opinion · reasonable assurance",
    );
    expect(
      termsLabel({
        engagementType: "readiness",
        assuranceLevel: null,
        conclusion: "readiness",
      }),
    ).toBe("Readiness assessment (not assurance)");
  });

  it("offers a readiness output with gaps, labelled not assurance (#111)", () => {
    const gaps: ReportTerms = {
      engagementType: "readiness",
      assuranceLevel: null,
      conclusion: "readiness_gaps",
    };
    expect(engagementTypes.readiness.conclusions).toEqual([
      "readiness",
      "readiness_gaps",
    ]);
    expect(termsProblem(gaps)).toBe("");
    expect(termsProblem({ ...gaps, engagementType: "attestation" })).toMatch(
      /requires a limited or reasonable/,
    );
    expect(termsProblem(assurance("readiness_gaps", "limited"))).toMatch(
      /cannot express/,
    );
    expect(termsLabel(gaps)).toBe(
      "Readiness assessment, gaps identified (not assurance)",
    );
    expect(reportTitle(gaps)).toContain("not an assurance report");
    const s = statement(gaps);
    expect(s).toMatchObject({
      notAssurance: true,
      levelStatement: "",
      basisHeading: "Gaps identified",
    });
    expect(s.heading).toContain("not an assurance engagement");
    expect(s.text).toContain("the gaps we identified");
    expect(s.text).toContain("does not state that the subject matter is ready");
    expect(statesBasis("readiness_gaps")).toBe(true);
    expect(statesBasis("readiness")).toBe(false);
    expect(statesBasis("qualified")).toBe(true);
    expect(normalizeTerms(gaps)).toEqual(gaps);
  });
});

describe("practice report settings (#111)", () => {
  const stated = {
    addressee: "The board",
    location: "",
    signatory: "  ",
    basisForModification: "",
  };
  const settings = {
    signatory: "Lea & Partners",
    location: "Vienna, Austria",
    qualityStatement: "We apply ISQM 1.",
  };

  it("fills blank particulars from the settings, then the default statement", () => {
    expect(resolveParticulars(stated, settings)).toEqual({
      ...stated,
      ...settings,
    });
    expect(resolveParticulars(stated)).toEqual({
      ...stated,
      signatory: "",
      qualityStatement,
    });
  });

  it("lets the report override every setting", () => {
    expect(
      resolveParticulars(
        {
          ...stated,
          signatory: "M. Muster",
          location: "Graz",
          qualityStatement: "Own statement.",
        },
        settings,
      ),
    ).toMatchObject({
      signatory: "M. Muster",
      location: "Graz",
      qualityStatement: "Own statement.",
    });
  });

  it("reads stored settings and treats anything malformed as unset", () => {
    expect(parseReportSettings(JSON.stringify(settings))).toEqual(settings);
    expect(parseReportSettings("{}")).toEqual(emptyReportSettings);
    expect(parseReportSettings("not json")).toEqual(emptyReportSettings);
    expect(parseReportSettings(null)).toEqual(emptyReportSettings);
    expect(
      parseReportSettings(JSON.stringify({ signatory: 7, location: " X " })),
    ).toEqual({ ...emptyReportSettings, location: "X" });
  });

  it("reads a snapshot captured before the settings with the default statement", () => {
    expect(
      snapshotParticulars({ particulars: { signatory: "S" } }).qualityStatement,
    ).toBe(qualityStatement);
    expect(
      snapshotParticulars({ particulars: { qualityStatement: "Own." } })
        .qualityStatement,
    ).toBe("Own.");
  });
});

describe("positive conclusions", () => {
  it("holds unmodified and readiness conclusions to the strict gates", () => {
    expect(
      Object.entries(conclusionTypes)
        .filter(([, c]) => c.requiresSupport)
        .map(([id]) => id),
    ).toEqual(["unmodified", "readiness"]);
    for (const c of [
      "qualified",
      "adverse",
      "disclaimer",
      "readiness_gaps",
      "factual_findings",
    ])
      expect(requiresSupport(c)).toBe(false);
    // An unknown value is held to the strict gates.
    expect(requiresSupport("Clean opinion")).toBe(true);
  });
});

describe("legacy reports", () => {
  const legacy = {
    "Readiness assessment": "readiness",
    "Qualified conclusion": "qualified",
    "Adverse conclusion": "adverse",
    "Unable to conclude": "disclaimer",
  };

  it("maps each legacy opinion to its conclusion for the release gates", () => {
    for (const [opinion, conclusion] of Object.entries(legacy)) {
      expect(legacyConclusion(opinion)).toBe(conclusion);
      expect(requiresSupport(opinion)).toBe(opinion === "Readiness assessment");
      expect(snapshotConclusion({ opinion })).toBe(opinion);
    }
  });

  it("renders a legacy snapshot's opinion exactly as it was issued", () => {
    for (const opinion of Object.keys(legacy)) {
      expect(snapshotTerms({ opinion })).toBeNull();
      expect(opinionLabel({ opinion })).toBe(opinion);
    }
    expect(opinionLabel({})).toBe("Opinion not recorded");
  });

  it("reads the terms of a v2 snapshot", () => {
    const terms = assurance("adverse", "limited");
    const snapshot = { opinion: termsLabel(terms), terms };
    expect(snapshotTerms(snapshot)).toEqual(terms);
    expect(snapshotConclusion(snapshot)).toBe("adverse");
    expect(opinionLabel(snapshot)).toBe(
      "Adverse conclusion · limited assurance",
    );
  });
});
