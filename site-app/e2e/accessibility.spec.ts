// Accessibility of the main views (#36): axe checks every engagement and
// practice view the Lead Auditor reaches and every client portal view, and
// keyboard-only use reaches the content and the portal's navigation.
import type { Locator, Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { DEMO, expect, test, workspacePath } from "./fixtures";

/** Waits until the view shows its heading and no loading placeholder. */
async function loaded(page: Page, heading?: string) {
  await expect(
    heading
      ? page.getByRole("heading", { name: heading, level: 1 })
      : page.getByRole("heading", { level: 1 }).first(),
  ).toBeVisible();
  await expect(page.locator(".loading-grid")).toHaveCount(0);
  await expect(page.locator(".workbench-load-state")).toHaveCount(0);
}

const leadViews: [string, string | undefined][] = [
  ["Overview", DEMO.engagement],
  ["Audit program", "Audit program"],
  ["Regulatory mapping", "Regulatory mapping"],
  ["Working papers", "Working papers"],
  ["Evidence vault", "Evidence vault"],
  ["Testing lab", "Testing lab"],
  ["Assurance workbench", "Assurance workbench"],
  ["Findings", "Findings"],
  ["Reports & sign-off", "Reports & sign-off"],
  ["Methodology", "Templates & history"],
  ["My work", undefined],
  ["Clients", undefined],
  ["Engagements", undefined],
  ["Users & access", undefined],
  // The Access log is for practice administrators only (#181): qa-lead
  // administers the demo practice (scripts/seed-demo.mjs).
  ["Access log", "Access log"],
];

test("the Lead Auditor's main views have no serious axe violations", async ({
  api,
  signIn,
  demo,
}) => {
  // The practice pages, the Access log among them, need administration.
  expect(
    (await (await api("qa-lead")).workspace(demo.tenantId)).identity
      .practiceAdmin,
  ).toBe(true);
  const page = await signIn("qa-lead");
  for (const [view, heading] of leadViews) {
    await page.goto(workspacePath(demo, view));
    await loaded(page, heading);
    if (view === "Regulatory mapping")
      await expect(
        page.locator(".coverage-filter-status").filter({ hasText: /Showing/ }),
      ).toBeVisible();
    await expectAccessible(page, view);
  }
});

// A Client Contributor's portal has no Findings (#182).
const portalViews = {
  "qa-viewer": [
    ["Overview", DEMO.engagement],
    ["Evidence vault", "Shared evidence"],
    ["Findings", "Findings"],
    ["Reports & sign-off", "Reports"],
  ],
  "qa-contrib": [
    ["Overview", DEMO.engagement],
    ["Evidence vault", "Shared evidence"],
    ["Reports & sign-off", "Reports"],
  ],
} satisfies Record<string, [string, string][]>;

for (const persona of ["qa-viewer", "qa-contrib"] as const)
  test(`the client portal has no serious axe violations (${persona})`, async ({
    signIn,
    demo,
  }) => {
    const page = await signIn(persona);
    for (const [view, heading] of portalViews[persona]) {
      await page.goto(workspacePath(demo, view));
      await loaded(page, heading);
      await expectAccessible(page, `Client portal ${heading} (${persona})`);
    }
  });

/** Presses Tab until the focused element has this accessible text. */
async function tabTo(page: Page, text: string) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => document.activeElement?.textContent?.trim() ?? "",
    );
    if (focused === text) return;
  }
  throw new Error(`Tab never reached "${text}"`);
}

