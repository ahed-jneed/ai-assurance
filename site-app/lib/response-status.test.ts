import { describe, expect, it } from "vitest";
import { setResponseStatus, withResponseStatus } from "./response-status";

describe("a page-recorded response status (#216)", () => {
  it("replaces a 200 and keeps the body and headers", async () => {
    const response = await withResponseStatus(async () => {
      await Promise.resolve();
      setResponseStatus(500);
      return new Response("fallback", {
        headers: { "content-type": "text/html" },
      });
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("fallback");
  });

  it("leaves a response alone when nothing was recorded", async () => {
    const response = await withResponseStatus(async () => new Response("ok"));
    expect(response.status).toBe(200);
  });

  it("never replaces a status other than 200", async () => {
    const response = await withResponseStatus(async () => {
      setResponseStatus(500);
      return new Response(null, { status: 307, headers: { location: "/" } });
    });
    expect(response.status).toBe(307);
  });

  it("keeps concurrent requests apart, and ignores calls outside a request", async () => {
    setResponseStatus(500);
    const [a, b] = await Promise.all([
      withResponseStatus(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return new Response("a");
      }),
      withResponseStatus(async () => {
        setResponseStatus(500);
        return new Response("b");
      }),
    ]);
    expect([a.status, b.status]).toEqual([200, 500]);
  });
});
