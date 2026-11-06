"""lm-evaluation-harness results plus `--log_samples` files (design section 7.3).

Each task is one run. The rows of one `doc_id` under several filters merge
into one item whose scores carry the filter in their name. Task
configuration strings (`!function` hooks, templates) are never evaluated.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from .. import hashing, scorers
from ..errors import fail, require
from ..readers import NonFinite, load_jsonl
from ..taxonomy import plan_categories
from . import common

FORMAT = "lm_eval_samples"
SAMPLES_NAME = re.compile(r"^samples_(?P<task>.+)_(?P<date>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d+)\.jsonl$")
RESULTS_NAME = re.compile(r"^results_(?P<date>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d+)\.json$")
SAMPLE_KEYS = ("doc_id", "doc", "target", "arguments", "resps", "filtered_resps", "filter", "metrics", "doc_hash", "prompt_hash", "target_hash")
RESULT_KEYS = ("results", "configs", "versions", "n-samples", "lm_eval_version")
MAX_EPOCH_SECONDS = 32503680000.0  # 3000-01-01: later dates are not timestamps
MAX_DURATION_SECONDS = 10 * 365 * 86400
REVISION = re.compile(r"(?:^|,)\s*revision=([0-9a-f]{7,40})\s*(?:,|$)")


def detect_results(doc) -> bool:
    return isinstance(doc, dict) and all(k in doc for k in RESULT_KEYS)


def detect_samples(first_row) -> bool:
    return isinstance(first_row, dict) and all(k in first_row for k in SAMPLE_KEYS)


def _python_json(value):
    """The decoded value with non-finite markers back as floats, for lm-evaluation-harness's own hash recipes."""
    if isinstance(value, NonFinite):
        return value.as_float()
    if isinstance(value, dict):
        return {k: _python_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_python_json(v) for v in value]
    return value


def doc_hash(doc) -> str:
    return hashing.sha256_text(json.dumps(_python_json(doc), indent=2, ensure_ascii=False))


def _py_str(value):
    if isinstance(value, NonFinite):
        return repr(value.as_float())
    return str(_python_json(value))


def target_hashes(target):
    accepted = {hashing.sha256_text(_py_str(target))}
    if isinstance(target, list):
        accepted.add(hashing.sha256_text(str(tuple(_python_json(target)))))
    return accepted


