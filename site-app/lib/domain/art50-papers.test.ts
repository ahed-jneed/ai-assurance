import { describe, expect, it } from "vitest";
import catalog from "../catalog.json";
import type { CriteriaTemplate } from "../catalog-criteria";
import { classificationRules } from "../classification-rules";
import { resolveNew } from "../criteria/pin";
import { freshEngagement } from "../factories";
import { asRulePack } from "../rule-pack";
import {
  art50Dating,
  art50PaperSuggestion,
  isArt50Paper,
  type PaperSuggestion,
} from "./art50-papers";
import {
  classificationFactValues,
  factAsked,
  factDefinitions,
  recordClassification,
  type Classification,
  type ClassificationInput,
} from "./classification";

// Applicability suggestions for the Art 50 papers from the classification's
// Art 50 items, through the research procedures (#120).
const rules = classificationRules(asRulePack(catalog.regulatorySnapshot)!);
const items = catalog.items as ((typeof catalog.items)[number] &
  CriteriaTemplate)[];
const item = (id: string) => items.find((i) => i.id === id)!;
const papers = ["WP-XC-07", "WP-XC-10", "WP-XC-11", "WP-XC-12"];
const fresh = () =>
  freshEngagement(resolveNew(), "CLIENT-1", "Art 50", "auditor").classification;

/** Every other required fact the form asks is answered "no". */
function classified(
  operatorRole: string,
  facts: Record<string, string>,
): Classification {
  const input: ClassificationInput = {
    operatorRole,
    annexRoute: "Outside high-risk scope",
    intendedPurpose: "Customer assistant",
    rationale: "Reviewed facts",
    facts: { ...facts },
  };
  for (let changed = true; changed;) {
    changed = false;
    const answers = Object.fromEntries(
      Object.entries(input.facts)
        .filter(([, v]) => v !== "unknown")
        .map(([k, v]) => [k, { value: v === "yes" }]),
    ) as Classification["answers"];
    const values = classificationFactValues({
      annexRoute: input.annexRoute,
      answers,
      status: "provisional",
    });
    for (const def of factDefinitions(rules))
      if (
        def.required &&
        !(def.id in input.facts) &&
        factAsked(def, input, values)
      ) {
        input.facts[def.id] = def.kind === "enumeration" ? "neither" : "no";
        changed = true;
      }
  }
  return recordClassification(fresh(), input, {
    rules,
    user: "auditor",
    at: "2026-11-06T10:00:00.000Z",
  });
}
const suggest = (c: Classification) =>
  Object.fromEntries(
    papers.map((id) => [id, art50PaperSuggestion(c, rules, item(id))!]),
  ) as Record<string, PaperSuggestion>;
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
const statuses = (s: PaperSuggestion) =>
  Object.fromEntries(s.procedures.map((p) => [p.procedureId, p.status]));

