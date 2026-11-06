// Assurance records: the immutable, hashed statements of an engagement
// (systems, sources, assessments and their reviews, briefings and events). An
// engagement may hold any number of them, so no function here returns them
// all: listings are cursor-paginated, ops look up the records they name, and
// the report gates and pins are computed in SQL.
import type { AssuranceRecord } from "./assurance-core";
import { db } from "./bindings";
import { requiresSupport } from "./domain/report-model";
import { getEngagement, save } from "./engagement-repo";
import { ApiError } from "./http";
import { id, now, sha256 } from "./ids";
import type { Context } from "./tenancy";

export type RecordRow = {
  id: string;
  kind: string;
  body: string;
  sha256: string;
  created_at: string;
  actor: string;
};
export function parsed(r: RecordRow): AssuranceRecord {
  return {
    id: r.id,
    kind: r.kind,
    body: JSON.parse(r.body),
    sha256: r.sha256,
    createdAt: r.created_at,
    actor: r.actor,
  };
}

/** Records per page of an engagement's record listing. */
export const assurancePageSize = 200;
/** One page of records in (created_at, id) order and the cursor of the next. */
export type AssuranceRecordPage = {
  records: AssuranceRecord[];
  nextCursor: string | null;
};
// A cursor is the (created_at, id) of the last record of a page, opaque to
// callers: base64url of a JSON pair.
export function encodeCursor(r: Pick<AssuranceRecord, "createdAt" | "id">) {
  const bytes = new TextEncoder().encode(JSON.stringify([r.createdAt, r.id]));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function readCursor(cursor: string): unknown {
  try {
    const binary = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      ),
    );
  } catch {
    return undefined;
  }
}
export function decodeCursor(cursor: string): [string, string] {
  const v = cursor.length <= 1000 ? readCursor(cursor) : undefined;
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    !v.every((x) => typeof x === "string")
  )
    throw new ApiError(400, "Invalid page cursor");
  return [v[0], v[1]];
}

/**
 * A page of the engagement's records, optionally of one kind, after `cursor`.
 * Records that share a timestamp continue in id order, so paging neither
 * repeats nor skips a record.
 */
