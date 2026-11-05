// Execution commands: performing, evaluating and submitting a procedure
// of the approved program, its independent review or return, and the
// working paper its work compiles into. Work binds the procedure's plan
// hash and the scope revision (see currentExecution), so it stays current
// across other procedures' changes and assignment changes.
//
// The procedure's history limit refuses only redoing current work. The
// first execution, the first evaluation of each execution, a new execution
// or impact review of work that a plan or scope change made stale, and
// returns are never refused: approved plan and scope revisions, and the
// reviewer's decisions, bound how often those happen.
import { z } from "zod";
import {
  currentExecution,
  executionPlanCurrent,
  runBindsProcedure,
} from "../workflow-state";
import { fail, optional, short, text, type WorkflowHandler } from "./command";
export const procedureCommands: Record<string, WorkflowHandler> = {
  async ensureProcedurePaper({ e, c, writer, procedure }, data) {
    writer();
    const a = z.object({ procedureId: short }).strict().parse(data),
      p = procedure(a.procedureId);
    let q = e.papers.find((q) => q.id === p.paperId);
    if (!q) {
      q = c.makePaper(p.templateId);
      q.required = false;
      q.body.scope = p.population;
      q.body.criteria = p.criterion;
      e.papers.push(q);
      p.paperId = q.id;
    }
    return { paperId: q.id, procedureId: p.id };
  },
  async recordProcedureExecution(
    { e, c, writer, procedure, accepted, ready, recordHistory, ensurePlanHash },
    data,
  ) {
    writer();
    const x = ready(),
      a = z
        .object({
          procedureId: short,
          performed: text,
          steps: z
            .array(
              z.object({
                id: short,
                state: z.enum(["performed", "not_performed"]),
                notes: optional,
              }),
            )
            .min(1)
            .max(30),
          sampling: text,
          results: text,
          limitations: optional,
          evidenceIds: z.array(short).min(1).max(100),
          runIds: z.array(short).max(30),
        })
        .strict()
        .parse(data),
      p = procedure(a.procedureId);
    if (!p.selected || !["applicable", "readiness"].includes(p.applicability))
      fail(409, "This procedure is outside the approved execution program");
    if (p.ownerId !== c.userId && c.role !== "Lead Auditor")
      fail(403, "The assigned preparer or Lead must record execution");
    if (p.state === "submitted")
      fail(409, "Resolve the submitted review before changing execution");
    accepted(a.evidenceIds);
    if (
      a.steps.length !== p.instructions.length ||
      new Set(a.steps.map((s) => s.id)).size !== p.instructions.length ||
      a.steps.some(
        (s) =>
          !p.instructions.some((i) => i.id === s.id) ||
          (s.state === "not_performed" && !s.notes.trim()),
      )
    )
      fail(400, "Record every planned step once; explain omitted work");
    if (p.method !== "manual" && !a.runIds.length)
      fail(400, "Include the planned automated evaluation");
    // A run queued under an earlier program revision still counts while
    // this procedure's plan revision and the scope are unchanged.
    for (const runId of a.runIds) {
      const r = e.runs.find((r) => r.id === runId);
      if (
        !r ||
        r.state !== "succeeded" ||
        !r.procedureBinding ||
        (await c.sha256(JSON.stringify(r.procedureBinding))) !==
          r.provenance.inputHashes.auditBinding ||
        !runBindsProcedure(e, p, r) ||
        r.modelId !== p.modelId ||
        r.datasetId !== p.datasetId ||
        r.profileId !== p.profileId
      )
        fail(
          400,
          "Link completed runs bound to this approved procedure and scope",
        );
    }
    recordHistory(p, "execute", !!p.execution && currentExecution(e, p));
    const { procedureId, ...actual } = a;
    p.execution = {
      ...actual,
      id: c.id("EXEC"),
      revision: (p.execution?.revision ?? 0) + 1,
      procedureRevision: p.revision,
      planHash: await ensurePlanHash(p),
      briefRevision: x.brief!.revision,
      programRevision: x.program.revision,
      actor: c.userId,
      at: c.at,
    };
    p.state = "executed";
    p.review = undefined;
    p.contributors = [...new Set([...p.contributors, c.userId])];
    return { procedureId: p.id };
  },
  async evaluateProcedure(
    { e, c, writer, procedure, accepted, ready, recordHistory },
    data,
  ) {
    writer();
    ready();
    const a = z
        .object({
          procedureId: short,
          relevance: text,
          reliability: text,
          coverage: text,
          contradictions: text,
          conclusion: text,
          outcome: z.enum(["supported", "qualified", "not_supported"]),
        })
        .strict()
        .parse(data),
      p = procedure(a.procedureId);
    if (!p.execution || !currentExecution(e, p) || p.state === "submitted")
      fail(409, "Record current execution before evaluation");
    accepted(p.execution.evidenceIds);
    recordHistory(p, "evaluate", !!p.execution.assessment);
    const { procedureId, ...assessment } = a;
    p.execution.assessment = { ...assessment, actor: c.userId, at: c.at };
    p.state = "evaluated";
    p.review = undefined;
    p.contributors = [...new Set([...p.contributors, c.userId])];
    return { procedureId: p.id };
  },
  async reaffirmExecution(
    { e, c, independent, w, procedure, accepted, ready, recordHistory },
    data,
  ) {
    ready();
    const a = z
        .object({ procedureId: short, reason: text })
        .strict()
        .parse(data),
      p = procedure(a.procedureId);
    independent(p.contributors);
    if (!p.execution || !executionPlanCurrent(p))
      fail(409, "A changed procedure plan requires a new execution");
    accepted(p.execution.evidenceIds);
    recordHistory(p, "reaffirm", currentExecution(e, p));
    p.execution.impactReview = {
      briefRevision: w().brief!.revision,
      programRevision: w().program.revision,
      actor: c.userId,
      at: c.at,
      reason: a.reason,
    };
    p.state = p.execution.assessment ? "evaluated" : "executed";
    p.review = undefined;
    return { procedureId: p.id };
  },
  async submitProcedure({ e, c, writer, w, procedure, accepted, ready }, data) {
    writer();
    ready();
    const a = z.object({ procedureId: short }).strict().parse(data),
      p = procedure(a.procedureId),
      v = p.execution;
    if (p.state !== "evaluated" || !v?.assessment || !currentExecution(e, p))
      fail(409, "Evaluate current execution before review");
    accepted(v.evidenceIds);
    const pending = e.evidenceRequests?.filter(
      (r) =>
        r.paperIds.includes(p.paperId ?? "") &&
        !["accepted", "waived"].includes(r.status),
    );
    if (pending?.length)
      fail(400, "Resolve related evidence requests before procedure review");
    let paper = e.papers.find((q) => q.id === p.paperId);
    if (paper?.comments.some((q) => !q.resolved))
      fail(400, "Respond to and resolve open review questions");
    if (!paper || paper.status === "signed") {
      paper = c.makePaper(p.templateId);
      e.papers.push(paper);
      p.paperId = paper.id;
    } else {
      paper.history.push({
        revision: paper.revision,
        body: { ...paper.body },
        authorId: paper.authorId,
        at: paper.updatedAt,
        evidenceIds: [...paper.evidenceIds],
        runIds: [...paper.runIds],
        reviews: [...paper.reviews],
        signatures: [...paper.signatures],
        contributors: [...paper.contributors],
      });
      paper.revision++;
    }
    paper.authorId = c.userId;
    paper.contributors = [
      ...new Set([...paper.contributors, ...p.contributors]),
    ];
    paper.body = {
      objective: p.objective,
      scope:
        p.population +
        "\nApproved engagement brief revision " +
        w().brief!.revision,
      criteria:
        p.criterion + "\nSource " + p.sourceVersion + "\n" + p.periodAnalysis,
      procedures:
        v.performed +
        "\n" +
        v.steps
          .map(
            (s) =>
              p.instructions.find((i) => i.id === s.id)?.text +
              ": " +
              s.state +
              " " +
              s.notes,
          )
          .join("\n"),
      sampling: v.sampling,
      results:
        v.results +
        "\nRelevance: " +
        v.assessment.relevance +
        "\nReliability: " +
        v.assessment.reliability +
        "\nCoverage: " +
        v.assessment.coverage +
        "\nContradictions: " +
        v.assessment.contradictions,
      limitations: v.limitations,
      conclusion: v.assessment.conclusion,
      conclusionStatus: v.assessment.outcome,
    };
    paper.plannedGuidance = p.instructions.map((i) => i.text).join("\n");
    paper.evidenceIds = [...v.evidenceIds];
    paper.runIds = [...v.runIds];
    paper.required = p.stage !== "Remediation and Monitoring";
    paper.status = "in_review";
    paper.updatedAt = c.at;
    paper.reviews = [];
    paper.signatures = [];
    p.paperRevision = paper.revision;
    p.state = "submitted";
    return { procedureId: p.id, paperId: paper.id };
  },
  async reviewProcedure({ e, c, independent, procedure, ready }, data) {
    const a = z
        .object({ procedureId: short, reason: text })
        .strict()
        .parse(data),
      p = procedure(a.procedureId);
    independent(p.contributors);
    if (p.reviewerId !== c.userId)
      fail(
        403,
        "Only the assigned independent reviewer can approve this procedure",
      );
    ready();
    const paper = e.papers.find((q) => q.id === p.paperId);
    if (
      p.state !== "submitted" ||
      !currentExecution(e, p) ||
      !paper ||
      paper.revision !== p.paperRevision ||
      paper.status !== "in_review" ||
      paper.comments.some((q) => !q.resolved)
    )
      fail(
        409,
        "Review the current submitted revision with resolved questions",
      );
    if (paper.contributors.includes(c.userId) || paper.authorId === c.userId)
      fail(403, "The paper reviewer must be independent");
    paper.reviews.push({
      userId: c.userId,
      revision: paper.revision,
      at: c.at,
    });
    paper.status = "reviewed";
    p.review = {
      userId: c.userId,
      at: c.at,
      revision: p.revision,
      hash: await c.sha256(JSON.stringify(p.execution)),
      reason: a.reason,
    };
    p.state = "reviewed";
    return { procedureId: p.id, paperId: paper.id };
  },
  async returnProcedure({ e, c, independent, procedure, recordHistory }, data) {
    const a = z
        .object({ procedureId: short, reason: text })
        .strict()
        .parse(data),
      p = procedure(a.procedureId);
    independent(p.contributors);
    if (p.reviewerId !== c.userId || p.state !== "submitted")
      fail(409, "The assigned reviewer can return submitted work");
    recordHistory(p, "return", false);
    p.state = p.execution?.assessment ? "evaluated" : "executed";
    p.review = undefined;
    const q = e.papers.find((q) => q.id === p.paperId);
    if (q) {
      q.comments.push({
        id: c.id("COMMENT"),
        authorId: c.userId,
        text: a.reason,
        resolved: false,
        createdAt: c.at,
      });
      q.status = "draft";
      q.reviews = [];
      q.signatures = [];
    }
    return { procedureId: p.id };
  },
};
