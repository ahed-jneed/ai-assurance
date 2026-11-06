# Traditional ML diagnostic runner

This is an executable evidence engine for the assurance platform. Its default dependency-free path evaluates CSV datasets containing labels and **precomputed predictions**. Optional model-backed adapters and Parquet ingestion require separately provisioned runtimes. It does not perform an automatic legal compliance determination. Core runtime: Python 3.12+; tested on bundled CPython 3.12.14. No third-party dependencies or installation are required for the default path.

The independent `/api/runner` pull client is implemented in `worker.py`; see [WORKER.md](WORKER.md) for enrollment, exact-byte completion signatures, hosted/external contract translation, isolated native execution and current limitations. Its local loopback end-to-end tests do not establish a deployed worker service or native-runtime validation.

Read-only MLflow and Hugging Face registration snapshots are implemented in `registry_import.py`; see [REGISTRY_IMPORT.md](REGISTRY_IMPORT.md) for exact version/commit acquisition, declaration-only feature contracts, approved digest-bound artifact copies and unknown fields. Importing a snapshot does not approve a model or enable a runtime.

From the repository root:

```powershell
python -m unittest discover -s engine/tests -v
python -m engine --data engine/examples/predictions.csv --reference engine/examples/reference.csv --config engine/examples/config.json --output engine/examples/report.json
```

If Python is not on PATH, use the executable returned by Codex's workspace dependency tool. The initial delivered report already exists; use a new output filename for another execution. An existing output is never overwritten. Each invocation needs a newly allocated run ID in production; the example ID is for demonstration only. `engine/examples/generate_fixture.py` regenerates the synthetic input fixtures.

## Implemented controls

| Task | Evidence produced |
| --- | --- |
| Binary classification | Confusion counts, accuracy, precision, recall, F1, balanced accuracy; Wilson 95% intervals for binomial proportions |
| Probability calibration | Brier score, fixed equal-width-bin expected calibration error, observed rates and score means by bin |
| Binary group fairness | Maximum/minimum demographic parity difference; minimum/maximum selection-rate disparate impact ratio; equalized odds difference as the maximum of TPR/FPR group ranges |
| Multiclass classification | Full confusion matrix, accuracy, per-class precision/recall/F1/support, macro metrics |
| Regression | MAE, RMSE, R²; constant-target R² is undefined and inconclusive |
| Numeric drift | Reference-derived fixed PSI bins, two-sample KS statistic, empirical 1D Wasserstein distance; reference/current missingness rates |

Fairness group slices preserve numerators, denominators, confusion counts and Wilson intervals. Small groups or insufficient positive/negative support yield **inconclusive**, even when a numeric result is available. DP/DI/EO do not claim a confidence interval for a nonlinear group range. Minimum sample counts are protocol settings, not statutory values. Intervals assume independent observations; repeated customers, temporal dependence or clustered observations need a reviewed resampling protocol. PSI collapses duplicate reference quantile cuts and applies normalized 0.5 pseudocounts. KS exposes an approximate descriptive p-value, explicitly labeled as asymptotic and unreliable with ties; acceptance uses the statistic threshold. No exact inferential or multiple-comparison claim is made.

SHAP, LIME, cross-validation, adversarial robustness and Article 12 record-keeping checks return explicit **inconclusive / capability unavailable** results when requested. Permutation importance, perturbation and inference do so when no trusted model adapter is supplied. A missing optional probability column produces **not_applicable** calibration. A missing drift reference is **inconclusive**. Regression and multiclass fairness need task-specific protocols and return **not_applicable** for the binary fairness suite. No values are fabricated for unavailable methods.

## Common run contract

The shared Draft 2020-12 schema in `schemas/test-run.schema.json` distinguishes three records. Engine evidence remains contract **1.0** (runner **1.2.0**); the frozen hosted input/configuration and hosted saved-prediction record use **1.1**; the platform's authenticated external-result compilation uses **1.2**. The worker transport request and exact result envelope each use `schemaVersion: "1.0"`. These independent version fields describe different boundaries; importing evidence does not rewrite the original report or upgrade its provenance.

An external 1.2 projection retains the complete worker metric objects, request/result SHA-256 pins, system/model/dataset/protocol declarations and approved procedure revisions. It creates one supplementary compilation paper requiring human assessment. Its manifest `rowCount` is derived from the largest reported metric sample size; it is not an independently verified population census. A registered native model associated with `provided_predictions` or `client_local` still represents supplied-prediction evaluation. Independent scoring requires the worker's actual `auditor_model` execution path and reviewed adapter/runtime evidence.

