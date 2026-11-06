"""DeepEval test-run JSON (design section 7.7).

The file records no DeepEval version and no system-under-test identity, so
those are declared in the manifest. `reason` and `verboseLogs` are never
copied.
"""
from __future__ import annotations

from .. import hashing, scorers
from ..errors import require
from ..taxonomy import plan_categories
from . import common

FORMAT = "deepeval_test_run"


def detect(doc) -> bool:
    return isinstance(doc, dict) and isinstance(doc.get("testCases"), list) and isinstance(doc.get("metricsScores"), list) and "testPassed" in doc and "testFailed" in doc


def metric_outcome(item, ctx, primary, success_rule, rule):
    """DeepEval and Ragas: the primary score's value; attack and agent items need a 0/1 success rule."""
    return common.value_outcome(item, ctx, primary, success_rule, rule)


def item_type(plan, task, has_context):
    return (plan.get("taskTypes") or {}).get(task) or ("rag" if has_context else "qa")


def check_plan(plan, run_format, items):
    if any(i["itemType"] in ("attack", "agent_task") for i in items):
        require(plan["successRule"]["type"] != "tool_native", "plan_invalid", f"{run_format} attack and agent items need a threshold or value_in successRule")


def parse(files, plan, manifest_inputs=None):
    (spec, _data), = files
    doc = spec["_doc"]
    require(detect(doc), "format_mismatch", spec["name"])
    file_sha = spec["sha256"]
    run_key = spec.get("runKey") or hashing.compose("deepeval", hashing.t16(file_sha))
    run = common.ParsedRun(run_key, FORMAT, [file_sha])
    cases = doc["testCases"]
    if doc.get("conversationalTestCases"):
        run.warnings.add("unsupported_conversational_case", "#/conversationalTestCases")
    names = [c.get("name") if isinstance(c, dict) else None for c in cases]
    by_name = all(isinstance(n, str) and n for n in names) and len(set(names)) == len(names)
    primary = plan.get("primaryScore")
    judges = {}
    cluster_key, technique_key, variant_key = plan.get("clusterKey"), plan.get("techniqueKey"), plan.get("variantKey")
    for index, case in enumerate(cases):
        require(isinstance(case, dict), "invalid_json", f"#/testCases/{index}")
        locator = f"#/testCases/{index}"
        order = case.get("order", index)
        group_key = hashing.compose("deepeval", hashing.c(case["name"])) if by_name else f"deepeval:order-{order if isinstance(order, int) and not isinstance(order, bool) else index}"
        context = case.get("retrievalContext")
        itype = item_type(plan, "deepeval", isinstance(context, list) and len(context) > 0)
        item = common.new_item(run_key, group_key, 1, itype, FORMAT, file_sha, locator, case.get("name"), "deepeval", None)
        item["outcome"]["metric"] = {"attack": "attack_success", "agent_task": "task_success"}.get(itype, "score")
        if case.get("input") is not None:
            item["promptSha256"] = hashing.sha256_value(case["input"])
        if case.get("actualOutput") is not None:
            item["responseSha256"] = hashing.sha256_value(case["actualOutput"])
        if case.get("expectedOutput") is not None:
            item["targetSha256"] = hashing.sha256_value(case["expectedOutput"])
        null_reasons = {}
        for metric in case.get("metricsData") or []:
            if not isinstance(metric, dict) or not isinstance(metric.get("name"), str):
                continue
            mname = metric["name"]
            model = metric.get("evaluationModel")
            judge_ref = None
            if isinstance(model, str) and model:
                kind = "model_graded"
                if model not in judges:
                    judges[model] = f"J{len(judges) + 1}"
                judge_ref = judges[model]
            elif mname in scorers.DEEPEVAL_DETERMINISTIC:
                kind = "deterministic"
            else:
                kind = "unknown"
            raw = metric.get("score")
            value = common.number(raw)
            if value is None:
                null_reasons[mname] = "unparseable_score"
            threshold = common.number(metric.get("threshold"))
            item["scores"].append(common.score(mname, raw, value, metric.get("success") if isinstance(metric.get("success"), bool) else None, "proportion", kind, judge_ref, threshold, with_threshold=True))
            run.score_kinds.setdefault(mname, set()).add(kind)
        common.check_scores(item["scores"], locator)
        metadata = case.get("metadata") if isinstance(case.get("metadata"), dict) else {}
        item["clusterId"] = common.string_value(metadata.get(cluster_key)) if isinstance(cluster_key, str) else None
        if itype == "attack":
            item["technique"] = common.string_value(metadata.get(technique_key)) if technique_key else None
            item["variant"] = common.string_value(metadata.get(variant_key)) if variant_key else None
        item["categories"] = plan_categories(plan, item["technique"])
        labels = common.labels_from(metadata, run.warnings, locator)
        if isinstance(context, list):
            labels["retrievalContextSha256"] = hashing.sha256_canonical(context)
        item["labels"] = labels
        ctx = {"error": False, "nullReasons": null_reasons}
        status, reason, value, rule = metric_outcome(item, ctx, primary, plan["successRule"], "deepeval.metric_score")
        common.set_outcome(item, status, reason, value, rule, plan["scorePolicy"])
        run.add(item, ctx)
    check_plan(plan, FORMAT, run.items)
    meta = run.meta = common.empty_metadata(run_key, FORMAT)
    meta["harness"] = {"name": "deepeval", "version": None, "source": common.missing_source()}
    for model, ref in judges.items():
        meta["judges"].append({"ref": ref, "role": "grader", "model": common.model_ref(hashing.redact(hashing.clean(model)), common.source("extracted", "#/testCases/*/metricsData/*/evaluationModel")),
                               "promptTemplateSha256": None, "validation": None})
    run.tool_aggregates = []
    passed = sum(1 for c in cases if isinstance(c, dict) and c.get("success") is True)
    failed = sum(1 for c in cases if isinstance(c, dict) and c.get("success") is False)
    for key, ours in (("testPassed", passed), ("testFailed", failed)):
        run.tool_aggregates.append({"metric": key, "tool": common._int(doc.get(key)), "ours": ours})
    for entry in doc["metricsScores"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("metric"), str):
            continue
        values = [s["value"] for i in run.items for s in i["scores"] if s["name"] == entry["metric"]]
        passes = sum(1 for i in run.items for s in i["scores"] if s["name"] == entry["metric"] and s["passed"] is True)
        fails = sum(1 for i in run.items for s in i["scores"] if s["name"] == entry["metric"] and s["passed"] is False)
        tool_scores = [common.number(v) for v in entry.get("scores") or []] if isinstance(entry.get("scores"), list) else None
        run.tool_aggregates.append({"metric": "metricsScores.passes", "group": hashing.clean(entry["metric"])[:300], "tool": common._int(entry.get("passes")), "ours": passes})
        run.tool_aggregates.append({"metric": "metricsScores.fails", "group": hashing.clean(entry["metric"])[:300], "tool": common._int(entry.get("fails")), "ours": fails})
        if tool_scores is not None and None not in tool_scores and None not in values and values:
            run.tool_aggregates.append({"metric": "metricsScores.mean", "group": hashing.clean(entry["metric"])[:300], "tool": sum(tool_scores) / len(tool_scores) if tool_scores else None, "ours": sum(values) / len(values)})
    return [run]
