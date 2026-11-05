import { z } from "zod";
import { db } from "../engagement-repo";
import { ApiError } from "../http";
import { defineCommands } from "./command";
import { short, text } from "./fields";
/** The AI Act classification of the system and its independent approval. */
export const classification = defineCommands({
  classify: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d) {
      const a = z
        .object({
          prohibited: z.boolean(),
          highRisk: z.boolean(),
          transparency: z.boolean(),
          profiling: z.boolean(),
          annexRoute: short,
          operatorRole: z.enum([
            "Provider",
            "Deployer",
            "Provider and deployer",
            "Importer / distributor",
          ]),
          intendedPurpose: text,
          rationale: text,
        })
        .parse(d);
      e.classification = {
        ...e.classification,
        ...a,
        highRisk: a.highRisk || a.profiling,
        status: "provisional",
        approvedBy: undefined,
      };
      return { details: { classification: "provisional" } };
    },
  },
  approveClassification: {
    roles: ["Reviewer", "Lead Auditor"],
    async handle(e, d, ctx) {
      const classifiedEvent = await db()
        .prepare(
          "SELECT actor FROM audit_events WHERE tenant_id=? AND engagement_id=? AND action=? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(ctx.tenantId, e.id, "classify")
        .first<{
          actor: string;
        }>();
      if (!classifiedEvent || classifiedEvent.actor === ctx.user.userId)
        throw new ApiError(
          403,
          "An independent reviewer must approve a completed classification",
        );
      if (!e.classification.rationale || !e.classification.intendedPurpose)
        throw new ApiError(400, "Record classification facts and rationale");
      e.classification.status = "approved";
      e.classification.approvedBy = ctx.user.userId;
      return { details: { classification: "approved" } };
    },
  },
});
