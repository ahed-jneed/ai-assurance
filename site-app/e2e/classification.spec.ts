// Classification: the Lead Auditor answers the guided regulatory
// classification of a credit scoring deployer in Regulatory mapping; their
// own approval is refused, and the independent Reviewer approves it. It runs
// on an engagement of its own, so the demo engagement's classification
// stays as the other specs expect.
import type { Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import {
  CLASSIFICATION,
  engagementOf,
  joinTeam,
  newEngagement,
} from "./engagement";
import {
  attestInDialog,
  choose,
  expect,
  runCommand,
  test,
  workspacePath,
} from "./fixtures";

// The Risk classification panel, the first panel of the Classification tab.
const classificationPanel =
  '[role="tabpanel"][data-state="active"] > section.panel:first-child';

/**
 * Waits for the criteria coverage grid below the panel, which loads on its
 * own schedule, so the page-wide axe check covers the loaded grid and never
 * its skeleton (#36).
 */
async function coverageLoaded(page: Page) {
  await expect(
    page.locator(".coverage-filter-status").filter({ hasText: /Showing/ }),
  ).toBeVisible();
}

test("the Lead classifies the system and the Reviewer approves it", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const reviewer = await api("qa-reviewer");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E classification",
  );
  await joinTeam(lead, e, ["qa-reviewer"]);

  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Regulatory mapping"));
  await expect(
    page
      .locator(classificationPanel)
      .getByRole("heading", { name: "Risk classification" }),
  ).toBeVisible();
  await coverageLoaded(page);
  await expectAccessible(page, "Unclassified classification");
  await page.getByRole("button", { name: "Assess classification" }).click();
  const form = page.getByRole("dialog", {
    name: "Guided regulatory classification",
  });
  await form
    .getByLabel("Intended purpose & deployment context")
    .fill(CLASSIFICATION.intendedPurpose);
  await choose(form, "Operator role", "Deployer");
  await choose(form, "Annex route", CLASSIFICATION.annexRoute);
  await form
    .getByRole("radiogroup", {
      name: "The Annex III use involves profiling of natural persons",
    })
    .getByRole("radio", { name: "Yes" })
    .check();
  // Every other fact the form asks is answered "No". An answer can bring
  // further facts into the form, so the form is read again until none is
  // left as "Needs information".
  for (let pass = 0; pass < 5; pass++) {
    const open = form.getByRole("radiogroup").filter({
      has: page.getByRole("radio", {
        name: "Needs information",
        checked: true,
      }),
    });
    const count = await open.count();
    if (!count) break;
    for (let i = 0; i < count; i++)
      await open.first().getByRole("radio", { name: "No" }).check();
  }
  await choose(
    form,
    "SME or small mid-cap status of the operator",
    "Neither SME nor small mid-cap",
  );
  await form
    .getByLabel("Legal rationale, facts, exceptions & transition analysis")
    .fill(CLASSIFICATION.rationale);
  await expect(form.getByText("Derived now:")).toBeVisible();
  await expect(form.getByText(/facts need information/)).toHaveCount(0);
  await expectAccessible(page, "Guided classification form");
  await runCommand(page, "classify", () =>
    form.getByRole("button", { name: "Save classification" }).click(),
  );
  await expect(form).toBeHidden();
  const classified = (await engagementOf(lead, e)).classification;
  expect(classified).toMatchObject({
    status: "provisional",
    operatorRole: "Deployer",
    annexRoute: CLASSIFICATION.annexRoute,
    highRisk: true,
    profiling: true,
  });

  // The Lead prepared it, so their approval is disabled with the reason the
  // server would refuse it with.
  const own = page.getByRole("button", { name: "Approve independently" });
  await expect(own).toBeDisabled();
  await expect(own).toHaveAccessibleDescription(
    "An independent reviewer must approve a completed classification",
  );
  expect((await engagementOf(lead, e)).classification.status).toBe(
    "provisional",
  );

  const review = await signIn("qa-reviewer");
  await review.goto(workspacePath(e, "Regulatory mapping"));
  const approve = review.getByRole("button", { name: "Approve independently" });
  await expect(approve).toBeEnabled();
  await coverageLoaded(review);
  await expectAccessible(review, "Classification awaiting approval");
  // Approval opens the attestation dialog; its statement and the reviewer's
  // rationale are recorded in the audit event.
  await approve.click();
  await runCommand(review, "approveClassification", () =>
    attestInDialog(
      review,
      "Approve classification",
      "Approve classification",
      "Answers checked against the intended purpose",
    ),
  );
  await expect(
    review.getByRole("dialog", { name: "Approve classification" }),
  ).toBeHidden();
  const approved = (await engagementOf(lead, e)).classification;
  expect(approved.status).toBe("approved");
  expect(approved.approvedBy).toBe(reviewer.who.userId);
  const event = (await lead.workspace(e.tenantId, e.engagementId)).events.find(
    (x: { action: string }) => x.action === "approveClassification",
  );
  expect(JSON.parse(event.details).attestation).toMatchObject({
    rationale: "Answers checked against the intended purpose",
    record: e.engagementId + "/classification",
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
});
