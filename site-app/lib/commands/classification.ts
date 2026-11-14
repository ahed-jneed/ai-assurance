import { z } from "zod";
import { classificationRules } from "../classification-rules";
import { pinnedPack, requireFeature } from "../criteria/pin";
import type { PackDocument } from "../criteria/types";
import {
  approveClassification,
  ClassificationError,
  recordClassification,
  type ClassificationRules,
  type Classification,
} from "../domain/classification";
import { db } from "../bindings";
import { ApiError } from "../http";
import { now } from "../ids";
import { asRulePack } from "../rule-pack";
import { defineCommands } from "./command";
import { short, text } from "./fields";

const rulesByPack = new WeakMap<PackDocument, ClassificationRules>();
/**
 * The classification rules of the engagement's pinned pack (its rule pack,
 * #18 and #19). 409 on a pack without features.aiActClassification.
 */
export function engagementClassificationRules(
  e: Parameters<typeof pinnedPack>[0],
) {
  requireFeature(e, "aiActClassification");
  const pack = pinnedPack(e);
  let rules = rulesByPack.get(pack);
  if (!rules) {
    const rulePack = asRulePack(pack.compat?.catalog?.regulatorySnapshot);
    if (!rulePack)
      throw new ApiError(
        409,
        "This criteria pack has no AI Act classification",
      );
    rules = classificationRules(rulePack);
    rulesByPack.set(pack, rules);
  }
  return rules;
}
const key = z.string().min(1).max(80);
const input = z.object({
  operatorRole: short,
  annexRoute: short,
  intendedPurpose: text,
  rationale: text,
  facts: z.record(key, z.string().max(40)),
  evidence: z.record(key, z.string().max(500)).optional(),
  checkedOn: z.record(key, z.string().max(20)).optional(),
  derogation: z
    .object({
      rationale: z.string().max(5000).optional(),
      registrationEvidence: z.string().max(500).optional(),
    })
    .optional(),
});
function rejected(error: unknown): never {
  if (error instanceof ClassificationError)
    throw new ApiError(400, error.message);
  throw error;
}
/** What the audit trail keeps of a classification: every answer and the label. */
function trail(c: Classification) {
  return {
    label: c.assessment?.label,
    route: c.annexRoute,
    operatorRole: c.operatorRole,
    rulePackVersion: c.rulePackVersion,
    legalVersion: c.version,
    answers: Object.fromEntries(
      Object.entries(c.answers ?? {}).map(([id, a]) => [id, a.value]),
    ),
  };
}

/**
 * The AI Act classification of the system (#19: tri-state facts, the Art 5
 * screen, GPAI roles, Art 50 triggers) and its independent approval.
 */
export const classification = defineCommands({
  classify: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      requireFeature(e, "aiActClassification");
      const a = input.parse(d);
      try {
        e.classification = recordClassification(e.classification, a, {
          rules: engagementClassificationRules(e),
          user: ctx.user.userId,
          at: now(),
        });
      } catch (error) {
        rejected(error);
      }
      return {
        details: {
          classification: "provisional",
          ...trail(e.classification),
        },
      };
    },
  },
  approveClassification: {
    roles: ["Reviewer", "Lead Auditor"],
    async handle(e, d, ctx) {
      requireFeature(e, "aiActClassification");
      // Approving twice would attest a second approval event and overwrite
      // who approved and when (#226 item 1).
      if (e.classification.status === "approved")
        throw new ApiError(409, "This classification is already approved");
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
      try {
        e.classification = approveClassification(e.classification, {
          rules: engagementClassificationRules(e),
          user: ctx.user.userId,
          at: now(),
        });
      } catch (error) {
        rejected(error);
      }
      return {
        details: { classification: "approved", ...trail(e.classification) },
      };
    },
  },
});
