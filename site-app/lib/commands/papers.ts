import { z } from "zod";
import { isReleaseTimeRecord, releaseTimeMessage } from "../domain/gates";
import type { Engagement, Paper } from "../domain/types";
import { id, now, sha256 } from "../ids";
import { managementSystemView, pinned } from "../criteria/pin";
import { earlierPhasePapers } from "../domain/management-system";
import { templatePaper } from "../factories";
import { procedureGenaiBlockers } from "../genai/readiness";
import { linkedReadiness } from "../genai/store";
import { ApiError } from "../http";
import { defineCommands } from "./command";
import { short, text } from "./fields";
/**
 * The paper a command changes. A superseded paper stays as it was signed and
 * a retired limitation memo changes only when its evidence request is closed
 * again, so neither can be changed here.
 */
function paper(e: Engagement, value: unknown) {
  const p = e.papers.find((p) => p.id === value);
  if (!p) throw new ApiError(404, "Working paper not found");
  if (p.supersededBy)
    throw new ApiError(
      409,
      "This signed paper was superseded by " +
        p.supersededBy +
        " and stays as it was signed",
    );
  if (p.retired)
    throw new ApiError(
      409,
      "This limitation memo was retired when its evidence request was reopened; close the request again to revise it",
    );
  return p;
}
/**
 * A paper that is prepared, reviewed and signed here. The release-time
 * records are recorded by the release against the approved package hashes,
 * so a change to them after capture would change the captured package.
 */
