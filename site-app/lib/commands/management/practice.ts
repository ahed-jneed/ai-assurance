import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain";
import { defineCommands } from "../command";
import type { ManagementModule } from "./batch";
/**
 * The practice itself: its name, which the practice switcher shows, so a
 * member of several practices can tell them apart.
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
});
