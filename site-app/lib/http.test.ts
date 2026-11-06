import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, parseJsonBody, readJson, responseError } from "./http";

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
