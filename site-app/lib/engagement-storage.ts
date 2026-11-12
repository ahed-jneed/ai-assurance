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
    let o: R2ObjectBody | null;
    try {
      o = await bucket().get(ref.key);
    } catch {
      throw new IntegrityError(engagementId, "unavailable", ref.key);
    }
    if (!o) throw new IntegrityError(engagementId, "missing", ref.key);
    const bytes = await o.arrayBuffer();
    if ((await sha256(bytes)) !== ref.sha256)
      throw new IntegrityError(engagementId, "mismatch", ref.key);
    if (ctx) presentIn(ctx).add(ref.key);
    return new TextDecoder().decode(bytes);
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
};
/** How many incidents the practice view lists, most recently seen first. */
export const integrityIncidentLimit = 50;
/**
 * The practice's recorded integrity incidents for its administrators: how
 * many there are and the most recently seen ones, newest first.
 */
export async function integrityIncidents(ctx: Context) {
  const [count, rows] = await Promise.all([
    db()
      .prepare(
        "SELECT COUNT(*) AS n FROM integrity_incidents WHERE tenant_id=?",
      )
      .bind(ctx.tenantId)
      .first<{ n: number }>(),
    db()
      .prepare(
        "SELECT i.engagement_id,e.title,i.object_key,i.kind,i.status,i.first_seen,i.last_seen,i.occurrences,COALESCE(m.display_name,i.last_user_id) AS last_seen_by FROM integrity_incidents i LEFT JOIN engagements e ON e.tenant_id=i.tenant_id AND e.id=i.engagement_id LEFT JOIN memberships m ON m.tenant_id=i.tenant_id AND m.user_id=i.last_user_id WHERE i.tenant_id=? ORDER BY i.last_seen DESC,i.engagement_id,i.object_key,i.kind LIMIT ?",
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
      }>(),
  ]);
  return {
    count: count?.n ?? 0,
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
    })),
  };
}
export type IntegrityIncidents = Awaited<ReturnType<typeof integrityIncidents>>;

/**
 * Records that an engagement failed to load intact: one row per engagement,
 * stored object and kind, counting repeats, plus a log line. Best effort: a
 * failure to record never fails the request that found the problem.
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
    const at = now();
    await db()
      .prepare(
        "INSERT INTO integrity_incidents(tenant_id,engagement_id,object_key,kind,status,first_seen,last_seen,last_user_id,occurrences) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(tenant_id,engagement_id,object_key,kind) DO UPDATE SET last_seen=excluded.last_seen,last_user_id=excluded.last_user_id,status=excluded.status,occurrences=occurrences+1",
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
      )
      .run();
  } catch {
    // The log line above still records the incident.
  }
}
