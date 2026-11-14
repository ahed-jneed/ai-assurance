// Who is calling, in which practice and with which role: resolves the signed-in
// user (lib/identity.ts) to an active membership and enforces role and
// practice-administration permissions. A user without a membership first
// accepts their pending invitations (lib/invitations.ts); a user with neither
// may provision a practice of their own only where self-signup is allowed
// (lib/access-policy.ts). Apart from those, recording the member's identity
// email once when it is new or changed, and recording a sign-in for the
// practice's Access log at most once per signInGapHours, resolving the caller
// only reads.
import { signInGapHours } from "./access-events";
import { selfSignupAllowed } from "./access-policy";
import { db } from "./bindings";
import type { Role } from "./domain";
import { roles } from "./domain";
import {
  qualityReviewerOps,
  qualityReviewerRole,
} from "./domain/quality-review";
import { resolveNew } from "./criteria/pin";
import { freshEngagement } from "./factories";
import { ApiError } from "./http";
import { currentUser } from "./identity";
import { id, now, sha256 } from "./ids";
import { acceptInvitations, normalizeEmail } from "./invitations";
export type Context = {
  user: { userId: string; displayName: string; email: string };
  tenantId: string;
  role: Role;
  clientId: string | null;
  practiceAdmin?: boolean;
  /**
   * When the caller's current grant of this membership began. Client request
   * grants issued before it do not apply. Null for memberships that predate it.
   */
  accessSince?: string | null;
};
type MemberRow = {
  role: Role;
  client_id: string | null;
  access_since: string | null;
  email?: string | null;
};
const memberRow = (tenantId: string, userId: string) =>
  db()
    .prepare(
      "SELECT role,client_id,access_since,email FROM memberships WHERE tenant_id=? AND user_id=? AND status='active'",
    )
    .bind(tenantId, userId)
    .first<MemberRow>();
/**
 * Records the member's normalized identity email on their membership when it
 * is not recorded yet or the identity provider now reports another one, so
 * revocation can cancel their pending invitations and an administrator
 * cannot invite them again while they are active (#95). Writes nothing when
 * the stored email is current.
 */
async function recordEmail(
  tenantId: string,
  user: Context["user"],
  member: MemberRow,
) {
  const email = normalizeEmail(user.email ?? "");
  if (!email || member.email === email) return;
  await db()
    .prepare(
      "UPDATE memberships SET email=? WHERE tenant_id=? AND user_id=? AND email IS NOT ?",
    )
    .bind(email, tenantId, user.userId, email)
    .run();
}
/**
 * Records the member's sign-in to the practice for its Access log (#181), with the
 * role they hold, unless one is recorded within signInGapHours: one read on
 * each request and a write at most once per gap. The guarded insert keeps
 * concurrent first requests to one event. A failure to record never refuses
 * the request; it is logged instead.
 */
