// The practice's engagement quality review policy (#127): how many days must
// pass after someone's latest team work on a client's engagement before they
// may be the Engagement Quality Reviewer of another engagement for that
// client (ISQM 2 ¶19). It is a practice setting (tenants.eqr_cooling_off_days),
// changed only through the setQualityReviewPolicy management op, which
// records a management event. Unset, the default applies.
import { db } from "./bindings";

/** Two years, the period the platform applied before practices could set one. */
export const defaultCoolingOffDays = 730;
/** The longest cooling-off period a practice may set: ten years. */
export const maxCoolingOffDays = 3650;

/** The stored value, or the default when the practice has not set one. */
export const effectiveCoolingOffDays = (stored: number | null | undefined) =>
  typeof stored === "number" &&
  Number.isInteger(stored) &&
  stored >= 0 &&
  stored <= maxCoolingOffDays
    ? stored
    : defaultCoolingOffDays;

/**
 * The practice's quality review policy: its cooling-off period in days (0
 * checks only the engagement's own team) and whether the practice set it.
 */
export async function qualityReviewPolicy(tenantId: string) {
  const row = await db()
    .prepare("SELECT eqr_cooling_off_days AS days FROM tenants WHERE id=?")
    .bind(tenantId)
    .first<{ days: number | null }>();
  return {
    coolingOffDays: effectiveCoolingOffDays(row?.days),
    practiceSet: typeof row?.days === "number",
  };
}
