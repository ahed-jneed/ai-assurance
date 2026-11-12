import { sanitize } from "../client-projection";
import {
  criteriaRegistry,
  criteriaView,
  defaultCatalog,
  pinnedCatalog,
} from "../criteria/pin";
import { selectablePacks } from "../criteria/registry";
import type { Engagement } from "../domain";
import { parseReportSettings } from "../domain/report-model";
import { db, getEngagement, storedSize } from "../engagement-repo";
import {
  IntegrityError,
  integrityIncidents,
  recordIntegrityIncident,
} from "../engagement-storage";
import { effectiveCoolingOffDays } from "../quality-review-policy";
import type { Context } from "../tenancy";
import { isClientRole, isInternalRole } from "../workflow-state";

/** A row of the engagement directory. */
export type EngagementRow = {
  id: string;
  client_id: string;
  title: string;
  version: number;
  stage: string | null;
  due_date: string | null;
  /** Why the engagement cannot be opened now, when its record is damaged. */
  integrity_error?: string;
};
/** What a member is told about an engagement that failed to load intact. */
export const integrityMessage = (error: IntegrityError) =>
  error.message +
  (error.kind === "unavailable"
    ? ". Retry shortly; other engagements are unaffected."
    : ". It cannot be opened until its record is restored; other engagements are unaffected and the incident was recorded.");
const unreadableBody = integrityMessage(
  new IntegrityError("", "unreadable", "body"),
);
// The body is read with json_extract only where it is valid JSON, so one
// damaged record never fails the query for everyone.
const readable = (column: string) =>
  `CASE WHEN json_valid(e.body) THEN json_extract(e.body,'${column}') END`;
/**
 * The engagements the caller may open, decided in SQL without loading any
 * engagement: internal members by their active engagement grant, a Client
 * Viewer by their client, and a Client Contributor by their client and a live
 * request grant in the engagement (as activeGrant in lib/workflow-state.ts
 * decides it). A record whose body is not JSON is listed with an integrity
 * error for those who would see it by grant or client alone.
 */
export async function engagementList(ctx: Context): Promise<EngagementRow[]> {
  const filter = isClientRole(ctx.role)
      ? " AND e.client_id=?" +
        (ctx.role === "Client Contributor"
          ? " AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(e.body) THEN e.body ELSE '{}' END,'$.workflow.clientGrants') g WHERE json_extract(g.value,'$.active')=1 AND json_extract(g.value,'$.userId')=? AND julianday(json_extract(g.value,'$.expiresAt'))>julianday('now') AND (? IS NULL OR json_extract(g.value,'$.at')>=?))"
          : "")
      : " AND EXISTS(SELECT 1 FROM engagement_access a WHERE a.tenant_id=e.tenant_id AND a.engagement_id=e.id AND a.user_id=? AND a.active=1)",
    args = isClientRole(ctx.role)
      ? [
          ctx.clientId,
          ...(ctx.role === "Client Contributor"
            ? [
                ctx.user.userId,
                ctx.accessSince ?? null,
                ctx.accessSince ?? null,
              ]
            : []),
        ]
      : [ctx.user.userId];
  const rows = (
    await db()
      .prepare(
        `SELECT e.id,e.client_id,e.title,e.version,${readable("$.stage")} AS stage,${readable("$.dueDate")} AS due_date,json_valid(e.body) AS valid FROM engagements e WHERE e.tenant_id=?` +
          filter +
          " ORDER BY e.title",
      )
      .bind(ctx.tenantId, ...args)
      .all<EngagementRow & { valid: number }>()
  ).results;
  return rows.map(({ valid, ...row }) =>
    valid ? row : { ...row, integrity_error: unreadableBody },
  );
}
/**
 * What changes with each save of the engagement besides the engagement itself,
 * for internal members: its latest audit events and stored size (for the audit
 * program's warning near the metadata limit). The workspace GET and the
 * response to each workspace command return it, so the UI applies a save
 * without reloading the workspace.
 */
