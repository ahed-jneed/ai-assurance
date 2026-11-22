import { describe, expect, it } from "vitest";
import {
  all,
  any,
  conjunction,
  factTruth,
  not,
  select,
  truth,
  unknownFacts,
  type Facts,
  type Predicate,
} from "./predicates";

// Small helpers so each test reads like the case it checks.
const eq = (fact: string, value: unknown): Predicate => ({
  fact,
  op: "eq",
  value,
});
const isIn = (fact: string, value: unknown): Predicate => ({
  fact,
  op: "in",
  value,
});
const before = (fact: string, value: unknown): Predicate => ({
  fact,
  op: "before",
  value,
});
const onOrAfter = (fact: string, value: unknown): Predicate => ({
  fact,
  op: "onOrAfter",
  value,
});

describe("truth", () => {
  it("treats a missing, null or 'unknown' fact as unknown", () => {
    const p = eq("colour", "red");
    expect(truth(p, {})).toBe("unknown");
    expect(truth(p, { colour: null })).toBe("unknown");
    expect(truth(p, { colour: "unknown" })).toBe("unknown");
  });

  it("treats an unknown fact as unknown for every operator", () => {
    expect(truth(isIn("colour", ["red"]), {})).toBe("unknown");
    expect(truth(before("startDate", "2026-08-02"), {})).toBe("unknown");
    expect(truth(onOrAfter("startDate", "2026-08-02"), {})).toBe("unknown");
  });

  it("eq: equal is true, different is false", () => {
    expect(truth(eq("colour", "red"), { colour: "red" })).toBe(true);
    expect(truth(eq("colour", "red"), { colour: "blue" })).toBe(false);
    expect(truth(eq("isPublic", false), { isPublic: false })).toBe(true);
  });

  it("in: a value in the list is true, one not in the list is false", () => {
    const p = isIn("colour", ["red", "green"]);
    expect(truth(p, { colour: "green" })).toBe(true);
    expect(truth(p, { colour: "blue" })).toBe(false);
  });

  it("in: a value that is not a list gives false", () => {
    expect(truth(isIn("colour", "red"), { colour: "red" })).toBe(false);
  });

  it("before: only an earlier date is true", () => {
    const p = before("startDate", "2026-08-02");
    expect(truth(p, { startDate: "2026-08-01" })).toBe(true);
    expect(truth(p, { startDate: "2026-08-02" })).toBe(false);
    expect(truth(p, { startDate: "2026-08-03" })).toBe(false);
  });

  it("onOrAfter: the same day and later dates are true", () => {
    const p = onOrAfter("startDate", "2026-08-02");
    expect(truth(p, { startDate: "2026-08-01" })).toBe(false);
    expect(truth(p, { startDate: "2026-08-02" })).toBe(true);
    expect(truth(p, { startDate: "2026-08-03" })).toBe(true);
  });

  it("before and onOrAfter give unknown when the fact or the value is not a string", () => {
    expect(truth(before("startDate", "2026-08-02"), { startDate: 2026 })).toBe(
      "unknown",
    );
    expect(truth(before("startDate", 2026), { startDate: "2026-08-01" })).toBe(
      "unknown",
    );
    expect(
      truth(onOrAfter("startDate", "2026-08-02"), { startDate: true }),
    ).toBe("unknown");
    expect(
      truth(onOrAfter("startDate", null), { startDate: "2026-08-03" }),
    ).toBe("unknown");
  });

  it("treats a fact that exists only on the prototype as missing", () => {
    expect(truth(eq("toString", "x"), {})).toBe("unknown");
    expect(truth(eq("hasOwnProperty", "x"), {})).toBe("unknown");
  });
});

describe("conjunction", () => {
  const facts: Facts = { colour: "red", size: "large" };

  it("returns the absent argument for an empty or missing list", () => {
    expect(conjunction([], facts, true)).toBe(true);
    expect(conjunction([], facts, false)).toBe(false);
    expect(conjunction(undefined, facts, true)).toBe(true);
    expect(conjunction(undefined, facts, false)).toBe(false);
  });

  it("is true when every predicate is true", () => {
    expect(
      conjunction([eq("colour", "red"), eq("size", "large")], facts, false),
    ).toBe(true);
  });

  it("is false when one predicate is false, even next to an unknown", () => {
    expect(
      conjunction([eq("weight", 3), eq("colour", "blue")], facts, true),
    ).toBe(false);
    expect(
      conjunction([eq("colour", "blue"), eq("weight", 3)], facts, true),
    ).toBe(false);
  });

  it("is unknown when the rest are true and one is unknown", () => {
    expect(
      conjunction([eq("colour", "red"), eq("weight", 3)], facts, true),
    ).toBe("unknown");
  });
});

