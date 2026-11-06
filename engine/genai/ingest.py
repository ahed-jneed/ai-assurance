"""`run_bundle`: the one entry point of the CLI (and of the future worker job) (design sections 4, 6.3 and 10).

Validation, detection, parsing, declarations, judge validation,
recomputation and the result envelope. Inputs are bytes matched to the
manifest by SHA-256, never by name or path. The computation is
deterministic: the same inputs, plan, manifest and engine version give
byte-identical `computationJSON` and `itemsJSONL`.
"""
from __future__ import annotations

import hashlib
import re

from .. import __version__ as ENGINE_VERSION
from .. import statistics as core
from . import GENAI_VERSION, hashing, limits, plan as plans, recompute, taxonomy
from .errors import GenaiInputError, Warnings, fail, require
from .families import heuristic_family
from .formats import common, deepeval, garak, inspect, judge_validation, lm_eval, marking, promptfoo, pyrit, ragas
from .readers import decode_text, first_jsonl_object, load_jsonl, loads

COMPUTATION_SCHEMA = "genai-computation/0.1"
PARSER_VERSIONS = {
    "inspect_eval": "0.1.0", "inspect_json": "0.1.0", "lm_eval_samples": "0.1.0", "promptfoo_results": "0.1.0", "garak_report": "0.1.0",
    "pyrit_export": "0.1.0", "deepeval_test_run": "0.1.0", "ragas_results": "0.1.0", "judge_validation_jsonl": "0.1.0", "marking_check_jsonl": "0.1.0",
}
SNAPSHOT_SUFFIX = re.compile(r"^[-_.:@]v?[0-9]")
REVISION = re.compile(r"^[0-9a-f]{7,40}$|^sha256:[0-9a-f]{64}$")


# ---------------------------------------------------------------- detection


def detect(data: bytes):
    """(format, role) from content, never from a file name; (None, None) when nothing matches."""
    if data[:4] == b"PK\x03\x04":
        return ("inspect_eval", "log") if inspect.detect_eval(data) else (None, None)
    head = data.lstrip()[:1]
    if head == b"{":
        try:
            doc = loads(decode_text(data))
        except GenaiInputError:
            doc = None
        if doc is not None:
            if inspect.detect_json(doc):
                return "inspect_json", "log"
            if lm_eval.detect_results(doc):
                return "lm_eval_samples", "results"
            if promptfoo.detect(doc):
                return "promptfoo_results", "log"
            if deepeval.detect(doc):
                return "deepeval_test_run", "log"
            if not _looks_like_jsonl(data):
                return None, None
        first = first_jsonl_object(data)
        if first is None:
            return None, None
        if garak.detect(first):
            return "garak_report", "log"
        if garak.detect_hitlog(first):
            return "garak_report", "hitlog"
        if lm_eval.detect_samples(first):
            return "lm_eval_samples", "samples"
        if pyrit.detect(first):
            return "pyrit_export", "log"
        if judge_validation.detect(first):
            return "judge_validation_jsonl", "judge_validation"
        if marking.detect(first):
            return "marking_check_jsonl", "marking"
        try:
            rows = [row for _, row in load_jsonl(data, "input")]
        except GenaiInputError:
            return None, None
        if ragas.detect(rows):
            return "ragas_results", "log"
    return None, None


def _looks_like_jsonl(data: bytes) -> bool:
    lines = [line for line in data.split(b"\n") if line.strip()]
    return len(lines) > 1


# ---------------------------------------------------------------- declarations (design section 6.3)


def _snapshot_consistent(model, snapshot):
    if not isinstance(model, str) or not model:
        return True
    last = model.rsplit("/", 1)[-1]
    if snapshot == last or REVISION.match(snapshot):
        return True
    return snapshot.startswith(last) and bool(SNAPSHOT_SUFFIX.match(snapshot[len(last):]))


def _declared_source(pointer, by):
    return common.source("declared", pointer, by)


