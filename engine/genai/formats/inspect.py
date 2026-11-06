"""Inspect AI logs: `.eval` (zip, zstd entries) and `.json` (design section 7.2).

The engine never uses Inspect's reader and never passes `trust_log`; task
files, scorer names and metric options are strings only.
"""
from __future__ import annotations

import re

from .. import hashing, scorers
from ..errors import fail, require
from ..readers import NonFinite, ZipArchive
from ..taxonomy import plan_categories
from . import common

FORMATS = ("inspect_eval", "inspect_json")
LOG_VERSION = 2
SAMPLE_ENTRY = re.compile(r"^samples/(?P<id>.+)_epoch_(?P<epoch>[0-9]+)\.json$")
KNOWN_ENTRIES = re.compile(r"^(header\.json|reductions\.json|summaries\.json|_journal/start\.json|_journal/summaries/[0-9]+\.json|samples/.+_epoch_[0-9]+\.json)$")
CATEGORICAL = {"C": 1.0, "P": 0.5, "I": 0.0, "N": 0.0}
TRUE_WORDS = {"yes": 1.0, "true": 1.0, "no": 0.0, "false": 0.0}


def detect_eval(data: bytes) -> bool:
    if data[:4] != b"PK\x03\x04":
        return False
    try:
        names = ZipArchive(data).names()
    except Exception:  # noqa: BLE001 - detection never raises
        return False
    return "header.json" in names or "_journal/start.json" in names


def detect_json(doc) -> bool:
    return isinstance(doc, dict) and "version" in doc and isinstance(doc.get("eval"), dict) and "plan" in doc


def map_scalar(value):
    """(value, scale, null reason) of one Inspect score value (rule inspect.value_to_float)."""
    if isinstance(value, NonFinite):
        return None, "real", "non_finite_score"
    if isinstance(value, bool):
        return (1.0 if value else 0.0), "binary", None
    if isinstance(value, (int, float)):
        return float(value), "real", None
    if isinstance(value, str):
        if value in CATEGORICAL:
            return CATEGORICAL[value], "categorical", None
        if value.lower() in TRUE_WORDS:
            return TRUE_WORDS[value.lower()], "categorical", None
        return None, "categorical", "unparseable_score"
    return None, "categorical", "unparseable_score"


def _edits(history):
    out = []
    for entry in history[1:]:
        prov = entry.get("provenance") if isinstance(entry, dict) else None
        prov = prov if isinstance(prov, dict) else {}
        reason = prov.get("reason")
        out.append({
            "at": prov.get("timestamp") if isinstance(prov.get("timestamp"), str) else None,
            "author": hashing.clean(prov["author"])[:300] if isinstance(prov.get("author"), str) else None,
            "reasonSha256": hashing.sha256_text(reason) if isinstance(reason, str) else None,
        })
    return out


class _Ctx:
    def __init__(self, fmt, file_sha, plan, header, archive=None):
        self.fmt, self.file_sha, self.plan, self.header, self.archive = fmt, file_sha, plan, header, archive
        self.eval = header.get("eval") if isinstance(header.get("eval"), dict) else {}

    def hp(self, path):
        return ("header.json#" if self.fmt == "inspect_eval" else "#") + path

    def sp(self, path):
        return ("samples/*#" if self.fmt == "inspect_eval" else "#/samples/*") + path


def _samples(ctx, doc, run):
    """Yield (locator base, sample) in a deterministic order."""
    if ctx.fmt == "inspect_json":
        samples = doc.get("samples") or []
        require(isinstance(samples, list), "invalid_json", "samples must be a list")
        for index, sample in enumerate(samples):
            require(isinstance(sample, dict), "invalid_json", f"#/samples/{index}")
            yield f"#/samples/{index}", sample
        return
    names = ctx.archive.names()
    ignored = [n for n in names if not KNOWN_ENTRIES.match(n)]
    for name in ignored:
        run.warnings.add("ignored_entries", name)
    for name in names:
        if SAMPLE_ENTRY.match(name):
            sample = ctx.archive.read_json(name)
            require(isinstance(sample, dict), "invalid_json", name)
            yield name + "#", sample


def _spans(events):
    """Map span id -> (type, name, parent) and return a resolver from an event to its scorer name."""
    spans = {}
    for event in events:
        if isinstance(event, dict) and event.get("event") == "span_begin" and isinstance(event.get("id"), str):
            spans[event["id"]] = (event.get("type"), event.get("name"), event.get("parent_id"))

    def scorer_of(event):
        span, seen = event.get("span_id"), set()
        while isinstance(span, str) and span in spans and span not in seen:
            seen.add(span)
            kind, name, parent = spans[span]
            if kind == "scorer":
                return name
            span = parent
        return None
    return scorer_of


