// The Art 50 suggestion panel (#120, #152): the readiness suggestion with
// its timing, and the paper editor's form of it for a paper without a
// program ("Add to scope"); the statistical criteria say which ones GenAI
// marking evidence decides.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaperSuggestion } from "@/lib/domain/art50-papers";
import {
  Art50StatisticalCriteria,
  Art50Suggestion,
  canAddToScope,
  scopeWithRationale,
} from "./art50-plan";

const suggestion: PaperSuggestion = {
  templateId: "WP-XC-10",
  applicability: "readiness",
  procedures: [
    {
      procedureId: "A50-P-02A",
      title: "Machine-readable marking",
      status: "candidate",
      items: [
        {
          code: "AIA-50-2",
          article: "50(2)",
          status: "candidate",
          missingFacts: [],
        },
      ],
      claimedExceptions: [],
    },
  ],
  missingFacts: [],
  basis: { status: "approved", rulePackVersion: "2026.11.2", legalVersion: "" },
  rationale: "Suggested from the approved classification: readiness.",
  timing: {
    period: { start: "2026-09-01", end: "2026-11-30" },
    items: [
      {
        code: "AIA-50-2",
        date: "2026-12-02",
        transition: "Art 111(4)",
        alternativeDate: null,
        period: "readiness",
        missingFacts: [],
      },
    ],
    pendingReview: ["LR-03", "LR-04"],
  },
};

describe("adding the suggestion to a paper's scope", () => {
  const rationale = suggestion.rationale;
  it("appends the rationale after a blank line, or starts the scope", () => {
    expect(scopeWithRationale("Population: all users.", rationale)).toBe(
      "Population: all users.\n\n" + rationale,
    );
    expect(scopeWithRationale(undefined, rationale)).toBe(rationale);
    expect(scopeWithRationale("", rationale)).toBe(rationale);
  });

  it("offers it only on an editable, unlocked paper without the rationale", () => {
    expect(canAddToScope("Population.", rationale, true, false)).toBe(true);
    expect(canAddToScope(undefined, rationale, true, false)).toBe(true);
    expect(canAddToScope("Population.", rationale, false, false)).toBe(false);
    expect(canAddToScope("Population.", rationale, true, true)).toBe(false);
    const added = scopeWithRationale("Population.", rationale);
    expect(canAddToScope(added, rationale, true, false)).toBe(false);
  });
});

describe("the Art 50 suggestion panel", () => {
  it("shows a readiness suggestion with its timing and open legal review", () => {
    const html = renderToStaticMarkup(
      <Art50Suggestion
        suggestion={suggestion}
        current="pending"
        canUse
        onUse={() => {}}
      />,
    );
    expect(html).toContain("Suggested: Readiness");
    expect(html).toContain(
      "Timing for the engagement period 2026-09-01 to 2026-11-30:",
    );
    expect(html).toContain(
      "<b>AIA-50-2</b> · applies from 2026-12-02 (Art 111(4) transition) · starts after the period ends",
    );
    expect(html).toContain("Pending legal review: LR-03, LR-04");
    expect(html).toContain("in the plan for independent review");
    expect(html).toContain("Use in plan");
    // With the placing date unknown, both dates are named (#164 review).
    const both = renderToStaticMarkup(
      <Art50Suggestion
        suggestion={{
          ...suggestion,
          timing: {
            ...suggestion.timing!,
            period: { start: "2026-01-01", end: "2026-06-30" },
            items: [
              {
                ...suggestion.timing!.items[0],
                date: "2026-08-02",
                alternativeDate: "2026-12-02",
              },
            ],
          },
        }}
        current="pending"
        canUse
        onUse={() => {}}
      />,
    );
    expect(both).toContain(
      "<b>AIA-50-2</b> · applies from 2026-08-02, or from 2026-12-02 under the Art 111(4) transition (its facts are not recorded) · starts after the period ends",
    );
  });

  it("offers to add the rationale to a paper's scope when there is no program", () => {
    const html = renderToStaticMarkup(
      <Art50Suggestion
        suggestion={{ ...suggestion, timing: null }}
        current=""
        canUse
        useLabel="Add to scope"
        decision="in the paper's scope for review"
        onUse={() => {}}
      />,
    );
    expect(html).toContain("Add to scope");
    expect(html).not.toContain("Use in plan");
    expect(html).toContain("in the paper&#x27;s scope for review");
    expect(html).toContain(
      "Timing not considered: the engagement period is not set in the brief.",
    );
    expect(html).not.toContain("Recorded in the plan");
  });

  it("marks the criteria GenAI marking evidence decides", () => {
    const html = renderToStaticMarkup(
      <Art50StatisticalCriteria procedureIds={["A50-P-02C", "A50-P-02F"]} />,
    );
    expect(html).toContain(
      "Decided by GenAI marking evidence (detection_rate): pre-register it in a GenAI plan in the Testing lab.",
    );
    expect(html).toContain(
      "Attribute sampling: the auditor records the sample and its result.",
    );
  });
});
