import { z } from "zod";
import type { AssuranceRecord } from "../../assurance-core";
import { pendingJobCount, recordStatement } from "../../assurance-store";
import { bucket, db } from "../../bindings";
import type { Artifact, Engagement } from "../../domain/types";
import { save } from "../../engagement-repo";
import { assertClaimFits } from "../../external-worker-contract";
import {
  GENAI_REQUEST_SCHEMA,
  GenaiEnvelopeError,
  MAX_GENAI_RESULT_BYTES,
  readGenaiEnvelope,
} from "../../genai/envelope";
import {
  GENAI_ACK_FLAGS,
  genaiReadiness,
  type GenaiAckFlag,
} from "../../genai/readiness";
import { genaiManifest, genaiPlan } from "../../genai/requests";
import { resultContexts } from "../../genai/store";
import {
  genaiSummary,
  summaryBytes,
  type GenaiCustody,
} from "../../genai/summary";
import { ApiError } from "../../http";
import { id, now, sha256 } from "../../ids";
import { assertPlatformBytes } from "../../special-category";
import type { Context } from "../../tenancy";
import { substantivePlan } from "../../workflow/command";
import { planPinsCurrent } from "../../workflow-state";
import type { Procedure } from "../../workflow-types";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";

/** A genai_result record keeps at most this much summary (design 12.1). */
const MAX_SUMMARY_BYTES = 100 * 1024;

/** A selected procedure of the approved scope and programme. */
function approvedProcedure(e: Engagement, procedureId: string) {
  const p = e.workflow?.procedures.find((p) => p.id === procedureId);
  if (
    !p ||
    e.workflow?.brief?.status !== "approved" ||
    e.workflow.program.status !== "approved" ||
    !p.selected ||
    !["applicable", "readiness"].includes(p.applicability)
  )
    throw new ApiError(
      409,
      "Use a selected procedure of the approved scope and programme",
    );
  return p;
}
/** The plan and scope pins a GenAI job or result binds, as tabular jobs do. */
async function procedurePins(e: Engagement, p: Procedure) {
  return {
    id: p.id,
    revision: p.revision,
    planHash: (p.planHash ??= await sha256(JSON.stringify(substantivePlan(p)))),
    briefRevision: e.workflow!.brief!.revision,
    programRevision: e.workflow!.program.revision,
  };
}
/** Accepted, platform-held evidence of this engagement with these bytes. */
function pinnedInput(
  e: Engagement,
  artifactId: string,
  input: { sha256: string; bytes: number; name?: string },
) {
  const a = e.artifacts.find((a) => a.id === artifactId);
  if (!a || a.status !== "accepted")
    throw new ApiError(400, "Select accepted evidence for every input");
  assertPlatformBytes(a);
  if (a.sha256 !== input.sha256 || a.size !== input.bytes)
    throw new ApiError(
      409,
      "The manifest pins " +
        (input.name ?? artifactId) +
        " to other bytes than the accepted evidence",
    );
  return a;
}
/** The verified envelope text, mapped to coded 409s. */
async function verifiedEnvelope(text: string) {
  try {
    return await readGenaiEnvelope(text);
  } catch (error) {
    if (error instanceof GenaiEnvelopeError)
      throw new ApiError(409, "GenAI result rejected: " + error.message);
    throw error;
  }
}
/** The genai_result record of a verified envelope. */
async function resultRecord(
  ctx: Context,
  e: Engagement,
  text: string,
  body: {
    artifactId: string;
    custody: GenaiCustody;
    envelopeSha256: string;
    jobId?: string;
    procedureId?: string;
    bundleRecordId?: string;
  },
) {
  const { envelope, computation } = await verifiedEnvelope(text);
  // Who declared the bundle, as the engine recorded it: their declarations
  // (for example `declared.scorers`) need someone else's acknowledgement.
  const declaredBy = (computation.manifest as { declaredBy?: unknown })
    .declaredBy;
  // Every input the computation consumed is accepted evidence of this
  // engagement, matched by SHA-256 (design section 10.4).
  for (const input of computation.inputs)
    if (
      !e.artifacts.some(
        (a) => a.sha256 === input.sha256 && a.status === "accepted",
      )
    )
      throw new ApiError(
        409,
        "Input " +
          input.name +
          " of the GenAI result is not accepted evidence of this engagement",
      );
  const summary = genaiSummary(computation, {
    computationSha256: envelope.computationSha256,
    itemsSha256: envelope.itemsSha256,
  });
  if (summaryBytes(summary) > MAX_SUMMARY_BYTES)
    throw new ApiError(
      413,
      "The GenAI result's summary exceeds 100 KB; split the bundle into fewer runs or criteria",
    );
  return recordStatement(ctx, e.id, "genai_result", {
    ...body,
    declaredBy: typeof declaredBy === "string" ? declaredBy : null,
    channel: envelope.provenance.channel,
    summary,
  });
}
/**
 * The people who prepared a GenAI result and so may not acknowledge its
 * flags (design 12.1, "a Reviewer or Lead Auditor who is not the
 * preparer"): its importer or compiler, the bundle's declarer (as the engine
 * recorded it and as the bundle record names it), and the preparer of the
 * procedure the result was queued for or whose paper links it.
 */
