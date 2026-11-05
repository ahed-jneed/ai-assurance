"""Versioned worker transport and hosted-v1.1/external-v1.0 translation.

Transport hashes refer to exact UTF-8 bytes. An engine report's own checksum
uses its existing canonical JSON contract; these are different digests.
"""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .contract import HASH, ID, validate_report
from .diagnostics import MAX_BYTES, canonical_bytes, finite_number, sha256, validate_config
from .errors import EngineError

WORKER_VERSION = "1.1.0"
TRANSLATION_VERSION = "hosted-1.1-to-engine-1.0/1.1.0"
MAX_ENVELOPE_BYTES = 2 * 1024 * 1024
MAX_RESULT_BYTES = 8 * 1024 * 1024
MAX_COMPLETION_BYTES = 10 * 1024 * 1024
TASKS = {"Binary classification": "binary_classification", "Multiclass classification": "multiclass_classification", "Regression": "regression"}
FORMAT_ALIASES = {"onnx": "onnx", "ONNX": "onnx", "pmml": "pmml", "PMML": "pmml", "xgboost_json": "xgboost_json", "XGBoost": "xgboost_json", "lightgbm_text": "lightgbm_text", "LightGBM": "lightgbm_text"}
FAIRNESS = {"demographic_parity": "FAIR-DP", "disparate_impact": "FAIR-DI", "equalized_odds": "FAIR-EO"}
# The hosted tests a platform profile can select (site-app/lib/evaluation.ts
# suiteSchema). The platform never sends any other test and can import only
# these results, so the worker accepts exactly this catalog.
SUITES = {"performance": ["performance"], "regression": ["performance"], **{name: ["fairness"] for name in FAIRNESS}}
LABELS = {"performance": "Classification performance", "regression": "Regression performance", "demographic_parity": "Demographic parity", "disparate_impact": "Disparate impact", "equalized_odds": "Equalized odds"}
METRIC_ALIASES = {"demographic_parity_difference": "maximum_selection_rate_gap", "disparate_impact_ratio": "minimum_selection_rate_ratio", "equalized_odds_difference": "maximum_tpr_fpr_gap"}

# Sanitized failure codes: the only `error` values posted with op:"fail",
# besides http_<status>. engine/WORKER.md documents every code and a test
# keeps both lists identical. A code never carries rows, paths or messages.
# The compute process may report only COMPUTE_FAILURE_CODES in error.json.
COMPUTE_FAILURE_CODES = frozenset({
    "request_contract_rejected", "model_not_locally_approved_or_runtime_unavailable",
    "dataset_input_pin_mismatch", "model_input_pin_mismatch",
    "dataset_malformed", "dataset_limit_exceeded", "missing_column", "missing_value",
    "invalid_numeric_value", "label_set_mismatch", "cardinality_limit_exceeded", "protocol_config_invalid",
    "model_artifact_invalid", "model_runtime_unavailable", "model_objective_mismatch",
    "model_interface_mismatch", "model_output_invalid", "model_inference_failed",
    "evidence_too_large", "compute_timeout", "compute_resource_exhausted", "compute_internal_error",
})
FAILURE_CODES = COMPUTE_FAILURE_CODES | frozenset({
    "lease_expired_on_receipt", "executable_preprocessing_unsupported", "workspace_job_limit", "workspace_unavailable",
    "transport_unavailable", "transport_idle_timeout", "response_deadline_exceeded", "response_truncated", "response_size_rejected", "model_input_size_mismatch",
    "compute_unavailable", "compute_rejected", "result_verification_failed", "worker_internal_error",
})
HTTP_FAILURE = re.compile(r"^http_[1-5][0-9]{2}$")


def failure_code(code):
    """Return a documented failure code unchanged; anything else is internal."""
    return code if isinstance(code, str) and (code in FAILURE_CODES or HTTP_FAILURE.fullmatch(code)) else "worker_internal_error"


