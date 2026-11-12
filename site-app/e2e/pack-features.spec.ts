// Pack follow-ups (#144): on an engagement of the NYC Local Law 144 pack the
// Testing lab offers the LL144 panel (a pack feature, absent on the AI Act
// demo engagement), a finding names a clause of the pack as its primary
// reference instead of an AI Act article, and a draft captured while gates
// are open says so above its conclusion.
import { expectAccessible } from "./a11y";
import { DEMO, choose, expect, test, unique, workspacePath } from "./fixtures";

test("an LL144 engagement offers its panel, cites its clauses and caveats its draft", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const title = `E2E LL144 bias audit ${unique()}`;
  const before = await lead.workspace(demo.tenantId);
  const created = await lead.post("/api/management", {
    tenantId: demo.tenantId,
    expectedVersion: before.managementVersion,
    op: "createEngagement",
    data: { clientId: demo.clientId, title, packId: "nyc-ll144-bias-audit" },
  });
  expect(created.status(), await created.text()).toBe(200);
  const engagementId = (await lead.workspace(demo.tenantId)).engagements.find(
    (e: { title: string }) => e.title === title,
  ).id as string;
  const ll144 = { ...demo, engagementId };

  const page = await signIn("qa-lead");
  // The LL144 panel follows the pack feature.
  await page.goto(workspacePath(ll144, "Testing lab"));
  await expect(
    page.getByRole("heading", { name: "NYC Local Law 144 bias audits" }),
  ).toBeVisible();
  await page.goto(workspacePath(demo, "Testing lab"));
  await expect(
    page.getByRole("heading", { name: DEMO.engagement, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "NYC Local Law 144 bias audits" }),
  ).toHaveCount(0);

  // A finding cites a clause of the pack, not an AI Act article.
  await page.goto(workspacePath(ll144, "Findings"));
  await page.getByRole("button", { name: "New finding" }).click();
  const dialog = page.getByRole("dialog", { name: "Record audit finding" });
  await expect(
    dialog.getByRole("combobox", { name: "Primary reference" }),
  ).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Article" })).toHaveCount(
    0,
  );
  await expectAccessible(page, "Finding dialog on a clause pack");
  await choose(
    dialog,
    "Primary reference",
    "NYC Local Law 144 § 5-301(b) · Selection rates and impact ratios by sex, race/ethnicity and intersection",
  );
  await dialog
    .getByRole("textbox", { name: "Finding title" })
    .fill("Intersectional categories not reported (E2E)");
  for (const [name, value] of [
    ["Observed condition", "The draft summary omits intersectional ratios."],
    ["Criteria & expectation", "Ratios are reported for every category."],
    ["Effect & affected persons", "Applicants cannot compare categories."],
  ])
    await dialog.getByRole("textbox", { name }).fill(value);
  await dialog
    .getByRole("textbox", { name: "Remediation owner" })
    .fill("Vendor");
  await dialog.getByLabel("Due date").fill("2027-01-31");
  await dialog.getByRole("button", { name: "Record finding" }).click();
  await expect(dialog).toBeHidden();
  const w = await lead.workspace(demo.tenantId, engagementId);
  expect(w.engagement.findings.at(-1)).toMatchObject({
    article: "NYC Local Law 144 § 5-301(b)",
    criteriaRefs: ["nyc-ll144:LL144-5-301-B"],
  });

  // A draft captured with open gates states the caveat.
  await page.goto(workspacePath(ll144, "Reports & sign-off"));
  await page
    .getByRole("button", { name: /^Create (draft )?snapshot$/ })
    .first()
    .click();
  const form = page.getByRole("dialog", {
    name: "Create immutable report snapshot",
  });
  await form
    .getByRole("textbox", { name: "Executive summary, scope & limitations" })
    .fill("E2E draft while fieldwork is open.");
  await form.getByRole("button", { name: "Create snapshot" }).click();
  await expect(form).toBeHidden();
  const report = (
    await lead.workspace(demo.tenantId, engagementId)
  ).engagement.reports.at(-1);
  expect(report.kind).toBe("draft");
  expect(report.snapshot.conclusionStatement.draftCaveat).toMatch(
    /^Draft, gates open: \d+ completion requirements? (was|were) open/,
  );
});
