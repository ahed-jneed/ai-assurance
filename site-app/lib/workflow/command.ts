// What every workflow command shares: the error commands fail with, the
// input field schemas, the context the workspace route supplies and the
// guards and lookups bound to one engagement and caller.
import { z } from "zod";
import type { Engagement, Paper, Role } from "../domain/types";
import type { GenaiReadiness } from "../genai/readiness";
import { ownWorkRefusal } from "../preconditions";
import { procedureWorkRevisions, revisionLimits } from "../workflow-state";
import type {
  Procedure,
  ProcedureChange,
  ProcedurePlan,
  Workflow,
} from "../workflow-types";
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
  /** The initial workflow of the engagement's criteria pack (lib/workflow-seed.ts). */
  seedWorkflow: (at: string) => Workflow;
  member: (userId: string) => Promise<{
    role: Role;
    client_id: string | null;
    status: string;
    /** When the member's current grant began (memberships.access_since). */
    access_since?: string | null;
  } | null>;
  /**
   * A practice member's display name, whatever their access to this
   * engagement, so that a refusal names the person it concerns; absent or
   * unknown, the refusal falls back to their user id.
   */
  displayName?: (userId: string) => Promise<string | null | undefined>;
  /**
   * The readiness of the GenAI results that these evidence ids link
   * (lib/genai/store.ts); absent, no evidence id links one.
   */
  genaiReadiness?: (artifactIds: string[]) => Promise<GenaiReadiness[]>;
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
/** The administrative part of a plan: who prepares and reviews, by when. */
export const assignmentKeys = ["ownerId", "reviewerId", "dueDate"] as const;
/**
 * The substantive plan: what the procedure tests and how. Its hash binds
 * executions, so only a change to it invalidates recorded work.
 */
export function substantivePlan(
  p: ProcedurePlan & Pick<Procedure, "id" | "objective" | "instructions">,
) {
  return {
    procedureId: p.id,
    objective: p.objective,
    instructions: p.instructions.map((i) => ({ id: i.id, text: i.text })),
    selected: p.selected,
    applicability: p.applicability,
    rationale: p.rationale,
    criterion: p.criterion,
    sourceVersion: p.sourceVersion,
    periodAnalysis: p.periodAnalysis,
    population: p.population,
    sampling: p.sampling,
    method: p.method,
    modelId: p.modelId,
    datasetId: p.datasetId,
    profileId: p.profileId,
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
    const refusal = ownWorkRefusal(contributors, c.userId);
    if (refusal) fail(refusal.status, refusal.message);
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
  /**
   * Keeps the procedure's state before a change. Only redoing current work
   * is `limited`: plan changes, returns and the work that a plan or scope
   * change requires are never refused.
   */
  const recordHistory = (
    p: Procedure,
    action: ProcedureChange,
    limited: boolean,
  ) => {
    if (limited && procedureWorkRevisions(p) >= revisionLimits.procedure)
      fail(
        413,
        "This procedure reached its limit for redoing work; submit its current work or continue in a follow-up engagement",
      );
    p.history.push({
      action,
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
  /** Records the caller as a contributor to the program. */
  const programEdited = () => {
    const p = w().program;
    p.contributors = [...new Set([...p.contributors, c.userId])];
    p.updatedBy = c.userId;
    p.updatedAt = c.at;
  };
  const planHash = (p: Parameters<typeof substantivePlan>[0]) =>
    c.sha256(JSON.stringify(substantivePlan(p)));
  /** The plan hash, kept on first use for procedures planned without one. */
  const ensurePlanHash = async (p: Procedure) =>
    (p.planHash ??= await planHash(p));
  /** Each procedure's plan revision and hash: what the program binds. */
  const programBindings = () =>
    Promise.all(
      w().procedures.map(async (p) => ({
        id: p.id,
        revision: p.revision,
        planHash: await ensurePlanHash(p),
      })),
    );
  /**
   * A change to what the program tests, before any plan changes: a
   * submitted or approved program becomes the draft of its next revision,
   * and a draft is amended. A pending submission is recorded as withdrawn,
   * with the plans it bound; drafting uses no history entry.
   */
  const programDraft = async () => {
    const p = w().program;
    if (p.status === "submitted")
      p.history.push({
        revision: p.revision,
        briefRevision: p.briefRevision,
        status: "withdrawn",
        procedureRevisions: await programBindings(),
        at: c.at,
        actor: c.userId,
      });
    if (p.status !== "draft") {
      p.revision++;
      p.status = "draft";
      p.approval = undefined;
    }
    programEdited();
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
    programEdited,
    programDraft,
    planHash,
    ensurePlanHash,
    programBindings,
  };
}
export type CommandScope = ReturnType<typeof commandScope>;
export type WorkflowHandler = (
  scope: CommandScope,
  data: unknown,
) => Promise<Record<string, string>>;
