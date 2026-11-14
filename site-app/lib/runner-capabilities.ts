// The capabilities an external runner can be enrolled with: the one list the
// enrolment command validates against (lib/commands/assurance/workers.ts) and
// the Enroll runner dialog offers (app/assurance-workbench), so the two cannot
// drift (#211). The runner route (app/api/runner/route.ts) matches a queued
// job to a worker by these names.

/** Every capability the server accepts, in the dialog's display order. */
export const runnerCapabilities = [
  "provided_predictions",
  "ONNX",
  "XGBoost",
  "LightGBM",
  "PMML",
  // The engine's GenAI ingest (docs/design/genai-evidence.md section 10.2):
  // parses pinned logs, executes nothing.
  "genai_ingest",
  // The client's own worker, which reads client-held datasets in the client's
  // environment (#102).
  "client_local",
] as const;

export type RunnerCapability = (typeof runnerCapabilities)[number];

/** Display name and a short help line for each capability. */
export const runnerCapabilityInfo: Record<
  RunnerCapability,
  { name: string; help: string }
> = {
  provided_predictions: {
    name: "Provided predictions",
    help: "Scores predictions the client supplied against the pinned dataset.",
  },
  ONNX: {
    name: "ONNX",
    help: "Runs an approved ONNX model from the local allowlist.",
  },
  XGBoost: {
    name: "XGBoost",
    help: "Runs an approved XGBoost model from the local allowlist.",
  },
  LightGBM: {
    name: "LightGBM",
    help: "Runs an approved LightGBM model from the local allowlist.",
  },
  PMML: {
    name: "PMML",
    help: "Runs an approved PMML model from the local allowlist.",
  },
  genai_ingest: {
    name: "GenAI evidence ingest",
    help: "Parses pinned GenAI evaluation logs and recomputes their metrics; executes no ingested code.",
  },
  client_local: {
    name: "Client-local worker",
    help: "The client's own worker: evaluates client-held datasets inside the client's environment.",
  },
};
