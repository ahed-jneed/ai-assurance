// The follow-up case commands beyond their role check (#52): creating,
// assessing and independently closing a case, each refusal and the state
// each leaves. A refused command leaves the engagement exactly as it was.
// monitoring.test.ts covers the evidence each decision needs at closure.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Engagement, Report } from "../domain/types";
import type { MonitoringCase } from "../workflow-types";
import {
  approvedWorkflow,
  artifact,
  at,
  command,
  engagement,
  expectFailure,
  finding,
} from "./test-fixtures";

const caseInput = {
  kind: "monitoring",
  title: "Quarterly drift review",
  description: "Compare live error rates with the audited baseline",
  ownerId: "auditor",
  dueDate: "2026-12-31",
  cadence: "quarterly",
  findingId: "",
  reportId: "",
};

const finalReport = {
  id: "R1",
  kind: "final",
  createdAt: at,
  actor: "auditor",
  sha256: "R1-internal",
  snapshot: {},
} as Report;

function audited(): Engagement {
  return engagement({
    workflow: approvedWorkflow(),
    artifacts: [artifact()],
    findings: [finding()],
    reports: [finalReport, { ...finalReport, id: "D1", kind: "draft" }],
  });
}

function existing(overrides: Partial<MonitoringCase> = {}): MonitoringCase {
  return {
    ...(caseInput as Omit<MonitoringCase, "id">),
    id: "CASE-1",
    state: "open",
    decision: "not_assessed",
    assessment: "",
    evidenceIds: [],
    contributors: ["auditor"],
    createdBy: "auditor",
    createdAt: at,
    updatedAt: at,
    history: [],
    ...overrides,
  };
}

function withCase(overrides: Partial<MonitoringCase> = {}) {
  const e = audited();
  e.workflow!.monitoring = [existing(overrides)];
  return e;
}
const theCase = (e: Engagement, id = "CASE-1") =>
  e.workflow!.monitoring.find((m) => m.id === id)!;

async function refused(
  e: Engagement,
  run: () => Promise<unknown>,
  status: number,
  message?: string,
) {
  const before = structuredClone(e);
  await expectFailure(run(), status, message);
  expect(e).toEqual(before);
}

const writerOnly = "An Auditor or Lead Auditor must record this audit work";

