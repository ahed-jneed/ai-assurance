"""Ragas results exported as JSON lines (design section 7.8).

The supported export is `result.to_pandas().to_json(path, orient="records",
lines=True)`. CSV is rejected: list columns would need `ast.literal_eval`.
Ragas records no judge, so a column produced by an LLM metric is `unknown`
until the manifest declares its judge.
"""
from __future__ import annotations

from .. import hashing, scorers
from ..errors import require
from ..readers import NonFinite, load_jsonl
from ..taxonomy import plan_categories
from . import common
from .deepeval import check_plan, item_type, metric_outcome

FORMAT = "ragas_results"
INPUT_COLUMNS = ("user_input", "retrieved_contexts", "reference_contexts", "response", "multi_responses", "reference", "rubrics", "reference_tool_calls")


def _is_metric_value(value):
    return value is None or isinstance(value, NonFinite) or (isinstance(value, (int, float)) and not isinstance(value, bool))


def detect(rows) -> bool:
    if not rows:
        return False
    first = rows[0]
    if not (isinstance(first, dict) and "user_input" in first and "response" in first):
        return False
    return bool(metric_columns(rows))


def metric_columns(rows):
    columns = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    return [c for c in columns if c not in INPUT_COLUMNS and all(_is_metric_value(r.get(c)) for r in rows) and any(c in r for r in rows)]


def parse(files, plan, manifest_inputs=None):
    (spec, data), = files
    name = spec["name"]
    numbered = load_jsonl(data, name)
    rows = [r for _, r in numbered]
    require(detect(rows), "format_mismatch", name)
    metrics = metric_columns(rows)
    label_columns = []
    for row in rows:
        for key in row:
            if key not in INPUT_COLUMNS and key not in metrics and key not in label_columns:
                label_columns.append(key)
    file_sha = spec["sha256"]
    run_key = spec.get("runKey") or hashing.compose("ragas", hashing.t16(file_sha))
    run = common.ParsedRun(run_key, FORMAT, [file_sha])
    primary = plan.get("primaryScore")
    cluster_key, technique_key, variant_key = plan.get("clusterKey"), plan.get("techniqueKey"), plan.get("variantKey")
    counters = {}
    for number, row in numbered:
        locator = f"{name}:{number}"
        user_input = row.get("user_input")
        input_sha = hashing.sha256_value(user_input) if user_input is not None else hashing.EMPTY_SHA256
        index = counters.get(input_sha, 0)
        counters[input_sha] = index + 1
        group_key = hashing.compose("ragas", hashing.t16(input_sha), str(index))
        contexts = row.get("retrieved_contexts")
        itype = item_type(plan, "ragas", isinstance(contexts, list) and len(contexts) > 0)
        item = common.new_item(run_key, group_key, 1, itype, FORMAT, file_sha, locator, None, "ragas", None)
        item["outcome"]["metric"] = {"attack": "attack_success", "agent_task": "task_success"}.get(itype, "score")
        if user_input is not None:
            item["promptSha256"] = input_sha
        if row.get("response") is not None:
            item["responseSha256"] = hashing.sha256_value(row["response"])
        if row.get("reference") is not None:
            item["targetSha256"] = hashing.sha256_value(row["reference"])
        null_reasons = {}
        for metric in metrics:
            raw = row.get(metric)
            value = common.number(raw)
            if value is None:
                null_reasons[metric] = "non_finite_score"
            kind = "deterministic" if metric in scorers.RAGAS_DETERMINISTIC else "unknown"
            item["scores"].append(common.score(metric, raw, value, None, "proportion", kind))
            run.score_kinds.setdefault(metric, set()).add(kind)
        common.check_scores(item["scores"], locator)
        item["clusterId"] = common.string_value(row.get(cluster_key)) if isinstance(cluster_key, str) else None
        if itype == "attack":
            item["technique"] = common.string_value(row.get(technique_key)) if technique_key else None
            item["variant"] = common.string_value(row.get(variant_key)) if variant_key else None
        item["categories"] = plan_categories(plan, item["technique"])
        labels = {}
        if "retrieved_contexts" in row:
            labels["retrievedContextsSha256"] = hashing.sha256_canonical(row["retrieved_contexts"])
        if "reference_contexts" in row:
            labels["referenceContextsSha256"] = hashing.sha256_canonical(row["reference_contexts"])
        labels.update(common.labels_from({k: row.get(k) for k in label_columns if k in row}, run.warnings, locator))
        item["labels"] = dict(list(labels.items())[:50])
        ctx = {"error": False, "nullReasons": null_reasons}
        status, reason, value, rule = metric_outcome(item, ctx, primary, plan["successRule"], "ragas.metric_value")
        common.set_outcome(item, status, reason, value, rule, plan["scorePolicy"])
        run.add(item, ctx)
    check_plan(plan, FORMAT, run.items)
    run.meta = common.empty_metadata(run_key, FORMAT)
    run.meta["harness"] = {"name": "ragas", "version": None, "source": common.missing_source()}
    return [run]
