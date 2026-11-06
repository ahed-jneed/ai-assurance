// Reviewer: independently reviews a submitted working paper; its author cannot
// review it, and the Lead Auditor signs the reviewed revision off.
import { expectAccessible } from "./a11y";
import {
  expect,
  paperPath,
  test,
  unique,
  workspacePath,
  type Api,
  type Demo,
} from "./fixtures";

const TEMPLATE = "WP-A15-02";
const TITLE = "Robustness, stability and distribution drift";

/** A paper prepared and submitted for review through the API by `author`. */
async function submittedPaper(author: Api, demo: Demo) {
  const { tenantId, engagementId } = demo;
  const { artifactId } = await author.uploadEvidence(
    tenantId,
    engagementId,
    `drift-report-${unique()}.txt`,
    "Population stability index 0.04 across quarters (synthetic summary).",
    "Validation",
  );
  await author.command(tenantId, engagementId, "acceptEvidence", {
    artifactId,
  });
  const { paperId } = await author.command(
    tenantId,
    engagementId,
    "createPaper",
    { templateId: TEMPLATE },
  );
  const w = await author.workspace(tenantId, engagementId);
  const paper = w.engagement.papers.find(
    (p: { id: string }) => p.id === paperId,
  );
  await author.command(tenantId, engagementId, "editPaper", {
    paperId,
    body: {
      ...paper.body,
      results: "Drift stayed within the approved threshold in every quarter.",
      conclusion: "Robustness claims are supported for the tested period.",
      conclusionStatus: "supported",
    },
    evidenceIds: [artifactId],
    required: paper.required,
  });
  await author.command(tenantId, engagementId, "submitPaper", { paperId });
  return paperId as string;
}

async function paperStatus(api: Api, demo: Demo, paperId: string) {
  const w = await api.workspace(demo.tenantId, demo.engagementId);
  return w.engagement.papers.find((p: { id: string }) => p.id === paperId)
    ?.status as string;
}

async function reviewAs(who: Api, demo: Demo, paperId: string) {
  const w = await who.workspace(demo.tenantId, demo.engagementId);
  return who.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: w.engagement.version,
    op: "reviewPaper",
    data: { paperId },
  });
}

test("the author of a paper cannot review it", async ({ api, demo }) => {
  // A Lead Auditor may review, but not a paper they prepared.
  const lead = await api("qa-lead");
  const paperId = await submittedPaper(lead, demo);
  const response = await reviewAs(lead, demo, paperId);
  expect(response.status()).toBe(403);
  expect((await response.json()).error).toBe(
    "The author cannot review their own paper",
  );
  expect(await paperStatus(lead, demo, paperId)).toBe("in_review");
});

test("the Reviewer reviews a paper and the Lead Auditor signs it off", async ({
  signIn,
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor");
  const paperId = await submittedPaper(auditor, demo);

  // An Auditor's role cannot review at all: the role check refuses it before
  // the self-review check would.
  const review = await reviewAs(auditor, demo, paperId);
  expect(review.status()).toBe(403);
  expect((await review.json()).error).toBe(
    "Your role cannot perform this action",
  );

  const page = await signIn("qa-reviewer");
  await page.goto(workspacePath(demo, "Working papers"));
  await page.getByRole("button", { name: "Ready for my review" }).click();
  await expect(page.getByRole("button", { name: TITLE }).first()).toBeVisible();

  // Several runs may leave papers of the same title, so open this one by link.
  await page.goto(paperPath(demo, paperId));
  const editor = page.getByRole("dialog", { name: new RegExp(TITLE) });
  await expect(editor).toBeVisible();
  await expectAccessible(page, "Working paper review");
  await editor.getByRole("button", { name: "Approve review" }).click();
  await expect.poll(() => paperStatus(auditor, demo, paperId)).toBe("reviewed");

  const lead = await signIn("qa-lead");
  await lead.goto(paperPath(demo, paperId));
  const leadEditor = lead.getByRole("dialog", { name: new RegExp(TITLE) });
  await expect(leadEditor).toBeVisible();
  await leadEditor.getByRole("button", { name: "Sign revision" }).click();
  await expect.poll(() => paperStatus(auditor, demo, paperId)).toBe("signed");
});
