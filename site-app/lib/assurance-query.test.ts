// The shared GET /api/assurance cache (#63, F-47): one request per query and
// engagement version however many components read it, a new read when the
// version moves, and explicit invalidation after assurance commands.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssuranceQueryCache,
  genaiQuery,
  recordsQuery,
  refreshAfterMutation,
  type AssuranceQuery,
} from "./assurance-query";

const engagement = { tenantId: "t1", engagementId: "E-1" };
const at = (version: number) => ({ ...engagement, version });

/** A query whose reads are counted and answered by hand. */
function manual(key = "q") {
  const reads: { resolve: (v: number) => void; reject: (e: Error) => void }[] =
    [];
  const query: AssuranceQuery<number> = {
    key,
    read: () =>
      new Promise<number>((resolve, reject) => reads.push({ resolve, reject })),
  };
  return { query, reads };
}

/** Subscribes like a mounted component; returns its unsubscribe. */
function mount<T>(
  cache: AssuranceQueryCache,
  version: number,
  query: AssuranceQuery<T>,
) {
  void cache.ensure(at(version), query);
  return cache.subscribe(
    AssuranceQueryCache.keyOf(engagement, query),
    () => {},
  );
}

const state = (cache: AssuranceQueryCache, query: { key: string }) =>
  cache.snapshot<number>(AssuranceQueryCache.keyOf(engagement, query));

afterEach(() => vi.unstubAllGlobals());

