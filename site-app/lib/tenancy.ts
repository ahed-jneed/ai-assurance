// Who is calling, in which practice and with which role: resolves the signed-in
// user (lib/identity.ts) to an active membership, provisions a practice on
// first sign-in and enforces role and practice-administration permissions.
// Apart from that first provisioning, resolving the caller only reads.
import type { Role } from "./domain";
import { roles } from "./domain";
import { db, now, sha256 } from "./engagement-repo";
import { freshEngagement } from "./factories";
import { ApiError } from "./http";
import { currentUser } from "./identity";
export type Context = {
  user: { userId: string; displayName: string; email: string };
  tenantId: string;
  role: Role;
  clientId: string | null;
  practiceAdmin?: boolean;
};
export async function context(tenantId?: string): Promise<Context> {
  const user = currentUser();
  if (!user) throw new ApiError(401, "Sign in to access the audit workspace");
  if (!tenantId) {
    const existing = await db()
      .prepare(
        "SELECT tenant_id FROM memberships WHERE user_id=? AND status='active' ORDER BY tenant_id LIMIT 1",
      )
      .bind(user.userId)
      .first<{ tenant_id: string }>();
    if (existing) tenantId = existing.tenant_id;
    else {
      if (
        await db()
          .prepare("SELECT tenant_id FROM memberships WHERE user_id=? LIMIT 1")
          .bind(user.userId)
          .first()
      )
        throw new ApiError(
          403,
          "Your practice access has been revoked. Contact a Lead Auditor.",
        );
      tenantId = await provisionPractice(user);
    }
  }
  const member = await db()
    .prepare(
      "SELECT role,client_id FROM memberships WHERE tenant_id=? AND user_id=? AND status='active'",
    )
    .bind(tenantId, user.userId)
    .first<{ role: Role; client_id: string | null }>();
  if (!member || !roles.includes(member.role))
    throw new ApiError(403, "You do not have access to this practice");
  const practiceAdmin = !!(await db()
    .prepare(
      "SELECT 1 FROM practice_admins WHERE tenant_id=? AND user_id=? AND active=1",
    )
    .bind(tenantId, user.userId)
    .first());
  return {
    user,
    tenantId,
    role: member.role,
    clientId: member.client_id,
    practiceAdmin,
  };
}
/**
 * First sign-in: a practice that the user leads and administers, with an
 * example client and an engagement only the user may open. Practices that
 * predate engagement grants were adopted once by drizzle/0005.
 */
async function provisionPractice(user: Context["user"]) {
  const tenantId = "tenant-" + (await sha256(user.userId)).slice(0, 24);
  const clientId = "CL-default",
    e = freshEngagement(clientId, "New AI assurance engagement", user.userId);
  e.id = "ENG-default";
  const body = JSON.stringify(e),
    at = now();
  await db().batch([
    db()
      .prepare(
        "INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES(?,?,?)",
      )
      .bind(tenantId, "Assurance practice", at),
    db()
      .prepare(
        "INSERT OR IGNORE INTO memberships(tenant_id,user_id,role,client_id,display_name) VALUES(?,?,?,?,?)",
      )
      .bind(tenantId, user.userId, "Lead Auditor", null, user.displayName),
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
export function requireRole(ctx: Context, allowed: Role[]) {
  if (!allowed.includes(ctx.role))
    throw new ApiError(403, "Your role cannot perform this action");
}
export function requireAdmin(ctx: Context) {
  if (!ctx.practiceAdmin)
    throw new ApiError(403, "Practice administration permission is required");
}