describe("createMonitoringCase", () => {
  const create = (e: Engagement, data = {}, user = "auditor") =>
    command(e, "createMonitoringCase", { ...caseInput, ...data }, user);

  it("opens a case owned by an internal member, linked to a finding and a final report", async () => {
    const e = audited();
    const { caseId } = await create(
      e,
      { findingId: "finding", reportId: "R1" },
      "lead",
    );
    expect(caseId).toMatch(/^CASE-/);
    expect(theCase(e, caseId)).toEqual({
      ...caseInput,
      findingId: "finding",
      reportId: "R1",
      id: caseId,
      state: "open",
      decision: "not_assessed",
      assessment: "",
      evidenceIds: [],
      contributors: ["lead"],
      createdBy: "lead",
      createdAt: at,
      updatedAt: at,
      history: [],
    });
  });

  it("plans the next cycle of a closed recurring case", async () => {
    const e = withCase({
      state: "closed",
      decision: "no_reassessment",
      assessment: "No drift",
      evidenceIds: ["evidence"],
    });
    const { caseId } = await create(e, {
      previousCaseId: "CASE-1",
      dueDate: "2027-03-31",
    });
    const previous = theCase(e);
    expect(previous.nextCaseId).toBe(caseId);
    expect(previous.history).toEqual([
      {
        at,
        actor: "auditor",
        action: "plan_next_cycle",
        state: "closed",
        assessment: caseInput.description,
        evidenceIds: ["evidence"],
      },
    ]);
    expect(theCase(e, caseId)).toMatchObject({
      previousCaseId: "CASE-1",
      state: "open",
    });
  });

  it.each(["reviewer", "viewer", "contributor", "quality-reviewer"])(
    "refuses %s",
    async (user) => {
      const e = audited();
      await refused(e, () => create(e, {}, user), 403, writerOnly);
    },
  );

  it.each([
    ["a reviewer", "reviewer"],
    ["a client contributor", "contributor"],
    ["a revoked member", "revoked-reviewer"],
    ["an unknown person", "nobody"],
  ])("refuses %s as the owner", async (_, ownerId) => {
    const e = audited();
    await refused(
      e,
      () => create(e, { ownerId }),
      400,
      "Select an active authorized person with the required role",
    );
  });

  it("refuses a finding of another engagement", async () => {
    const e = audited();
    await refused(
      e,
      () => create(e, { findingId: "finding-elsewhere" }),
      400,
      "Select a finding from this engagement",
    );
  });

  it.each([
    ["a draft report", "D1"],
    ["a report of another engagement", "R9"],
  ])("refuses %s", async (_, reportId) => {
    const e = audited();
    await refused(
      e,
      () => create(e, { reportId }),
      400,
      "Select a final report from this engagement",
    );
  });

  it("refuses the 151st case", async () => {
    const e = audited();
    e.workflow!.monitoring = Array.from({ length: 150 }, (_, i) =>
      existing({ id: "CASE-" + i }),
    );
    await refused(e, () => create(e), 413, "Follow-up case limit reached");
  });

  const nextCycle =
    "Plan one later cycle from a closed recurring monitoring case";
  it.each([
    ["an unknown case", {}, "CASE-9", "2027-03-31"],
    ["an open case", {}, "CASE-1", "2027-03-31"],
    [
      "a one-off case",
      { state: "closed", cadence: "one_off" },
      "CASE-1",
      "2027-03-31",
    ],
    [
      "a case already followed by a cycle",
      { state: "closed", nextCaseId: "CASE-2" },
      "CASE-1",
      "2027-03-31",
    ],
    ["a cycle due no later", { state: "closed" }, "CASE-1", "2026-12-31"],
  ] as const)(
    "refuses to plan the next cycle of %s",
    async (_, previous, previousCaseId, dueDate) => {
      const e = withCase(previous as Partial<MonitoringCase>);
      await refused(
        e,
        () => create(e, { previousCaseId, dueDate }),
        409,
        nextCycle,
      );
    },
  );

  it("refuses a date that is not a real calendar date", async () => {
    const e = audited();
    await expect(create(e, { dueDate: "2026-02-30" })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(e.workflow!.monitoring).toEqual([]);
  });
});

describe("assessMonitoringCase", () => {
  const assessment = {
    caseId: "CASE-1",
    decision: "follow_up",
    assessment: "Error rates moved within tolerance",
    evidenceIds: ["evidence"],
    dueDate: "2027-01-31",
  };
  const assess = (e: Engagement, data = {}, user = "second-auditor") =>
    command(e, "assessMonitoringCase", { ...assessment, ...data }, user);

  it("records the assessment, keeps the earlier one and adds the assessor", async () => {
    const e = withCase();
    expect(await assess(e)).toEqual({ caseId: "CASE-1" });
    expect(theCase(e)).toMatchObject({
      state: "in_progress",
      decision: "follow_up",
      assessment: "Error rates moved within tolerance",
      evidenceIds: ["evidence"],
      dueDate: "2027-01-31",
      updatedAt: at,
      contributors: ["auditor", "second-auditor"],
    });
    expect(theCase(e).history).toEqual([
      {
        at,
        actor: "second-auditor",
        action: "assess",
        state: "open",
        assessment: "",
        evidenceIds: [],
      },
    ]);
    await assess(e, { decision: "no_reassessment" }, "auditor");
    expect(theCase(e).contributors).toEqual(["auditor", "second-auditor"]);
    expect(theCase(e).history).toHaveLength(2);
  });

  it.each(["reviewer", "viewer", "contributor"])("refuses %s", async (user) => {
    const e = withCase();
    await refused(e, () => assess(e, {}, user), 403, writerOnly);
  });

  it("refuses an unknown case", async () => {
    const e = withCase();
    await refused(
      e,
      () => assess(e, { caseId: "CASE-9" }),
      404,
      "Follow-up case not found",
    );
  });

  it("refuses a closed case", async () => {
    const e = withCase({ state: "closed" });
    await refused(
      e,
      () => assess(e),
      409,
      "This case is already closed. Create a new case for subsequent work",
    );
  });

  it("refuses to decide no reassessment without evidence", async () => {
    const e = withCase();
    await refused(
      e,
      () => assess(e, { decision: "no_reassessment", evidenceIds: [] }),
      400,
      "Link the accepted evidence that shows no reassessment is needed",
    );
  });

  it.each([
    ["evidence that is not accepted", "quarantined"],
    ["evidence of another engagement", "elsewhere"],
  ])("refuses %s", async (_, id) => {
    const e = withCase();
    e.artifacts.push(artifact({ id: "quarantined", status: "quarantined" }));
    await refused(
      e,
      () => assess(e, { evidenceIds: [id] }),
      400,
      "Link accepted evidence from this engagement",
    );
  });
});

describe("closeMonitoringCase", () => {
  const close = (e: Engagement, user = "reviewer") =>
    command(
      e,
      "closeMonitoringCase",
      { caseId: "CASE-1", closure: "Independently reviewed" },
      user,
    );
  const assessed: Partial<MonitoringCase> = {
    state: "in_progress",
    decision: "no_reassessment",
    assessment: "No drift",
    evidenceIds: ["evidence"],
  };

  it("closes an assessed case and records who closed it", async () => {
    const e = withCase(assessed);
    expect(await close(e)).toEqual({ caseId: "CASE-1" });
    expect(theCase(e)).toMatchObject({
      state: "closed",
      closedBy: "reviewer",
      closedAt: at,
      closure: "Independently reviewed",
      updatedAt: at,
    });
    expect(theCase(e).history.at(-1)).toEqual({
      at,
      actor: "reviewer",
      action: "close",
      state: "in_progress",
      assessment: "Independently reviewed",
      evidenceIds: ["evidence"],
    });
  });

  it.each(["auditor", "viewer", "contributor"])("refuses %s", async (user) => {
    const e = withCase(assessed);
    await refused(
      e,
      () => close(e, user),
      403,
      "An independent Reviewer or Lead Auditor must approve",
    );
  });

  it.each([
    ["a contributor to the case", { contributors: ["auditor", "lead"] }],
    ["the case owner", { ownerId: "lead" }],
  ])("refuses %s", async (_, overrides) => {
    const e = withCase({ ...assessed, ...overrides });
    await refused(
      e,
      () => close(e, "lead"),
      403,
      "A preparer or contributor cannot approve their own work",
    );
  });

  it("refuses an unknown case", async () => {
    const e = withCase(assessed);
    await refused(
      e,
      () =>
        command(
          e,
          "closeMonitoringCase",
          { caseId: "CASE-9", closure: "Closed" },
          "reviewer",
        ),
      404,
      "Follow-up case not found",
    );
  });

  it("refuses to close a closed case again, whoever asks (#209)", async () => {
    for (const user of ["reviewer", "auditor"]) {
      const e = withCase({ ...assessed, state: "closed" });
      await refused(
        e,
        () =>
          command(
            e,
            "closeMonitoringCase",
            { caseId: "CASE-1", closure: "Closed again" },
            user,
          ),
        409,
        "This case is already closed. Create a new case for subsequent work",
      );
    }
  });

  it.each([
    ["an unassessed case", {}],
    ["a case with a blank assessment", { ...assessed, assessment: " " }],
  ] as const)("refuses %s", async (_, overrides) => {
    const e = withCase(overrides as Partial<MonitoringCase>);
    await refused(
      e,
      () => close(e),
      409,
      "Assess the case before independent closure",
    );
  });

  it("refuses a follow-up decision without evidence", async () => {
    const e = withCase({ ...assessed, decision: "follow_up", evidenceIds: [] });
    await refused(
      e,
      () => close(e),
      400,
      "Record an assessment with the accepted evidence before independent closure",
    );
  });

  it("closes a reassessment case once its successor engagement is open", async () => {
    const reassessment: Partial<MonitoringCase> = {
      ...assessed,
      decision: "reassessment_required",
      evidenceIds: [],
    };
    const e = withCase(reassessment);
    await refused(
      e,
      () => close(e),
      400,
      "Open a successor engagement before closing the reassessment case",
    );
    theCase(e).successorEngagementId = "ENG-2";
    theCase(e).evidenceIds = ["quarantined"];
    e.artifacts.push(artifact({ id: "quarantined", status: "quarantined" }));
    // Evidence a reassessment links must still be accepted.
    await refused(
      e,
      () => close(e),
      400,
      "Link accepted evidence from this engagement",
    );
    theCase(e).evidenceIds = [];
    await close(e);
    expect(theCase(e).state).toBe("closed");
  });

  it("refuses a case whose evidence is no longer accepted", async () => {
    const e = withCase(assessed);
    e.artifacts[0].status = "quarantined";
    await refused(
      e,
      () => close(e),
      400,
      "Link accepted evidence from this engagement",
    );
  });
});
