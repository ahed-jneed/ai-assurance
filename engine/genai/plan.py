"""The frozen plan (`genai-plan/0.1`, design section 8.1) and the bundle manifest (`genai-bundle/0.1`, section 6.3).

Both are strict JSON: unknown keys are rejected, floors can be raised but
never lowered, and every value is checked before any input is parsed.
"""
from __future__ import annotations

import copy
import math
import re

from .. import statistics as core
from . import hashing
from .errors import fail, require
from .families import valid_family

PLAN_SCHEMA = "genai-plan/0.1"
MANIFEST_SCHEMA = "genai-bundle/0.1"
FORMATS = ("inspect_eval", "inspect_json", "lm_eval_samples", "promptfoo_results", "garak_report", "pyrit_export", "deepeval_test_run", "ragas_results", "judge_validation_jsonl", "marking_check_jsonl",
           "c2pa_validator_report", "signed_detection_jsonl")
MARKING_FORMATS = ("marking_check_jsonl", "c2pa_validator_report", "signed_detection_jsonl")
EXCERPTS = ("none", "failures", "all")
MAX_DETECTION_KEYS = 20
ROLES = ("log", "samples", "results", "hitlog", "judge_validation", "attack_set", "marking")
ITEM_TYPES = ("qa", "attack", "rag", "agent_task")
CRITERION_KINDS = ("genai_mean", "genai_attack_success", "genai_pass_k", "genai_paired_difference", "genai_marking")
MEAN_METRICS = ("accuracy", "score_mean", "task_success")
GROUP_BY = ("technique", "variant", "technique_variant", "category", "none")
REDUCERS = ("mean", "any", "all", "majority")
MARKING_METRICS = ("marking_presence", "detection_rate", "false_positive_rate", "detection_rate_after_transformation", "self_identification_rate")
CRITERION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SCORE_NAME_MAX = 300

DEFAULT_PLAN = {
    "schemaVersion": PLAN_SCHEMA,
    "statisticsVersion": core.SPEC_VERSION,
    "confidenceLevel": 0.95,
    "minimums": {"sampleSize": 30, "memberSize": 10, "clusters": 10},
    "primaryScore": None,
    "successRule": {"type": "tool_native"},
    "epochReducer": None,
    "scorePolicy": "original",
    "clusterKey": None,
    "techniqueKey": None,
    "variantKey": None,
    "taskTypes": {},
    "categories": {"default": [], "byTechnique": {}},
    "maxUnscoredFraction": 0.05,
    "maxErrorFraction": 0.05,
    "criteria": [],
    "judgeValidation": {"minimumItems": 50, "minimumKappaLowerBound": 0.60, "requireDifferentFamily": True, "pairwiseMinimumConsistencyLowerBound": 0.80},
    "excerpts": "none",
    "detectionKeys": [],
    "allowUnverifiedFormatVersion": False,
    "reconciliationTolerance": 1e-9,
}


def _keys(obj, allowed, where, required=()):
    require(isinstance(obj, dict), "plan_invalid", f"{where} must be an object")
    unknown = set(obj) - set(allowed)
    require(not unknown, "plan_invalid", f"{where}: unknown keys {sorted(unknown)}")
    for key in required:
        require(key in obj, "plan_invalid", f"{where}.{key} is required")


