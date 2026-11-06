"""Shared building blocks of the format parsers: items, scores, outcomes and run metadata (design sections 6 and 7)."""
from __future__ import annotations

import math
import re

from .. import hashing, limits
from ..errors import Warnings, fail, require
from ..readers import NonFinite

ITEM_SCHEMA = "genai-evidence-item/0.1"
LABEL_KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
METADATA_FIELDS = (
    "harness", "systemUnderTest.snapshot", "systemUnderTest.family", "systemPrompt", "decoding", "tools", "dataset", "attackSet",
    "judges.model", "judges.family", "judges.promptTemplate", "judges.validation", "epochs", "dates",
)
METRIC_BY_TYPE = {"qa": "correct", "rag": "correct", "attack": "attack_success", "agent_task": "task_success"}


def source(kind, pointer=None, declared_by=None):
    out = {"kind": kind, "pointer": pointer}
    if declared_by is not None:
        out["declaredBy"] = declared_by
    return out


MISSING = None  # sentinel name for readability


def missing_source():
    return source("missing", None)


class ParsedRun:
    """One run: its items (records plus internal outcome context) and its run metadata before finalization."""

    def __init__(self, run_key, fmt, input_sha256s):
        self.run_key = run_key
        self.format = fmt
        self.inputs = list(input_sha256s)
        self.items = []
        self.contexts = []
        self.meta = {}
        self.warnings = Warnings()
        self.tool_aggregates = []
        self.post_run_edits = None
        self.level_caps = []
        self.incomplete = False
        self.primary_default = None
        self.score_kinds = {}
        self.extra = {}

    def add(self, item, ctx):
        self.items.append(item)
        self.contexts.append(ctx)


def obj(value):
    """The value when it is a JSON object, else an empty one: hostile files put anything anywhere."""
    return value if isinstance(value, dict) else {}


def seq(value):
    return value if isinstance(value, list) else []


def string_value(value):
    """clusterId, technique and variant as strings (section 7.1)."""
    if value is None or isinstance(value, NonFinite) or isinstance(value, (dict, list)):
        return None
    text = value if isinstance(value, str) else hashing.canonical_hash_bytes(value).decode("utf-8")
    text = hashing.clean(text)
    if len(text) > 300:
        return "h-" + hashing.short(text)
    return text


def dot_path(obj, path):
    if not isinstance(path, str) or not path:
        return None
    node = obj
    for part in path.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def labels_from(mapping, warnings=None, locator=None, drop=()):
    out = {}
    if not isinstance(mapping, dict):
        return out
    for key, value in mapping.items():
        if len(out) >= limits.MAX_LABELS:
            break
        if not isinstance(key, str) or key.startswith("_") or key in drop or not LABEL_KEY.match(key):
            continue
        if isinstance(value, (dict, list)):
            continue
        out[key] = label_value(value, warnings, locator)
    return out


def label_value(value, warnings=None, locator=None):
    if isinstance(value, NonFinite):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, str):
        value = hashing.redact(hashing.clean(value), warnings, locator)
        if len(value) > limits.MAX_LABEL_CHARS:
            if warnings is not None:
                warnings.add("label_truncated", locator)
            value = value[: limits.MAX_LABEL_CHARS]
    return value


def number(value):
    """A finite JSON number as float; booleans and everything else give None."""
    if isinstance(value, bool) or value is None or isinstance(value, NonFinite):
        return None
    if isinstance(value, (int, float)):
        out = float(value)
        return out if math.isfinite(out) else None
    return None


def raw_scalar(value):
    if isinstance(value, NonFinite):
        return None
    if isinstance(value, str):
        text = hashing.clean(value)
        return text[:1000]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return None


def score(name, raw, value, passed, scale, kind, judge_ref=None, threshold=None, edited=False, original=None, edits=None, with_threshold=False):
    out = {
        "name": hashing.clean(name)[:300] or "score",
        "raw": raw_scalar(raw),
        "value": value,
        "passed": passed,
        "scale": scale,
        "scorer": {"kind": kind, "judgeRef": judge_ref},
        "edited": edited,
        "original": original,
    }
    if with_threshold:
        out["threshold"] = threshold
    if edits:
        out["edits"] = edits[:50]
    return out


