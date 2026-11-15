// Round-7 fixes (#244) with real clicks and keys: Release is disabled with
// the server's reason when the signed-off Engagement Quality Reviewer was
// revoked afterwards; the reviewer picker lists the members the server would
// refuse as disabled, with the reason, and a refused appointment keeps the
// typed reason and shows the refusal in the form; adding an active member by
// account ID is refused in the wizard; and an access decision that revoked a
// member's access still names them.
import { request as playwrightRequest } from "@playwright/test";
import { expectAccessible } from "./a11y";
import {
  engagementInSignOff,
  finalReport,
  newEngagement,
  RELEASE_CHECKLIST,
  run,
  type Engagement,
} from "./engagement";
import {
  Api,
  expect,
  identityHeaders,
  persona,
  recordPath,
  runCommand,
  test,
  unique,
  workspacePath,
  type Persona,
} from "./fixtures";

const STAND_BACK = [
  "understanding",
  "judgments",
  "documentation",
  "independence",
  "consultation",
  "involvement",
  "report",
];
const qualityReviewer = "Engagement Quality Reviewer";

/**
 * A throwaway member of the demo practice, so revoking them or changing
 * their role never touches a persona other specs rely on. They sign in with
 * the persona domain's trusted headers.
 */
async function throwawayMember(
  lead: Api,
  e: Engagement,
  label: string,
  role: string,
  engagementIds: string[],
) {
  const u = unique();
  const who = {
    id: "qa-eqr",
    userId: `e2e-r7-${label}-${u}`,
    email: `e2e-r7-${label}-${u}@personas.test`,
    name: `R7 ${label} ${u}`,
    role,
  } as Persona;
  await lead.manage(e.tenantId, "grantMember", {
    userId: who.userId,
    displayName: who.name,
    role,
    clientId: null,
    engagementIds,
  });
  return who;
}
async function apiOf(who: Persona, baseURL: string) {
  const http = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: identityHeaders(who),
    timeout: 15_000,
  });
  return new Api(who, http, baseURL);
}
/** Moves a member to another role, keeping only the listed engagements. */
const changeRole = (
  lead: Api,
  e: Engagement,
  who: Persona,
  role: string,
  engagementIds: string[],
) =>
  lead.manage(e.tenantId, "updateMember", {
    userId: who.userId,
    displayName: who.name,
    role,
    clientId: null,
    engagementIds,
  });

test("Release is disabled with the server's reason once the signed-off EQR is revoked", async ({
  signIn,
  api,
  demo,
  baseURL,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await engagementInSignOff(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E round-7 EQR re-check",
  );
  const who = await throwawayMember(lead, e, "eqr", qualityReviewer, [
    e.engagementId,
  ]);
  const eqr = await apiOf(who, baseURL!);
  try {
    await run(lead, e, "appointQualityReviewer", {
      userId: who.userId,
      reason: "Independent of this engagement team",
    });
    await run(eqr, e, "saveQualityReview", {
      items: STAND_BACK.map((id) => ({
        id,
        status: "satisfied",
        notes: "Evaluated (persona suite)",
      })),
    });
    const report = await finalReport(lead, e, "Readiness report, EQR revoked.");
    await run(reviewer, e, "approveReportPackage", {
      reportId: report.id,
      internalHash: report.sha256,
      clientHash: report.clientSha256,
      reason: "Both packages reviewed",
      checklist: RELEASE_CHECKLIST,
    });
    await run(eqr, e, "signOffQualityReview", {
      reportId: report.id,
      internalHash: report.sha256,
      clientHash: report.clientSha256,
      conclusion: "Stand-back review complete",
    });
    // After the sign-off the reviewer's practice access is revoked.
    await lead.manage(e.tenantId, "revokeMember", { userId: who.userId });

    const reason =
      "The engagement quality reviewer is no longer an active member with the Engagement Quality Reviewer role; appoint an eligible reviewer and obtain their sign-off before release";
    const page = await signIn("qa-lead");
    await page.goto(workspacePath(e, "Reports & sign-off"));
    const handoff = page.getByRole("region", { name: "Report handoff" });
    await expect(
      handoff.getByText("Both package versions are approved. " + reason + "."),
    ).toBeVisible();
    await expect(handoff.locator(".badge").first()).toHaveClass(/amber/);
    await page.goto(recordPath(e, "Reports & sign-off", "report", report.id));
    const sheet = page.getByRole("dialog");
    const releaseButton = sheet.getByRole("button", {
      name: "Release to client",
    });
    await expect(releaseButton).toBeDisabled();
    await expect(releaseButton).toHaveAccessibleDescription(reason);
    await expect(
      sheet.getByText("Both package versions are approved. " + reason + "."),
    ).toBeVisible();
    await expectAccessible(page, "Approved package with a revoked EQR");
    // The server refuses the release with the same reason.
    const w = await lead.workspace(e.tenantId, e.engagementId);
    const refused = await lead.post("/api/workspace", {
      tenantId: e.tenantId,
      engagementId: e.engagementId,
      expectedVersion: w.engagement.version,
      op: "releaseReport",
      data: {
        reportId: report.id,
        recipientScope: "Client members",
        reason: "Release",
      },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toBe(reason);
  } finally {
    await eqr.http.dispose();
  }
});

test("the reviewer picker shows who the server refuses, and a refusal keeps the reason", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-7 reviewer picker",
  );
  const other = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-7 earlier engagement",
  );
  // On this engagement's team: granted it as an Auditor before taking the
  // reviewer role.
  const onTeam = await throwawayMember(lead, e, "team", "Auditor", [
    e.engagementId,
  ]);
  await changeRole(lead, e, onTeam, qualityReviewer, [e.engagementId]);
  // On the team of another of Acme's engagements within the cooling-off.
  const coolingOff = await throwawayMember(lead, e, "cooling", "Auditor", [
    other.engagementId,
  ]);
  await changeRole(lead, e, coolingOff, qualityReviewer, [e.engagementId]);
  const eligible = await throwawayMember(lead, e, "ok", qualityReviewer, [
    e.engagementId,
  ]);

  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Reports & sign-off"));
  await page.getByRole("tab", { name: "Quality review" }).click();
  const quality = page.getByRole("region", {
    name: "Engagement quality review",
  });
  const picker = quality.locator("form.quality-review-appoint select");
  const option = (who: Persona) =>
    picker.locator("option", { hasText: who.name });
  await expect(option(eligible)).toHaveJSProperty("disabled", false);
  await expect(option(eligible)).toHaveText(eligible.name);
  await expect(option(onTeam)).toHaveJSProperty("disabled", true);
  await expect(option(onTeam)).toHaveText(
    onTeam.name +
      " (not eligible: This person is on the engagement team (a preparer, reviewer or Lead of this engagement) and cannot be its quality reviewer)",
  );
  await expect(option(coolingOff)).toHaveJSProperty("disabled", true);
  await expect(option(coolingOff)).toContainText(
    // #246 item 3: the earlier engagement by its title, not its id.
    "(not eligible: This person served on the team of " +
      other.title +
      " for the same client within the",
  );
  await expect(option(coolingOff)).not.toContainText(other.engagementId);
  await expectAccessible(page, "Reviewer picker with refused members");

  // The Lead picks the eligible member and writes a reason; meanwhile the
  // member serves on the earlier engagement, so the server refuses them.
  await picker.selectOption({ label: eligible.name });
  const reason = quality.getByLabel("Reason");
  const typed = `Independent of the engagement team (${unique()})`;
  await reason.fill(typed);
  await changeRole(lead, e, eligible, "Auditor", [other.engagementId]);
  await changeRole(lead, e, eligible, qualityReviewer, [e.engagementId]);
  const appoint = quality.getByRole("button", { name: "Appoint reviewer" });
  await runCommand(page, "appointQualityReviewer", () => appoint.click(), {
    status: 409,
  });
  const alert = quality.getByRole("alert");
  await expect(alert).toContainText(
    "This person served on the team of " + other.title + " for the same",
  );
  await expect(alert).not.toContainText(other.engagementId);
  await expect(reason).toHaveValue(typed);
  await expect(appoint).toBeEnabled();
  // The refusal shows in the form only, not as a toast.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expectAccessible(page, "Refused reviewer appointment");
});

