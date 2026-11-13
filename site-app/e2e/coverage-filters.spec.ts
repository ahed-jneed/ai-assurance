// Coverage heatmap filters (#135, docs/design/criteria-model.md section 15.2):
// an Auditor filters the heatmap by actor and applicability date, the filters
// persist in their workspace preferences across a reload, the drawer marks
// rule-pack dates as derived and not reviewed, and the CSV export follows the
// filters. A Client Viewer's export is refused.
import { expectAccessible } from "./a11y";
import { expect, test, workspacePath } from "./fixtures";

const KEY = "eu-ai-act@02024R1689-20260727";

test("the Auditor filters coverage and exports it; a client cannot export", async ({
  signIn,
  api,
  demo,
}) => {
  const page = await signIn("qa-auditor");
  await page.goto(workspacePath(demo, "Regulatory mapping"));
  const heatmap = page.locator("section.criteria-coverage");
  await expect(
    heatmap.getByRole("heading", { name: "Criteria coverage" }),
  ).toBeVisible();
  const state = heatmap.getByLabel("State", { exact: true });
  const actor = heatmap.getByLabel("Actor", { exact: true });
  const date = heatmap.getByLabel("Applicability date");
  const status = heatmap.locator(".coverage-filter-status");
  const saved = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/workspace-state") &&
        r.request().method() === "POST" &&
        r.status() === 200,
    );

  // Start from no filter (a reused server keeps earlier runs' preferences).
  for (const [select, value] of [
    [state, "all"],
    [actor, "all"],
    [date, "all"],
  ] as const)
    if ((await select.inputValue()) !== value) {
      const done = saved();
      await select.selectOption(value);
      await done;
    }
  await expect(status).toContainText(/Showing all \d+ requirements/);

  let done = saved();
  await actor.selectOption("Provider");
  await done;
  done = saved();
  await date.selectOption("2026-08-02");
  await done;
  await expect(status).toContainText(/Showing \d+ of \d+ requirements/);
  await expect(status).toContainText("not reviewed");
  // A tile's name is its reference, then its state ("Art. 9(1), mapped at a
  // higher level only").
  const tile = (ref: string) =>
    heatmap.getByRole("button", {
      name: new RegExp("^" + ref.replace(/[.()]/g, "\\$&") + "\\W"),
    });
  await expect(tile("Art. 50(1)")).toBeVisible();
  // Deployer-only and undated requirements are filtered out.
  await expect(tile("Art. 50(3)")).toHaveCount(0);
  await expect(tile("Art. 9(1)")).toHaveCount(0);
  await expectAccessible(page, "Coverage heatmap, filtered");

  // The filters are the user's: they survive a reload.
  await page.reload();
  await expect(actor).toHaveValue("Provider");
  await expect(date).toHaveValue("2026-08-02");

  // The drawer says where the date comes from.
  await tile("Art. 50(2)").click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByRole("heading", {
      name: "Applicability dates (derived, not reviewed)",
    }),
  ).toBeVisible();
  await expect(drawer).toContainText(
    "aia-2026-12-02-art50-2-legacy-transition",
  );
  await expectAccessible(page, "Coverage drawer with derived dates");
  await page.keyboard.press("Escape");

  // The export follows the filters.
  const exportLink = heatmap.getByRole("link", { name: "Export filtered CSV" });
  const href = await exportLink.getAttribute("href");
  expect(href).toContain("format=csv");
  expect(href).toContain("actor=Provider");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toMatch(/^text\/csv/);
  const lines = (await csv.text()).trimEnd().split("\r\n");
  expect(lines[0]).toMatch(/^view,framework_data_version,pack/);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines.slice(1)) {
    expect(line).toContain("Provider");
    expect(line).toContain("2026-08-02");
  }

  // Clean up: back to no filter for the next run.
  done = saved();
  await actor.selectOption("all");
  await done;
  done = saved();
  await date.selectOption("all");
  await done;

  // Coverage, and so its export, is internal (Q7): a client gets 403.
  const viewer = await api("qa-viewer");
  const refused = await viewer.http.get(
    "/api/coverage?" +
      new URLSearchParams({
        tenantId: demo.tenantId,
        engagementId: demo.engagementId,
        framework: KEY,
        format: "csv",
      }),
  );
  expect(refused.status()).toBe(403);
});
