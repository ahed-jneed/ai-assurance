import { describe, expect, it } from "vitest";
import { reportDate } from "./report-presentation";

describe("report date", () => {
  it("states the capture date from the report date element", () => {
    expect(
      reportDate({
        createdAt: "2026-11-01T09:00:00.000Z",
        elements: [
          {
            id: "date",
            label: "Report date",
            value: "2026-11-02T09:00:00.000Z",
          },
        ],
      }),
    ).toBe("2026-11-02T09:00:00.000Z");
  });

  it("falls back to the snapshot's capture time, never a release time", () => {
    expect(reportDate({ createdAt: "2026-11-01T09:00:00.000Z" })).toBe(
      "2026-11-01T09:00:00.000Z",
    );
    expect(reportDate({ elements: "malformed" })).toBe("");
  });
});
