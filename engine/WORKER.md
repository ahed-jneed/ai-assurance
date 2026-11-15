# External pull worker

`python -m engine.worker` is an operational client for the platform's `/api/runner` protocol. It claims a leased attempt, downloads pinned inputs, runs the existing diagnostics in a separate process, and submits a signed completion containing the **exact UTF-8 result file**. It adds no web routes or hosted Python runtime. Deployment and enrollment of the independent worker remain operator actions.

The implemented default path evaluates provided CSV predictions for binary classification, multiclass classification, regression and selected binary fairness tests. Optional ONNX, native XGBoost JSON, native LightGBM text and PMML inference require installed runtimes, reviewed native fixtures, a digest-pinned Docker executor and a **local artifact SHA-256 allowlist**. A job cannot approve its own artifact. Pickle, joblib, model-provided Python, arbitrary commands, remote model URLs and job-requested package installation are prohibited.

## Start and configuration

Provision these values using your secret manager or service environment; do not commit token values or place them in command arguments:

| Environment variable | Purpose |
| --- | --- |
| `ASSURANCE_SITE_ORIGIN` | HTTPS origin only, e.g. `https://your-assurance-site.example` |
| `ASSURANCE_WORKER_TOKEN` | Application worker credential enrolled by the platform |
| `ASSURANCE_WORKER_ID` | Enrolled worker identifier |
| `ASSURANCE_WORKER_IMAGE_DIGEST` | Enrolled compute identity, `sha256:<64 lowercase hex>` |
| `ASSURANCE_COMPUTE_IMAGE` | For Docker: locally available `repository@sha256:<digest>` |
| `ASSURANCE_APPROVED_MODEL_HASHES` | Comma-separated hashes approved locally by the worker operator |
| `ASSURANCE_CLIENT_DATA_DIR` | The client's own worker only: the directory of client-held datasets for [client-local jobs](#client-held-datasets) (or `--client-data-dir`) |

From the repository root:

```powershell
python -m engine.worker --readiness
python -m engine.worker --workspace D:\AssuranceWorker\jobs --once
python -m engine.worker --workspace D:\AssuranceWorker\jobs
```

A client's own worker adds `--client-data-dir D:\ClientData\assurance` (see [Client-held datasets](#client-held-datasets)).