Run `node schemas/validate-run-schema.mjs` with Ajv 2020 and ajv-formats installed in an existing dependency tree; alternatively supply `--ajv-package path/to/package.json`. The committed external fixtures use actual core computations on synthetic inputs and preserve exact request/result strings. They do not validate platform authentication, production integration or native runtimes. `python schemas/.build-run-schema.py` regenerates all three contract variants and invokes the idempotent 1.2 extension automatically. See `RUNTIME_PACKAGE.md` for the source archive and reproduction commands.

`contractVersion: "1.0"`; identifiers `id`, `engagementId`, `modelId`, `datasetId`; `suite[]`; copied and hashed `configuration`; frozen `thresholds`; `seed`; execution `state`; `outcome` and `overallOutcome`; `results[]`; `provenance`; `paperIds[]`; `workingPapers[]`. A finished computation can have `state: "succeeded"` and `outcome: "fail"`: the former describes execution, the latter the frozen acceptance criteria. No-test or missing-evidence conditions never default to pass.

Each result contains `{testId, label, article, outcome, metrics[], limitations[]}`. Each metric contains `{name, value, threshold, unit, sampleSize, numerator, denominator, confidenceInterval, slices[], details}`. `value` can be null. `threshold` is null or `{operator, value, policyId, policyVersion, source: "internal_policy"}`. **There are no universal numeric fairness/performance/drift cutoffs specified by these EU AI Act article mappings.** Demo cutoffs must be replaced by an engagement's risk, domain and acceptance policy, approved before testing. Missing cutoffs produce inconclusive results.

Every generated working paper is a **draft** with a proposed diagnostic conclusion, limitations, evidence hashes, test ID, runner version and mandatory review. It has no auditor sign-offs. The platform must add the approved audit program, population/sampling rationale, reviewer assessment, control applicability and subsequent versions before reporting. Article references are supporting-evidence mappings rather than findings that an article is satisfied.

## Integrity and safety

CSV parsing rejects duplicate/blank headers, inconsistent row widths, invalid UTF-8, unknown binary labels, non-finite numeric cells, probabilities outside [0,1], and unknown test suites. Blank/null numeric values are excluded and counted; categorical blank labels are excluded. Up to 100 MiB, 1,000,000 rows, 1,000 columns, 100 class labels, and 1,000 protected groups are accepted. Resource-limited workers remain necessary for production.

`provenance` records SHA-256 of original input bytes, canonical frozen config, file sizes/row counts, runner version and seed. `reportSha256` hashes canonical report JSON **excluding only reportSha256**. `verify_report()` detects modification. This is an integrity checksum, not a digital signature. Local create-once files are not tamper-proof: production must sign manifests through a managed signing service, enforce object-lock retention and append-only custody events, and separate storage administrators from audit approvers.

Runner 1.1.1 also records the actual Python version/implementation and installed versions of direct distributions declared by the active adapter and consumed Parquet connector. A CSV-only run omits unrelated installed packages. Custom application-owned adapters must declare `runtime_packages` (an empty tuple explicitly declares standard-library-only behavior). Missing declarations or unresolved distribution metadata produce `status: "partial"`, null unknown versions and a report limitation. This covers direct dependencies; transitive packages, native binaries, Java and the complete worker environment still require an image/dependency lock.

`provenance.inputs.testDefinitions` snapshots per-test definition versions. Generated working-paper IDs bind the run ID, input/config hashes, runner version, test ID and its definition version. Retrying with identical pins produces identical IDs; changing the runner changes the IDs, while changing one test definition changes that test's paper ID. The paper procedure includes both versions. Definition versions must be updated when metric formulas, eligibility or acceptance procedures change. Contract version remains `1.0`; previous immutable reports remain readable and retain their original IDs.

`contract.validate_report()` checks the implemented completed-report shape, frozen-policy consistency, finite metric values, sample-size types, aggregate outcomes, timezone-aware timestamp order, working-paper IDs, configuration digest and report checksum before the CLI writes evidence. It is an application contract validator, not a general JSON Schema implementation. Treat external reports as unverified evidence even after it passes; a valid checksum cannot establish origin or truth of the submitted predictions. Keep imported envelopes unchanged and store engagement associations separately to preserve integrity.

No pickle/joblib loading, model-provided code, SQL credentials, or embedded executable imports occur. The default CSV path makes no network connections. Optional native tree adapters invoke a fixed application-owned child Python process, without shell expansion. PMML's Java bridge requires separately controlled local runtime communication; the production sandbox must constrain network access. Bundled environment inspection found numpy 2.3.5 and pandas 3.0.1. pyarrow, scikit-learn, ONNX Runtime, pypmml, SHAP, LIME, XGBoost and LightGBM were absent, so their native inference/Parquet integrations were not runtime-tested. Tests exercise model-backed algorithms using an application-owned deterministic predictor and verify read-only SQLite behavior and artifact eligibility gates.

