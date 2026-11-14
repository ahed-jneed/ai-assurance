// Accessibility of the main views (#36): axe checks every engagement and
// practice view the Lead Auditor reaches and every client portal view, and
// keyboard-only use reaches the content and the portal's navigation.
import type { Page } from "@playwright/test";
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
  ["Access log", "Access log"],
];

test("the Lead Auditor's main views have no serious axe violations", async ({
  signIn,
  demo,
}) => {
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

const portalViews: [string, string][] = [
  ["Overview", DEMO.engagement],
  ["Evidence vault", "Shared evidence"],
  ["Findings", "Findings"],
  ["Reports & sign-off", "Reports"],
];

for (const persona of ["qa-viewer", "qa-contrib"] as const)
  test(`the client portal has no serious axe violations (${persona})`, async ({
    signIn,
    demo,
  }) => {
    const page = await signIn(persona);
    for (const [view, heading] of portalViews) {
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
