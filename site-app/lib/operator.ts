// The platform operator (#95, F-09 storage): the people named in the
// PLATFORM_OPERATORS Worker variable may list every practice with what it
// stores and delete an abandoned one with its snapshots, records and R2
// objects. An abandoned practice that released a report or signed a dossier
// is never deleted; it is archived instead (#151): its members lose access
// and its issued records stay retained and verifiable. Nobody else can do
// either, practice administrators included. Every deletion and archive is
// recorded in operator_events, which is immutable and outlives the practice
// (docs/security/identity.md).
import { env } from "./bindings";
import type { Report } from "./domain";
import {
  IntegrityError,
  loadStoredPart,
  type IntegrityKind,
  type ReportRefs,
  type StorageRef,
} from "./engagement-storage";
import { ApiError } from "./http";
import type { Identity } from "./identity";
import { normalizeEmail } from "./invitations";
import { id, sha256 } from "./ids";
import { verifyPackage } from "./report-package";

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
 * and runner heartbeat. Sign-ins (sign_in_events, for the Access log) change
 * nothing and do not count.
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

/**
 * Binds the cutoff: true when the practice is inactive for the period but
 * holds issued work, so it may be archived now instead (#151).
 */
const archivableSql = `(t.archived_at IS NULL AND ${lastActivitySql}<? AND ${retainedSql})`;

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
  /** Inactive for the period and holding no issued work: may be deleted. */
  abandoned: boolean;
  /** Inactive for the period, holding issued work: may be archived. */
  archivable: boolean;
  /** When the practice was archived, or null. */
  archivedAt: string | null;
};
type SummaryRow = Omit<
  PracticeSummary,
  "retained" | "abandoned" | "archivable"
> & {
  retained: number;
  abandoned: number;
  archivable: number;
};
const summarySql = `SELECT t.id,t.name,t.created_at AS createdAt,${lastActivitySql} AS lastActivity,(SELECT COUNT(*) FROM memberships WHERE tenant_id=t.id) AS members,(SELECT COUNT(*) FROM memberships WHERE tenant_id=t.id AND status='active') AS activeMembers,(SELECT COUNT(*) FROM engagements WHERE tenant_id=t.id) AS engagements,(SELECT COUNT(*) FROM engagement_snapshots WHERE tenant_id=t.id) AS snapshots,(SELECT COALESCE(SUM(LENGTH(body)),0) FROM engagement_snapshots WHERE tenant_id=t.id) AS snapshotBytes,(SELECT COUNT(*) FROM assurance_records WHERE tenant_id=t.id) AS records,${retainedSql} AS retained,${abandonedSql} AS abandoned,${archivableSql} AS archivable,t.archived_at AS archivedAt FROM tenants t`;
const summary = (row: SummaryRow): PracticeSummary => ({
  ...row,
  retained: !!row.retained,
  abandoned: !!row.abandoned,
  archivable: !!row.archivable,
});

/** Where a page of the practice listing continues: after this practice. */
export type PracticeCursor = { lastActivity: string; id: string };

/** How many practices one page of the operator console lists. */
export const practicePageSize = 50;

/**
 * The practices, the longest inactive first, paged by last activity (#151):
 * unless `all` is set, only those the operator may delete or archive now and
 * those already archived, whose issued work the console verifies. At most
 * `limit` of them, after `after` when given.
 */
export async function listPractices(
  db: D1Database,
  at: string,
  {
    all = false,
    limit = 100,
    after,
  }: { all?: boolean; limit?: number; after?: PracticeCursor } = {},
): Promise<PracticeSummary[]> {
  const cutoff = abandonedBefore(at);
  const rows = (
    await db
      .prepare(
        "SELECT * FROM (" +
          summarySql +
          (all
            ? ""
            : ` WHERE (${abandonedSql} OR ${archivableSql} OR t.archived_at IS NOT NULL)`) +
          ") s" +
          (after
            ? " WHERE s.lastActivity>? OR (s.lastActivity=? AND s.id>?)"
            : "") +
          " ORDER BY s.lastActivity,s.id LIMIT ?",
      )
      .bind(
        cutoff,
        cutoff,
        ...(all ? [] : [cutoff, cutoff]),
        ...(after ? [after.lastActivity, after.lastActivity, after.id] : []),
        limit,
      )
      .all<SummaryRow>()
  ).results;
  return rows.map(summary);
}

/**
 * One page of the operator console's listing: {@link practicePageSize}
 * practices and the cursor of the next page, or null on the last one.
 */
