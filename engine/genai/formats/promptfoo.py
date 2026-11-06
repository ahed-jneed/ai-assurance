"""promptfoo results, version 3 (design section 7.4).

One run per (provider id, provider label, prompt id). Assertions that name
code (`javascript`, `python`, `webhook`, transforms) are recorded as data and
classified `unknown`; nothing is executed. `config.env`, provider
configuration beyond the allowlist, `response.raw` and error text are never
copied.
"""
from __future__ import annotations

from .. import hashing, scorers
from ..errors import GenaiInputError, require
from ..readers import loads
from ..taxonomy import plan_categories, promptfoo_categories
from . import common

FORMAT = "promptfoo_results"
RESULTS_VERSION = 3
CODE_KEYS = ("transform", "postprocess", "transformResponse")


def detect(doc) -> bool:
    return isinstance(doc, dict) and "evalId" in doc and isinstance(doc.get("results"), dict) and isinstance(doc["results"].get("results"), list) and doc["results"].get("version") == RESULTS_VERSION


def _provider_id(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("id"), str):
        return value["id"]
    return None


def _chat(raw):
    if not isinstance(raw, str) or not raw.lstrip().startswith("["):
        return None
    try:
        value = loads(raw)
    except GenaiInputError:
        return None
    if isinstance(value, list) and value and all(isinstance(m, dict) and isinstance(m.get("role"), str) and "content" in m for m in value):
        return [{"role": m["role"], "content": m["content"]} for m in value]
    return None


def _has_code(mapping):
    return isinstance(mapping, dict) and any(mapping.get(k) is not None for k in CODE_KEYS)


