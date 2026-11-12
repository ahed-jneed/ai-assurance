// Who may provision a practice of their own, and how much one practice may
// write. Both come from Worker variables (docs/security/identity.md).
import { env } from "cloudflare:workers";
import { ApiError } from "./http";

/** The Worker variables read here (cloudflare-env.d.ts). */
export type AccessSettings = {
  IDENTITY_MODE?: string;
  SELF_SIGNUP?: string;
  TENANT_MAX_ENGAGEMENTS?: string;
  TENANT_MAX_SAVES_PER_HOUR?: string;
};

const settings = () => env as AccessSettings;

/**
 * Whether a signed-in user without any membership or invitation may provision
 * a practice of their own. SELF_SIGNUP is "open", "off", or a comma-separated
 * allowlist of email addresses and "@domain" entries. Unset, it is open only
 * on the development server (IDENTITY_MODE=dev) and off everywhere else.
 */
export function selfSignupAllowed(
  email: string,
  config: AccessSettings = settings(),
): boolean {
  const setting = (config.SELF_SIGNUP ?? "").trim().toLowerCase();
  if (!setting) return config.IDENTITY_MODE === "dev";
  if (setting === "open") return true;
  if (setting === "off") return false;
  const address = email.trim().toLowerCase();
  return setting
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) =>
      entry.startsWith("@") ? address.endsWith(entry) : address === entry,
    );
}

/** A positive integer variable, or its default when unset or invalid. */
function limit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** The per-practice quotas, from the Worker variables or their defaults. */
export function tenantQuotas(config: AccessSettings = settings()) {
  return {
    engagements: limit(config.TENANT_MAX_ENGAGEMENTS, 200),
    savesPerHour: limit(config.TENANT_MAX_SAVES_PER_HOUR, 1000),
  };
}

/** Refuses a new engagement once the practice holds its quota of them. */
export async function assertEngagementQuota(db: D1Database, tenantId: string) {
  const { engagements } = tenantQuotas();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM engagements WHERE tenant_id=?")
    .bind(tenantId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= engagements)
    throw new ApiError(
      429,
      "This practice has reached its limit of " +
        engagements +
        " engagements. Nothing was created. Ask the platform operator to raise TENANT_MAX_ENGAGEMENTS.",
    );
}

/**
 * Refuses an engagement save once the practice has stored its hourly quota of
 * engagement versions; each save keeps a full snapshot.
 */
export async function assertSaveQuota(db: D1Database, tenantId: string) {
  const { savesPerHour } = tenantQuotas();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM engagement_snapshots WHERE tenant_id=? AND created_at>?",
    )
    .bind(tenantId, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= savesPerHour)
    throw new ApiError(
      429,
      "This practice has saved " +
        savesPerHour +
        " engagement versions in the last hour, its hourly limit. Nothing was saved. Try again later.",
    );
}
