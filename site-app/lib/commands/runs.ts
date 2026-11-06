import { z } from "zod";
import { recordsById } from "../assurance-store";
import { aggregateOutcome } from "../diagnostic-decisions";
import { evaluate } from "../diagnostics";
import type { Engagement } from "../domain";
import { getEngagement, now, save, sha256 } from "../engagement-repo";
import { protocolConfigKeys } from "../evaluation";
import {
  registerModel,
  registerProfile,
  queueEvaluation,
  queueRetry,
  executionCSV,
  verifyFrozenInputs,
} from "../evaluation-service";
import { templatePaper } from "../factories";
import { ApiError } from "../http";
import { diagnosticNarrative } from "../presentation";
import { defineCommands } from "./command";
import { short } from "./fields";
/**
 * Interactive evaluations: registering models and protocols, queueing frozen
 * runs, executing them into draft working papers, and retry, recovery and
 * cancellation.
 */
export const runs = defineCommands({
  createModel: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const m = registerModel(e, d, ctx.user.userId);
      return { details: { modelId: m.id, status: m.status } };
    },
  },
  createEvaluationProfile: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const p = registerProfile(e, d, ctx.user.userId);
      return { details: { profileId: p.id } };
    },
  },
  queueRun: {
    roles: ["Auditor", "Lead Auditor"],
    async handle(e, d, ctx) {
      const { procedureId, datasetCardRecordId, ...args } = d;
      const p = procedureId
        ? e.workflow?.procedures.find((p) => p.id === procedureId)
        : undefined;
      if (
        procedureId &&
        (!p ||
          e.workflow?.brief?.status !== "approved" ||
          e.workflow.program.status !== "approved" ||
          !p.selected ||
          !["applicable", "readiness"].includes(p.applicability) ||
          p.modelId !== args.modelId ||
          p.datasetId !== args.datasetId ||
          p.profileId !== args.profileId)
      )
        throw new ApiError(
          409,
          "Use the approved procedure model, dataset and protocol",
        );
      const card = datasetCardRecordId
        ? (await recordsById(ctx, e.id, [datasetCardRecordId])).find(
            (r) => r.id === datasetCardRecordId && r.kind === "dataset",
          )
        : undefined;
      if (
        datasetCardRecordId &&
        (!card ||
          card.body.artifactId !== args.datasetId ||
          card.body.artifactSha256 !==
            e.artifacts.find(
              (a) => a.id === args.datasetId && a.status === "accepted",
            )?.sha256)
      )
        throw new ApiError(
          409,
          "The dataset card must match the accepted evaluation bytes",
        );
      const run = await queueEvaluation(e, args, ctx.user.userId);
      if (card && run.manifest) {
        run.manifest.dataset.cardPin = {
          recordId: card.id,
          sha256: card.sha256,
          card: card.body,
        };
        run.provenance.inputHashes.manifest = await sha256(
          JSON.stringify(run.manifest),
        );
      }
      if (p)
        run.procedureBinding = {
          procedureId: p.id,
          procedureRevision: p.revision,
          briefRevision: e.workflow!.brief!.revision,
          programRevision: e.workflow!.program.revision,
        };
      if (run.procedureBinding)
        run.provenance.inputHashes.auditBinding = await sha256(
          JSON.stringify(run.procedureBinding),
        );
      return { details: { runId: run.id } };
    },
  },
  retryRun: {
    roles: ["Auditor", "Lead Auditor"],
    async handle(e, d, ctx) {
      const a = z.object({ runId: short }).strict().parse(d),
        source = e.runs.find((r) => r.id === a.runId);
      if (
        !source ||
        !["failed", "cancelled"].includes(source.state) ||
        !source.manifest
      )
        throw new ApiError(
          409,
          "Retry a failed or cancelled frozen evaluation",
        );
      // The retry is a new run under the current runner; the source's own
      // definition version may be retired.
      await verifyFrozenInputs(e, source);
      const p = source.procedureBinding
        ? e.workflow?.procedures.find(
            (p) => p.id === source.procedureBinding?.procedureId,
          )
        : undefined;
      if (
        source.procedureBinding &&
        (!p ||
          e.workflow?.program.status !== "approved" ||
          p.revision !== source.procedureBinding.procedureRevision ||
          e.workflow.program.revision !==
            source.procedureBinding.programRevision ||
          e.workflow.brief?.revision !== source.procedureBinding.briefRevision)
      )
        throw new ApiError(
          409,
          "The audit scope or procedure changed. Queue a new planned evaluation",
        );
      const run = await queueRetry(e, source, ctx.user.userId);
      run.retryOf = source.id;
      if (source.procedureBinding) {
        run.procedureBinding = { ...source.procedureBinding };
        run.provenance.inputHashes.auditBinding = await sha256(
          JSON.stringify(run.procedureBinding),
        );
      }
      return { details: { runId: run.id, retryOf: source.id } };
    },
  },
  executeRun: {
    roles: ["Auditor", "Lead Auditor"],
    // Claims the run, executes it and saves the outcome itself, retrying the
    // completion against concurrent edits.
    async handle(e, d, ctx) {
      const run = e.runs.find((r) => r.id === d.runId);
      if (!run) throw new ApiError(404, "Run not found");
      if (run.state !== "queued")
        throw new ApiError(
          409,
          "This run has already been claimed, completed or cancelled",
        );
      run.state = "running";
      run.startedAt = now();
      // e.version is the caller's expectedVersion: the route checked it.
      await save(ctx, e, e.version, "claimRun", {
        runId: run.id,
      });
      try {
        const { a, csv } = await executionCSV(e, run);
        run.results = evaluate(run, csv);
        run.outcome = aggregateOutcome(run.results.map((r) => r.outcome));
        run.overallOutcome = run.outcome;
        run.state = "succeeded";
        run.completedAt = now();
        for (const article of [...new Set(run.results.map((r) => r.article))]) {
          const p = templatePaper(
            article === "10" ? "WP-A10-02" : "WP-A15-01",
            ctx.user.userId,
          );
          p.title = "Diagnostic run · " + run.id + " · Article " + article;
          p.required = false;
          p.body.results = diagnosticNarrative(
            run.results.filter((r) => r.article === article),
          );
          p.body.procedures =
            "Verified the registered CSV bytes against their SHA-256 pin and validated the task-specific column mappings. Executed: " +
            run.results
              .filter((r) => r.article === article)
              .map((r) => r.label)
              .join("; ") +
            ". Runner: " +
            run.provenance.runnerVersion +
            ". Saved-prediction diagnostics only; no independent model inference or cross-validation was performed.";
          p.body.scope =
            "Model: " +
            (run.manifest?.model.name ?? run.modelId) +
            " · version " +
            (run.manifest?.model.version ?? "legacy") +
            "; dataset: " +
            (run.manifest?.dataset.name ?? run.datasetId);
          p.body.sampling = run.manifest?.profile
            ? run.manifest.profile.datasetContext.split +
              " dataset. " +
              run.manifest.profile.datasetContext.independence
            : "Sampling independence not established.";
          p.body.criteria = run.manifest?.profile
            ? run.manifest.profile.name +
              " v" +
              run.manifest.profile.version +
              ": " +
              run.manifest.profile.rationale
            : p.body.criteria;
          p.body.criteria +=
            "\nInternal protocol parameters: " +
            Object.entries(run.config)
              .filter(([key]) =>
                protocolConfigKeys(
                  run.task ?? "Binary classification",
                  run.suite,
                ).includes(key),
              )
              .map(
                ([key, value]) =>
                  key.replace(/([A-Z])/g, " $1") + " = " + value,
              )
              .join("; ");
          p.body.limitations =
            "Automated diagnostic draft. Evaluate suitability, data rights, sampling and uncertainty before reaching a human audit conclusion. " +
            (run.manifest?.limitations ?? []).join(" ");
          p.evidenceIds = [a.id];
          p.runIds = [run.id];
          e.papers.push(p);
          run.paperIds.push(p.id);
        }
      } catch (error) {
        run.state = "failed";
        run.outcome = "inconclusive";
        run.overallOutcome = "inconclusive";
        run.error =
          error instanceof Error
            ? error.message
            : "Diagnostic execution failed";
        run.completedAt = now();
      }
      const generated = e.papers.filter((p) => run.paperIds.includes(p.id));
      let completion: Engagement | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = await getEngagement(ctx, e.id),
          target = latest.runs.find((r) => r.id === run.id);
        if (!target || target.state !== "running")
          throw new ApiError(409, "The run is no longer active");
        Object.assign(target, run);
        for (const p of generated)
          if (!latest.papers.some((x) => x.id === p.id)) latest.papers.push(p);
        try {
          completion = await save(ctx, latest, latest.version, "completeRun", {
            runId: run.id,
            state: run.state,
            outcome: run.outcome,
          });
          break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
        }
      }
      if (!completion)
        throw new ApiError(
          409,
          "Completion conflicted with ongoing edits. Recover the interrupted run once it is older than two minutes.",
        );
      return { saved: completion };
    },
  },
  recoverRun: {
    roles: ["Lead Auditor"],
    handle(e, d) {
      const r = e.runs.find((r) => r.id === d.runId);
      if (!r) throw new ApiError(404, "Run not found");
      if (
        r.state !== "running" ||
        Date.now() - new Date(r.startedAt ?? r.createdAt).getTime() < 120000
      )
        throw new ApiError(
          409,
          "Only an interrupted run older than two minutes can be recovered",
        );
      r.state = "failed";
      r.outcome = "inconclusive";
      r.overallOutcome = "inconclusive";
      r.error =
        "Execution was interrupted. Re-run using a new immutable request.";
      r.completedAt = now();
      return { details: { runId: r.id } };
    },
  },
  cancelRun: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d) {
      const r = e.runs.find((r) => r.id === d.runId);
      if (!r) throw new ApiError(404, "Run not found");
      if (r.state !== "queued")
        throw new ApiError(
          409,
          "Only queued interactive runs can be cancelled",
        );
      r.state = "cancelled";
      r.outcome = "inconclusive";
      r.overallOutcome = "inconclusive";
      r.completedAt = now();
      return { details: { runId: r.id } };
    },
  },
});
