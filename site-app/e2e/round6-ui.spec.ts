// Round-6 fixes with real clicks and keys.
// #240: a client who opens a link to another client's engagement is told it
// is not available to them and is led back to their own engagement.
// #241: the retest form's required evidence, the close-finding refusal after
// an effective retest, focus after Undo on the snooze toast, focus after a
// dialog opened by mouse from a "More actions" menu, Review closure on an
// unassessed follow-up case and "Recorded by" with the member's name.
import { expectAccessible } from "./a11y";
import {
  assurance,
  attempt,
  engagementInFieldwork,
  engagementOf,
  joinTeam,
  newEngagement,
  run,
  type Engagement,
} from "./engagement";
import {
  type Api,
  attest,
  DEMO,
  engagementWork,
  expect,
  persona,
  recordPath,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

/** A finding raised by the Auditor and remediated by the Lead, ready for retest. */
async function findingReadyForRetest(lead: Api, auditor: Api, e: Engagement) {
  const { artifactId } = await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    `retest-${unique()}.txt`,
    "Re-run of the representativeness test after remediation (synthetic).",
  );
  await run(auditor, e, "acceptEvidence", { artifactId, ...attest });
  const { findingId } = await run(auditor, e, "createFinding", {
    title: `Sampling frame gap ${unique()}`,
    article: "Art. 10",
    condition: "Online applicants were missing from the sampling frame",
    criteria: "Data governance requires representative training data",
    cause: "Channel export omitted",
    effect: "Bias metrics may be unreliable",
    likelihood: 3,
    impact: 3,
    owner: "Acme model risk office",
    dueDate: "2026-12-31",
    visibility: "internal",
  });
  await run(lead, e, "updateFinding", {
    findingId,
    status: "ready_for_retest",
    response: "Agreed",
    remediation: "The export now includes every channel",
    retestEvidenceIds: [artifactId],
  });
  return { findingId: findingId as string, artifactId };
}

test("the retest form requires its evidence, and the remediator's close names the rule that applies", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await engagementInFieldwork(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E round-6 retest",
  );
  const { findingId, artifactId } = await findingReadyForRetest(
    lead,
    auditor,
    e,
  );
  const retest = {
    findingId,
    performed: "Re-ran the representativeness test",
    results: "Every channel within tolerance",
    rationale: "The remediated frame covers every channel",
    conclusion: "effective",
  };
  // The server refuses a retest without evidence in the form's words.
  expect(
    await attempt(reviewer, e, "recordFindingRetest", {
      ...retest,
      evidenceIds: [],
    }),
  ).toEqual({ status: 400, error: "Select the evidence the retest relied on" });

  const page = await signIn("qa-reviewer");
  await page.goto(recordPath(e, "Findings", "finding", findingId));
  await page.getByRole("button", { name: "Record independent retest" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record independent remediation retest",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("group", {
      name: "Accepted supporting evidence (required)",
    }),
  ).toBeVisible();
  await dialog
    .getByLabel("Retest procedures actually performed")
    .fill(retest.performed);
  await dialog.getByLabel("Observed results").fill(retest.results);
  await dialog
    .getByLabel("Evidence assessment and conclusion rationale")
    .fill(retest.rationale);
  await dialog
    .getByLabel("Remediation effectiveness")
    .selectOption({ label: "Effective" });
  // The remediation's evidence comes ticked; unticked, the form refuses
  // without a request.
  const evidence = dialog.getByRole("checkbox").first();
  await expect(evidence).toBeChecked();
  await evidence.click();
  await expect(evidence).not.toBeChecked();
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/workspace"))
      sent.push(r.url());
  });
  await dialog.getByRole("button", { name: "Save retest assessment" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Select the evidence the retest relied on",
  );
  await expect(dialog).not.toContainText("Array must contain");
  // Focus moves from the Save button to the evidence to tick.
  await expect(evidence).toBeFocused();
  expect(sent).toEqual([]);
  await expectAccessible(page, "Retest form without evidence");
  // Ticked, it saves.
  await page.keyboard.press("Space");
  await runCommand(page, "recordFindingRetest", () =>
    dialog.getByRole("button", { name: "Save retest assessment" }).click(),
  );
  await expect(dialog).toBeHidden();
  const saved = (await engagementOf(reviewer, e)).findings.find(
    (f: { id: string }) => f.id === findingId,
  );
  expect(saved.retest.evidenceIds).toEqual([artifactId]);

  // The Lead remediated the finding: Close is refused for that reason.
  const rule = "The finding's creator or remediator cannot close it";
  expect(
    await attempt(lead, e, "closeFinding", { findingId, ...attest }),
  ).toEqual({
    status: 403,
    error: rule,
  });
  const leadPage = await signIn("qa-lead");
  await leadPage.goto(recordPath(e, "Findings", "finding", findingId));
  const close = leadPage.getByRole("button", {
    name: "Close verified finding",
  });
  await expect(close).toBeDisabled();
  await expect(close).toHaveAccessibleDescription(rule);
  await expect(
    leadPage.getByText("Independent retest confirmation"),
  ).toHaveCount(0);
  await expectAccessible(leadPage, "Remediator's refused closure");
});

