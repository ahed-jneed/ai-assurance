// The structured engagement workflow's commands, dispatched by name for the
// workspace route. They live in lib/workflow/ by area: scope and program
// planning, procedure execution and review, client request grants, report
// release, follow-up monitoring and finding assurance.
import type { Engagement } from "./domain";
import { briefProgramCommands } from "./workflow/brief-program";
import { clientGrantCommands } from "./workflow/client-grants";
import {
  commandScope,
  fail,
  type Context,
  type WorkflowHandler,
} from "./workflow/command";
import { findingAssuranceCommands } from "./workflow/finding-assurance";
import { monitoringCommands } from "./workflow/monitoring";
import { procedureCommands } from "./workflow/procedures";
import { reportReleaseCommands } from "./workflow/report-release";
export { WorkflowError, calendarDate } from "./workflow/command";
export const workflowOps = [
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
];
// A Map, so inherited object keys such as `constructor` stay unknown.
const commands = new Map<string, WorkflowHandler>(
  Object.entries({
    ...briefProgramCommands,
    ...procedureCommands,
    ...clientGrantCommands,
    ...reportReleaseCommands,
    ...monitoringCommands,
    ...findingAssuranceCommands,
  }),
);
export async function workflowCommand(
  e: Engagement,
  op: string,
  data: unknown,
  c: Context,
): Promise<Record<string, string>> {
  const command = commands.get(op);
  if (!command) return fail(400, "Unknown workflow command");
  return command(commandScope(e, c), data);
}
