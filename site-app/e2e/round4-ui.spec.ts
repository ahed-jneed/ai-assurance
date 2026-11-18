// Round-4 UI polish (#227) with real clicks and keys: focus after a refused
// submit and after a snooze, Tab out of the toaster back into the open
// sheet, the audit program's tabs in the URL, and readable follow-up labels.
import type { Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { joinTeam, newEngagement, run } from "./engagement";
import {
  engagementWork,
  expect,
  paperPath,
  persona,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

/** Whether focus is inside the element `selector` matches. */
const focusWithin = (page: Page, selector: string) =>
  page.evaluate((s) => !!document.activeElement?.closest(s), selector);

test("the audit program keeps its tab in the URL and a refused assessment keeps focus in the dialog", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-4 follow-up",
  );
  await joinTeam(lead, e, ["qa-auditor"]);
  const title = `Drift check ${unique()}`;
  await run(auditor, e, "createMonitoringCase", {
    kind: "monitoring",
    title,
    description: "Quarterly drift monitoring of the scoring model",
    ownerId: auditor.who.userId,
    dueDate: "2026-12-31",
    cadence: "one_off",
    findingId: "",
    reportId: "",
  });

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(e, "Audit program"));
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  // The tab the program opens on is in the URL once it shows.
  await expect(tab("Program")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]section=program(&|$)/);
  await tab("Follow-up").click();
  await expect(page).toHaveURL(/[?&]section=followup(&|$)/);
  // Reload keeps the tab.
  await page.reload();
  await expect(tab("Follow-up")).toHaveAttribute("aria-selected", "true");
  // Back returns to the previous tab, Forward to the next.
  await tab("Acceptance").click();
  await expect(page).toHaveURL(/[?&]section=acceptance(&|$)/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]section=followup(&|$)/);
  await expect(tab("Follow-up")).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(tab("Acceptance")).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(tab("Follow-up")).toHaveAttribute("aria-selected", "true");

  // Readable case type, cadence and outcome.
  await page.getByText(title).click();
  await expect(
    page.getByText(
      `Monitoring · ${persona("qa-auditor").name} · due 2026-12-31 · One-off`,
    ),
  ).toBeVisible();
  await expect(page.getByText("Decision: Not assessed")).toBeVisible();
  await expectAccessible(page, "Follow-up tab with readable case labels");

  await page.getByRole("button", { name: "Record assessment" }).click();
  const dialog = page.getByRole("dialog", { name: "Assess follow-up case" });
  await expect(dialog).toBeVisible();
  const decision = dialog.locator('select[name="decision"]');
  await expect(decision.locator("option")).toHaveText([
    "Choose…",
    "Follow-up",
    "No reassessment",
    "Reassessment required",
  ]);
  await decision.selectOption({ label: "No reassessment" });
  await dialog
    .locator('textarea[name="assessment"]')
    .fill("No material change since the baseline report (synthetic).");
  // Submitted from the keyboard; the server refuses it (400).
  await dialog.getByRole("button", { name: "Save decision" }).focus();
  await runCommand(
    page,
    "assessMonitoringCase",
    () => page.keyboard.press("Enter"),
    { status: 400 },
  );
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveText(
    "Link the accepted evidence that shows no reassessment is needed",
  );
  // Focus is on the refusal, not on <body>, and Tab stays in the dialog.
  await expect(alert).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await focusWithin(page, '[role="dialog"]')).toBe(true);
  await expectAccessible(page, "Refused follow-up assessment");
});

test("a snooze moves focus to the next row, and the last one to the list heading", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-4 snooze",
  );
  const page = await signIn("qa-lead");
  const rows = await engagementWork(page, e);
  const snoozeButtons = page.getByRole("button", {
    name: /^Snooze reminder for /,
  });
  const snoozed = page
    .getByRole("region", { name: /Notifications/ })
    .getByText("Reminder snoozed until tomorrow at 08:00");
  /** Snoozes the row at `index` from the keyboard; returns the order before. */
  async function snooze(index: number) {
    const order = await rows.evaluateAll((all) =>
      all.map((el) => (el as HTMLElement).dataset.workId ?? ""),
    );
    await rows
      .nth(index)
      .getByRole("button", { name: /^Snooze/ })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`[data-work-id="${order[index]}"]`)).toHaveCount(
      0,
    );
    await expect(snoozed.first()).toBeVisible();
    return order;
  }
  expect(await snoozeButtons.count()).toBeGreaterThan(1);
  // The first row: focus moves to the row that followed it.
  const order = await snooze(0);
  await expect(
    page.locator(`[data-work-id="${order[1]}"] .business-task-open`),
  ).toBeFocused();
  // Every row of a new engagement is the Lead's own reminder: snooze the
  // rest; once none is left, focus moves to the list heading.
  expect(await snoozeButtons.count()).toBe(await rows.count());
  while ((await rows.count()) > 0) await snooze(0);
  await expect(page.locator(".work-results h2")).toBeFocused();
  await expectAccessible(page, "My work after snoozing");
});

