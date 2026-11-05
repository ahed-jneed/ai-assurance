import { z } from "zod";
import { recordStatement } from "../../assurance-store";
import { db } from "../../bindings";
import { save } from "../../engagement-repo";
import { ApiError } from "../../http";
import { now } from "../../ids";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";
/**
 * Who may open the engagement: a Lead Auditor grants or revokes an internal
 * member's access and records the reason.
 */
export const access: AssuranceModule = defineCommands({
  setAccess: {
    roles: ["Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z
        .object({ userId: short, active: z.boolean(), reason: note })
        .strict()
        .parse(d);
      if (v.userId === ctx.user.userId && !v.active)
        throw new ApiError(400, "You cannot revoke your own engagement access");
      if (
        !(await db()
          .prepare(
            "SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' AND role IN ('Auditor','Lead Auditor','Reviewer')",
          )
          .bind(ctx.tenantId, v.userId)
          .first())
      )
        throw new ApiError(400, "Select an active internal member");
      const log = await recordStatement(ctx, e.id, "access_event", v);
      await save(
        ctx,
        e,
        e.version,
        "setEngagementAccess",
        { userId: v.userId, active: v.active },
        (cmd) => [
          db()
            .prepare(
              "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?) ON CONFLICT(tenant_id,engagement_id,user_id) DO UPDATE SET active=excluded.active,actor=excluded.actor,updated_at=excluded.updated_at",
            )
            .bind(
              ctx.tenantId,
              e.id,
              v.userId,
              v.active ? 1 : 0,
              ctx.user.userId,
              now(),
              ctx.tenantId,
              e.id,
              cmd,
            ),
          log.guarded(cmd),
        ],
      );
      return { record: log.record };
    },
  },
});
