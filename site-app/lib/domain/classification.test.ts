import { describe, expect, it } from "vitest";
import catalog from "../catalog.json";
import { classificationRules } from "../classification-rules";
import { freshEngagement } from "../factories";
import obligations from "../obligation-subitems.json";
import { asRulePack, engagementFacts, obligationsByDate } from "../rule-pack";
import {
  aiOfficeCompetence,
  annexRoutes,
  approvalBlockers,
  approveClassification,
  art50Assessment,
  classificationFacts,
  ClassificationError,
  classificationFactValues,
  classify,
  derogationRoute,
  factAsked,
  factDefinitions,
  factDerivations,
  migrateClassification,
  practiceKey,
  recordClassification,
  reReviewTriggers,
  type Classification,
  type ClassificationInput,
} from "./classification";

const pack = asRulePack(catalog.regulatorySnapshot)!;
const rules = classificationRules(pack);
const at = "2026-11-06T10:00:00.000Z";
const fresh = () =>
  freshEngagement("CLIENT-1", "Classification", "auditor").classification;

/**
 * Answers every required fact the form asks "no" (SME status "neither"),
 * keeping the answers given, so a test changes only what it is about.
 */
function complete(
  partial: Partial<ClassificationInput> & { facts?: Record<string, string> },
): ClassificationInput {
  const input: ClassificationInput = {
    operatorRole: "Provider",
    annexRoute: "Outside high-risk scope",
    intendedPurpose: "Customer service assistant",
    rationale: "Reviewed facts and route",
    ...partial,
    facts: { ...partial.facts },
  };
  for (let changed = true; changed;) {
    changed = false;
    const answers = Object.fromEntries(
      Object.entries(input.facts)
        .filter(([, v]) => v !== "unknown" && v !== "")
        .map(([k, v]) => [
          k,
          { value: v === "yes" ? true : v === "no" ? false : v },
        ]),
    ) as Classification["answers"];
    const facts = classificationFactValues({
      annexRoute: input.annexRoute,
      answers,
      status: "provisional",
    });
    for (const def of factDefinitions(rules))
      if (
        def.required &&
        !(def.id in input.facts) &&
        factAsked(def, input, facts)
      ) {
        input.facts[def.id] = def.kind === "enumeration" ? "neither" : "no";
        changed = true;
      }
  }
  return input;
}
const record = (
  partial: Parameters<typeof complete>[0],
  previous = fresh(),
  user = "auditor",
) => recordClassification(previous, complete(partial), { rules, user, at });
const statusOf = (c: Classification, code: string) =>
  art50Assessment(c, rules).find((r) => r.code === code)!;
const problems = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ClassificationError);
    return (error as ClassificationError).problems;
  }
  throw new Error("expected a ClassificationError");
};

describe("route x flag matrix", () => {
  it.each<[string, Record<string, string>, string, string]>([
    ["Annex III — sensitive use case", {}, "annex_iii", "High risk"],
    [
      "Annex III — sensitive use case",
      { annexIIIProfiling: "yes" },
      "annex_iii",
      "High risk",
    ],
    [
      "Annex I Section A — regulated product",
      {},
      "annex_i_section_a",
      "High risk",
    ],
    [
      "Annex I Section B — sector-specific review",
      {},
      "annex_i_section_b",
      "High risk",
    ],
    [derogationRoute, { art6_3Derogation: "no" }, "annex_iii", "High risk"],
    [
      derogationRoute,
      { art6_3Derogation: "yes" },
      "not_high_risk",
      "Minimal risk",
    ],
    [
      derogationRoute,
      { art6_3Derogation: "unknown" },
      "unknown",
      "Needs information",
    ],
    // Profiling keeps the system high risk while the derogation is open.
    [
      derogationRoute,
      { art6_3Derogation: "unknown", annexIIIProfiling: "yes" },
      "annex_iii",
      "High risk",
    ],
    ["Outside high-risk scope", {}, "not_high_risk", "Minimal risk"],
    [
      "Article 50 only",
      {
        interactsDirectlyWithNaturalPersons: "yes",
        scientificResearchOnly: "no",
      },
      "not_high_risk",
      "Specific transparency",
    ],
    ["Unassessed", {}, "unknown", "Unassessed"],
  ])("%s with %j: %s, %s", (annexRoute, facts, route, label) => {
    const c = record({ annexRoute, facts });
    expect(c.assessment?.highRiskRoute).toBe(route);
    expect(classify(c)).toBe(label);
    expect(c.highRisk).toBe(route.startsWith("annex"));
    expect(engagementFacts({ classification: c }).highRiskRoute).toBe(
      route === "unknown" ? undefined : route,
    );
  });

  it("derives the legacy flags instead of accepting them", () => {
    const c = record({
      annexRoute: "Annex III — sensitive use case",
      facts: {
        annexIIIProfiling: "yes",
        interactsDirectlyWithNaturalPersons: "yes",
        scientificResearchOnly: "no",
      },
    });
    expect(c).toMatchObject({
      prohibited: false,
      highRisk: true,
      transparency: true,
      profiling: true,
      status: "provisional",
      model: 2,
    });
  });

  it.each<[string, Record<string, string>, string]>([
    [
      derogationRoute,
      { art6_3Derogation: "yes", annexIIIProfiling: "yes" },
      "derogation cannot apply",
    ],
    ["Outside high-risk scope", { annexIIIProfiling: "yes" }, "only on"],
    ["Annex III — sensitive use case", { art6_3Derogation: "no" }, "only on"],
    ["Free text route", {}, "Choose a classification route"],
  ])("rejects %s with %j", (annexRoute, facts, message) => {
    expect(problems(() => record({ annexRoute, facts })).join(" ")).toContain(
      message,
    );
  });

  it("rejects an Article 50 only route without an Art 50 trigger", () => {
    expect(
      problems(() => record({ annexRoute: "Article 50 only" })).join(" "),
    ).toContain("Article 50 only route needs");
    expect(
      problems(() =>
        record({
          annexRoute: "Article 50 only",
          operatorRole: "Importer / distributor",
        }),
      ).join(" "),
    ).toContain("importer or distributor");
  });

  it("offers exactly the seven routes", () => {
    expect(annexRoutes).toHaveLength(7);
    expect(annexRoutes[0]).toBe("Unassessed");
  });
});

