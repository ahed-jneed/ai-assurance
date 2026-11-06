// Tenant isolation and stale writes: a signed-in user outside the demo practice
// is refused in the UI and the API, a member of the demo practice cannot reach
// another practice, and a write against an old engagement version is refused.
import { expectAccessible } from "./a11y";
import { expect, ownPractice, test, workspacePath } from "./fixtures";

test("an outsider is refused the demo practice", async ({
  signIn,
  api,
  demo,
}) => {
  const page = await signIn("qa-outsider");
  await page.goto(workspacePath(demo, "Overview"));
  await expect(
    page.getByText("This link is outside your practice access."),
  ).toBeVisible();
  // The outsider lands in the practice their first sign-in provisioned.
  const outsider = await api("qa-outsider");
  await expect(page).toHaveURL(
    new RegExp("practice=" + ownPractice(outsider.who)),
  );
  await expect(page.getByText(demo.engagementId)).toHaveCount(0);
  await expectAccessible(page, "Refused deep link");

  const read = await outsider.http.get(
    "/api/workspace?" +
      new URLSearchParams({
        tenantId: demo.tenantId,
        engagementId: demo.engagementId,
      }),
  );
  expect(read.status()).toBe(403);
  const write = await outsider.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: 1,
    op: "createPaper",
    data: { templateId: "WP-A10-01" },
  });
  expect(write.status()).toBe(403);
  const evidence = await outsider.http.get(
    "/api/evidence?" +
      new URLSearchParams({
        tenantId: demo.tenantId,
        engagementId: demo.engagementId,
        artifactId: "EV-any",
      }),
  );
  expect(evidence.status()).toBe(403);
});

test("a member of the demo practice cannot reach another practice", async ({
  api,
}) => {
  const lead = await api("qa-lead");
  const outsider = await api("qa-outsider");
  const other = await outsider.workspace(ownPractice(outsider.who));
  expect(other.engagement?.id).toBeTruthy();
  const read = await lead.http.get(
    "/api/workspace?" +
      new URLSearchParams({
        tenantId: other.tenantId,
        engagementId: other.engagement.id,
      }),
  );
  expect(read.status()).toBe(403);
});

test("a practice member reaches each of their practices", async ({
  api,
  demo,
}) => {
  // qa-lead2 leads a practice of their own and is a member of the demo one.
  const lead2 = await api("qa-lead2");
  const own = await lead2.workspace(ownPractice(lead2.who));
  expect(own.identity.role).toBe("Lead Auditor");
  const shared = await lead2.workspace(demo.tenantId, demo.engagementId);
  expect(shared.engagement.id).toBe(demo.engagementId);
  const tenants = own.memberships.map(
    (m: { tenant_id: string }) => m.tenant_id,
  );
  expect(tenants).toEqual(
    expect.arrayContaining([demo.tenantId, ownPractice(lead2.who)]),
  );
});

test("a write against a stale engagement version is refused", async ({
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor");
  const w = await auditor.workspace(demo.tenantId, demo.engagementId);
  const stale = w.engagement.version;
  await auditor.command(demo.tenantId, demo.engagementId, "createPaper", {
    templateId: "WP-A13-02",
  });
  const response = await auditor.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: stale,
    op: "createPaper",
    data: { templateId: "WP-A13-02" },
  });
  expect(response.status()).toBe(409);
});
