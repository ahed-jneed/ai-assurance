import { env } from "cloudflare:workers";
import { hydrate, dehydrate } from "./engagement-storage";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import type { Engagement, Paper, Role } from "./domain";
import { roles } from "./domain";
import catalog from "./catalog.json";
import { clientFinding } from "./client-projection";
import { seedWorkflow } from "./workflow-seed";
import { isClientRole, activeGrant, isReleased } from "./workflow-state";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function db() {
  if (!env.DB)
    throw new ApiError(503, "Workspace storage is unavailable. Please retry.");
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET)
    throw new ApiError(503, "Evidence storage is unavailable. Please retry.");
  return env.BUCKET;
}
export async function sha256(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function id(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 12);
}
export function now() {
  return new Date().toISOString();
}
export type Context = {
  user: { userId: string; displayName: string; email: string };
  tenantId: string;
  role: Role;
  clientId: string | null;
  practiceAdmin?: boolean;
};
export function templatePaper(templateId: string, userId: string): Paper {
  const t = catalog.items.find((t) => t.id === templateId);
  if (!t) throw new ApiError(400, "Unknown methodology template");
  return {
    id: id("WP"),
    templateId: t.id,
    title: t.title,
    kind: t.kind,
    stage: t.stage,
    articleRefs: t.regulatoryRefs,
    required:
      t.kind === "working_paper" && t.stage !== "Remediation and Monitoring",
    revision: 1,
    authorId: userId,
    contributors: [],
    updatedAt: now(),
    status: "draft",
    plannedGuidance: t.procedures.map((p) => p.text).join("\n"),
    body: {
      objective: t.objective,
      scope: "",
      criteria: t.regulatoryRefs.join("; "),
      procedures: "",
      sampling: "",
      results: "",
      limitations: "",
      conclusion: "",
      conclusionStatus: "not_evaluated",
    },
    evidenceIds: [],
    runIds: [],
    comments: [],
    reviews: [],
    signatures: [],
    history: [],
  };
}
export function freshEngagement(
  clientId: string,
  title: string,
  userId: string,
  structured = false,
): Engagement {
  return {
    ...(structured ? { workflow: seedWorkflow(userId, now()) } : {}),
    id: id("ENG"),
    clientId,
    title,
    stage: "Planning",
    dueDate: "",
    version: 1,
    classification: {
      prohibited: false,
      highRisk: false,
      transparency: false,
      profiling: false,
      annexRoute: "Unassessed",
      operatorRole: "Provider",
      intendedPurpose: "",
      rationale: "",
      status: "provisional",
      version: "02024R1689-20260727",
      asOf: "2026-10-05",
    },
    papers: structured
      ? []
      : catalog.items
          .filter((t) => t.kind === "working_paper")
          .map((t) => templatePaper(t.id, userId)),
    artifacts: [],
    evidenceRequests: [],
    models: [],
    findings: [],
    runs: [],
    reports: [],
    eventHead: "0".repeat(64),
    createdAt: now(),
  };
}
export async function context(tenantId?: string): Promise<Context> {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, "Sign in to access the audit workspace");
  if (!tenantId) {
    const existing = await db()
      .prepare(
        "SELECT tenant_id FROM memberships WHERE user_id=? AND status='active' ORDER BY tenant_id LIMIT 1",
      )
      .bind(user.userId)
      .first<{ tenant_id: string }>();
    if (existing) tenantId = existing.tenant_id;
    else {
      if (
        await db()
          .prepare("SELECT tenant_id FROM memberships WHERE user_id=? LIMIT 1")
          .bind(user.userId)
          .first()
      )
        throw new ApiError(
          403,
          "Your practice access has been revoked. Contact a Lead Auditor.",
        );
      tenantId = "tenant-" + (await sha256(user.userId)).slice(0, 24);
      const clientId = "CL-default",
        e = freshEngagement(
          clientId,
          "New AI assurance engagement",
          user.userId,
        );
      e.id = "ENG-default";
      const body = JSON.stringify(e);
      await db().batch([
        db()
          .prepare(
            "INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES(?,?,?)",
          )
          .bind(tenantId, "Assurance practice", now()),
        db()
          .prepare(
            "INSERT OR IGNORE INTO memberships(tenant_id,user_id,role,client_id,display_name) VALUES(?,?,?,?,?)",
          )
          .bind(tenantId, user.userId, "Lead Auditor", null, user.displayName),
        db()
          .prepare(
            "INSERT OR IGNORE INTO clients(tenant_id,id,name,sector,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            tenantId,
            clientId,
            "Example client",
            "Financial services",
            now(),
          ),
        db()
          .prepare(
            "INSERT OR IGNORE INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(tenantId, e.id, clientId, e.title, 1, body, "init"),
        db()
          .prepare(
            "INSERT OR IGNORE INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(tenantId, e.id, 1, body, await sha256(body), now()),
      ]);
    }
  }
  const member = await db()
    .prepare(
      "SELECT role,client_id FROM memberships WHERE tenant_id=? AND user_id=? AND status='active'",
    )
    .bind(tenantId, user.userId)
    .first<{ role: Role; client_id: string | null }>();
  if (!member || !roles.includes(member.role))
    throw new ApiError(403, "You do not have access to this practice");
  // Adopt existing practice access once. New members receive no engagement grants.
  // A policy row prevents a revoked grant from being recreated on later reads.
  await db().batch([
    db()
      .prepare(
        "INSERT OR IGNORE INTO practice_admins(tenant_id,user_id,active) SELECT ?,MIN(user_id),1 FROM memberships WHERE tenant_id=? AND role='Lead Auditor' AND status='active' HAVING NOT EXISTS(SELECT 1 FROM practice_admins WHERE tenant_id=?)",
      )
      .bind(tenantId, tenantId, tenantId),
    db()
      .prepare(
        "INSERT OR IGNORE INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT e.tenant_id,e.id,m.user_id,1,'legacy-access-adoption',? FROM engagements e JOIN memberships m ON m.tenant_id=e.tenant_id AND m.status='active' AND m.role IN ('Auditor','Lead Auditor','Reviewer') WHERE e.tenant_id=? AND NOT EXISTS(SELECT 1 FROM engagement_access_policies p WHERE p.tenant_id=e.tenant_id AND p.engagement_id=e.id)",
      )
      .bind(now(), tenantId),
    db()
      .prepare(
        "INSERT OR IGNORE INTO engagement_access_policies(tenant_id,engagement_id,created_at) SELECT tenant_id,id,? FROM engagements WHERE tenant_id=?",
      )
      .bind(now(), tenantId),
  ]);
  const practiceAdmin = !!(await db()
    .prepare(
      "SELECT 1 FROM practice_admins WHERE tenant_id=? AND user_id=? AND active=1",
    )
    .bind(tenantId, user.userId)
    .first());
  return {
    user,
    tenantId,
    role: member.role,
    clientId: member.client_id,
    practiceAdmin,
  };
}
export async function getEngagement(ctx: Context, engagementId: string) {
  const row = await db()
    .prepare(
      "SELECT body,version,client_id FROM engagements WHERE tenant_id=? AND id=?",
    )
    .bind(ctx.tenantId, engagementId)
    .first<{ body: string; version: number; client_id: string }>();
  if (!row || (isClientRole(ctx.role) && ctx.clientId !== row.client_id))
    throw new ApiError(404, "Engagement not found");
  if (
    !isClientRole(ctx.role) &&
    !(await db()
      .prepare(
        "SELECT 1 FROM engagement_access WHERE tenant_id=? AND engagement_id=? AND user_id=? AND active=1",
      )
      .bind(ctx.tenantId, engagementId, ctx.user.userId)
      .first())
  )
    throw new ApiError(404, "Engagement not found");
  const e = JSON.parse(row.body) as Engagement;
  e.version = row.version;
  if (
    ctx.role === "Client Contributor" &&
    activeGrant(e.workflow, ctx.user.userId).length === 0
  )
    throw new ApiError(404, "Engagement not found");
  return hydrate(e);
}
export async function save(
  ctx: Context,
  e: Engagement,
  expectedVersion: number,
  action: string,
  details: Record<string, unknown>,
  extra: (commandId: string) => D1PreparedStatement[] = () => [],
) {
  const commandId = id("CMD"),
    event = {
      id: id("EV"),
      actor: ctx.user.userId,
      action,
      previousHash: e.eventHead,
      createdAt: now(),
      details,
    },
    eventHash = await sha256(JSON.stringify(event));
  e.eventHead = eventHash;
  e.version = expectedVersion + 1;
  const body = JSON.stringify(await dehydrate(ctx, e)),
    hash = await sha256(body);
  if (new TextEncoder().encode(body).byteLength > 1500000)
    throw new ApiError(
      413,
      "The active engagement metadata exceeds its 1.5 MB limit. Archive supplementary active records or split this engagement before adding more content.",
    );
  const guard =
    "EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)";
  const accessGuard =
    ctx.role === "Client Contributor"
      ? " AND EXISTS(SELECT 1 FROM json_each(engagements.body,'$.workflow.clientGrants') g WHERE json_extract(g.value,'$.id')=? AND json_extract(g.value,'$.userId')=? AND json_extract(g.value,'$.requestId')=? AND json_extract(g.value,'$.active')=1 AND julianday(json_extract(g.value,'$.expiresAt'))>julianday('now'))"
      : isClientRole(ctx.role)
        ? ""
        : " AND EXISTS(SELECT 1 FROM engagement_access WHERE tenant_id=? AND engagement_id=? AND user_id=? AND active=1)";
  const results = await db().batch([
    db()
      .prepare(
        "UPDATE engagements SET body=?,title=?,version=?,last_command_id=? WHERE tenant_id=? AND id=? AND version=? AND EXISTS(SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND role=? AND client_id IS ? AND status='active')" +
          accessGuard,
      )
      .bind(
        body,
        e.title,
        e.version,
        commandId,
        ctx.tenantId,
        e.id,
        expectedVersion,
        ctx.tenantId,
        ctx.user.userId,
        ctx.role,
        ctx.clientId,
        ...(ctx.role === "Client Contributor"
          ? [
              String(details.grantId ?? ""),
              ctx.user.userId,
              String(details.requestId ?? ""),
            ]
          : isClientRole(ctx.role)
            ? []
            : [ctx.tenantId, e.id, ctx.user.userId]),
      ),
    db()
      .prepare(
        "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) SELECT ?,?,?,?,?,? WHERE " +
          guard,
      )
      .bind(
        ctx.tenantId,
        e.id,
        e.version,
        body,
        hash,
        now(),
        ctx.tenantId,
        e.id,
        commandId,
      ),
    db()
      .prepare(
        "INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) SELECT ?,?,?,?,?,?,?,?,? WHERE " +
          guard,
      )
      .bind(
        ctx.tenantId,
        e.id,
        event.id,
        event.actor,
        event.action,
        event.previousHash,
        eventHash,
        event.createdAt,
        JSON.stringify(details),
        ctx.tenantId,
        e.id,
        commandId,
      ),
    ...extra(commandId),
  ]);
  if (!results[0].meta.changes)
    throw new ApiError(
      409,
      "The engagement changed. Reload and apply your changes again.",
    );
  return e;
}
export function requireRole(ctx: Context, allowed: Role[]) {
  if (!allowed.includes(ctx.role))
    throw new ApiError(403, "Your role cannot perform this action");
}
export function requireAdmin(ctx: Context) {
  if (!ctx.practiceAdmin)
    throw new ApiError(403, "Practice administration permission is required");
}
export function responseError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Audit workspace request failed",
    error instanceof Error ? error.message : "Unknown failure",
  );
  return Response.json(
    {
      error:
        "The request could not be completed. Your changes were not confirmed.",
    },
    { status: 500 },
  );
}
export function sanitize(e: Engagement, ctx: Context): Engagement {
  if (!isClientRole(ctx.role)) return e;
  const grants =
    e.workflow?.clientGrants.filter(
      (g) =>
        g.userId === ctx.user.userId &&
        g.active &&
        Date.parse(g.expiresAt) > Date.now(),
    ) ?? [];
  const own =
    e.workflow?.submissions.filter(
      (s) =>
        s.actor === ctx.user.userId && grants.some((g) => g.id === s.grantId),
    ) ?? [];
  const ownIds = new Set(own.flatMap((s) => s.evidenceIds));
  const contributor = ctx.role === "Client Contributor";
  return {
    id: e.id,
    clientId: e.clientId,
    title: e.title,
    stage: e.stage,
    dueDate: e.dueDate,
    version: e.version,
    createdAt: e.createdAt,
    eventHead: "",
    classification: { ...e.classification, rationale: "", intendedPurpose: "" },
    papers: [],
    models: [],
    runs: [],
    evaluationProfiles: [],
    evidenceRequests: [],
    findings: contributor
      ? []
      : e.findings.filter((f) => f.visibility === "client").map(clientFinding),
    artifacts: e.artifacts
      .filter(
        (a) =>
          (a.visibility === "client" && a.status === "accepted") ||
          (contributor && ownIds.has(a.id)),
      )
      .map((a) => ({
        ...a,
        key: "",
        uploadedBy: contributor && ownIds.has(a.id) ? a.uploadedBy : "",
      })),
    reports: e.reports.filter(isReleased).map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.release!.releasedAt!,
      actor: "",
      sha256: r.clientSha256!,
      snapshot: r.clientSnapshot!,
    })),
    ...(contributor
      ? {
          portalRequests: grants.map((g) => {
            const r = e.evidenceRequests?.find((r) => r.id === g.requestId);
            return {
              id: g.requestId,
              subject: g.prompt,
              prompt: g.prompt,
              instructions: g.instructions,
              periodVersion: r?.periodVersion ?? "",
              dueDate: r?.dueDate ?? "",
              status: r?.status ?? "open",
              grantId: g.id,
              requestedItems: g.requestedItems ?? [],
              communications: g.communications ?? [],
              submissions: own.filter((s) => s.grantId === g.id),
            };
          }),
        }
      : {}),
  };
}
export async function readBounded(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Request body required");
  const pieces: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "Request exceeds the permitted size");
    }
    pieces.push(part.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of pieces) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new ApiError(403, "A same-origin request is required");
}
