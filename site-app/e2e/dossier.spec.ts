// Dossier sealing: the Lead Auditor seals the internal and the client
// dossier of a released final report, and a scoped internal export of its
// one procedure, from the report's record sheet. Each download is the signed
// dossier the seal recorded; the scoped export's manifest states its scope.
// Only a Lead Auditor seals, and a client reader only ever receives the
// client dossier.
import type { Locator, Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import {
  assurance,
  engagementInSignOff,
  finalReport,
  run,
  type Engagement,
} from "./engagement";
import { expect, recordPath, test, type Api } from "./fixtures";

type Sealed = {
  keyId: string;
  files: number;
  scopeSha256?: string;
  scope?: { procedureIds: string[] | null };
};

/** Seals from the record sheet and waits for the Worker's seal. */
async function sealInUi(
  page: Page,
  button: string,
  dialogName: string,
  configure?: (dialog: Locator) => Promise<void>,
) {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await configure?.(dialog);
  await expectAccessible(page, dialogName, { include: "[role=dialog]" });
  const sealed = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/dossier",
  );
  await dialog.getByRole("button", { name: "Verify bytes and seal" }).click();
  const response = await sealed;
  expect(response.status(), await response.text()).toBe(200);
  await expect(dialog).toBeHidden();
  return ((await response.json()) as { record: { body: Sealed } }).record.body;
}

/** Downloads a sealed dossier as `api` and returns its signed manifest. */
async function download(
  api: Api,
  e: Engagement,
  reportId: string,
  query: Record<string, string>,
) {
  const response = await api.http.get(
    "/api/dossier?" +
      new URLSearchParams({
        tenantId: e.tenantId,
        engagementId: e.engagementId,
        reportId,
        ...query,
      }),
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as {
    manifest: {
      audience?: string;
      files: unknown[];
      scope?: { procedureIds: string[] | null };
    };
    signature: { keyId: string };
  };
}

test("the Lead Auditor seals the dossiers of a released report", async ({
  signIn,
  api,
  demo,
}) => {
  test.slow();
  const lead = await api("qa-lead");
  const auditor = await api("qa-auditor");
  const reviewer = await api("qa-reviewer");
  const viewer = await api("qa-viewer");
  const e = await engagementInSignOff(
    [lead, auditor, reviewer],
    demo.tenantId,
    demo.clientId,
    "E2E dossier",
  );
  // A reviewed assertion of the procedure, which the final report pins and
  // a scoped export by that procedure carries.
  const assertion = await assurance(auditor, e, "addAssertion", {
    statement: "Every register risk has an owner and a treatment (E2E)",
    criterion: "AIA-09-1",
    procedureId: e.procedureId,
    relations: [],
    missingEvidence: "",
    assessment: "Inspected in the procedure's execution",
    conclusion: "supported",
  });
  await assurance(reviewer, e, "reviewAssertion", {
    assertionId: assertion.id,
    decision: "approve",
    reason: "Independently confirmed against the register",
  });
  const report = await finalReport(lead, e);
  await run(reviewer, e, "approveReportPackage", {
    reportId: report.id,
    internalHash: report.sha256,
    clientHash: report.clientSha256,
    reason: "Both packages reviewed",
  });
  await run(lead, e, "releaseReport", {
    reportId: report.id,
    recipientScope: "Acme board risk committee",
    reason: "Released for the dossier spec",
  });

  // Only a Lead Auditor seals.
  const refused = await reviewer.post("/api/dossier", {
    tenantId: e.tenantId,
    engagementId: e.engagementId,
    reportId: report.id,
    audience: "internal",
  });
  expect(refused.status()).toBe(403);

  const page = await signIn("qa-lead");
  await page.goto(recordPath(e, "Reports & sign-off", "report", report.id));
  await page.getByText("Integrity & downloads").click();
  await expect(
    page.getByRole("button", { name: "Seal internal dossier" }),
  ).toBeVisible();
  await expectAccessible(page, "Report integrity and dossiers");

  const internal = await sealInUi(
    page,
    "Seal internal dossier",
    "Seal internal dossier",
  );
  await expect(
    page.getByRole("link", { name: "Download internal dossier" }),
  ).toBeVisible();
  const internalDossier = await download(lead, e, report.id, {
    audience: "internal",
  });
  expect(internalDossier.manifest.audience).toBe("internal");
  expect(internalDossier.signature.keyId).toBe(internal.keyId);
  expect(internalDossier.manifest.files).toHaveLength(internal.files);

  const client = await sealInUi(
    page,
    "Seal client dossier",
    "Seal client dossier",
  );
  // A client reader asking for the internal dossier receives the client one.
  const clientDossier = await download(viewer, e, report.id, {
    audience: "internal",
  });
  expect(clientDossier.manifest.audience).toBe("client");
  expect(clientDossier.signature.keyId).toBe(client.keyId);
  expect(clientDossier.manifest.files).toHaveLength(client.files);

  // A scoped export of the engagement's one procedure.
  const scoped = await sealInUi(
    page,
    "Seal scoped internal export",
    "Seal scoped internal export",
    async (dialog) => {
      await dialog
        .getByRole("checkbox", { name: new RegExp(e.procedureId) })
        .check();
    },
  );
  expect(scoped.scope?.procedureIds).toEqual([e.procedureId]);
  await expect(
    page.getByRole("link", { name: "Download scoped export" }),
  ).toBeVisible();
  const scopedDossier = await download(lead, e, report.id, {
    audience: "internal",
    scope: scoped.scopeSha256!,
  });
  expect(scopedDossier.manifest.audience).toBe("internal");
  expect(scopedDossier.manifest.scope?.procedureIds).toEqual([e.procedureId]);
  expect(scopedDossier.signature.keyId).toBe(scoped.keyId);
});