def strict_json(data: str | bytes, *, maximum: int = MAX_ENVELOPE_BYTES) -> Any:
    raw = data.encode("utf-8") if isinstance(data, str) else data
    if not isinstance(raw, bytes) or len(raw) > maximum:
        raise ValueError("JSON payload exceeds the protocol limit")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON object keys are forbidden")
            result[key] = value
        return result

    def constant(_):
        raise ValueError("Non-finite JSON numbers are forbidden")

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
        # json.loads can also overflow valid JSON exponents (e.g. 1e999).
        canonical_bytes(value)
        return value
    except (UnicodeError, json.JSONDecodeError, RecursionError, OverflowError) as exc:
        raise ValueError("Invalid bounded UTF-8 JSON") from exc


def json_bytes(value: Any) -> bytes:
    return canonical_bytes(value)


def result_signature(application_token: str, body: bytes) -> str:
    """HMAC key is SHA256(raw application token); sign the full exact body."""
    if not isinstance(application_token, str) or not application_token:
        raise ValueError("An application worker token is required")
    return hmac.new(hashlib.sha256(application_token.encode("utf-8")).digest(), body, hashlib.sha256).hexdigest()


def valid_id(value, name):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("Invalid "+name)
    return value


def valid_hash(value, name):
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError("Invalid SHA-256 for "+name)
    return value


def timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError("A timezone is required")
        return result
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Invalid leaseUntil timestamp") from exc


def claim_pins(body):
    """Validate only the attempt pins that every later operation echoes.

    A claim whose request is unusable can still be failed by these pins.
    """
    if not isinstance(body, dict):
        raise ValueError("Claim must be an object")
    job = valid_id(body.get("jobId"), "jobId")
    attempt = valid_id(body.get("attemptId"), "attemptId")
    fence = body.get("fence")
    if isinstance(fence, bool) or not isinstance(fence, int) or not 1 <= fence <= 2**53-1:
        raise ValueError("Invalid fence")
    nonce = body.get("nonce")
    if not isinstance(nonce, str) or not 16 <= len(nonce) <= 256 or any(ord(c) < 32 for c in nonce):
        raise ValueError("Invalid attempt nonce")
    digest = valid_hash(body.get("requestSha256"), "request")
    return {"jobId": job, "attemptId": attempt, "fence": fence, "nonce": nonce, "requestSha256": digest}


@dataclass(frozen=True)
class Claim:
    job_id: str
    attempt_id: str
    fence: int
    nonce: str
    lease_until: str
    request_sha256: str
    request: dict
    request_json: str

    @classmethod
    def parse(cls, body):
        """Validate a claim's pins, lease timestamp and exact request.

        Whether the lease is still running is a question for the server's
        clock, so the worker checks it with the claim response's Date header.
        """
        pins = claim_pins(body)
        timestamp(body.get("leaseUntil"))
        request_json = body.get("requestJSON")
        # Exact server bytes remove JavaScript/Python number serialization ambiguity.
        if not isinstance(request_json, str):
            raise ValueError("Claim requires exact requestJSON bytes")
        request = strict_json(request_json)
        if not isinstance(request, dict) or request != body.get("request") or sha256(request_json.encode("utf-8")) != pins["requestSha256"]:
            raise ValueError("Request JSON/hash mismatch")
        validate_request(request)
        return cls(pins["jobId"], pins["attemptId"], pins["fence"], pins["nonce"], body["leaseUntil"], pins["requestSha256"], request, request_json)

    def pins(self):
        return {"jobId": self.job_id, "attemptId": self.attempt_id, "fence": self.fence, "nonce": self.nonce, "requestSha256": self.request_sha256}

    def transport_dict(self):
        return {**self.pins(), "leaseUntil": self.lease_until, "request": self.request, "requestJSON": self.request_json}