describe("all", () => {
  it("lets false win over unknown", () => {
    expect(all([true, "unknown", false])).toBe(false);
  });

  it("lets unknown win over true", () => {
    expect(all([true, "unknown"])).toBe("unknown");
  });

  it("is true when every value is true, and for an empty list", () => {
    expect(all([true, true])).toBe(true);
    expect(all([])).toBe(true);
  });
});

describe("any", () => {
  it("lets true win over unknown", () => {
    expect(any([false, "unknown", true])).toBe(true);
  });

  it("lets unknown win over false", () => {
    expect(any([false, "unknown"])).toBe("unknown");
  });

  it("is false when every value is false, and for an empty list", () => {
    expect(any([false, false])).toBe(false);
    expect(any([])).toBe(false);
  });
});

describe("not", () => {
  it("swaps true and false and keeps unknown", () => {
    expect(not(true)).toBe(false);
    expect(not(false)).toBe(true);
    expect(not("unknown")).toBe("unknown");
  });
});

describe("factTruth", () => {
  it("returns true and false as they are", () => {
    expect(factTruth({ isPublic: true }, "isPublic")).toBe(true);
    expect(factTruth({ isPublic: false }, "isPublic")).toBe(false);
  });

  it("gives unknown for anything else", () => {
    expect(factTruth({ isPublic: "yes" }, "isPublic")).toBe("unknown");
    expect(factTruth({ isPublic: 1 }, "isPublic")).toBe("unknown");
    expect(factTruth({ isPublic: null }, "isPublic")).toBe("unknown");
    expect(factTruth({}, "isPublic")).toBe("unknown");
  });

  it("treats a fact that exists only on the prototype as missing", () => {
    expect(factTruth({}, "toString")).toBe("unknown");
  });
});

describe("select", () => {
  const rule = {
    appliesIf: [eq("usesCamera", true)],
    exceptIf: [eq("isToy", true)],
  };

  it("is a candidate when appliesIf is true and exceptIf is false", () => {
    expect(select(rule, { usesCamera: true, isToy: false })).toEqual({
      selection: "candidate",
      missingFacts: [],
    });
  });

  it("is not selected when appliesIf is false, even if exceptIf is unknown", () => {
    expect(select(rule, { usesCamera: false })).toEqual({
      selection: "not_selected",
      missingFacts: [],
    });
  });

  it("is not selected when exceptIf is true, even if appliesIf is unknown", () => {
    expect(select(rule, { isToy: true })).toEqual({
      selection: "not_selected",
      missingFacts: [],
    });
  });

  it("needs information for any other mix with an unknown, naming the unknown facts", () => {
    expect(select(rule, { isToy: false })).toEqual({
      selection: "needs_information",
      missingFacts: ["usesCamera"],
    });
    expect(select(rule, { usesCamera: true })).toEqual({
      selection: "needs_information",
      missingFacts: ["isToy"],
    });
    expect(select(rule, {})).toEqual({
      selection: "needs_information",
      missingFacts: ["usesCamera", "isToy"],
    });
  });

  it("is a candidate for a rule with neither list", () => {
    expect(select({}, {})).toEqual({
      selection: "candidate",
      missingFacts: [],
    });
  });
});

describe("unknownFacts", () => {
  it("returns only the facts that are unknown", () => {
    expect(
      unknownFacts([eq("colour", "red"), eq("size", "large")], {
        colour: "blue",
      }),
    ).toEqual(["size"]);
  });

  it("returns each unknown fact once, even when two predicates read it", () => {
    expect(
      unknownFacts(
        [
          before("startDate", "2026-08-02"),
          onOrAfter("startDate", "2025-01-01"),
          eq("colour", "red"),
        ],
        {},
      ),
    ).toEqual(["startDate", "colour"]);
  });
});
