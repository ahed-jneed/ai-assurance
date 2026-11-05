import {
  ApiError,
  db,
  id,
  now,
  sha256,
  getEngagement,
  save,
  type Context,
} from "./store";
import type { AssuranceRecord } from "./assurance-core";
export async function records(ctx: Context, engagementId: string) {
  const rows = (
    await db()
      .prepare(
        "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE tenant_id=? AND engagement_id=? ORDER BY created_at,id LIMIT 1001",
      )
      .bind(ctx.tenantId, engagementId)
      .all<{
        id: string;
        kind: string;
        body: string;
        sha256: string;
        created_at: string;
        actor: string;
      }>()
  ).results;
  if (rows.length > 1000)
    throw new ApiError(
      413,
      "Use a scoped export for audit files exceeding 1,000 assurance records",
    );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    body: JSON.parse(r.body),
    sha256: r.sha256,
    createdAt: r.created_at,
    actor: r.actor,
  })) as AssuranceRecord[];
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
export async function assurancePins(ctx: Context, engagementId: string) {
  return (await records(ctx, engagementId))
    .filter(
      (r) =>
        ![
          "assistant",
          "assistant_export",
          "assistant_acceptance",
          "key_rotation",
          "dossier",
          "access_event",
          "worker_event",
        ].includes(r.kind),
    )
    .map((r) => ({ id: r.id, kind: r.kind, sha256: r.sha256 }));
}
export function currentAssessments(all: AssuranceRecord[]) {
  const superseded = new Set(
    all
      .filter((r) => ["assertion", "impact", "obligation"].includes(r.kind))
      .map((r) => r.body.supersedesId)
      .filter(Boolean),
  );
  return all.filter(
    (r) =>
      ["assertion", "impact", "obligation"].includes(r.kind) &&
      !superseded.has(r.id),
  );
}
export async function assuranceGates(
  ctx: Context,
  engagementId: string,
  opinion: string,
) {
  const all = await records(ctx, engagementId),
    messages: string[] = [];
  for (const r of currentAssessments(all)) {
    const review = all
      .filter(
        (x) =>
          x.kind === r.kind + "_review" &&
          (x.body.assertionId ?? x.body.impactId ?? x.body.obligationId) ===
            r.id,
      )
      .at(-1);
    if (!review || !["approve", "confirmed"].includes(review.body.decision))
      messages.push(
        "Independent review required: " +
          (r.body.statement ?? r.body.description ?? r.body.code),
      );
    if (
      r.kind === "assertion" &&
      (r.body.conclusion === "unassessed" ||
        (opinion === "Readiness assessment" &&
          r.body.conclusion !== "supported"))
    )
      messages.push(
        "Assertion does not support this opinion: " + r.body.statement,
      );
    if (
      r.kind === "obligation" &&
      (r.body.applicability === "needs_information" ||
        (opinion === "Readiness assessment" &&
          r.body.applicability === "applicable" &&
          r.body.outcome !== "supported"))
    )
      messages.push("Obligation assessment remains unresolved: " + r.body.code);
  }
  return messages;
}
export async function jobs(ctx: Context, engagementId: string) {
  return (
    await db()
      .prepare(
        "SELECT id,state,request_sha256,created_at,created_by,worker_id,attempt_id,fence,lease_until,result_sha256,error,completed_at,json_extract(request,'$.system.name') AS system_name,json_extract(request,'$.executionMode') AS mode FROM execution_jobs WHERE tenant_id=? AND engagement_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(ctx.tenantId, engagementId)
      .all()
  ).results;
}
export const activeJobGuard =
  "EXISTS(SELECT 1 FROM memberships m JOIN engagement_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=execution_jobs.tenant_id AND m.user_id=execution_jobs.created_by AND m.status='active' AND m.role IN ('Auditor','Lead Auditor') AND a.engagement_id=execution_jobs.engagement_id AND a.active=1) AND EXISTS(SELECT 1 FROM engagements e,json_each(e.body,'$.workflow.procedures') p WHERE e.tenant_id=execution_jobs.tenant_id AND e.id=execution_jobs.engagement_id AND json_extract(e.body,'$.workflow.brief.status')='approved' AND json_extract(e.body,'$.workflow.program.status')='approved' AND json_extract(e.body,'$.workflow.brief.revision')=json_extract(execution_jobs.request,'$.procedure.briefRevision') AND json_extract(e.body,'$.workflow.program.revision')=json_extract(execution_jobs.request,'$.procedure.programRevision') AND json_extract(p.value,'$.id')=json_extract(execution_jobs.request,'$.procedure.id') AND json_extract(p.value,'$.revision')=json_extract(execution_jobs.request,'$.procedure.revision') AND json_extract(p.value,'$.selected')=1)";
