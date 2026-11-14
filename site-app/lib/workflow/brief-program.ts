// Planning commands: the engagement brief (the agreed scope), the
// procedure plans that make up the audit program, and the program's
// submission, independent approval and return.
//
// Histories keep what was submitted, not drafting: a brief, program or
// procedure plan is amended until its next submission, so saving drafts
// never uses up a history limit. The scope and program limits count returns
// only, so a change to an approved scope or program can always be submitted
// again, and returns are never refused. A procedure plan has two parts. Its
// substantive plan (what is tested and how) carries the plan revision and
// hash that bind executions and runs: changing it returns the program to
// draft and invalidates that procedure's work only. Its assignment
// (preparer, reviewer, due date) is versioned apart from it and changes
// without renewed program approval or invalidating any work.
import { z } from "zod";
import { isReleaseTimeRecord, paperCurrent } from "../domain/gates";
import {
  briefReturns,
  programReturns,
  revisionLimits,
} from "../workflow-state";
import type {
  Brief,
  Procedure,
  ProcedurePlan,
  Program,
} from "../workflow-types";
import { assignable } from "./acceptance-commands";
import {
  assignmentKeys,
  calendarDate,
  fail,
  optional,
  short,
  snapshot,
  text,
  uid,
  type CommandScope,
  type WorkflowHandler,
} from "./command";

/**
 * What a procedure still lacks, in words ("sampling and a due date"): a
 * refusal names only the missing parts, so a set due date is never asked for
 * again (#211).
 */
function lacking(parts: [missing: boolean, name: string][]) {
  const names = parts.filter(([missing]) => missing).map(([, name]) => name);
  return names.length > 1
    ? names.slice(0, -1).join(", ") + " and " + names.at(-1)
    : names[0];
}
const briefFields = z
  .object({
    systemName: short,
    intendedUse: text,
    boundary: text,
    periodStart: calendarDate,
    periodEnd: calendarDate,
    actorResponsibilities: text,
    audience: text,
    deliverables: text,
    basis: text,
    constraints: text,
    // Replaced by per-person declarations (./acceptance-commands.ts); kept
    // for briefs that recorded it as free text.
    independence: optional,
    changeImpact: optional,
  })
  .strict();
const planFields = z
  .object({
    selected: z.boolean(),
    applicability: z.enum([
      "pending",
      "applicable",
      "readiness",
      "not_applicable",
    ]),
    rationale: optional,
    criterion: optional,
    sourceVersion: short,
    periodAnalysis: optional,
    population: optional,
    sampling: optional,
    ownerId: uid,
    reviewerId: uid,
    dueDate: z.union([calendarDate, z.literal("")]),
    method: z.enum(["manual", "automated", "mixed"]),
    modelId: uid,
    datasetId: uid,
    profileId: uid,
  })
  .strict();
const procedureIds = z
  .array(short)
  .min(1)
  .max(40)
  .refine((v) => new Set(v).size === v.length, "Choose each procedure once");
const inScope = (p: ProcedurePlan) =>
  p.selected && ["applicable", "readiness"].includes(p.applicability);
// A submission is refused only once returns used up the limit. A scope or
// program in force always has one left, since its own submission passed and
// nothing returned it, so a change to it can be submitted again. The same
// checks guard such a change before it lands, should a record exceed a limit
// that was lowered after it was approved.
function scopeSubmittable(b: Brief) {
  if (briefReturns(b) >= revisionLimits.brief)
    fail(
      413,
      "The scope reached its return limit; start a follow-up engagement",
    );
}
function programSubmittable(p: Program) {
  if (programReturns(p) >= revisionLimits.program)
    fail(
      413,
      "The program reached its return limit; start a follow-up engagement",
    );
}
/**
 * Changes procedure plans as one decision: every change is checked before
 * any procedure changes. A procedure whose plan is unchanged is left alone.
 */
