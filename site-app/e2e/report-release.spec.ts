// Report release and supersession: on an engagement in Sign-off, the Lead
// Auditor captures a final readiness report, the Reviewer approves both
// exact packages and the Lead releases it to the client. A second final
// report, released the same way, supersedes the first: the client sees the
// new report and the old one labelled with its successor. The creator cannot
// approve their own package, an approval must name the exact package digests,
// and nothing is released before approval.
import type { Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import {
  attempt,
  engagementInSignOff,
  engagementOf,
  finalReport,
  run,
  type Engagement,
} from "./engagement";
import { expect, recordPath, runCommand, test, type Api } from "./fixtures";

type Report = { id: string; sha256: string; clientSha256: string };

const reportPath = (e: Engagement, r: Report) =>
  recordPath(e, "Reports & sign-off", "report", r.id);

/** The Lead releases an approved report from its record sheet. */
async function releaseInUi(page: Page, e: Engagement, r: Report) {
  await page.goto(reportPath(e, r));
  const open = page.getByRole("button", { name: "Release to client" });
  await expect(open).toBeEnabled();
  await expectAccessible(page, "Approved report before release");
  await open.click();
  const release = page.getByRole("dialog", {
    name: "Authorize client release",
  });
  await expect(
    release.getByLabel("Recipient scope and authorized use"),
  ).not.toBeEmpty();
  await release
    .getByLabel("Review decision and rationale")
    .fill("The approved packages are released to the Acme board.");
  await expectAccessible(page, "Client release dialog", {
    include: "[role=dialog]",
  });
  await runCommand(page, "releaseReport", () =>
    release.getByRole("button", { name: "Release to client" }).click(),
  );
  await expect(release).toBeHidden();
}

async function releaseOf(api: Api, e: Engagement, r: Report) {
  return (await engagementOf(api, e)).reports.find(
    (q: { id: string }) => q.id === r.id,
  ).release;
}

test("a released report is superseded by the next release", async ({
  signIn,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const viewer = await api("qa-viewer");
  const e = await engagementInSignOff(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E report release",
  );
  const first = await finalReport(lead, e, "First readiness report (E2E).");

  // Nothing is released before an independent approval, and the creator
  // cannot approve their own package.
  expect(
    await attempt(lead, e, "releaseReport", {
      reportId: first.id,
      recipientScope: "Acme board",
      reason: "Too early",
    }),
  ).toEqual({
    status: 409,
    error:
      "A different independent approver must approve both exact packages before release",
  });
  expect(
    await attempt(lead, e, "approveReportPackage", {
      reportId: first.id,
      internalHash: first.sha256,
      clientHash: first.clientSha256,
      reason: "Own package",
    }),
  ).toEqual({
    status: 403,
    error: "The report creator cannot approve its package",
  });
  // An approval names the exact package digests it reviewed.
  expect(
    await attempt(reviewer, e, "approveReportPackage", {
      reportId: first.id,
      internalHash: "0".repeat(64),
      clientHash: first.clientSha256,
      reason: "A package I did not review",
    }),
  ).toEqual({ status: 409, error: "Review both exact package hashes" });

  // The Reviewer approves both exact packages in the report's record sheet.
  const review = await signIn("qa-reviewer");
  await review.goto(reportPath(e, first));
  const approve = review.getByRole("button", { name: "Approve package" });
  await expect(approve).toBeEnabled();
  await expectAccessible(review, "Final report awaiting approval");
  await approve.click();
  const approval = review.getByRole("dialog", {
    name: "Approve both exact packages",
  });
  await approval
    .getByLabel("Review decision and rationale")
    .fill("Internal report and client preview reviewed against the work.");
  await expectAccessible(review, "Package approval dialog", {
    include: "[role=dialog]",
  });
  await runCommand(review, "approveReportPackage", () =>
    approval.getByRole("button", { name: "Approve package" }).click(),
  );
  expect((await releaseOf(lead, e, first)).state).toBe("approved");

  // The Lead Auditor releases it; the client sees it.
  const page = await signIn("qa-lead");
  await releaseInUi(page, e, first);
  const released = await releaseOf(lead, e, first);
  expect(released.state).toBe("released");
  expect(released.releasedBy).toBe(lead.who.userId);
  expect(
    (await engagementOf(viewer, e)).reports.map((r: { id: string }) => r.id),
  ).toEqual([first.id]);

  // A second final report replaces it.
  const second = await finalReport(lead, e, "Amended readiness report (E2E).");
  await run(reviewer, e, "approveReportPackage", {
    reportId: second.id,
    internalHash: second.sha256,
    clientHash: second.clientSha256,
    reason: "Amended packages reviewed",
  });
  await releaseInUi(page, e, second);
  const superseded = await releaseOf(lead, e, first);
  expect(superseded.state).toBe("superseded");
  expect(superseded.supersededBy).toBe(second.id);
  expect((await releaseOf(lead, e, second)).supersedes).toBe(first.id);

  // The client reads both: the new report names the one it replaces, and
  // the old one stays readable, labelled with its successor.
  const client = (await engagementOf(viewer, e)).reports;
  expect(client.find((r: { id: string }) => r.id === second.id)).toMatchObject({
    replaces: [first.id],
  });
  expect(client.find((r: { id: string }) => r.id === first.id)).toMatchObject({
    supersededBy: second.id,
  });
  const clientPage = await signIn("qa-viewer");
  await clientPage.goto(
    recordPath(e, "Reports & sign-off", "report", first.id),
  );
  // The report's record sheet names its successor.
  await expect(
    clientPage
      .getByRole("dialog")
      .getByText(
        `Superseded by ${second.id}. This report remains as it was issued.`,
      ),
  ).toBeVisible();
  await expectAccessible(clientPage, "Superseded report for the client");
});