`--once` exits after one attempt or an idle response. Long-running mode polls every five seconds by default. `--heartbeat-seconds` defaults to ten; `--compute-timeout` to 300 (maximum 600); `--maximum-jobs` to 100; `--transport-timeout`, the per-read idle timeout described under [Verification and current limits](#verification-and-current-limits), to 15 (maximum 120). Use a dedicated workspace owned by the service account, an encrypted filesystem with a disk quota, and retention/archival procedures. The worker stops acquiring leases when its retained-job count reaches the configured limit. It preserves inputs, request bytes, exact results and completion bodies for reconciliation; it never silently deletes evidence. Local create-once files do not provide object-lock retention or independent custody attestation.

Application authorization uses `Authorization: Bearer <application token>`. Behind Cloudflare Access, `/api/runner` needs a Bypass policy (see `docs/security/identity.md`), because runners carry no Access session. The credential is read from the environment; it is never copied into the compute environment, job files or result envelope. Redirects are rejected. HTTPS certificate verification is provided by Python's default TLS context. Loopback HTTP is available only through the test constructor, not the public CLI.

## Exact wire contract

`POST /api/runner` accepts claim, heartbeat, complete and fail operations. A claim sends:

```json
{"op":"claim","workerId":"worker-001","imageDigest":"sha256:...","formats":["provided_predictions"]}
```

A worker started with a client data directory adds `"client_local"` to `formats`; the platform serves a job whose dataset stays with the client only to a worker that claims, and was enrolled for, that capability.

CLI/runtime model formats are normalized `onnx`, `xgboost_json`, `lightgbm_text`, `pmml`. Their corresponding enrollment/claim wire names are `ONNX`, `XGBoost`, `LightGBM`, `PMML`. They appear only when explicitly selected with `--formats`, the selected executor provides no-network model isolation, the runtime probe succeeds, and the local model-hash allowlist is nonempty. Package imports establish availability, not successful native inference or artifact safety. Validate golden native fixtures before approving enrollment. `--readiness` reports absent distributions and Java separately.

A claim response is `{"idle":true}` when there is nothing to run, otherwise `{jobId,attemptId,fence,nonce,leaseUntil,requestSha256,request,requestJSON}`. `requestJSON` is the **exact original server JSON string**; its UTF-8 hash must equal `requestSha256`, and its parsed contents must equal `request`. This avoids JavaScript/Python serialization disagreements.

The platform refuses to queue the jobs it can tell this worker would refuse (`site-app/lib/external-worker-contract.ts`, which a test keeps in step with this contract's limits): a binary system without exactly two output classes, a frozen `negativeLabel` that is not the system's other class (when the auditor gives none, the platform derives it), more than 100 features or a wrong number of output classes for model inference, and a frozen request whose claim response would exceed the 2 MiB envelope limit. The worker still checks every claim, for older jobs and other platforms. If a claim's pins (`jobId`, `attemptId`, `fence`, `nonce`, `requestSha256`) are valid but the rest of the claim is not, the worker fails that attempt before downloading anything and continues with the next poll. The code is `request_contract_rejected` unless a more specific one applies: `lease_expired_on_receipt` when the lease has already ended, or `label_set_mismatch` (`protocol_config_invalid` for an unusable label) when a binary `auditor_model` request's `modelSpec.outputLabels` are not exactly the frozen `positiveLabel` and `negativeLabel`. A claim without valid pins cannot be failed; the worker logs it as `claim_rejected` and the server-side lease expires. The request contains:

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
    "policyId":"protocol-001","policyVersion":"1","negativeLabel":"0",
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

Input retrieval is `GET /api/runner?jobId=...&attemptId=...&fence=...&input=dataset|model` with the same authorization headers. A client-held dataset (`dataset.custody:"client"`) is never retrieved: the platform holds no bytes for it and refuses the request with 403. The worker verifies the actual dataset byte count and SHA-256 before computation and again in the compute process. Native model bytes must match `inputHashes.modelArtifact`, the model's `sha256` or `sourceSha256`, and the local approval allowlist. An optional declared model byte count is checked. Dataset names and request identifiers never become input filesystem paths: filenames are application-owned `dataset.csv` and `model.<approved suffix>`.

Heartbeat posts `{op:"heartbeat",jobId,attemptId,fence,nonce,requestSha256}`; its response must contain a `leaseUntil` that has not yet passed. A nonretryable heartbeat rejection or expired lease stops computation. The server must independently reject stale fences, nonces, cancelled jobs and expired leases at publication. A fail operation uses the same pins and `error` set to one code from [Failure codes](#failure-codes); rows, column names, token values, file paths and raw native errors are never sent.

`leaseUntil` is a time on the server's clock, so the worker never compares it with its own wall clock. It takes the time left from the response's `Date` header (`leaseUntil` minus `Date`, less one second for the header's whole-second resolution) and counts it down on the monotonic clock from when it sent the request. A host clock that runs fast therefore cannot fail a valid lease, and one that runs slow cannot extend an ended one. Only a response without a usable `Date` header leaves the worker to judge the lease by its own clock.

Completion posts `{op:"complete",jobId,attemptId,fence,nonce,requestSha256,resultJSON,resultSha256}`. `resultJSON` is read verbatim from the created-once `outputs/result.json`; `resultSha256` hashes that string's exact UTF-8 bytes, including the trailing newline. Evidence is limited to 8 MiB and the escaped full completion body to 10 MiB. `X-Result-Signature` is lowercase hex HMAC-SHA256 over the **entire exact HTTP body bytes**, with key `SHA256(raw application token UTF-8)` bytes. The worker signs all POST bodies consistently; completion is the required verification point. The embedded engine report's `reportSha256` remains its existing canonical checksum and differs from the completion hash.

Read-only downloads and idempotent heartbeat/complete/fail operations have at most two retries for temporary transport failures or HTTP 429/502/503/504, using the same serialized POST bytes. Claim has no automatic transport retry because an ambiguous request may already have acquired a lease. The server must make duplicate completion of the same accepted pins and digest idempotent. An ambiguous exhausted completion retains the evidence and returns `completion_uncertain`; the worker does not overwrite a possibly committed completion with fail. Reconciliation remains an operator/server responsibility.

## Failure codes

Every per-job failure is posted as `{op:"fail", ...pins, error:<code>}` and the worker then moves on to the next poll. The code is the only failure information that reaches the platform. `engine/worker_contract.py` holds the same list (`FAILURE_CODES`), and a test keeps the two identical.

| Code | Stage | Meaning |
| --- | --- | --- |
| `request_contract_rejected` | Claim or compute | The frozen request breaks the worker contract, for example a binary `modelSpec` without exactly two `outputLabels`, more than 100 features, or an unsupported test or model format. Fix the protocol or system definition and queue a new job. |
| `lease_expired_on_receipt` | Claim | By the claim response's `Date` header, the lease had already ended when the claim arrived. The platform grants two minutes, so the response took longer than that to arrive, or a proxy in front of the platform stamps `Date` from a clock that disagrees with the platform's. Only a response without a `Date` header is judged by the worker host's clock; then this usually means that clock runs ahead (synchronize it with NTP). |
| `model_not_locally_approved_or_runtime_unavailable` | Local eligibility | The model format is not enabled on this worker, its SHA-256 is not in the local allowlist, or the executor has no network-isolated model runtime. |
| `executable_preprocessing_unsupported` | Local eligibility | The request declares preprocessing that this worker would have to execute. Supply already prepared columns. |
| `workspace_job_limit` | Local eligibility | The retained job directories reached `--maximum-jobs` while the attempt was being prepared. Archive evidence. |
| `workspace_unavailable` | Local files | A job file could not be created or written (permissions, disk space). |
| `client_dataset_unavailable` | Client-local input | The job's dataset stays with the client, but this worker has no client data directory, the directory cannot be read, or it holds no regular file of the pinned size. Place the client's file there, unchanged, and queue a new job. |
| `transport_unavailable` | Input transfer | The connection failed or reset during download, after the allowed retries. |
| `transport_idle_timeout` | Input transfer | No byte arrived within `--transport-timeout` seconds, after the allowed retries. |
| `response_deadline_exceeded` | Input transfer | A download used up its size-scaled time budget, after the allowed retries. |
| `response_truncated` | Input transfer | The connection closed before the declared `Content-Length` arrived, after the allowed retries. |
| `response_size_rejected` | Input transfer | The platform sent, or declared, more bytes than the pinned size or limit. |
| `http_<status>` | Input transfer or completion | The platform answered a download or a completion with this HTTP status, for example `http_404`. |
| `dataset_input_pin_mismatch` | Input transfer, client-local input or compute | The dataset's size or SHA-256 differs from the frozen pin. For a client-held dataset: files of the pinned size are in the client data directory, but none has the pinned SHA-256 (the file changed after it was pinned). |
| `model_input_pin_mismatch` | Input transfer or compute | The model's SHA-256 differs from the frozen pin. |
| `model_input_size_mismatch` | Input transfer | The model's byte count differs from the declared size. |
| `dataset_malformed` | Compute | The dataset is not well-formed UTF-8 CSV: empty or duplicate headers, ragged rows, or no observations. |
| `dataset_limit_exceeded` | Compute | The dataset exceeds the byte, row, column or batch limits. |
| `missing_column` | Compute | A mapped column (label, prediction, group, score) or a model feature column is absent. |
| `missing_value` | Compute | A mapped cell or model feature is empty; the worker never silently drops rows on this path. In a client-local run an empty group cell is not a failure: the row is left out and counted as withheld for a missing group value (D-33, see below). |
| `invalid_numeric_value` | Compute | A numeric cell is not a finite number, a score lies outside [0, 1], or a metric overflowed. |
| `label_set_mismatch` | Claim or compute | Observed labels, the frozen positive and negative labels, and the model's `outputLabels` do not agree. A binary model whose `outputLabels` are not the frozen pair fails at claim, before any download; the operator log names both sets. |
| `cardinality_limit_exceeded` | Compute | More than 1,000 protected groups or 100 classes. |
| `protocol_config_invalid` | Claim or compute | The frozen column mapping, acceptance criteria, minimum counts, or binary `positiveLabel`/`negativeLabel` cannot be applied. |
| `model_artifact_invalid` | Compute | The model bytes are not a valid artifact of the declared format, or the runtime could not load them. |
| `model_runtime_unavailable` | Compute | The compute image lacks the runtime for the declared format. |
| `model_objective_mismatch` | Compute | The native objective is outside the reviewed protocol or differs from the declared task. |
| `model_interface_mismatch` | Compute | The model's inputs or named outputs do not match the frozen `modelSpec`. |
| `model_output_invalid` | Compute | The model returned non-finite values, the wrong shape, labels outside `outputLabels`, or probabilities that do not sum to one. |
| `model_inference_failed` | Compute | The native runtime raised an error while scoring. |
| `evidence_too_large` | Compute | The completed evidence envelope exceeds 8 MiB. |
| `compute_timeout` | Compute | Computation, or native scoring, exceeded its time limit. |
| `compute_resource_exhausted` | Compute | The compute process ran out of memory, including while a native runtime loaded or scored the model. |
| `compute_internal_error` | Compute | An unexpected engine error; the operator log has its type. Report it as a worker defect. |
| `evidence_input_pin_mismatch` | GenAI input transfer | A downloaded evidence input's size or SHA-256 differs from its frozen pin. Treat it as an integrity exception. |
| `input_too_large` | GenAI compute | An evidence input exceeds 50 MiB. |
| `bundle_too_large` | GenAI compute | The bundle has more than 64 inputs or more than 200 MiB in all. |
| `line_too_long` | GenAI compute | A JSON Lines input has a line over 16 MiB. |
| `too_many_items` | GenAI compute | The bundle yields more than 50,000 items. |
| `too_many_scores` | GenAI compute | One item carries more than 50 scores. |
| `nesting_too_deep` | GenAI compute | A JSON value nests deeper than 64 levels. |
| `invalid_utf8` | GenAI compute | An input is not UTF-8 without a byte-order mark. |
| `invalid_json` | GenAI compute | An input is not valid JSON, or its structure is not the declared format's. |
| `duplicate_key` | GenAI compute | A JSON object repeats a key. |
| `number_out_of_range` | GenAI compute | A JSON number overflows (for example `1e999`). |
| `unknown_format` | GenAI compute | An input matches no supported format. |
| `format_mismatch` | GenAI compute | An input's content is not the format or role the manifest declares. |
| `unsupported_format` | GenAI compute | The declared format is not supported. |
| `unsupported_format_version` | GenAI compute | The tool or format version is outside the verified versions and the plan does not allow unverified versions. |
| `zip_invalid` | GenAI compute | A `.eval` archive is malformed, repeats an entry name or disagrees with its central directory. |
| `zip_entry_unsafe_name` | GenAI compute | A `.eval` archive has an entry name with `..`, an absolute path, a backslash or a NUL. |
| `zip_entry_too_large` | GenAI compute | A `.eval` entry or the whole archive exceeds the decompression limits. |
| `zip_entry_size_mismatch` | GenAI compute | A `.eval` entry decompresses to another size than its central directory declares. |
| `zip_ratio_exceeded` | GenAI compute | A `.eval` entry over 1 MiB has a compression ratio above 500:1 (a zip bomb). |
| `zip_method_unsupported` | GenAI compute | A `.eval` entry uses an unsupported compression method. |
| `zip_encrypted` | GenAI compute | A `.eval` entry is encrypted. |
| `zip_crc_mismatch` | GenAI compute | A `.eval` entry's CRC-32 does not match. |
| `zstd_unavailable` | GenAI compute | The compute runtime has no zstd back-end to read a `.eval` log. A worker without one does not claim GenAI jobs. |
| `missing_required_entry` | GenAI compute | A `.eval` archive lacks an entry the format requires. |
| `lm_eval_bundle_mismatch` | GenAI compute | lm-evaluation-harness results and samples files do not pair up. |
| `duplicate_item_key` | GenAI compute | Two items or two runs share a key. |
| `manifest_invalid` | Claim or GenAI compute | The frozen bundle manifest breaks its schema. |
| `plan_invalid` | Claim or GenAI compute | The frozen GenAI plan breaks its schema or lowers a floor. |
| `input_hash_mismatch` | GenAI compute | An input's bytes differ from the manifest's SHA-256 or byte count, or an input is not declared. |
| `signature_invalid` | GenAI compute | A signed detection result's signature by a key the plan pins does not verify: the result was altered or forged. |
| `signature_untrusted` | GenAI compute | No key the plan pins for the result's detection solution signed it. |
| `detection_content_mismatch` | GenAI compute | A signed detection result is for other content than the sampled output it is listed for. |
| `signature_backend_unavailable` | GenAI compute | The compute runtime lacks the `cryptography` package to verify signed detection results. |
| `compute_unavailable` | Compute supervision | The compute process or container could not be started. |
| `compute_rejected` | Compute supervision | The compute process failed without a valid `error.json` (for example it was killed, or the image predates this protocol). |
| `result_verification_failed` | Result | The produced result failed the control plane's independent verification and was not submitted. |
| `worker_internal_error` | Any | An unexpected control-plane error. Report it as a worker defect. |

Local states that are never posted: `lease_lost` (a stale worker never publishes, not even a failure), `completion_uncertain` (see retries above), `claim_rejected` with `claim_pins_invalid` (a claim without valid pins cannot be addressed; its lease expires on the server), `transport_failed` (the claim request itself failed), `worker_error` (a defect outside any job), `workspace_capacity_reached` and `idle`. None of these stops the long-running worker; it logs the state and polls again.

On a compute failure the compute process writes `outputs/error.json` (`{"schemaVersion":"1.0","code":...}`). The control plane accepts only a compute code from the table and otherwise posts `compute_rejected`, because compute may run a native parser on client bytes. The compute process also writes `outputs/operator-detail.json` with the exception type and, for engine validation errors only, the engine's message (for example which column is missing). Native-library messages are reduced to their type.

The worker appends every job outcome (completed, failed with code and whether the fail was acknowledged, lease lost, completion uncertain) to `<workspace>/operator-log.jsonl`, including that operator detail. It creates the log owner-only (mode 0600, like the 0700 job directories), because entries can name columns and labels. The log stays on the worker host and is never sent to the platform; rotate it with the job evidence.

## Client-held datasets

Special-category fairness data stay with the client by default (decision D-11, #60). For such data the platform records a **client-held dataset pin** instead of an upload (`pinClientDataset`: file name, byte size, SHA-256 and who at the client confirmed them); the platform never receives the file's bytes, so it never receives the special-category column. A pin is accepted like other evidence and is selected for procedures, prediction lineage and dataset cards by its ID like an uploaded dataset. Only a client-local job can use it: `queueExternal` refuses every other mode, the hosted runner refuses it, and the evidence and runner download routes have nothing to return. A fairness protocol whose group column is special-category runs without a recorded Art 4a or GDPR Art 9(2) basis only as a client-local job on a client-held pin; on bytes held by the platform, or on the auditor's own worker, it needs the basis.

The frozen request marks the dataset `"custody":"client"`. Worker 1.3.0 runs such a job only when it was started with a client data directory (`--client-data-dir` or `ASSURANCE_CLIENT_DATA_DIR`), which is how the client's own worker is configured; without one it does not offer `client_local`. For the job it:

1. downloads nothing: it never calls the input route;
2. looks at the regular top-level files of the client data directory (no symlinks, at most 10,000 entries) whose size equals the pin; names do not matter and request fields never become paths;
3. copies each such file into the job's `inputs/dataset.csv` while hashing the bytes it copies, and keeps the first copy whose SHA-256 equals the pin. A changed file is refused with `dataset_input_pin_mismatch`, a missing one with `client_dataset_unavailable`, and nothing is computed. The compute process checks the size and SHA-256 again;
4. computes as for provided predictions, except that **the rows of groups below the minimum group size are left out and those groups are withheld** (see below), and returns the usual envelope: the engine report and `hostedResults` hold metrics, counts, intervals and per-group or per-class slices, which are aggregates; no row leaves the client. `provenance.execution` records `"controller":"client_local_worker"` and `"datasetCustody":"client"` with a limitation saying that only aggregates reached the platform, and the platform rejects a completion whose custody differs from the frozen request.

The client data directory must be an existing directory apart from the workspace; the worker reads it and never writes to it. The client keeps the pinned file unchanged until the job completes.

**Pinning without a worker, declared columns and the client's signature (#134).** A client without an enrolled worker computes the pin with `python -m engine.client_pin` from the runtime package (see `RUNTIME_PACKAGE.md`, "Client dataset pins"): it reads the file locally, uploads nothing and prints the pin form's fields. A pin also declares the file's header columns, exactly as this worker reads them, and `queueExternal` refuses a job whose target, prediction or group columns (the plan's group fields included) the declared header does not hold, so the mismatch is found when the job is queued rather than when this worker claims it. Pins recorded before declared columns are checked only here, as before. A pin can carry the client's Ed25519 signature over a statement of the pin, which the platform verifies when it records the pin. A fairness protocol on special-category data needs a minimum group size of at least 50 rows (above the 30-row statistics floor), so on this route no group under 50 rows is reported; protocols saved before that floor keep their frozen minimum.

**Small groups are withheld, and their rows are left out.** Reported exactly, a group of one row would give that person's special-category group, actual label and prediction. Blanking only that group's own figures is not enough: any total over every row (the row count, coverage, or the performance criterion's prevalence and selections) minus the eligible groups would give it back by subtraction. In a run on a client-held dataset the engine therefore first finds every group below the plan's minimum group size (`statistics.minimums.groupSize`, never below the 30-row floor; a configured `minimumGroupSize` below 30 is raised to it) in every column set the plan groups by: the protected column, each criterion's group fields and each calibration subgroup's field. It leaves the rows of those groups out, and also the rows with no value in such a column set when there are fewer than the minimum of them (otherwise the totals minus the eligible groups would give back a single such row's other group values, label and prediction), and repeats, because leaving rows out can shrink a group of another column below the minimum. The remaining rows are evaluated by every criterion, performance and calibration included, by drift, and they are the reported row count (`provenance.inputs.data.rowCount`). So every group that remains has at least the minimum number of rows in every column set, and no figure in the completion includes a row that was left out. A withheld group still counts, internally, as a present, suppressed group and towards its comparison's coverage population, rows left out for missing values count towards that population as unknown-group rows, and a row left out for another column set's small group still counts as an eligible row of its own group in this column set. With one group column set, as in every hosted plan today, the group decisions are therefore those of the same rows held by the platform. With several, they are too unless the repetition shrinks a group below the minimum that the full rows would have compared: such a group is suppressed, which lowers coverage and can make a comparison inconclusive where the platform-held run would decide it. In the result its slice keeps only the label (`"n":null`, `"withheld":true`, no rates or intervals), every comparison involving it carries no estimate, counts, interval or p-value, `decision.suppressedGroups[].n` is null, and a group comparison's `decision.coverage` is null, since its population counts the rows left out; whether coverage met its minimum still decides (`insufficient_coverage`). Its `decision.sampleSize` counts only the remaining rows. Every result states that rows were left out. A row whose mapped group cell is empty does not fail a client-local run with `missing_value`: it is a row with no value in that column set, handled as above, and when such rows are left out every result also states that rows were left out and count as withheld for a missing group value (#233). Every other empty mapped cell still fails the job. The performance and calibration figures therefore describe only the rows of groups at or above the minimum, and they can differ from a run on every row; the number of rows left out is not reported. A calibration subgroup below the minimum has no rows left and withholds all its estimates. Calibration bins below the minimum group size are withheld too, but the calibration figures over all bins (sample size, coverage, expected calibration error and Brier score) include their rows, so a small bin's scores and labels can be derived by subtraction. None of those rows belongs to a group below the minimum group size. Hosted plans, which client-local jobs use, have no calibration criteria. What remains derivable: the pinned file size the platform holds bounds the row count, and two jobs on the same pin with different group columns could be compared with each other; neither gives a withheld row's label or prediction within a single completion, and cross-run differencing is a stated limitation for the auditor's protocol design. Group-level aggregates of the eligible groups still describe the special-category attribute. Whether the client may share these aggregates under its basis, and the Art 4a reading behind the default route, remain pending legal review (LR-06, #57).

**The custody rests on enrollment.** The platform cannot see where a worker runs. That a `client_local` worker is the client's own, running in the client's environment, is established only by the enrollment security review that the auditor records when enrolling it (`enrollWorker`, its `securityReview`); a worker enrolled with `client_local` that in fact runs elsewhere would read the client's file there. Enroll `client_local` only for a worker the client operates, and record that review.

## GenAI ingest jobs

Worker 1.4.0 runs the `genai_ingest` job of `docs/design/genai-evidence.md` section 10.2 (#128): it ingests the tool logs of a GenAI evaluation (Inspect, lm-evaluation-harness, promptfoo, garak, PyRIT, DeepEval, Ragas, judge-validation labels and the Art. 50 marking inputs), recomputes every statistic with `engine.genai` and returns the `genai-result/0.1` envelope. It never executes, imports or opens anything an ingested file names (task files, scorer names, `!function` hooks, JavaScript assertions, `file://` providers are strings); parsers take bytes only (`engine/GENAI.md`).

- **Claiming.** The worker adds `"genai_ingest"` to its claim `formats` only when the executor's readiness reports `genaiIngest.runtimePresent`, that is when a zstd back-end imports (`zstandard` on Python 3.12, installed in the compute image), because Inspect `.eval` logs need one. `--no-genai-ingest` turns it off. The platform serves a GenAI job only to a worker enrolled with the `genai_ingest` capability that claims it. `--readiness` reports `genaiIngest: {runtimePresent, zstdBackend, signatureVerification, packages}`.
- **Request** (`schemaVersion: "genai-1.0"`, `executionMode: "genai_ingest"`): `engagementId`, `jobId`, `procedure` pins, `inputs[]` (`index`, `artifactId`, `name`, `sha256`, `size`, `role`, `format`), the frozen `manifest` (`genai-bundle/0.1`) and `plan` (`genai-plan/0.1`), `inputHashes` (`{"<index>": sha256}`), `records` and `limitations`. At claim time, before any download, the worker checks at most 64 inputs, each of 1 byte to 50 MiB and together at most 200 MiB, hex digests, `inputHashes` and the manifest's inputs equal to `inputs`, and that the engine accepts the manifest and plan; a failed check fails the attempt with `request_contract_rejected`, `manifest_invalid` or `plan_invalid`.
- **Inputs.** Each input is downloaded with `GET /api/runner?…&input=evidence&index=<i>` into `inputs/genai-<i>.bin.partial`, hashed while it streams, and promoted to `inputs/genai-<i>.bin` only when its size and SHA-256 equal the pin (`evidence_input_pin_mismatch` otherwise). Names never become paths. Downloads run in the control process, outside the compute limits.
- **Compute.** The compute process verifies every input again and calls `engine.genai.ingest.run_bundle` with provenance `channel: "runner"`, the request SHA-256, the worker version and the enrolled image digest. On POSIX it keeps the limits above (300 s of CPU, 32 MiB per written file, 64 open files); production should use the Docker executor, which adds the no-network, read-only container and the memory limit around a parser of hostile bytes. Every coded GenAI rejection is posted as its code (table above); an uncoded failure is `compute_internal_error`.
- **Result.** `outputs/result.json` holds the exact `resultJSON` string (no trailing newline). Before it is posted, the control plane checks the envelope's own hashes (`computationSha256`, and `itemsSha256` when items are inline), that its provenance names this request, these input hashes, this worker version and the enrolled image, and that the computation binds the request's plan and manifest (`planSha256`, `manifestSha256`) and exactly its inputs. The platform checks the same pins again before it stores the result; the workspace then compiles it (`compileGenaiResult`).

## Hosted and external report translation

The server freezes hosted `engineConfig.contractVersion:"1.1"`, human-readable task, selected individual test IDs, flat column/threshold configuration, policy identity and seed. The worker (translation `hosted-1.1-1.4-to-engine-1.3/2.1.0`, worker 1.3.0) translates that snapshot into engine configuration `contractVersion:"1.3"`: machine task IDs, suite families, typed column roles and the hosted statistics plan derived under `docs/design/audit-statistics.md` section 9.3. Each selected test becomes a confirmatory criterion with the test's id (`performance` adds the chance baseline balanced accuracy ≥ 0.5, or macro recall ≥ 1/k with k from the target column), and the configured minimums are raised to the floors of 30 rows, 30 per group and 10 per class, with both recorded in the plan and in `hostedTranslation.minimums`. `engineConfig` 1.4 instead carries an explicit `statistics` plan, keeps only the column mappings and the declared label pair in `config`, and its suite must equal the families of the plan's criteria; its top-level `negativeLabel` must equal `config.negativeLabel`. The source snapshot and translation version are retained in the engine configuration hash.

The worker accepts exactly the five tests a platform evaluation profile can select (`suiteSchema` in `site-app/lib/evaluation.ts`): `performance`, `regression`, `demographic_parity`, `disparate_impact` and `equalized_odds`. The platform never sends any other test and its import contract accepts only these results, so any other test fails the claim with `request_contract_rejected`. A test keeps the two catalogs identical.

For binary tasks the label pair is the frozen favourable `config.positiveLabel` and `engineConfig.negativeLabel`, not the labels that happen to occur in the data. A dataset with a single observed class is therefore evaluated, and statistics 1.0.0 decides what it supports (class-dependent members are undefined and block a pass). Observed labels outside the pair fail with `label_set_mismatch`, as do model `outputLabels` that differ from it; the worker checks those when the claim arrives, before downloading the dataset or model. A request frozen without `negativeLabel` derives the other label from exactly two observed labels (or the model's `outputLabels`), as earlier versions did.

Binary performance follows test definitions `traditional-ml-2.1.0` (translation 2.1.0, #65). Recall, precision and F1 are measured on the protocol's frozen `config.performancePositiveLabel`, which must be one of the frozen label pair; empty means the favourable label. The engine configuration records it as `performancePositiveLabel`. Fairness criteria, calibration and a model's decision threshold keep counting the favourable `positiveLabel`. A request frozen without `negativeLabel` takes a separate performance positive class as the other label. A performance result also reports prevalence and the majority-class baseline accuracy as descriptive entries, a per-class table (support, predictions, correct predictions, recall, precision, F1) in the `slices` of its balanced-accuracy entry, and a limitation that names predicted labels absent from the reference column, which count as errors. The decision is statistics 1.0.0's: the chance baseline (balanced accuracy ≥ 0.5, or macro recall ≥ 1/k) is a plan member, and the majority-class baseline is descriptive (`docs/design/audit-statistics.md` section 5.2), as in the hosted runner since #22. `schemas/fixtures/performance-rules-golden.json` holds binary cases both runners must decide alike, with one outcome and decision per case.

The completion envelope is:

```text
{schemaVersion:"1.0", externalReport:<unchanged valid engine 1.3 report>,
 hostedResults:[{testId,label,article,outcome,metrics,limitations,decision}],
 provenance:{requestSha256,inputHashes,imageDigest,workerVersion,translationVersion,
 executionMode,execution,externalReportSha256,preprocessingScope}}
```

`externalReport` includes every engine metric, limitation and generated draft working paper. `hostedResults` holds **one result per criterion of the recorded plan, in plan order**, copied from the engine: outcome, metrics, limitations and the `decision` object. The worker never re-decides (statistics 1.0.0 section 12): the interval decides against the band, with Bonferroni over the confirmatory family, in the engine alone. Headline names take the hosted aliases (`maximum_selection_rate_gap`, `minimum_selection_rate_ratio`, `maximum_tpr_fpr_gap`), multiclass `macro_recall` becomes `balanced_accuracy`, and the article follows the criterion kind (15 for performance kinds, 10 for group criteria). Metrics without a band are descriptive (`details.role`). A configured minimum class count of one is raised to ten like every other minimum; there is no separate projection. `verify_result_bytes` recomputes the copy and rejects any difference.

Until the platform's intake follows statistics 1.0.0 (#22, H4), the platform compiles these results into a 1.2 run, whose result schema admits the copied `decision` for that reason, and a result must stay within today's `resultEnvelope` limits of 100 metrics and 300-character metric names: an all-pairs group criterion over many groups (more than 14 groups for parity, more than 10 for equalized odds) or very long group labels exceeds them. The worker rejects missing mapped input cells instead of silently excluding them on the hosted translation path; the one exception is an empty group cell in a client-local run, which is left out and stated (see the client-local section).

`provided_predictions` and `client_local` evaluate the pinned prediction dataset, including when it is associated with separately registered native model metadata. Neither mode downloads or loads a model artifact. A `client_local` job on a client-held pin reads the dataset in the client's environment (see [Client-held datasets](#client-held-datasets)); one on an uploaded dataset downloads it like `provided_predictions`. `auditor_model` requires actual native inference; it cannot run a prediction file and claim independent scoring. `client_local` identifies client-origin provided-prediction evidence. A signed client-origin result does not establish independent auditor reproduction or ground-truth validity. Controller and execution kind remain separate from metadata declarations.

## Native inference and container execution

The supported frozen `engineConfig.modelSpec` is:

```json
{"task":"binary_classification","featureColumns":["age","income"],"outputLabels":["0","1"],"decisionThreshold":0.5}
```

`featureColumns` is an ordered list of 1–100 complete numeric prepared columns. Classification requires explicit ordered `outputLabels` (exactly two for binary); regression uses an empty list. ONNX additionally requires `predictionOutput`, accepts `predictionKind:"label"|"probability"`, `labelEncoding:"label"|"class_index"`, and optional `probabilityOutput`. PMML requires `predictionOutput`. The native tree objective must be in the reviewed protocol and match the task: XGBoost's is read from the loaded model's configuration, LightGBM's from the `objective=` line in the model text header, because a Booster loaded from text has empty `params`. A mismatch fails with `model_objective_mismatch`. There is no raw text or arbitrary categorical/preprocessing pipeline execution.

For a binary model, a row is classified as the frozen favourable label (`positiveLabel`) when that label's probability is at least `decisionThreshold` (default 0.5). A one-dimensional output is the probability of `outputLabels[1]`, the native binary objective convention, so when the favourable label is `outputLabels[0]` the worker uses 1 − p. An (n, 2) output has one column per label in `outputLabels` order, and each row must sum to one. Any other shape fails with `model_output_invalid`. When a binary model outputs class labels (ONNX `predictionKind:"label"`, PMML), the threshold cannot be applied: the model's own decision rule produces the predictions, and the report and every result built on those predictions carry a limitation saying so.

Build the core image from the engine directory, replacing the base image with a reviewed immutable digest for production:

```bash
docker build --build-arg PYTHON_IMAGE=python@sha256:<reviewed-base-digest> -t assurance-compute:reviewed engine
```

The delivered Dockerfile installs only `requirements-image.txt` (`cryptography` for signature verification and `zstandard` for Inspect `.eval` logs, with their dependencies), hash-locked and from wheels only; the base must stay on CPython 3.12, the one supported version (`README.md`, section Packaging). Its default base is `python:3.12.14-slim` pinned by the tag's multi-arch index digest, so the default build is reproducible; production still reviews and enrolls its own base digest. Optional runtimes must be included in an operator-owned derived image from a reviewed hash-locked dependency set; do not install from claimed job content. The optional requirement pins are only an initial baseline. The resulting image digest, full transitive/native dependency lock and native golden-fixture results must be enrolled together.

Use a host service with a rootless Docker CLI or equivalent controlled container launcher. Do not give an inference container the Docker socket. The supplied worker's Docker executor launches only a **locally present digest-pinned image** with `--pull=never`, network none, read-only image, all capabilities dropped, no new privileges, a nonroot user, default 1 CPU/1 GiB memory with no extra swap, 64 PIDs, file-descriptor/file-size bounds and a 64 MiB temporary filesystem. Inputs mount read-only; the separate output mount contains created evidence. It terminates the generated job container on timeout or lost lease, including native child processes. Host egress belongs to the transport service; inference containers receive neither credentials nor network.

```bash
python -m engine.worker --executor docker --compute-image registry.example/assurance@sha256:<enrolled-digest> \
  --image-digest sha256:<same-enrolled-digest> --formats onnx --workspace /var/lib/assurance/jobs
```

Process mode is useful for the dependency-free provided-prediction path and tests. It strips service secrets, sets thread limits, invokes a fixed application module with Python isolation, and enforces available POSIX CPU/file/descriptor limits and an outer wall-clock timeout. **It is not an OS memory/network sandbox**, and it does not permit native model formats. A declared image digest in this mode is operator-provided provenance, not measured remote attestation. Container execution, runtime readiness and model-hash approval reduce scope; they do not prove parser/model safety, input representativeness or complete custody.

## Verification and current limits

The common schema reads frozen engine reports at contract 1.0 and current ones at 1.3, and has the platform's external import projection as contract 1.2 and, under statistics 1.0.0, 1.5. The original result envelope remains schema 1.0 and is retained byte for byte. The imported run is a separate record with procedure bindings, frozen declarations and the exact request/result digest pins; it must preserve rich metric counts, confidence intervals and slices. The external manifest's `rowCount` is the largest metric sample size, not independently established source completeness.

Every request has two time limits. `--transport-timeout` (default 15 s, at most 120 s) is the idle timeout: the longest a connect or any single read may wait. Each attempt also has a wall-clock budget of that idle timeout plus the time its byte limit takes at 128 KiB/s (1 Mbit/s), so a 100 MiB dataset gets about 13 minutes. A POST's byte limit is its body plus the largest response envelope (2 MiB), so even a heartbeat or fail gets the idle timeout plus about 16 seconds (31 seconds with the defaults). Every retry starts a fresh budget. Reads use bounded `read1` chunks and check the active lease and the budget before and after each chunk, so a slow trickle cannot extend a transfer indefinitely. An idle timeout, an exhausted budget and a connection closed before its `Content-Length` are retried like other temporary failures.

Downloads stream to `<input>.partial` and are hashed as they arrive; nothing larger than an envelope is held in memory. A retry restarts from an empty file. Only bytes whose size and SHA-256 match the pins are renamed to `dataset.csv` or `model.<suffix>`; rejected or partial bytes are deleted. The configured workspace and existing ancestors are checked for symlinks before resolving the path; operators must still prevent filesystem races through dedicated service-account ownership and permissions.

`python -m unittest discover -s engine/tests -v` exercises actual local HTTP claim/download/subprocess/completion, exact-body HMAC, input/projection tampering, missing cells, task compatibility, absent class/constant target conditions, retry bounds and fresh retry budgets, truncated and stalled transfers, credential redirect rejection, heartbeat renewal/rejected fencing, leases under a host clock ten minutes fast or slow, ambiguous completion, workspace capacity, malformed and expired claims, every failure code, the CLI's configuration errors and exit codes, and `validate_model_spec`. The loopback fixture enforces the contract of `site-app/app/api/runner/route.ts`: 72-character token format, strict per-operation envelopes, `{"idle":true}`, format filtering, pins and leases, signature checks on complete/fail, the result envelope and frozen-request checks, and duplicate completion. Golden binary/fairness/multiclass/regression expectations are checked against real engine computations. HTTP fixtures use dummy credentials and loopback only.

The bundled environment contains numpy/pandas but lacks ONNX Runtime, XGBoost, LightGBM, pypmml and pyarrow; no native inference image or Docker execution was validated here. Optional tests do not claim native golden validation. Drift, permutation importance, perturbation, SHAP/LIME and cross-validation are not hosted tests: the platform cannot select them and the pull protocol has no reference-dataset endpoint. They remain available through the engine CLI (`python -m engine`). Raw-text NLP and executable preprocessing remain unavailable. A preprocessing hash can be retained as a source declaration; this worker does not verify or execute that transformation. Add a pinned prepared-dataset/source-transformation custody record before making stronger lineage claims.

HMAC proves possession of the enrolled application credential and binds exact request/result bytes. It does not establish metric correctness, complete source records, a measured worker image, model artifact safety or external auditor independence. Preserve human working-paper review, evidence acceptance, finding decisions and report release controls in the platform. Production rollout still requires actual server integration tests, lease crash/recovery and cancellation tests, native golden fixtures, secure service enrollment/rotation, filesystem quotas, container-runtime verification and retained evidence verification.
