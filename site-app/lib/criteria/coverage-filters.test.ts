// The coverage heatmap's filters and CSV export (#135,
// docs/design/criteria-model.md section 15.2), the preference that keeps the
// filters per user, and the internal-only export.
import { describe, expect, it } from "vitest";
import { caller } from "../commands/test-fixtures";
import { freshEngagement } from "../factories";
import { coverageExport } from "../read-models/coverage-view";
import { defaultPreferences, preferencesSchema } from "../workspace-state";
import {
  coverageCsv,
  csvCell,
  csvColumns,
  effectiveFilters,
  filterOptions,
  matches,
  NONE,
} from "./coverage-filters";
import { criteriaRegistry, pinned, resolveNew } from "./pin";
import { coverageFor, type CellView } from "./views";

const KEY = "eu-ai-act@02024R1689-20260727";
const view = () => {
  const e = freshEngagement(resolveNew(), "CL-1", "AI Act", "lead", true);
  return coverageFor(criteriaRegistry(), pinned(e), e, [], KEY)!;
};
const cell = (over: Partial<CellView>): CellView => ({
  id: "x",
  ref: "Art. 1",
  type: "requirement",
  state: "open",
  readiness: false,
  qualified: false,
  capped: false,
  contributions: [],
  caps: [],
  ...over,
});
const all = { state: "all", actor: "all", date: "all" };

describe("matches", () => {
  it("filters by state, actor and date, and 'none' picks the cells without one", () => {
    const provider = cell({ actors: ["Provider"], state: "partial" });
    const bare = cell({});
    const dated = cell({
      derivedApplicability: [
        {
          from: "2027-12-02",
          condition: "x",
          provenance: {
            source: "s",
            sourceKind: "k",
            verification: "unverified",
          },
          derived: {
            entryId: "e",
            rulePackVersion: "1",
            dateType: "applies_from",
            provision: "Art 1",
            reviewed: false,
          },
        },
      ],
    });
    expect(matches(provider, { ...all, state: "partial" })).toBe(true);
    expect(matches(provider, { ...all, state: "open" })).toBe(false);
    expect(matches(provider, { ...all, actor: "Provider" })).toBe(true);
    expect(matches(provider, { ...all, actor: "Deployer" })).toBe(false);
    expect(matches(bare, { ...all, actor: NONE })).toBe(true);
    expect(matches(provider, { ...all, actor: NONE })).toBe(false);
    expect(matches(dated, { ...all, date: "2027-12-02" })).toBe(true);
    expect(matches(dated, { ...all, date: "2028-08-02" })).toBe(false);
    expect(matches(bare, { ...all, date: NONE })).toBe(true);
    expect(matches(dated, { ...all, date: NONE })).toBe(false);
    // Reviewed rows of the framework data count as dates too.
    expect(
      matches(
        cell({
          applicability: [
            {
              from: "2026-08-02",
              condition: "y",
              provenance: {
                source: "s",
                sourceKind: "k",
                verification: "verified",
              },
            },
          ],
        }),
        { ...all, date: "2026-08-02" },
      ),
    ).toBe(true);
  });
});

describe("filter options on pack #1", () => {
  const v = view();
  const o = filterOptions(v);
  it("offers the framework's actors and the derived dates", () => {
    expect(o.actors).toEqual(expect.arrayContaining(["Provider", "Deployer"]));
    expect(o.actorsMissing).toBe(true);
    expect(o.dates).toEqual(
      expect.arrayContaining(["2026-08-02", "2027-12-02", "2028-08-02"]),
    );
    expect(o.dates).toEqual([...o.dates].sort());
    expect(o.datesMissing).toBe(true);
    expect(o.derived).toBe(true);
  });

  it("falls back to 'all' for a saved value the view does not offer", () => {
    expect(
      effectiveFilters(v, {
        state: "bogus",
        actor: "Notified body",
        date: "1999-01-01",
      }),
    ).toEqual(all);
    expect(
      effectiveFilters(v, {
        state: "open",
        actor: "Provider",
        date: "2027-12-02",
      }),
    ).toEqual({ state: "open", actor: "Provider", date: "2027-12-02" });
    expect(effectiveFilters(v, undefined)).toEqual(all);
  });
});

describe("coverageCsv", () => {
  const v = view();
  const parse = (csv: string) => csv.trimEnd().split("\r\n");

  it("exports one line per requirement in heatmap order", () => {
    const lines = parse(coverageCsv(v));
    expect(lines[0]).toBe(csvColumns.join(","));
    expect(lines).toHaveLength(v.summary.total + 1);
    expect(lines[1]).toContain(
      v.cells.find((c) => c.type === "requirement")!.id,
    );
  });

  it("applies the filters", () => {
    const lines = parse(
      coverageCsv(v, { ...all, actor: "Provider", date: "2026-08-02" }),
    );
    const expected = v.cells.filter((c) =>
      matches(c, { ...all, actor: "Provider", date: "2026-08-02" }),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(expected.length + 1);
    expect(lines.slice(1).every((l) => l.includes("Provider"))).toBe(true);
  });

  it("says derived dates are not reviewed and never says compliant", () => {
    const csv = coverageCsv(v);
    const line = parse(csv).find((l) => l.includes(",AIA-50-2,"))!;
    expect(line).toContain(
      "2026-12-02 aia-2026-12-02-art50-2-legacy-transition (Art 50(2); derived, not reviewed)",
    );
    expect(line).toContain(",yes,"); // legal review pending
    expect(csv.toLowerCase()).not.toMatch(/compliant|certified|conformant/);
  });

  it("names the group and inheritance of a subitem", () => {
    const line = parse(coverageCsv(v)).find((l) => l.includes(",AIA-9-1,"))!;
    expect(line).toContain(",Art. 9,");
    expect(line).toContain("inherited from Art. 9");
  });
});

describe("csvCell", () => {
  it("quotes separators and neutralises formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("coverageExport", () => {
  it.each(["Client Viewer", "Client Contributor"] as const)(
    "refuses %s with 403 before reading anything",
    async (role) => {
      await expect(
        coverageExport(caller(role, false), "E-1", KEY),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it("asks for a view", async () => {
    await expect(
      coverageExport(caller("Auditor", false), "E-1", null),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("the coverage filter preference", () => {
  it("is optional, so earlier preferences still parse", () => {
    expect(preferencesSchema.parse(defaultPreferences)).toEqual(
      defaultPreferences,
    );
  });
  it("keeps a state, an actor and a date per user", () => {
    const value = {
      ...defaultPreferences,
      coverage: { state: "open", actor: "Provider", date: "2027-12-02" },
    };
    expect(preferencesSchema.parse(value)).toEqual(value);
    expect(
      preferencesSchema.parse({
        ...defaultPreferences,
        coverage: { state: "all", actor: NONE, date: NONE },
      }).coverage,
    ).toEqual({ state: "all", actor: NONE, date: NONE });
  });
  it.each([
    { state: "open", actor: "Provider", date: "next year" },
    { state: "", actor: "Provider", date: "all" },
    { state: "open", actor: "x".repeat(81), date: "all" },
    { state: "open", actor: "Provider", date: "all", extra: 1 },
  ])("rejects %o", (coverage) => {
    expect(
      preferencesSchema.safeParse({ ...defaultPreferences, coverage }).success,
    ).toBe(false);
  });
});
