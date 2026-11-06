"""Shared fixtures for the GenAI evidence tests: bundles, manifests and plans built from engine/tests/fixtures/genai."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "genai"
SCHEMAS = Path(__file__).resolve().parents[2] / "schemas"


def has_zstd():
    from engine.genai.readers import zstd_backend
    return zstd_backend() is not None


ROLE_BY_PREFIX = (("results_", "results"), ("samples_", "samples"))


def input_spec(relative, fmt, role=None, **extra):
    data = (FIXTURES / relative).read_bytes()
    name = relative.split("/")[-1]
    if role is None:
        role = next((r for p, r in ROLE_BY_PREFIX if name.startswith(p)), "hitlog" if "hitlog" in name else "log")
    return {"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": fmt, "role": role, **extra}, data


BUNDLES = {
    "inspect/tiny_qa.eval": [("inspect/tiny_qa.eval", "inspect_eval")],
    "inspect/tiny_qa.edited.eval": [("inspect/tiny_qa.edited.eval", "inspect_eval")],
    "inspect/judged_qa_30.eval": [("inspect/judged_qa_30.eval", "inspect_eval")],
    "inspect/tiny_agent.eval": [("inspect/tiny_agent.eval", "inspect_eval")],
    "inspect/canary_injection.json": [("inspect/canary_injection.json", "inspect_json")],
    "lm_eval/*": [("lm_eval/results_2026-11-05T16-54-06.848117.json", "lm_eval_samples"), ("lm_eval/samples_tiny_gen_2026-11-05T16-54-06.848117.jsonl", "lm_eval_samples"),
                  ("lm_eval/samples_tiny_mc_2026-11-05T16-54-06.848117.jsonl", "lm_eval_samples")],
    "promptfoo/echo_repeat.results.json": [("promptfoo/echo_repeat.results.json", "promptfoo_results")],
    "promptfoo/redteam_shaped.results.json": [("promptfoo/redteam_shaped.results.json", "promptfoo_results")],
    "garak/tiny.report.jsonl": [("garak/tiny.report.jsonl", "garak_report"), ("garak/tiny.hitlog.jsonl", "garak_report")],
    "pyrit/attacks.pyrit-export.jsonl": [("pyrit/attacks.pyrit-export.jsonl", "pyrit_export")],
    "deepeval/test_run_20261105_170925.json": [("deepeval/test_run_20261105_170925.json", "deepeval_test_run")],
    "ragas/results.jsonl": [("ragas/results.jsonl", "ragas_results")],
}
ZSTD_BUNDLES = {"inspect/tiny_qa.eval", "inspect/tiny_qa.edited.eval", "inspect/judged_qa_30.eval", "inspect/tiny_agent.eval"}
DECLARED_HARNESS = {"deepeval/test_run_20261105_170925.json": "4.3.3", "ragas/results.jsonl": "0.4.3"}


def examples():
    return json.loads((FIXTURES / "normalized-examples.json").read_text(encoding="utf-8"))


def expected():
    return json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


def reference_lines():
    """Reference records keyed by (fileSha256, itemKey), plus the raw lines."""
    out = {}
    for line in (FIXTURES / "normalized-items.jsonl").read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        out[(record["source"]["fileSha256"], record["itemKey"])] = line
    return out


def bundle(name, *, criteria=(), declared=None, plan_extra=None, origin="auditee_supplied", extra_inputs=()):
    """(inputs, manifest, plan) for one fixture bundle, with the reference plan of normalized-examples.json."""
    specs = [input_spec(path, fmt) for path, fmt in BUNDLES[name]] + list(extra_inputs)
    reference = examples()["bundles"][name]["referencePlan"]
    plan = {"schemaVersion": "genai-plan/0.1", "criteria": list(criteria), **reference, **(plan_extra or {})}
    declared = dict(declared or {})
    if name in DECLARED_HARNESS and "harness" not in declared:
        declared["harness"] = {"name": name.split("/")[0], "version": DECLARED_HARNESS[name]}
    manifest = {"schemaVersion": "genai-bundle/0.1", "origin": origin, "inputs": [s for s, _ in specs], "declared": declared}
    return {s["sha256"]: d for s, d in specs}, manifest, plan


def computation(envelope):
    return json.loads(envelope["computationJSON"])


def schema_validators():
    """jsonschema validators for the item schema and the result schema (with the cross-file $ref)."""
    import jsonschema
    from referencing import Registry, Resource
    item = json.loads((SCHEMAS / "genai-evidence-item.schema.json").read_text(encoding="utf-8"))
    result = json.loads((SCHEMAS / "genai-result.schema.json").read_text(encoding="utf-8"))
    registry = Registry().with_resources([(item["$id"], Resource.from_contents(item)), (result["$id"], Resource.from_contents(result)),
                                          ("genai-evidence-item.schema.json", Resource.from_contents(item))])
    cls = jsonschema.validators.validator_for(item)
    make = lambda schema: cls(schema, registry=registry, format_checker=cls.FORMAT_CHECKER)  # noqa: E731
    computation_schema = {"$schema": result["$schema"], "$ref": result["$id"] + "#/$defs/computation"}
    metadata_schema = {"$schema": item["$schema"], "$ref": item["$id"] + "#/$defs/runMetadata"}
    return make(item), make(result), make(computation_schema), make(metadata_schema)