def apply_declarations(run, declared, by, bundle_warnings):
    meta = run.meta
    w = run.warnings
    if not declared:
        return
    if "harness" in declared:
        d = declared["harness"]
        h = meta["harness"]
        if h["version"] is None and d.get("version"):
            meta["harness"] = {"name": h["name"], "version": d["version"], "source": _declared_source("manifest#/declared/harness", by)}
        elif d.get("version") and d["version"] != h["version"]:
            w.add("declaration_conflict", "harness.version")
    if "systemUnderTest" in declared:
        d = declared["systemUnderTest"]
        sut = meta["systemUnderTest"]
        if d.get("model"):
            if sut["model"] is None:
                sut["model"] = d["model"]
                sut["source"] = _declared_source("manifest#/declared/systemUnderTest", by)
            elif sut["model"] != d["model"]:
                w.add("declaration_conflict", "systemUnderTest.model")
        if d.get("snapshot"):
            if sut["snapshot"] is not None:
                if sut["snapshot"] != d["snapshot"]:
                    w.add("declaration_conflict", "systemUnderTest.snapshot")
            else:
                if not _snapshot_consistent(sut["model"], d["snapshot"]):
                    w.add("declaration_conflict", "systemUnderTest.snapshot")
                sut["snapshot"] = d["snapshot"]
                sut["_snapshotSource"] = _declared_source("manifest#/declared/systemUnderTest/snapshot", by)
        if d.get("provider"):
            sut["provider"] = d["provider"]
        if d.get("family"):
            sut["family"] = d["family"]
            sut["_familySource"] = _declared_source("manifest#/declared/systemUnderTest/family", by)
            guess = heuristic_family(sut["model"])
            if guess is not None and guess != d["family"]:
                w.add("family_declaration_conflict", "systemUnderTest.family")
                run.extra["familyConflict"] = True
    if "systemPrompt" in declared:
        sp = meta["systemPrompt"]
        if sp["sha256"] is None and sp["distinctCount"] == 0:
            meta["systemPrompt"] = {"sha256": declared["systemPrompt"]["sha256"], "distinctCount": 1, "source": _declared_source("manifest#/declared/systemPrompt", by)}
        elif sp["sha256"] != declared["systemPrompt"]["sha256"]:
            w.add("declaration_conflict", "systemPrompt")
    if "decoding" in declared:
        d = declared["decoding"]
        dec = meta["decoding"]
        if dec["source"]["kind"] == "missing":
            values = common.decoding({k: d.get(k) for k in ("temperature", "topP", "topK", "maxTokens", "seed")}, _declared_source("manifest#/declared/decoding", by),
                                     d.get("generationsPerItem") or dec["generationsPerItem"], dec.get("other"))
            meta["decoding"] = values
        else:
            for key in ("temperature", "topP", "topK", "maxTokens", "seed"):
                if d.get(key) is not None and dec[key] is not None and float(d[key]) != float(dec[key]):
                    w.add("declaration_conflict", f"decoding.{key}")
    if "tools" in declared:
        d = declared["tools"]
        tools = meta["tools"]
        if tools["agentic"] is None:
            meta["tools"] = {"agentic": d["agentic"], "offered": [dict(t) for t in d["offered"]], "source": _declared_source("manifest#/declared/tools", by)}
        else:
            if d["agentic"] != tools["agentic"]:
                w.add("declaration_conflict", "tools.agentic")
            permissions = {t["name"]: t["permission"] for t in d["offered"]}
            for tool in tools["offered"]:
                if tool["name"] in permissions:
                    tool["permission"] = permissions[tool["name"]]
    for key in ("dataset", "attackSet"):
        if key not in declared or (key == "attackSet" and not any(i["itemType"] == "attack" for i in run.items)):
            continue
        d = declared[key]
        current = meta[key]
        if current is None or (current["name"] is None and current["sha256"] is None):
            meta[key] = common.versioned(d.get("name"), d.get("version"), d.get("sha256"), _declared_source(f"manifest#/declared/{key}", by))
        else:
            for field in ("name", "version", "sha256"):
                if d.get(field) is not None and current[field] is not None and d[field] != current[field]:
                    w.add("declaration_conflict", f"{key}.{field}")
    if "dates" in declared and run.format == "garak_report" and meta["dates"]["source"]["kind"] == "declared":
        pass
    _apply_judges(run, declared.get("judges") or [], by)
    for entry in declared.get("scorers") or []:
        if entry["score"] in run.score_kinds and "unknown" in run.score_kinds[entry["score"]]:
            run.extra.setdefault("declaredDeterministic", set()).add(entry["score"])
            w.add("scorer_kind_declared", entry["score"])


