// Round-5 workspace fixes (#234) with real clicks: the own-work reason on
// Approve scope and Approve program, a practice link to an unknown
// engagement, the banner after leaving it, the access decision sheet, the
// over-limit reason in the evaluation wizard, readable dataset roles and
// procedure methods, and the dataset card export.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expectAccessible } from "./a11y";
import {
  approvedScope,
  assurance,
  draftProgram,
  joinTeam,
  newEngagement,
  run,
  submittedBrief,
} from "./engagement";
import {
  attest,
  expect,
  ownPractice,
  persona,
  test,
  unique,
  workspacePath,
} from "./fixtures";

const ownWork = "A preparer or contributor cannot approve their own work";

test("a contributing Lead sees why Approve scope and Approve program are disabled", async ({
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
    "E2E round-5 own work",
  );
  await joinTeam(lead, e, ["qa-reviewer"]);
  await submittedBrief(lead, e);

  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Audit program"));
  await page.getByRole("tab", { name: "Engagement brief" }).click();
  const approveScope = page.getByRole("button", { name: "Approve scope" });
  await expect(approveScope).toBeDisabled();
  // The server's reason, tied to the button.
  await expect(approveScope).toHaveAccessibleDescription(ownWork);
  await expect(page.getByText(ownWork)).toBeVisible();
  await expectAccessible(page, "Own scope awaiting approval");

  // The Lead prepares the program after an independent scope approval.
  await run(reviewer, e, "returnBrief", { reason: "Reset for the program" });
  await approvedScope(lead, reviewer, e);
  await draftProgram(lead, e);
  await run(lead, e, "submitProgram");
  await page.reload();
  await page.getByRole("tab", { name: "Program" }).click();
  const approveProgram = page.getByRole("button", { name: "Approve program" });
  await expect(approveProgram).toBeDisabled();
  await expect(approveProgram).toHaveAccessibleDescription(ownWork);
  // The procedure's plan names its method.
  await page.getByText("WP-A09-01").first().click();
  await expect(page.getByText("Manual", { exact: true })).toBeVisible();
  await expect(page.getByText("manual", { exact: true })).toHaveCount(0);
});

test("a link to an unknown engagement stays in its practice, and leaving it clears the banner", async ({
  signIn,
  api,
  demo,
}) => {
  // qa-lead2 belongs to the demo practice and leads one of their own.
  const lead2 = await api("qa-lead2");
  const own = ownPractice(lead2.who);
  const fallback = (await lead2.workspace()).tenantId;
  // The practice the account does not open by default.
  const other = fallback === demo.tenantId ? own : demo.tenantId;
  const page = await signIn("qa-lead2");
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/workspace" && request.method() === "GET")
      reads.push(url.searchParams.get("engagementId") ?? "");
  });
  await page.goto(
    "/?" +
      new URLSearchParams({
        practice: other,
        engagement: "ENG-DOES-NOT-EXIST",
        view: "Overview",
      }),
  );
  await expect(
    page.getByText(
      "This engagement does not exist in this practice or you no longer have access.",
    ),
  ).toBeVisible();
  const banner = page.locator(".error-banner");
  await expect(banner).toContainText("Engagement not found");
  // The requested practice, not the account's default one.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("practice"))
    .toBe(other);
  await expectAccessible(page, "Unknown engagement in a linked practice");

  await page
    .getByRole("button", { name: "Open the Engagements directory" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Engagements", level: 1 }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("practice"))
    .toBe(other);
  // Leaving the engagement clears its banner, so no Retry re-requests it.
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  const before = reads.filter((id) => id === "ENG-DOES-NOT-EXIST").length;
  await page.waitForLoadState("networkidle");
  expect(reads.filter((id) => id === "ENG-DOES-NOT-EXIST").length).toBe(before);
});

