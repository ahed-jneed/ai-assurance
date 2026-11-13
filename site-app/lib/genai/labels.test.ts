import { describe, expect, it } from "vitest";
import { GENAI_ACK_FLAGS } from "./readiness";
import {
  ACK_LABELS,
  LEVEL_LABELS,
  custodyLabel,
  fmt,
  reasonLabel,
} from "./labels";

describe("GenAI labels", () => {
  it("labels every acknowledgement flag and level", () => {
    for (const flag of GENAI_ACK_FLAGS) expect(ACK_LABELS[flag]).toBeTruthy();
    expect(Object.keys(LEVEL_LABELS)).toEqual(["L0", "L1", "L2", "L3"]);
  });
  it("shows an unknown reason code as it is", () => {
    expect(reasonLabel("same_family")).toMatch(/same model family/);
    expect(reasonLabel("something_new")).toBe("something_new");
  });
  it("never presents an unauthenticated upload as a worker result", () => {
    expect(custodyLabel("uploaded", false)).toMatch(/unauthenticated/);
    expect(custodyLabel("uploaded", true)).toMatch(/authenticated by/);
    expect(custodyLabel("worker", false)).toBe("Authenticated worker result");
  });
  it("formats numbers and shows a dash for missing ones", () => {
    expect(fmt(0.123456)).toBe("0.1235");
    expect(fmt(1)).toBe("1");
    expect(fmt(null)).toBe("—");
    expect(fmt(Number.NaN)).toBe("—");
  });
});
