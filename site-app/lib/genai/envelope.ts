// The GenAI result envelope `genai-result/0.1` (docs/design/genai-evidence.md
// section 10.3) as the workspace reads it. Hashed parts travel as exact
// strings: the SHA-256 is checked over the string's UTF-8 bytes and the
// string is then parsed, never re-serialised, because Python writes `1.0`
// where JavaScript writes `1`. The workspace never recomputes statistics; it
// checks pins and reads what the engine computed. Pure: no bindings.
import { z } from "zod";
import { sha256 } from "../ids";

export const GENAI_RESULT_SCHEMA = "genai-result/0.1";
/** The worker request schema of a `genai_ingest` job (design section 10.2). */
export const GENAI_REQUEST_SCHEMA = "genai-1.0";
/** Results the runner accepts (MAX_RESULT_BYTES of the worker contract). */
export const MAX_GENAI_RESULT_BYTES = 8 * 1024 * 1024;

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
export const genaiResultEnvelope = z
  .object({
    schemaVersion: z.literal(GENAI_RESULT_SCHEMA),
    computationJSON: z.string().min(2),
    computationSha256: hex64,
    itemsJSONL: z.string().nullable(),
    itemsSha256: hex64,
    provenance: z
      .object({
        channel: z.enum(["runner", "cli"]),
        producedAt: z.string().max(100).nullable(),
        requestSha256: hex64.nullable(),
        inputHashes: z.record(z.string().regex(/^(0|[1-9][0-9]?)$/), hex64),
        workerVersion: z.string().max(100).nullable(),
        imageDigest: z.string().max(100).nullable(),
        executionMode: z.literal("genai_ingest"),
      })
      .strict(),
  })
  .strict();
export type GenaiEnvelope = z.infer<typeof genaiResultEnvelope>;

// The parts of `genai-computation/0.1` the workspace reads. The engine's
// schema (schemas/genai-result.schema.json) is authoritative; unknown fields
// pass through, and a missing field the workspace needs is a rejection.
const level = z.enum(["L0", "L1", "L2", "L3"]);
const interval = z
  .object({
    level: z.number(),
    lower: z.number().nullable(),
    upper: z.number().nullable(),
    method: z.string(),
  })
  .passthrough();