export async function practicePage(
  db: D1Database,
  at: string,
  options: { all?: boolean; after?: PracticeCursor } = {},
): Promise<{ practices: PracticeSummary[]; next: PracticeCursor | null }> {
  const rows = await listPractices(db, at, {
    ...options,
    limit: practicePageSize + 1,
  });
  const practices = rows.slice(0, practicePageSize),
    last = practices.at(-1);
  return {
    practices,
    next:
      rows.length > practicePageSize && last
        ? { lastActivity: last.lastActivity, id: last.id }
        : null,
  };
}

/** One practice's summary, or null when it does not exist. */
export async function practiceSummary(
  db: D1Database,
  tenantId: string,
  at: string,
): Promise<PracticeSummary | null> {
  const row = await db
    .prepare(summarySql + " WHERE t.id=?")
    .bind(abandonedBefore(at), abandonedBefore(at), tenantId)
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
  "sign_in_events",
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
      "This practice released a report or signed a dossier, which must be retained. It cannot be deleted; archive it instead.",
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

/** What an archive changed: who lost access and what it cancelled. */
export type ArchiveResult = {
  tenantId: string;
  eventId: string;
  archivedAt: string;
  members: number;
  invitations: number;
  workers: number;
};

/**
 * Archives an abandoned practice that holds issued work (#151, decision of
 * 13 Nov 2026): no recorded activity for abandonedAfterDays and a released
 * report or a signed dossier, so it may not be deleted. In one D1 batch the
 * `archivePractice` operator event is written first, under the same guard in
 * SQL, then the practice is marked archived, its active memberships become
 * 'archived' (every access check requires 'active'), its pending invitations
 * are cancelled and its runner workers deactivated. Nothing else changes:
 * its engagements, snapshots, records, audit trails and stored objects stay,
 * and migration 0015 keeps it archived and closed to new members.
 */
export async function archivePractice(
  db: D1Database,
  operator: Identity,
  request: DeletionRequest,
  at: string,
): Promise<ArchiveResult> {
  const practice = await practiceSummary(db, request.tenantId, at);
  if (!practice) throw new ApiError(404, "Practice not found");
  if (request.confirmName.trim() !== practice.name)
    throw new ApiError(
      400,
      "Type the practice name exactly to confirm the archive",
    );
  if (practice.archivedAt)
    throw new ApiError(
      409,
      "This practice was archived on " + practice.archivedAt.slice(0, 10) + ".",
    );
  if (!practice.retained)
    throw new ApiError(
      409,
      "This practice released no report and signed no dossier. Only a practice with issued work is archived; delete it instead.",
    );
  if (!practice.archivable)
    throw new ApiError(
      409,
      "This practice recorded activity on " +
        practice.lastActivity.slice(0, 10) +
        ". Only a practice without activity for " +
        abandonedAfterDays +
        " days can be archived.",
    );
  const count = async (sql: string) =>
    (await db.prepare(sql).bind(request.tenantId).first<{ n: number }>())?.n ??
    0;
  const members = await count(
    "SELECT COUNT(*) AS n FROM memberships WHERE tenant_id=? AND status='active'",
  );
  const invitations = await count(
    "SELECT COUNT(*) AS n FROM invitations WHERE tenant_id=? AND status='pending'",
  );
  const workers = await count(
    "SELECT COUNT(*) AS n FROM runner_workers WHERE tenant_id=? AND active=1",
  );
  const event = await recordStatement(
    db,
    operator,
    "archivePractice",
    request.tenantId,
    {
      name: practice.name,
      createdAt: practice.createdAt,
      lastActivity: practice.lastActivity,
      reason: request.reason,
      members,
      invitations,
      workers,
      engagements: practice.engagements,
      snapshots: practice.snapshots,
      records: practice.records,
    },
    at,
    `EXISTS(SELECT 1 FROM tenants t WHERE t.id=? AND t.name=? AND ${archivableSql})`,
    [request.tenantId, practice.name, abandonedBefore(at)],
  );
  const recorded = "EXISTS(SELECT 1 FROM operator_events WHERE id=?)";
  const results = await db.batch([
    event.statement,
    db
      .prepare(
        `UPDATE tenants SET archived_at=? WHERE id=? AND archived_at IS NULL AND ${recorded}`,
      )
      .bind(at, request.tenantId, event.id),
    db
      .prepare(
        `UPDATE memberships SET status='archived' WHERE tenant_id=? AND status='active' AND ${recorded}`,
      )
      .bind(request.tenantId, event.id),
    db
      .prepare(
        `UPDATE invitations SET status='cancelled',closed_at=? WHERE tenant_id=? AND status='pending' AND ${recorded}`,
      )
      .bind(at, request.tenantId, event.id),
    db
      .prepare(
        `UPDATE runner_workers SET active=0 WHERE tenant_id=? AND active=1 AND ${recorded}`,
      )
      .bind(request.tenantId, event.id),
  ]);
  if (!results[0]?.meta.changes)
    throw new ApiError(
      409,
      "The practice changed while it was being archived. Nothing was changed; reload and check it again.",
    );
  return {
    tenantId: request.tenantId,
    eventId: event.id,
    archivedAt: at,
    members: results[2]?.meta.changes ?? members,
    invitations: results[3]?.meta.changes ?? invitations,
    workers: results[4]?.meta.changes ?? workers,
  };
}

/**
 * How one issued part checked out: "valid", or why not. "mismatch" means the
 * stored bytes, or the package rebuilt from them, no longer hash to the
 * recorded digest; "missing", "unavailable" and "unreadable" say the stored
 * part could not be read back intact (lib/engagement-storage.ts).
 */
export type PartCheck = "valid" | IntegrityKind;
/** A released report of an archived practice, with its package checks. */
export type IssuedReport = {
  engagementId: string;
  reportId: string;
  kind: string;
  state: string;
  releasedAt: string | null;
  sha256: string;
  clientSha256: string | null;
  /** The internal package, loaded from R2 and rechecked against sha256. */
  internal: PartCheck;
  /** The client package against clientSha256; null when none was issued. */
  client: PartCheck | null;
  /** Whether every package of the report checked out. */
  valid: boolean;
};
/** A signed dossier of an archived practice, with its two checks. */
export type IssuedDossier = {
  engagementId: string;
  recordId: string;
  reportId: string | null;
  audience: string | null;
  createdAt: string;
  sha256: string;
  /** The D1 record against its recorded digest. */
  record: "valid" | "mismatch";
  /** The signed dossier archive in R2 against the digest the record names. */
  archive: PartCheck;
  /** Whether both checked out. */
  valid: boolean;
};
/** What an archived practice issued, for answering verification requests. */
export type IssuedWork = {
  tenantId: string;
  name: string;
  archivedAt: string;
  reports: IssuedReport[];
  dossiers: IssuedDossier[];
  /**
   * The practice's verification keys, active and retired, for the
   * --trusted-keys file of `python -m engine.assurance verify`. Members read
   * them at /api/dossier/keys, which an archived practice's members no
   * longer can.
   */
  keys: {
    keyId: string;
    publicKeySPKI: string;
    status: "active" | "retired";
  }[];
};

/**
 * The issued work of an archived practice (#151): each released (or since
 * superseded or withdrawn) report with its internal and client packages
 * loaded from R2, where dehydrate() keeps them, and rechecked against the
 * report's digests; each signed dossier with its record digest and its signed
 * archive in R2 rechecked; and the practice's verification keys. A part that
 * is missing, unavailable or altered is reported as such, never thrown.
 * Identifiers and digests only, never the content. Only archived practices
 * are answered, so the operator reads nothing of a practice its members
 * still run.
 */
export async function issuedWork(
  db: D1Database,
  store: Pick<R2Bucket, "get">,
  tenantId: string,
): Promise<IssuedWork> {
  const practice = await db
    .prepare("SELECT name,archived_at FROM tenants WHERE id=?")
    .bind(tenantId)
    .first<{ name: string; archived_at: string | null }>();
  if (!practice) throw new ApiError(404, "Practice not found");
  if (!practice.archived_at)
    throw new ApiError(
      409,
      "Only an archived practice's issued work is shown here",
    );
  const released = (
    await db
      .prepare(
        "SELECT e.id AS engagementId,r.value AS report,json_extract(e.body,'$.storageRefs.reports') AS refs FROM engagements e, json_each(CASE WHEN json_valid(e.body) THEN e.body ELSE '{}' END,'$.reports') r WHERE e.tenant_id=? AND json_extract(r.value,'$.release.state') IN ('released','superseded','withdrawn') ORDER BY e.id,json_extract(r.value,'$.createdAt')",
      )
      .bind(tenantId)
      .all<{ engagementId: string; report: string; refs: string | null }>()
  ).results;
  const reports: IssuedReport[] = [];
  for (const row of released) {
    const report = JSON.parse(row.report) as Report;
    const refs = (row.refs ? JSON.parse(row.refs) : {}) as ReportRefs;
    const ref = refs[report.id];
    const internal = await packageCheck(
      store,
      row.engagementId,
      report,
      false,
      ref?.snapshot,
    );
    const client = report.clientSha256
      ? await packageCheck(
          store,
          row.engagementId,
          report,
          true,
          ref?.clientSnapshot,
        )
      : null;
    reports.push({
      engagementId: row.engagementId,
      reportId: report.id,
      kind: report.kind,
      state: report.release?.state ?? "released",
      releasedAt: report.release?.releasedAt ?? null,
      sha256: report.sha256,
      clientSha256: report.clientSha256 ?? null,
      internal,
      client,
      valid: internal === "valid" && (client === null || client === "valid"),
    });
  }
  const dossierRows = (
    await db
      .prepare(
        "SELECT engagement_id AS engagementId,id AS recordId,json_extract(body,'$.reportId') AS reportId,json_extract(body,'$.audience') AS audience,created_at AS createdAt,sha256,body FROM assurance_records WHERE tenant_id=? AND kind='dossier' ORDER BY created_at,id",
      )
      .bind(tenantId)
      .all<
        Omit<IssuedDossier, "record" | "archive" | "valid"> & { body: string }
      >()
  ).results;
  const dossiers: IssuedDossier[] = [];
  for (const { body, ...row } of dossierRows) {
    const record = (await sha256(body)) === row.sha256 ? "valid" : "mismatch";
    const archive = await dossierCheck(store, row.engagementId, body);
    dossiers.push({
      ...row,
      record,
      archive,
      valid: record === "valid" && archive === "valid",
    });
  }
  const keys = (
    await db
      .prepare(
        "SELECT id AS keyId,public_key AS publicKeySPKI,active FROM dossier_keys WHERE tenant_id=? ORDER BY created_at,id",
      )
      .bind(tenantId)
      .all<{ keyId: string; publicKeySPKI: string; active: number }>()
  ).results.map(({ active, ...k }) => ({
    ...k,
    status: active ? ("active" as const) : ("retired" as const),
  }));
  return {
    tenantId,
    name: practice.name,
    archivedAt: practice.archived_at,
    reports,
    dossiers,
    keys,
  };
}

/** What went wrong with a part, as a check result. */
const failure = (error: unknown): IntegrityKind =>
  error instanceof IntegrityError ? error.kind : "unreadable";

/**
 * One package of a released report: its snapshot loaded from R2 by the
 * stored reference (or, for a record stored before dehydrate(), held inline),
 * then the package rebuilt from it and compared with the report's digest.
 */
async function packageCheck(
  store: Pick<R2Bucket, "get">,
  engagementId: string,
  report: Report,
  client: boolean,
  ref: StorageRef | undefined,
): Promise<PartCheck> {
  let snapshot: Record<string, unknown> | undefined;
  if (ref)
    try {
      snapshot = (await loadStoredPart(store, engagementId, ref)) as Record<
        string,
        unknown
      >;
    } catch (error) {
      return failure(error);
    }
  else {
    const inline = client ? report.clientSnapshot : report.snapshot;
    if (inline && Object.keys(inline).length) snapshot = inline;
  }
  if (!snapshot || typeof snapshot !== "object") return "missing";
  try {
    const proof = await verifyPackage(
      client
        ? { ...report, clientSnapshot: snapshot }
        : { ...report, snapshot },
      sha256,
      client,
    );
    return proof.valid ? "valid" : "mismatch";
  } catch {
    return "unreadable";
  }
}

/**
 * The signed dossier archive a dossier record names (app/api/dossier): read
 * from R2 by its key and checked against the digest the record holds.
 */
async function dossierCheck(
  store: Pick<R2Bucket, "get">,
  engagementId: string,
  body: string,
): Promise<PartCheck> {
  let ref: { key?: unknown; sha256?: unknown };
  try {
    ref = JSON.parse(body) as typeof ref;
  } catch {
    return "unreadable";
  }
  if (typeof ref.key !== "string" || typeof ref.sha256 !== "string")
    return "missing";
  try {
    await loadStoredPart(store, engagementId, {
      key: ref.key,
      sha256: ref.sha256,
    });
    return "valid";
  } catch (error) {
    return failure(error);
  }
}
