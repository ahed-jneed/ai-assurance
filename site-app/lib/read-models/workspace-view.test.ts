// GET /api/workspace's read model against SQLite D1 and a counting R2 bucket
// (#16): the directory is decided in SQL without loading any engagement, only
// the selected engagement's parts are read, and one damaged engagement leaves
// the workspace usable for everyone else.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getEngagement, loadEngagement, save } from "../engagement-repo";
import { IntegrityError } from "../engagement-storage";
import {
  engagementWithParts,
  member,
  partsOf,
  practice,
  tenantId,
} from "../test-storage";
import { workspaceView } from "./workspace-view";

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

const lead = () => member("lead", "Lead Auditor"),
  auditor = () => member("auditor", "Auditor");
const three = () => [
  engagementWithParts("ENG-A", "Alpha audit"),
  engagementWithParts("ENG-B", "Beta audit"),
  engagementWithParts("ENG-C", "Gamma audit"),
];
const incidents = (sqlite: Awaited<ReturnType<typeof practice>>["sqlite"]) =>
  sqlite
    .prepare(
      "SELECT engagement_id,object_key,kind,status,occurrences FROM integrity_incidents ORDER BY engagement_id",
    )
    .all();

describe("workspaceView", () => {
  it("lists the engagements by grant and reads R2 for the selected one only", async () => {
    const { reads, objects } = await practice(three(), ["ENG-A", "ENG-C"]);
    const view = await workspaceView(auditor(), null);
    expect(view.engagements.map((e) => e.id)).toEqual(["ENG-A", "ENG-C"]);
    expect(view.engagements[0]).toEqual({
      id: "ENG-A",
      client_id: "CL-1",
      title: "Alpha audit",
      version: 1,
      stage: "Planning",
      due_date: expect.any(String),
    });
    expect(view.engagement?.id).toBe("ENG-A");
    expect(view.engagementError).toBeNull();
    // Every part of the selected engagement, each read once, and nothing else.
    expect([...reads].sort()).toEqual(partsOf(objects.keys(), "ENG-A").sort());
    expect(view.engagement?.reports[0].snapshot).toEqual({
      workflow: { captured: "ENG-A-open" },
    });
  });

  it("gives internal members the practice's report settings, clients none (#111)", async () => {
    const { sqlite } = await practice(three());
    // The migration's default: nothing set.
    expect((await workspaceView(lead(), null)).reportSettings).toEqual({
      signatory: "",
      location: "",
      qualityStatement: "",
    });
    sqlite
      .prepare("UPDATE tenants SET report_settings=? WHERE id=?")
      .run(
        JSON.stringify({ signatory: "Lea & Partners", location: "Vienna" }),
        tenantId,
      );
    expect((await workspaceView(auditor(), null)).reportSettings).toEqual({
      signatory: "Lea & Partners",
      location: "Vienna",
      qualityStatement: "",
    });
    expect(
      (await workspaceView(member("viewer", "Client Viewer", "CL-1"), null))
        .reportSettings,
    ).toBeNull();
  });

  it("selects a requested engagement and reads only its parts", async () => {
    const { reads, objects } = await practice(three());
    const view = await workspaceView(lead(), "ENG-B");
    expect(view.engagements).toHaveLength(3);
    expect(view.engagement?.id).toBe("ENG-B");
    expect([...reads].sort()).toEqual(partsOf(objects.keys(), "ENG-B").sort());
  });

  it("keeps the workspace usable when the selected engagement's blob is missing", async () => {
    const { objects, sqlite } = await practice(three());
    const [missing] = partsOf(objects.keys(), "ENG-B");
    objects.delete(missing);
    const view = await workspaceView(lead(), "ENG-B");
    expect(view.engagement).toBeNull();
    expect(view.engagementError).toEqual({
      engagementId: "ENG-B",
      error: expect.stringContaining(
        "An immutable audit record of this engagement is missing",
      ),
    });
    expect(view.engagements.map((e) => [e.id, !!e.integrity_error])).toEqual([
      ["ENG-A", false],
      ["ENG-B", true],
      ["ENG-C", false],
    ]);
    expect(incidents(sqlite)).toEqual([
      {
        engagement_id: "ENG-B",
        object_key: missing,
        kind: "missing",
        status: 503,
        occurrences: 1,
      },
    ]);
    // The other engagements still open, and the default selection is intact.
    expect((await workspaceView(lead(), "ENG-C")).engagement?.id).toBe("ENG-C");
    expect((await workspaceView(lead(), null)).engagement?.id).toBe("ENG-A");
    await workspaceView(lead(), "ENG-B");
    expect(incidents(sqlite)).toMatchObject([{ occurrences: 2 }]);
  });

  it("shows internal members the practice's quality review policy", async () => {
    const { sqlite } = await practice(three());
    expect((await workspaceView(lead(), null)).qualityReviewPolicy).toEqual({
      coolingOffDays: 730,
      practiceSet: false,
    });
    sqlite.prepare("UPDATE tenants SET eqr_cooling_off_days=365").run();
    expect((await workspaceView(auditor(), null)).qualityReviewPolicy).toEqual({
      coolingOffDays: 365,
      practiceSet: true,
    });
    expect(
      (await workspaceView(member("viewer", "Client Viewer", "CL-1"), null))
        .qualityReviewPolicy,
    ).toBeNull();
  });

  it("reports an altered blob as an integrity mismatch", async () => {
    const { objects } = await practice(three());
    const [altered] = partsOf(objects.keys(), "ENG-A");
    objects.set(altered, JSON.stringify({ forged: true }));
    const view = await workspaceView(lead(), "ENG-A");
    expect(view.engagement).toBeNull();
    expect(view.engagementError?.error).toContain(
      "Immutable audit record integrity mismatch",
    );
    expect(view.engagements).toHaveLength(3);
  });

  it("falls back past an engagement with a damaged R2 part when none is requested", async () => {
    const { objects, sqlite } = await practice(three());
    const [altered] = partsOf(objects.keys(), "ENG-A");
    objects.set(altered, JSON.stringify({ forged: true }));
    const view = await workspaceView(lead(), null);
    expect(view.engagement?.id).toBe("ENG-B");
    expect(view.engagementError).toBeNull();
    expect(view.engagements.map((e) => [e.id, !!e.integrity_error])).toEqual([
      ["ENG-A", true],
      ["ENG-B", false],
      ["ENG-C", false],
    ]);
    expect(incidents(sqlite)).toMatchObject([
      { engagement_id: "ENG-A", object_key: altered },
    ]);
  });

  it("gives up the default selection after three damaged engagements", async () => {
    const { objects, reads } = await practice([
      ...three(),
      engagementWithParts("ENG-D", "Zeta audit"),
    ]);
    for (const id of ["ENG-A", "ENG-B", "ENG-C"])
      objects.delete(partsOf(objects.keys(), id)[0]);
    const view = await workspaceView(lead(), null);
    expect(view.engagement).toBeNull();
    expect(view.engagementError?.engagementId).toBe("ENG-A");
    expect(reads.some((k) => k.includes("/ENG-D/"))).toBe(false);
  });

  it("treats a failing R2 read as temporarily unavailable for that engagement only", async () => {
    await practice(three());
    const bucket = env.BUCKET!;
    env.BUCKET = {
      get: async (key: string) => {
        if (key.includes("/ENG-A/")) throw new Error("R2 timeout");
        return bucket.get(key);
      },
    } as unknown as R2Bucket;
    const view = await workspaceView(lead(), "ENG-A");
    expect(view.engagementError?.error).toContain("temporarily unavailable");
    expect((await workspaceView(lead(), "ENG-B")).engagement?.id).toBe("ENG-B");
  });

  it("lists a record whose body is not JSON with an integrity error and opens the next one", async () => {
    const { sqlite, reads } = await practice(three());
    sqlite
      .prepare("UPDATE engagements SET body='{not json' WHERE id='ENG-A'")
      .run();
    const view = await workspaceView(lead(), null);
    expect(view.engagements[0]).toMatchObject({
      id: "ENG-A",
      stage: null,
      integrity_error: expect.stringContaining("unreadable"),
    });
    expect(view.engagement?.id).toBe("ENG-B");
    expect(reads.every((k) => k.includes("/ENG-B/"))).toBe(true);
    expect(incidents(sqlite)).toMatchObject([
      { engagement_id: "ENG-A", object_key: "body", kind: "unreadable" },
    ]);
    const opened = await workspaceView(lead(), "ENG-A");
    expect(opened.engagement).toBeNull();
    expect(opened.engagementError?.engagementId).toBe("ENG-A");
  });

  it("lists a client's engagements for a Client Viewer and live grants for a Client Contributor", async () => {
    const engagements = three(),
      expires = new Date(Date.now() + 86_400_000).toISOString();
    engagements[1].workflow!.clientGrants.push({
      id: "GR-1",
      userId: "contributor",
      requestId: "REQ-1",
      active: true,
      at: "2026-11-01T00:00:00.000Z",
      expiresAt: expires,
    } as never);
    engagements[2].workflow!.clientGrants.push({
      id: "GR-2",
      userId: "contributor",
      requestId: "REQ-2",
      active: true,
      at: "2026-11-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:00.000Z",
    } as never);
    await practice(engagements);
    const viewer = await workspaceView(
      member("viewer", "Client Viewer", "CL-1"),
      null,
    );
    expect(viewer.engagements.map((e) => e.id)).toEqual([
      "ENG-A",
      "ENG-B",
      "ENG-C",
    ]);
    const contributor = member("contributor", "Client Contributor", "CL-1");
    expect(
      (await workspaceView(contributor, null)).engagements.map((e) => e.id),
    ).toEqual(["ENG-B"]);
    // A grant issued before the contributor's current access began is void.
    expect(
      (
        await workspaceView(
          { ...contributor, accessSince: "2026-11-02T00:00:00.000Z" },
          null,
        )
      ).engagements,
    ).toEqual([]);
  });

  it("answers a Client Contributor 404 for an unreadable body and records nothing", async () => {
    const { sqlite } = await practice(three());
    sqlite
      .prepare("UPDATE engagements SET body='{not json' WHERE id='ENG-A'")
      .run();
    const contributor = member("contributor", "Client Contributor", "CL-1");
    await expect(loadEngagement(contributor, "ENG-A")).rejects.toMatchObject({
      status: 404,
    });
    const view = await workspaceView(contributor, "ENG-A").catch((e) => e);
    expect(view).toMatchObject({ status: 404 });
    expect(incidents(sqlite)).toEqual([]);
    // Internal members still see the integrity error.
    await expect(loadEngagement(lead(), "ENG-A")).rejects.toBeInstanceOf(
      IntegrityError,
    );
  });
});