describe("unknown handling", () => {
  it("shows needs information, never minimal risk, while a required fact is unknown", () => {
    for (const def of factDefinitions(rules).filter(
      (d) => d.required && !d.parent && !d.routes && d.role !== "deployer",
    )) {
      const c = record({ facts: { [def.id]: "unknown" } });
      const blockers = approvalBlockers(c, rules);
      expect(blockers, def.id).toContain(def.label);
      // Facts that decide the risk class keep the label at needs information;
      // GPAI roles and SME status block the approval only.
      if (["art5", "art50Provider"].includes(def.section))
        expect(classify(c), def.id).toBe("Needs information");
      else expect(classify(c), def.id).toBe("Minimal risk");
    }
  });

  it("keeps an unanswered Art 5 practice from reading as high risk", () => {
    const c = record({
      annexRoute: "Annex III — sensitive use case",
      facts: { [practiceKey("Art 5(1)(c)")]: "unknown" },
    });
    expect(classify(c)).toBe("Needs information");
  });

  it("treats every unanswered fact as unknown in the date predicates", () => {
    const c = record({});
    const facts = engagementFacts({ classification: c });
    expect(facts.placedOnMarketDate).toBeUndefined();
    const row = obligationsByDate(pack, {
      classification: c,
      workflow: undefined,
    })
      .flatMap((g) => g.rows)
      .find((r) => r.entry.id === "aia-2026-12-02-art50-2-legacy-transition")!;
    // The system generates no synthetic content: the Art 111(4) rule is out.
    expect(row.selection).toBe("not_selected");
    const generative = record({
      facts: {
        generatesSyntheticImage: "yes",
        authorisedByLawForCriminalOffences: "no",
        onlyAssistiveStandardEditing: "no",
        noSubstantialAlterationOfInput: "no",
        outputsOnlyOutOfScopeContent: "no",
        b2bIndustrialConditionsMet: "no",
        ephemeralRealTimeOnly: "no",
        scientificResearchOnly: "no",
      },
    });
    const selection = (c: Classification) =>
      obligationsByDate(pack, { classification: c, workflow: undefined })
        .flatMap((g) => g.rows)
        .find(
          (r) => r.entry.id === "aia-2026-12-02-art50-2-legacy-transition",
        )!;
    expect(selection(generative)).toMatchObject({
      selection: "needs_information",
      missingFacts: ["placedOnMarketDate"],
    });
    const placed = record({
      facts: {
        ...complete({}).facts,
        generatesSyntheticImage: "yes",
        authorisedByLawForCriminalOffences: "no",
        onlyAssistiveStandardEditing: "no",
        noSubstantialAlterationOfInput: "no",
        outputsOnlyOutOfScopeContent: "no",
        b2bIndustrialConditionsMet: "no",
        ephemeralRealTimeOnly: "no",
        scientificResearchOnly: "no",
        placedOnMarketDate: "2026-05-01",
      },
    });
    expect(selection(placed).selection).toBe("candidate");
  });

  it("captures the seven date facts #18 left unknown, and validates dates", () => {
    const c = record({
      facts: {
        placedOnMarketDate: "2026-05-01",
        putIntoServiceDate: "",
        firstPlacedOnMarketOrPutIntoServiceDate: "2025-11-30",
        significantDesignChangeOnOrAfterChapterIIIDate: "no",
        intendedForUseByPublicAuthorities: "yes",
        annexXLargeScaleItComponent: "no",
        gpaiModelProvider: "yes",
        gpaiSystemicRiskModel: "no",
        gpaiModelPlacedOnMarketDate: "2025-06-01",
      },
    });
    expect(engagementFacts({ classification: c })).toMatchObject({
      placedOnMarketDate: "2026-05-01",
      firstPlacedOnMarketOrPutIntoServiceDate: "2025-11-30",
      significantDesignChangeOnOrAfterChapterIIIDate: false,
      intendedForUseByPublicAuthorities: true,
      annexXLargeScaleItComponent: false,
      gpaiModelPlacedOnMarketDate: "2025-06-01",
      generatesSyntheticContent: false,
      highRiskRoute: "not_high_risk",
    });
    expect(c.answers?.putIntoServiceDate).toBeUndefined();
    expect(
      problems(() =>
        record({ facts: { placedOnMarketDate: "2026-13-45" } }),
      ).join(" "),
    ).toContain("YYYY-MM-DD");
    expect(
      problems(() =>
        record({ facts: { interactsDirectlyWithNaturalPersons: "maybe" } }),
      ).join(" "),
    ).toContain("answer yes, no or needs information");
    expect(
      problems(() => record({ facts: { madeUpFact: "yes" } })).join(" "),
    ).toContain("Unknown fact madeUpFact");
  });
});

