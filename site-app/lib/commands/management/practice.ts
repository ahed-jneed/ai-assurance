import { z } from "zod";
import { db } from "../../bindings";
import { roles } from "../../domain";
import { defineCommands } from "../command";
import type { ManagementModule } from "./batch";
/**
 * The practice itself: its name, which the practice switcher shows, so a
 * member of several practices can tell them apart, and its report settings.
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
  // The signatory, location and quality-management statement new reports
  // state unless the Lead Auditor overrides them (lib/report-settings.ts).
  // The event details record the settings as saved; an empty field is unset.
  setReportSettings: {
    roles,
    handle({ commandId, guard, statements }, data, ctx) {
      const setting = (max: number) =>
        z
          .string()
          .trim()
          .max(max, "Use at most " + max + " characters")
          .default("");
      const settings = z
        .object({
          signatory: setting(300),
          location: setting(300),
          qualityStatement: setting(2000),
        })
        .strict()
        .parse(data);
      statements.push(
        db()
          .prepare(
            "UPDATE tenants SET report_settings=? WHERE id=? AND " + guard,
          )
          .bind(
            JSON.stringify(settings),
            ctx.tenantId,
            ctx.tenantId,
            commandId,
          ),
      );
      return settings;
    },
  },
});
