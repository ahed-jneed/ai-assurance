import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain";
import { ApiError } from "../../http";
import { id } from "../../ids";
import { invitationLifetimeDays, normalizeEmail } from "../../invitations";
import { isClientRole } from "../../workflow-state";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementModule } from "./batch";
import {
  checkAssignable,
  engagementIds,
  memberRole,
} from "./engagement-grants";
import { clientScope } from "./members";
/**
 * Invitations by email into this practice (F-44): the invitee joins with the
 * invited role, client and engagements at their next sign-in
 * (lib/invitations.ts), whether or not self-signup is allowed. An email that
 * belongs to an active member of this practice (memberships.email) is
 * refused: their access is edited in Members & access. An administrator may
 * cancel a pending invitation, and revoking a member cancels theirs.
 */
export const invitations: ManagementModule = defineCommands({
  inviteMember: {
    roles,
    async handle({ commandId, timestamp, guard, statements }, data, ctx) {
      const a = z
        .object({
          email: z
            .string()
            .trim()
            .email("Enter a valid email address")
            .max(320),
          displayName: short.optional(),
          role: memberRole,
          clientId: z.string().max(300).nullable().optional(),
          engagementIds: engagementIds.optional(),
        })
        .strict()
        .parse(data);
      const email = normalizeEmail(a.email);
      if (email === normalizeEmail(ctx.user.email))
        throw new ApiError(400, "You cannot invite yourself");
      const member = await db()
        .prepare(
          "SELECT display_name FROM memberships WHERE tenant_id=? AND email=? AND status='active' LIMIT 1",
        )
        .bind(ctx.tenantId, email)
        .first<{ display_name: string }>();
      if (member)
        throw new ApiError(
          409,
          member.display_name +
            " is already an active member with this email. Change their role or engagements in Members & access instead.",
        );
      const clientId = await clientScope(ctx.tenantId, a.role, a.clientId);
      const ids = isClientRole(a.role) ? [] : (a.engagementIds ?? []);
      await checkAssignable(ctx, a.role, a.engagementIds ?? []);
      if (
        await db()
          .prepare(
            "SELECT 1 FROM invitations WHERE tenant_id=? AND email=? AND status='pending'",
          )
          .bind(ctx.tenantId, email)
          .first()
      )
        throw new ApiError(
          409,
          "An invitation for this email is already pending. Cancel it to invite again.",
        );
      const invitationId = id("INV"),
        expiresAt = new Date(
          Date.parse(timestamp) + invitationLifetimeDays * 86400000,
        ).toISOString();
      statements.push(
        db()
          .prepare(
            "INSERT INTO invitations(tenant_id,id,email,display_name,role,client_id,engagement_ids,status,invited_by,created_at,expires_at) SELECT ?,?,?,?,?,?,?,'pending',?,?,? WHERE " +
              guard,
          )
          .bind(
            ctx.tenantId,
            invitationId,
            email,
            a.displayName ?? null,
            a.role,
            clientId,
            JSON.stringify(ids),
            ctx.user.userId,
            timestamp,
            expiresAt,
            ctx.tenantId,
            commandId,
          ),
      );
      return {
        invitationId,
        email,
        role: a.role,
        clientId,
        engagementIds: ids,
        expiresAt,
      };
    },
  },
  cancelInvitation: {
    roles,
    async handle({ commandId, timestamp, guard, statements }, data, ctx) {
      const { invitationId } = z
        .object({ invitationId: short })
        .strict()
        .parse(data);
      const row = await db()
        .prepare(
          "SELECT email FROM invitations WHERE tenant_id=? AND id=? AND status='pending'",
        )
        .bind(ctx.tenantId, invitationId)
        .first<{ email: string }>();
      if (!row) throw new ApiError(404, "No pending invitation to cancel");
      statements.push(
        db()
          .prepare(
            "UPDATE invitations SET status='cancelled',closed_at=? WHERE tenant_id=? AND id=? AND status='pending' AND " +
              guard,
          )
          .bind(timestamp, ctx.tenantId, invitationId, ctx.tenantId, commandId),
      );
      return { invitationId, email: row.email, status: "cancelled" };
    },
  },
});