async function resultPreparers(
  e: Engagement,
  lookup: (ids: readonly unknown[]) => Promise<AssuranceRecord[]>,
  result: AssuranceRecord,
) {
  const body = result.body as {
    artifactId?: string;
    declaredBy?: string | null;
    procedureId?: string;
    bundleRecordId?: string;
  };
  const people = new Set<string>([result.actor]);
  if (body.declaredBy) people.add(body.declaredBy);
  if (body.bundleRecordId)
    for (const bundle of await lookup([body.bundleRecordId]))
      if (bundle.kind === "genai_bundle") {
        people.add(bundle.actor);
        const by = (bundle.body.manifest as { declaredBy?: unknown })
          ?.declaredBy;
        if (typeof by === "string") people.add(by);
      }
  for (const p of e.workflow?.procedures ?? []) {
    const paper = p.paperId
      ? e.papers.find((q) => q.id === p.paperId)
      : undefined;
    if (
      p.ownerId &&
      (p.id === body.procedureId ||
        (!!body.artifactId && !!paper?.evidenceIds.includes(body.artifactId)))
    )
      people.add(p.ownerId);
  }
  return people;
}
const existingResult = async (
  ctx: Context,
  e: Engagement,
  artifactId: string,
) =>
  !!(await db()
    .prepare(
      "SELECT 1 FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND kind='genai_result' AND json_extract(body,'$.artifactId')=? LIMIT 1",
    )
    .bind(ctx.tenantId, e.id, artifactId)
    .first());

type GenaiJobRow = {
  id: string;
  request: string;
  request_sha256: string;
  result_key: string;
  result_sha256: string;
};

/**
 * GenAI evaluation evidence (docs/design/genai-evidence.md sections 10 and
 * 12.1): freezing a plan, declaring a bundle of accepted logs, queueing the
 * engine's ingest for an enrolled worker and compiling its authenticated
 * result, importing an envelope made with the engine CLI (custody capped at
 * L1), a reviewer's acknowledgement of a flag, and an auditor's re-run
 * attestation. Nothing here parses, runs or renders an ingested log.
 */
