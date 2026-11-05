import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain";
import { getEngagement } from "../../engagement-repo";
import { ApiError } from "../../http";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementHandler, ManagementModule } from "./batch";
/**
 * Granting, editing and revoking practice membership share one handler: the
 * same validation and self-change refusal, and for grant and update the same
 * role, client and engagement-grant checks. Only a Lead Auditor may grant
 * internal engagement access with a membership.
 */
const saveMember: ManagementHandler = {
  roles,
  async handle({ commandId, timestamp, guard, statements }, data, ctx, op) {
    const a = z
      .object({
        userId: short,
        displayName: short.optional(),
        role: z
          .enum([
            "Auditor",
            "Lead Auditor",
            "Client Viewer",
            "Client Contributor",
            "Reviewer",
          ])
          .optional(),
        clientId: z.string().max(300).nullable().optional(),
        engagementIds: z
          .array(short)
          .max(50)
          .refine((v) => new Set(v).size === v.length)
          .optional(),
      })
      .parse(data);
    if (a.userId === ctx.user.userId)
      throw new ApiError(400, "You cannot change or revoke your own access");
    const existing = await db()
      .prepare(
        "SELECT user_id,status FROM memberships WHERE tenant_id=? AND user_id=?",
      )
      .bind(ctx.tenantId, a.userId)
      .first<{ user_id: string; status: string }>();
    if (op !== "grantMember" && !existing)
      throw new ApiError(404, "User not found in this practice");
    if (op === "updateMember" && existing?.status !== "active")
      throw new ApiError(409, "Restore revoked access before editing the role");
    if (op === "revokeMember") {
      statements.push(
        db()
          .prepare(
            "UPDATE memberships SET status=? WHERE tenant_id=? AND user_id=? AND " +
              guard,
          )
          .bind("revoked", ctx.tenantId, a.userId, ctx.tenantId, commandId),
      );
      return { userId: a.userId, status: "revoked" };
    } else {
      if (!a.displayName || !a.role)
        throw new ApiError(400, "Enter a name and select a role");
      if (
        ["Client Viewer", "Client Contributor"].includes(a.role) &&
        (!a.clientId ||
          !(await db()
            .prepare("SELECT id FROM clients WHERE tenant_id=? AND id=?")
            .bind(ctx.tenantId, a.clientId)
            .first()))
      )
        throw new ApiError(400, "Select a client for client access");
      const clientId = ["Client Viewer", "Client Contributor"].includes(a.role)
        ? a.clientId!
        : null;
      if (op === "updateMember")
        statements.push(
          db()
            .prepare(
              "UPDATE memberships SET display_name=?,role=?,client_id=? WHERE tenant_id=? AND user_id=? AND status=? AND " +
                guard,
            )
            .bind(
              a.displayName,
              a.role,
              clientId,
              ctx.tenantId,
              a.userId,
              "active",
              ctx.tenantId,
              commandId,
            ),
        );
      else
        statements.push(
          db()
            .prepare(
              "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) SELECT ?,?,?,?,?,? WHERE " +
                guard +
                " ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,client_id=excluded.client_id,display_name=excluded.display_name,status=excluded.status",
            )
            .bind(
              ctx.tenantId,
              a.userId,
              a.role,
              clientId,
              a.displayName,
              "active",
              ctx.tenantId,
              commandId,
            ),
        );
      if (a.engagementIds?.length) {
        if (
          ctx.role !== "Lead Auditor" ||
          ["Client Viewer", "Client Contributor"].includes(a.role)
        )
          throw new ApiError(
            403,
            "Only a Lead Auditor may assign internal engagement access",
          );
        for (const engagementId of a.engagementIds) {
          await getEngagement(ctx, engagementId);
          statements.push(
            db()
              .prepare(
                "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE " +
                  guard +
                  " ON CONFLICT(tenant_id,engagement_id,user_id) DO UPDATE SET active=1,actor=excluded.actor,updated_at=excluded.updated_at",
              )
              .bind(
                ctx.tenantId,
                engagementId,
                a.userId,
                ctx.user.userId,
                timestamp,
                ctx.tenantId,
                commandId,
              ),
          );
        }
      }
      return {
        userId: a.userId,
        displayName: a.displayName,
        role: a.role,
        clientId,
        status: "active",
        engagementIds: a.engagementIds ?? [],
      };
    }
  },
};
/** Practice members and the engagement access granted with a membership. */
export const members: ManagementModule = defineCommands({
  grantMember: saveMember,
  updateMember: saveMember,
  revokeMember: saveMember,
});
