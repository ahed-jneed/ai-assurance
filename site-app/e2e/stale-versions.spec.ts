// Stale versions: a decision taken on a version of the engagement, a
// record revision or the practice directory that changed since it was read
// is refused, and nothing changes until the user works on the current one.
// The API-level check of a stale engagement version is in isolation.spec.ts.
import { expectAccessible } from "./a11y";
import {
  attempt,
  draftProgram,
  engagementOf,
  joinTeam,
  newEngagement,
  run,
  submittedBrief,
} from "./engagement";
import type { Page } from "@playwright/test";
import {
  expect,
  paperPath,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

test("a decision on a changed engagement is refused until the page reloads", async ({
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
    "E2E stale version",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);
  const brief = await submittedBrief(lead, e);

  const page = await signIn("qa-reviewer");
  await page.goto(workspacePath(e, "Audit program"));
  await page.getByRole("tab", { name: "Engagement brief" }).click();
  const approve = page.getByRole("button", { name: "Approve scope" });
  await expect(approve).toBeEnabled();
  await expectAccessible(page, "Submitted brief for the Reviewer");

  // The Auditor changes the engagement after the Reviewer opened it.
  await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    `late-upload-${unique()}.txt`,
    "Uploaded while the reviewer had the brief open (synthetic).",
  );

  await approve.click();
  const dialog = page.getByRole("dialog", {
    name: `Approve scope revision ${brief.revision}`,
  });
  await dialog
    .getByLabel("Review decision and rationale")
    .fill("Scope reviewed.");
  await runCommand(
    page,
    "approveBrief",
    () => dialog.getByRole("button", { name: "Approve scope" }).click(),
    { status: 409 },
  );
  await expect(
    dialog.getByRole("alert").filter({
      hasText: "The engagement changed. Reload before saving.",
    }),
  ).toBeVisible();
  await expectAccessible(page, "Refused stale approval");
  expect((await engagementOf(lead, e)).workflow.brief.status).toBe("submitted");

  // After a reload the same decision is taken on the current version.
  await page.reload();
  await page.getByRole("tab", { name: "Engagement brief" }).click();
  const reloaded = page.getByRole("button", { name: "Approve scope" });
  await expect(reloaded).toBeEnabled();
  await expectAccessible(page, "Brief after the reload");
  await reloaded.click();
  const current = page.getByRole("dialog", {
    name: `Approve scope revision ${brief.revision}`,
  });
  await current
    .getByLabel("Review decision and rationale")
    .fill("Scope reviewed on the current version.");
  await runCommand(page, "approveBrief", () =>
    current.getByRole("button", { name: "Approve scope" }).click(),
  );
  expect((await engagementOf(lead, e)).workflow.brief.status).toBe("approved");
});

