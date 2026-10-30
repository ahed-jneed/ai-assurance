# External pull worker

`python -m engine.worker` is an operational client for the platform's `/api/runner` protocol. It claims a leased attempt, downloads pinned inputs, runs the existing diagnostics in a separate process, and submits a signed completion containing the **exact UTF-8 result file**. It adds no web routes or hosted Python runtime. Deployment and enrollment of the independent worker remain operator actions.

The implemented default path evaluates provided CSV predictions for binary classification, multiclass classification, regression and selected binary fairness tests. Optional ONNX, native XGBoost JSON, native LightGBM text and PMML inference require installed runtimes, reviewed native fixtures, a digest-pinned Docker executor and a **local artifact SHA-256 allowlist**. A job cannot approve its own artifact. Pickle, joblib, model-provided Python, arbitrary commands, remote model URLs and job-requested package installation are prohibited.

## Start and configuration

Provision these values using your secret manager or service environment; do not commit token values or place them in command arguments:

| Environment variable | Purpose |
| --- | --- |
| `ASSURANCE_SITE_ORIGIN` | HTTPS origin only, e.g. `https://your-assurance-site.example` |
| `ASSURANCE_WORKER_TOKEN` | Application worker credential enrolled by the platform |
| `ASSURANCE_SITE_SERVICE_TOKEN` | Optional separate Sites service-access credential for a restricted Site |
| `ASSURANCE_WORKER_ID` | Enrolled worker identifier |
| `ASSURANCE_WORKER_IMAGE_DIGEST` | Enrolled compute identity, `sha256:<64 lowercase hex>` |
| `ASSURANCE_COMPUTE_IMAGE` | For Docker: locally available `repository@sha256:<digest>` |
| `ASSURANCE_APPROVED_MODEL_HASHES` | Comma-separated hashes approved locally by the worker operator |

From the repository root:

```powershell
python -m engine.worker --readiness
python -m engine.worker --workspace D:\AssuranceWorker\jobs --once
python -m engine.worker --workspace D:\AssuranceWorker\jobs
```

`--once` exits after one attempt or an idle response. Long-running mode polls every five seconds by default. `--heartbeat-seconds` defaults to ten; `--compute-timeout` to 300 (maximum 600); `--maximum-jobs` to 100. Use a dedicated workspace owned by the service account, an encrypted filesystem with a disk quota, and retention/archival procedures. The worker stops acquiring leases when its retained-job count reaches the configured limit. It preserves inputs, request bytes, exact results and completion bodies for reconciliation; it never silently deletes evidence. Local create-once files do not provide object-lock retention or independent custody attestation.

Application authorization uses `Authorization: Bearer <application token>`. The optional platform credential uses `OAI-Sites-Authorization: Bearer <platform service token>`. They have separate purposes. Credentials are read from the environment; neither is copied into the compute environment, job files or result envelope. Redirects are rejected. HTTPS certificate verification is provided by Python's default TLS context. Loopback HTTP is available only through the test constructor, not the public CLI.

## Exact wire contract

`POST /api/runner` accepts claim, heartbeat, complete and fail operations. A claim sends:

```json
{"op":"claim","workerId":"worker-001","imageDigest":"sha256:...","formats":["provided_predictions"]}
```

CLI/runtime model formats are normalized `onnx`, `xgboost_json`, `lightgbm_text`, `pmml`. Their corresponding enrollment/claim wire names are `ONNX`, `XGBoost`, `LightGBM`, `PMML`. They appear only when explicitly selected with `--formats`, the selected executor provides no-network model isolation, the runtime probe succeeds, and the local model-hash allowlist is nonempty. Package imports establish availability, not successful native inference or artifact safety. Validate golden native fixtures before approving enrollment. `--readiness` reports absent distributions and Java separately.

A claim response contains `{jobId,attemptId,fence,nonce,leaseUntil,requestSha256,request,requestJSON}`. `requestJSON` is the **exact original server JSON string**; its UTF-8 hash must equal `requestSha256`, and its parsed contents must equal `request`. This avoids JavaScript/Python serialization disagreements. The request contains:

```json
{
  "schemaVersion":"1.0",
  "executionMode":"provided_predictions",
  "model":{"id":"model-001","format":"Prediction file","task":"Binary classification"},
  "dataset":{"id":"data-001","name":"predictions.csv","sha256":"64-character-hash","size":100},
  "profile":null,
  "engineConfig":{
    "contractVersion":"1.1","id":"run-001","engagementId":"eng-001",
    "modelId":"model-001","datasetId":"data-001","task":"Binary classification",
    "suite":["performance","demographic_parity"],"seed":42,
    "policyId":"protocol-001","policyVersion":"1",
    "config":{
      "labelColumn":"actual","predictionColumn":"predicted","groupColumn":"group",
      "positiveLabel":"1","minimumSampleSize":20,"minimumClassCount":5,
      "minimumGroupSize":30,"minimumAccuracy":0.8,"minimumRecall":0.7,
      "maximumParityGap":0.1
    }
  },
  "seed":42,"inputHashes":{"dataset":"64-character-hash"}
}
```

