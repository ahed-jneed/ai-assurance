// Server-side search and review queue over an engagement's assurance records.
// Both run as one scoped SQL query (tenant and engagement first, so they use
// idx_assurance_order / idx_assurance_kind) and return keyset pages, so their
// results cover every record of the engagement and never load all of them.
// The review states are workbenchReviewState and workbenchReviewQueue of
// lib/workbench-presentation.ts, in SQL; lib/assurance-search.test.ts keeps
// the two in agreement.
import type { AssuranceRecord } from "./assurance-core";
import {
  assessmentKinds,
  decodeCursor,
  encodeCursor,
  parsed,
  recordsById,
  type RecordRow,
} from "./assurance-store";
import { db } from "./bindings";
import type { Role } from "./domain";
import { ApiError } from "./http";
import type { Context } from "./tenancy";

export const reviewStates = [
  "Awaiting review",
  "Confirmed",
  "Returned",
  "Superseded",
] as const;
export type ReviewState = (typeof reviewStates)[number];
/** A record with its review state; `null` for a record that is not an assessment. */
export type SearchedRecord = AssuranceRecord & {
  reviewState: ReviewState | null;
};
export type RecordSearchPage = {
  records: SearchedRecord[];
  nextCursor: string | null;
  /** How many records match in all; only on the first page (no cursor). */
  total?: number;
};
export type RecordSearch = {
  /** Record kinds to search; empty or absent searches every kind. */
  kinds?: readonly string[];
  /** Text to find; empty or absent matches every record. */
  term?: string;
  /** A review state; assessments in another state are left out. */
  review?: string;
  /** Only assessments (current ones, through `review`) not recorded by this user. */
  notActor?: string;
  cursor?: string;
  limit?: number;
};
/** Default and largest page of a search. */
export const searchPageSize = 50,
  searchPageLimit = 200;
const kindPattern = /^[a-z_]{1,40}$/;

// The latest review of the assessment `r`, as reviewFor's `.at(-1)` in
// (created_at, id) order: the review of its kind whose subject
// (assertionId ?? impactId ?? obligationId, as in memory) is `r.id`. The
// subject expression and the kind list repeat idx_review_subject's
// (migration 0013) exactly, so this is one index lookup per assessment;
// `+r.id` drops the column's text affinity, which the index expression does
// not have and which would otherwise keep the subject out of the lookup.
const latestReview = `(SELECT CASE WHEN json_extract(v.body,'$.decision') IN ('approve','confirmed') THEN 'Confirmed' ELSE 'Returned' END
    FROM assurance_records v
    WHERE v.tenant_id=r.tenant_id AND v.engagement_id=r.engagement_id
      AND v.kind IN ('assertion_review','impact_review','obligation_review')
      AND v.kind=r.kind||'_review'
      AND COALESCE(json_extract(v.body,'$.assertionId'),json_extract(v.body,'$.impactId'),json_extract(v.body,'$.obligationId'))=+r.id
    ORDER BY v.created_at DESC,v.id DESC LIMIT 1)`;
// Superseded first, then the latest matching review decides. `+r.id` keeps the
// supersession check on idx_assessment_successor.
const stateSQL = `CASE
  WHEN r.kind NOT IN ${assessmentKinds} THEN NULL
  WHEN EXISTS(SELECT 1 FROM assurance_records s WHERE s.tenant_id=r.tenant_id AND s.engagement_id=r.engagement_id AND s.kind IN ${assessmentKinds} AND json_extract(s.body,'$.supersedesId')=+r.id) THEN 'Superseded'
  ELSE COALESCE(${latestReview},'Awaiting review')
END`;
// What a search term is matched against: the record's id and kind, every
// field a register shows as its title or context, and the name of the member
// who recorded it.
const searchFields = [
  "name",
  "label",
  "statement",
  "description",
  "title",
  "artifactName",
  "criterion",
  "code",
  "locator",
  "intendedUse",
  "producingRun",
  "action",
];
const haystack = [
  "r.id",
  "replace(r.kind,'_',' ')",
  ...searchFields.map((f) => `COALESCE(json_extract(r.body,'$.${f}'),'')`),
  "COALESCE(m.display_name,'')",
].join("||' '||");

/**
 * How many case forms the haystack replaces for one term: two bound values
 * each. With the other values of a search (at most 29) a query binds at most
 * 89, under D1's limit of 100.
 */
