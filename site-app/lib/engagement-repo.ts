// Engagement persistence: loading and saving an engagement with its snapshot
// and audit event. The D1 and R2 bindings (bindings.ts) and the identifiers
// and hashes (ids.ts) are re-exported for the modules that import them here.
import { db } from "./bindings";
import type { Engagement } from "./domain";
import { hydrate, dehydrate } from "./engagement-storage";
import { ApiError } from "./http";
import { id, now, sha256 } from "./ids";
import type { Context } from "./tenancy";
import { isClientRole, activeGrant } from "./workflow-state";
export { bucket, db } from "./bindings";
export { id, now, sha256 } from "./ids";
export async function getEngagement(ctx: Context, engagementId: string) {
  const row = await db()
    .prepare(
      "SELECT body,version,client_id FROM engagements WHERE tenant_id=? AND id=?",
    )
    .bind(ctx.tenantId, engagementId)
    .first<{ body: string; version: number; client_id: string }>();
  if (!row || (isClientRole(ctx.role) && ctx.clientId !== row.client_id))
    throw new ApiError(404, "Engagement not found");
  if (
    !isClientRole(ctx.role) &&
    !(await db()
      .prepare(
        "SELECT 1 FROM engagement_access WHERE tenant_id=? AND engagement_id=? AND user_id=? AND active=1",
      )
      .bind(ctx.tenantId, engagementId, ctx.user.userId)
      .first())
  )
    throw new ApiError(404, "Engagement not found");
  const e = JSON.parse(row.body) as Engagement;
  e.version = row.version;
  if (
    ctx.role === "Client Contributor" &&
    activeGrant(e.workflow, ctx.user.userId).length === 0
  )
    throw new ApiError(404, "Engagement not found");
  return hydrate(e);
}
export async function save(
  ctx: Context,
  e: Engagement,
  expectedVersion: number,
  action: string,
  details: Record<string, unknown>,
  extra: (commandId: string) => D1PreparedStatement[] = () => [],
) {
  const commandId = id("CMD"),
    event = {
      id: id("EV"),
      actor: ctx.user.userId,
      action,
      previousHash: e.eventHead,
      createdAt: now(),
      details,
    },
    eventHash = await sha256(JSON.stringify(event));
  e.eventHead = eventHash;
  e.version = expectedVersion + 1;
  const body = JSON.stringify(await dehydrate(ctx, e)),
    hash = await sha256(body);
  if (new TextEncoder().encode(body).byteLength > 1500000)
    throw new ApiError(
      413,
      "The active engagement metadata exceeds its 1.5 MB limit. Archive supplementary active records or split this engagement before adding more content.",
    );
  const guard =
    "EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)";
  const accessGuard =
    ctx.role === "Client Contributor"
      ? " AND EXISTS(SELECT 1 FROM json_each(engagements.body,'$.workflow.clientGrants') g WHERE json_extract(g.value,'$.id')=? AND json_extract(g.value,'$.userId')=? AND json_extract(g.value,'$.requestId')=? AND json_extract(g.value,'$.active')=1 AND julianday(json_extract(g.value,'$.expiresAt'))>julianday('now'))"
      : isClientRole(ctx.role)
        ? ""
        : " AND EXISTS(SELECT 1 FROM engagement_access WHERE tenant_id=? AND engagement_id=? AND user_id=? AND active=1)";
  const results = await db().batch([
    db()
      .prepare(
        "UPDATE engagements SET body=?,title=?,version=?,last_command_id=? WHERE tenant_id=? AND id=? AND version=? AND EXISTS(SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND role=? AND client_id IS ? AND status='active')" +
          accessGuard,
      )
      .bind(
        body,
        e.title,
        e.version,
        commandId,
        ctx.tenantId,
        e.id,
        expectedVersion,
        ctx.tenantId,
        ctx.user.userId,
        ctx.role,
        ctx.clientId,
        ...(ctx.role === "Client Contributor"
          ? [
              String(details.grantId ?? ""),
              ctx.user.userId,
              String(details.requestId ?? ""),
            ]
          : isClientRole(ctx.role)
            ? []
            : [ctx.tenantId, e.id, ctx.user.userId]),
      ),
    db()
      .prepare(
        "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) SELECT ?,?,?,?,?,? WHERE " +
          guard,
      )
      .bind(
        ctx.tenantId,
        e.id,
        e.version,
        body,
        hash,
        now(),
        ctx.tenantId,
        e.id,
        commandId,
      ),
    db()
      .prepare(
        "INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) SELECT ?,?,?,?,?,?,?,?,? WHERE " +
          guard,
      )
      .bind(
        ctx.tenantId,
        e.id,
        event.id,
        event.actor,
        event.action,
        event.previousHash,
        eventHash,
        event.createdAt,
        JSON.stringify(details),
        ctx.tenantId,
        e.id,
        commandId,
      ),
    ...extra(commandId),
  ]);
  if (!results[0].meta.changes)
    throw new ApiError(
      409,
      "The engagement changed. Reload and apply your changes again.",
    );
  return e;
}
