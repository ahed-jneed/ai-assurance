// Cursor pages of an event log, newest first (#181): the engagement audit
// trail (audit-trail.ts) and the practice Access log (access-log.ts) share
// the query string, the filters and the cursor. A page is ordered by
// (created_at, id) descending, so events written in the same millisecond
// keep one order and a page never repeats or skips one; the cursor names the
// last event of the previous page.
import { z } from "zod";
import { ApiError } from "../http";

/** Events per page unless the request asks for fewer or more. */
export const defaultPageSize = 50;
/** The most events one page returns. */
export const maxPageSize = 200;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(d + "T00:00:00.000Z")), {
    message: "Not a calendar date",
  });
const query = z
  .object({
    cursor: z.string().max(600).optional(),
    actor: z.string().max(256).optional(),
    action: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, "Unknown event type")
      .optional(),
    from: day.optional(),
    to: day.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maxPageSize)
      .default(defaultPageSize),
  })
  .strict();
/**
 * A log whose events name the member acted on as well (the Access log) also
 * takes `involved`: the member who acted or was acted on.
 */
const involvedQuery = query.extend({
  involved: z.string().max(256).optional(),
});

/** A page request: its filters, where it starts and how many events. */
export type EventQuery = {
  /** The user id of who acted. */
  actor?: string;
  /**
   * The user id of a member who either acted or was acted on; only a log
   * parsed with `{ involved: true }` has it.
   */
  involved?: string;
  /** The event type (the command or event action). */
  action?: string;
  /** The first day (UTC) included. */
  from?: string;
  /** The last day (UTC) included. */
  to?: string;
  /** The last event of the previous page. */
  after?: { createdAt: string; id: string };
  limit: number;
};

/** One page of events, and the cursor of the next when there is one. */
export type EventPage<T> = { events: T[]; next: string | null };

/** The query parameters that are not filters of the page. */
const scopeParams = new Set(["tenantId", "engagementId", "format"]);

/** Encodes the position after `event` as an opaque cursor. */
export function cursorAfter(event: { created_at: string; id: string }) {
  return btoa(JSON.stringify([event.created_at, event.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string): EventQuery["after"] {
  try {
    const value: unknown = JSON.parse(
      atob(cursor.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      value[0].length <= 40 &&
      value[1].length <= 200
    )
      return { createdAt: value[0], id: value[1] };
  } catch {
    // Reported below.
  }
  throw new ApiError(400, "The page cursor is not valid. Start from page 1.");
}

/**
 * The page a request's query string asks for. Empty parameters are absent;
 * an unknown parameter (`involved` too, unless `options.involved` says the
 * log names the member acted on), a malformed date or cursor, or a range
 * that ends before it starts is 400.
 */
export function parseEventQuery(
  params: URLSearchParams,
  options: { involved?: boolean } = {},
): EventQuery {
  const raw: Record<string, string> = {};
  for (const [key, value] of params)
    if (!scopeParams.has(key) && value !== "") raw[key] = value;
  const parsed = (options.involved ? involvedQuery : query).safeParse(raw);
  if (!parsed.success)
    throw new ApiError(
      400,
      parsed.error.issues
        .map((i) => (i.path.length ? i.path.join(".") + ": " : "") + i.message)
        .join("; "),
    );
  const { cursor, ...q } = parsed.data;
  if (q.from && q.to && q.from > q.to)
    throw new ApiError(400, "The date range ends before it starts");
  return { ...q, ...(cursor ? { after: decodeCursor(cursor) } : {}) };
}

/** The ISO timestamp of the start of the UTC day after `day`. */
function dayAfter(day: string) {
  return new Date(Date.parse(day + "T00:00:00.000Z") + 86400000).toISOString();
}

/**
 * The SQL conditions of the query's filters and cursor over columns
 * `created_at`, `id`, `action`, `actorColumn` and, for `involved`,
 * `subjectColumn` (the member acted on), each prefixed by " AND ", with
 * their arguments in order.
 */
export function eventFilters(
  q: EventQuery,
  actorColumn = "actor",
  subjectColumn?: string,
): { sql: string; args: string[] } {
  let sql = "";
  const args: string[] = [];
  if (q.actor) {
    sql += ` AND ${actorColumn}=?`;
    args.push(q.actor);
  }
  if (q.involved) {
    if (!subjectColumn)
      throw new ApiError(400, "This log cannot be filtered by person involved");
    sql += ` AND (${actorColumn}=? OR ${subjectColumn}=?)`;
    args.push(q.involved, q.involved);
  }
  if (q.action) {
    sql += " AND action=?";
    args.push(q.action);
  }
  if (q.from) {
    sql += " AND created_at>=?";
    args.push(q.from + "T00:00:00.000Z");
  }
  if (q.to) {
    sql += " AND created_at<?";
    args.push(dayAfter(q.to));
  }
  if (q.after) {
    sql += " AND (created_at<? OR (created_at=? AND id<?))";
    args.push(q.after.createdAt, q.after.createdAt, q.after.id);
  }
  return { sql, args };
}

/**
 * Turns the rows of a query that asked for `limit + 1` events into the page:
 * the extra row only says that another page follows.
 */
export function toPage<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): EventPage<T> {
  const events = rows.slice(0, limit);
  return {
    events,
    next: rows.length > limit ? cursorAfter(events[events.length - 1]) : null,
  };
}
