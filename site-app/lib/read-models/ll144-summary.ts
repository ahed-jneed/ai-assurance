// The publishable NYC Local Law 144 summary of one audit (#30), as JSON for
// GET /api/ll144-summary and as the standalone page /ll144-summary.
//
// - With `reportId`: the summary a captured report holds, read through the
//   client projection (lib/client-projection.ts), so a client role sees it
//   only in a report released to it, exactly as captured.
// - Without: the engagement team's live view of the audit, draft or
//   approved. Client roles get 404: they read summaries from released reports.
import { sanitize } from "../client-projection";
import { getEngagement } from "../engagement-repo";
import { ApiError } from "../http";
import { publishableSummary, type Ll144Summary } from "../ll144-audit";
import type { Context } from "../tenancy";
import { isInternalRole } from "../workflow-state";

export type Ll144SummaryView = {
  summary: Ll144Summary;
  /** "report": captured in report `reportId`; "live": the engagement's current audit. */
  source: "report" | "live";
  reportId?: string;
};

export async function ll144SummaryView(
  ctx: Context,
  engagementId: string,
  auditId: string,
  reportId: string | null,
): Promise<Ll144SummaryView> {
  const e = sanitize(await getEngagement(ctx, engagementId), ctx);
  if (reportId) {
    const report = e.reports.find((r) => r.id === reportId);
    const summaries = (report?.snapshot as { ll144Summaries?: Ll144Summary[] })
      ?.ll144Summaries;
    const summary = summaries?.find((s) => s.auditId === auditId);
    if (!summary)
      throw new ApiError(404, "This report holds no such LL144 summary");
    return { summary, source: "report", reportId };
  }
  if (!isInternalRole(ctx.role))
    throw new ApiError(
      404,
      "LL144 summaries are published with a released report",
    );
  const audit = e.ll144Audits?.find((a) => a.id === auditId);
  if (!audit) throw new ApiError(404, "LL144 audit not found");
  return { summary: publishableSummary(audit), source: "live" };
}