def parse(files, plan, manifest_inputs=None):
    (spec, data), = files
    fmt = spec["format"]
    file_sha = spec["sha256"]
    archive = None
    if fmt == "inspect_eval":
        archive = ZipArchive(data)
        names = archive.names()
        if "header.json" in names:
            header = archive.read_json("header.json")
        elif "_journal/start.json" in names:
            header = archive.read_json("_journal/start.json")
            header = dict(header) if isinstance(header, dict) else {}
            header["status"] = "started"
        else:
            fail("missing_required_entry", "header.json")
        doc = header
    else:
        doc = spec["_doc"]
        header = doc
    require(isinstance(header, dict) and isinstance(header.get("eval"), dict), "invalid_json", "eval header")
    ctx = _Ctx(fmt, file_sha, plan, header, archive)
    ev = ctx.eval
    eval_id = ev.get("eval_id")
    require(isinstance(eval_id, (str, int)) and not isinstance(eval_id, bool), "invalid_json", "eval.eval_id")
    run = common.ParsedRun(hashing.compose("inspect", hashing.c(str(eval_id))), fmt, [file_sha])
    version_ok = header.get("version") == LOG_VERSION
    if not version_ok:
        require(plan.get("allowUnverifiedFormatVersion"), "unsupported_format_version", f"Inspect log version {header.get('version')!r}")
        run.level_caps.append("unverified_format_version")
        run.warnings.add("unverified_format_version")
    packages = ev.get("packages") if isinstance(ev.get("packages"), dict) else {}
    tool_version = packages.get("inspect_ai") if isinstance(packages.get("inspect_ai"), str) else None
    if tool_version is not None and tool_version != scorers.INSPECT_VERIFIED:
        run.warnings.add("unverified_tool_version")
    if header.get("status") != "success":
        run.incomplete = True
        run.warnings.add("run_incomplete")

    task = ev.get("task_registry_name") or ev.get("task")
    task = str(task) if isinstance(task, (str, int)) and not isinstance(task, bool) else "inspect"
    task_version = ev.get("task_version")
    task_version = None if task_version is None or isinstance(task_version, (dict, list)) else str(task_version)
    eval_model = ev.get("model") if isinstance(ev.get("model"), str) else None
    policy = plan["scorePolicy"]
    scorer_specs = [s for s in (ev.get("scorers") or []) if isinstance(s, dict)]
    headline = ((header.get("results") or {}).get("headline") or {}) if isinstance(header.get("results"), dict) else {}
    run.primary_default = headline.get("scorer") if isinstance(headline.get("scorer"), str) else (scorer_specs[0].get("name") if scorer_specs else None)
    primary = plan.get("primaryScore") or run.primary_default
    task_types = plan.get("taskTypes") or {}
    cluster_key = plan.get("clusterKey")
    if isinstance(cluster_key, dict):
        cluster_key = cluster_key.get(task)
    technique_key, variant_key = plan.get("techniqueKey"), plan.get("variantKey")
    sandbox = bool(ev.get("sandbox"))

    judges = {}  # (model, scorer) -> ref
    judge_entries = []
    tools = {}
    agent_models = []
    score_edits, invalidations = [], []
    sample_count = 0
    for base, sample in _samples(ctx, doc, run):
        sample_count += 1
        locator = base + "/scores" if fmt == "inspect_eval" else base + "/scores"
        sample_id = sample.get("id")
        require(isinstance(sample_id, (str, int)) and not isinstance(sample_id, bool), "invalid_json", f"{base}: sample id")
        epoch = sample.get("epoch")
        require(isinstance(epoch, int) and not isinstance(epoch, bool), "invalid_json", f"{base}: epoch")
        events = [e for e in (sample.get("events") or []) if isinstance(e, dict)] if isinstance(sample.get("events"), list) else []
        scorer_of = _spans(events)
        offered = False
        sample_judges = {}
        for event in events:
            if event.get("event") != "model":
                continue
            if event.get("origin") == "agent":
                event_tools = event.get("tools") if isinstance(event.get("tools"), list) else []
                for tool in event_tools:
                    if isinstance(tool, dict) and isinstance(tool.get("name"), str):
                        offered = True
                        digest = hashing.sha256_canonical(tool)
                        tools.setdefault((tool["name"], digest), {"name": hashing.clean(tool["name"])[:300], "permission": "unknown", "definitionSha256": digest})
                output = event.get("output")
                if isinstance(output, dict) and isinstance(output.get("model"), str) and output["model"] not in agent_models:
                    agent_models.append(output["model"])
            elif event.get("origin") == "scorer" and isinstance(event.get("model"), str):
                scorer_name = scorer_of(event)
                if scorer_name is not None:
                    key = (event["model"], scorer_name)
                    if key not in judges:
                        judges[key] = f"J{len(judges) + 1}"
                        judge_entries.append(key)
                    sample_judges.setdefault(scorer_name, judges[key])
        sample_sandbox = bool(sample.get("sandbox"))
        item_type = task_types.get(task) or ("agent_task" if offered or sandbox or sample_sandbox else "qa")
        group_key = hashing.compose(hashing.c(task), hashing.c(str(sample_id)))
        item = common.new_item(run.run_key, group_key, epoch, item_type, fmt, file_sha, locator, sample.get("uuid"), task, task_version)
        attachments = sample.get("attachments") if isinstance(sample.get("attachments"), dict) else {}
        messages = [m for m in (sample.get("messages") or []) if isinstance(m, dict)] if isinstance(sample.get("messages"), list) else []
        normalized = [hashing.normalize_message(m, attachments, run.warnings, base) for m in messages]
        sample_input = sample.get("input")
        if isinstance(sample_input, str):
            item["promptSha256"] = hashing.sha256_text(sample_input)
        elif isinstance(sample_input, list):
            item["promptSha256"] = hashing.prompt_hash([hashing.normalize_message(m, attachments, run.warnings, base) for m in sample_input if isinstance(m, dict)])
        item["systemPromptSha256"] = hashing.system_hash(normalized)
        output = sample.get("output") if isinstance(sample.get("output"), dict) else {}
        error = sample.get("error")
        if isinstance(output.get("completion"), str) and not error:
            item["responseSha256"] = hashing.sha256_text(output["completion"])
        if item_type == "agent_task":
            transcript = []
            for message, norm in zip(messages, normalized):
                entry = dict(norm)
                for field in ("tool_calls", "tool_call_id", "function", "error"):
                    if message.get(field) is not None:
                        entry[field] = message[field]
                transcript.append(entry)
            item["transcriptSha256"] = hashing.sha256_canonical(transcript)
        target = sample.get("target")
        if isinstance(target, str):
            item["targetSha256"] = hashing.sha256_text(target)
        elif isinstance(target, list):
            item["targetSha256"] = hashing.sha256_canonical(target)
        if any(hashing.any_surrogate(v) for v in (sample_input, target, output.get("completion"))):
            common.add_warning(item, "lone_surrogate")

        null_reasons, edited_values = {}, {}
        sample_scores = sample.get("scores") if isinstance(sample.get("scores"), dict) else {}
        for name, record in sample_scores.items():
            if not isinstance(record, dict):
                continue
            history = record.get("history") if isinstance(record.get("history"), list) else []
            first = history[0] if history and isinstance(history[0], dict) else None
            original_raw = first.get("value") if first is not None else record.get("value")
            raw = record.get("value") if policy == "as_edited" else original_raw
            edited = len(history) >= 2
            edits = _edits(history) if edited else None
            if edited:
                score_edits.append({"itemKey": item["itemKey"], "score": hashing.clean(name)[:300], "edits": edits})
            judge_ref = sample_judges.get(name)
            kind = "model_graded" if judge_ref else ("deterministic" if name in scorers.INSPECT_DETERMINISTIC else "unknown")
            parts = [(name, raw, original_raw, record.get("value"))]
            if isinstance(raw, dict):
                parts = [(f"{name}/{key}", value, original_raw.get(key) if isinstance(original_raw, dict) else None, (record.get("value") or {}).get(key) if isinstance(record.get("value"), dict) else None) for key, value in raw.items()]
            for score_name, part_raw, part_original, part_edited in parts:
                value, scale, reason = map_scalar(part_raw) if not isinstance(part_raw, (dict, list)) else (None, "categorical", "unparseable_score")
                original = None
                if edited:
                    ov, _, _ = map_scalar(part_original) if not isinstance(part_original, (dict, list)) else (None, None, None)
                    original = {"raw": common.raw_scalar(part_original), "value": ov}
                if reason:
                    null_reasons[score_name] = reason
                ev_value, _, _ = map_scalar(part_edited) if not isinstance(part_edited, (dict, list)) else (None, None, None)
                edited_values[score_name] = ev_value
                item["scores"].append(common.score(score_name, part_raw if not isinstance(part_raw, (dict, list)) else None, value, None, scale, kind, judge_ref if kind == "model_graded" else None, edited=edited, original=original, edits=edits))
                run.score_kinds.setdefault(score_name, set()).add(kind)
        common.check_scores(item["scores"], locator)

        invalidation = sample.get("invalidation")
        if isinstance(invalidation, dict):
            invalidations.append({"itemKey": item["itemKey"], "at": invalidation.get("timestamp") if isinstance(invalidation.get("timestamp"), str) else None,
                                  "author": hashing.clean(invalidation["author"])[:300] if isinstance(invalidation.get("author"), str) else None,
                                  "reasonSha256": hashing.sha256_text(invalidation["reason"]) if isinstance(invalidation.get("reason"), str) else None})
        metadata = sample.get("metadata") if isinstance(sample.get("metadata"), dict) else {}
        item["clusterId"] = common.string_value(metadata.get(cluster_key)) if isinstance(cluster_key, str) else None
        if item_type == "attack":
            item["technique"] = common.string_value(metadata.get(technique_key)) if technique_key else hashing.clean(task)[:300]
            item["variant"] = common.string_value(metadata.get(variant_key)) if variant_key else None
        item["categories"] = plan_categories(plan, item["technique"])
        item["labels"] = common.labels_from(metadata, run.warnings, base)
        usage = sample.get("model_usage") if isinstance(sample.get("model_usage"), dict) else {}
        model_usage = usage.get(eval_model) if isinstance(usage.get(eval_model), dict) else None
        item["usage"] = None if model_usage is None else {
            "inputTokens": common._int(model_usage.get("input_tokens")),
            "outputTokens": common._int(model_usage.get("output_tokens")),
            "latencyMs": None,
        }
        item["timing"] = {
            "startedAt": sample.get("started_at") if isinstance(sample.get("started_at"), str) else None,
            "completedAt": sample.get("completed_at") if isinstance(sample.get("completed_at"), str) else None,
        }
        ctx_item = {"error": bool(error), "invalidated": isinstance(invalidation, dict) and policy == "as_edited", "nullReasons": null_reasons,
                    "editedValues": edited_values, "invalidatedPostRun": isinstance(invalidation, dict)}
        status, reason, value, rule = common.value_outcome(item, ctx_item, primary, plan["successRule"], "inspect.value_to_float")
        common.set_outcome(item, status, reason, value, rule, policy)
        run.add(item, ctx_item)

    # Cross-checks against the summaries and the journal.
    if archive is not None and "summaries.json" in archive.names():
        summaries = archive.read_json("summaries.json")
        if not isinstance(summaries, list) or len(summaries) != sample_count:
            run.warnings.add("summary_count_mismatch", "summaries.json")

    meta = run.meta = common.empty_metadata(run.run_key, fmt)
    meta["harness"] = {"name": "inspect_ai", "version": tool_version, "source": common.source("extracted", ctx.hp("/eval/packages/inspect_ai")) if tool_version else common.missing_source()}
    snapshot = None
    distinct = [m for m in agent_models if m != eval_model]
    if distinct:
        snapshot = hashing.clean(distinct[0])[:300]
        if len(agent_models) > 1:
            run.warnings.add("snapshot_changed_during_run")
    meta["systemUnderTest"] = common.model_ref(eval_model, common.source("extracted", ctx.hp("/eval/model")) if eval_model else None, snapshot)
    if snapshot is None and eval_model:
        run.warnings.add("moving_model_alias")
    if snapshot is not None:
        meta["systemUnderTest"]["_snapshotSource"] = common.source("extracted", ctx.sp("/events[event=model,origin=agent]/output/model"))
    common.apply_system_prompt(run, ctx.sp("/messages[role=system]"))
    plan_config = (header.get("plan") or {}).get("config") if isinstance(header.get("plan"), dict) else None
    generate = dict(ev.get("model_generate_config") or {}) if isinstance(ev.get("model_generate_config"), dict) else {}
    if isinstance(plan_config, dict):
        generate.update(plan_config)
    choices = common._int(generate.get("num_choices"))
    meta["decoding"] = common.decoding(
        {"temperature": generate.get("temperature"), "topP": generate.get("top_p"), "topK": generate.get("top_k"), "maxTokens": generate.get("max_tokens"), "seed": generate.get("seed")},
        common.source("extracted", ctx.hp("/plan/config")), choices if choices and choices >= 1 else 1)
    meta["tools"] = {"agentic": bool(tools) or sandbox, "offered": [tools[k] for k in sorted(tools)], "source": common.source("extracted", ctx.sp("/events[event=model,origin=agent]/tools"))}
    dataset = ev.get("dataset") if isinstance(ev.get("dataset"), dict) else {}
    dataset_name = dataset.get("name") or dataset.get("location") or task
    meta["dataset"] = common.versioned(dataset_name, task_version, None, common.source("extracted", ctx.hp("/eval/dataset")))
    if any(i["itemType"] == "attack" for i in run.items):
        meta["attackSet"] = common.versioned(task, task_version, None, common.source("extracted", ctx.hp("/eval/task")))
    config = ev.get("config") if isinstance(ev.get("config"), dict) else {}
    epochs = common._int(config.get("epochs")) or 1
    meta["epochs"] = {"value": epochs, "source": common.source("extracted", ctx.hp("/eval/config/epochs"))}
    stats = header.get("stats") if isinstance(header.get("stats"), dict) else {}
    started = stats.get("started_at") if isinstance(stats.get("started_at"), str) else None
    completed = stats.get("completed_at") if isinstance(stats.get("completed_at"), str) else None
    meta["dates"] = {"runStartedAt": started, "runCompletedAt": completed, "source": common.source("extracted", ctx.hp("/stats")) if (started or completed) else common.missing_source()}
    options = {s.get("name"): s.get("options") for s in scorer_specs}
    for model, scorer_name in judge_entries:
        opts = options.get(scorer_name)
        opts = {k: v for k, v in opts.items() if k not in ("model", "model_role")} if isinstance(opts, dict) else {}
        template = hashing.sha256_canonical({"harness": "inspect_ai", "version": tool_version, "scorer": scorer_name, "options": opts})
        meta["judges"].append({
            "ref": judges[(model, scorer_name)],
            "role": "grader",
            "model": common.model_ref(model, common.source("extracted", ctx.sp("/events[origin=scorer]/model"))),
            "promptTemplateSha256": template,
            "validation": None,
        })
    run.extra ={"evalReducer": config.get("epochs_reducer") or "mean", "headerResults": header.get("results")}
    run.tool_aggregates = _aggregates(header)
    run.post_run_edits = _post_run_edits(header, score_edits, invalidations, ctx)
    if run.post_run_edits["counts"]["invalidatedSampleEpochs"] and policy != "as_edited":
        run.warnings.add("invalidated_post_run", count=run.post_run_edits["counts"]["invalidatedSampleEpochs"])
    return [run]