def validate_request(request):
    if request.get("schemaVersion") != "1.0" or request.get("executionMode") not in {"provided_predictions", "auditor_model", "client_local"}:
        raise ValueError("Unsupported worker request version/execution mode")
    for key in ("model", "dataset", "engineConfig", "inputHashes"):
        if not isinstance(request.get(key), dict):
            raise ValueError("Request requires "+key)
    data = request["dataset"]
    valid_id(data.get("id"), "dataset.id")
    valid_id(request["model"].get("id"), "model.id")
    digest = valid_hash(data.get("sha256"), "dataset")
    size = data.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_BYTES:
        raise ValueError("Dataset exceeds worker byte limits")
    if request["inputHashes"].get("dataset") != digest:
        raise ValueError("Dataset manifest/hash mismatch")
    config = request["engineConfig"]
    if config.get("contractVersion") != "1.1":
        raise ValueError("Worker requires frozen hosted engineConfig contractVersion 1.1")
    for key in ("id", "engagementId", "modelId", "datasetId"):
        valid_id(config.get(key), "engineConfig."+key)
    if config["datasetId"] != data["id"] or config["modelId"] != request["model"]["id"]:
        raise ValueError("Configuration identity differs from pinned inputs")
    seed = config.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**32-1 or request.get("seed") != seed:
        raise ValueError("Frozen request/config seed mismatch")
    if config.get("task") not in TASKS or request["model"].get("task") != config["task"]:
        raise ValueError("Task is unsupported or differs from registered model")
    if request["executionMode"] == "auditor_model" and request["model"].get("format") == "Prediction file":
        raise ValueError("Auditor-model execution requires independent model inference")
    if request["executionMode"] == "auditor_model":
        if request["model"].get("format") not in FORMAT_ALIASES:
            raise ValueError("Unsupported model format; pickle/joblib/custom code is prohibited")
        model_hash = valid_hash(request["inputHashes"].get("modelArtifact"), "modelArtifact")
        declared = request["model"].get("sha256", request["model"].get("sourceSha256"))
        if declared != model_hash:
            raise ValueError("Model artifact hash differs from request")
        size = request["model"].get("size")
        if size is not None and (isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_BYTES):
            raise ValueError("Model size exceeds worker byte limits")
    suite = config.get("suite")
    if not isinstance(suite, list) or not suite or len(suite) > len(SUITES) or any(not isinstance(s, str) or s not in SUITES for s in suite) or len(set(suite)) != len(suite):
        raise ValueError("Invalid hosted suite selection")
    if any(s in FAIRNESS for s in suite) and config["task"] != "Binary classification":
        raise ValueError("Binary fairness is incompatible with this task")
    if ("regression" in suite and config["task"] != "Regression") or ("performance" in suite and config["task"] == "Regression"):
        raise ValueError("Performance test/task mismatch")
    if not isinstance(config.get("config"), dict):
        raise ValueError("Frozen hosted column/policy configuration is required")
    for field in ("policyId", "policyVersion"):
        if not isinstance(config.get(field), str) or not config[field].strip():
            raise ValueError("Named frozen internal policy is required")
    if "modelSpec" in config:
        validate_model_spec(config["modelSpec"], TASKS[config["task"]])
        if request["executionMode"] == "auditor_model" and config["task"] == "Binary classification":
            # The same check compute makes, here so that a model whose labels
            # are not the frozen pair fails at claim time, before any download.
            binary_labels(config, inference=True)


