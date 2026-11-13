"use client";
// Reads a shared GET /api/assurance query (lib/assurance-query.ts) for a
// component: the cached answer at once when there is one, a read when the
// engagement version moved or the answer was invalidated, and a re-render
// only when this query's state changes.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  AssuranceQueryCache,
  assuranceQueries,
  type AssuranceQuery,
  type AssuranceScope,
  type QueryState,
} from "@/lib/assurance-query";

export type AssuranceQueryResult<T> = QueryState<T> & {
  /** Nothing to show yet: the first read for this engagement is in flight. */
  loading: boolean;
  /** Reads the query again now. */
  reload: () => Promise<void>;
};

/**
 * `scope` null reads nothing (a role or a view that does not need the
 * query). `query` should be a module constant (recordsQuery("dataset") made
 * once), since a new query object reads again. `revalidateOnFocus` also
 * reads again when the window regains focus, for data another tab may
 * change without a new engagement version.
 */
export function useAssuranceQuery<T>(
  scope: AssuranceScope | null,
  query: AssuranceQuery<T>,
  { revalidateOnFocus = false }: { revalidateOnFocus?: boolean } = {},
): AssuranceQueryResult<T> {
  const tenantId = scope?.tenantId,
    engagementId = scope?.engagementId,
    version = scope?.version;
  // The same scope object while the engagement and its version stay.
  const stable = useMemo(
    () =>
      tenantId !== undefined &&
      engagementId !== undefined &&
      version !== undefined
        ? { tenantId, engagementId, version }
        : null,
    [tenantId, engagementId, version],
  );
  const key = stable ? AssuranceQueryCache.keyOf(stable, query) : "";
  // Declared before the subscription, so the entry exists when it subscribes.
  useEffect(() => {
    if (stable) void assuranceQueries.ensure(stable, query);
  }, [stable, query]);
  const subscribe = useCallback(
      (listener: () => void) => assuranceQueries.subscribe(key, listener),
      [key],
    ),
    read = useCallback(() => assuranceQueries.snapshot<T>(key), [key]);
  const state = useSyncExternalStore(subscribe, read, read);
  const reload = useCallback(
    () =>
      stable ? assuranceQueries.refetch(stable, query) : Promise.resolve(),
    [stable, query],
  );
  useEffect(() => {
    if (!revalidateOnFocus || !stable) return;
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [revalidateOnFocus, stable, reload]);
  return useMemo(
    () => ({
      ...state,
      loading: !!key && state.data === undefined && !state.error,
      reload,
    }),
    [state, key, reload],
  );
}
