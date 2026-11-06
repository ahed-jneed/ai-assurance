// NYC Local Law 144 golden cases (schemas/fixtures/ll144-golden.json) through
// the hosted runner. engine/tests/test_ll144.py runs the same cases through
// engine/ll144.py, so both runners agree on every case.
/* eslint-disable @typescript-eslint/no-explicit-any -- the golden fixture is untyped JSON. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoryLabel, Ll144Error, ll144Audit, median } from "./ll144";
import { evaluateLl144 } from "./statistics";

const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL("../../schemas/fixtures/" + name, import.meta.url),
      "utf8",
    ),
  );
const GOLDEN = read("ll144-golden.json");

function differences(
  actual: any,
  expected: any,
  path = "",
  out: string[] = [],
  key = "",
): string[] {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (
      !actual ||
      typeof actual !== "object" ||
      Object.keys(actual).sort().join() !== Object.keys(expected).sort().join()
    ) {
      out.push(path + ": keys differ");
      return out;
    }
    for (const k of Object.keys(expected))
      differences(actual[k], expected[k], path + "." + k, out, k);
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      out.push(path + ": length differs");
    else
      expected.forEach((e, i) =>
        differences(actual[i], e, `${path}[${i}]`, out, key),
      );
  } else if (typeof expected === "number" && typeof actual === "number") {
    const tolerance =
      GOLDEN.tolerances[
        key === "lower" || key === "upper" ? "interval" : "number"
      ];
    if (Math.abs(actual - expected) > tolerance)
      out.push(`${path}: ${actual} != ${expected}`);
  } else if (actual !== expected)
    out.push(`${path}: ${String(actual)} != ${String(expected)}`);
  return out;
}

describe("LL144 golden cases (hosted runner)", () => {
  it("has five cases and four error cases", () => {
    expect(GOLDEN.cases).toHaveLength(5);
    expect(GOLDEN.errorCases).toHaveLength(4);
  });

  it.each(GOLDEN.cases.map((c: any) => [c.id, c]))(
    "%s reproduces",
    (_, c: any) => {
      expect(differences(ll144Audit(c.input), c.expected)).toEqual([]);
    },
  );

  it.each(GOLDEN.errorCases.map((c: any) => [c.id, c]))(
    "%s is rejected",
    (_, c: any) => {
      expect(() => ll144Audit(c.input)).toThrow(Ll144Error);
      expect(() => ll144Audit(c.input)).toThrow(c.error);
    },
  );

  it("reproduces the DCWP race/ethnicity table of GC-32", () => {
    const gc32 = read("statistics-golden.json").cases.find(
      (c: any) => c.id === "GC-32",
    );
    const ll04 = GOLDEN.cases.find((c: any) => c.id === "LL-04");
    const race = ll144Audit(ll04.input).tables[1];
    expect(
      differences(
        race.categories.map(
          ({ components: _c, exclusionJustification: _j, ...row }) => row,
        ),
        gc32.expected.categories,
      ),
    ).toEqual([]);
    expect(race.referenceCategory).toBe("White");
  });

  it("takes the median over the full sample, including the unknown category", () => {
    const ll02 = GOLDEN.cases.find((c: any) => c.id === "LL-02");
    expect(ll144Audit(ll02.input).medianScore).toBe(5);
    expect(
      ll144Audit({
        ...ll02.input,
        records: ll02.input.records.filter((r: any) => r.sex !== null),
      }).medianScore,
    ).toBe(4.5);
  });

  it("computes the median of counted pairs and labels strata as the engine does", () => {
    expect(
      median([
        [3, 1],
        [1, 2],
      ]),
    ).toBe(1);
    expect(
      median([
        [1, 2],
        [3, 2],
      ]),
    ).toBe(2);
    expect(categoryLabel(["Male", "Asian"])).toBe('["Male","Asian"]');
    const out = ll144Audit({
      rate: "selection",
      records: [
        { sex: " ", raceEthnicity: "Asian", selected: true },
        { sex: "Male", raceEthnicity: "Asian", selected: false },
      ],
    });
    expect(out.tables[0].unknownCategoryCount).toBe(1);
  });

  it("keeps the statistics table's selection shape", () => {
    const table = evaluateLl144({
      categories: [
        { name: "a", n: 0, selected: 0 },
        { name: "b", n: 4, selected: 2 },
      ],
    });
    expect(table.referenceCategory).toBe("b");
    expect(table.categories[0].selectionRate).toBeNull();
    expect(() => evaluateLl144({ categories: [] })).toThrow(/at least one/);
  });
});