test("an approval of a superseded revision is refused", async ({
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E stale revision",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);

  // The Reviewer read revision 1 of the scope; it was returned and revised.
  const first = await submittedBrief(lead, e);
  await run(reviewer, e, "returnBrief", { reason: "Clarify the boundary" });
  const second = await submittedBrief(lead, e);
  expect(second.revision).toBeGreaterThan(first.revision);
  expect(
    await attempt(reviewer, e, "approveBrief", {
      revision: first.revision,
      reason: "Approving what I read",
    }),
  ).toEqual({ status: 409, error: "Review the submitted scope revision" });
  await run(reviewer, e, "approveBrief", {
    revision: second.revision,
    reason: "Revised boundary reviewed",
  });

  // A procedure plan opened before its assignment changed would revert it.
  const procedureId = await draftProgram(auditor, e);
  const opened = (await engagementOf(auditor, e)).workflow.procedures.find(
    (p: { id: string }) => p.id === procedureId,
  );
  await run(auditor, e, "bulkPlanProcedures", {
    procedureIds: [procedureId],
    patch: { dueDate: "2026-12-30" },
  });
  const plan = {
    selected: opened.selected,
    applicability: opened.applicability,
    rationale: opened.rationale,
    criterion: opened.criterion,
    sourceVersion: opened.sourceVersion,
    periodAnalysis: opened.periodAnalysis,
    population: opened.population,
    sampling: "A changed sample, saved from the stale form",
    ownerId: opened.ownerId,
    reviewerId: opened.reviewerId,
    dueDate: opened.dueDate,
    method: opened.method,
    modelId: opened.modelId ?? "",
    datasetId: opened.datasetId ?? "",
    profileId: opened.profileId ?? "",
  };
  const stale = await attempt(auditor, e, "saveProcedurePlan", {
    procedureId,
    assignmentRevision: opened.assignmentRevision ?? 1,
    plan,
  });
  expect(stale.status).toBe(409);
  expect(stale.error).toMatch(/changed after this plan was opened/);
  const kept = (await engagementOf(auditor, e)).workflow.procedures.find(
    (p: { id: string }) => p.id === procedureId,
  );
  expect(kept.dueDate).toBe("2026-12-30");
  expect(kept.sampling).toBe(opened.sampling);
});

test("a practice change against a stale directory version is refused", async ({
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const { managementVersion } = await lead.workspace(demo.tenantId);
  const invite = (email: string) =>
    lead.post("/api/management", {
      tenantId: demo.tenantId,
      expectedVersion: managementVersion,
      op: "inviteMember",
      data: { email, role: "Auditor" },
    });
  const first = `stale-first-${unique()}@personas.test`;
  const second = `stale-second-${unique()}@personas.test`;
  expect((await invite(first)).status()).toBe(200);
  // The second change was read at the same version, before the first.
  expect((await invite(second)).status()).toBe(409);
  const pending = (await lead.workspace(demo.tenantId)).invitations.map(
    (i: { email: string }) => i.email,
  );
  expect(pending).toContain(first);
  expect(pending).not.toContain(second);
  // Leave no pending invitation behind.
  const id = (await lead.workspace(demo.tenantId)).invitations.find(
    (i: { email: string }) => i.email === first,
  ).id;
  await lead.manage(demo.tenantId, "cancelInvitation", { invitationId: id });
});

// #210: the stale-version toast sits outside the modal paper sheet. Its
// Reload must work with a real click and from the keyboard (Alt+T), and the
// sheet offers the same reload itself; each leads to the newer-revision
// dialog, which keeps the local changes.
test("a stale paper save is reloaded from the toast or the sheet into the newer-revision dialog", async ({
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
    "E2E stale paper",
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
  const newerRevision = second.getByRole("dialog", {
    name: "This paper has a newer revision",
  });
  const toastReload = second
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Reload" });
  /** The first tab saves a revision; the second then saves its own edit. */
  async function staleSave(round: number) {
    await results(first).fill(`Saved first, round ${round} (synthetic).`);
    await save(first);
    await results(second).fill(`Edited in the second tab, round ${round}.`);
    await save(second, 409);
    await expect(toastReload).toBeVisible();
  }
  async function resolveConflict() {
    await expect(newerRevision).toBeVisible();
    await expect(
      newerRevision.getByRole("button", { name: "Export local changes" }),
    ).toBeVisible();
    await newerRevision
      .getByRole("button", { name: "Load saved revision" })
      .click();
    await expect(newerRevision).toBeHidden();
    // The sheet stayed open behind the toast and the dialog.
    await expect(editorOf(second)).toBeVisible();
  }

  // A real mouse click on the toast's Reload, with the sheet open.
  await staleSave(1);
  await expect(
    editorOf(second).getByRole("alert").filter({ hasText: "Reload" }),
  ).toBeVisible();
  await expectAccessible(second, "Stale paper save with its reload choices");
  await toastReload.click();
  await resolveConflict();
  await expect(results(second)).toHaveValue(
    "Saved first, round 1 (synthetic).",
  );

  // The keyboard: Alt+T reaches the toaster out of the sheet's focus trap,
  // Tab reaches Reload and Enter runs it.
  await staleSave(2);
  await second.keyboard.press("Alt+T");
  for (let i = 0; i < 5; i++) {
    if (await toastReload.evaluate((el) => el === document.activeElement))
      break;
    await second.keyboard.press("Tab");
  }
  await expect(toastReload).toBeFocused();
  await second.keyboard.press("Enter");
  await resolveConflict();

  // Escape leaves the toaster for the sheet without closing it, even when
  // focus was on <body> before Alt+T, as it is after the focused button
  // becomes disabled (#216).
  await staleSave(3);
  await second.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect
    .poll(() => second.evaluate(() => document.activeElement?.tagName))
    .toBe("BODY");
  await second.keyboard.press("Alt+T");
  await expect
    .poll(() =>
      second.evaluate(
        () => !!document.activeElement?.closest("[data-sonner-toaster]"),
      ),
    )
    .toBe(true);
  await second.keyboard.press("Escape");
  await expect(editorOf(second)).toBeVisible();
  await expect
    .poll(() =>
      editorOf(second).evaluate((sheet) =>
        sheet.contains(document.activeElement),
      ),
    )
    .toBe(true);
  // The sheet's own Reload, independent of the toast.
  await editorOf(second)
    .getByRole("alert")
    .getByRole("button", { name: "Reload" })
    .click();
  await resolveConflict();
});

// #216: without a modal open, Escape in the toaster is left to sonner, which
// collapses the stack Alt+T expanded, and focus returns to where it was.
test("Escape collapses the expanded toast stack when no modal is open", async ({
  signIn,
  demo,
}) => {
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Users & access"));
  const copy = page.getByRole("button", { name: "Copy account ID" });
  // Copying succeeds or falls back to a hint; either raises a toast.
  await copy.click();
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(toast).toHaveAttribute("data-expanded", "false");
  await page.keyboard.press("Alt+T");
  await expect(toast).toHaveAttribute("data-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(toast).toHaveAttribute("data-expanded", "false");
  await expect(copy).toBeFocused();
});
