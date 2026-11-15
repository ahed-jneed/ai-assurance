import { z } from "../../zod";
import { db } from "../../bindings";
import { roles } from "../../domain/types";
import { ApiError } from "../../http";
import { defineCommands } from "../command";
import { short } from "../fields";
import type { ManagementModule } from "./batch";
/**
 * Integrity incident handling (#151): a practice administrator (the route
 * requires one for every management op) acknowledges an open incident, so
 * the navigation badge stops counting it, or resolves it once the record is
 * restored. Each change is a management event naming the incident and its
 * previous handling. A resolved incident that a member meets again reopens
 * (recordIntegrityIncident in lib/engagement-storage.ts), so it is never
 * acknowledged afterwards.
 */
const handleIncident = z
  .object({
    engagementId: short,
    objectKey: z.string().min(1).max(1024),
    kind: z.enum(["missing", "unavailable", "mismatch", "unreadable"]),
    handling: z.enum(["acknowledged", "resolved"]),
  })
  .strict();

export const incidents: ManagementModule = defineCommands({
  handleIntegrityIncident: {
    roles,
    async handle({ commandId, guard, statements, timestamp }, data, ctx) {
      const a = handleIncident.parse(data);
      const key = [ctx.tenantId, a.engagementId, a.objectKey, a.kind];
      const row = await db()
        .prepare(
          "SELECT handling FROM integrity_incidents WHERE tenant_id=? AND engagement_id=? AND object_key=? AND kind=?",
        )
        .bind(...key)
        .first<{ handling: string }>();
      if (!row) throw new ApiError(404, "Integrity incident not found");
      if (row.handling === a.handling)
        throw new ApiError(409, "This incident is already " + a.handling);
      if (row.handling === "resolved")
        throw new ApiError(
          409,
          "This incident is resolved. It reopens if a member meets the damaged record again.",
        );
      statements.push(
        db()
          .prepare(
            "UPDATE integrity_incidents SET handling=?,handled_at=?,handled_by=? WHERE tenant_id=? AND engagement_id=? AND object_key=? AND kind=? AND handling=? AND " +
              guard,
          )
          .bind(
            a.handling,
            timestamp,
            ctx.user.userId,
            ...key,
            row.handling,
            ctx.tenantId,
            commandId,
          ),
      );
      return {
        engagementId: a.engagementId,
        objectKey: a.objectKey,
        kind: a.kind,
        handling: a.handling,
        previous: row.handling,
      };
    },
  },
});
