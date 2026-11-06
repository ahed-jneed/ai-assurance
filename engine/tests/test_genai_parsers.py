"""GenAI parsers against the design-time reference records (docs/design/genai-evidence.md section 7).

Every record the parsers produce from engine/tests/fixtures/genai must equal its line in
normalized-items.jsonl byte for byte (canonical JSON), and every run-metadata block must equal
normalized-examples.json. The reference was produced independently from the design text; a
disagreement is a defect to resolve, not to copy.
"""
from __future__ import annotations

import importlib
import json
import os
import unittest

from engine.genai import hashing
from engine.genai import plan as plans
from engine.genai.formats import common
from engine.genai.ingest import detect
from engine.genai.readers import decode_text, loads
from engine.tests import genai_support as gs

ZSTD_REQUIRED = os.environ.get("GENAI_REQUIRE_ZSTD") == "1"
MODULES = {"inspect": "inspect", "lm_eval": "lm_eval", "promptfoo": "promptfoo", "garak": "garak", "pyrit": "pyrit", "deepeval": "deepeval", "ragas": "ragas"}


def parse_reference_bundle(name):
    """Parse a bundle the way the reference was made: the reference plan and no declarations."""
    files = []
    for path, fmt in gs.BUNDLES[name]:
        spec, data = gs.input_spec(path, fmt)
        if fmt in ("inspect_json", "promptfoo_results", "deepeval_test_run") or spec["role"] == "results":
            spec["_doc"] = loads(decode_text(data))
        files.append((spec, data))
    plan = plans.normalize_plan({"schemaVersion": "genai-plan/0.1", "criteria": [], **gs.examples()["bundles"][name]["referencePlan"]})
    module = importlib.import_module("engine.genai.formats." + MODULES[name.split("/")[0]])
    runs = module.parse(files, plan)
    for run in runs:
        common.finalize(run)
    return runs


class ZstdBackendTest(unittest.TestCase):
    def test_zstd_backend_present_where_required(self):
        if ZSTD_REQUIRED:
            self.assertTrue(gs.has_zstd(), "GENAI_REQUIRE_ZSTD=1 but neither compression.zstd nor zstandard imports")


class ReferenceRecordsTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls.references = gs.reference_lines()
        cls.examples = gs.examples()

    def check_bundle(self, name):
        if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
            if ZSTD_REQUIRED:
                self.fail("zstd back-end missing")
            self.skipTest("no zstd back-end (install engine/requirements-dev.txt)")
        runs = parse_reference_bundle(name)
        spec = self.examples["bundles"][name]
        self.assertEqual(sorted(r.run_key for r in runs), sorted(r["runKey"] for r in spec["runs"]))
        count = 0
        for run in runs:
            reference = next(r for r in spec["runs"] if r["runKey"] == run.run_key)
            self.assertEqual(json.loads(json.dumps(common.ordered_metadata(run.meta))), reference["runMetadata"])
            self.assertEqual(len(run.items), reference["itemCount"])
            for item in run.items:
                line = hashing.canonical(item).decode("utf-8")
                self.assertEqual(line, self.references[(item["source"]["fileSha256"], item["itemKey"])], item["itemKey"])
                count += 1
            first = next(i for i in run.items if i["itemKey"] == reference["firstItem"]["itemKey"])
            self.assertEqual(json.loads(hashing.canonical(first)), reference["firstItem"])
        return count

    def test_every_bundle_reproduces_the_reference(self):
        total = 0
        for name in gs.BUNDLES:
            with self.subTest(bundle=name):
                total += self.check_bundle(name)
        if gs.has_zstd():
            self.assertEqual(total, self.examples["itemCount"])

    def test_reference_items_sha256(self):
        """The reference file itself is pinned by normalized-examples.json."""
        data = (gs.FIXTURES / "normalized-items.jsonl").read_bytes()
        self.assertEqual(hashing.sha256_bytes(data), self.examples["itemsSha256"])

    def test_items_validate_against_the_item_schema(self):
        item_validator, _, _, metadata_validator = gs.schema_validators()
        for name in gs.BUNDLES:
            if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            for run in parse_reference_bundle(name):
                metadata_validator.validate(json.loads(json.dumps(common.ordered_metadata(run.meta))))
                for item in run.items:
                    item_validator.validate(json.loads(hashing.canonical(item)))


class DetectionTest(unittest.TestCase):
    def test_detection_uses_content(self):
        for name, files in gs.BUNDLES.items():
            if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            for path, fmt in files:
                spec, data = gs.input_spec(path, fmt)
                with self.subTest(path=path):
                    detected, role = detect(data)
                    self.assertEqual(detected, fmt)
                    self.assertEqual(role, spec["role"])
        for path in ("judge_validation/judge_small_60.jsonl", "judge_validation/judge_large_200.jsonl"):
            self.assertEqual(detect((gs.FIXTURES / path).read_bytes()), ("judge_validation_jsonl", "judge_validation"))

    def test_unknown_content(self):
        for data in (b"", b"{}", b"[1,2]", b"hello", b'{"a":1}\n{"b":2}\n', b"PK\x03\x04garbage"):
            self.assertEqual(detect(data), (None, None))


class ToolHashTest(unittest.TestCase):
    def test_lm_eval_hashes_reproduce(self):
        runs = parse_reference_bundle("lm_eval/*")
        for run in runs:
            self.assertNotIn("tool_hash_mismatch", run.warnings)
            self.assertNotIn("tool_hash_mismatch", run.level_caps)

    def test_lm_eval_tampered_prompt_hash_caps_the_run(self):
        from engine.genai.formats import lm_eval
        files = []
        for path, fmt in gs.BUNDLES["lm_eval/*"]:
            spec, data = gs.input_spec(path, fmt)
            if "tiny_gen" in path:
                data = data.replace(b'"prompt_hash": "ef88', b'"prompt_hash": "0f88', 1)
            if spec["role"] == "results":
                spec["_doc"] = loads(decode_text(data))
            files.append((spec, data))
        plan = plans.normalize_plan({"schemaVersion": "genai-plan/0.1", "criteria": []})
        runs = {r.run_key.rsplit(":", 1)[-1]: r for r in lm_eval.parse(files, plan)}
        self.assertIn("tool_hash_mismatch", runs["tiny_gen"].level_caps)
        self.assertNotIn("tool_hash_mismatch", runs["tiny_mc"].level_caps)

    def test_pyrit_piece_hashes_verified(self):
        runs = parse_reference_bundle("pyrit/attacks.pyrit-export.jsonl")
        self.assertNotIn("tool_hash_mismatch", runs[0].level_caps)


if __name__ == "__main__":
    unittest.main()
