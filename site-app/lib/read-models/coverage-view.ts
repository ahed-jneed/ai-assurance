// GET /api/coverage (docs/design/criteria-model.md section 10): the coverage
// views an engagement offers and, with `framework`, one of them computed on
// demand from the engagement aggregate, its pinned documents and at most
// 1,000 current obligation records. Internal roles with engagement access
// only; client roles get 403 (Q7, decided in #61: coverage stays internal).
// The CSV export (section 15.2, #135) is the same view, filtered, under the
// same check.
import { currentObligations } from "../assurance-store";
import {
  coverageCsv,
  defaultCoverageFilters,
  type CoverageFilters,
} from "../criteria/coverage-filters";
import { criteriaRegistry, pinned } from "../criteria/pin";
import { features } from "../criteria/projection";
import { coverageFor, offeredViews } from "../criteria/views";
import { getEngagement } from "../engagement-repo";
import { ApiError } from "../http";
import type { Context } from "../tenancy";
import { isInternalRole } from "../workflow-state";

export async function coverageView(
  ctx: Context,
  engagementId: string,
  framework: string | null,
) {
  if (!isInternalRole(ctx.role))
    throw new ApiError(403, "Coverage is available to the engagement team");
  const e = await getEngagement(ctx, engagementId);
  const r = criteriaRegistry();
  const resolved = pinned(e);
  if (!framework)
    return {
      pin: resolved.pin,
      views: offeredViews(r, resolved),
    };
  const records = features(resolved.pack).obligationAssessments
    ? await currentObligations(ctx, e.id)
    : [];
  const view = coverageFor(r, resolved, e, records, framework);
  if (!view)
    throw new ApiError(
      404,
      "This engagement offers no coverage view for " + framework,
    );
  return view;
}

/**
 * The CSV export of one coverage view, with the heatmap's filters (absent
 * ones mean "all"). Internal roles only, like the view itself.
 */
export async function coverageExport(
  ctx: Context,
  engagementId: string,
  framework: string | null,
  filters: Partial<CoverageFilters> = {},
) {
  if (!isInternalRole(ctx.role))
    throw new ApiError(403, "Coverage is available to the engagement team");
  if (!framework) throw new ApiError(400, "Choose a coverage view to export");
  const view = await coverageView(ctx, engagementId, framework);
  if (!("cells" in view)) throw new ApiError(400, "Choose a coverage view");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "_");
  return {
    filename: `coverage-${safe(engagementId)}-${safe(framework)}.csv`,
    csv: coverageCsv(view, { ...defaultCoverageFilters, ...filters }),
  };
}
