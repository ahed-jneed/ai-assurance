import type { FieldContext } from "./assessment-fields";
import { label, type Field } from "./types";

/**
 * The fields of the system, prediction, execution, runner, access and packet
 * forms.
 */
export function executionFields({
  lead,
  artifactOptions,
  models,
  profiles,
  procedures,
  options,
  members,
  workers,
  activeJobs,
}: FieldContext): Record<string, Field[]> {
  return {
    registerSystem: [
      { name: "name", label: "AI system name", required: true },
      { name: "version", label: "System revision", required: true },
      {
        name: "intendedUse",
        label: "Intended use and decision boundary",
        multiline: true,
        required: true,
      },
      {
        name: "population",
        label: "Population and period",
        multiline: true,
        required: true,
      },
      {
        name: "modelId",
        label: "Primary model version",
        options: models,
        required: true,
      },
      {
        name: "pipelineArtifactId",
        label: "Preprocessing / pipeline evidence",
        options: artifactOptions("Pipeline code"),
      },
      {
        name: "deploymentArtifactId",
        label: "Deployment manifest",
        options: artifactOptions(),
      },
      { name: "semantics", label: "Output meaning", required: true },
      {
        name: "classOrder",
        label: "Ordered output classes",
        help: "Comma-separated class labels in the adapter output order. Leave empty for regression.",
      },
      {
        name: "threshold",
        label: "Decision threshold on the favourable class",
        type: "number",
        help: "From 0 to 1. Model inference decides for the evaluation protocol's favourable (positive) label when that label's probability is at least this value, so give the threshold on that class's probability, not the other class's.",
      },
      {
        name: "humanDecision",
        label: "How people use, override and stop the system",
        multiline: true,
        required: true,
      },
      { name: "runtime", label: "Expected runtime / adapter", required: true },
      {
        name: "limitations",
        label: "Compatibility limitations",
        multiline: true,
      },
    ],

    registerPrediction: [
      {
        name: "systemId",
        label: "System revision",
        options: options("system"),
        required: true,
      },
      {
        name: "modelId",
        label: "Producing model",
        options: models,
        required: true,
      },
      {
        name: "datasetId",
        label: "Prediction evidence",
        options: artifactOptions("Dataset"),
        required: true,
      },
      {
        name: "sourceDatasetId",
        label: "Source population evidence",
        options: artifactOptions("Dataset"),
        required: true,
      },
      {
        name: "producedAt",
        label: "Prediction generation time (UTC)",
        type: "datetime-local",
        required: true,
      },
      {
        name: "producingRun",
        label: "Producing run / transaction identity",
        required: true,
      },
      {
        name: "inferenceConfiguration",
        label: "Pipeline, threshold and generation configuration",
        multiline: true,
        required: true,
      },
      {
        name: "mode",
        label: "Origin",
        options: ["provided_predictions", "auditor_model", "client_local"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
      {
        name: "limitations",
        label: "What is verified and what is still declared",
        multiline: true,
        required: true,
      },
    ],

    queueExternal: [
      {
        name: "systemId",
        label: "Pinned system revision",
        options: options("system"),
        required: true,
      },
      {
        name: "procedureId",
        label: "Approved procedure",
        options: procedures,
        required: true,
        help: "The model, dataset and protocol must match the approved procedure.",
      },
      {
        name: "modelId",
        label: "Model version",
        options: models,
        required: true,
      },
      {
        name: "datasetId",
        label: "Input dataset",
        options: artifactOptions("Dataset"),
        required: true,
      },
      {
        name: "profileId",
        label: "Evaluation protocol",
        options: profiles,
        required: true,
      },
      {
        name: "mode",
        label: "Execution mode",
        options: [
          { value: "provided_predictions", label: "Supplied predictions" },
          {
            value: "client_local",
            label: "Client-local prediction evaluation",
          },
          ...(lead
            ? [
                {
                  value: "auditor_model",
                  label: "Independent portable model inference",
                },
              ]
            : []),
        ],
        required: true,
        initial: "provided_predictions",
      },
      {
        name: "predictionId",
        label: "Prediction lineage (prediction modes)",
        options: options("prediction"),
      },
      {
        name: "securityReviewId",
        label: "Accepted adapter security review (model inference)",
        options: artifactOptions("Security"),
      },
      {
        name: "negativeLabel",
        label: "Other binary class label",
        help: "Leave empty to use the system revision's other output class. The pair must be exactly the system's two output classes, and a protocol with a statistics plan must declare the same other label. Leave it empty for multiclass and regression models.",
      },
      { name: "predictionOutput", label: "Named adapter output (ONNX / PMML)" },
      {
        name: "predictionKind",
        label: "Adapter output type",
        options: [
          { value: "label", label: "Class label" },
          { value: "probability", label: "Probability" },
        ],
        initial: "label",
      },
    ],

    enrollWorker: [
      { name: "name", label: "Runner name", required: true },
      {
        name: "imageDigest",
        label: "Approved container image digest",
        help: "sha256: followed by the 64-character digest in lowercase hexadecimal (0-9, a-f).",
        required: true,
      },
      {
        name: "securityReview",
        label: "Isolation, egress, resource limits and adapter validation",
        multiline: true,
        required: true,
      },
    ],

    setAccess: [
      {
        name: "userId",
        label: "Internal practice member",
        options: members,
        required: true,
      },
      {
        name: "active",
        label: "Engagement access",
        options: [
          { value: "true", label: "Grant access" },
          { value: "false", label: "Revoke access" },
        ],
        required: true,
      },
      { name: "reason", label: "Reason", multiline: true, required: true },
    ],

    importPacket: [
      {
        name: "artifactId",
        label: "Accepted external assurance JSON",
        options: artifactOptions().filter((x) =>
          x.label.toLowerCase().endsWith(".json"),
        ),
        required: true,
      },
      {
        name: "assessment",
        label: "Origin, scope and completeness assessment",
        multiline: true,
        required: true,
      },
    ],

    revokeWorker: [
      {
        name: "workerId",
        label: "Runner",
        options: workers,
        required: true,
      },
      {
        name: "reason",
        label: "Revocation rationale",
        multiline: true,
        required: true,
      },
    ],

    cancelJob: [
      {
        name: "jobId",
        label: "Execution",
        options: activeJobs,
        required: true,
      },
      {
        name: "reason",
        label: "Cancellation rationale",
        multiline: true,
        required: true,
      },
    ],
  };
}
