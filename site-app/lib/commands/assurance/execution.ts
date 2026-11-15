import { z } from "../../zod";
import { pendingJobCount, recordStatement } from "../../assurance-store";
import { bucket, db } from "../../bindings";
import type { Outcome, Result, Run } from "../../domain/types";
import { save } from "../../engagement-repo";
import {
  assertClaimFits,
  assertDeclaredLabel,
  assertModelSpecLimits,
  assertPerformancePositiveLabel,
  frozenLabelPair,
} from "../../external-worker-contract";
import { pinned, recordVersions, roleTemplate } from "../../criteria/pin";
import { item, type Resolved } from "../../criteria/projection";
import { templatePaper } from "../../factories";
import { ApiError } from "../../http";
import { id, now, sha256 } from "../../ids";
import { diagnosticNarrative } from "../../presentation";
import {
  externalGate,
  heldByClient,
  specialCategoryLimitation,
  undeclaredColumns,
} from "../../special-category";
import { aggregate, planSha256, type Plan } from "../../statistics";
import { requireRole } from "../../tenancy";
import { substantivePlan } from "../../workflow/command";
import { planPinsCurrent } from "../../workflow-state";
import type { Procedure } from "../../workflow-types";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";
const OUTCOMES = new Set(["pass", "fail", "inconclusive", "not_applicable"]);
/**
 * The hosted results of an imported packet. A packet without results has
 * nothing to compile, so it is refused rather than recorded as a run.
 */
export function hostedResults(results: unknown): Result[] {
  if (!Array.isArray(results) || !results.length)
    throw new ApiError(409, "The result holds no hosted results to compile");
  return results as Result[];
}
/**
 * The overall outcome of an imported external run, by the rule hosted runs
 * use (statistics `aggregate`, section 4.6): any fail is a fail, then
 * inconclusive, then pass. The packet is untrusted, so a missing or unknown
 * outcome counts as inconclusive, never as a pass. When the results carry
 * decisions (run contract 1.5), only confirmatory criteria decide; a result
 * whose role is not "exploratory" decides, so a missing role cannot drop it.
 */
export function importedOutcome(
  results: readonly Pick<Result, "outcome" | "decision">[] | undefined,
  decided = false,
): Outcome {
  return aggregate(
    hostedResults(results)
      .filter((r) => !decided || r?.decision?.role !== "exploratory")
      .map((r) => (OUTCOMES.has(r?.outcome) ? r.outcome : "inconclusive")),
  );
}
/**
 * The draft paper an external execution compiles into: filed under the
 * procedure the job is bound to, with that procedure's template criteria and
 * its objective (#233). Only a procedure whose template the pinned pack does
 * not hold falls back to the pack's externalExecutionPaper template.
 */
export function externalExecutionPaper(
  resolved: Pick<Resolved, "pack" | "frameworks">,
  procedure: Pick<Procedure, "templateId" | "objective">,
  userId: string,
) {
  const own = !!item(resolved.pack, procedure.templateId);
  const p = templatePaper(
    resolved,
    own
      ? procedure.templateId
      : roleTemplate(resolved.pack, "externalExecutionPaper"),
    userId,
  );
  if (own && procedure.objective) p.body.objective = procedure.objective;
  return p;
}
// Columns of a succeeded execution_jobs row as importJob reads them.
type SucceededJobRow = {
  id: string;
  request: string;
  request_sha256: string;
  created_by: string;
  created_at: string;
  attempt_id: string;
  fence: number;
  result_key: string;
  result_sha256: string;
  completed_at: string;
};
/**
 * External execution: freezing a job for an enrolled worker, cancelling it,
 * and compiling its authenticated result into a paper and a run.
 */
