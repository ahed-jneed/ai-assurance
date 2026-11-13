import { describe, expect, it } from "vitest";
import catalog from "../catalog.json";
import type { CriteriaTemplate } from "../catalog-criteria";
import { classificationRules } from "../classification-rules";
import { resolveNew } from "../criteria/pin";
import { freshEngagement } from "../factories";
import { asRulePack } from "../rule-pack";
import {
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
