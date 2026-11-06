// Engagement persistence: loading and saving an engagement with its snapshot
// and audit event. The D1 and R2 bindings (bindings.ts) and the identifiers
// and hashes (ids.ts) are re-exported for the modules that import them here.
import { db } from "./bindings";
import type { Engagement } from "./domain";
import { migrateClassification } from "./domain/classification";
import {
  dehydrate,
  hydrate,
  IntegrityError,
  type HydrateParts,
} from "./engagement-storage";
import { ApiError } from "./http";
import { id, now, sha256 } from "./ids";
import { assertSaveQuota } from "./access-policy";
import { refuseReadOnly, type Context } from "./tenancy";
import {
  isClientRole,
  activeGrant,
  approvalStatus,
  metadataLimit,
  metadataReserve,
  type ApprovalStatus,
} from "./workflow-state";
export { bucket, db } from "./bindings";
export { id, now, sha256 } from "./ids";
/**
 * The stored size and approval status of each engagement as getEngagement()
 * loaded it or save() last stored it: what the metadata limit checks a write
 * against.
 */
const stored = new WeakMap<
  Engagement,
  { bytes: number; approval: ApprovalStatus }
>();
const byteLength = (body: string) => new TextEncoder().encode(body).byteLength;
/** The bytes the engagement occupies as stored, when it was loaded here. */
export const storedSize = (e: Engagement) => stored.get(e)?.bytes;
/**
 * Engagements loaded without all their immutable parts (loadEngagement, or
 * getEngagement with `parts`): for reading only, never for save().
 */
const partial = new WeakSet<Engagement>();
/**
 * Loads the engagement's D1 record for a caller who may open it, without its
 * immutable R2 parts (report snapshots stay empty objects, paper histories and
 * run results empty lists): enough for access checks, workflow state and work
 * items, and never saved. A body that is not JSON raises IntegrityError (for a
 * Client Contributor, whose grant it would hold, 404).
 */
export async function loadEngagement(ctx: Context, engagementId: string) {
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
  let e: Engagement;
  try {
    e = JSON.parse(row.body) as Engagement;
  } catch {
    // A Client Contributor's access rests on a grant inside the body, so an
    // unreadable body cannot show one: 404, as the directory decides it
    // (engagementList), before anything about the record is revealed.
    if (ctx.role === "Client Contributor")
      throw new ApiError(404, "Engagement not found");
    throw new IntegrityError(engagementId, "unreadable", "body");
  }
  e.version = row.version;
  // A classification recorded before #19 loads with every fact unknown.
  e.classification = migrateClassification(e.classification);
  if (
    ctx.role === "Client Contributor" &&
    activeGrant(
      e.workflow,
      ctx.user.userId,
      undefined,
      undefined,
      ctx.accessSince,
    ).length === 0
  )
    throw new ApiError(404, "Engagement not found");
  stored.set(e, {
    bytes: byteLength(row.body),
    approval: approvalStatus(e.workflow),
  });
  partial.add(e);
  return e;
}
/**
 * Loads the engagement for a caller who may open it, with its immutable parts
 * read from R2 in parallel (or only the `parts` named, which leaves it for
 * reading only). A missing, unavailable or altered part raises IntegrityError.
 */
export async function getEngagement(
  ctx: Context,
  engagementId: string,
  parts?: HydrateParts,
) {
  const e = await loadEngagement(ctx, engagementId);
  await hydrate(e, ctx, parts);
  if (!parts) partial.delete(e);
  return e;
}
/**
 * Stores the engagement with its snapshot and audit event in one D1 batch,
 * if it is still at `expectedVersion`. A write that would take the stored
 * record over the metadata limit, or take the room kept under it for
 * approving the scope and program (metadataReserve in lib/workflow-state.ts),
 * is refused with 413 before anything is written. Client Viewers never write,
 * a Client Contributor writes only under a live request grant named in
 * `details` (F-56), and each practice saves at most its hourly quota of
 * versions (lib/access-policy.ts).
 */
export async function save(
  ctx: Context,
  e: Engagement,
  expectedVersion: number,
  action: string,
  details: Record<string, unknown>,
  extra: (commandId: string) => D1PreparedStatement[] = () => [],
) {
  refuseReadOnly(ctx);
  if (partial.has(e))
    throw new Error("A partially loaded engagement cannot be saved");
  if (
    ctx.role === "Client Contributor" &&
    !(
      typeof details.grantId === "string" &&
      typeof details.requestId === "string" &&
      activeGrant(
        e.workflow,
        ctx.user.userId,
        details.requestId,
        Date.now(),
        ctx.accessSince,
      ).some((g) => g.id === details.grantId)
    )
  )
    throw new ApiError(403, "Request access expired or was revoked");
  await assertSaveQuota(db(), ctx.tenantId);
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
    hash = await sha256(body),
    bytes = byteLength(body),
    // An engagement not loaded here counts as growing from nothing.
    loaded = stored.get(e) ?? {
      bytes: 0,
      approval: approvalStatus(e.workflow),
    };
  if (bytes > metadataLimit)
    throw new ApiError(
      413,
      "This change would take the engagement record over its " +
        metadataLimit / 1_000_000 +
        " MB limit. Nothing was saved. Shorten the text you are adding, or continue in a follow-up engagement.",
    );
  const reserve = metadataReserve(loaded.approval, e.workflow, action);
  if (
    reserve &&
    bytes > metadataLimit - reserve.bytes &&
    (reserve.whole || bytes > loaded.bytes)
  )
    throw new ApiError(413, reserve.refusal);
  const guard =
    "EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)";
  const accessGuard =
    ctx.role === "Client Contributor"
      ? " AND EXISTS(SELECT 1 FROM json_each(engagements.body,'$.workflow.clientGrants') g WHERE json_extract(g.value,'$.id')=? AND json_extract(g.value,'$.userId')=? AND json_extract(g.value,'$.requestId')=? AND json_extract(g.value,'$.active')=1 AND julianday(json_extract(g.value,'$.expiresAt'))>julianday('now') AND json_extract(g.value,'$.at')>=COALESCE((SELECT access_since FROM memberships WHERE tenant_id=engagements.tenant_id AND user_id=?),''))"
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
              ctx.user.userId,
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
  stored.set(e, { bytes, approval: approvalStatus(e.workflow) });
  return e;
}
