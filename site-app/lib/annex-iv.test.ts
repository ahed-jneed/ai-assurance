import { describe, expect, it } from "vitest";
import annexMap from "./annex-iv-map.json";
import { annexIVIndex } from "./annex-iv";
import type { Engagement, Paper } from "./domain";
import { artifact, engagement, templatePaper } from "./workflow/test-fixtures";

const section = (e: Engagement, number: number) =>
  annexIVIndex(e).find((s) => s.number === number)!;
// Section 7 maps WP-XC-06 and WP-A11-01.
const mapped = annexMap.sections.find((s) => s.number === 7)!.paperIds;
const missing = (t: string) =>
  t + ": no current working paper for this mapped template";
const unsigned = (t: string) => t + ": independent signed assessment missing";
const specific = (e: Engagement) =>
  section(e, 7).gaps.filter((g) => !g.startsWith("Human assessment"));
const signed = (templateId: string): Paper => ({
  ...templatePaper(templateId),
  status: "signed",
});

describe("Annex IV index", () => {
  it("emits an explicit gap for each mapped template without a paper", () => {
    expect(mapped).toEqual(["WP-XC-06", "WP-A11-01"]);
    const e = engagement({ papers: [] });
    expect(specific(e)).toEqual([
      "No accepted candidate evidence",
      missing("WP-XC-06"),
      missing("WP-A11-01"),
    ]);
    expect(section(e, 7).paperIds).toEqual([]);
  });

  it("matches signed and required papers and reports unsigned required ones", () => {
    const xc06 = signed("WP-XC-06");
    const a11 = templatePaper("WP-A11-01");
    const e = engagement({
      papers: [xc06, a11],
      artifacts: [artifact({ category: "Governance" })],
    });
    expect(section(e, 7).paperIds).toEqual([xc06.id, a11.id]);
    expect(specific(e)).toEqual([unsigned("WP-A11-01")]);
    expect(section(e, 7).state).toBe("candidate_evidence_present");
  });

  it("ignores unsigned diagnostic drafts and superseded papers", () => {
    const draft = {
      ...templatePaper("WP-A11-01"),
      title: "Diagnostic run",
      required: false,
    };
    const superseded = {
      ...signed("WP-XC-06"),
      supersededBy: "WP-new",
      required: false,
    };
    const current = signed("WP-XC-06");
    const e = engagement({ papers: [draft, superseded, current] });
    expect(section(e, 7).paperIds).toEqual([current.id]);
    expect(specific(e)).toEqual([
      "No accepted candidate evidence",
      missing("WP-A11-01"),
    ]);
  });

  it("matches a signed supplementary paper", () => {
    const supplementary = { ...signed("WP-A11-01"), required: false };
    const e = engagement({ papers: [supplementary] });
    expect(section(e, 7).paperIds).toEqual([supplementary.id]);
  });
});
