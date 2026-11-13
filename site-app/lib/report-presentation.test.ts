import { describe, expect, it } from "vitest";
import type { Report } from "./domain";
import { clientNotices, reportDate } from "./report-presentation";

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

describe("client release notices (#94)", () => {
  const report = (id: string, extra: Partial<Report>): Report => ({
    id,
    kind: "final",
    createdAt: "2026-11-01T09:00:00.000Z",
    actor: "",
    sha256: id,
    snapshot: {},
    ...extra,
  });
  it("lists the notified releases newest first, with what they replace", () => {
    expect(
      clientNotices([
        report("REPORT-1", {
          supersededBy: "REPORT-2",
          notification: {
            at: "2026-11-02T09:00:00.000Z",
            recipients: "Acme board",
          },
        }),
        report("REPORT-2", {
          replaces: ["REPORT-1"],
          notification: {
            at: "2026-11-04T09:00:00.000Z",
            recipients: "Acme board",
          },
        }),
        // Released before releases recorded a notification.
        report("REPORT-0", {}),
      ]),
    ).toEqual([
      {
        reportId: "REPORT-2",
        at: "2026-11-04T09:00:00.000Z",
        text: "Report REPORT-2 was released to Acme board; it replaces REPORT-1.",
      },
      {
        reportId: "REPORT-1",
        at: "2026-11-02T09:00:00.000Z",
        text: "Report REPORT-1 was released to Acme board. It has since been superseded.",
      },
    ]);
  });
});
