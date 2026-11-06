import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { save } from "@/lib/engagement-repo";
import { ApiError } from "@/lib/http";
import { seedWorkflow } from "@/lib/workflow-seed";
import { caller, fakeD1, stored } from "./commands/test-fixtures";

// The central write guards of save() (F-56) and the hourly save quota, which
// all refuse before anything is written.
function contributorEngagement(grantAt: string) {
  const e = stored();
  e.workflow = seedWorkflow("user-lead", "2026-11-01T00:00:00.000Z");
  e.workflow.clientGrants.push({
    id: "GRANT-1",
    userId: "user-lead",
    requestId: "REQ-1",
    prompt: "Upload",
    instructions: "Upload",
    category: "Other",
    handlingBasis: "synthetic",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    active: true,
    actor: "user-admin",
    at: grantAt,
  });
  return e;
}
const refusal = (error: unknown) =>
  error instanceof ApiError ? [error.status, error.message] : error;

afterEach(() => {
  delete env.DB;
  delete env.TENANT_MAX_SAVES_PER_HOUR;
});

describe("save", () => {
  it("refuses a Client Viewer before touching storage", async () => {
    const d1 = fakeD1(() => {
      throw new Error("no query expected");
    });
    env.DB = d1.db;
    const outcome = await save(
      caller("Client Viewer"),
      stored(),
      3,
      "renameEngagement",
      {},
    ).catch(refusal);
    expect(outcome).toEqual([403, "Client Viewers have read-only access"]);
    expect(d1.batches).toEqual([]);
  });

  it("lets a Client Contributor write only under a live grant of the current membership", async () => {
    const d1 = fakeD1(() => ({ n: 0 }));
    env.DB = d1.db;
    const contributor = {
      ...caller("Client Contributor"),
      clientId: "CL-1",
      accessSince: "2026-11-05T00:00:00.000Z",
    };
    const denied = [403, "Request access expired or was revoked"];
    // No grant named, a grant of another request, a grant issued before the
    // membership was last granted (revoked and re-granted since).
    for (const [e, details] of [
      [contributorEngagement("2026-11-05T10:00:00.000Z"), {}],
      [
        contributorEngagement("2026-11-05T10:00:00.000Z"),
        { grantId: "GRANT-1", requestId: "REQ-2" },
      ],
      [
        contributorEngagement("2026-11-04T10:00:00.000Z"),
        { grantId: "GRANT-1", requestId: "REQ-1" },
      ],
    ] as const)
      expect(
        await save(contributor, e, 3, "clientReply", { ...details }).catch(
          refusal,
        ),
      ).toEqual(denied);
    expect(d1.batches).toEqual([]);
    await save(
      contributor,
      contributorEngagement("2026-11-05T10:00:00.000Z"),
      3,
      "clientReply",
      { grantId: "GRANT-1", requestId: "REQ-1" },
    );
    expect(d1.batches).toHaveLength(1);
    // The stored grant is checked against the membership's access_since too.
    expect(d1.batches[0][0].sql).toContain(
      "json_extract(g.value,'$.at')>=COALESCE((SELECT access_since FROM memberships",
    );
  });

  it("refuses a save over the practice's hourly quota", async () => {
    env.TENANT_MAX_SAVES_PER_HOUR = "5";
    const d1 = fakeD1((sql) =>
      sql.startsWith("SELECT COUNT(*) AS n FROM engagement_snapshots")
        ? { n: 5 }
        : null,
    );
    env.DB = d1.db;
    const outcome = await save(
      caller(),
      stored(),
      3,
      "renameEngagement",
      {},
    ).catch(refusal);
    expect(outcome).toEqual([
      429,
      "This practice has saved 5 engagement versions in the last hour, its hourly limit. Nothing was saved. Try again later.",
    ]);
    expect(d1.batches).toEqual([]);
  });
});