describe("approval blocking", () => {
  it("refuses an unassessed route and approves a complete classification", () => {
    const unassessed = record({ annexRoute: "Unassessed" });
    expect(() =>
      approveClassification(unassessed, { rules, user: "reviewer", at }),
    ).toThrow(/Assess the classification route/);
    const done = approveClassification(record({}), {
      rules,
      user: "reviewer",
      at,
    });
    expect(done).toMatchObject({ status: "approved", approvedBy: "reviewer" });
    expect(done.history?.map((h) => h.action)).toEqual([
      "classified",
      "approved",
    ]);
    expect(engagementFacts({ classification: done }).highRiskConfirmed).toBe(
      false,
    );
  });

  it("refuses while an exception relied on has no evidence", () => {
    const c = record({
      facts: {
        interactsDirectlyWithNaturalPersons: "yes",
        obviousToReasonablyWellInformedPerson: "yes",
        scientificResearchOnly: "no",
      },
    });
    expect(approvalBlockers(c, rules).join(" ")).toContain(
      "Link the evidence for",
    );
    const linked = record({
      facts: complete({
        facts: {
          interactsDirectlyWithNaturalPersons: "yes",
          obviousToReasonablyWellInformedPerson: "yes",
          scientificResearchOnly: "no",
        },
      }).facts,
      evidence: {
        obviousToReasonablyWellInformedPerson: "EV-12 audience study",
      },
    });
    expect(approvalBlockers(linked, rules)).toEqual([]);
    expect(linked.answers?.obviousToReasonablyWellInformedPerson.evidence).toBe(
      "EV-12 audience study",
    );
  });

  it("refuses an Art 6(3) derogation without rationale and registration evidence", () => {
    const facts = { art6_3Derogation: "yes" };
    const bare = record({ annexRoute: derogationRoute, facts });
    expect(approvalBlockers(bare, rules).join(" ")).toContain(
      "derogation rationale and registration evidence",
    );
    const documented = record({
      annexRoute: derogationRoute,
      facts,
      derogation: {
        rationale: "Narrow procedural task (Art 6(3)(a))",
        registrationEvidence: "EU database registration REG-7",
      },
    });
    expect(approvalBlockers(documented, rules)).toEqual([]);
    expect(documented.derogation?.registrationEvidence).toBe(
      "EU database registration REG-7",
    );
  });

  it("refuses a Code signatory status without the date it was checked", () => {
    const facts = {
      generatesSyntheticText: "yes",
      authorisedByLawForCriminalOffences: "no",
      onlyAssistiveStandardEditing: "no",
      noSubstantialAlterationOfInput: "no",
      outputsOnlyOutOfScopeContent: "no",
      b2bIndustrialConditionsMet: "no",
      ephemeralRealTimeOnly: "no",
      scientificResearchOnly: "no",
      codeSignatorySection1: "yes",
    };
    expect(approvalBlockers(record({ facts }), rules).join(" ")).toContain(
      "signatory list was checked",
    );
    expect(
      approvalBlockers(
        record({ facts, checkedOn: { codeSignatorySection1: "2026-11-05" } }),
        rules,
      ),
    ).toEqual([]);
  });

  it("refuses a migrated legacy approval until the facts are answered", () => {
    const legacy = migrateClassification({
      ...fresh(),
      model: undefined,
      answers: undefined,
      annexRoute: "Unassessed",
      intendedPurpose: "Scoring",
      rationale: "Old",
      status: "approved",
      approvedBy: "reviewer",
    });
    expect(legacy.status).toBe("provisional");
    expect(approvalBlockers(legacy, rules).length).toBeGreaterThan(10);
  });
});

