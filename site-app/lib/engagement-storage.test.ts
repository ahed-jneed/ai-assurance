import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getEngagement } from "./engagement-repo";
import { dehydrate } from "./engagement-storage";
import { engagementWithParts, member, partsOf, practice } from "./test-storage";

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

// dehydrate() puts only the parts R2 does not already hold for this request:
// parts are content-addressed, so a part read back intact (or written) in the
// same request is skipped on the save that follows.
describe("dehydrate", () => {
  it("re-puts no part that was loaded unchanged in the same request", async () => {
    const { writes } = await practice([engagementWithParts("ENG-A", "A")]),
      ctx = member("lead", "Lead Auditor"),
      e = await getEngagement(ctx, "ENG-A");
    const stored = await dehydrate(ctx, e);
    expect(writes).toEqual([]);
    // A fresh request that did not read the parts still writes each one.
    const fresh = member("lead", "Lead Auditor"),
      again = await dehydrate(fresh, e);
    // Two report snapshots, one client snapshot, a paper history, run results.
    expect(writes).toHaveLength(5);
    expect(partsOf(writes, "ENG-A")).toHaveLength(5);
    // Skipping a write never changes what is stored.
    expect(again).toEqual(stored);
  });

  it("puts only the parts that changed, once each", async () => {
    const { writes, objects } = await practice([
        engagementWithParts("ENG-A", "A"),
      ]),
      ctx = member("lead", "Lead Auditor"),
      e = await getEngagement(ctx, "ENG-A");
    e.papers[0].history = [
      ...e.papers[0].history,
      { revision: 1, at: "2026-11-02T00:00:00.000Z" },
    ] as (typeof e.papers)[0]["history"];
    await dehydrate(ctx, e);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("/immutable/paper-history/");
    expect(objects.get(writes[0])).toBe(JSON.stringify(e.papers[0].history));
    // A second save in the same request finds the new part already written.
    await dehydrate(ctx, e);
    expect(writes).toHaveLength(1);
  });

  it("writes identical parts of one engagement once", async () => {
    const { writes } = await practice([]),
      e = engagementWithParts("ENG-B", "B");
    e.runs.push({ ...e.runs[0], id: "ENG-B-run-2" });
    await dehydrate(member("lead", "Lead Auditor"), e);
    // The two runs share one results object.
    expect(writes.filter((k) => k.includes("/results/"))).toHaveLength(1);
    expect(writes).toHaveLength(5);
  });
});