Input retrieval is `GET /api/runner?jobId=...&attemptId=...&fence=...&input=dataset|model` with the same authorization headers. The worker verifies the actual dataset byte count and SHA-256 before computation and again in the compute process. Native model bytes must match `inputHashes.modelArtifact`, the model's `sha256` or `sourceSha256`, and the local approval allowlist. An optional declared model byte count is checked. Dataset names and request identifiers never become input filesystem paths: filenames are application-owned `dataset.csv` and `model.<approved suffix>`.

Heartbeat posts `{op:"heartbeat",jobId,attemptId,fence,nonce,requestSha256}`; its response must contain a future `leaseUntil`. A nonretryable heartbeat rejection or expired lease stops computation. The server must independently reject stale fences, nonces, cancelled jobs and expired leases at publication. A fail operation uses the same pins and a sanitized string `error`; rows, token values and raw native errors are not sent.

Completion posts `{op:"complete",jobId,attemptId,fence,nonce,requestSha256,resultJSON,resultSha256}`. `resultJSON` is read verbatim from the created-once `outputs/result.json`; `resultSha256` hashes that string's exact UTF-8 bytes, including the trailing newline. Evidence is limited to 8 MiB and the escaped full completion body to 10 MiB. `X-Result-Signature` is lowercase hex HMAC-SHA256 over the **entire exact HTTP body bytes**, with key `SHA256(raw application token UTF-8)` bytes. The worker signs all POST bodies consistently; completion is the required verification point. The embedded engine report's `reportSha256` remains its existing canonical checksum and differs from the completion hash.

Read-only downloads and idempotent heartbeat/complete/fail operations have at most two retries for temporary transport failures or HTTP 429/502/503/504, using the same serialized POST bytes. Claim has no automatic transport retry because an ambiguous request may already have acquired a lease. The server must make duplicate completion of the same accepted pins and digest idempotent. An ambiguous exhausted completion retains the evidence and returns `completion_uncertain`; the worker does not overwrite a possibly committed completion with fail. Reconciliation remains an operator/server responsibility.

## Hosted and external report translation

The server freezes hosted `engineConfig.contractVersion:"1.1"`, human-readable task, selected individual test IDs, flat column/threshold configuration, policy identity and seed. The worker translates that snapshot into external engine `contractVersion:"1.0"`, machine task IDs, suite families, typed column roles and named metric thresholds. The source snapshot and translation version are retained in the engine configuration hash.

The completion envelope is:

```text
{schemaVersion:"1.0", externalReport:<unchanged valid engine v1.0 report>,
 hostedResults:[{testId,label,article,outcome,metrics,limitations}],
 provenance:{requestSha256,inputHashes,imageDigest,workerVersion,translationVersion,
 executionMode,execution,externalReportSha256,preprocessingScope}}
```

`externalReport` includes every engine metric, limitation and generated draft working paper. Its conservative aggregate conclusion remains unchanged when supplemental metrics have no acceptance threshold. `hostedResults` contains **only the requested individual tests** and separately evaluates their frozen acceptance criteria. Binary performance uses accuracy and recall, multiclass uses accuracy and macro F1, regression uses RMSE, and DP/DI/EO use their respective named group criteria. Other metrics are explicitly marked `supplemental_descriptive`. Null or unsupported criteria and insufficient sample/class/group support remain inconclusive. Inclusive comparisons use the hosted numerical tolerance of `1e-12 × max(1, |value|, |criterion|)`; values are never rounded before evaluation.

The engine currently requires a minimum class count of at least two. If the hosted profile explicitly uses one, the full report retains the conservative engine minimum; the hosted projection applies its frozen minimum of one using the same observed counts and names this difference in its limitations. No original report is rewritten. Undefined constant-target R² remains visible and does not replace the separately approved RMSE criterion. The worker rejects missing mapped input cells instead of silently excluding them on the hosted translation path.

`provided_predictions` and `client_local` evaluate the pinned prediction dataset, including when it is associated with separately registered native model metadata. Neither mode downloads or loads a model artifact. `auditor_model` requires actual native inference; it cannot run a prediction file and claim independent scoring. `client_local` identifies client-origin provided-prediction evidence. A signed client-origin result does not establish independent auditor reproduction or ground-truth validity. Controller and execution kind remain separate from metadata declarations.

## Native inference and container execution

The supported frozen `engineConfig.modelSpec` is:

```json
{"task":"binary_classification","featureColumns":["age","income"],"outputLabels":["0","1"],"decisionThreshold":0.5}
```

