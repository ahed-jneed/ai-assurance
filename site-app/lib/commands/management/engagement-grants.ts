import { z } from "zod";
import { db } from "../../bindings";
import { roles, type Role } from "../../domain";
import { loadEngagement } from "../../engagement-repo";
import { ApiError } from "../../http";
import type { Context } from "../../tenancy";
import { isClientRole } from "../../workflow-state";
import { accessConflict } from "../../workflow/acceptance";
import { short } from "../fields";
import type { ManagementBatch } from "./batch";
/**
 * Engagement grants that travel with a membership (F-24). Revoking a member or
 * changing their role withdraws every engagement grant they hold and
 * deactivates the runner workers they sponsored, in the same management
 * batch. Nothing is restored implicitly: a re-grant activates only the
 * engagements it lists, and a withdrawn worker must be enrolled again.
 */

/** The role a membership or invitation grants: any of `roles`. */
export const memberRole = z.enum(roles as [Role, ...Role[]]);

/** The engagements a grant, re-grant or invitation lists explicitly. */
export const engagementIds = z
  .array(short)
  .max(50)
  .refine((v) => new Set(v).size === v.length, "List each engagement once");

/**
 * Checks that the caller may assign these engagements with a membership: only
 * a Lead Auditor, only to internal roles, and only engagements the caller can
 * open. For a known member (`userId`), an engagement where they declared a
 * disqualifying relationship or an unresolved threat is refused, as
 * assigning them to its team is (lib/workflow/acceptance.ts); an invitation
 * is checked when it is accepted (lib/invitations.ts).
 */
export async function checkAssignable(
  ctx: Context,
  role: string,
  ids: readonly string[],
  userId?: string,
) {
  if (!ids.length) return;
  if (ctx.role !== "Lead Auditor" || isClientRole(role))
    throw new ApiError(
      403,
      "Only a Lead Auditor may assign internal engagement access",
    );
  // Access is decided by the D1 record; its R2 parts are never needed here.
  for (const engagementId of ids) {
    const e = await loadEngagement(ctx, engagementId);
    const conflict = userId && accessConflict(e, userId);
    if (conflict) throw new ApiError(409, conflict + " (" + e.title + ")");
  }
}

/** Activates the user's access to each listed engagement. */
export function grantStatements(
  { commandId, timestamp, guard }: ManagementBatch,
  ctx: Context,
  userId: string,
  ids: readonly string[],
) {
  return ids.map((engagementId) =>
    db()
      .prepare(
        "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE " +
          guard +
          " ON CONFLICT(tenant_id,engagement_id,user_id) DO UPDATE SET active=1,actor=excluded.actor,updated_at=excluded.updated_at",
      )
      .bind(
        ctx.tenantId,
        engagementId,
        userId,
        ctx.user.userId,
        timestamp,
        ctx.tenantId,
        commandId,
      ),
  );
}

/**
 * Withdraws every engagement grant of the user and deactivates every runner
 * worker they sponsored. Returns the statements and what they withdraw, for
 * the management event.
 */
export async function withdrawAll(
  { commandId, timestamp, guard }: ManagementBatch,
  ctx: Context,
  userId: string,
) {
  const grants = (
    await db()
      .prepare(
        "SELECT engagement_id FROM engagement_access WHERE tenant_id=? AND user_id=? AND active=1 ORDER BY engagement_id",
      )
      .bind(ctx.tenantId, userId)
      .all<{ engagement_id: string }>()
  ).results.map((r) => r.engagement_id);
  const workers = (
    await db()
      .prepare(
        "SELECT id FROM runner_workers WHERE tenant_id=? AND created_by=? AND active=1 ORDER BY id",
      )
      .bind(ctx.tenantId, userId)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
  return {
    withdrawn: { engagementIds: grants, workerIds: workers },
    statements: [
      db()
        .prepare(
          "UPDATE engagement_access SET active=0,actor=?,updated_at=? WHERE tenant_id=? AND user_id=? AND active=1 AND " +
            guard,
        )
        .bind(
          ctx.user.userId,
          timestamp,
          ctx.tenantId,
          userId,
          ctx.tenantId,
          commandId,
        ),
      db()
        .prepare(
          "UPDATE runner_workers SET active=0 WHERE tenant_id=? AND created_by=? AND active=1 AND " +
            guard,
        )
        .bind(ctx.tenantId, userId, ctx.tenantId, commandId),
    ],
  };
}
