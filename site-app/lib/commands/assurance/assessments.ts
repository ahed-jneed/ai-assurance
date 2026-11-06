import { z } from "zod";
import { assertionSchema, impactSchema } from "../../assurance-core";
import { addRecord } from "../../assurance-store";
import { ApiError } from "../../http";
import obligations from "../../obligation-subitems.json";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";
/**
 * Assertions, obligation decisions and impact assessments, each confirmed by
 * an independent review from someone other than its author.
 */
export const assessments: AssuranceModule = defineCommands({
  addAssertion: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, lookup, pick, revision }, d, ctx) {
      const v = assertionSchema.parse(d),
        previous = await revision(v.supersedesId, "assertion");
      if (
        v.procedureId &&
        !e.workflow?.procedures.some((p) => p.id === v.procedureId)
      )
        throw new ApiError(400, "Procedure not found");
      if (v.paperId && !e.papers.some((p) => p.id === v.paperId))
        throw new ApiError(400, "Paper not found");
      const locations = await lookup(v.relations.map((rel) => rel.locationId));
      return {
        record: await addRecord(ctx, e.id, "assertion", {
          ...v,
          relations: v.relations.map((rel) => ({
            ...rel,
            locationSha256: pick(locations, rel.locationId, "location").sha256,
          })),
          status: "draft",
          revision: previous ? (previous.body.revision ?? 1) + 1 : 1,
        }),
      };
    },
  },
  reviewAssertion: {
    roles: ["Reviewer", "Lead Auditor"],
    async handle({ e, find }, d, ctx) {
      const v = z
          .object({
            assertionId: short,
            decision: z.enum(["approve", "return"]),
            reason: note,
          })
          .strict()
          .parse(d),
        source = await find(v.assertionId, "assertion");
      if (source.actor === ctx.user.userId)
        throw new ApiError(403, "Independent assertion review is required");
      return {
        record: await addRecord(ctx, e.id, "assertion_review", {
          ...v,
          assertionSha256: source.sha256,
        }),
      };
    },
  },
  obligationDecision: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, accepted, revision }, d, ctx) {
      const v = z
          .object({
            supersedesId: short.optional(),
            code: short,
            actor: z.enum([
              "Provider",
              "Deployer",
              "Importer",
              "Distributor",
              "Authorised representative",
            ]),
            applicability: z.enum([
              "applicable",
              "readiness",
              "not_applicable",
              "needs_information",
            ]),
            rationale: note,
            evidenceIds: z.array(short).max(100),
            assessment: note,
            outcome: z.enum([
              "unassessed",
              "supported",
              "qualified",
              "unsupported",
            ]),
            periodAnalysis: note,
          })
          .strict()
          .parse(d),
        item = obligations.items.find((x) => x.code === v.code);
      if (!item) throw new ApiError(400, "Unknown obligation subitem");
      await revision(v.supersedesId, "obligation");
      for (const evidenceId of v.evidenceIds) accepted(evidenceId);
      if (
        v.applicability === "applicable" &&
        (!v.evidenceIds.length || v.outcome === "unassessed")
      )
        throw new ApiError(
          400,
          "Applicable obligations require accepted evidence and a recorded assessment",
        );
      return {
        record: await addRecord(ctx, e.id, "obligation", {
          ...v,
          title: item.title,
          article: item.article,
          sourceVersion: item.version,
          sourceURL: obligations.source.url,
          catalogVersion: obligations.catalogVersion,
          trigger: item.trigger,
          status: "proposed",
          limitations:
            "Human applicability and evidence judgment. This selective catalog does not waive other duties.",
        }),
      };
    },
  },
  reviewObligation: {
    roles: ["Reviewer", "Lead Auditor"],
    async handle({ e, find }, d, ctx) {
      const v = z
          .object({
            obligationId: short,
            decision: z.enum(["confirmed", "returned"]),
            reason: note,
          })
          .strict()
          .parse(d),
        source = await find(v.obligationId, "obligation");
      if (source.actor === ctx.user.userId)
        throw new ApiError(403, "Independent obligation review is required");
      return {
        record: await addRecord(ctx, e.id, "obligation_review", {
          ...v,
          obligationSha256: source.sha256,
        }),
      };
    },
  },
  impact: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, revision }, d, ctx) {
      const v = impactSchema.parse(d);
      await revision(v.supersedesId, "impact");
      return {
        record: await addRecord(ctx, e.id, "impact", { ...v, state: "open" }),
      };
    },
  },
  reviewImpact: {
    roles: ["Reviewer", "Lead Auditor"],
    async handle({ e, find }, d, ctx) {
      const v = z
          .object({
            impactId: short,
            decision: z.enum(["confirmed", "returned"]),
            reason: note,
          })
          .strict()
          .parse(d),
        source = await find(v.impactId, "impact");
      if (source.actor === ctx.user.userId)
        throw new ApiError(403, "Independent impact review is required");
      return {
        record: await addRecord(ctx, e.id, "impact_review", {
          ...v,
          impactSha256: source.sha256,
        }),
      };
    },
  },
});
