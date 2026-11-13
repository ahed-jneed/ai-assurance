// What the workspace checks of a GenAI plan and bundle manifest before it
// freezes them (docs/design/genai-evidence.md sections 6.3, 8.1 and 10.2).
// The engine validates both in full when it ingests; these checks refuse
// early what the workspace can see: the shape, the floors of decisions D-10
// and D-16, and the pins to accepted evidence. Pure.
import { z } from "zod";
import { GENAI_FLOORS } from "./readiness";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const floor = (min: number, message: string) =>
  z.number().refine((v) => v >= min, message);
const ceiling = (max: number, message: string) =>
  z.number().refine((v) => v <= max, message);

/** genai-plan/0.1: a criterion list plus optional settings, floors enforced. */
export const genaiPlan = z
  .object({
    schemaVersion: z.literal("genai-plan/0.1"),
    criteria: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
            kind: z.enum([
              "genai_mean",
              "genai_attack_success",
              "genai_pass_k",
              "genai_paired_difference",
              "genai_marking",
            ]),
          })
          .passthrough(),
      )
      .min(1)
      .max(50),
    minimums: z
      .object({
        sampleSize: floor(
          GENAI_FLOORS.sampleSize,
          "minimums.sampleSize may not be below 30",
        ).optional(),
        memberSize: floor(
          GENAI_FLOORS.memberSize,
          "minimums.memberSize may not be below 10",
        ).optional(),
        clusters: floor(
          GENAI_FLOORS.clusters,
          "minimums.clusters may not be below 10",
        ).optional(),
      })
      .strict()
      .optional(),
    judgeValidation: z
      .object({
        minimumItems: floor(
          GENAI_FLOORS.minimumItems,
          "judgeValidation.minimumItems may not be below 50 (D-10)",
        ).optional(),
        minimumKappaLowerBound: floor(
          GENAI_FLOORS.minimumKappaLowerBound,
          "judgeValidation.minimumKappaLowerBound may not be below 0.60 (D-10)",
        ).optional(),
        requireDifferentFamily: z
          .literal(true, {
            errorMap: () => ({
              message:
                "judgeValidation.requireDifferentFamily must stay true (D-10)",
            }),
          })
          .optional(),
        pairwiseMinimumConsistencyLowerBound: floor(
          GENAI_FLOORS.pairwiseMinimumConsistencyLowerBound,
          "judgeValidation.pairwiseMinimumConsistencyLowerBound may not be below 0.80 (D-16)",
        ).optional(),
      })
      .strict()
      .optional(),
    maxUnscoredFraction: ceiling(
      GENAI_FLOORS.maxUnscoredFraction,
      "maxUnscoredFraction may not exceed 0.05",
    ).optional(),
    maxErrorFraction: ceiling(
      GENAI_FLOORS.maxErrorFraction,
      "maxErrorFraction may not exceed 0.05",
    ).optional(),
    // Off unless the plan asks (design Q12): inert excerpts of failed or
    // successful-attack items, or of every item, up to 1,000 characters.
    excerpts: z.enum(["none", "failures", "all"]).optional(),
    // Public keys of detection solutions whose signed results count (#128).
    detectionKeys: z
      .array(
        z
          .object({
            keyId: z.string().regex(/^[A-Za-z0-9._@+=/#-]{1,128}$/),
            solutionId: z.string().min(1).max(100),
            algorithm: z.literal("Ed25519"),
            publicKeySPKI: z
              .string()
              .regex(
                /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/,
                "publicKeySPKI is a base64 Ed25519 SubjectPublicKeyInfo",
              ),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .passthrough()
  .superRefine((p, x) => {
    if (new Set(p.criteria.map((c) => c.id)).size !== p.criteria.length)
      x.addIssue({ code: "custom", message: "Criterion ids must be unique" });
    if (JSON.stringify(p).length > 64 * 1024)
      x.addIssue({ code: "custom", message: "The plan exceeds 64 KiB" });
  });
export type GenaiPlan = z.infer<typeof genaiPlan>;

export const GENAI_INPUT_FORMATS = [
  "inspect_eval",
  "inspect_json",
  "lm_eval_samples",
  "promptfoo_results",
  "garak_report",
  "pyrit_export",
  "deepeval_test_run",
  "ragas_results",
  "judge_validation_jsonl",
  "marking_check_jsonl",
  "c2pa_validator_report",
  "signed_detection_jsonl",
] as const;

/** genai-bundle/0.1 as the auditor declares it; inputs pin evidence by SHA-256. */
export const genaiManifest = z
  .object({
    schemaVersion: z.literal("genai-bundle/0.1"),
    origin: z.enum(["auditee_supplied", "auditor_rerun"]),
    inputs: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            sha256: sha,
            bytes: z.number().int().positive(),
            format: z.enum(GENAI_INPUT_FORMATS),
            role: z.enum([
              "log",
              "samples",
              "results",
              "hitlog",
              "judge_validation",
              "attack_set",
              "marking",
            ]),
            judgeRef: z.string().max(64).optional(),
            runKey: z
              .string()
              .regex(/^[A-Za-z0-9._:/#@+=-]{1,128}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    declared: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((m, x) => {
    if (new Set(m.inputs.map((i) => i.sha256)).size !== m.inputs.length)
      x.addIssue({
        code: "custom",
        message: "Each input file is listed once (inputs match by SHA-256)",
      });
    if (JSON.stringify(m).length > 64 * 1024)
      x.addIssue({ code: "custom", message: "The manifest exceeds 64 KiB" });
  });
export type GenaiManifest = z.infer<typeof genaiManifest>;
