import { ApiError } from "../http";
import { id, now } from "../ids";
import {
  basisInputSchema,
  type SpecialCategoryBasis,
} from "../special-category";
import { defineCommands } from "./command";
/**
 * The client's bases for special-category data (#60, D-11): recorded before
 * such data reach the platform, then declared with fairness protocols.
 * Records are append-only; a corrected basis is a new record.
 */
export const specialCategory = defineCommands({
  recordSpecialCategoryBasis: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const v = basisInputSchema.parse(d),
        at = now();
      if (v.confirmedOn > at.slice(0, 10))
        throw new ApiError(400, "The client cannot confirm a basis in future");
      if (
        new Set(v.columns.map((c) => c.toLocaleLowerCase("en"))).size !==
        v.columns.length
      )
        throw new ApiError(400, "List each column once");
      const b: SpecialCategoryBasis = {
        ...v,
        id: id("BASIS"),
        recordedBy: ctx.user.userId,
        recordedAt: at,
      };
      (e.specialCategoryBases ??= []).push(b);
      return {
        details: {
          basisId: b.id,
          kind: b.kind,
          provision:
            b.kind === "art4a"
              ? "Art 4a(" + b.paragraph + ")"
              : "GDPR Art 9(2)(" + b.point + ")",
          columns: b.columns,
          confirmedBy: b.confirmedBy,
          confirmedOn: b.confirmedOn,
        },
      };
    },
  },
});
