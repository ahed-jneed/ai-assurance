import { describe, expect, it } from "vitest";
import { leavesToaster } from "./toaster-layer";

describe("leavesToaster (#227)", () => {
  const controls = ["toast", "reload", "close"];
  it("leaves forwards from the last control and backwards from the first", () => {
    expect(leavesToaster(controls, "close", false)).toBe(true);
    expect(leavesToaster(controls, "toast", true)).toBe(true);
  });

  it("stays inside the toaster between its controls", () => {
    expect(leavesToaster(controls, "reload", false)).toBe(false);
    expect(leavesToaster(controls, "reload", true)).toBe(false);
    expect(leavesToaster(controls, "toast", false)).toBe(false);
    expect(leavesToaster(controls, "close", true)).toBe(false);
  });

  it("treats the list Alt+T focuses as before the controls", () => {
    expect(leavesToaster(controls, "list", true)).toBe(true);
    expect(leavesToaster(controls, "list", false)).toBe(false);
    expect(leavesToaster([], "list", false)).toBe(true);
  });
});
