// The built-in account pages (#273): axe and keyboard-only use of first-run
// setup, sign-in, invited sign-up and password change, each also with an
// error message shown. Runs in the `auth-pages` project against
// e2e/auth-server.mjs (built-in accounts, a fresh empty database), never
// against the persona server. The flow follows the `local` section of
// scripts/identity-check.mjs. All accounts are made up and live only in the
// throwaway database.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y";

const OWNER = {
  name: "Olive Owner",
  email: "owner@example.com",
  password: "correct horse battery",
};

/** Fails unless the element has a visible focus indicator (an outline). */
async function expectFocusVisible(element: Locator) {
  await expect(element).toBeFocused();
  const outline = await element.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style, "focus outline").not.toBe("none");
  expect(outline.width, "focus outline width").toBeGreaterThan(0);
}

/**
 * Completes a form with the keyboard alone: focus starts in the first field
 * (autofocus), Tab moves through the fields in `fields` order to the submit
 * button, each with a visible focus indicator, and Enter submits. Resolves
 * with the response of the form post.
 */
async function submitWithKeyboard(
  page: Page,
  fields: [id: string, value: string][],
  button: string,
) {
  for (const [index, [id, value]] of fields.entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    const field = page.locator(`#${id}`);
    await expectFocusVisible(field);
    // Replace a prefilled value (the invitee's name) rather than append to it.
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(value);
  }
  await page.keyboard.press("Tab");
  await expectFocusVisible(page.getByRole("button", { name: button }));
  const posted = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/auth/"),
  );
  await page.keyboard.press("Enter");
  return posted;
}

/** The error message is announced and tied to each field it is about. */
async function expectFieldError(page: Page, message: string, ids: string[]) {
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(message);
  const alertId = await alert.getAttribute("id");
  expect(alertId, "the error message has an id").toBeTruthy();
  for (const id of ids) {
    const field = page.locator(`#${id}`);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute(
      "aria-describedby",
      new RegExp(`(^|\\s)${alertId}(\\s|$)`),
    );
    await expect(field).toHaveAccessibleDescription(new RegExp(message));
  }
}

/** Waits until a successful form post has moved on to the workspace. */
async function landedInWorkspace(page: Page) {
  await page.waitForURL((url) => url.pathname === "/", { waitUntil: "commit" });
}

