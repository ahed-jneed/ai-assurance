// One client-side cache for the reads of GET /api/assurance that several
// workspace components share (F-47, #63): the workbench view, the small
// record kinds read in full (systems, predictions, dataset cards, samples,
// dossiers, obligation assessments) and the GenAI results view.
//
// An entry is keyed by practice, engagement and query, and remembers the
// engagement version it was read at:
//
// - components that ask for the same query share one entry, and one request
//   in flight answers all of them;
// - a newer engagement version reads the entry again, once, for everyone;
// - assurance commands write records without changing the engagement
//   version, so whoever runs one invalidates the engagement's entries
//   (refreshAfterMutation): the entries on screen read again, the others
//   when they are next shown;
// - an entry shown again after `staleMs` reads again in the background,
//   showing the cached answer meanwhile, so another user's change appears
//   about as soon as it did when each view read on its own.
//
// The cache never changes what the server answers: each query is the request
// a component made before, and its value is the response as it was parsed.
// The paged registers, the record pickers and the record details read the
// server's search directly (app/assurance-record-search.tsx), as before.
import type { AssuranceRecord } from "./assurance-core";
import { assuranceRecords } from "./assurance-store-client";
import { fetchJson } from "./fetch-json";
import type { GenaiView } from "./read-models/genai-view";

type EngagementRef = { tenantId: string; engagementId: string };
/** The engagement a query reads, and the version its answer must not predate. */
export type AssuranceScope = EngagementRef & { version: number };
/** A read of GET /api/assurance: a stable name and how to make the request. */
export type AssuranceQuery<T> = {
  key: string;
  read: (scope: EngagementRef, signal: AbortSignal) => Promise<T>;
};
/** What a component sees of a query. */
export type QueryState<T> = {
  /** The last answer, kept while a newer read is in flight or after one failed. */
  data: T | undefined;
  /** Why the last read failed; "" once a read succeeds. */
  error: string;
  /** A read is in flight. */
  fetching: boolean;
  /** Bumped by each answer, for reads that must follow this one. */
  generation: number;
};

type Entry = {
  /** What subscribers see; replaced, never changed, so it compares by identity. */
  state: QueryState<unknown>;
  scope: EngagementRef;
  read: AssuranceQuery<unknown>["read"];
  /** The engagement version of the read in flight, or of the last answer. */
  version: number;
  /** When the last read started (ms). */
  startedAt: number;
  /** Invalidated since the last read started. */
  stale: boolean;
  inflight: Promise<void> | null;
  controller: AbortController | null;
  subscribers: Set<() => void>;
};

const idle: QueryState<never> = {
  data: undefined,
  error: "",
  fetching: false,
  generation: 0,
};

const scopeKeyOf = (s: EngagementRef) =>
  JSON.stringify([s.tenantId, s.engagementId]);
const sameEngagement = (a: EngagementRef, b: EngagementRef) =>
  a.tenantId === b.tenantId && a.engagementId === b.engagementId;

export type CacheOptions = {
  /** Age after which an entry shown again reads again (ms). */
  staleMs: number;
  /** Entries kept without subscribers before the oldest are dropped. */
  maxIdle: number;
  now: () => number;
};

