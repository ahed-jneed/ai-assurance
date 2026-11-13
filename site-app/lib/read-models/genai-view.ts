// GET /api/assurance?view=genai: the GenAI evidence of an engagement for the
// results view (docs/design/genai-evidence.md section 12.2): every result
// with its summary and readiness, the frozen plans and declared bundles, the
// acknowledgements and attestations, the GenAI ingest jobs and how many
// active workers were enrolled with the genai_ingest capability. With
// `recordId`, the full computation of one result, read from R2 and checked
// against its pins. Internal roles only.
import { jobs, workerSponsorGuard } from "../assurance-store";
import { bucket, db } from "../bindings";
import { loadEngagement } from "../engagement-repo";
import { readGenaiEnvelope } from "../genai/envelope";
import { genaiReadiness } from "../genai/readiness";
import { genaiRecords, toContext } from "../genai/store";
import { ApiError } from "../http";
import { sha256 } from "../ids";
import type { Context } from "../tenancy";
import { isClientRole } from "../workflow-state";

export async function genaiView(ctx: Context, engagementId: string) {
  const e = await loadEngagement(ctx, engagementId);
  if (isClientRole(ctx.role))
    throw new ApiError(403, "GenAI evidence is internal");
  const records = await genaiRecords(ctx, e.id),
    of = (kind: string) => records.filter((r) => r.kind === kind);
  return {
    results: of("genai_result").map((r) => {
      const context = toContext(r, records);
      return {
        id: r.id,
        createdAt: r.createdAt,
        actor: r.actor,
        sha256: r.sha256,
        artifactId: context.artifactId,
        custody: context.custody,
        channel: r.body.channel as string,
        jobId: (r.body.jobId as string | undefined) ?? null,
        procedureId: (r.body.procedureId as string | undefined) ?? null,
        authenticatedBy: context.authenticatedBy ?? null,
        attested: context.attested,
        summary: context.summary,
        readiness: genaiReadiness(context),
      };
    }),
    plans: of("genai_plan").map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.actor,
      procedureId: r.body.procedureId as string,
      plan: r.body.plan,
    })),
    bundles: of("genai_bundle").map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.actor,
      origin: r.body.manifest.origin as string,
      inputs: r.body.manifest.inputs,
      inputArtifactIds: r.body.inputArtifactIds as string[],
    })),
    acknowledgements: of("genai_acknowledgement").map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.actor,
      ...r.body,
    })),
    attestations: of("genai_rerun_attestation").map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.actor,
      bundleSha256s: r.body.bundleSha256s as string[],
      harness: r.body.harness,
    })),
    jobs: (await jobs(ctx, e.id)).filter((j) => j.mode === "genai_ingest"),
    ingestWorkers: await ingestWorkerCount(ctx, e.id),
  };
}

/**
 * Active workers of the engagement whose enrolment lists `genai_ingest` and
 * whose sponsor passes the runner route's guard (workerSponsorGuard): the
 * route serves a GenAI ingest job to no other worker, so the view offers to
 * queue one only when this is at least 1.
 */
async function ingestWorkerCount(ctx: Context, engagementId: string) {
  const row = await db()
    .prepare(
      "SELECT COUNT(*) AS n FROM runner_workers w WHERE w.tenant_id=? AND w.engagement_id=? AND " +
        workerSponsorGuard +
        " AND json_valid(w.capabilities) AND EXISTS(SELECT 1 FROM json_each(w.capabilities) WHERE value='genai_ingest')",
    )
    .bind(ctx.tenantId, engagementId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** The full computation of one GenAI result, verified against its record. */
export async function genaiComputation(
  ctx: Context,
  engagementId: string,
  recordId: string,
) {
  const e = await loadEngagement(ctx, engagementId);
  if (isClientRole(ctx.role))
    throw new ApiError(403, "GenAI evidence is internal");
  const r = (await genaiRecords(ctx, e.id)).find(
    (x) => x.kind === "genai_result" && x.id === recordId,
  );
  const a = r && e.artifacts.find((x) => x.id === r.body.artifactId);
  if (!r || !a) throw new ApiError(404, "GenAI result not found");
  const o = await bucket().get(a.key);
  if (!o) throw new ApiError(404, "Result bytes unavailable");
  const bytes = await o.arrayBuffer();
  if ((await sha256(bytes)) !== a.sha256)
    throw new ApiError(409, "Result integrity check failed");
  const { envelope, computation } = await readGenaiEnvelope(
    new TextDecoder().decode(bytes),
  );
  if (envelope.computationSha256 !== r.body.summary.computationSha256)
    throw new ApiError(409, "The stored result differs from its record");
  return { computationSha256: envelope.computationSha256, computation };
}

/** The response of GET /api/assurance?view=genai. */
export type GenaiView = Awaited<ReturnType<typeof genaiView>>;