test("the built-in account pages pass axe and work with the keyboard alone", async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow(); // every sign-in hashes a password (PBKDF2, 100,000 rounds)

  await test.step("first-run setup creates the owner", async () => {
    await page.goto("/auth/sign-in");
    if (new URL(page.url()).pathname !== "/auth/setup") {
      // The owner exists already: CI runs every spec twice on one database,
      // and a local run may reuse a running server. The first run checked
      // the setup page.
      test.info().annotations.push({
        type: "note",
        description: "The owner exists; the setup page was checked earlier.",
      });
      return;
    }
    await expect(
      page.getByRole("heading", { name: "Create the owner account" }),
    ).toBeVisible();
    await expectAccessible(page, "Setup");
    const refused = await submitWithKeyboard(
      page,
      [
        ["name", OWNER.name],
        ["email", OWNER.email],
        ["password", OWNER.password],
        ["confirm", "a different password"],
      ],
      "Create the owner account",
    );
    expect(refused.status()).toBe(400);
    await expectFieldError(page, "The passwords do not match.", ["confirm"]);
    await expectAccessible(page, "Setup with an error");
    const created = await submitWithKeyboard(
      page,
      [
        ["name", OWNER.name],
        ["email", OWNER.email],
        ["password", OWNER.password],
        ["confirm", OWNER.password],
      ],
      "Create the owner account",
    );
    expect(created.status()).toBe(303);
    await landedInWorkspace(page);
  });

  await test.step("sign-in, with a wrong password first", async () => {
    await page.goto("/auth/sign-out");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectAccessible(page, "Sign-in");
    const wrong = await submitWithKeyboard(
      page,
      [
        ["email", OWNER.email],
        ["password", "not the password"],
      ],
      "Sign in",
    );
    expect(wrong.status()).toBe(401);
    await expectFieldError(page, "The email or password is incorrect.", [
      "email",
      "password",
    ]);
    await expectAccessible(page, "Sign-in with an error");
    const ok = await submitWithKeyboard(
      page,
      [
        ["email", OWNER.email],
        ["password", OWNER.password],
      ],
      "Sign in",
    );
    expect(ok.status()).toBe(303);
    await landedInWorkspace(page);
  });

  // A new address on every run, so a second run on the same database works.
  const invitee = {
    email: `ava-${Date.now()}@example.com`,
    password: "ava's first password",
    newPassword: "ava's second password",
  };
  const signupPath = await test.step("the owner invites a member", async () => {
    // Setup, not the subject of this spec: the invitation goes through the
    // API the Members & access page calls (as in identity-check.mjs).
    const workspace = await (await page.request.get("/api/workspace")).json();
    const tenantId = workspace.tenantId as string;
    const invite = await page.request.post("/api/management", {
      headers: { Origin: baseURL! },
      data: {
        tenantId,
        expectedVersion: workspace.managementVersion ?? 1,
        op: "inviteMember",
        data: { email: invitee.email, role: "Reviewer", engagementIds: [] },
      },
    });
    expect(invite.status(), await invite.text()).toBe(200);
    const listed = await (
      await page.request.get(`/api/workspace?tenantId=${tenantId}`)
    ).json();
    const invitation = (
      listed.invitations as { email: string; signup_path: string }[]
    ).find((i) => i.email === invitee.email);
    expect(invitation?.signup_path).toMatch(/^\/auth\/sign-up\?invite=/);
    return invitation!.signup_path;
  });

  // The invitee has their own browser, without the owner's session.
  const context = await browser.newContext({ baseURL });
  const guest = await context.newPage();
  try {
    await test.step("the invitee signs up through the link", async () => {
      await guest.goto(signupPath);
      await expect(
        guest.getByRole("heading", { name: "Create your account" }),
      ).toBeVisible();
      await expectAccessible(guest, "Sign-up");
      const refused = await submitWithKeyboard(
        guest,
        [
          ["name", "Ava Auditor"],
          ["password", invitee.password],
          ["confirm", "a different password"],
        ],
        "Create account",
      );
      expect(refused.status()).toBe(400);
      await expectFieldError(guest, "The passwords do not match.", ["confirm"]);
      await expectAccessible(guest, "Sign-up with an error");
      const created = await submitWithKeyboard(
        guest,
        [
          ["name", "Ava Auditor"],
          ["password", invitee.password],
          ["confirm", invitee.password],
        ],
        "Create account",
      );
      expect(created.status()).toBe(303);
      await landedInWorkspace(guest);
    });

    await test.step("the invitee changes their password", async () => {
      await guest.goto("/auth/password");
      await expect(
        guest.getByRole("heading", { name: "Change your password" }),
      ).toBeVisible();
      await expectAccessible(guest, "Password change");
      const refused = await submitWithKeyboard(
        guest,
        [
          ["current", "not the password"],
          ["password", invitee.newPassword],
          ["confirm", invitee.newPassword],
        ],
        "Change password",
      );
      expect(refused.status()).toBe(401);
      await expectFieldError(guest, "The current password is incorrect.", [
        "current",
      ]);
      await expectAccessible(guest, "Password change with an error");
      const changed = await submitWithKeyboard(
        guest,
        [
          ["current", invitee.password],
          ["password", invitee.newPassword],
          ["confirm", invitee.newPassword],
        ],
        "Change password",
      );
      expect(changed.status()).toBe(303);
      await landedInWorkspace(guest);
      // The new password signs in.
      await guest.goto("/auth/sign-out");
      await expect(guest).toHaveURL(/\/auth\/sign-in$/);
      const ok = await submitWithKeyboard(
        guest,
        [
          ["email", invitee.email],
          ["password", invitee.newPassword],
        ],
        "Sign in",
      );
      expect(ok.status()).toBe(303);
      await landedInWorkspace(guest);
    });
  } finally {
    await context.close();
  }
});