function workingPaper(e: Engagement, value: unknown) {
  const p = paper(e, value);
  if (isReleaseTimeRecord(p.templateId))
    throw new ApiError(409, releaseTimeMessage(p.templateId));
  return p;
}
function archive(p: Paper, actor: string) {
  p.history.push({
    revision: p.revision,
    body: { ...p.body },
    authorId: p.authorId,
    at: p.updatedAt,
    evidenceIds: [...p.evidenceIds],
    runIds: [...p.runIds],
    reviews: [...p.reviews],
    signatures: [...p.signatures],
    contributors: [...(p.contributors ?? [])],
  });
  p.revision++;
  p.authorId = actor;
  p.updatedAt = now();
  p.status = "draft";
  p.reviews = [];
  p.signatures = [];
}
/** Working papers: drafting, the review and sign-off cycle, and review comments. */
export const papers = defineCommands({
  createPaper: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const a = z.object({ templateId: short }).parse(d);
      if (isReleaseTimeRecord(a.templateId))
        throw new ApiError(409, releaseTimeMessage(a.templateId));
      const p = templatePaper(pinned(e), a.templateId, ctx.user.userId);
      e.papers.push(p);
      return { details: { paperId: p.id } };
    },
  },
  editPaper: {
    roles: ["Auditor", "Lead Auditor"],
    async handle(e, d, ctx) {
      const a = z
          .object({
            paperId: short,
            body: z.object({
              objective: z.string().max(20000),
              scope: z.string().max(20000),
              criteria: z.string().max(20000),
              procedures: z.string().max(20000),
              sampling: z.string().max(20000),
              results: z.string().max(30000),
              limitations: z.string().max(20000),
              conclusion: z.string().max(20000),
              conclusionStatus: z.enum([
                "not_evaluated",
                "supported",
                "qualified",
                "not_supported",
                "not_applicable",
              ]),
            }),
            evidenceIds: z.array(short).max(100),
            required: z.boolean(),
          })
          .parse(d),
        p = workingPaper(e, a.paperId);
      if (
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        )
      )
        throw new ApiError(
          409,
          "Update the source procedure execution and evaluation, then compile a new working-paper revision",
        );
      if (p.status === "signed")
        throw new ApiError(409, "Reopen the signed paper before changing it");
      if (
        a.evidenceIds.some(
          (v) =>
            !e.artifacts.some((t) => t.id === v && t.status === "accepted"),
        )
      )
        throw new ApiError(400, "Link accepted evidence from this engagement");
      // The GenAI gate applies to a free paper as to a procedure's
      // (docs/design/genai-evidence.md section 12.3).
      if (["supported", "qualified"].includes(a.body.conclusionStatus)) {
        const blockers = procedureGenaiBlockers(
          p.templateId,
          await linkedReadiness(ctx, e, a.evidenceIds),
        );
        if (blockers.length)
          throw new ApiError(
            400,
            "The linked GenAI evidence cannot support this conclusion yet (" +
              [...new Set(blockers.map((b) => b.code))].join(", ") +
              ")",
          );
      }
      // An existing supplementary paper is not an applicability exclusion. Removing a required paper or recording not-applicable remains Lead-controlled.
      const supplementary =
        !p.required &&
        p.body.conclusionStatus !== "not_applicable" &&
        a.body.conclusionStatus !== "not_applicable";
      if (!a.required && !supplementary && ctx.role !== "Lead Auditor")
        throw new ApiError(
          403,
          "Only a Lead Auditor can approve applicability exclusions",
        );
      if (
        !a.required &&
        !supplementary &&
        (a.body.conclusionStatus !== "not_applicable" ||
          !a.body.conclusion.trim() ||
          !a.body.criteria.trim())
      )
        throw new ApiError(
          400,
          "An applicability exclusion needs criteria and a reasoned not-applicable conclusion",
        );
      archive(p, ctx.user.userId);
      p.contributors = [
        ...new Set([...(p.contributors ?? []), ctx.user.userId]),
      ];
      p.body = a.body;
      p.evidenceIds = a.evidenceIds;
      p.required = a.required;
      return { details: { paperId: p.id, revision: p.revision } };
    },
  },
  reopenPaper: {
    roles: ["Lead Auditor"],
    handle(e, d, ctx) {
      const p = workingPaper(e, d.paperId),
        authorId = p.authorId;
      if (
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        )
      )
        throw new ApiError(
          409,
          "Record new work in the source procedure to preserve this signed revision",
        );
      archive(p, ctx.user.userId);
      p.authorId = authorId;
      return { details: { paperId: p.id, revision: p.revision } };
    },
  },
  submitPaper: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d) {
      const p = workingPaper(e, d.paperId);
      if (
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        )
      )
        throw new ApiError(
          409,
          "Submit the compiled working paper through its source procedure",
        );
      if (p.status !== "draft")
        throw new ApiError(409, "Only a draft can be submitted");
      if (
        !p.body.conclusion.trim() ||
        p.body.conclusionStatus === "not_evaluated" ||
        !p.body.results.trim() ||
        !p.evidenceIds.length
      )
        throw new ApiError(
          400,
          "Record results, a reasoned conclusion and accepted evidence before submission",
        );
      if (p.comments.some((c) => !c.resolved))
        throw new ApiError(400, "Resolve reviewer comments first");
      p.status = "in_review";
      return { details: { paperId: p.id, revision: p.revision } };
    },
  },
  reviewPaper: {
    roles: ["Reviewer", "Lead Auditor"],
    handle(e, d, ctx) {
      const p = workingPaper(e, d.paperId);
      if (e.workflow?.procedures.some((q) => q.paperId === p.id))
        throw new ApiError(
          409,
          "Review the bound procedure from the audit program",
        );
      if (
        p.authorId === ctx.user.userId ||
        (p.contributors ?? []).includes(ctx.user.userId)
      )
        throw new ApiError(403, "The author cannot review their own paper");
      if (p.status !== "in_review")
        throw new ApiError(409, "Submit the paper for review first");
      if (p.comments.some((c) => !c.resolved))
        throw new ApiError(400, "Unresolved reviewer comments block review");
      p.reviews.push({
        userId: ctx.user.userId,
        revision: p.revision,
        at: now(),
      });
      p.status = "reviewed";
      return { details: { paperId: p.id, revision: p.revision } };
    },
  },
  signPaper: {
    roles: ["Lead Auditor"],
    async handle(e, d, ctx) {
      const p = workingPaper(e, d.paperId);
      if (p.status === "signed")
        throw new ApiError(409, "This paper is already signed");
      if (
        p.status !== "reviewed" ||
        !p.reviews.some(
          (r) =>
            r.revision === p.revision &&
            r.userId !== p.authorId &&
            r.userId !== ctx.user.userId,
        )
      )
        throw new ApiError(
          400,
          "Independent review of the current revision is required",
        );
      if (p.comments.some((c) => !c.resolved))
        throw new ApiError(400, "Unresolved comments block sign-off");
      // Programme phases (#28): Stage 2 work is signed once Stage 1 is.
      const phases = managementSystemView(pinned(e))?.phases ?? [];
      const earlier = earlierPhasePapers(e, phases, p);
      if (earlier.length)
        throw new ApiError(
          409,
          "Sign the papers of the earlier programme phase first: " +
            earlier.map((q) => q.templateId).join(", "),
        );
      const hash = await sha256(
        JSON.stringify({
          body: p.body,
          revision: p.revision,
          evidenceIds: p.evidenceIds,
          runIds: p.runIds,
        }),
      );
      p.signatures.push({
        userId: ctx.user.userId,
        revision: p.revision,
        at: now(),
        hash,
      });
      p.status = "signed";
      return { details: { paperId: p.id, revision: p.revision, hash } };
    },
  },
  comment: {
    roles: ["Reviewer", "Lead Auditor", "Auditor"],
    handle(e, d, ctx) {
      const a = z.object({ paperId: short, text }).parse(d),
        p = paper(e, a.paperId);
      if (p.status === "signed")
        throw new ApiError(
          409,
          "Reopen the signed paper to add a review comment",
        );
      p.comments.push({
        id: id("COMMENT"),
        authorId: ctx.user.userId,
        text: a.text,
        resolved: false,
        createdAt: now(),
      });
      p.status = "draft";
      p.reviews = [];
      p.signatures = [];
      const bound = e.workflow?.procedures.find((q) => q.paperId === p.id);
      if (bound) {
        bound.state = bound.execution?.assessment ? "evaluated" : "executed";
        bound.review = undefined;
      }
      return { details: { paperId: p.id } };
    },
  },
  respondComment: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const a = z
          .object({ paperId: short, commentId: short, text })
          .strict()
          .parse(d),
        p = paper(e, a.paperId),
        c = p.comments.find((c) => c.id === a.commentId);
      if (!c || c.resolved || p.status === "signed")
        throw new ApiError(409, "Respond to an open review question");
      c.responses ??= [];
      if (c.responses.length >= 30)
        throw new ApiError(413, "Comment response limit reached");
      c.responses.push({ actor: ctx.user.userId, at: now(), text: a.text });
      return { details: { paperId: p.id, commentId: c.id } };
    },
  },
  resolveComment: {
    roles: ["Reviewer", "Lead Auditor", "Auditor"],
    handle(e, d, ctx) {
      const p = paper(e, d.paperId),
        c = p.comments.find((c) => c.id === d.commentId);
      if (!c) throw new ApiError(404, "Comment not found");
      if (c.authorId !== ctx.user.userId)
        throw new ApiError(403, "The comment author must confirm resolution");
      if (!c.responses?.length)
        throw new ApiError(
          400,
          "Record a preparer response before confirming resolution",
        );
      c.resolved = true;
      c.resolvedAt = now();
      return { details: { paperId: p.id, commentId: c.id } };
    },
  },
});