def _apply_judges(run, judges, by):
    meta = run.meta
    for index, decl in enumerate(judges):
        pointer = f"manifest#/declared/judges/{index}"
        matched = [j for j in meta["judges"] if j["model"]["model"] == decl["model"]]
        for entry in matched:
            entry["_decl"] = decl["ref"]
            model = entry["model"]
            if decl.get("snapshot"):
                if model["snapshot"] is None:
                    model["snapshot"] = decl["snapshot"]
                elif model["snapshot"] != decl["snapshot"]:
                    run.warnings.add("declaration_conflict", f"judges.{entry['ref']}.snapshot")
            if decl.get("family"):
                model["family"] = decl["family"]
                model["_familySource"] = _declared_source(f"{pointer}/family", by)
                guess = heuristic_family(model["model"])
                if guess is not None and guess != decl["family"]:
                    run.warnings.add("family_declaration_conflict", f"judges.{entry['ref']}")
                    run.extra["familyConflict"] = True
            if entry["promptTemplateSha256"] is None and decl.get("promptTemplateSha256"):
                entry["promptTemplateSha256"] = decl["promptTemplateSha256"]
                entry["_templateSource"] = _declared_source(f"{pointer}/promptTemplateSha256", by)
            if decl.get("pairwise"):
                entry["role"] = "pairwise_judge"
        if matched:
            run.extra.setdefault("matchedDeclarations", set()).add(decl["ref"])
        named = [s for s in decl.get("scores", []) if s in run.score_kinds]
        if not named:
            continue
        run.extra.setdefault("matchedDeclarations", set()).add(decl["ref"])
        declared_only = None
        for item in run.items:
            for score in item["scores"]:
                if score["name"] not in named:
                    continue
                if score["scorer"]["kind"] == "model_graded" and score["scorer"]["judgeRef"]:
                    continue
                if declared_only is None:
                    role = "pairwise_judge" if decl.get("pairwise") else {"garak_report": "detector_model", "pyrit_export": "scorer_model"}.get(run.format, "grader")
                    declared_only = {
                        "ref": f"J{len(meta['judges']) + 1}", "role": role,
                        "model": {"model": decl["model"], "snapshot": decl.get("snapshot"), "provider": None, "family": decl.get("family"), "source": _declared_source(pointer, by),
                                  "_familySource": _declared_source(f"{pointer}/family", by) if decl.get("family") else None},
                        "promptTemplateSha256": decl.get("promptTemplateSha256"), "validation": None, "_decl": decl["ref"],
                        "_templateSource": _declared_source(f"{pointer}/promptTemplateSha256", by) if decl.get("promptTemplateSha256") else None,
                    }
                    meta["judges"].append(declared_only)
                score["scorer"] = {"kind": "model_graded", "judgeRef": declared_only["ref"]}
        if declared_only is not None:
            for name in named:
                run.score_kinds[name] = {s["scorer"]["kind"] for i in run.items for s in i["scores"] if s["name"] == name}
            _recompose_composites(run)


def _recompose_composites(run):
    """promptfoo `overall` takes the most restrictive kind of its parts again after a declaration changed a part."""
    from .scorers import most_restrictive
    if run.format != "promptfoo_results":
        return
    for item in run.items:
        parts = [s for s in item["scores"] if s["name"] != "overall"]
        for s in item["scores"]:
            if s["name"] == "overall" and parts:
                s["scorer"]["kind"] = most_restrictive(p["scorer"]["kind"] for p in parts)
    run.score_kinds["overall"] = {s["scorer"]["kind"] for i in run.items for s in i["scores"] if s["name"] == "overall"}


