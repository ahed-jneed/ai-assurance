// Client Viewer: sees only what the audit team released to the client. Evidence
// shared with the client and accepted is listed; internal or unaccepted
// evidence is neither listed nor downloadable, and nothing can be changed.
import { expectAccessible } from "./a11y";
import { attest, DEMO, expect, test, unique } from "./fixtures";

test("the Client Viewer sees released content only", async ({
  signIn,
  api,
  demo,
}) => {
  const { tenantId, engagementId } = demo;
  const auditor = await api("qa-auditor");
  const suffix = unique();
  const shared = `model-card-${suffix}.txt`;
  const pending = `draft-model-card-${suffix}.txt`;
  const internal = `internal-notes-${suffix}.txt`;
  const sharedId = (
    await auditor.uploadEvidence(
      tenantId,
      engagementId,
      shared,
      "Model card v3.2 (synthetic).",
      "Instructions",
      "client",
    )
  ).artifactId;
  await auditor.command(tenantId, engagementId, "acceptEvidence", {
    artifactId: sharedId,
    ...attest,
  });
  // Shared with the client but not accepted yet: not released.
  const pendingId = (
    await auditor.uploadEvidence(
      tenantId,
      engagementId,
      pending,
      "Draft model card (synthetic).",
      "Instructions",
      "client",
    )
  ).artifactId;
  // Accepted but internal: never released.
  const internalId = (
    await auditor.uploadEvidence(
      tenantId,
      engagementId,
      internal,
      "Internal working notes (synthetic).",
    )
  ).artifactId;
  await auditor.command(tenantId, engagementId, "acceptEvidence", {
    artifactId: internalId,
    ...attest,
  });

  const page = await signIn("qa-viewer");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: DEMO.engagement, level: 1 }),
  ).toBeVisible();
  // A viewer has no evidence requests to answer.
  await expect(
    page.getByRole("heading", { name: "Your evidence requests" }),
  ).toHaveCount(0);
  await expectAccessible(page, "Client viewer overview");

  // The client portal shell (#36): its own navigation, no practice sidebar.
  const portal = page.getByRole("navigation", {
    name: "Client portal navigation",
  });
  await expect(
    portal.getByRole("button", { name: "Overview" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("navigation", { name: "Audit workspace navigation" }),
  ).toHaveCount(0);
  for (const practiceOnly of [
    "Clients",
    "Engagements",
    "Members & access",
    "Search workspace",
  ])
    await expect(
      page.getByRole("button", { name: practiceOnly, exact: true }),
    ).toHaveCount(0);
  await expect(page.getByText("Switch practice")).toHaveCount(0);
  await portal.getByRole("button", { name: "Shared evidence" }).click();
  await expect(
    page.getByRole("heading", { name: "Shared evidence", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(shared).first()).toBeVisible();
  await expect(page.getByText(pending)).toHaveCount(0);
  await expect(page.getByText(internal)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /upload/i })).toHaveCount(0);
  await expectAccessible(page, "Client viewer evidence");

  // The API agrees: only released evidence is in the projection or downloadable.
  const viewer = await api("qa-viewer");
  const w = await viewer.workspace(tenantId, engagementId);
  const ids = w.engagement.artifacts.map((a: { id: string }) => a.id);
  expect(ids).toContain(sharedId);
  expect(ids).not.toContain(pendingId);
  expect(ids).not.toContain(internalId);
  const download = (artifactId: string) =>
    viewer.http.get(
      "/api/evidence?" +
        new URLSearchParams({ tenantId, engagementId, artifactId }),
    );
  expect((await download(sharedId)).status()).toBe(200);
  expect((await download(pendingId)).status()).toBe(404);
  expect((await download(internalId)).status()).toBe(404);
});
