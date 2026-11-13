"""Portable assurance procedures; local data only, no inferred model execution.

These checks produce evidence for an auditor. They do not certify compliance,
authenticate source declarations, or establish that supplied logs are complete.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import hmac
import json
import math
import random
import re
import statistics
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path, PurePosixPath, PureWindowsPath

# 1.4.0: decided intersectional strata accept a cluster field and use the cluster bootstrap (#136).
TOOL_VERSION = "1.4.0"
MAX_RECORDS = 100_000
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_CONTAINER_BYTES = 64 * 1024 * 1024
MAX_LINE_BYTES = 64 * 1024
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_FILES = 500
MAX_BOOTSTRAP_WORK = 5_000_000
# Section 5.11: cluster-bootstrap decisions draw at most 50,000,000 clusters per run (B x C).
MAX_DECISION_DRAWS = 50_000_000
HASH = re.compile(r"^[a-f0-9]{64}$")


def _expect(condition, message):
    if not condition:
        raise ValueError(message)


def _integer(value, name, lower=0, upper=MAX_RECORDS):
    _expect(isinstance(value, int) and not isinstance(value, bool) and lower <= value <= upper, f"{name} must be an integer between {lower} and {upper}")
    return value


def _number(value, name, lower=None, upper=None):
    _expect(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value), f"{name} must be a finite number")
    _expect(lower is None or value >= lower, f"{name} is below its permitted bound")
    _expect(upper is None or value <= upper, f"{name} exceeds its permitted bound")
    return float(value)


def _text(value, name, maximum=1_048_576):
    _expect(isinstance(value, str) and value.strip() and len(value) <= maximum, f"{name} must be nonempty text within its limit")
    _expect(not any(0xD800 <= ord(c) <= 0xDFFF for c in value), f"{name} contains invalid Unicode")
    return value


def _timestamp(value, name="timestamp"):
    _text(value, name, 100)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name} must be an ISO-8601 timestamp") from exc
    _expect(parsed.tzinfo is not None and parsed.utcoffset() is not None, f"{name} must include a timezone")
    return parsed


def _json_value(value, integer_only=False, depth=0):
    _expect(depth <= 32, "JSON nesting exceeds 32 levels")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        _expect(len(value) <= MAX_INPUT_BYTES, "JSON string exceeds input bound")
        _expect(not any(0xD800 <= ord(c) <= 0xDFFF for c in value), "Invalid Unicode surrogate")
    elif isinstance(value, int):
        _expect(not integer_only or abs(value) <= 2**53 - 1, "Manifest integers must be exactly representable across runtimes")
    elif isinstance(value, float):
        _expect(not integer_only and math.isfinite(value), "Non-finite numbers and manifest floats are forbidden")
    elif isinstance(value, list):
        _expect(len(value) <= MAX_RECORDS, "JSON array exceeds record bound")
        for item in value:
            _json_value(item, integer_only, depth + 1)
    elif isinstance(value, dict):
        _expect(len(value) <= 1000 and all(isinstance(k, str) for k in value), "JSON objects require bounded string keys")
        for key, item in value.items():
            _json_value(key, integer_only, depth + 1)
            _json_value(item, integer_only, depth + 1)
    else:
        raise ValueError("Only JSON values are accepted")


def canonical_bytes(value, *, integer_only=False):
    """Sorted keys, UTF-8, compact separators, unescaped Unicode; no NaN."""
    _json_value(value, integer_only)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _pairs(items):
    result = {}
    for key, value in items:
        _expect(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _loads(data):
    try:
        value = json.loads(data.decode("utf-8-sig"), object_pairs_hook=_pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON numbers are forbidden")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("Input must be well-formed UTF-8 JSON") from exc
    _json_value(value)
    return value


def read_json(path, limit=MAX_INPUT_BYTES):
    source = Path(path)
    _expect(source.is_file() and source.stat().st_size <= limit, "JSON input path or size is invalid")
    data = source.read_bytes()
    _expect(len(data) <= limit, "JSON input grew beyond the limit")
    return _loads(data)


def _records(records):
    _expect(isinstance(records, list) and len(records) <= MAX_RECORDS and all(isinstance(row, dict) for row in records), "Records must be a bounded JSON object array")
    data = canonical_bytes(records)
    _expect(len(data) <= MAX_INPUT_BYTES, "Record population exceeds byte limit")
    return records


def _missing(value):
    return value is None or isinstance(value, str) and not value.strip()


def _index(records, record_id):
    result = {}
    for row in _records(records):
        identifier = _text(row.get(record_id), record_id, 3000)
        _expect(identifier not in result, f"Record IDs must be unique: {identifier}")
        result[identifier] = row
    return result


def _population_hash(index):
    return _sha(canonical_bytes([index[key] for key in sorted(index)]))


def sample_records(records, *, count, seed=1729, record_id="id", strata=(), allocations=None, exclusions=None):
    """Seeded keyed-hash sampling without replacement; exact rational inclusion probabilities."""
    _integer(seed, "seed", 0, 2**32 - 1)
    _integer(count, "count", 1)
    index = _index(records, record_id)
    _expect(index, "Sampling requires a nonempty population")
    _expect(isinstance(strata, (list, tuple)) and len(strata) <= 5 and len(set(strata)) == len(strata), "Declare up to five unique strata fields")
    for field in strata:
        _text(field, "strata field", 300)
    exclusions = exclusions or {}
    _expect(isinstance(exclusions, dict), "Exclusions must map record IDs to reasons")
    for identifier, reason in exclusions.items():
        _expect(identifier in index, "Excluded ID is outside the population")
        _text(reason, "exclusion reason", 5000)
    groups = defaultdict(list)
    values = {}
    for identifier, row in index.items():
        if identifier in exclusions:
            continue
        group_values = []
        for field in strata:
            value = row.get(field)
            _expect(not _missing(value) and isinstance(value, (str, int, float, bool)), f"Eligible record {identifier} lacks a scalar stratum {field}")
            group_values.append(value)
        key = canonical_bytes(group_values).decode("utf-8")
        groups[key].append(identifier)
        values[key] = group_values
    eligible = sum(map(len, groups.values()))
    _expect(count <= eligible, "Requested sample exceeds the eligible population")
    if allocations is not None:
        _expect(strata and isinstance(allocations, dict) and set(allocations) == set(groups), "Explicit allocations must name every observed stratum")
        take = {key: _integer(allocations[key], "stratum allocation", 0, len(groups[key])) for key in groups}
        _expect(sum(take.values()) == count, "Stratum allocations must sum to count")
    else:
        # Largest remainder proportional allocation, exact integer arithmetic.
        take = {key: count * len(ids) // eligible for key, ids in groups.items()}
        remainder = count - sum(take.values())
        order = sorted(groups, key=lambda key: (-(count * len(groups[key]) % eligible), key))
        for key in order[:remainder]:
            take[key] += 1
    key_bytes = hashlib.sha256(("ai-assurance-sampling-1.0:" + str(seed)).encode()).digest()
    selection = []
    strata_summary = []
    for group in sorted(groups):
        ranked = sorted((hmac.new(key_bytes, canonical_bytes([group, identifier]), hashlib.sha256).hexdigest(), identifier) for identifier in groups[group])
        for rank_hash, identifier in ranked[:take[group]]:
            selection.append({"id": identifier, "stratum": group, "rankSha256": rank_hash, "inclusionProbability": {"numerator": take[group], "denominator": len(groups[group])}})
        strata_summary.append({"stratum": group, "values": values[group], "populationCount": len(groups[group]), "selectedCount": take[group]})
    selection.sort(key=lambda item: (item["stratum"], item["rankSha256"], item["id"]))
    return {"schemaVersion": "1.0", "type": "sampling", "toolVersion": TOOL_VERSION, "method": "keyed_sha256_stratified_without_replacement" if strata else "keyed_sha256_simple_random_without_replacement", "seed": seed, "recordId": record_id, "strata": list(strata), "population": {"count": len(index), "eligibleCount": eligible, "excludedCount": len(exclusions), "sha256": _population_hash(index)}, "requestedCount": count, "selectedCount": len(selection), "selectedIds": [item["id"] for item in selection], "selection": selection, "stratumCounts": strata_summary, "exclusions": [{"id": key, "reason": exclusions[key]} for key in sorted(exclusions)], "assumptions": ["The supplied population and exclusions were defined and frozen before inspecting sample outcomes.", "The keyed SHA-256 ranking is a deterministic pseudorandom sampling protocol; its seed is not a secrecy or authenticity key.", "Inclusion probabilities are conditional on the eligible population and fixed stratum allocations."], "limitations": ["Population completeness and source authenticity are not established.", "Zero-allocated strata have zero inclusion probability and cannot support population-wide inference."] if any(take[key] == 0 for key in groups) else ["Population completeness and source authenticity are not established."]}


def quality_checks(records, *, record_id="id", split_field="split", entity_field=None, required_fields=(), content_fields=(), timestamp_field=None, temporal_cutoff=None, before_splits=("training",), after_splits=("test",)):
    """Check declared split separation and data quality, retaining issue counts/examples."""
    rows = _records(records)
    _expect(isinstance(required_fields, (list, tuple)) and len(set(required_fields)) == len(required_fields), "Required fields must be a unique array")
    _expect(isinstance(content_fields, (list, tuple)) and len(set(content_fields)) == len(content_fields), "Content fingerprint fields must be a unique array")
    for field in (*required_fields, *content_fields):
        _text(field, "mapped field", 300)
    cutoff = _timestamp(temporal_cutoff, "temporal cutoff") if temporal_cutoff is not None else None
    _expect(cutoff is None or timestamp_field, "Temporal cutoff requires a timestamp field")
    _expect(not set(before_splits).intersection(after_splits), "Temporal split sides must be disjoint")
    required = set(required_fields) | set(content_fields) | {record_id, split_field}
    if entity_field:
        required.add(entity_field)
    if cutoff:
        required.add(timestamp_field)
    missing = Counter()
    missing_examples = defaultdict(list)
    identifiers = defaultdict(list)
    entities = defaultdict(list)
    contents = defaultdict(list)
    temporal = []
    invalid = []
    split_counts = Counter()
    for position, row in enumerate(rows):
        label = row.get(record_id) if isinstance(row.get(record_id), str) and row.get(record_id).strip() else f"row:{position + 1}"
        split = row.get(split_field)
        for field in sorted(required):
            if _missing(row.get(field)):
                missing[field] += 1
                if len(missing_examples[field]) < 100:
                    missing_examples[field].append(label)
        if not _missing(split):
            if not isinstance(split, str):
                invalid.append({"id": label, "field": split_field, "reason": "split must be text"})
            else:
                split_counts[split] += 1
        if not _missing(row.get(record_id)):
            if not isinstance(row[record_id], str):
                invalid.append({"id": label, "field": record_id, "reason": "record ID must be text"})
            else:
                identifiers[row[record_id]].append({"row": position + 1, "split": split})
        if entity_field and not _missing(row.get(entity_field)):
            value = row[entity_field]
            if not isinstance(value, (str, int, float, bool)):
                invalid.append({"id": label, "field": entity_field, "reason": "entity ID must be scalar"})
            else:
                entities[canonical_bytes(value).decode()].append({"id": label, "split": split})
        if content_fields and not any(_missing(row.get(field)) for field in content_fields):
            fingerprint = _sha(canonical_bytes({field: row[field] for field in content_fields}))
            contents[fingerprint].append({"id": label, "split": split})
        if cutoff and not _missing(row.get(timestamp_field)):
            try:
                at = _timestamp(row[timestamp_field])
                if split in before_splits and at > cutoff or split in after_splits and at <= cutoff:
                    temporal.append({"id": label, "split": split, "timestamp": row[timestamp_field]})
            except ValueError:
                invalid.append({"id": label, "field": timestamp_field, "reason": "invalid timezone-aware timestamp"})
    duplicates = [{"id": key, "count": len(items), "splits": sorted({str(item["split"]) for item in items}), "rows": [item["row"] for item in items[:100]]} for key, items in sorted(identifiers.items()) if len(items) > 1]
    record_leakage = [item for item in duplicates if len(item["splits"]) > 1]
    entity_leakage = [{"entity": key, "count": len(items), "splits": sorted({str(item["split"]) for item in items}), "recordIds": [item["id"] for item in items[:100]]} for key, items in sorted(entities.items()) if len({str(item["split"]) for item in items}) > 1]
    content_leakage = [{"sha256": key, "count": len(items), "splits": sorted({str(item["split"]) for item in items}), "recordIds": [item["id"] for item in items[:100]]} for key, items in sorted(contents.items()) if len({str(item["split"]) for item in items}) > 1]
    failed = bool(missing or invalid or duplicates or entity_leakage or content_leakage or temporal)
    return {"schemaVersion": "1.0", "type": "data_quality", "toolVersion": TOOL_VERSION, "outcome": "fail" if failed else "pass" if len(split_counts) >= 2 else "inconclusive", "populationSha256": _sha(canonical_bytes(rows)), "recordCount": len(rows), "splitCounts": dict(sorted(split_counts.items())), "splitSeparationAssessable": len(split_counts) >= 2, "missingFields": [{"field": key, "count": missing[key], "examples": missing_examples[key]} for key in sorted(missing)], "duplicateIds": duplicates, "recordLeakage": record_leakage, "entityLeakage": entity_leakage, "contentLeakage": content_leakage, "temporalViolations": {"count": len(temporal), "examples": temporal[:100]}, "invalidFields": {"count": len(invalid), "examples": invalid[:100]}, "protocol": {"recordId": record_id, "splitField": split_field, "entityField": entity_field, "requiredFields": sorted(required), "contentFields": list(content_fields), "timestampField": timestamp_field, "temporalCutoff": temporal_cutoff, "beforeSplits": list(before_splits), "afterSplits": list(after_splits), "boundary": "before splits <= cutoff; after splits > cutoff"}, "limitations": ["Only supplied records and declared fields/split names are checked; fewer than two populated splits cannot establish separation.", "Content matches use only explicitly declared fingerprint fields and require assessment of whether they identify the same record.", "No feature-engineering, target derivation, preprocessing-fit or model-training leakage is inferred.", "An event timestamp does not establish when its label or feature became available."]}


def _bootstrap_protocol(n, seed, replicates, confidence, min_support, min_clusters, purpose="descriptive"):
    """Section 5.11 (E3): a "descriptive" bootstrap accepts 100-10000 replicates within rows x replicates
    <= 5,000,000; a "decision" bootstrap accepts 1000-10000 replicates within clusters x replicates <=
    50,000,000 draws (`n` is then the cluster count)."""
    _expect(purpose in {"descriptive", "decision"}, "Bootstrap purpose must be descriptive or decision")
    _integer(seed, "seed", 0, 2**32 - 1)
    _integer(replicates, "replicates", 100 if purpose == "descriptive" else 1000, 10000)
    _integer(min_support, "min_support", 2)
    _integer(min_clusters, "min_clusters", 2)
    _number(confidence, "confidence", 0.5, 0.999)
    budget = MAX_BOOTSTRAP_WORK if purpose == "descriptive" else MAX_DECISION_DRAWS
    _expect(n * replicates <= budget, "Bootstrap work exceeds bounded observation/repetition limit")


def _draws(n, rng, clusters=None):
    if clusters is None:
        return [rng.randrange(n) for _ in range(n)]
    groups = defaultdict(list)
    for position, cluster in enumerate(clusters):
        groups[canonical_bytes(cluster)].append(position)
    ordered = [groups[key] for key in sorted(groups)]
    result = []
    for _ in ordered:
        selected = ordered[rng.randrange(len(ordered))]
        _expect(len(result) + len(selected) <= MAX_RECORDS, "Resampled cluster population exceeds record limit")
        result.extend(selected)
    return result


def _quantile(values, probability):
    values = sorted(values)
    position = (len(values) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def _interval(values, confidence, minimum_valid):
    if len(values) < minimum_valid:
        return None
    alpha = (1 - confidence) / 2
    return {"lower": _quantile(values, alpha), "upper": _quantile(values, 1 - alpha), "level": confidence, "method": "seeded percentile bootstrap; linear-interpolated empirical quantiles"}


def bootstrap_interval(values, *, statistic="mean", seed=1729, replicates=500, confidence=0.95, min_support=30, clusters=None, min_clusters=10):
    """Mean/MAE/RMSE interval under iid observations or independent whole clusters."""
    _expect(isinstance(values, list) and len(values) <= MAX_RECORDS, "Values must be a bounded array")
    _expect(statistic in {"mean", "mae", "rmse"}, "Statistic must be mean, mae or rmse")
    values = [_number(value, "bootstrap value", -1e100, 1e100) for value in values]
    _bootstrap_protocol(len(values), seed, replicates, confidence, min_support, min_clusters)
    if clusters is not None:
        _expect(isinstance(clusters, list) and len(clusters) == len(values) and all(not _missing(c) and isinstance(c, (str, int, float, bool)) for c in clusters), "Cluster IDs must be complete scalar values aligned to observations")
    def estimate(numbers):
        if not numbers:
            return None
        if statistic == "mean":
            return statistics.fmean(numbers)
        if statistic == "mae":
            return statistics.fmean(abs(value) for value in numbers)
        return math.sqrt(statistics.fmean(value * value for value in numbers))
    count_clusters = len({canonical_bytes(c) for c in clusters}) if clusters is not None else None
    sufficient = len(values) >= min_support and (clusters is None or count_clusters >= min_clusters)
    notes = ["Pass means estimation support; no acceptance threshold or legal compliance criterion is applied.", "Percentile intervals do not correct bias or multiple comparisons."]
    if not sufficient:
        notes.append("Insufficient observation or independent-cluster support; no interval issued.")
    samples = []
    if sufficient:
        rng = random.Random(seed)
        work = 0
        for _ in range(replicates):
            selected = _draws(len(values), rng, clusters)
            work += len(selected)
            _expect(work <= MAX_BOOTSTRAP_WORK, "Realized cluster bootstrap exceeds work limit")
            samples.append(estimate([values[i] for i in selected]))
    if replicates * (1 - confidence) / 2 < 5:
        notes.append("Few bootstrap observations occur in the requested interval tails; endpoint precision is limited.")
    return {"schemaVersion": "1.0", "type": "bootstrap_interval", "toolVersion": TOOL_VERSION, "outcome": "pass" if sufficient else "inconclusive", "statistic": statistic, "estimate": estimate(values), "populationSha256": _sha(canonical_bytes({"values": values, "clusters": clusters})), "sampleSize": len(values), "clusterCount": count_clusters, "method": "cluster" if clusters is not None else "iid", "seed": seed, "replicatesRequested": replicates, "validReplicates": len(samples), "confidenceInterval": _interval(samples, confidence, replicates) if sufficient else None, "assumptions": ["Observations are independent and representative of the declared population; seed reproducibility also requires identical input order."] if clusters is None else ["Clusters are independently sampled and representative; complete clusters are resampled uniformly with replacement.", "Within-cluster dependence is preserved. The estimand is an observation-weighted statistic, not an equal-cluster mean."], "limitations": notes}


def intersectional_slices(records, *, protected_fields, target_field="actual", prediction_field="predicted", positive_label="1", negative_label="0", record_id="id", seed=1729, replicates=500, confidence=0.95, min_support=30, min_class_count=5, cluster_field=None, min_clusters=10, bands=None, minimum_coverage=1.0):
    """Binary intersectional DP/DI/EO with whole-population iid/cluster resampling.

    With `bands` ({selection_rate_difference | selection_rate_ratio | equalized_odds: band}) the strata are
    also decided by statistics 1.0.0 as exploratory group criteria (section 5.10): strata below the
    minimum group size are suppressed one at a time, coverage is recorded and Benjamini-Hochberg adjusts
    the family. Exploratory claims are screening; they never decide a run outcome."""
    index = _index(records, record_id)
    _expect(isinstance(protected_fields, (list, tuple)) and 1 <= len(protected_fields) <= 5 and len(set(protected_fields)) == len(protected_fields), "Declare one to five unique protected fields")
    _text(positive_label, "positive label", 3000)
    _text(negative_label, "negative label", 3000)
    _expect(positive_label != negative_label, "Binary labels must differ")
    _integer(min_class_count, "min_class_count", 1)
    observations, exclusions, group_values = [], [], {}
    for identifier in sorted(index):
        row = index[identifier]
        required = [target_field, prediction_field, *protected_fields, *([cluster_field] if cluster_field else [])]
        missing = [field for field in required if _missing(row.get(field))]
        if missing:
            exclusions.append({"id": identifier, "reason": "Missing mapped fields: " + ", ".join(missing)})
            continue
        _expect(all(isinstance(row[field], (str, int, float)) and not isinstance(row[field], bool) for field in [target_field, prediction_field]), "Binary reference/prediction labels must be text or numeric scalars")
        actual, predicted = str(row[target_field]), str(row[prediction_field])
        _expect(actual in {positive_label, negative_label} and predicted in {positive_label, negative_label}, "Observed labels differ from the declared binary labels")
        values = [row[field] for field in protected_fields]
        _expect(all(isinstance(value, (str, int, float, bool)) for value in values), "Protected values must be scalar")
        cluster = row.get(cluster_field) if cluster_field else None
        _expect(cluster_field is None or isinstance(cluster, (str, int, float, bool)), "Cluster IDs must be scalar")
        group = canonical_bytes(values).decode()
        group_values[group] = values
        observations.append((group, actual == positive_label, predicted == positive_label, cluster))
    _expect(len(group_values) <= 1000, "Intersectional group count exceeds 1000")
    _bootstrap_protocol(len(observations), seed, replicates, confidence, min_support, min_clusters)
    def counts(selected):
        result = {key: {"tp": 0, "tn": 0, "fp": 0, "fn": 0, "n": 0} for key in group_values}
        for group, actual, predicted, _ in selected:
            row = result[group]
            row["n"] += 1
            row["tp" if actual and predicted else "fn" if actual else "fp" if predicted else "tn"] += 1
        for row in result.values():
            row["selectionRate"] = (row["tp"] + row["fp"]) / row["n"] if row["n"] else None
            row["tpr"] = row["tp"] / (row["tp"] + row["fn"]) if row["tp"] + row["fn"] else None
            row["fpr"] = row["fp"] / (row["fp"] + row["tn"]) if row["fp"] + row["tn"] else None
        return result
    def contrasts(c):
        rates = [row["selectionRate"] for row in c.values()]
        ready = len(rates) >= 2 and all(rate is not None for rate in rates)
        dp = max(rates) - min(rates) if ready else None
        di = min(rates) / max(rates) if ready and max(rates) > 0 else None
        odds_ready = ready and all(row["tpr"] is not None and row["fpr"] is not None for row in c.values())
        eo = max(max(row["tpr"] for row in c.values()) - min(row["tpr"] for row in c.values()), max(row["fpr"] for row in c.values()) - min(row["fpr"] for row in c.values())) if odds_ready else None
        return {"demographic_parity_gap": dp, "disparate_impact_ratio": di, "equalized_odds_gap": eo}
    original = counts(observations)
    clusters = [row[3] for row in observations] if cluster_field else None
    cluster_count = len({canonical_bytes(value) for value in clusters}) if clusters is not None else None
    sufficient = len(original) >= 2 and all(row["n"] >= min_support for row in original.values())
    group_clusters = defaultdict(set)
    if clusters is not None:
        for row in observations:
            group_clusters[row[0]].add(canonical_bytes(row[3]))
        sufficient = sufficient and cluster_count >= min_clusters and all(len(group_clusters[key]) >= min_clusters for key in original)
    odds_support = sufficient and all(row["tp"] + row["fn"] >= min_class_count and row["fp"] + row["tn"] >= min_class_count for row in original.values())
    estimates = contrasts(original)
    resampled = {key: [] for key in estimates}
    if sufficient:
        rng = random.Random(seed)
        work = 0
        for _ in range(replicates):
            selected = _draws(len(observations), rng, clusters)
            work += len(selected)
            _expect(work <= MAX_BOOTSTRAP_WORK, "Realized cluster bootstrap exceeds work limit")
            values = contrasts(counts([observations[i] for i in selected]))
            for key, value in values.items():
                if value is not None:
                    resampled[key].append(value)
    metrics = []
    for name, value in estimates.items():
        support = odds_support if name == "equalized_odds_gap" else sufficient
        eligible = support and value is not None and len(resampled[name]) >= math.ceil(0.9 * replicates)
        metrics.append({"name": name, "value": value, "outcome": "pass" if eligible else "inconclusive", "validReplicates": len(resampled[name]), "undefinedReplicates": replicates - len(resampled[name]) if sufficient else 0, "confidenceInterval": _interval(resampled[name], confidence, math.ceil(0.9 * replicates)) if eligible else None, "limitations": ["No acceptance threshold applied; pass means estimation support only."] if eligible else ["Insufficient group/class/cluster support, undefined denominator, or more than 10% undefined bootstrap replicates."]})
    slices = [{"stratum": key, "values": group_values[key], **original[key], "clusterCount": len(group_clusters[key]) if clusters is not None else None} for key in sorted(original)]
    decided = _slice_statistics(original, len(exclusions), bands, confidence, min_support, min_class_count, minimum_coverage, cluster_field, observations, seed, replicates)
    return {"schemaVersion": "1.0", "type": "intersectional_slices", "statistics": decided, "toolVersion": TOOL_VERSION, "outcome": "pass" if all(metric["outcome"] == "pass" for metric in metrics) and not exclusions else "inconclusive", "scope": "binary saved-label/prediction intersectional contrasts", "populationSha256": _population_hash(index), "populationCount": len(index), "includedCount": len(observations), "exclusions": exclusions, "protectedFields": list(protected_fields), "slices": slices, "metrics": metrics, "bootstrap": {"method": "cluster" if clusters is not None else "iid", "seed": seed, "replicates": replicates, "confidence": confidence, "clusterField": cluster_field, "clusterCount": cluster_count}, "assumptions": ["The mapped binary favourable label and protected attributes have been reviewed for this use.", "Whole-population resampling preserves cross-slice dependence; iid observations are assumed unless independent clusters are declared.", "Percentile intervals require representative observations/clusters and are descriptive; no multiple-comparison correction."], "limitations": ["Exclusions and source-population completeness require human assessment.", "Confidence intervals are conditional on defined contrasts; undefined-replicate counts are retained.", "Metrics and support flags do not determine legal conformity or an approved audit conclusion."]}


def _slice_statistics(counts, unknown, bands, confidence, min_support, min_class_count, minimum_coverage, cluster_field, observations=(), seed=1729, replicates=500):
    """Exploratory statistics 1.0.0 group criteria over the strata (E3); None without bands. With a cluster
    field the strata are decided by the cluster bootstrap (section 5.11, #136): one count vector per cluster,
    the run seed, and the decision replicates (`replicates` when it lies in 1000-10000, otherwise 2000)."""
    if bands is None:
        return None
    from . import statistics as stats
    _expect(isinstance(bands, dict) and bands and set(bands) <= {"selection_rate_difference", "selection_rate_ratio", "equalized_odds"}, "bands names selection_rate_difference, selection_rate_ratio or equalized_odds")
    _expect(confidence in (0.9, 0.95, 0.99), "Decided strata use a confidence level of 0.90, 0.95 or 0.99")
    plan = {"confidenceLevel": confidence, **({"clusterField": cluster_field, "bootstrap": {"replicates": replicates if 1000 <= replicates <= 10000 else 2000}} if cluster_field else {}), "minimums": {"sampleSize": max(30, min_support), "groupSize": max(30, min_support), "classCount": max(10, min_class_count)},
        "criteria": [{"id": "intersectional-" + metric.replace("_", "-"), "kind": "group_comparison", "role": "exploratory", "metric": metric, "band": band, "minimumCoverage": minimum_coverage} for metric, band in sorted(bands.items())]}
    try:
        plan = stats.validate_plan(plan)
    except stats.StatisticsError as exc:
        raise ValueError(str(exc)) from exc
    data = {"groups": [{"group": key, **{cell: row[cell] for cell in ("tp", "fp", "fn", "tn")}} for key, row in sorted(counts.items())], "unknownGroupRows": unknown}
    if cluster_field:
        # Excluded rows carry no usable cluster id; they count once, as unknown-group rows, in coverage.
        ids, parts = {}, defaultdict(dict)
        for group, actual, predicted, cluster in observations:
            key = canonical_bytes(cluster)
            ids.setdefault(key, cluster)
            cells = parts[key].setdefault(group, {"tp": 0, "fp": 0, "fn": 0, "tn": 0})
            cells["tp" if actual and predicted else "fn" if actual else "fp" if predicted else "tn"] += 1
        clusters = [{"cluster": ids[key], "groups": [{"group": group, **cells} for group, cells in sorted(groups.items())]} for key, groups in parts.items()]
        if clusters:
            clusters[0]["unknownGroupRows"] = unknown
        data = {"seed": seed, "clusters": clusters}
    evaluation = stats.evaluate_plan(plan, data)

    def public(value):
        if isinstance(value, dict):
            return {key: public(item) for key, item in value.items() if not key.startswith("_")}
        return [public(item) for item in value] if isinstance(value, list) else value

    return {"statisticsVersion": stats.SPEC_VERSION, "planSha256": evaluation["planSha256"], "plan": plan, "criteria": public(evaluation["criteria"]), "reviewFlags": evaluation["reviewFlags"], "note": "Exploratory screening with Benjamini-Hochberg adjustment; excluded rows count as unknown-group rows in coverage."}


def power(plan_or_case):
    """Power and minimum detectable effects at plan approval (section 8).

    A plan (`{"criteria": [...]}`) gets every criterion's power at its family's Bonferroni level; a single
    case (`{"kind": "equality_test" | "criterion", ...}`, the golden fixture's power input) is evaluated
    as given. Outcome-derived assumptions come from the auditor, never from the data being tested."""
    from . import statistics as stats
    _expect(isinstance(plan_or_case, dict), "Power input must be an object")
    try:
        if "criteria" not in plan_or_case:
            return {"schemaVersion": "1.0", "type": "statistics_power", "toolVersion": TOOL_VERSION, "statisticsVersion": stats.SPEC_VERSION, "result": stats.evaluate_power(plan_or_case)}
        plan = stats.validate_plan(plan_or_case)
        families = {role: sum(1 for c in plan["criteria"] if c["role"] == role) for role in ("confirmatory", "exploratory")}
        criteria = []
        for criterion in plan["criteria"]:
            family = families["confirmatory"] if criterion["role"] == "confirmatory" else 1
            criteria.append({"id": criterion["id"], "role": criterion["role"], "familySize": family, **stats.criterion_power(criterion, plan["confidenceLevel"], plan["power"]["targetPower"], family, plan["minimums"])})
    except (stats.StatisticsError, KeyError, TypeError) as exc:
        raise ValueError("Power input rejected: " + str(exc)) from exc
    short = [c["id"] for c in criteria if c["role"] == "confirmatory" and (c["status"] != "computed" or c["passProbability"] < plan["power"]["targetPower"])]
    return {"schemaVersion": "1.0", "type": "statistics_power", "toolVersion": TOOL_VERSION, "statisticsVersion": stats.SPEC_VERSION, "planSha256": stats.plan_sha256(plan), "targetPower": plan["power"]["targetPower"], "criteria": criteria, "acknowledgementRequired": bool(short), "shortfalls": short, "acknowledgement": plan["power"]["acknowledgement"], "limitations": ["Normal approximations at assumed true values; required sizes and pass ranges are conservative under dependence between members.", "A shortfall needs a recorded acknowledgement at approval; it does not block (section 8)."]}


def collect_jsonl(paths):
    """Read bounded immutable snapshots of supplied operational JSONL logs."""
    _expect(isinstance(paths, (list, tuple)) and 1 <= len(paths) <= 20, "Declare one to twenty local JSONL sources")
    sources, records, locations, total = [], [], [], 0
    for path in paths:
        source = Path(path)
        _expect(source.is_file() and source.stat().st_size <= MAX_INPUT_BYTES, "Log source path or size is invalid")
        data = source.read_bytes()
        total += len(data)
        _expect(total <= MAX_INPUT_BYTES, "Combined log inputs exceed byte limit")
        count, blanks = 0, 0
        for line_number, line in enumerate(data.splitlines(), 1):
            _expect(len(line) <= MAX_LINE_BYTES, "JSONL record exceeds line byte limit")
            if not line.strip():
                blanks += 1
                continue
            value = _loads(line)
            _expect(isinstance(value, dict), "Each JSONL line must be an object")
            records.append(value)
            locations.append({"sourceIndex": len(sources), "line": line_number})
            count += 1
            _expect(len(records) <= MAX_RECORDS, "Log population exceeds record limit")
        sources.append({"name": source.name, "sha256": _sha(data), "bytes": len(data), "recordCount": count, "blankLines": blanks})
    required = ("eventId", "timestamp", "streamId", "sequence", "modelVersion", "pipelineVersion", "thresholdVersion", "finalDecision", "override")
    missing, invalid, overrides = [], [], []
    ids, streams = defaultdict(list), defaultdict(list)
    versions = {field: Counter() for field in ("modelVersion", "pipelineVersion", "thresholdVersion", "finalDecision")}
    for position, row in enumerate(records):
        location = locations[position]
        identifier = row.get("eventId")
        for field in required:
            if _missing(row.get(field)):
                missing.append({"eventId": identifier, "field": field, **location})
        if isinstance(identifier, str) and identifier.strip():
            ids[identifier].append(location)
        elif not _missing(identifier):
            invalid.append({"field": "eventId", "reason": "ID must be text", **location})
        if not _missing(row.get("timestamp")):
            try:
                _timestamp(row["timestamp"])
            except ValueError:
                invalid.append({"eventId": identifier, "field": "timestamp", "reason": "invalid timezone-aware timestamp"})
        sequence, stream = row.get("sequence"), row.get("streamId")
        if isinstance(sequence, int) and not isinstance(sequence, bool) and sequence >= 0 and isinstance(stream, str) and stream.strip():
            streams[stream].append({"sequence": sequence, "eventId": identifier, **location})
        elif not _missing(sequence) and not _missing(stream):
            invalid.append({"eventId": identifier, "field": "sequence/streamId", "reason": "sequence must be a nonnegative integer and stream ID text"})
        for field, counter in versions.items():
            value = row.get(field)
            if not _missing(value):
                if field != "finalDecision" and not isinstance(value, str) or not isinstance(value, (str, int, float, bool)):
                    invalid.append({"eventId": identifier, "field": field, "reason": "version must be text; final decision scalar"})
                else:
                    counter[canonical_bytes(value).decode()] += 1
                    _expect(len(counter) <= 1000, "Operational version/decision categories exceed bounded summary limit")
        override = row.get("override")
        applied = override if isinstance(override, bool) else override.get("applied") if isinstance(override, dict) else None
        if applied is not None and not isinstance(applied, bool):
            applied = None
        if not _missing(override) and applied is None:
            overrides.append({"eventId": identifier, "reason": "override must be boolean or contain boolean applied"})
        if applied:
            actor = override.get("actor") if isinstance(override, dict) else row.get("overrideActor")
            reason = override.get("reason") if isinstance(override, dict) else row.get("overrideReason")
            if not isinstance(actor, str) or not actor.strip() or not isinstance(reason, str) or not reason.strip():
                overrides.append({"eventId": identifier, "reason": "applied override lacks attributed actor/reason"})
    duplicate_ids = [{"eventId": identifier, "count": len(items), "locations": items[:100]} for identifier, items in sorted(ids.items()) if len(items) > 1]
    gaps, duplicate_sequences, out_of_order = [], [], []
    for stream, events in sorted(streams.items()):
        counts = Counter(event["sequence"] for event in events)
        for sequence, count in sorted(counts.items()):
            if count > 1:
                duplicate_sequences.append({"streamId": stream, "sequence": sequence, "count": count})
        ordered = sorted(counts)
        for left, right in zip(ordered, ordered[1:]):
            if right > left + 1:
                gaps.append({"streamId": stream, "after": left, "before": right, "missingCount": right - left - 1})
        for left, right in zip(events, events[1:]):
            if right["sequence"] < left["sequence"]:
                out_of_order.append({"streamId": stream, "priorSequence": left["sequence"], **right})
    failed = any((missing, invalid, overrides, duplicate_ids, gaps, duplicate_sequences, out_of_order))
    return {"schemaVersion": "1.0", "type": "operational_collection", "toolVersion": TOOL_VERSION, "outcome": "fail" if failed else "pass" if records else "inconclusive", "recordCount": len(records), "populationSha256": _sha(canonical_bytes(records)), "sources": sources, "records": records, "recordSources": locations, "duplicateIds": duplicate_ids, "sequenceGaps": gaps, "duplicateSequences": duplicate_sequences, "outOfOrder": out_of_order, "missingFields": {"count": len(missing), "examples": missing[:100]}, "invalidFields": {"count": len(invalid), "examples": invalid[:100]}, "overrideIssues": {"count": len(overrides), "examples": overrides[:100]}, "sourceCounts": {field: dict(sorted(counter.items())) for field, counter in versions.items()}, "limitations": ["Read-only collection of supplied local bytes; no production connector or actual inference was executed.", "Contiguous supplied sequences do not prove completeness; beginning/end boundaries, omitted streams and source authenticity require corroboration.", "Sequence order is checked in declared file/line order; separate source ordering must be reviewed.", "Version identifiers and override statements are source declarations, not verified deployed configurations."]}


def compare_replay(logged_records, replay_records, *, selected_ids, record_id="eventId", output_field="finalDecision", absolute_tolerance=0, relative_tolerance=0, metadata_fields=("modelVersion", "pipelineVersion", "thresholdVersion")):
    """Compare supplied replay outputs; this function never runs a model."""
    logged, replayed = _index(logged_records, record_id), _index(replay_records, record_id)
    _expect(isinstance(selected_ids, list) and selected_ids and len(selected_ids) <= MAX_RECORDS and len(set(selected_ids)) == len(selected_ids), "Select unique nonempty record IDs")
    _number(absolute_tolerance, "absolute tolerance", 0, 1e100)
    _number(relative_tolerance, "relative tolerance", 0, 1)
    comparisons = []
    for identifier in selected_ids:
        _text(identifier, "selected ID", 3000)
        left, right = logged.get(identifier), replayed.get(identifier)
        if left is None or right is None:
            comparisons.append({"id": identifier, "outcome": "inconclusive", "reason": "Missing logged or provided replay record"})
            continue
        missing = [field for field in (*metadata_fields, output_field) if _missing(left.get(field)) or _missing(right.get(field))]
        if missing:
            comparisons.append({"id": identifier, "outcome": "inconclusive", "reason": "Missing mapped fields: " + ", ".join(missing)})
            continue
        mismatches = [field for field in metadata_fields if type(left[field]) is not type(right[field]) or left[field] != right[field]]
        actual, provided = left[output_field], right[output_field]
        numeric = all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in (actual, provided))
        if numeric:
            _number(actual, "logged output", -1e100, 1e100)
            _number(provided, "provided replay output", -1e100, 1e100)
            equal = math.isclose(actual, provided, abs_tol=absolute_tolerance, rel_tol=relative_tolerance)
        else:
            _expect(all(isinstance(value, (str, bool)) for value in (actual, provided)), "Decision outputs must be finite numeric, text or boolean scalars")
            equal = type(actual) is type(provided) and actual == provided
        comparisons.append({"id": identifier, "outcome": "pass" if equal and not mismatches else "fail", "loggedOutput": actual, "providedReplayOutput": provided, "absoluteDifference": abs(actual - provided) if numeric else None, "metadataMismatches": mismatches})
    outcome = "fail" if any(row["outcome"] == "fail" for row in comparisons) else "inconclusive" if any(row["outcome"] == "inconclusive" for row in comparisons) else "pass"
    return {"schemaVersion": "1.0", "type": "decision_replay", "toolVersion": TOOL_VERSION, "outcome": outcome, "scope": "comparison of provided outputs; no actual model inference", "selectedIds": selected_ids, "selectionSha256": _sha(canonical_bytes(selected_ids)), "loggedPopulationSha256": _population_hash(logged), "providedReplayPopulationSha256": _population_hash(replayed), "outputField": output_field, "absoluteTolerance": absolute_tolerance, "relativeTolerance": relative_tolerance, "metadataFields": list(metadata_fields), "comparisons": comparisons, "limitations": ["Output agreement does not prove which model, preprocessing, threshold or oversight mechanism produced either output.", "This comparison does not execute inference or reproduce deployer decision logic.", "Selected-record representativeness and source custody must be reviewed independently."]}


def _safe_path(path):
    _text(path, "portable path", 512)
    _expect(path == unicodedata.normalize("NFC", path), "Portable paths must use NFC Unicode")
    _expect(not path.startswith("/") and "\\" not in path and ":" not in path and not any(ord(c) < 32 or ord(c) == 127 for c in path), "Unsafe portable path")
    segments = path.split("/")
    for segment in segments:
        _expect(segment not in {"", ".", ".."} and not segment.endswith((".", " ")), "Unsafe portable path segment")
        _expect(segment.split(".")[0].upper() not in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)], *[f"LPT{i}" for i in range(1, 10)]}, "Reserved portable filename")
    return path


def _keys(value, allowed, required, name):
    _expect(isinstance(value, dict) and set(value) <= set(allowed) and set(required) <= set(value), f"Invalid {name} fields")


def _path_set(paths):
    for path in paths:
        _safe_path(path)
    folded = [path.casefold() for path in paths]
    _expect(len(set(folded)) == len(paths), "Duplicate or case-colliding portable paths")
    names = set(folded)
    _expect(all("/".join(path.split("/")[:i]) not in names for path in folded for i in range(1, len(path.split("/")))), "File/directory path collision")


MANIFEST_KEYS = ("schemaVersion", "audience", "reportId", "reportSha256", "createdAt", "files", "withheld", "custody")
# Manifest 1.1 also signs the signing key ID and the captured rule-pack and
# methodology versions (null when the report captured none).
MANIFEST_KEYS_1_1 = MANIFEST_KEYS + ("signingKeyId", "rulePack", "methodologyVersion")
# Manifest 1.2 also signs the export scope: null for the full dossier, or the
# procedures, record types and creation period (UTC dates, inclusive) that
# select the pinned assurance records it includes, whether evidence bytes are
# withheld, and how many of the report's pinned records it includes.
MANIFEST_KEYS_1_2 = MANIFEST_KEYS_1_1 + ("scope",)
MANIFEST_VERSIONS = {"1.0": MANIFEST_KEYS, "1.1": MANIFEST_KEYS_1_1, "1.2": MANIFEST_KEYS_1_2}
RULE_PACK_KEYS = ("version", "legalVersion", "researchedAsOf", "legalReview")
SCOPE_KEYS = ("procedureIds", "recordKinds", "period", "evidence", "pinnedRecords", "includedRecords")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _scope_labels(value, name):
    if value is None:
        return
    _expect(isinstance(value, list) and 1 <= len(value) <= 100, f"Scope {name} must be null or a bounded nonempty list")
    for item in value:
        _text(item, "scope " + name, 200)
    _expect(value == sorted(set(value)), f"Scope {name} must be sorted and unique")


def _scope_date(value):
    _expect(isinstance(value, str) and DATE.fullmatch(value), "Scope period dates must be YYYY-MM-DD")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("Scope period dates must be real calendar dates") from exc
    return value


def _scope(scope, files):
    """Check manifest 1.2's scope against the files the manifest lists."""
    if scope is None:
        return
    _keys(scope, SCOPE_KEYS, SCOPE_KEYS, "manifest scope")
    _scope_labels(scope["procedureIds"], "procedure IDs")
    _scope_labels(scope["recordKinds"], "record types")
    if scope["period"] is not None:
        _keys(scope["period"], ("from", "to"), ("from", "to"), "scope period")
        _expect(_scope_date(scope["period"]["from"]) <= _scope_date(scope["period"]["to"]), "The scope period must not end before it starts")
    _expect(scope["evidence"] in {"included", "withheld"}, "Scope evidence must be included or withheld")
    _expect(scope["procedureIds"] is not None or scope["recordKinds"] is not None or scope["period"] is not None or scope["evidence"] == "withheld", "A scope that selects everything must be null")
    pinned = _integer(scope["pinnedRecords"], "scope pinned records")
    included = _integer(scope["includedRecords"], "scope included records")
    _expect(1 <= included <= pinned, "A scope includes at least one and at most every pinned record")
    _expect(sum(1 for path in files if path.startswith("assurance/")) == included, "Scope included records differ from the assurance files supplied")
    if scope["evidence"] == "withheld":
        _expect(not any(path.startswith("evidence/") for path in files), "A scope that withholds evidence cannot supply evidence files")


def _manifest(manifest):
    _expect(isinstance(manifest, dict) and manifest.get("schemaVersion") in MANIFEST_VERSIONS, "Unsupported manifest version or audience")
    keys = MANIFEST_VERSIONS[manifest["schemaVersion"]]
    _keys(manifest, keys, keys, "manifest")
    _expect(manifest["audience"] in {"internal", "client"}, "Unsupported manifest version or audience")
    _expect(manifest.get("scope") is None or manifest["audience"] == "internal", "Only an internal dossier can carry an export scope")
    if manifest["schemaVersion"] != "1.0":
        _text(manifest["signingKeyId"], "signing key ID", 300)
        pack = manifest["rulePack"]
        if pack is not None:
            _keys(pack, RULE_PACK_KEYS, RULE_PACK_KEYS, "manifest rule pack")
            for key in RULE_PACK_KEYS:
                _text(pack[key], "rule pack " + key, 200)
            _expect(pack["legalReview"] in {"pending", "approved"}, "Rule pack legal review must be pending or approved")
        if manifest["methodologyVersion"] is not None:
            _text(manifest["methodologyVersion"], "methodology version", 200)
    _text(manifest["reportId"], "report ID", 3000)
    _expect(isinstance(manifest["reportSha256"], str) and HASH.fullmatch(manifest["reportSha256"]), "Invalid report digest")
    _timestamp(manifest["createdAt"], "manifest creation time")
    _expect(isinstance(manifest["files"], list) and 1 <= len(manifest["files"]) <= MAX_FILES, "Manifest requires bounded files")
    paths = []
    for item in manifest["files"]:
        _keys(item, ("path", "sha256", "size", "mediaType"), ("path", "sha256", "size", "mediaType"), "manifest file")
        paths.append(item["path"])
        _expect(isinstance(item["sha256"], str) and HASH.fullmatch(item["sha256"]), "Invalid file digest")
        _integer(item["size"], "file size", 0, MAX_FILE_BYTES)
        _text(item["mediaType"], "media type", 200)
    _path_set(paths)
    if manifest["schemaVersion"] == "1.2":
        _scope(manifest["scope"], paths)
    report = next((item for item in manifest["files"] if item["path"] == "report.json"), None)
    _expect(report is not None and report["sha256"] == manifest["reportSha256"] and report["mediaType"] == "application/json" and report["size"] > 0, "Manifest requires report.json with the exact JSON report digest")
    _expect(sum(item["size"] for item in manifest["files"]) <= MAX_INPUT_BYTES, "Dossier decoded volume exceeds limit")
    _expect(isinstance(manifest["withheld"], list) and len(manifest["withheld"]) <= 1000, "Withheld entries must be bounded")
    withheld_ids = []
    for entry in manifest["withheld"]:
        _keys(entry, ("id", "reason"), ("id", "reason"), "withheld entry")
        withheld_ids.append(_text(entry["id"], "withheld ID", 3000))
        _text(entry["reason"], "withheld reason", 5000)
    _expect(len(set(withheld_ids)) == len(withheld_ids), "Duplicate withheld IDs")
    _expect(isinstance(manifest["custody"], list) and len(manifest["custody"]) <= 10000, "Custody records must be bounded")
    custody_ids = []
    files = {item["path"]: item for item in manifest["files"]}
    for event in manifest["custody"]:
        _keys(event, ("id", "action", "actor", "at", "path", "sha256", "source", "reason"), ("id", "action", "actor", "at"), "custody event")
        custody_ids.append(_text(event["id"], "custody ID", 3000))
        _text(event["action"], "custody action", 100)
        _text(event["actor"], "custody actor", 3000)
        _timestamp(event["at"], "custody time")
        if "path" in event:
            _expect(event["path"] in files, "Custody path is not a supplied file")
        if "sha256" in event:
            _expect(isinstance(event["sha256"], str) and HASH.fullmatch(event["sha256"]), "Invalid custody digest")
            if "path" in event:
                _expect(event["sha256"] == files[event["path"]]["sha256"], "Custody digest differs from its file")
        for key in ("source", "reason"):
            if key in event:
                _text(event[key], "custody " + key, 5000)
    _expect(len(set(custody_ids)) == len(custody_ids), "Duplicate custody IDs")
    return canonical_bytes(manifest, integer_only=True)


def build_dossier(files, *, report_id, report_path, audience="internal", created_at, custody=(), withheld=(), media_types=None):
    """Build a bounded JSON container without signing or asserting source truth."""
    _expect(isinstance(files, dict) and 1 <= len(files) <= MAX_FILES, "Supply a bounded path-to-bytes mapping")
    _expect(report_path == "report.json" and report_path in files, "The exact captured report bytes must be supplied as report.json")
    _path_set(list(files))
    media_types = media_types or {}
    _expect(isinstance(media_types, dict) and set(media_types) <= set(files), "Media types must refer to supplied files")
    metadata, payloads, total = [], [], 0
    for path in sorted(files):
        data = files[path]
        _expect(isinstance(data, bytes) and len(data) <= MAX_FILE_BYTES, "Dossier file must be bounded bytes")
        total += len(data)
        _expect(total <= MAX_INPUT_BYTES, "Dossier decoded volume exceeds limit")
        metadata.append({"path": path, "sha256": _sha(data), "size": len(data), "mediaType": media_types.get(path, "application/json" if path.lower().endswith(".json") else "application/pdf" if path.lower().endswith(".pdf") else "application/octet-stream")})
        payloads.append({"path": path, "contentBase64": base64.b64encode(data).decode("ascii")})
    manifest = {"schemaVersion": "1.0", "audience": audience, "reportId": report_id, "reportSha256": _sha(files[report_path]), "createdAt": created_at, "files": metadata, "withheld": copy.deepcopy(list(withheld)), "custody": copy.deepcopy(list(custody))}
    data = _manifest(manifest)
    result = {"schemaVersion": "1.0", "manifest": manifest, "manifestSha256": _sha(data), "files": payloads}
    _expect(len(canonical_bytes(result)) <= MAX_CONTAINER_BYTES, "Dossier container exceeds byte limit")
    return result


def _pack_source(base, source):
    """Read one pack source confined to base; a dossier may reach a client."""
    _text(source, "pack source", 4096)
    _expect(not PureWindowsPath(source).anchor and not PurePosixPath(source).is_absolute(), "Pack sources must be relative to the specification directory or --base-dir")
    parts = [part for part in re.split(r"[\\/]", source) if part not in {"", "."}]
    _expect(bool(parts) and ".." not in parts, "Pack sources cannot leave the base directory")
    candidate = base
    for part in parts:
        candidate = candidate / part
        _expect(not candidate.is_symlink(), "Pack sources cannot be or pass through symbolic links")
    resolved = candidate.resolve(strict=True)
    # Also catches links is_symlink() misses, such as Windows junctions.
    _expect(resolved.is_relative_to(base), "Pack sources cannot leave the base directory")
    _expect(resolved.is_file() and resolved.stat().st_size <= MAX_FILE_BYTES, "Pack source path or size invalid")
    data = resolved.read_bytes()
    _expect(len(data) <= MAX_FILE_BYTES, "Pack source grew beyond its size limit")
    return data


def _b64(value, name, limit):
    _expect(isinstance(value, str) and len(value) <= 4 * ((limit + 2) // 3), name + " exceeds its encoded bound")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, UnicodeError) as exc:
        raise ValueError(name + " is not strict base64") from exc
    _expect(len(decoded) <= limit and base64.b64encode(decoded).decode("ascii") == value, name + " has noncanonical base64 or excessive bytes")
    return decoded


def verify_dossier(container, *, trusted_keys=None, require_trusted_signature=False):
    """Verify content and optional signature; trust is an explicit external policy."""
    result = {"schemaVersion": "1.0", "type": "dossier_verification", "toolVersion": TOOL_VERSION, "valid": False, "integrityValid": False, "outcome": "fail", "signature": {"present": False, "valid": None, "trusted": False, "status": "unsigned"}, "scope": None, "errors": [], "limitations": ["Hashes and signature verification do not establish source truth, completeness, legal conformity, retention or a trusted timestamp."]}
    try:
        _expect(isinstance(require_trusted_signature, bool), "Signature policy must be boolean")
        _keys(container, ("schemaVersion", "manifest", "manifestSha256", "signature", "files"), ("schemaVersion", "manifest", "manifestSha256", "files"), "container")
        _expect(container["schemaVersion"] == "1.0", "Unsupported container version")
        _expect(len(canonical_bytes(container)) <= MAX_CONTAINER_BYTES, "Dossier container exceeds byte limit")
        manifest_bytes = _manifest(container["manifest"])
        _expect(container["manifestSha256"] == _sha(manifest_bytes), "Manifest digest mismatch")
        _expect(isinstance(container["files"], list) and len(container["files"]) <= MAX_FILES, "Container files must be bounded")
        supplied = {}
        for entry in container["files"]:
            _keys(entry, ("path", "contentBase64"), ("path", "contentBase64"), "container file")
            _safe_path(entry["path"])
            _expect(entry["path"] not in supplied, "Duplicate container file path")
            supplied[entry["path"]] = _b64(entry["contentBase64"], "file payload", MAX_FILE_BYTES)
        _path_set(list(supplied))
        expected = {item["path"]: item for item in container["manifest"]["files"]}
        _expect(set(supplied) == set(expected), "Missing or extra dossier files")
        _expect(sum(map(len, supplied.values())) <= MAX_INPUT_BYTES, "Dossier decoded volume exceeds limit")
        for path, data in supplied.items():
            _expect(len(data) == expected[path]["size"] and _sha(data) == expected[path]["sha256"], "File digest or size mismatch: " + path)
        _expect(isinstance(_loads(supplied["report.json"]), dict), "report.json must contain a captured JSON object")
        matches = [path for path, item in expected.items() if item["sha256"] == container["manifest"]["reportSha256"]]
        _expect(matches, "Report digest is not represented by a supplied file")
        result["integrityValid"] = True
        result["reportFiles"] = matches
        # Surface the signed scope so a part of the audit file is never read as the whole of it.
        scope = container["manifest"].get("scope")
        result["scope"] = copy.deepcopy(scope)
        if scope is not None:
            result["limitations"].append(f"Scoped export: includes {scope['includedRecords']} of {scope['pinnedRecords']} pinned assurance records" + ("; evidence files are withheld" if scope["evidence"] == "withheld" else "") + "; not the complete audit file.")
        signature = container.get("signature")
        if "signature" in container:
            _expect(signature is not None, "An optional signature must be omitted rather than null")
            result["signature"]["present"] = True
            _keys(signature, ("algorithm", "publicKeySPKI", "signature", "keyId"), ("algorithm", "publicKeySPKI", "signature", "keyId"), "signature")
            _expect(signature["algorithm"] == "Ed25519", "Unsupported signature algorithm")
            _text(signature["keyId"], "signing key ID", 300)
            if container["manifest"]["schemaVersion"] != "1.0":
                _expect(signature["keyId"] == container["manifest"]["signingKeyId"], "Signature key ID differs from the signed manifest's signingKeyId")
            key_data = _b64(signature["publicKeySPKI"], "public key SPKI", 1024)
            signature_data = _b64(signature["signature"], "signature bytes", 64)
            _expect(len(signature_data) == 64, "Ed25519 signatures require 64 bytes")
            try:
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
            except ImportError:
                result["signature"]["status"] = "verification_unavailable"
                result["outcome"] = "inconclusive"
                result["limitations"].append("Optional cryptography runtime is unavailable; the asserted signature was not verified.")
                return result
            try:
                key = serialization.load_der_public_key(key_data)
                _expect(isinstance(key, Ed25519PublicKey), "SPKI must contain an Ed25519 public key")
                key.verify(signature_data, manifest_bytes)
            except ValueError:
                raise
            except Exception as exc:
                raise ValueError("Ed25519 signature verification failed") from exc
            result["signature"]["valid"] = True
            trusted_keys = trusted_keys or {}
            _expect(isinstance(trusted_keys, dict), "Trusted keys must map key IDs to externally approved base64 SPKI")
            trusted = trusted_keys.get(signature["keyId"])
            if trusted is not None:
                trusted_data = _b64(trusted, "trusted key SPKI", 1024)
                result["signature"]["trusted"] = hmac.compare_digest(trusted_data, key_data)
            result["signature"]["status"] = "trusted" if result["signature"]["trusted"] else "valid_untrusted"
        if require_trusted_signature and not result["signature"]["trusted"]:
            result["errors"].append("A valid signature from an explicitly trusted signing key is required.")
            result["outcome"] = "inconclusive"
            return result
        result["valid"] = True
        result["outcome"] = "pass" if result["signature"]["trusted"] else "inconclusive"
        if not result["signature"]["trusted"]:
            result["limitations"].append("Content integrity is verified; signer authenticity is unsigned or not trusted by the external allowlist.")
        return result
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        result["errors"].append(str(exc))
        if result["signature"]["present"]:
            result["signature"]["valid"] = False
            result["signature"]["status"] = "invalid"
        return result


def sign_dossier(container, *, private_key_path, key_id):
    """Sign a verified container using an existing external unencrypted PEM key."""
    _text(key_id, "signing key ID", 300)
    _expect("signature" not in container, "Already signed containers cannot be silently re-signed")
    proof = verify_dossier(container)
    _expect(proof["integrityValid"] and proof["valid"], "Cannot sign an invalid dossier")
    _expect(container["manifest"]["schemaVersion"] == "1.0" or container["manifest"]["signingKeyId"] == key_id, "The key ID must match the manifest's signingKeyId")
    source = Path(private_key_path)
    _expect(source.is_file() and source.stat().st_size <= 65536, "Private key path/size is invalid")
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except ImportError as exc:
        raise ValueError("Signing requires the optional cryptography runtime") from exc
    raw = source.read_bytes()
    _expect(len(raw) <= 65536, "Private key grew beyond its size bound")
    try:
        key = serialization.load_pem_private_key(raw, password=None)
    except (TypeError, ValueError) as exc:
        raise ValueError("Supply an existing unencrypted Ed25519 PEM key from an approved signing context") from exc
    _expect(isinstance(key, Ed25519PrivateKey), "Only Ed25519 private keys are supported")
    result = copy.deepcopy(container)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signature = key.sign(_manifest(result["manifest"]))
    result["signature"] = {"algorithm": "Ed25519", "keyId": key_id, "publicKeySPKI": base64.b64encode(public).decode("ascii"), "signature": base64.b64encode(signature).decode("ascii")}
    return result


def _write(value, path):
    data = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    if path:
        with Path(path).open("x", encoding="utf-8", newline="\n") as output:
            output.write(data)
    else:
        print(data, end="")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Portable local assurance evidence procedures; no production model inference")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("sample", "quality", "bootstrap", "slices", "power"):
        command = sub.add_parser(name)
        command.add_argument("--input", required=True)
        command.add_argument("--config")
        command.add_argument("--output")
    collect = sub.add_parser("collect")
    collect.add_argument("--logs", nargs="+", required=True)
    collect.add_argument("--output")
    replay = sub.add_parser("replay")
    replay.add_argument("--logged", required=True)
    replay.add_argument("--replayed", required=True)
    replay.add_argument("--config", required=True)
    replay.add_argument("--output")
    pack = sub.add_parser("pack")
    pack.add_argument("--spec", required=True)
    pack.add_argument("--output", required=True)
    pack.add_argument("--base-dir", help="Directory every source must stay inside (default: the specification's directory)")
    for name in ("verify", "sign"):
        command = sub.add_parser(name)
        command.add_argument("--dossier", required=True)
        command.add_argument("--output")
        if name == "verify":
            command.add_argument("--trusted-keys")
            command.add_argument("--require-trusted-signature", action="store_true")
        else:
            command.add_argument("--private-key", required=True)
            command.add_argument("--key-id", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "power":
            result = power(read_json(args.input, 1024 * 1024))
        elif args.command in {"sample", "quality", "bootstrap", "slices"}:
            config = read_json(args.config, 1024 * 1024) if args.config else {}
            _expect(isinstance(config, dict), "Procedure configuration must be an object")
            functions = {"sample": sample_records, "quality": quality_checks, "bootstrap": bootstrap_interval, "slices": intersectional_slices}
            result = functions[args.command](read_json(args.input), **config)
        elif args.command == "collect":
            result = collect_jsonl(args.logs)
        elif args.command == "replay":
            result = compare_replay(read_json(args.logged), read_json(args.replayed), **read_json(args.config, 1024 * 1024))
        elif args.command == "pack":
            spec = read_json(args.spec, 1024 * 1024)
            _keys(spec, ("reportId", "reportPath", "audience", "createdAt", "files", "withheld", "custody"), ("reportId", "reportPath", "audience", "createdAt", "files"), "pack specification")
            _expect(isinstance(spec["files"], list) and 1 <= len(spec["files"]) <= MAX_FILES, "Bounded files required")
            files, types = {}, {}
            base = Path(args.base_dir or Path(args.spec).resolve().parent).resolve(strict=True)
            _expect(base.is_dir(), "Pack base directory is invalid")
            for entry in spec["files"]:
                _keys(entry, ("path", "source", "mediaType"), ("path", "source"), "pack source")
                _expect(entry["path"] not in files, "Duplicate pack path")
                files[entry["path"]] = _pack_source(base, entry["source"])
                if "mediaType" in entry:
                    types[entry["path"]] = entry["mediaType"]
            result = build_dossier(files, report_id=spec["reportId"], report_path=spec["reportPath"], audience=spec["audience"], created_at=spec["createdAt"], withheld=spec.get("withheld", ()), custody=spec.get("custody", ()), media_types=types)
        elif args.command == "verify":
            result = verify_dossier(read_json(args.dossier, MAX_CONTAINER_BYTES), trusted_keys=read_json(args.trusted_keys, 1024 * 1024) if args.trusted_keys else None, require_trusted_signature=args.require_trusted_signature)
        else:
            result = sign_dossier(read_json(args.dossier, MAX_CONTAINER_BYTES), private_key_path=args.private_key, key_id=args.key_id)
        _write(result, args.output)
        return 2 if args.command == "verify" and not result["valid"] else 0
    except (ValueError, OSError, TypeError, KeyError, OverflowError) as exc:
        print("Assurance procedure rejected: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
