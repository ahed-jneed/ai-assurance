import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FetchError,
  errorMessage,
  fetchJson,
  postJson,
  retryable,
} from "@/lib/fetch-json";

function answer(body: string, status = 200, type = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, { status, headers: { "content-type": type } }),
    ),
  );
}
async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected a failure");
    },
    (error: unknown) => error as FetchError,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("returns the JSON body of a success", async () => {
    answer('{"ok":true}');
    expect(await fetchJson("/api/x")).toEqual({ ok: true });
  });

  it("uses the server's own error of a failed JSON response", async () => {
    answer('{"error":"The engagement changed. Reload before saving."}', 409);
    const error = await failure(fetchJson("/api/x"));
    expect(error).toBeInstanceOf(FetchError);
    expect(error).toMatchObject({
      status: 409,
      kind: "conflict",
      message: "The engagement changed. Reload before saving.",
    });
    expect(retryable(error)).toBe(false);
  });

  // F-71: a 413 or 502 page is not JSON; it used to surface as a parse error.
  it.each([
    [
      413,
      "too_large",
      "The request is too large. Send fewer or smaller files.",
    ],
    [
      502,
      "transient",
      "The service is temporarily unavailable. Try again in a moment.",
    ],
  ])(
    "maps a non-JSON %i to a readable message",
    async (status, kind, message) => {
      answer("<html>Bad gateway</html>", status, "text/html");
      const error = await failure(fetchJson("/api/x"));
      expect(error).toMatchObject({ status, kind, message });
      expect(error.message).not.toMatch(/Unexpected token/);
    },
  );

  it("reports a network failure as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await failure(fetchJson("/api/x"));
    expect(error).toMatchObject({ status: 0, kind: "network" });
    expect(retryable(error)).toBe(true);
  });

  it("rethrows an abort unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abort;
      }),
    );
    expect(
      await failure(fetchJson("/api/x", { signal: controller.signal })),
    ).toBe(abort);
  });

  it("refuses an unreadable success body", async () => {
    answer("not json");
    expect(await failure(fetchJson("/api/x"))).toMatchObject({
      status: 200,
      kind: "transient",
    });
  });

  it("posts JSON", async () => {
    answer("{}");
    await postJson("/api/workspace", { op: "x" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"op":"x"}',
    });
  });

  it("names a fallback for errors without a message", () => {
    expect(errorMessage(new Error(""), "Could not save")).toBe(
      "Could not save",
    );
    expect(errorMessage("x", "Could not save")).toBe("Could not save");
    expect(errorMessage(new Error("Nope"))).toBe("Nope");
  });
});
