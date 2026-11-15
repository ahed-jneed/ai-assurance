import { z } from "zod";
import {
  defaultFindingCriteria,
  findingArticleOf,
  findingCriteriaRefs,
  pinned,
  primaryReferenceOf,
} from "../criteria/pin";
import { risk } from "../domain/risk";
import type { Finding } from "../domain/types";
import { id, now } from "../ids";
import { ApiError } from "../http";
import { closeFindingRefusal } from "../permissions";
import { defineCommands } from "./command";
import { short, text } from "./fields";
/** Requirement references such as "eu-ai-act:AIA-ART-9" (at most 20). */
const criteriaRefs = z
  .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}:[^\s:]{1,128}$/))
  .max(20);
/** Findings: raising them, tracking remediation and closing them after an independent retest. */
export const findings = defineCommands({
  createFinding: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const a = z
          .object({
            title: short,
            // Optional when the finding names its criteria: its primary
            // reference is then the first criterion's (#144).
            article: short.optional(),
            condition: text,
            criteria: text,
            cause: z.string().max(5000),
            effect: text,
            likelihood: z.number().int().min(1).max(5),
            impact: z.number().int().min(1).max(5),
            owner: short,
            dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            visibility: z.enum(["internal", "client"]),
            procedureId: short.optional(),
            criteriaRefs: criteriaRefs.optional(),
          })
          .parse(d),
        { criteriaRefs: refs, ...fields } = a,
        f: Finding = {
          ...fields,
          article: fields.article ?? "",
          ...risk(a.likelihood, a.impact),
          id: id("F"),
          status: "open" as const,
          response: "",
          remediation: "",
          retestEvidenceIds: [],
          createdBy: ctx.user.userId,
        };
      if (a.procedureId) {
        const p = e.workflow?.procedures.find((p) => p.id === a.procedureId);
        if (
          !p?.execution ||
          p.execution.evidenceIds.some(
            (id) =>
              !e.artifacts.some((a) => a.id === id && a.status === "accepted"),
          )
        )
          throw new ApiError(
            400,
            "Finding origin requires a procedure with accepted execution evidence",
          );
        Object.assign(f, {
          support: {
            findingId: f.id,
            procedureId: p.id,
            paperIds: p.paperId ? [p.paperId] : [],
            evidenceIds: [...p.execution.evidenceIds],
            runIds: [...p.execution.runIds],
            actor: ctx.user.userId,
            at: now(),
          },
        });
      }
      // The criteria the finding concerns (docs/design/criteria-model.md
      // section 7, phase 2): as given, or those of its procedure's item.
      const chosen = refs?.length
        ? findingCriteriaRefs(e, refs)
        : a.procedureId
          ? defaultFindingCriteria(
              e,
              e.workflow!.procedures.find((p) => p.id === a.procedureId)!
                .templateId,
            )
          : [];
      if (chosen.length) f.criteriaRefs = chosen;
      if (!f.article) {
        const first = primaryReferenceOf(pinned(e).pack, chosen);
        const article = first ? findingArticleOf(e, first) : undefined;
        if (!article)
          throw new ApiError(
            400,
            "State the finding's primary reference: an article or a criterion of the pack",
          );
        f.article = article;
      }
      e.findings.push(f);
      return { details: { findingId: f.id, riskScore: f.riskScore } };
    },
  },
  updateFinding: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const a = z
          .object({
            findingId: short,
            status: z.enum(["open", "in_progress", "ready_for_retest"]),
            response: z.string().max(15000),
            remediation: z.string().max(15000),
            retestEvidenceIds: z.array(short).max(100),
          })
          .parse(d),
        f = e.findings.find((f) => f.id === a.findingId);
      if (!f) throw new ApiError(404, "Finding not found");
      if (f.status === "closed")
        throw new ApiError(
          409,
          "A closed finding needs a new re-opening decision",
        );
      if (
        a.retestEvidenceIds.some(
          (v) =>
            !e.artifacts.some((t) => t.id === v && t.status === "accepted"),
        )
      )
        throw new ApiError(400, "Retest evidence must be accepted");
      Object.assign(f, a, {
        remediationBy: ctx.user.userId,
        remediationAt: now(),
        retest: undefined,
      });
      return { details: { findingId: f.id, status: f.status } };
    },
  },
  /**
   * Sets the criteria a finding concerns, for example on a finding recorded
   * before phase 2. Not remediation: it leaves the remediation author and
   * any retest as they are. An empty list removes them.
   */
  setFindingCriteria: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d) {
      const a = z.object({ findingId: short, criteriaRefs }).strict().parse(d),
        f = e.findings.find((f) => f.id === a.findingId);
      if (!f) throw new ApiError(404, "Finding not found");
      const refs = findingCriteriaRefs(e, a.criteriaRefs);
      if (refs.length) f.criteriaRefs = refs;
      else delete f.criteriaRefs;
      return { details: { findingId: f.id, criteriaRefs: refs } };
    },
  },
  closeFinding: {
    roles: ["Reviewer", "Lead Auditor"],
    handle(e, d, ctx) {
      const f = e.findings.find((f) => f.id === d.findingId);
      if (!f) throw new ApiError(404, "Finding not found");
      if (
        f.createdBy === ctx.user.userId ||
        f.remediationBy === ctx.user.userId
      )
        throw new ApiError(403, closeFindingRefusal(f));
      if (
        f.status !== "ready_for_retest" ||
        !f.remediation.trim() ||
        !f.retestEvidenceIds.length
      )
        throw new ApiError(
          400,
          "Remediation and accepted retest evidence are required",
        );
      if (
        !f.retest ||
        f.retest.conclusion !== "effective" ||
        f.retest.evidenceIds.some(
          (id) =>
            !e.artifacts.some((a) => a.id === id && a.status === "accepted"),
        )
      )
        throw new ApiError(
          400,
          "Record an independent effective retest before closure",
        );
      f.status = "closed";
      f.closedBy = ctx.user.userId;
      return { details: { findingId: f.id } };
    },
  },
});
