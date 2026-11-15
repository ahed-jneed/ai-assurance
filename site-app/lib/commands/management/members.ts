import { z } from "../../zod";
import { db } from "../../bindings";
import { roles } from "../../domain/types";
import { ApiError } from "../../http";
import { isClientRole } from "../../workflow-state";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementHandler, ManagementModule } from "./batch";
import {
  checkAssignable,
  engagementIds,
  grantStatements,
  memberRole,
  withdrawAll,
} from "./engagement-grants";

type Existing = {
  role: string;
  status: string;
  client_id: string | null;
  practice_admin: number;
  email: string | null;
  display_name: string | null;
};
async function existingMember(tenantId: string, userId: string) {
  return db()
    .prepare(
      "SELECT m.role,m.status,m.client_id,m.email,m.display_name,EXISTS(SELECT 1 FROM practice_admins a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.active=1) AS practice_admin FROM memberships m WHERE m.tenant_id=? AND m.user_id=?",
    )
    .bind(tenantId, userId)
    .first<Existing>();
}
/**
 * The client a client role is scoped to, which must be a client of this
 * practice; null for internal roles.
 */
export async function clientScope(
  tenantId: string,
  role: string,
  clientId: string | null | undefined,
) {
  if (!isClientRole(role)) return null;
  if (
    !clientId ||
    !(await db()
      .prepare("SELECT id FROM clients WHERE tenant_id=? AND id=?")
      .bind(tenantId, clientId)
      .first())
  )
    throw new ApiError(400, "Select a client for client access");
  return clientId;
}
/**
 * Granting and editing practice membership share one handler: the same
 * validation, self-change refusal and role, client and engagement checks.
 * A new grant, a re-grant of revoked access and any change of role or client
 * starts a fresh grant: the member's earlier engagement grants and sponsored
 * runner workers are withdrawn, their earlier client request grants lapse
 * (memberships.access_since), and only the engagements listed in
 * `engagementIds` are granted, which such a change must list explicitly for
 * an internal role. Editing only the name keeps the grants; listed
 * engagements are then added. Only a Lead Auditor may grant internal
 * engagement access with a membership. A grant to an active member is
 * refused: their access is changed with updateMember.
 */
const saveMember: ManagementHandler = {
  roles,
  async handle(batch, data, ctx, op) {
    const { timestamp, guard, commandId, statements } = batch;
    const a = z
      .object({
        userId: short,
        displayName: short.optional(),
        role: memberRole.optional(),
        clientId: z.string().max(300).nullable().optional(),
        engagementIds: engagementIds.optional(),
      })
      .parse(data);
    if (a.userId === ctx.user.userId)
      throw new ApiError(400, "You cannot change or revoke your own access");
    const existing = await existingMember(ctx.tenantId, a.userId);
    // Adding someone who already holds active access would overwrite their
    // name and grants (#244 item 3): refused as Invite by email refuses the
    // same person. Restoring a revoked member stays a grant.
    if (op === "grantMember" && existing?.status === "active")
      throw new ApiError(
        409,
        (existing.display_name || a.userId) +
          " is already an active member. Change their role or engagements in Members & access instead.",
      );
    if (op === "updateMember" && !existing)
      throw new ApiError(404, "User not found in this practice");
    if (op === "updateMember" && existing?.status !== "active")
      throw new ApiError(409, "Restore revoked access before editing the role");
    if (!a.displayName || !a.role)
      throw new ApiError(400, "Enter a name and select a role");
    const clientId = await clientScope(ctx.tenantId, a.role, a.clientId);
    const fresh =
      !existing ||
      existing.status !== "active" ||
      existing.role !== a.role ||
      existing.client_id !== clientId;
    if (
      existing &&
      fresh &&
      !isClientRole(a.role) &&
      a.engagementIds === undefined
    )
      throw new ApiError(
        400,
        existing.status === "active"
          ? "List the engagements this member keeps with the new role; earlier grants are withdrawn"
          : "List the engagements to grant again; earlier grants are not restored",
      );
    if (existing?.practice_admin && isClientRole(a.role))
      throw new ApiError(
        409,
        "Remove practice administration before giving this member a client role",
      );
    const ids = isClientRole(a.role) ? [] : (a.engagementIds ?? []);
    await checkAssignable(ctx, a.role, a.engagementIds ?? [], a.userId);
    let withdrawn: { engagementIds: string[]; workerIds: string[] } = {
      engagementIds: [],
      workerIds: [],
    };
    if (existing && fresh) {
      const withdrawal = await withdrawAll(batch, ctx, a.userId);
      withdrawn = withdrawal.withdrawn;
      statements.push(...withdrawal.statements);
    }
    statements.push(
      op === "updateMember"
        ? db()
            .prepare(
              "UPDATE memberships SET display_name=?,role=?,client_id=?,access_since=" +
                (fresh ? "?" : "access_since") +
                " WHERE tenant_id=? AND user_id=? AND status=? AND " +
                guard,
            )
            .bind(
              a.displayName,
              a.role,
              clientId,
              ...(fresh ? [timestamp] : []),
              ctx.tenantId,
              a.userId,
              "active",
              ctx.tenantId,
              commandId,
            )
        : db()
            .prepare(
              "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status,access_since) SELECT ?,?,?,?,?,?,? WHERE " +
                guard +
                " ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,client_id=excluded.client_id,display_name=excluded.display_name,status=excluded.status,access_since=" +
                (fresh ? "excluded.access_since" : "memberships.access_since"),
            )
            .bind(
              ctx.tenantId,
              a.userId,
              a.role,
              clientId,
              a.displayName,
              "active",
              timestamp,
              ctx.tenantId,
              commandId,
            ),
    );
    statements.push(...grantStatements(batch, ctx, a.userId, ids));
    return {
      userId: a.userId,
      displayName: a.displayName,
      role: a.role,
      clientId,
      status: "active",
      engagementIds: ids,
      ...(existing && fresh ? { withdrawn } : {}),
    };
  },
};
/**
 * Revoking a member withdraws, in the same batch, their engagement grants,
 * the runner workers they sponsored and their practice administration,
 * lapses their client request grants and cancels the pending invitations for
 * their recorded email. A later re-grant restores none of it.
 */
