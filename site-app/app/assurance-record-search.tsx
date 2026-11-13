"use client";
// Registers and record pickers of the assurance workbench that read from the
// server's search (GET /api/assurance?view=search|queue). They show one page
// at a time and load the next on request, and their filters run over every
// record of the engagement, not only the records a browser holds.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  QueueState,
  RecordContext,
  RecordSearchPage,
  SearchedRecord,
} from "@/lib/assurance-search";
import { errorMessage, fetchJson } from "@/lib/fetch-json";
import { AssuranceRegister } from "./assurance-register";

export type SearchScope = { tenantId: string; engagementId: string };
export type RecordQuery = {
  /** Record kinds to list (ignored with `queue`). */
  kinds?: readonly string[];
  /** A part of the caller's review queue instead of `kinds`. */
  queue?: QueueState;
  q?: string;
  review?: string;
  pageSize?: number;
};
/** Records per page of a register. */
export const registerPageSize = 50;

async function fetchPage(
  scope: SearchScope,
  query: RecordQuery,
  cursor: string | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    tenantId: scope.tenantId,
    engagementId: scope.engagementId,
    limit: String(query.pageSize ?? registerPageSize),
  });
  if (query.queue) {
    params.set("view", "queue");
    params.set("state", query.queue);
  } else {
    params.set("view", "search");
    if (query.kinds?.length) params.set("kinds", query.kinds.join(","));
    if (query.q?.trim()) params.set("q", query.q.trim());
    if (query.review && query.review !== "all")
      params.set("review", query.review);
  }
  if (cursor) params.set("cursor", cursor);
  return fetchJson<RecordSearchPage>("/api/assurance?" + params, {
    cache: "no-store",
    signal,
  });
}

type SearchState = {
  key: string;
  records: SearchedRecord[];
  nextCursor: string | null;
  total: number;
  loading: boolean;
  error: string;
};
/**
 * The first page of records that match `query`, and `more()` to append the
 * next. A changed query or `refreshKey` starts again from the first page;
 * typing is debounced. The previous rows stay visible while a new query
 * loads, and are dropped if it fails.
 */
export function useRecordSearch(
  scope: SearchScope,
  query: RecordQuery,
  refreshKey: unknown,
) {
  const key = JSON.stringify([scope, query, refreshKey]);
  const [state, setState] = useState<SearchState>({
    key: "",
    records: [],
    nextCursor: null,
    total: 0,
    loading: true,
    error: "",
  });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    const [s, q] = JSON.parse(key) as [SearchScope, RecordQuery];
    const timer = setTimeout(
      () => {
        setState((v) => ({ ...v, loading: true, error: "" }));
        fetchPage(s, q, null, abort.signal).then(
          (page) =>
            setState({
              key,
              records: page.records,
              nextCursor: page.nextCursor,
              total: page.total ?? page.records.length,
              loading: false,
              error: "",
            }),
          (x: unknown) => {
            // The previous query's rows do not answer this one: drop them.
            if (!abort.signal.aborted)
              setState({
                key,
                records: [],
                nextCursor: null,
                total: 0,
                loading: false,
                error:
                  x instanceof Error
                    ? x.message
                    : "Assurance records unavailable",
              });
          },
        );
      },
      q.q?.trim() ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key]);
  const more = () => {
    // Only the rows of the current query continue; a first page that is
    // still loading is never aborted for them.
    if (!state.nextCursor || state.loading || state.key !== key) return;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setState((v) => ({ ...v, loading: true, error: "" }));
    fetchPage(scope, query, state.nextCursor, abort.signal).then(
      (page) =>
        setState((v) =>
          v.key !== key
            ? v
            : {
                ...v,
                records: [...v.records, ...page.records],
                nextCursor: page.nextCursor,
                loading: false,
              },
        ),
      (x: unknown) => {
        if (!abort.signal.aborted)
          setState((v) => ({
            ...v,
            loading: false,
            error:
              x instanceof Error ? x.message : "Assurance records unavailable",
          }));
      },
    );
  };
  return {
    ...state,
    /** Whether the rows shown answer the current query. */
    current: state.key === key,
    more,
  };
}

type ContextState = {
  key: string;
  context: RecordContext | null;
  error: string;
};
/**
 * One record with its review state and the records its details read
 * (GET /api/assurance?view=record), for `recordId`; nothing without one. A
 * changed `refreshKey` reads it again (after an action adds a review or a
 * successor), keeping the last answer on screen meanwhile.
 */
export function useRecordContext(
  scope: SearchScope,
  recordId: string,
  refreshKey: unknown,
) {
  const key = recordId ? JSON.stringify([scope, recordId, refreshKey]) : "";
  const [state, setState] = useState<ContextState>({
    key: "",
    context: null,
    error: "",
  });
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController(),
      [s, id] = JSON.parse(key) as [SearchScope, string];
    const params = new URLSearchParams({
      tenantId: s.tenantId,
      engagementId: s.engagementId,
      view: "record",
      id,
    });
    fetchJson<RecordContext>("/api/assurance?" + params, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then((value) => setState({ key, context: value, error: "" }))
      .catch((x: unknown) => {
        if (!abort.signal.aborted)
          setState({
            key,
            context: null,
            error: errorMessage(x, "Assurance record unavailable"),
          });
      });
    return () => abort.abort();
  }, [key]);
  const same = state.context?.record.id === recordId;
  return {
    /** The record's context; the last one for this record while it reloads. */
    context: recordId && same ? state.context : null,
    /** Why the record could not be read, once its read has answered. */
    error: recordId && state.key === key ? state.error : "",
    loading: !!recordId && state.key !== key,
  };
}

