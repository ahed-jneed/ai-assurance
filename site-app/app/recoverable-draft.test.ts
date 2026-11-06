import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftAutosave, type DraftScope } from "./recoverable-draft";

const scope = (baseRevision: string): DraftScope => ({
  tenantId: "t1",
  engagementId: "e1",
  kind: "brief",
  recordId: "brief",
  baseRevision,
});
const keyOf = (s: DraftScope) =>
  [s.tenantId, s.engagementId, s.kind, s.recordId, s.baseRevision].join("|");
const input = (s: DraftScope, text: string) => {
  const content = { objective: text };
  return { scope: s, content, encoded: JSON.stringify(content) };
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const stale =
  "The source changed. Your recovery draft remains available; compare it with the saved revision.";

// The hook re-runs its autosave effect whenever the form re-renders. Each
// status change re-renders, so the harness feeds the same input back on every
// status, which is what made the old effect retry a refused save every second.
function harness(post: (body: string) => Promise<Response>) {
  const statuses: string[] = [];
  let latest: ReturnType<typeof input> | undefined;
  const autosave: DraftAutosave = new DraftAutosave((s) => {
    statuses.push(s);
    autosave.update(latest);
  }, post);
  const update = (next: ReturnType<typeof input> | undefined) => {
    latest = next;
    autosave.update(next);
  };
  return { autosave, statuses, update };
}

describe("DraftAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a second after the content changes", async () => {
    const post = vi.fn(async (body: string) =>
      reply(200, {
        version:
          (JSON.parse(body) as { expectedVersion: number }).expectedVersion + 1,
      }),
    );
    const { autosave, statuses, update } = harness(post);
    autosave.reset(keyOf(scope("r1")));
    update(input(scope("r1"), "a"));
    await vi.advanceTimersByTimeAsync(999);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["Saving recovery copy…", "Recovery copy saved"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
    update(input(scope("r1"), "ab"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(post.mock.calls[1][0])).toMatchObject({
      expectedVersion: 1,
      content: { objective: "ab" },
    });
  });

  it("sends a single request after a 409 and shows the conflict once", async () => {
    const post = vi.fn(async () => reply(409, { error: stale }));
    const { autosave, statuses, update } = harness(post);
    autosave.reset(keyOf(scope("r1")));
    update(input(scope("r1"), "a"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["Saving recovery copy…", stale]);
    // Further edits on the same base revision cannot succeed either.
    update(input(scope("r1"), "ab"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(statuses.filter((s) => s === stale)).toHaveLength(1);
  });

  it("resumes autosave once the base revision changes", async () => {
    const post = vi
      .fn<(body: string) => Promise<Response>>()
      .mockResolvedValueOnce(reply(409, { error: stale }))
      .mockResolvedValue(reply(200, { version: 1 }));
    const { autosave, statuses, update } = harness(post);
    autosave.reset(keyOf(scope("r1")));
    update(input(scope("r1"), "a"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
    autosave.reset(keyOf(scope("r2")));
    update(input(scope("r2"), "a"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(post.mock.calls[1][0])).toMatchObject({
      baseRevision: "r2",
      expectedVersion: 0,
    });
    expect(statuses.at(-1)).toBe("Recovery copy saved");
  });

  it("does not retry other failures until the content changes", async () => {
    const post = vi
      .fn<(body: string) => Promise<Response>>()
      .mockResolvedValueOnce(reply(413, { error: "Too large" }))
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValue(reply(200, { version: 1 }));
    const { autosave, statuses, update } = harness(post);
    autosave.reset(keyOf(scope("r1")));
    update(input(scope("r1"), "a"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
    update(input(scope("r1"), "ab"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(2);
    update(input(scope("r1"), "abc"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(3);
    expect(statuses.filter((s) => s !== "Saving recovery copy…")).toEqual([
      "Too large",
      "Network down",
      "Recovery copy saved",
    ]);
  });

  it("waits for a save in flight and then saves the newer content", async () => {
    let finish: (r: Response) => void = () => {};
    const post = vi
      .fn<(body: string) => Promise<Response>>()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(reply(200, { version: 2 }));
    const { autosave, update } = harness(post);
    autosave.reset(keyOf(scope("r1")));
    update(input(scope("r1"), "a"));
    await vi.advanceTimersByTimeAsync(1000);
    update(input(scope("r1"), "ab"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
    finish(reply(200, { version: 1 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(post.mock.calls[1][0])).toMatchObject({
      expectedVersion: 1,
      content: { objective: "ab" },
    });
  });

  it("drops the result of a save from a previous scope", async () => {
    let finish: (r: Response) => void = () => {};
    const post = vi.fn<(body: string) => Promise<Response>>(
      () => new Promise<Response>((resolve) => (finish = resolve)),
    );
    const { autosave, statuses, update } = harness(post);
    autosave.reset(keyOf(scope("r1")));
    update(input(scope("r1"), "a"));
    await vi.advanceTimersByTimeAsync(1000);
    autosave.reset("");
    finish(reply(409, { error: stale }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(statuses).toEqual(["Saving recovery copy…"]);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
