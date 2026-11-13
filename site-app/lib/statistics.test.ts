// Core-level golden tests: every case of schemas/fixtures/statistics-golden.json
// whose runners include "hosted" goes through lib/statistics.ts. The engine
// runs the same cases (engine/tests/test_statistics_golden.py), so the two
// runners agree on every case both run. Numbers match within the fixture's
// tolerances, p-values within its absolute plus relative tolerance, reasons
// as sets, and everything else exactly, including the normalised plan and
// its RFC 8785 SHA-256.
/* eslint-disable @typescript-eslint/no-explicit-any -- the golden fixture is untyped JSON. */
import { describe, expect, it } from "vitest";
import * as st from "./statistics";
import { GOLDEN, differences, publicView } from "./statistics.fixture";

const HOSTED = (GOLDEN.cases as { runners: string[] }[]).filter((c) =>
  c.runners.includes("hosted"),
);

function compute(c: any): unknown {
  if (c.type === "plan") return st.evaluatePlan(st.planFor(c), c.data);
  if (c.type === "derivation") {
    const plan = st.planFor(c);
    return { planSha256: st.planSha256(plan), normalizedPlan: plan };
  }
  if (c.type === "multiplicity") {
    const given = c.input;
    const adjusted = (
      given.method === "bonferroni" ? st.bonferroni : st.benjaminiHochberg
    )(given.pValues);
    return {
      adjustedPValues: adjusted,
      rejected: adjusted.map((v: number) => v <= given.alpha + st.EPS),
    };
  }
  if (c.type === "power") return st.evaluatePower(c.input);
  if (c.type === "ll144") return st.evaluateLl144(c.input);
  if (c.type === "fisher")
    return {
      pValues: c.input.tables.map((t: any) =>
        st.fisherTwoSided(
          t.subject.x,
          t.subject.n,
          t.comparator.x,
          t.comparator.n,
        ),
      ),
    };
  throw Error("unknown golden case type " + c.type);
}

describe("statistics golden fixture (hosted runner, core level)", () => {
  it("has the fixture shape the specification fixes", () => {
    expect(GOLDEN.specificationVersion).toBe(st.SPEC_VERSION);
    expect(GOLDEN.cases).toHaveLength(60);
    expect(GOLDEN.defaults.minimums).toEqual(st.FLOORS);
    // Every case except the engine-only calibration case runs here, the clustered ones included (#136).
    expect(HOSTED).toHaveLength(59);
  });

  it.each(HOSTED.map((c: any) => [c.id, c]))(
    "%s reproduces at core level",
    (_, c: any) => {
      expect(differences(publicView(compute(c)), c.expected)).toEqual([]);
    },
  );

  it("refuses to decide a clustered plan without its cluster data", () => {
    const c: any = GOLDEN.cases.find((x: any) => x.id === "GC-54");
    const plan = st.planFor(c);
    expect(plan.clusterField).not.toBeNull();
    expect(() => st.evaluateCriteria(plan, () => c.data)).toThrow(
      /cluster bootstrap/,
    );
  });

  it("notices a corrupted value, reason or plan field", () => {
    const c = structuredClone(GOLDEN.cases.find((x: any) => x.id === "GC-50"));
    const actual = publicView(compute(c));
    c.expected.criteria[0].members.at(-1).chanceExactP *= 1.001;
    c.expected.criteria[0].decision.reasons = ["interval_straddles_band"];
    c.expected.normalizedPlan.minimums.sampleSize = 31;
    expect(differences(actual, c.expected)).toHaveLength(3);
  });

  it("recomputes every plan hash from the canonical bytes, and normalising is idempotent", () => {
    for (const c of GOLDEN.cases)
      if ("planSha256" in c.expected) {
        const plan = c.expected.normalizedPlan;
        expect(st.planSha256(plan), c.id).toBe(c.expected.planSha256);
        expect(publicView(st.normalizePlan(plan))).toEqual(plan);
      }
  });

  it("matches the fixture's normal quantiles and erfc values", () => {
    for (const entry of GOLDEN.numerics.normalQuantiles)
      expect(
        Math.abs(st.zcrit(entry.twoSidedLevel) - entry.z),
      ).toBeLessThanOrEqual(1e-9);
    // The fixture stores 12 significant digits, so the comparison allows their rounding.
    for (const entry of GOLDEN.numerics.erfc)
      expect(Math.abs(st.erfc(entry.x) - entry.value)).toBeLessThanOrEqual(
        1e-11 * entry.value,
      );
  });
});

