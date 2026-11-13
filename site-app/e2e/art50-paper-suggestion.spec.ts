// Art 50 papers (#120): a classified Art 50 engagement gets its papers'
// applicability suggested from the classification, through the research
// procedures, with the statistical criteria and their threshold-library
// entries. The suggestion never applies itself: the Lead Auditor opens the
// plan form from it, filled in, and cancelling it records nothing.
import { expectAccessible } from "./a11y";
import { expect, test, unique, type Api } from "./fixtures";

const practices = ["a", "b", "ba", "bb", "c", "d", "e", "f", "g", "h"];

/** A new engagement of the demo client, so the shared one stays unclassified. */
async function newEngagement(lead: Api, tenantId: string, clientId: string) {
  const w = await lead.workspace(tenantId);
  const response = await lead.post("/api/management", {
    tenantId,
    expectedVersion: w.managementVersion,
    op: "createEngagement",
    data: { clientId, title: `E2E chatbot transparency ${unique()}` },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).details.engagementId as string;
}

const procedurePath = (tenantId: string, engagementId: string, id: string) =>
  "/?" +
  new URLSearchParams({
    practice: tenantId,
    engagement: engagementId,
    view: "Audit program",
    kind: "procedure",
    record: id,
    section: "plan",
  });

test("a classified Art 50 engagement gets its papers suggested", async ({
  signIn,
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const { tenantId } = demo;
  const engagementId = await newEngagement(lead, tenantId, demo.clientId);
  // A provider's customer chatbot: Art 50(1) and (5) are candidates; it
  // generates no synthetic content and the operator deploys nothing.
  await lead.command(tenantId, engagementId, "classify", {
    annexRoute: "Article 50 only",
    operatorRole: "Provider",
    intendedPurpose: "Customer service chatbot",
    rationale: "Interacts directly with natural persons.",
    facts: {
      ...Object.fromEntries(practices.map((p) => ["art5_1_" + p, "no"])),
      gpaiModelProvider: "no",
      gpaiDownstreamProvider: "no",
      smeStatus: "neither",
      interactsDirectlyWithNaturalPersons: "yes",
      scientificResearchOnly: "no",
      authorisedByLawForCriminalOffences: "no",
      generatesSyntheticText: "no",
      generatesSyntheticImage: "no",
      generatesSyntheticAudio: "no",
      generatesSyntheticVideo: "no",
    },
  });
  const procedure = (id: string) =>
    lead
      .workspace(tenantId, engagementId)
      .then((w) =>
        w.engagement.workflow.procedures.find(
          (p: { id: string }) => p.id === id,
        ),
      );
  expect((await procedure("PROC-WP-XC-07")).applicability).toBe("pending");

  const page = await signIn("qa-lead");
  await page.goto(procedurePath(tenantId, engagementId, "PROC-WP-XC-07"));
  const suggestion = page.getByTestId("art50-suggestion-WP-XC-07");
  await expect(suggestion).toContainText("Suggested: applicable");
  await expect(suggestion).toContainText("A50-P-01");
  await expect(suggestion).toContainText("AIA-50-1 candidate");
  await expect(suggestion).toContainText(
    "Does not apply on the recorded facts",
  );
  // The statistical criterion of A50-P-01 with its library entry.
  const criterion = page.getByTestId("art50-criterion-A50-P-01-C01");
  await expect(criterion).toContainText("lower bound 0.98");
  await expect(criterion).toContainText(
    "policy.eu-aia.art50-disclosure-probe@1",
  );
  await expect(criterion).toContainText("No legal safe harbour");
  await expectAccessible(page, "Art 50 paper plan");

  // Opening the plan form from the suggestion fills it in, saves nothing.
  await suggestion.getByRole("button", { name: "Use in plan" }).click();
  const dialog = page.getByRole("dialog", { name: /Plan · WP-XC-07/ });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Regulatory applicability" }),
  ).toHaveValue("applicable");
  await expect(
    dialog.getByRole("textbox", {
      name: "Applicability and selection rationale",
    }),
  ).toHaveValue(/Suggested from the provisional classification/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await procedure("PROC-WP-XC-07")).applicability).toBe("pending");

  // The marking paper is suggested as not applicable in the program list.
  await page.goto(
    "/?" +
      new URLSearchParams({
        practice: tenantId,
        engagement: engagementId,
        view: "Audit program",
      }),
  );
  await page.getByRole("button", { name: "Decisions needed" }).click();
  await expect(page.getByTestId("art50-suggested-WP-XC-10")).toHaveText(
    "Suggested: not applicable",
  );
  expect((await procedure("PROC-WP-XC-10")).applicability).toBe("pending");
});