async function revisePlans(
  { c, w, recordHistory, programEdited, programDraft, planHash }: CommandScope,
  changes: { p: Procedure; plan: Partial<ProcedurePlan> }[],
) {
  const revisions: {
    p: Procedure;
    plan: Partial<ProcedurePlan>;
    next: Procedure;
    hash: string;
    substantive: boolean;
    assignment: boolean;
  }[] = [];
  for (const { p, plan } of changes) {
    const next = { ...p, ...plan },
      hash = await planHash(next),
      substantive = hash !== (p.planHash ?? (await planHash(p))),
      assignment = assignmentKeys.some((k) => next[k] !== p[k]);
    if (substantive || assignment)
      revisions.push({ p, plan, next, hash, substantive, assignment });
  }
  // Only a substantive change returns a submitted or approved program to
  // draft, and only if it can be submitted again. Without one, the program
  // stays as approved and must stay complete. A procedure's history limit
  // never refuses a plan change: a plan entry is added only at the first
  // change after each program submission, or when a change clears a review.
  const program = w().program,
    redraft = revisions.some((r) => r.substantive),
    settled = program.status !== "draft" && !redraft;
  if (redraft && program.status !== "draft") programSubmittable(program);
  for (const { p, next, substantive } of revisions) {
    if (!substantive && p.review && next.reviewerId !== p.reviewerId)
      fail(
        409,
        "The assigned reviewer already approved " +
          p.title +
          "; record new work before reassigning its review",
      );
    if (
      settled &&
      inScope(next) &&
      !isReleaseTimeRecord(next.templateId) &&
      (!next.ownerId || !next.reviewerId || !next.dueDate)
    )
      fail(
        400,
        p.templateId +
          ": approved work needs " +
          lacking([
            [!next.ownerId, "a preparer"],
            [!next.reviewerId, "a reviewer"],
            [!next.dueDate, "a due date"],
          ]),
      );
  }
  if (!revisions.length) return;
  if (redraft) await programDraft();
  else programEdited();
  for (const { p, plan, hash, substantive, assignment } of revisions) {
    // The plan as submitted enters the history once, at its first change,
    // and so does a review that a substantive change clears.
    if (!p.planAmended || (substantive && p.review)) {
      recordHistory(p, "plan", false);
      p.planAmended = true;
    }
    Object.assign(p, plan, {
      planHash: hash,
      updatedBy: c.userId,
      updatedAt: c.at,
      contributors: [...new Set([...p.contributors, c.userId])],
    });
    // A substantive change invalidates the review. Reviewed work goes back
    // for review, as a return sends it, so that restoring the reviewed plan
    // makes the execution current again but not the review.
    if (substantive) {
      p.revision++;
      if (p.state === "reviewed")
        p.state = p.execution?.assessment ? "evaluated" : "executed";
      p.review = undefined;
    }
    if (assignment) p.assignmentRevision = (p.assignmentRevision ?? 1) + 1;
  }
}
export const briefProgramCommands: Record<string, WorkflowHandler> = {
  async adoptWorkflow({ e, c, lead }) {
    lead();
    if (e.workflow) fail(409, "This engagement already uses the workflow");
    e.workflow = c.seedWorkflow(c.at);
    // Each procedure takes over its template's current paper, the required
    // one when diagnostic drafts share the template. Compiling its work later
    // supersedes that paper if it was signed (submitProcedure).
    for (const p of e.workflow.procedures) {
      const papers = e.papers.filter(
        (q) => q.templateId === p.templateId && paperCurrent(q),
      );
      p.paperId = (papers.find((q) => q.required) ?? papers[0])?.id;
    }
    return { workflow: "adopted" };
  },
  async saveBrief({ c, writer, lead, w, programDraft }, data) {
    writer();
    const a = briefFields.parse(data),
      x = w(),
      old = x.brief;
    if (a.periodStart > a.periodEnd)
      fail(400, "The audit period ends before it starts");
    if (old?.status === "approved") {
      lead();
      if (!a.changeImpact.trim())
        fail(400, "Explain the scope change and its impact");
    }
    if (old?.status === "submitted")
      fail(409, "Return the submitted scope before revising it");
    // A scope change needs the scope and the program submitted again.
    if (old?.status === "approved") scopeSubmittable(old);
    if (x.program.status !== "draft") programSubmittable(x.program);
    // An approved revision enters the history when a Lead revises it, and a
    // returned one did on its return; a draft that was never submitted is
    // superseded without an entry. An open return stays with the draft that
    // answers it.
    const returned =
      old?.returnReason === undefined
        ? {}
        : {
            returnReason: old.returnReason,
            returnedBy: old.returnedBy,
            returnedAt: old.returnedAt,
          };
    x.brief = {
      ...a,
      revision: (old?.revision ?? 0) + 1,
      status: "draft",
      contributors: [...new Set([...(old?.contributors ?? []), c.userId])],
      updatedBy: c.userId,
      updatedAt: c.at,
      ...returned,
      history:
        old?.status === "approved"
          ? [...old.history, snapshot(old)]
          : (old?.history ?? []),
    };
    if (x.program.status !== "draft") await programDraft();
    return { briefRevision: String(x.brief.revision) };
  },
  async submitBrief({ writer, w }) {
    writer();
    const b = w().brief ?? fail(400, "Complete the engagement brief first");
    if (b.status !== "draft") fail(409, "Only a scope draft can be submitted");
    scopeSubmittable(b);
    b.status = "submitted";
    // The resubmission answers the return the history keeps.
    delete b.returnReason;
    delete b.returnedBy;
    delete b.returnedAt;
    return { briefRevision: String(b.revision) };
  },
  async approveBrief({ c, independent, w }, data) {
    const b = w().brief ?? fail(400, "Complete the brief first");
    independent(b.contributors);
    const a = z
      .object({ revision: z.number().int(), reason: text })
      .strict()
      .parse(data);
    if (b.status !== "submitted" || b.revision !== a.revision)
      fail(409, "Review the submitted scope revision");
    b.approval = {
      userId: c.userId,
      at: c.at,
      revision: b.revision,
      hash: await c.sha256(
        JSON.stringify({ ...b, history: undefined, approval: undefined }),
      ),
      reason: a.reason,
    };
    b.status = "approved";
    return { briefRevision: String(b.revision) };
  },
  async returnBrief({ c, reviewer, w }, data) {
    reviewer();
    const a = z.object({ reason: text }).strict().parse(data);
    const b = w().brief ?? fail(400, "Complete the brief first");
    if (b.status !== "submitted") fail(409, "Return a submitted scope");
    // The reason is the reviewer's, never the preparer's change impact. The
    // returned revision enters the history with it.
    b.returnReason = a.reason;
    b.returnedBy = c.userId;
    b.returnedAt = c.at;
    b.history.push(snapshot(b));
    b.status = "draft";
    return { reason: a.reason };
  },
  async saveProcedurePlan(scope, data) {
    const { e, c, writer, lead, authorized, w, procedure } = scope;
    writer();
    const a = z
        .object({
          procedureId: short,
          // The assignment revision the plan was read at.
          assignmentRevision: z.number().int().positive(),
          plan: planFields,
        })
        .strict()
        .parse(data),
      p = procedure(a.procedureId);
    if (w().program.status !== "draft") lead();
    // The plan carries the preparer, reviewer and due date, which change
    // without the plan revision. A plan read before another change to them
    // would revert it, so it is refused as a conflict.
    if (a.assignmentRevision !== (p.assignmentRevision ?? 1))
      fail(
        409,
        "The preparer, reviewer or due date of " +
          p.title +
          " changed after this plan was opened. Reload and apply your changes again.",
      );
    if (a.plan.ownerId) {
      await authorized(a.plan.ownerId, ["Auditor", "Lead Auditor"]);
      if (a.plan.ownerId !== p.ownerId) assignable(w(), a.plan.ownerId);
    }
    if (a.plan.reviewerId) {
      await authorized(a.plan.reviewerId, ["Reviewer", "Lead Auditor"]);
      if (a.plan.reviewerId !== p.reviewerId)
        assignable(w(), a.plan.reviewerId);
      // Saving makes the editor a contributor, who cannot review it either.
      if (
        [a.plan.ownerId, c.userId, ...p.contributors].includes(
          a.plan.reviewerId,
        )
      )
        fail(
          400,
          "Choose a reviewer independent of this procedure's preparers",
        );
    }
    if (a.plan.modelId && !e.models.some((m) => m.id === a.plan.modelId))
      fail(400, "Choose a model from this engagement");
    if (
      a.plan.datasetId &&
      !e.artifacts.some(
        (q) =>
          q.id === a.plan.datasetId &&
          q.category === "Dataset" &&
          q.status === "accepted",
      )
    )
      fail(400, "Choose an accepted dataset from this engagement");
    if (
      a.plan.profileId &&
      !e.evaluationProfiles?.some((q) => q.id === a.plan.profileId)
    )
      fail(400, "Choose a protocol from this engagement");
    await revisePlans(scope, [{ p, plan: a.plan }]);
    return { procedureId: p.id };
  },
  async bulkPlanProcedures(scope, data) {
    const { c, writer, lead, authorized, w, procedure } = scope;
    writer();
    if (w().program.status !== "draft") lead();
    const a = z
      .object({
        procedureIds,
        patch: z
          .object({
            ownerId: uid.optional(),
            reviewerId: uid.optional(),
            dueDate: z.union([calendarDate, z.literal("")]).optional(),
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0, "Choose a planning change"),
      })
      .strict()
      .parse(data);
    const targets = a.procedureIds.map(procedure);
    for (const p of targets) {
      const owner = a.patch.ownerId ?? p.ownerId,
        review = a.patch.reviewerId ?? p.reviewerId;
      if (owner) {
        await authorized(owner, ["Auditor", "Lead Auditor"]);
        if (owner !== p.ownerId) assignable(w(), owner);
      }
      if (review) {
        await authorized(review, ["Reviewer", "Lead Auditor"]);
        if (review !== p.reviewerId) assignable(w(), review);
        if (
          review === owner ||
          p.contributors.includes(review) ||
          review === c.userId
        )
          fail(400, "Choose an independent reviewer for " + p.title);
      }
    }
    await revisePlans(
      scope,
      targets.map((p) => ({ p, plan: a.patch })),
    );
    return { count: String(targets.length) };
  },
  async scopeProgramCandidates(scope, data) {
    const { writer, lead, w, procedure } = scope;
    writer();
    if (w().program.status !== "draft") lead();
    const a = z
      .object({
        procedureIds,
        selected: z.boolean(),
        applicability: z.enum(["applicable", "readiness", "not_applicable"]),
        rationale: text,
        periodAnalysis: text,
      })
      .strict()
      .parse(data);
    const targets = a.procedureIds.map(procedure);
    await revisePlans(
      scope,
      targets.map((p) => ({
        p,
        plan: {
          selected: a.selected,
          applicability: a.applicability,
          rationale: a.rationale,
          periodAnalysis: a.periodAnalysis,
          criterion:
            p.criterion || "Approved engagement methodology: " + p.objective,
        },
      })),
    );
    return { count: String(targets.length) };
  },
  async submitProgram({ c, writer, authorized, w, programBindings }) {
    writer();
    const x = w();
    if (x.brief?.status !== "approved")
      fail(409, "Approve scope before the program");
    if (x.program.status !== "draft")
      fail(409, "Only a draft program can be submitted");
    programSubmittable(x.program);
    if (!x.procedures.some(inScope))
      fail(400, "Select at least one applicable or readiness procedure");
    for (const p of x.procedures) {
      if (
        p.applicability === "pending" ||
        !p.rationale.trim() ||
        !p.periodAnalysis.trim() ||
        !p.criterion.trim()
      )
        fail(
          400,
          p.templateId +
            ": record applicability, criterion, period analysis and scope rationale",
        );
      // A release-time record (WP-RP-02, MEM-SO-01) is recorded by the
      // release against the final package: nobody prepares or reviews it, so
      // it needs no assignment, deadline, population or sampling. Any
      // assignment it does carry must still be eligible and independent.
      if (inScope(p) && isReleaseTimeRecord(p.templateId)) {
        if (p.ownerId) await authorized(p.ownerId, ["Auditor", "Lead Auditor"]);
        if (p.reviewerId)
          await authorized(p.reviewerId, ["Reviewer", "Lead Auditor"]);
        if (
          p.reviewerId &&
          (p.reviewerId === p.ownerId || p.contributors.includes(p.reviewerId))
        )
          fail(400, p.templateId + ": reviewer must be independent");
      } else if (inScope(p)) {
        if (!p.population.trim() || !p.sampling.trim() || !p.dueDate)
          fail(
            400,
            p.templateId +
              ": record " +
              lacking([
                [!p.population.trim(), "population"],
                [!p.sampling.trim(), "sampling"],
                [!p.dueDate, "a due date"],
              ]),
          );
        await authorized(p.ownerId, ["Auditor", "Lead Auditor"]);
        await authorized(p.reviewerId, ["Reviewer", "Lead Auditor"]);
        if (p.reviewerId === p.ownerId || p.contributors.includes(p.reviewerId))
          fail(400, p.templateId + ": reviewer must be independent");
        if (
          p.method !== "manual" &&
          (!p.modelId || !p.datasetId || !p.profileId)
        )
          fail(
            400,
            p.templateId +
              ": pin model, dataset and protocol for automated work",
          );
      }
    }
    x.program.status = "submitted";
    x.program.briefRevision = x.brief.revision;
    // Each plan is now as submitted; its next change keeps it in the history.
    for (const p of x.procedures) delete p.planAmended;
    x.program.history.push({
      revision: x.program.revision,
      briefRevision: x.brief.revision,
      status: "submitted",
      procedureRevisions: await programBindings(),
      at: c.at,
      actor: c.userId,
    });
    return { programRevision: String(x.program.revision) };
  },
  async approveProgram({ c, independent, w, programBindings }, data) {
    const x = w();
    independent(x.program.contributors);
    const a = z
      .object({ revision: z.number().int(), reason: text })
      .strict()
      .parse(data);
    if (
      x.program.status !== "submitted" ||
      x.program.revision !== a.revision ||
      x.program.briefRevision !== x.brief?.revision ||
      x.brief?.status !== "approved"
    )
      fail(409, "Review the current submitted program against approved scope");
    // The approval binds each procedure's plan revision and hash, the list
    // its history entry records.
    const procedureRevisions = await programBindings();
    x.program.approval = {
      userId: c.userId,
      at: c.at,
      revision: x.program.revision,
      hash: await c.sha256(JSON.stringify(procedureRevisions)),
      reason: a.reason,
    };
    x.program.status = "approved";
    x.program.history.push({
      revision: x.program.revision,
      briefRevision: x.program.briefRevision,
      status: "approved",
      approval: x.program.approval,
      procedureRevisions,
      at: c.at,
      actor: c.userId,
    });
    return { programRevision: String(x.program.revision) };
  },
  async returnProgram({ c, reviewer, w, programBindings }, data) {
    reviewer();
    const a = z.object({ reason: text }).strict().parse(data),
      p = w().program;
    if (p.status !== "submitted") fail(409, "Return a submitted program");
    // A return is never refused, even the one that uses up the limit. Work
    // continues on the next revision, and the reviewer does not become one
    // of the program's preparers.
    p.history.push({
      revision: p.revision,
      briefRevision: p.briefRevision,
      status: "returned",
      reason: a.reason,
      procedureRevisions: await programBindings(),
      at: c.at,
      actor: c.userId,
    });
    p.revision++;
    p.status = "draft";
    p.updatedBy = c.userId;
    p.updatedAt = c.at;
    return { reason: a.reason };
  },
};
