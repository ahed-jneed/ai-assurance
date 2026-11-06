// Lead Auditor: creates an engagement for an existing client from the
// Engagements register and lands in it.
import { expectAccessible } from "./a11y";
import { DEMO, choose, expect, test, unique, workspacePath } from "./fixtures";

test("the Lead Auditor creates an engagement for a client", async ({
  signIn,
  api,
  demo,
}) => {
  const title = `E2E fairness re-audit ${unique()}`;
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(demo, "Engagements"));
  await expect(
    page.getByRole("heading", { name: "Engagements", level: 1 }),
  ).toBeVisible();
  await expectAccessible(page, "Engagements register");

  await page.getByRole("button", { name: "New engagement" }).click();
  const dialog = page.getByRole("dialog", { name: "New engagement" });
  await choose(dialog, "Client", DEMO.client);
  await dialog.getByRole("textbox", { name: "Engagement title" }).fill(title);
  await expectAccessible(page, "New engagement dialog");
  await dialog.getByRole("button", { name: "Create engagement" }).click();
  await expect(dialog).toBeHidden();

  // The new engagement opens and is recorded for the client.
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  const w = await (await api("qa-lead")).workspace(demo.tenantId);
  expect(
    w.engagements.some(
      (e: { title: string; client_id: string }) =>
        e.title === title && e.client_id === demo.clientId,
    ),
  ).toBe(true);
});

test("an Auditor cannot create engagements", async ({ api, demo }) => {
  const auditor = await api("qa-auditor");
  const w = await auditor.workspace(demo.tenantId);
  const response = await auditor.post("/api/management", {
    tenantId: demo.tenantId,
    expectedVersion: w.managementVersion,
    op: "createEngagement",
    data: { clientId: demo.clientId, title: "Not allowed" },
  });
  expect(response.status()).toBe(403);
});
