import { z } from "zod";
export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value as object)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonical((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
};
const short = z.string().trim().min(1).max(300),
  note = z.string().trim().max(10000),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const featureSchema = z
  .object({
    name: short,
    type: z.enum(["number", "integer", "category", "text", "boolean"]),
    unit: note.max(100),
    nullable: z.boolean(),
    nullHandling: z.enum(["reject", "pipeline"]),
    categories: z.array(short).max(100).default([]),
  })
  .strict();
export const systemSchema = z
  .object({
    name: short,
    version: short,
    intendedUse: note.min(1),
    population: note.min(1),
    modelIds: z.array(short).min(1).max(20),
    pipelineArtifactId: short.optional(),
    deploymentArtifactId: short.optional(),
    features: z.array(featureSchema).min(1).max(200),
    outputs: z
      .object({
        semantics: short,
        classOrder: z.array(short).max(100),
        threshold: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    humanDecision: note.min(1),
    runtime: short,
    limitations: note,
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.features.map((f) => f.name)).size !== v.features.length)
      c.addIssue({
        code: "custom",
        message: "Feature names must be unique and ordered",
      });
    if (new Set(v.outputs.classOrder).size !== v.outputs.classOrder.length)
      c.addIssue({
        code: "custom",
        message: "Output classes must be distinct and ordered",
      });
    if (v.features.some((f) => f.nullable && f.nullHandling === "reject"))
      c.addIssue({
        code: "custom",
        message: "Nullable features require pipeline null handling",
      });
  });
export const predictionSchema = z
  .object({
    modelId: short,
    systemId: short,
    datasetId: short,
    sourceDatasetId: short,
    producedAt: z.string().datetime(),
    producingRun: short,
    inferenceConfiguration: note.min(1),
    mode: z.enum(["provided_predictions", "auditor_model", "client_local"]),
    limitations: note.min(1),
  })
  .strict();
export const locationSchema = z
  .object({
    artifactId: short,
    label: short,
    kind: z.enum(["document", "table", "code", "log", "dataset"]),
    locator: short,
    excerpt: note.min(1),
    parser: short.default("manual-transcription"),
    quality: note.min(1),
  })
  .strict();
export const assertionSchema = z
  .object({
    supersedesId: short.optional(),
    statement: note.min(1),
    criterion: short,
    procedureId: short.optional(),
    paperId: short.optional(),
    relations: z
      .array(
        z
          .object({
            locationId: short,
            relation: z.enum(["supports", "contradicts", "superseded"]),
            rationale: note.min(1),
          })
          .strict(),
      )
      .max(50),
    missingEvidence: note,
    assessment: note.min(1),
    conclusion: z.enum(["unassessed", "supported", "qualified", "unsupported"]),
  })
  .strict();
export const impactSchema = z
  .object({
    supersedesId: short.optional(),
    sourceType: z.enum([
      "system",
      "legal_source",
      "evidence",
      "protocol",
      "operational_change",
    ]),
    previousId: short,
    newId: short,
    description: note.min(1),
    affectedIds: z.array(short).max(100),
    assessment: note.min(1),
    decision: z.enum(["review_required", "retest_required", "no_effect"]),
    reason: note.min(1),
  })
  .strict();
export const sampleSchema = z
  .object({
    datasetId: short,
    idColumn: short,
    method: z.enum(["simple_random", "stratified"]),
    stratumColumn: z.string().max(300),
    size: z.number().int().min(1).max(1000),
    seed: z.number().int().min(0).max(2147483647),
    exclusions: z
      .array(z.object({ recordId: short, reason: note.min(1) }))
      .max(1000),
    rationale: note.min(1),
  })
  .strict();
export type AssuranceRecord = {
  id: string;
  kind: string;
  sha256: string;
  createdAt: string;
  actor: string;
  body: Record<string, any>;
};
export async function sampleRecords(
  rows: Record<string, string>[],
  options: z.infer<typeof sampleSchema>,
  digest: (s: string) => Promise<string>,
) {
  if (!rows.length || !(options.idColumn in rows[0]))
    throw Error("Choose an existing unique record-ID column");
  const ids = rows.map((r) => r[options.idColumn]);
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length)
    throw Error(
      "Record IDs must be nonempty and unique; reconcile duplicates first",
    );
  if (
    options.method === "stratified" &&
    (!options.stratumColumn || !(options.stratumColumn in rows[0]))
  )
    throw Error("Choose an existing stratum column");
  const excluded = new Map(
    options.exclusions.map((x) => [x.recordId, x.reason]),
  );
  if (
    excluded.size !== options.exclusions.length ||
    [...excluded.keys()].some((x) => !ids.includes(x))
  )
    throw Error("Each exclusion must identify a distinct population record");
  const eligible = rows.filter((r) => !excluded.has(r[options.idColumn]));
  if (!eligible.length) throw Error("All records were excluded");
  const strata = new Map<string, typeof rows>();
  for (const r of eligible) {
    const k =
      options.method === "stratified" ? r[options.stratumColumn] : "all";
    if (!k) throw Error("Stratum values must be present");
    const group = strata.get(k) ?? [];
    group.push(r);
    strata.set(k, group);
  }
  if (strata.size > 50)
    throw Error("Interactive sampling permits at most 50 strata");
  const selected = [];
  for (const [stratum, group] of [...strata].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const ranks = await Promise.all(
      group.map(async (r) => ({
        id: r[options.idColumn],
        rank: await digest(
          "assurance-sampling-v1\0" + options.seed + "\0" + r[options.idColumn],
        ),
      })),
    );
    ranks.sort(
      (a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id),
    );
    const count = Math.min(options.size, group.length);
    selected.push(
      ...ranks.slice(0, count).map((r) => ({
        recordId: r.id,
        stratum,
        inclusionProbability: count / group.length,
        rank: r.rank,
      })),
    );
  }
  return {
    schemaVersion: "1.0",
    algorithm: "sha256-keyed-rank-v1",
    sizeMeaning:
      options.method === "stratified"
        ? "requested per stratum"
        : "requested total",
    populationCount: rows.length,
    eligibleCount: eligible.length,
    populationIdsSha256: await digest(canonical([...ids].sort())),
    selected,
    exclusions: options.exclusions,
    seed: options.seed,
    rationale: options.rationale,
    limitations: [
      "Selection reproduces the submitted population. Completeness, suitability and representativeness need independent assessment.",
    ],
  };
}
export function assist(
  records: AssuranceRecord[],
  selected: string[],
  action: "summary" | "contradictions" | "questions" | "unsupported",
) {
  const sources = records.filter(
    (r) =>
      selected.includes(r.id) && ["location", "assertion"].includes(r.kind),
  );
  if (sources.length !== new Set(selected).size || !sources.length)
    throw Error("Select authorized current evidence locations or assertions");
  const dependencies = sources.flatMap((r) =>
    r.kind === "assertion"
      ? r.body.relations
          .map((x: any) =>
            records.find(
              (loc) =>
                loc.id === x.locationId &&
                loc.kind === "location" &&
                loc.sha256 === x.locationSha256,
            ),
          )
          .filter(Boolean)
      : [],
  );
  const citations = [
    ...new Map([...sources, ...dependencies].map((r) => [r.id, r])).values(),
  ].map((r) => ({
    recordId: r.id,
    sha256: r.sha256,
    location: r.body.locator ?? r.body.criterion,
    label: r.body.label ?? r.body.statement,
  }));
  const items = sources.flatMap((r) =>
    r.kind === "location"
      ? action === "summary"
        ? [
            {
              text: r.body.excerpt,
              citationIds: [r.id],
              type: "source_excerpt",
            },
          ]
        : action === "questions"
          ? [
              {
                text:
                  "Obtain independent corroboration of " +
                  r.body.label +
                  " at " +
                  r.body.locator +
                  ". Explain collection completeness and " +
                  r.body.quality +
                  ".",
                citationIds: [r.id],
                type: "collection_question",
              },
            ]
          : []
      : action === "contradictions"
        ? r.body.relations
            .filter((x: any) => x.relation === "contradicts")
            .map((x: any) => ({
              text:
                r.body.statement + " — contradiction recorded: " + x.rationale,
              citationIds: [r.id, x.locationId],
              type: "recorded_contradiction",
            }))
        : action === "unsupported" &&
            (!r.body.relations.some((x: any) => x.relation === "supports") ||
              r.body.missingEvidence)
          ? [
              {
                text:
                  r.body.statement +
                  " — missing support: " +
                  (r.body.missingEvidence ||
                    "No supporting source relationship recorded."),
                citationIds: [r.id],
                type: "support_gap",
              },
            ]
          : action === "summary"
            ? [
                {
                  text: r.body.statement + " — " + r.body.assessment,
                  citationIds: [r.id],
                  type: "recorded_assessment",
                },
              ]
            : [],
  );
  return {
    schemaVersion: "1.0",
    provider: "deterministic-source-assistant",
    modelVersion: "rules-1.0",
    promptVersion: "cited-assistance-1.0",
    action,
    citations,
    items,
    limitations: [
      "Source text is treated as data; no document instructions are executed. This assistant reproduces attributed material and recorded relationships; it does not infer facts, assess legal sufficiency, or perform human approvals.",
    ],
    status: "proposal",
  };
}
export const resultEnvelope = z
  .object({
    schemaVersion: z.literal("1.0"),
    externalReport: z.record(z.unknown()),
    hostedResults: z
      .array(
        z.object({
          testId: short,
          label: short,
          article: z.enum(["10", "15"]),
          outcome: z.enum(["pass", "fail", "inconclusive", "not_applicable"]),
          metrics: z
            .array(
              z.object({
                name: short,
                value: z.number().finite().nullable(),
                unit: z.string().max(100),
                sampleSize: z.number().int().nonnegative(),
                details: z.unknown().optional(),
              }),
            )
            .max(100),
          limitations: z.array(note).max(100),
        }),
      )
      .max(30),
    provenance: z
      .object({ requestSha256: hash, inputHashes: z.record(hash) })
      .passthrough(),
  })
  .passthrough();