const foldedFormLimit = 30;
/**
 * The case forms of a letter other than its canonical form
 * `c.toUpperCase().toLowerCase()` and that form's upper case, keyed by the
 * canonical form: final sigma, the Greek symbol variants, the title case
 * digraphs, the Ohm, Angstrom and micro signs and the Cyrillic rounded forms.
 * lib/assurance-search.test.ts checks it against every code point.
 */
const otherCaseForms: Record<string, string> = {
  "\u03bc": "\u00b5",
  "\u00e5": "\u212b",
  "\u01c6": "\u01c5",
  "\u01c9": "\u01c8",
  "\u01cc": "\u01cb",
  "\u01f3": "\u01f2",
  "\u03b9": "\u0345\u1fbe",
  "\u03b2": "\u03d0",
  "\u03b5": "\u03f5",
  "\u03b8": "\u03d1\u03f4",
  "\u03ba": "\u03f0",
  "\u03c0": "\u03d6",
  "\u03c1": "\u03f1",
  "\u03c3": "\u03c2",
  "\u03c6": "\u03d5",
  "\u03c9": "\u2126",
  "\u0432": "\u1c80",
  "\u0434": "\u1c81",
  "\u043e": "\u1c82",
  "\u0441": "\u1c83",
  "\u0442": "\u1c84\u1c85",
  "\u044a": "\u1c86",
  "\u0463": "\u1c87",
  "\ua64b": "\u1c88",
  "\u1e61": "\u1e9b",
};
const single = (s: string) => [...s].length === 1;
/**
 * A letter's canonical case form, `c.toUpperCase().toLowerCase()`, or
 * undefined when a case form on the way is not a single character (as "ß"
 * has "SS" and "İ" has "i̇") or the canonical form is ASCII (as for "ı" and
 * "ſ", which SQLite's lower() cannot fold to).
 */
export function canonicalCaseForm(c: string) {
  const upper = c.toUpperCase(),
    canonical = upper.toLowerCase();
  return single(upper) &&
    single(canonical) &&
    single(canonical.toUpperCase()) &&
    canonical.charCodeAt(0) > 127
    ? canonical
    : undefined;
}
/** Every other single-character case form whose canonical form is `canonical`. */
export function caseForms(canonical: string) {
  return [canonical.toUpperCase(), ...(otherCaseForms[canonical] ?? "")].filter(
    (f) => f !== canonical && single(f),
  );
}
/**
 * A condition that finds `term` anywhere in the haystack, ignoring the case of
 * every letter, with its bound values. SQLite's LIKE and lower() fold only
 * ASCII case (D1 has no ICU), and D1 refuses LIKE and GLOB patterns over 50
 * bytes, so each non-ASCII letter of the term is folded to its canonical form
 * (σ for Σ, σ and ς), the haystack goes through lower() and a replace() of
 * every other case form of those letters by their canonical form, and instr()
 * finds the folded term in it. Every character of the term is matched
 * literally. A letter without a single-character canonical form (such as
 * "ß") keeps its case, one whose canonical form is ASCII (such as "ı") is
 * matched by its lower case form, and so is a letter whose forms would take
 * the haystack past `foldedFormLimit` replaced forms.
 */
export function termCondition(term: string) {
  let folded = "";
  const forms = new Map<string, string>();
  for (const c of term) {
    const canonical = canonicalCaseForm(c);
    if (canonical !== undefined) {
      const others = caseForms(canonical).filter((f) => !forms.has(f));
      if (forms.size + others.length <= foldedFormLimit) {
        for (const f of others) forms.set(f, canonical);
        folded += canonical;
        continue;
      }
    }
    folded += single(c.toLowerCase()) ? c.toLowerCase() : c;
  }
  let sql = `lower(${haystack})`;
  for (let i = 0; i < forms.size; i++) sql = `replace(${sql},?,?)`;
  return {
    sql: `instr(${sql},?)>0`,
    values: [...[...forms].flat(), folded],
  };
}

function validKinds(kinds: readonly string[] = []) {
  if (kinds.length > 20 || !kinds.every((k) => kindPattern.test(k)))
    throw new ApiError(400, "Invalid record kinds");
  return [...new Set(kinds)];
}
/**
 * One page of the engagement's records that match `search`, in (created_at,
 * id) order, each with its review state. Matching ignores the case of every
 * letter (Unicode simple case mapping) and treats every character of the
 * term literally.
 */