def validate_model_spec(spec, task):
    allowed = {"task", "featureColumns", "outputLabels", "decisionThreshold", "predictionOutput", "predictionKind", "labelEncoding", "probabilityOutput"}
    if not isinstance(spec, dict) or set(spec) - allowed or spec.get("task") != task:
        raise ValueError("Invalid typed modelSpec")
    columns = spec.get("featureColumns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 100 or any(not isinstance(c, str) or not c.strip() or len(c) > 300 for c in columns) or len(set(columns)) != len(columns):
        raise ValueError("modelSpec requires ordered unique numeric features")
    labels = spec.get("outputLabels")
    if not isinstance(labels, list) or any(not isinstance(label, str) or not label or len(label) > 300 for label in labels) or len(set(labels)) != len(labels):
        raise ValueError("modelSpec requires explicit outputLabels")
    if task == "regression" and labels or task == "binary_classification" and len(labels) != 2 or task == "multiclass_classification" and not 2 <= len(labels) <= 100:
        raise ValueError("Output class order differs from task")
    threshold = spec.get("decisionThreshold", .5)
    # A JSON number only: finite_number would also accept text such as "0.5".
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0 <= threshold <= 1:
        raise ValueError("Invalid decision threshold")
    if spec.get("predictionKind", "label") not in {"label", "probability"} or spec.get("labelEncoding", "label") not in {"label", "class_index"}:
        raise ValueError("Unsupported output encoding")
    for field in ("predictionOutput", "probabilityOutput"):
        if field in spec and (not isinstance(spec[field], str) or not spec[field] or len(spec[field]) > 300):
            raise ValueError("Invalid declared tensor/field output")


def integer(config, key, default, maximum=1_000_000, minimum=2):
    value = config.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError("Invalid "+key)
    return value


def translate_config(request, rows):
    """Translate selected tests without claiming supplemental metrics passed."""
    validate_request(request)
    hosted = request["engineConfig"]
    c = hosted["config"]
    selected = hosted["suite"]
    task = TASKS[hosted["task"]]
    columns = {"target": c.get("labelColumn"), "prediction": c.get("predictionColumn")}
    if any(test in FAIRNESS for test in selected):
        columns["protected"] = c.get("groupColumn")
    if c.get("scoreColumn"):
        columns["score"] = c["scoreColumn"]
    if any(not isinstance(v, str) or not v.strip() or len(v) > 300 for v in columns.values()) or len(set(columns.values())) != len(columns):
        raise EngineError("protocol_config_invalid", "Mapped role columns must be nonempty and distinct")
    inference = request["executionMode"] == "auditor_model"
    required = [name for role, name in columns.items() if not inference or role not in {"prediction", "score"}]
    absent = [name for name in required if not rows or name not in rows[0]]
    if absent:
        raise EngineError("missing_column", "Required mapped input columns are absent: "+", ".join(map(repr, absent)))
    if any(not str(row.get(name, "")).strip() for row in rows for name in required):
        raise EngineError("missing_value", "Mapped inputs cannot silently drop missing values")
    for row_number, row in enumerate(rows, 2):
        if task == "regression":
            for name in (columns["target"], *([] if inference else [columns["prediction"]])):
                try:
                    value = finite_number(row[name], f"row {row_number} column {name!r}")
                except ValueError as exc:
                    raise EngineError("invalid_numeric_value", str(exc)) from exc
                if abs(value) > 1e100:
                    raise EngineError("invalid_numeric_value", "Regression inputs exceed numeric bounds")
    if "protected" in columns and len({row[columns["protected"]].strip() for row in rows}) > 1000:
        raise EngineError("cardinality_limit_exceeded", "Protected-group cardinality exceeds engine bounds")
    suites = list(dict.fromkeys(s for test in selected for s in SUITES[test]))
    values = {}

    def criterion(field, metric, operator, default=None, upper=1.0):
        value = c.get(field, default)
        number = finite_number(value, field)
        if not 0 <= number <= upper:
            raise ValueError("Invalid acceptance criterion "+field)
        values[metric] = {"operator": operator, "value": number}

    if "performance" in selected:
        criterion("minimumAccuracy", "accuracy", ">=")
        criterion("minimumRecall" if task == "binary_classification" else "minimumMacroF1", "recall" if task == "binary_classification" else "macro_f1", ">=", .7)
    if "regression" in selected:
        criterion("maximumRmse", "rmse", "<=", 1, 1e100)
    if "demographic_parity" in selected:
        criterion("maximumParityGap", "demographic_parity_difference", "<=")
    if "disparate_impact" in selected:
        criterion("minimumImpactRatio", "disparate_impact_ratio", ">=")
    if "equalized_odds" in selected:
        criterion("maximumOddsGap", "equalized_odds_difference", "<=", c.get("maximumParityGap", .1))
    native = {"contractVersion": "1.0", **{key: hosted[key] for key in ("id", "engagementId", "modelId", "datasetId", "seed")}, "task": task, "suite": suites, "columns": columns, "minSampleSize": integer(c, "minimumSampleSize", 20), "minClassCount": max(2, integer(c, "minimumClassCount", 5, minimum=1)), "minGroupSize": integer(c, "minimumGroupSize", 30), "thresholds": {"policyId": hosted["policyId"], "policyVersion": hosted["policyVersion"], "source": "internal_policy", "values": values}, "hostedTranslation": {"version": TRANSLATION_VERSION, "sourceContract": "1.1", "selectedTests": selected, "sourceConfiguration": copy.deepcopy(c), "minimumClassCount": c.get("minimumClassCount", 5), "supplementalMetricPolicy": "descriptive; only selected named acceptance criteria determine hostedResults"}}
    if task == "binary_classification":
        native.update(binary_labels(hosted, rows, columns, inference=inference))
    if "modelSpec" in hosted:
        native["modelSpec"] = copy.deepcopy(hosted["modelSpec"])
    return validate_config(native)


def binary_labels(hosted, rows=None, columns=None, *, inference):
    """The frozen favourable and other binary labels.

    The platform freezes engineConfig.negativeLabel, so the label pair never
    depends on which labels happen to occur: a dataset with a single
    observed class is evaluated and reported as inconclusive. A model's
    outputLabels must be exactly that pair, and observed labels outside it
    are rejected when predictions are read. Only a request frozen without
    negativeLabel and without a model reads `rows` (the `columns` roles).
    """
    positive = hosted["config"].get("positiveLabel")
    if not isinstance(positive, str) or not positive.strip():
        raise EngineError("protocol_config_invalid", "A favourable binary class label is required")
    labels = hosted.get("modelSpec", {}).get("outputLabels", []) if inference else None
    declared = set(labels) if inference else None
    negative = hosted.get("negativeLabel")
    if negative is None:
        # Requests frozen without negativeLabel: derive the other label.
        names = declared if inference else {row[column].strip() for row in rows for column in (columns["target"], columns["prediction"])}
        others = names-{positive}
        if len(others) != 1 or inference and positive not in names:
            raise EngineError("label_set_mismatch", "Freeze engineConfig.negativeLabel; the other binary label cannot be derived from these labels")
        negative = others.pop()
    if not isinstance(negative, str) or not negative.strip() or negative.strip() == positive:
        raise EngineError("protocol_config_invalid", "negativeLabel must be a nonempty label that differs from positiveLabel")
    negative = negative.strip()
    if inference and declared != {positive, negative}:
        raise EngineError("label_set_mismatch", f"Model outputLabels {labels!r} differ from the frozen positiveLabel and negativeLabel {[positive, negative]!r}")
    return {"positiveLabel": positive, "negativeLabel": negative}


def _selected_sources(report, test, task):
    ids = {"performance": ["PERF-BINARY" if task == "binary_classification" else "PERF-MULTI"], "regression": ["PERF-REG"], **{name: [result_id] for name, result_id in FAIRNESS.items()}}
    return [result for result in report["results"] if result["testId"] in ids[test]]


def hosted_results(report, request):
    """Retain engine evidence; evaluate only frozen selected hosted criteria.

    The core engine is deliberately conservative when supplementary metrics
    have no thresholds. This separate projection never rewrites that report.
    """
    validate_report(report)
    c = request["engineConfig"]["config"]
    task = report["configuration"]["task"]
    minimum_n = c.get("minimumSampleSize", 20)
    minimum_class = c.get("minimumClassCount", 5)
    result_list = []
    for test in request["engineConfig"]["suite"]:
        sources = _selected_sources(report, test, task)
        if not sources:
            raise ValueError("Requested test produced no evidence")
        # Engine measurements may share one confusion/details object. Copy
        # each separately so acceptance metadata survives JSON round trips.
        metrics = [copy.deepcopy(m) for source in sources for m in source["metrics"]]
        limitations = list(dict.fromkeys(note for source in sources for note in source["limitations"]))
        selected_metrics = [m for m in metrics if m["threshold"] is not None]
        eligible = bool(metrics) and min((m["sampleSize"] for m in metrics), default=0) >= minimum_n
        if test == "performance" and task == "binary_classification":
            confusion = metrics[0]["details"]["confusionMatrix"]
            eligible &= min(confusion["tp"]+confusion["fn"], confusion["tn"]+confusion["fp"]) >= minimum_class
        elif test == "performance":
            slices = metrics[0]["slices"]
            eligible &= len(slices) >= 2 and all(s["n"] >= minimum_class for s in slices)
        elif test in FAIRNESS:
            slices = metrics[0]["slices"]
            eligible &= len(slices) >= 2 and all(s["n"] >= c["minimumGroupSize"] for s in slices)
            if test == "equalized_odds":
                eligible &= all(min(s["tprDenominator"], s["fprDenominator"]) >= minimum_class for s in slices)
        if not eligible or not selected_metrics or any(m["value"] is None for m in selected_metrics):
            outcome = "inconclusive"
            limitations.append("Selected acceptance is inconclusive because evidence, eligibility, or a frozen criterion is unavailable.")
        else:
            def accepted(m):
                a, b = m["value"], m["threshold"]["value"]
                epsilon = 1e-12 * max(1, abs(a), abs(b))
                return a <= b+epsilon if m["threshold"]["operator"] == "<=" else a >= b-epsilon
            outcome = "pass" if all(accepted(m) for m in selected_metrics) else "fail"
        for m in metrics:
            m["details"]["acceptanceRole"] = "criterion" if m["threshold"] is not None else "supplemental_descriptive"
            if m["name"] in METRIC_ALIASES:
                m["details"]["engineMetricName"] = m["name"]
                m["name"] = METRIC_ALIASES[m["name"]]
        limitations.append("Only selected named internal criteria determine this projection; the unchanged external report retains its own conservative outcome and supplemental evidence.")
        if minimum_class == 1:
            limitations.append("The engine's full report applies a conservative minimum class count of two; this hosted projection separately applies the frozen minimum of one.")
        result_list.append({"testId": test, "label": LABELS[test], "article": "10" if test in FAIRNESS else "15", "outcome": outcome, "metrics": metrics, "limitations": list(dict.fromkeys(limitations))})
    return result_list


def evidence_envelope(report, claim, *, image_digest, execution):
    request = claim.request
    hashes = {"dataset": report["provenance"]["inputHashes"]["data"]}
    if report["provenance"]["inputHashes"].get("model"):
        hashes["modelArtifact"] = report["provenance"]["inputHashes"]["model"]
    if request["inputHashes"].get("preprocessing"):
        hashes["preprocessing"] = valid_hash(request["inputHashes"]["preprocessing"], "preprocessing")
    return {"schemaVersion": "1.0", "externalReport": report, "hostedResults": hosted_results(report, request), "provenance": {"requestSha256": claim.request_sha256, "inputHashes": hashes, "workerVersion": WORKER_VERSION, "translationVersion": TRANSLATION_VERSION, "imageDigest": image_digest, "executionMode": request["executionMode"], "execution": execution, "externalReportSha256": report["reportSha256"], "preprocessingScope": "Preprocessing hashes are source declarations only; this worker scores already prepared numeric columns and does not execute preprocessing artifacts."}}


def completion_body(claim, result_bytes):
    if len(result_bytes) > MAX_RESULT_BYTES:
        raise ValueError("Evidence envelope exceeds completion byte limits")
    # Decode the exact created-once file, never parse/reserialize resultJSON.
    text = result_bytes.decode("utf-8")
    strict_json(text, maximum=MAX_RESULT_BYTES)
    body = json_bytes({"op": "complete", **claim.pins(), "resultJSON": text, "resultSha256": sha256(result_bytes)})
    if len(body) > MAX_COMPLETION_BYTES:
        raise ValueError("Exact completion body exceeds the server byte limit")
    return body
