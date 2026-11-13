// The immutable parts of an engagement kept in R2 (report snapshots, paper
// histories and run results), stored content-addressed by dehydrate() and
// loaded back by hydrate(). A part that is missing, unreadable or does not
// match its hash raises an IntegrityError naming the engagement, so list
// endpoints can isolate it (recordIntegrityIncident) instead of failing for
// every member.
import { bucket, db } from "./bindings";
import type { Engagement, Report } from "./domain";
import { ApiError } from "./http";
import { now, sha256 } from "./ids";
import type { Context } from "./tenancy";
type Ref = { key: string; sha256: string };
type StorageRefs = {
  reports: Record<string, { snapshot: Ref; clientSnapshot?: Ref }>;
  histories: Record<string, Ref>;
  results: Record<string, Ref>;
};
type Stored = Engagement & { storageRefs?: StorageRefs };

/** How a stored engagement record failed to load. */
export type IntegrityKind =
  "missing" | "unavailable" | "mismatch" | "unreadable";
/**
 * An engagement record that could not be loaded intact: its D1 body
 * (`objectKey` "body") or one of its R2 parts is missing, temporarily
 * unavailable, altered or unreadable.
 */
export class IntegrityError extends ApiError {
  constructor(
    public engagementId: string,
    public kind: IntegrityKind,
    public objectKey: string,
  ) {
    super(
      kind === "missing" || kind === "unavailable" ? 503 : 409,
      kind === "missing"
        ? "An immutable audit record of this engagement is missing"
        : kind === "unavailable"
          ? "An immutable audit record of this engagement is temporarily unavailable"
          : kind === "mismatch"
            ? "Immutable audit record integrity mismatch"
            : "This engagement's stored record is unreadable",
    );
  }
}

/**
 * The R2 keys this request has verified (read back intact) or written, keyed
 * by the request's Context. Parts are content-addressed, so such a key already
 * holds exactly the bytes its name promises and dehydrate() does not put it
 * again: a save after a load writes only the parts that changed.
 */
const present = new WeakMap<object, Set<string>>();
const presentIn = (ctx: Context) =>
  present.get(ctx) ?? present.set(ctx, new Set()).get(ctx)!;

/**
 * Moves the engagement's immutable parts to R2 and returns the record to
 * store in D1, with storage references in their place. A part this request
 * has already read back intact or written is not put again, and identical
 * parts are put once.
 */
export async function dehydrate(ctx: Context, e: Engagement) {
  const copy = structuredClone(e) as Stored,
    refs: StorageRefs = { reports: {}, histories: {}, results: {} },
    known = presentIn(ctx),
    writes = new Map<string, Promise<void>>();
  async function put(type: string, value: unknown) {
    const body = JSON.stringify(value),
      hash = await sha256(body),
      key = ctx.tenantId + "/" + e.id + "/immutable/" + type + "/" + hash;
    if (!known.has(key)) {
      let write = writes.get(key);
      if (!write) {
        write = bucket()
          .put(key, body, {
            httpMetadata: { contentType: "application/json" },
            customMetadata: { sha256: hash },
          })
          .then(() => void known.add(key));
        writes.set(key, write);
      }
      await write;
    }
    return { key, sha256: hash };
  }
  // Written in parallel; the references are assigned in record order, so the
  // stored body does not depend on which write finishes first.
  const [reports, histories, results] = await Promise.all([
    Promise.all(
      copy.reports.map(async (r) => ({
        snapshot: await put("report", r.snapshot),
        ...(r.clientSnapshot
          ? { clientSnapshot: await put("client-report", r.clientSnapshot) }
          : {}),
      })),
    ),
    Promise.all(
      copy.papers.map((p) =>
        p.history.length ? put("paper-history", p.history) : null,
      ),
    ),
    Promise.all(
      copy.runs.map((r) =>
        r.results.length ? put("results", r.results) : null,
      ),
    ),
  ]);
  copy.reports.forEach((r, i) => {
    refs.reports[r.id] = reports[i];
    r.snapshot = {};
    delete r.clientSnapshot;
  });
  copy.papers.forEach((p, i) => {
    const ref = histories[i];
    if (ref) {
      refs.histories[p.id] = ref;
      p.history = [];
    }
  });
  copy.runs.forEach((r, i) => {
    const ref = results[i];
    if (ref) {
      refs.results[r.id] = ref;
      r.results = [];
    }
  });
  copy.storageRefs = refs;
  return copy;
}

/**
 * Which immutable parts hydrate() loads; every part by default. A report
 * filter loads the snapshots of the reports it accepts only.
 */
export type HydrateParts = {
  reports?: boolean | ((report: Report) => boolean);
  histories?: boolean;
  results?: boolean;
};
const allParts: HydrateParts = {
  reports: true,
  histories: true,
  results: true,
};
/**
 * Reads one stored object and checks it against the digest its reference
 * records: an IntegrityError says whether it is missing, unavailable or
 * altered.
 */
