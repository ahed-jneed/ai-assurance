# Asynchronous computation integration specification

Version boundaries are explicit: frozen hosted `engineConfig` is 1.1, native Python report contract is 1.0, worker request/result envelopes are schema 1.0, and the authenticated platform compilation is run contract 1.2. Keep the exact request JSON and result bytes separate from that projection; the common schema accepts all three run records without modifying old evidence. Full metrics and procedure/system/protocol pins belong in the imported projection. Refer to `schemas/README.md` for computed synthetic fixtures and application binding checks.

This specifies the target production integration. The CLI and independent `/api/runner` pull client are operational locally; see [WORKER.md](WORKER.md) for the implemented leased-attempt protocol, hosted-to-engine translation and exact-byte HMAC completion. A deployed worker, managed queue/outbox dispatcher, managed asymmetric signing service and object-lock custody system remain deployment/architecture work. Keep computations out of request handlers and browsers.

## Submission and isolation

1. `POST /engagements/{engagementId}/runs` authorizes the actor against an engagement belonging to its current tenant, verifies model/dataset/artifact membership, checks approved audit-program version and frozen acceptance policy, then resolves exact object versions/hashes. Do not trust tenant, role, bucket, URI or policy claims supplied by the browser. Enforce no self-review where approval is required.
2. In a single database transaction, insert `DiagnosticRun(state=queued)`, immutable `RunConfiguration`, an idempotency key scoped to tenant, and an `OutboxEvent`. Identical requests reuse the same run; changes require a new run ID. The configuration snapshot retains task, feature order, positive class, sensitive grouping, suite versions, reference population, sample-count settings, threshold policy ID/version, seed and adapter image digest.
3. A dispatcher publishes the outbox event to a managed at-least-once queue. The signed envelope binds all IDs, expected hashes, exact input object versions, approved worker image digest, expiry, allowed resources, nonce, configuration hash and key ID. The signer uses a managed key, never a client-held secret. Workers verify signature/expiry and retrieve authoritative state before execution. There is no untrusted code in the envelope.
4. A worker claims a compare-and-set lease `queued -> validating -> running` and uses a fenced lease token. It rechecks tenant/object association and hashes, downloads only permitted versioned objects to a dedicated job directory, scans/quarantines artifacts, and invokes the pinned runner in a non-root sandbox. No inbound network, no general outbound network, read-only container image, scoped short-lived artifact credentials, CPU/memory/file/time quotas, no mounted host sockets, no pickle/joblib, and no user plugins. Paths derive from job-owned IDs, not arbitrary envelope filesystem paths.
5. On completion, upload generated result JSON, sanitized diagnostic plots where implemented and draft papers under a new versioned job prefix. Create a manifest of content hashes and lineage. Ask the signing service to sign it and persist content using object-lock retention. Transactionally publish artifact records and `succeeded` after the manifest is verified. A stale/fenced worker cannot publish. Results remain visible as diagnostic evidence regardless of test acceptance outcome.
6. Reviewer decisions update separate versioned working-paper records and append-only audit events. Approvals never modify prior run output. The final audit report references accepted paper versions, reviewer sign-offs, legal-framework snapshot, scope and qualification/limitations; sign and lock its manifest. Reruns and report reissues create new IDs linked by `supersedes`, preserving originals.

## Example signed payload (signature carried separately)

```json
{
  "schemaVersion": "1.0",
  "eventType": "diagnostic.run.requested",
  "tenantId": "tenant-001",
  "runId": "run-001",
  "engagementId": "engagement-001",
  "modelId": "model-001",
  "datasetId": "dataset-001",
  "configurationSha256": "64-character-sha256",
  "inputs": [{"artifactId": "artifact-001", "objectVersionId": "version-001", "sha256": "64-character-sha256", "purpose": "data"}],
  "workerImageDigest": "sha256:approved-image-digest",
  "resourceProfile": "csv-diagnostics-v1",
  "issuedAt": "2026-10-05T10:00:00Z",
  "expiresAt": "2026-10-05T10:15:00Z",
  "nonce": "unique-cryptographic-nonce",
  "keyId": "managed-signing-key-version"
}
```

Use an established signature envelope such as a detached JWS over canonical payload bytes with allowed algorithms and managed asymmetric keys. Reject unknown algorithms/key IDs; rotate keys with verification history and replay protection. Artifact download authorization still verifies database ownership independently of a valid signature. Sensitive attributes or data rows never enter the queue payload, logs, SSE stream or telemetry.

## State machine and reliability

`queued -> validating -> running -> succeeded | failed | cancelled`. Cancellation may enter `cancel_requested`; publishing is blocked after an authoritative cancellation. `outcome` is populated only with completed evaluation evidence and is `pass | fail | inconclusive | not_applicable`; never treat execution failure as an acceptance failure, or missing evidence as pass.

Use lease expiry plus a monotonic fence token and bounded retry attempts. Retry infrastructure interruptions (queue/network/temporary storage failures); do not retry schema/label/non-finite/policy validation errors or rejected model formats. Retried attempts preserve the same frozen request, record distinct attempt IDs and worker image digests, and cannot emit duplicate working papers: unique key `(tenant_id, run_id, test_id, report_manifest_hash)`. Final compare-and-set binds the active fence token and run state. A dead-letter event retains a sanitized error code, attempt history, actionable remediation and correlation ID; never raw data or secrets.

`GET /runs/{id}` and SSE return tenant-authorized progress, timestamps, counts, sanitized error codes and immutable result URLs. An API request must never wait for ML computation. Cancellation is cooperative with hard timeout termination. Artifact credentials expire; job work directories are wiped under validated scoped paths. Audit trail records submission, policy approval, lease attempts, cancellations, signed manifest storage, reviewer actions, report issuance and download/export events.

## Reviewed adapter rollout

`adapters.py` declares prediction and explanation protocols. Ship trusted application-owned adapter code in pinned worker images; never install dependencies from user artifacts. ONNX/PMML reduce Python code execution risk but still require graph/operator allowlists, tensor/shape limits, resource isolation and vetted runtimes. For submitted scikit-learn/XGBoost/LightGBM artifacts, prefer a reviewed portable export or an isolated client-controlled inference endpoint over deserializing Python objects. Pin and record adapter/runtime/library versions and native binaries.

SHAP/LIME/permutation controls require a verified feature schema, training/background dataset hash, approved sampling strategy, categorical handling, missing-data treatment, seed, explainer version and explanation stability checks. Cross-validation requires fold assignments, leak-proof grouping/time rules, complete preprocessing inside folds, fixed hyperparameters and train/test separation. Robustness requires a domain-approved perturbation/threat model, valid-value constraints, protected-attribute treatment and primary acceptance endpoint. Every plugin emits the common metric/result contract with unavailable/undefined conditions rather than a default success.

## Production acceptance checks

Exercise cross-tenant access denials for run/artifact/paper/report APIs; submission replay and idempotency; changed-config hashes; expired/altered signatures; stale leases; duplicate deliveries; cancellation during upload; interrupted worker recovery; tampered artifact bytes; retention/legal-hold behavior; backup restoration; tenant export/deletion governed by lawful retention; role separation for approval; and incident/change-control linkage. Capture verified evidence before claiming production readiness.
