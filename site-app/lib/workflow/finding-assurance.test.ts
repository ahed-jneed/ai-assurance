// The finding assurance commands (#52): the support behind a finding, the
// independent retest of its remediation and reopening a closed finding;
// the happy path, each refusal and the state each leaves. A refused command
// leaves the engagement exactly as it was.
import { describe, expect, it } from "vitest";
import { defaultFindingCriteria } from "../criteria/pin";
import type { Engagement, Finding } from "../domain";
import {
  artifact,
  at,
  command,
  engagement,
  expectFailure,
  finding,
  paper,
  procedureId,
  procedureOf,
  run,
  structuredEngagement,
} from "./test-fixtures";

function withFinding(overrides: Partial<Finding> = {}): Engagement {
  return structuredEngagement({
    artifacts: [
      artifact(),
      artifact({ id: "quarantined", status: "quarantined" }),
    ],
    papers: [paper()],
    runs: [run()],
    findings: [finding(overrides)],
  });
}
const theFinding = (e: Engagement) => e.findings[0];

async function refused(
  e: Engagement,
  result: () => Promise<unknown>,
  status: number,
  message?: string,
) {
  const before = structuredClone(e);
  await expectFailure(result(), status, message);
  expect(e).toEqual(before);
}

describe("linkFindingSupport", () => {
  const support = {
    findingId: "finding",
    procedureId,
    paperIds: ["paper"],
    evidenceIds: ["evidence"],
    runIds: ["run"],
  };
  const link = (e: Engagement, data = {}, user = "auditor") =>
    command(e, "linkFindingSupport", { ...support, ...data }, user);

  it("records the support and takes the criteria of the procedure's item", async () => {
    const e = withFinding();
    expect(await link(e)).toEqual({ findingId: "finding" });
    expect(theFinding(e).support).toEqual({
      ...support,
      actor: "auditor",
      at,
    });
    const expected = defaultFindingCriteria(
      e,
      procedureOf(e, procedureId).templateId,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(theFinding(e).criteriaRefs).toEqual(expected);
  });

  it("keeps criteria the finding already names", async () => {
    const e = withFinding({ criteriaRefs: ["eu-ai-act:art-10-3"] });
    await link(e, {}, "lead");
    expect(theFinding(e).criteriaRefs).toEqual(["eu-ai-act:art-10-3"]);
  });

  it("links support without a procedure, and so without criteria", async () => {
    const e = withFinding();
    await link(e, { procedureId: "", paperIds: [], runIds: [] });
    expect(theFinding(e).support).toMatchObject({ procedureId: "" });
    expect(theFinding(e).criteriaRefs).toBeUndefined();
  });

  it.each(["reviewer", "viewer", "contributor"])("refuses %s", async (u) => {
    const e = withFinding();
    await refused(
      e,
      () => link(e, {}, u),
      403,
      "An Auditor or Lead Auditor must record this audit work",
    );
  });

  it("refuses an unknown finding", async () => {
    const e = withFinding();
    await refused(
      e,
      () => link(e, { findingId: "finding-9" }),
      404,
      "Finding not found",
    );
  });

  it("refuses a procedure of another engagement", async () => {
    const e = withFinding();
    await refused(
      e,
      () => link(e, { procedureId: "PROC-elsewhere" }),
      404,
      "Procedure not found in this engagement",
    );
  });

  it("refuses a procedure on an engagement without the structured workflow", async () => {
    const e = engagement({
      artifacts: [artifact()],
      findings: [finding()],
    });
    await refused(
      e,
      () => link(e, { paperIds: [], runIds: [] }),
      409,
      "Adopt the engagement workflow first",
    );
  });

  it.each([
    ["a paper", { paperIds: ["paper-elsewhere"] }],
    ["a run", { runIds: ["run-elsewhere"] }],
  ])("refuses %s of another engagement", async (_, data) => {
    const e = withFinding();
    await refused(
      e,
      () => link(e, data),
      400,
      "Support must belong to this engagement",
    );
  });

  it.each([
    ["no evidence", []],
    ["evidence that is not accepted", ["quarantined"]],
    ["evidence of another engagement", ["elsewhere"]],
  ])("refuses %s", async (_, evidenceIds) => {
    const e = withFinding();
    await refused(
      e,
      () => link(e, { evidenceIds }),
      400,
      "Link accepted evidence from this engagement",
    );
  });
});

describe("recordFindingRetest", () => {
  const ready: Partial<Finding> = {
    status: "ready_for_retest",
    remediation: "Sampling frame now includes online applicants",
    remediationBy: "client",
  };
  const retest = {
    findingId: "finding",
    performed: "Reperformed the representativeness test",
    results: "Both groups within tolerance",
    rationale: "The remediated frame covers every channel",
    evidenceIds: ["evidence"],
    conclusion: "effective",
  };
  const record = (e: Engagement, data = {}, user = "reviewer") =>
    command(e, "recordFindingRetest", { ...retest, ...data }, user);

  it.each(["reviewer", "lead"])(
    "lets an independent %s record the retest",
    async (user) => {
      const e = withFinding(ready);
      expect(await record(e, {}, user)).toEqual({ findingId: "finding" });
      expect(theFinding(e).retest).toEqual({ ...retest, actor: user, at });
      expect(theFinding(e).retestEvidenceIds).toEqual(["evidence"]);
      // Recording the retest does not close the finding.
      expect(theFinding(e).status).toBe("ready_for_retest");
    },
  );

  it.each(["auditor", "viewer", "contributor"])("refuses %s", async (u) => {
    const e = withFinding(ready);
    await refused(
      e,
      () => record(e, {}, u),
      403,
      "An independent Reviewer or Lead Auditor must approve",
    );
  });

  it.each([
    ["the finding's author", { createdBy: "reviewer" }],
    ["the person who remediated it", { remediationBy: "reviewer" }],
  ])("refuses %s", async (_, overrides) => {
    const e = withFinding({ ...ready, ...overrides });
    await refused(
      e,
      () => record(e),
      403,
      "An independent person must perform the retest",
    );
  });

  it("refuses an unknown finding", async () => {
    const e = withFinding(ready);
    await refused(
      e,
      () => record(e, { findingId: "finding-9" }),
      404,
      "Finding not found",
    );
  });

  it.each([
    ["an open finding", { ...ready, status: "open" }],
    ["a closed finding", { ...ready, status: "closed" }],
    ["a finding without remediation", { ...ready, remediation: "  " }],
  ] as const)("refuses %s", async (_, overrides) => {
    const e = withFinding(overrides as Partial<Finding>);
    await refused(
      e,
      () => record(e),
      409,
      "Record management remediation and request retest first",
    );
  });

  it.each([
    ["evidence that is not accepted", ["quarantined"]],
    ["evidence of another engagement", ["elsewhere"]],
  ])("refuses %s", async (_, evidenceIds) => {
    const e = withFinding(ready);
    await refused(
      e,
      () => record(e, { evidenceIds }),
      400,
      "Link accepted evidence from this engagement",
    );
  });
});

describe("reopenFinding", () => {
  const previousRetest: Finding["retest"] = {
    performed: "Reperformed the test",
    results: "Within tolerance",
    rationale: "Remediation effective",
    evidenceIds: ["evidence"],
    conclusion: "effective",
    actor: "reviewer",
    at,
  };
  const closed: Partial<Finding> = {
    status: "closed",
    closedBy: "reviewer",
    retest: previousRetest,
  };
  const reopen = (e: Engagement, data = {}, user = "lead") =>
    command(
      e,
      "reopenFinding",
      { findingId: "finding", reason: "The deviation recurred", ...data },
      user,
    );

  it("reopens a closed finding and keeps the closure in its history", async () => {
    const e = withFinding(closed);
    expect(await reopen(e)).toEqual({ findingId: "finding" });
    expect(theFinding(e)).toMatchObject({ status: "open" });
    expect(theFinding(e).closedBy).toBeUndefined();
    expect(theFinding(e).retest).toBeUndefined();
    expect(theFinding(e).closureHistory).toEqual([
      {
        at,
        actor: "lead",
        reason: "The deviation recurred",
        closedBy: "reviewer",
        retest: previousRetest,
      },
    ]);
  });

  it.each(["auditor", "reviewer", "viewer"])("refuses %s", async (u) => {
    const e = withFinding(closed);
    await refused(
      e,
      () => reopen(e, {}, u),
      403,
      "A Lead Auditor must authorize this decision",
    );
  });

  it("refuses an unknown finding", async () => {
    const e = withFinding(closed);
    await refused(
      e,
      () => reopen(e, { findingId: "finding-9" }),
      404,
      "Finding not found",
    );
  });

  it.each(["open", "ready_for_retest"] as const)(
    "refuses a finding that is %s",
    async (status) => {
      const e = withFinding({ ...closed, status });
      await refused(
        e,
        () => reopen(e),
        409,
        "Only a closed finding can be reopened",
      );
    },
  );
});
