import { z } from "../../zod";
import { roles } from "../../domain/types";
import {
  keyEncryptionKey,
  newSigningKey,
  rotationStatements,
} from "../../signing-keys";
import { defineCommands } from "../command";
import type { ManagementModule } from "./batch";
/**
 * The practice's signing key (#25, F-23). It signs every engagement's
 * dossiers and briefing packets, so only a practice administrator (checked by
 * the route) rotates it, as a management event. The retired key loses its
 * wrapped private half and stays published for verification.
 */
export const signingKeys: ManagementModule = defineCommands({
  rotateSigningKey: {
    roles,
    async handle({ commandId, timestamp, guard, statements }, data, ctx) {
      const { reason } = z
        .object({
          reason: z
            .string()
            .trim()
            .min(1, "Give a reason for the rotation")
            .max(500, "Use at most 500 characters"),
        })
        .strict()
        .parse(data);
      const created = await newSigningKey(
        ctx.tenantId,
        await keyEncryptionKey(),
      );
      statements.push(
        ...rotationStatements(ctx.tenantId, created, reason, timestamp, guard, [
          ctx.tenantId,
          commandId,
        ]),
      );
      return {
        keyId: created.id,
        publicKeySPKI: created.publicKeySPKI,
        reason,
      };
    },
  },
});
