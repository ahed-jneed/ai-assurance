// The assurance workbench without a full record load (#121): the workbench
// reads its view, the few kinds its forms offer and server searches, never
// every record page. The Lead Auditor records an assertion whose precise
// source is found by a server search in the source picker, and the record
// opens by id with its review state; the Reviewer's review shows on reopening.
import { expect, test, unique, workspacePath } from "./fixtures";

test("the Lead Auditor records an assertion from a searched source without loading every record", async ({
  signIn,
  api,
  demo,
}) => {
  const { tenantId, engagementId } = demo;
  const lead = await api("qa-lead");
  const marker = unique();
  const { artifactId } = await lead.uploadEvidence(
    tenantId,
    engagementId,
    `workbench-source-${marker}.txt`,
    "Approval rule: score > 600",
  );
  await lead.command(tenantId, engagementId, "acceptEvidence", { artifactId });
  const assurance = async (
    who: typeof lead,
    op: string,
    data: Record<string, unknown>,
  ) => {
    const response = await who.post("/api/assurance", {
      tenantId,
      engagementId,
      op,
      data,
    });
    expect(response.status(), `${op}: ${await response.text()}`).toBe(200);
    return (await response.json()).record as { id: string };
  };
  const label = `Needle source ${marker}`;
  for (const name of [`Other source ${marker}`, label])
    await assurance(lead, "addLocation", {
      artifactId,
      label: name,
      kind: "document",
      locator: "line 1",
      excerpt: "Approval rule: score > 600",
      quality: "Transcribed from the accepted source",
    });

  const page = await signIn("qa-lead");
  const reads: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/assurance" && request.method() === "GET")
      reads.push(url);
  });
  await page.goto(
    workspacePath(demo, "Assurance workbench") + "&section=evidence",
  );
  await page.getByRole("button", { name: "Record assertion" }).click();
  const form = page.getByRole("dialog", { name: "Record an assertion" });
  const statement = `Scores above 600 are approved (${marker})`;
  await form.getByRole("textbox", { name: "Claimed fact" }).fill(statement);
  await form.locator("select[name=criterion]").selectOption({ index: 1 });
  await form.locator("textarea[name=assessment]").fill("Source reviewed.");
  await form.locator("select[name=conclusion]").selectOption({ index: 1 });
  const picker = form.getByRole("group", { name: "Precise source 1" });
  await picker
    .getByRole("textbox", { name: "Search precise source 1" })
    .fill(label);
  await picker.getByRole("checkbox", { name: label }).check();
  await expect(
    picker.getByRole("list", { name: "Selected records" }),
  ).toContainText(label);
  await form
    .getByRole("textbox", { name: "Relevance and reliability rationale" })
    .fill("The excerpt states the rule.");
  await form.getByRole("button", { name: "Save assertion" }).click();
  await expect(form).toBeHidden();

  // The new assertion opens by id with its review state.
  const details = page.getByRole("dialog", { name: statement });
  await expect(details).toBeVisible();
  await expect(details).toContainText("Awaiting review");
  const opened = new URL(page.url()).searchParams.get("assurance");
  expect(opened).toBeTruthy();

  // Every read named a view, a kind or a search: no page-by-page full load.
  expect(reads.length).toBeGreaterThan(0);
  for (const url of reads) {
    const view = url.searchParams.get("view");
    expect(
      view === null
        ? !url.searchParams.has("cursor") && !url.searchParams.has("kind")
        : view !== "records" || url.searchParams.has("kind"),
      url.search,
    ).toBe(true);
  }

  // The Reviewer confirms it; reopening the deep link shows the new state.
  const reviewer = await api("qa-reviewer");
  await assurance(reviewer, "reviewAssertion", {
    assertionId: opened,
    decision: "approve",
    reason: "Source matches the claim.",
  });
  await page.reload();
  await expect(page.getByRole("dialog", { name: statement })).toContainText(
    "Confirmed",
  );
});
