// Planning commands: the engagement brief (the agreed scope), the
// procedure plans that make up the audit program, and the program's
// submission, independent approval and return.
import { z } from "zod";
import { seedWorkflow } from "../workflow-seed";
import {
  calendarDate,
  fail,
  optional,
  plan,
  short,
  snapshot,
  text,
  uid,
  type WorkflowHandler,
} from "./command";
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
    independence: text,
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
export const briefProgramCommands: Record<string, WorkflowHandler> = {
  async adoptWorkflow({ e, c, lead }) {
    lead();
    if (e.workflow) fail(409, "This engagement already uses the workflow");
    e.workflow = seedWorkflow(c.userId, c.at);
    for (const p of e.workflow.procedures)
      p.paperId = e.papers.find((q) => q.templateId === p.templateId)?.id;
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
    if (old && old.history.length >= 40)
      fail(413, "Scope revision limit reached");
    const history = old ? [...old.history, snapshot(old)] : [];
    x.brief = {
      ...a,
      revision: (old?.revision ?? 0) + 1,
      status: "draft",
      contributors: [...new Set([...(old?.contributors ?? []), c.userId])],
      updatedBy: c.userId,
      updatedAt: c.at,
      history,
    };
    if (x.program.status !== "draft") programDraft();
    return { briefRevision: String(x.brief.revision) };
  },
  async submitBrief({ writer, w }) {
    writer();
    const b = w().brief ?? fail(400, "Complete the engagement brief first");
    if (b.status !== "draft") fail(409, "Only a scope draft can be submitted");
    b.status = "submitted";
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
  async returnBrief({ reviewer, w }, data) {
    reviewer();
    const a = z.object({ reason: text }).strict().parse(data),
      x = w();
    const b = x.brief ?? fail(400, "Complete the brief first");
    if (b.status !== "submitted") fail(409, "Return a submitted scope");
    b.history.push(snapshot(b));
    b.status = "draft";
    b.approval = undefined;
    b.changeImpact = a.reason;
    return { reason: a.reason };
  },
  async saveProcedurePlan(
    {
      e,
      c,
      writer,
      lead,
      authorized,
      w,
      procedure,
      recordHistory,
      programDraft,
    },
    data,
  ) {
    writer();
    const a = z
        .object({ procedureId: short, plan: planFields })
        .strict()
        .parse(data),
      p = procedure(a.procedureId),
      x = w();
    if (x.program.status !== "draft") lead();
    if (a.plan.ownerId)
      await authorized(a.plan.ownerId, ["Auditor", "Lead Auditor"]);
    if (a.plan.reviewerId) {
      await authorized(a.plan.reviewerId, ["Reviewer", "Lead Auditor"]);
      if (
        a.plan.reviewerId === a.plan.ownerId ||
        p.contributors.includes(a.plan.reviewerId)
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
    recordHistory(p);
    p.revision++;
    Object.assign(p, a.plan, {
      updatedBy: c.userId,
      updatedAt: c.at,
      contributors: [...new Set([...p.contributors, c.userId])],
      review: undefined,
    });
    programDraft();
    return { procedureId: p.id };
  },
  async bulkPlanProcedures(
    { c, writer, lead, authorized, w, procedure, recordHistory, programDraft },
    data,
  ) {
    writer();
    const x = w();
    if (x.program.status !== "draft") lead();
    const a = z
      .object({
        procedureIds: z
          .array(short)
          .min(1)
          .max(40)
          .refine(
            (v) => new Set(v).size === v.length,
            "Choose each procedure once",
          ),
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
    if (
      x.program.history.length >= 150 ||
      targets.some((p) => p.history.length >= 30)
    )
      fail(413, "Revision limit reached");
    for (const p of targets) {
      const owner = a.patch.ownerId ?? p.ownerId,
        review = a.patch.reviewerId ?? p.reviewerId;
      if (owner) await authorized(owner, ["Auditor", "Lead Auditor"]);
      if (review) {
        await authorized(review, ["Reviewer", "Lead Auditor"]);
        if (
          review === owner ||
          p.contributors.includes(review) ||
          review === c.userId
        )
          fail(400, "Choose an independent reviewer for " + p.title);
      }
    }
    for (const p of targets) {
      recordHistory(p);
      Object.assign(p, a.patch, {
        revision: p.revision + 1,
        review: undefined,
        updatedBy: c.userId,
        updatedAt: c.at,
        contributors: [...new Set([...p.contributors, c.userId])],
      });
    }
    programDraft();
    return { count: String(targets.length) };
  },
  async scopeProgramCandidates(
    { c, writer, lead, w, procedure, recordHistory, programDraft },
    data,
  ) {
    writer();
    const x = w();
    if (x.program.status !== "draft") lead();
    const a = z
      .object({
        procedureIds: z
          .array(short)
          .min(1)
          .max(40)
          .refine(
            (v) => new Set(v).size === v.length,
            "Choose each procedure once",
          ),
        selected: z.boolean(),
        applicability: z.enum(["applicable", "readiness", "not_applicable"]),
        rationale: text,
        periodAnalysis: text,
      })
      .strict()
      .parse(data);
    for (const pid of a.procedureIds) {
      const p = procedure(pid);
      recordHistory(p);
      Object.assign(p, {
        selected: a.selected,
        applicability: a.applicability,
        rationale: a.rationale,
        periodAnalysis: a.periodAnalysis,
        criterion:
          p.criterion || "Approved engagement methodology: " + p.objective,
        revision: p.revision + 1,
        review: undefined,
        updatedBy: c.userId,
        updatedAt: c.at,
        contributors: [...new Set([...p.contributors, c.userId])],
      });
    }
    programDraft();
    return { count: String(a.procedureIds.length) };
  },
  async submitProgram({ writer, authorized, w }) {
    writer();
    const x = w();
    if (x.brief?.status !== "approved")
      fail(409, "Approve scope before the program");
    if (x.program.status !== "draft")
      fail(409, "Only a draft program can be submitted");
    if (
      !x.procedures.some(
        (p) =>
          p.selected && ["applicable", "readiness"].includes(p.applicability),
      )
    )
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
      if (p.selected && ["applicable", "readiness"].includes(p.applicability)) {
        if (!p.population.trim() || !p.sampling.trim() || !p.dueDate)
          fail(
            400,
            p.templateId + ": record population, sampling and deadline",
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
    return { programRevision: String(x.program.revision) };
  },
  async approveProgram({ c, independent, w }, data) {
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
    x.program.approval = {
      userId: c.userId,
      at: c.at,
      revision: x.program.revision,
      hash: await c.sha256(
        JSON.stringify(
          x.procedures.map((p) => ({
            id: p.id,
            revision: p.revision,
            plan: plan(p),
          })),
        ),
      ),
      reason: a.reason,
    };
    x.program.status = "approved";
    return { programRevision: String(x.program.revision) };
  },
  async returnProgram({ reviewer, w, programDraft }, data) {
    reviewer();
    const a = z.object({ reason: text }).strict().parse(data),
      x = w();
    if (x.program.status !== "submitted")
      fail(409, "Return a submitted program");
    const contributors = [...x.program.contributors];
    programDraft();
    x.program.contributors = contributors;
    return { reason: a.reason };
  },
};
