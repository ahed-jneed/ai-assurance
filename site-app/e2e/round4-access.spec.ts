// Round-4 access fixes (#225) with real clicks and keys. A Lead Auditor
// grants an existing Engagement Quality Reviewer engagement access in Team &
// runtime and appoints them in Quality review, which clears the capture
// blocker; Edit access lists engagements for a staff member without a role
// change. An account with no active role gets the minimal shell. A
// practice-only link opens that practice; an unknown engagement tells an
// internal member it does not exist; the Auditor's Client submissions panel
// names the contributor.
import type { Browser } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { engagementOf, newEngagement } from "./engagement";
import {
  choose,
  expect,
  identityHeaders,
  ownPractice,
  persona,
  runCommand,
  test,
  unique,
  workspacePath,
  type Persona,
} from "./fixtures";

const management = { path: "/api/management" };
const appointBlocker = "Appoint an engagement quality reviewer";

test("a Lead grants the EQR engagement access in Team & runtime and appoints them", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const eqr = persona("qa-eqr");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E EQR access",
  );
  const page = await signIn("qa-lead");
  const reports = async () => {
    await page.goto(workspacePath(e, "Reports & sign-off"));
    await page.getByRole("tab", { name: /^Completion checklist/ }).click();
    await choose(
      page.getByRole("tabpanel"),
      "Engagement type",
      "Attestation engagement",
    );
  };
  // A capture requirement of the Completion checklist, by its title.
  const gate = (title: string) =>
    page
      .getByRole("tabpanel")
      .getByRole("button", { name: new RegExp("^" + title) });
  const quality = () =>
    page.getByRole("region", { name: "Engagement quality review" });
  const reviewerPicker = () =>
    quality().locator("form.quality-review-appoint select");

  // Without engagement access nobody can be appointed.
  await reports();
  await expect(gate(appointBlocker)).toBeVisible();
  await page.getByRole("tab", { name: "Quality review" }).click();
  await expect(reviewerPicker().locator("option")).toHaveText([
    "Select an eligible reviewer",
  ]);

  // Team & runtime offers the EQR among the staff members.
  await page.goto(workspacePath(e, "Assurance workbench") + "&section=access");
  await page.getByRole("button", { name: "Manage access" }).click();
  const form = page.getByRole("dialog", { name: "Manage engagement access" });
  const member = form.locator("select[name=userId]");
  await expect(member.locator("option")).toContainText([
    `${eqr.name} · Engagement Quality Reviewer`,
  ]);
  await member.selectOption({
    label: `${eqr.name} · Engagement Quality Reviewer`,
  });
  await form.locator("select[name=active]").selectOption("true");
  await form
    .locator("textarea[name=reason]")
    .fill("Engagement quality review of this engagement");
  await expectAccessible(page, "Manage engagement access with the EQR");
  const granted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/assurance",
  );
  await form.getByRole("button", { name: "Save access decision" }).click();
  expect((await granted).status()).toBe(200);
  await expect(form).toBeHidden();
  await expect(
    page.locator(".execution-row").filter({ hasText: eqr.name }),
  ).toContainText("Granted");

  // Quality review now lists them; appointing them clears the blocker.
  await reports();
  await page.getByRole("tab", { name: "Quality review" }).click();
  await reviewerPicker().selectOption({ label: eqr.name });
  await quality()
    .getByLabel("Reason")
    .fill("Independent of the engagement team");
  await runCommand(page, "appointQualityReviewer", () =>
    quality().getByRole("button", { name: "Appoint reviewer" }).click(),
  );
  await expect(quality().getByText(eqr.name).first()).toBeVisible();
  await page.getByRole("tab", { name: /^Completion checklist/ }).click();
  await expect(gate("Complete the quality review")).toBeVisible();
  await expect(gate(appointBlocker)).toHaveCount(0);
  expect((await engagementOf(lead, e)).qualityReview.reviewerId).toBe(
    eqr.userId,
  );
});

test("Edit access lists the engagements of a staff member who keeps the role", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const eqr = await api("qa-eqr");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E EQR edit access",
  );
  const title = (await engagementOf(lead, e)).title;
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Users & access"));
  await page
    .getByRole("row")
    .filter({ hasText: eqr.who.name })
    .getByRole("button", { name: "Edit access" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit access" });
  const access = dialog.getByRole("group", { name: "Engagement access" });
  // The engagement the EQR already holds stays ticked and fixed.
  const held = access.getByRole("checkbox", { name: demoTitle });
  await expect(held).toBeChecked();
  await expect(held).toBeDisabled();
  const added = access.getByRole("checkbox", { name: title });
  await expect(added).not.toBeChecked();
  await expectAccessible(page, "Edit access of the EQR");
  await added.check();
  await runCommand(
    page,
    "updateMember",
    () => dialog.getByRole("button", { name: "Update access" }).click(),
    management,
  );
  await expect(dialog).toBeHidden();
  // The EQR opens the engagement and still keeps the demo engagement.
  expect((await eqr.workspace(e.tenantId, e.engagementId)).engagement.id).toBe(
    e.engagementId,
  );
  expect(
    (await eqr.workspace(demo.tenantId, demo.engagementId)).engagement.id,
  ).toBe(demo.engagementId);
});
const demoTitle = "Acme credit scoring model audit";

