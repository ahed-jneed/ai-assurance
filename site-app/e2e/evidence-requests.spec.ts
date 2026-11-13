// Evidence requests end to end: the Auditor requests evidence for a working
// paper, the Lead Auditor grants the Client Contributor the request, the
// contributor submits a complete package in the client portal, and the
// Auditor accepts the files and assesses the request as sufficient.
import { expectAccessible } from "./a11y";
import { attempt, engagementOf, run } from "./engagement";
import {
  DEMO,
  attest,
  choose,
  expect,
  persona,
  recordPath,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

const DAY = 86_400_000;

test("an evidence request goes from the Auditor to the client and back", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const contributor = await api("qa-contrib");
  const run_ = unique();
  const subject = `Model validation report ${run_}`;

  // The Auditor requests the evidence for the seeded working paper.
  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(demo, "Evidence vault"));
  await page.getByRole("tab", { name: /^Requests/ }).click();
  await page.getByRole("button", { name: "Request evidence" }).first().click();
  const form = page.getByRole("dialog", { name: "Request evidence" });
  await form.getByLabel("Requested evidence").fill(subject);
  await form
    .getByLabel("Expected deliverable, purpose & coverage")
    .fill("The latest independent validation report of the scoring model.");
  await form.getByLabel("Responsible party").fill("Acme model risk office");
  await form
    .getByLabel("Due date")
    .fill(new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10));
  await form
    .getByLabel("Population period / model version")
    .fill("Model 3.2, validation of 2026");
  await form
    .getByLabel("Confidentiality & collection instructions")
    .fill("Synthetic or anonymized extracts only, through the client portal.");
  // Other specs may add papers of the same template, so the first match is
  // linked: any of them is a working paper this request supports.
  await form.getByLabel("Find working paper").fill(DEMO.paperTemplate);
  await form
    .getByRole("checkbox", { name: new RegExp(DEMO.paperTemplate) })
    .first()
    .check();
  await expectAccessible(page, "Evidence request form", {
    include: "[role=dialog]",
  });
  const created = await runCommand(page, "createEvidenceRequest", () =>
    form.getByRole("button", { name: "Create request" }).click(),
  );
  await expect(form).toBeHidden();
  const { requestId } = (await created.json()).details;
  await expect(page.getByText(subject)).toBeVisible();
  await expectAccessible(page, "Evidence request register");

  // A Client Contributor cannot grant themselves the request; the Lead does.
  const prompt = `Upload the validation report (${run_}).`;
  const grant = {
    userId: persona("qa-contrib").userId,
    requestId,
    prompt,
    instructions: "Synthetic or anonymized material only.",
    category: "Validation",
    handlingBasis: "synthetic",
    expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
  };
  expect(
    (await attempt(contributor, demo, "grantClientRequest", grant)).status,
  ).toBe(403);
  await run(lead, demo, "grantClientRequest", grant);

  // The contributor submits a complete package in the portal.
  const portal = await signIn("qa-contrib");
  await portal.goto("/");
  await portal.getByText(prompt).click();
  await portal.getByRole("button", { name: "Submit evidence package" }).click();
  await portal.getByLabel("Evidence files").setInputFiles({
    name: `validation-report-${run_}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("Validation of model 3.2: AUC 0.81 (synthetic)."),
  });
  await portal.getByLabel("Submission note").fill("Validation report 2026.");
  await portal.getByLabel("Delivery status").selectOption("complete");
  await expectAccessible(portal, "Client evidence submission form");
  await portal.getByRole("button", { name: "Submit for assessment" }).click();
  await expect(portal.getByLabel("Submission note")).toBeHidden();

  // The Auditor accepts the delivered file for handling.
  const w = await engagementOf(auditor, demo);
  const submission = w.workflow.submissions.findLast(
    (s: { requestId: string }) => s.requestId === requestId,
  );
  expect(
    submission,
    "the portal submission reached the audit team",
  ).toBeTruthy();
  for (const artifactId of submission.evidenceIds)
    await run(auditor, demo, "acceptEvidence", { artifactId, ...attest });

  // The Auditor assesses the request in its record sheet.
  await page.goto(recordPath(demo, "Evidence vault", "request", requestId));
  const assess = page.getByRole("button", { name: "Assess evidence" });
  await expect(assess).toBeVisible();
  await expectAccessible(page, "Submitted evidence request");
  await assess.click();
  const assessment = page.getByRole("dialog", { name: "Assess evidence" });
  await choose(
    assessment,
    "Evidence decision",
    "Sufficient for the planned procedure",
  );
  await assessment
    .getByLabel("Relevance, reliability, coverage & limitations")
    .fill("Report covers model 3.2 for the audit period; source verified.");
  await expectAccessible(page, "Evidence assessment form", {
    include: "[role=dialog]",
  });
  await runCommand(page, "assessEvidenceRequest", () =>
    assessment.getByRole("button", { name: "Record assessment" }).click(),
  );
  const request = (await engagementOf(auditor, demo)).evidenceRequests.find(
    (r: { id: string }) => r.id === requestId,
  );
  expect(request.status).toBe("accepted");
  expect(request.evidenceIds).toEqual(
    expect.arrayContaining(submission.evidenceIds),
  );
});
