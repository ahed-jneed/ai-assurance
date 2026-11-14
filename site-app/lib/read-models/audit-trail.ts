// GET /api/audit-trail (#181): the engagement's audit trail in cursor pages,
// newest first, filtered by actor, event type and date range
// (event-pages.ts). The workspace load carries only the latest events
// (engagementTrail in workspace-view.ts); this read pages through all of
// them.
import { db } from "../bindings";
import { ApiError } from "../http";
import type { Context } from "../tenancy";
import { isInternalRole } from "../workflow-state";
import {
  eventFilters,
  toPage,
  type EventPage,
  type EventQuery,
} from "./event-pages";

/** One audit event as the trail lists it. */
export type TrailEvent = {
  id: string;
  actor: string;
  /** The actor's display name in the practice, or their user id without a membership. */
  actor_name: string;
  action: string;
  hash: string;
  previous_hash: string;
  created_at: string;
  details: string;
};

/** A page of the trail, with what its filters can choose from. */
export type TrailPage = EventPage<TrailEvent> & {
  /** Everyone who acted in the engagement, by name. */
  actors: { id: string; name: string }[];
  /** Every event type recorded in the engagement. */
  actions: string[];
};

/**
 * A page of the engagement's audit trail. As with the trail the workspace
 * load returns, the practice's engagement staff read it, and only for an
 * engagement they hold an active grant to (as loadEngagement checks); client
 * roles are refused before the engagement is looked up, and another
 * practice's engagement, or one without a grant, is 404.
 */
export async function auditTrailPage(
  ctx: Context,
  engagementId: string,
  q: EventQuery,
): Promise<TrailPage> {
  if (!isInternalRole(ctx.role))
    throw new ApiError(
      403,
      "The audit trail is for the practice's engagement staff",
    );
  if (
    !engagementId ||
    !(await db()
      .prepare(
        "SELECT 1 FROM engagements e JOIN engagement_access a ON a.tenant_id=e.tenant_id AND a.engagement_id=e.id WHERE e.tenant_id=? AND e.id=? AND a.user_id=? AND a.active=1",
      )
      .bind(ctx.tenantId, engagementId, ctx.user.userId)
      .first())
  )
    throw new ApiError(404, "Engagement not found");
  const filters = eventFilters(q);
  const name =
    "COALESCE((SELECT m.display_name FROM memberships m WHERE m.tenant_id=? AND m.user_id=actor),actor)";
  const [rows, actors, actions] = await Promise.all([
    db()
      .prepare(
        `SELECT id,actor,${name} AS actor_name,action,hash,previous_hash,created_at,details FROM audit_events WHERE tenant_id=? AND engagement_id=?` +
          filters.sql +
          " ORDER BY created_at DESC,id DESC LIMIT ?",
      )
      .bind(
        ctx.tenantId,
        ctx.tenantId,
        engagementId,
        ...filters.args,
        q.limit + 1,
      )
      .all<TrailEvent>(),
    db()
      .prepare(
        `SELECT actor AS id,${name} AS name FROM (SELECT DISTINCT actor FROM audit_events WHERE tenant_id=? AND engagement_id=?) ORDER BY name`,
      )
      .bind(ctx.tenantId, ctx.tenantId, engagementId)
      .all<{ id: string; name: string }>(),
    db()
      .prepare(
        "SELECT DISTINCT action FROM audit_events WHERE tenant_id=? AND engagement_id=? ORDER BY action",
      )
      .bind(ctx.tenantId, engagementId)
      .all<{ action: string }>(),
  ]);
  return {
    ...toPage(rows.results, q.limit),
    actors: actors.results,
    actions: actions.results.map((a) => a.action),
  };
}
