// The practice's report settings: the signatory, location and independence
// and quality-management statement a new report states unless the Lead
// Auditor overrides them. Stored as JSON in tenants.report_settings and set
// with the management op setReportSettings, which records the change in the
// practice's management history.
import { db } from "./bindings";
import {
  parseReportSettings,
  type PracticeReportSettings,
} from "./domain/report-model";
import type { Context } from "./tenancy";

/** The caller's practice report settings; unset fields are empty. */
export async function practiceReportSettings(
  ctx: Pick<Context, "tenantId">,
): Promise<PracticeReportSettings> {
  const row = await db()
    .prepare("SELECT report_settings FROM tenants WHERE id=?")
    .bind(ctx.tenantId)
    .first<{ report_settings: string | null }>();
  return parseReportSettings(row?.report_settings ?? null);
}