`featureColumns` is an ordered list of 1–100 complete numeric prepared columns. Classification requires explicit ordered `outputLabels` (exactly two for binary); regression uses an empty list. ONNX additionally requires `predictionOutput`, accepts `predictionKind:"label"|"probability"`, `labelEncoding:"label"|"class_index"`, and optional `probabilityOutput`. PMML requires `predictionOutput`. Native tree objective/task compatibility is checked by the existing adapter. There is no raw text or arbitrary categorical/preprocessing pipeline execution.

Build the core image from the engine directory, replacing the base image with a reviewed immutable digest for production:

```bash
docker build --build-arg PYTHON_IMAGE=python@sha256:<reviewed-base-digest> -t assurance-compute:reviewed engine
```

The delivered Dockerfile has no package installation. Its default Python tag is a development convenience, not a production pin. Optional runtimes must be included in an operator-owned derived image from a reviewed hash-locked dependency set; do not install from claimed job content. The optional requirement pins are only an initial baseline. The resulting image digest, full transitive/native dependency lock and native golden-fixture results must be enrolled together.

Use a host service with a rootless Docker CLI or equivalent controlled container launcher. Do not give an inference container the Docker socket. The supplied worker's Docker executor launches only a **locally present digest-pinned image** with `--pull=never`, network none, read-only image, all capabilities dropped, no new privileges, a nonroot user, default 1 CPU/1 GiB memory with no extra swap, 64 PIDs, file-descriptor/file-size bounds and a 64 MiB temporary filesystem. Inputs mount read-only; the separate output mount contains created evidence. It terminates the generated job container on timeout or lost lease, including native child processes. Host egress belongs to the transport service; inference containers receive neither credentials nor network.

```bash
python -m engine.worker --executor docker --compute-image registry.example/assurance@sha256:<enrolled-digest> \
  --image-digest sha256:<same-enrolled-digest> --formats onnx --workspace /var/lib/assurance/jobs
```

Process mode is useful for the dependency-free provided-prediction path and tests. It strips service secrets, sets thread limits, invokes a fixed application module with Python isolation, and enforces available POSIX CPU/file/descriptor limits and an outer wall-clock timeout. **It is not an OS memory/network sandbox**, and it does not permit native model formats. A declared image digest in this mode is operator-provided provenance, not measured remote attestation. Container execution, runtime readiness and model-hash approval reduce scope; they do not prove parser/model safety, input representativeness or complete custody.

## Verification and current limits

The common schema keeps engine reports at contract 1.0 and adds the platform's external import projection as contract 1.2. The original result envelope remains schema 1.0 and is retained byte for byte. The imported run is a separate record with procedure bindings, frozen declarations and the exact request/result digest pins; it must preserve rich metric counts, confidence intervals and slices. The external manifest's `rowCount` is the largest metric sample size, not independently established source completeness.

Transport input reads use bounded `read1` chunks, check the active lease before and after each chunk, and enforce one elapsed deadline across an operation and its retries. An in-flight socket read is bounded by its configured timeout; checks resume when that read returns. Slow response trickles cannot extend the chunk-read budget indefinitely. The configured workspace and existing ancestors are checked for symlinks before resolving the path; operators must still prevent filesystem races through dedicated service-account ownership and permissions.

`python -m unittest discover -s engine/tests -v` exercises actual local HTTP claim/download/subprocess/completion, exact-body HMAC, input/projection tampering, missing cells, task compatibility, absent class/constant target conditions, retry bounds, credential redirect rejection, heartbeat renewal/rejected fencing, ambiguous completion and workspace capacity. Golden binary/fairness/multiclass/regression expectations are checked against real engine computations. HTTP fixtures use dummy credentials and loopback only.

The bundled environment contains numpy/pandas but lacks ONNX Runtime, XGBoost, LightGBM, pypmml and pyarrow; no native inference image or Docker execution was validated here. Optional tests do not claim native golden validation. The pull protocol currently provides no reference-dataset endpoint: selected numeric drift preserves an explicit missing-baseline inconclusive result. Permutation and approved-range perturbation use the existing genuine model-backed algorithms only after eligible native inference is available. SHAP/LIME, training/cross-validation, adversarial robustness, raw-text NLP and executable preprocessing remain unavailable. A preprocessing hash can be retained as a source declaration; this worker does not verify or execute that transformation. Add a pinned prepared-dataset/source-transformation custody record before making stronger lineage claims.

HMAC proves possession of the enrolled application credential and binds exact request/result bytes. It does not establish metric correctness, complete source records, a measured worker image, model artifact safety or external auditor independence. Preserve human working-paper review, evidence acceptance, finding decisions and report release controls in the platform. Production rollout still requires actual server integration tests, lease crash/recovery and cancellation tests, native golden fixtures, secure service enrollment/rotation, filesystem quotas, container-runtime verification and retained evidence verification.
