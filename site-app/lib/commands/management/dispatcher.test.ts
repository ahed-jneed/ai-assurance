import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/management/route";
import {
  dispatchManagement,
  managementModules,
  managementOps,
} from "@/lib/commands/management";
import { roles, type Role } from "@/lib/domain";
import { getEngagement } from "@/lib/engagement-repo";
import { ApiError } from "@/lib/http";
import { context, type Context } from "@/lib/tenancy";
import {
  caller,
  fakeD1,
  postRequest,
  stored,
  type FakeStatement,
} from "../test-fixtures";

// Identity and engagement access are faked per test; D1 is a fake binding.
vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));
vi.mock("@/lib/engagement-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/engagement-repo")>()),
  getEngagement: vi.fn(),
}));

// The ops of the old envelope enum, in its order.
const ops = [
  "createClient",
  "updateClient",
  "createEngagement",
  "grantMember",
  "updateMember",
  "revokeMember",
];
// Valid data for each op, against a practice where CL-1 and user-2 exist.
const valid: Record<string, Record<string, unknown>> = {
  createClient: { name: "Acme Lending", sector: "Financial services" },
  updateClient: { clientId: "CL-1", name: "Acme", sector: "Insurance" },
  createEngagement: { clientId: "CL-1", title: "Credit model audit" },
  grantMember: { userId: "user-2", displayName: "Ada", role: "Auditor" },
  updateMember: { userId: "user-2", displayName: "Ada", role: "Reviewer" },
  revokeMember: { userId: "user-2" },
};
function practice(changes = 1) {
  const d1 = fakeD1((sql) => {
    if (sql.startsWith("SELECT id FROM clients")) return { id: "CL-1" };
    if (sql.startsWith("SELECT user_id,status FROM memberships"))
      return { user_id: "user-2", status: "active" };
    return null;
  }, changes);
  env.DB = d1.db;
  return d1;
}
function signIn(ctx: Context) {
  vi.mocked(context).mockResolvedValue(ctx);
}
function post(op: string, data: Record<string, unknown>, expectedVersion = 7) {
  return POST(
    postRequest("/api/management", {
      tenantId: "tenant-1",
      expectedVersion,
      op,
      data,
    }),
  );
}
const tables = (batch: FakeStatement[]) =>
  batch.map((s) => s.sql.match(/^(?:UPDATE|INSERT INTO) (\w+)/)?.[1]);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  delete env.DB;
});

describe("POST /api/management", () => {
  it.each(["archiveEverything", "toString", "renameEngagement", "setAccess"])(
    "rejects the unknown op %s with 400 before resolving the caller",
    async (op) => {
      const d1 = practice();
      const response = await post(op, {});
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error:
          "Invalid enum value. Expected 'createClient' | 'updateClient' | 'createEngagement' | 'grantMember' | 'updateMember' | 'revokeMember', received '" +
          op +
          "'",
      });
      expect(context).not.toHaveBeenCalled();
      expect(d1.batches).toEqual([]);
    },
  );

  it.each(ops)(
    "refuses %s with 403 to every role without practice administration",
    async (op) => {
      const d1 = practice();
      for (const role of roles) {
        signIn(caller(role, false));
        const response = await post(op, valid[op]);
        expect(response.status, role).toBe(403);
        expect(await response.json(), role).toEqual({
          error: "Practice administration permission is required",
        });
      }
      expect(d1.batches).toEqual([]);
    },
  );

  it.each(ops)(
    "commits %s with the version bump and the management event",
    async (op) => {
      const d1 = practice();
      const ctx = caller();
      signIn(ctx);
      const response = await post(op, valid[op]);
      expect(response.status).toBe(200);
      const reply = (await response.json()) as {
        details: Record<string, unknown>;
        managementVersion: number;
      };
      expect(reply.managementVersion).toBe(8);
      expect(d1.batches).toHaveLength(1);
      const [batch] = d1.batches;
      const [bump] = batch,
        event = batch.at(-1)!;
      expect(bump.sql).toMatch(/^UPDATE tenants SET version=version\+1/);
      expect(bump.args).toEqual([
        expect.stringMatching(/^MGMT-/),
        "tenant-1",
        7,
        "tenant-1",
        "user-lead",
      ]);
      expect(event.sql).toMatch(/^INSERT INTO management_events/);
      expect(event.args.slice(0, 5)).toEqual([
        "tenant-1",
        expect.stringMatching(/^ME-/),
        "user-lead",
        op,
        JSON.stringify(reply.details),
      ]);
      // Every statement of the op is guarded by this command's id.
      for (const statement of batch.slice(1))
        expect(statement.args.at(-1), statement.sql).toBe(bump.args[0]);
      expect(tables(batch.slice(1, -1))).toEqual(
        {
          createClient: ["clients"],
          updateClient: ["clients"],
          createEngagement: [
            "engagements",
            "engagement_snapshots",
            "engagement_access_policies",
            "engagement_access",
          ],
          grantMember: ["memberships"],
          updateMember: ["memberships"],
          revokeMember: ["memberships"],
        }[op],
      );
    },
  );

  it("answers a stale management version with 409", async () => {
    practice(0);
    signIn(caller());
    const response = await post("createClient", valid.createClient);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Client or access settings changed. Reload before saving.",
    });
  });

  it("answers invalid data with the zod messages and no paths", async () => {
    const d1 = practice();
    signIn(caller());
    const response = await post("createClient", { name: "Acme" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Required" });
    expect(d1.batches).toEqual([]);
  });

  it("lets only a Lead Auditor grant engagement access with a membership", async () => {
    const grant = { ...valid.grantMember, engagementIds: ["ENG-1"] };
    for (const role of roles.filter((r) => r !== "Lead Auditor")) {
      const d1 = practice();
      signIn(caller(role));
      const response = await post("grantMember", grant);
      expect(response.status, role).toBe(403);
      expect(await response.json(), role).toEqual({
        error: "Only a Lead Auditor may assign internal engagement access",
      });
      expect(d1.batches, role).toEqual([]);
    }
    const d1 = practice();
    const ctx = caller();
    signIn(ctx);
    vi.mocked(getEngagement).mockResolvedValue(stored());
    const response = await post("grantMember", grant);
    expect(response.status).toBe(200);
    expect(getEngagement).toHaveBeenCalledWith(ctx, "ENG-1");
    expect(tables(d1.batches[0].slice(1, -1))).toEqual([
      "memberships",
      "engagement_access",
    ]);
  });
});

describe("management command registry", () => {
  it("lists each accepted op in exactly one module, in the envelope's order", () => {
    const listed = managementModules.flatMap((m) => m.ops);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(ops);
    expect(managementOps).toEqual(ops);
  });

  it("rejects an op no module lists", async () => {
    const outcome = await dispatchManagement(
      { commandId: "MGMT-1", timestamp: "", guard: "", statements: [] },
      "archiveEverything",
      {},
      caller(),
    ).catch((error: unknown) => error);
    expect(outcome).toEqual(new ApiError(400, "Unknown management action"));
  });

  // Practice administration, checked by the route for every op, authorizes
  // management, so no op refuses a role at dispatch.
  it.each(ops)("admits every role to %s at dispatch", async (op) => {
    for (const role of roles as Role[]) {
      const outcome = await dispatchManagement(
        { commandId: "MGMT-1", timestamp: "", guard: "", statements: [] },
        op,
        {},
        caller(role),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(outcome instanceof ApiError && outcome.status === 403, role).toBe(
        false,
      );
    }
  });
});