function PageFooter({
  shown,
  total,
  loading,
  hasMore,
  onMore,
  noun,
}: {
  shown: number;
  total: number;
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  noun: string;
}) {
  if (!hasMore && shown <= registerPageSize) return null;
  return (
    <div className="register-pager">
      <span className="subtle" aria-live="polite">
        Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      {hasMore && (
        <Button variant="outline" size="sm" disabled={loading} onClick={onMore}>
          {loading ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}

/**
 * A register of the records of `kinds` (or of a part of the review queue)
 * that match the search text and review state, one server page at a time.
 */
export function RecordRegister({
  scope,
  query,
  refreshKey,
  hasRecords,
  empty,
  emptyAction,
  person,
  onOpen,
  onReset,
}: {
  scope: SearchScope;
  query: RecordQuery;
  refreshKey: unknown;
  /** Whether the register holds any record before filtering. */
  hasRecords: boolean;
  empty: string;
  emptyAction?: ReactNode;
  person: (id: string) => string;
  onOpen: (r: SearchedRecord) => void;
  onReset?: () => void;
}) {
  const result = useRecordSearch(scope, query, refreshKey),
    filtered =
      hasRecords && (!!query.q?.trim() || (query.review ?? "all") !== "all");
  if (result.error && !result.records.length)
    return (
      <div className="assurance-register-empty" role="alert">
        <p>{result.error}</p>
      </div>
    );
  if (!result.key && result.loading)
    return (
      <div className="assurance-register-empty" role="status">
        <p>Loading records…</p>
      </div>
    );
  return (
    <div aria-busy={result.loading || !result.current}>
      <AssuranceRegister
        rows={result.records}
        onOpen={onOpen}
        empty={empty}
        filtered={filtered}
        person={person}
        onReset={onReset}
        emptyAction={emptyAction}
      />
      {result.error && (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      )}
      <PageFooter
        shown={result.records.length}
        total={result.total}
        loading={result.loading || !result.current}
        hasMore={!!result.nextCursor}
        onMore={result.more}
        noun={filtered ? "matching records" : "records"}
      />
    </div>
  );
}

/**
 * Checkboxes over the records of `kinds`, searched and paged on the server.
 * Selected records stay listed above the results, so a selection can span
 * pages and searches.
 */
export function RecordPicker({
  scope,
  kinds,
  refreshKey,
  selected,
  onChange,
  max,
  disabled,
  title,
  detail,
  describe,
  label,
  empty,
  single,
  onPick,
}: {
  scope: SearchScope;
  kinds: readonly string[];
  refreshKey: unknown;
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  disabled?: boolean;
  title: (r: SearchedRecord) => string;
  detail?: (r: SearchedRecord) => string;
  /** The title of a selected record that is not among the results. */
  describe: (id: string) => string;
  label: string;
  empty: string;
  /** Picking a record replaces the selection (at most one is selected). */
  single?: boolean;
  /** Hears each record as it is picked, for callers that need more than its id. */
  onPick?: (r: SearchedRecord) => void;
}) {
  const [term, setTerm] = useState(""),
    result = useRecordSearch(
      scope,
      { kinds, q: term, pageSize: 25 },
      refreshKey,
    ),
    full = !single && max !== undefined && selected.length >= max,
    toggle = (record: SearchedRecord | string, on: boolean) => {
      const id = typeof record === "string" ? record : record.id;
      if (on && typeof record !== "string") onPick?.(record);
      onChange(
        on
          ? single
            ? [id]
            : [...selected, id]
          : selected.filter((x) => x !== id),
      );
    };
  return (
    <div className="record-picker" role="group" aria-label={label}>
      {selected.length > 0 && (
        <ul className="record-picker-selected" aria-label="Selected records">
          {selected.map((id) => (
            <li key={id}>
              <span>{describe(id)}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={"Remove " + describe(id)}
                onClick={() => toggle(id, false)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="search-field">
        <Search size={15} aria-hidden="true" />
        <Input
          autoComplete="off"
          aria-label={"Search " + label.toLocaleLowerCase()}
          placeholder="Search by title, reference or person…"
          value={term}
          onChange={(ev) => setTerm(ev.target.value)}
        />
      </div>
      {result.error && (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      )}
      <div
        className="record-picker-results"
        aria-busy={result.loading || !result.current}
      >
        {!result.key && result.loading ? (
          <p className="subtle" role="status">
            Loading records…
          </p>
        ) : !result.records.length ? (
          <p className="subtle">
            {term.trim() ? "No records match this search." : empty}
          </p>
        ) : (
          result.records.map((r) => {
            const checked = selected.includes(r.id);
            return (
              <label className="check-row" key={r.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (!checked && full)}
                  onChange={(ev) => toggle(r, ev.target.checked)}
                />
                <span>
                  {title(r)}
                  {detail && (
                    <small className="block subtle">{detail(r)}</small>
                  )}
                </span>
              </label>
            );
          })
        )}
      </div>
      <PageFooter
        shown={result.records.length}
        total={result.total}
        loading={result.loading || !result.current}
        hasMore={!!result.nextCursor}
        onMore={result.more}
        noun={term.trim() ? "matching records" : "records"}
      />
    </div>
  );
}
