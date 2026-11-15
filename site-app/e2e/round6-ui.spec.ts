// Round-6 workspace fixes (#240) with real clicks: a client who opens a link
// to another client's engagement is told it is not available to them and is
// led back to their own engagement.
import { expectAccessible } from "./a11y";
import { newEngagement } from "./engagement";
import { DEMO, expect, test, unique, workspacePath } from "./fixtures";

test("a client opening another client's engagement is led back to their own", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const { clientId } = await lead.manage(demo.tenantId, "createClient", {
    name: `Other client ${unique()}`,
    sector: "Other",
  });
  const other = await newEngagement(
    lead,
    demo.tenantId,
    clientId,
    "E2E round-6 other client",
  );

  const page = await signIn("qa-viewer");
  await page.goto(workspacePath(other, "Overview"));
  await expect(
    page.getByRole("heading", {
      name: "This engagement is not available to you",
    }),
  ).toBeVisible();
  await expect(page.getByText("No engagement is assigned")).toHaveCount(0);
  await expect(
    page.getByText("Ask your Lead Auditor to assign client access."),
  ).toHaveCount(0);
  await expectAccessible(page, "Another client's engagement");
  await page.getByRole("button", { name: `Open ${DEMO.engagement}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Client portal navigation" }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("engagement"))
    .toBe(demo.engagementId);
});
