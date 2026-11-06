import { describe, expect, it } from "vitest";
import { ApiError } from "../../http";
import { hostedResults, importedOutcome } from "./execution";

const results = (...outcomes: unknown[]) =>
  outcomes.map((outcome) => ({ outcome }) as { outcome: "pass" });

describe("importedOutcome", () => {
  it("refuses a result without hosted results instead of recording a run", () => {
    for (const empty of [[], undefined, null, {}]) {
      let error: unknown;
      try {
        hostedResults(empty);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).message).toMatch(/no hosted results/);
    }
  });

  it("never turns an unknown or missing outcome next to a pass into a pass", () => {
    expect(importedOutcome(results("pass", "passed"))).toBe("inconclusive");
    expect(importedOutcome(results("pass", undefined))).toBe("inconclusive");
    expect(importedOutcome(results("pass", null))).toBe("inconclusive");
    expect(importedOutcome([{ outcome: "pass" }, {} as never])).toBe(
      "inconclusive",
    );
  });

  it("ranks fail over inconclusive over pass", () => {
    expect(importedOutcome(results("pass", "inconclusive", "fail"))).toBe(
      "fail",
    );
    expect(importedOutcome(results("fail", "unknown"))).toBe("fail");
    expect(importedOutcome(results("pass", "inconclusive"))).toBe(
      "inconclusive",
    );
    expect(importedOutcome(results("pass", "not_applicable"))).toBe("pass");
    expect(importedOutcome(results("pass"))).toBe("pass");
    expect(importedOutcome(results("not_applicable"))).toBe("not_applicable");
  });

  it("refuses an empty result in the decided path too", () => {
    expect(() => importedOutcome([], true)).toThrow(/no hosted results/);
  });

  it("lets confirmatory criteria decide a run 1.5 import", () => {
    const decided = (outcome: unknown, role?: unknown) =>
      ({ outcome, decision: { role } }) as never;
    // A failing exploratory criterion is a review flag, not the outcome.
    expect(
      importedOutcome(
        [decided("pass", "confirmatory"), decided("fail", "exploratory")],
        true,
      ),
    ).toBe("pass");
    expect(
      importedOutcome(
        [decided("fail", "confirmatory"), decided("pass", "exploratory")],
        true,
      ),
    ).toBe("fail");
    // An unknown or missing outcome among the deciding criteria is never a pass.
    expect(
      importedOutcome(
        [decided("pass", "confirmatory"), decided("passed", "confirmatory")],
        true,
      ),
    ).toBe("inconclusive");
    expect(
      importedOutcome(
        [decided("pass", "confirmatory"), decided(null, "confirmatory")],
        true,
      ),
    ).toBe("inconclusive");
    // A result without a known role still decides; it cannot be dropped.
    expect(
      importedOutcome([decided("pass", "confirmatory"), decided("fail")], true),
    ).toBe("fail");
    // Only exploratory criteria: nothing decides, as for a hosted run.
    expect(importedOutcome([decided("fail", "exploratory")], true)).toBe(
      "not_applicable",
    );
  });
});
