import { describe, expect, it } from "vitest";
import { positionLabel } from "./statistics-position";

const band = { lower: null, upper: 0.1 };
const member = {
  role: "member" as const,
  band,
  status: "evaluated",
  direction: "pass",
  reasons: [] as string[],
};

describe("positionLabel", () => {
  it("states the side of the band for decided members", () => {
    expect(positionLabel(member)).toBe("Estimate within band");
    expect(positionLabel({ ...member, direction: "fail" })).toBe(
      "Estimate outside band",
    );
  });

  it("reports the band edge only when the evaluation recorded it", () => {
    expect(
      positionLabel({
        ...member,
        direction: "none",
        reasons: ["estimate_on_band_boundary"],
      }),
    ).toBe("Estimate on the band edge");
    // decide=false: a member whose derived band is invalid stays undecided.
    expect(
      positionLabel({ ...member, direction: "none", reasons: ["invalid_band"] }),
    ).toBe("Not decided");
    expect(positionLabel({ ...member, direction: "none", reasons: [] })).toBe(
      "Not decided",
    );
  });

  it("never places a descriptive metric on a band", () => {
    expect(
      positionLabel({
        role: "descriptive",
        band: null,
        status: "evaluated",
        direction: "none",
        reasons: [],
      }),
    ).toBe("Descriptive, no band");
  });

  it("says when an evaluated entry has no band", () => {
    expect(
      positionLabel({ ...member, band: null, direction: "none" }),
    ).toBe("No band");
  });

  it("shows a headline without a decision as not decided", () => {
    expect(
      positionLabel({
        role: "headline",
        band,
        status: "evaluated",
        direction: "none",
        reasons: [],
      }),
    ).toBe("Not decided");
  });

  it("names a status other than evaluated", () => {
    expect(positionLabel({ ...member, status: "suppressed" })).toBe(
      "Suppressed",
    );
  });
});
