// Scope and program approval: the Lead Auditor completes and submits the
// engagement brief, the Reviewer approves it; the Auditor submits the audit
// program and the Reviewer approves it. The preparers cannot approve their
// own scope or program. The flow runs on an engagement of its own, so the
// demo engagement's brief stays as the other specs expect.
import { expectAccessible } from "./a11y";
import {
  BRIEF,
  attempt,
  draftProgram,
  engagementOf,
  joinTeam,
  newEngagement,
} from "./engagement";
import { expect, runCommand, test, workspacePath } from "./fixtures";

test("the Reviewer approves the scope and the program the team prepared", async ({
  signIn,
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
    "E2E scope and program",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);

  // The Lead Auditor completes the brief and submits it.
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Audit program"));
  await page.getByRole("tab", { name: "Engagement brief" }).click();
  await page.getByRole("button", { name: "Complete brief" }).click();
  const form = page.getByRole("dialog", { name: "Complete engagement brief" });
  for (const [label, value] of [
    ["AI system and version", BRIEF.systemName],
    ["Intended use and decision context", BRIEF.intendedUse],
    ["Audit boundary and exclusions", BRIEF.boundary],
    ["Period from", BRIEF.periodStart],
    ["Period to", BRIEF.periodEnd],
    [
      "Provider, deployer and other actor responsibilities",
      BRIEF.actorResponsibilities,
    ],
    ["Intended report users", BRIEF.audience],
    ["Deliverables and assurance limitations", BRIEF.deliverables],
    ["Regulatory source, applicable dates and assurance criteria", BRIEF.basis],
    ["Access, data rights and engagement constraints", BRIEF.constraints],
  ])
    await form.getByLabel(label, { exact: true }).fill(value);
  await expectAccessible(page, "Engagement brief form");
  await runCommand(page, "saveBrief", () =>
    form.getByRole("button", { name: "Save scope draft" }).click(),
  );
  await expect(form).toBeHidden();
  await runCommand(page, "submitBrief", () =>
    page.getByRole("button", { name: "Submit for review" }).click(),
  );
  // The preparer is offered no approval of their own scope, and the API
  // refuses it.
  await expect(
    page.getByRole("button", { name: "Approve scope" }),
  ).toBeDisabled();
  const brief = (await engagementOf(lead, e)).workflow.brief;
  expect(brief.status).toBe("submitted");
  expect(
    await attempt(lead, e, "approveBrief", {
      revision: brief.revision,
      reason: "Own scope",
    }),
  ).toEqual({
    status: 403,
    error: "A preparer or contributor cannot approve their own work",
  });

  // The Reviewer approves the submitted scope revision.
  const review = await signIn("qa-reviewer");
  await review.goto(workspacePath(e, "Audit program"));
  await review.getByRole("tab", { name: "Engagement brief" }).click();
  const approveScope = review.getByRole("button", { name: "Approve scope" });
  await expect(approveScope).toBeEnabled();
  await expectAccessible(review, "Submitted engagement brief");
  await approveScope.click();
  const approval = review.getByRole("dialog", {
    name: `Approve scope revision ${brief.revision}`,
  });
  await approval
    .getByLabel("Review decision and rationale")
    .fill("Boundary, period and responsibilities reviewed.");
  await expectAccessible(review, "Scope approval dialog");
  await runCommand(review, "approveBrief", () =>
    approval.getByRole("button", { name: "Approve scope" }).click(),
  );
  const approved = (await engagementOf(lead, e)).workflow.brief;
  expect(approved.status).toBe("approved");
  expect(approved.approval.userId).toBe(reviewer.who.userId);

  // The Auditor plans the program and submits it in the Program tab.
  await draftProgram(auditor, e);
  const prepare = await signIn("qa-auditor");
  await prepare.goto(workspacePath(e, "Audit program"));
  await prepare.getByRole("tab", { name: "Program" }).click();
  const submit = prepare.getByRole("button", { name: "Submit program" });
  await expect(submit).toBeEnabled();
  await expectAccessible(prepare, "Draft audit program");
  await runCommand(prepare, "submitProgram", () => submit.click());
  const program = (await engagementOf(lead, e)).workflow.program;
  expect(program.status).toBe("submitted");
  expect(
    await attempt(auditor, e, "approveProgram", {
      revision: program.revision,
      reason: "Own program",
    }),
  ).toEqual({
    status: 403,
    error: "An independent Reviewer or Lead Auditor must approve",
  });

  // The Reviewer approves it.
  await review.reload();
  await review.getByRole("tab", { name: "Program" }).click();
  await review.getByRole("button", { name: "Approve program" }).click();
  const programApproval = review.getByRole("dialog", {
    name: `Approve program revision ${program.revision}`,
  });
  await programApproval
    .getByLabel("Review decision and rationale")
    .fill("Selection, criteria, sample and assignments reviewed.");
  await expectAccessible(review, "Program approval dialog");
  await runCommand(review, "approveProgram", () =>
    programApproval.getByRole("button", { name: "Approve program" }).click(),
  );
  const done = (await engagementOf(lead, e)).workflow.program;
  expect(done.status).toBe("approved");
  expect(done.approval.userId).toBe(reviewer.who.userId);
});
