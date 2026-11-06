import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, responseError } from "./http";

afterEach(() => vi.restoreAllMocks());

describe("responseError", () => {
  it("answers an ApiError with its status and message", async () => {
    const response = responseError(new ApiError(404, "Engagement not found"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Engagement not found" });
  });

  it("answers a request body that is not JSON with 400", async () => {
    let error: unknown;
    try {
      JSON.parse("{op:");
    } catch (e) {
      error = e;
    }
    const response = responseError(error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body is not valid JSON",
    });
  });

  it.each([
    "D1_ERROR: UNIQUE constraint failed: invitations.tenant_id, invitations.email: SQLITE_CONSTRAINT",
    "UNIQUE constraint failed: workspace_drafts.tenant_id",
  ])("answers a constraint race with 409: %s", async (message) => {
    const response = responseError(new Error(message));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Reload");
  });

  it("answers anything else with a 500 that does not reveal the cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = responseError(new Error("secret internals"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
