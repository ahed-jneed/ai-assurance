import { z } from "zod";
import {
  locationSchema,
  sampleRecords,
  sampleSchema,
} from "../../assurance-core";
import { packetSummary } from "../../assurance-packet";
import { addRecord } from "../../assurance-store";
import { bucket } from "../../bindings";
import { parseCSV } from "../../diagnostics";
import { datasetCSV } from "../../evaluation-service";
import { ApiError } from "../../http";
import { platformKey } from "../../special-category";
import { sha256 } from "../../ids";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";
/**
 * Records drawn from accepted evidence: cited source locations, imported
 * assurance packets and reproducible samples of a dataset.
 */
export const sources: AssuranceModule = defineCommands({
  addLocation: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, accepted }, d, ctx) {
      const v = locationSchema.parse(d),
        source = accepted(v.artifactId);
      return {
        record: await addRecord(ctx, e.id, "location", {
          ...v,
          artifactSha256: source.sha256,
          artifactName: source.name,
          visibility: source.visibility,
        }),
      };
    },
  },
  importPacket: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, accepted }, d, ctx) {
      const v = z
          .object({ artifactId: short, assessment: note })
          .strict()
          .parse(d),
        source = accepted(v.artifactId);
      if (!source.name.endsWith(".json") || source.size > 5 * 1024 * 1024)
        throw new ApiError(
          400,
          "Select an accepted assurance JSON packet up to 5 MB",
        );
      const o = await bucket().get(platformKey(source));
      if (!o) throw new ApiError(404, "Packet bytes unavailable");
      const bytes = await o.arrayBuffer();
      if ((await sha256(bytes)) !== source.sha256)
        throw new ApiError(409, "Packet integrity mismatch");
      const summary = packetSummary(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      return {
        record: await addRecord(
          ctx,
          e.id,
          summary.type === "registry_snapshot"
            ? "registry"
            : summary.type === "operational_collection" ||
                summary.type === "decision_replay"
              ? "operational"
              : "statistics",
          {
            ...summary,
            artifactId: source.id,
            artifactName: source.name,
            artifactSha256: source.sha256,
            auditorAssessment: v.assessment,
            status: "diagnostic_only",
          },
        ),
      };
    },
  },
  sample: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e }, d, ctx) {
      const { procedureId, ...sample } = d,
        v = sampleSchema.parse(sample),
        p = procedureId
          ? e.workflow?.procedures.find((p) => p.id === procedureId)
          : undefined;
      if (procedureId && (!p || p.datasetId !== v.datasetId))
        throw new ApiError(
          400,
          "The sample must use the planned procedure dataset",
        );
      const { a: data, csv } = await datasetCSV(e, v.datasetId);
      return {
        record: await addRecord(ctx, e.id, "sample", {
          ...v,
          ...(await sampleRecords(parseCSV(csv), v, sha256)),
          datasetSha256: data.sha256,
          ...(p
            ? {
                procedureId: p.id,
                procedureRevision: p.revision,
                programRevision: e.workflow!.program.revision,
                briefRevision: e.workflow?.brief?.revision,
              }
            : {}),
        }),
      };
    },
  },
});
