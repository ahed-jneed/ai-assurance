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
import { expect, runCommand, test, unique, workspacePath } from "./fixtures";

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
