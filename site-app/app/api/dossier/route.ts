import { z } from "zod";
import {
  ApiError,
  bucket,
  checkOrigin,
  context,
  getEngagement,
  now,
  readBounded,
  requireRole,
  responseError,
  sha256,
} from "@/lib/store";
import { buildDossier, signDossier } from "@/lib/dossier";
import { activeSigningKey } from "@/lib/signing-keys";
import { addRecord, dossierSeal } from "@/lib/assurance-store";
import { isClientRole, isReleased } from "@/lib/workflow-state";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const v = z
        .object({
          tenantId: z.string(),
          engagementId: z.string(),
          reportId: z.string().optional(),
          audience: z.enum(["internal", "client"]).default("internal"),
          // Signing keys are practice-wide: rotation is the management op
          // rotateSigningKey, for practice administrators only (#25).
          op: z
            .literal("seal", {
              errorMap: () => ({
                message:
                  "This endpoint only seals dossiers. A practice administrator rotates the signing key (management op rotateSigningKey).",
              }),
            })
            .optional(),
          withheld: z
            .array(
              z.object({
                id: z.string(),
                reason: z.string().trim().min(1).max(1000),
              }),
            )
            .max(100)
            .default([]),
        })
        .strict()
        .parse(
          JSON.parse(
            new TextDecoder().decode(await readBounded(request, 20000)),
          ),
        ),
      ctx = await context(v.tenantId),
      e = await getEngagement(ctx, v.engagementId);
    requireRole(ctx, ["Lead Auditor"]);
    const r = e.reports.find((r) => r.id === v.reportId);
    if (!r || (v.audience === "client" && !isReleased(r)))
      throw new ApiError(
        409,
        "Select a captured report; client dossiers require release approval",
      );
    const sealed = await dossierSeal(ctx, e.id, r.id, v.audience);
    if (sealed) return Response.json({ record: sealed, existing: true });
    if (
      v.withheld.some(
        (w) =>
          !(v.audience === "client" ? r.clientSnapshot : r.snapshot)
            ?.evidence ||
          !(
            (v.audience === "client" ? r.clientSnapshot : r.snapshot)!
              .evidence as { id: string }[]
          ).some((a) => a.id === w.id),
      )
    )
      throw new ApiError(400, "Exclusions must refer to captured evidence");
    const signingKey = await activeSigningKey(ctx),
      dossier = await signDossier(
        signingKey,
        await buildDossier(
          ctx,
          e,
          r,
          v.audience === "client",
          signingKey.id,
          v.withheld,
        ),
      ),
      body = JSON.stringify(dossier),
      hash = await sha256(body),
      key =
        ctx.tenantId +
        "/" +
        e.id +
        "/dossiers/" +
        r.id +
        "/" +
        v.audience +
        "/" +
        hash;
    await bucket().put(key, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: hash },
    });
    const record = await addRecord(ctx, e.id, "dossier", {
      reportId: r.id,
      audience: v.audience,
      key,
      sha256: hash,
      manifestSha256: dossier.manifestSha256,
      keyId: dossier.signature.keyId,
      publicKeySPKI: dossier.signature.publicKeySPKI,
      files: dossier.manifest.files.length,
      withheld: dossier.manifest.withheld,
      createdAt: now(),
      signing:
        "Application Ed25519 practice key, wrapped at rest under the DOSSIER_KEK Worker secret; no external timestamp or KMS attestation",
    });
    return Response.json(
      { record },
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
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      ctx = await context(u.searchParams.get("tenantId") ?? ""),
      e = await getEngagement(ctx, u.searchParams.get("engagementId") ?? ""),
      client = isClientRole(ctx.role),
      r = e.reports.find((r) => r.id === u.searchParams.get("reportId"));
    if (!r || (client && !isReleased(r)))
      throw new ApiError(404, "Dossier not available");
    const audience = client
      ? "client"
      : u.searchParams.get("audience") === "client"
        ? "client"
        : "internal";
    if (audience === "client" && !isReleased(r))
      throw new ApiError(404, "Client dossier not released");
    const seal = await dossierSeal(ctx, e.id, r.id, audience);
    if (!seal)
      throw new ApiError(
        409,
        "Ask the audit lead to seal this audience’s dossier first",
      );
    const o = await bucket().get(seal.body.key);
    if (!o) throw new ApiError(404, "Sealed dossier unavailable");
    const payload = await o.arrayBuffer();
    if ((await sha256(payload)) !== seal.body.sha256)
      throw new ApiError(409, "Sealed dossier integrity mismatch");
    return new Response(payload, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition":
          'attachment; filename="dossier-' + r.id + "-" + audience + '.json"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Dossier-SHA256": seal.body.sha256,
      },
    });
  } catch (e) {
    return responseError(e);
  }
}
