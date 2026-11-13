// Practice administration: the Lead Auditor, who administers the demo
// practice, invites a colleague by email and cancels the invitation, makes
// the second Lead an administrator and removes it again, and rotates the
// practice's signing key, all in Users & access. A member who does not
// administer the practice is refused each of these.
import type { Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import {
  expect,
  persona,
  runCommand,
  test,
  unique,
  workspacePath,
  type Api,
} from "./fixtures";

const management = { path: "/api/management" };

async function members(api: Api, tenantId: string) {
  return (await api.workspace(tenantId)).members as {
    user_id: string;
    practice_admin: boolean;
  }[];
}

/** Opens Users & access, where the practice's members are listed. */
async function usersAndAccess(page: Page, path: string) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Members & access", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite by email" }),
  ).toBeEnabled();
}

test("a non-administrator cannot administer the practice", async ({
  api,
  demo,
}) => {
  // qa-lead2 is a Lead Auditor of the demo practice but not its administrator.
  const lead2 = await api("qa-lead2");
  const w = await lead2.workspace(demo.tenantId);
  expect(w.identity.practiceAdmin).toBeFalsy();
  for (const [op, data] of [
    [
      "inviteMember",
      { email: `refused-${unique()}@personas.test`, role: "Auditor" },
    ],
    ["grantAdmin", { userId: persona("qa-reviewer").userId }],
    ["rotateSigningKey", { reason: "Not an administrator" }],
  ] as const) {
    const response = await lead2.post("/api/management", {
      tenantId: demo.tenantId,
      expectedVersion: w.managementVersion,
      op,
      data,
    });
    expect(response.status(), op).toBe(403);
  }
});

test("the administrator manages invitations, administrators and the signing key", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const lead2 = persona("qa-lead2");
  // A run interrupted after the grant leaves qa-lead2 an administrator.
  if (
    (await members(lead, demo.tenantId)).find((m) => m.user_id === lead2.userId)
      ?.practice_admin
  )
    await lead.manage(demo.tenantId, "revokeAdmin", { userId: lead2.userId });

  const page = await signIn("qa-lead");
  const path = workspacePath(demo, "Users & access");
  await usersAndAccess(page, path);
  await expectAccessible(page, "Members and access");

  // Invite a colleague by email, then cancel the invitation.
  const email = `invitee-${unique()}@personas.test`;
  await page.getByRole("button", { name: "Invite by email" }).click();
  const invite = page.getByRole("dialog", { name: "Invite by email" });
  await invite.getByLabel("Email").fill(email);
  await invite.getByLabel("Name (optional)").fill("E2E Invitee");
  await expectAccessible(page, "Invitation form", { include: "[role=dialog]" });
  await runCommand(
    page,
    "inviteMember",
    () => invite.getByRole("button", { name: "Save invitation" }).click(),
    management,
  );
  await expect(invite).toBeHidden();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  const pending = async () =>
    (await lead.workspace(demo.tenantId)).invitations.filter(
      (i: { email: string }) => i.email === email,
    );
  expect(await pending()).toEqual([
    expect.objectContaining({ role: "Auditor", display_name: "E2E Invitee" }),
  ]);

  await row.getByRole("button", { name: "Cancel" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancel invitation" });
  await expectAccessible(page, "Cancel invitation", {
    include: "[role=dialog]",
  });
  await runCommand(
    page,
    "cancelInvitation",
    () => cancel.getByRole("button", { name: "Cancel invitation" }).click(),
    management,
  );
  await expect(row).toHaveCount(0);
  expect(await pending()).toEqual([]);

  // Make the second Lead an administrator, then remove it again.
  const member = page.getByRole("row").filter({ hasText: lead2.name });
  await member.getByRole("button", { name: "Make administrator" }).click();
  const grant = page.getByRole("dialog", {
    name: "Grant practice administration",
  });
  await expectAccessible(page, "Grant administration", {
    include: "[role=dialog]",
  });
  await runCommand(
    page,
    "grantAdmin",
    () => grant.getByRole("button", { name: "Grant administration" }).click(),
    management,
  );
  await expect(grant).toBeHidden();
  expect(
    (await members(lead, demo.tenantId)).find((m) => m.user_id === lead2.userId)
      ?.practice_admin,
  ).toBeTruthy();
  await member.getByRole("button", { name: "Remove administration" }).click();
  const revoke = page.getByRole("dialog", {
    name: "Remove practice administration",
  });
  await expectAccessible(page, "Remove administration", {
    include: "[role=dialog]",
  });
  await runCommand(
    page,
    "revokeAdmin",
    () => revoke.getByRole("button", { name: "Remove administration" }).click(),
    management,
  );
  await expect(revoke).toBeHidden();
  expect(
    (await members(lead, demo.tenantId)).find((m) => m.user_id === lead2.userId)
      ?.practice_admin,
  ).toBeFalsy();

  // Rotate the practice's signing key.
  await page.getByRole("button", { name: "Rotate signing key" }).click();
  const rotate = page.getByRole("dialog", { name: "Rotate signing key" });
  await rotate.getByLabel("Reason").fill("Scheduled rotation (persona suite)");
  await expectAccessible(page, "Signing key rotation", {
    include: "[role=dialog]",
  });
  await runCommand(
    page,
    "rotateSigningKey",
    () => rotate.getByRole("button", { name: "Rotate key" }).click(),
    management,
  );
  await expect(rotate).toBeHidden();
  const events = (await lead.workspace(demo.tenantId)).managementEvents;
  expect(events[0].action).toBe("rotateSigningKey");
});
