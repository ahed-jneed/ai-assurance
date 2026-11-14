import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/management/route";
import {
  dispatchManagement,
  managementModules,
  managementOps,
} from "@/lib/commands/management";
import { roles, type Role } from "@/lib/domain/types";
import { loadEngagement } from "@/lib/engagement-repo";
import { ApiError } from "@/lib/http";
import { context, type Context } from "@/lib/tenancy";
import { at, declaration } from "@/lib/workflow/test-fixtures";
import { resolveNew } from "@/lib/criteria/pin";
import { seedWorkflow } from "@/lib/workflow-seed";
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
  loadEngagement: vi.fn(),
}));

// Every op, in module order (the envelope enum's order).
const ops = [
  "createClient",
  "updateClient",
  "createEngagement",
  "grantMember",
  "updateMember",
  "revokeMember",
  "grantAdmin",
  "revokeAdmin",
  "transferAdmin",
  "inviteMember",
  "cancelInvitation",
  "renamePractice",
  "setQualityReviewPolicy",
  "setReportSettings",
  "rotateSigningKey",
  "handleIntegrityIncident",
];
// Valid data for each op, against the practice below.
const valid: Record<string, Record<string, unknown>> = {
  createClient: { name: "Acme Lending", sector: "Financial services" },
  updateClient: { clientId: "CL-1", name: "Acme", sector: "Insurance" },
  createEngagement: { clientId: "CL-1", title: "Credit model audit" },
  grantMember: { userId: "user-new", displayName: "Nia", role: "Auditor" },
  updateMember: { userId: "user-2", displayName: "Ada L.", role: "Auditor" },
  revokeMember: { userId: "user-2" },
  grantAdmin: { userId: "user-2" },
  revokeAdmin: { userId: "user-4" },
  transferAdmin: { userId: "user-2" },
  inviteMember: { email: "Nia@Example.test", role: "Auditor" },
  cancelInvitation: { invitationId: "INV-1" },
  renamePractice: { name: "Lea & Partners" },
  setQualityReviewPolicy: { coolingOffDays: 365, reason: "Firm policy review" },
  setReportSettings: { signatory: "Lea & Partners", location: "Vienna" },
  rotateSigningKey: { reason: "Scheduled annual rotation" },
  handleIntegrityIncident: {
    engagementId: "ENG-1",
    objectKey: "tenant-1/ENG-1/immutable/report/abc",
    kind: "missing",
    handling: "acknowledged",
  },
};
// The members of the fixture practice besides the caller (user-lead).
const people: Record<string, Record<string, unknown>> = {
  "user-2": { role: "Auditor", status: "active", client_id: null, admin: 0 },
  "user-4": {
    role: "Lead Auditor",
    status: "active",
    client_id: null,
    admin: 1,
  },
  "user-5": { role: "Auditor", status: "revoked", client_id: null, admin: 0 },
  "user-4e": {
    role: "Auditor",
    status: "active",
    client_id: null,
    admin: 0,
    email: "eve@example.test",
  },
  "user-q": {
    role: "Engagement Quality Reviewer",
    status: "active",
    client_id: null,
    admin: 0,
  },
  "user-v": {
    role: "Client Viewer",
    status: "active",
    client_id: "CL-1",
    admin: 0,
  },
};
function practice(
  changes = 1,
  {
    otherAdmins = 1,
    engagements = 0,
    grants = [] as string[],
    workers = [] as string[],
    pendingInvitations = [] as string[],
    incidentHandling = "open",
  } = {},
) {
  const d1 = fakeD1((sql, args) => {
    if (sql.startsWith("SELECT id FROM clients")) return { id: "CL-1" };
    if (
      sql.includes("FROM memberships m WHERE m.tenant_id=? AND m.user_id=?")
    ) {
      const p = people[String(args[1])];
      return p && { ...p, practice_admin: p.admin };
    }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM practice_admins"))
      return { n: otherAdmins };
    if (sql.startsWith("SELECT COUNT(*) AS n FROM engagements"))
      return { n: engagements };
    if (sql.startsWith("SELECT email FROM invitations"))
      return args[1] === "INV-1" ? { email: "nia@example.test" } : null;
    if (sql.startsWith("SELECT engagement_id FROM engagement_access"))
      return grants.map((engagement_id) => ({ engagement_id }));
    if (sql.startsWith("SELECT id FROM runner_workers"))
      return workers.map((id) => ({ id }));
    if (
      sql.startsWith("SELECT id FROM invitations WHERE tenant_id=? AND email")
    )
      return pendingInvitations.map((id) => ({ id }));
    if (sql.startsWith("SELECT handling FROM integrity_incidents"))
      return args[1] === "ENG-1" ? { handling: incidentHandling } : null;
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
async function refusal(response: Response) {
  return { status: response.status, ...((await response.json()) as object) };
}
const reply = async (response: Response) =>
  (await response.json()) as { details?: unknown; error?: string };
const tables = (batch: FakeStatement[]) =>
  batch.map((s) => s.sql.match(/^(?:UPDATE|INSERT INTO) (\w+)/)?.[1]);
/** The op's own statements: the batch without the bump and the event. */
const own = (d1: ReturnType<typeof practice>) => d1.batches[0].slice(1, -1);

beforeEach(() => {
  vi.resetAllMocks();
  // A generated test key-encryption key for rotateSigningKey.
  env.DOSSIER_KEK = Buffer.alloc(32, 9).toString("base64");
});
afterEach(() => {
  delete env.DB;
  delete env.DOSSIER_KEK;
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
          "Invalid enum value. Expected " +
          ops.map((o) => "'" + o + "'").join(" | ") +
          ", received '" +
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
          error:
            role === "Client Viewer"
              ? "Client Viewers have read-only access"
              : "Practice administration permission is required",
        });
      }
      expect(d1.batches).toEqual([]);
    },
  );

  // F-56: even a Client Viewer recorded as an administrator only reads.
  it.each(ops)("refuses %s with 403 to a Client Viewer", async (op) => {
    const d1 = practice();
    signIn(caller("Client Viewer", true));
    expect(await refusal(await post(op, valid[op]))).toEqual({
      status: 403,
      error: "Client Viewers have read-only access",
    });
    expect(d1.batches).toEqual([]);
  });

  it.each(ops)(
    "commits %s with the version bump and the management event",
    async (op) => {
      const d1 = practice();
      const ctx = caller();
      signIn(ctx);
      const response = await post(op, valid[op]);
      expect(
        response.status,
        JSON.stringify(await response.clone().json()),
      ).toBe(200);
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
          revokeMember: [
            "memberships",
            "engagement_access",
            "runner_workers",
            "practice_admins",
          ],
          grantAdmin: ["practice_admins"],
          revokeAdmin: ["practice_admins"],
          transferAdmin: ["practice_admins", "practice_admins"],
          inviteMember: ["invitations"],
          cancelInvitation: ["invitations"],
          renamePractice: ["tenants"],
          setQualityReviewPolicy: ["tenants"],
          setReportSettings: ["tenants"],
          rotateSigningKey: ["dossier_keys", "dossier_keys"],
          handleIntegrityIncident: ["integrity_incidents"],
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
    for (const role of roles.filter(
      (r) => r !== "Lead Auditor" && r !== "Client Viewer",
    )) {
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
    vi.mocked(loadEngagement).mockResolvedValue(stored());
    const response = await post("grantMember", grant);
    expect(response.status).toBe(200);
    expect(loadEngagement).toHaveBeenCalledWith(ctx, "ENG-1");
    expect(tables(own(d1))).toEqual(["memberships", "engagement_access"]);
  });

  it("refuses engagement access to a member with a declared conflict (#112)", async () => {
    const e = stored();
    e.title = "Credit model audit";
    e.workflow = {
      ...seedWorkflow(resolveNew(), "user-lead", at),
      declarations: [
        declaration("auditor", {
          userId: "user-2",
          exclusions: ["financial_interest"],
        }),
      ],
    };
    vi.mocked(loadEngagement).mockResolvedValue(e);
    signIn(caller());
    for (const op of ["updateMember", "grantMember"]) {
      const d1 = practice();
      const response = await post(op, {
        userId: "user-2",
        displayName: "Ada",
        role: "Reviewer",
        engagementIds: ["ENG-1"],
      });
      expect(await refusal(response), op).toEqual({
        status: 409,
        error:
          "This person declared a disqualifying relationship with the engagement and cannot be assigned (Credit model audit)",
      });
      expect(d1.batches, op).toEqual([]);
    }
    // Another member, and the same member without that engagement, pass.
    practice();
    expect(
      (
        await post("grantMember", {
          ...valid.grantMember,
          engagementIds: ["ENG-1"],
        })
      ).status,
    ).toBe(200);
    practice();
    expect(
      (
        await post("updateMember", {
          userId: "user-2",
          displayName: "Ada",
          role: "Reviewer",
          engagementIds: [],
        })
      ).status,
    ).toBe(200);
  });
});