def check_scores(scores, locator):
    require(len(scores) <= limits.MAX_SCORES_PER_ITEM, "too_many_scores", locator)
    names = set()
    for s in scores:
        require(s["name"] not in names, "invalid_json", f"{locator}: duplicate score name")
        names.add(s["name"])


def new_item(run_key, group_key, epoch, item_type, fmt, file_sha, locator, tool_item_id, task_name, task_version):
    require(hashing.KEY.match(group_key) and hashing.KEY.match(run_key), "invalid_json", f"{locator}: invalid key")
    require(isinstance(epoch, int) and not isinstance(epoch, bool) and 1 <= epoch <= 10000, "invalid_json", f"{locator}: epoch out of range")
    return {
        "schemaVersion": ITEM_SCHEMA,
        "itemKey": hashing.item_key(run_key, group_key, epoch),
        "groupKey": group_key,
        "runKey": run_key,
        "epoch": epoch,
        "itemType": item_type,
        "source": {"format": fmt, "fileSha256": file_sha, "locator": locator[:1024], "toolItemId": None if tool_item_id is None else hashing.clean(str(tool_item_id))[:300]},
        "task": {"name": (hashing.clean(str(task_name)) or "task")[:300], "version": None if task_version is None else hashing.clean(str(task_version))[:100]},
        "status": "scored",
        "statusReason": None,
        "promptSha256": None,
        "systemPromptSha256": None,
        "responseSha256": None,
        "targetSha256": None,
        "toolHashes": {},
        "technique": None,
        "variant": None,
        "categories": [],
        "clusterId": None,
        "scores": [],
        "outcome": {"metric": METRIC_BY_TYPE.get(item_type, "score"), "value": None, "rule": "engine.unscored", "policy": "original"},
        "labels": {},
    }


def add_warning(item, code):
    warnings = item.setdefault("warnings", [])
    if code not in warnings and len(warnings) < 20:
        warnings.append(code)


# ---------------------------------------------------------------- outcomes


def find_score(item, name):
    for s in item["scores"]:
        if s["name"] == name:
            return s
    return None


def apply_success_rule(rule, s, null_reason):
    """(status, reason, value) from one score under the plan's successRule (section 8.1)."""
    kind = (rule or {}).get("type", "tool_native")
    if kind == "value_in":
        if s["raw"] is None:
            return "unscored", null_reason or "no_score", None
        return "scored", None, 1.0 if s["raw"] in rule["values"] else 0.0
    if kind == "threshold":
        if s["value"] is None:
            return "unscored", null_reason or "no_score", None
        v, t, op = s["value"], rule["value"], rule["operator"]
        hit = {">=": v >= t, ">": v > t, "<=": v <= t, "<": v < t}[op]
        return "scored", None, 1.0 if hit else 0.0
    if s["value"] is None:
        return "unscored", null_reason or "unparseable_score", None
    if s["value"] < 0.0 or s["value"] > 1.0:
        return "unscored", "score_out_of_range", None
    return "scored", None, float(s["value"])


def value_outcome(item, ctx, primary, success_rule, rule_name):
    """Outcome from the primary score's value (Inspect, lm-evaluation-harness, DeepEval, Ragas)."""
    if ctx.get("error"):
        return "error", "tool_error", None, rule_name
    if ctx.get("invalidated"):
        return "invalidated", "invalidated_post_run", None, rule_name
    if primary is None:
        return "unscored", "no_score", None, rule_name
    s = find_score(item, primary)
    if s is None:
        return "unscored", "no_score", None, rule_name
    status, reason, value = apply_success_rule(success_rule, s, ctx.get("nullReasons", {}).get(primary))
    return status, reason, value, rule_name


def set_outcome(item, status, reason, value, rule, policy="original"):
    item["status"] = status
    item["statusReason"] = reason
    item["outcome"]["value"] = value if status == "scored" else None
    item["outcome"]["rule"] = rule
    item["outcome"]["policy"] = policy
    if reason in ("non_finite_score", "unparseable_score", "score_out_of_range"):
        add_warning(item, reason)


