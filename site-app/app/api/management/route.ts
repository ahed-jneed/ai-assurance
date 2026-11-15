import { z } from "../../../lib/zod";
import { db } from "@/lib/bindings";
import { short } from "@/lib/commands/fields";
import { dispatchManagement, managementOps } from "@/lib/commands/management";
import { ApiError, checkOrigin, readJson, responseError } from "@/lib/http";
import { id, now, sha256 } from "@/lib/ids";
import { context, refuseReadOnly, requireAdmin } from "@/lib/tenancy";

export const dynamic = "force-dynamic";
const command = z
  .object({
    tenantId: short,
    expectedVersion: z.number().int().positive(),
    op: z.enum(managementOps),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * Parse → context → practice-admin check → dispatch (lib/commands/management)
 * → one batch that bumps the tenant's management version, runs the op's
 * statements and records the management event.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const payload = command.parse(await readJson(request, 16384));
    const ctx = await context(payload.tenantId);
    refuseReadOnly(ctx);
    requireAdmin(ctx);
    const commandId = id("MGMT"),
      timestamp = now();
    const guard =
      "EXISTS(SELECT 1 FROM tenants WHERE id=? AND last_command_id=?)";
    const statements: D1PreparedStatement[] = [];
    const details = await dispatchManagement(
      { commandId, timestamp, guard, statements },
      payload.op,
      payload.data,
      ctx,
    );
    const event = {
      id: id("ME"),
      actor: ctx.user.userId,
      action: payload.op,
      details,
      createdAt: timestamp,
    };
    const result = await db().batch([
      db()
        .prepare(
          "UPDATE tenants SET version=version+1,last_command_id=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM memberships m JOIN practice_admins a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND a.active=1)",
        )
        .bind(
          commandId,
          ctx.tenantId,
          payload.expectedVersion,
          ctx.tenantId,
          ctx.user.userId,
        ),
      ...statements,
      db()
        .prepare(
          "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) SELECT ?,?,?,?,?,?,? WHERE " +
            guard,
        )
        .bind(
          ctx.tenantId,
          event.id,
          event.actor,
          event.action,
          JSON.stringify(details),
          await sha256(JSON.stringify(event)),
          timestamp,
          ctx.tenantId,
          commandId,
        ),
    ]);
    if (!result[0].meta.changes)
      throw new ApiError(
        409,
        "Client or access settings changed. Reload before saving.",
      );
    return Response.json({
      details,
      managementVersion: payload.expectedVersion + 1,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    return responseError(error);
  }
}
