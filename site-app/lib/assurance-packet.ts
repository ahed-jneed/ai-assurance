import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  count = z.number().int().nonnegative(),
  outcome = z.enum(["pass", "fail", "inconclusive", "not_applicable"]);
const base = z
  .object({
    schemaVersion: z.literal("1.0"),
    toolVersion: z.string().max(100).optional(),
    type: z.enum([
      "sampling",
      "data_quality",
      "bootstrap_interval",
      "intersectional_slices",
      "operational_collection",
      "decision_replay",
      "registry_snapshot",
    ]),
    limitations: z.array(z.string().max(10000)).max(100).optional(),
    assumptions: z.array(z.string().max(10000)).max(100).optional(),
  })
  .passthrough();
const fieldWords: Record<string, string> = {
  schemaVersion: "packet version",
  type: "packet type",
};
/**
 * What the auditor reads when a JSON file is not a packet this platform
 * imports (#226 item 4): the supported version and at most the first missing
 * field in plain words, never the validator's own text.
 */
export function packetRefusal(error: z.ZodError): string {
  const missing = error.issues.find(
    (i) =>
      i.path.length > 0 &&
      ((i.code === "invalid_type" && i.received === "undefined") ||
        (i.code === "invalid_literal" && i.received === undefined)),
  );
  const field = missing?.path.map(String).join(".") ?? "";
  const words =
    fieldWords[field] ??
    field
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\./g, " ")
      .toLowerCase();
  return (
    "This file is not a supported assurance packet (expected packet version 1.0)" +
    (missing
      ? ". The first missing field is the " + words + " (" + field + ")"
      : "")
  );
}
export function packetSummary(value: unknown) {
  const p = base.parse(value),
    common = {
      type: p.type,
      toolVersion: p.toolVersion,
      limitations: p.limitations ?? [],
      assumptions: p.assumptions ?? [],
      origin:
        "Imported client/local diagnostic packet; supplied source integrity does not establish population completeness or independent execution.",
    };
  if (p.type === "registry_snapshot") {
    const v = z
      .object({
        provider: z.enum(["mlflow", "huggingface"]),
        status: z.literal("proposed"),
        auditApproval: z.literal("not_granted"),
        registration: z
          .object({ name: z.string(), version: z.string() })
          .passthrough(),
        source: z
          .object({
            registryOrigin: z.string(),
            requestedReference: z.unknown(),
            resolvedReference: z.unknown(),
            acquiredAt: z.string(),
            responses: z
              .array(z.object({ sha256: hash, bytes: count }).passthrough())
              .max(100),
          })
          .passthrough(),
        systemContract: z
          .object({
            features: z.array(z.unknown()).max(200),
            unknownFields: z.array(z.unknown()).max(100),
            executionReadiness: z.literal("not_assessed"),
          })
          .passthrough(),
        snapshotSha256: hash,
      })
      .parse(p);
    return {
      ...common,
      provider: v.provider,
      status: v.status,
      name: v.registration.name,
      version: v.registration.version,
      source: v.source,
      declaredFeatures: v.systemContract.features,
      unknownFields: v.systemContract.unknownFields,
      executionReadiness: v.systemContract.executionReadiness,
      snapshotSha256: v.snapshotSha256,
      auditApproval: "not_granted",
    };
  }
  if (p.type === "sampling") {
    const v = z
      .object({
        population: z
          .object({
            count,
            eligibleCount: count,
            excludedCount: count,
            sha256: hash,
          })
          .passthrough(),
        selectedIds: z.array(z.string()).max(100000),
        stratumCounts: z.array(z.unknown()).max(1000),
        exclusions: z.array(z.unknown()).max(100000),
      })
      .parse(p);
    return {
      ...common,
      population: v.population,
      selectedCount: v.selectedIds.length,
      stratumCounts: v.stratumCounts,
      exclusionCount: v.exclusions.length,
    };
  }
  if (p.type === "data_quality") {
    const v = z
      .object({
        outcome,
        recordCount: count,
        populationSha256: hash,
        splitCounts: z.record(count),
        missingFields: z.array(z.unknown()),
        duplicateIds: z.array(z.unknown()),
        recordLeakage: z.array(z.unknown()),
        entityLeakage: z.array(z.unknown()),
        temporalViolations: z.object({ count }).passthrough(),
      })
      .parse(p);
    return {
      ...common,
      outcome: v.outcome,
      populationCount: v.recordCount,
      populationSha256: v.populationSha256,
      splitCounts: v.splitCounts,
      missingFields: v.missingFields.length,
      duplicates: v.duplicateIds.length,
      recordLeakage: v.recordLeakage.length,
      entityLeakage: v.entityLeakage.length,
      temporalViolations: v.temporalViolations.count,
    };
  }
  if (p.type === "bootstrap_interval") {
    const v = z
      .object({
        outcome,
        estimate: z.number().finite().nullable(),
        statistic: z.string().max(100),
        sampleSize: count,
        clusterCount: count.nullable(),
        method: z.enum(["iid", "cluster"]),
        seed: z.number().int(),
        validReplicates: count,
        confidenceInterval: z
          .object({
            lower: z.number().finite(),
            upper: z.number().finite(),
            level: z.number().min(0).max(1),
            method: z.string(),
          })
          .nullable(),
      })
      .parse(p);
    return { ...common, ...v };
  }
  if (p.type === "intersectional_slices") {
    const v = z
      .object({
        outcome,
        populationSha256: hash,
        populationCount: count,
        includedCount: count,
        protectedFields: z.array(z.string()).max(10),
        slices: z.array(z.unknown()).max(1000),
        metrics: z.array(z.unknown()).max(100),
      })
      .parse(p);
    return {
      ...common,
      outcome: v.outcome,
      populationSha256: v.populationSha256,
      populationCount: v.populationCount,
      includedCount: v.includedCount,
      protectedFields: v.protectedFields,
      sliceCount: v.slices.length,
      metrics: v.metrics,
    };
  }
  if (p.type === "operational_collection") {
    const v = z
      .object({
        outcome,
        recordCount: count,
        populationSha256: hash,
        sources: z
          .array(
            z
              .object({
                name: z.string(),
                sha256: hash,
                bytes: count,
                recordCount: count,
              })
              .passthrough(),
          )
          .max(100),
        duplicateIds: z.array(z.unknown()),
        sequenceGaps: z.array(z.unknown()),
        duplicateSequences: z.array(z.unknown()),
        overrideIssues: z.object({ count }).passthrough(),
        missingFields: z.object({ count }).passthrough(),
        sourceCounts: z.unknown(),
      })
      .parse(p);
    return {
      ...common,
      outcome: v.outcome,
      populationCount: v.recordCount,
      populationSha256: v.populationSha256,
      sources: v.sources,
      duplicateIds: v.duplicateIds.length,
      sequenceGaps: v.sequenceGaps.length,
      duplicateSequences: v.duplicateSequences.length,
      overrideIssues: v.overrideIssues.count,
      missingFields: v.missingFields.count,
      sourceCounts: v.sourceCounts,
    };
  }
  const v = z
    .object({
      outcome,
      selectedIds: z.array(z.string()).max(100000),
      selectionSha256: hash,
      loggedPopulationSha256: hash,
      providedReplayPopulationSha256: hash,
      outputField: z.string().max(100),
      absoluteTolerance: z.number().finite().nonnegative(),
      relativeTolerance: z.number().finite().nonnegative(),
      comparisons: z.array(z.object({ outcome }).passthrough()).max(100000),
    })
    .parse(p);
  return {
    ...common,
    outcome: v.outcome,
    selectedCount: v.selectedIds.length,
    selectionSha256: v.selectionSha256,
    loggedPopulationSha256: v.loggedPopulationSha256,
    providedReplayPopulationSha256: v.providedReplayPopulationSha256,
    outputField: v.outputField,
    absoluteTolerance: v.absoluteTolerance,
    relativeTolerance: v.relativeTolerance,
    mismatchCount: v.comparisons.filter((c) => c.outcome === "fail").length,
    inconclusiveCount: v.comparisons.filter((c) => c.outcome === "inconclusive")
      .length,
  };
}
