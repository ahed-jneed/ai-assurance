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

// The latest review of each (review kind, subject), as reviewFor's `.at(-1)`
// in (created_at, id) order; the subject is assertionId ?? impactId ??
// obligationId, as in memory.
const latestReviews = `latest AS (
  SELECT kind,subject,decision FROM (
    SELECT kind,
      COALESCE(json_extract(body,'$.assertionId'),json_extract(body,'$.impactId'),json_extract(body,'$.obligationId')) AS subject,
      json_extract(body,'$.decision') AS decision,
      ROW_NUMBER() OVER (PARTITION BY kind,COALESCE(json_extract(body,'$.assertionId'),json_extract(body,'$.impactId'),json_extract(body,'$.obligationId')) ORDER BY created_at DESC,id DESC) AS n
    FROM assurance_records
    WHERE tenant_id=? AND engagement_id=? AND kind IN ('assertion_review','impact_review','obligation_review')
  ) WHERE n=1 AND subject IS NOT NULL
)`;
// Superseded first, then the latest matching review decides. `+r.id` keeps the
// supersession check on idx_assessment_successor.
const stateSQL = `CASE
  WHEN r.kind NOT IN ${assessmentKinds} THEN NULL
  WHEN EXISTS(SELECT 1 FROM assurance_records s WHERE s.tenant_id=r.tenant_id AND s.engagement_id=r.engagement_id AND s.kind IN ${assessmentKinds} AND json_extract(s.body,'$.supersedesId')=+r.id) THEN 'Superseded'
  WHEN l.kind IS NULL THEN 'Awaiting review'
  WHEN l.decision IN ('approve','confirmed') THEN 'Confirmed'
  ELSE 'Returned'
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
 * A GLOB pattern that finds `term` anywhere in a text, ignoring the case of
 * every letter (not only ASCII ones, as LIKE would): each cased character
 * becomes a class of its lower and upper case forms, and `*`, `?` and `[`
 * are matched literally. `%`, `_` and `\` are ordinary characters in GLOB.
 */
export function caseInsensitiveGlob(term: string) {
  let pattern = "";
  for (const c of term) {
    if (c === "*" || c === "?" || c === "[") {
      pattern += "[" + c + "]";
      continue;
    }
    // Only single-character case forms fit in a class (not "SS" for "ß").
    const forms = new Set(
      [c, c.toLowerCase(), c.toUpperCase()].filter((f) => [...f].length === 1),
    );
    pattern += forms.size > 1 ? "[" + [...forms].join("") + "]" : c;
  }
  return "*" + pattern + "*";
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
    values: (string | number)[] = [
      ctx.tenantId,
      engagementId,
      ctx.tenantId,
      engagementId,
    ];
  if (kinds.length) {
    filters.push("r.kind IN (" + kinds.map(() => "?").join(",") + ")");
    values.push(...kinds);
  }
  if (search.notActor !== undefined) {
    filters.push("r.kind IN " + assessmentKinds, "r.actor<>?");
    values.push(search.notActor);
  }
  if (term) {
    filters.push(`(${haystack}) GLOB ?`);
    values.push(caseInsensitiveGlob(term));
  }
  const page = [...filters],
    pageValues = [...values];
  if (search.cursor) {
    const [createdAt, recordId] = decodeCursor(search.cursor);
    page.push("r.created_at>=?", "(r.created_at>? OR r.id>?)");
    pageValues.push(createdAt, createdAt, recordId);
  }
  const query = (where: string[]) =>
    `WITH ${latestReviews}, matched AS (
  SELECT r.id,r.kind,r.body,r.sha256,r.created_at,r.actor,${stateSQL} AS review_state
  FROM assurance_records r
  LEFT JOIN latest l ON l.kind=r.kind||'_review' AND l.subject=r.id
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
