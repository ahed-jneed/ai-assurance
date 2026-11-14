// Queue planned evaluation opens the queued run (#226 item 3, F-33): in the
// Audit program, an automated procedure's Execute section queues the
// approved model, dataset and protocol, and the workspace then shows that
// run in the Testing lab rather than staying on the program. It runs on an
// engagement of its own, so the demo engagement gets no models or runs.
import { readFileSync } from "node:fs";
import {
  approvedScope,
  engagementOf,
  joinTeam,
  newEngagement,
  run,
} from "./engagement";
import {
  attest,
  expect,
  persona,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

const predictions = readFileSync(
  new URL("../../engine/examples/predictions.csv", import.meta.url),
);
const PROCEDURE = "WP-A15-01";

test("Queue planned evaluation opens the queued run in the Testing lab", async ({
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
    "E2E queued evaluation",
  );
  await joinTeam(lead, e, ["qa-auditor", "qa-reviewer"]);

  // An accepted prediction file, its model version and a saved protocol.
  const { artifactId } = await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    `predictions-${unique()}.csv`,
    predictions,
    "Dataset",
  );
  await run(auditor, e, "acceptEvidence", { artifactId, ...attest });
  const { modelId } = await run(auditor, e, "createModel", {
    name: "Credit scorer",
    version: "3.2",
    task: "Binary classification",
    format: "Prediction file",
    intendedPurpose: "Creditworthiness assessment of consumer loan applicants",
    artifactId,
  });
  const { profileId } = await run(auditor, e, "createEvaluationProfile", {
    name: "Credit scoring performance",
    version: "1.0",
    task: "Binary classification",
    suite: [
      "performance",
      "demographic_parity",
      "disparate_impact",
      "equalized_odds",
    ],
    config: {
      labelColumn: "actual",
      predictionColumn: "predicted",
      groupColumn: "group",
      positiveLabel: "1",
      minimumGroupSize: 5,
      maximumParityGap: 0.2,
      minimumImpactRatio: 0.7,
      minimumAccuracy: 0.8,
    },
    datasetContext: {
      split: "test",
      population: "Synthetic applicants of the example file",
      predictionProvenance: "Saved predictions of the scoring service",
      independence: "Synthetic example; no holdout independence claim",
      sensitiveDataBasis: "Synthetic groups; no personal data",
    },
    rationale: "Persona suite thresholds; they check arithmetic only",
    specialCategory: { specialCategory: false },
  });

  // An approved scope and a program whose one procedure is automated and
  // pins that model, dataset and protocol.
  await approvedScope(lead, reviewer, e);
  const w = (await engagementOf(auditor, e)).workflow;
  await run(auditor, e, "scopeProgramCandidates", {
    procedureIds: w.procedures.map((p: { id: string }) => p.id),
    selected: false,
    applicability: "not_applicable",
    rationale:
      "Persona suite: outside this engagement's agreed scope; no legal exclusion claim",
    periodAnalysis: "Assessed for the audit period of the brief",
  });
  const p = (await engagementOf(auditor, e)).workflow.procedures.find(
    (q: { templateId: string }) => q.templateId === PROCEDURE,
  );
  await run(auditor, e, "saveProcedurePlan", {
    procedureId: p.id,
    assignmentRevision: p.assignmentRevision ?? 1,
    plan: {
      selected: true,
      applicability: "readiness",
      rationale: "Selected for the persona suite's automated evaluation",
      criterion: p.criterion || "Accuracy is declared and measured",
      sourceVersion: p.sourceVersion,
      periodAnalysis: "Applies throughout the audit period",
      population: "The saved predictions of the example file",
      sampling: "Every row of the accepted prediction file",
      ownerId: auditor.who.userId,
      reviewerId: persona("qa-reviewer").userId,
      dueDate: "2026-12-31",
      method: "automated",
      modelId,
      datasetId: artifactId,
      profileId,
    },
  });
  await run(auditor, e, "submitProgram");
  const program = (await engagementOf(auditor, e)).workflow.program;
  await run(reviewer, e, "approveProgram", {
    revision: program.revision,
    reason: "Selection, criteria, sample and assignments reviewed",
  });

  // The Auditor opens the procedure's Execute section and queues the run.
  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(e, "Audit program"));
  await page.getByRole("button", { name: new RegExp("^" + PROCEDURE) }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Execute" }).click();
  const queue = sheet.getByRole("button", { name: "Queue planned evaluation" });
  await expect(queue).toBeEnabled();
  const queued = await runCommand(page, "queueRun", () => queue.click());
  const { runId } = (await queued.json()).details as { runId: string };

  // The workspace opens the queued run in the Testing lab, not a new setup
  // that would queue a duplicate.
  await expect(page).toHaveURL(/view=Testing\+lab/);
  await expect(
    page.getByRole("heading", { name: "Testing lab", level: 1 }),
  ).toBeVisible();
  const opened = page.getByRole("dialog", { name: "Evaluation results" });
  await expect(opened).toBeVisible();
  await expect(opened.getByText("Queued", { exact: true })).toBeVisible();
  await expect(
    opened.getByRole("button", { name: "Start evaluation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue planned evaluation" }),
  ).toHaveCount(0);
  const runs = (await engagementOf(auditor, e)).runs as {
    id: string;
    state: string;
  }[];
  expect(runs.map((r) => [r.id, r.state])).toEqual([[runId, "queued"]]);
});
