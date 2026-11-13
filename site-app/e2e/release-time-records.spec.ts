// Release polish (#94): the records that cannot change say why. A limitation
// memo retired by reopening its evidence request opens with a banner and no
// command; the release-time procedure WP-RP-02 shows its release record
// instead of the generic readiness checklist, needs no preparer, reviewer or
// deadline in its plan, and the program list does not ask for a deadline.
import { expectAccessible } from "./a11y";
import { expect, paperPath, test, unique, type Api } from "./fixtures";

/** A new engagement of the demo client, so the shared one stays untouched. */
async function newEngagement(lead: Api, tenantId: string, clientId: string) {
  const w = await lead.workspace(tenantId);
  const response = await lead.post("/api/management", {
    tenantId,
    expectedVersion: w.managementVersion,
    op: "createEngagement",
    data: { clientId, title: `E2E release-time records ${unique()}` },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).details.engagementId as string;
}

test("retired and release-time records explain why they do not change", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const { tenantId } = demo;
  const engagementId = await newEngagement(lead, tenantId, demo.clientId);
  const here = { ...demo, engagementId };

  // A limitation memo: a request closed as unobtainable, then reopened.
  const { paperId } = await lead.command(
    tenantId,
    engagementId,
    "createPaper",
    {
      templateId: "WP-A15-02",
    },
  );
  await lead.command(tenantId, engagementId, "createEvidenceRequest", {
    subject: "Synthetic population extract",
    description: "Synthetic coverage support for the paper.",
    responsibleParty: "Synthetic provider",
    periodVersion: "Synthetic 2026 population, version 1.0",
    handling: "Synthetic collection instructions",
    dueDate: "2026-12-31",
    paperIds: [paperId],
  });
  const requestId = (
    await lead.workspace(tenantId, engagementId)
  ).engagement.evidenceRequests.at(-1).id as string;
  const closed = await lead.command(
    tenantId,
    engagementId,
    "closeEvidenceRequest",
    {
      requestId,
      disposition: "unobtainable",
      assessment: "The provider holds no records for the period.",
    },
  );
  const memoId = closed.paperId as string;
  await lead.command(tenantId, engagementId, "reopenEvidenceRequest", {
    requestId,
    reason: "The provider located further records",
  });

  const page = await signIn("qa-lead");
  await page.goto(paperPath(here, memoId));
  const editor = page.getByRole("dialog");
  const notice = editor.getByRole("note");
  await expect(notice).toContainText("Retired memo");
  await expect(notice).toContainText(
    "its evidence request " + requestId + " was reopened",
  );
  // Nothing can be saved or submitted.
  await expect(
    editor.getByRole("button", { name: /Save revision|Submit for review/ }),
  ).toHaveCount(0);
  await expectAccessible(page, "Retired limitation memo");

  // The release-time procedure shows its release record.
  await page.goto(
    "/?" +
      new URLSearchParams({
        practice: tenantId,
        engagement: engagementId,
        view: "Audit program",
        kind: "procedure",
        record: "PROC-WP-RP-02",
        section: "plan",
      }),
  );
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Release record")).toBeVisible();
  await expect(
    drawer.getByText(
      "Not recorded yet: approving and releasing the final package records it.",
    ),
  ).toBeVisible();
  await expect(drawer.getByText("Procedure readiness")).toHaveCount(0);
  await expectAccessible(page, "Release-time procedure");

  // Its plan needs no preparer, reviewer or deadline.
  await drawer.getByRole("button", { name: "Edit plan" }).click();
  const plan = page.getByRole("dialog", { name: /Plan · WP-RP-02/ });
  await expect(plan).toContainText(
    "Recorded at release: no preparer, reviewer, deadline, population or sampling is needed",
  );
  for (const name of ["Preparer", "Independent reviewer"])
    await expect(plan.getByRole("combobox", { name })).not.toHaveAttribute(
      "required",
    );
  await expect(plan.getByLabel("Due date")).not.toHaveAttribute("required");
  await plan.getByRole("button", { name: "Cancel" }).click();
  await expect(plan).toBeHidden();

  // The program list does not ask for its deadline.
  await page.goto(
    "/?" +
      new URLSearchParams({
        practice: tenantId,
        engagement: engagementId,
        view: "Audit program",
      }),
  );
  await page.getByRole("button", { name: "Decisions needed" }).click();
  const row = page.getByRole("row").filter({ hasText: "WP-RP-02" });
  await expect(row).toContainText("Recorded at release");
  await expect(row).not.toContainText("Deadline needed");
});
