"""PyRIT `pyrit-export/1` JSONL (design section 7.6).

PyRIT 1.x has no file exporter, so the engine defines a small export
contract that the client writes with PyRIT's own serialisers. The engine
never opens PyRIT memory databases. Gated on PyRIT major version 1; each
minor release is re-verified (design Q5).
"""
from __future__ import annotations

from .. import hashing, scorers
from ..errors import require
from ..readers import load_jsonl
from ..taxonomy import plan_categories
from . import common

FORMAT = "pyrit_export"
SCHEMA = "pyrit-export/1"


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("schema") == SCHEMA


def _attack_node(result):
    ident = result.get("atomic_attack_identifier") if isinstance(result.get("atomic_attack_identifier"), dict) else {}
    technique = ((ident.get("children") or {}).get("attack_technique") or {}) if isinstance(ident.get("children"), dict) else {}
    attack = ((technique.get("children") or {}).get("attack") or {}) if isinstance(technique, dict) and isinstance(technique.get("children"), dict) else {}
    return attack if isinstance(attack, dict) else {}


def _verified_hash(piece, field, value_field, run, locator):
    recorded = piece.get(field)
    value = piece.get(value_field)
    if not isinstance(recorded, str) or not hashing.SHA256.match(recorded):
        return hashing.sha256_text(value) if isinstance(value, str) else None, False
    if isinstance(value, str) and hashing.sha256_text(value) != recorded:
        run.warnings.add("tool_hash_mismatch", locator)
        return recorded, True
    return recorded, False


