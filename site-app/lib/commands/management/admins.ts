import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain/types";
import { ApiError } from "../../http";
import type { Context } from "../../tenancy";
import { isInternalRole } from "../../workflow-state";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementBatch, ManagementModule } from "./batch";
/**
 * Practice administration (F-43): an administrator grants it to an active
 * internal member, revokes it, or transfers their own to another member. A
 * practice always keeps at least one active administrator; each change is a
 * management event like every other management op.
 */
const target = z.object({ userId: short }).strict();

async function adminState(ctx: Context, userId: string) {
  const row = await db()
    .prepare(
      "SELECT m.role,m.status,EXISTS(SELECT 1 FROM practice_admins a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.active=1) AS admin FROM memberships m WHERE m.tenant_id=? AND m.user_id=?",
    )
    .bind(ctx.tenantId, userId)
    .first<{ role: string; status: string; admin: number }>();
  return row;
}
/** The target must be an active internal member who is not yet an admin. */
async function checkCandidate(ctx: Context, userId: string) {
  const row = await adminState(ctx, userId);
  if (!row || row.status !== "active")
    throw new ApiError(404, "Select an active member of this practice");
  if (!isInternalRole(row.role))
    throw new ApiError(
      400,
      "Practice administration needs an internal role (Auditor, Lead Auditor or Reviewer)",
    );
  if (row.admin)
    throw new ApiError(409, "This member already administers the practice");
}
function grant(
  { commandId, guard }: ManagementBatch,
  ctx: Context,
  userId: string,
) {
  return db()
    .prepare(
      "INSERT INTO practice_admins(tenant_id,user_id,active) SELECT ?,?,1 WHERE " +
        guard +
        " ON CONFLICT(tenant_id,user_id) DO UPDATE SET active=1",
    )
    .bind(ctx.tenantId, userId, ctx.tenantId, commandId);
}
/**
 * Ends the user's administration, only while another active member stays an
 * active administrator (checked again in the statement itself).
 */
function revoke(
  { commandId, guard }: ManagementBatch,
  ctx: Context,
  userId: string,
) {
  return db()
    .prepare(
      "UPDATE practice_admins SET active=0 WHERE tenant_id=? AND user_id=? AND active=1 AND EXISTS(SELECT 1 FROM practice_admins o JOIN memberships m ON m.tenant_id=o.tenant_id AND m.user_id=o.user_id WHERE o.tenant_id=? AND o.user_id<>? AND o.active=1 AND m.status='active') AND " +
        guard,
    )
    .bind(ctx.tenantId, userId, ctx.tenantId, userId, ctx.tenantId, commandId);
}
export const admins: ManagementModule = defineCommands({
  grantAdmin: {
    roles,
    async handle(batch, data, ctx) {
      const { userId } = target.parse(data);
      await checkCandidate(ctx, userId);
      batch.statements.push(grant(batch, ctx, userId));
      return { userId, practiceAdmin: true };
    },
  },
  revokeAdmin: {
    roles,
    async handle(batch, data, ctx) {
      const { userId } = target.parse(data);
      const row = await adminState(ctx, userId);
      if (!row?.admin)
        throw new ApiError(404, "This member does not administer the practice");
      const others = await db()
        .prepare(
          "SELECT COUNT(*) AS n FROM practice_admins a JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id WHERE a.tenant_id=? AND a.user_id<>? AND a.active=1 AND m.status='active'",
        )
        .bind(ctx.tenantId, userId)
        .first<{ n: number }>();
      if (!others?.n)
        throw new ApiError(
          409,
          "A practice needs at least one active administrator. Grant or transfer administration first.",
        );
      batch.statements.push(revoke(batch, ctx, userId));
      return { userId, practiceAdmin: false };
    },
  },
  transferAdmin: {
    roles,
    async handle(batch, data, ctx) {
      const { userId } = target.parse(data);
      if (userId === ctx.user.userId)
        throw new ApiError(400, "Choose another member to transfer to");
      await checkCandidate(ctx, userId);
      batch.statements.push(
        grant(batch, ctx, userId),
        revoke(batch, ctx, ctx.user.userId),
      );
      return { from: ctx.user.userId, to: userId };
    },
  },
});