describe("Art 50 paper suggestions", () => {
  it("recognise the four Art 50 papers and no other catalogue item", () => {
    expect(
      items.filter((i) => isArt50Paper(i, rules)).map((i) => i.id),
    ).toEqual(papers);
    expect(art50PaperSuggestion(fresh(), rules, item("WP-A10-01"))).toBeNull();
  });

  it("suggest the disclosure paper for a provider's chatbot and nothing for marking or deployers", () => {
    const c = classified("Provider", {
      interactsDirectlyWithNaturalPersons: "yes",
      obviousToReasonablyWellInformedPerson: "yes",
      ...providerExclusionsNo,
    });
    const s = suggest(c);
    expect(s["WP-XC-07"].applicability).toBe("applicable");
    expect(statuses(s["WP-XC-07"])).toEqual({
      "A50-P-00": "candidate",
      "A50-P-01": "candidate",
      "A50-P-03": "not_applicable",
      "A50-P-05": "candidate",
    });
    // The obviousness exception never excludes: it is tested per item.
    expect(
      s["WP-XC-07"].procedures.find((p) => p.procedureId === "A50-P-01")
        ?.claimedExceptions,
    ).toEqual(["EX-50-1-OBVIOUS"]);
    expect(s["WP-XC-07"].rationale).toContain(
      "A50-P-01 AI-interaction disclosure (Art 50(1) with Art 50(5)): AIA-50-1 candidate; claimed exceptions to test per item: EX-50-1-OBVIOUS.",
    );
    expect(s["WP-XC-07"].rationale).toContain(
      "Steps of procedures that do not apply are recorded as not performed",
    );
    for (const id of ["WP-XC-10", "WP-XC-12"]) {
      expect(s[id].applicability, id).toBe("not_applicable");
      expect(
        s[id].procedures.every((p) => p.items[0].status === "not_triggered"),
      ).toBe(true);
    }
    expect(s["WP-XC-11"].applicability).toBe("not_applicable");
    expect(
      s["WP-XC-11"].procedures.flatMap((p) => p.items.map((i) => i.status)),
    ).toContain("role_not_held");
    expect(s["WP-XC-07"].basis).toMatchObject({
      status: "provisional",
      rulePackVersion: rules.rulePackVersion,
    });
  });

  it("suggest the marking papers for a generator of synthetic content", () => {
    const s = suggest(
      classified("Provider", {
        interactsDirectlyWithNaturalPersons: "no",
        generatesSyntheticImage: "yes",
        ...providerExclusionsNo,
        ...art50_2No,
      }),
    );
    expect(s["WP-XC-10"].applicability).toBe("applicable");
    expect(s["WP-XC-12"].applicability).toBe("applicable");
    expect(s["WP-XC-07"].applicability).toBe("applicable");
    expect(statuses(s["WP-XC-07"])["A50-P-01"]).toBe("not_applicable");
    expect(s["WP-XC-11"].applicability).toBe("not_applicable");
  });

  it("suggest the deep-fake paper for a deployer that publishes deep fakes", () => {
    const s = suggest(
      classified("Deployer", {
        deployerGeneratesDeepFakes: "yes",
        personalNonProfessionalUseOnly: "no",
      }),
    );
    expect(s["WP-XC-11"].applicability).toBe("applicable");
    expect(statuses(s["WP-XC-11"])).toEqual({
      "A50-P-04A": "candidate",
      "A50-P-04B": "not_applicable",
    });
    expect(s["WP-XC-10"].applicability).toBe("not_applicable");
  });

  it("keep a paper pending, naming the facts, while an item needs information", () => {
    const s = suggest(
      classified("Provider", {
        interactsDirectlyWithNaturalPersons: "unknown",
      }),
    );
    expect(s["WP-XC-07"].applicability).toBe("pending");
    expect(s["WP-XC-07"].missingFacts.join(" ")).toMatch(/interact/i);
    expect(s["WP-XC-07"].rationale).toContain("Waits for: ");
  });

  it("suggest nothing for a classification recorded before the tri-state model", () => {
    const legacy: Classification = { ...fresh(), model: undefined };
    expect(art50PaperSuggestion(legacy, rules, item("WP-XC-07"))).toBeNull();
  });
});

