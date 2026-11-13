// The work queue's default dates come from the local calendar, not UTC.
// vitest.config.ts runs *.local-calendar.test.ts files in their own project
// with TZ=Europe/Vienna; at 22:30 UTC on 9 October it is already 10 October
// there. Ported from the --local-calendar mode of scripts/work-items-check.mjs
// (#52).
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { engagementWork, orderWork, procedureWork } from "./work-items";
import { fixture } from "./work-items.test-fixture";

const fixed = new Date("2026-10-09T22:30:00.000Z").getTime();

describe("local calendar defaults near UTC midnight", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixed);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("runs in Vienna while UTC is still on the previous day", () => {
    assert.equal(process.env.TZ, "Europe/Vienna");
    assert.equal(new Date().toISOString().slice(0, 10), "2026-10-09");
    assert.equal(
      new Date().getDate(),
      10,
      "The project's TZ must reach the Date implementation",
    );
  });

  it("local calendar defaults near UTC midnight and deterministic date injection", () => {
    assert.equal(
      procedureWork(fixture(), "procedure")!.overdue,
      true,
      "Vienna has reached October 10 even while UTC is October 9",
    );
    const items = [
      {
        id: "urgent-today",
        title: "Today",
        dueDate: "2026-10-10",
        priority: 0,
      },
      { id: "overdue", title: "Yesterday", dueDate: "2026-10-09", priority: 3 },
    ];
    assert.equal(
      orderWork(items as Parameters<typeof orderWork>[0])[0].id,
      "overdue",
      "Default ordering uses the same local date as deadline labels",
    );
    assert.equal(
      engagementWork(fixture(), "Reviewer", "reviewer")[0].priority,
      0,
      "Procedure priority uses the injected local calendar",
    );
  });
});
