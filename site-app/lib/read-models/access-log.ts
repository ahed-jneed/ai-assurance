// GET /api/access-log (#181): the practice's Access log in cursor pages,
// newest first, filtered by actor, event type and date range
// (event-pages.ts), and its CSV export. It lists who was given, changed or
// lost membership, a role or practice administration, the invitations behind
// them, and members' sign-ins (sign_in_events, recorded by lib/tenancy.ts).
// A Lead Auditor and the practice's administrators read it
// (canSeeAccessLog in lib/permissions.ts); client roles never do.
import { csvCell } from "../criteria/coverage-filters";
import { db } from "../bindings";
import { ApiError } from "../http";
import { canSeeAccessLog } from "../permissions";
import type { Context } from "../tenancy";
import {
  eventFilters,
  maxPageSize,
  toPage,
  type EventPage,
  type EventQuery,
} from "./event-pages";

/**
 * The management events about membership, roles and practice
 * administration (lib/commands/management/members.ts, invitations.ts,
 * admins.ts and lib/invitations.ts), in the order the log's filter offers
 * them, then the sign-ins.
 */
export const accessLogActions = [
  "signIn",
  "grantMember",
  "updateMember",
  "revokeMember",
  "inviteMember",
  "cancelInvitation",
  "acceptInvitation",
  "supersedeInvitation",
  "grantAdmin",
  "revokeAdmin",
  "transferAdmin",
] as const;
const managementActions = accessLogActions.filter((a) => a !== "signIn");

/** One event of the Access log. */
export type AccessEvent = {
  id: string;
  created_at: string;
  /** A management op, or "signIn". */
  action: string;
  /** Who acted: the administrator, or the member who signed in or accepted. */
  actor: string;
  actor_name: string;
  /** The member the event is about, when it names one. */
  subject: string | null;
  /** Their display name, or the invited email for an invitation. */
  subject_name: string | null;
  /** The role granted, invited or held at sign-in, when the event states one. */
  role: string | null;
  /** The management event's details as recorded; null for a sign-in. */
  details: Record<string, unknown> | null;
};

/** A page of the log, with the people its actor filter can choose from. */
export type AccessLogPage = EventPage<AccessEvent> & {
  actors: { id: string; name: string }[];
  actions: readonly string[];
};

type Row = Omit<AccessEvent, "details"> & { details: string | null };

const json = (path: string) =>
  `CASE WHEN json_valid(e.details) THEN json_extract(e.details,'${path}') END`;
const name = (column: string) =>
  `(SELECT m.display_name FROM memberships m WHERE m.tenant_id=? AND m.user_id=${column})`;
// Both sources as one relation with the log's columns, so one ORDER BY and
// one cursor page through them together. Each branch binds the practice.
const events = `SELECT e.id,e.created_at,e.action,e.actor,COALESCE(${json("$.userId")},${json("$.to")}) AS subject,${json("$.email")} AS email,${json("$.role")} AS role,e.details FROM management_events e WHERE e.tenant_id=? AND e.action IN (${managementActions.map(() => "?").join(",")}) UNION ALL SELECT s.id,s.created_at,'signIn',s.user_id,s.user_id,NULL,s.role,NULL FROM sign_in_events s WHERE s.tenant_id=?`;
const eventArgs = (tenantId: string) => [
  tenantId,
  ...managementActions,
  tenantId,
];

function refuse(ctx: Context) {
  if (!canSeeAccessLog(ctx))
    throw new ApiError(
      403,
      "The Access log is for Lead Auditors and practice administrators",
    );
}

async function rows(ctx: Context, q: EventQuery): Promise<Row[]> {
  const filters = eventFilters(q);
  return (
    await db()
      .prepare(
        `SELECT id,created_at,action,actor,COALESCE(${name("actor")},actor) AS actor_name,subject,COALESCE(${name("subject")},email) AS subject_name,role,details FROM (${events}) WHERE 1=1` +
          filters.sql +
          " ORDER BY created_at DESC,id DESC LIMIT ?",
      )
      .bind(
        ctx.tenantId,
        ctx.tenantId,
        ...eventArgs(ctx.tenantId),
        ...filters.args,
        q.limit + 1,
      )
      .all<Row>()
  ).results;
}

function parseDetails(details: string | null) {
  if (details === null) return null;
  try {
    const value: unknown = JSON.parse(details);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A page of the practice's Access log. */
export async function accessLogPage(
  ctx: Context,
  q: EventQuery,
): Promise<AccessLogPage> {
  refuse(ctx);
  const [page, actors] = await Promise.all([
    rows(ctx, q),
    db()
      .prepare(
        `SELECT actor AS id,COALESCE(${name("actor")},actor) AS name FROM (SELECT DISTINCT actor FROM (${events})) ORDER BY name`,
      )
      .bind(ctx.tenantId, ...eventArgs(ctx.tenantId))
      .all<{ id: string; name: string }>(),
  ]);
  const { events: found, next } = toPage(page, q.limit);
  return {
    events: found.map((e) => ({ ...e, details: parseDetails(e.details) })),
    next,
    actors: actors.results,
    actions: accessLogActions,
  };
}

/** The most events one CSV export holds; a larger export asks for a narrower range. */
export const accessLogExportLimit = 20000;

export const accessLogCsvColumns = [
  "time_utc",
  "event_id",
  "event",
  "actor_id",
  "actor",
  "member_id",
  "member",
  "role",
  "details",
] as const;

/**
 * The Access log with the query's filters as CSV, every matching event from
 * its cursor on, newest first. More than accessLogExportLimit events is 413,
 * so an export is never silently cut short.
 */
export async function accessLogCsv(
  ctx: Context,
  q: EventQuery,
): Promise<{ filename: string; csv: string }> {
  refuse(ctx);
  const lines = [accessLogCsvColumns.join(",")];
  let after = q.after,
    count = 0;
  for (;;) {
    const page = toPage(
      await rows(ctx, { ...q, after, limit: maxPageSize * 5 }),
      maxPageSize * 5,
    );
    count += page.events.length;
    if (count > accessLogExportLimit)
      throw new ApiError(
        413,
        "The export would hold more than " +
          accessLogExportLimit +
          " events. Narrow the date range and export again.",
      );
    for (const e of page.events)
      lines.push(
        [
          e.created_at,
          e.id,
          e.action,
          e.actor,
          e.actor_name,
          e.subject,
          e.subject_name,
          e.role,
          e.details,
        ]
          .map(csvCell)
          .join(","),
      );
    if (!page.next) break;
    const last = page.events[page.events.length - 1];
    after = { createdAt: last.created_at, id: last.id };
  }
  const range =
    q.from || q.to ? "-" + (q.from ?? "start") + "-to-" + (q.to ?? "now") : "";
  return {
    filename: "access-log" + range + ".csv",
    csv: lines.join("\r\n") + "\r\n",
  };
}
