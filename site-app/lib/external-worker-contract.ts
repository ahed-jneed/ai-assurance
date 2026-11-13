// What the external pull worker (engine/worker.py) accepts, checked when the
// platform freezes a job so that the worker is never handed a job it has to
// refuse. The numbers mirror engine/worker_contract.py, and
// external-worker-contract.test.ts reads that file and fails when the two
// sides disagree.
import { ApiError } from "./http";

export const WORKER_LIMITS = {
  /** MAX_ENVELOPE_BYTES: the largest claim response the worker reads. */
  maxResponseBytes: 2 * 1024 * 1024,
  /** validate_model_spec: a modelSpec has 1 to 100 featureColumns. */
  maxFeatureColumns: 100,
  /** validate_model_spec: a binary modelSpec has exactly two outputLabels. */
  binaryOutputLabels: 2,
  /** validate_model_spec: a multiclass modelSpec has 2 to 100 outputLabels. */
  maxClassLabels: 100,
} as const;

const quoted = (labels: string[]) =>
  labels.length ? labels.map((l) => "'" + l + "'").join(", ") : "none";

/**
 * The binary label pair frozen into a job: the protocol's favourable label
 * and the system revision's other output class. The worker requires exactly
 * this pair (binary_labels in engine/worker_contract.py), so a pair that is
 * not exactly the system's two output classes is refused here with a 400
 * instead of failing later with label_set_mismatch. Other tasks freeze no
 * negative label.
 */
export function frozenLabelPair(input: {
  task: string;
  classOrder: string[];
  positiveLabel: string;
  requested?: string;
}): { positiveLabel: string; negativeLabel: string } | undefined {
  const { task, classOrder, positiveLabel, requested } = input;
  if (task !== "Binary classification") {
    if (requested)
      throw new ApiError(
        400,
        "The other binary class label applies only to binary classification. Leave it empty for this model.",
      );
    return undefined;
  }
  if (classOrder.length !== WORKER_LIMITS.binaryOutputLabels)
    throw new ApiError(
      400,
      `External execution of a binary model needs the system revision to declare exactly two output classes; it declares ${classOrder.length} (${quoted(classOrder)}). Register a system revision whose ordered output classes are the model's two labels.`,
    );
  if (!classOrder.includes(positiveLabel))
    throw new ApiError(
      400,
      `The protocol's favourable label '${positiveLabel}' is not one of the system revision's output classes (${quoted(classOrder)}). Use a protocol version whose favourable label is one of them.`,
    );
  // Safe: systemSchema (lib/assurance-core.ts) refuses duplicate output
  // classes, so a two-class order always holds one class besides positiveLabel.
  const negativeLabel = classOrder.find((l) => l !== positiveLabel)!;
  if (requested !== undefined && requested !== negativeLabel)
    throw new ApiError(
      400,
      `The other binary class label must be '${negativeLabel}', the system revision's other output class; the worker would refuse '${requested}'. Leave the field empty to use '${negativeLabel}'.`,
    );
  return { positiveLabel, negativeLabel };
}

/**
 * A schemaVersion 1.1 protocol pre-registers its binary label pair with its
 * statistics plan. The worker scores against the frozen pair, so the
 * declared other label must be the system revision's other output class;
 * otherwise the plan registered in advance would not describe the run.
 * Protocols without a plan, and other tasks, declare no pair to check.
 */
export function assertDeclaredLabel(
  plan: unknown,
  declared: string | undefined,
  frozen: { negativeLabel: string } | undefined,
) {
  if (!plan || !frozen || !declared || declared === frozen.negativeLabel)
    return;
  throw new ApiError(
    400,
    `The protocol declares the other binary class label '${declared}', but the system revision's other output class is '${frozen.negativeLabel}'. Use a protocol version that declares '${frozen.negativeLabel}', or a system revision whose output classes are the protocol's label pair.`,
  );
}

/**
 * Binary performance is measured on the protocol's performance positive
 * class (#65). The worker accepts only one of the frozen label pair, which
 * frozenLabelPair takes from the system revision's output classes, and would
 * otherwise fail the job with protocol_config_invalid; refuse it here with a
 * 400 instead. A legacy (1.0) protocol is the case that reaches this check:
 * a 1.1 protocol's class is one of its declared pair, which the queue already
 * matched to the system. Empty means the favourable label.
 */
