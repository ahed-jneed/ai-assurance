// Round-3 UI fixes (#221) with real clicks and keys. The D-28 acceptance
// gate: while a team member's disqualifying relationship stands, the Lead's
// Approve acceptance is disabled with the server's reason, which names the
// person, the Revise acceptance team checklist marks them and the server's
// refusals name them too. The R1-19 banner: once a final package is
// captured, Reports & sign-off describes that package and its next step,
// not the capture gates of the terms selected for a new capture.
import { expectAccessible } from "./a11y";
import {
  approvedProgram,
  approvedScope,
  attempt,
  BRIEF,
  engagementInSignOff,
  FINAL_REPORT,
  joinTeam,
  newEngagement,
  run,
} from "./engagement";
import { expect, persona, test, workspacePath, type Api } from "./fixtures";

const competence = {
  assurance: "proficient",
  ai_systems: "foundation",
  statistics: "proficient",
  regulation: "foundation",
  management_systems: "none",
  data_protection: "foundation",
  security: "none",
  domain: "none",
};
const declaration = (exclusions: string[] = []) => ({
  priorWork: "",
  threats: [],
  exclusions,
  competence,
  expertField: "",
  confirmed: true,
});

test("acceptance approval names a team member with a disqualifying relationship", async ({
  signIn,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await newEngagement(
    lead,
    demo.tenantId,
    demo.clientId,
    "E2E acceptance gate",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);
  await approvedScope(lead, reviewer, e);
  await approvedProgram(auditor, reviewer, e);
  const met = (basis: string) => ({ met: true, basis });
  const acceptance = (team: Api[]) => ({
    decision: "acceptance",
    preconditions: {
      subjectMatter: met("The credit scoring model is identifiable"),
      criteria: met("Persona suite methodology criteria"),
      evidence: met("Synthetic evidence access agreed"),
      purpose: met("Readiness decision of the board risk committee"),
    },
    scope: "Readiness assessment of the credit scoring model",
    periodStart: BRIEF.periodStart,
    periodEnd: BRIEF.periodEnd,
    systemBoundary: BRIEF.boundary,
    accessLevel: "grey",
    engagementLetter: "EL-E2E-221",
    team: team.map((t) => t.who.userId),
    competenceConclusion: "The team covers assurance and statistics",
    changeReason: "",
  });
  await run(lead, e, "saveAcceptance", acceptance([lead, auditor, reviewer]));
  await run(lead, e, "saveDeclaration", declaration());
  await run(auditor, e, "saveDeclaration", declaration());
  await run(reviewer, e, "saveDeclaration", declaration(["employment"]));

  const name = persona("qa-reviewer").name;
  const reason = `${name} declared a disqualifying relationship with the engagement; remove them from the team before accepting it`;
  // The server's refusals name the person.
  expect(
    await attempt(lead, e, "approveAcceptance", {
      revision: 1,
      reason: "Too early",
    }),
  ).toEqual({ status: 409, error: reason });
  expect(
    await attempt(
      lead,
      e,
      "saveAcceptance",
      acceptance([lead, auditor, reviewer]),
    ),
  ).toEqual({
    status: 400,
    error: `${name} declared a disqualifying relationship with the engagement and cannot be assigned`,
  });

  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Audit program") + "&section=acceptance");
  const approve = page.getByRole("button", { name: "Approve acceptance" });
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAccessibleDescription(reason);
  await expect(page.getByText(reason)).toBeVisible();
  await expectAccessible(page, "Acceptance with a disqualified team member");

  await page.getByRole("button", { name: "Revise acceptance" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Revise acceptance and continuance",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", {
      name: `${name} · Reviewer · Cannot be assigned: declared a disqualifying relationship`,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", {
      name: `${persona("qa-auditor").name} · Auditor`,
      exact: true,
    }),
  ).toBeVisible();
  await expectAccessible(page, "Revise acceptance with a marked team member");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the banner describes a captured final package awaiting approval", async ({
  signIn,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const e = await engagementInSignOff(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E captured banner",
  );
  // An open High finding: the default terms of a new capture are blocked.
  await run(auditor, e, "createFinding", {
    title: "Risk register lacks treatment owners",
    article: "9",
    condition: "Two of twelve risks name no treatment owner",
    criteria: "Every risk names an owner and a treatment",
    cause: "",
    effect: "Untreated risks may go unnoticed",
    likelihood: 5,
    impact: 5,
    owner: "Provider risk office",
    dueDate: "2026-12-31",
    visibility: "internal",
  });
  await run(lead, e, "createReport", {
    ...FINAL_REPORT,
    conclusion: "readiness_gaps",
    basisForModification: "An open High finding on treatment owners.",
  });

  const page = await signIn("qa-lead");
  await page.goto(workspacePath(e, "Reports & sign-off"));
  const handoff = page.getByRole("region", { name: "Report handoff" });
  await expect(
    handoff.getByRole("heading", {
      name: "Captured (Readiness assessment, gaps identified), awaiting approval",
    }),
  ).toBeVisible();
  await expect(handoff).not.toContainText("Final capture blocked");
  await expect(handoff).toContainText(
    "A Reviewer or Lead Auditor other than you approves both package versions before client release.",
  );
  await expectAccessible(page, "Captured final package awaiting approval");

  // The Reviewer's next step is the approval, which the banner opens.
  const review = await signIn("qa-reviewer");
  await review.goto(workspacePath(e, "Reports & sign-off"));
  const reviewerHandoff = review.getByRole("region", {
    name: "Report handoff",
  });
  await expect(reviewerHandoff).toContainText(
    "Review both package versions and approve them for client release.",
  );
  await reviewerHandoff
    .getByRole("button", { name: "Review approval" })
    .click();
  await expect(
    review.getByRole("button", { name: "Approve package" }),
  ).toBeEnabled();
});
