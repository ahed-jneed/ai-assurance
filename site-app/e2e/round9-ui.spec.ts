// Round-9 fixes (#248) with real clicks and keys: the Freeze plan dialog's
// default GenAI plan has a band, so it freezes as it stands, and a plan the
// engine would refuse (a criterion without a band) is refused in the dialog
// with a reason that names the criterion, before anything is frozen. The
// held-release handoff wording is covered in round7-ui.spec.ts, where the
// release is held by the Engagement Quality Reviewer's re-check.
import { expectAccessible } from "./a11y";
import { engagementInFieldwork } from "./engagement";
import { expect, test, workspacePath } from "./fixtures";

test("the default GenAI plan freezes, and a criterion without a band is refused by name", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await engagementInFieldwork(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E round-9 GenAI plan",
  );
  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(e, "Testing lab"));
  await page.getByRole("tab", { name: "GenAI evidence" }).click();
  await expect(page.getByText(/^0 frozen plans/)).toBeVisible();

  // A plan the engine would refuse: the dialog stays open with the reason.
  await page.getByRole("button", { name: "Freeze plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Freeze a GenAI plan" });
  const planField = dialog.getByLabel("Plan (JSON)");
  const procedure = dialog.getByLabel("Procedure");
  await procedure.selectOption({ index: 1 });
  const template = JSON.parse(await planField.inputValue());
  expect(template.criteria).toEqual([
    { id: "C1", kind: "genai_mean", metric: "accuracy", band: { lower: 0.9 } },
  ]);
  await planField.fill(
    JSON.stringify({
      schemaVersion: "genai-plan/0.1",
      criteria: [{ id: "ACC-1", kind: "genai_mean" }],
    }),
  );
  await dialog.getByRole("button", { name: "Freeze plan" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    'Criterion ACC-1 needs a band, for example "band": {"lower": 0.9}',
  );
  await expectAccessible(page, "Freeze plan refused for a missing band");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^0 frozen plans/)).toBeVisible();

  // The default template freezes as it stands.
  await page.getByRole("button", { name: "Freeze plan" }).click();
  await expect(dialog).toBeVisible();
  expect(JSON.parse(await planField.inputValue())).toEqual(template);
  await procedure.selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Freeze plan" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^1 frozen plan /)).toBeVisible();
  const genai = await auditor.post("/api/assurance", {
    tenantId: e.tenantId,
    engagementId: e.engagementId,
    op: "freezeGenaiPlan",
    data: {
      procedureId: e.procedureId,
      plan: {
        schemaVersion: "genai-plan/0.1",
        criteria: [{ id: "ASR", kind: "genai_attack_success" }],
      },
    },
  });
  expect(genai.status()).toBe(400);
  expect((await genai.json()).error).toBe(
    'Criterion ASR needs a band, for example "band": {"upper": 0.05}',
  );
});
