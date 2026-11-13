import { describe, expect, it } from "vitest";
import catalog from "@/lib/catalog.json";
import { classificationRules } from "@/lib/classification-rules";
import { resolveNew } from "@/lib/criteria/pin";
import {
  classificationFactValues,
  factAsked,
  factDefinitions,
  recordClassification,
  type Classification,
  type ClassificationInput,
} from "@/lib/domain/classification";
import { freshEngagement } from "@/lib/factories";
import { asRulePack } from "@/lib/rule-pack";
import type { WorkspaceData } from "../workspace-types";
import { art50Suggestions } from "./art50-suggestion";

// The workspace's Art 50 suggestion (#152): the program's plan and the paper
// editor of an engagement without a program read the same helper, which
// dates the suggestion against the brief's engagement period.
const rules = classificationRules(asRulePack(catalog.regulatorySnapshot)!);
const data = { catalog, criteria: null } as unknown as WorkspaceData;

/** A provider's chatbot; every other required fact is answered "no". */
function chatbot(): Classification {
  const e = freshEngagement(resolveNew(), "CLIENT-1", "Art 50", "auditor");
  const input: ClassificationInput = {
    operatorRole: "Provider",
    annexRoute: "Outside high-risk scope",
    intendedPurpose: "Customer assistant",
    rationale: "Reviewed facts",
    facts: {
      interactsDirectlyWithNaturalPersons: "yes",
      obviousToReasonablyWellInformedPerson: "no",
      scientificResearchOnly: "no",
      authorisedByLawForCriminalOffences: "no",
    },
  };
  for (let changed = true; changed;) {
    changed = false;
    const answers = Object.fromEntries(
      Object.entries(input.facts).map(([k, v]) => [k, { value: v === "yes" }]),
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
  return recordClassification(e.classification, input, {
    rules,
    user: "auditor",
    at: "2026-11-06T10:00:00.000Z",
  });
}

describe("the workspace's Art 50 suggestion", () => {
  const classification = chatbot();
  const withPeriod = (periodStart: string, periodEnd: string) => ({
    classification,
    workflow: { brief: { periodStart, periodEnd } },
  });

  it("dates the suggestion by the brief's engagement period", () => {
    const early = art50Suggestions(
      data,
      withPeriod("2026-01-01", "2026-06-30") as never,
    )("WP-XC-07");
    expect(early?.applicability).toBe("readiness");
    const late = art50Suggestions(
      data,
      withPeriod("2026-09-01", "2026-12-31") as never,
    )("WP-XC-07");
    expect(late?.applicability).toBe("applicable");
  });

  it("suggests without timing for an engagement without a brief (a legacy engagement)", () => {
    const s = art50Suggestions(data, { classification } as never)("WP-XC-07");
    expect(s?.applicability).toBe("applicable");
    expect(s?.timing).toBeNull();
  });

  it("suggests nothing without a classification, for other papers or when the pack has no AI Act classification", () => {
    expect(art50Suggestions(data, null)("WP-XC-07")).toBeNull();
    expect(
      art50Suggestions(data, { classification } as never)("WP-A10-01"),
    ).toBeNull();
    const withoutAiAct = {
      ...data,
      criteria: { features: { aiActClassification: false } },
    } as unknown as WorkspaceData;
    expect(
      art50Suggestions(withoutAiAct, { classification } as never)("WP-XC-07"),
    ).toBeNull();
  });
});