def _aggregates(header):
    out = []
    results = header.get("results") if isinstance(header.get("results"), dict) else {}
    for entry in results.get("scores") or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            continue
        metrics = entry.get("metrics") if isinstance(entry.get("metrics"), dict) else {}
        for metric in ("accuracy", "mean", "stderr"):
            m = metrics.get(metric)
            if isinstance(m, dict):
                value = common.number(m.get("value"))
                out.append({"score": hashing.clean(entry["name"])[:300], "metric": metric, "value": value})
        scored = entry.get("scored_samples")
        if isinstance(scored, int) and not isinstance(scored, bool):
            out.append({"score": hashing.clean(entry["name"])[:300], "metric": "scored_samples", "value": scored})
    return out


def _post_run_edits(header, score_edits, invalidations, ctx):
    updates = []
    for update in header.get("log_updates") or []:
        if not isinstance(update, dict):
            continue
        prov = update.get("provenance") if isinstance(update.get("provenance"), dict) else {}
        kinds = [e.get("type") for e in update.get("edits") or [] if isinstance(e, dict) and isinstance(e.get("type"), str)]
        updates.append({
            "at": prov.get("timestamp") if isinstance(prov.get("timestamp"), str) else None,
            "author": hashing.clean(prov["author"])[:300] if isinstance(prov.get("author"), str) else None,
            "reasonSha256": hashing.sha256_text(prov["reason"]) if isinstance(prov.get("reason"), str) else None,
            "edits": kinds[:50],
        })
    ev = ctx.eval
    tags_changed = "tags" in header and header.get("tags") != (ev.get("tags") or [])
    metadata_changed = "metadata" in header and header.get("metadata") != (ev.get("metadata") or {})
    return {
        "logUpdates": updates,
        "scoreEdits": score_edits,
        "invalidations": invalidations,
        "logInvalidated": header.get("invalidated") is True,
        "tagsChanged": bool(tags_changed),
        "metadataChanged": bool(metadata_changed),
        "counts": {"logUpdates": len(updates), "scoreEdits": sum(len(e["edits"]) for e in score_edits), "invalidatedSampleEpochs": len(invalidations), "logInvalidated": header.get("invalidated") is True},
    }
