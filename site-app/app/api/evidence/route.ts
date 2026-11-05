import {
  ApiError,
  bucket,
  checkOrigin,
  context,
  getEngagement,
  id,
  now,
  readBounded,
  requireRole,
  responseError,
  save,
  sha256,
} from "@/lib/store";
import { activeGrant, isClientRole } from "@/lib/workflow-state";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let uploadedKey: string | undefined;
  try {
    checkOrigin(request);
    const bytes = await readBounded(request, 51 * 1024 * 1024),
      form = await new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") ?? "" },
        body: bytes,
      }).formData(),
      tenantId = String(form.get("tenantId") ?? ""),
      engagementId = String(form.get("engagementId") ?? ""),
      ctx = await context(tenantId);
    requireRole(ctx, ["Auditor", "Lead Auditor"]);
    const e = await getEngagement(ctx, engagementId),
      expectedVersion = Number(form.get("expectedVersion"));
    if (e.version !== expectedVersion)
      throw new ApiError(
        409,
        "The engagement changed. Reload before uploading",
      );
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 50 * 1024 * 1024)
      throw new ApiError(400, "Choose a nonempty file up to 50 MB");
    const category = String(form.get("category"));
    if (
      ![
        "Dataset",
        "Model",
        "Training log",
        "Validation",
        "Pipeline code",
        "Governance",
        "Instructions",
        "Oversight",
        "Security",
        "Other",
      ].includes(category)
    )
      throw new ApiError(400, "Invalid evidence category");
    const handlingBasis = String(form.get("handlingBasis"));
    if (!["synthetic", "anonymized", "reviewed"].includes(handlingBasis))
      throw new ApiError(400, "Record the evidence handling basis");
    const governanceArtifactId = String(form.get("governanceArtifactId") ?? "");
    if (
      handlingBasis === "reviewed" &&
      !e.artifacts.some(
        (a) =>
          a.id === governanceArtifactId &&
          a.category === "Governance" &&
          a.status === "accepted",
      )
    )
      throw new ApiError(
        400,
        "Link an accepted governance decision for the reviewed processing route",
      );
    const artifactId = id("EV"),
      payload = await file.arrayBuffer(),
      hash = await sha256(payload),
      name = file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200),
      key = ctx.tenantId + "/" + e.id + "/" + artifactId + "/" + hash;
    await bucket().put(key, payload, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        sha256: hash,
        tenantId: ctx.tenantId,
        engagementId: e.id,
      },
    });
    uploadedKey = key;
    e.artifacts.push({
      id: artifactId,
      name,
      category,
      size: file.size,
      sha256: hash,
      key,
      createdAt: now(),
      uploadedBy: ctx.user.userId,
      visibility: form.get("visibility") === "client" ? "client" : "internal",
      status: category === "Model" ? "quarantined" : "unverified",
      mediaType: file.type || "application/octet-stream",
    });
    await save(ctx, e, expectedVersion, "uploadEvidence", {
      artifactId,
      sha256: hash,
      category,
      handlingBasis,
      governanceArtifactId,
    });
    uploadedKey = undefined;
    return Response.json({ artifactId, sha256: hash });
  } catch (error) {
    if (uploadedKey)
      try {
        await bucket().delete(uploadedKey);
      } catch {}
    return responseError(error);
  }
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? ""),
      e = await getEngagement(ctx, url.searchParams.get("engagementId") ?? ""),
      a = e.artifacts.find((x) => x.id === url.searchParams.get("artifactId"));
    const own =
      ctx.role === "Client Contributor" &&
      e.workflow?.submissions.some(
        (s) =>
          s.actor === ctx.user.userId &&
          s.evidenceIds.includes(a?.id ?? "") &&
          activeGrant(e.workflow, ctx.user.userId).some(
            (g) => g.id === s.grantId,
          ),
      );
    if (
      !a ||
      (isClientRole(ctx.role) &&
        !own &&
        (a.visibility !== "client" || a.status !== "accepted"))
    )
      throw new ApiError(404, "Evidence not found");
    const object = await bucket().get(a.key);
    if (!object) throw new ApiError(404, "Evidence bytes unavailable");
    if (url.searchParams.get("preview") === "1") {
      if (a.status !== "accepted")
        throw new ApiError(409, "Accept evidence before previewing it");
      if (a.size > 256 * 1024 || object.size > 256 * 1024)
        throw new ApiError(
          413,
          "Preview is limited to 256 KB. Download this file.",
        );
      if (!/\.(txt|md|csv|json|log)$/i.test(a.name))
        throw new ApiError(
          400,
          "Preview supports text, CSV, JSON and logs. Download this format.",
        );
      const bytes = await object.arrayBuffer();
      if ((await sha256(bytes)) !== a.sha256)
        throw new ApiError(409, "Evidence integrity check failed");
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ApiError(400, "This file is not UTF-8 text");
      }
      return Response.json(
        { text, sha256: a.sha256 },
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(a.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Evidence-SHA256": a.sha256,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return responseError(error);
  }
}