describe("Art 5 screen", () => {
  it("asks every practice of the rule pack with the date it applies", () => {
    const art5 = factDefinitions(rules).filter((d) => d.section === "art5");
    expect(art5.map((d) => d.id)).toEqual(
      pack.prohibitedPractices.map((p) => practiceKey(p.point)),
    );
    expect(art5.find((d) => d.id === "art5_1_ba")).toMatchObject({
      appliesFrom: "2026-12-02",
      required: true,
      legalReview: ["LR-05"],
    });
    expect(art5.find((d) => d.id === "art5_1_a")?.appliesFrom).toBe(
      "2025-02-02",
    );
  });

  it.each(pack.prohibitedPractices.map((p) => [p.point]))(
    "%s answered yes is prohibited",
    (point) => {
      const c = record({
        annexRoute: "Annex III — sensitive use case",
        facts: { [practiceKey(point)]: "yes" },
      });
      expect(classify(c)).toBe("Prohibited");
      expect(c.prohibited).toBe(true);
    },
  );

  it("decides prohibited even while other facts are unknown", () => {
    const c = record({
      annexRoute: "Unassessed",
      facts: { art5_1_bb: "yes", art5_1_a: "unknown" },
    });
    expect(classify(c)).toBe("Prohibited");
  });
});

describe("GPAI roles and the AI Office", () => {
  it("asks the systemic-risk and model-date facts only of a model provider", () => {
    expect(
      problems(() =>
        record({
          facts: { gpaiModelProvider: "no", gpaiSystemicRiskModel: "yes" },
        }),
      ).join(" "),
    ).toContain("applies only where GPAI model provider is answered yes");
    const provider = record({
      facts: { gpaiModelProvider: "yes", gpaiSystemicRiskModel: "unknown" },
    });
    expect(approvalBlockers(provider, rules)).toContain(
      "The model is a GPAI model with systemic risk (Art 51)",
    );
    const systemic = record({
      facts: { gpaiModelProvider: "yes", gpaiSystemicRiskModel: "yes" },
    });
    expect(approvalBlockers(systemic, rules)).toEqual([]);
  });

  it("asks the downstream-provider role of providers only", () => {
    expect(
      approvalBlockers(
        record({ facts: { gpaiDownstreamProvider: "unknown" } }),
        rules,
      ),
    ).toContain(
      "Integrates a general-purpose AI model of another provider (downstream provider)",
    );
    expect(
      problems(() =>
        record({
          operatorRole: "Deployer",
          facts: { gpaiDownstreamProvider: "yes" },
        }),
      ).join(" "),
    ).toContain("applies only to a provider");
  });

  it.each<[string, Record<string, string>, unknown, unknown]>([
    ["Provider", {}, "unknown", "not_applicable"],
    [
      "Provider",
      { builtOnOwnGpaiModel: "yes", art75ExceptedSystem: "no" },
      true,
      "not_applicable",
    ],
    [
      "Provider",
      {
        builtOnOwnGpaiModel: "yes",
        art75ExceptedSystem: "yes",
        integratedIntoVlopOrVlose: "no",
      },
      false,
      "not_applicable",
    ],
    ["Provider", { integratedIntoVlopOrVlose: "yes" }, true, "not_applicable"],
    [
      "Provider and deployer",
      {
        integratedIntoVlopOrVlose: "yes",
        deployerIsProviderOrSameUndertaking: "yes",
      },
      true,
      true,
    ],
    [
      "Deployer",
      {
        integratedIntoVlopOrVlose: "yes",
        deployerIsProviderOrSameUndertaking: "no",
      },
      "not_applicable",
      false,
    ],
    [
      "Deployer",
      { integratedIntoVlopOrVlose: "yes" },
      "not_applicable",
      "unknown",
    ],
  ])("%s with %j: provider %s, deployer %s", (operatorRole, facts, p, d) => {
    expect(aiOfficeCompetence(record({ operatorRole, facts }))).toEqual({
      provider: p,
      deployer: d,
    });
  });

  it("records SME or small mid-cap status as an enumeration", () => {
    const c = record({ facts: { smeStatus: "small_mid_cap" } });
    expect(c.answers?.smeStatus.value).toBe("small_mid_cap");
    expect(
      problems(() => record({ facts: { smeStatus: "large" } })).join(" "),
    ).toContain("choose a listed value");
  });
});

