import { z } from "zod";
import { risk } from "../domain";
import { id, now } from "../engagement-repo";
import { ApiError } from "../http";
import { defineCommands } from "./command";
import { short, text } from "./fields";
/** Findings: raising them, tracking remediation and closing them after an independent retest. */
export const findings = defineCommands({
  createFinding: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const a = z
          .object({
            title: short,
            article: short,
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
          })
          .parse(d),
        f = {
          ...a,
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
  closeFinding: {
    roles: ["Reviewer", "Lead Auditor"],
    handle(e, d, ctx) {
      const f = e.findings.find((f) => f.id === d.findingId);
      if (!f) throw new ApiError(404, "Finding not found");
      if (
        f.createdBy === ctx.user.userId ||
        f.remediationBy === ctx.user.userId
      )
        throw new ApiError(403, "Independent retest confirmation is required");
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