describe("statistics core behaviour", () => {
  it("serialises numbers and keys as RFC 8785 requires", () => {
    expect(st.jcs({ b: 1.0, a: [true, null, "é"], c: 0.95 })).toBe(
      '{"a":[true,null,"é"],"b":1,"c":0.95}',
    );
    expect(st.jcs([1e21, 1e20, 1e-7, 0.000001, -0, 5e-324])).toBe(
      "[1e+21,100000000000000000000,1e-7,0.000001,0,5e-324]",
    );
    // Integer-like keys are sorted as strings, not in JavaScript's numeric order.
    expect(st.jcs({ "10": 1, "9": 2 })).toBe('{"10":1,"9":2}');
    expect(() => st.jcs(NaN)).toThrow();
  });

  it("hashes with SHA-256", () => {
    expect(st.sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(st.sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(st.sha256Hex("é".repeat(100))).toHaveLength(64);
  });

  it("rejects minimums below the floors", () => {
    expect(() =>
      st.normalizePlan({
        minimums: { sampleSize: 20 },
        criteria: [
          {
            id: "c",
            kind: "performance",
            members: [{ metric: "accuracy", band: { lower: 0.8 } }],
          },
        ],
      }),
    ).toThrow(st.StatisticsError);
  });

  it("computes Fisher's exact test on known tables", () => {
    expect(st.fisherTwoSided(6, 20, 10, 20)).toBeCloseTo(0.33325, 4);
    expect(st.fisherTwoSided(1, 10, 1, 10)).toBe(1);
    expect(st.fisherGreater(1, 100, 1, 2000)).toBeCloseTo(0.05, 12);
  });

  it("agrees between the closed-form z* and bisection", () => {
    const band = { lower: 0.7, upper: null };
    expect(
      Math.abs(
        st.wilsonZstar(40, 50, band, "pass") -
          st.invert((z) => st.wilson(40, 50, z), band, "pass"),
      ),
    ).toBeLessThanOrEqual(1e-8);
  });

  it("orders labels by code point, not UTF-16 unit", () => {
    // U+FF5E sorts before U+1F600 by code point but after it by UTF-16 unit.
    expect(["😀", "～"].sort(st.codePointCompare)).toEqual(["～", "😀"]);
  });

  it("validates new plans as written", () => {
    const plan = {
      criteria: [
        {
          id: "impact",
          kind: "group_comparison",
          metric: "selection_rate_ratio",
          libraryEntry: { id: "screen.us.four-fifths" },
        },
      ],
    };
    const normalised = st.validatePlan(plan);
    expect(normalised.criteria[0].band).toEqual({ lower: 0.8, upper: 1.25 });
    expect(() =>
      st.validatePlan({
        criteria: [
          {
            id: "p",
            kind: "performance",
            members: [{ metric: "accuracy", band: { lower: 1.2 } }],
          },
        ],
      }),
    ).toThrow(/strictly inside/);
    expect(() => st.validatePlan({ ...plan, unknownField: true })).toThrow(
      /unknown fields/,
    );
    expect(() =>
      st.validatePlan({
        criteria: [
          {
            id: "r",
            kind: "regression_performance",
            members: [{ metric: "rmse", band: { upper: 1 } }],
            passBlockedBy: ["r2"],
          },
        ],
      }),
    ).toThrow(/derived plans/);
  });
});

describe("threshold library", () => {
  it("ships the screen, the LL144 reporting profile, the EU policies and the Art 50 entries", () => {
    const ids = st.THRESHOLD_LIBRARY.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(Object.keys(st.LIBRARY)));
    expect(ids).toContain("report.us-nyc.ll144");
    expect(
      ids.filter((id) => id.startsWith("policy.eu-aia.art50-")),
    ).toHaveLength(5);
    for (const entry of st.THRESHOLD_LIBRARY)
      if (entry.id.startsWith("policy.eu-aia."))
        expect(entry.legalStatus).toBe("no_legal_safe_harbour");
  });

  it("lets a plan reference only entries a criterion can decide", () => {
    expect(() =>
      st.validatePlan({
        criteria: [
          {
            id: "marking",
            kind: "performance",
            members: [{ metric: "recall", band: { lower: 0.95 } }],
            libraryEntry: { id: "policy.eu-aia.art50-marking-presence" },
          },
        ],
      }),
    ).toThrow(/not a library entry/);
  });
});