# ---------------------------------------------------------------- run metadata


def empty_metadata(run_key, fmt):
    return {
        "runKey": run_key,
        "format": fmt,
        "harness": {"name": fmt, "version": None, "source": missing_source()},
        "systemUnderTest": model_ref(None),
        "systemPrompt": {"sha256": None, "distinctCount": 0, "source": missing_source()},
        "decoding": decoding(),
        "tools": {"agentic": None, "offered": [], "source": missing_source()},
        "dataset": versioned(None, None, None, missing_source()),
        "datasetFingerprint": None,
        "attackSet": None,
        "judges": [],
        "epochs": {"value": 1, "source": source("computed")},
        "n": {"items": 0, "groups": 0, "scored": 0},
        "dates": {"runStartedAt": None, "runCompletedAt": None, "source": missing_source()},
        "completeness": {"missing": [], "declaredOnly": []},
    }


def model_ref(model, src=None, snapshot=None):
    return {"model": None if model is None else hashing.clean(str(model))[:300], "snapshot": snapshot, "provider": None, "family": None, "source": src or missing_source()}


def versioned(name, version, sha, src):
    return {
        "name": None if name is None else hashing.clean(str(name))[:300],
        "version": None if version is None else hashing.clean(str(version))[:100],
        "sha256": sha,
        "source": src,
    }


def decoding(values=None, src=None, generations=1, other=None):
    values = values or {}
    out = {
        "temperature": number(values.get("temperature")),
        "topP": number(values.get("topP")),
        "topK": _int(values.get("topK")),
        "maxTokens": _int(values.get("maxTokens")),
        "seed": _int(values.get("seed")),
        "generationsPerItem": generations,
        "other": dict(list((other or {}).items())[:30]),
    }
    known = any(out[k] is not None for k in ("temperature", "topP", "topK", "maxTokens", "seed"))
    out["source"] = src if (known and src is not None) else missing_source()
    return out


def _int(value):
    if isinstance(value, bool) or value is None or isinstance(value, NonFinite):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value == int(value):
        return int(value)
    return None


def other_setting(value):
    if isinstance(value, (dict, list)):
        text = hashing.canonical(hashing.clean(value)).decode("utf-8")
        return text if len(text) <= 300 else "h-" + hashing.short(text)
    if isinstance(value, str):
        return hashing.redact(hashing.clean(value))[:300]
    if isinstance(value, NonFinite):
        return None
    return value


def system_prompt_meta(items, pointer):
    hashes = [i["systemPromptSha256"] for i in items]
    distinct = sorted({h for h in hashes if h is not None})
    if not distinct:
        return None
    if len(distinct) == 1 and all(h is not None for h in hashes):
        return {"sha256": distinct[0], "distinctCount": 1, "source": source("extracted", pointer)}
    return {"sha256": None, "distinctCount": len(distinct), "source": source("extracted", pointer), "_warning": "multiple_system_prompts"}


def apply_system_prompt(run, pointer):
    meta = system_prompt_meta(run.items, pointer)
    if meta is None:
        return False
    if meta.pop("_warning", None):
        run.warnings.add("multiple_system_prompts")
    run.meta["systemPrompt"] = meta
    return True


def fingerprint(items):
    triples = {(i["groupKey"], i["promptSha256"], i["targetSha256"]) for i in items}

    def key(t):
        return tuple((0, "") if v is None else (1, v) for v in t)
    ordered = [list(t) for t in sorted(triples, key=key)]
    return hashing.sha256_bytes(hashing.canonical(ordered))


def judged_scores(items):
    return any(s["scorer"]["kind"] == "model_graded" for i in items for s in i["scores"])


