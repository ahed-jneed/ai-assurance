import { z } from "zod";
import {
  ApiError,
  checkOrigin,
  context,
  db,
  loadEngagement,
  now,
  readJson,
  requireRole,
  responseError,
} from "@/lib/store";
import { procedureDraftRevision } from "@/lib/workflow-state";
import {
  defaultPreferences,
  draftKinds,
  preferencesSchema,
  type DraftKind,
} from "@/lib/workspace-state";
import {
  navigationRoutes,
  permittedNavigationRoutes,
  type NavigationRoute,
} from "@/lib/navigation-preferences";
export const dynamic = "force-dynamic";
const short = z.string().min(1).max(300);
async function target(
  ctx: Awaited<ReturnType<typeof context>>,
  engagementId: string,
  kind: DraftKind,
  recordId: string,
  writing = false,
) {
  requireRole(ctx, ["Auditor", "Lead Auditor", "Reviewer"]);
  // Drafts check revisions and locks only, never the record's R2 parts.
  const e = await loadEngagement(ctx, engagementId);
  if (writing) requireRole(ctx, ["Auditor", "Lead Auditor"]);
  if (kind === "paper") {
    const p = e.papers.find((p) => p.id === recordId);
    if (!p) throw new ApiError(404, "Paper not found");
    if (
      writing &&
      (p.status === "signed" ||
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        ))
    )
      throw new ApiError(
        409,
        "This paper is locked. Update its source procedure.",
      );
    return { revision: p.revision + ":" + p.updatedAt, e };
  }
  if (!e.workflow) throw new ApiError(409, "Adopt the audit workflow first");
  if (kind === "brief")
    return { revision: String(e.workflow.brief?.revision ?? 0), e };
  const p = e.workflow.procedures.find((p) => p.id === recordId);
  if (!p) throw new ApiError(404, "Procedure not found");
  if (
    writing &&
    kind !== "procedure-plan" &&
    p.ownerId !== ctx.user.userId &&
    ctx.role !== "Lead Auditor"
  )
    throw new ApiError(
      403,
      "Only the assigned preparer or Lead may draft this execution",
    );
  return { revision: procedureDraftRevision(e.workflow, p, kind), e };
}
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      ctx = await context(u.searchParams.get("tenantId") ?? undefined);
    if (u.searchParams.get("kind") === "preferences") {
      const row = await db()
        .prepare(
          "SELECT body,version,updated_at FROM personal_preferences WHERE tenant_id=? AND user_id=?",
        )
        .bind(ctx.tenantId, ctx.user.userId)
        .first<{ body: string; version: number; updated_at: string }>();
      return Response.json(
        {
          preferences: row
            ? preferencesSchema.parse(JSON.parse(row.body))
            : defaultPreferences,
          version: row?.version ?? 0,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const a = z
      .object({
        engagementId: short,
        kind: z.enum(draftKinds),
        recordId: short,
      })
      .parse(Object.fromEntries(u.searchParams));
    const t = await target(ctx, a.engagementId, a.kind, a.recordId);
    const row = await db()
      .prepare(
        "SELECT body,base_revision,version,updated_at FROM workspace_drafts WHERE tenant_id=? AND engagement_id=? AND user_id=? AND kind=? AND record_id=?",
      )
      .bind(ctx.tenantId, a.engagementId, ctx.user.userId, a.kind, a.recordId)
      .first<{
        body: string;
        base_revision: string;
        version: number;
        updated_at: string;
      }>();
    return Response.json(
      {
        draft: row
          ? {
              content: JSON.parse(row.body),
              baseRevision: row.base_revision,
              version: row.version,
              updatedAt: row.updated_at,
              current: row.base_revision === t.revision,
            }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid recovery request" },
        { status: 400 },
      );
    return responseError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const raw = (await readJson(request, 65536)) as {
        tenantId?: unknown;
        kind?: unknown;
      },
      ctx = await context(short.parse(raw.tenantId));
    if (raw.kind === "preferences") {
      const a = z
        .object({
          tenantId: short,
          kind: z.literal("preferences"),
          expectedVersion: z.number().int().nonnegative(),
          preferences: preferencesSchema,
        })
        .strict()
        .parse(raw);
      const allowed = permittedNavigationRoutes(ctx.role, true);
      if (
        a.preferences.views.some(
          (v) =>
            !navigationRoutes.includes(v.module as NavigationRoute) ||
            !allowed.includes(v.module as NavigationRoute),
        )
      )
        throw new ApiError(
          400,
          "Choose an authorized destination for each saved view",
        );
      const args = [ctx.tenantId, ctx.user.userId, ctx.role];
      const guard =
        "EXISTS(SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND role=? AND status='active')";
      const r =
        a.expectedVersion === 0
          ? await db()
              .prepare(
                "INSERT OR IGNORE INTO personal_preferences(tenant_id,user_id,body,version,updated_at) SELECT ?,?,?,1,? WHERE " +
                  guard,
              )
              .bind(
                ctx.tenantId,
                ctx.user.userId,
                JSON.stringify(a.preferences),
                now(),
                ...args,
              )
              .run()
          : await db()
              .prepare(
                "UPDATE personal_preferences SET body=?,version=version+1,updated_at=? WHERE tenant_id=? AND user_id=? AND version=? AND " +
                  guard,
              )
              .bind(
                JSON.stringify(a.preferences),
                now(),
                ctx.tenantId,
                ctx.user.userId,
                a.expectedVersion,
                ...args,
              )
              .run();
      if (!r.meta.changes)
        throw new ApiError(409, "Preferences or access changed. Reload them.");
      return Response.json({ version: a.expectedVersion + 1 });
    }
    const a = z
        .object({
          tenantId: short,
          engagementId: short,
          kind: z.enum(draftKinds),
          recordId: short,
          baseRevision: short,
          expectedVersion: z.number().int().nonnegative(),
          content: z.record(z.unknown()),
        })
        .strict()
        .parse(raw),
      t = await target(ctx, a.engagementId, a.kind, a.recordId, true);
    if (a.baseRevision !== t.revision)
      throw new ApiError(
        409,
        "The source changed. Your recovery draft remains available; compare it with the saved revision.",
      );
    const content =
      a.kind === "paper"
        ? z
            .object({
              body: z.record(z.string().max(20000)),
              evidenceIds: z.array(short).max(300),
              required: z.boolean(),
            })
            .strict()
            .parse(a.content)
        : z
            .record(
              z.union([
                z.string().max(8000),
                z.array(z.string().max(300)).max(300),
              ]),
            )
            .parse(a.content);
    const body = JSON.stringify(content);
    if (new TextEncoder().encode(body).length > 50000)
      throw new ApiError(
        413,
        "Recovery draft exceeds 50 KB. Save an audit revision.",
      );
    const guard =
      "EXISTS(SELECT 1 FROM memberships m JOIN engagement_access x ON x.tenant_id=m.tenant_id AND x.user_id=m.user_id JOIN engagements e ON e.tenant_id=x.tenant_id AND e.id=x.engagement_id WHERE m.tenant_id=? AND m.user_id=? AND m.role=? AND m.status='active' AND x.engagement_id=? AND x.active=1 AND e.version=?)";
    const args = [ctx.tenantId, ctx.user.userId, ctx.role, t.e.id, t.e.version];
    let r;
    if (a.expectedVersion === 0)
      r = await db()
        .prepare(
          "INSERT OR IGNORE INTO workspace_drafts(tenant_id,engagement_id,user_id,kind,record_id,base_revision,body,version,updated_at) SELECT ?,?,?,?,?,?,?,1,? WHERE " +
            guard,
        )
        .bind(
          ctx.tenantId,
          t.e.id,
          ctx.user.userId,
          a.kind,
          a.recordId,
          a.baseRevision,
          body,
          now(),
          ...args,
        )
        .run();
    else
      r = await db()
        .prepare(
          "UPDATE workspace_drafts SET body=?,base_revision=?,version=version+1,updated_at=? WHERE tenant_id=? AND engagement_id=? AND user_id=? AND kind=? AND record_id=? AND version=? AND " +
            guard,
        )
        .bind(
          body,
          a.baseRevision,
          now(),
          ctx.tenantId,
          t.e.id,
          ctx.user.userId,
          a.kind,
          a.recordId,
          a.expectedVersion,
          ...args,
        )
        .run();
    if (!r.meta.changes)
      throw new ApiError(
        409,
        "Draft or access changed. Reload before replacing the recovery copy.",
      );
    return Response.json(
      { version: a.expectedVersion + 1, updatedAt: now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    return responseError(e);
  }
}
