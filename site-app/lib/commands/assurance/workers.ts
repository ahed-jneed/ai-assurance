import { z } from "zod";
import { recordStatement } from "../../assurance-store";
import { db } from "../../bindings";
import { save } from "../../engagement-repo";
import { id, now, sha256 } from "../../ids";
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
          imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          // "client_local": the client's own worker, which reads client-held
          // datasets in the client's environment (#102).
          formats: z
            .array(
              z.enum([
                "provided_predictions",
                "client_local",
                "ONNX",
                "XGBoost",
                "LightGBM",
                "PMML",
              ]),
            )
            .min(1)
            .max(6),
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