describe("Art 50 triggers", () => {
  const providerExclusionsNo = {
    scientificResearchOnly: "no",
    authorisedByLawForCriminalOffences: "no",
  };
  const art50_2No = {
    onlyAssistiveStandardEditing: "no",
    noSubstantialAlterationOfInput: "no",
    outputsOnlyOutOfScopeContent: "no",
    b2bIndustrialConditionsMet: "no",
    ephemeralRealTimeOnly: "no",
  };
  it.each<[string, string, Record<string, string>, string]>([
    [
      "Provider",
      "AIA-50-1",
      { interactsDirectlyWithNaturalPersons: "yes", ...providerExclusionsNo },
      "candidate",
    ],
    ...(
      [
        "generatesSyntheticText",
        "generatesSyntheticImage",
        "generatesSyntheticAudio",
        "generatesSyntheticVideo",
      ] as const
    ).map((f): [string, string, Record<string, string>, string] => [
      "Provider",
      "AIA-50-2",
      { [f]: "yes", ...providerExclusionsNo, ...art50_2No },
      "candidate",
    ]),
    [
      "Deployer",
      "AIA-50-3",
      {
        deployerUsesEmotionRecognition: "yes",
        personalNonProfessionalUseOnly: "no",
      },
      "candidate",
    ],
    [
      "Deployer",
      "AIA-50-3",
      {
        deployerUsesBiometricCategorisation: "yes",
        personalNonProfessionalUseOnly: "no",
      },
      "candidate",
    ],
    [
      "Deployer",
      "AIA-50-4-DF",
      {
        deployerGeneratesDeepFakes: "yes",
        personalNonProfessionalUseOnly: "no",
      },
      "candidate",
    ],
    [
      "Deployer",
      "AIA-50-4-TXT",
      {
        deployerPublishesAiTextOnPublicInterest: "yes",
        personalNonProfessionalUseOnly: "no",
      },
      "candidate",
    ],
    [
      "Deployer",
      "AIA-50-5",
      {
        deployerGeneratesDeepFakes: "yes",
        personalNonProfessionalUseOnly: "no",
      },
      "candidate",
    ],
  ])("%s %s with %j: %s", (operatorRole, code, facts, status) => {
    const c = record({ operatorRole, facts });
    expect(statusOf(c, code).status).toBe(status);
    expect(c.transparency).toBe(true);
    expect(classify(c)).toBe("Specific transparency");
  });

  it("follows each tri-state path of a trigger", () => {
    const path = (value: string) =>
      statusOf(
        record({
          facts: {
            interactsDirectlyWithNaturalPersons: value,
            scientificResearchOnly: "no",
          },
        }),
        "AIA-50-1",
      );
    expect(path("yes").status).toBe("candidate");
    expect(path("no").status).toBe("not_triggered");
    expect(path("unknown")).toMatchObject({
      status: "needs_information",
      missingFacts: ["interactsDirectlyWithNaturalPersons"],
    });
  });

  it("asks provider facts of providers and deployer facts of deployers", () => {
    const deployer = record({ operatorRole: "Deployer" });
    expect(statusOf(deployer, "AIA-50-1").status).toBe("role_not_held");
    expect(statusOf(deployer, "AIA-50-3").status).toBe("not_triggered");
    expect(
      problems(() =>
        record({
          operatorRole: "Deployer",
          facts: { interactsDirectlyWithNaturalPersons: "yes" },
        }),
      ).join(" "),
    ).toContain("applies only to a provider");
    const importer = record({ operatorRole: "Importer / distributor" });
    expect(
      art50Assessment(importer, rules).every(
        (r) => r.status === "role_not_held",
      ),
    ).toBe(true);
  });

  it("excludes an item when an exclusion's facts are true, and needs information while one is unknown", () => {
    const research = record({
      facts: {
        interactsDirectlyWithNaturalPersons: "yes",
        scientificResearchOnly: "yes",
      },
      evidence: { scientificResearchOnly: "EV-3 research charter" },
    });
    expect(statusOf(research, "AIA-50-1")).toMatchObject({
      status: "excluded",
      exclusion: { id: "EX-SCOPE-RD" },
    });
    const open = record({
      facts: {
        interactsDirectlyWithNaturalPersons: "yes",
        scientificResearchOnly: "unknown",
      },
    });
    expect(statusOf(open, "AIA-50-1")).toMatchObject({
      status: "needs_information",
      missingFacts: ["scientificResearchOnly"],
    });
    // Art 50(5) follows its only paragraph 1-4 item, so neither is certain.
    expect(statusOf(open, "AIA-50-5")).toMatchObject({
      status: "needs_information",
      missingFacts: ["scientificResearchOnly"],
    });
    expect(classify(open)).toBe("Needs information");
    expect(approvalBlockers(open, rules).join(" ")).toContain("Art 50(1)");
    const guidance = record({
      facts: {
        generatesSyntheticText: "yes",
        ...providerExclusionsNo,
        ...art50_2No,
        outputsOnlyOutOfScopeContent: "yes",
      },
      evidence: { outputsOnlyOutOfScopeContent: "EV-9 output inventory" },
    });
    expect(statusOf(guidance, "AIA-50-2")).toMatchObject({
      status: "excluded",
      exclusion: {
        id: "EX-50-2-OUTOFSCOPE",
        basis: "guidance",
        legalReview: { itemIds: ["LR-A50-03"] },
      },
    });
    const personal = record({
      operatorRole: "Deployer",
      facts: {
        deployerUsesEmotionRecognition: "yes",
        personalNonProfessionalUseOnly: "yes",
      },
      evidence: { personalNonProfessionalUseOnly: "EV-1" },
    });
    expect(statusOf(personal, "AIA-50-3").status).toBe("excluded");
  });

  it("takes Art 50(5) out with the paragraph 1-4 items a scope exclusion removes", () => {
    const research = record({
      facts: {
        interactsDirectlyWithNaturalPersons: "yes",
        scientificResearchOnly: "yes",
      },
      evidence: { scientificResearchOnly: "EV-3 research charter" },
    });
    expect(statusOf(research, "AIA-50-5")).toMatchObject({
      status: "excluded",
      exclusion: { id: "EX-SCOPE-RD" },
    });
    expect(research.transparency).toBe(false);
    expect(classify(research)).toBe("Minimal risk");
    const personal = record({
      operatorRole: "Deployer",
      facts: {
        deployerGeneratesDeepFakes: "yes",
        personalNonProfessionalUseOnly: "yes",
      },
      evidence: { personalNonProfessionalUseOnly: "EV-1 use statement" },
    });
    expect(statusOf(personal, "AIA-50-4-DF").status).toBe("excluded");
    expect(statusOf(personal, "AIA-50-5")).toMatchObject({
      status: "excluded",
      exclusion: { id: "EX-SCOPE-PERSONAL" },
    });
    expect(classify(personal)).toBe("Minimal risk");
    // One remaining candidate of a held role keeps Art 50(5) a candidate.
    const both = record({
      operatorRole: "Provider and deployer",
      facts: {
        interactsDirectlyWithNaturalPersons: "yes",
        scientificResearchOnly: "no",
        authorisedByLawForCriminalOffences: "no",
        deployerGeneratesDeepFakes: "yes",
        generatesSyntheticImage: "yes",
        ...art50_2No,
        personalNonProfessionalUseOnly: "yes",
      },
      evidence: { personalNonProfessionalUseOnly: "EV-1 use statement" },
    });
    expect(statusOf(both, "AIA-50-4-DF").status).toBe("excluded");
    expect(statusOf(both, "AIA-50-5").status).toBe("candidate");
    expect(classify(both)).toBe("Specific transparency");
  });

  it("tests a claimed Art 50(1), (3) or (4) exception per item instead of excluding (option a)", () => {
    const obvious = record({
      facts: {
        interactsDirectlyWithNaturalPersons: "yes",
        obviousToReasonablyWellInformedPerson: "yes",
        scientificResearchOnly: "no",
      },
    });
    expect(statusOf(obvious, "AIA-50-1")).toMatchObject({
      status: "candidate",
      claimedExceptions: [{ id: "EX-50-1-OBVIOUS" }],
    });
    const lawEnforcement = record({
      operatorRole: "Deployer",
      facts: {
        deployerUsesBiometricCategorisation: "yes",
        lawEnforcementPermittedErBc: "yes",
        personalNonProfessionalUseOnly: "no",
      },
    });
    expect(statusOf(lawEnforcement, "AIA-50-3")).toMatchObject({
      status: "candidate",
      claimedExceptions: [{ id: "EX-50-3-LE" }],
    });
    const editorial = record({
      operatorRole: "Deployer",
      facts: {
        deployerPublishesAiTextOnPublicInterest: "yes",
        editorialExceptionReliedOn: "yes",
        authorisedByLawForCriminalOffences: "yes",
        personalNonProfessionalUseOnly: "no",
      },
    });
    expect(
      statusOf(editorial, "AIA-50-4-TXT").claimedExceptions.map((x) => x.id),
    ).toEqual(["EX-50-4T-LE", "EX-50-4T-EDITORIAL"]);
    expect(statusOf(editorial, "AIA-50-4-TXT").status).toBe("candidate");
    // Art 50(2) keeps its statutory law-enforcement exclusion.
    const marking = record({
      facts: {
        generatesSyntheticImage: "yes",
        ...art50_2No,
        scientificResearchOnly: "no",
        authorisedByLawForCriminalOffences: "yes",
      },
      evidence: { authorisedByLawForCriminalOffences: "EV-4 statute" },
    });
    expect(statusOf(marking, "AIA-50-2").status).toBe("excluded");
  });

  it("rejects deep fakes or public-interest text a provider-deployer's own system cannot produce", () => {
    const base = {
      operatorRole: "Provider and deployer",
      facts: {
        generatesSyntheticText: "no",
        generatesSyntheticImage: "no",
        generatesSyntheticAudio: "no",
        generatesSyntheticVideo: "no",
      },
    };
    expect(
      problems(() =>
        record({
          ...base,
          facts: { ...base.facts, deployerGeneratesDeepFakes: "yes" },
        }),
      ).join(" "),
    ).toContain("Deep fakes need image, audio or video output");
    expect(
      problems(() =>
        record({
          ...base,
          facts: {
            ...base.facts,
            deployerPublishesAiTextOnPublicInterest: "yes",
          },
        }),
      ).join(" "),
    ).toContain("needs text output");
  });

  it("evaluates the catalogue's six Art 50 items", () => {
    expect(rules.art50Items.map((i) => i.code)).toEqual([
      "AIA-50-1",
      "AIA-50-2",
      "AIA-50-3",
      "AIA-50-4-DF",
      "AIA-50-4-TXT",
      "AIA-50-5",
    ]);
  });
});

