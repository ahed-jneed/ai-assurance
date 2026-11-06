"""Versioned worker transport and hosted engineConfig 1.1/1.4 to engine 1.3 translation.

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
from . import statistics as stats
from .diagnostics import MAX_BYTES, canonical_bytes, finite_number, sha256, validate_config
from .errors import EngineError

# 1.3.0: client-local jobs whose dataset stays with the client (#102): the worker reads the file from its
# local client data directory by the frozen SHA-256 pin and downloads nothing; only aggregates are returned.
WORKER_VERSION = "1.3.0"
# 2.0.0: hosted engineConfig 1.1 (derived plan) and 1.4 (explicit plan) become engine configuration 1.3,
# and hostedResults copy the engine's statistics 1.0.0 decisions (docs/design/audit-statistics.md E4).
# 2.1.0: the performance rules of test definitions traditional-ml-2.1.0 (#65): binary performance is measured
# on the frozen performancePositiveLabel while fairness counts the favourable label, and performance results
# report prevalence, the majority-class baseline accuracy, a per-class table and predicted labels absent
# from the reference column.
TRANSLATION_VERSION = "hosted-1.1-1.4-to-engine-1.3/2.1.0"
ENGINE_CONFIG_VERSIONS = {"1.1", "1.4"}
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
    "client_dataset_unavailable",
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
    # A client-held dataset (#102) has no bytes on the platform; only the
    # client's own worker, in client-local mode, can read it.
    if "custody" in data and (data["custody"] != "client" or request["executionMode"] != "client_local"):
        raise ValueError("Only a client-local request can pin a client-held dataset")
    config = request["engineConfig"]
    if config.get("contractVersion") not in ENGINE_CONFIG_VERSIONS:
        raise ValueError("Worker requires frozen hosted engineConfig contractVersion 1.1 or 1.4")
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
    if config["contractVersion"] == "1.4":
        validate_plan_request(config)
    elif "statistics" in config:
        raise ValueError("A statistics plan requires engineConfig contractVersion 1.4")
    if "modelSpec" in config:
        validate_model_spec(config["modelSpec"], TASKS[config["task"]])
        if request["executionMode"] == "auditor_model" and config["task"] == "Binary classification":
            # The same check compute makes, here so that a model whose labels
            # are not the frozen pair fails at claim time, before any download.
            binary_labels(config, inference=True)


def client_held(request):
    """The frozen dataset stays in the client's environment; the platform holds only its pin."""
    return request["dataset"].get("custody") == "client"


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


def integer(config, key, default, maximum=1_000_000, minimum=1):
    value = config.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError("Invalid "+key)
    return value


def plan_families(plan):
    """Section 11.2: the hosted test families a plan's criteria use (a 1.4 profile's suite, as a set)."""
    names = {"selection_rate_difference": "demographic_parity", "selection_rate_ratio": "disparate_impact", "equalized_odds": "equalized_odds"}
    return {"regression" if c["kind"] == "regression_performance" else names[c["metric"]] if c["kind"] == "group_comparison" else "performance" for c in plan["criteria"]}


def validate_plan_request(config):
    """engineConfig 1.4 (section 11.1): an explicit plan, the profile's declared label pair, and a suite
    that is exactly the families of the plan's criteria. Hosted plans have no calibration criteria."""
    plan = stats.validate_plan(config.get("statistics"))
    if any(c["kind"] == "calibration" for c in plan["criteria"]):
        raise ValueError("A hosted plan cannot contain calibration criteria")
    if plan["clusterField"] is not None:
        raise ValueError("A hosted plan cannot declare a cluster design")
    if plan_families(plan) != set(config["suite"]):
        raise ValueError("engineConfig suite must equal the families of the plan's criteria")
    allowed = {"labelColumn", "predictionColumn", "groupColumn", "positiveLabel", "negativeLabel", "performancePositiveLabel"}
    if set(config["config"]) - allowed:
        raise ValueError("engineConfig 1.4 config holds only column mappings and the declared labels")
    if config["task"] == "Binary classification" and config.get("negativeLabel") != config["config"].get("negativeLabel"):
        raise ValueError("engineConfig.negativeLabel must equal config.negativeLabel")
    return plan