export async function searchRecords(
  ctx: Context,
  engagementId: string,
  search: RecordSearch = {},
): Promise<RecordSearchPage> {
  const kinds = validKinds(search.kinds),
    term = (search.term ?? "").trim().slice(0, 200),
    review = search.review && search.review !== "all" ? search.review : "",
    limit = Math.min(
      Math.max(Math.trunc(search.limit ?? searchPageSize) || 1, 1),
      searchPageLimit,
    );
  if (review && !reviewStates.includes(review as ReviewState))
    throw new ApiError(400, "Invalid review state");
  const filters = ["r.tenant_id=?", "r.engagement_id=?"],
    values: (string | number)[] = [ctx.tenantId, engagementId];
  if (kinds.length) {
    filters.push("r.kind IN (" + kinds.map(() => "?").join(",") + ")");
    values.push(...kinds);
  }
  if (search.notActor !== undefined) {
    filters.push("r.kind IN " + assessmentKinds, "r.actor<>?");
    values.push(search.notActor);
  }
  if (term) {
    const condition = termCondition(term);
    filters.push(condition.sql);
    values.push(...condition.values);
  }
  const page = [...filters],
    pageValues = [...values];
  if (search.cursor) {
    const [createdAt, recordId] = decodeCursor(search.cursor);
    page.push("r.created_at>=?", "(r.created_at>? OR r.id>?)");
    pageValues.push(createdAt, createdAt, recordId);
  }
  const query = (where: string[]) =>
    `WITH matched AS (
  SELECT r.id,r.kind,r.body,r.sha256,r.created_at,r.actor,${stateSQL} AS review_state
  FROM assurance_records r
  LEFT JOIN memberships m ON m.tenant_id=r.tenant_id AND m.user_id=r.actor
  WHERE ${where.join(" AND ")}
)`;
  const reviewFilter = review
      ? " WHERE review_state IS NULL OR review_state=?"
      : "",
    reviewValues = review ? [review] : [];
  const rows = (
    await db()
      .prepare(
        query(page) +
          " SELECT * FROM matched" +
          reviewFilter +
          " ORDER BY created_at,id LIMIT ?",
      )
      .bind(...pageValues, ...reviewValues, limit + 1)
      .all<RecordRow & { review_state: ReviewState | null }>()
  ).results;
  const records = rows.slice(0, limit).map((row) => ({
    ...parsed(row),
    reviewState: row.review_state,
  }));
  const result: RecordSearchPage = {
    records,
    nextCursor:
      rows.length > limit ? encodeCursor(records[records.length - 1]) : null,
  };
  if (!search.cursor)
    result.total =
      rows.length <= limit
        ? records.length
        : ((
            await db()
              .prepare(
                query(filters) +
                  " SELECT COUNT(*) AS n FROM matched" +
                  reviewFilter,
              )
              .bind(...values, ...reviewValues)
              .first<{ n: number }>()
          )?.n ?? 0);
  return result;
}

export const queueStates = [
  "awaiting",
  "returned",
  "reviewable",
  "revisable",
] as const;
export type QueueState = (typeof queueStates)[number];
const canReview = (role: Role) => ["Lead Auditor", "Reviewer"].includes(role),
  canRevise = (role: Role) => ["Lead Auditor", "Auditor"].includes(role);
/**
 * One page of a review queue for the caller: current assessments awaiting
 * review or returned for revision; `reviewable` leaves out the caller's own
 * assessments (independent review) and is empty for a role that cannot
 * review, `revisable` is empty for a role that cannot revise.
 */
export async function reviewQueuePage(
  ctx: Context,
  engagementId: string,
  state: QueueState,
  { cursor, limit }: { cursor?: string; limit?: number } = {},
): Promise<RecordSearchPage> {
  if (
    (state === "reviewable" && !canReview(ctx.role)) ||
    (state === "revisable" && !canRevise(ctx.role))
  )
    return cursor
      ? { records: [], nextCursor: null }
      : { records: [], nextCursor: null, total: 0 };
  return searchRecords(ctx, engagementId, {
    kinds: ["assertion", "impact", "obligation"],
    review:
      state === "awaiting" || state === "reviewable"
        ? "Awaiting review"
        : "Returned",
    notActor: state === "reviewable" ? ctx.user.userId : undefined,
    cursor,
    limit,
  });
}
/**
 * The caller's review queue at a glance: how many current assessments await
 * review or were returned, how many of those the caller may review or revise,
 * and the first assessment of each (in record order) to open next.
 */