def _model_args(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        out = {}
        for part in value.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
        return out
    return {}


def _timestamp(seconds):
    return datetime.fromtimestamp(0, tz=timezone.utc) + timedelta(seconds=seconds)


def _iso(moment):
    return moment.isoformat()


def parse(files, plan, manifest_inputs=None):
    results_spec = [(s, d) for s, d in files if s["role"] == "results"]
    samples_specs = [(s, d) for s, d in files if s["role"] == "samples"]
    require(len(results_spec) == 1 and samples_specs, "lm_eval_bundle_mismatch", "one results file and at least one samples file are required")
    rspec, _ = results_spec[0]
    results = rspec["_doc"]
    require(detect_results(results), "format_mismatch", rspec["name"])
    rmatch = RESULTS_NAME.match(rspec["name"])
    require(rmatch is not None, "lm_eval_bundle_mismatch", "results file name")
    date_id = rmatch.group("date")
    rname = rspec["name"]
    version = results.get("lm_eval_version")
    require(isinstance(version, str), "invalid_json", "lm_eval_version")
    caps, warnings_ = [], []
    if not version.startswith("0.4.") and version != "0.4":
        require(plan.get("allowUnverifiedFormatVersion"), "unsupported_format_version", f"lm_eval_version {version}")
        caps.append("unverified_format_version")
        warnings_.append("unverified_format_version")
    elif version != scorers.LM_EVAL_VERIFIED:
        warnings_.append("unverified_tool_version")
    configs = results.get("configs") if isinstance(results.get("configs"), dict) else {}
    versions = results.get("versions") if isinstance(results.get("versions"), dict) else {}
    config = results.get("config") if isinstance(results.get("config"), dict) else {}
    model_args = _model_args(config.get("model_args"))
    model = model_args.get("pretrained") or model_args.get("model") or config.get("model")
    model_pointer = f"{rname}#/config/model_args" if (model_args.get("pretrained") or model_args.get("model")) else f"{rname}#/config/model"
    raw_args = config.get("model_args") if isinstance(config.get("model_args"), str) else ",".join(f"{k}={v}" for k, v in model_args.items() if isinstance(v, str))
    revision = REVISION.search(raw_args or "")
    sanitized = results.get("model_name_sanitized") or results.get("model_name") or "model"
    task_hashes = results.get("task_hashes") if isinstance(results.get("task_hashes"), dict) else {}
    n_shot = results.get("n-shot") if isinstance(results.get("n-shot"), dict) else {}
    cluster_key = plan.get("clusterKey")
    runs = []
    seen_tasks = set()
    for spec, data in samples_specs:
        match = SAMPLES_NAME.match(spec["name"])
        require(match is not None, "lm_eval_bundle_mismatch", f"samples file name {spec['name']!r}")
        task = match.group("task")
        require(match.group("date") == date_id and task in configs and task not in seen_tasks, "lm_eval_bundle_mismatch", spec["name"])
        seen_tasks.add(task)
        tconfig = configs[task] if isinstance(configs[task], dict) else {}
        rows = load_jsonl(data, spec["name"])
        require(rows and detect_samples(rows[0][1]), "format_mismatch", spec["name"])
        run_key = hashing.compose("lm_eval", hashing.c(str(sanitized)), hashing.c(date_id), hashing.c(task))
        run = common.ParsedRun(run_key, FORMAT, [rspec["sha256"], spec["sha256"]])
        run.level_caps.extend(caps)
        for code in warnings_:
            run.warnings.add(code)
        task_cluster = cluster_key.get(task) if isinstance(cluster_key, dict) else cluster_key
        output_type = tconfig.get("output_type")
        metric_list = tconfig.get("metric_list")
        has_hook = tconfig.get("process_results") is not None
        if isinstance(metric_list, list):
            named = {m.get("metric") for m in metric_list if isinstance(m, dict) and isinstance(m.get("metric"), str)}
            aggregations = {m["metric"]: m.get("aggregation") for m in metric_list if isinstance(m, dict) and isinstance(m.get("metric"), str)}
        else:
            named = set(scorers.LM_EVAL_DEFAULT_METRICS.get(output_type, ()))
            aggregations = {}
        # Merge the rows of each doc_id across filters.
        docs, order, filters = {}, [], []
        concat = []
        mismatch = False
        for number, row in rows:
            require(detect_samples(row), "format_mismatch", f"{spec['name']}:{number}")
            doc_id = row["doc_id"]
            require(isinstance(doc_id, int) and not isinstance(doc_id, bool), "invalid_json", f"{spec['name']}:{number}: doc_id")
            filt = row["filter"] if isinstance(row["filter"], str) else str(row["filter"])
            if filt not in filters:
                filters.append(filt)
            hashes = tuple(row.get(k) for k in ("doc_hash", "prompt_hash", "target_hash"))
            require(all(isinstance(h, str) for h in hashes), "invalid_json", f"{spec['name']}:{number}: hashes")
            concat.append("".join(hashes))
            if doc_id not in docs:
                docs[doc_id] = {"line": number, "row": row, "hashes": hashes, "filters": {}}
                order.append(doc_id)
            entry = docs[doc_id]
            require(entry["hashes"] == hashes, "lm_eval_bundle_mismatch", f"{spec['name']}:{number}: rows of one doc disagree")
            require(filt not in entry["filters"], "lm_eval_bundle_mismatch", f"{spec['name']}:{number}: duplicate filter row")
            entry["filters"][filt] = row
        for entry in docs.values():
            require(set(entry["filters"]) == set(filters), "lm_eval_bundle_mismatch", "every filter must cover the same documents")
        first_row = rows[0][1]
        first_metrics = first_row.get("metrics") if isinstance(first_row.get("metrics"), list) else []
        run.primary_default = f"{first_metrics[0]},{first_row['filter']}" if first_metrics else None
        primary = plan.get("primaryScore") or run.primary_default
        # Occurrence counters among docs with the same doc_hash, by ascending doc_id.
        by_hash = {}
        for doc_id in sorted(docs):
            by_hash.setdefault(docs[doc_id]["hashes"][0], []).append(doc_id)
        occurrence = {doc_id: index for ids in by_hash.values() for index, doc_id in enumerate(ids)}
        value_sets = {}
        pending = []
        for doc_id in order:
            entry = docs[doc_id]
            row = entry["row"]
            locator = f"{spec['name']}:{entry['line']}"
            arg0 = common.obj(common.obj(row.get("arguments")).get("gen_args_0")).get("arg_0")
            recomputed_doc = doc_hash(row.get("doc"))
            group_key = hashing.compose(hashing.c(task), hashing.t16(recomputed_doc), str(occurrence[doc_id]))
            item = common.new_item(run_key, group_key, 1, "qa", FORMAT, spec["sha256"], locator, str(doc_id), task, None if versions.get(task) is None else str(versions.get(task)))
            if isinstance(arg0, str):
                item["promptSha256"] = hashing.sha256_text(arg0)
            target = row.get("target")
            item["targetSha256"] = hashing.sha256_value(target if not isinstance(target, NonFinite) else _py_str(target))
            doc_h, prompt_h, target_h = entry["hashes"]
            item["toolHashes"] = {k: v for k, v in (("lm_eval.doc_hash", doc_h), ("lm_eval.prompt_hash", prompt_h), ("lm_eval.target_hash", target_h)) if hashing.SHA256.match(v)}
            if doc_h != recomputed_doc or (not isinstance(arg0, str) or prompt_h != hashing.sha256_text(arg0)) or target_h not in target_hashes(target):
                mismatch = True
                run.warnings.add("tool_hash_mismatch", locator)
            resps = row.get("resps")
            if output_type == "generate_until" and isinstance(resps, list) and resps and isinstance(resps[0], list) and resps[0] and isinstance(resps[0][0], str):
                item["responseSha256"] = hashing.sha256_text(resps[0][0])
            null_reasons = {}
            for filt in filters:
                frow = entry["filters"][filt]
                for metric in common.seq(frow.get("metrics")):
                    if not isinstance(metric, str):
                        continue
                    name = f"{metric},{filt}"
                    raw = frow.get(metric)
                    if isinstance(raw, bool):
                        value = 1.0 if raw else 0.0
                    elif isinstance(raw, (int, float)):
                        value = float(raw)
                    else:
                        value = None
                        null_reasons[name] = "non_finite_score" if isinstance(raw, NonFinite) else "unparseable_score"
                    kind = "deterministic" if (metric in scorers.LM_EVAL_METRICS and metric in named and not has_hook) else "unknown"
                    item["scores"].append(common.score(name, raw if not isinstance(raw, (list, dict)) else None, value, None, "binary", kind))
                    run.score_kinds.setdefault(name, set()).add(kind)
                    value_sets.setdefault(name, set()).add(value)
            common.check_scores(item["scores"], locator)
            item["clusterId"] = common.string_value(common.dot_path(row, task_cluster)) if isinstance(task_cluster, str) else None
            item["categories"] = plan_categories(plan, None)
            repeats = tconfig.get("repeats")
            item["labels"] = {"filters": ",".join(filters), "outputType": common.label_value(output_type) if isinstance(output_type, str) else None, "repeats": repeats if isinstance(repeats, int) and not isinstance(repeats, bool) else None}
            pending.append((item, {"error": False, "nullReasons": null_reasons}))
        for name, values in value_sets.items():
            if not values <= {0.0, 1.0}:
                for item, _ in pending:
                    for s in item["scores"]:
                        if s["name"] == name:
                            s["scale"] = "real"
        primary_scale = None
        for item, ctx in pending:
            s = common.find_score(item, primary) if primary else None
            if s is not None:
                primary_scale = s["scale"]
            item["outcome"]["metric"] = "correct" if (s is None or s["scale"] == "binary") else "score"
            status, reason, value, rule = common.value_outcome(item, ctx, primary, plan["successRule"], "lm_eval.metric_value")
            common.set_outcome(item, status, reason, value, rule, plan["scorePolicy"])
            run.add(item, ctx)
        recomputed_task = hashing.sha256_text("".join(concat))
        reported_task = task_hashes.get(task)
        if isinstance(reported_task, str) and reported_task != recomputed_task:
            mismatch = True
            run.warnings.add("tool_hash_mismatch", f"{rname}#/task_hashes/{task}")
        if mismatch:
            run.level_caps.append("tool_hash_mismatch")
        meta = run.meta = common.empty_metadata(run_key, FORMAT)
        git = results.get("git_hash")
        harness_version = version + (f"+{git}" if isinstance(git, str) and git else "")
        meta["harness"] = {"name": "lm_eval", "version": harness_version[:100], "source": common.source("extracted", f"{rname}#/lm_eval_version")}
        snapshot = revision.group(1) if revision else None
        meta["systemUnderTest"] = common.model_ref(model if isinstance(model, str) else None, common.source("extracted", model_pointer) if isinstance(model, str) else None, snapshot)
        if snapshot:
            meta["systemUnderTest"]["_snapshotSource"] = common.source("extracted", f"{rname}#/config/model_args")
        sys_sha = results.get("system_instruction_sha")
        if isinstance(sys_sha, str) and hashing.SHA256.match(sys_sha):
            meta["systemPrompt"] = {"sha256": sys_sha, "distinctCount": 1, "source": common.source("extracted", f"{rname}#/system_instruction_sha")}
        elif results.get("chat_template") is None and results.get("chat_template_sha") is None:
            meta["systemPrompt"] = {"sha256": hashing.EMPTY_SHA256, "distinctCount": 1, "source": common.source("computed", f"{rname}#/system_instruction_sha + #/chat_template")}
        gen = dict(tconfig.get("generation_kwargs") or {}) if isinstance(tconfig.get("generation_kwargs"), dict) else {}
        if isinstance(config.get("gen_kwargs"), dict):
            gen.update(config["gen_kwargs"])
        other = {}
        for key in ("do_sample", "until"):
            if key in gen:
                other[key] = common.other_setting(gen[key])
        for key in ("numpy_seed", "torch_seed", "fewshot_seed"):
            if key in config:
                other[key] = common.other_setting(config[key])
        if task in n_shot:
            other["num_fewshot"] = common.other_setting(n_shot[task])
        generations = repeats if output_type == "generate_until" and isinstance((repeats := tconfig.get("repeats")), int) and not isinstance(repeats, bool) and repeats >= 1 else None
        meta["decoding"] = common.decoding({"temperature": gen.get("temperature"), "topP": gen.get("top_p"), "topK": gen.get("top_k"), "maxTokens": gen.get("max_gen_toks"), "seed": config.get("random_seed")},
                                           common.source("extracted", f"{rname}#/config + #/configs/{task}/generation_kwargs"), generations, other)
        meta["tools"] = {"agentic": False, "offered": [], "source": common.source("computed")}
        dataset_name = tconfig.get("dataset_path")
        if isinstance(dataset_name, str) and isinstance(tconfig.get("dataset_name"), str):
            dataset_name = f"{dataset_name}:{tconfig['dataset_name']}"
        meta["dataset"] = common.versioned(dataset_name if isinstance(dataset_name, str) else None, None if versions.get(task) is None else str(versions.get(task)),
                                           reported_task if isinstance(reported_task, str) and hashing.SHA256.match(reported_task) else None,
                                           common.source("extracted", f"{rname}#/configs/{task}/dataset_path"))
        meta["epochs"] = {"value": 1, "source": common.source("computed")}
        date = common.number(results.get("date"))
        if date is not None and 0.0 <= date <= MAX_EPOCH_SECONDS:
            start = _timestamp(date)
            completed = None
            total = results.get("total_evaluation_time_seconds")
            try:
                seconds = Decimal(str(total)) if isinstance(total, (str, int, float)) and not isinstance(total, bool) else None
            except InvalidOperation:
                seconds = None
            if seconds is not None and seconds.is_finite() and 0 <= seconds <= MAX_DURATION_SECONDS:
                completed = _iso(start + timedelta(seconds=float(seconds)))
            meta["dates"] = {"runStartedAt": _iso(start), "runCompletedAt": completed, "source": common.source("computed", f"{rname}#/date + #/total_evaluation_time_seconds")}
        run.extra = {"aggregations": aggregations, "namedMetrics": named, "primaryScale": primary_scale}
        run.tool_aggregates = _aggregates(results.get("results"), task)
        runs.append(run)
    return runs


def aggregation_of(run, score_name):
    metric = score_name.split(",", 1)[0]
    aggregations = run.extra.get("aggregations") or {}
    if metric in aggregations:
        return aggregations[metric] if isinstance(aggregations[metric], str) else None
    if metric in scorers.LM_EVAL_DEFAULT_AGGREGATION:
        return scorers.LM_EVAL_DEFAULT_AGGREGATION[metric]
    return None


def _aggregates(results, task):
    out = []
    entry = results.get(task) if isinstance(results, dict) else None
    if not isinstance(entry, dict):
        return out
    for key, value in entry.items():
        if not isinstance(key, str) or "," not in key:
            continue
        metric, filt = key.split(",", 1)
        if metric.endswith("_stderr"):
            out.append({"score": f"{metric[:-7]},{filt}", "metric": "stderr", "value": common.number(value), "raw": value if isinstance(value, str) else None})
        else:
            out.append({"score": key, "metric": "value", "value": common.number(value)})
    return out