describe("answers, history and migration", () => {
  it("stamps each answer with its legal version and keeps the stamp while it is unchanged", () => {
    const first = record({ facts: { smeStatus: "sme" } });
    expect(first.answers?.smeStatus).toEqual({
      value: "sme",
      legalVersion: pack.celex,
      rulePackVersion: pack.rulePackVersion,
      answeredAt: at,
      answeredBy: "auditor",
    });
    const second = recordClassification(
      first,
      complete({ facts: { smeStatus: "sme", gpaiModelProvider: "no" } }),
      { rules, user: "lead", at: "2026-11-07T09:00:00.000Z" },
    );
    expect(second.answers?.smeStatus.answeredBy).toBe("auditor");
    const third = recordClassification(
      second,
      complete({ facts: { smeStatus: "neither" } }),
      { rules, user: "lead", at: "2026-11-08T09:00:00.000Z" },
    );
    expect(third.answers?.smeStatus).toMatchObject({
      value: "neither",
      answeredBy: "lead",
      answeredAt: "2026-11-08T09:00:00.000Z",
    });
    expect(third.history?.map((h) => h.action)).toEqual([
      "classified",
      "classified",
      "classified",
    ]);
    expect(third).toMatchObject({
      version: pack.celex,
      asOf: pack.researchedAsOf,
      rulePackVersion: pack.rulePackVersion,
    });
  });

  it("cites the draft Art 6 guidelines and the Art 50 guidance versions from the rule pack's register", () => {
    const c = record({});
    expect(c.guidance?.map((g) => [g.id, g.status])).toEqual([
      ["GUID-ART6-HIGH-RISK-CLASSIFICATION", "draft"],
      ["GUID-PROHIBITED-PRACTICES", "published (covers prohibitions 1 to 8)"],
      ["GUID-ART50-TRANSPARENCY", "adopted"],
      ["GUID-ART50-COP", "published"],
    ]);
    expect(c.guidance?.[2]).toMatchObject({
      reference: "C(2026) 7702 final",
      date: "2026-11-05",
    });
    expect(c.guidance?.[3]).toMatchObject({
      reference: "Final code, 10 June 2026",
      date: "2026-06-10",
    });
    // The citation follows the register: a later revision changes it.
    const revised = structuredClone(pack);
    revised.guidanceDocuments.find(
      (g) => g.id === "GUID-ART50-TRANSPARENCY",
    )!.status = "reviewed";
    expect(
      classificationRules(revised).guidance.find(
        (g) => g.id === "GUID-ART50-TRANSPARENCY",
      )?.status,
    ).toBe("reviewed");
  });

  it("migrates a four-flag classification: facts unknown, approval kept readable", () => {
    const old = {
      prohibited: false,
      highRisk: true,
      transparency: true,
      profiling: false,
      annexRoute: "Annex III — sensitive use case",
      operatorRole: "Provider",
      intendedPurpose: "Credit scoring",
      rationale: "Old record",
      status: "approved",
      approvedBy: "reviewer-1",
      version: "02024R1689-20260727",
      asOf: "2026-10-05",
    } satisfies Classification;
    const c = migrateClassification(old);
    expect(c).toMatchObject({
      model: 2,
      answers: {},
      status: "provisional",
      approvedBy: undefined,
      highRisk: false,
      transparency: false,
      legacy: {
        status: "approved",
        approvedBy: "reviewer-1",
        highRisk: true,
        transparency: true,
      },
      history: [{ action: "approved_v1", by: "reviewer-1" }],
    });
    expect(classify(c)).toBe("Needs information");
    // The route still decides highRiskRoute; everything else is unknown.
    expect(engagementFacts({ classification: c })).toEqual({
      highRiskRoute: "annex_iii",
    });
    expect(migrateClassification(c)).toBe(c);
  });

  it("raises re-review triggers for final Art 6 guidelines, the Code, interoperability and a new rule pack", () => {
    const c = record({ facts: { generatesSyntheticText: "unknown" } });
    const ids = (today: string, r = rules) =>
      Object.fromEntries(
        reReviewTriggers(c, r, today).map((t) => [t.id, t.state]),
      );
    expect(ids("2026-11-06")).toEqual({
      "art6-guidelines-final": "watch",
      "art50-guidelines-review": "watch",
      "code-update": "scheduled",
      "interoperability-2027": "scheduled",
    });
    expect(ids("2027-02-02")["interoperability-2027"]).toBe("due");
    const adopted = {
      ...rules,
      rulePackVersion: "2027.01.1",
      guidance: rules.guidance.map((g) =>
        g.id === "GUID-ART6-HIGH-RISK-CLASSIFICATION"
          ? { ...g, status: "adopted" }
          : g,
      ),
    };
    expect(ids("2026-11-06", adopted)).toMatchObject({
      "art6-guidelines-final": "due",
      "rule-pack": "due",
    });
  });
});

