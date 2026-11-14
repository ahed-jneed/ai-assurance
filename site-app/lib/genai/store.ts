// GenAI evidence records on D1 (docs/design/genai-evidence.md section 12.1):
// the frozen plans, declared bundles, results, acknowledgements and re-run
// attestations of an engagement, and the readiness of the results that a
// procedure or paper links through its evidence ids.
import type { AssuranceRecord } from "../assurance-core";
import { parsed, type RecordRow } from "../assurance-store";
import { db } from "../bindings";
import type { Engagement } from "../domain/types";
import type { Context } from "../tenancy";
import { GENAI_RESULT_CATEGORIES } from "./evidence-levels";
import { genaiCoverageCandidates } from "./limitation";
import {
  genaiReadiness,
  type GenaiAcknowledgement,
  type GenaiReadiness,
  type GenaiResultContext,
} from "./readiness";
import type { GenaiCustody, GenaiSummary } from "./summary";

export const GENAI_KINDS = [
  "genai_plan",
  "genai_bundle",
  "genai_result",
  "genai_acknowledgement",
  "genai_rerun_attestation",
] as const;

const select =
  "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND ";

/** Every GenAI record of the engagement, oldest first (at most 500 of each kind). */
export async function genaiRecords(ctx: Context, engagementId: string) {
  const rows = (
    await db()
      .prepare(
        "SELECT id,kind,body,sha256,created_at,actor FROM (SELECT *,ROW_NUMBER() OVER (PARTITION BY kind ORDER BY created_at DESC,id DESC) AS n FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind IN ('genai_plan','genai_bundle','genai_result','genai_acknowledgement','genai_rerun_attestation')) WHERE n<=500 ORDER BY created_at,id",
      )
      .bind(ctx.tenantId, engagementId)
      .all<RecordRow>()
  ).results;
  return rows.map(parsed);
}

/** The genai_result records whose artifact is one of `artifactIds`. */
export async function resultsForArtifacts(
  ctx: Context,
  engagementId: string,
  artifactIds: readonly string[],
) {
  if (!artifactIds.length) return [];
  return (
    await db()
      .prepare(
        select +
          "kind='genai_result' AND json_extract(body,'$.artifactId') IN (SELECT value FROM json_each(?)) ORDER BY created_at,id",
      )
      .bind(
        ctx.tenantId,
        engagementId,
        JSON.stringify([...new Set(artifactIds)]),
      )
      .all<RecordRow>()
  ).results.map(parsed);
}

/**
 * The gate contexts of these results: their acknowledgements, whether a
 * re-run attestation pins every input, and, for uploads, a worker result of
 * the engagement with the same computation hash.
 */
export async function resultContexts(
  ctx: Context,
  engagementId: string,
  results: AssuranceRecord[],
): Promise<GenaiResultContext[]> {
  if (!results.length) return [];
  const related = (
    await db()
      .prepare(
        select +
          "(kind IN ('genai_acknowledgement','genai_rerun_attestation') OR (kind='genai_result' AND json_extract(body,'$.custody')='worker' AND json_extract(body,'$.summary.computationSha256') IN (SELECT value FROM json_each(?)))) ORDER BY created_at,id LIMIT 2000",
      )
      .bind(
        ctx.tenantId,
        engagementId,
        JSON.stringify(results.map((r) => r.body.summary.computationSha256)),
      )
      .all<RecordRow>()
  ).results.map(parsed);
  return results.map((r) => toContext(r, related));
}

/** The gate context of one result among already loaded related records. */
export function toContext(
  r: AssuranceRecord,
  related: readonly AssuranceRecord[],
): GenaiResultContext {
  const summary = r.body.summary as GenaiSummary;
  const inputs = summary.inputs.map((i) => i.sha256);
  return {
    recordId: r.id,
    artifactId: r.body.artifactId,
    custody: r.body.custody as GenaiCustody,
    summary,
    acknowledgements: related
      .filter(
        (a) =>
          a.kind === "genai_acknowledgement" && a.body.resultRecordId === r.id,
      )
      .map((a) => a.body as GenaiAcknowledgement),
    attested: related.some(
      (a) =>
        a.kind === "genai_rerun_attestation" &&
        inputs.every((sha) => a.body.bundleSha256s?.includes(sha)),
    ),
    authenticatedBy:
      r.body.custody === "uploaded"
        ? (related.find(
            (w) =>
              w.kind === "genai_result" &&
              w.body.custody === "worker" &&
              w.body.summary?.computationSha256 === summary.computationSha256,
          )?.id ?? null)
        : null,
  };
}

// Evidence categories that can hold a GenAI result (only these ids are looked
// up); shared with the Evidence vault.
export { GENAI_RESULT_CATEGORIES };

/** The readiness of every GenAI result linked through these evidence ids. */
export async function linkedReadiness(
  ctx: Context,
  e: Pick<Engagement, "id" | "artifacts">,
  artifactIds: readonly string[],
): Promise<GenaiReadiness[]> {
  const candidates = artifactIds.filter((id) =>
    e.artifacts.some(
      (a) => a.id === id && GENAI_RESULT_CATEGORIES.includes(a.category),
    ),
  );
  if (!candidates.length) return [];
  const results = await resultsForArtifacts(ctx, e.id, candidates);
  return (await resultContexts(ctx, e.id, results)).map(genaiReadiness);
}

/**
 * Whether GenAI evidence covers the engagement (#80): a current signed paper
 * concludes supported or qualified on linked GenAI results, none of which
 * has a blocker.
 */
export async function genaiCovered(ctx: Context, e: Engagement) {
  for (const p of genaiCoverageCandidates(e)) {
    const linked = await linkedReadiness(ctx, e, p.evidenceIds);
    if (linked.length && linked.every((r) => !r.blockers.length)) return true;
  }
  return false;
}