describe("access lifecycle (F-24)", () => {
  it("withdraws grants, sponsored workers and administration on revoke", async () => {
    const d1 = practice(1, { grants: ["ENG-1", "ENG-2"], workers: ["W-1"] });
    signIn(caller());
    const response = await post("revokeMember", { userId: "user-2" });
    expect(response.status).toBe(200);
    expect((await reply(response)).details).toEqual({
      userId: "user-2",
      status: "revoked",
      withdrawn: { engagementIds: ["ENG-1", "ENG-2"], workerIds: ["W-1"] },
      practiceAdminRemoved: false,
      cancelledInvitations: [],
    });
    const [membership, access, workers, admin] = own(d1);
    expect(membership.sql).toMatch(
      /^UPDATE memberships SET status=\?,access_since=\?/,
    );
    expect(membership.args.slice(0, 1)).toEqual(["revoked"]);
    expect(access.sql).toMatch(
      /^UPDATE engagement_access SET active=0,actor=\?,updated_at=\? WHERE tenant_id=\? AND user_id=\? AND active=1/,
    );
    expect(access.args.slice(2, 4)).toEqual(["tenant-1", "user-2"]);
    expect(workers.sql).toMatch(
      /^UPDATE runner_workers SET active=0 WHERE tenant_id=\? AND created_by=\?/,
    );
    expect(workers.args.slice(0, 2)).toEqual(["tenant-1", "user-2"]);
    expect(admin.sql).toMatch(/^UPDATE practice_admins SET active=0/);
  });

  it("cancels the pending invitations for a revoked member's recorded email (#95)", async () => {
    const d1 = practice(1, { pendingInvitations: ["INV-A", "INV-B"] });
    signIn(caller());
    const response = await post("revokeMember", { userId: "user-4e" });
    expect(response.status).toBe(200);
    expect((await reply(response)).details).toMatchObject({
      userId: "user-4e",
      status: "revoked",
      cancelledInvitations: ["INV-A", "INV-B"],
    });
    const cancel = own(d1).find((s) => s.sql.startsWith("UPDATE invitations"));
    expect(cancel?.sql).toMatch(
      /^UPDATE invitations SET status='cancelled',closed_at=\? WHERE tenant_id=\? AND email=\? AND status='pending' AND EXISTS/,
    );
    expect(cancel?.args.slice(1, 3)).toEqual(["tenant-1", "eve@example.test"]);
    // Without a recorded email nothing is cancelled.
    const plain = practice(1, { pendingInvitations: ["INV-A"] });
    await post("revokeMember", { userId: "user-2" });
    expect(tables(own(plain))).not.toContain("invitations");
  });

  it("refuses to revoke access that is already revoked", async () => {
    practice();
    signIn(caller());
    expect(
      await refusal(await post("revokeMember", { userId: "user-5" })),
    ).toEqual({
      status: 409,
      error: "This member's access is already revoked",
    });
  });

  it("requires a re-grant to list its engagements and restores nothing else", async () => {
    let d1 = practice();
    signIn(caller());
    const restore = {
      userId: "user-5",
      displayName: "Former",
      role: "Auditor",
    };
    expect(await refusal(await post("grantMember", restore))).toEqual({
      status: 400,
      error:
        "List the engagements to grant again; earlier grants are not restored",
    });
    expect(d1.batches).toEqual([]);
    d1 = practice(1, { grants: ["ENG-OLD"], workers: ["W-OLD"] });
    vi.mocked(loadEngagement).mockResolvedValue(stored());
    const response = await post("grantMember", {
      ...restore,
      engagementIds: ["ENG-1"],
    });
    expect(response.status).toBe(200);
    expect((await reply(response)).details).toMatchObject({
      engagementIds: ["ENG-1"],
      withdrawn: { engagementIds: ["ENG-OLD"], workerIds: ["W-OLD"] },
    });
    expect(tables(own(d1))).toEqual([
      "engagement_access",
      "runner_workers",
      "memberships",
      "engagement_access",
    ]);
    const [, , membership, grant] = own(d1);
    // A fresh grant: client request grants issued before it lapse.
    expect(membership.sql).toContain("access_since=excluded.access_since");
    expect(grant.args.slice(0, 3)).toEqual(["tenant-1", "ENG-1", "user-5"]);
  });

  it("withdraws every grant on a role change and grants only those listed", async () => {
    practice();
    signIn(caller());
    expect(
      await refusal(
        await post("updateMember", {
          userId: "user-2",
          displayName: "Ada",
          role: "Reviewer",
        }),
      ),
    ).toEqual({
      status: 400,
      error:
        "List the engagements this member keeps with the new role; earlier grants are withdrawn",
    });
    const d1 = practice();
    const response = await post("updateMember", {
      userId: "user-2",
      displayName: "Ada",
      role: "Reviewer",
      engagementIds: [],
    });
    expect(response.status).toBe(200);
    expect(tables(own(d1))).toEqual([
      "engagement_access",
      "runner_workers",
      "memberships",
    ]);
    expect(own(d1)[2].sql).toMatch(/access_since=\?/);
  });

  it("grants and changes to the Engagement Quality Reviewer role like any internal role (#24)", async () => {
    const d1 = practice();
    signIn(caller());
    vi.mocked(loadEngagement).mockResolvedValue(stored());
    const response = await post("updateMember", {
      userId: "user-2",
      displayName: "Ada",
      role: "Engagement Quality Reviewer",
      engagementIds: ["ENG-1"],
    });
    expect(response.status).toBe(200);
    expect((await reply(response)).details).toMatchObject({
      role: "Engagement Quality Reviewer",
      engagementIds: ["ENG-1"],
      withdrawn: { engagementIds: [], workerIds: [] },
    });
    // The role change withdraws earlier grants, grants the one listed and is
    // recorded as a management event in the same batch.
    expect(tables(own(d1))).toEqual([
      "engagement_access",
      "runner_workers",
      "memberships",
      "engagement_access",
    ]);
    expect(d1.batches[0].at(-1)!.sql).toMatch(/management_events/);
    const invite = practice();
    expect(
      (
        await post("inviteMember", {
          email: "eqr@example.test",
          role: "Engagement Quality Reviewer",
          engagementIds: ["ENG-1"],
        })
      ).status,
    ).toBe(200);
    expect(tables(own(invite))).toEqual(["invitations"]);
  });

  it("keeps grants when only the name changes", async () => {
    const d1 = practice();
    signIn(caller());
    await post("updateMember", valid.updateMember);
    expect(tables(own(d1))).toEqual(["memberships"]);
    expect(own(d1)[0].sql).toContain("access_since=access_since");
  });

  it("keeps an administrator out of client roles", async () => {
    practice();
    signIn(caller());
    expect(
      await refusal(
        await post("updateMember", {
          userId: "user-4",
          displayName: "Lee",
          role: "Client Viewer",
          clientId: "CL-1",
        }),
      ),
    ).toEqual({
      status: 409,
      error:
        "Remove practice administration before giving this member a client role",
    });
  });
});

