import { z } from "zod";
import { bucket, db } from "@/lib/bindings";
import { getEngagement, save } from "@/lib/engagement-repo";
import {
  ApiError,
  checkOrigin,
  parseJsonBody,
  readBounded,
  responseError,
} from "@/lib/http";
import { id, now, sha256 } from "@/lib/ids";
import { context, requireRole } from "@/lib/tenancy";
import { uploadGate, uploadHeader } from "@/lib/special-category";
import { activeGrant } from "@/lib/workflow-state";
import type { Submission } from "@/lib/workflow-types";
export const dynamic = "force-dynamic";
const base = z.object({
  tenantId: z.string().min(1),
  engagementId: z.string().min(1),
  grantId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
});
export async function POST(request: Request) {
  const keys: string[] = [];
  let scope:
    | { tenantId: string; engagementId: string; submissionId: string }
    | undefined;
  try {
    checkOrigin(request);
    const json = request.headers
      .get("content-type")
      ?.includes("application/json");
    const bytes = await readBounded(request, json ? 16384 : 11 * 1024 * 1024);
    const form = json
      ? null
      : await new Request(request.url, {
          method: "POST",
          headers: {
            "content-type": request.headers.get("content-type") ?? "",
          },
          body: bytes,
        }).formData();
    const raw = json ? parseJsonBody(bytes) : Object.fromEntries(form!),
      a = base.parse(raw),
      ctx = await context(a.tenantId);
    requireRole(ctx, ["Client Contributor"]);
    const e = await getEngagement(ctx, a.engagementId);
    if (e.version !== a.expectedVersion)
      throw new ApiError(409, "The request changed. Reload before submitting");
    const g = activeGrant(
      e.workflow,
      ctx.user.userId,
      undefined,
      undefined,
      ctx.accessSince,
    ).find((g) => g.id === a.grantId);
    if (!g) throw new ApiError(403, "Request access expired or was revoked");
    const r = e.evidenceRequests?.find((r) => r.id === g.requestId);
    if (!r || ["accepted", "waived"].includes(r.status))
      throw new ApiError(409, "This request is already complete");
    if (json) {
      const reply = z
        .object({ text: z.string().trim().min(1).max(5000) })
        .parse(raw);
      g.communications ??= [];
      if (g.communications.length >= 80)
        throw new ApiError(
          413,
          "Ask the audit team to open a follow-up request",
        );
      const messageId = id("MSG");
      g.communications.push({
        id: messageId,
        actor: ctx.user.userId,
        at: now(),
        kind: "reply",
        text: reply.text,
      });
      await save(ctx, e, a.expectedVersion, "clientReply", {
        grantId: g.id,
        requestId: r.id,
        messageId,
      });
      return Response.json({ messageId });
    }
    const delivery = z
      .object({
        note: z.string().trim().min(1).max(5000),
        delivery: z.enum(["partial", "complete"]),
        remaining: z.string().max(5000),
      })
      .parse(raw);
    if (delivery.delivery === "partial" && !delivery.remaining.trim())
      throw new ApiError(400, "Explain which items remain outstanding");
    const files = form!.getAll("file");
    if (
      !files.length ||
      files.length > 10 ||
      files.some(
        (f) => !(f instanceof File) || !f.size || f.size > 10 * 1024 * 1024,
      )
    )
      throw new ApiError(
        400,
        "Choose 1–10 nonempty files, up to 10 MB in total",
      );
    const bundle = files as File[];
    if (bundle.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024)
      throw new ApiError(
        413,
        "The delivery package exceeds 10 MB. Split it into partial deliveries.",
      );
    const deliveredItems = form!
      .getAll("deliveredItem")
      .filter((v): v is string => typeof v === "string");
    if (deliveredItems.some((v) => !g.requestedItems?.includes(v)))
      throw new ApiError(400, "Choose items from this request checklist");
    if (
      delivery.delivery === "complete" &&
      g.requestedItems?.some((v) => !deliveredItems.includes(v))
    )
      throw new ApiError(
        400,
        "Mark each requested item supplied, or choose partial delivery",
      );
    if (
      e.workflow!.submissions.length >= 250 ||
      r.history.length >= 50 ||
      e.artifacts.length + bundle.length > 1000
    )
      throw new ApiError(
        413,
        "Delivery limit reached. Ask the audit team to open a follow-up request",
      );
    const at = now(),
      submissionId = id("SUB"),
      artifactIds: string[] = [],
      hashes: string[] = [];
    scope = { tenantId: ctx.tenantId, engagementId: e.id, submissionId };
    // A client cannot declare columns free of special-category data: such
    // columns need the basis the audit team records first (#60, D-11). The
    // audit event records each gated file's columns and bases.
    const ids = bundle.map(() => id("EV")),
      specialCategory: Record<string, ReturnType<typeof uploadGate>> = {};
    for (const [i, file] of bundle.entries()) {
      const gate = uploadGate(e, {
        category: g.category,
        headers: await uploadHeader(file.name, await file.arrayBuffer()),
        handlingBasis: g.handlingBasis,
        declaration: null,
      });
      if (gate) specialCategory[ids[i]] = gate;
    }
    for (const [i, file] of bundle.entries()) {
      const artifactId = ids[i],
        payload = await file.arrayBuffer(),
        hash = await sha256(payload),
        key = ctx.tenantId + "/" + e.id + "/" + artifactId + "/" + hash;
      keys.push(key);
      await bucket().put(key, payload, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
          sha256: hash,
          tenantId: ctx.tenantId,
          engagementId: e.id,
        },
      });
      artifactIds.push(artifactId);
      hashes.push(hash);
      e.artifacts.push({
        id: artifactId,
        name: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200),
        category: g.category,
        size: file.size,
        sha256: hash,
        key,
        createdAt: at,
        uploadedBy: ctx.user.userId,
        visibility: "internal",
        status: g.category === "Model" ? "quarantined" : "unverified",
        mediaType: file.type || "application/octet-stream",
      });
    }
    e.workflow!.submissions.push({
      id: submissionId,
      grantId: g.id,
      requestId: r.id,
      actor: ctx.user.userId,
      at,
      evidenceIds: artifactIds,
      ...delivery,
      deliveredItems,
    });
    const { history, ...previous } = r;
    history.push(structuredClone(previous));
    Object.assign(r, {
      revision: r.revision + 1,
      status: "submitted",
      response: delivery.note,
      evidenceIds: [...new Set([...r.evidenceIds, ...artifactIds])],
      deliveryComplete: delivery.delivery === "complete",
      remainingItems: delivery.remaining,
      updatedBy: ctx.user.userId,
      updatedAt: at,
      assessment: "",
      disposition: undefined,
    });
    await save(ctx, e, a.expectedVersion, "clientSubmission", {
      requestId: r.id,
      grantId: g.id,
      submissionId,
      artifactIds,
      hashes,
      handlingBasis: g.handlingBasis,
      delivery: delivery.delivery,
      ...(Object.keys(specialCategory).length ? { specialCategory } : {}),
    });
    keys.length = 0;
    return Response.json({
      artifactId: artifactIds[0],
      artifactIds,
      submissionId,
      requestId: r.id,
    });
  } catch (error) {
    if (keys.length && scope) {
      try {
        const row = await db()
          .prepare("SELECT body FROM engagements WHERE tenant_id=? AND id=?")
          .bind(scope.tenantId, scope.engagementId)
          .first<{ body: string }>();
        const committed =
          row &&
          JSON.parse(row.body).workflow?.submissions?.some(
            (s: Submission) => s.id === scope!.submissionId,
          );
        if (!committed) for (const key of keys) await bucket().delete(key);
      } catch {
        /* Retain staged bytes when commit status is uncertain. */
      }
    }
    if (error instanceof z.ZodError)
      return Response.json(
        { error: error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    return responseError(error);
  }
}