test("an access decision opens as an access decision with the member's name", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-5 access decision",
  );
  const member = persona("qa-reviewer");
  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Assurance workbench"));
  await page.getByRole("tab", { name: "Team & runtime" }).click();
  await page.getByRole("button", { name: "Manage access" }).click();
  const form = page
    .getByRole("dialog")
    .filter({ hasText: "Manage engagement access" });
  await form.getByLabel("Internal practice member").selectOption({
    label: member.name + " · Reviewer",
  });
  await form
    .getByLabel("Engagement access")
    .selectOption({ label: "Grant access" });
  await form
    .getByRole("textbox", { name: "Reason" })
    .fill("Second reviewer for the persona suite");
  await form.getByRole("button", { name: "Save access decision" }).click();
  const sheet = page.getByRole("dialog", { name: "Access decision" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(
    "Engagement access granted or revoked, and why",
  );
  await expect(sheet.locator(".badge").first()).toHaveText("Access decision");
  await expect(sheet).not.toContainText("Diagnostic record");
  await expect(sheet).not.toContainText("Saved assessment and source history");
  await expect(sheet.getByText("Team member")).toBeVisible();
  await expect(sheet.getByText(member.name)).toBeVisible();
  await expect(sheet).not.toContainText(member.userId);
  await expectAccessible(page, "Access decision record sheet");
});

/** A CSV of saved predictions with `rows` rows. */
function predictions(rows: number) {
  const lines = ["actual,predicted,group"];
  for (let i = 0; i < rows; i++)
    lines.push(`${i % 2},${(i >> 1) % 2},${i % 3 ? "a" : "b"}`);
  return lines.join("\n") + "\n";
}

test("the evaluation wizard keeps the over-limit reason and names the dataset roles", async ({
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
    "E2E round-5 evaluation wizard",
  );
  await joinTeam(lead, e, ["qa-auditor"]);
  const { artifactId } = await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    `large-predictions-${unique()}.csv`,
    predictions(10_001),
    "Dataset",
  );
  await run(auditor, e, "acceptEvidence", { artifactId, ...attest });
  await run(auditor, e, "createModel", {
    name: "Credit scorer",
    version: "4.0",
    task: "Binary classification",
    format: "Prediction file",
    intendedPurpose: "Creditworthiness assessment of consumer loan applicants",
    artifactId,
  });

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(e, "Testing lab"));
  await page.getByRole("tab", { name: "Model registry" }).click();
  await page.getByRole("button", { name: "Evaluate", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Configure evaluation" });
  await expect(wizard).toBeVisible();
  const alert = wizard.getByRole("alert");
  await expect(alert).toContainText("10,000 rows");
  const reason = (await alert.textContent())!.trim();
  await wizard.getByRole("button", { name: "Continue" }).click();
  // The Data step keeps the server's reason, not only "unavailable".
  await expect(
    wizard.getByText("Dataset inspection is unavailable: " + reason),
  ).toBeVisible();
  await expect(
    wizard.getByLabel("Declared dataset role").locator("option"),
  ).toHaveText(["Choose…", "Test", "Validation", "Training", "Unknown"]);
  await expectAccessible(page, "Over-limit dataset in the Data step");
});

test("a registered dataset card exports in the canonical schema", async ({
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
    "E2E round-5 dataset card",
  );
  await joinTeam(lead, e, ["qa-auditor"]);
  const { artifactId } = await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    `holdout-${unique()}.csv`,
    predictions(40),
    "Dataset",
  );
  await run(auditor, e, "acceptEvidence", { artifactId, ...attest });
  await assurance(auditor, e, "registerDataset", {
    schemaVersion: "1.0",
    name: "Applicant holdout",
    version: "2026-Q3",
    artifactId,
    owner: "Credit risk analytics",
    split: "test",
    population: "Consumer credit applications, Q3 2026",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    collectionMethod: "Exported from the decision log",
    independence: "Held out from training and tuning",
    sensitiveDataBasis: "",
    limitations: "Online channel only",
  });

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(e, "Testing lab"));
  await page.getByRole("tab", { name: "Datasets" }).click();
  const card = page.locator(".dataset-card", { hasText: "Applicant holdout" });
  await expect(card.locator(".badge")).toHaveText("Test");
  await expectAccessible(page, "Dataset registry with an export control");
  const downloaded = page.waitForEvent("download");
  await card.getByRole("button", { name: /^Export dataset card/ }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(
    "dataset-card-applicant-holdout-2026-q3.json",
  );
  const exported = JSON.parse(
    readFileSync(await download.path(), "utf8"),
  ) as Record<string, unknown>;
  expect(exported).toMatchObject({
    name: "Applicant holdout",
    version: "2026-Q3",
    artifactId,
    split: "test",
  });
  // Valid against schemas/dataset-card.schema.json.
  const require = createRequire(import.meta.url);
  const Ajv2020 = require("ajv/dist/2020").default;
  const addFormats = require("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(
      readFileSync(
        new URL("../../schemas/dataset-card.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  expect(validate(exported), JSON.stringify(validate.errors)).toBe(true);
});