export const execution: AssuranceModule = defineCommands({
  queueExternal: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, find, accepted }, d, ctx) {
      const v = z
          .object({
            systemId: short,
            modelId: short,
            datasetId: short,
            profileId: short,
            procedureId: short,
            mode: z.enum([
              "provided_predictions",
              "auditor_model",
              "client_local",
            ]),
            datasetCardRecordId: short.optional(),
            predictionId: short.optional(),
            securityReviewId: short.optional(),
            // Empty: the system revision's other output class (D-12). A 1.1
            // protocol's declared label must also be that class.
            negativeLabel: short.optional(),
            predictionOutput: z.string().max(300).default(""),
            predictionKind: z.enum(["label", "probability"]).default("label"),
          })
          .strict()
          .parse(d),
        system = await find(v.systemId, "system"),
        m = e.models.find((m) => m.id === v.modelId),
        dataset = accepted(v.datasetId, "Dataset"),
        profile = e.evaluationProfiles?.find((p) => p.id === v.profileId),
        p = e.workflow?.procedures.find((p) => p.id === v.procedureId);
      if (
        !m ||
        !system.body.modelIds.includes(m.id) ||
        !profile ||
        profile.task !== m.task ||
        !p ||
        e.workflow?.brief?.status !== "approved" ||
        e.workflow.program.status !== "approved" ||
        !p.selected ||
        !["applicable", "readiness"].includes(p.applicability) ||
        p.modelId !== m.id ||
        p.datasetId !== dataset.id ||
        p.profileId !== profile.id
      )
        throw new ApiError(
          409,
          "Use a selected approved procedure with the same model, dataset and protocol",
        );
      // A client-held pin (#102) has no bytes here: only the client's own
      // worker can read it, in the client's environment.
      const clientHeld = heldByClient(dataset);
      if (clientHeld && v.mode !== "client_local")
        throw new ApiError(
          409,
          "This dataset is held by the client: queue it in client-local mode for the client's own worker",
        );
      externalGate(profile, v.mode, clientHeld);
      // The client declared the pinned file's columns (#134): a mapping the
      // file cannot satisfy is refused now, not when the worker claims it.
      const missing = clientHeld ? undeclaredColumns(dataset, profile) : [];
      if (missing.length)
        throw new ApiError(
          409,
          "The client-held dataset " +
            dataset.name +
            " does not declare the protocol's column" +
            (missing.length > 1 ? "s " : " ") +
            missing.join(", ") +
            ". Map the protocol to the pinned file's columns, or pin the client's file again with its header.",
        );
      const plan = profile.statistics,
        outputLabels: string[] = system.body.outputs.classOrder,
        labels = frozenLabelPair({
          task: m.task,
          classOrder: outputLabels,
          positiveLabel: profile.config.positiveLabel,
          requested: v.negativeLabel || undefined,
        });
      assertDeclaredLabel(plan, profile.config.negativeLabel, labels);
      // The worker measures a performance positive class only when the
      // protocol runs the performance test.
      assertPerformancePositiveLabel(
        profile.suite.includes("performance")
          ? profile.config.performancePositiveLabel
          : undefined,
        labels,
      );
      const card = v.datasetCardRecordId
        ? await find(v.datasetCardRecordId, "dataset")
        : undefined;
      if (
        card &&
        (card.body.artifactId !== dataset.id ||
          card.body.artifactSha256 !== dataset.sha256)
      )
        throw new ApiError(
          409,
          "Choose the dataset card pinned to these exact bytes",
        );
      if (
        !system.body.modelPins?.some(
          (pin: { id: string; sha256: string }) =>
            pin.id === m.id && pin.sha256 === m.sourceSha256,
        ) ||
        e.artifacts.find((x) => x.id === m.artifactId)?.sha256 !==
          m.sourceSha256
      )
        throw new ApiError(
          409,
          "System and model artifact hashes must match the registered version",
        );
      if (dataset.size > 100 * 1024 * 1024)
        throw new ApiError(413, "External datasets are limited to 100 MB");
      if (v.mode !== "auditor_model") {
        const pred = await find(v.predictionId, "prediction");
        if (
          pred.body.modelId !== m.id ||
          pred.body.systemId !== system.id ||
          pred.body.datasetId !== dataset.id ||
          pred.body.datasetSha256 !== dataset.sha256
        )
          throw new ApiError(
            400,
            "Select prediction lineage for these exact system and data pins",
          );
      }
      if (v.mode === "auditor_model") {
        requireRole(ctx, ["Lead Auditor"]);
        accepted(v.securityReviewId, "Security");
        if (!["ONNX", "XGBoost", "LightGBM", "PMML"].includes(m.format))
          throw new ApiError(
            400,
            "The worker supports only portable reviewed adapters; pickle/joblib is prohibited",
          );
        if (
          system.body.features.some(
            (f: { type: string; nullable: boolean }) =>
              !["number", "integer"].includes(f.type) || f.nullable,
          ) ||
          system.body.pipelineArtifactId
        )
          throw new ApiError(
            400,
            "This adapter requires complete numeric preprocessed inputs. Executable preprocessing and raw text pipelines require a separately validated adapter",
          );
        if (["ONNX", "PMML"].includes(m.format) && !v.predictionOutput)
          throw new ApiError(400, "Specify the adapter prediction output name");
        assertModelSpecLimits({
          task: m.task,
          featureCount: system.body.features.length,
          outputLabels,
        });
      }
      if ((await pendingJobCount(ctx, e.id)) >= 10)
        throw new ApiError(429, "Finish or cancel pending external work");
      const jobId = id("JOB"),
        modelArtifact = e.artifacts.find((x) => x.id === m.artifactId)!,
        requestBody = {
          schemaVersion: "1.0",
          executionMode: v.mode,
          system: { ...system.body, id: system.id, sha256: system.sha256 },
          model: {
            ...m,
            sha256: modelArtifact.sha256,
            size: modelArtifact.size,
            review: {
              approved: v.mode === "auditor_model",
              securityReviewId: v.securityReviewId,
            },
          },
          dataset: {
            id: dataset.id,
            name: dataset.name,
            sha256: dataset.sha256,
            size: dataset.size,
            // The worker reads the file in the client's environment by this
            // pin and downloads nothing (worker 1.3.0).
            ...(clientHeld ? { custody: "client" as const } : {}),
            ...(card
              ? {
                  cardPin: {
                    recordId: card.id,
                    sha256: card.sha256,
                    card: card.body,
                  },
                }
              : {}),
          },
          profile,
          seed: 42,
          // The job binds the plan content, as runs do: the plan hash is kept
          // on first use for procedures planned before plan hashes.
          procedure: {
            id: p.id,
            revision: p.revision,
            planHash: (p.planHash ??= await sha256(
              JSON.stringify(substantivePlan(p)),
            )),
            briefRevision: e.workflow!.brief!.revision,
            programRevision: e.workflow!.program.revision,
          },
          inputHashes: {
            dataset: dataset.sha256,
            modelArtifact: modelArtifact.sha256,
            system: system.sha256,
            protocol: await sha256(JSON.stringify(profile)),
          },
          // engineConfig 1.4 carries a 1.1 protocol's plan and declared label
          // pair; 1.1 lets the worker derive the plan (section 9.3).
          engineConfig: {
            contractVersion: plan ? "1.4" : "1.1",
            id: jobId,
            engagementId: e.id,
            modelId: m.id,
            datasetId: dataset.id,
            task: m.task,
            suite: profile.suite,
            config: profile.config,
            ...(plan ? { statistics: plan } : {}),
            ...(labels ? { negativeLabel: labels.negativeLabel } : {}),
            policyId: profile.id,
            policyVersion: profile.version,
            seed: 42,
            ...(v.mode === "auditor_model"
              ? {
                  modelSpec: {
                    task:
                      m.task === "Regression"
                        ? "regression"
                        : m.task === "Binary classification"
                          ? "binary_classification"
                          : "multiclass_classification",
                    featureColumns: system.body.features.map(
                      (f: { name: string }) => f.name,
                    ),
                    outputLabels,
                    decisionThreshold: system.body.outputs.threshold ?? 0.5,
                    ...(v.predictionOutput
                      ? { predictionOutput: v.predictionOutput }
                      : {}),
                    predictionKind: v.predictionKind,
                  },
                }
              : {}),
          },
          limitations: [
            v.mode === "auditor_model"
              ? "Reviewed portable model inference; correspondence to deployed pipeline remains subject to audit."
              : "Submitted prediction lineage is declared; source completeness and model origin need corroboration.",
            "Worker signature authenticates enrolled service origin, not completeness or truth.",
            ...(clientHeld
              ? [
                  "The dataset stays in the client's environment: the platform holds only its SHA-256 and size, and the client's worker returns aggregate results only, withholding groups below the minimum group size. The auditor has not inspected the rows.",
                ]
              : []),
          ],
        };
      const text = JSON.stringify(requestBody),
        hash = await sha256(text);
      assertClaimFits(jobId, hash, text);
      const log = await recordStatement(ctx, e.id, "execution_request", {
        jobId,
        requestSha256: hash,
        systemId: system.id,
        procedureId: p.id,
        mode: v.mode,
      });
      await save(
        ctx,
        e,
        e.version,
        "freezeExternalExecution",
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
  cancelJob: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z.object({ jobId: short, reason: note }).strict().parse(d);
      // A job id this engagement does not hold, whether unknown or another
      // engagement's, is not found (404); only a job of this engagement that
      // really is finished or cancelled is a conflict (409) (#220).
      const job = await db()
        .prepare(
          "SELECT state FROM execution_jobs WHERE id=? AND tenant_id=? AND engagement_id=?",
        )
        .bind(v.jobId, ctx.tenantId, e.id)
        .first<{ state: string }>();
      if (!job) throw new ApiError(404, "Job not found");
      if (job.state !== "queued" && job.state !== "running")
        throw new ApiError(409, "Job already completed or cancelled");
      const log = await recordStatement(ctx, e.id, "execution_cancel", v);
      await save(
        ctx,
        e,
        e.version,
        "cancelExternalExecution",
        { jobId: v.jobId },
        (cmd) => [
          db()
            .prepare(
              "UPDATE execution_jobs SET state='cancelled',fence=fence+1,error=?,completed_at=? WHERE id=? AND tenant_id=? AND engagement_id=? AND state IN ('queued','running') AND EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
            )
            .bind(
              v.reason,
              now(),
              v.jobId,
              ctx.tenantId,
              e.id,
              ctx.tenantId,
              e.id,
              cmd,
            ),
          db()
            .prepare(
              "UPDATE execution_attempts SET state='cancelled',completed_at=? WHERE job_id=? AND state='running' AND EXISTS(SELECT 1 FROM execution_jobs j JOIN engagements e ON e.tenant_id=j.tenant_id AND e.id=j.engagement_id WHERE j.id=? AND j.state='cancelled' AND e.last_command_id=?)",
            )
            .bind(now(), v.jobId, v.jobId, cmd),
          log.guarded(cmd),
        ],
      );
      return { record: log.record };
    },
  },
  importJob: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const v = z.object({ jobId: short }).strict().parse(d),
        job = await db()
          .prepare(
            "SELECT * FROM execution_jobs WHERE id=? AND tenant_id=? AND engagement_id=? AND state='succeeded'",
          )
          .bind(v.jobId, ctx.tenantId, e.id)
          .first<SucceededJobRow>();
      if (!job)
        throw new ApiError(
          409,
          "An authenticated completed result is required",
        );
      // Checked before reading R2: a GenAI envelope has no hosted results.
      if (JSON.parse(job.request).executionMode === "genai_ingest")
        throw new ApiError(
          409,
          "This job is a GenAI ingest; use compileGenaiResult",
        );
      if (e.artifacts.some((a) => a.id === v.jobId))
        throw new ApiError(409, "This result was already compiled");
      const o = await bucket().get(job.result_key);
      if (!o) throw new ApiError(404, "Result bytes unavailable");
      const bytes = await o.arrayBuffer();
      if ((await sha256(bytes)) !== job.result_sha256)
        throw new ApiError(409, "Result integrity check failed");
      const packet = JSON.parse(new TextDecoder().decode(bytes)),
        results = hostedResults(packet.hostedResults),
        frozen = JSON.parse(job.request),
        procedure = e.workflow?.procedures.find(
          (q) => q.id === frozen.procedure.id,
        );
      // The result compiles only while it binds the procedure's current plan
      // and scope, the rule activeJobGuard applies while the job runs.
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
      const p = externalExecutionPaper(pinned(e), procedure, ctx.user.userId);
      p.required = false;
      p.title = "External execution — " + v.jobId;
      // Worker 1.2.0 copies the engine's statistics 1.0.0 decision into every
      // result, which compiles into run contract 1.5; results without
      // decisions keep the frozen 1.2 projection.
      const decided =
        results.length > 0 && results.every((r) => r.decision !== undefined);
      const plan: Plan | undefined =
        packet.externalReport?.configuration?.statistics ?? undefined;
      // A frozen plan (engineConfig 1.4) names results by criterion id, which
      // only run contract 1.5 admits, so every result must carry a decision.
      if (frozen.engineConfig.statistics && !decided)
        throw new ApiError(
          409,
          "The protocol froze a statistics plan; every result must carry its decision",
        );
      if (decided) {
        if (!plan)
          throw new ApiError(409, "Decided results need the recorded plan");
        if (
          frozen.engineConfig.statistics &&
          planSha256(plan) !== planSha256(frozen.engineConfig.statistics)
        )
          throw new ApiError(
            409,
            "The worker decided a plan other than the frozen protocol's",
          );
        if (
          results.map((r) => r.testId).join("\n") !==
          plan.criteria.map((c) => c.id).join("\n")
        )
          throw new ApiError(409, "Results must follow the recorded plan");
      }
      // The runner accepted only a result stating the frozen custody; a
      // client-held job's run must come from the client's environment.
      if (
        (frozen.dataset.custody === "client") !==
        (packet.provenance?.execution?.datasetCustody === "client")
      )
        throw new ApiError(
          409,
          "The result's dataset custody differs from the frozen request",
        );
      p.body.results = diagnosticNarrative(results);
      p.body.procedures =
        "Authenticated external execution " +
        job.id +
        "; request SHA-256 " +
        job.request_sha256 +
        "; attempt " +
        job.attempt_id +
        ". Technical output compilation only. Auditor must record actual procedure work and assess sufficiency.";
      // A protocol on special-category data states where the data were
      // processed and under which basis, as a hosted run's paper does (#103).
      const specialCategory = specialCategoryLimitation(
        job.id,
        frozen.profile,
        frozen.executionMode,
        frozen.dataset.custody,
      );
      p.body.limitations = [
        ...frozen.limitations,
        ...(specialCategory ? [specialCategory] : []),
      ].join("\n");
      p.evidenceIds = [job.id];
      p.runIds = [job.id];
      const binding = {
        procedureId: frozen.procedure.id,
        procedureRevision: frozen.procedure.revision,
        ...(frozen.procedure.planHash
          ? { planHash: frozen.procedure.planHash }
          : {}),
        briefRevision: frozen.procedure.briefRevision,
        programRevision: frozen.procedure.programRevision,
      };
      // Section 4.6: confirmatory criteria decide a 1.5 run; failing
      // exploratory criteria become review flags.
      const outcome = importedOutcome(results, decided);
      const {
        sha256: declaredHash,
        size: declaredSize,
        review: declaredReview,
        ...pinnedModel
      } = frozen.model;
      const attempt = await db()
        .prepare(
          "SELECT started_at FROM execution_attempts WHERE job_id=? AND fence=?",
        )
        .bind(job.id, job.fence)
        .first<{ started_at: string }>();
      const run: Run = {
        externalJobId: job.id,
        contractVersion: decided ? "1.5" : "1.2",
        id: job.id,
        engagementId: e.id,
        modelId: frozen.model.id,
        datasetId: frozen.dataset.id,
        task: frozen.model.task,
        profileId: frozen.profile.id,
        suite: frozen.profile.suite,
        config: frozen.profile.config,
        seed: frozen.seed,
        thresholds: {
          source: "internal_policy",
          policyId: frozen.profile.id,
          policyVersion: frozen.profile.version,
          frozenAt: job.created_at,
          frozenBy: job.created_by,
          ...frozen.profile.config,
        },
        state: "succeeded",
        outcome,
        overallOutcome: outcome,
        ...(decided
          ? {
              reviewFlags: results
                .filter(
                  (r) =>
                    r.decision!.role === "exploratory" && r.outcome === "fail",
                )
                .map((r) => r.testId),
            }
          : {}),
        results,
        paperIds: [p.id],
        createdAt: job.created_at,
        startedAt: attempt?.started_at ?? job.created_at,
        completedAt: job.completed_at,
        ...recordVersions(e),
        procedureBinding: binding,
        provenance: {
          inputHashes: {
            ...frozen.inputHashes,
            auditBinding: await sha256(JSON.stringify(binding)),
            externalRequest: job.request_sha256,
            externalResult: job.result_sha256,
            ...(decided ? { statisticsPlan: planSha256(plan) } : {}),
          },
          runnerVersion: packet.provenance.workerVersion,
          policyVersion: frozen.profile.version,
        },
        manifest: {
          schemaVersion: "1.0",
          model: pinnedModel,
          dataset: {
            ...frozen.dataset,
            rowCount: Math.max(
              0,
              ...packet.hostedResults.flatMap((r: Result) =>
                r.metrics.map((m) => m.sampleSize),
              ),
            ),
            columns: [
              frozen.profile.config.labelColumn,
              frozen.profile.config.predictionColumn,
            ],
          },
          profile: frozen.profile,
          executionMode: frozen.executionMode,
          lineage: "authenticated_external_attempt",
          testDefinitionVersion: packet.provenance.translationVersion,
          limitations: frozen.limitations,
          ...(decided ? { statistics: plan } : {}),
        },
      };
      e.artifacts.push({
        id: job.id,
        name: "external-" + job.id + ".json",
        category: "Validation",
        size: bytes.byteLength,
        sha256: job.result_sha256,
        key: job.result_key,
        createdAt: now(),
        uploadedBy: ctx.user.userId,
        visibility: "internal",
        status: "accepted",
        mediaType: "application/json",
      });
      e.papers.push(p);
      e.runs.push(run);
      const compilation = await recordStatement(
        ctx,
        e.id,
        "execution_compilation",
        {
          jobId: job.id,
          paperId: p.id,
          runId: run.id,
          sourceSha256: job.result_sha256,
        },
      );
      await save(
        ctx,
        e,
        e.version,
        "compileExternalResult",
        { jobId: job.id, paperId: p.id, sha256: job.result_sha256 },
        (cmd) => [compilation.guarded(cmd)],
      );
      return { record: compilation.record };
    },
  },
});
