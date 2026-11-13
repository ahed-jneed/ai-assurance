// The platform operator (#95, F-09 storage): the people named in the
// PLATFORM_OPERATORS Worker variable may list every practice with what it
// stores and delete an abandoned one with its snapshots, records and R2
// objects. Nobody else can, practice administrators included. Every deletion
// is recorded in operator_events, which is immutable and outlives the
// practice (docs/security/identity.md).
import { env } from "cloudflare:workers";
import { ApiError } from "./http";
import type { Identity } from "./identity";
import { normalizeEmail } from "./invitations";
import { id, sha256 } from "./ids";

/** The Worker variable read here (cloudflare-env.d.ts). */
export type OperatorSettings = { PLATFORM_OPERATORS?: string };

/**
 * Whether the signed-in email is a platform operator: PLATFORM_OPERATORS is a
 * comma-separated list of exact email addresses (no domains). Unset or empty,
 * there is no operator, on the development server too.
 */
export function isOperator(
  email: string | null | undefined,
  config: OperatorSettings = env as OperatorSettings,
): boolean {
  const address = normalizeEmail(email ?? "");
  if (!address) return false;
  return (config.PLATFORM_OPERATORS ?? "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .some((entry) => entry === address && !entry.startsWith("@"));
}

/** Refuses anyone but a signed-in platform operator. */
export function requireOperator(user: Identity | null): Identity {
  if (!user) throw new ApiError(401, "Sign in to use the operator console");
  if (!isOperator(user.email))
    throw new ApiError(403, "Only a platform operator may use this console");
  return user;
}

/**
 * How long a practice must have recorded no activity before the operator may
 * delete it.
 */
export const abandonedAfterDays = 90;

/** The earliest last activity that still keeps a practice, given the time. */
export const abandonedBefore = (at: string) =>
  new Date(Date.parse(at) - abandonedAfterDays * 86400000).toISOString();

/**
 * The practice's latest recorded activity, for tenants aliased `t`: its
 * creation and the newest management or audit event, snapshot, assurance
 * record, execution job, invitation, preference, draft, membership grant
 * and runner heartbeat. Sign-ins that change nothing are not recorded.
 */
const lastActivitySql = `MAX(t.created_at,${[
  ["management_events", "created_at"],
  ["audit_events", "created_at"],
  ["engagement_snapshots", "created_at"],
  ["assurance_records", "created_at"],
  ["execution_jobs", "created_at"],
  ["invitations", "created_at"],
  ["personal_preferences", "updated_at"],
  ["workspace_drafts", "updated_at"],
  ["memberships", "access_since"],
  ["runner_workers", "last_seen"],
]
  .map(
    ([table, column]) =>
      `COALESCE((SELECT MAX(${column}) FROM ${table} WHERE tenant_id=t.id),'')`,
  )
  .join(",")})`;

/**
 * Whether the practice holds work it must retain, for tenants aliased `t`: a
 * report that was released to its client (whatever happened to it since) or
 * a signed dossier. Such a practice is never deleted from the console.
 */
const retainedSql =
  "(EXISTS(SELECT 1 FROM engagements e, json_each(CASE WHEN json_valid(e.body) THEN e.body ELSE '{}' END,'$.reports') r WHERE e.tenant_id=t.id AND json_extract(r.value,'$.release.state') IN ('released','superseded','withdrawn')) OR EXISTS(SELECT 1 FROM assurance_records d WHERE d.tenant_id=t.id AND d.kind='dossier'))";

/** Binds the cutoff: true when the practice may be deleted now. */
const abandonedSql = `(${lastActivitySql}<? AND NOT ${retainedSql})`;

/** A practice as the operator console lists it. */
export type PracticeSummary = {
  id: string;
  name: string;
  createdAt: string;
  lastActivity: string;
  members: number;
  activeMembers: number;
  engagements: number;
  snapshots: number;
  snapshotBytes: number;
  records: number;
  retained: boolean;
  abandoned: boolean;
};
type SummaryRow = Omit<PracticeSummary, "retained" | "abandoned"> & {
  retained: number;
  abandoned: number;
};
const summarySql = `SELECT t.id,t.name,t.created_at AS createdAt,${lastActivitySql} AS lastActivity,(SELECT COUNT(*) FROM memberships WHERE tenant_id=t.id) AS members,(SELECT COUNT(*) FROM memberships WHERE tenant_id=t.id AND status='active') AS activeMembers,(SELECT COUNT(*) FROM engagements WHERE tenant_id=t.id) AS engagements,(SELECT COUNT(*) FROM engagement_snapshots WHERE tenant_id=t.id) AS snapshots,(SELECT COALESCE(SUM(LENGTH(body)),0) FROM engagement_snapshots WHERE tenant_id=t.id) AS snapshotBytes,(SELECT COUNT(*) FROM assurance_records WHERE tenant_id=t.id) AS records,${retainedSql} AS retained,${abandonedSql} AS abandoned FROM tenants t`;
const summary = (row: SummaryRow): PracticeSummary => ({
  ...row,
  retained: !!row.retained,
  abandoned: !!row.abandoned,
});

/**
 * The practices, the longest inactive first: only the abandoned ones unless
 * `all` is set. At most `limit` of them.
 */
export async function listPractices(
  db: D1Database,
  at: string,
  { all = false, limit = 100 }: { all?: boolean; limit?: number } = {},
): Promise<PracticeSummary[]> {
  const cutoff = abandonedBefore(at);
  const rows = (
    await db
      .prepare(
        summarySql +
          (all ? "" : ` WHERE ${abandonedSql}`) +
          " ORDER BY lastActivity,t.id LIMIT ?",
      )
      .bind(cutoff, ...(all ? [] : [cutoff]), limit)
      .all<SummaryRow>()
  ).results;
  return rows.map(summary);
}

/** One practice's summary, or null when it does not exist. */
export async function practiceSummary(
  db: D1Database,
  tenantId: string,
  at: string,
): Promise<PracticeSummary | null> {
  const row = await db
    .prepare(summarySql + " WHERE t.id=?")
    .bind(abandonedBefore(at), tenantId)
    .first<SummaryRow>();
  return row ? summary(row) : null;
}

/**
 * The practice's tables in deletion order, children before parents so the
 * foreign keys hold at every step. Each deletes the rows of the practice
 * bound as its first parameter.
 */
const practiceTables = [
  "workspace_drafts",
  "integrity_incidents",
  "engagement_access",
  "engagement_access_policies",
  "engagement_access_history",
  "assurance_records",
  "audit_events",
  "engagement_snapshots",
  "execution_attempts",
  "execution_jobs",
  "runner_workers",
  "engagements",
  "clients",
  "invitations",
  "practice_admins",
  "memberships",
  "dossier_keys",
  "personal_preferences",
  "management_events",
  "tenants",
] as const;
type PracticeTable = (typeof practiceTables)[number];
const scope = (table: PracticeTable) =>
  table === "tenants"
    ? "id=?"
    : table === "execution_attempts"
      ? "job_id IN (SELECT id FROM execution_jobs WHERE tenant_id=?)"
      : "tenant_id=?";

/** An operator event as the console lists it. */
export type OperatorEvent = {
  id: string;
  actor: string;
  actorEmail: string;
  action: string;
  tenantId: string;
  details: Record<string, unknown>;
  hash: string;
  createdAt: string;
};

/**
 * The latest operator events, newest first; events of one deletion share a
 * timestamp and keep the order they were written in (rowid).
 */
export async function operatorEvents(
  db: D1Database,
  limit = 50,
): Promise<OperatorEvent[]> {
  return (
    await db
      .prepare(
        "SELECT id,actor,actor_email AS actorEmail,action,tenant_id AS tenantId,details,hash,created_at AS createdAt FROM operator_events ORDER BY created_at DESC,rowid DESC LIMIT ?",
      )
      .bind(limit)
      .all<Omit<OperatorEvent, "details"> & { details: string }>()
  ).results.map((e) => ({
    ...e,
    details: JSON.parse(e.details) as Record<string, unknown>,
  }));
}

async function recordStatement(
  db: D1Database,
  operator: Identity,
  action: string,
  tenantId: string,
  details: Record<string, unknown>,
  at: string,
  where = "",
  whereArgs: unknown[] = [],
) {
  const event = {
    id: id("OPE"),
    actor: operator.userId,
    actorEmail: normalizeEmail(operator.email),
    action,
    tenantId,
    details,
    createdAt: at,
  };
  return {
    id: event.id,
    statement: db
      .prepare(
        "INSERT INTO operator_events(id,actor,actor_email,action,tenant_id,details,hash,created_at) SELECT ?,?,?,?,?,?,?,?" +
          (where ? " WHERE " + where : ""),
      )
      .bind(
        event.id,
        event.actor,
        event.actorEmail,
        action,
        tenantId,
        JSON.stringify(details),
        await sha256(JSON.stringify(event)),
        at,
        ...whereArgs,
      ),
  };
}

/**
 * What a deletion removed: the practice's rows by table (absent when it only
 * finished the object purge of a practice deleted before) and its R2 objects.
 */
export type DeletionResult = {
  tenantId: string;
  eventId: string;
  rows?: Record<string, number>;
  objects: number;
  bytes: number;
  purgeEventId: string;
};

/** What the operator asked to delete, and why. */
export type DeletionRequest = {
  tenantId: string;
  /** The practice's name, typed by the operator as confirmation. */
  confirmName: string;
  reason: string;
};

/**
 * Deletes an abandoned practice (no recorded activity for abandonedAfterDays
 * and nothing it must retain) with every row it owns, in one D1 batch:
 * the `deletePractice` operator event is written first, under the same
 * abandonment guard in SQL, then the practice_erasures marker that admits
 * the deletes of its append-only rows, then the deletes, and the marker is
 * removed again. Its R2 objects are deleted afterwards and recorded as
 * `purgePracticeObjects`; when that step fails, deleting the same practice
 * again resumes it.
 */
export async function deletePractice(
  db: D1Database,
  bucket: R2Bucket,
  operator: Identity,
  request: DeletionRequest,
  at: string,
): Promise<DeletionResult> {
  const practice = await practiceSummary(db, request.tenantId, at);
  if (!practice) {
    const deleted = await db
      .prepare(
        "SELECT id FROM operator_events WHERE tenant_id=? AND action='deletePractice' LIMIT 1",
      )
      .bind(request.tenantId)
      .first<{ id: string }>();
    if (!deleted) throw new ApiError(404, "Practice not found");
    // The practice's rows are gone; finish deleting its stored objects.
    return {
      tenantId: request.tenantId,
      eventId: deleted.id,
      ...(await purgeObjects(db, bucket, operator, request.tenantId, at)),
    };
  }
  if (request.confirmName.trim() !== practice.name)
    throw new ApiError(
      400,
      "Type the practice name exactly to confirm the deletion",
    );
  if (practice.retained)
    throw new ApiError(
      409,
      "This practice released a report or signed a dossier, which must be retained. It cannot be deleted here.",
    );
  if (!practice.abandoned)
    throw new ApiError(
      409,
      "This practice recorded activity on " +
        practice.lastActivity.slice(0, 10) +
        ". Only a practice without activity for " +
        abandonedAfterDays +
        " days can be deleted.",
    );
  const counts: Record<string, number> = {};
  for (const table of practiceTables) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${scope(table)}`)
      .bind(request.tenantId)
      .first<{ n: number }>();
    counts[table] = row?.n ?? 0;
  }
  const details = {
    name: practice.name,
    createdAt: practice.createdAt,
    lastActivity: practice.lastActivity,
    reason: request.reason,
    rows: counts,
    snapshotBytes: practice.snapshotBytes,
  };
  const cutoff = abandonedBefore(at);
  const event = await recordStatement(
    db,
    operator,
    "deletePractice",
    request.tenantId,
    details,
    at,
    `EXISTS(SELECT 1 FROM tenants t WHERE t.id=? AND t.name=? AND ${abandonedSql})`,
    [request.tenantId, practice.name, cutoff],
  );
  const marked =
    "EXISTS(SELECT 1 FROM practice_erasures WHERE tenant_id=? AND event_id=?)";
  const results = await db.batch([
    event.statement,
    db
      .prepare(
        "INSERT INTO practice_erasures(tenant_id,event_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM operator_events WHERE id=?)",
      )
      .bind(request.tenantId, event.id, at, event.id),
    ...practiceTables.map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE ${scope(table)} AND ${marked}`)
        .bind(request.tenantId, request.tenantId, event.id),
    ),
    db
      .prepare("DELETE FROM practice_erasures WHERE tenant_id=?")
      .bind(request.tenantId),
  ]);
  if (!results[0]?.meta.changes)
    throw new ApiError(
      409,
      "The practice changed while it was being deleted. Nothing was deleted; reload and check it again.",
    );
  return {
    tenantId: request.tenantId,
    eventId: event.id,
    rows: counts,
    ...(await purgeObjects(db, bucket, operator, request.tenantId, at)),
  };
}

/**
 * Deletes every R2 object under the practice's prefix and records how many
 * it deleted. Runs only after the practice's rows are gone.
 */
async function purgeObjects(
  db: D1Database,
  bucket: R2Bucket,
  operator: Identity,
  tenantId: string,
  at: string,
) {
  let objects = 0,
    bytes = 0,
    cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: tenantId + "/",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((o) => o.key));
      objects += page.objects.length;
      bytes += page.objects.reduce((sum, o) => sum + o.size, 0);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const event = await recordStatement(
    db,
    operator,
    "purgePracticeObjects",
    tenantId,
    { objects, bytes },
    at,
  );
  await event.statement.run();
  return { objects, bytes, purgeEventId: event.id };
}
