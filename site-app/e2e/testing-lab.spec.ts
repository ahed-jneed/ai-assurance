// Testing lab: the Auditor registers a saved-predictions model version from
// an accepted dataset, then starts a queued evaluation against a saved
// protocol and reads its results. The Worker evaluates the predictions
// itself, so no Python runner is involved. It runs on an engagement of its
// own, so the demo engagement gets no models or runs.
import { readFileSync } from "node:fs";
import { expectAccessible } from "./a11y";
import { engagementOf, joinTeam, newEngagement, run } from "./engagement";
import {
  attest,
  expect,
  runCommand,
  test,
  unique,
  workspacePath,
} from "./fixtures";

const predictions = readFileSync(
  new URL("../../engine/examples/predictions.csv", import.meta.url),
);

// A protocol over the example predictions: performance and three fairness
// procedures over synthetic groups, which hold no special-category data.
const protocol = {
  name: "Credit scoring performance and fairness",
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
  rationale: "Persona suite thresholds; they check arithmetic, not conformity",
  specialCategory: { specialCategory: false },
};

test("the Auditor registers a model and evaluates it in the testing lab", async ({
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
    "E2E testing lab",
  );
  await joinTeam(lead, e, ["qa-auditor"]);
  const dataset = `predictions-${unique()}.csv`;
  const { artifactId } = await auditor.uploadEvidence(
    e.tenantId,
    e.engagementId,
    dataset,
    predictions,
    "Dataset",
  );
  await run(auditor, e, "acceptEvidence", { artifactId, ...attest });

  // The Auditor registers the saved predictions as a model version.
  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(e, "Testing lab"));
  await page.getByRole("tab", { name: "Model registry" }).click();
  await page.getByRole("button", { name: "Register version" }).click();
  const form = page.getByRole("dialog", { name: "Register model version" });
  await form.getByLabel("Model name").fill("Credit scorer");
  await form.getByLabel("Version", { exact: true }).fill("3.2");
  await form.getByLabel("Artifact format").selectOption("Prediction file");
  await form
    .getByLabel("Evaluation task")
    .selectOption("Binary classification");
  await form.getByLabel("Accepted prediction dataset").selectOption(artifactId);
  await form.getByLabel("Provider / model owner").fill("Acme model risk");
  await form.getByLabel("Algorithm / framework").fill("Logistic regression");
  await form
    .getByLabel("Intended use")
    .fill("Creditworthiness assessment of consumer loan applicants");
  await form
    .getByLabel("Output meaning")
    .fill("1 approves the application; 0 declines it");
  await expectAccessible(page, "Model registration form");
  const registered = await runCommand(page, "createModel", () =>
    form.getByRole("button", { name: "Register version" }).click(),
  );
  await expect(form).toBeHidden();
  const { modelId } = (await registered.json()).details;
  await expect(
    page.getByRole("tab", { name: "Model registry", selected: true }),
  ).toBeVisible();
  await expectAccessible(page, "Model registry");

  // A saved protocol and a queued run, as the evaluation wizard creates them.
  const { profileId } = await run(
    auditor,
    e,
    "createEvaluationProfile",
    protocol,
  );
  const { runId } = await run(auditor, e, "queueRun", {
    modelId,
    datasetId: artifactId,
    profileId,
  });

  // The Auditor starts the queued evaluation and opens its results.
  await page.reload();
  await page.getByRole("tab", { name: "Evaluations" }).click();
  const start = page.getByRole("button", { name: "Start", exact: true });
  await expect(start).toBeVisible();
  await expectAccessible(page, "Queued evaluation");
  await runCommand(page, "executeRun", () => start.click());
  await page.getByRole("button", { name: "Results", exact: true }).click();
  const results = page.getByRole("dialog", { name: "Evaluation results" });
  await expect(results).toBeVisible();
  await expect(results.getByText("succeeded").first()).toBeVisible();
  await expectAccessible(page, "Evaluation results");

  const evaluated = (await engagementOf(auditor, e)).runs.find(
    (r: { id: string }) => r.id === runId,
  );
  expect(evaluated.state).toBe("succeeded");
  expect(evaluated.results).toHaveLength(4);
  // Each result article gets a draft diagnostic paper for the Auditor.
  expect(evaluated.paperIds.length).toBeGreaterThan(0);
});
