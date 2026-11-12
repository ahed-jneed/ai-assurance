// GET /api/coverage (docs/design/criteria-model.md section 10): the coverage
// views an engagement offers and, with `framework`, one of them computed on
// demand from the engagement aggregate, its pinned documents and at most
// 1,000 current obligation records. Internal roles with engagement access
// only; client roles get 403 (Q7, decided in #61: coverage stays internal).
import { currentObligations } from "../assurance-store";
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