## Optional trusted model and connector capabilities

`optional_adapters.py` implements ONNX Runtime (single numeric rank-2 input; explicit label/probability outputs), pypmml (explicit prediction field; separately provisioned Java), native XGBoost JSON and native LightGBM text. **Every model requires the explicit `--trusted-model` gate**, an existing local file, the declared format/extension, bounded bytes and an ordered numeric feature schema. The gate expresses that the artifact belongs to a reviewed client-owned execution context; it does not prove artifact safety. Never apply it automatically to tenant uploads or browser requests. Native tree scoring runs in a fixed child process with a 60-second timeout and checks the exact model hash/objective; this is process separation, not an OS security sandbox. ONNX/PMML also require the resource-limited isolation described in `ASYNC_INTEGRATION.md`. External ONNX weights, arbitrary tensor schemas, raw categorical/NLP features and custom model operators are outside this adapter protocol. scikit-learn objects must currently be exported to supported ONNX/PMML or evaluated through saved predictions; pickle/joblib remains prohibited.

Freeze a `modelSpec` inside the run config, for example:

```json
{"task":"binary_classification","featureColumns":["age","income"],"outputLabels":["0","1"],"decisionThreshold":0.5}
```

For ONNX also specify `predictionOutput`, `predictionKind` (`label` or `probability`), optionally `labelEncoding: "class_index"` and `probabilityOutput`. Class probabilities follow the exact declared `outputLabels` ordering. PMML requires `predictionOutput`. All features must already have reviewed preprocessing and finite numeric values. A model-backed run replaces supplied predictions; it discards supplied scores unless the adapter produces validated probabilities for the same model, preventing calibration from mixing models.

```powershell
python -m engine --data features.csv --config model-run.json --model reviewed-model.json --model-format xgboost_json --trusted-model --output new-run.json
```

`permutation_importance` computes actual seeded independent-column shuffles, held-out classification error/MAE increase, repeat values and descriptive standard deviation. `permutation.repeats` defaults to 5 and permits 2–20. Correlated-feature importance and unrealistic shuffled combinations require review; this is not a causal explanation or population confidence interval. Acceptance rule names are `permutation_accuracy_drop:FEATURE` or `permutation_mae_increase:FEATURE`.

`perturbation` executes ±delta numeric changes, clipped to approved feature ranges, reporting worst loss increase. Config must supply `{approvalId,rationale,features:{FEATURE:{lower,upper,delta}}}`; every observed value must lie within its approved range. Merely writing an approval ID does not authenticate approval; the production API must verify it against the signed audit program. Rule names are `perturbation_accuracy_drop:FEATURE` or `perturbation_mae_increase:FEATURE`. These controls are local sensitivity checks, not adversarial security certification. No adapter/approved protocol/matching threshold means inconclusive.

`connectors.read_dataset()` accepts CSV and optional Parquet through pyarrow, with bounded rows, columns, compressed and decoded bytes and scalar-only values. It hashes the actual source byte snapshot. `python -m engine.connectors` creates a deterministic local SQLite CSV snapshot plus manifest using `mode=ro`, `query_only`, disabled extension loading/trusted schema, a read transaction, fixed validated table/column names, a unique non-null order key, parameterized finite numeric bounds, a 20-second query budget and a non-truncating row limit. No arbitrary SQL is accepted. The connector is local SQLite only; enterprise SQL credentials/connectors remain future integration work.

```json
{"table":"predictions","columns":["id","actual","predicted"],"orderBy":"id","boundColumn":"id","lower":1,"upper":1001,"limit":1000}
```

```powershell
python -m engine.connectors --database client-snapshot.db --spec snapshot-spec.json --output snapshot.csv
```

`requirements-optional.txt` pins an optional runtime baseline; no packages were installed. Before production, resolve and hash-lock transitive dependencies and validate each adapter with real reviewed models and golden predictions. Pin availability was checked against owner pages: [ONNX Runtime](https://pypi.org/project/onnxruntime/), [pypmml](https://pypi.org/project/pypmml/), [XGBoost](https://pypi.org/project/xgboost/), [LightGBM](https://pypi.org/project/lightgbm/), [PyArrow](https://pypi.org/project/pyarrow/).

See `ASYNC_INTEGRATION.md` for the API/outbox/queue/worker contract. The local web prototype must never execute this Python engine in a browser or imply an API was deployed merely because the runner exists.
