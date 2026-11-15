import { z } from "../../zod";
import { assertEngagementQuota } from "../../access-policy";
import { db } from "../../bindings";
import { roles } from "../../domain/types";
import { resolveNew } from "../../criteria/pin";
import { freshEngagement } from "../../factories";
import { ApiError } from "../../http";
import { sha256 } from "../../ids";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementModule } from "./batch";
/**
 * Opening an engagement for a client: its first version and snapshot, an
 * access policy, and access for the admin who created it, within the
 * practice's engagement quota (lib/access-policy.ts).
 */
export const engagements: ManagementModule = defineCommands({
  createEngagement: {
    roles,
    async handle({ commandId, timestamp, guard, statements }, data, ctx) {
      const a = z
        .object({
          clientId: short,
          title: short,
          // The criteria pack (docs/design/criteria-model.md section 10):
          // the default pack, or the current version of the chosen one.
          packId: short.optional(),
          packVersion: short.optional(),
        })
        .refine((v) => !v.packVersion || v.packId, "Choose a criteria pack")
        .parse(data);
      const resolved = resolveNew(a.packId, a.packVersion);
      if (
        !(await db()
          .prepare("SELECT id FROM clients WHERE tenant_id=? AND id=?")
          .bind(ctx.tenantId, a.clientId)
          .first())
      )
        throw new ApiError(404, "Client not found");
      await assertEngagementQuota(db(), ctx.tenantId);
      const engagement = freshEngagement(
          resolved,
          a.clientId,
          a.title,
          ctx.user.userId,
          true,
        ),
        body = JSON.stringify(engagement);
      statements.push(
        db()
          .prepare(
            "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) SELECT ?,?,?,?,?,?,? WHERE " +
              guard,
          )
          .bind(
            ctx.tenantId,
            engagement.id,
            a.clientId,
            a.title,
            1,
            body,
            "init",
            ctx.tenantId,
            commandId,
          ),
      );
      statements.push(
        db()
          .prepare(
            "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) SELECT ?,?,?,?,?,? WHERE " +
              guard,
          )
          .bind(
            ctx.tenantId,
            engagement.id,
            1,
            body,
            await sha256(body),
            timestamp,
            ctx.tenantId,
            commandId,
          ),
      );
      statements.push(
        db()
          .prepare(
            "INSERT INTO engagement_access_policies(tenant_id,engagement_id,created_at) SELECT ?,?,? WHERE " +
              guard,
          )
          .bind(
            ctx.tenantId,
            engagement.id,
            timestamp,
            ctx.tenantId,
            commandId,
          ),
      );
      statements.push(
        db()
          .prepare(
            "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE " +
              guard,
          )
          .bind(
            ctx.tenantId,
            engagement.id,
            ctx.user.userId,
            ctx.user.userId,
            timestamp,
            ctx.tenantId,
            commandId,
          ),
      );
      return {
        engagementId: engagement.id,
        clientId: a.clientId,
        title: a.title,
        pack: {
          id: resolved.pin.packId,
          version: resolved.pin.packVersion,
          sha256: resolved.pin.packSha256,
        },
      };
    },
  },
});
