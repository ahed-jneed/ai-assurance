import { explainWorkerFailure } from "@/lib/worker-failures";

// The frozen fields of an external job that the job list explains, as
// selected by jobs() in lib/assurance-store.ts.
export type ExternalJobFields = {
  state: string;
  mode: string;
  model_format: string | null;
  positive_label: string | null;
  negative_label: string | null;
  decision_threshold: number | null;
  prediction_kind: string | null;
  error: string | null;
};

/**
 * The frozen binary label pair, the class the decision threshold applies
 * to, and for a failed job what the worker's failure code means.
 */
export function ExternalJobDetail({ job }: { job: ExternalJobFields }) {
  const failure =
    job.state === "failed" ? explainWorkerFailure(job.error) : null;
  // The worker applies the threshold to P(favourable label); a model that
  // outputs class labels decides by its own rule (engine/WORKER.md).
  const labelOutput =
    job.prediction_kind === "label" &&
    ["ONNX", "PMML"].includes(job.model_format ?? "");
  return (
    <>
      {job.negative_label !== null && (
        <small className="block subtle">
          Favourable class &lsquo;{job.positive_label}&rsquo; · other class
          &lsquo;{job.negative_label}&rsquo;
          {job.mode === "auditor_model" &&
            job.decision_threshold !== null &&
            (labelOutput
              ? " · model's own decision rule (class-label output; threshold not applied)"
              : ` · threshold ${job.decision_threshold} on P('${job.positive_label}')`)}
        </small>
      )}
      {failure ? (
        <p className="form-error" role="status">
          {failure.guidance}
          {failure.code && (
            <small className="block subtle">
              Worker failure code: <code>{failure.code}</code>
            </small>
          )}
        </p>
      ) : (
        job.error && <p className="form-error">{job.error}</p>
      )}
    </>
  );
}
