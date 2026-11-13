import { predictionSchema, systemSchema } from "../../assurance-core";
import {
  addRecord,
  datasetVersions,
  recordStatement,
  systemRevisionExists,
} from "../../assurance-store";
import { datasetCardSchema, registeredCard } from "../../dataset-card";
import { save } from "../../engagement-repo";
import { ApiError } from "../../http";
import { defineCommands } from "../command";
import type { AssuranceModule } from "./target";
/**
 * The system under audit: immutable system revisions, dataset versions with
 * their cards, and declared prediction lineage.
 */
export const systems: AssuranceModule = defineCommands({
  registerSystem: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, accepted }, d, ctx) {
      const v = systemSchema.parse(d);
      if (v.modelIds.some((m) => !e.models.some((x) => x.id === m)))
        throw new ApiError(400, "Models must belong to this engagement");
      if (await systemRevisionExists(ctx, e.id, v.name, v.version))
        throw new ApiError(409, "Register a new system revision");
      for (const aid of [v.pipelineArtifactId, v.deploymentArtifactId].filter(
        Boolean,
      ))
        accepted(aid);
      return {
        record: await addRecord(ctx, e.id, "system", {
          ...v,
          modelPins: e.models
            .filter((m) => v.modelIds.includes(m.id))
            .map((m) => ({
              id: m.id,
              sha256:
                m.sourceSha256 ??
                e.artifacts.find((x) => x.id === m.artifactId)!.sha256,
            })),
          artifactPins: [v.pipelineArtifactId, v.deploymentArtifactId]
            .filter(Boolean)
            .map((a) => ({ id: a, sha256: accepted(a).sha256 })),
        }),
      };
    },
  },
  registerDataset: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, find, accepted }, d, ctx) {
      const v = datasetCardSchema.parse(d),
        artifact = accepted(v.artifactId, "Dataset");
      if (
        (await datasetVersions(ctx, e.id)).some(
          (r) =>
            r.name.toLocaleLowerCase() === v.name.toLocaleLowerCase() &&
            r.version.toLocaleLowerCase() === v.version.toLocaleLowerCase(),
        )
      )
        throw new ApiError(
          409,
          "This dataset version exists. Register a new version for corrections",
        );
      let baseline;
      if (v.baselineDatasetRecordId) {
        baseline = await find(v.baselineDatasetRecordId, "dataset");
        if (
          accepted(baseline.body.artifactId, "Dataset").sha256 !==
          baseline.body.artifactSha256
        )
          throw new ApiError(409, "Baseline source pin changed");
      }
      const log = await recordStatement(
        ctx,
        e.id,
        "dataset",
        registeredCard(v, artifact, baseline),
      );
      await save(
        ctx,
        e,
        e.version,
        "registerDataset",
        { recordId: log.record.id, artifactId: artifact.id },
        (cmd) => [log.guarded(cmd)],
      );
      return { record: log.record };
    },
  },
  registerPrediction: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, find, accepted }, d, ctx) {
      const v = predictionSchema.parse(d),
        s = await find(v.systemId, "system"),
        model = e.models.find((m) => m.id === v.modelId);
      if (!model || !s.body.modelIds.includes(model.id))
        throw new ApiError(400, "Choose a model in this system revision");
      const data = accepted(v.datasetId, "Dataset"),
        source = accepted(v.sourceDatasetId, "Dataset");
      return {
        record: await addRecord(ctx, e.id, "prediction", {
          ...v,
          systemSha256: s.sha256,
          modelSha256: model.sourceSha256,
          datasetSha256: data.sha256,
          sourceDatasetSha256: source.sha256,
          lineageAssurance:
            "Declared lineage. Independent reproduction or operational corroboration remains required.",
        }),
      };
    },
  },
});
