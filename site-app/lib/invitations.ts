// Practice invitations: an administrator invites an email address into the
// practice (lib/commands/management/invitations.ts), and the invitee's next
// sign-in consumes it. The identity provider vouches for the email
// (docs/security/identity.md), so only a verified sign-in can accept.
import { db } from "./bindings";
import type { Identity } from "./identity";
import { id, now, sha256 } from "./ids";

/** How long an invitation stays valid. */
export const invitationLifetimeDays = 30;

/** The stored form of an email address: trimmed and lower-case. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

type Invitation = {
  tenant_id: string;
  id: string;
  display_name: string | null;
  role: string;
  client_id: string | null;
  engagement_ids: string;
  invited_by: string;
};

/**
 * Accepts every pending, unexpired invitation for the user's email: each one
 * in its own batch that closes the invitation, makes the user a member of the
 * inviting practice (restoring a revoked membership with the invited role and
 * none of its earlier grants), grants the invited engagements that still
 * exist, bumps the practice's management version and records the event. An
 * active membership keeps its role. Returns how many were accepted.
 */
export async function acceptInvitations(
  user: Pick<Identity, "userId" | "email" | "displayName">,
): Promise<number> {
  const email = normalizeEmail(user.email ?? "");
  if (!email) return 0;
  const at = now();
  const pending = (
    await db()
      .prepare(
        "SELECT tenant_id,id,display_name,role,client_id,engagement_ids,invited_by FROM invitations WHERE email=? AND status='pending' AND expires_at>? ORDER BY created_at LIMIT 20",
      )
      .bind(email, at)
      .all<Invitation>()
  ).results;
  let accepted = 0;
  for (const invitation of pending) {
    const { tenant_id: tenantId, id: invitationId } = invitation;
    const guard =
      "EXISTS(SELECT 1 FROM invitations WHERE tenant_id=? AND id=? AND accepted_by=? AND closed_at=?)";
    const guardArgs = [tenantId, invitationId, user.userId, at];
    const engagementIds = parseIds(invitation.engagement_ids);
    const details = {
      invitationId,
      userId: user.userId,
      role: invitation.role,
      clientId: invitation.client_id,
      engagementIds,
    };
    const event = {
      id: id("ME"),
      actor: user.userId,
      action: "acceptInvitation",
      details,
      createdAt: at,
    };
    const results = await db().batch([
      db()
        .prepare(
          "UPDATE invitations SET status='accepted',accepted_by=?,closed_at=? WHERE tenant_id=? AND id=? AND status='pending' AND expires_at>?",
        )
        .bind(user.userId, at, tenantId, invitationId, at),
      db()
        .prepare(
          "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status,access_since) SELECT ?,?,?,?,?,'active',? WHERE " +
            guard +
            " ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,client_id=excluded.client_id,display_name=excluded.display_name,status='active',access_since=excluded.access_since WHERE memberships.status<>'active'",
        )
        .bind(
          tenantId,
          user.userId,
          invitation.role,
          invitation.client_id,
          (invitation.display_name || user.displayName).slice(0, 300),
          at,
          ...guardArgs,
        ),
      ...engagementIds.map((engagementId) =>
        db()
          .prepare(
            "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE " +
              guard +
              " AND EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=?) AND EXISTS(SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' AND role IN ('Auditor','Lead Auditor','Reviewer')) ON CONFLICT(tenant_id,engagement_id,user_id) DO UPDATE SET active=1,actor=excluded.actor,updated_at=excluded.updated_at",
          )
          .bind(
            tenantId,
            engagementId,
            user.userId,
            invitation.invited_by,
            at,
            ...guardArgs,
            tenantId,
            engagementId,
            tenantId,
            user.userId,
          ),
      ),
      db()
        .prepare("UPDATE tenants SET version=version+1 WHERE id=? AND " + guard)
        .bind(tenantId, ...guardArgs),
      db()
        .prepare(
          "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) SELECT ?,?,?,?,?,?,? WHERE " +
            guard,
        )
        .bind(
          tenantId,
          event.id,
          event.actor,
          event.action,
          JSON.stringify(details),
          await sha256(JSON.stringify(event)),
          at,
          ...guardArgs,
        ),
    ]);
    if (results[0]?.meta.changes) accepted++;
  }
  return accepted;
}

function parseIds(value: string): string[] {
  try {
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids)
      ? ids.filter((x): x is string => typeof x === "string").slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