describe("canonical data", () => {
  it("derives facts as docs/obligation-subitems.json factDerivations says", () => {
    const { rule, ...derivations } = obligations.factDerivations;
    expect(rule).toContain("any listed fact is true");
    expect(
      Object.fromEntries(
        Object.entries(derivations).map(([k, v]) => [k, v.anyOf]),
      ),
    ).toEqual(factDerivations);
  });

  it("declares every fact the Art 50 items and the date predicates read", () => {
    const types = obligations.factTypes as Record<string, string>;
    const read = rules.art50Items.flatMap((i) => [
      ...i.trigger.conditions,
      ...(i.exclusions ?? []).flatMap((x) => x.ifAll),
      ...(i.exceptionsTestedPerItem ?? []).flatMap((x) => x.ifAll),
    ]);
    for (const c of read)
      expect(types[c.fact], c.fact).toBe("boolean_or_unknown");
    for (const def of classificationFacts.filter(
      (d) => d.section.startsWith("art50") || d.section === "dates",
    ))
      expect(types[def.id], def.id).toBe(
        def.kind === "date" ? "date_or_unknown" : "boolean_or_unknown",
      );
    for (const fact of [
      "generatesSyntheticContent",
      "placedOnMarketDate",
      "highRiskRoute",
      "firstPlacedOnMarketOrPutIntoServiceDate",
      "significantDesignChangeOnOrAfterChapterIIIDate",
      "intendedForUseByPublicAuthorities",
      "annexXLargeScaleItComponent",
      "gpaiModelPlacedOnMarketDate",
    ])
      expect(
        classificationFacts.some((d) => d.id === fact) ||
          fact in factDerivations ||
          fact === "highRiskRoute",
        fact,
      ).toBe(true);
  });

  it("lets Art 50(5) follow the paragraph 1-4 items, as exclusionType says", () => {
    expect(obligations.exclusionType.followsItems).toContain("Article 2(6)");
    expect(
      rules.art50Items.find((i) => i.code === "AIA-50-5")?.followsItems,
    ).toEqual(
      rules.art50Items.map((i) => i.code).filter((code) => code !== "AIA-50-5"),
    );
  });

  it("keeps the Art 50 profiles free of a high-risk confirmation", () => {
    for (const name of ["provider_art50", "deployer_art50", "operator_art50"])
      expect(JSON.stringify(rules.profiles[name]), name).not.toContain(
        "highRiskConfirmed",
      );
  });
});
