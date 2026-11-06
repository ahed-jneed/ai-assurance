// Client Contributor: answers the evidence request assigned to them in the
// client portal; the audit team sees the submission. The portal offers no
// internal work, and the API refuses it.
import { expectAccessible } from "./a11y";
import { DEMO, expect, test, unique } from "./fixtures";

test("the Client Contributor answers an evidence request", async ({
  signIn,
  api,
  demo,
}) => {
  const page = await signIn("qa-contrib");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: DEMO.engagement, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your evidence requests" }),
  ).toBeVisible();
  // Client navigation has no internal audit work.
  const nav = page.getByRole("navigation", {
    name: "Audit workspace navigation",
  });
  await expect(nav.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Working papers" })).toHaveCount(
    0,
  );
  await expect(nav.getByRole("button", { name: "Audit program" })).toHaveCount(
    0,
  );
  await expectAccessible(page, "Client portal");

  const note = `Lineage summary for model 3.2 (${unique()}).`;
  await page.getByText("Upload the training data lineage summary.").click();
  await page.getByRole("button", { name: "Submit evidence package" }).click();
  await page.getByLabel("Evidence files").setInputFiles({
    name: "lineage-summary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "source,extracted,rows\nbureau,2026-06-30,120000\napplications,2026-06-30,48000\n",
    ),
  });
  await page.getByLabel("Submission note").fill(note);
  await page.getByLabel("Delivery status").selectOption("complete");
  await expectAccessible(page, "Client evidence submission form");
  await page.getByRole("button", { name: "Submit for assessment" }).click();
  // The request collapses once submitted; reopen it to see the submission.
  await expect(page.getByLabel("Submission note")).toBeHidden();
  await page.getByText("Upload the training data lineage summary.").click();
  await expect(page.getByText(note)).toBeVisible();
  await expect(
    page.getByText("Awaiting receipt acknowledgment").first(),
  ).toBeVisible();

  // The audit team sees the submission against the seeded request.
  const auditor = await api("qa-auditor");
  const w = await auditor.workspace(demo.tenantId, demo.engagementId);
  const request = w.engagement.evidenceRequests.find(
    (r: { subject: string }) => r.subject === DEMO.request,
  );
  expect(
    w.engagement.workflow.submissions.some(
      (s: { note: string; requestId: string }) =>
        s.note === note && s.requestId === request.id,
    ),
  ).toBe(true);
});

test("a Client Contributor cannot run internal audit commands", async ({
  api,
  demo,
}) => {
  const contributor = await api("qa-contrib");
  const w = await contributor.workspace(demo.tenantId, demo.engagementId);
  // The client projection carries no working papers.
  expect(w.engagement.papers ?? []).toEqual([]);
  const response = await contributor.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: w.engagement.version,
    op: "createPaper",
    data: { templateId: DEMO.paperTemplate },
  });
  expect(response.status()).toBe(403);
});
