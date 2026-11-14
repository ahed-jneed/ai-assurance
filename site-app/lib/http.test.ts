import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  parseJsonBody,
  parseJsonFile,
  readBounded,
  readJson,
  responseError,
  trackRequestBody,
} from "./http";

afterEach(() => vi.restoreAllMocks());

const syntaxError = () => {
  try {
    JSON.parse("{op:");
  } catch (e) {
    return e;
  }
};

describe("responseError", () => {
  it("answers an ApiError with its status and message", async () => {
    const response = responseError(new ApiError(404, "Engagement not found"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Engagement not found" });
  });

  it.each([
    "D1_ERROR: UNIQUE constraint failed: invitations.tenant_id, invitations.email: SQLITE_CONSTRAINT",
    "UNIQUE constraint failed: workspace_drafts.tenant_id",
    "SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY KEY constraint failed",
  ])("answers a uniqueness race with a logged 409: %s", async (message) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = responseError(new Error(message));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Reload");
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    "D1_ERROR: NOT NULL constraint failed: engagements.title: SQLITE_CONSTRAINT",
    "CHECK constraint failed: role_check",
    "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT",
    "SQLITE_CONSTRAINT_NOTNULL",
  ])("logs a non-uniqueness constraint failure as a 500: %s", (message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = responseError(new Error(message));
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith(
      "Audit workspace request failed",
      message,
    );
  });

  it("logs a SyntaxError from stored data as a 500, not a request fault", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = responseError(syntaxError());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("JSON");
    expect(error).toHaveBeenCalled();
  });

  it("answers anything else with a 500 that does not reveal the cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = responseError(new Error("secret internals"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("request body JSON", () => {
  const encode = (s: string) => new TextEncoder().encode(s);

  it("decodes a JSON body", async () => {
    expect(parseJsonBody(encode('{"op":"x"}'))).toEqual({ op: "x" });
    const request = new Request("http://local/", {
      method: "POST",
      body: '{"a":1}',
    });
    expect(await readJson(request, 100)).toEqual({ a: 1 });
  });

  it("answers a request body that is not JSON with 400", async () => {
    let caught: unknown;
    try {
      parseJsonBody(encode("{op:"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const response = responseError(caught);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body is not valid JSON",
    });
  });
});

describe("imported JSON files (#220)", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).buffer;

  it("decodes a JSON file", () => {
    expect(parseJsonFile(bytes('{"type":"x"}'), "packet")).toEqual({
      type: "x",
    });
  });

  it.each(["{not json", "", '{"a":1}\n{"b":2}'])(
    "answers a file that is not JSON (%j) with 400 naming the file kind",
    async (text) => {
      let caught: unknown;
      try {
        parseJsonFile(bytes(text), "briefing");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ApiError);
      const response = responseError(caught);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "This briefing file is not valid JSON",
      });
    },
  );
});

describe("request bodies the app leaves unread (#209)", () => {
  /** A POST whose body arrives in `chunks` pieces, counting the reads. */
  function upload(chunks: number) {
    let delivered = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (delivered === chunks) return controller.close();
        delivered++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new Request("http://local/api/workspace", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    return { request, delivered: () => delivered };
  }

  it("reads nothing until the app asks, then passes the body through", async () => {
    const source = upload(3);
    const tracked = trackRequestBody(source.request);
    expect(source.delivered()).toBeLessThanOrEqual(1);
    expect((await readBounded(tracked.request, 1 << 20)).byteLength).toBe(3072);
    await tracked.settle();
    expect(source.delivered()).toBe(3);
  });

  it("drains a body the app never read", async () => {
    const source = upload(5);
    const tracked = trackRequestBody(source.request);
    await tracked.settle();
    expect(source.delivered()).toBe(5);
  });

  it("drains the rest of a body the app stopped reading with 413", async () => {
    const source = upload(8);
    const tracked = trackRequestBody(source.request);
    await expect(readBounded(tracked.request, 2048)).rejects.toMatchObject({
      status: 413,
    });
    await tracked.settle();
    expect(source.delivered()).toBe(8);
  });

  it("leaves a request without a body as it is", async () => {
    const request = new Request("http://local/api/workspace");
    const tracked = trackRequestBody(request);
    expect(tracked.request).toBe(request);
    await tracked.settle();
  });
});