describe("practice administration (F-43)", () => {
  it("keeps at least one active administrator", async () => {
    const d1 = practice(1, { otherAdmins: 0 });
    signIn(caller());
    expect(
      await refusal(await post("revokeAdmin", { userId: "user-lead" })),
    ).toEqual({
      status: 404,
      error: "This member does not administer the practice",
    });
    expect(
      await refusal(await post("revokeAdmin", { userId: "user-4" })),
    ).toEqual({
      status: 409,
      error:
        "A practice needs at least one active administrator. Grant or transfer administration first.",
    });
    expect(d1.batches).toEqual([]);
  });

  it("guards the revocation in SQL as well", async () => {
    const d1 = practice();
    signIn(caller());
    await post("revokeAdmin", { userId: "user-4" });
    expect(own(d1)[0].sql).toContain(
      "EXISTS(SELECT 1 FROM practice_admins o JOIN memberships m",
    );
  });

  it("grants administration only to active internal members once", async () => {
    practice();
    signIn(caller());
    for (const [userId, status, error] of [
      ["user-5", 404, "Select an active member of this practice"],
      [
        "user-v",
        400,
        "Practice administration needs an internal role (Auditor, Lead Auditor, Reviewer or Engagement Quality Reviewer)",
      ],
      ["user-4", 409, "This member already administers the practice"],
      ["nobody", 404, "Select an active member of this practice"],
    ] as const)
      expect(
        await refusal(await post("grantAdmin", { userId })),
        userId,
      ).toEqual({ status, error });
  });

  it("lets an Engagement Quality Reviewer administer the practice (#209)", async () => {
    const d1 = practice();
    signIn(caller());
    const response = await post("grantAdmin", { userId: "user-q" });
    expect(response.status).toBe(200);
    expect(tables(own(d1))).toEqual(["practice_admins"]);
    expect(own(d1)[0].args.slice(0, 2)).toEqual(["tenant-1", "user-q"]);
  });

  it("transfers the caller's administration to another member", async () => {
    const d1 = practice();
    signIn(caller());
    const response = await post("transferAdmin", { userId: "user-2" });
    expect((await reply(response)).details).toEqual({
      from: "user-lead",
      to: "user-2",
    });
    const [grant, revoke] = own(d1);
    expect(grant.args.slice(0, 2)).toEqual(["tenant-1", "user-2"]);
    expect(revoke.args.slice(0, 2)).toEqual(["tenant-1", "user-lead"]);
    expect(
      await refusal(await post("transferAdmin", { userId: "user-lead" })),
    ).toEqual({ status: 400, error: "Choose another member to transfer to" });
  });
});