def target_label_count(rows, column):
    """k for the multiclass chance baseline: the labels that occur in the target column (section 9.3)."""
    return len({str(row[column]).strip() for row in rows if str(row.get(column, "")).strip()})


def hosted_plan(hosted, rows, task, target_column):
    """Section 9.3: derive the hosted plan of an engineConfig 1.1 request, minimums raised to the floors."""
    c = hosted["config"]
    selected = hosted["suite"]

    def criterion(field, default=None, upper=1.0):
        value = finite_number(c.get(field, default), field)
        if not 0 <= value <= upper:
            raise ValueError("Invalid acceptance criterion "+field)
        return value

    legacy = {"minimumGroupSize": integer(c, "minimumGroupSize", 30), "minimumSampleSize": integer(c, "minimumSampleSize", 20), "minimumClassCount": integer(c, "minimumClassCount", 5)}
    if "performance" in selected:
        legacy["minimumAccuracy"] = criterion("minimumAccuracy")
        if task == "binary_classification":
            legacy["minimumRecall"] = criterion("minimumRecall", .7)
        else:
            legacy["minimumMacroF1"] = criterion("minimumMacroF1", .7)
    if "regression" in selected:
        legacy["maximumRmse"] = criterion("maximumRmse", 1, 1e100)
    if {"demographic_parity", "equalized_odds"} & set(selected):
        legacy["maximumParityGap"] = criterion("maximumParityGap", .1)
    if "equalized_odds" in selected:
        legacy["maximumOddsGap"] = criterion("maximumOddsGap", legacy["maximumParityGap"])
    if "disparate_impact" in selected:
        legacy["minimumImpactRatio"] = criterion("minimumImpactRatio")
    for key in ("minimumAccuracy", "maximumParityGap", "minimumImpactRatio"):
        legacy.setdefault(key, 0.0)
    k = target_label_count(rows, target_column) if task == "multiclass_classification" else 0
    data = {"matrix": [[1]] * k} if task == "multiclass_classification" else None
    plan = stats.derive_hosted({"task": hosted["task"], "suite": selected, "config": legacy}, data)
    return stats.normalize_plan(plan)


def translate_config(request, rows):
    """Translate a hosted engineConfig into an engine 1.3 configuration whose plan decides every result.

    engineConfig 1.1 derives the hosted plan (section 9.3); engineConfig 1.4 carries its own plan. The
    configured and applied minimums are both recorded (section 7)."""
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
    if hosted["contractVersion"] == "1.4":
        plan = validate_plan_request(hosted)
        configured = None
    else:
        plan = hosted_plan(hosted, rows, task, columns["target"])
        configured = plan["configuredMinimums"]
    applied = plan["minimums"]
    native = {"contractVersion": "1.3", **{key: hosted[key] for key in ("id", "engagementId", "modelId", "datasetId", "seed")}, "task": task, "suite": suites, "columns": columns, "statistics": plan, "thresholds": {"policyId": hosted["policyId"], "policyVersion": hosted["policyVersion"], "source": "internal_policy", "values": {}}, "hostedTranslation": {"version": TRANSLATION_VERSION, "sourceContract": hosted["contractVersion"], "selectedTests": selected, "sourceConfiguration": copy.deepcopy(c), "minimums": {"configured": configured, "applied": applied}, "supplementalMetricPolicy": "Every result is a criterion of the recorded statistics plan; metrics without a band are descriptive and never decide."}}
    if task == "binary_classification":
        native.update(binary_labels(hosted, rows, columns, inference=inference))
        if any(criterion["kind"] == "performance" for criterion in plan["criteria"]):
            native["performancePositiveLabel"] = performance_positive_label(hosted, native)
    if "modelSpec" in hosted:
        native["modelSpec"] = copy.deepcopy(hosted["modelSpec"])
    try:
        return validate_config(native)
    except stats.StatisticsError as exc:
        raise EngineError("protocol_config_invalid", str(exc)) from exc


