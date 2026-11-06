// What every workflow command shares: the error commands fail with, the
// input field schemas, the context the workspace route supplies and the
// guards and lookups bound to one engagement and caller.
import { z } from "zod";
import type { Engagement, Paper, Role } from "../domain";
import type { Procedure, ProcedurePlan } from "../workflow-types";
export class WorkflowError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new WorkflowError(status, message);
}
export const short = z.string().trim().min(1).max(300),
  text = z.string().trim().min(1).max(8000),
  optional = z.string().trim().max(8000),
  uid = z.string().max(300);
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Choose a real calendar date");
export type Context = {
  role: Role;
  userId: string;
  at: string;
  id: (prefix: string) => string;
  sha256: (value: string) => Promise<string>;
  makePaper: (templateId: string) => Paper;
  member: (userId: string) => Promise<{
    role: Role;
    client_id: string | null;
    status: string;
  } | null>;
};
export function snapshot<
  T extends {
    history: unknown[];
  },
>(record: T) {
  const { history, ...value } = record;
  return structuredClone(value);
}
export function plan(p: Procedure): ProcedurePlan {
  const {
    selected,
    applicability,
    rationale,
    criterion,
    sourceVersion,
    periodAnalysis,
    population,
    sampling,
    ownerId,
    reviewerId,
    dueDate,
    method,
    modelId,
    datasetId,
    profileId,
  } = p;
  return {
    selected,
    applicability,
    rationale,
    criterion,
    sourceVersion,
    periodAnalysis,
    population,
    sampling,
    ownerId,
    reviewerId,
    dueDate,
    method,
    modelId,
    datasetId,
    profileId,
  };
}
/** The guards and lookups of one command: this engagement, this caller. */
export function commandScope(e: Engagement, c: Context) {
  const writer = () => {
    if (!["Auditor", "Lead Auditor"].includes(c.role))
      fail(403, "An Auditor or Lead Auditor must record this audit work");
  };
  const lead = () => {
    if (c.role !== "Lead Auditor")
      fail(403, "A Lead Auditor must authorize this decision");
  };
  const reviewer = () => {
    if (!["Reviewer", "Lead Auditor"].includes(c.role))
      fail(403, "An independent Reviewer or Lead Auditor must approve");
  };
  const independent = (contributors: string[]) => {
    reviewer();
    if (contributors.includes(c.userId))
      fail(403, "A preparer or contributor cannot approve their own work");
  };
  const authorized = async (userId: string, roles: Role[]) => {
    const m = await c.member(userId);
    if (!m || m.status !== "active" || !roles.includes(m.role))
      fail(400, "Select an active authorized person with the required role");
    return m;
  };
  const w = () =>
    e.workflow ?? fail(409, "Adopt the engagement workflow first");
  const procedure = (id: string) =>
    w().procedures.find((p) => p.id === id) ??
    fail(404, "Procedure not found in this engagement");
  const accepted = (ids: string[]) => {
    if (
      !ids.length ||
      ids.some(
        (id) =>
          !e.artifacts.some((a) => a.id === id && a.status === "accepted"),
      )
    )
      fail(400, "Link accepted evidence from this engagement");
  };
  const ready = () => {
    const x = w();
    if (
      x.brief?.status !== "approved" ||
      x.program.status !== "approved" ||
      x.program.briefRevision !== x.brief.revision
    )
      fail(409, "Approve the current scope and audit program before execution");
    return x;
  };
  const recordHistory = (p: Procedure) => {
    if (p.history.length >= 30)
      fail(
        413,
        "This procedure reached its revision limit; start a follow-up engagement",
      );
    p.history.push({
      plan: plan(p),
      revision: p.revision,
      execution: structuredClone(p.execution),
      review: p.review,
      paperId: p.paperId,
      paperRevision: p.paperRevision,
      at: c.at,
      actor: c.userId,
    });
  };
  const programDraft = () => {
    const x = w(),
      p = x.program;
    if (p.history.length >= 150) fail(413, "Program revision limit reached");
    p.history.push({
      revision: p.revision,
      briefRevision: p.briefRevision,
      status: p.status,
      approval: p.approval,
      procedureRevisions: x.procedures.map((q) => ({
        id: q.id,
        revision: q.revision,
      })),
      at: c.at,
      actor: c.userId,
    });
    p.revision++;
    p.status = "draft";
    p.approval = undefined;
    p.contributors = [...new Set([...p.contributors, c.userId])];
    p.updatedBy = c.userId;
    p.updatedAt = c.at;
  };
  return {
    e,
    c,
    writer,
    lead,
    reviewer,
    independent,
    authorized,
    w,
    procedure,
    accepted,
    ready,
    recordHistory,
    programDraft,
  };
}
export type CommandScope = ReturnType<typeof commandScope>;
export type WorkflowHandler = (
  scope: CommandScope,
  data: unknown,
) => Promise<Record<string, string>>;
