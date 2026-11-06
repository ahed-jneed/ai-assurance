import catalog from "../catalog.json";
import { sanitize } from "../client-projection";
import { db, getEngagement, storedSize } from "../engagement-repo";
import { ApiError } from "../http";
import type { Context } from "../tenancy";
import { isClientRole, isInternalRole } from "../workflow-state";
/**
 * What the workspace loads for the caller: their practices, the clients and
 * engagements they may open, the selected engagement projected for their role,
 * its people and audit trail, and practice administration data for admins.
 * Without a requested engagement the first permitted one is selected.
 */
export async function workspaceView(
  ctx: Context,
  requestedEngagementId: string | null,
) {
  const memberships = (
    await db()
      .prepare(
        "SELECT m.tenant_id,t.name,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='active' ORDER BY t.name",
      )
      .bind(ctx.user.userId)
      .all()
  ).results;
  let clientRows = (
    await db()
      .prepare(
        "SELECT id,name,sector FROM clients WHERE tenant_id=?" +
          (isClientRole(ctx.role) ? " AND id=?" : "") +
          " ORDER BY name",
      )
      .bind(ctx.tenantId, ...(isClientRole(ctx.role) ? [ctx.clientId] : []))
      .all()
  ).results;
  let engagementRows = (
    await db()
      .prepare(
        "SELECT id,client_id,title,version,json_extract(body,'$.stage') AS stage,json_extract(body,'$.dueDate') AS due_date FROM engagements WHERE tenant_id=?" +
          (isClientRole(ctx.role) ? " AND client_id=?" : "") +
          " ORDER BY title",
      )
      .bind(ctx.tenantId, ...(isClientRole(ctx.role) ? [ctx.clientId] : []))
      .all()
  ).results;
  if (ctx.role !== "Client Viewer") {
    const granted = [];
    for (const row of engagementRows) {
      try {
        await getEngagement(ctx, String(row.id));
        granted.push(row);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    engagementRows = granted;
  }
  if (isInternalRole(ctx.role) && !ctx.practiceAdmin)
    clientRows = clientRows.filter((c) =>
      engagementRows.some((e) => e.client_id === c.id),
    );
  const selectedId =
    requestedEngagementId ?? (engagementRows[0]?.id as string | undefined);
  const e = selectedId ? await getEngagement(ctx, selectedId) : null;
  // Administrators see each member's live engagement grants, sponsored runner
  // workers and administration, and the pending invitations.
  const members = ctx.practiceAdmin
    ? (
        await db()
          .prepare(
            "SELECT m.user_id,m.role,m.client_id,m.display_name,m.status,EXISTS(SELECT 1 FROM practice_admins a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.active=1) AS practice_admin,(SELECT json_group_array(json_object('id',e.id,'title',e.title)) FROM engagement_access x JOIN engagements e ON e.tenant_id=x.tenant_id AND e.id=x.engagement_id WHERE x.tenant_id=m.tenant_id AND x.user_id=m.user_id AND x.active=1) AS grants,(SELECT COUNT(*) FROM runner_workers w WHERE w.tenant_id=m.tenant_id AND w.created_by=m.user_id AND w.active=1) AS sponsored_workers FROM memberships m WHERE m.tenant_id=? ORDER BY m.display_name",
          )
          .bind(ctx.tenantId)
          .all<Record<string, unknown>>()
      ).results.map((m) => ({
        ...m,
        practice_admin: !!m.practice_admin,
        grants: JSON.parse(String(m.grants ?? "[]")) as {
          id: string;
          title: string;
        }[],
      }))
    : [];
  const invitations = ctx.practiceAdmin
    ? (
        await db()
          .prepare(
            "SELECT id,email,display_name,role,client_id,engagement_ids,invited_by,created_at,expires_at FROM invitations WHERE tenant_id=? AND status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 100",
          )
          .bind(ctx.tenantId, new Date().toISOString())
          .all<Record<string, unknown>>()
      ).results.map((i) => ({
        ...i,
        engagement_ids: JSON.parse(
          String(i.engagement_ids ?? "[]"),
        ) as string[],
      }))
    : [];
  const people = isInternalRole(ctx.role)
    ? (
        await db()
          .prepare(
            "SELECT m.user_id,m.display_name,m.role,m.status,m.client_id FROM memberships m JOIN engagement_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.status='active' AND a.engagement_id=? AND a.active=1",
          )
          .bind(ctx.tenantId, e?.id ?? "")
          .all()
      ).results
    : [];
  const managementVersion = (await db()
    .prepare("SELECT version FROM tenants WHERE id=?")
    .bind(ctx.tenantId)
    .first<{
      version: number;
    }>())!.version;
  const managementEvents = ctx.practiceAdmin
    ? (
        await db()
          .prepare(
            "SELECT id,actor,action,details,hash,created_at FROM management_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30",
          )
          .bind(ctx.tenantId)
          .all()
      ).results
    : [];
  const events =
    e && isInternalRole(ctx.role)
      ? (
          await db()
            .prepare(
              "SELECT id,actor,action,hash,previous_hash,created_at,details FROM audit_events WHERE tenant_id=? AND engagement_id=? ORDER BY created_at DESC LIMIT 30",
            )
            .bind(ctx.tenantId, e.id)
            .all()
        ).results
      : [];
  return {
    identity: {
      id: ctx.user.userId,
      name: ctx.user.displayName,
      role: ctx.role,
      practiceAdmin: ctx.practiceAdmin,
    },
    tenantId: ctx.tenantId,
    memberships,
    clients: clientRows,
    engagements: engagementRows,
    engagement: e ? sanitize(e, ctx) : null,
    // The stored size, for the audit program's warning near the limit.
    metadataBytes:
      e && isInternalRole(ctx.role) ? (storedSize(e) ?? null) : null,
    members,
    invitations,
    people,
    managementVersion,
    managementEvents,
    events,
    catalog: isClientRole(ctx.role) ? null : catalog,
  };
}