// #152: an applicable paper is dated against the engagement period with the
// rule pack's Art 50 dates (2 August 2026; Art 50(2) on 2 December 2026 for
// generators placed on the market before 2 August 2026, Art 111(4)).
describe("Art 50 paper suggestions by engagement period", () => {
  const dating = art50Dating(asRulePack(catalog.regulatorySnapshot));
  const generator = (placedOnMarketDate: string) =>
    classified("Provider", {
      interactsDirectlyWithNaturalPersons: "no",
      generatesSyntheticImage: "yes",
      placedOnMarketDate,
      ...providerExclusionsNo,
      ...art50_2No,
    });
  const chatbot = classified("Provider", {
    interactsDirectlyWithNaturalPersons: "yes",
    obviousToReasonablyWellInformedPerson: "no",
    ...providerExclusionsNo,
  });
  const dated = (
    c: Classification,
    id: string,
    period: { start: string; end: string } | null,
  ) => art50PaperSuggestion(c, rules, item(id), { period, dating })!;

  it("read the Art 50 dates and the Art 111(4) transition from the pack", () => {
    expect(dating?.appliesFrom).toMatchObject({
      entryId: "aia-2026-08-02-art50-transparency",
      date: "2026-08-02",
    });
    expect(dating?.transitions).toEqual([
      expect.objectContaining({
        entryId: "aia-2026-12-02-art50-2-legacy-transition",
        reference: "Art 111(4)",
        date: "2026-12-02",
      }),
    ]);
    expect(art50Dating(null)).toBeNull();
  });

  it("suggest readiness when the period ends before Art 50 applies", () => {
    const s = dated(chatbot, "WP-XC-07", {
      start: "2026-01-01",
      end: "2026-06-30",
    });
    expect(s.applicability).toBe("readiness");
    // Art 50(1) and the Art 50(5) manner of informing that follows it.
    expect(s.timing?.items).toEqual(
      ["AIA-50-1", "AIA-50-5"].map((code) => ({
        code,
        date: "2026-08-02",
        transition: null,
        alternativeDate: null,
        period: "readiness",
        missingFacts: [],
      })),
    );
    // D-02: the dates carry their open legal-review items.
    expect(s.timing?.pendingReview).toEqual(
      expect.arrayContaining(["LR-03", "LR-04"]),
    );
    expect(s.rationale).toContain(
      "Suggested from the provisional classification (rule pack " +
        rules.rulePackVersion +
        "): readiness: the obligations start applying after the engagement period.",
    );
    expect(s.rationale).toContain(
      "Timing for the period 2026-01-01 to 2026-06-30: AIA-50-1 applies from 2026-08-02, after the period ends; AIA-50-5 applies from 2026-08-02, after the period ends.",
    );
    expect(s.rationale).toMatch(/The dates are pending legal review \(LR-/);
  });

  it("keep a paper applicable when the period reaches the date", () => {
    for (const [start, end] of [
      ["2026-09-01", "2026-11-30"],
      ["2026-07-01", "2026-09-30"],
    ]) {
      const s = dated(chatbot, "WP-XC-07", { start, end });
      expect(s.applicability).toBe("applicable");
      expect(s.timing?.items[0].period).toBe(
        start === "2026-09-01" ? "applicable" : "starts_in_period",
      );
    }
  });

  it("date Art 50(2) by the Art 111(4) transition for a generator already on the market", () => {
    const period = { start: "2026-09-01", end: "2026-11-30" };
    const before = dated(generator("2026-03-01"), "WP-XC-10", period);
    expect(before.applicability).toBe("readiness");
    expect(before.timing?.items).toEqual([
      {
        code: "AIA-50-2",
        date: "2026-12-02",
        transition: "Art 111(4)",
        alternativeDate: null,
        period: "readiness",
        missingFacts: [],
      },
    ]);
    expect(before.rationale).toContain(
      "AIA-50-2 applies from 2026-12-02 (Art 111(4) transition), after the period ends.",
    );
    // A system placed on the market after 2 August 2026 has no transition.
    const after = dated(generator("2026-09-15"), "WP-XC-10", period);
    expect(after.applicability).toBe("applicable");
    expect(after.timing?.items[0]).toMatchObject({
      date: "2026-08-02",
      transition: null,
      period: "applicable",
    });
  });

  it("wait for the placing date when the transition alone decides", () => {
    const s = dated(generator("unknown"), "WP-XC-10", {
      start: "2026-09-01",
      end: "2026-11-30",
    });
    expect(s.applicability).toBe("pending");
    expect(s.timing?.items[0]).toMatchObject({
      date: null,
      period: "undetermined",
      missingFacts: ["placedOnMarketDate"],
    });
    expect(s.missingFacts).toEqual(["Date first placed on the Union market"]);
    // Ending before 2 August 2026, both dates give readiness.
    const early = dated(generator("unknown"), "WP-XC-10", {
      start: "2026-01-01",
      end: "2026-06-30",
    });
    expect(early.applicability).toBe("readiness");
    expect(early.timing?.items[0]).toMatchObject({
      date: "2026-08-02",
      transition: "Art 111(4)",
      alternativeDate: "2026-12-02",
      period: "readiness",
    });
    // The rationale names both dates: Art 111(4) gives 2026-12-02, not the
    // general 2026-08-02.
    expect(early.rationale).toContain(
      "AIA-50-2 applies from 2026-08-02, or from 2026-12-02 under the Art 111(4) transition (its facts are not recorded), after the period ends.",
    );
    expect(early.rationale).not.toContain("2026-08-02 (Art 111(4) transition)");
    // Starting after 2 December 2026, both dates give applicable.
    const late = dated(generator("unknown"), "WP-XC-10", {
      start: "2027-01-01",
      end: "2027-06-30",
    });
    expect(late.applicability).toBe("applicable");
    expect(late.timing?.items[0]).toMatchObject({
      date: "2026-08-02",
      transition: "Art 111(4)",
      alternativeDate: "2026-12-02",
      period: "applicable",
      missingFacts: [],
    });
    expect(late.rationale).toContain(
      "AIA-50-2 applies from 2026-08-02, or from 2026-12-02 under the Art 111(4) transition (its facts are not recorded), before the period starts.",
    );
  });

  it("say so when the engagement period is not set, and change nothing else", () => {
    const s = dated(chatbot, "WP-XC-07", null);
    expect(s.applicability).toBe("applicable");
    expect(s.timing).toBeNull();
    expect(s.rationale).toContain(
      "Timing not considered: the engagement period is not set in the brief.",
    );
    // Without timing, as before #152.
    const plain = art50PaperSuggestion(chatbot, rules, item("WP-XC-07"))!;
    expect(plain.timing).toBeUndefined();
    expect(plain.rationale).not.toContain("Timing");
    // Papers that are not applicable are not dated.
    expect(
      dated(chatbot, "WP-XC-11", { start: "2026-01-01", end: "2026-06-30" })
        .applicability,
    ).toBe("not_applicable");
  });
});
