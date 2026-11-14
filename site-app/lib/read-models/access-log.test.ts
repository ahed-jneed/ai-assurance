// GET /api/access-log's read model against SQLite D1 (#181): membership,
// role and administration events and sign-ins in one cursor-paged log, its
// filters, its CSV export, and who may read it.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { member, practice, tenantId } from "../test-storage";
import { accessLogCsv, accessLogCsvColumns, accessLogPage } from "./access-log";
import { parseEventQuery, type EventQuery } from "./event-pages";

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

type Sqlite = Awaited<ReturnType<typeof practice>>["sqlite"];
const day = (d: number, t = "09:00:00.000") =>
  `2026-11-${String(d).padStart(2, "0")}T${t}Z`;
function managementEvent(
  sqlite: Sqlite,
  id: string,
  actor: string,
  action: string,
  details: unknown,
  createdAt: string,
  tenant = tenantId,
) {
  sqlite
    .prepare(
      "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES(?,?,?,?,?,'h',?)",
    )
    .run(
      tenant,
      id,
      actor,
      action,
      typeof details === "string" ? details : JSON.stringify(details),
      createdAt,
    );
}
function signIn(
  sqlite: Sqlite,
  id: string,
  userId: string,
  role: string,
  createdAt: string,
  tenant = tenantId,
) {
  sqlite
    .prepare(
      "INSERT INTO sign_in_events(tenant_id,id,user_id,role,created_at) VALUES(?,?,?,?,?)",
    )
    .run(tenant, id, userId, role, createdAt);
}
async function seeded() {
  const { sqlite } = await practice([]);
  managementEvent(
    sqlite,
    "M1",
    "lead",
    "inviteMember",
    { invitationId: "INV-1", email: "nia@example.test", role: "Auditor" },
    day(1),
  );
  signIn(sqlite, "S1", "lead", "Lead Auditor", day(1));
  managementEvent(
    sqlite,
    "M2",
    "lead",
    "grantMember",
    { userId: "auditor", role: "Auditor", status: "active" },
    day(2),
  );
  // Not about access: never listed.
  managementEvent(
    sqlite,
    "M3",
    "lead",
    "renamePractice",
    { name: "Firm" },
    day(3),
  );
  signIn(sqlite, "S2", "auditor", "Auditor", day(3));
  managementEvent(
    sqlite,
    "M4",
    "lead",
    "transferAdmin",
    { from: "lead", to: "auditor" },
    day(4),
  );
  managementEvent(sqlite, "M5", "lead", "revokeMember", "not json", day(5));
  // Another practice's events.
  sqlite
    .prepare(
      "INSERT INTO tenants(id,name,created_at) VALUES('tenant-2','Other',?)",
    )
    .run(day(1));
  signIn(sqlite, "X1", "lead", "Lead Auditor", day(2), "tenant-2");
  managementEvent(
    sqlite,
    "X2",
    "lead",
    "grantMember",
    { userId: "x", role: "Auditor" },
    day(2),
    "tenant-2",
  );
  return sqlite;
}
const q = (params: Record<string, string> = {}): EventQuery =>
  parseEventQuery(new URLSearchParams(params));
const ids = (page: { events: { id: string }[] }) =>
  page.events.map((e) => e.id);
// The Access log is for practice administrators only (#181): `lead` is a Lead
// Auditor who administers the practice, `admin` an Auditor who does.
const lead = () => ({ ...member("lead", "Lead Auditor"), practiceAdmin: true }),
  admin = () => ({ ...member("auditor", "Auditor"), practiceAdmin: true });

