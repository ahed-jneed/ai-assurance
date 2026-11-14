// Release verification round 2 (#210): the workspace offers what the
// server accepts. Release stays disabled, with the server's reason, until
// the Engagement Quality Reviewer signs off both packages; the client sees
// the release time labelled "Released"; the Auditor acknowledges a client
// package; and Review closure of a follow-up case without accepted evidence
// is disabled with the server's reason. The toast layering is in
// stale-versions.spec.ts.
import { expectAccessible } from "./a11y";
import {
  engagementInSignOff,
  finalReport,
  newEngagement,
  joinTeam,
  RELEASE_CHECKLIST,
  run,
} from "./engagement";
import {
  expect,
  recordPath,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

const STAND_BACK = [
  "understanding",
  "judgments",
  "documentation",
  "independence",
  "consultation",
  "involvement",
  "report",
];

test("Release waits for the EQR's sign-off, and the client sees when it was released", async ({
  signIn,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const eqr = await api("qa-eqr");
  const e = await engagementInSignOff(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E EQR release",
  );
  // The reviewer is granted the engagement, which does not put them on its team.
  await joinTeam(lead, e, ["qa-eqr"]);
  await run(lead, e, "appointQualityReviewer", {
    userId: eqr.who.userId,
    reason: "Independent of this engagement team",
  });
  await run(eqr, e, "saveQualityReview", {
    items: STAND_BACK.map((id) => ({
      id,
      status: "satisfied",
      notes: "Evaluated (persona suite)",
    })),
  });
  const report = await finalReport(lead, e, "Readiness report with EQR.");
  await run(reviewer, e, "approveReportPackage", {
    reportId: report.id,
    internalHash: report.sha256,
    clientHash: report.clientSha256,
    reason: "Both packages reviewed",
    checklist: RELEASE_CHECKLIST,
  });

  const eqrReason =
    "The engagement quality reviewer must sign off both exact packages before release";
  const page = await signIn("qa-lead");
  await page.goto(recordPath(e, "Reports & sign-off", "report", report.id));
  const sheet = page.getByRole("dialog");
  const releaseButton = sheet.getByRole("button", {
    name: "Release to client",
  });
  await expect(releaseButton).toBeDisabled();
  await expect(releaseButton).toHaveAccessibleDescription(eqrReason);
  await expect(
    sheet.getByText("Both package versions are approved. " + eqrReason + "."),
  ).toBeVisible();
  await expectAccessible(page, "Approved package awaiting the EQR");

  // Once the EQR signs off both packages, the Lead releases it.
  await run(eqr, e, "signOffQualityReview", {
    reportId: report.id,
    internalHash: report.sha256,
    clientHash: report.clientSha256,
    conclusion: "Stand-back review complete",
  });
  await page.reload();
  await expect(releaseButton).toBeEnabled();
  await releaseButton.click();
  const release = page.getByRole("dialog", {
    name: "Authorize client release",
  });
  await release
    .getByLabel("Review decision and rationale")
    .fill("Released after the quality review sign-off.");
  await runCommand(page, "releaseReport", () =>
    release.getByRole("button", { name: "Release to client" }).click(),
  );
  await expect(release).toBeHidden();

  // The client sees the release time labelled Released: the reports list,
  // the record sheet and the printable report.
  const client = await signIn("qa-viewer");
  await client.goto(workspacePath(e, "Reports & sign-off"));
  await expect(
    client.getByRole("columnheader", { name: "Released" }),
  ).toBeVisible();
  await expect(
    client.getByRole("columnheader", { name: "Captured" }),
  ).toHaveCount(0);
  await client.goto(recordPath(e, "Reports & sign-off", "report", report.id));
  const record = client.getByRole("dialog");
  await expect(record.getByText("Released", { exact: true })).toBeVisible();
  await expect(record.getByText("Captured", { exact: true })).toHaveCount(0);
  await expectAccessible(client, "Released report for the client");
  await client.goto(
    "/report?" +
      new URLSearchParams({
        tenantId: e.tenantId,
        engagementId: e.engagementId,
        reportId: report.id,
      }),
  );
  await expect(client.locator(".report-meta").first()).toContainText(
    `${report.id} · Released`,
  );
});

test("the Auditor acknowledges a client package outside the Lead's grant controls", async ({
  signIn,
  api,
  demo,
}) => {
  // The Client Contributor submits a package to the seeded request.
  const contributor = await signIn("qa-contrib");
  await contributor.goto("/");
  const note = `Lineage package for acknowledgment (${unique()}).`;
  await contributor
    .getByText("Upload the training data lineage summary.")
    .click();
  await contributor
    .getByRole("button", { name: "Submit evidence package" })
    .click();
  await contributor.getByLabel("Evidence files").setInputFiles({
    name: "lineage-ack.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("source,rows\nbureau,120000\n"),
  });
  await contributor.getByLabel("Submission note").fill(note);
  await contributor.getByLabel("Delivery status").selectOption("complete");
  await contributor
    .getByRole("button", { name: "Submit for assessment" })
    .click();
  await expect(contributor.getByLabel("Submission note")).toBeHidden();

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(demo, "Evidence vault"));
  await page.getByRole("tab", { name: /^Requests/ }).click();
  await page.getByText("Client submissions").click();
  // The grant controls stay the Lead Auditor's.
  await expect(
    page.getByRole("button", { name: "Assign request" }),
  ).toHaveCount(0);
  const pkg = page
    .locator(".comment-box .comment-box")
    .filter({ hasText: note });
  await expect(pkg).toHaveCount(1);
  await expectAccessible(page, "Client submissions for the Auditor");
  await pkg.getByRole("button", { name: "Acknowledge receipt" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Acknowledge package receipt",
  });
  await dialog
    .getByLabel("Client-facing receipt note")
    .fill("Received; the audit team will assess the files.");
  await runCommand(page, "acknowledgeClientSubmission", () =>
    dialog.getByRole("button", { name: "Acknowledge receipt" }).click(),
  );
  await expect(pkg.getByText(/^Receipt acknowledged/)).toBeVisible();
  const auditor = await api("qa-auditor");
  const w = await auditor.workspace(demo.tenantId, demo.engagementId);
  expect(
    w.engagement.workflow.submissions.find(
      (s: { note: string }) => s.note === note,
    ).receipt.actor,
  ).toBe(auditor.who.userId);
});

test("Review closure of a follow-up case without accepted evidence is disabled with the server's reason", async ({
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
    "E2E follow-up closure",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);
  const title = `Model change ${unique()}`;
  const { caseId } = await run(auditor, e, "createMonitoringCase", {
    kind: "change",
    title,
    description: "A new model version needs an impact decision",
    ownerId: auditor.who.userId,
    dueDate: "2026-12-31",
    cadence: "one_off",
    findingId: "",
    reportId: "",
  });
  await run(auditor, e, "assessMonitoringCase", {
    caseId,
    decision: "follow_up",
    assessment: "Follow-up needed once the new version is validated",
    evidenceIds: [],
    dueDate: "2026-12-31",
  });

  const page = await signIn("qa-reviewer");
  await page.goto(workspacePath(e, "Audit program"));
  await page.getByRole("tab", { name: "Follow-up" }).click();
  await page.getByText(title).click();
  const closure = page.getByRole("button", { name: "Review closure" });
  const reason =
    "Record an assessment with the accepted evidence before independent closure";
  await expect(closure).toBeDisabled();
  await expect(closure).toHaveAccessibleDescription(reason);
  await expect(page.getByText(reason)).toBeVisible();
  await expectAccessible(page, "Follow-up case awaiting evidence");
});
