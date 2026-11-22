import { describe, expect, it } from "vitest";
import {
  defaultCoolingOffDays,
  effectiveCoolingOffDays,
  maxCoolingOffDays,
} from "./quality-review-policy";

describe("effectiveCoolingOffDays", () => {
  it("uses the two-year default when the practice has not set a period", () => {
    expect(defaultCoolingOffDays).toBe(730);
    expect(effectiveCoolingOffDays(null)).toBe(730);
    expect(effectiveCoolingOffDays(undefined)).toBe(730);
  });

  it("keeps 0, which is a valid setting and not 'unset'", () => {
    expect(effectiveCoolingOffDays(0)).toBe(0);
  });

  it("keeps a period within range", () => {
    expect(effectiveCoolingOffDays(365)).toBe(365);
  });

  it("keeps the ten-year maximum and refuses one day more", () => {
    expect(maxCoolingOffDays).toBe(3650);
    expect(effectiveCoolingOffDays(3650)).toBe(3650);
    expect(effectiveCoolingOffDays(3651)).toBe(defaultCoolingOffDays);
  });

  it.each([-1, 1.5, NaN])("uses the default for %s", (stored) => {
    expect(effectiveCoolingOffDays(stored)).toBe(defaultCoolingOffDays);
  });
});
