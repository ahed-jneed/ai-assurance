// The browser's reads of the paged event logs (#181), as queries of the
// shared query cache (lib/assurance-query.ts, #63) through fetchJson:
//
// - a page of the engagement audit trail (GET /api/audit-trail) is cached
//   per engagement and read again when the engagement version moves, which
//   every save that writes an audit event does;
// - a page of the practice Access log (GET /api/access-log) is cached under
//   the practice with no engagement and read again when the management
//   version moves or the cached page is older than the cache's stale time
//   (sign-ins change no version).
//
// Each distinct page (filters and cursor) is one query object, made once.
import type { AssuranceQuery } from "./assurance-query";
import { fetchJson } from "./fetch-json";
import type { AccessLogPage } from "./read-models/access-log";
import type { TrailPage } from "./read-models/audit-trail";

/**
 * The filters a person sets on an event log; "" is unset. `involved` (a
 * member who acted or was acted on) is the Access log's only.
 */
export type EventLogFilters = {
  actor: string;
  involved: string;
  action: string;
  from: string;
  to: string;
};
export const noEventFilters: EventLogFilters = {
  actor: "",
  involved: "",
  action: "",
  from: "",
  to: "",
};

/** The query string of a page: its set filters and cursor. */
export function eventLogParams(
  filters: EventLogFilters,
  cursor = "",
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...filters, cursor }).filter(([, v]) => v),
  );
}

const made = new Map<string, AssuranceQuery<unknown>>();
/** At most this many page queries are kept; older ones are made again. */
const keep = 200;
function memo<T>(key: string, make: () => AssuranceQuery<T>) {
  let query = made.get(key) as AssuranceQuery<T> | undefined;
  if (!query) {
    if (made.size >= keep) made.delete(made.keys().next().value!);
    query = make();
    made.set(key, query as AssuranceQuery<unknown>);
  }
  return query;
}

function read<T>(path: string, params: Record<string, string>) {
  return (
    scope: { tenantId: string; engagementId: string },
    signal: AbortSignal,
  ) =>
    fetchJson<T>(
      path +
        "?" +
        new URLSearchParams({
          tenantId: scope.tenantId,
          ...(scope.engagementId ? { engagementId: scope.engagementId } : {}),
          ...params,
        }),
      { cache: "no-store", signal, headers: { accept: "application/json" } },
    );
}

/** One page of the engagement's audit trail. */
export function trailQuery(
  filters: EventLogFilters,
  cursor = "",
): AssuranceQuery<TrailPage> {
  const params = eventLogParams(filters, cursor),
    key = "trail:" + new URLSearchParams(params);
  return memo(key, () => ({
    key,
    read: read<TrailPage>("/api/audit-trail", params),
  }));
}

/** One page of the practice's Access log. */
export function accessLogQuery(
  filters: EventLogFilters,
  cursor = "",
): AssuranceQuery<AccessLogPage> {
  const params = eventLogParams(filters, cursor),
    key = "access-log:" + new URLSearchParams(params);
  return memo(key, () => ({
    key,
    read: read<AccessLogPage>("/api/access-log", params),
  }));
}

/** The CSV export of the Access log with `filters`, every page. */
export function accessLogCsvHref(tenantId: string, filters: EventLogFilters) {
  return (
    "/api/access-log?" +
    new URLSearchParams({ tenantId, ...eventLogParams(filters), format: "csv" })
  );
}