const revokeMember: ManagementHandler = {
  roles,
  async handle(batch, data, ctx) {
    const { timestamp, guard, commandId, statements } = batch;
    const a = z.object({ userId: short }).parse(data);
    if (a.userId === ctx.user.userId)
      throw new ApiError(400, "You cannot change or revoke your own access");
    const existing = await existingMember(ctx.tenantId, a.userId);
    if (!existing) throw new ApiError(404, "User not found in this practice");
    if (existing.status !== "active")
      throw new ApiError(409, "This member's access is already revoked");
    const { withdrawn, statements: withdrawal } = await withdrawAll(
      batch,
      ctx,
      a.userId,
    );
    // Their pending invitations into this practice, found by the identity
    // email recorded on the membership, are cancelled with the revocation.
    const cancelledInvitations = existing.email
      ? (
          await db()
            .prepare(
              "SELECT id FROM invitations WHERE tenant_id=? AND email=? AND status='pending' ORDER BY created_at",
            )
            .bind(ctx.tenantId, existing.email)
            .all<{ id: string }>()
        ).results.map((r) => r.id)
      : [];
    if (cancelledInvitations.length)
      statements.push(
        db()
          .prepare(
            "UPDATE invitations SET status='cancelled',closed_at=? WHERE tenant_id=? AND email=? AND status='pending' AND " +
              guard,
          )
          .bind(
            timestamp,
            ctx.tenantId,
            existing.email,
            ctx.tenantId,
            commandId,
          ),
      );
    statements.push(
      db()
        .prepare(
          "UPDATE memberships SET status=?,access_since=? WHERE tenant_id=? AND user_id=? AND " +
            guard,
        )
        .bind(
          "revoked",
          timestamp,
          ctx.tenantId,
          a.userId,
          ctx.tenantId,
          commandId,
        ),
      ...withdrawal,
      db()
        .prepare(
          "UPDATE practice_admins SET active=0 WHERE tenant_id=? AND user_id=? AND active=1 AND " +
            guard,
        )
        .bind(ctx.tenantId, a.userId, ctx.tenantId, commandId),
    );
    return {
      userId: a.userId,
      status: "revoked",
      withdrawn,
      practiceAdminRemoved: !!existing.practice_admin,
      cancelledInvitations,
    };
  },
};
/** Practice members and the engagement access granted with a membership. */
export const members: ManagementModule = defineCommands({
  grantMember: saveMember,
  updateMember: saveMember,
  revokeMember,
});