export async function recordPage(
  ctx: Context,
  engagementId: string,
  {
    kind,
    cursor,
    limit = assurancePageSize,
  }: { kind?: string; cursor?: string; limit?: number } = {},
): Promise<AssuranceRecordPage> {
  const filters = ["tenant_id=?", "engagement_id=?"],
    values: (string | number)[] = [ctx.tenantId, engagementId];
  if (kind) {
    filters.push("kind=?");
    values.push(kind);
  }
  if (cursor) {
    const [createdAt, recordId] = decodeCursor(cursor);
    // created_at>=? lets idx_assurance_order seek to the page start.
    filters.push("created_at>=?", "(created_at>? OR id>?)");
    values.push(createdAt, createdAt, recordId);
  }
  const rows = (
    await db()
      .prepare(
        "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE " +
          filters.join(" AND ") +
          " ORDER BY created_at,id LIMIT ?",
      )
      .bind(...values, limit + 1)
      .all<RecordRow>()
  ).results;
  const records = rows.slice(0, limit).map(parsed);
  return {
    records,
    nextCursor:
      rows.length > limit ? encodeCursor(records[records.length - 1]) : null,
  };
}
export async function recordCount(ctx: Context, engagementId: string) {
  const row = await db()
    .prepare(
      "SELECT COUNT(*) AS n FROM assurance_records WHERE tenant_id=? AND engagement_id=?",
    )
    .bind(ctx.tenantId, engagementId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
/**
 * The records with these ids, in (created_at, id) order; values that are not
 * the id of a record of this engagement are ignored. One query whatever the
 * count: the ids travel as a single JSON array parameter.
 */
export async function recordsById(
  ctx: Context,
  engagementId: string,
  ids: readonly unknown[],
) {
  const wanted = [
    ...new Set(ids.filter((v): v is string => typeof v === "string")),
  ];
  if (!wanted.length) return [];
  return (
    await db()
      .prepare(
        "SELECT r.id,r.kind,r.body,r.sha256,r.created_at,r.actor FROM json_each(?) j CROSS JOIN assurance_records r ON r.tenant_id=? AND r.engagement_id=? AND r.id=j.value ORDER BY r.created_at,r.id",
      )
      .bind(JSON.stringify(wanted), ctx.tenantId, engagementId)
      .all<RecordRow>()
  ).results.map(parsed);
}
/**
 * The exact stored JSON of these records with their digests, by id, for
 * embedding byte for byte. Missing ids are absent from the map.
 */
export async function storedBodies(
  ctx: Context,
  engagementId: string,
  ids: readonly string[],
) {
  const rows = ids.length
    ? (
        await db()
          .prepare(
            "SELECT r.id,r.body,r.sha256 FROM json_each(?) j CROSS JOIN assurance_records r ON r.tenant_id=? AND r.engagement_id=? AND r.id=j.value",
          )
          .bind(JSON.stringify([...new Set(ids)]), ctx.tenantId, engagementId)
          .all<{ id: string; body: string; sha256: string }>()
      ).results
    : [];
  return new Map(rows.map((r) => [r.id, { body: r.body, sha256: r.sha256 }]));
}
export const assessmentKinds = "('assertion','impact','obligation')";
export type AssessmentKind = "assertion" | "impact" | "obligation";
/** Whether an assessment of `kind` already supersedes the record `recordId`. */
export async function hasSuccessor(
  ctx: Context,
  engagementId: string,
  kind: AssessmentKind,
  recordId: string,
) {
  // The literal kind list matches idx_assessment_successor's WHERE clause.
  return !!(await db()
    .prepare(
      "SELECT 1 FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind IN " +
        assessmentKinds +
        " AND kind=? AND json_extract(body,'$.supersedesId')=? LIMIT 1",
    )
    .bind(ctx.tenantId, engagementId, kind, recordId)
    .first());
}
/** Whether a system revision with exactly this name and version exists. */
export async function systemRevisionExists(
  ctx: Context,
  engagementId: string,
  name: string,
  version: string,
) {
  return !!(await db()
    .prepare(
      "SELECT 1 FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind='system' AND json_extract(body,'$.name')=? AND json_extract(body,'$.version')=? LIMIT 1",
    )
    .bind(ctx.tenantId, engagementId, name, version)
    .first());
}
/** The name and version of every dataset card, oldest first. */
export async function datasetVersions(ctx: Context, engagementId: string) {
  return (
    await db()
      .prepare(
        "SELECT json_extract(body,'$.name') AS name,json_extract(body,'$.version') AS version FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind='dataset' ORDER BY created_at,id",
      )
      .bind(ctx.tenantId, engagementId)
      .all<{ name: string; version: string }>()
  ).results;
}
/** The earliest export of this briefing packet to this destination. */
export async function briefingExport(
  ctx: Context,
  engagementId: string,
  packetSha256: string,
  processingDestination: string,
) {
  const row = await db()
    .prepare(
      "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind='assistant_export' AND json_extract(body,'$.packetSha256')=? AND json_extract(body,'$.processingDestination')=? ORDER BY created_at,id LIMIT 1",
    )
    .bind(ctx.tenantId, engagementId, packetSha256, processingDestination)
    .first<RecordRow>();
  return row ? parsed(row) : undefined;
}
/** The dossier sealed for this report and audience (at most one exists). */
export async function dossierSeal(
  ctx: Context,
  engagementId: string,
  reportId: string,
  audience: string,
) {
  const row = await db()
    .prepare(
      "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind='dossier' AND json_extract(body,'$.reportId')=? AND json_extract(body,'$.audience')=? ORDER BY created_at,id LIMIT 1",
    )
    .bind(ctx.tenantId, engagementId, reportId, audience)
    .first<RecordRow>();
  return row ? parsed(row) : undefined;
}
export async function recordStatement(
  ctx: Context,
  engagementId: string,
  kind: string,
  body: Record<string, unknown>,
  recordId = id("AS"),
) {
  const text = JSON.stringify(body);
  if (new TextEncoder().encode(text).length > 150000)
    throw new ApiError(
      413,
      "Assurance record exceeds its size limit; store source bytes as evidence",
    );
  const sha = await sha256(text),
    at = now();
  const statement = db()
    .prepare(
      "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships m JOIN engagement_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role=? AND m.status='active' AND a.engagement_id=? AND a.active=1)",
    )
    .bind(
      ctx.tenantId,
      engagementId,
      recordId,
      kind,
      text,
      sha,
      at,
      ctx.user.userId,
      ctx.tenantId,
      ctx.user.userId,
      ctx.role,
      engagementId,
    );
  const guarded = (commandId: string) =>
    db()
      .prepare(
        "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
      )
      .bind(
        ctx.tenantId,
        engagementId,
        recordId,
        kind,
        text,
        sha,
        at,
        ctx.user.userId,
        ctx.tenantId,
        engagementId,
        commandId,
      );
  return {
    statement,
    guarded,
    record: {
      id: recordId,
      kind,
      body,
      sha256: sha,
      createdAt: at,
      actor: ctx.user.userId,
    },
  };
}
export async function addRecord(
  ctx: Context,
  engagementId: string,
  kind: string,
  body: Record<string, unknown>,
) {
  const { guarded, record } = await recordStatement(
      ctx,
      engagementId,
      kind,
      body,
    ),
    e = await getEngagement(ctx, engagementId);
  await save(
    ctx,
    e,
    e.version,
    "assurance:" + kind,
    { recordId: record.id, sha256: record.sha256 },
    (cmd) => [guarded(cmd)],
  );
  return record;
}
// Kinds a report does not pin: briefing proposals and exports, dossiers and
// operational events.
const unpinnedKinds =
  "('assistant','assistant_export','assistant_acceptance','key_rotation','dossier','access_event','worker_event')";
/**
 * What a report captures of the engagement's assurance records: the id, kind
 * and digest of every pinned record, oldest first. Reads only
 * idx_assurance_order, never a record body.
 */
export async function assurancePins(ctx: Context, engagementId: string) {
  return (
    await db()
      .prepare(
        "SELECT id,kind,sha256 FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind NOT IN " +
          unpinnedKinds +
          " ORDER BY created_at,id",
      )
      .bind(ctx.tenantId, engagementId)
      .all<{ id: string; kind: string; sha256: string }>()
  ).results.map((r) => ({ id: r.id, kind: r.kind, sha256: r.sha256 }));
}
// Every current assessment (no assessment supersedes it) with whether its
// latest review of the matching kind approves it: currentAssessments and
// reviewFor of lib/assurance-store-client.ts, in SQL. Each assessment and its
// reviews share a (family, subject) window; reviews sort first, newest first.
// Fields come as JSON text (->), so a missing field reads as undefined and a
// JSON null as null, as they do in memory. `+d.id` keeps the supersession
// check on idx_assessment_successor.
const currentAssessmentsSQL = `WITH items AS (
  SELECT id,kind,created_at,body,
    kind IN ('assertion_review','impact_review','obligation_review') AS review,
    CASE WHEN kind IN ${assessmentKinds} THEN kind ELSE substr(kind,1,length(kind)-7) END AS family,
    CASE WHEN kind IN ${assessmentKinds} THEN id ELSE COALESCE(json_extract(body,'$.assertionId'),json_extract(body,'$.impactId'),json_extract(body,'$.obligationId')) END AS subject
  FROM assurance_records
  WHERE tenant_id=?1 AND engagement_id=?2 AND kind IN ('assertion','impact','obligation','assertion_review','impact_review','obligation_review')
), decided AS (
  SELECT *,FIRST_VALUE(CASE WHEN review THEN json_extract(body,'$.decision') END) OVER (PARTITION BY family,subject ORDER BY review DESC,created_at DESC,id DESC) AS decision
  FROM items
)
SELECT kind,body->'$.statement' AS statement,body->'$.description' AS description,body->'$.code' AS code,body->'$.conclusion' AS conclusion,body->'$.applicability' AS applicability,body->'$.outcome' AS outcome,decision IN ('approve','confirmed') AS approved
FROM decided d
WHERE NOT review AND NOT EXISTS(SELECT 1 FROM assurance_records s WHERE s.tenant_id=?1 AND s.engagement_id=?2 AND s.kind IN ${assessmentKinds} AND json_extract(s.body,'$.supersedesId')=+d.id)
ORDER BY created_at,id`;
type AssessmentField =
  | "statement"
  | "description"
  | "code"
  | "conclusion"
  | "applicability"
  | "outcome";
type AssessmentRow = { kind: string; approved: number | null } & Record<
  AssessmentField,
  string | null
>;
const field = (json: string | null): unknown =>
  json === null ? undefined : JSON.parse(json);
/**
 * Why the engagement's assessments do not yet support `opinion` (a
 * report-model conclusion id or a legacy opinion string), in record
 * order: each current assessment needs an approving independent review, and
 * its own conclusion must fit the opinion.
 */
export async function assuranceGates(
  ctx: Context,
  engagementId: string,
  opinion: string,
) {
  const rows = (
      await db()
        .prepare(currentAssessmentsSQL)
        .bind(ctx.tenantId, engagementId)
        .all<AssessmentRow>()
    ).results,
    messages: string[] = [];
  for (const row of rows) {
    const statement = field(row.statement),
      code = field(row.code),
      conclusion = field(row.conclusion),
      applicability = field(row.applicability);
    if (!row.approved)
      messages.push(
        "Independent review required: " +
          String(statement ?? field(row.description) ?? code),
      );
    if (
      row.kind === "assertion" &&
      (conclusion === "unassessed" ||
        (requiresSupport(opinion) && conclusion !== "supported"))
    )
      messages.push(
        "Assertion does not support this opinion: " + String(statement),
      );
    if (
      row.kind === "obligation" &&
      (applicability === "needs_information" ||
        (requiresSupport(opinion) &&
          applicability === "applicable" &&
          field(row.outcome) !== "supported"))
    )
      messages.push(
        "Obligation assessment remains unresolved: " + String(code),
      );
  }
  return messages;
}
export async function jobs(ctx: Context, engagementId: string) {
  return (
    await db()
      .prepare(
        "SELECT id,state,request_sha256,created_at,created_by,worker_id,attempt_id,fence,lease_until,result_sha256,error,completed_at,json_extract(request,'$.system.name') AS system_name,json_extract(request,'$.executionMode') AS mode,json_extract(request,'$.model.format') AS model_format,json_extract(request,'$.engineConfig.config.positiveLabel') AS positive_label,json_extract(request,'$.engineConfig.negativeLabel') AS negative_label,json_extract(request,'$.engineConfig.modelSpec.decisionThreshold') AS decision_threshold,json_extract(request,'$.engineConfig.modelSpec.predictionKind') AS prediction_kind FROM execution_jobs WHERE tenant_id=? AND engagement_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(ctx.tenantId, engagementId)
      .all()
  ).results;
}
/**
 * SQL that keeps an external job alive: its creator still holds auditor
 * access, the scope and the program are approved, and the job's procedure is
 * selected with the plan revision and scope revision the job was queued for.
 * The program revision is not compared, so a change to another procedure
 * does not stop an unchanged procedure's job (see runBindsProcedure).
 */
export const activeJobGuard =
  "EXISTS(SELECT 1 FROM memberships m JOIN engagement_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=execution_jobs.tenant_id AND m.user_id=execution_jobs.created_by AND m.status='active' AND m.role IN ('Auditor','Lead Auditor') AND a.engagement_id=execution_jobs.engagement_id AND a.active=1) AND EXISTS(SELECT 1 FROM engagements e,json_each(e.body,'$.workflow.procedures') p WHERE e.tenant_id=execution_jobs.tenant_id AND e.id=execution_jobs.engagement_id AND json_extract(e.body,'$.workflow.brief.status')='approved' AND json_extract(e.body,'$.workflow.program.status')='approved' AND json_extract(e.body,'$.workflow.brief.revision')=json_extract(execution_jobs.request,'$.procedure.briefRevision') AND json_extract(p.value,'$.id')=json_extract(execution_jobs.request,'$.procedure.id') AND json_extract(p.value,'$.revision')=json_extract(execution_jobs.request,'$.procedure.revision') AND json_extract(p.value,'$.selected')=1)";