async function readVerified(
  store: Pick<R2Bucket, "get">,
  engagementId: string,
  ref: Ref,
) {
  let o: R2ObjectBody | null;
  try {
    o = await store.get(ref.key);
  } catch {
    throw new IntegrityError(engagementId, "unavailable", ref.key);
  }
  if (!o) throw new IntegrityError(engagementId, "missing", ref.key);
  let bytes: ArrayBuffer;
  try {
    bytes = await o.arrayBuffer();
  } catch {
    throw new IntegrityError(engagementId, "unavailable", ref.key);
  }
  if ((await sha256(bytes)) !== ref.sha256)
    throw new IntegrityError(engagementId, "mismatch", ref.key);
  return new TextDecoder().decode(bytes);
}

/** A stored engagement record's reference to one of its R2 parts. */
export type StorageRef = Ref;
/** The R2 references of a stored report's snapshots, by report id. */
export type ReportRefs = StorageRefs["reports"];

/**
 * Loads one stored part outside a request (the operator's issued-work check,
 * lib/operator.ts): read from `store`, checked against the reference's
 * digest and parsed, or an IntegrityError naming what is wrong with it.
 */
export async function loadStoredPart(
  store: Pick<R2Bucket, "get">,
  engagementId: string,
  ref: Ref,
): Promise<unknown> {
  const text = await readVerified(store, engagementId, ref);
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrityError(engagementId, "unreadable", ref.key);
  }
}

/**
 * Verified R2 reads per request, keyed by the request's Context. Parts are
 * content-addressed, so a key read once in a request is never read again in
 * it; each caller parses its own copy.
 */
const reads = new WeakMap<object, Map<string, Promise<string>>>();
function read(ctx: Context | undefined, engagementId: string, ref: Ref) {
  const cache = ctx
    ? (reads.get(ctx) ?? reads.set(ctx, new Map()).get(ctx)!)
    : undefined;
  const cached = cache?.get(ref.key);
  if (cached) return cached;
  const pending = (async () => {
    const text = await readVerified(bucket(), engagementId, ref);
    if (ctx) presentIn(ctx).add(ref.key);
    return text;
  })();
  cache?.set(ref.key, pending);
  pending.catch(() => cache?.delete(ref.key));
  return pending;
}
async function load(ctx: Context | undefined, engagementId: string, ref: Ref) {
  const text = await read(ctx, engagementId, ref);
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrityError(engagementId, "unreadable", ref.key);
  }
}

/**
 * Loads the engagement's immutable parts from R2 into it, in parallel, and
 * drops its storage references. With `parts`, only those parts are loaded;
 * the others stay empty, so such an engagement is for reading only (save()
 * refuses it).
 */
export async function hydrate(
  e: Engagement,
  ctx?: Context,
  parts: HydrateParts = allParts,
) {
  const copy = e as Stored,
    refs = copy.storageRefs;
  if (!refs) return e;
  const loads: Promise<void>[] = [],
    part = (ref: Ref, apply: (value: never) => unknown) =>
      loads.push(load(ctx, e.id, ref).then((v) => void apply(v as never)));
  for (const r of e.reports) {
    const ref = refs.reports[r.id];
    if (
      ref &&
      (typeof parts.reports === "function" ? parts.reports(r) : parts.reports)
    ) {
      part(ref.snapshot, (v) => (r.snapshot = v));
      if (ref.clientSnapshot)
        part(ref.clientSnapshot, (v) => (r.clientSnapshot = v));
    }
  }
  if (parts.histories)
    for (const p of e.papers)
      if (refs.histories[p.id])
        part(refs.histories[p.id], (v) => (p.history = v));
  if (parts.results)
    for (const r of e.runs)
      if (refs.results[r.id]) part(refs.results[r.id], (v) => (r.results = v));
  await Promise.all(loads);
  delete copy.storageRefs;
  return e;
}

/** One recorded integrity incident, as practice administrators see it. */
export type IntegrityIncident = {
  engagementId: string;
  /** The engagement's title; null when the engagement row is gone. */
  title: string | null;
  objectKey: string;
  kind: IntegrityKind;
  status: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  /** Who last met it: a display name, or the user id without a membership. */
  lastSeenBy: string;
  /** How the administrators handled it; meeting it again reopens it. */
  handling: IncidentHandling;
  /** When it was last acknowledged or resolved; null while never handled. */
  handledAt: string | null;
  /** Who did: a display name, or the user id without a membership. */
  handledBy: string | null;
};
/**
 * How an incident stands (#151): open until an administrator acknowledges it
 * (the problem is known and being worked on) or resolves it (the record was
 * restored). A resolved incident that a member meets again reopens.
 */
export const incidentHandlings = ["open", "acknowledged", "resolved"] as const;
export type IncidentHandling = (typeof incidentHandlings)[number];
/** How many incidents the practice view lists, most recently seen first. */
export const integrityIncidentLimit = 50;
/**
 * How long an incident counts as recent: the navigation badge counts only
 * open incidents a member met in this window, so it clears once a restored
 * record stops failing or an administrator acknowledges or resolves it.
 */
