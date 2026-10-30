"""Model-backed diagnostics for trusted application-owned numeric adapters."""
from __future__ import annotations

import math
import random
import statistics

from .diagnostics import finite_number, label_cell, metric, numeric_cell, result


def features_and_targets(rows, config, adapter):
    if len(rows) > 100_000 or len(adapter.descriptor.feature_schema) > 100:
        raise ValueError("Model-backed diagnostics require <=100000 rows and <=100 features")
    records, targets = [], []
    target_column = config["columns"]["target"]
    for row in rows:
        target = numeric_cell(row.get(target_column), "regression target") if config["task"] == "regression" else label_cell(row.get(target_column))
        if target is None:
            continue
        if config["task"] != "regression" and target not in adapter.descriptor.output_labels:
            raise ValueError("Evaluation target differs from declared model outputLabels")
        record = {}
        for feature in adapter.descriptor.feature_schema:
            value = numeric_cell(row.get(feature.name), "feature "+feature.name)
            if value is None:
                raise ValueError("Model-backed diagnostics require complete numeric features; apply reviewed preprocessing before ingestion")
            record[feature.name] = value
        records.append(record)
        targets.append(target)
    if not records:
        raise ValueError("Model-backed diagnostics have no observed targets")
    return records, targets


def loss(adapter, records, targets, task):
    predictions = list(adapter.predict(records))
    if len(predictions) != len(targets):
        raise ValueError("Model prediction count differs from evaluation row count")
    if task == "regression":
        values = [finite_number(value, "model prediction") for value in predictions]
        return statistics.fmean(abs(value-target) for value, target in zip(values, targets))
    labels = [str(value) for value in predictions]
    if any(value not in adapter.descriptor.output_labels for value in labels):
        raise ValueError("Model output does not match declared class labels")
    return sum(value != target for value, target in zip(labels, targets))/len(targets)


def permutation_importance(rows, config, adapter):
    records, targets = features_and_targets(rows, config, adapter)
    protocol = config.get("permutation", {})
    repeats = protocol.get("repeats", 5)
    if not isinstance(repeats, int) or isinstance(repeats, bool) or not 2 <= repeats <= 20:
        raise ValueError("Permutation repeats must be between 2 and 20")
    baseline = loss(adapter, records, targets, config["task"])
    rng = random.Random(config["seed"])
    metrics = []
    for feature in adapter.descriptor.feature_schema:
        original = [record[feature.name] for record in records]
        changes = []
        for _ in range(repeats):
            shuffled = list(original)
            rng.shuffle(shuffled)
            modified = [{**record, feature.name: value} for record, value in zip(records, shuffled)]
            changes.append(loss(adapter, modified, targets, config["task"])-baseline)
        metric_name = ("permutation_mae_increase:" if config["task"] == "regression" else "permutation_accuracy_drop:")+feature.name
        details = {"feature": feature.name, "baselineLoss": baseline, "loss": "mae" if config["task"] == "regression" else "classification_error", "repeats": repeats, "repeatLossIncreases": changes, "repeatStandardDeviation": statistics.stdev(changes), "seed": config["seed"], "method": "independent column shuffle; mean held-out loss increase", "scope": "exploratory feature relevance, not a causal explanation"}
        metrics.append(metric(config, metric_name, statistics.fmean(changes), len(records), unit="target_units" if config["task"] == "regression" else "ratio", details=details))
    notes = ["Correlated features can share importance; independent permutations may create unrealistic joint feature combinations.", "Repeat variability is descriptive Monte Carlo variation, not a confidence interval for population importance.", "The evaluation dataset must be independently held out; this runner does not certify independence."]
    insufficient = len(records) < config["minSampleSize"]
    if insufficient:
        notes.append("Insufficient valid evaluation observations.")
    return result("EXPL-PERM", "Permutation importance", "10, 13", metrics, notes, "inconclusive" if insufficient else None)


def perturbation(rows, config, adapter):
    protocol = config.get("perturbation")
    if not isinstance(protocol, dict) or not isinstance(protocol.get("approvalId"), str) or not protocol["approvalId"] or not isinstance(protocol.get("rationale"), str) or not protocol["rationale"]:
        return result("ROB-PERT", "Perturbation robustness", "15", [], ["A domain-approved protocol with approvalId, rationale and numeric feature ranges/deltas is required."], "inconclusive")
    ranges = protocol.get("features")
    if not isinstance(ranges, dict) or not ranges:
        raise ValueError("Perturbation protocol requires feature ranges")
    records, targets = features_and_targets(rows, config, adapter)
    baseline = loss(adapter, records, targets, config["task"])
    names = {feature.name for feature in adapter.descriptor.feature_schema}
    measurements = []
    for name, rule in ranges.items():
        if name not in names or not isinstance(rule, dict):
            raise ValueError("Perturbation feature is outside the model schema")
        lower, upper, delta = (finite_number(rule.get(key), "perturbation "+key) for key in ("lower", "upper", "delta"))
        if not lower < upper or not delta > 0:
            raise ValueError("Perturbation requires lower < upper and positive delta")
        if any(not lower <= record[name] <= upper for record in records):
            raise ValueError("Evaluation feature falls outside the approved domain range")
        scenarios = []
        for direction in (-1, 1):
            changed = [{**record, name: min(upper, max(lower, record[name]+direction*delta))} for record in records]
            scenarios.append({"direction": direction, "lossIncrease": loss(adapter, changed, targets, config["task"])-baseline, "changedRows": sum(a[name] != b[name] for a, b in zip(records, changed))})
        name_prefix = "perturbation_mae_increase:" if config["task"] == "regression" else "perturbation_accuracy_drop:"
        measurements.append(metric(config, name_prefix+name, max(0.0, *(scenario["lossIncrease"] for scenario in scenarios)), len(records), unit="target_units" if config["task"] == "regression" else "ratio", details={"baselineLoss": baseline, "approvedRange": [lower, upper], "delta": delta, "scenarios": scenarios, "approvalId": protocol["approvalId"], "rationale": protocol["rationale"], "method": "one feature at a time; +/- approved delta clipped to approved range"}))
    return result("ROB-PERT", "Perturbation robustness", "15", measurements, ["This deterministic local sensitivity check is not an adversarial security certification.", "One-feature perturbations do not preserve all correlated/domain constraints; approved protocol applicability requires human review."], "inconclusive" if len(records) < config["minSampleSize"] else None)