async function recordSignIn(tenantId: string, userId: string, role: Role) {
  try {
    const at = now(),
      since = new Date(Date.parse(at) - signInGapHours * 3600000).toISOString();
    const recent =
      "SELECT 1 FROM sign_in_events WHERE tenant_id=? AND user_id=? AND created_at>?";
    if (
      await db()
        .prepare(recent + " LIMIT 1")
        .bind(tenantId, userId, since)
        .first()
    )
      return;
    await db()
      .prepare(
        "INSERT INTO sign_in_events(tenant_id,id,user_id,role,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(" +
          recent +
          ")",
      )
      .bind(tenantId, id("SI"), userId, role, at, tenantId, userId, since)
      .run();
  } catch (error) {
    console.warn(
      "Access log: the sign-in could not be recorded: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
/**
 * Why a member of an archived practice is refused (#151): the platform
 * operator archived it, and only its issued records remain.
 */
export const archivedMessage =
  "This practice was archived by the platform operator after a long period without activity. Its released reports and signed dossiers are retained; contact the platform operator to verify them.";
export async function context(tenantId?: string): Promise<Context> {
  const user = currentUser();
  if (!user) throw new ApiError(401, "Sign in to access the audit workspace");
  let member = tenantId ? await memberRow(tenantId, user.userId) : null;
  if (!member) {
    // Invitations are accepted on the first request that needs them: every
    // request without a practice, and a request for a practice the user is
    // not (yet) an active member of.
    await acceptInvitations(user);
    if (!tenantId) {
      const existing = await db()
        .prepare(
          "SELECT tenant_id FROM memberships WHERE user_id=? AND status='active' ORDER BY tenant_id LIMIT 1",
        )
        .bind(user.userId)
        .first<{ tenant_id: string }>();
      if (existing) tenantId = existing.tenant_id;
      else if (
        await db()
          .prepare(
            "SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='archived' AND t.archived_at IS NOT NULL LIMIT 1",
          )
          .bind(user.userId)
          .first()
      )
        throw new ApiError(403, archivedMessage);
      else if (
        await db()
          .prepare("SELECT tenant_id FROM memberships WHERE user_id=? LIMIT 1")
          .bind(user.userId)
          .first()
      )
        throw new ApiError(
          403,
          "Your practice access has been revoked. Contact a practice administrator.",
        );
      else if (!selfSignupAllowed(user.email))
        throw new ApiError(
          403,
          "You have no practice membership or pending invitation. Ask a practice administrator to invite " +
            user.email +
            ".",
        );
      else tenantId = await provisionPractice(user);
    }
    member = await memberRow(tenantId, user.userId);
    if (
      !member &&
      (await db()
        .prepare(
          "SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='archived' AND t.archived_at IS NOT NULL",
        )
        .bind(tenantId, user.userId)
        .first())
    )
      throw new ApiError(403, archivedMessage);
  }
  if (!tenantId || !member || !roles.includes(member.role))
    throw new ApiError(403, "You do not have access to this practice");
  await recordEmail(tenantId, user, member);
  const practiceAdmin = !!(await db()
    .prepare(
      "SELECT 1 FROM practice_admins WHERE tenant_id=? AND user_id=? AND active=1",
    )
    .bind(tenantId, user.userId)
    .first());
  await recordSignIn(tenantId, user.userId, member.role);
  return {
    user,
    tenantId,
    role: member.role,
    clientId: member.client_id,
    practiceAdmin,
    accessSince: member.access_since,
  };
}
/** The name of a practice provisioned at first sign-in, after its founder. */
export const practiceName = (user: Context["user"]) =>
  ((user.displayName || user.email).trim().slice(0, 60) || "New") + " practice";
/**
 * First sign-in where self-signup is allowed: a practice that the user leads
 * and administers, named after them, with an example client and an
 * engagement only the user may open. Practices that predate engagement grants
 * were adopted once by drizzle/0005.
 */
async function provisionPractice(user: Context["user"]) {
  const tenantId = "tenant-" + (await sha256(user.userId)).slice(0, 24);
  const clientId = "CL-default",
    e = freshEngagement(
      resolveNew(),
      clientId,
      "New AI assurance engagement",
      user.userId,
    );
  e.id = "ENG-default";
  const body = JSON.stringify(e),
    at = now();
  await db().batch([
    db()
      .prepare(
        "INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES(?,?,?)",
      )
      .bind(tenantId, practiceName(user), at),
    db()
      .prepare(
        "INSERT OR IGNORE INTO memberships(tenant_id,user_id,role,client_id,display_name,access_since,email) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        tenantId,
        user.userId,
        "Lead Auditor",
        null,
        user.displayName,
        at,
        normalizeEmail(user.email ?? "") || null,
      ),
    db()
      .prepare(
        "INSERT OR IGNORE INTO practice_admins(tenant_id,user_id,active) VALUES(?,?,1)",
      )
      .bind(tenantId, user.userId),
    db()
      .prepare(
        "INSERT OR IGNORE INTO clients(tenant_id,id,name,sector,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(tenantId, clientId, "Example client", "Financial services", at),
    db()
      .prepare(
        "INSERT OR IGNORE INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(tenantId, e.id, clientId, e.title, 1, body, "init"),
    db()
      .prepare(
        "INSERT OR IGNORE INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(tenantId, e.id, 1, body, await sha256(body), at),
    db()
      .prepare(
        "INSERT OR IGNORE INTO engagement_access_policies(tenant_id,engagement_id,created_at) VALUES(?,?,?)",
      )
      .bind(tenantId, e.id, at),
    db()
      .prepare(
        "INSERT OR IGNORE INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES(?,?,?,1,?,?)",
      )
      .bind(tenantId, e.id, user.userId, user.userId, at),
  ]);
  return tenantId;
}
export function requireRole(ctx: Context, allowed: readonly Role[]) {
  if (!allowed.includes(ctx.role))
    throw new ApiError(403, "Your role cannot perform this action");
}
export function requireAdmin(ctx: Context) {
  if (!ctx.practiceAdmin)
    throw new ApiError(403, "Practice administration permission is required");
}
/**
 * Client Viewers only read (F-56): every write path refuses them before it
 * looks at the op or loads anything to change.
 */
export function refuseReadOnly(ctx: Context) {
  if (ctx.role === "Client Viewer")
    throw new ApiError(403, "Client Viewers have read-only access");
}
/**
 * An Engagement Quality Reviewer changes nothing but the quality review
 * (lib/domain/quality-review.ts): every other engagement write refuses them,
 * whatever the op's own checks would say.
 */
export function refuseQualityReviewer(ctx: Context, op: string) {
  if (ctx.role === qualityReviewerRole && !qualityReviewerOps.includes(op))
    throw new ApiError(
      403,
      "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work",
    );
}