test("adding an active member by account ID is refused in the wizard, and their name is kept", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = persona("qa-auditor");
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Users & access"));
  await expect(
    page.getByRole("heading", { name: "Members & access", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add member" }).click();
  const wizard = page.getByRole("dialog", {
    name: "Add colleague or client contact",
  });
  await wizard.getByLabel("Display name").fill("Someone else");
  await wizard
    .getByLabel("They have signed in and shared their account ID")
    .check();
  await wizard.getByLabel("Signed-in account ID").fill(auditor.userId);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Audit role").selectOption("Auditor");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await runCommand(
    page,
    "grantMember",
    () => wizard.getByRole("button", { name: "Confirm access" }).click(),
    { status: 409, path: "/api/management" },
  );
  await expect(wizard.getByRole("alert")).toHaveText(
    auditor.name +
      " is already an active member. Change their role or engagements in Members & access instead.",
  );
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expectAccessible(page, "Wizard refusing an active member");
  const members = (await lead.workspace(demo.tenantId)).members as {
    user_id: string;
    display_name: string;
  }[];
  expect(members.find((m) => m.user_id === auditor.userId)?.display_name).toBe(
    auditor.name,
  );
});

test("an access decision that revoked a member's access still names them", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-7 revocation",
  );
  const member = persona("qa-reviewer");
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Assurance workbench"));
  await page.getByRole("tab", { name: "Team & runtime" }).click();
  const decide = async (access: string, why: string) => {
    await page.getByRole("button", { name: "Manage access" }).click();
    const form = page
      .getByRole("dialog")
      .filter({ hasText: "Manage engagement access" });
    await form.getByLabel("Internal practice member").selectOption({
      label: member.name + " · Reviewer",
    });
    await form.getByLabel("Engagement access").selectOption({ label: access });
    await form.getByRole("textbox", { name: "Reason" }).fill(why);
    await runCommand(
      page,
      "setAccess",
      () => form.getByRole("button", { name: "Save access decision" }).click(),
      { path: "/api/assurance" },
    );
    const sheet = page.getByRole("dialog", { name: "Access decision" });
    await expect(sheet).toBeVisible();
    return sheet;
  };
  let sheet = await decide("Grant access", "Second reviewer for the suite");
  await expect(sheet.getByText(member.name)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  sheet = await decide("Revoke access", "No longer needed on this engagement");
  await expect(sheet.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(sheet.getByText(member.name)).toBeVisible();
  await expect(sheet).not.toContainText("Practice member");
  await expectAccessible(page, "Access decision revoking access");
});