export async function reviewQueueSummary(ctx: Context, engagementId: string) {
  const firsts = await Promise.all(
    queueStates.map((state) =>
      reviewQueuePage(ctx, engagementId, state, { limit: 1 }),
    ),
  );
  const [awaiting, returned, reviewable, revisable] = firsts;
  return {
    awaiting: awaiting.total ?? 0,
    returned: returned.total ?? 0,
    reviewable: reviewable.total ?? 0,
    revisable: revisable.total ?? 0,
    canReview: canReview(ctx.role),
    canRevise: canRevise(ctx.role),
    next: {
      awaiting: awaiting.records[0] ?? null,
      returned: returned.records[0] ?? null,
      reviewable: reviewable.records[0] ?? null,
      revisable: revisable.records[0] ?? null,
    },
  };
}
export type ReviewQueueSummary = Awaited<ReturnType<typeof reviewQueueSummary>>;

/**
 * Body fields that name other assurance records of the engagement; the record
 * details link them (app/assurance-record-details.tsx).
 */
export const recordReferenceFields = [
  "systemId",
  "predictionId",
  "datasetCardRecordId",
  "sourceIds",
  "affectedIds",
  "supersedesId",
  "assertionId",
  "impactId",
  "obligationId",
  "assistantId",
  "locationId",
  "recordId",
  "citationIds",
  "previousId",
  "newId",
] as const;
/** At most this many referenced records are loaded with a record. */
export const recordReferenceLimit = 500;
/**
 * The ids a record's body names in its reference fields, at the top level or
 * in a list of entries (such as an assertion's source relationships).
 */
export function referencedIds(record: AssuranceRecord) {
  const ids: string[] = [],
    collect = (body: unknown) => {
      if (!body || typeof body !== "object" || Array.isArray(body)) return;
      for (const field of recordReferenceFields)
        for (const value of [(body as Record<string, unknown>)[field]].flat())
          if (typeof value === "string" && value !== record.id) ids.push(value);
    };
  collect(record.body);
  for (const value of Object.values(record.body ?? {}))
    if (Array.isArray(value)) value.forEach(collect);
  return [...new Set(ids)].slice(0, recordReferenceLimit);
}
export type RecordContext = {
  record: AssuranceRecord;
  /** The record's review state; `null` for a record that is not an assessment. */
  reviewState: ReviewState | null;
  /**
   * The records its details read: its reviews, the assessments that supersede
   * it and the records its body names, in (created_at, id) order.
   */
  related: AssuranceRecord[];
};
/**
 * One record of the engagement with what its details need, read by id rather
 * than from a load of every record: its reviews (through idx_review_subject),
 * its successors (through idx_assessment_successor) and the records it names.
 */
export async function recordContext(
  ctx: Context,
  engagementId: string,
  recordId: string,
): Promise<RecordContext> {
  const [record] = await recordsById(ctx, engagementId, [recordId]);
  if (!record) throw new ApiError(404, "Assurance record not found");
  const assessment = ["assertion", "impact", "obligation"].includes(
    record.kind,
  );
  const [reviews, successors, named] = await Promise.all([
    assessment
      ? db()
          .prepare(
            "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records v WHERE v.tenant_id=? AND v.engagement_id=? AND v.kind IN ('assertion_review','impact_review','obligation_review') AND v.kind=? AND COALESCE(json_extract(v.body,'$.assertionId'),json_extract(v.body,'$.impactId'),json_extract(v.body,'$.obligationId'))=? ORDER BY v.created_at,v.id",
          )
          .bind(ctx.tenantId, engagementId, record.kind + "_review", record.id)
          .all<RecordRow>()
          .then((r) => r.results.map(parsed))
      : [],
    assessment
      ? db()
          .prepare(
            "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind IN " +
              assessmentKinds +
              " AND json_extract(body,'$.supersedesId')=? ORDER BY created_at,id",
          )
          .bind(ctx.tenantId, engagementId, record.id)
          .all<RecordRow>()
          .then((r) => r.results.map(parsed))
      : [],
    recordsById(ctx, engagementId, referencedIds(record)),
  ]);
  const related = new Map<string, AssuranceRecord>();
  for (const r of [...reviews, ...successors, ...named]) related.set(r.id, r);
  const ordered = [...related.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
  const latest = reviews.at(-1);
  return {
    record,
    reviewState: !assessment
      ? null
      : successors.length
        ? "Superseded"
        : !latest
          ? "Awaiting review"
          : ["approve", "confirmed"].includes(latest.body.decision)
            ? "Confirmed"
            : "Returned",
    related: ordered,
  };
}