test("keyboard-only use reaches the content and the portal navigation", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-viewer");
  await page.goto(workspacePath(demo, "Overview"));
  await loaded(page, DEMO.engagement);
  // The first Tab reaches the skip link, which moves focus to the content.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#audit-main-content")).toBeFocused();
  // The portal navigation is reachable and operable with the keyboard.
  await page.goto(workspacePath(demo, "Overview"));
  await loaded(page, DEMO.engagement);
  await tabTo(page, "Shared evidence");
  await page.keyboard.press("Enter");
  await loaded(page, "Shared evidence");
  await expect(
    page
      .getByRole("navigation", { name: "Client portal navigation" })
      .getByRole("button", { name: "Shared evidence" }),
  ).toHaveAttribute("aria-current", "page");

  // The audit team's workspace keeps its own skip link.
  const lead = await signIn("qa-lead");
  await lead.goto(workspacePath(demo, "Overview"));
  await loaded(lead, DEMO.engagement);
  await lead.keyboard.press("Tab");
  await expect(
    lead.getByRole("link", { name: "Skip to audit content" }),
  ).toBeFocused();
  await lead.keyboard.press("Enter");
  await expect(lead.locator("#audit-main-content")).toBeFocused();
});

// Keyboard focus after dialogs, sheets and in-place forms close (#203): focus
// returns to the control that opened them, so the next Tab continues from
// there instead of restarting at the skip link.

/** Activates a control from the keyboard. */
async function press(target: Locator, key = "Enter") {
  await target.focus();
  await target.press(key);
}

/** document.activeElement is this element, not <body>. */
async function expectFocusOn(page: Page, target: Locator) {
  await expect(target).toBeFocused();
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
}

test("closing a record sheet returns focus to the control that opened it", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Evidence vault"));
  await loaded(page, "Evidence vault");
  await page.getByRole("tab", { name: /^Requests/ }).click();
  const opener = page.getByRole("button", { name: DEMO.request, exact: true });
  const sheet = page.locator(".record-sheet");

  // Escape closes the sheet.
  await press(opener);
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expectFocusOn(page, opener);
  // The next Tab continues from the opener, not from the skip link.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to audit content" }),
  ).not.toBeFocused();
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);

  // So does the sheet's Close button.
  await press(opener);
  await expect(sheet).toBeVisible();
  await press(sheet.getByRole("button", { name: "Close", exact: true }));
  await expect(sheet).toBeHidden();
  await expectFocusOn(page, opener);

  // A dialog opened from the sheet's menu returns focus to the menu's
  // trigger in the sheet, and the sheet stays open.
  await press(opener);
  await expect(sheet).toBeVisible();
  const more = sheet.getByRole("button", {
    name: "More actions for this request",
  });
  await press(more);
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.locator(".audit-dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeVisible();
  await expectFocusOn(page, more);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expectFocusOn(page, opener);
});

test("the engagement switcher and the account menu return focus on close", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Overview"));
  await loaded(page, DEMO.engagement);
  const switcher = page.getByRole("button", { name: /switch engagement$/ });
  await press(switcher);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expectFocusOn(page, switcher);

  const account = page.getByRole("button", { name: /^Account: / });
  await press(account);
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expectFocusOn(page, account);
});

test("the client portal forms take focus and give it back on cancel", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-contrib");
  await page.goto(workspacePath(demo, "Overview"));
  await loaded(page, DEMO.engagement);
  const request = page
    .locator("details.captured-record")
    .filter({ hasText: "Upload the training data lineage summary." });
  await press(request.locator("summary"));
  const submit = request.getByRole("button", {
    name: "Submit evidence package",
  });
  const ask = request.getByRole("button", { name: "Ask a question" });

  // The evidence package form: focus moves to its first field, and back to
  // the button on cancel.
  await press(submit);
  await expectFocusOn(page, request.getByLabel("Evidence files"));
  await press(request.getByRole("button", { name: "Cancel", exact: true }));
  await expect(request.getByLabel("Evidence files")).toHaveCount(0);
  await expectFocusOn(page, submit);

  // The question form: the same.
  await press(ask);
  await expectFocusOn(page, request.getByLabel("Question or clarification"));
  await press(request.getByRole("button", { name: "Cancel reply" }));
  await expect(request.getByLabel("Question or clarification")).toHaveCount(0);
  await expectFocusOn(page, ask);
});