test("Tab out of the toaster returns into the open paper sheet, and a refused save keeps focus in it", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-4 toaster",
  );
  await joinTeam(lead, e, ["qa-auditor"]);
  const { paperId } = await run(auditor, e, "createPaper", {
    templateId: "WP-A15-01",
  });
  const first = await signIn("qa-auditor");
  const second = await signIn("qa-auditor");
  const editorOf = (page: Page) =>
    page.getByRole("dialog", {
      name: /Performance, calibration and validation/,
    });
  const results = (page: Page) =>
    editorOf(page).getByRole("textbox", { name: "Results & exceptions" });
  const save = (page: Page, status = 200) =>
    runCommand(
      page,
      "editPaper",
      () =>
        editorOf(page).getByRole("button", { name: "Save revision" }).click(),
      { status },
    );
  for (const page of [first, second]) {
    await page.goto(paperPath(e, paperId));
    await expect(results(page)).toBeVisible();
  }
  await results(first).fill("Saved first (synthetic).");
  await save(first);
  await results(second).fill("Edited in the second tab (synthetic).");
  await save(second, 409);
  const toastReload = second
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Reload" });
  await expect(toastReload).toBeVisible();

  // The refused save (409): focus is on its alert in the sheet, not <body>.
  await expect
    .poll(() =>
      editorOf(second).evaluate(
        (sheet) =>
          !!document.activeElement?.closest('[role="alert"]') &&
          sheet.contains(document.activeElement),
      ),
    )
    .toBe(true);

  // Alt+T, then Tab through the toaster: past its last control focus
  // returns into the sheet, never to the page behind the modal.
  const sheet = '[data-slot="sheet-content"]',
    toaster = "[data-sonner-toaster]";
  // Focus starts on <body> before each Alt+T, as after a disabled Save drops
  // it there. From the alert, Radix's own trap already sends Tab back into
  // the sheet; only from <body> does Tab depend on the toaster's handling.
  const altT = async () => {
    await second.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    expect(
      await second.evaluate(() => document.activeElement === document.body),
    ).toBe(true);
    await second.keyboard.press("Alt+T");
    await expect.poll(() => focusWithin(second, toaster)).toBe(true);
  };
  /** Whether the sheet's first (or last) tabbable control has focus. */
  const atSheetEdge = (edge: "first" | "last") =>
    second.evaluate(
      ([s, edge]) => {
        const root = document.querySelector(s);
        const controls = [
          ...(root?.querySelectorAll<HTMLElement>(
            "a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])",
          ) ?? []),
        ].filter(
          (el) =>
            el.tabIndex >= 0 &&
            !(el as HTMLButtonElement).disabled &&
            el.getClientRects().length > 0,
        );
        const want = edge === "first" ? controls[0] : controls.at(-1);
        return !!want && document.activeElement === want;
      },
      [sheet, edge] as const,
    );

  // Tab past the toaster's last control: the sheet's first control.
  await altT();
  let returned = false;
  for (let i = 0; i < 8 && !returned; i++) {
    await second.keyboard.press("Tab");
    returned = await focusWithin(second, sheet);
    if (!returned) expect(await focusWithin(second, toaster)).toBe(true);
  }
  expect(returned).toBe(true);
  expect(await atSheetEdge("first")).toBe(true);
  await expect(editorOf(second)).toBeVisible();

  // Shift+Tab from the list Alt+T focuses: the sheet's last control.
  await altT();
  await second.keyboard.press("Shift+Tab");
  await expect.poll(() => focusWithin(second, sheet)).toBe(true);
  expect(await atSheetEdge("last")).toBe(true);
  // Shift+Tab from the toast's first control as well.
  await altT();
  await second.keyboard.press("Tab");
  await expect.poll(() => focusWithin(second, toaster)).toBe(true);
  await second.keyboard.press("Shift+Tab");
  await expect.poll(() => focusWithin(second, sheet)).toBe(true);
  expect(await atSheetEdge("last")).toBe(true);
  await expect(editorOf(second)).toBeVisible();
});