def performance_positive_label(hosted, labels):
    """The class binary performance is measured on (test definitions traditional-ml-2.1.0): the frozen
    performancePositiveLabel, empty or absent meaning the favourable positiveLabel. It must be one of the
    frozen label pair; fairness criteria keep counting the favourable label."""
    value = hosted["config"].get("performancePositiveLabel") or labels["positiveLabel"]
    if not isinstance(value, str) or value.strip() not in {labels["positiveLabel"], labels["negativeLabel"]}:
        raise EngineError("protocol_config_invalid", f"performancePositiveLabel {value!r} is not one of the frozen labels {[labels['positiveLabel'], labels['negativeLabel']]!r}")
    return value.strip()


def binary_labels(hosted, rows=None, columns=None, *, inference):
    """The frozen favourable and other binary labels.

    The platform freezes engineConfig.negativeLabel, so the label pair never
    depends on which labels happen to occur: a dataset with a single
    observed class is evaluated (statistics 1.0.0 decides what it supports).
    A model's outputLabels must be exactly that pair, and observed labels
    outside it are rejected when predictions are read. Only an engineConfig
    1.1 request frozen without negativeLabel and without a model reads `rows`
    (the `columns` roles).
    """
    positive = hosted["config"].get("positiveLabel")
    if not isinstance(positive, str) or not positive.strip():
        raise EngineError("protocol_config_invalid", "A favourable binary class label is required")
    labels = hosted.get("modelSpec", {}).get("outputLabels", []) if inference else None
    declared = set(labels) if inference else None
    negative = hosted.get("negativeLabel")
    if negative is None:
        if hosted.get("contractVersion") == "1.4":
            raise EngineError("protocol_config_invalid", "engineConfig 1.4 declares negativeLabel")
        # Requests frozen without negativeLabel: derive the other label.
        names = declared if inference else {row[column].strip() for row in rows for column in (columns["target"], columns["prediction"])}
        performance = hosted["config"].get("performancePositiveLabel")
        if isinstance(performance, str) and performance.strip() and performance.strip() != positive:
            # A separate performance positive class is the other label of the frozen pair.
            names = names | {performance.strip()}
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


def hosted_results(report, request):
    """The engine's decisions, copied (section 12): one result per criterion of the recorded plan, in plan
    order, never re-decided. Headline names take the hosted aliases and multiclass macro_recall becomes
    balanced_accuracy; the article follows the criterion kind."""
    validate_report(report)
    plan = report["configuration"].get("statistics")
    if plan is None:
        raise ValueError("Requested tests produced no statistics plan")
    by_id = {result["testId"]: result for result in report["results"] if "decision" in result}
    multiclass = report["configuration"]["task"] == "multiclass_classification"
    result_list = []
    for criterion in plan["criteria"]:
        source = by_id.get(criterion["id"])
        if source is None:
            raise ValueError("Requested test produced no evidence")
        metrics = copy.deepcopy(source["metrics"])
        for m in metrics:
            if m["details"]["role"] == "headline":
                m["name"] = METRIC_ALIASES.get(m["name"], m["name"])
            elif multiclass and m["name"] == "macro_recall":
                m["name"] = "balanced_accuracy"
        article = "10" if criterion["kind"] == "group_comparison" else "15"
        limitations = list(dict.fromkeys(source["limitations"] + ["The external worker copies the engine's statistics 1.0.0 decision for this criterion; it does not re-decide."]))
        result_list.append({"testId": criterion["id"], "label": LABELS.get(criterion["id"], source["label"]), "article": article, "outcome": source["outcome"], "metrics": metrics, "limitations": limitations, "decision": copy.deepcopy(source["decision"])})
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