# ---------------------------------------------------------------- judge validation (design sections 7.9 and 8.7)


def validate_judges(label_files, runs, manifest, plan):
    level = plan["confidenceLevel"]
    rules = plan["judgeValidation"]
    out = []
    by_ref = {spec.get("judgeRef"): (spec, parsed) for spec, parsed in label_files}
    for ref, (spec, parsed) in sorted(by_ref.items(), key=lambda kv: kv[0] or ""):
        k = judge_validation.kappa(parsed["labels"], parsed["labelSet"], level)
        pc = judge_validation.position_consistency(parsed["pairs"], level)
        bindings = []
        for run in runs:
            for entry in run.meta["judges"]:
                if entry.get("_decl") != ref:
                    continue
                model = entry["model"]
                header = parsed["judge"]
                sampled = parsed["sampledFrom"]

                def eq(a, b):
                    return None if a is None or b is None else a == b
                if sampled["datasetFingerprint"] is not None:
                    sampled_ok = sampled["datasetFingerprint"] == run.meta["datasetFingerprint"]
                else:
                    ds = run.meta["dataset"]
                    pairs = [(sampled["dataset"]["name"], ds["name"]), (sampled["dataset"]["version"], ds["version"])]
                    sampled_ok = None if any(a is None or b is None for a, b in pairs) else all(a == b for a, b in pairs)
                binding = {"model": eq(header["model"], model["model"]), "snapshot": eq(header["snapshot"], model["snapshot"]),
                           "promptTemplate": eq(header["promptTemplateSha256"], entry["promptTemplateSha256"]), "sampledFrom": sampled_ok}
                bound = all(v is True for v in binding.values())
                sut_family = run.meta["systemUnderTest"]["family"]
                reasons = []
                if sut_family is None or model["family"] is None:
                    reasons.append("family_undeclared")
                elif sut_family == model["family"]:
                    reasons.append("same_family")
                if run.extra.get("familyConflict"):
                    reasons.append("family_declaration_conflict")
                if not bound:
                    reasons.append("judge_validation_unbound")
                    run.warnings.add("judge_validation_unbound", entry["ref"])
                if k["kappa"] is None:
                    reasons.append("kappa_undefined")
                if k["n"] < rules["minimumItems"]:
                    reasons.append("below_minimum_items")
                if k["lower"] is None or k["lower"] < rules["minimumKappaLowerBound"]:
                    reasons.append("kappa_lower_bound_below_floor")
                pairwise = entry["role"] == "pairwise_judge"
                if pairwise and (pc["lower"] is None or pc["lower"] < rules["pairwiseMinimumConsistencyLowerBound"]):
                    reasons.append("position_consistency_below_floor")
                validated = not reasons
                entry["validation"] = {
                    "kappa": None if k["kappa"] is None else max(-1.0, min(1.0, k["kappa"])), "lower": k["lower"], "upper": k["upper"], "n": k["n"], "level": level,
                    "positionConsistency": pc if pairwise else None, "binding": binding, "artifactSha256": parsed["sha256"], "evidenceLevel": "L2",
                }
                entry["_validated"] = validated
                entry["_reasons"] = reasons
                matched_items = sum(1 for key in parsed["itemKeys"] if any(i["itemKey"] == key for i in run.items))
                bindings.append({"runKey": run.run_key, "judgeRef": entry["ref"], "binding": binding, "validated": validated, "reasons": reasons, "labelRowsReferencingRun": matched_items})
        out.append({"inputSha256": parsed["sha256"], "declaredJudgeRef": ref, "judge": parsed["judge"], "sampledFrom": parsed["sampledFrom"], "labelSet": parsed["labelSet"],
                    "n": k["n"], "table": k["table"], "observedAgreement": k["observedAgreement"], "chanceAgreement": k["chanceAgreement"],
                    "kappa": k["kappa"], "se": k["se"], "lower": k["lower"], "upper": k["upper"], "level": level, "positionConsistency": pc,
                    "evidenceLevel": "L2", "reasons": k["reasons"], "bindings": bindings})
    return out