/** A signed-in page for an identity outside the persona fixture. */
async function pageAs(browser: Browser, baseURL: string, who: Persona) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: identityHeaders(who),
    locale: "en-GB",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  });
  return { context, page: await context.newPage() };
}

test("an account with no active role gets the minimal shell", async ({
  browser,
  baseURL,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const run = unique();
  const identity = (id: string, name: string, domain = "personas.test") =>
    ({
      id: "qa-outsider",
      userId: `r4-${id}-${run}`,
      email: `r4-${id}-${run}@${domain}`,
      name,
      role: null,
    }) as Persona;
  // Never a member (outside the self-signup domain), revoked staff and a
  // revoked client member.
  const nobody = identity("nobody", "R4 Nobody", "example.test"),
    staff = identity("staff", "R4 Revoked Auditor"),
    client = identity("client", "R4 Revoked Contributor");
  for (const [who, role, clientId] of [
    [staff, "Auditor", null],
    [client, "Client Contributor", demo.clientId],
  ] as const) {
    await lead.manage(demo.tenantId, "grantMember", {
      userId: who.userId,
      displayName: who.name,
      role,
      clientId,
      ...(clientId ? {} : { engagementIds: [] }),
    });
    await lead.manage(demo.tenantId, "revokeMember", { userId: who.userId });
  }
  for (const [who, reason] of [
    [nobody, "You have no practice membership or pending invitation"],
    [staff, "Your practice access has been revoked"],
    [client, "Your practice access has been revoked"],
  ] as const) {
    const { context, page } = await pageAs(browser, baseURL!, who);
    await page.goto("/");
    await expect(page.getByText(reason)).toBeVisible();
    // No practice navigation, breadcrumb or search.
    await expect(
      page.getByRole("navigation", { name: "Audit workspace navigation" }),
    ).toHaveCount(0);
    await expect(page.getByText("Members & access")).toHaveCount(0);
    await expect(
      page.getByText("Audit workspace", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".workspace-breadcrumbs")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Search workspace" }),
    ).toHaveCount(0);
    // The account names the person and offers Sign out.
    await expect(page.getByText(who.name, { exact: true })).toBeVisible();
    await expectAccessible(page, "Minimal shell for " + who.name);
    await page.getByRole("button", { name: "Account: " + who.name }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText(who.name);
    await expect(
      menu.getByRole("menuitem", { name: "Sign out" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await context.close();
  }
});

test("a practice-only link opens that practice at the Overview", async ({
  signIn,
  api,
  demo,
}) => {
  // qa-lead2 belongs to the demo practice and leads a practice of their own.
  const lead2 = await api("qa-lead2");
  const own = ownPractice(lead2.who);
  const page = await signIn("qa-lead2");
  const ownView = (await lead2.workspace(own)).engagement
    ? "Overview"
    : "Engagements";
  // Either practice may be the default one: each link opens its own.
  for (const [practice, view] of [
    [demo.tenantId, "Overview"],
    [own, ownView],
  ]) {
    await page.goto("/?" + new URLSearchParams({ practice }));
    await expect
      .poll(() => {
        const q = new URL(page.url()).searchParams;
        return [q.get("practice"), q.get("view")];
      })
      .toEqual([practice, view]);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("an unknown engagement tells an internal member it does not exist", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-auditor");
  await page.goto(
    workspacePath(
      { tenantId: demo.tenantId, engagementId: "ENG-DOES-NOT-EXIST" },
      "Overview",
    ),
  );
  await expect(
    page.getByText(
      "This engagement does not exist in this practice or you no longer have access.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Ask your Lead Auditor to assign client access."),
  ).toHaveCount(0);
  await expectAccessible(page, "Unknown engagement");
  await page
    .getByRole("button", { name: "Open the Engagements directory" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Engagements", level: 1 }),
  ).toBeVisible();
});

test("the Auditor's Client submissions panel names the contributor", async ({
  signIn,
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor");
  const contributor = persona("qa-contrib");
  const w = await auditor.workspace(demo.tenantId, demo.engagementId);
  // The read model sends the holder's name and state, nothing more.
  expect(w.members).toEqual([]);
  expect(w.clientGrantHolders).toContainEqual({
    user_id: contributor.userId,
    display_name: contributor.name,
    active: true,
  });
  expect(JSON.stringify(w.clientGrantHolders)).not.toContain("@");

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(demo, "Evidence vault"));
  await page.getByRole("tab", { name: /^Requests/ }).click();
  await page.getByText("Client submissions").click();
  const panel = page.locator("details.captured-record").filter({
    hasText: "Client submissions",
  });
  await expect(
    panel.getByText(`${contributor.name} ·`, { exact: false }).first(),
  ).toBeVisible();
  await expect(panel.getByText("Inactive contributor")).toHaveCount(0);
  await expectAccessible(page, "Client submissions with contributor names");
});
