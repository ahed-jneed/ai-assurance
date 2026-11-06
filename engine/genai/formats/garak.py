"""garak report JSONL plus hit log (design section 7.5).

One item per (attempt, generation); every detector that scored the attempt
is a score of that item, never a separate item. garak's own digest,
bootstrap intervals and `doc_uri` links are information only and never
followed or re-run.
"""
from __future__ import annotations

from datetime import datetime

from .. import hashing, scorers
from ..errors import require
from ..readers import load_jsonl
from ..taxonomy import garak_categories
from . import common

FORMAT = "garak_report"
HITLOG_KEYS = ("probe", "detector", "attempt_id", "attempt_seq", "attempt_idx", "score", "generator", "generations_per_prompt")
DEFAULT_THRESHOLD = 0.5


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("entry_type") == "start_run setup"


def detect_hitlog(first_row) -> bool:
    return isinstance(first_row, dict) and all(k in first_row for k in HITLOG_KEYS)


def _turn_content(content):
    if isinstance(content, dict) and isinstance(content.get("text"), str) and content.get("data_path") is None:
        return content["text"]
    return content


def _naive_to_utc(text, offset):
    if not isinstance(text, str) or offset is None:
        return None
    try:
        moment = datetime.fromisoformat(text + offset)
    except ValueError:
        return None
    return moment.isoformat()