def parse(files, plan, manifest_inputs=None):
    (spec, _data), = files
    doc = spec["_doc"]
    require(detect(doc), "format_mismatch", spec["name"])
    file_sha = spec["sha256"]
    config = doc.get("config") if isinstance(doc.get("config"), dict) else {}
    metadata = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    version = metadata.get("promptfooVersion") if isinstance(metadata.get("promptfooVersion"), str) else None
    eval_id = doc.get("evalId")
    eval_id = eval_id if isinstance(eval_id, str) else str(eval_id)
    description = config.get("description") if isinstance(config.get("description"), str) and config.get("description") else None
    task_name = description or "promptfoo"
    tests = config.get("tests")
    tests_sha = hashing.sha256_canonical(tests) if tests is not None else None
    providers = [p for p in (config.get("providers") or []) if isinstance(p, dict)] if isinstance(config.get("providers"), list) else []
    default_test = config.get("defaultTest") if isinstance(config.get("defaultTest"), dict) else {}
    default_options = default_test.get("options") if isinstance(default_test.get("options"), dict) else {}
    runtime = doc.get("runtimeOptions") if isinstance(doc.get("runtimeOptions"), dict) else {}
    cluster_key = plan.get("clusterKey")
    primary_plan = plan.get("primaryScore")
    runs = {}
    rows = doc["results"]["results"]
    max_repeat = 0
    for index, result in enumerate(rows):
        require(isinstance(result, dict), "invalid_json", f"#/results/results/{index}")
        locator = f"#/results/results/{index}"
        provider = result.get("provider") if isinstance(result.get("provider"), dict) else {}
        pid = provider.get("id") if isinstance(provider.get("id"), str) else ""
        plabel = provider.get("label") if isinstance(provider.get("label"), str) else ""
        prompt_id = result.get("promptId") if isinstance(result.get("promptId"), str) else ""
        run_key = hashing.compose("promptfoo", hashing.c(eval_id), hashing.c(pid), hashing.c(plabel), hashing.c(prompt_id))
        run = runs.get(run_key)
        if run is None:
            run = common.ParsedRun(run_key, FORMAT, [file_sha])
            run.primary_default = "overall"
            run.extra = {"provider": (pid, plabel), "judges": {}, "judgeOrder": []}
            runs[run_key] = run
        test_case = result.get("testCase") if isinstance(result.get("testCase"), dict) else {}
        test_meta = test_case.get("metadata") if isinstance(test_case.get("metadata"), dict) else {}
        test_options = test_case.get("options") if isinstance(test_case.get("options"), dict) else {}
        is_attack = "pluginId" in test_meta and test_meta.get("pluginId") is not None
        repeat_group = result.get("repeatGroupId")
        test_idx = result.get("testIdx")
        if isinstance(repeat_group, str) and repeat_group:
            group_key = hashing.c(repeat_group)
        else:
            require(isinstance(test_idx, int) and not isinstance(test_idx, bool), "invalid_json", f"{locator}: testIdx")
            group_key = f"test-{test_idx}"
        repeat_index = result.get("repeatIndex", 0)
        require(isinstance(repeat_index, int) and not isinstance(repeat_index, bool) and repeat_index >= 0, "invalid_json", f"{locator}: repeatIndex")
        max_repeat = max(max_repeat, repeat_index + 1)
        item = common.new_item(run_key, group_key, repeat_index + 1, "attack" if is_attack else "qa", FORMAT, file_sha, locator, result.get("id"), task_name, None)
        prompt = result.get("prompt") if isinstance(result.get("prompt"), dict) else {}
        raw_prompt = prompt.get("raw")
        chat = _chat(raw_prompt)
        if chat is not None:
            item["promptSha256"] = hashing.prompt_hash(chat)
            item["systemPromptSha256"] = hashing.system_hash(chat)
        elif isinstance(raw_prompt, str):
            item["promptSha256"] = hashing.sha256_text(raw_prompt)
        failure = result.get("failureReason", 0)
        error = failure == 2
        response = result.get("response") if isinstance(result.get("response"), dict) else {}
        if not error and "output" in response and response.get("output") is not None:
            item["responseSha256"] = hashing.sha256_value(response["output"])
        grading = result.get("gradingResult") if isinstance(result.get("gradingResult"), dict) else None
        provider_entry = next((p for p in providers if p.get("id") == pid and (p.get("label") or "") == plabel), None)
        provider_code = _has_code(provider_entry) or _has_code((provider_entry or {}).get("config"))
        test_code = _has_code(test_options) or _has_code(default_options)
        kinds = []
        if grading is not None:
            names = {}
            for component in grading.get("componentResults") or []:
                if not isinstance(component, dict):
                    continue
                assertion = component.get("assertion") if isinstance(component.get("assertion"), dict) else {}
                atype = assertion.get("type") if isinstance(assertion.get("type"), str) else "unknown"
                name = atype + (f":{assertion['metric']}" if isinstance(assertion.get("metric"), str) and assertion.get("metric") else "")
                names[name] = names.get(name, 0) + 1
                if names[name] >= 2:
                    name = f"{name}#{names[name]}"
                kind = scorers.promptfoo_kind(atype, _has_code(assertion) or test_code or provider_code)
                judge_ref = None
                if kind == "model_graded":
                    judge_model = _provider_id(assertion.get("provider")) or _provider_id(test_options.get("provider")) or _provider_id(default_options.get("provider"))
                    if judge_model is not None:
                        judge_ref = _judge(run, judge_model, atype, version, assertion, test_options, default_options)
                raw = component.get("score")
                threshold = common.number(assertion.get("threshold"))
                item["scores"].append(common.score(name, raw, common.number(raw), component.get("pass") if isinstance(component.get("pass"), bool) else None,
                                                   "proportion", kind, judge_ref, threshold, with_threshold=threshold is not None))
                kinds.append(kind)
                run.score_kinds.setdefault(name, set()).add(kind)
            overall_kind = scorers.most_restrictive(kinds) if kinds else "unknown"
            raw = result.get("score")
            item["scores"].append(common.score("overall", raw, common.number(raw), result.get("success") if isinstance(result.get("success"), bool) else None, "proportion", overall_kind))
            run.score_kinds.setdefault("overall", set()).add(overall_kind)
            common.check_scores(item["scores"], locator)
        if is_attack:
            item["technique"] = common.string_value(test_meta.get("pluginId"))
            strategy = test_meta.get("strategyId")
            item["variant"] = common.string_value(strategy) if strategy is not None else "basic"
            categories, unknown = promptfoo_categories(test_meta.get("pluginId"), item["variant"])
            if unknown:
                run.warnings.add("uncategorised_plugin", locator)
            item["categories"] = categories
        else:
            item["categories"] = plan_categories(plan, None)
        item["labels"] = common.labels_from(test_meta, run.warnings, locator, drop=("pluginConfig", "modifiers"))
        if isinstance(cluster_key, str):
            value = test_meta.get(cluster_key)
            if value is None:
                variables = test_case.get("vars") if isinstance(test_case.get("vars"), dict) else {}
                value = variables.get(cluster_key)
            item["clusterId"] = common.string_value(value)
        usage = response.get("tokenUsage") if isinstance(response.get("tokenUsage"), dict) else (result.get("tokenUsage") if isinstance(result.get("tokenUsage"), dict) else {})
        latency = result.get("latencyMs")
        item["usage"] = {"inputTokens": common._int(usage.get("prompt")), "outputTokens": common._int(usage.get("completion")),
                         "latencyMs": latency if isinstance(latency, (int, float)) and not isinstance(latency, bool) and latency >= 0 else None}
        ctx = {"error": error, "success": result.get("success") is True, "failureReason": failure, "attack": is_attack}
        status, reason, value, rule = outcome(item, ctx, primary_plan or "overall", plan["successRule"])
        common.set_outcome(item, status, reason, value, rule, plan["scorePolicy"])
        run.add(item, ctx)

    counts = {"successes": 0, "failures": 0, "errors": 0}
    for run in runs.values():
        for item, ctx in zip(run.items, run.contexts):
            if ctx["error"]:
                counts["errors"] += 1
            elif ctx["success"]:
                counts["successes"] += 1
            else:
                counts["failures"] += 1
    stats = doc["results"].get("stats") if isinstance(doc["results"].get("stats"), dict) else {}
    stability = doc["results"].get("repeatStability") if isinstance(doc["results"].get("repeatStability"), dict) else {}
    epochs = common._int(runtime.get("repeat"))
    out = []
    for run in runs.values():
        meta = run.meta = common.empty_metadata(run.run_key, FORMAT)
        meta["harness"] = {"name": "promptfoo", "version": version, "source": common.source("extracted", "#/metadata/promptfooVersion") if version else common.missing_source()}
        pid, plabel = run.extra["provider"]
        model = hashing.redact(hashing.clean(pid), run.warnings, "#/results/results/*/provider/id") if pid else None
        meta["systemUnderTest"] = common.model_ref(model, common.source("extracted", "#/results/results/*/provider/id") if model else None)
        if model:
            run.warnings.add("moving_model_alias")
        common.apply_system_prompt(run, "#/results/results/*/prompt/raw")
        entry = next((p for p in providers if p.get("id") == pid and (p.get("label") or "") == plabel), None)
        pconfig = entry.get("config") if isinstance(entry, dict) and isinstance(entry.get("config"), dict) else {}
        other = {"model": common.other_setting(pconfig["model"])} if "model" in pconfig else {}
        meta["decoding"] = common.decoding({"temperature": pconfig.get("temperature"), "maxTokens": pconfig.get("max_tokens"), "topP": pconfig.get("top_p"), "seed": pconfig.get("seed")},
                                           common.source("extracted", "#/config/providers/*/config"), 1, other)
        meta["dataset"] = common.versioned(description, None, tests_sha, common.source("extracted", "#/config/description + #/config/tests"))
        if any(i["itemType"] == "attack" for i in run.items):
            meta["attackSet"] = common.versioned(description, None, tests_sha, common.source("extracted", "#/config/tests"))
        if epochs is not None and epochs >= 1:
            meta["epochs"] = {"value": epochs, "source": common.source("extracted", "#/runtimeOptions/repeat")}
        else:
            meta["epochs"] = {"value": max(max_repeat, 1), "source": common.source("computed", "#/results/results/*/repeatIndex")}
        started = metadata.get("evaluationCreatedAt") if isinstance(metadata.get("evaluationCreatedAt"), str) else None
        meta["dates"] = {"runStartedAt": started, "runCompletedAt": None, "source": common.source("extracted", "#/metadata/evaluationCreatedAt") if started else common.missing_source()}
        meta["judges"] = run.extra.pop("judgeEntries", [])
        if version is not None and version != scorers.PROMPTFOO_VERIFIED and version != "0.118.0":
            run.warnings.add("unverified_tool_version")
        run.tool_aggregates = [{"metric": f"stats.{k}", "scope": "file", "tool": common._int(stats.get(k)), "ours": counts[k]} for k in ("successes", "failures", "errors") if k in stats]
        for group in stability.get("groups") or []:
            if not isinstance(group, dict):
                continue
            gprov = group.get("provider") if isinstance(group.get("provider"), dict) else {}
            if gprov.get("id") != pid or (gprov.get("label") or "") != plabel:
                continue
            run.tool_aggregates.append({"metric": "repeatStability.passRate", "scope": "group", "group": hashing.c(str(group.get("repeatGroupId"))), "tool": common.number(group.get("passRate")), "informationOnly": True})
        out.append(run)
    return out