def parse(files, plan, manifest_inputs=None):
    (spec, data), = files
    name = spec["name"]
    rows = load_jsonl(data, name)
    require(rows and all(detect(r) for _, r in rows), "format_mismatch", name)
    versions = {r.get("pyritVersion") for _, r in rows}
    require(len(versions) == 1, "format_mismatch", "one PyRIT version per export")
    version = versions.pop()
    version = version if isinstance(version, str) else None
    ids = []
    for number, row in rows:
        result = row.get("attackResult")
        require(isinstance(result, dict) and isinstance(result.get("attack_result_id"), str), "invalid_json", f"{name}:{number}: attackResult")
        ids.append(result["attack_result_id"])
    declared_key = spec.get("runKey")
    run_key = declared_key or hashing.compose("pyrit", hashing.t16(hashing.sha256_canonical(sorted(ids))))
    run = common.ParsedRun(run_key, FORMAT, [spec["sha256"]])
    if version is None or version.split(".")[0] != "1":
        require(plan.get("allowUnverifiedFormatVersion"), "unsupported_format_version", f"pyritVersion {version!r}")
        run.level_caps.append("unverified_format_version")
        run.warnings.add("unverified_format_version")
    elif version != scorers.PYRIT_VERIFIED:
        run.warnings.add("unverified_tool_version")
    prepared = []
    for number, row in rows:
        result = row["attackResult"]
        attack = _attack_node(result)
        technique = attack.get("class_name") if isinstance(attack.get("class_name"), str) else "unknown"
        converters = (attack.get("children") or {}).get("request_converters") if isinstance(attack.get("children"), dict) else None
        names = [c.get("class_name") for c in converters if isinstance(c, dict) and isinstance(c.get("class_name"), str)] if isinstance(converters, list) else []
        variant = "+".join(names) if names else "none"
        objective = result.get("objective")
        objective_sha = hashing.sha256_value(objective) if objective is not None else hashing.EMPTY_SHA256
        timestamp = result.get("timestamp") if isinstance(result.get("timestamp"), str) else ""
        prepared.append((technique, variant, objective_sha, timestamp, result["attack_result_id"], number, row, attack))
    counters, occurrence = {}, {}
    for entry in sorted(prepared, key=lambda p: (p[0], p[1], p[2], p[3], p[4])):
        key = entry[:3]
        occurrence[entry[4]] = counters.get(key, 0)
        counters[key] = occurrence[entry[4]] + 1
    mismatch = False
    timestamps = []
    targets = []
    cluster_key = plan.get("clusterKey")
    for technique, variant, objective_sha, timestamp, result_id, number, row, attack in prepared:
        result = row["attackResult"]
        locator = f"{name}:{number}"
        group_key = hashing.compose(hashing.c(technique), hashing.c(variant), hashing.t16(objective_sha), str(occurrence[result_id]))
        item = common.new_item(run_key, group_key, 1, "attack", FORMAT, spec["sha256"], locator, result_id, technique, version)
        pieces = sorted([p for p in (row.get("messagePieces") or []) if isinstance(p, dict)], key=lambda p: p.get("sequence") if isinstance(p.get("sequence"), int) else 0)
        users = [p for p in pieces if p.get("role") == "user"]
        assistants = [p for p in pieces if p.get("role") == "assistant"]
        systems = [p for p in pieces if p.get("role") == "system"]
        if users:
            item["promptSha256"], bad = _verified_hash(users[0], "converted_value_sha256", "converted_value", run, locator)
            mismatch |= bad
            original, bad = _verified_hash(users[0], "original_value_sha256", "original_value", run, locator)
            mismatch |= bad
            if original:
                item["toolHashes"]["pyrit.original_value_sha256"] = original
        if assistants:
            item["responseSha256"], bad = _verified_hash(assistants[-1], "converted_value_sha256", "converted_value", run, locator)
            mismatch |= bad
        if systems:
            item["systemPromptSha256"] = hashing.system_hash([{"role": "system", "content": p.get("converted_value")} for p in systems])
        last = result.get("last_score") if isinstance(result.get("last_score"), dict) else None
        if last is not None:
            identifier = last.get("scorer_class_identifier") if isinstance(last.get("scorer_class_identifier"), dict) else {}
            score_name = identifier.get("class_name") if isinstance(identifier.get("class_name"), str) else "last_score"
            raw = last.get("score_value")
            value = 1.0 if raw == "true" else 0.0 if raw == "false" else None
            kind = scorers.pyrit_kind(identifier)
            item["scores"].append(common.score(score_name, raw, value, (raw != "true") if value is not None else None, "binary", kind))
            run.score_kinds.setdefault(score_name, set()).add(kind)
            if run.primary_default is None:
                run.primary_default = score_name
        item["technique"] = hashing.clean(technique)[:300]
        item["variant"] = hashing.clean(variant)[:300] if len(variant) <= 300 else "h-" + hashing.short(variant)
        item["categories"] = plan_categories(plan, item["technique"])
        labels = dict(result.get("labels") or {}) if isinstance(result.get("labels"), dict) else {}
        if isinstance(result.get("outcome"), str):
            labels["outcome"] = result["outcome"]
        harms = result.get("targeted_harm_categories")
        if isinstance(harms, list) and harms:
            labels["targeted_harm_categories"] = ",".join(h for h in harms if isinstance(h, str))
        item["labels"] = common.labels_from(labels, run.warnings, locator)
        item["clusterId"] = common.string_value((result.get("labels") or {}).get(cluster_key)) if isinstance(cluster_key, str) and isinstance(result.get("labels"), dict) else None
        if timestamp:
            timestamps.append(timestamp)
        target = (attack.get("children") or {}).get("objective_target") if isinstance(attack.get("children"), dict) else None
        if isinstance(target, dict):
            targets.append(target)
        ctx = {"error": result.get("error_type") not in (None, ""), "outcome": result.get("outcome")}
        status, reason, value, rule = outcome(item, ctx, plan.get("primaryScore"), plan["successRule"])
        common.set_outcome(item, status, reason, value, rule, plan["scorePolicy"])
        run.add(item, ctx)
    if mismatch:
        run.level_caps.append("tool_hash_mismatch")
    meta = run.meta = common.empty_metadata(run_key, FORMAT)
    meta["harness"] = {"name": "pyrit", "version": version, "source": common.source("extracted", f"{name}:1#/pyritVersion") if version else common.missing_source()}
    model = None
    for target in targets:
        for key in ("model_name", "underlying_model_name"):
            if isinstance(target.get(key), str) and target[key]:
                model = target[key]
                break
        if model:
            break
    if model:
        meta["systemUnderTest"] = common.model_ref(hashing.redact(model, run.warnings), common.source("extracted", "#/attackResult/atomic_attack_identifier/.../objective_target/model_name"))
        run.warnings.add("moving_model_alias")
    common.apply_system_prompt(run, "#/messagePieces[role=system]")
    pairs = sorted({f"{i['technique']}/{i['variant']}" for i in run.items})
    meta["attackSet"] = common.versioned(",".join(pairs)[:300] if pairs else None, version, None, common.source("extracted", "#/attackResult/atomic_attack_identifier"))
    if timestamps:
        meta["dates"] = {"runStartedAt": min(timestamps), "runCompletedAt": max(timestamps), "source": common.source("extracted", "#/attackResult/timestamp (min, max)")}
    return [run]


def outcome(item, ctx, primary, success_rule):
    rule = "pyrit.attack_outcome"
    if ctx["error"]:
        return "error", "tool_error", None, rule
    if primary is not None or (success_rule or {}).get("type", "tool_native") != "tool_native":
        s = common.find_score(item, primary) if primary else (item["scores"][0] if item["scores"] else None)
        if s is None:
            return "unscored", "no_score", None, rule
        status, reason, value = common.apply_success_rule(success_rule, s, None)
        return status, reason, value, "pyrit.objective_score"
    if ctx["outcome"] == "success":
        return "scored", None, 1.0, rule
    if ctx["outcome"] == "failure":
        return "scored", None, 0.0, rule
    return "unscored", "no_score", None, rule
