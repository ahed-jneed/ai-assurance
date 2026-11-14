import { z } from "zod";
import { assertEngagementQuota } from "../access-policy";
import { roles } from "../domain/types";
import { stageGates } from "../domain/gates";
import { db } from "../bindings";
import { now, sha256 } from "../ids";
import {
  assertLegacyUnpin,
  explicitLegacyPin,
  packFeatures,
  resolveFollowup,
} from "../criteria/pin";
import { freshEngagement } from "../factories";
import { ApiError } from "../http";
import { requireAdmin } from "../tenancy";
import { calendarDate } from "../workflow/command";
import { defineCommands, type CommandHandler } from "./command";
import { short } from "./fields";
/**
 * Clients, engagements and memberships are created through /api/management.
 * Every role gets this referral, not a role refusal.
 */
const managementOnly: CommandHandler = {
  roles,
  handle() {
    throw new ApiError(400, "Use client and user management for this action");
  },
};
/**
 * The engagement record itself: title, due date and stage, accepting evidence
 * into it, and opening a follow-up engagement from a monitoring case.
 */
export const engagement = defineCommands({
  createClient: managementOnly,
  createEngagement: managementOnly,
  grantMember: managementOnly,
  renameEngagement: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d) {
      const a = z
        .object({
          title: short,
          dueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(d);
      e.title = a.title;
      e.dueDate = a.dueDate;
      return { details: a };
    },
  },
  setStage: {
    roles: ["Lead Auditor"],
    handle(e, d) {
      const stage = z
        .enum([
          "Planning",
          "Fieldwork",
          "Evidence evaluation",
          "Reporting",
          "Sign-off",
        ])
        .parse(d.stage);
      const gates = stageGates(e, stage, packFeatures(e));
      if (gates.length)
        throw new ApiError(
          400,
          [...new Set(gates.map((g) => g.message))].slice(0, 5).join("; "),
        );
      e.stage = stage;
      return { details: { stage } };
    },
  },
  acceptEvidence: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d) {
      const a = e.artifacts.find((a) => a.id === d.artifactId);
      if (!a) throw new ApiError(404, "Evidence not found");
      if (a.category === "Model")
        throw new ApiError(
          400,
          "Model binaries stay quarantined until a trusted adapter and security review are available",
        );
      a.status = "accepted";
      return { details: { artifactId: a.id, sha256: a.sha256 } };
    },
  },
  openFollowup: {
    roles: ["Lead Auditor"],
    async handle(e, d, ctx) {
      const a = z
          .object({ caseId: short, title: short, dueDate: calendarDate })
          .strict()
          .parse(d),
        c = e.workflow?.monitoring.find((c) => c.id === a.caseId);
      if (
        !c ||
        c.decision !== "reassessment_required" ||
        c.state === "closed" ||
        c.successorEngagementId
      )
        throw new ApiError(
          409,
          "Assess an open case requiring reassessment before creating its follow-up",
        );
      await assertEngagementQuota(db(), ctx.tenantId);
      // The follow-up keeps the predecessor's pack, at its current version.
      const next = freshEngagement(
        resolveFollowup(e),
        e.clientId,
        a.title,
        ctx.user.userId,
        true,
      );
      next.dueDate = a.dueDate;
      next.workflow!.successorOf = { engagementId: e.id, caseId: c.id };
      c.successorEngagementId = next.id;
      c.history.push({
        at: now(),
        actor: ctx.user.userId,
        action: "create_followup",
        state: c.state,
        assessment: c.assessment,
        evidenceIds: [...c.evidenceIds],
      });
      const body = JSON.stringify(next),
        hash = await sha256(body);
      // The successor is created in the same batch as this engagement's save,
      // and only if that save wins (it set last_command_id to this command).
      return {
        details: { engagementId: next.id },
        extras: (cmd) => [
          db()
            .prepare(
              "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(
              ctx.tenantId,
              next.id,
              next.clientId,
              next.title,
              next.version,
              body,
              cmd,
              ctx.tenantId,
              e.id,
              cmd,
            ),
          db()
            .prepare(
              "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(
              ctx.tenantId,
              next.id,
              next.version,
              body,
              hash,
              now(),
              ctx.tenantId,
              e.id,
              cmd,
            ),
          db()
            .prepare(
              "INSERT INTO engagement_access_policies(tenant_id,engagement_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(ctx.tenantId, next.id, now(), ctx.tenantId, e.id, cmd),
          db()
            .prepare(
              "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(
              ctx.tenantId,
              next.id,
              ctx.user.userId,
              ctx.user.userId,
              now(),
              ctx.tenantId,
              e.id,
              cmd,
            ),
        ],
      };
    },
  },
  // M1 of docs/design/criteria-model.md section 11.4: a practice
  // administrator on the engagement team writes the read-time legacy pin
  // into the stored aggregate, through the normal save (audit event,
  // snapshot row, version bump). Behaviour does not change; the pin becomes
  // visible in the stored engagement.
  pinCriteria: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      z.object({}).strict().parse(d);
      requireAdmin(ctx);
      e.criteria = explicitLegacyPin(e, ctx.user.userId, now());
      const { pin } = e.criteria;
      return {
        details: {
          packId: pin.packId,
          packVersion: pin.packVersion,
          packSha256: pin.packSha256,
          origin: "legacy",
        },
      };
    },
  },
  // The reversal of M1, while the pin is a legacy pin that never moved. The
  // engagement then resolves the same pin at read time again (M0).
  unpinCriteria: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      z.object({}).strict().parse(d);
      requireAdmin(ctx);
      assertLegacyUnpin(e);
      const { pin } = e.criteria!;
      delete e.criteria;
      return {
        details: {
          packId: pin.packId,
          packVersion: pin.packVersion,
          packSha256: pin.packSha256,
        },
      };
    },
  },
});
