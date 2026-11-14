// The practice Access log and the paged engagement audit trail (#181): the
// Lead Auditor, who administers the demo practice, opens the Access log from
// the sidebar, filters it and exports it as CSV; a Lead Auditor who does not
// administer the practice reads it too; an Auditor and the client roles are
// refused. The engagement's audit history pages and filters through
// GET /api/audit-trail.
import type { Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { expect, persona, test, workspacePath } from "./fixtures";

/** Waits until the Access log shows its events. */
async function accessLogShown(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Access log", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".loading-grid")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "Access events" }),
  ).toBeVisible();
}

test("the Lead Auditor filters the Access log and exports it as CSV", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Overview"));
  await page
    .getByRole("navigation", { name: "Audit workspace navigation" })
    .getByRole("button", { name: "Access log" })
    .click();
  await accessLogShown(page);
  const table = page.getByRole("table", { name: "Access events" });
  // The seed granted every persona its membership, and the Lead's own visit
  // was recorded as a sign-in.
  await expect(
    table.getByRole("row").filter({ hasText: "Member granted" }).first(),
  ).toBeVisible();
  await expect(
    table
      .getByRole("row")
      .filter({ hasText: "Signed in" })
      .filter({ hasText: persona("qa-lead").name })
      .first(),
  ).toBeVisible();
  await expectAccessible(page, "Access log");

  const filters = page.getByRole("group", { name: "Filter the Access log" });
  const answered = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/access-log" &&
      new URL(r.url()).searchParams.get("action") === "signIn",
  );
  await filters.getByLabel("Event").selectOption("signIn");
  expect((await answered).status()).toBe(200);
  await expect(page.locator(".loading-grid")).toHaveCount(0);
  const rows = table.getByRole("row");
  // A header row and only sign-ins.
  await expect(rows.nth(1)).toContainText("Signed in");
  for (const text of await rows.allInnerTexts())
    if (!/^Time/.test(text)) expect(text).toContain("Signed in");
  await expectAccessible(page, "Access log filtered by event");

  // The export link carries the filters. A browser download in this suite
  // arrives without the persona's identity (the Worker answered it with an
  // error), so the spec reads the link through the page's request context,
  // as the coverage export spec does.
  const href = await page
    .getByRole("link", { name: "Export filtered CSV" })
    .getAttribute("href");
  expect(href).toContain("action=signIn");
  expect(href).toContain("format=csv");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
  expect(response.headers()["content-disposition"]).toBe(
    'attachment; filename="access-log.csv"',
  );
  const csv = await response.text();
  const lines = csv.trimEnd().split("\r\n");
  expect(lines[0]).toBe(
    "time_utc,event_id,event,actor_id,actor,member_id,member,role,details",
  );
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines.slice(1)) expect(line.split(",")[2]).toBe("signIn");
  expect(csv).toContain(persona("qa-lead").userId);
});

test("Lead Auditors and administrators read the Access log; others are refused", async ({
  api,
  signIn,
  demo,
}) => {
  // qa-lead2 leads engagements in the demo practice but does not administer it.
  const lead2 = await api("qa-lead2");
  expect((await lead2.workspace(demo.tenantId)).identity.practiceAdmin).toBe(
    false,
  );
  const page = await lead2.http.get(
    "/api/access-log?" +
      new URLSearchParams({ tenantId: demo.tenantId, limit: "2" }),
  );
  expect(page.status(), await page.text()).toBe(200);
  const first = await page.json();
  expect(first.events).toHaveLength(2);
  expect(first.next).toBeTruthy();
  const second = await (
    await lead2.http.get(
      "/api/access-log?" +
        new URLSearchParams({
          tenantId: demo.tenantId,
          limit: "2",
          cursor: first.next,
        }),
    )
  ).json();
  expect(second.events.map((e: { id: string }) => e.id)).not.toContain(
    first.events[0].id,
  );

  for (const id of [
    "qa-auditor",
    "qa-reviewer",
    "qa-viewer",
    "qa-contrib",
  ] as const) {
    const who = await api(id);
    for (const format of ["", "csv"]) {
      const refused = await who.http.get(
        "/api/access-log?" +
          new URLSearchParams({
            tenantId: demo.tenantId,
            ...(format ? { format } : {}),
          }),
      );
      expect(refused.status(), id + " " + format).toBe(403);
    }
  }
  // The Auditor's sidebar has no Access log.
  const auditor = await signIn("qa-auditor");
  await auditor.goto(workspacePath(demo, "Overview"));
  await expect(
    auditor.getByRole("heading", { level: 1 }).first(),
  ).toBeVisible();
  await expect(
    auditor
      .getByRole("navigation", { name: "Audit workspace navigation" })
      .getByRole("button", { name: "Access log" }),
  ).toHaveCount(0);
});

test("the engagement audit history pages and filters", async ({
  api,
  signIn,
  demo,
}) => {
  const lead = await api("qa-lead");
  const trail = (params: Record<string, string>) =>
    lead.http.get(
      "/api/audit-trail?" +
        new URLSearchParams({
          tenantId: demo.tenantId,
          engagementId: demo.engagementId,
          ...params,
        }),
    );
  const all = await (await trail({ limit: "200" })).json();
  expect(all.events.length).toBeGreaterThanOrEqual(3);
  // Page by page, the trail returns the same events in the same order.
  const paged: string[] = [];
  let cursor = "";
  for (let i = 0; i < 100; i++) {
    const page = await (
      await trail({ limit: "2", ...(cursor ? { cursor } : {}) })
    ).json();
    paged.push(...page.events.map((e: { id: string }) => e.id));
    if (!page.next) break;
    cursor = page.next;
  }
  expect(paged).toEqual(
    all.events.slice(0, paged.length).map((e: { id: string }) => e.id),
  );
  // Client roles read no trail.
  for (const id of ["qa-viewer", "qa-contrib"] as const) {
    const who = await api(id);
    const refused = await who.http.get(
      "/api/audit-trail?" +
        new URLSearchParams({
          tenantId: demo.tenantId,
          engagementId: demo.engagementId,
        }),
    );
    expect(refused.status(), id).toBe(403);
  }

  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Methodology"));
  await expect(
    page.getByRole("heading", { name: "Templates & history", level: 1 }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Audit history" }).click();
  const events = page.getByRole("table", { name: "Audit events" });
  await expect(events).toBeVisible();
  await expect(page.locator(".loading-grid")).toHaveCount(0);
  const action = all.events.find(
    (e: { action: string }) => e.action === "grantClientRequest",
  )
    ? "grantClientRequest"
    : all.events[0].action;
  const count = all.events.filter(
    (e: { action: string }) => e.action === action,
  ).length;
  const filtered = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/audit-trail" &&
      new URL(r.url()).searchParams.get("action") === action,
  );
  await page
    .getByRole("group", { name: "Filter the audit history" })
    .getByLabel("Event")
    .selectOption(action);
  expect((await filtered).status()).toBe(200);
  await expect(events.getByRole("row")).toHaveCount(Math.min(count, 50) + 1);
  await expectAccessible(page, "Audit history filtered by event");
});
