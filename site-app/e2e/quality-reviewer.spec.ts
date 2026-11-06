// Engagement Quality Reviewer: a Lead Auditor appoints a reviewer from outside
// the engagement team, who records the stand-back checklist. Team members
// cannot be appointed, and the reviewer cannot edit audit work.
import { expectAccessible } from "./a11y";
import {
  DEMO,
  expect,
  runCommand,
  test,
  workspacePath,
  type Api,
  type Demo,
} from "./fixtures";

const refusedWork =
  "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work";

/** A raw engagement command at the current version, for refusals. */
async function attempt(
  who: Api,
  demo: Demo,
  op: string,
  data: Record<string, unknown>,
) {
  const w = await who.workspace(demo.tenantId, demo.engagementId);
  const response = await who.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: w.engagement.version,
    op,
    data,
  });
  return { status: response.status(), error: (await response.json()).error };
}

test("only an eligible reviewer outside the team is appointed", async ({
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  // The Auditor has the wrong role; the Lead is on the engagement team.
  expect(
    await attempt(lead, demo, "appointQualityReviewer", {
      userId: "persona-qa-auditor",
      reason: "Persona suite",
    }),
  ).toEqual({
    status: 400,
    error: "Select an active member with the Engagement Quality Reviewer role",
  });
  const w = await lead.workspace(demo.tenantId, demo.engagementId);
  if (w.engagement.qualityReview?.reviewerId !== "persona-qa-eqr")
    await lead.command(
      demo.tenantId,
      demo.engagementId,
      "appointQualityReviewer",
      {
        userId: "persona-qa-eqr",
        reason: "Independent of the Acme engagement team",
      },
    );
  // Only the appointed reviewer records the review.
  expect(await attempt(lead, demo, "saveQualityReview", { items: [] })).toEqual(
    { status: 403, error: "Your role cannot perform this action" },
  );
});

test("the reviewer records the checklist but cannot edit papers", async ({
  signIn,
  api,
  demo,
}) => {
  const eqr = await api("qa-eqr");
  const w = await eqr.workspace(demo.tenantId, demo.engagementId);
  expect(w.engagement.qualityReview?.reviewerId).toBe("persona-qa-eqr");
  const paper = w.engagement.papers.find(
    (p: { templateId: string }) => p.templateId === DEMO.paperTemplate,
  );
  expect(
    await attempt(eqr, demo, "editPaper", {
      paperId: paper.id,
      body: paper.body,
      evidenceIds: [],
      required: paper.required,
    }),
  ).toEqual({ status: 403, error: refusedWork });
  expect(
    await attempt(eqr, demo, "createPaper", { templateId: "WP-A15-02" }),
  ).toEqual({ status: 403, error: refusedWork });

  const page = await signIn("qa-eqr");
  await page.goto(workspacePath(demo, "Reports & sign-off"));
  await page.getByRole("tab", { name: "Quality review" }).click();
  const panel = page.getByRole("region", { name: "Engagement quality review" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("QA Quality Reviewer")).toBeVisible();
  await expectAccessible(page, "Engagement quality review");
  const item = panel.getByRole("listitem").filter({
    hasText: "Understand the engagement, its subject matter and its risks",
  });
  await item.getByLabel("Result").selectOption("satisfied");
  await item
    .getByLabel("Notes")
    .fill("Read the brief, the classification and the audit program.");
  // Read through the API only once the Worker has answered the UI's command,
  // never while its save is still in flight (#119).
  await runCommand(page, "saveQualityReview", () =>
    panel.getByRole("button", { name: "Save checklist" }).click(),
  );
  const now = await eqr.workspace(demo.tenantId, demo.engagementId);
  expect(
    now.engagement.qualityReview.items.find(
      (i: { id: string }) => i.id === "understanding",
    )?.status,
  ).toBe("satisfied");
});
