// GET /api/audit-trail's read model against SQLite D1 (#181): cursor pages
// that never repeat or skip an event, even when events share a timestamp,
// the filters, and the same scope as the trail the workspace load returns.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../http";
import {
  engagementWithParts,
  member,
  practice,
  tenantId,
} from "../test-storage";
import { auditTrailPage } from "./audit-trail";
import { parseEventQuery, type EventQuery } from "./event-pages";

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

type Sqlite = Awaited<ReturnType<typeof practice>>["sqlite"];
function event(
  sqlite: Sqlite,
  engagementId: string,
  id: string,
  actor: string,
  action: string,
  createdAt: string,
  tenant = tenantId,
) {
  sqlite
    .prepare(
      "INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) VALUES(?,?,?,?,?,'p','h',?,'{}')",
    )
    .run(tenant, engagementId, id, actor, action, createdAt);
}
/** ENG-A with seven events (three in one millisecond), ENG-B with one. */
async function seeded() {
  const { sqlite } = await practice(
    [
      engagementWithParts("ENG-A", "Alpha audit"),
      engagementWithParts("ENG-B", "Beta audit"),
    ],
    ["ENG-A"],
  );
  const day = (d: number, t = "09:00:00.000") => `2026-11-0${d}T${t}Z`;
  event(sqlite, "ENG-A", "E1", "lead", "createPaper", day(1));
  event(sqlite, "ENG-A", "E2", "auditor", "editPaper", day(2));
  event(sqlite, "ENG-A", "E3", "auditor", "editPaper", day(3));
  event(sqlite, "ENG-A", "E4", "lead", "submitPaper", day(3));
  event(sqlite, "ENG-A", "E5", "auditor", "editPaper", day(3));
  event(sqlite, "ENG-A", "E6", "lead", "signPaper", day(4, "23:59:59.999"));
  event(sqlite, "ENG-A", "E7", "ghost", "editPaper", day(5));
  event(sqlite, "ENG-B", "B1", "lead", "createPaper", day(2));
  // Another practice with an engagement of the same id.
  sqlite
    .prepare(
      "INSERT INTO tenants(id,name,created_at) VALUES('tenant-2','Other',?)",
    )
    .run(day(1));
  sqlite
    .prepare(
      "INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('CL-1','tenant-2','Other client','Finance',?)",
    )
    .run(day(1));
  sqlite
    .prepare(
      "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES('ENG-A','tenant-2','CL-1','Other',1,'{}','init')",
    )
    .run();
  event(sqlite, "ENG-A", "X1", "lead", "createPaper", day(3), "tenant-2");
  return sqlite;
}
const q = (params: Record<string, string> = {}): EventQuery =>
  parseEventQuery(new URLSearchParams(params));
const ids = (page: { events: { id: string }[] }) =>
  page.events.map((e) => e.id);
const lead = () => member("lead", "Lead Auditor"),
  auditor = () => member("auditor", "Auditor");