def finalize(run):
    """Counts, fingerprint and completeness (section 6.1)."""
    items = run.items
    meta = run.meta
    meta["runKey"] = run.run_key
    meta["format"] = run.format
    meta["n"] = {"items": len(items), "groups": len({i["groupKey"] for i in items}), "scored": sum(1 for i in items if i["status"] == "scored")}
    meta["datasetFingerprint"] = fingerprint(items)
    has_attack = any(i["itemType"] == "attack" for i in items)
    if not has_attack:
        meta["attackSet"] = None
    missing, declared = [], []

    def check(field, present, src):
        if not present:
            missing.append(field)
        elif src is not None and src.get("kind") == "declared":
            declared.append(field)

    sut = meta["systemUnderTest"]
    check("harness", meta["harness"]["version"] is not None, meta["harness"]["source"])
    check("systemUnderTest.snapshot", sut["snapshot"] is not None, sut["source"] if sut["source"]["kind"] == "declared" else sut.get("_snapshotSource"))
    check("systemUnderTest.family", sut["family"] is not None, sut.get("_familySource"))
    check("systemPrompt", meta["systemPrompt"]["sha256"] is not None, meta["systemPrompt"]["source"])
    check("decoding", meta["decoding"]["source"]["kind"] != "missing", meta["decoding"]["source"])
    check("tools", meta["tools"]["agentic"] is not None, meta["tools"]["source"])
    dataset = meta["dataset"]
    check("dataset", dataset["name"] is not None or dataset["sha256"] is not None, dataset["source"])
    if has_attack:
        check("attackSet", meta["attackSet"] is not None, (meta["attackSet"] or {}).get("source"))
    if judged_scores(items) or meta["judges"]:
        refs = {s["scorer"]["judgeRef"] for i in items for s in i["scores"] if s["scorer"]["kind"] == "model_graded"}
        judges = meta["judges"]
        unjudged = None in refs
        check("judges.model", bool(judges) and not unjudged and all(j["model"]["model"] is not None for j in judges), _judge_source(judges, "model"))
        check("judges.family", bool(judges) and not unjudged and all(j["model"]["family"] is not None for j in judges), _judge_source(judges, "family"))
        check("judges.promptTemplate", bool(judges) and not unjudged and all(j["promptTemplateSha256"] is not None for j in judges), _judge_source(judges, "promptTemplate"))
        check("judges.validation", bool(judges) and not unjudged and all(j["validation"] is not None for j in judges), None)
    check("epochs", meta["epochs"]["value"] is not None, meta["epochs"]["source"])
    check("dates", meta["dates"]["runStartedAt"] is not None or meta["dates"]["runCompletedAt"] is not None, meta["dates"]["source"])
    meta["completeness"] = {"missing": missing, "declaredOnly": declared}
    return meta


def finalize_counts(run):
    """Counts and fingerprint only: judge-label binding needs the fingerprint before completeness is final."""
    items = run.items
    run.meta["n"] = {"items": len(items), "groups": len({i["groupKey"] for i in items}), "scored": sum(1 for i in items if i["status"] == "scored")}
    run.meta["datasetFingerprint"] = fingerprint(items)


def strip_private(value):
    """Drop the engine's internal `_` keys before a value is written into the envelope."""
    if isinstance(value, dict):
        return {k: strip_private(v) for k, v in value.items() if not (isinstance(k, str) and k.startswith("_"))}
    if isinstance(value, list):
        return [strip_private(v) for v in value]
    return value


def _judge_source(judges, field):
    if not judges:
        return None
    sources = []
    for judge in judges:
        if field == "family":
            sources.append(judge["model"].get("_familySource"))
        elif field == "promptTemplate":
            sources.append(judge.get("_templateSource"))
        else:
            sources.append(judge["model"]["source"])
    if sources and all(s is not None and s.get("kind") == "declared" for s in sources):
        return {"kind": "declared"}
    return None


def ordered_metadata(meta):
    keys = ("runKey", "format", "harness", "systemUnderTest", "systemPrompt", "decoding", "tools", "dataset", "datasetFingerprint", "attackSet", "judges", "epochs", "n", "dates", "completeness")
    return strip_private({k: meta[k] for k in keys})


def require_unique_keys(items):
    seen = set()
    for item in items:
        if item["itemKey"] in seen:
            fail("duplicate_item_key", item["itemKey"])
        seen.add(item["itemKey"])
