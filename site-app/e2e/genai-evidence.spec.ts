// GenAI evidence (#33): an auditor uploads the engine's example envelope with
// the tool log and label file it pins, imports it on the Testing lab's GenAI
// evidence tab and sees its evidence level, criteria and readiness; the gate
// then refuses a supported conclusion on a paper that links it, because an
// uploaded envelope counts as L1 until a worker recomputation authenticates
// it. The worker path (L2, a validated judge passing the gate) is covered by
// lib/commands/assurance/genai.test.ts, since the suite runs no worker.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expectAccessible } from "./a11y";
import { expect, test, unique, workspacePath } from "./fixtures";

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