describe("accessLogPage", () => {
  it("lists access events and sign-ins of the practice only, newest first", async () => {
    await seeded();
    const page = await accessLogPage(lead(), q());
    expect(ids(page)).toEqual(["M5", "M4", "S2", "M2", "S1", "M1"]);
    expect(page.next).toBeNull();
    const byId = Object.fromEntries(page.events.map((e) => [e.id, e]));
    expect(byId.S2).toEqual({
      id: "S2",
      created_at: day(3),
      action: "signIn",
      actor: "auditor",
      actor_name: "auditor",
      subject: "auditor",
      subject_name: "auditor",
      role: "Auditor",
      details: null,
    });
    // An invitation names the invited email; a transfer, its recipient.
    expect(byId.M1).toMatchObject({
      subject: null,
      subject_name: "nia@example.test",
      role: "Auditor",
      details: { invitationId: "INV-1" },
    });
    expect(byId.M4).toMatchObject({ subject: "auditor", role: null });
    // Damaged details are listed without them.
    expect(byId.M5).toMatchObject({ subject: null, details: null });
    expect(page.actors).toEqual([
      { id: "auditor", name: "auditor" },
      { id: "lead", name: "lead" },
    ]);
    expect(page.actions).toContain("signIn");
    expect(page.actions).not.toContain("renamePractice");
  });

  it("pages across both sources at the boundaries", async () => {
    await seeded();
    const seen: string[] = [];
    let cursor: string | null = "";
    while (cursor !== null) {
      const page = await accessLogPage(
        lead(),
        q({ limit: "2", ...(cursor ? { cursor } : {}) }),
      );
      expect(page.events).toHaveLength(2);
      seen.push(...ids(page));
      cursor = page.next;
    }
    expect(seen).toEqual(["M5", "M4", "S2", "M2", "S1", "M1"]);
    const all = await accessLogPage(lead(), q({ limit: "6" }));
    expect(all.next).toBeNull();
  });

  it("filters by actor, event type and date range", async () => {
    await seeded();
    expect(ids(await accessLogPage(lead(), q({ actor: "auditor" })))).toEqual([
      "S2",
    ]);
    expect(ids(await accessLogPage(lead(), q({ action: "signIn" })))).toEqual([
      "S2",
      "S1",
    ]);
    expect(
      ids(
        await accessLogPage(
          lead(),
          q({ from: "2026-11-02", to: "2026-11-04" }),
        ),
      ),
    ).toEqual(["M4", "S2", "M2"]);
    expect(
      ids(await accessLogPage(lead(), q({ action: "renamePractice" }))),
    ).toEqual([]);
  });

  it("is for practice administrators only", async () => {
    await seeded();
    expect(ids(await accessLogPage(admin(), q({ limit: "1" })))).toEqual([
      "M5",
    ]);
    for (const refused of [
      member("lead", "Lead Auditor"),
      member("auditor", "Auditor"),
      member("reviewer", "Reviewer"),
      member("eqr", "Engagement Quality Reviewer"),
      member("viewer", "Client Viewer", "CL-1"),
      member("contributor", "Client Contributor", "CL-1"),
      { ...member("viewer", "Client Viewer", "CL-1"), practiceAdmin: true },
    ]) {
      await expect(accessLogPage(refused, q())).rejects.toMatchObject({
        status: 403,
      });
      await expect(accessLogCsv(refused, q())).rejects.toMatchObject({
        status: 403,
      });
    }
  });
});

describe("accessLogCsv", () => {
  it("exports every filtered event with neutralised formula cells", async () => {
    const sqlite = await seeded();
    sqlite
      .prepare("UPDATE memberships SET display_name=? WHERE user_id='auditor'")
      .run('=HYPERLINK("x")');
    const { filename, csv } = await accessLogCsv(
      lead(),
      q({ from: "2026-11-02", to: "2026-11-03" }),
    );
    expect(filename).toBe("access-log-2026-11-02-to-2026-11-03.csv");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(accessLogCsvColumns.join(","));
    expect(lines.slice(1)).toEqual([
      `${day(3)},S2,signIn,auditor,"'=HYPERLINK(""x"")",auditor,"'=HYPERLINK(""x"")",Auditor,`,
      `${day(2)},M2,grantMember,lead,lead,auditor,"'=HYPERLINK(""x"")",Auditor,"{""userId"":""auditor"",""role"":""Auditor"",""status"":""active""}"`,
    ]);
  });

  it("reads past one export batch without losing an event", async () => {
    const sqlite = await seeded();
    sqlite.exec("BEGIN");
    for (let i = 0; i < 1003; i++)
      signIn(
        sqlite,
        "B" + String(i).padStart(4, "0"),
        "lead",
        "Lead Auditor",
        day(20),
      );
    sqlite.exec("COMMIT");
    const { filename, csv } = await accessLogCsv(
      lead(),
      q({ action: "signIn" }),
    );
    expect(filename).toBe("access-log.csv");
    const rows = csv.trimEnd().split("\r\n").slice(1);
    expect(rows).toHaveLength(1005);
    expect(new Set(rows).size).toBe(1005);
    expect(rows.at(-1)).toMatch(/^2026-11-01T09:00:00.000Z,S1,signIn,lead,/);
  });
});