# ---------------------------------------------------------------- the bundle


# Defence in depth: a parser crash on structure it did not expect is a rejected input, never an
# uncoded exception. The fuzz tests set STRICT so that every such crash is found and fixed instead.
STRICT = False
_CRASHES = (TypeError, KeyError, AttributeError, IndexError, ValueError, OverflowError, ZeroDivisionError, RecursionError)


def guarded(parser, *args, **kwargs):
    try:
        return parser(*args, **kwargs)
    except GenaiInputError:
        raise
    except _CRASHES as exc:
        if STRICT:
            raise
        raise GenaiInputError("invalid_json", f"unexpected structure ({type(exc).__name__})") from exc


def items_line(item) -> str:
    return hashing.canonical(hashing.clean(item)).decode("utf-8")


def _group_inputs(entries):
    groups = []
    lm_results = [e for e in entries if e[0]["format"] == "lm_eval_samples" and e[0]["role"] == "results"]
    lm_samples = [e for e in entries if e[0]["format"] == "lm_eval_samples" and e[0]["role"] == "samples"]
    used = set()
    for results in lm_results:
        match = lm_eval.RESULTS_NAME.match(results[0]["name"])
        require(match is not None, "lm_eval_bundle_mismatch", "results file name")
        members = [s for s in lm_samples if (m := lm_eval.SAMPLES_NAME.match(s[0]["name"])) and m.group("date") == match.group("date")]
        used.update(id(s) for s in members)
        groups.append(("lm_eval_samples", [results] + members))
    require(all(id(s) in used for s in lm_samples), "lm_eval_bundle_mismatch", "a samples file matches no results file")
    reports = [e for e in entries if e[0]["format"] == "garak_report" and e[0]["role"] != "hitlog"]
    hitlogs = [e for e in entries if e[0]["format"] == "garak_report" and e[0]["role"] == "hitlog"]
    require(len(hitlogs) <= len(reports) and (len(reports) == 1 or not hitlogs), "format_mismatch", "pair each garak hit log with one report")
    for report in reports:
        groups.append(("garak_report", [report] + hitlogs))
    for entry in entries:
        fmt = entry[0]["format"]
        if fmt in ("lm_eval_samples", "garak_report", "judge_validation_jsonl", "marking_check_jsonl"):
            continue
        groups.append((fmt, [entry]))
    return groups


PARSERS = {
    "inspect_eval": inspect.parse, "inspect_json": inspect.parse, "lm_eval_samples": lm_eval.parse, "promptfoo_results": promptfoo.parse,
    "pyrit_export": pyrit.parse, "deepeval_test_run": deepeval.parse, "ragas_results": ragas.parse,
}
DECLARED_VERSION_FORMATS = {"deepeval_test_run": "4.3", "ragas_results": "0.4"}


def run_bundle(inputs, manifest, plan, *, provenance=None):
    """Ingest a bundle. `inputs` maps SHA-256 to bytes; `manifest` and `plan` are the parsed JSON objects."""
    return ingest_bundle(inputs, manifest, plan, provenance=provenance)[0]


