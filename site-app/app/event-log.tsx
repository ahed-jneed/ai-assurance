"use client";
// What the engagement audit trail (app/audit-trail.tsx) and the practice
// Access log (app/access-log.tsx) share (#181): the filters (actor, event
// type, an inclusive UTC date range), the page position, and the pager.
// Pages are cursors from the server (lib/read-models/event-pages.ts): the
// pager keeps the cursors of the pages before the current one, so Newer goes
// back exactly to the page that was shown.
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { noEventFilters, type EventLogFilters } from "@/lib/event-log-queries";

/** The filters and page position of one event log. */
export function useEventLog() {
  const [filters, setFilters] = useState<EventLogFilters>(noEventFilters),
    // The cursor of every page shown before the current one; the current
    // page's cursor is the last ("" for the first page).
    [cursors, setCursors] = useState<string[]>([""]);
  return {
    filters,
    cursor: cursors[cursors.length - 1],
    page: cursors.length,
    /** Changes filters and returns to the first page. */
    change(patch: Partial<EventLogFilters>) {
      setFilters((f) => ({ ...f, ...patch }));
      setCursors([""]);
    },
    clear() {
      setFilters(noEventFilters);
      setCursors([""]);
    },
    older(next: string) {
      setCursors((c) => [...c, next]);
    },
    newer() {
      setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c));
    },
    first() {
      setCursors([""]);
    },
  };
}
export type EventLog = ReturnType<typeof useEventLog>;

type Facets = {
  actors: { id: string; name: string }[];
  actions: readonly string[];
};
/**
 * What the filters offer: the latest page's, kept while another page loads,
 * so a chosen person or event type stays listed.
 */
export function useFacets(page: Facets | undefined): Facets {
  const [last, setLast] = useState<Facets>({ actors: [], actions: [] });
  if (page && (page.actors !== last.actors || page.actions !== last.actions))
    setLast({ actors: page.actors, actions: page.actions });
  return page ?? last;
}

export const filtered = (f: EventLogFilters) =>
  !!(f.actor || f.action || f.from || f.to);

/** The filter controls of an event log. */
export function EventLogFilterBar({
  log,
  label,
  actors,
  actions,
  actionLabel,
  children,
}: {
  log: EventLog;
  /** What the group filters, read out by assistive technology. */
  label: string;
  actors: { id: string; name: string }[];
  actions: readonly string[];
  actionLabel: (action: string) => string;
  /** Controls after the filters, such as an export. */
  children?: React.ReactNode;
}) {
  const ids = useId(),
    { filters } = log;
  return (
    <div className="event-log-filters" role="group" aria-label={label}>
      <span className="event-log-filter">
        <label htmlFor={ids + "-actor"}>Person</label>
        <select
          id={ids + "-actor"}
          value={filters.actor}
          onChange={(event) => log.change({ actor: event.target.value })}
        >
          <option value="">Everyone</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </span>
      <span className="event-log-filter">
        <label htmlFor={ids + "-action"}>Event</label>
        <select
          id={ids + "-action"}
          value={filters.action}
          onChange={(event) => log.change({ action: event.target.value })}
        >
          <option value="">All events</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
      </span>
      <span className="event-log-filter">
        <label htmlFor={ids + "-from"}>From</label>
        <input
          id={ids + "-from"}
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(event) => log.change({ from: event.target.value })}
        />
      </span>
      <span className="event-log-filter">
        <label htmlFor={ids + "-to"}>To</label>
        <input
          id={ids + "-to"}
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(event) => log.change({ to: event.target.value })}
        />
      </span>
      {filtered(filters) && (
        <Button variant="ghost" size="sm" onClick={log.clear}>
          Clear filters
        </Button>
      )}
      {children}
    </div>
  );
}

/** The position and paging controls under an event log. */
export function EventLogPager({
  log,
  shown,
  next,
  fetching,
  noun,
}: {
  log: EventLog;
  /** Events on this page. */
  shown: number;
  /** The cursor of the next (older) page, or null on the last. */
  next: string | null;
  fetching: boolean;
  /** What the events are called, plural. */
  noun: string;
}) {
  return (
    <div className="event-log-pager">
      <p className="subtle" role="status">
        {fetching
          ? "Loading " + noun + "…"
          : `Page ${log.page}: ${shown} ${noun}` +
            (filtered(log.filters) ? " matching the filters" : "") +
            (next ? ", older ones on the next page." : ".") +
            " The date filters use UTC days."}
      </p>
      <div className="event-log-pager-actions">
        {log.page > 2 && (
          <Button variant="ghost" size="sm" onClick={log.first}>
            Newest
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={log.page === 1}
          onClick={log.newer}
        >
          Newer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!next}
          onClick={() => next && log.older(next)}
        >
          Older
        </Button>
      </div>
    </div>
  );
}

/** An event's time as the logs show it: local, with the UTC instant on hover. */
export function EventTime({ at }: { at: string }) {
  return (
    <time dateTime={at} title={at}>
      {new Date(at).toLocaleString()}
    </time>
  );
}
