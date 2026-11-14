// Practice report settings (#111): a practice administrator sets the
// signatory, location and quality-management statement new reports state;
// the report form shows them, and a readiness assessment with gaps asks for
// the gaps and is captured as not assurance. A non-administrator cannot
// change the settings.
import { expectAccessible } from "./a11y";
import { choose, expect, test, unique, workspacePath } from "./fixtures";

test("the Lead Auditor sets report settings that a new report states", async ({
  signIn,
  api,
  demo,
}) => {
  const settings = {
    signatory: `E2E Assurance GmbH ${unique()}`,
    location: "Vienna, Austria",
    qualityStatement:
      "We comply with the IESBA Code and our firm applies ISQM 1 (E2E).",
  };
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Users & access"));
  await page.getByRole("button", { name: "Report settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Report settings" });
  await dialog
    .getByRole("textbox", { name: "Signed by" })
    .fill(settings.signatory);
  await dialog
    .getByRole("textbox", { name: "Location" })
    .fill(settings.location);
  await dialog
    .getByRole("textbox", {
      name: "Independence and quality management statement",
    })
    .fill(settings.qualityStatement);
  await expectAccessible(page, "Report settings dialog");
  const lead = await api("qa-lead");
  const before = (await lead.workspace(demo.tenantId))
    .managementVersion as number;
  await dialog.getByRole("button", { name: "Save report settings" }).click();
  await expect(dialog).toBeHidden();

  // Saved as one management change (the workspace load no longer lists
  // management events; the Access log lists only access events).
  const saved = await lead.workspace(demo.tenantId);
  expect(saved.reportSettings).toEqual(settings);
  expect(saved.managementVersion).toBeGreaterThan(before);

  // The report form states the settings for fields left blank.
  await page.goto(workspacePath(demo, "Reports & sign-off"));
  await page
    .getByRole("button", { name: /^Create (draft )?snapshot$/ })
    .first()
    .click();
  const form = page.getByRole("dialog", {
    name: "Create immutable report snapshot",
  });
  await expect(
    form.getByRole("textbox", { name: "Signed by" }),
  ).toHaveAttribute("placeholder", settings.signatory);
  await choose(form, "Engagement type", "Readiness assessment");
  await choose(
    form,
    "Conclusion",
    "Readiness assessment, gaps identified (not assurance)",
  );
  await form
    .getByRole("textbox", { name: "Gaps identified" })
    .fill("No post-market monitoring plan yet (E2E).");
  await form
    .getByRole("textbox", { name: "Executive summary, scope & limitations" })
    .fill("E2E readiness draft with gaps.");
  await expectAccessible(page, "Report form with gaps");
  await form.getByRole("button", { name: "Create snapshot" }).click();
  await expect(form).toBeHidden();

  const w = await lead.workspace(demo.tenantId, demo.engagementId);
  const report = w.engagement.reports.at(-1);
  expect(report.snapshot.opinion).toBe(
    "Readiness assessment, gaps identified (not assurance)",
  );
  expect(report.snapshot.particulars).toMatchObject({
    signatory: settings.signatory,
    location: settings.location,
    qualityStatement: settings.qualityStatement,
    basisForModification: "No post-market monitoring plan yet (E2E).",
  });
  expect(report.snapshot.conclusionStatement.notAssurance).toBe(true);
});

test("only a practice administrator changes the report settings", async ({
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor");
  const w = await auditor.workspace(demo.tenantId);
  const response = await auditor.post("/api/management", {
    tenantId: demo.tenantId,
    expectedVersion: w.managementVersion,
    op: "setReportSettings",
    data: { signatory: "Not allowed" },
  });
  expect(response.status()).toBe(403);
});