describe("invitations and practice settings (F-44)", () => {
  it("stores an invitation by normalized email with its scope and expiry", async () => {
    const d1 = practice();
    signIn(caller());
    const response = await post("inviteMember", {
      email: " Nia@Example.test ",
      displayName: "Nia",
      role: "Client Contributor",
      clientId: "CL-1",
    });
    expect(response.status).toBe(200);
    const { details } = (await response.json()) as {
      details: Record<string, unknown>;
    };
    expect(details).toMatchObject({
      email: "nia@example.test",
      role: "Client Contributor",
      clientId: "CL-1",
      engagementIds: [],
    });
    const [insert] = own(d1);
    expect(insert.args.slice(2, 7)).toEqual([
      "nia@example.test",
      "Nia",
      "Client Contributor",
      "CL-1",
      "[]",
    ]);
    expect(Date.parse(String(details.expiresAt)) - Date.now()).toBeGreaterThan(
      29 * 86400000,
    );
  });

  it("refuses an invalid, duplicate or self invitation", async () => {
    practice();
    signIn(caller());
    expect(
      await refusal(
        await post("inviteMember", { email: "not-an-email", role: "Auditor" }),
      ),
    ).toEqual({ status: 400, error: "Enter a valid email address" });
    expect(
      await refusal(
        await post("inviteMember", {
          email: "LEAD@fixture.invalid",
          role: "Auditor",
        }),
      ),
    ).toEqual({ status: 400, error: "You cannot invite yourself" });
    const d1 = fakeD1((sql) =>
      sql.startsWith("SELECT id,expires_at FROM invitations")
        ? [{ id: "INV-1", expires_at: "2999-01-01T00:00:00.000Z" }]
        : null,
    );
    env.DB = d1.db;
    expect(
      await refusal(await post("inviteMember", valid.inviteMember)),
    ).toEqual({
      status: 409,
      error:
        "An invitation for this email is already pending. Cancel it to invite again.",
    });
  });

  it("closes an expired invitation as expired when the email is invited again (#209)", async () => {
    const d1 = fakeD1((sql, args) => {
      if (sql.startsWith("SELECT id,expires_at FROM invitations"))
        return args[1] === "nia@example.test"
          ? [{ id: "INV-OLD", expires_at: "2026-01-01T00:00:00.000Z" }]
          : [];
      return null;
    });
    env.DB = d1.db;
    signIn(caller());
    const response = await post("inviteMember", valid.inviteMember);
    expect(response.status).toBe(200);
    expect((await reply(response)).details).toMatchObject({
      email: "nia@example.test",
      expiredInvitations: ["INV-OLD"],
    });
    // The expired row is closed before the new one is inserted, in the same
    // guarded batch as the version bump and the inviteMember event.
    const [close, insert] = d1.batches[0].slice(1, -1);
    expect(close.sql).toMatch(
      /^UPDATE invitations SET status='expired',closed_at=\? WHERE tenant_id=\? AND email=\? AND status='pending' AND expires_at<=\? AND /,
    );
    expect(close.args.slice(1, 3)).toEqual(["tenant-1", "nia@example.test"]);
    expect(close.args[0]).toBe(close.args[3]);
    expect(insert.sql).toMatch(/^INSERT INTO invitations/);
    expect(d1.batches[0].at(-1)!.sql).toMatch(/management_events/);
    expect(d1.batches).toHaveLength(1);
  });

  it("refuses to invite the recorded email of an active member (#95)", async () => {
    const d1 = fakeD1((sql, args) =>
      sql.startsWith("SELECT display_name FROM memberships") &&
      args[1] === "ada@example.test"
        ? { display_name: "Ada" }
        : null,
    );
    env.DB = d1.db;
    signIn(caller());
    expect(
      await refusal(
        await post("inviteMember", {
          email: " Ada@Example.test",
          role: "Reviewer",
        }),
      ),
    ).toEqual({
      status: 409,
      error:
        "Ada is already an active member with this email. Change their role or engagements in Members & access instead.",
    });
    expect(d1.batches).toEqual([]);
  });

  it("cancels only a pending invitation", async () => {
    practice();
    signIn(caller());
    expect(
      await refusal(await post("cancelInvitation", { invitationId: "INV-9" })),
    ).toEqual({ status: 404, error: "No pending invitation to cancel" });
  });

  it("renames the practice within 80 characters", async () => {
    const d1 = practice();
    signIn(caller());
    expect(
      await refusal(await post("renamePractice", { name: "x".repeat(81) })),
    ).toEqual({ status: 400, error: "Use at most 80 characters" });
    await post("renamePractice", { name: "  Lea & Partners " });
    expect(own(d1)[0].args.slice(0, 2)).toEqual(["Lea & Partners", "tenant-1"]);
  });

  it("sets the quality review policy with a reason, for a Lead Auditor only", async () => {
    for (const data of [
      { coolingOffDays: -1, reason: "Policy" },
      { coolingOffDays: 3651, reason: "Policy" },
      { coolingOffDays: 1.5, reason: "Policy" },
      { coolingOffDays: 365 },
    ]) {
      const d1 = practice();
      signIn(caller());
      const response = await post("setQualityReviewPolicy", data);
      expect(response.status, JSON.stringify(data)).toBe(400);
      expect(d1.batches).toEqual([]);
    }
    for (const role of ["Auditor", "Reviewer", "Engagement Quality Reviewer"]) {
      const d1 = practice();
      signIn(caller(role as Role));
      expect(
        await refusal(
          await post("setQualityReviewPolicy", valid.setQualityReviewPolicy),
        ),
        role,
      ).toEqual({
        status: 403,
        error: "Only a Lead Auditor may set the quality review policy",
      });
      expect(d1.batches).toEqual([]);
    }
    const d1 = practice();
    signIn(caller());
    const response = await post("setQualityReviewPolicy", {
      coolingOffDays: 0,
      reason: " Only the engagement's own team ",
    });
    // The event records the old (default) and the new period and the reason.
    expect((await reply(response)).details).toEqual({
      coolingOffDays: 0,
      previousCoolingOffDays: 730,
      reason: "Only the engagement's own team",
    });
    expect(own(d1)[0].sql).toMatch(/^UPDATE tenants SET eqr_cooling_off_days/);
    expect(own(d1)[0].args.slice(0, 2)).toEqual([0, "tenant-1"]);
  });

  it("saves the practice's report settings and records them in the event (#111)", async () => {
    const d1 = practice();
    signIn(caller());
    expect(
      await refusal(
        await post("setReportSettings", { qualityStatement: "x".repeat(2001) }),
      ),
    ).toEqual({ status: 400, error: "Use at most 2000 characters" });
    expect(
      await refusal(await post("setReportSettings", { footer: "x" })),
    ).toMatchObject({ status: 400 });
    const response = await post("setReportSettings", {
      signatory: " Lea & Partners ",
      location: "Vienna, Austria",
      qualityStatement: "We apply ISQM 1 and the IESBA Code.",
    });
    const settings = {
      signatory: "Lea & Partners",
      location: "Vienna, Austria",
      qualityStatement: "We apply ISQM 1 and the IESBA Code.",
    };
    expect(((await response.json()) as { details: unknown }).details).toEqual(
      settings,
    );
    const [update] = own(d1);
    expect(update.sql).toMatch(/^UPDATE tenants SET report_settings=\?/);
    expect(update.args.slice(0, 2)).toEqual([
      JSON.stringify(settings),
      "tenant-1",
    ]);
    // The management event records the settings as saved.
    expect(d1.batches[0].at(-1)!.args[4]).toBe(JSON.stringify(settings));
    // A setting left out is cleared.
    await post("setReportSettings", { signatory: "Lea & Partners" });
    expect(JSON.parse(String(d1.batches[1][1].args[0]))).toEqual({
      signatory: "Lea & Partners",
      location: "",
      qualityStatement: "",
    });
  });

  it("rotates the signing key with a reason, retiring the active key", async () => {
    const d1 = practice();
    signIn(caller());
    expect(await refusal(await post("rotateSigningKey", {}))).toEqual({
      status: 400,
      error: "Required",
    });
    expect(
      await refusal(await post("rotateSigningKey", { reason: "  " })),
    ).toEqual({ status: 400, error: "Give a reason for the rotation" });
    const response = await post("rotateSigningKey", {
      reason: " Suspected exposure ",
    });
    const { details } = (await response.json()) as {
      details: Record<string, string>;
    };
    expect(details).toEqual({
      keyId: expect.stringMatching(/^KEY-/),
      publicKeySPKI: expect.stringMatching(/^MC/),
      reason: "Suspected exposure",
    });
    const [retire, insert] = own(d1);
    expect(retire.sql).toMatch(
      /^UPDATE dossier_keys SET active=0,wrapped_key=NULL,kek_id=NULL,/,
    );
    expect(retire.args.slice(1, 3)).toEqual(["Suspected exposure", "tenant-1"]);
    expect(insert.args.slice(0, 2)).toEqual(["tenant-1", details.keyId]);
    expect(insert.args[2]).toMatch(/^A256GCM\./);
    expect(insert.args[4]).toBe(details.publicKeySPKI);
    // The management event records the new key, never its wrapped private half.
    const event = d1.batches[0].at(-1)!;
    expect(event.args[4]).toBe(JSON.stringify(details));
    expect(String(event.args[4])).not.toContain("A256GCM");
  });

  it("acknowledges or resolves an integrity incident and records it (#151)", async () => {
    const incident = valid.handleIntegrityIncident;
    let d1 = practice();
    signIn(caller());
    const response = await post("handleIntegrityIncident", incident);
    const { details } = (await response.json()) as {
      details: Record<string, string>;
    };
    expect(details).toEqual({
      engagementId: "ENG-1",
      objectKey: incident.objectKey,
      kind: "missing",
      handling: "acknowledged",
      previous: "open",
    });
    const [update] = own(d1);
    expect(update.sql).toMatch(
      /^UPDATE integrity_incidents SET handling=\?,handled_at=\?,handled_by=\? WHERE tenant_id=\? AND engagement_id=\? AND object_key=\? AND kind=\? AND handling=\? AND /,
    );
    expect(update.args.slice(0, 8)).toEqual([
      "acknowledged",
      expect.any(String),
      "user-lead",
      "tenant-1",
      "ENG-1",
      incident.objectKey,
      "missing",
      "open",
    ]);
    expect(d1.batches[0].at(-1)!.args[4]).toBe(JSON.stringify(details));
    // An acknowledged incident may be resolved, not acknowledged again.
    d1 = practice(1, { incidentHandling: "acknowledged" });
    expect(
      await refusal(await post("handleIntegrityIncident", incident)),
    ).toEqual({ status: 409, error: "This incident is already acknowledged" });
    expect(
      (
        await post("handleIntegrityIncident", {
          ...incident,
          handling: "resolved",
        })
      ).status,
    ).toBe(200);
    // A resolved one reopens only when it recurs.
    d1 = practice(1, { incidentHandling: "resolved" });
    expect(
      await refusal(await post("handleIntegrityIncident", incident)),
    ).toEqual({
      status: 409,
      error:
        "This incident is resolved. It reopens if a member meets the damaged record again.",
    });
    expect(
      await refusal(
        await post("handleIntegrityIncident", {
          ...incident,
          engagementId: "ENG-9",
        }),
      ),
    ).toEqual({ status: 404, error: "Integrity incident not found" });
    expect(
      (
        await post("handleIntegrityIncident", {
          ...incident,
          handling: "open",
        })
      ).status,
    ).toBe(400);
    expect(d1.batches).toEqual([]);
  });

  it("refuses a signing key rotation without DOSSIER_KEK", async () => {
    delete env.DOSSIER_KEK;
    const d1 = practice();
    signIn(caller());
    expect(
      await refusal(await post("rotateSigningKey", valid.rotateSigningKey)),
    ).toEqual({
      status: 503,
      error:
        "Signing is not configured: the platform operator must set the DOSSIER_KEK Worker secret (docs/security/signing-keys.md). Nothing was signed.",
    });
    expect(d1.batches).toEqual([]);
  });

  it("pins a new engagement to the chosen criteria pack and records it", async () => {
    const d1 = practice();
    signIn(caller());
    const response = await post("createEngagement", {
      ...valid.createEngagement,
      packId: "eu-ai-act-amended",
      packVersion: "2026.11.2",
    });
    expect(response.status).toBe(200);
    const pack = {
      id: "eu-ai-act-amended",
      version: "2026.11.2",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    };
    expect((await reply(response)).details).toMatchObject({ pack });
    const insert = own(d1).find((s) =>
      s.sql.startsWith("INSERT INTO engagements("),
    )!;
    const body = JSON.parse(String(insert.args[5]));
    expect(body.criteria).toMatchObject({
      pin: { packId: pack.id, packVersion: pack.version },
      origin: "created",
      pinnedBy: "user-lead",
    });
  });

  it.each([
    [{ packId: "no-such-pack" }],
    [{ packId: "eu-ai-act-amended", packVersion: "2026.10.1" }],
    [{ packVersion: "2026.11.2" }],
  ])("refuses a criteria pack that cannot be pinned: %j", async (pack) => {
    const d1 = practice();
    signIn(caller());
    const response = await post("createEngagement", {
      ...valid.createEngagement,
      ...pack,
    });
    expect(response.status).toBe(400);
    expect(d1.batches).toEqual([]);
  });

  it("refuses an engagement over the practice quota", async () => {
    const d1 = practice(1, { engagements: 200 });
    signIn(caller());
    const response = await post("createEngagement", valid.createEngagement);
    expect(response.status).toBe(429);
    expect((await reply(response)).error).toMatch(
      /^This practice has reached its limit of 200 engagements/,
    );
    expect(d1.batches).toEqual([]);
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