test("Undo on the snooze toast returns focus to the restored row", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-6 undo",
  );
  const page = await signIn("qa-lead");
  const rows = await engagementWork(page, e);
  const id = await rows.nth(1).getAttribute("data-work-id");
  await rows
    .nth(1)
    .getByRole("button", { name: /^Snooze/ })
    .click();
  const row = page.locator(`[data-work-id="${id}"]`);
  await expect(row).toHaveCount(0);
  const toast = page
    .getByRole("region", { name: /Notifications/ })
    .locator("li")
    .filter({ hasText: "Reminder snoozed until tomorrow at 08:00" });
  await toast.first().getByRole("button", { name: "Undo" }).click();
  await expect(row).toHaveCount(1);
  await expect(row.locator(".business-task-open")).toBeFocused();
  // From the keyboard as well.
  await row.getByRole("button", { name: /^Snooze/ }).focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveCount(0);
  await toast.first().getByRole("button", { name: "Undo" }).focus();
  await page.keyboard.press("Enter");
  await expect(row.locator(".business-task-open")).toBeFocused();
  await expectAccessible(page, "My work after Undo");
});

test("a dialog opened by mouse from More actions returns focus to the menu's trigger", async ({
  signIn,
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor");
  const paperId = (await engagementOf(auditor, demo)).papers[0].id;
  const { requestId } = await run(auditor, demo, "createEvidenceRequest", {
    subject: `Data lineage extract ${unique()}`,
    description: "Lineage of the training data for the audit period.",
    responsibleParty: "Acme data office",
    periodVersion: "2026",
    handling: "Synthetic extracts only.",
    dueDate: "2026-12-31",
    paperIds: [paperId],
  });
  const page = await signIn("qa-auditor");
  await page.goto(recordPath(demo, "Evidence vault", "request", requestId));
  const more = page.getByRole("button", {
    name: "More actions for this request",
  });
  for (const close of ["Escape", "Cancel"]) {
    await more.click();
    await page.getByRole("menuitem", { name: "Edit request" }).click();
    const form = page.getByRole("dialog", { name: "Edit evidence request" });
    await expect(form).toBeVisible();
    if (close === "Escape") await page.keyboard.press("Escape");
    else await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toBeHidden();
    await expect(more).toBeFocused();
  }
  await expectAccessible(page, "Request sheet after the menu dialog");
});

test("an unassessed follow-up case shows Review closure disabled with the server's reason", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-6 follow-up closure",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);
  const title = `Drift check ${unique()}`;
  const { caseId } = await run(auditor, e, "createMonitoringCase", {
    kind: "monitoring",
    title,
    description: "Quarterly drift monitoring of the scoring model",
    ownerId: auditor.who.userId,
    dueDate: "2026-12-31",
    cadence: "one_off",
    findingId: "",
    reportId: "",
  });
  const reason = "Assess the case before independent closure";
  const refused = await attempt(reviewer, e, "closeMonitoringCase", {
    caseId,
    closure: "Closed",
  });
  expect(refused.error).toBe(reason);

  const page = await signIn("qa-reviewer");
  await page.goto(workspacePath(e, "Audit program"));
  await page.getByRole("tab", { name: "Follow-up", exact: true }).click();
  await page.getByText(title).click();
  const closure = page.getByRole("button", { name: "Review closure" });
  await expect(closure).toBeDisabled();
  await expect(closure).toHaveAccessibleDescription(reason);
  await expectAccessible(page, "Unassessed follow-up case for a reviewer");
});

test("Recorded by names the member, not their email", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const who = persona("qa-auditor");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E round-6 recorded by",
  );
  // A membership that names the member only by email, as one created by a
  // sign-in without a full name or an invitation without a display name.
  const member = (displayName: string) =>
    lead.manage(e.tenantId, "updateMember", {
      userId: who.userId,
      displayName,
      role: who.role,
      clientId: null,
      engagementIds: [e.engagementId],
    });
  await member(who.email);
  try {
    // The Auditor's next request carries their name from the identity
    // provider: it registers a system revision.
    const { artifactId } = await auditor.uploadEvidence(
      e.tenantId,
      e.engagementId,
      `predictions-${unique()}.csv`,
      "actual,predicted,group\n0,1,a\n1,1,b\n",
      "Dataset",
    );
    await run(auditor, e, "acceptEvidence", { artifactId, ...attest });
    const { modelId } = await run(auditor, e, "createModel", {
      name: "Credit scorer",
      version: "6.0",
      task: "Binary classification",
      format: "Prediction file",
      intendedPurpose:
        "Creditworthiness assessment of consumer loan applicants",
      artifactId,
    });
    const system = await assurance(auditor, e, "registerSystem", {
      name: "Credit scoring service",
      version: "1",
      intendedUse: "Creditworthiness assessment of consumer loan applicants",
      population: "Synthetic applicants only",
      modelIds: [modelId],
      features: [
        {
          name: "feature_age",
          type: "number",
          unit: "years",
          nullable: false,
          nullHandling: "reject",
          categories: [],
        },
      ],
      outputs: {
        semantics: "1 approves the application; 0 declines it",
        classOrder: ["0", "1"],
        threshold: 0.5,
      },
      humanDecision: "A credit officer reviews each decline",
      runtime: "Saved predictions",
      limitations: "Round-6 system revision",
    });
    const page = await signIn("qa-lead");
    await page.goto(
      workspacePath(e, "Assurance workbench") +
        "&" +
        new URLSearchParams({ section: "systems", assurance: system.id }),
    );
    const sheet = page.getByRole("dialog", { name: "Credit scoring service" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".workbench-record-meta dd").first()).toHaveText(
      who.name,
    );
    await expect(sheet).not.toContainText(who.email);
    await expectAccessible(page, "System record sheet with Recorded by");
  } finally {
    await member(who.name);
  }
});

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
