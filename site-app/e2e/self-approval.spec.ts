// Self-approval: a Lead Auditor may approve, but not work they prepared. The
// classification and the engagement brief have separate independence guards
// (lib/commands/classification.ts, lib/workflow/command.ts), so both are
// checked; an independent Reviewer's approval of the same record succeeds.
import { expect, test, type Api, type Demo } from "./fixtures";

async function engagement(api: Api, demo: Demo) {
  return (await api.workspace(demo.tenantId, demo.engagementId)).engagement;
}

async function attempt(
  who: Api,
  demo: Demo,
  op: string,
  data: Record<string, unknown>,
) {
  const e = await engagement(who, demo);
  return who.post("/api/workspace", {
    tenantId: demo.tenantId,
    engagementId: demo.engagementId,
    expectedVersion: e.version,
    op,
    data,
  });
}

test("the preparer of a classification cannot approve it", async ({
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const reviewer = await api("qa-reviewer");
  // Tri-state facts (#19): every required fact for a deployer on the Annex
  // III route is answered, so only independence decides the approval.
  const practices = ["a", "b", "ba", "bb", "c", "d", "e", "f", "g", "h"];
  await lead.command(demo.tenantId, demo.engagementId, "classify", {
    annexRoute: "Annex III — sensitive use case",
    operatorRole: "Deployer",
    intendedPurpose: "Creditworthiness assessment of consumer loan applicants",
    rationale: "Credit scoring of natural persons is listed in Annex III.",
    facts: {
      ...Object.fromEntries(practices.map((p) => ["art5_1_" + p, "no"])),
      annexIIIProfiling: "yes",
      smeStatus: "neither",
      deployerUsesEmotionRecognition: "no",
      deployerUsesBiometricCategorisation: "no",
      deployerGeneratesDeepFakes: "no",
      deployerPublishesAiTextOnPublicInterest: "no",
    },
  });

  const own = await attempt(lead, demo, "approveClassification", {});
  expect(own.status()).toBe(403);
  expect((await own.json()).error).toBe(
    "An independent reviewer must approve a completed classification",
  );
  expect((await engagement(lead, demo)).classification.status).toBe(
    "provisional",
  );

  await reviewer.command(
    demo.tenantId,
    demo.engagementId,
    "approveClassification",
  );
  const approved = (await engagement(lead, demo)).classification;
  expect(approved.status).toBe("approved");
  expect(approved.approvedBy).toBe(reviewer.who.userId);
});

test("the preparer of the engagement brief cannot approve it", async ({
  api,
  demo,
}) => {
  const lead = await api("qa-lead");
  const reviewer = await api("qa-reviewer");
  const { tenantId, engagementId } = demo;
  // A server reused from an interrupted run may have left the brief submitted.
  if ((await engagement(lead, demo)).workflow?.brief?.status === "submitted")
    await reviewer.command(tenantId, engagementId, "returnBrief", {
      reason: "Reset by the persona suite",
    });

  await lead.command(tenantId, engagementId, "saveBrief", {
    systemName: "Credit scoring model",
    intendedUse: "Creditworthiness assessment of consumer loan applicants",
    boundary: "Scoring service and its decision-support interface",
    periodStart: "2026-01-01",
    periodEnd: "2026-09-30",
    actorResponsibilities: "The provider develops; the bank deploys",
    audience: "Board risk committee",
    deliverables: "Readiness report",
    basis: "ISAE 3000 (Revised) limited assurance",
    constraints: "Synthetic and anonymized data only",
    independence: "No prior implementation services",
    changeImpact: "Scope set by the persona suite",
  });
  await lead.command(tenantId, engagementId, "submitBrief");
  const brief = (await engagement(lead, demo)).workflow.brief;
  expect(brief.status).toBe("submitted");

  const own = await attempt(lead, demo, "approveBrief", {
    revision: brief.revision,
    reason: "Scope agreed",
  });
  expect(own.status()).toBe(403);
  expect((await own.json()).error).toBe(
    "A preparer or contributor cannot approve their own work",
  );
  expect((await engagement(lead, demo)).workflow.brief.status).toBe(
    "submitted",
  );

  // The Reviewer returns it rather than approving, so a reused server can run
  // the suite again: a Lead's save of an approved brief is a scope change.
  await reviewer.command(tenantId, engagementId, "returnBrief", {
    reason: "Returned by the persona suite",
  });
  expect((await engagement(lead, demo)).workflow.brief.status).toBe("draft");
});