def _judge(run, model, atype, version, assertion, test_options, default_options):
    key = (model, atype)
    judges = run.extra["judges"]
    if key not in judges:
        judges[key] = f"J{len(judges) + 1}"
        rubric = assertion.get("rubricPrompt")
        if rubric is None:
            rubric = test_options.get("rubricPrompt", default_options.get("rubricPrompt"))
        template = hashing.sha256_canonical({"harness": "promptfoo", "version": version, "assertion": atype, "rubricPrompt": rubric})
        run.extra.setdefault("judgeEntries", []).append({
            "ref": judges[key],
            "role": "pairwise_judge" if atype in ("select-best", "not-select-best") else "grader",
            "model": common.model_ref(hashing.redact(hashing.clean(model)), common.source("extracted", "#/results/results/*/gradingResult/componentResults/*/assertion/provider")),
            "promptTemplateSha256": template,
            "validation": None,
        })
    return judges[key]


def outcome(item, ctx, primary, success_rule):
    rule = "promptfoo.redteam_failure" if ctx["attack"] else "promptfoo.success"
    if ctx["error"]:
        return "error", "tool_error", None, rule
    s = common.find_score(item, primary or "overall")
    if s is None:
        return "unscored", "no_score", None, rule
    if (success_rule or {}).get("type", "tool_native") != "tool_native":
        status, reason, value = common.apply_success_rule(success_rule, s, None)
        return status, reason, value, rule
    if s["passed"] is None:
        return "unscored", "no_score", None, rule
    if ctx["attack"]:
        return "scored", None, 1.0 if (s["passed"] is False and ctx["failureReason"] == 1) else 0.0, rule
    return "scored", None, 1.0 if s["passed"] else 0.0, rule