const member = z
  .object({
    memberId: z.string(),
    metric: z.string(),
    subject: z.string().nullable().optional(),
    estimate: z.number().nullable(),
    interval: interval.nullable(),
    status: z.string(),
    direction: z.string(),
    pValue: z.number().nullable(),
    reasons: z.array(z.string()),
    band: z
      .object({ lower: z.number().nullable(), upper: z.number().nullable() })
      .partial()
      .nullable()
      .optional(),
    counts: z
      .object({
        n: z.number().nullable().optional(),
        x: z.number().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    seIid: z.number().nullable().optional(),
    seCluster: z.number().nullable().optional(),
    se: z.number().nullable().optional(),
    nEff: z.number().nullable().optional(),
  })
  .passthrough();
const flag = z
  .object({
    flag: z.string(),
    runKey: z.string(),
    score: z.string(),
    judgeRef: z.string().nullable(),
    reasons: z.array(z.string()),
  })
  .passthrough();
const criterion = z
  .object({
    id: z.string(),
    kind: z.string(),
    outcome: z.string().nullable(),
    members: z.array(member),
    decision: z
      .object({
        role: z.enum(["confirmatory", "exploratory"]),
        confidenceLevel: z.number(),
        pValue: z.number().nullable(),
        adjustedPValue: z.number().nullable(),
        sampleSize: z.number().nullable(),
        reasons: z.array(z.string()),
      })
      .passthrough(),
    runKeys: z.array(z.string()),
    scoreKinds: z.record(z.record(z.array(z.string()))),
    flags: z.array(flag),
  })
  .passthrough();
const source = z
  .object({ kind: z.string() })
  .passthrough()
  .nullable()
  .optional();
const judge = z
  .object({
    ref: z.string(),
    role: z.string(),
    model: z
      .object({
        model: z.string().nullable(),
        snapshot: z.string().nullable(),
        family: z.string().nullable(),
      })
      .passthrough(),
    validation: z
      .object({
        kappa: z.number().nullable(),
        lower: z.number().nullable(),
        upper: z.number().nullable(),
        n: z.number(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const run = z
  .object({
    runKey: z.string(),
    format: z.string(),
    inputs: z.array(hex64),
    evidenceLevel: level,
    levelReasons: z.array(z.string()),
    incomplete: z.boolean(),
    claimScope: z.array(z.string()),
    warnings: z.array(
      z.object({ code: z.string(), count: z.number() }).passthrough(),
    ),
    reconciliation: z.array(
      z
        .object({
          metric: z.string(),
          tool: z.unknown(),
          ours: z.unknown(),
          status: z.string(),
        })
        .passthrough(),
    ),
    postRunEdits: z
      .object({
        counts: z
          .object({
            scoreEdits: z.number(),
            logUpdates: z.number(),
            invalidatedSampleEpochs: z.number(),
            logInvalidated: z.boolean(),
          })
          .passthrough(),
        scoreEdits: z.array(z.unknown()),
      })
      .passthrough()
      .nullable(),
    runMetadata: z
      .object({
        completeness: z.object({
          missing: z.array(z.string()),
          declaredOnly: z.array(z.string()),
        }),
        systemUnderTest: z
          .object({
            model: z.string().nullable(),
            snapshot: z.string().nullable(),
            family: z.string().nullable(),
            source,
          })
          .passthrough(),
        harness: z
          .object({
            name: z.string().nullable(),
            version: z.string().nullable(),
          })
          .passthrough(),
        dataset: z
          .object({
            name: z.string().nullable(),
            version: z.string().nullable(),
          })
          .passthrough(),
        tools: z
          .object({
            agentic: z.boolean().nullable(),
            offered: z.array(
              z
                .object({ name: z.string(), permission: z.string() })
                .passthrough(),
            ),
          })
          .passthrough(),
        judges: z.array(judge),
      })
      .passthrough(),
  })
  .passthrough();
const computation = z
  .object({
    schemaVersion: z.string(),
    engine: z
      .object({
        version: z.string(),
        genaiVersion: z.string(),
        statisticsVersion: z.string(),
        taxonomyVersion: z.string(),
      })
      .passthrough(),
    plan: z
      .object({
        planSha256: hex64,
        normalized: z
          .object({
            confidenceLevel: z.number(),
            minimums: z.object({
              sampleSize: z.number(),
              memberSize: z.number(),
              clusters: z.number(),
            }),
            judgeValidation: z.object({
              minimumItems: z.number(),
              minimumKappaLowerBound: z.number(),
              requireDifferentFamily: z.boolean(),
              pairwiseMinimumConsistencyLowerBound: z.number(),
            }),
            maxUnscoredFraction: z.number(),
            maxErrorFraction: z.number(),
            scorePolicy: z.string(),
          })
          .passthrough(),
      })
      .passthrough(),
    manifest: z
      .object({
        manifestSha256: hex64,
        origin: z.enum(["auditee_supplied", "auditor_rerun"]),
      })
      .passthrough(),
    inputs: z.array(
      z
        .object({
          name: z.string(),
          sha256: hex64,
          bytes: z.number(),
          format: z.string(),
          formatVersion: z.string().nullable(),
          role: z.string(),
        })
        .passthrough(),
    ),
    runs: z.array(run),
    criteria: z.array(criterion),
    judgeValidation: z.array(
      z
        .object({
          inputSha256: hex64,
          declaredJudgeRef: z.string().nullable(),
          n: z.number(),
          kappa: z.number().nullable(),
          lower: z.number().nullable(),
          upper: z.number().nullable(),
          level: z.number(),
          evidenceLevel: level,
          bindings: z.array(
            z
              .object({
                runKey: z.string(),
                judgeRef: z.string(),
                binding: z.record(z.boolean().nullable()),
                validated: z.boolean(),
                reasons: z.array(z.string()),
              })
              .passthrough(),
          ),
          positionConsistency: z
            .object({ lower: z.number().nullable(), pairs: z.number() })
            .passthrough()
            .nullable(),
        })
        .passthrough(),
    ),
    marking: z.array(
      z
        .object({
          runKey: z.string(),
          // Engine 0.2 names the input format of each marking block (#128).
          format: z.string().max(100).optional(),
          inputSha256: hex64,
          evidenceLevel: level,
          count: z.number(),
          records: z.array(z.unknown()),
        })
        .passthrough(),
    ),
    overallOutcome: z.string(),
    warnings: z.array(
      z.object({ code: z.string(), count: z.number() }).passthrough(),
    ),
  })
  .passthrough();
export type GenaiComputation = z.infer<typeof computation>;

export class GenaiEnvelopeError extends Error {}
const reject = (message: string): never => {
  throw new GenaiEnvelopeError(message);
};

/**
 * Parses the exact envelope text and checks its own pins: computationSha256
 * over computationJSON and, when items are inline, itemsSha256 over
 * itemsJSONL. Throws GenaiEnvelopeError with the reason; never trusts a field
 * it did not check.
 */
export async function readGenaiEnvelope(text: string) {
  if (new TextEncoder().encode(text).length > MAX_GENAI_RESULT_BYTES)
    reject("The GenAI result exceeds 8 MiB");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    reject("The file is not JSON");
  }
  const parsed = genaiResultEnvelope.safeParse(raw);
  if (!parsed.success) reject("The file is not a genai-result/0.1 envelope");
  const envelope = parsed.data!;
  if ((await sha256(envelope.computationJSON)) !== envelope.computationSha256)
    reject("computationSha256 does not match computationJSON");
  if (
    envelope.itemsJSONL !== null &&
    (await sha256(envelope.itemsJSONL)) !== envelope.itemsSha256
  )
    reject("itemsSha256 does not match itemsJSONL");
  let body: unknown;
  try {
    body = JSON.parse(envelope.computationJSON);
  } catch {
    reject("computationJSON is not JSON");
  }
  const c = computation.safeParse(body);
  if (!c.success)
    reject(
      "The computation lacks a field the workspace reads: " +
        c
          .error!.issues.slice(0, 3)
          .map((i) => i.path.join("."))
          .join(", "),
    );
  const comp = c.data!;
  const inputHashes = Object.values(envelope.provenance.inputHashes).sort();
  if (
    inputHashes.join() !==
    comp.inputs
      .map((i) => i.sha256)
      .sort()
      .join()
  )
    reject("The provenance input hashes differ from the computation inputs");
  return { envelope, computation: comp };
}
