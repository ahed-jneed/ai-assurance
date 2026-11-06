import { describe, expect, it } from "vitest";
import { ApiError } from "../../http";
import { importedOutcome } from "./execution";

const results = (...outcomes: unknown[]) =>
  outcomes.map((outcome) => ({ outcome }) as { outcome: "pass" });

describe("importedOutcome", () => {
  it("refuses a result without hosted results instead of recording a run", () => {
    for (const empty of [[], undefined, null, {}]) {
      let error: unknown;
      try {
        importedOutcome(empty as never);
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
});
