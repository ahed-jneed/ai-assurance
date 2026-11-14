import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessLogCsvHref,
  accessLogQuery,
  eventLogParams,
  noEventFilters,
  trailQuery,
} from "./event-log-queries";

afterEach(() => vi.unstubAllGlobals());

describe("event log queries (#181)", () => {
  it("send only the set filters and the cursor", () => {
    expect(eventLogParams(noEventFilters)).toEqual({});
    expect(
      eventLogParams(
        { ...noEventFilters, actor: "u-1", to: "2026-11-05" },
        "c",
      ),
    ).toEqual({ actor: "u-1", to: "2026-11-05", cursor: "c" });
  });

  it("make one query object per page, so the cache shares it", () => {
    const filters = { ...noEventFilters, action: "editPaper" };
    expect(trailQuery(filters, "c1")).toBe(trailQuery({ ...filters }, "c1"));
    expect(trailQuery(filters, "c1")).not.toBe(trailQuery(filters, "c2"));
    expect(trailQuery(filters).key).not.toBe(accessLogQuery(filters).key);
  });

  it("read the trail of the engagement and the log of the practice through fetchJson", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({ events: [], next: null, actors: [], actions: [] });
    });
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await trailQuery({ ...noEventFilters, from: "2026-11-01" }).read(
      { tenantId: "t-1", engagementId: "E-1" },
      signal,
    );
    await accessLogQuery(noEventFilters, "c9").read(
      { tenantId: "t-1", engagementId: "" },
      signal,
    );
    expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/audit-trail?tenantId=t-1&engagementId=E-1&from=2026-11-01",
      "/api/access-log?tenantId=t-1&cursor=c9",
    ]);
  });

  it("fail with the server's error instead of parsing a failed answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error:
              "The Access log is for Lead Auditors and practice administrators",
          },
          { status: 403 },
        ),
      ),
    );
    await expect(
      accessLogQuery(noEventFilters).read(
        { tenantId: "t-1", engagementId: "" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, kind: "forbidden" });
  });

  it("export the filtered log without a cursor", () => {
    expect(
      accessLogCsvHref("t-1", { ...noEventFilters, action: "signIn" }),
    ).toBe("/api/access-log?tenantId=t-1&action=signIn&format=csv");
  });
});
