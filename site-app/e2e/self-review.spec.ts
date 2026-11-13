// Self-review: nobody reviews work they prepared or contributed to. A Lead
// Auditor who prepared a procedure is offered no review of it and the API
// refuses it, while the assigned Reviewer approves it in the Review tab; a
// Lead who edited an Auditor's working paper cannot review that paper, even
// after the Auditor's later revision makes the Auditor its author again. The
// self-approval of a classification or brief is in self-approval.spec.ts,
// and a report creator's package approval in report-release.spec.ts.
import { expectAccessible } from "./a11y";
import {
  attempt,
  engagementInFieldwork,
  engagementOf,
  submittedProcedure,
} from "./engagement";
import {
  attest,
  expect,
  recordPath,
  runCommand,
  test,
  unique,
} from "./fixtures";

test("the preparer of a procedure cannot review it", async ({
  signIn,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const reviewer = await api("qa-reviewer");
  // The Lead Auditor prepares the engagement's one procedure.
  const e = await engagementInFieldwork(
    [lead, lead, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E self-review",
  );
  await submittedProcedure(lead, e, e.procedureId);
  expect(
    await attempt(lead, e, "reviewProcedure", {
      procedureId: e.procedureId,
      reason: "Own work",
    }),
  ).toEqual({
    status: 403,
    error: "A preparer or contributor cannot approve their own work",
  });

  const path =
    recordPath(e, "Audit program", "procedure", e.procedureId) +
    "&section=review";
  const page = await signIn("qa-lead");
  await page.goto(path);
  await expect(
    page.getByRole("button", { name: "Approve reviewed work" }),
  ).toBeDisabled();
  await expectAccessible(page, "Own procedure in review");

  const review = await signIn("qa-reviewer");
  await review.goto(path);
  const approve = review.getByRole("button", { name: "Approve reviewed work" });
  await expect(approve).toBeEnabled();
  await approve.click();
  const dialog = review.getByRole("dialog", {
    name: "Approve procedure revision",
  });
  await dialog
    .getByLabel("Review decision and rationale")
    .fill("Execution, evidence and conclusion independently inspected.");
  await expectAccessible(review, "Procedure review dialog", {
    include: "[role=dialog]",
  });
  await runCommand(review, "reviewProcedure", () =>
    dialog.getByRole("button", { name: "Approve procedure" }).click(),
  );
  const reviewed = (await engagementOf(lead, e)).workflow.procedures.find(
    (p: { id: string }) => p.id === e.procedureId,
  );
  expect(reviewed.state).toBe("reviewed");
  expect(reviewed.review.userId).toBe(reviewer.who.userId);
});

test("a Lead Auditor who edited a paper cannot review it", async ({
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const { artifactId } = await auditor.uploadEvidence(
    demo.tenantId,
    demo.engagementId,
    `oversight-log-${unique()}.txt`,
    "Human oversight log: 40 overrides reviewed (synthetic).",
    "Oversight",
  );
  await auditor.command(demo.tenantId, demo.engagementId, "acceptEvidence", {
    artifactId,
    ...attest,
  });
  const { paperId } = await auditor.command(
    demo.tenantId,
    demo.engagementId,
    "createPaper",
    { templateId: "WP-A14-01" },
  );
  const paper = () =>
    engagementOf(lead, demo).then((e) =>
      e.papers.find((p: { id: string }) => p.id === paperId),
    );
  // The Lead completes the Auditor's draft, which makes them a contributor.
  const draft = await paper();
  await lead.command(demo.tenantId, demo.engagementId, "editPaper", {
    paperId,
    body: {
      ...draft.body,
      results: "Overrides were reviewed by a second officer every week.",
      conclusion: "Human oversight operates as designed.",
      conclusionStatus: "supported",
    },
    evidenceIds: [artifactId],
    required: draft.required,
  });
  // The Auditor revises it again and becomes its author, so the Lead is only
  // a contributor and the contributor rule, not the author rule, refuses the
  // Lead's review.
  const revised = await paper();
  expect(revised.authorId).toBe(lead.who.userId);
  await auditor.command(demo.tenantId, demo.engagementId, "editPaper", {
    paperId,
    body: {
      ...revised.body,
      results:
        "Overrides were reviewed by a second officer every week; 40 of 40 logged.",
    },
    evidenceIds: [artifactId],
    required: revised.required,
  });
  const final = await paper();
  expect(final.authorId).toBe(auditor.who.userId);
  expect(final.contributors).toContain(lead.who.userId);
  await auditor.command(demo.tenantId, demo.engagementId, "submitPaper", {
    paperId,
  });
  expect(await attempt(lead, demo, "reviewPaper", { paperId })).toEqual({
    status: 403,
    error: "The author cannot review their own paper",
  });
  expect((await paper()).status).toBe("in_review");
});
