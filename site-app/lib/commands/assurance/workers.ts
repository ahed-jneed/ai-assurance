import { z } from "zod";
import { recordStatement } from "../../assurance-store";
import { db } from "../../bindings";
import { save } from "../../engagement-repo";
import { ApiError } from "../../http";
import { id, now, sha256 } from "../../ids";
import { runnerCapabilities } from "../../runner-capabilities";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";
/**
 * External runner workers: a Lead Auditor enrolls a worker for this engagement,
 * whose token is shown once, or revokes it.
 */
export const workers: AssuranceModule = defineCommands({
  enrollWorker: {
    roles: ["Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z
        .object({
          name: short,
          imageDigest: z
            .string()
            .regex(
              /^sha256:[a-f0-9]{64}$/,
              "Enter the image digest as sha256: followed by 64 lowercase hexadecimal characters",
            ),
          // The one capability list the Enroll runner dialog also offers.
          formats: z
            .array(z.enum(runnerCapabilities))
            .min(1)
            .max(runnerCapabilities.length),
          securityReview: note,
        })
        .strict()
        .parse(d);
      const token = crypto.randomUUID() + crypto.randomUUID(),
        tokenHash = await sha256(token),
        workerId = id("WORKER"),
        log = await recordStatement(ctx, e.id, "worker_event", {
          ...v,
          workerId,
          action: "enrolled",
          limitations:
            "Image digest is an enrollment declaration; no remote attestation. Local model allowlist and isolated runtime must be configured.",
        });
      await save(ctx, e, e.version, "enrollWorker", { workerId }, (cmd) => [
        db()
          .prepare(
            "INSERT INTO runner_workers(id,tenant_id,engagement_id,name,token_hash,image_digest,capabilities,active,created_by,created_at) SELECT ?,?,?,?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
          )
          .bind(
            workerId,
            ctx.tenantId,
            e.id,
            v.name,
            tokenHash,
            v.imageDigest,
            JSON.stringify(v.formats),
            ctx.user.userId,
            now(),
            ctx.tenantId,
            e.id,
            cmd,
          ),
        log.guarded(cmd),
      ]);
      return Response.json(
        {
          workerId,
          token,
          notice:
            "Shown once. Store as ASSURANCE_WORKER_TOKEN outside source. Private Site service access must be configured separately.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
  },
  revokeWorker: {
    roles: ["Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z.object({ workerId: short, reason: note }).strict().parse(d);
      // Only a runner enrolled for this engagement can be revoked: an unknown
      // id must not leave a "revoked" worker event behind.
      const runner = await db()
        .prepare(
          "SELECT active FROM runner_workers WHERE id=? AND tenant_id=? AND engagement_id=?",
        )
        .bind(v.workerId, ctx.tenantId, e.id)
        .first<{ active: number }>();
      if (!runner) throw new ApiError(404, "Runner not found");
      if (!runner.active)
        throw new ApiError(409, "This runner is already revoked");
      const log = await recordStatement(ctx, e.id, "worker_event", {
        ...v,
        action: "revoked",
      });
      await save(
        ctx,
        e,
        e.version,
        "revokeWorker",
        { workerId: v.workerId },
        (cmd) => [
          db()
            .prepare(
              "UPDATE runner_workers SET active=0 WHERE id=? AND tenant_id=? AND engagement_id=? AND EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(v.workerId, ctx.tenantId, e.id, ctx.tenantId, e.id, cmd),
          log.guarded(cmd),
        ],
      );
      return { record: log.record };
    },
  },
});
