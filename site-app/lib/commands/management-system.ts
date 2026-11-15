import { z } from "../zod";
import type { Engagement, Finding } from "../domain/types";
import { nonconformityGradeIds, soaRows } from "../domain/management-system";
import { now } from "../ids";
import { ApiError } from "../http";
import { managementSystemView, pinned, requireFeature } from "../criteria/pin";
import { defineCommands } from "./command";
import { short, text } from "./fields";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optional = (max: number) => z.string().trim().max(max).default("");

function finding(e: Engagement, findingId: unknown): Finding {
  const f = e.findings.find((f) => f.id === findingId);
  if (!f) throw new ApiError(404, "Finding not found");
  if (f.status === "closed")
    throw new ApiError(409, "A closed finding needs a new re-opening decision");
  return f;
}
const controlsOf = (e: Engagement) =>
  managementSystemView(pinned(e))?.controls ?? [];

/**
 * Management-system audits (#28): the organisation's Statement of
 * Applicability as the auditors record and independently review it, and
 * graded nonconformities with corrective action plans that someone other
 * than their recorder accepts. Each op answers 409 unless the pinned pack
 * switches its feature on.
 */
export const managementSystem = defineCommands({
  recordSoaEntry: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      requireFeature(e, "statementOfApplicability");
      const a = z
        .object({
          control: short,
          included: z.boolean(),
          justification: z.string().trim().max(5000),
          implementation: z
            .enum([
              "implemented",
              "partially_implemented",
              "planned",
              "not_implemented",
            ])
            .optional(),
          documentRef: z.string().trim().max(300).optional(),
        })
        .strict()
        .parse(d);
      if (!controlsOf(e).some((c) => c.id === a.control))
        throw new ApiError(
          400,
          "Not a control of this pack's Statement of Applicability",
        );
      if (!a.included && a.implementation)
        throw new ApiError(
          400,
          "An excluded control has no implementation status",
        );
      const soa = (e.statementOfApplicability ??= {
        documentRef: "",
        entries: [],
        revision: 0,
      });
      if (a.documentRef !== undefined) soa.documentRef = a.documentRef;
      const entry = {
        control: a.control,
        included: a.included,
        justification: a.justification,
        ...(a.included && a.implementation
          ? { implementation: a.implementation }
          : {}),
        actor: ctx.user.userId,
        at: now(),
      };
      const i = soa.entries.findIndex((x) => x.control === a.control);
      if (i < 0) soa.entries.push(entry);
      else soa.entries[i] = entry;
      soa.revision++;
      return {
        details: {
          control: a.control,
          included: a.included,
          revision: soa.revision,
        },
      };
    },
  },
  reviewSoa: {
    roles: ["Reviewer", "Lead Auditor"],
    handle(e, d, ctx) {
      requireFeature(e, "statementOfApplicability");
      const a = z
        .object({ note: optional(5000) })
        .strict()
        .parse(d);
      const soa = e.statementOfApplicability;
      const incomplete = soaRows(controlsOf(e), e).filter((r) => r.problem);
      if (!soa || incomplete.length)
        throw new ApiError(
          400,
          "Record a justified decision for every control before the review",
        );
      if (soa.entries.some((x) => x.actor === ctx.user.userId))
        throw new ApiError(
          403,
          "The Statement of Applicability needs a review by someone who recorded none of its decisions",
        );
      soa.review = {
        by: ctx.user.userId,
        at: now(),
        revision: soa.revision,
        note: a.note,
      };
      return { details: { revision: soa.revision } };
    },
  },
  gradeNonconformity: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      requireFeature(e, "nonconformityGrading");
      const a = z
        .object({
          findingId: short,
          grade: z.enum(nonconformityGradeIds),
          rationale: text,
        })
        .strict()
        .parse(d);
      const f = finding(e, a.findingId);
      const at = now();
      f.grade = a.grade;
      (f.gradeHistory ??= []).push({
        grade: a.grade,
        rationale: a.rationale,
        actor: ctx.user.userId,
        at,
      });
      // An opportunity for improvement needs no corrective action; a new
      // grade needs the plan accepted again.
      if (a.grade === "opportunity") delete f.correctiveAction;
      else if (f.correctiveAction) delete f.correctiveAction.accepted;
      return { details: { findingId: f.id, grade: a.grade } };
    },
  },
  recordCorrectiveAction: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      requireFeature(e, "nonconformityGrading");
      const a = z
        .object({
          findingId: short,
          correction: text,
          rootCause: text,
          action: text,
          owner: short,
          dueDate: date,
        })
        .strict()
        .parse(d);
      const f = finding(e, a.findingId);
      if (f.grade !== "major" && f.grade !== "minor")
        throw new ApiError(
          409,
          "Grade the finding as a major or minor nonconformity first",
        );
      const { findingId, ...plan } = a;
      f.correctiveAction = {
        ...plan,
        recordedBy: ctx.user.userId,
        recordedAt: now(),
      };
      return { details: { findingId, dueDate: a.dueDate } };
    },
  },
  acceptCorrectiveAction: {
    roles: ["Reviewer", "Lead Auditor"],
    handle(e, d, ctx) {
      requireFeature(e, "nonconformityGrading");
      const a = z
        .object({ findingId: short, note: optional(5000) })
        .strict()
        .parse(d);
      const f = finding(e, a.findingId);
      const plan = f.correctiveAction;
      if (!plan || (f.grade !== "major" && f.grade !== "minor"))
        throw new ApiError(409, "Record the corrective action plan first");
      if (plan.recordedBy === ctx.user.userId)
        throw new ApiError(
          403,
          "Someone other than the person who recorded the plan accepts it",
        );
      plan.accepted = { by: ctx.user.userId, at: now(), note: a.note };
      return { details: { findingId: f.id } };
    },
  },
});
