"""Deterministic, dependency-free diagnostics over precomputed predictions.

Acceptance thresholds are frozen internal audit policies. These metrics are
evidence for a qualified reviewer, not an EU AI Act compliance determination.
"""
from __future__ import annotations

import bisect
import csv
import hashlib
import io
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__
from .errors import EngineError
from .provenance import definition_versions, runtime_dependencies

MAX_BYTES = 100 * 1024 * 1024
MAX_ROWS = 1_000_000
MAX_COLUMNS = 1000
CONFIDENCE = 0.95
SUPPORTED_SUITES = {"performance", "fairness", "drift"}
UNAVAILABLE_SUITES = {
    "shap": ("EXPL-SHAP", "SHAP explanation", "10, 13", "A fitted-model adapter and its validated background dataset are required."),
    "lime": ("EXPL-LIME", "LIME explanation", "10, 13", "A fitted-model adapter, feature schema, and a validated neighborhood sampler are required."),
    "permutation_importance": ("EXPL-PERM", "Permutation importance", "10, 13", "A fitted-model adapter is required to score permuted data; saved predictions cannot establish feature importance."),
    "cross_validation": ("ROB-CV", "Cross-validation", "15", "A reviewed training procedure, fold plan, and leakage controls are required."),
    "perturbation": ("ROB-PERT", "Perturbation robustness", "15", "A fitted-model adapter and domain-approved perturbation specification are required."),
    "adversarial": ("ROB-ADV", "Adversarial robustness", "15", "A fitted-model adapter and scoped threat model are required."),
    "inference": ("ING-INFER", "Trained-model inference", "15", "This runner consumes predictions. It never loads pickle/joblib or executes submitted model code."),
    "record_keeping": ("LOG-12", "Record-keeping validation", "12", "Inference logs, retention rules, event schema, and source-system access are required. A diagnostic run log alone is insufficient."),
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def finite_number(value: Any, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number, not a boolean")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def numeric_cell(value: str | None, name: str) -> float | None:
    if value is None or value.strip().lower() in {"", "null", "none"}:
        return None
    try:
        return finite_number(value, name)
    except ValueError as exc:
        raise EngineError("invalid_numeric_value", str(exc)) from exc


def label_cell(value: str | None) -> str | None:
    if value is None or value.strip() == "":
        return None
    return value.strip()


def read_csv(path: str | Path) -> tuple[list[dict[str, str]], dict[str, Any]]:
    source = Path(path)
    if not source.is_file() or source.suffix.lower() != ".csv":
        raise EngineError("dataset_malformed", "Input must be an existing CSV file")
    if source.stat().st_size > MAX_BYTES:
        raise EngineError("dataset_limit_exceeded", f"CSV exceeds {MAX_BYTES} byte limit")
    data = source.read_bytes()
    if len(data) > MAX_BYTES:
        raise EngineError("dataset_limit_exceeded", "CSV grew beyond size limit during read")
    try:
        reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True)
        columns = reader.fieldnames
        if columns and len(columns) > MAX_COLUMNS:
            raise EngineError("dataset_limit_exceeded", f"CSV exceeds {MAX_COLUMNS} column limit")
        if not columns or len(set(columns)) != len(columns) or any(not c.strip() for c in columns):
            raise EngineError("dataset_malformed", "CSV requires unique, nonempty column names")
        rows = []
        for row_number, row in enumerate(reader, 2):
            if None in row or any(v is None for v in row.values()):
                raise EngineError("dataset_malformed", f"CSV row {row_number} has a different number of fields from its header")
            rows.append(row)
            if len(rows) > MAX_ROWS:
                raise EngineError("dataset_limit_exceeded", f"CSV exceeds {MAX_ROWS} row limit")
    except (UnicodeError, csv.Error) as exc:
        raise EngineError("dataset_malformed", "CSV must be well-formed UTF-8") from exc
    if not rows:
        raise EngineError("dataset_malformed", "CSV contains no observations")
    return rows, {"name": source.name, "sha256": sha256(data), "bytes": len(data), "rowCount": len(rows), "columns": columns}


def validate_config(config: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise ValueError("Configuration must be an object")
    # Round-trip also copies configuration: a caller cannot mutate a running policy.
    frozen = json.loads(canonical_bytes(config))
    if frozen.get("contractVersion") != "1.0":
        raise ValueError("contractVersion must be '1.0'")
    for field in ("id", "engagementId", "modelId", "datasetId"):
        if not isinstance(frozen.get(field), str) or not frozen[field].strip():
            raise ValueError(f"{field} must be a nonempty string")
    if frozen.get("task") not in {"binary_classification", "multiclass_classification", "regression"}:
        raise ValueError("task must be binary_classification, multiclass_classification, or regression")
    suites = frozen.get("suite")
    if not isinstance(suites, list) or not suites or any(not isinstance(s, str) for s in suites) or len(set(suites)) != len(suites):
        raise ValueError("suite must contain unique suite names")
    unknown = set(suites) - SUPPORTED_SUITES - set(UNAVAILABLE_SUITES)
    if unknown:
        raise ValueError("Unknown suite: " + ", ".join(sorted(unknown)))
    seed = frozen.get("seed", 1729)
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 or seed > 2**32 - 1:
        raise ValueError("seed must be an unsigned 32-bit integer")
    frozen["seed"] = seed
    columns = frozen.get("columns", {})
    if not isinstance(columns, dict):
        raise ValueError("columns must be an object")
    if {"performance", "fairness"}.intersection(suites):
        for field in ("target", "prediction"):
            if not isinstance(columns.get(field), str) or not columns[field]:
                raise ValueError(f"columns.{field} is required")
    if "fairness" in suites and frozen["task"] == "binary_classification":
        if not isinstance(columns.get("protected"), str) or not columns["protected"]:
            raise ValueError("columns.protected is required for binary fairness")
    for field in ("score", "protected"):
        if field in columns and (not isinstance(columns[field], str) or not columns[field]):
            raise ValueError(f"columns.{field} must be a nonempty column name")
    if "drift" in suites:
        if not isinstance(frozen.get("driftFeatures"), list) or not frozen["driftFeatures"] or any(not isinstance(f, str) or not f for f in frozen["driftFeatures"]):
            raise ValueError("driftFeatures must name at least one numeric column")
        if len(set(frozen["driftFeatures"])) != len(frozen["driftFeatures"]):
            raise ValueError("driftFeatures must be unique")
    if frozen["task"] == "binary_classification":
        for field, default in (("positiveLabel", "1"), ("negativeLabel", "0")):
            frozen[field] = frozen.get(field, default)
            if not isinstance(frozen[field], str) or not frozen[field].strip():
                raise ValueError(f"{field} must be a nonempty string")
        if frozen["positiveLabel"] == frozen["negativeLabel"]:
            raise ValueError("Positive and negative labels must differ")
    for field, default in (("minGroupSize", 30), ("minClassCount", 10), ("minSampleSize", 30), ("psiBins", 10), ("calibrationBins", 10)):
        value = frozen.get(field, default)
        if not isinstance(value, int) or isinstance(value, bool) or value < 2 or value > (100 if field.endswith("Bins") else MAX_ROWS):
            raise ValueError(f"{field} is outside supported bounds")
        frozen[field] = value
    policy = frozen.get("thresholds")
    if not isinstance(policy, dict) or not isinstance(policy.get("policyId"), str) or not policy["policyId"].strip() or not isinstance(policy.get("policyVersion"), str) or not policy["policyVersion"].strip():
        raise ValueError("thresholds requires named internal policyId and policyVersion")
    if policy.get("source") != "internal_policy":
        raise ValueError("Threshold source must be 'internal_policy'; metrics have no universal EU AI Act cutoff")
    values = policy.get("values")
    if not isinstance(values, dict):
        raise ValueError("thresholds.values must be an object")
    for name, specification in values.items():
        if not isinstance(specification, dict) or specification.get("operator") not in {"<=", ">="}:
            raise ValueError(f"Threshold {name} requires operator <= or >=")
        specification["value"] = finite_number(specification.get("value"), f"Threshold {name}")
    return frozen


def wilson(successes: int, total: int) -> dict[str, Any] | None:
    if total == 0:
        return None
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z*z/total
    center = (p + z*z/(2*total)) / denominator
    radius = z * math.sqrt(p*(1-p)/total + z*z/(4*total*total)) / denominator
    return {"lower": 0.0 if successes == 0 else max(0.0, center-radius), "upper": 1.0 if successes == total else min(1.0, center+radius), "level": CONFIDENCE, "method": "Wilson score; IID binomial assumption"}


def threshold_for(config: dict[str, Any], name: str) -> dict[str, Any] | None:
    policy = config["thresholds"]
    spec = policy["values"].get(name)
    if spec is None:
        return None
    return {**spec, "policyId": policy["policyId"], "policyVersion": policy["policyVersion"], "source": "internal_policy"}


def metric(config: dict[str, Any], name: str, value: float | None, sample_size: int, *, unit: str = "ratio", numerator: int | None = None, denominator: int | None = None, details: dict[str, Any] | None = None, slices: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if value is not None and not math.isfinite(value):
        raise EngineError("invalid_numeric_value", f"Computed metric {name} overflowed; rescale numeric inputs")
    return {"name": name, "value": value, "threshold": threshold_for(config, name), "unit": unit, "sampleSize": sample_size, "numerator": numerator, "denominator": denominator, "confidenceInterval": wilson(numerator, denominator) if numerator is not None and denominator is not None else None, "slices": slices or [], "details": details or {}}


def evaluate(m: dict[str, Any]) -> str:
    if m["value"] is None or m["threshold"] is None:
        return "inconclusive"
    rule = m["threshold"]
    accepted = m["value"] <= rule["value"] if rule["operator"] == "<=" else m["value"] >= rule["value"]
    return "pass" if accepted else "fail"


def result(test_id: str, label: str, article: str, metrics: list[dict[str, Any]], limitations: list[str] | None = None, forced_outcome: str | None = None) -> dict[str, Any]:
    outcomes = [evaluate(m) for m in metrics]
    outcome = forced_outcome or ("fail" if "fail" in outcomes else "inconclusive" if not outcomes or "inconclusive" in outcomes else "pass")
    notes = list(limitations or [])
    if any(m["threshold"] is None for m in metrics):
        notes.append("A frozen internal acceptance threshold is missing; affected metrics cannot produce a pass/fail conclusion.")
    return {"testId": test_id, "label": label, "article": article, "outcome": outcome, "metrics": metrics, "limitations": notes}


def prediction_rows(rows: list[dict[str, str]], config: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    columns = config["columns"]
    required = [columns["target"], columns["prediction"]]
    required += [columns[c] for c in ("score", "protected") if c in columns]
    missing = set(required) - set(rows[0])
    if missing:
        raise EngineError("missing_column", "Missing CSV columns: " + ", ".join(sorted(missing)))
    observations = []
    for row_number, row in enumerate(rows, 2):
        if config["task"] == "regression":
            target = numeric_cell(row[columns["target"]], f"row {row_number} target")
            predicted = numeric_cell(row[columns["prediction"]], f"row {row_number} prediction")
        else:
            target = label_cell(row[columns["target"]])
            predicted = label_cell(row[columns["prediction"]])
        score = numeric_cell(row[columns["score"]], f"row {row_number} score") if "score" in columns else None
        if score is not None and not 0 <= score <= 1:
            raise EngineError("invalid_numeric_value", f"Row {row_number} score is not a probability between 0 and 1")
        if target is None or predicted is None:
            continue
        if config["task"] == "binary_classification" and (target not in {config["positiveLabel"], config["negativeLabel"]} or predicted not in {config["positiveLabel"], config["negativeLabel"]}):
            raise EngineError("label_set_mismatch", f"Unexpected binary label in row {row_number}; configure positiveLabel and negativeLabel")
        observations.append({"target": target, "prediction": predicted, "score": score, "group": label_cell(row[columns["protected"]]) if "protected" in columns else None})
    return observations, len(rows)-len(observations)


def counts(observations: list[dict[str, Any]], positive: str) -> dict[str, int]:
    return {"tp": sum(o["target"] == positive and o["prediction"] == positive for o in observations), "fp": sum(o["target"] != positive and o["prediction"] == positive for o in observations), "tn": sum(o["target"] != positive and o["prediction"] != positive for o in observations), "fn": sum(o["target"] == positive and o["prediction"] != positive for o in observations)}


def ratio(a: float, b: float) -> float | None:
    return a/b if b else None


def binary_performance(observations: list[dict[str, Any]], config: dict[str, Any], omitted: int) -> list[dict[str, Any]]:
    c = counts(observations, config["positiveLabel"])
    n = len(observations)
    tpr = ratio(c["tp"], c["tp"]+c["fn"])
    tnr = ratio(c["tn"], c["tn"]+c["fp"])
    details = {"confusionMatrix": c, "positiveLabel": config["positiveLabel"], "excludedMissingTargetOrPrediction": omitted}
    measurements = [metric(config, "accuracy", ratio(c["tp"]+c["tn"], n), n, numerator=c["tp"]+c["tn"], denominator=n, details=details), metric(config, "precision", ratio(c["tp"], c["tp"]+c["fp"]), n, numerator=c["tp"], denominator=c["tp"]+c["fp"], details=details), metric(config, "recall", tpr, n, numerator=c["tp"], denominator=c["tp"]+c["fn"], details=details), metric(config, "f1", ratio(2*c["tp"], 2*c["tp"]+c["fp"]+c["fn"]), n, details=details), metric(config, "balanced_accuracy", (tpr+tnr)/2 if tpr is not None and tnr is not None else None, n, details=details)]
    limitations = ["Performance is measured on supplied labels and predictions; independence, representativeness, temporal validity, and target leakage require review."]
    if omitted:
        limitations.append(f"Excluded {omitted} rows missing target or prediction; this may bias results.")
    insufficient = n < config["minSampleSize"] or min(c["tp"]+c["fn"], c["tn"]+c["fp"]) < config["minClassCount"]
    if insufficient:
        limitations.append("Insufficient sample size or target-class support under the frozen run configuration.")
    output = [result("PERF-BINARY", "Binary classification performance", "15", measurements, limitations, "inconclusive" if insufficient else None)]
    scored = [o for o in observations if o["score"] is not None]
    if not scored:
        output.append(result("PERF-CAL", "Probability calibration", "15", [], ["No probability scores supplied; calibration was skipped."], "not_applicable"))
        return output
    bins = [[] for _ in range(config["calibrationBins"])]
    for o in scored:
        bins[min(int(o["score"]*len(bins)), len(bins)-1)].append(o)
    slices = []
    ece = 0.0
    for index, entries in enumerate(bins):
        if not entries:
            continue
        positives = sum(o["target"] == config["positiveLabel"] for o in entries)
        mean_score = statistics.fmean(o["score"] for o in entries)
        observed = positives/len(entries)
        ece += len(entries)/len(scored)*abs(mean_score-observed)
        slices.append({"slice": f"probability_bin_{index}", "lower": index/len(bins), "upper": (index+1)/len(bins), "n": len(entries), "meanProbability": mean_score, "observedRate": observed, "numerator": positives, "denominator": len(entries), "confidenceInterval": wilson(positives, len(entries))})
    brier = statistics.fmean((o["score"]-int(o["target"] == config["positiveLabel"]))**2 for o in scored)
    notes = [f"Calibration uses {len(scored)} of {n} valid prediction rows; probability scores refer to positive label {config['positiveLabel']!r}.", "ECE depends on fixed equal-width probability bins; sparse bins and prevalence shift require review."]
    if len(scored) < config["minSampleSize"]:
        notes.append("Calibration has insufficient scored observations.")
    output.append(result("PERF-CAL", "Probability calibration", "15", [metric(config, "brier_score", brier, len(scored), details={"formula": "mean squared probability error"}), metric(config, "expected_calibration_error", ece, len(scored), slices=slices, details={"bins": len(bins), "excludedMissingScore": n-len(scored)})], notes, "inconclusive" if len(scored) < config["minSampleSize"] else None))
    return output


def multiclass_performance(observations: list[dict[str, Any]], config: dict[str, Any], omitted: int) -> list[dict[str, Any]]:
    labels = sorted({o["target"] for o in observations} | {o["prediction"] for o in observations})
    if len(labels) > 100:
        raise EngineError("cardinality_limit_exceeded", "Multiclass evaluation is limited to 100 labels; revise the protocol for high-cardinality outcomes")
    n = len(observations)
    cells = defaultdict(int)
    for observation in observations:
        cells[(observation["target"], observation["prediction"])] += 1
    confusion = [[cells[(actual, predicted)] for predicted in labels] for actual in labels]
    slices = []
    for i, label in enumerate(labels):
        tp = confusion[i][i]
        support = sum(confusion[i])
        predicted = sum(row[i] for row in confusion)
        precision = ratio(tp, predicted)
        recall = ratio(tp, support)
        f1 = ratio(2*tp, support+predicted)
        slices.append({"slice": label, "n": support, "tp": tp, "predictedCount": predicted, "precision": precision, "recall": recall, "f1": f1, "recallConfidenceInterval": wilson(tp, support)})
    macro = lambda name: statistics.fmean(s[name] for s in slices) if slices and all(s[name] is not None for s in slices) else None
    correct = sum(confusion[i][i] for i in range(len(labels)))
    details = {"labels": labels, "confusionMatrix": confusion, "excludedMissingTargetOrPrediction": omitted, "undefinedClassPolicy": "Undefined per-class metric makes macro metric inconclusive; it is not silently coerced to zero."}
    measurements = [metric(config, "accuracy", ratio(correct, n), n, numerator=correct, denominator=n, details=details, slices=slices), metric(config, "macro_precision", macro("precision"), n, slices=slices, details=details), metric(config, "macro_recall", macro("recall"), n, slices=slices, details=details), metric(config, "macro_f1", macro("f1"), n, slices=slices, details=details)]
    insufficient = n < config["minSampleSize"] or len(labels) < 2 or any(s["n"] < config["minClassCount"] for s in slices)
    notes = ["Saved predictions do not establish cross-validation, dataset independence, or freedom from leakage."]
    if omitted:
        notes.append(f"Excluded {omitted} rows missing target or prediction.")
    if insufficient:
        notes.append("Insufficient total or per-class support under the frozen run configuration.")
    return [result("PERF-MULTI", "Multiclass classification performance", "15", measurements, notes, "inconclusive" if insufficient else None)]


def regression_performance(observations: list[dict[str, Any]], config: dict[str, Any], omitted: int) -> list[dict[str, Any]]:
    n = len(observations)
    if n:
        errors = [o["prediction"]-o["target"] for o in observations]
        mae = statistics.fmean(abs(e) for e in errors)
        squared_errors = [e*e for e in errors]
        rmse = math.sqrt(statistics.fmean(squared_errors))
        mean_target = statistics.fmean(o["target"] for o in observations)
        total_sum_squares = sum((o["target"]-mean_target)**2 for o in observations)
        r2 = 1-sum(squared_errors)/total_sum_squares if n >= 2 and total_sum_squares > 0 else None
    else:
        mae = rmse = r2 = None
    notes = ["R² is undefined for a constant target; no interval is fabricated for regression error metrics.", "Saved predictions do not establish cross-validation, dataset independence, or freedom from leakage."]
    if omitted:
        notes.append(f"Excluded {omitted} rows missing target or prediction.")
    if n < config["minSampleSize"]:
        notes.append("Insufficient valid regression observations.")
    return [result("PERF-REG", "Regression performance", "15", [metric(config, "mae", mae, n, unit="target_units"), metric(config, "rmse", rmse, n, unit="target_units"), metric(config, "r2", r2, n, unit="dimensionless")], notes, "inconclusive" if n < config["minSampleSize"] else None)]


def fairness(observations: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    if config["task"] != "binary_classification":
        return [result("FAIR-SCOPE", "Binary outcome fairness suite", "10", [], ["These fairness definitions require a binary decision. A task-specific group-fairness protocol is required for regression or multiclass tasks."], "not_applicable")]
    groups = defaultdict(list)
    for observation in observations:
        if observation["group"] is not None:
            groups[observation["group"]].append(observation)
    if len(groups) > 1000:
        raise EngineError("cardinality_limit_exceeded", "Fairness evaluation is limited to 1000 protected groups; revise the grouping protocol")
    slices = []
    for group in sorted(groups):
        entries = groups[group]
        c = counts(entries, config["positiveLabel"])
        positives = c["tp"]+c["fn"]
        negatives = c["tn"]+c["fp"]
        selected = c["tp"]+c["fp"]
        slices.append({"slice": group, "n": len(entries), "selectionRate": selected/len(entries), "selectionNumerator": selected, "selectionDenominator": len(entries), "selectionConfidenceInterval": wilson(selected, len(entries)), "tpr": ratio(c["tp"], positives), "tprNumerator": c["tp"], "tprDenominator": positives, "tprConfidenceInterval": wilson(c["tp"], positives), "fpr": ratio(c["fp"], negatives), "fprNumerator": c["fp"], "fprDenominator": negatives, "fprConfidenceInterval": wilson(c["fp"], negatives), "confusionMatrix": c})
    valid_n = sum(s["n"] for s in slices)
    base_notes = ["Descriptive group comparisons are not a causal finding of discrimination or a legal compliance verdict.", "Metrics may conflict; protected-attribute collection requires an independently established lawful basis and access controls.", "Intervals assume independent observations; clustered or repeated records require a different protocol."]
    missing = len(observations)-valid_n
    if missing:
        base_notes.append(f"Excluded {missing} prediction rows with missing protected-group membership; representativeness requires review.")
    sufficient = len(slices) >= 2 and all(s["n"] >= config["minGroupSize"] for s in slices)
    if not sufficient:
        base_notes.append("Fewer than two eligible groups or at least one group below minGroupSize; all observed groups remain visible, and acceptance is inconclusive.")
    rates = [s["selectionRate"] for s in slices]
    difference = max(rates)-min(rates) if len(rates) >= 2 else None
    di = min(rates)/max(rates) if len(rates) >= 2 and max(rates) > 0 else None
    dp_details = {"comparison": "maximum minus minimum group selection rate", "minGroupSize": config["minGroupSize"], "missingGroupCount": missing}
    di_details = {"comparison": "minimum divided by maximum group selection rate", "reference": "highest observed selection rate", "zeroDenominatorPolicy": "undefined; inconclusive"}
    dp = result("FAIR-DP", "Demographic parity difference", "10", [metric(config, "demographic_parity_difference", difference, valid_n, slices=slices, details=dp_details)], base_notes, "inconclusive" if not sufficient else None)
    di_result = result("FAIR-DI", "Disparate impact ratio", "10", [metric(config, "disparate_impact_ratio", di, valid_n, slices=slices, details=di_details)], base_notes, "inconclusive" if not sufficient else None)
    eo_sufficient = sufficient and all(min(s["tprDenominator"], s["fprDenominator"]) >= config["minClassCount"] for s in slices)
    all_rates_defined = len(slices) >= 2 and all(s["tpr"] is not None and s["fpr"] is not None for s in slices)
    tpr_gap = max(s["tpr"] for s in slices)-min(s["tpr"] for s in slices) if all_rates_defined else None
    fpr_gap = max(s["fpr"] for s in slices)-min(s["fpr"] for s in slices) if all_rates_defined else None
    eo = max(tpr_gap, fpr_gap) if all_rates_defined else None
    eo_notes = base_notes + ([] if eo_sufficient else ["Insufficient positive/negative target support in at least one group for equalized odds."])
    eo_result = result("FAIR-EO", "Equalized odds difference", "10", [metric(config, "equalized_odds_difference", eo, valid_n, slices=slices, details={"tprGap": tpr_gap, "fprGap": fpr_gap, "comparison": "maximum of TPR range and FPR range", "minClassCount": config["minClassCount"]})], eo_notes, "inconclusive" if not eo_sufficient else None)
    return [dp, di_result, eo_result]


def reference_edges(values: list[float], bins: int) -> list[float]:
    sorted_values = sorted(values)
    # Interior cuts are learned once from the reference only. Duplicate cuts
    # collapse deterministically, including the constant-reference case.
    return sorted(set(sorted_values[min(len(values)-1, math.ceil(len(values)*i/bins)-1)] for i in range(1, bins)))


def psi(reference: list[float], current: list[float], bins: int) -> tuple[float, dict[str, Any]]:
    edges = reference_edges(reference, bins)
    reference_counts = [0]*(len(edges)+1)
    current_counts = [0]*(len(edges)+1)
    for value in reference:
        reference_counts[bisect.bisect_left(edges, value)] += 1
    for value in current:
        current_counts[bisect.bisect_left(edges, value)] += 1
    # Jeffreys pseudocounts keep proportions normalized and avoid log(0).
    k = len(reference_counts)
    rp = [(count+0.5)/(len(reference)+0.5*k) for count in reference_counts]
    cp = [(count+0.5)/(len(current)+0.5*k) for count in current_counts]
    value = sum((c-r)*math.log(c/r) for r, c in zip(rp, cp))
    return value, {"referenceEdges": edges, "edgeRule": "(-inf, cut1], (cut1, cut2], ..., (lastCut, +inf)", "referenceCounts": reference_counts, "currentCounts": current_counts, "smoothing": "Jeffreys 0.5 pseudocount per bin; proportions renormalized", "requestedBins": bins, "effectiveBins": k}


def ks_statistic(reference: list[float], current: list[float]) -> float:
    a, b = sorted(reference), sorted(current)
    return max(abs(bisect.bisect_right(a, point)/len(a)-bisect.bisect_right(b, point)/len(b)) for point in sorted(set(a+b)))


def ks_asymptotic_pvalue(statistic: float, n: int, m: int) -> float:
    if statistic == 0:
        return 1.0
    effective = math.sqrt(n*m/(n+m))
    lam = (effective+0.12+0.11/effective)*statistic
    if lam < 1.18:
        cdf = math.sqrt(2*math.pi)/lam*sum(math.exp(-((2*k-1)**2)*math.pi**2/(8*lam**2)) for k in range(1, 101))
        return max(0.0, min(1.0, 1-cdf))
    return max(0.0, min(1.0, 2*sum((-1)**(k-1)*math.exp(-2*k*k*lam*lam) for k in range(1, 101))))


def wasserstein(reference: list[float], current: list[float]) -> float:
    a, b = sorted(reference), sorted(current)
    points = sorted(set(a+b))
    return sum((right-left)*abs(bisect.bisect_right(a, left)/len(a)-bisect.bisect_right(b, left)/len(b)) for left, right in zip(points, points[1:]))


def drift(rows: list[dict[str, str]], reference: list[dict[str, str]] | None, config: dict[str, Any]) -> list[dict[str, Any]]:
    if reference is None:
        return [result("DRIFT-INPUT", "Numeric distribution drift", "10, 15", [], ["Reference dataset is absent; no baseline was invented."], "inconclusive")]
    output = []
    # Test IDs must match the shared schema's identifier pattern. Column names
    # may contain spaces or any Unicode, so they stay in labels and details.
    for index, feature in enumerate(config["driftFeatures"], 1):
        test_id = f"DRIFT-{index}"
        if feature not in rows[0] or feature not in reference[0]:
            raise EngineError("missing_column", f"Drift feature {feature!r} is missing in current or reference CSV")
        a_raw = [numeric_cell(row[feature], f"reference row {i+2} feature {feature}") for i, row in enumerate(reference)]
        b_raw = [numeric_cell(row[feature], f"current row {i+2} feature {feature}") for i, row in enumerate(rows)]
        a = [v for v in a_raw if v is not None]
        b = [v for v in b_raw if v is not None]
        missing_details = {"feature": feature, "referenceN": len(a), "currentN": len(b), "referenceMissing": len(a_raw)-len(a), "currentMissing": len(b_raw)-len(b), "referenceMissingRate": (len(a_raw)-len(a))/len(a_raw), "currentMissingRate": (len(b_raw)-len(b))/len(b_raw)}
        if not a or not b:
            output.append(result(test_id, f"Distribution drift: {feature}", "10, 15", [], ["At least one dataset has no finite observed feature values; missingness is not evidence of distribution stability."], "inconclusive"))
            continue
        psi_value, psi_details = psi(a, b, config["psiBins"])
        ks = ks_statistic(a, b)
        ks_details = {**missing_details, "asymptoticPValue": ks_asymptotic_pvalue(ks, len(a), len(b)), "pValueMethod": "two-sample asymptotic Kolmogorov approximation; not exact; ties/discrete data violate its continuous-distribution assumption", "decisionUses": "KS statistic threshold, not p-value", "multiplicity": "No multiplicity-corrected inference; each feature is a descriptive screening control."}
        measurements = [metric(config, "psi:"+feature, psi_value, len(b), unit="dimensionless", details={**missing_details, **psi_details}), metric(config, "ks:"+feature, ks, len(b), details=ks_details), metric(config, "wasserstein:"+feature, wasserstein(a, b), len(b), unit="feature_units", details=missing_details)]
        notes = ["Distribution change does not itself establish model degradation or regulatory noncompliance.", "Missing values are excluded and missingness rates are separately recorded; review missingness change.", "Reference selection, seasonality, dependence, multiple-feature testing, and feature scale require review."]
        insufficient = min(len(a), len(b)) < config["minSampleSize"]
        if insufficient:
            notes.append("Insufficient current or reference numeric observations.")
        output.append(result(test_id, f"Distribution drift: {feature}", "10, 15", measurements, notes, "inconclusive" if insufficient else None))
    return output


def paper_for(run: dict[str, Any], diagnostic: dict[str, Any]) -> dict[str, Any]:
    versions = run["provenance"].get("inputs", {}).get("testDefinitions")
    test_version = versions[diagnostic["testId"]] if versions is not None else definition_versions([diagnostic["testId"]])[diagnostic["testId"]]
    runner_version = run["provenance"]["runnerVersion"]
    paper_id = "wp-"+sha256(canonical_bytes([run["id"], run["provenance"]["configSha256"], run["provenance"]["inputHashes"], runner_version, diagnostic["testId"], test_version]))[:24]
    return {"id": paper_id, "schemaVersion": "1.0", "engagementId": run["engagementId"], "modelId": run["modelId"], "runId": run["id"], "templateId": "automated-diagnostic-v1", "title": diagnostic["label"], "status": "draft", "objective": f"Evaluate {diagnostic['label'].lower()} using frozen internal policy criteria.", "regulatoryMapping": {"regulation": "EU 2024/1689", "articleReferences": diagnostic["article"], "mappingKind": "supporting evidence; reviewer must determine applicability"}, "procedure": {"testId": diagnostic["testId"], "runnerVersion": runner_version, "testDefinitionVersion": test_version, "configurationSha256": run["provenance"]["configSha256"]}, "evidence": {"inputHashes": run["provenance"]["inputHashes"], "metrics": diagnostic["metrics"]}, "exceptions": diagnostic["limitations"], "proposedConclusion": diagnostic["outcome"], "review": {"required": True, "preparerId": "diagnostic-runner", "reviewerId": None, "reviewedAt": None, "signOffs": []}, "version": 1}


def _inference(call, records):
    """Score through an adapter; native runtimes raise their own error types."""
    try:
        return list(call(records))
    except (EngineError, MemoryError):
        # MemoryError is compute_resource_exhausted, not a model defect.
        raise
    except Exception as exc:
        # Native messages can echo arbitrary content; keep only the type.
        raise EngineError("model_inference_failed", "Model inference raised "+type(exc).__name__) from exc


def run(data_path: str | Path, config: dict[str, Any], reference_path: str | Path | None = None, *, adapter=None) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc).isoformat()
    frozen = validate_config(config)
    from .connectors import read_dataset
    rows, current_meta = read_dataset(data_path)
    reference_rows, reference_meta = read_dataset(reference_path) if reference_path else (None, None)
    if adapter is not None:
        if adapter.descriptor.task != frozen["task"]:
            raise EngineError("model_interface_mismatch", "Adapter task differs from frozen run configuration")
        if frozen.get("modelSpec") != adapter.spec:
            raise EngineError("model_interface_mismatch", "Adapter modelSpec must be bound into the frozen configuration")
        # The decision threshold applies to this label's probability.
        if frozen["task"] == "binary_classification" and getattr(adapter, "positive_label", None) not in (None, frozen["positiveLabel"]):
            raise EngineError("label_set_mismatch", "Adapter favourable label differs from the frozen positiveLabel")
        absent = [feature.name for feature in adapter.descriptor.feature_schema if feature.name not in rows[0]]
        if absent:
            raise EngineError("missing_column", "Model feature columns are absent: "+", ".join(map(repr, absent)))
        feature_rows = [{feature.name: numeric_cell(row[feature.name], "model feature "+feature.name) for feature in adapter.descriptor.feature_schema} for row in rows]
        if any(value is None for record in feature_rows for value in record.values()):
            raise EngineError("missing_value", "Model inference requires complete numeric features; apply reviewed preprocessing before ingestion")
        predictions = _inference(adapter.predict, feature_rows)
        if len(predictions) != len(rows):
            raise EngineError("model_output_invalid", "Model returned a different number of predictions")
        rows = [{**row, frozen["columns"]["prediction"]: str(prediction)} for row, prediction in zip(rows, predictions)]
        if "score" in frozen["columns"]:
            score_column = frozen["columns"]["score"]
            if "probability" in adapter.capabilities and frozen["task"] == "binary_classification":
                probabilities = _inference(adapter.predict_probability, feature_rows)
                positive_index = adapter.descriptor.output_labels.index(frozen["positiveLabel"])
                if len(probabilities) != len(rows) or any(len(values) != 2 for values in probabilities):
                    raise EngineError("model_output_invalid", "Binary model probability dimensions differ from declared labels")
                for row, values in zip(rows, probabilities):
                    try:
                        numeric = [finite_number(value, "model probability") for value in values]
                    except ValueError as exc:
                        raise EngineError("model_output_invalid", str(exc)) from exc
                    if any(not 0 <= value <= 1 for value in numeric) or not math.isclose(sum(numeric), 1.0, abs_tol=1e-5):
                        raise EngineError("model_output_invalid", "Model probabilities must lie in [0,1] and sum to one")
                    row[score_column] = str(numeric[positive_index])
            else:
                # Never attach saved probabilities from a different model to
                # freshly computed predictions.
                for row in rows:
                    row[score_column] = ""
    diagnostics = []
    if {"performance", "fairness"}.intersection(frozen["suite"]):
        observations, omitted = prediction_rows(rows, frozen)
        if "performance" in frozen["suite"]:
            handlers = {"binary_classification": binary_performance, "multiclass_classification": multiclass_performance, "regression": regression_performance}
            diagnostics.extend(handlers[frozen["task"]](observations, frozen, omitted))
        if "fairness" in frozen["suite"]:
            fairness_results = fairness(observations, frozen)
            if omitted:
                for diagnostic in fairness_results:
                    diagnostic["limitations"].append(f"Excluded {omitted} input rows missing target or prediction before group comparison.")
            diagnostics.extend(fairness_results)
    from_predictions = list(diagnostics)
    if "drift" in frozen["suite"]:
        diagnostics.extend(drift(rows, reference_rows, frozen))
    for suite in frozen["suite"]:
        if suite in UNAVAILABLE_SUITES:
            if adapter is not None and suite in {"inference", "permutation_importance", "perturbation"}:
                if suite == "inference":
                    diagnostics.append(result("ING-INFER", "Trained-model inference", "15", [metric(frozen, "inference_row_count", len(rows), len(rows), unit="rows", details={"adapterFormat": adapter.descriptor.format, "modelSha256": adapter.descriptor.artifact_sha256})], ["Inference completed using a client-owned trusted adapter; this does not validate model accuracy or certify artifact safety."]))
                else:
                    from .model_diagnostics import permutation_importance, perturbation
                    diagnostics.append((permutation_importance if suite == "permutation_importance" else perturbation)(rows, frozen, adapter))
                from_predictions.append(diagnostics[-1])
                continue
            test_id, label, article, reason = UNAVAILABLE_SUITES[suite]
            diagnostics.append(result(test_id, label, article, [], ["Capability unavailable in this runner: "+reason], "inconclusive"))
    # How the adapter produced its predictions (for example class labels that
    # bypass the frozen threshold) qualifies every result built on them.
    adapter_notes = list(getattr(adapter, "limitations", None) or ()) if adapter is not None else []
    for diagnostic in from_predictions:
        diagnostic["limitations"].extend(adapter_notes)
    outcomes = [r["outcome"] for r in diagnostics]
    overall = "fail" if "fail" in outcomes else "inconclusive" if "inconclusive" in outcomes else "pass" if "pass" in outcomes else "not_applicable"
    input_hashes = {"data": current_meta["sha256"], "reference": reference_meta["sha256"] if reference_meta else None}
    if adapter is not None:
        input_hashes["model"] = adapter.descriptor.artifact_sha256
    dependencies, dependency_notes = runtime_dependencies(adapter, (current_meta, reference_meta))
    report = {"contractVersion": "1.0", "id": frozen["id"], "engagementId": frozen["engagementId"], "modelId": frozen["modelId"], "datasetId": frozen["datasetId"], "suite": frozen["suite"], "thresholds": frozen["thresholds"], "seed": frozen["seed"], "state": "succeeded", "outcome": overall, "overallOutcome": overall, "startedAt": started_at, "configuration": frozen, "provenance": {"runnerVersion": __version__, "inputHashes": input_hashes, "configSha256": sha256(canonical_bytes(frozen)), "inputs": {"data": current_meta, "reference": reference_meta}, "determinism": "No sampling or randomized computation; seed reserved for adapter protocols", "dependencies": dependencies}, "results": diagnostics, "limitations": ["This is a diagnostic evidence report. It does not determine legal compliance or replace an authorized auditor's judgment.", "Local hashes and exclusive file creation support integrity; organizational immutability requires signed manifests, object-lock storage, retention controls, and authorized custody."], "paperIds": [], "workingPapers": []}
    report["provenance"]["inputs"]["testDefinitions"] = definition_versions(diagnostic["testId"] for diagnostic in diagnostics)
    report["limitations"].extend(dependency_notes+adapter_notes)
    report["workingPapers"] = [paper_for(report, diagnostic) for diagnostic in diagnostics]
    report["provenance"]["policyVersion"] = frozen["thresholds"]["policyVersion"]
    if adapter is not None:
        report["provenance"]["adapterVersion"] = adapter.descriptor.adapter_version
        report["provenance"]["inputs"]["model"] = {"sha256": adapter.descriptor.artifact_sha256, "format": adapter.descriptor.format, "featureColumns": [feature.name for feature in adapter.descriptor.feature_schema]}
        report["provenance"]["determinism"] = "Seeded permutation protocol; deterministic feature perturbations; adapter-native determinism requires separate validation"
    report["paperIds"] = [paper["id"] for paper in report["workingPapers"]]
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    report["reportSha256"] = sha256(canonical_bytes(report))
    return report


def write_report(report: dict[str, Any], output_path: str | Path) -> None:
    """Create once. Existing reports are never overwritten."""
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False)+"\n"
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)


def verify_report(report: dict[str, Any]) -> bool:
    expected = report.get("reportSha256")
    body = {key: value for key, value in report.items() if key != "reportSha256"}
    return isinstance(expected, str) and expected == sha256(canonical_bytes(body))
