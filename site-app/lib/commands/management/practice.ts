import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain";
import { ApiError } from "../../http";
import {
  maxCoolingOffDays,
  qualityReviewPolicy,
} from "../../quality-review-policy";
import { defineCommands } from "../command";
import { text } from "../fields";
import type { ManagementModule } from "./batch";
/**
 * The practice itself: its name, which the practice switcher shows, so a
 * member of several practices can tell them apart, and its engagement
 * quality review policy.
 */
export const practice: ManagementModule = defineCommands({
  renamePractice: {
    roles,
    handle({ commandId, guard, statements }, data, ctx) {
      const { name } = z
        .object({
          name: z
            .string()
            .trim()
            .min(1, "Enter a practice name")
            .max(80, "Use at most 80 characters"),
        })
        .strict()
        .parse(data);
      statements.push(
        db()
          .prepare("UPDATE tenants SET name=? WHERE id=? AND " + guard)
          .bind(name, ctx.tenantId, ctx.tenantId, commandId),
      );
      return { name };
    },
  },
  /**
   * Sets the cooling-off period an Engagement Quality Reviewer appointment is
   * checked against (lib/quality-review-policy.ts). It is a firm policy, so
   * only a Lead Auditor who administers the practice sets it (checked here,
   * like every narrower management rule), with a reason;
   * the management event records the old and new period. Appointments made
   * earlier keep the period they were checked against.
   */
  setQualityReviewPolicy: {
    roles,
    async handle({ commandId, guard, statements }, data, ctx) {
      const a = z
        .object({
          coolingOffDays: z
            .number()
            .int("Enter a whole number of days")
            .min(0, "Enter 0 or more days")
            .max(
              maxCoolingOffDays,
              "Use at most " + maxCoolingOffDays + " days",
            ),
          reason: text,
        })
        .strict()
        .parse(data);
      if (ctx.role !== "Lead Auditor")
        throw new ApiError(
          403,
          "Only a Lead Auditor may set the quality review policy",
        );
      const previous = await qualityReviewPolicy(ctx.tenantId);
      if (previous.practiceSet && previous.coolingOffDays === a.coolingOffDays)
        throw new ApiError(
          409,
          "The cooling-off period is already " + a.coolingOffDays + " days",
        );
      statements.push(
        db()
          .prepare(
            "UPDATE tenants SET eqr_cooling_off_days=? WHERE id=? AND " + guard,
          )
          .bind(a.coolingOffDays, ctx.tenantId, ctx.tenantId, commandId),
      );
      return {
        coolingOffDays: a.coolingOffDays,
        previousCoolingOffDays: previous.coolingOffDays,
        reason: a.reason,
      };
    },
  },
});
