// What the workspace checks of a GenAI plan and bundle manifest before it
// freezes them (docs/design/genai-evidence.md sections 6.3, 8.1 and 10.2).
// The engine validates both in full when it ingests. A plan is checked here
// under the engine's own rules (lib/genai/plan-check.ts), so a frozen plan
// never fails its ingest job as plan_invalid (#248); a manifest is checked
// for what the workspace can see: its shape and the pins to accepted
// evidence. Pure.
import { z } from "../zod";
import { genaiPlanProblems } from "./plan-check";

const sha = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * genai-plan/0.1: refused with every reason the engine would refuse it for,
 * each naming its criterion; frozen as the auditor wrote it.
 */
export const genaiPlan = z
  .record(z.string(), z.unknown())
  .superRefine((plan, x) => {
    for (const message of genaiPlanProblems(plan))
      x.addIssue({ code: "custom", message });
  });

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
    declared: z.record(z.string(), z.unknown()).optional(),
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