export const integrityIncidentRecentDays = 7;
/**
 * Repeats of one incident are recorded at most once in this many seconds
 * (#151): a damaged record that every page load meets does not write to D1
 * on every request. Occurrences therefore count the recorded repeats. A
 * resolved incident is reopened at once.
 */
export const integrityIncidentThrottleSeconds = 60;
/**
 * The practice's recorded integrity incidents for its administrators: how
 * many were ever recorded, how many are open (neither acknowledged nor
 * resolved), how many of those were last seen in the past
 * {@link integrityIncidentRecentDays} days, and the most recently seen ones,
 * newest first. The rows are history: a resolved incident stays listed.
 */
export async function integrityIncidents(ctx: Context) {
  const since = new Date(
    Date.now() - integrityIncidentRecentDays * 86_400_000,
  ).toISOString();
  const [count, rows] = await Promise.all([
    db()
      .prepare(
        "SELECT COUNT(*) AS n,COALESCE(SUM(handling='open'),0) AS open,COALESCE(SUM(handling='open' AND last_seen>=?),0) AS recent FROM integrity_incidents WHERE tenant_id=?",
      )
      .bind(since, ctx.tenantId)
      .first<{ n: number; open: number; recent: number }>(),
    db()
      .prepare(
        "SELECT i.engagement_id,e.title,i.object_key,i.kind,i.status,i.first_seen,i.last_seen,i.occurrences,COALESCE(m.display_name,i.last_user_id) AS last_seen_by,i.handling,i.handled_at,CASE WHEN i.handled_by IS NULL THEN NULL ELSE COALESCE(h.display_name,i.handled_by) END AS handled_by FROM integrity_incidents i LEFT JOIN engagements e ON e.tenant_id=i.tenant_id AND e.id=i.engagement_id LEFT JOIN memberships m ON m.tenant_id=i.tenant_id AND m.user_id=i.last_user_id LEFT JOIN memberships h ON h.tenant_id=i.tenant_id AND h.user_id=i.handled_by WHERE i.tenant_id=? ORDER BY i.last_seen DESC,i.engagement_id,i.object_key,i.kind LIMIT ?",
      )
      .bind(ctx.tenantId, integrityIncidentLimit)
      .all<{
        engagement_id: string;
        title: string | null;
        object_key: string;
        kind: IntegrityKind;
        status: number;
        first_seen: string;
        last_seen: string;
        occurrences: number;
        last_seen_by: string;
        handling: IncidentHandling;
        handled_at: string | null;
        handled_by: string | null;
      }>(),
  ]);
  return {
    count: count?.n ?? 0,
    open: count?.open ?? 0,
    recent: count?.recent ?? 0,
    incidents: rows.results.map((r): IntegrityIncident => ({
      engagementId: r.engagement_id,
      title: r.title,
      objectKey: r.object_key,
      kind: r.kind,
      status: r.status,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      occurrences: r.occurrences,
      lastSeenBy: r.last_seen_by,
      handling: r.handling,
      handledAt: r.handled_at,
      handledBy: r.handled_by,
    })),
  };
}
export type IntegrityIncidents = Awaited<ReturnType<typeof integrityIncidents>>;

/**
 * Records that an engagement failed to load intact: one row per engagement,
 * stored object and kind, counting repeats at most once per
 * {@link integrityIncidentThrottleSeconds} (a repeat inside that window
 * changes no row), plus a log line on every occurrence. A resolved incident
 * met again is reopened at once. Best effort: a failure to record never
 * fails the request that found the problem.
 */
export async function recordIntegrityIncident(
  ctx: Context,
  error: IntegrityError,
) {
  console.error(
    "Engagement integrity incident",
    JSON.stringify({
      tenantId: ctx.tenantId,
      engagementId: error.engagementId,
      kind: error.kind,
      objectKey: error.objectKey,
    }),
  );
  try {
    const at = now(),
      throttled = new Date(
        Date.parse(at) - integrityIncidentThrottleSeconds * 1000,
      ).toISOString();
    // SET reads the row as it was, so a resolved incident reopens.
    await db()
      .prepare(
        "INSERT INTO integrity_incidents(tenant_id,engagement_id,object_key,kind,status,first_seen,last_seen,last_user_id,occurrences) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(tenant_id,engagement_id,object_key,kind) DO UPDATE SET last_seen=excluded.last_seen,last_user_id=excluded.last_user_id,status=excluded.status,occurrences=occurrences+1,handling=CASE WHEN handling='resolved' THEN 'open' ELSE handling END,handled_at=CASE WHEN handling='resolved' THEN NULL ELSE handled_at END,handled_by=CASE WHEN handling='resolved' THEN NULL ELSE handled_by END WHERE integrity_incidents.last_seen<=? OR integrity_incidents.handling='resolved'",
      )
      .bind(
        ctx.tenantId,
        error.engagementId,
        error.objectKey,
        error.kind,
        error.status,
        at,
        at,
        ctx.user.userId,
        throttled,
      )
      .run();
  } catch {
    // The log line above still records the incident.
  }
}