export function assertPerformancePositiveLabel(
  performancePositiveLabel: string | undefined,
  frozen: { positiveLabel: string; negativeLabel: string } | undefined,
) {
  // The worker compares the stripped value (performance_positive_label).
  const label = performancePositiveLabel?.trim();
  if (
    !frozen ||
    !label ||
    label === frozen.positiveLabel ||
    label === frozen.negativeLabel
  )
    return;
  throw new ApiError(
    400,
    `The protocol measures binary performance on the class '${label}', which is not one of the system revision's output classes (${quoted([frozen.positiveLabel, frozen.negativeLabel])}); the worker would refuse the job. Use a protocol version whose performance positive class is one of them, or leave it empty to use the favourable label '${frozen.positiveLabel}'.`,
  );
}

/**
 * The worker's modelSpec limits for independent model inference
 * (validate_model_spec in engine/worker_contract.py).
 */
export function assertModelSpecLimits(input: {
  task: string;
  featureCount: number;
  outputLabels: string[];
}) {
  const { task, featureCount, outputLabels } = input;
  if (featureCount < 1 || featureCount > WORKER_LIMITS.maxFeatureColumns)
    throw new ApiError(
      400,
      `Independent model inference accepts 1 to ${WORKER_LIMITS.maxFeatureColumns} feature columns; this system revision declares ${featureCount}. Register a system revision within the worker's limit or evaluate supplied predictions.`,
    );
  if (task === "Regression" && outputLabels.length)
    throw new ApiError(
      400,
      "A regression model has no output classes. Register a system revision without ordered output classes for model inference.",
    );
  if (
    task === "Multiclass classification" &&
    (outputLabels.length < 2 ||
      outputLabels.length > WORKER_LIMITS.maxClassLabels)
  )
    throw new ApiError(
      400,
      `Model inference for a multiclass model needs 2 to ${WORKER_LIMITS.maxClassLabels} ordered output classes on the system revision; it declares ${outputLabels.length}.`,
    );
  if (
    task === "Binary classification" &&
    outputLabels.length !== WORKER_LIMITS.binaryOutputLabels
  )
    throw new ApiError(
      400,
      `Model inference for a binary model needs exactly two ordered output classes on the system revision; it declares ${outputLabels.length}.`,
    );
}

export type ClaimPins = {
  jobId: string;
  attemptId: string;
  fence: number;
  nonce: string;
  leaseUntil: string;
  requestSha256: string;
};

/** The body of a claim response (POST /api/runner, op "claim"). */
export function claimResponse(pins: ClaimPins, requestJSON: string) {
  return {
    jobId: pins.jobId,
    attemptId: pins.attemptId,
    fence: pins.fence,
    nonce: pins.nonce,
    leaseUntil: pins.leaseUntil,
    requestSha256: pins.requestSha256,
    requestJSON,
    request: JSON.parse(requestJSON) as unknown,
  };
}

/**
 * The UTF-8 size of the largest claim response that can carry this frozen
 * request. The response repeats the request twice, once as escaped exact
 * bytes, so a request of about 1 MiB already exceeds the worker's limit.
 * The placeholders are as long as the real pins: id("ATTEMPT"), a fence of
 * at most 5 (the route fails a job before a sixth claim), a UUID nonce and
 * an ISO timestamp.
 */
export function claimResponseBytes(
  jobId: string,
  requestSha256: string,
  requestJSON: string,
) {
  const body = claimResponse(
    {
      jobId,
      attemptId: "ATTEMPT-" + "0".repeat(12),
      fence: 5,
      nonce: "0".repeat(36),
      leaseUntil: "2026-01-01T00:00:00.000Z",
      requestSha256,
    },
    requestJSON,
  );
  return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}

/** Refuses (413) a frozen request whose claim response the worker cannot read. */
export function assertClaimFits(
  jobId: string,
  requestSha256: string,
  requestJSON: string,
) {
  const bytes = claimResponseBytes(jobId, requestSha256, requestJSON);
  if (bytes > WORKER_LIMITS.maxResponseBytes)
    throw new ApiError(
      413,
      `This execution request would reach the worker as ${(bytes / 1024 / 1024).toFixed(2)} MiB, over its 2 MiB limit for a claim. Reduce the system revision, dataset card or model metadata it pins, then queue again.`,
    );
}
