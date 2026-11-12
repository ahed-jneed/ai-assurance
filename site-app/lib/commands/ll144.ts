import { z } from "zod";
import { id, now } from "../engagement-repo";
import { datasetCSV } from "../evaluation-service";
import { ApiError } from "../http";
import { computeAudit, ll144InputSchema } from "../ll144-audit";
import { defineCommands } from "./command";
import { short } from "./fields";

/**
 * NYC Local Law 144 bias audits (#30): an auditor computes a draft from an
 * accepted dataset, and a reviewer or lead auditor other than the preparer
 * approves it. Only approved audits reach a final report's summaries.
 */
export const ll144 = defineCommands({
  computeLl144Audit: {
    roles: ["Auditor", "Lead Auditor"],
    async handle(e, d, ctx) {
      const parsed = ll144InputSchema.safeParse(d);
      if (!parsed.success)
        throw new ApiError(
          400,
          parsed.error.issues[0]?.message ?? "Invalid LL144 audit",
        );
      const a = parsed.data;
      const { a: dataset, csv } = await datasetCSV(e, a.datasetId);
      const audit = computeAudit(e, a, dataset, csv, {
        id: id("LL144"),
        actor: ctx.user.userId,
        at: now(),
      });
      (e.ll144Audits ??= []).push(audit);
      return {
        details: {
          auditId: audit.id,
          datasetId: dataset.id,
          datasetSha256: dataset.sha256,
          rate: audit.mapping.rate,
          individuals: audit.result.totalIndividuals,
        },
      };
    },
  },
  approveLl144Audit: {
    roles: ["Reviewer", "Lead Auditor"],
    handle(e, d, ctx) {
      const a = z.object({ auditId: short }).strict().parse(d),
        audit = e.ll144Audits?.find((x) => x.id === a.auditId);
      if (!audit) throw new ApiError(404, "LL144 audit not found");
      if (audit.status !== "draft")
        throw new ApiError(409, "This LL144 audit is already approved");
      if (audit.createdBy === ctx.user.userId)
        throw new ApiError(
          409,
          "The preparer cannot approve their own LL144 audit; another reviewer or lead auditor approves it",
        );
      audit.status = "approved";
      audit.approvedBy = ctx.user.userId;
      audit.approvedAt = now();
      return { details: { auditId: audit.id } };
    },
  },
});