describe("auditTrailPage", () => {
  it("pages newest first by (created_at, id) without repeating or skipping an event", async () => {
    await seeded();
    const seen: string[] = [];
    let cursor: string | null = "";
    let pages = 0;
    while (cursor !== null) {
      const page = await auditTrailPage(
        lead(),
        "ENG-A",
        q({ limit: "2", ...(cursor ? { cursor } : {}) }),
      );
      expect(page.events.length).toBeLessThanOrEqual(2);
      seen.push(...ids(page));
      cursor = page.next;
      pages++;
    }
    expect(seen).toEqual(["E7", "E6", "E5", "E4", "E3", "E2", "E1"]);
    expect(pages).toBe(4);
  });

  it("ends exactly at a page boundary with no empty page after it", async () => {
    await seeded();
    const first = await auditTrailPage(lead(), "ENG-A", q({ limit: "7" }));
    expect(ids(first)).toHaveLength(7);
    expect(first.next).toBeNull();
    const six = await auditTrailPage(lead(), "ENG-A", q({ limit: "6" }));
    expect(six.next).not.toBeNull();
    const rest = await auditTrailPage(
      lead(),
      "ENG-A",
      q({ limit: "6", cursor: six.next! }),
    );
    expect(ids(rest)).toEqual(["E1"]);
    expect(rest.next).toBeNull();
  });

  it("splits a page inside events that share a timestamp", async () => {
    await seeded();
    const first = await auditTrailPage(lead(), "ENG-A", q({ limit: "3" }));
    expect(ids(first)).toEqual(["E7", "E6", "E5"]);
    const second = await auditTrailPage(
      lead(),
      "ENG-A",
      q({ limit: "3", cursor: first.next! }),
    );
    expect(ids(second)).toEqual(["E4", "E3", "E2"]);
  });

  it("filters by actor, event type and an inclusive UTC date range", async () => {
    await seeded();
    expect(
      ids(await auditTrailPage(lead(), "ENG-A", q({ actor: "auditor" }))),
    ).toEqual(["E5", "E3", "E2"]);
    expect(
      ids(await auditTrailPage(lead(), "ENG-A", q({ action: "editPaper" }))),
    ).toEqual(["E7", "E5", "E3", "E2"]);
    expect(
      ids(
        await auditTrailPage(
          lead(),
          "ENG-A",
          q({ from: "2026-11-03", to: "2026-11-04" }),
        ),
      ),
    ).toEqual(["E6", "E5", "E4", "E3"]);
    const combined = await auditTrailPage(
      lead(),
      "ENG-A",
      q({
        actor: "auditor",
        action: "editPaper",
        from: "2026-11-03",
        limit: "1",
      }),
    );
    expect(ids(combined)).toEqual(["E5"]);
    expect(
      ids(
        await auditTrailPage(
          lead(),
          "ENG-A",
          q({
            actor: "auditor",
            action: "editPaper",
            from: "2026-11-03",
            limit: "1",
            cursor: combined.next!,
          }),
        ),
      ),
    ).toEqual(["E3"]);
  });

  it("names the actors and event types its filters offer", async () => {
    await seeded();
    const page = await auditTrailPage(lead(), "ENG-A", q());
    expect(page.actors).toEqual([
      { id: "auditor", name: "auditor" },
      // Without a membership the user id stands in for the name.
      { id: "ghost", name: "ghost" },
      { id: "lead", name: "lead" },
    ]);
    expect(page.actions).toEqual([
      "createPaper",
      "editPaper",
      "signPaper",
      "submitPaper",
    ]);
    expect(page.events[0]).toMatchObject({ id: "E7", actor_name: "ghost" });
  });

  it("keeps to the engagement and the practice", async () => {
    await seeded();
    expect(ids(await auditTrailPage(lead(), "ENG-B", q()))).toEqual(["B1"]);
    const all = await auditTrailPage(lead(), "ENG-A", q({ limit: "200" }));
    expect(ids(all)).not.toContain("X1");
    expect(ids(all)).not.toContain("B1");
    // A member of the other practice reads only its own trail.
    const other = { ...lead(), tenantId: "tenant-2" };
    await expect(auditTrailPage(other, "ENG-A", q())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("is refused without an engagement grant and to client roles", async () => {
    const sqlite = await seeded();
    await expect(auditTrailPage(auditor(), "ENG-B", q())).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(
      auditTrailPage(auditor(), "ENG-NONE", q()),
    ).rejects.toMatchObject({ status: 404 });
    sqlite
      .prepare(
        "UPDATE engagement_access SET active=0 WHERE engagement_id='ENG-A' AND user_id='auditor'",
      )
      .run();
    await expect(auditTrailPage(auditor(), "ENG-A", q())).rejects.toMatchObject(
      { status: 404 },
    );
    for (const client of [
      member("viewer", "Client Viewer", "CL-1"),
      member("contributor", "Client Contributor", "CL-1"),
    ]) {
      const refusal = await auditTrailPage(client, "ENG-A", q()).catch(
        (e: unknown) => e,
      );
      expect(refusal).toBeInstanceOf(ApiError);
      expect((refusal as ApiError).status).toBe(403);
    }
  });
});

describe("parseEventQuery", () => {
  it("reads the filters, ignores empty and scope parameters and defaults the page size", () => {
    expect(
      q({
        tenantId: "t",
        engagementId: "e",
        format: "csv",
        actor: "",
        action: "editPaper",
      }),
    ).toEqual({ action: "editPaper", limit: 50 });
  });

  it("refuses an unknown parameter, a bad date, a reversed range, a bad cursor or page size", () => {
    for (const params of <Record<string, string>[]>[
      { sort: "asc" },
      { from: "2026-13-40" },
      { from: "yesterday" },
      { from: "2026-11-05", to: "2026-11-04" },
      { cursor: "not-a-cursor" },
      { limit: "0" },
      { limit: "201" },
      { action: "edit paper; DROP" },
    ])
      expect(() => q(params), JSON.stringify(params)).toThrow(ApiError);
  });
});
