import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain";
import { freshEngagement } from "../../factories";
import { ApiError } from "../../http";
import { sha256 } from "../../ids";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementModule } from "./batch";
/**
 * Opening an engagement for a client: its first version and snapshot, an
 * access policy, and access for the admin who created it.
 */
export const engagements: ManagementModule = defineCommands({
  createEngagement: {
    roles,
    async handle({ commandId, timestamp, guard, statements }, data, ctx) {
      const a = z.object({ clientId: short, title: short }).parse(data);
      if (
        !(await db()
          .prepare("SELECT id FROM clients WHERE tenant_id=? AND id=?")
          .bind(ctx.tenantId, a.clientId)
          .first())
      )
        throw new ApiError(404, "Client not found");
      const engagement = freshEngagement(
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
      };
    },
  },
});