def ingest_bundle(inputs, manifest, plan, *, provenance=None):
    """run_bundle, plus the full items JSONL whether or not it travels inline."""
    raw_manifest, raw_plan = manifest, plan
    require(isinstance(inputs, dict), "manifest_invalid", "inputs")
    plan = plans.normalize_plan(raw_plan)
    manifest = plans.normalize_manifest(raw_manifest)
    require(len(inputs) <= limits.MAX_BUNDLE_FILES, "bundle_too_large")
    require(sum(len(v) for v in inputs.values()) <= limits.MAX_BUNDLE_BYTES, "bundle_too_large")
    declared = manifest["declared"]
    by = manifest["declaredBy"]
    entries, input_records = [], []
    for spec in manifest["inputs"]:
        data = inputs.get(spec["sha256"])
        require(data is not None, "input_hash_mismatch", f"{spec['name']}: no input with the declared SHA-256")
        require(len(data) <= limits.MAX_INPUT_FILE_BYTES, "input_too_large", spec["name"])
        require(hashlib.sha256(data).hexdigest() == spec["sha256"] and len(data) == spec["bytes"], "input_hash_mismatch", spec["name"])
        fmt, role = detect(data)
        require(fmt is not None, "unknown_format", spec["name"])
        require(fmt == spec["format"], "format_mismatch", f"{spec['name']}: detected {fmt}, declared {spec['format']}")
        expected_roles = {"results": ("results",), "samples": ("samples",), "hitlog": ("hitlog",), "judge_validation": ("judge_validation",), "marking": ("marking",)}.get(role, ("log", "attack_set"))
        require(spec["role"] in expected_roles, "format_mismatch", f"{spec['name']}: role {spec['role']} does not fit the content")
        item = dict(spec)
        if fmt in ("inspect_json", "promptfoo_results", "deepeval_test_run") or (fmt == "lm_eval_samples" and role == "results"):
            item["_doc"] = loads(decode_text(data))
        entries.append((item, data))
    require(len(inputs) == len(manifest["inputs"]), "input_hash_mismatch", "every input must be declared in the manifest")
    for fmt, version in DECLARED_VERSION_FORMATS.items():
        if any(e[0]["format"] == fmt for e in entries):
            declared_version = (declared.get("harness") or {}).get("version")
            if not (isinstance(declared_version, str) and (declared_version == version or declared_version.startswith(version + "."))):
                require(plan["allowUnverifiedFormatVersion"], "unsupported_format_version", f"{fmt} needs a declared harness version {version}.x")
    runs = []
    bundle_warnings = Warnings()
    format_versions = {}
    for fmt, group in _group_inputs(entries):
        files = [(spec, data) for spec, data in group]
        if fmt == "garak_report":
            parsed = guarded(garak.parse, files, plan, declared=declared)
        else:
            parsed = guarded(PARSERS[fmt], files, plan)
        for run in parsed:
            if fmt in DECLARED_VERSION_FORMATS:
                declared_version = (declared.get("harness") or {}).get("version")
                if not (isinstance(declared_version, str) and (declared_version == DECLARED_VERSION_FORMATS[fmt] or declared_version.startswith(DECLARED_VERSION_FORMATS[fmt] + "."))):
                    run.level_caps.append("unverified_format_version")
                    run.warnings.add("unverified_format_version")
            runs.append(run)
            for sha in run.inputs:
                format_versions.setdefault(sha, run.meta["harness"]["version"])
    keys = [r.run_key for r in runs]
    require(len(keys) == len(set(keys)), "duplicate_item_key", "two runs share a run key")
    total_items = sum(len(r.items) for r in runs)
    require(total_items <= limits.MAX_ITEMS, "too_many_items")
    for run in runs:
        run.extra["policy"] = plan["scorePolicy"]
        apply_declarations(run, declared, by, bundle_warnings)
        if run.meta["systemUnderTest"]["model"] and run.meta["systemUnderTest"]["snapshot"] is None:
            run.warnings.add("moving_model_alias")
    for decl in declared.get("judges") or []:
        if not any(decl["ref"] in r.extra.get("matchedDeclarations", set()) for r in runs):
            bundle_warnings.add("declared_judge_not_observed", decl["ref"])
    for run in runs:
        common.finalize_counts(run)
    label_files = []
    marking_runs = []
    for spec, data in entries:
        if spec["format"] == "judge_validation_jsonl":
            label_files.append((spec, guarded(judge_validation.parse, spec, data)))
            format_versions[spec["sha256"]] = judge_validation.SCHEMA
        elif spec["format"] == "marking_check_jsonl":
            parsed = guarded(marking.parse, spec, data)
            marking_runs.append(parsed)
            bundle_warnings.merge(parsed["warnings"])
            format_versions[spec["sha256"]] = marking.SCHEMA
    judge_results = validate_judges(label_files, runs, manifest, plan)
    for run in runs:
        common.finalize(run)
    all_items = [item for run in runs for item in run.items]
    common.require_unique_keys(all_items)
    criteria, overall, review_flags = recompute.evaluate(plan, runs, marking_runs, bundle_warnings)
    run_blocks = []
    for run in runs:
        level, level_reasons = recompute.evidence_level(run)
        reconciliation = recompute.reconcile(run, plan)
        if any(r["status"] == "mismatch" for r in reconciliation):
            run.warnings.add("tool_aggregate_mismatch", count=sum(1 for r in reconciliation if r["status"] == "mismatch"))
        lines = [items_line(i) for i in sorted(run.items, key=lambda i: i["itemKey"])]
        counts = {s: sum(1 for i in run.items if i["status"] == s) for s in ("scored", "unscored", "error", "invalidated")}
        run_blocks.append({
            "runKey": run.run_key, "format": run.format, "inputs": run.inputs,
            "runMetadata": hashing.clean(common.ordered_metadata(run.meta)),
            "statusCounts": counts,
            "scoreKinds": {name: sorted(kinds) for name, kinds in sorted(run.score_kinds.items())},
            "declaredDeterministicScores": sorted(run.extra.get("declaredDeterministic", set())),
            "postRunEdits": run.post_run_edits,
            "reconciliation": reconciliation,
            "items": {"count": len(run.items), "sha256": hashing.sha256_bytes("".join(line + "\n" for line in lines).encode("utf-8"))},
            "evidenceLevel": level, "levelReasons": level_reasons,
            "incomplete": run.incomplete,
            "claimScope": recompute.claim_scope(run, criteria, judge_results),
            "warnings": run.warnings.as_list(),
        })
        bundle_warnings.merge(run.warnings)
    marking_blocks = [{"runKey": m["runKey"], "inputSha256": m["inputSha256"], "evidenceLevel": "L2", "records": m["records"], "count": len(m["records"])} for m in marking_runs]
    computation = {
        "schemaVersion": COMPUTATION_SCHEMA,
        "engine": {"version": ENGINE_VERSION, "genaiVersion": GENAI_VERSION, "parsers": {f: PARSER_VERSIONS[f] for f in sorted({s["format"] for s, _ in entries})},
                   "statisticsVersion": core.SPEC_VERSION, "taxonomyVersion": taxonomy.TAXONOMY_VERSION},
        "plan": {"planSha256": hashing.sha256_bytes(hashing.canonical(raw_plan)), "normalized": plan},
        "manifest": {"manifestSha256": hashing.sha256_bytes(hashing.canonical(raw_manifest)), "origin": manifest["origin"], "declaredBy": manifest["declaredBy"], "declaredAt": manifest["declaredAt"]},
        "inputs": [{"name": hashing.clean(s["name"]), "sha256": s["sha256"], "bytes": s["bytes"], "format": s["format"], "formatVersion": format_versions.get(s["sha256"]), "role": s["role"]} for s, _ in entries],
        "runs": run_blocks,
        "criteria": criteria,
        "overallOutcome": overall,
        "reviewFlags": review_flags,
        "judgeValidation": judge_results,
        "marking": marking_blocks,
        "warnings": bundle_warnings.as_list(),
    }
    items_jsonl = "".join(items_line(i) + "\n" for i in sorted(all_items, key=lambda i: i["itemKey"]))
    from .envelope import build_envelope
    # Names and labels copied from a log may carry unpaired surrogates: replace them before encoding (section 6.2).
    return build_envelope(hashing.clean(computation), items_jsonl, manifest, provenance), items_jsonl