export async function engagementTrail(ctx: Context, e: Engagement) {
  if (!isInternalRole(ctx.role)) return { events: [], metadataBytes: null };
  const events = (
    await db()
      .prepare(
        "SELECT id,actor,action,hash,previous_hash,created_at,details FROM audit_events WHERE tenant_id=? AND engagement_id=? ORDER BY created_at DESC LIMIT 30",
      )
      .bind(ctx.tenantId, e.id)
      .all()
  ).results;
  return { events, metadataBytes: storedSize(e) ?? null };
}
/** How many engagements the default selection tries before giving up. */
const defaultAttempts = 3;
/**
 * What the workspace loads for the caller: their practices, the clients and
 * engagements they may open, the selected engagement projected for their role,
 * its people and audit trail, and practice administration data for admins.
 * Without a requested engagement the first permitted one that loads intact is
 * selected.
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
  const engagementRows = await engagementList(ctx);
  for (const row of engagementRows)
    if (row.integrity_error)
      await recordIntegrityIncident(
        ctx,
        new IntegrityError(row.id, "unreadable", "body"),
      );
  if (isInternalRole(ctx.role) && !ctx.practiceAdmin)
    clientRows = clientRows.filter((c) =>
      engagementRows.some((e) => e.client_id === c.id),
    );
  // Only the selected engagement is loaded with its R2 parts. One that fails
  // to load intact leaves the rest of the workspace usable: the row carries an
  // integrity error and the response says why nothing is selected. Without a
  // requested engagement the default selection falls back past engagements
  // whose body or R2 parts are damaged, trying at most defaultAttempts so a
  // widespread outage never reads the parts of every engagement.
  const candidates = requestedEngagementId
    ? [requestedEngagementId]
    : engagementRows
        .filter((row) => !row.integrity_error)
        .slice(0, defaultAttempts)
        .map((row) => row.id);
  let e: Engagement | null = null,
    engagementError: { engagementId: string; error: string } | null = null;
  for (const candidateId of candidates) {
    try {
      e = await getEngagement(ctx, candidateId);
      engagementError = null;
      break;
    } catch (error) {
      if (!(error instanceof IntegrityError)) throw error;
      const row = engagementRows.find((row) => row.id === candidateId);
      if (!row?.integrity_error) await recordIntegrityIncident(ctx, error);
      const message = integrityMessage(error);
      // When nothing opens, the response names the first engagement tried.
      engagementError ??= { engagementId: candidateId, error: message };
      if (row) row.integrity_error = message;
    }
  }
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
  const tenant = (await db()
    .prepare(
      "SELECT version,eqr_cooling_off_days AS cooling_off_days,report_settings FROM tenants WHERE id=?",
    )
    .bind(ctx.tenantId)
    .first<{
      version: number;
      cooling_off_days: number | null;
      report_settings: string | null;
    }>())!;
  const managementVersion = tenant.version;
  // The practice's quality review policy, for its internal members: the
  // quality review panel and practice settings show it.
  const qualityReviewPolicy = isInternalRole(ctx.role)
    ? {
        coolingOffDays: effectiveCoolingOffDays(tenant.cooling_off_days),
        practiceSet: typeof tenant.cooling_off_days === "number",
      }
    : null;
  // What a new report states unless the Lead Auditor overrides it; clients
  // read reports only as issued.
  const reportSettings = isInternalRole(ctx.role)
    ? parseReportSettings(tenant.report_settings)
    : null;
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
  // Damaged engagement records found by any member (#16), for the practice's
  // administrators; read after this request recorded its own.
  const incidents = ctx.practiceAdmin ? await integrityIncidents(ctx) : null;
  const trail = e ? await engagementTrail(ctx, e) : null;
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
    engagementError,
    metadataBytes: trail?.metadataBytes ?? null,
    members,
    invitations,
    people,
    managementVersion,
    qualityReviewPolicy,
    managementEvents,
    integrityIncidents: incidents,
    reportSettings,
    events: trail?.events ?? [],
    // The catalogue projection of the engagement's pinned pack (or the
    // default pack without one), and what the pack switches on
    // (docs/design/criteria-model.md section 10).
    catalog: isClientRole(ctx.role)
      ? null
      : e
        ? pinnedCatalog(e)
        : defaultCatalog(),
    criteria: e ? criteriaView(e, isInternalRole(ctx.role)) : null,
    selectablePacks: ctx.practiceAdmin
      ? selectablePacks(criteriaRegistry())
      : [],
  };
}