describe("assurance query cache", () => {
  it("opening an engagement reads each query once for every component", async () => {
    // The requests the components that read the dataset cards made before:
    // the Testing lab, the dataset registry, two planned evaluations and the
    // workbench each read GET /api/assurance?view=records&kind=dataset.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify(
            url.includes("view=genai")
              ? { results: [] }
              : { records: [], nextCursor: null },
          ),
        );
      }),
    );
    const cache = new AssuranceQueryCache();
    const datasets = recordsQuery("dataset");
    expect(recordsQuery("dataset")).toBe(datasets);
    for (let i = 0; i < 5; i++) mount(cache, 3, datasets);
    // The Evidence vault's levels and the Testing lab's GenAI tab.
    mount(cache, 3, genaiQuery);
    mount(cache, 3, genaiQuery);
    await cache.ensure(at(3), datasets);
    await cache.ensure(at(3), genaiQuery);
    expect(urls).toEqual([
      "/api/assurance?tenantId=t1&engagementId=E-1&view=records&kind=dataset",
      "/api/assurance?tenantId=t1&engagementId=E-1&view=genai",
    ]);
    expect(state(cache, datasets).data).toEqual([]);
  });

  it("reads again, once, when the engagement version moves", async () => {
    const cache = new AssuranceQueryCache(),
      { query, reads } = manual();
    mount(cache, 1, query);
    mount(cache, 1, query);
    reads[0].resolve(10);
    await cache.ensure(at(1), query);
    expect(state(cache, query)).toMatchObject({ data: 10, fetching: false });
    void cache.ensure(at(2), query);
    void cache.ensure(at(2), query);
    // An older version asks for nothing newer than what is in flight.
    void cache.ensure(at(1), query);
    expect(reads).toHaveLength(2);
    // The last answer stays visible while the newer one loads.
    expect(state(cache, query)).toMatchObject({ data: 10, fetching: true });
    reads[1].resolve(20);
    await cache.ensure(at(2), query);
    expect(state(cache, query)).toMatchObject({
      data: 20,
      fetching: false,
      generation: 2,
    });
  });

  it("reuses an answer shown again within staleMs and revalidates after", async () => {
    let now = 0;
    const cache = new AssuranceQueryCache({ staleMs: 1000, now: () => now }),
      { query, reads } = manual();
    const leave = mount(cache, 1, query);
    reads[0].resolve(1);
    await cache.ensure(at(1), query);
    leave();
    now = 500;
    void cache.ensure(at(1), query);
    expect(reads).toHaveLength(1);
    now = 1500;
    void cache.ensure(at(1), query);
    expect(reads).toHaveLength(2);
  });

  it("invalidation reads the queries on screen again, the others when next shown", async () => {
    const cache = new AssuranceQueryCache(),
      shown = manual("shown"),
      hidden = manual("hidden"),
      other = manual("other");
    mount(cache, 4, shown.query);
    const leave = mount(cache, 4, hidden.query);
    void cache.ensure(
      { tenantId: "t1", engagementId: "E-2", version: 1 },
      other.query,
    );
    shown.reads[0].resolve(1);
    hidden.reads[0].resolve(1);
    other.reads[0].resolve(1);
    await cache.ensure(at(4), shown.query);
    leave();

    const done = cache.invalidate(engagement, 5);
    expect(shown.reads).toHaveLength(2);
    expect(hidden.reads).toHaveLength(1);
    // Another engagement is untouched.
    expect(other.reads).toHaveLength(1);
    // The components that then render version 5 find the read in flight.
    void cache.ensure(at(5), shown.query);
    expect(shown.reads).toHaveLength(2);
    shown.reads[1].resolve(2);
    await done;
    expect(state(cache, shown.query).data).toBe(2);
    // The hidden query reads when shown again, even within staleMs.
    void cache.ensure(at(4), hidden.query);
    expect(hidden.reads).toHaveLength(2);
  });

  it("refreshAfterMutation reads at the reloaded engagement version", async () => {
    const cache = new AssuranceQueryCache(),
      { query, reads } = manual();
    mount(cache, 7, query);
    reads[0].resolve(1);
    await cache.ensure(at(7), query);
    const refresh = vi.fn(async () => ({ engagement: { version: 8 } }));
    const done = refreshAfterMutation(engagement, refresh, cache);
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    void cache.ensure(at(8), query);
    expect(reads).toHaveLength(2);
    reads[1].resolve(2);
    await done;
    expect(refresh).toHaveBeenCalledOnce();
    expect(state(cache, query).data).toBe(2);
  });

  it("drops the answer of a read that a newer one replaced", async () => {
    const cache = new AssuranceQueryCache(),
      { query, reads } = manual();
    mount(cache, 1, query);
    void cache.refetch(at(1), query);
    // A read in flight that started after the last invalidation is reused.
    expect(reads).toHaveLength(1);
    void cache.invalidate(engagement);
    expect(reads).toHaveLength(2);
    reads[1].resolve(2);
    reads[0].resolve(1);
    await cache.ensure(at(1), query);
    await Promise.resolve();
    expect(state(cache, query)).toMatchObject({ data: 2, generation: 1 });
  });

  it("keeps the last answer when a read fails, and clears the error on success", async () => {
    const cache = new AssuranceQueryCache(),
      { query, reads } = manual();
    mount(cache, 1, query);
    reads[0].resolve(1);
    await cache.ensure(at(1), query);
    const failing = cache.refetch(at(1), query);
    reads[1].reject(new Error("Assurance records unavailable"));
    await failing;
    expect(state(cache, query)).toMatchObject({
      data: 1,
      error: "Assurance records unavailable",
      fetching: false,
    });
    const retry = cache.refetch(at(1), query);
    reads[2].resolve(3);
    await retry;
    expect(state(cache, query)).toMatchObject({ data: 3, error: "" });
  });

  it("notifies subscribers with a new snapshot on each change", async () => {
    const cache = new AssuranceQueryCache(),
      { query, reads } = manual();
    void cache.ensure(at(1), query);
    const key = AssuranceQueryCache.keyOf(engagement, query),
      before = cache.snapshot(key),
      listener = vi.fn();
    cache.subscribe(key, listener);
    expect(cache.snapshot(key)).toBe(before);
    reads[0].resolve(1);
    await cache.ensure(at(1), query);
    expect(listener).toHaveBeenCalled();
    expect(cache.snapshot(key)).not.toBe(before);
  });

  it("drops the oldest entries nobody reads beyond maxIdle", async () => {
    let now = 0;
    const cache = new AssuranceQueryCache({ maxIdle: 1, now: () => ++now });
    const a = manual("a"),
      b = manual("b");
    const leaveA = mount(cache, 1, a.query),
      leaveB = mount(cache, 1, b.query);
    a.reads[0].resolve(1);
    b.reads[0].resolve(1);
    await cache.ensure(at(1), b.query);
    leaveA();
    leaveB();
    expect(state(cache, a.query).data).toBeUndefined();
    expect(state(cache, b.query).data).toBe(1);
  });
});