export const genai: AssuranceModule = defineCommands({
  freezeGenaiPlan: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z
        .object({ procedureId: short, plan: z.record(z.unknown()) })
        .strict()
        .parse(d);
      // The plan first: a lowered floor is refused as such, whatever the scope.
      const plan = genaiPlan.parse(v.plan),
        p = approvedProcedure(e, v.procedureId),
        text = JSON.stringify(plan);
      const log = await recordStatement(ctx, e.id, "genai_plan", {
        procedureId: p.id,
        procedureRevision: p.revision,
        plan,
        planTextSha256: await sha256(text),
      });
      await save(
        ctx,
        e,
        e.version,
        "freezeGenaiPlan",
        { recordId: log.record.id, procedureId: p.id },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
  declareGenaiBundle: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z
        .object({
          manifest: z.record(z.unknown()),
          inputArtifactIds: z.array(short).min(1).max(64),
        })
        .strict()
        .parse(d);
      const manifest = genaiManifest.parse(v.manifest);
      if (v.inputArtifactIds.length !== manifest.inputs.length)
        throw new ApiError(
          400,
          "Link one accepted artifact per manifest input",
        );
      v.inputArtifactIds.forEach((artifactId, i) =>
        pinnedInput(e, artifactId, manifest.inputs[i]),
      );
      const log = await recordStatement(ctx, e.id, "genai_bundle", {
        manifest: {
          ...manifest,
          declaredBy: ctx.user.userId,
          declaredAt: now(),
        },
        inputArtifactIds: v.inputArtifactIds,
      });
      await save(
        ctx,
        e,
        e.version,
        "declareGenaiBundle",
        { recordId: log.record.id },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
  queueGenaiIngest: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, find }, d, ctx) {
      const v = z
        .object({
          procedureId: short,
          bundleRecordId: short,
          planRecordId: short,
        })
        .strict()
        .parse(d);
      const p = approvedProcedure(e, v.procedureId),
        bundle = await find(v.bundleRecordId, "genai_bundle"),
        planRecord = await find(v.planRecordId, "genai_plan");
      if (planRecord.body.procedureId !== p.id)
        throw new ApiError(409, "Freeze the plan for this procedure first");
      const manifest = bundle.body.manifest,
        artifactIds: string[] = bundle.body.inputArtifactIds;
      // The pins are checked again: evidence may have been quarantined since.
      const inputs = artifactIds.map((artifactId, index) => {
        const spec = manifest.inputs[index],
          a = pinnedInput(e, artifactId, spec);
        return {
          index,
          artifactId: a.id,
          name: spec.name,
          sha256: a.sha256,
          size: a.size,
          role: spec.role,
          format: spec.format,
        };
      });
      // Counted over every job, not the 100 most recent (#151).
      if ((await pendingJobCount(ctx, e.id)) >= 10)
        throw new ApiError(429, "Finish or cancel pending external work");
      const jobId = id("JOB"),
        request = {
          schemaVersion: GENAI_REQUEST_SCHEMA,
          executionMode: "genai_ingest",
          engagementId: e.id,
          jobId,
          procedure: await procedurePins(e, p),
          inputs,
          manifest,
          plan: planRecord.body.plan,
          inputHashes: Object.fromEntries(
            inputs.map((i) => [String(i.index), i.sha256]),
          ),
          records: { bundle: bundle.id, plan: planRecord.id },
          limitations: [
            "The engine recomputed the statistics from the pinned tool logs; it ran no harness and executed nothing the logs name.",
            "Worker signature authenticates enrolled service origin, not completeness or truth of the logs.",
          ],
        };
      const text = JSON.stringify(request),
        hash = await sha256(text);
      assertClaimFits(jobId, hash, text);
      const log = await recordStatement(ctx, e.id, "execution_request", {
        jobId,
        requestSha256: hash,
        procedureId: p.id,
        mode: "genai_ingest",
      });
      await save(
        ctx,
        e,
        e.version,
        "freezeGenaiIngest",
        { jobId, requestSha256: hash },
        (cmd) => [
          db()
            .prepare(
              "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at) SELECT ?,?,?,'queued',?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(
              jobId,
              ctx.tenantId,
              e.id,
              text,
              hash,
              ctx.user.userId,
              now(),
              ctx.tenantId,
              e.id,
              cmd,
            ),
          log.guarded(cmd),
        ],
      );
      return Response.json(
        { jobId, requestSha256: hash },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
  },
  compileGenaiResult: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z.object({ jobId: short }).strict().parse(d),
        job = await db()
          .prepare(
            "SELECT id,request,request_sha256,result_key,result_sha256 FROM execution_jobs WHERE id=? AND tenant_id=? AND engagement_id=? AND state='succeeded'",
          )
          .bind(v.jobId, ctx.tenantId, e.id)
          .first<GenaiJobRow>();
      if (!job)
        throw new ApiError(
          409,
          "An authenticated completed result is required",
        );
      const frozen = JSON.parse(job.request);
      // Checked before reading R2: a tabular job compiles through importJob.
      if (frozen.executionMode !== "genai_ingest")
        throw new ApiError(
          409,
          "This job is not a GenAI ingest; use importJob",
        );
      if (e.artifacts.some((a) => a.id === job.id))
        throw new ApiError(409, "This result was already compiled");
      const procedure = e.workflow?.procedures.find(
        (q) => q.id === frozen.procedure.id,
      );
      if (
        !procedure ||
        !planPinsCurrent(e, procedure, {
          procedureRevision: frozen.procedure.revision,
          planHash: frozen.procedure.planHash,
          briefRevision: frozen.procedure.briefRevision,
        })
      )
        throw new ApiError(
          409,
          "The procedure's plan or scope changed after this job was queued; queue it again",
        );
      const o = await bucket().get(job.result_key);
      if (!o) throw new ApiError(404, "Result bytes unavailable");
      const bytes = await o.arrayBuffer();
      if ((await sha256(bytes)) !== job.result_sha256)
        throw new ApiError(409, "Result integrity check failed");
      const log = await resultRecord(ctx, e, new TextDecoder().decode(bytes), {
        artifactId: job.id,
        custody: "worker",
        envelopeSha256: job.result_sha256,
        jobId: job.id,
        procedureId: procedure.id,
        ...(typeof frozen.records?.bundle === "string"
          ? { bundleRecordId: frozen.records.bundle }
          : {}),
      });
      const artifact: Artifact = {
        id: job.id,
        name: "genai-result-" + job.id + ".json",
        category: "GenAI result",
        size: bytes.byteLength,
        sha256: job.result_sha256,
        key: job.result_key,
        createdAt: now(),
        uploadedBy: ctx.user.userId,
        visibility: "internal",
        status: "accepted",
        mediaType: "application/json",
      };
      e.artifacts.push(artifact);
      await save(
        ctx,
        e,
        e.version,
        "compileGenaiResult",
        { jobId: job.id, recordId: log.record.id, sha256: job.result_sha256 },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
  importGenaiEnvelope: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, accepted }, d, ctx) {
      const v = z.object({ artifactId: short }).strict().parse(d),
        a = accepted(v.artifactId, "GenAI log");
      assertPlatformBytes(a);
      if (a.size > MAX_GENAI_RESULT_BYTES)
        throw new ApiError(413, "A GenAI result envelope is at most 8 MiB");
      if (await existingResult(ctx, e, a.id))
        throw new ApiError(409, "This envelope was already imported");
      const o = await bucket().get(a.key);
      if (!o) throw new ApiError(404, "Evidence bytes unavailable");
      const bytes = await o.arrayBuffer();
      if ((await sha256(bytes)) !== a.sha256)
        throw new ApiError(409, "Evidence integrity check failed");
      // An upload is an auditor-prepared, unauthenticated computation: it
      // counts as at most L1 until a worker recomputation matches it (4.2).
      const log = await resultRecord(ctx, e, new TextDecoder().decode(bytes), {
        artifactId: a.id,
        custody: "uploaded",
        envelopeSha256: a.sha256,
      });
      await save(
        ctx,
        e,
        e.version,
        "importGenaiEnvelope",
        { artifactId: a.id, recordId: log.record.id },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
  acknowledgeGenaiFlag: {
    roles: ["Reviewer", "Lead Auditor"],
    async handle({ e, find, lookup }, d, ctx) {
      const v = z
        .object({
          resultRecordId: short,
          flag: z.enum(GENAI_ACK_FLAGS),
          runKey: z.string().min(1).max(512),
          judgeRef: z.string().max(64).nullable().optional(),
          score: z.string().max(200).nullable().optional(),
          rationale: note,
        })
        .strict()
        .parse(d);
      const result = await find(v.resultRecordId, "genai_result");
      if ((await resultPreparers(e, lookup, result)).has(ctx.user.userId))
        throw new ApiError(
          403,
          "The person who imported or compiled the result, declared its bundle or prepared its procedure cannot acknowledge its flags",
        );
      const [context] = await resultContexts(ctx, e.id, [result]);
      if (
        !genaiReadiness(context).pendingAcknowledgements.some(
          (p) =>
            p.flag === (v.flag as GenaiAckFlag) &&
            p.runKey === v.runKey &&
            (p.judgeRef ?? null) === (v.judgeRef ?? null) &&
            (p.score ?? null) === (v.score ?? null),
        )
      )
        throw new ApiError(
          409,
          "This flag is not awaiting acknowledgement on this result",
        );
      const log = await recordStatement(ctx, e.id, "genai_acknowledgement", {
        resultRecordId: result.id,
        flag: v.flag,
        runKey: v.runKey,
        judgeRef: v.judgeRef ?? null,
        score: v.score ?? null,
        rationale: v.rationale,
      });
      await save(
        ctx,
        e,
        e.version,
        "acknowledgeGenaiFlag",
        { recordId: log.record.id, flag: v.flag },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
  attestGenaiRerun: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z
        .object({
          bundleSha256s: z
            .array(z.string().regex(/^[a-f0-9]{64}$/))
            .min(1)
            .max(64),
          harness: z
            .object({
              name: short,
              version: short,
              imageDigest: z
                .string()
                .regex(/^sha256:[a-f0-9]{64}$/)
                .optional(),
            })
            .strict(),
          systemUnderTest: z
            .object({
              endpointHost: z
                .string()
                .regex(/^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/, {
                  message: "Record the endpoint host only, without a path",
                }),
              snapshot: short,
            })
            .strict(),
          runWindow: z
            .object({
              start: z.string().datetime(),
              end: z.string().datetime(),
            })
            .strict()
            .refine((w) => w.start <= w.end, "The run ends before it starts"),
          environment: z.string().trim().max(2000),
          statement: z.literal(
            "I ran this evaluation as described; the pinned files are its unmodified output",
          ),
        })
        .strict()
        .parse(d);
      for (const sha of v.bundleSha256s)
        if (
          !e.artifacts.some((a) => a.sha256 === sha && a.status === "accepted")
        )
          throw new ApiError(
            400,
            "Every pinned file must be accepted evidence",
          );
      const log = await recordStatement(
        ctx,
        e.id,
        "genai_rerun_attestation",
        v,
      );
      await save(
        ctx,
        e,
        e.version,
        "attestGenaiRerun",
        { recordId: log.record.id },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
});
