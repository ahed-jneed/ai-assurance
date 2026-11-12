// GET /api/work-inbox against SQLite D1 and a counting R2 bucket (#16): work
// items read only the snapshots of final reports awaiting approval, and one
// damaged engagement is reported beside the queue instead of failing it.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { context } from "@/lib/tenancy";
import {
  engagementWithParts,
  member,
  partsOf,
  practice,
} from "@/lib/test-storage";
import { GET } from "./route";

vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));
afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

type Inbox = {
  items: { engagementId: string; kind: string; recordId: string }[];
  integrityErrors: { engagementId: string; engagement: string }[];
  loadedEngagements: number;
};
async function inbox() {
  vi.mocked(context).mockResolvedValue(member("lead", "Lead Auditor"));
  const response = await GET(
    new Request("https://workspace.test/api/work-inbox?tenantId=tenant-1"),
  );
  return { status: response.status, body: (await response.json()) as Inbox };
}
const engagements = () => [
  engagementWithParts("ENG-A", "Alpha audit"),
  engagementWithParts("ENG-B", "Beta audit"),
];

describe("GET /api/work-inbox", () => {
  it("reads only the snapshots of final reports awaiting approval", async () => {
    const { reads, objects } = await practice(engagements());
    const { status, body } = await inbox();
    expect(status).toBe(200);
    expect(body.loadedEngagements).toBe(2);
    expect(body.integrityErrors).toEqual([]);
    expect(
      body.items.filter((i) => i.kind === "report").map((i) => i.recordId),
    ).toEqual(["ENG-A-open", "ENG-B-open"]);
    // One snapshot per engagement: no released report, history or results.
    expect(reads).toHaveLength(2);
    for (const id of ["ENG-A", "ENG-B"])
      expect(reads.filter((k) => k.includes("/" + id + "/"))).toHaveLength(1);
    expect(partsOf(objects.keys(), "ENG-A").length).toBeGreaterThan(1);
  });

  it("keeps the queue when one engagement's blob is missing and names it", async () => {
    const { objects, reads, sqlite } = await practice(engagements());
    await inbox();
    const [snapshot] = reads.filter((k) => k.includes("/ENG-A/"));
    objects.delete(snapshot);
    const { status, body } = await inbox();
    expect(status).toBe(200);
    expect(new Set(body.items.map((i) => i.engagementId))).toEqual(
      new Set(["ENG-B"]),
    );
    expect(body.integrityErrors).toEqual([
      {
        engagementId: "ENG-A",
        engagement: "Alpha audit",
        client: "Client",
        error: expect.stringContaining("missing"),
      },
    ]);
    expect(
      sqlite
        .prepare("SELECT engagement_id,kind FROM integrity_incidents")
        .all(),
    ).toEqual([{ engagement_id: "ENG-A", kind: "missing" }]);
  });

  it("lists the classification work the server derives (#104)", async () => {
    const [legacy, stale] = engagements();
    // A pre-#19 approval (four flags, no model): it loads migrated.
    legacy.classification = {
      ...legacy.classification,
      model: undefined,
      answers: undefined,
      status: "approved",
      approvedBy: "reviewer",
    };
    // An approval under an earlier rule pack: the re-review is due.
    stale.classification = {
      ...stale.classification,
      status: "approved",
      approvedBy: "reviewer",
      rulePackVersion: "2026.10.1",
    };
    await practice([legacy, stale]);
    const { status, body } = await inbox();
    expect(status).toBe(200);
    expect(
      body.items
        .filter((i) => i.kind === "classification")
        .map((i) => [i.engagementId, (i as { action?: string }).action]),
    ).toEqual([
      ["ENG-A", "Reclassify the system"],
      ["ENG-B", "Re-review classification"],
    ]);
  });

  it("keeps an engagement whose rule-pack stamp has no criteria pack, without classification work", async () => {
    const [legacy, unknown] = engagements();
    legacy.classification = {
      ...legacy.classification,
      model: undefined,
      answers: undefined,
      status: "approved",
      approvedBy: "reviewer",
    };
    unknown.classification = legacy.classification;
    const { sqlite } = await practice([legacy, unknown]);
    sqlite
      .prepare(
        `UPDATE engagements SET body=json_set(json_remove(body,'$.criteria'),'$.rulePack',json('{"version":"2026.12.9","legalVersion":"x","researchedAsOf":"2026-12-01","legalReview":"pending"}')) WHERE id='ENG-B'`,
      )
      .run();
    const { status, body } = await inbox();
    expect(status).toBe(200);
    expect(
      body.items
        .filter((i) => i.kind === "classification")
        .map((i) => i.engagementId),
    ).toEqual(["ENG-A"]);
    expect(body.items.some((i) => i.engagementId === "ENG-B")).toBe(true);
  });

  it("keeps the queue when one engagement's body is not JSON", async () => {
    const { sqlite } = await practice(engagements());
    sqlite.prepare("UPDATE engagements SET body='[' WHERE id='ENG-B'").run();
    const { status, body } = await inbox();
    expect(status).toBe(200);
    expect(new Set(body.items.map((i) => i.engagementId))).toEqual(
      new Set(["ENG-A"]),
    );
    expect(body.integrityErrors).toMatchObject([
      { engagementId: "ENG-B", error: expect.stringContaining("unreadable") },
    ]);
  });
});