describe("engagement loading", () => {
  it("reads each R2 part once per request, in parallel loads", async () => {
    const { reads, objects } = await practice(three());
    const ctx = lead();
    await Promise.all([
      getEngagement(ctx, "ENG-A"),
      getEngagement(ctx, "ENG-A"),
    ]);
    await getEngagement(ctx, "ENG-A");
    expect([...reads].sort()).toEqual(partsOf(objects.keys(), "ENG-A").sort());
    // Another request reads again.
    await getEngagement(lead(), "ENG-A");
    expect(reads).toHaveLength(2 * partsOf(objects.keys(), "ENG-A").length);
  });

  it("loads a record without its parts for access checks, and never saves it", async () => {
    const { reads } = await practice(three());
    const e = await loadEngagement(lead(), "ENG-A");
    expect(reads).toEqual([]);
    expect(e.reports[0].snapshot).toEqual({});
    await expect(save(lead(), e, e.version, "noop", {})).rejects.toThrow(
      "A partially loaded engagement cannot be saved",
    );
    const partial = await getEngagement(lead(), "ENG-A", { reports: true });
    expect(partial.reports[0].snapshot).toEqual({
      workflow: { captured: "ENG-A-open" },
    });
    expect(partial.papers[0].history).toEqual([]);
    await expect(
      save(lead(), partial, partial.version, "noop", {}),
    ).rejects.toThrow("A partially loaded engagement cannot be saved");
  });

  it("raises an IntegrityError naming the engagement and object", async () => {
    const { objects } = await practice(three());
    const [missing] = partsOf(objects.keys(), "ENG-C");
    objects.delete(missing);
    const error = await getEngagement(lead(), "ENG-C").catch((e) => e);
    expect(error).toBeInstanceOf(IntegrityError);
    expect(error).toMatchObject({
      engagementId: "ENG-C",
      kind: "missing",
      objectKey: missing,
      status: 503,
    });
    expect(missing.startsWith(tenantId + "/ENG-C/immutable/")).toBe(true);
  });
});