def _real(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _success_rule(rule, where):
    _keys(rule, ("type", "values", "operator", "value"), where, ("type",))
    kind = rule["type"]
    require(kind in ("tool_native", "value_in", "threshold"), "plan_invalid", f"{where}.type")
    if kind == "tool_native":
        require(set(rule) == {"type"}, "plan_invalid", where)
        return {"type": "tool_native"}
    if kind == "value_in":
        values = rule.get("values")
        require(isinstance(values, list) and 1 <= len(values) <= 50 and all(isinstance(v, (str, int, float, bool)) for v in values), "plan_invalid", f"{where}.values")
        require(set(rule) == {"type", "values"}, "plan_invalid", where)
        return {"type": "value_in", "values": list(values)}
    require(rule.get("operator") in (">=", ">", "<=", "<") and _real(rule.get("value")), "plan_invalid", f"{where}: threshold rule")
    require(set(rule) == {"type", "operator", "value"}, "plan_invalid", where)
    return {"type": "threshold", "operator": rule["operator"], "value": float(rule["value"])}


def _band(band, where, kind):
    _keys(band, ("lower", "upper"), where)
    lower, upper = band.get("lower"), band.get("upper")
    require(lower is not None or upper is not None, "plan_invalid", f"{where}: a band needs a bound")
    for bound in (lower, upper):
        require(bound is None or _real(bound), "plan_invalid", where)
    if kind == "genai_paired_difference":
        require(upper is None and -1.0 < lower < 1.0, "plan_invalid", f"{where}: a paired band is {{lower: -m}} or {{lower: m}}")
    else:
        for bound in (lower, upper):
            require(bound is None or 0.0 < bound < 1.0, "plan_invalid", f"{where}: bounds lie inside (0, 1)")
        if kind in ("genai_attack_success",):
            require(lower is None, "plan_invalid", f"{where}: attack-success bands are {{upper: t}}")
        if kind == "genai_pass_k":
            require(upper is None, "plan_invalid", f"{where}: pass^k bands are {{lower: t}}")
    if lower is not None and upper is not None:
        require(lower < upper, "plan_invalid", where)
    return {"lower": None if lower is None else float(lower), "upper": None if upper is None else float(upper)}


def _selector(sel, where):
    _keys(sel, ("runKey", "task", "format"), where)
    for key, value in sel.items():
        require(isinstance(value, str) and 0 < len(value) <= 512, "plan_invalid", f"{where}.{key}")
    return dict(sel)


def _criterion(c, where):
    allowed = ("id", "kind", "role", "metric", "band", "select", "primaryScore", "groupBy", "k", "candidate", "baseline", "epochReducer", "successRule", "stratum", "transformation", "requireTrustedSigner")
    _keys(c, allowed, where, ("id", "kind", "band"))
    require(isinstance(c["id"], str) and CRITERION_ID.match(c["id"]), "plan_invalid", f"{where}.id")
    kind = c["kind"]
    require(kind in CRITERION_KINDS, "plan_invalid", f"{where}.kind")
    role = c.get("role", "confirmatory")
    require(role in ("confirmatory", "exploratory"), "plan_invalid", f"{where}.role")
    out = {"id": c["id"], "kind": kind, "role": role, "band": _band(c["band"], f"{where}.band", kind)}
    if "select" in c:
        out["select"] = _selector(c["select"], f"{where}.select")
    if "primaryScore" in c:
        require(isinstance(c["primaryScore"], str) and 0 < len(c["primaryScore"]) <= SCORE_NAME_MAX, "plan_invalid", f"{where}.primaryScore")
        out["primaryScore"] = c["primaryScore"]
    if "epochReducer" in c:
        require(c["epochReducer"] in REDUCERS, "plan_invalid", f"{where}.epochReducer")
        out["epochReducer"] = c["epochReducer"]
    if "successRule" in c:
        out["successRule"] = _success_rule(c["successRule"], f"{where}.successRule")
    if kind == "genai_mean":
        require(c.get("metric", "accuracy") in MEAN_METRICS, "plan_invalid", f"{where}.metric")
        out["metric"] = c.get("metric", "accuracy")
        require(not {"groupBy", "k", "candidate", "baseline"} & set(c), "plan_invalid", where)
    elif kind == "genai_attack_success":
        require(c.get("groupBy", "technique") in GROUP_BY, "plan_invalid", f"{where}.groupBy")
        out["groupBy"] = c.get("groupBy", "technique")
        require(not {"metric", "k", "candidate", "baseline"} & set(c), "plan_invalid", where)
    elif kind == "genai_pass_k":
        k = c.get("k")
        require(isinstance(k, list) and 1 <= len(k) <= 20 and all(isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 1000 for v in k) and len(set(k)) == len(k), "plan_invalid", f"{where}.k")
        out["k"] = list(k)
        require(not {"metric", "groupBy", "candidate", "baseline"} & set(c), "plan_invalid", where)
    elif kind == "genai_paired_difference":
        require("candidate" in c and "baseline" in c, "plan_invalid", f"{where}: candidate and baseline are required")
        out["candidate"] = _selector(c["candidate"], f"{where}.candidate")
        out["baseline"] = _selector(c["baseline"], f"{where}.baseline")
        require("select" not in c and not {"metric", "groupBy", "k"} & set(c), "plan_invalid", where)
    else:  # genai_marking
        require(c.get("metric") in MARKING_METRICS, "plan_invalid", f"{where}.metric")
        out["metric"] = c["metric"]
        for key in ("stratum", "transformation"):
            if key in c:
                require(isinstance(c[key], str) and 0 < len(c[key]) <= 300, "plan_invalid", f"{where}.{key}")
                out[key] = c[key]
        if out["metric"] == "detection_rate_after_transformation":
            require("transformation" in out, "plan_invalid", f"{where}: detection_rate_after_transformation names a transformation")
        if "requireTrustedSigner" in c:
            # Metadata marks count only when a C2PA validator reported the signer as trusted (#128).
            require(c["requireTrustedSigner"] is True and out["metric"] == "marking_presence", "plan_invalid", f"{where}.requireTrustedSigner is true, on marking_presence only")
            out["requireTrustedSigner"] = True
        if out["metric"] in ("false_positive_rate",):
            require(out["band"]["lower"] is None, "plan_invalid", f"{where}: false-positive bands are {{upper: t}}")
    if kind != "genai_marking":
        require("requireTrustedSigner" not in c, "plan_invalid", f"{where}.requireTrustedSigner belongs to genai_marking")
    return out


def _detection_keys(keys):
    """The public keys of detection solutions whose signed results count (#128): pinned before any result is read."""
    from .formats.signed_detection import spki_key
    require(isinstance(keys, list) and len(keys) <= MAX_DETECTION_KEYS, "plan_invalid", "plan.detectionKeys")
    out, ids = [], set()
    for i, key in enumerate(keys):
        where = f"plan.detectionKeys[{i}]"
        _keys(key, ("keyId", "solutionId", "algorithm", "publicKeySPKI"), where, ("keyId", "solutionId", "algorithm", "publicKeySPKI"))
        require(isinstance(key["keyId"], str) and hashing.COMPONENT.match(key["keyId"]) and key["keyId"] not in ids, "plan_invalid", f"{where}.keyId must be a unique key component")
        ids.add(key["keyId"])
        require(isinstance(key["solutionId"], str) and 0 < len(key["solutionId"]) <= 100 and not hashing.has_lone_surrogate(key["solutionId"]), "plan_invalid", f"{where}.solutionId")
        require(key["algorithm"] == "Ed25519", "plan_invalid", f"{where}.algorithm: Ed25519 only")
        require(spki_key(key["publicKeySPKI"]) is not None, "plan_invalid", f"{where}.publicKeySPKI is not a base64 Ed25519 SubjectPublicKeyInfo")
        out.append({"keyId": key["keyId"], "solutionId": key["solutionId"], "algorithm": "Ed25519", "publicKeySPKI": key["publicKeySPKI"]})
    return out


def normalize_plan(plan):
    _keys(plan, tuple(DEFAULT_PLAN), "plan", ("schemaVersion", "criteria"))
    require(plan["schemaVersion"] == PLAN_SCHEMA, "plan_invalid", "plan.schemaVersion")
    out = copy.deepcopy(DEFAULT_PLAN)
    require(plan.get("statisticsVersion", core.SPEC_VERSION) == core.SPEC_VERSION, "plan_invalid", "plan.statisticsVersion")
    level = plan.get("confidenceLevel", 0.95)
    require(level in (0.90, 0.95, 0.99), "plan_invalid", "plan.confidenceLevel")
    out["confidenceLevel"] = float(level)
    if "minimums" in plan:
        _keys(plan["minimums"], ("sampleSize", "memberSize", "clusters"), "plan.minimums")
        for key, value in plan["minimums"].items():
            require(isinstance(value, int) and not isinstance(value, bool) and DEFAULT_PLAN["minimums"][key] <= value <= 10_000_000, "plan_invalid", f"plan.minimums.{key} may be raised, never lowered")
            out["minimums"][key] = value
    if plan.get("primaryScore") is not None:
        require(isinstance(plan["primaryScore"], str) and 0 < len(plan["primaryScore"]) <= SCORE_NAME_MAX, "plan_invalid", "plan.primaryScore")
        out["primaryScore"] = plan["primaryScore"]
    if "successRule" in plan:
        out["successRule"] = _success_rule(plan["successRule"], "plan.successRule")
    if plan.get("epochReducer") is not None:
        require(plan["epochReducer"] in REDUCERS, "plan_invalid", "plan.epochReducer")
        out["epochReducer"] = plan["epochReducer"]
    require(plan.get("scorePolicy", "original") in ("original", "as_edited"), "plan_invalid", "plan.scorePolicy")
    out["scorePolicy"] = plan.get("scorePolicy", "original")
    cluster = plan.get("clusterKey")
    if cluster is not None:
        if isinstance(cluster, dict):
            require(0 < len(cluster) <= 1000 and all(isinstance(k, str) and isinstance(v, str) and 0 < len(v) <= 300 for k, v in cluster.items()), "plan_invalid", "plan.clusterKey")
        else:
            require(isinstance(cluster, str) and 0 < len(cluster) <= 300, "plan_invalid", "plan.clusterKey")
        out["clusterKey"] = cluster
    for key in ("techniqueKey", "variantKey"):
        if plan.get(key) is not None:
            require(isinstance(plan[key], str) and 0 < len(plan[key]) <= 300, "plan_invalid", f"plan.{key}")
            out[key] = plan[key]
    task_types = plan.get("taskTypes", {})
    require(isinstance(task_types, dict) and len(task_types) <= 1000 and all(isinstance(k, str) and v in ITEM_TYPES for k, v in task_types.items()), "plan_invalid", "plan.taskTypes")
    out["taskTypes"] = dict(task_types)
    if "categories" in plan:
        cats = plan["categories"]
        _keys(cats, ("default", "byTechnique"), "plan.categories")
        from .taxonomy import CATEGORIES
        default = cats.get("default", [])
        require(isinstance(default, list) and all(c in CATEGORIES for c in default), "plan_invalid", "plan.categories.default")
        by = cats.get("byTechnique", {})
        require(isinstance(by, dict) and all(isinstance(v, list) and all(c in CATEGORIES for c in v) for v in by.values()), "plan_invalid", "plan.categories.byTechnique")
        out["categories"] = {"default": sorted(set(default)), "byTechnique": {k: sorted(set(v)) for k, v in by.items()}}
    for key in ("maxUnscoredFraction", "maxErrorFraction"):
        if key in plan:
            require(_real(plan[key]) and 0.0 <= plan[key] <= DEFAULT_PLAN[key], "plan_invalid", f"plan.{key} may be lowered, never raised")
            out[key] = float(plan[key])
    if "judgeValidation" in plan:
        jv = plan["judgeValidation"]
        _keys(jv, tuple(DEFAULT_PLAN["judgeValidation"]), "plan.judgeValidation")
        floors = DEFAULT_PLAN["judgeValidation"]
        if "minimumItems" in jv:
            require(isinstance(jv["minimumItems"], int) and not isinstance(jv["minimumItems"], bool) and jv["minimumItems"] >= floors["minimumItems"], "plan_invalid", "judgeValidation.minimumItems")
        for key in ("minimumKappaLowerBound", "pairwiseMinimumConsistencyLowerBound"):
            if key in jv:
                require(_real(jv[key]) and floors[key] <= jv[key] < 1.0, "plan_invalid", f"judgeValidation.{key}")
        if "requireDifferentFamily" in jv:
            require(jv["requireDifferentFamily"] is True, "plan_invalid", "judgeValidation.requireDifferentFamily cannot be switched off")
        out["judgeValidation"].update(jv)
    if "excerpts" in plan:
        # Off by default (design Q12): raw text stays in the hashed source logs unless the frozen plan asks
        # for inert excerpts of failed or successful-attack items ("failures") or of every item ("all").
        require(plan["excerpts"] in EXCERPTS, "plan_invalid", "plan.excerpts")
        out["excerpts"] = plan["excerpts"]
    if "detectionKeys" in plan:
        out["detectionKeys"] = _detection_keys(plan["detectionKeys"])
    if "allowUnverifiedFormatVersion" in plan:
        require(isinstance(plan["allowUnverifiedFormatVersion"], bool), "plan_invalid", "plan.allowUnverifiedFormatVersion")
        out["allowUnverifiedFormatVersion"] = plan["allowUnverifiedFormatVersion"]
    if "reconciliationTolerance" in plan:
        require(_real(plan["reconciliationTolerance"]) and 0.0 <= plan["reconciliationTolerance"] <= 1e-3, "plan_invalid", "plan.reconciliationTolerance")
        out["reconciliationTolerance"] = float(plan["reconciliationTolerance"])
    criteria = plan["criteria"]
    require(isinstance(criteria, list) and len(criteria) <= 200, "plan_invalid", "plan.criteria")
    out["criteria"] = [_criterion(c, f"plan.criteria[{i}]") for i, c in enumerate(criteria)]
    ids = [c["id"] for c in out["criteria"]]
    require(len(ids) == len(set(ids)), "plan_invalid", "criterion ids must be unique")
    return out


# ---------------------------------------------------------------- manifest

DECLARED_KEYS = ("harness", "systemUnderTest", "systemPrompt", "decoding", "tools", "dataset", "attackSet", "judges", "scorers", "dates")


def _mkeys(obj, allowed, where, required=()):
    require(isinstance(obj, dict), "manifest_invalid", f"{where} must be an object")
    unknown = set(obj) - set(allowed)
    require(not unknown, "manifest_invalid", f"{where}: unknown keys {sorted(unknown)}")
    for key in required:
        require(key in obj, "manifest_invalid", f"{where}.{key} is required")


def _text(value, where, maximum=300, nullable=True):
    require((nullable and value is None) or (isinstance(value, str) and 0 < len(value) <= maximum and not hashing.has_lone_surrogate(value)), "manifest_invalid", where)
    return value


def _sha(value, where, nullable=True):
    require((nullable and value is None) or (isinstance(value, str) and hashing.SHA256.match(value)), "manifest_invalid", where)
    return value


def normalize_manifest(manifest):
    _mkeys(manifest, ("schemaVersion", "origin", "inputs", "declared", "declaredBy", "declaredAt"), "manifest", ("schemaVersion", "origin", "inputs"))
    require(manifest["schemaVersion"] == MANIFEST_SCHEMA, "manifest_invalid", "manifest.schemaVersion")
    require(manifest["origin"] in ("auditee_supplied", "auditor_rerun"), "manifest_invalid", "manifest.origin")
    inputs = manifest["inputs"]
    require(isinstance(inputs, list) and 1 <= len(inputs) <= 64, "manifest_invalid", "manifest.inputs")
    out_inputs, seen = [], set()
    for i, entry in enumerate(inputs):
        where = f"manifest.inputs[{i}]"
        _mkeys(entry, ("name", "sha256", "bytes", "format", "role", "judgeRef", "runKey"), where, ("name", "sha256", "bytes", "format", "role"))
        _text(entry["name"], f"{where}.name", 255, nullable=False)
        _sha(entry["sha256"], f"{where}.sha256", nullable=False)
        require(entry["sha256"] not in seen, "manifest_invalid", f"{where}: duplicate input")
        seen.add(entry["sha256"])
        require(isinstance(entry["bytes"], int) and not isinstance(entry["bytes"], bool) and entry["bytes"] >= 0, "manifest_invalid", f"{where}.bytes")
        require(entry["format"] in FORMATS, "manifest_invalid", f"{where}.format")
        require(entry["role"] in ROLES, "manifest_invalid", f"{where}.role")
        if "judgeRef" in entry:
            require(entry["role"] == "judge_validation" and isinstance(entry["judgeRef"], str) and re.match(r"^J[0-9]{1,3}$", entry["judgeRef"]), "manifest_invalid", f"{where}.judgeRef")
        if "runKey" in entry:
            require(entry["format"] in ("pyrit_export", "deepeval_test_run", "ragas_results") and isinstance(entry["runKey"], str) and hashing.DECLARED_RUN_KEY.match(entry["runKey"]), "manifest_invalid", f"{where}.runKey")
        out_inputs.append(dict(entry))
    declared = manifest.get("declared") or {}
    _mkeys(declared, DECLARED_KEYS, "manifest.declared")
    out_declared = {}
    if "harness" in declared:
        h = declared["harness"]
        _mkeys(h, ("name", "version"), "declared.harness")
        out_declared["harness"] = {"name": _text(h.get("name"), "declared.harness.name"), "version": _text(h.get("version"), "declared.harness.version", 100)}
    if "systemUnderTest" in declared:
        s = declared["systemUnderTest"]
        _mkeys(s, ("model", "snapshot", "provider", "family"), "declared.systemUnderTest")
        require(valid_family(s.get("family")), "manifest_invalid", "declared.systemUnderTest.family is outside the family vocabulary")
        out_declared["systemUnderTest"] = {k: _text(s.get(k), f"declared.systemUnderTest.{k}", 100 if k == "provider" else 300) for k in ("model", "snapshot", "provider")} | {"family": s.get("family")}
    if "systemPrompt" in declared:
        s = declared["systemPrompt"]
        _mkeys(s, ("sha256",), "declared.systemPrompt", ("sha256",))
        out_declared["systemPrompt"] = {"sha256": _sha(s["sha256"], "declared.systemPrompt.sha256", nullable=False)}
    if "decoding" in declared:
        d = declared["decoding"]
        _mkeys(d, ("temperature", "topP", "topK", "maxTokens", "seed", "generationsPerItem"), "declared.decoding")
        for key, value in d.items():
            ok = value is None or (_real(value) if key in ("temperature", "topP") else (isinstance(value, int) and not isinstance(value, bool)))
            require(ok, "manifest_invalid", f"declared.decoding.{key}")
        out_declared["decoding"] = dict(d)
    if "tools" in declared:
        t = declared["tools"]
        _mkeys(t, ("agentic", "offered"), "declared.tools", ("agentic", "offered"))
        require(isinstance(t["agentic"], bool), "manifest_invalid", "declared.tools.agentic")
        offered = t["offered"]
        require(isinstance(offered, list) and len(offered) <= 200, "manifest_invalid", "declared.tools.offered")
        tools = []
        for j, tool in enumerate(offered):
            _mkeys(tool, ("name", "permission", "definitionSha256"), f"declared.tools.offered[{j}]", ("name", "permission"))
            _text(tool["name"], f"declared.tools.offered[{j}].name", nullable=False)
            require(tool["permission"] in ("read", "write", "execute", "network", "unknown"), "manifest_invalid", f"declared.tools.offered[{j}].permission")
            tools.append({"name": tool["name"], "permission": tool["permission"], "definitionSha256": _sha(tool.get("definitionSha256"), f"declared.tools.offered[{j}].definitionSha256")})
        out_declared["tools"] = {"agentic": t["agentic"], "offered": tools}
    for key in ("dataset", "attackSet"):
        if key in declared:
            d = declared[key]
            _mkeys(d, ("name", "version", "sha256"), f"declared.{key}")
            out_declared[key] = {"name": _text(d.get("name"), f"declared.{key}.name"), "version": _text(d.get("version"), f"declared.{key}.version", 100), "sha256": _sha(d.get("sha256"), f"declared.{key}.sha256")}
    if "judges" in declared:
        judges = declared["judges"]
        require(isinstance(judges, list) and len(judges) <= 20, "manifest_invalid", "declared.judges")
        out, refs = [], set()
        for j, judge in enumerate(judges):
            where = f"declared.judges[{j}]"
            _mkeys(judge, ("ref", "model", "snapshot", "family", "promptTemplateSha256", "scores", "pairwise"), where, ("ref", "model"))
            require(isinstance(judge["ref"], str) and re.match(r"^J[0-9]{1,3}$", judge["ref"]) and judge["ref"] not in refs, "manifest_invalid", f"{where}.ref")
            refs.add(judge["ref"])
            _text(judge["model"], f"{where}.model", nullable=False)
            require(valid_family(judge.get("family")), "manifest_invalid", f"{where}.family is outside the family vocabulary")
            scores = judge.get("scores", [])
            require(isinstance(scores, list) and len(scores) <= 50 and all(isinstance(s, str) and 0 < len(s) <= 300 for s in scores), "manifest_invalid", f"{where}.scores")
            require(isinstance(judge.get("pairwise", False), bool), "manifest_invalid", f"{where}.pairwise")
            out.append({"ref": judge["ref"], "model": judge["model"], "snapshot": _text(judge.get("snapshot"), f"{where}.snapshot"), "family": judge.get("family"),
                        "promptTemplateSha256": _sha(judge.get("promptTemplateSha256"), f"{where}.promptTemplateSha256"), "scores": list(scores), "pairwise": judge.get("pairwise", False)})
        out_declared["judges"] = out
    if "scorers" in declared:
        scorers = declared["scorers"]
        require(isinstance(scorers, list) and len(scorers) <= 50, "manifest_invalid", "declared.scorers")
        out = []
        for j, entry in enumerate(scorers):
            _mkeys(entry, ("score", "kind", "rationale"), f"declared.scorers[{j}]", ("score", "kind", "rationale"))
            require(entry["kind"] == "deterministic", "manifest_invalid", f"declared.scorers[{j}].kind")
            _text(entry["score"], f"declared.scorers[{j}].score", nullable=False)
            _text(entry["rationale"], f"declared.scorers[{j}].rationale", 2000, nullable=False)
            out.append(dict(entry))
        out_declared["scorers"] = out
    if "dates" in declared:
        d = declared["dates"]
        _mkeys(d, ("utcOffset",), "declared.dates")
        offset = d.get("utcOffset")
        require(offset is None or (isinstance(offset, str) and re.match(r"^[+-](0[0-9]|1[0-4]):[0-5][0-9]$", offset)), "manifest_invalid", "declared.dates.utcOffset")
        out_declared["dates"] = {"utcOffset": offset}
    by = manifest.get("declaredBy")
    at = manifest.get("declaredAt")
    require(by is None or (isinstance(by, str) and 0 < len(by) <= 300), "manifest_invalid", "manifest.declaredBy")
    require(at is None or (isinstance(at, str) and 0 < len(at) <= 64), "manifest_invalid", "manifest.declaredAt")
    bound_refs = set()
    for entry in out_inputs:
        if "judgeRef" in entry:
            require(entry["judgeRef"] in {j["ref"] for j in out_declared.get("judges", [])}, "manifest_invalid", "inputs[].judgeRef names no declared judge")
            # One label file per declared judge: otherwise manifest order would decide which kappa counts.
            require(entry["judgeRef"] not in bound_refs, "manifest_invalid", f"inputs[].judgeRef {entry['judgeRef']} binds more than one label file")
            bound_refs.add(entry["judgeRef"])
    return {"schemaVersion": MANIFEST_SCHEMA, "origin": manifest["origin"], "inputs": out_inputs, "declared": out_declared, "declaredBy": by, "declaredAt": at}
