import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import * as service from "./workflow-service";
import {
  WorkflowError,
  workflowCommand,
  workflowOps,
} from "./workflow-service";
import {
  command,
  engagement,
  expectFailure,
  structuredEngagement,
} from "./workflow/test-fixtures";

const writerOnly = [
  403,
  "An Auditor or Lead Auditor must record this audit work",
] as const;
const leadOnly = [403, "A Lead Auditor must authorize this decision"] as const;
const reviewerOnly = [
  403,
  "An independent Reviewer or Lead Auditor must approve",
] as const;
const notAdopted = [409, "Adopt the engagement workflow first"] as const;
const invalid = "invalid input";
type FirstFailure = readonly [number, string] | typeof invalid;

// The first check each command applies, which the split must preserve: a
// client viewer on a fresh structured engagement, sending no data.
const asClientViewer: Record<string, FirstFailure> = {
  adoptWorkflow: leadOnly,
  saveBrief: writerOnly,
  submitBrief: writerOnly,
  approveBrief: [400, "Complete the brief first"],
  returnBrief: reviewerOnly,
  saveProcedurePlan: writerOnly,
  bulkPlanProcedures: writerOnly,
  publishClientClarification: writerOnly,
  acknowledgeClientSubmission: writerOnly,
  scopeProgramCandidates: writerOnly,
  submitProgram: writerOnly,
  approveProgram: reviewerOnly,
  returnProgram: reviewerOnly,
  ensureProcedurePaper: writerOnly,
  recordProcedureExecution: writerOnly,
  evaluateProcedure: writerOnly,
  reaffirmExecution: [
    409,
    "Approve the current scope and audit program before execution",
  ],
  submitProcedure: writerOnly,
  reviewProcedure: invalid,
  returnProcedure: invalid,
  grantClientRequest: leadOnly,
  updateClientRequest: leadOnly,
  revokeClientRequest: leadOnly,
  approveReportPackage: reviewerOnly,
  releaseReport: leadOnly,
  withdrawReport: leadOnly,
  createMonitoringCase: writerOnly,
  assessMonitoringCase: writerOnly,
  closeMonitoringCase: invalid,
  linkFindingSupport: writerOnly,
  recordFindingRetest: reviewerOnly,
  reopenFinding: leadOnly,
};

// The next check: a Lead Auditor on a legacy engagement without a workflow.
// Adoption itself succeeds there.
const asLeadWithoutWorkflow: Record<string, FirstFailure> = {
  ...Object.fromEntries(workflowOps.map((op) => [op, invalid])),
  submitBrief: notAdopted,
  approveBrief: notAdopted,
  bulkPlanProcedures: notAdopted,
  scopeProgramCandidates: notAdopted,
  submitProgram: notAdopted,
  approveProgram: notAdopted,
  recordProcedureExecution: notAdopted,
  evaluateProcedure: notAdopted,
  reaffirmExecution: notAdopted,
  submitProcedure: notAdopted,
};
delete asLeadWithoutWorkflow.adoptWorkflow;

async function expectFirstFailure(
  result: Promise<unknown>,
  expected: FirstFailure,
) {
  if (expected === invalid)
    await expect(result).rejects.toBeInstanceOf(ZodError);
  else await expectFailure(result, ...expected);
}

describe("workflow command dispatch", () => {
  it("exports the same public API", () => {
    expect(Object.keys(service).sort()).toEqual([
      "WorkflowError",
      "calendarDate",
      "workflowCommand",
      "workflowOps",
    ]);
    expect(workflowOps).toEqual([
      "adoptWorkflow",
      "saveBrief",
      "submitBrief",
      "approveBrief",
      "returnBrief",
      "saveProcedurePlan",
      "bulkPlanProcedures",
      "publishClientClarification",
      "acknowledgeClientSubmission",
      "scopeProgramCandidates",
      "submitProgram",
      "approveProgram",
      "returnProgram",
      "ensureProcedurePaper",
      "recordProcedureExecution",
      "evaluateProcedure",
      "reaffirmExecution",
      "submitProcedure",
      "reviewProcedure",
      "returnProcedure",
      "grantClientRequest",
      "updateClientRequest",
      "revokeClientRequest",
      "approveReportPackage",
      "releaseReport",
      "withdrawReport",
      "createMonitoringCase",
      "assessMonitoringCase",
      "closeMonitoringCase",
      "linkFindingSupport",
      "recordFindingRetest",
      "reopenFinding",
    ]);
    expect(Object.keys(asClientViewer).sort()).toEqual([...workflowOps].sort());
  });

  it.each(workflowOps)("applies the first guard of %s", async (op) => {
    await expectFirstFailure(
      command(structuredEngagement(), op, {}, "viewer"),
      asClientViewer[op],
    );
  });

  it.each(Object.keys(asLeadWithoutWorkflow))(
    "applies the next guard of %s",
    async (op) => {
      await expectFirstFailure(
        command(engagement(), op, {}, "lead"),
        asLeadWithoutWorkflow[op],
      );
    },
  );

  it("rejects unknown commands, including inherited object keys", async () => {
    for (const op of [
      "",
      "deleteEngagement",
      "constructor",
      "toString",
      "hasOwnProperty",
      "__proto__",
    ])
      await expectFailure(
        command(structuredEngagement(), op, {}, "lead"),
        400,
        "Unknown workflow command",
      );
  });

  it("reports failures as WorkflowError with an HTTP status", async () => {
    const error = await workflowCommand(
      engagement(),
      "submitBrief",
      {},
      {
        role: "Lead Auditor",
        userId: "lead",
        at: "2026-11-05T10:00:00.000Z",
        id: (prefix) => prefix + "-1",
        sha256: async () => "0",
        makePaper: () => {
          throw new Error("No paper expected");
        },
        member: async () => null,
      },
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(WorkflowError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      status: 409,
      message: "Adopt the engagement workflow first",
    });
  });
});

describe("calendarDate", () => {
  it("accepts only real ISO calendar dates", () => {
    const { calendarDate } = service;
    for (const date of ["2026-11-05", "2028-02-29"])
      expect(calendarDate.parse(date)).toBe(date);
    for (const date of [
      "2026-02-29",
      "2026-13-01",
      "2026-11-5",
      "05.11.2026",
      "2026-11-05T00:00:00Z",
    ])
      expect(calendarDate.safeParse(date).success).toBe(false);
  });
});
