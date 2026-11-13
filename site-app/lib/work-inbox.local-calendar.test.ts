// Work days and reminders follow the local calendar across daylight-saving
// changes. vitest.config.ts runs *.local-calendar.test.ts files in their own
// project with TZ=Europe/Vienna, so the other tests keep the time zone of the
// machine. Ported from the child process of scripts/work-inbox-check.mjs
// (#52).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { calendarWorkDay, localWorkDay, reminderResumeAt } from "./work-inbox";

describe("work inbox across daylight saving in Vienna", () => {
  it("runs in Vienna", () => {
    assert.equal(process.env.TZ, "Europe/Vienna");
    assert.equal(
      new Date("2026-10-09T22:30:00.000Z").getDate(),
      10,
      "The project's TZ must reach the Date implementation",
    );
  });

  it("local day boundaries and tomorrow-at-08:00 reminders across spring/fall daylight saving", () => {
    assert.equal(
      localWorkDay(new Date("2026-03-28T23:30:00.000Z")),
      "2026-03-29",
    );
    assert.equal(calendarWorkDay("2026-03-28", 1), "2026-03-29");
    assert.equal(calendarWorkDay("2026-10-24", 1), "2026-10-25");
    assert.equal(
      reminderResumeAt(new Date("2026-03-28T07:00:00.000Z")),
      "2026-03-29T06:00:00.000Z",
    );
    assert.equal(
      reminderResumeAt(new Date("2026-10-24T06:00:00.000Z")),
      "2026-10-25T07:00:00.000Z",
    );
    assert.equal(
      reminderResumeAt(new Date("2026-03-28T23:30:00.000Z")),
      "2026-03-30T06:00:00.000Z",
    );
  });
});
