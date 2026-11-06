// Auditor: creates a working paper, records results and a reasoned
// conclusion, links accepted evidence and submits the paper for review.
import { expectAccessible } from "./a11y";
import { choose, expect, test, unique, workspacePath } from "./fixtures";

const TEMPLATE = "WP-A15-01 · Performance, calibration and validation";
const TITLE = "Performance, calibration and validation";

test("the Auditor prepares a working paper and submits it for review", async ({
  signIn,
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor");
  // Evidence handling is its own flow; here it is only a prerequisite.
  const evidenceName = `validation-summary-${unique()}.txt`;
  const { artifactId } = await auditor.uploadEvidence(
    demo.tenantId,
    demo.engagementId,
    evidenceName,
    "Hold-out AUC 0.81; calibration slope 0.97 (synthetic summary).",
    "Validation",
  );
  await auditor.command(demo.tenantId, demo.engagementId, "acceptEvidence", {
    artifactId,
  });
  const before = (await auditor.workspace(demo.tenantId, demo.engagementId))
    .engagement.papers.length;

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(demo, "Working papers"));
  await expect(
    page.getByRole("heading", { name: "Working papers", level: 1 }),
  ).toBeVisible();
  await expectAccessible(page, "Working papers register");

  await page.getByRole("button", { name: "New paper" }).click();
  const dialog = page.getByRole("dialog", {
    name: "New working paper or memo",
  });
  await choose(dialog, "Template", TEMPLATE);
  await dialog.getByRole("button", { name: "Create paper" }).click();
  await expect(dialog).toBeHidden();

  const w = await auditor.workspace(demo.tenantId, demo.engagementId);
  expect(w.engagement.papers).toHaveLength(before + 1);
  const paper = w.engagement.papers.at(-1);
  expect(paper.authorId).toBe(auditor.who.userId);

  // The editor opens on the new paper.
  const editor = page.getByRole("dialog", { name: new RegExp(TITLE) });
  await expect(editor).toBeVisible();
  await editor
    .getByRole("textbox", { name: "Results & exceptions" })
    .fill("Validation metrics reproduced on the hold-out sample.");
  await editor
    .getByRole("textbox", { name: "Auditor conclusion" })
    .fill("Performance claims are supported by the validation evidence.");
  await choose(editor, "Conclusion status", "Supported");
  await editor.getByRole("checkbox", { name: "Link " + evidenceName }).click();
  // Typing keeps a recovery copy; the revision is saved explicitly.
  await editor.getByRole("button", { name: "Save revision" }).click();
  await expect(editor.getByText("All changes saved")).toBeVisible();
  await expectAccessible(page, "Working paper editor");

  await editor.getByRole("button", { name: "Submit for review" }).click();
  await expect
    .poll(async () => {
      const now = await auditor.workspace(demo.tenantId, demo.engagementId);
      return now.engagement.papers.find(
        (p: { id: string }) => p.id === paper.id,
      )?.status;
    })
    .toBe("in_review");
});