export class AssuranceQueryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly options: CacheOptions;
  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      staleMs: 30_000,
      maxIdle: 40,
      now: () => Date.now(),
      ...options,
    };
  }

  /** The cache key of `query` in the engagement of `scope`. */
  static keyOf(scope: EngagementRef, query: { key: string }) {
    return scopeKeyOf(scope) + ":" + query.key;
  }

  /** What the readers of `key` see; the same object until it changes. */
  snapshot<T>(key: string): QueryState<T> {
    return (this.entries.get(key)?.state as QueryState<T> | undefined) ?? idle;
  }

  /** Listens to `key`, which ensure() must have created. */
  subscribe(key: string, listener: () => void) {
    const entry = this.entries.get(key);
    if (!entry) return () => {};
    entry.subscribers.add(listener);
    return () => {
      entry.subscribers.delete(listener);
      this.collect();
    };
  }

  /**
   * Reads `query` unless its entry already answers it: an answer, or a read
   * in flight, for `scope.version` or newer that was not invalidated and,
   * unless `revalidate` is false, started less than `staleMs` ago. Creates
   * the entry, so a component may subscribe right after.
   */
  ensure<T>(
    scope: AssuranceScope,
    query: AssuranceQuery<T>,
    revalidate = true,
  ): Promise<void> {
    const key = AssuranceQueryCache.keyOf(scope, query);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        state: idle,
        scope: { tenantId: scope.tenantId, engagementId: scope.engagementId },
        read: query.read as AssuranceQuery<unknown>["read"],
        version: -Infinity,
        startedAt: -Infinity,
        stale: true,
        inflight: null,
        controller: null,
        subscribers: new Set(),
      };
      this.entries.set(key, entry);
    }
    const answered =
      entry.version >= scope.version &&
      !entry.stale &&
      (!!entry.inflight ||
        !revalidate ||
        this.options.now() - entry.startedAt < this.options.staleMs);
    if (answered) return entry.inflight ?? Promise.resolve();
    return this.start(entry, Math.max(entry.version, scope.version));
  }

  /** Reads `query` again now, unless a read that started after the last invalidation is in flight. */
  refetch<T>(scope: AssuranceScope, query: AssuranceQuery<T>): Promise<void> {
    const entry = this.entries.get(AssuranceQueryCache.keyOf(scope, query));
    if (!entry) return this.ensure(scope, query);
    if (entry.inflight && !entry.stale) return entry.inflight;
    return this.start(entry, Math.max(entry.version, scope.version));
  }

  /**
   * Marks every entry of the engagement out of date, after a command that
   * wrote assurance records. Entries that someone reads read again at once,
   * at `version` when the caller knows the engagement's version after the
   * command (so the components that then render that version find the read
   * already in flight); the others read again when next shown. Resolves when
   * the reads started here have answered.
   */
  invalidate(engagement: EngagementRef, version?: number): Promise<void> {
    const reads: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!sameEngagement(entry.scope, engagement)) continue;
      entry.stale = true;
      if (entry.subscribers.size)
        reads.push(
          this.start(entry, Math.max(entry.version, version ?? -Infinity)),
        );
    }
    return Promise.all(reads).then(() => {});
  }

  private start(entry: Entry, version: number): Promise<void> {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    entry.version = version;
    entry.startedAt = this.options.now();
    entry.stale = false;
    this.publish(entry, { fetching: true });
    const settle = (patch: Partial<QueryState<unknown>>) => {
      // A newer read replaced this one; its answer is dropped.
      if (entry.controller !== controller) return;
      entry.inflight = null;
      entry.controller = null;
      this.publish(entry, { ...patch, fetching: false });
    };
    const inflight = entry.read(entry.scope, controller.signal).then(
      (data) =>
        settle({ data, error: "", generation: entry.state.generation + 1 }),
      (error: unknown) =>
        settle({
          error:
            error instanceof Error && error.message
              ? error.message
              : "Assurance records unavailable",
        }),
    );
    entry.inflight = inflight;
    return inflight;
  }

  private publish(entry: Entry, patch: Partial<QueryState<unknown>>) {
    entry.state = { ...entry.state, ...patch };
    for (const listener of [...entry.subscribers]) listener();
  }

  /** Drops the oldest entries nobody reads once more than `maxIdle` are idle. */
  private collect() {
    const unread = [...this.entries].filter(
      ([, e]) => !e.subscribers.size && !e.inflight,
    );
    const excess = unread.length - this.options.maxIdle;
    if (excess <= 0) return;
    unread
      .sort(([, a], [, b]) => a.startedAt - b.startedAt)
      .slice(0, excess)
      .forEach(([key]) => this.entries.delete(key));
  }
}

/** The cache the workspace components share. */
export const assuranceQueries = new AssuranceQueryCache();

const byKind = new Map<string, AssuranceQuery<AssuranceRecord[]>>();
/**
 * Every record of one kind (GET /api/assurance?view=records&kind=…, page by
 * page); the same query object for the same kind.
 */
export function recordsQuery(kind: string): AssuranceQuery<AssuranceRecord[]> {
  let query = byKind.get(kind);
  if (!query) {
    query = {
      key: "records:" + kind,
      read: (scope, signal) => assuranceRecords({ ...scope, kind }, { signal }),
    };
    byKind.set(kind, query);
  }
  return query;
}

/**
 * A JSON read of GET /api/assurance with `params` through fetchJson: it
 * fails with the server's error, or with the status's message when the
 * answer is not JSON.
 */
export function viewQuery<T>(
  name: string,
  params: Record<string, string>,
): AssuranceQuery<T> {
  return {
    key: "view:" + name,
    read: (scope, signal) =>
      fetchJson<T>(
        "/api/assurance?" + new URLSearchParams({ ...scope, ...params }),
        {
          cache: "no-store",
          signal,
          headers: { accept: "application/json" },
        },
      ),
  };
}

/** GET /api/assurance?view=genai: the GenAI results, plans, bundles and workers. */
export const genaiQuery = viewQuery<GenaiView>("genai", { view: "genai" });

/** The version of the engagement in a workspace load's answer, if it has one. */
function versionOf(loaded: unknown) {
  const version = (loaded as { engagement?: { version?: unknown } } | null)
    ?.engagement?.version;
  return typeof version === "number" ? version : undefined;
}

/**
 * After a command that wrote assurance records: reloads the workspace with
 * `refresh` (which may return the reloaded workspace), then reads the
 * engagement's queries again at the reloaded version. Resolves when the
 * queries on screen have their new answers.
 */
export async function refreshAfterMutation(
  engagement: EngagementRef,
  refresh?: () => Promise<unknown>,
  cache: AssuranceQueryCache = assuranceQueries,
) {
  const loaded = await refresh?.();
  await cache.invalidate(engagement, versionOf(loaded));
}
