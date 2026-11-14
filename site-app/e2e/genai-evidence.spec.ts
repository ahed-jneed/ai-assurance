// GenAI evidence (#33): an auditor uploads the engine's example envelope with
// the tool log and label file it pins, imports it on the Testing lab's GenAI
// evidence tab and sees its evidence level, criteria and readiness; the gate
// then refuses a supported conclusion on a paper that links it, because an
// uploaded envelope counts as L1 until a worker recomputation authenticates
// it. The worker path (L2, a validated judge passing the gate) is covered by
// lib/commands/assurance/genai.test.ts, since the suite runs no worker.
// #145: with no genai_ingest worker the tab offers no Queue ingest; the
// auditor records a re-run attestation through its form; and the Evidence
// vault shows the envelope's level and the level of the logs it pins.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expectAccessible } from "./a11y";
import { attest, expect, test, unique, workspacePath } from "./fixtures";

const root = (path: string) =>
  readFileSync(fileURLToPath(new URL("../../" + path, import.meta.url)));

test("an auditor imports a GenAI envelope and the gate holds its conclusion", async ({
  signIn,
  api,
  demo,
}) => {
  const auditor = await api("qa-auditor"),
    run = unique();
  const upload = async (name: string, bytes: Buffer) => {
    const { artifactId } = await auditor.uploadEvidence(
      demo.tenantId,
      demo.engagementId,
      name,
      bytes,
      "GenAI log",
    );
    await auditor.command(demo.tenantId, demo.engagementId, "acceptEvidence", {
      artifactId,
      ...attest,
    });
    return artifactId;
  };
  await upload(
    "judged_qa_30.eval",
    root("engine/tests/fixtures/genai/inspect/judged_qa_30.eval"),
  );
  await upload(
    "judge_large_200.jsonl",
    root("engine/tests/fixtures/genai/judge_validation/judge_large_200.jsonl"),
  );
  const envelopeName = `genai-result-${run}.json`,
    envelopeId = await upload(
      envelopeName,
      root("schemas/fixtures/genai-result.example.json"),
    );

  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(demo, "Testing lab"));
  await page.getByRole("tab", { name: "GenAI evidence" }).click();
  await page.getByRole("button", { name: "Import envelope" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Import a GenAI result envelope",
  });
  await dialog.getByLabel("Envelope").selectOption({ label: envelopeName });
  await dialog.getByRole("button", { name: "Import envelope" }).click();
  await expect(dialog).toBeHidden();

  const card = page.locator("[data-genai-result]").first();
  await expect(card.getByText("L1 · hashed tool log").first()).toBeVisible();
  await expect(
    card.getByText(/Uploaded envelope: auditor-prepared/),
  ).toBeVisible();
  await expect(
    card.locator('[data-genai-blocker="genai_level_below_l2"]'),
  ).toBeVisible();
  await expect(
    card.getByText(/not accuracy on the population/i).first(),
  ).toBeVisible();
  await expectAccessible(page, "GenAI evidence tab");

  // #145: no worker of the demo engagement is enrolled with genai_ingest, so
  // the tab offers no Queue ingest and says why.
  await expect(page.getByRole("button", { name: "Queue ingest" })).toHaveCount(
    0,
  );
  await expect(page.locator("[data-genai-no-ingest-worker]")).toBeVisible();

  // #211: the Lead Auditor enrols a GenAI ingest runner from the Enroll
  // runner dialog, which offers every capability the server accepts; the
  // tab then offers Queue ingest. The runner is revoked again afterwards so
  // the demo engagement keeps no ingest worker.
  const leadPage = await signIn("qa-lead");
  await leadPage.goto(
    workspacePath(demo, "Assurance workbench") + "&section=access",
  );
  await leadPage.getByRole("button", { name: "Enroll runner" }).click();
  const enrol = leadPage.getByRole("dialog", {
    name: "Enroll a scoped runner",
  });
  for (const name of ["GenAI evidence ingest", "Client-local worker"])
    await expect(enrol.getByRole("checkbox", { name })).toBeVisible();
  await expect(enrol).toContainText("lowercase hexadecimal");
  await enrol.getByLabel("Runner name").fill(`GenAI runner ${run}`);
  await enrol
    .getByLabel("Approved container image digest")
    .fill("sha256:" + "e".repeat(64));
  await enrol
    .getByLabel("Isolation, egress, resource limits and adapter validation")
    .fill("Reviewed: no egress, read-only logs, parsers only.");
  await enrol.getByRole("checkbox", { name: "Provided predictions" }).uncheck();
  await enrol.getByRole("checkbox", { name: "GenAI evidence ingest" }).check();
  await enrol.getByRole("button", { name: "Enroll runner" }).click();
  const credential = leadPage.getByRole("dialog", {
    name: "Runner credential",
  });
  await expect(credential).toBeVisible();
  const workerId = (await credential.getByText(/^Worker: /).innerText())
    .replace("Worker: ", "")
    .trim();
  const lead = await api("qa-lead");
  try {
    await page.reload();
    await page.getByRole("tab", { name: "GenAI evidence" }).click();
    await page.getByRole("button", { name: "Queue ingest" }).click();
    const queue = page.getByRole("dialog", {
      name: "Queue the engine's GenAI ingest",
    });
    await expect(queue.getByLabel("Frozen plan")).toBeVisible();
    await expect(queue.getByLabel("Declared bundle")).toBeVisible();
    await queue.getByRole("button", { name: "Cancel" }).click();
    await expect(queue).toBeHidden();
  } finally {
    const revoked = await lead.post("/api/assurance", {
      tenantId: demo.tenantId,
      engagementId: demo.engagementId,
      op: "revokeWorker",
      data: { workerId, reason: "End of the e2e GenAI ingest check" },
    });
    expect(revoked.status(), await revoked.text()).toBe(200);
  }
  await page.reload();
  await page.getByRole("tab", { name: "GenAI evidence" }).click();
  await expect(page.locator("[data-genai-no-ingest-worker]")).toBeVisible();

  // #145: the re-run attestation form pins both inputs of the envelope.
  await page.getByRole("button", { name: "Attest a re-run" }).click();
  const rerun = page.getByRole("dialog", { name: "Attest an auditor re-run" });
  await rerun
    .getByLabel(/^judged_qa_30\.eval/)
    .first()
    .check();
  await rerun
    .getByLabel(/^judge_large_200\.jsonl/)
    .first()
    .check();
  await rerun.getByLabel("Harness name").fill("inspect_ai");
  await rerun.getByLabel("Harness version").fill("0.3.90");
  await rerun
    .getByLabel("System under test: endpoint host")
    .fill("api.example.com");
  await rerun
    .getByLabel("System under test: model snapshot")
    .fill("fixture-2026-10");
  await rerun.getByLabel("Run started (UTC)").fill("2026-11-05T09:00");
  await rerun.getByLabel("Run ended (UTC)").fill("2026-11-05T10:00");
  await rerun.getByLabel("Statement").selectOption({ index: 1 });
  await rerun.getByRole("button", { name: "Record attestation" }).click();
  await expect(rerun).toBeHidden();
  await expect(card.getByText(/re-run attested/)).toBeVisible();
  // An uploaded envelope stays at L1 even when attested.
  await expect(card.getByText("L1 · hashed tool log").first()).toBeVisible();

  // #145: the Evidence vault shows the envelope's level and its inputs'.
  await page.goto(workspacePath(demo, "Evidence vault"));
  const envelopeRow = page.getByRole("row").filter({ hasText: envelopeName });
  await expect(
    envelopeRow.locator('[data-genai-file-role="result"]'),
  ).toHaveText("GenAI L1 · hashed tool log");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "judged_qa_30.eval" })
      .first()
      .locator('[data-genai-file-role="input"]'),
  ).toHaveText("GenAI input · L1");
  await expectAccessible(page, "Evidence vault with GenAI levels");

  // The gate: a supported conclusion on a paper linking the envelope fails.
  const { paperId } = await auditor.command(
    demo.tenantId,
    demo.engagementId,
    "createPaper",
    { templateId: "WP-A10-01" },
  );
  const w = await auditor.workspace(demo.tenantId, demo.engagementId);
  const paper = w.engagement.papers.find(
    (p: { id: string }) => p.id === paperId,
  );
  const response = await auditor.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: w.engagement.version,
    op: "editPaper",
    data: {
      paperId,
      body: { ...paper.body, conclusionStatus: "supported" },
      evidenceIds: [envelopeId],
      required: paper.required,
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("genai_level_below_l2");
});