def parse(files, plan, manifest_inputs=None, declared=None):
    reports = [(s, d) for s, d in files if s["role"] != "hitlog"]
    hitlogs = [(s, d) for s, d in files if s["role"] == "hitlog"]
    require(len(reports) == 1 and len(hitlogs) <= 1, "format_mismatch", "one garak report and at most one hit log")
    spec, data = reports[0]
    name = spec["name"]
    rows = load_jsonl(data, name)
    require(rows and detect(rows[0][1]), "format_mismatch", name)
    setup_line, setup = rows[0]
    version = setup.get("_config.version") if isinstance(setup.get("_config.version"), str) else None
    run_id = setup.get("transient.run_id")
    init = next(((n, r) for n, r in rows if r.get("entry_type") == "init"), (None, {}))
    if not isinstance(run_id, str):
        run_id = init[1].get("run") if isinstance(init[1].get("run"), str) else "garak"
    run = common.ParsedRun(hashing.compose("garak", hashing.c(run_id)), FORMAT, [spec["sha256"]] + [h["sha256"] for h, _ in hitlogs])
    if version is None or not version.startswith("0.17."):
        require(plan.get("allowUnverifiedFormatVersion"), "unsupported_format_version", f"garak {version!r}")
        run.level_caps.append("unverified_format_version")
        run.warnings.add("unverified_format_version")
    elif version != scorers.GARAK_VERIFIED:
        run.warnings.add("unverified_tool_version")
    threshold = setup.get("run.eval_threshold")
    threshold = common.number(threshold) if common.number(threshold) is not None else DEFAULT_THRESHOLD
    cache = {"probes": {}, "detectors": {}, "generators": {}}
    for _, row in rows:
        if row.get("entry_type") == "plugin_cache" and isinstance(row.get("plugin_cache"), dict):
            for kind in cache:
                section = row["plugin_cache"].get(kind)
                if isinstance(section, dict):
                    for key, value in section.items():
                        if isinstance(value, dict):
                            cache[kind].setdefault(key, value)
    detector_overrides = setup.get("plugins.detectors") if isinstance(setup.get("plugins.detectors"), dict) else {}
    # Keep the last status-2 entry per uuid; remember status-1-only and status-0 attempts.
    attempts, order = {}, []
    for number, row in rows:
        if row.get("entry_type") != "attempt":
            continue
        uuid = row.get("uuid")
        require(isinstance(uuid, str), "invalid_json", f"{name}:{number}: attempt uuid")
        status = row.get("status")
        if uuid not in attempts:
            order.append(uuid)
            attempts[uuid] = (number, row)
        elif status == 2 or attempts[uuid][1].get("status") != 2:
            attempts[uuid] = (number, row)
    # Group attempts by probe and prompt hash for the occurrence counters.
    prepared = []
    for uuid in order:
        number, row = attempts[uuid]
        probe = row.get("probe_classname") if isinstance(row.get("probe_classname"), str) else "garak"
        prompt = row.get("prompt") if isinstance(row.get("prompt"), dict) else {}
        turns = [t for t in (prompt.get("turns") or []) if isinstance(t, dict)] if isinstance(prompt.get("turns"), list) else []
        normalized = [{"role": t.get("role"), "content": _turn_content(t.get("content"))} for t in turns]
        prompt_sha = hashing.prompt_hash(normalized)
        seq = row.get("seq") if isinstance(row.get("seq"), int) and not isinstance(row.get("seq"), bool) else 0
        prepared.append((probe, prompt_sha, seq, number, uuid, row, normalized))
    occurrence = {}
    counters = {}
    for probe, prompt_sha, seq, number, uuid, _row, _n in sorted(prepared, key=lambda p: (p[0], p[1], p[2], p[3])):
        index = counters.get((probe, prompt_sha), 0)
        counters[(probe, prompt_sha)] = index + 1
        occurrence[uuid] = index
    judges = {}
    per_detector = {}
    for probe, prompt_sha, seq, number, uuid, row, normalized in prepared:
        probe_info = cache["probes"].get(f"probes.{probe}", {})
        tags = [t for t in common.seq(probe_info.get("tags")) if isinstance(t, str)]
        categories, uncategorised = garak_categories(probe, tags)
        if uncategorised:
            run.warnings.add("uncategorised_probe", f"{name}:{number}")
        group_key = hashing.compose(hashing.c(probe), hashing.t16(prompt_sha), str(occurrence[uuid]))
        outputs = row.get("outputs") if isinstance(row.get("outputs"), list) else []
        results = row.get("detector_results") if isinstance(row.get("detector_results"), dict) else {}
        detectors = [d for d in results if isinstance(d, str)]
        targets = row.get("targets") if isinstance(row.get("targets"), list) else []
        system = hashing.system_hash(normalized)
        status = row.get("status")
        for g, output in enumerate(outputs or [None]):
            locator = f"{name}:{number}#/outputs/{g}"
            item = common.new_item(run.run_key, group_key, g + 1, "attack", FORMAT, spec["sha256"], locator, uuid, probe, version)
            item["promptSha256"] = prompt_sha
            item["systemPromptSha256"] = system
            text = output.get("text") if isinstance(output, dict) else None
            if isinstance(text, str):
                item["responseSha256"] = hashing.sha256_text(text)
            item["targetSha256"] = hashing.sha256_canonical(targets) if targets else None
            for detector in detectors:
                values = results[detector] if isinstance(results[detector], list) else []
                raw = values[g] if g < len(values) else None
                value = common.number(raw)
                params = dict(common.obj(common.obj(cache["detectors"].get(f"detectors.{detector}")).get("DEFAULT_PARAMS")))
                kind = scorers.garak_kind(detector, params)
                judge_ref = None
                if kind == "model_graded":
                    override = detector_overrides.get(detector) if isinstance(detector_overrides.get(detector), dict) else {}
                    params.update(override)
                    model = params.get("detector_model_name")
                    if isinstance(model, str):
                        key = (model, detector)
                        if key not in judges:
                            judges[key] = {"ref": f"J{len(judges) + 1}", "params": params}
                        judge_ref = judges[key]["ref"]
                item["scores"].append(common.score(detector, raw, value, (value < threshold) if value is not None else None, "proportion", kind, judge_ref, threshold, with_threshold=True))
                run.score_kinds.setdefault(detector, set()).add(kind)
                stats = per_detector.setdefault((probe, detector), {"passed": 0, "fails": 0, "nones": 0, "attempts": {}})
                if value is None:
                    stats["nones"] += 1
                elif value >= threshold:
                    stats["fails"] += 1
                else:
                    stats["passed"] += 1
                hit = value is not None and value >= threshold
                stats["attempts"][uuid] = stats["attempts"].get(uuid, False) or hit
            common.check_scores(item["scores"], locator)
            item["technique"] = hashing.clean(probe)[:300]
            item["categories"] = categories
            item["labels"] = common.labels_from({"detectors": ",".join(detectors), "goal": row.get("goal"), "intent": row.get("intent"), "tags": ",".join(tags)}, run.warnings, locator)
            cluster_key = plan.get("clusterKey")
            item["clusterId"] = common.string_value(common.dot_path(row, cluster_key)) if isinstance(cluster_key, str) else None
            ctx = {"error": status == 0, "unsent": status == 0, "unevaluated": status == 1, "threshold": threshold, "nullOutput": not isinstance(text, str)}
            st, reason, value, rule = outcome(item, ctx, plan.get("primaryScore"), plan["successRule"])
            common.set_outcome(item, st, reason, value, rule, plan["scorePolicy"])
            run.add(item, ctx)
    # Run metadata.
    meta = run.meta = common.empty_metadata(run.run_key, FORMAT)
    src1 = f"{name}:{setup_line}#"
    meta["harness"] = {"name": "garak", "version": version, "source": common.source("extracted", src1 + "/_config.version") if version else common.missing_source()}
    target_name = setup.get("plugins.target_name")
    target_type = setup.get("plugins.target_type")
    model = target_name if isinstance(target_name, str) and target_name else (target_type if isinstance(target_type, str) else None)
    meta["systemUnderTest"] = common.model_ref(hashing.redact(model, run.warnings) if model else None,
                                               common.source("extracted", src1 + ("/plugins.target_name" if model == target_name else "/plugins.target_type")) if model else None)
    system_prompt = setup.get("run.system_prompt")
    if isinstance(system_prompt, str):
        meta["systemPrompt"] = {"sha256": hashing.sha256_text(system_prompt), "distinctCount": 1, "source": common.source("extracted", src1 + "/run.system_prompt")}
    else:
        common.apply_system_prompt(run, f"{name}:*#/prompt/turns[role=system]")
    generations = common._int(setup.get("run.generations"))
    generator = cache["generators"].get(f"generators.{target_type}", {}) if isinstance(target_type, str) else {}
    gparams = common.obj(common.obj(generator).get("DEFAULT_PARAMS"))
    meta["decoding"] = common.decoding({"temperature": gparams.get("temperature"), "topP": gparams.get("top_p"), "topK": gparams.get("top_k"), "maxTokens": gparams.get("max_tokens"), "seed": setup.get("run.seed")},
                                       common.source("extracted", src1 + "/run.*"), generations if generations and generations >= 1 else None)
    probes = sorted(p for p in (setup.get("transient.active_probes") or []) if isinstance(p, str)) if isinstance(setup.get("transient.active_probes"), list) else []
    meta["dataset"] = common.versioned("garak probes " + ",".join(probes) if probes else None, version, None, common.source("extracted", src1 + "/transient.active_probes") if probes else common.missing_source())
    spec_includes = (setup.get("run.spec") or {}).get("include") if isinstance(setup.get("run.spec"), dict) else None
    includes = sorted(p for p in spec_includes if isinstance(p, str)) if isinstance(spec_includes, list) else probes
    meta["attackSet"] = common.versioned(",".join(includes) if includes else None, version, None, common.source("extracted", src1 + "/run.spec"))
    meta["epochs"] = {"value": generations if generations and generations >= 1 else None, "source": common.source("extracted", src1 + "/run.generations")}
    offset = (declared or {}).get("dates", {}).get("utcOffset") if declared else None
    completion = next(((n, r) for n, r in rows if r.get("entry_type") == "completion"), (None, {}))
    start_text = init[1].get("start_time")
    end_text = completion[1].get("end_time")
    start = _naive_to_utc(start_text, offset)
    end = _naive_to_utc(end_text, offset)
    if start or end:
        meta["dates"] = {"runStartedAt": start, "runCompletedAt": end, "source": common.source("declared", f"{name}:{init[0]}#/start_time", "manifest#/declared/dates/utcOffset")}
    else:
        meta["dates"] = {"runStartedAt": None, "runCompletedAt": None, "source": common.source("missing", f"{name}:{init[0]}#/start_time" if init[0] else None)}
        if isinstance(start_text, str):
            run.warnings.add("naive_timestamp", f"{name}:{init[0]}")
    for (model_name, detector), entry in judges.items():
        params = {k: v for k, v in entry["params"].items() if k not in ("detector_model_type", "detector_model_name", "detector_model_config")}
        meta["judges"].append({
            "ref": entry["ref"], "role": "detector_model",
            "model": common.model_ref(hashing.redact(model_name), common.source("extracted", f"{name}:*#/plugin_cache/detectors/{detector}/DEFAULT_PARAMS/detector_model_name")),
            "promptTemplateSha256": hashing.sha256_canonical({"harness": "garak", "version": version, "detector": detector, "params": params}),
            "validation": None,
        })
    # Reconciliation with the eval entries and the hit log.
    aggregates = []
    for number, row in rows:
        if row.get("entry_type") != "eval":
            continue
        key = tuple(v if isinstance(v, str) else None for v in (row.get("probe"), row.get("detector")))
        ours = per_detector.get(key, {"passed": 0, "fails": 0, "nones": 0, "attempts": {}})
        label = f"{key[0]}|{key[1]}"
        for field in ("passed", "fails", "nones"):
            aggregates.append({"metric": f"eval.{field}", "group": label, "tool": common._int(row.get(field)), "ours": ours[field]})
        hits = row.get("hit_at_k") if isinstance(row.get("hit_at_k"), dict) else {}
        top = hits.get(str(generations)) if generations else None
        if isinstance(top, dict) and ours["attempts"]:
            rate = sum(1 for v in ours["attempts"].values() if v) / len(ours["attempts"])
            aggregates.append({"metric": "eval.hit_at_k", "group": label, "tool": common.number(top.get("score")), "ours": rate})
    if hitlogs:
        hspec, hdata = hitlogs[0]
        hrows = load_jsonl(hdata, hspec["name"])
        require(not hrows or detect_hitlog(hrows[0][1]), "format_mismatch", hspec["name"])
        ours_hits = sum(stats["fails"] for stats in per_detector.values())
        aggregates.append({"metric": "hitlog.rows", "tool": len(hrows), "ours": ours_hits})
    run.tool_aggregates = aggregates
    run.primary_default = None
    return [run]


def outcome(item, ctx, primary, success_rule):
    rule = "garak.detector_threshold" if primary else "garak.any_detector_threshold"
    if ctx.get("unsent"):
        return "error", "tool_error", None, rule
    if ctx.get("unevaluated") or ctx.get("nullOutput"):
        return "unscored", "no_score", None, rule
    threshold = ctx["threshold"]
    custom = (success_rule or {}).get("type", "tool_native") != "tool_native"
    if primary:
        s = common.find_score(item, primary)
        if s is None:
            return "unscored", "no_score", None, rule
        if custom:
            status, reason, value = common.apply_success_rule(success_rule, s, None)
            return status, reason, value, rule
        if s["value"] is None:
            return "unscored", "no_score", None, rule
        return "scored", None, 1.0 if s["value"] >= threshold else 0.0, rule
    values = [s["value"] for s in item["scores"] if s["value"] is not None]
    if not values:
        return "unscored", "no_score", None, rule
    if custom:
        decided = [common.apply_success_rule(success_rule, s, None) for s in item["scores"] if s["value"] is not None]
        return "scored", None, 1.0 if any(v == 1.0 for _, _, v in decided) else 0.0, rule
    return "scored", None, 1.0 if any(v >= threshold for v in values) else 0.0, rule
