// Auditor guidance for the failure codes the external worker posts with
// op "fail" (engine/WORKER.md, "Failure codes"). worker-failures.test.ts
// keeps the keys identical to FAILURE_CODES in engine/worker_contract.py.
// The code is the only failure information the worker sends; the operator
// log on the worker host has the detail.
export const WORKER_FAILURE_GUIDANCE: Record<string, string> = {
  request_contract_rejected:
    "The worker refused the frozen request as outside its contract, for example an unsupported test or model format. Correct the protocol or system revision and queue a new request.",
  lease_expired_on_receipt:
    "The job reached the worker after its two-minute lease had ended, usually a slow connection or a proxy clock that disagrees with the platform. Ask the worker operator to check, then queue again.",
  model_not_locally_approved_or_runtime_unavailable:
    "The worker operator has not approved this model's SHA-256 or enabled its format on this worker. Ask the operator to review and allowlist the model, then queue again.",
  executable_preprocessing_unsupported:
    "The request needs preprocessing the worker would have to execute. Supply already prepared numeric columns.",
  workspace_job_limit:
    "The worker's retained evidence reached its job limit. Ask the operator to archive retained jobs, then queue again.",
  workspace_unavailable:
    "The worker could not write its job files (permissions or disk space). Ask the operator to fix its workspace, then queue again.",
  transport_unavailable:
    "The connection between the worker and the platform failed during a download. Queue again; if it recurs, ask the operator to check the network.",
  transport_idle_timeout:
    "A download stalled. Queue again; if it recurs, ask the operator to check the network or raise the transport timeout.",
  response_deadline_exceeded:
    "A download took longer than its time budget. Queue again; if it recurs, ask the operator to check the bandwidth.",
  response_truncated: "A download was cut off before it finished. Queue again.",
  response_size_rejected:
    "The platform sent more bytes than the pinned size. Check that the pinned evidence is unchanged before queueing again.",
  dataset_input_pin_mismatch:
    "The dataset bytes the worker received differ from the pinned size or SHA-256. Treat this as an integrity exception and investigate before re-running.",
  model_input_pin_mismatch:
    "The model bytes the worker received differ from the pinned SHA-256. Treat this as an integrity exception and investigate before re-running.",
  model_input_size_mismatch:
    "The model's byte count differs from its registered size. Check the registered model artifact.",
  dataset_malformed:
    "The dataset is not well-formed UTF-8 CSV: empty or duplicate headers, ragged rows, or no rows. Correct the evidence file and queue again.",
  dataset_limit_exceeded:
    "The dataset exceeds the worker's byte, row or column limits. Reduce or split the dataset.",
  missing_column:
    "A column the protocol maps (label, prediction, group or score) or a model feature column is absent from the dataset. Compare the protocol's column names with the file.",
  missing_value:
    "A mapped cell or model feature is empty, and the worker never drops rows silently. Resolve the missing values and queue again.",
  invalid_numeric_value:
    "A numeric cell is not a finite number, or a score lies outside 0 to 1. Correct the dataset.",
  label_set_mismatch:
    "The labels in the data, the frozen favourable and other class labels, and the model's output classes do not agree. Check the system revision's output classes and the protocol's favourable label.",
  cardinality_limit_exceeded:
    "The data has more than 1,000 protected groups or 100 classes. Reduce the group granularity.",
  protocol_config_invalid:
    "The protocol's column mapping, acceptance criteria, minimum counts or class labels cannot be applied. Review the protocol version.",
  model_artifact_invalid:
    "The model file is not a valid artifact of its declared format. Check the registered format and file.",
  model_runtime_unavailable:
    "The worker's compute image lacks the runtime for this model format. Ask the operator.",
  model_objective_mismatch:
    "The model's native objective differs from the declared task or is outside the reviewed protocol.",
  model_interface_mismatch:
    "The model's inputs or named outputs do not match the system revision's features or the named adapter output.",
  model_output_invalid:
    "The model returned invalid output: non-finite values, the wrong shape, labels outside the output classes, or probabilities that do not sum to one.",
  model_inference_failed:
    "The model runtime raised an error while scoring. Ask the operator for the operator log entry of this job.",
  evidence_too_large:
    "The result exceeds the 8 MiB evidence limit. Select fewer tests or fewer protected groups.",
  compute_timeout:
    "The computation exceeded its time limit. Reduce the dataset or ask the operator to raise the compute timeout.",
  compute_resource_exhausted:
    "The computation ran out of memory. Reduce the dataset or ask the operator for more memory.",
  compute_internal_error:
    "An unexpected engine error. Report it to the worker operator as a defect, with the job ID.",
  compute_unavailable:
    "The worker could not start its compute process or container. Ask the operator.",
  compute_rejected:
    "The compute process failed without a valid error report, for example it was stopped or its image is outdated. Ask the operator.",
  result_verification_failed:
    "The worker's own verification rejected the result, so nothing was submitted. Report it to the worker operator as a defect.",
  worker_internal_error:
    "An unexpected worker error. Report it to the worker operator as a defect, with the job ID.",
};

// Failure texts the platform itself stores (app/api/runner/route.ts).
const PLATFORM_FAILURES: Record<string, string> = {
  "Maximum attempts exhausted":
    "Five claims of this job ended without a result, for example because the worker stopped or lost its lease each time. Ask the worker operator to check the worker, then queue again.",
};

export type FailureExplanation = {
  /** The documented code, or null when the stored text is not one. */
  code: string | null;
  guidance: string;
};

/**
 * Guidance for a failed job's stored error. Unknown text falls back to the
 * text itself.
 */
export function explainWorkerFailure(
  error: string | null | undefined,
): FailureExplanation | null {
  if (!error) return null;
  if (Object.hasOwn(WORKER_FAILURE_GUIDANCE, error))
    return { code: error, guidance: WORKER_FAILURE_GUIDANCE[error] };
  const http = /^http_([1-5][0-9]{2})$/.exec(error);
  if (http)
    return {
      code: error,
      guidance: `The platform answered the worker's download or completion with HTTP ${http[1]}. Queue again; if it recurs, check that the pinned evidence is still available and the worker is still enrolled.`,
    };
  if (Object.hasOwn(PLATFORM_FAILURES, error))
    return { code: null, guidance: PLATFORM_FAILURES[error] };
  return { code: null, guidance: error };
}
