"""The genai-result/0.1 envelope, the CLI, manifests, plans and marking checks (design sections 6.3, 8.1, 10 and the #59 Art. 50 edits)."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine.genai import envelope as envelopes
from engine.genai import limits
from engine.genai.__main__ import main
from engine.genai.errors import GenaiInputError
from engine.genai.ingest import ingest_bundle, run_bundle
from engine.tests import genai_support as gs

CRITERIA = {
    "inspect/tiny_qa.eval": [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.3}}],
    "inspect/tiny_qa.edited.eval": [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.3}}],
    "inspect/judged_qa_30.eval": [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.7}}],
    "inspect/tiny_agent.eval": [{"id": "k", "kind": "genai_pass_k", "k": [1, 2], "band": {"lower": 0.2}}],
    "inspect/canary_injection.json": [{"id": "asr", "kind": "genai_attack_success", "band": {"upper": 0.1}}],
    "lm_eval/*": [{"id": "mc", "kind": "genai_mean", "metric": "accuracy", "select": {"task": "tiny_mc"}, "band": {"lower": 0.1}}],
    "promptfoo/echo_repeat.results.json": [{"id": "pass", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.5}}],
    "promptfoo/redteam_shaped.results.json": [{"id": "asr", "kind": "genai_attack_success", "groupBy": "category", "band": {"upper": 0.1}}],
    "garak/tiny.report.jsonl": [{"id": "asr", "kind": "genai_attack_success", "band": {"upper": 0.1}}],
    "pyrit/attacks.pyrit-export.jsonl": [{"id": "asr", "kind": "genai_attack_success", "groupBy": "technique_variant", "band": {"upper": 0.1}}],
    "deepeval/test_run_20261105_170925.json": [{"id": "f", "kind": "genai_mean", "metric": "score_mean", "primaryScore": "Faithfulness", "band": {"lower": 0.5}}],
    "ragas/results.jsonl": [{"id": "em", "kind": "genai_mean", "metric": "score_mean", "band": {"lower": 0.2}}],
}


def available(name):
    return name not in gs.ZSTD_BUNDLES or gs.has_zstd()


class EnvelopeSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.item, cls.result, cls.computation, _ = gs.schema_validators()

    def test_every_bundle_envelope_validates(self):
        for name, criteria in CRITERIA.items():
            if not available(name):
                continue
            with self.subTest(bundle=name):
                inputs, manifest, plan = gs.bundle(name, criteria=criteria)
                env = run_bundle(inputs, manifest, plan)
                self.result.validate(env)
                comp = gs.computation(env)
                self.computation.validate(comp)
                self.assertEqual(hashlib.sha256(env["computationJSON"].encode("utf-8")).hexdigest(), env["computationSha256"])
                self.assertEqual(hashlib.sha256(env["itemsJSONL"].encode("utf-8")).hexdigest(), env["itemsSha256"])
                lines = env["itemsJSONL"].splitlines()
                self.assertEqual(len(lines), sum(r["items"]["count"] for r in comp["runs"]))
                keys = [json.loads(line)["itemKey"] for line in lines]
                self.assertEqual(keys, sorted(keys))
                for line in lines:
                    self.item.validate(json.loads(line))
                self.assertEqual(env["provenance"]["inputHashes"], {str(i): s["sha256"] for i, s in enumerate(manifest["inputs"])})

    def test_committed_example_envelope(self):
        """schemas/fixtures/genai-result.example.json is what the acceptance scenario produces today."""
        if not gs.has_zstd():
            self.skipTest("no zstd back-end")
        committed = json.loads((gs.SCHEMAS / "fixtures" / "genai-result.example.json").read_text(encoding="utf-8"))
        self.result.validate(committed)
        fresh = example_envelope()
        self.assertEqual(committed["computationSha256"], fresh["computationSha256"], "regenerate with: python -m engine.tests.test_genai_envelope --write-example")
        self.assertEqual(committed, fresh)


def example_envelope():
    declared = {"systemUnderTest": {"snapshot": "model-2026-11-05", "provider": "fixture", "family": "other-fixture-sut"},
                "tools": {"agentic": False, "offered": []}, "dataset": {"name": "judged_qa_30", "version": "1.0.0"},
                "judges": [{"ref": "J1", "model": "mockllm/judge", "snapshot": "judge-2026-11-05", "family": "other-fixture-judge", "promptTemplateSha256": None, "scores": []}],
                "scorers": [], "dates": {"utcOffset": None}}
    label = gs.input_spec("judge_validation/judge_large_200.jsonl", "judge_validation_jsonl", role="judge_validation", judgeRef="J1")
    inputs, manifest, plan = gs.bundle("inspect/judged_qa_30.eval", criteria=CRITERIA["inspect/judged_qa_30.eval"], declared=declared,
                                       plan_extra={"primaryScore": "model_graded_qa"}, extra_inputs=[label])
    manifest["declaredBy"], manifest["declaredAt"] = "USER-fixture", "2026-11-05T17:00:00Z"
    return run_bundle(inputs, manifest, plan, provenance={"channel": "cli", "producedAt": None})


class DeterminismTest(unittest.TestCase):
    def test_same_inputs_same_bytes(self):
        name = "promptfoo/redteam_shaped.results.json"
        first = run_bundle(*gs.bundle(name, criteria=CRITERIA[name]))
        second = run_bundle(*gs.bundle(name, criteria=CRITERIA[name]), provenance={"channel": "runner", "producedAt": "2026-11-06T00:00:00Z"})
        self.assertEqual(first["computationJSON"], second["computationJSON"])
        self.assertEqual(first["itemsJSONL"], second["itemsJSONL"])
        self.assertNotEqual(first["provenance"], second["provenance"])

    def test_verify_detects_tampering(self):
        name = "ragas/results.jsonl"
        env = run_bundle(*gs.bundle(name, criteria=CRITERIA[name]))
        self.assertEqual(envelopes.verify(env, env), [])
        tampered = dict(env, computationJSON=env["computationJSON"].replace('"L2"', '"L1"', 1))
        self.assertIn("computationSha256", envelopes.verify(tampered))
        items = dict(env, itemsJSONL=env["itemsJSONL"] + "\n")
        self.assertIn("itemsSha256", envelopes.verify(items))


class SizeProcedureTest(unittest.TestCase):
    def test_items_drop_out_when_they_do_not_fit(self):
        name = "garak/tiny.report.jsonl"
        with mock.patch.object(limits, "MAX_INLINE_ITEMS_BYTES", 1000):
            env, items = ingest_bundle(*gs.bundle(name, criteria=CRITERIA[name]))
        self.assertIsNone(env["itemsJSONL"])
        self.assertEqual(hashlib.sha256(items.encode("utf-8")).hexdigest(), env["itemsSha256"])

    def test_too_large_computation_fails(self):
        name = "garak/tiny.report.jsonl"
        with mock.patch.object(limits, "MAX_RESULT_BYTES", 2000):
            with self.assertRaises(GenaiInputError) as caught:
                run_bundle(*gs.bundle(name, criteria=CRITERIA[name]))
        self.assertEqual(caught.exception.code, "evidence_too_large")


class ManifestAndPlanTest(unittest.TestCase):
    name = "ragas/results.jsonl"

    def expect(self, code, mutate_manifest=None, mutate_plan=None, mutate_inputs=None):
        inputs, manifest, plan = gs.bundle(self.name, criteria=CRITERIA[self.name])
        if mutate_manifest:
            mutate_manifest(manifest)
        if mutate_plan:
            mutate_plan(plan)
        if mutate_inputs:
            inputs = mutate_inputs(inputs)
        with self.assertRaises(GenaiInputError) as caught:
            run_bundle(inputs, manifest, plan)
        self.assertEqual(caught.exception.code, code)

    def test_rejections(self):
        self.expect("input_hash_mismatch", mutate_inputs=lambda i: {k: v + b"\n" for k, v in i.items()})
        self.expect("input_hash_mismatch", mutate_manifest=lambda m: m["inputs"][0].update(bytes=1))
        self.expect("format_mismatch", mutate_manifest=lambda m: m["inputs"][0].update(format="pyrit_export"))
        self.expect("manifest_invalid", mutate_manifest=lambda m: m.update(origin="vendor"))
        self.expect("manifest_invalid", mutate_manifest=lambda m: m.update(extra=True))
        self.expect("manifest_invalid", mutate_manifest=lambda m: m.setdefault("declared", {}).update(systemUnderTest={"family": "meta-llama"}))
        self.expect("manifest_invalid", mutate_manifest=lambda m: m.setdefault("declared", {}).update(systemUnderTest={"family": "other-openai"}))
        self.expect("manifest_invalid", mutate_manifest=lambda m: m["inputs"][0].update(runKey="bad|key"))
        self.expect("plan_invalid", mutate_plan=lambda p: p.update(minimums={"sampleSize": 10}))
        self.expect("plan_invalid", mutate_plan=lambda p: p.update(judgeValidation={"minimumKappaLowerBound": 0.4}))
        self.expect("plan_invalid", mutate_plan=lambda p: p.update(judgeValidation={"requireDifferentFamily": False}))
        self.expect("plan_invalid", mutate_plan=lambda p: p.update(maxErrorFraction=0.2))
        self.expect("plan_invalid", mutate_plan=lambda p: p.update(excerpts="all"))
        self.expect("plan_invalid", mutate_plan=lambda p: p.update(unknown=1))
        self.expect("plan_invalid", mutate_plan=lambda p: p["criteria"][0].update(band={"lower": 1.5}))
        self.expect("plan_invalid", mutate_plan=lambda p: p["criteria"][0].update(select={"task": "nothing"}))
        self.expect("plan_invalid", mutate_plan=lambda p: p["criteria"][0].update(primaryScore="no_such_score"))
        self.expect("plan_invalid", mutate_plan=lambda p: p["criteria"].append({"id": "asr", "kind": "genai_attack_success", "band": {"lower": 0.1}}))

    def test_declared_run_key(self):
        inputs, manifest, plan = gs.bundle(self.name, criteria=CRITERIA[self.name])
        manifest["inputs"][0]["runKey"] = "ragas:client-run-7"
        comp = gs.computation(run_bundle(inputs, manifest, plan))
        self.assertEqual(comp["runs"][0]["runKey"], "ragas:client-run-7")

    def test_snapshot_declaration_rules(self):
        from engine.genai.ingest import _snapshot_consistent
        self.assertTrue(_snapshot_consistent("openai/gpt-4o", "gpt-4o-2024-08-06"))
        self.assertTrue(_snapshot_consistent("mockllm/model", "model-2026-11-05"))
        self.assertFalse(_snapshot_consistent("openai/gpt-4o", "gpt-4o-mini-2024-07-18"))
        self.assertTrue(_snapshot_consistent("org/model", "0123abc"))
        self.assertTrue(_snapshot_consistent("org/model", "sha256:" + "a" * 64))

    def test_family_conflict_warning(self):
        inputs, manifest, plan = gs.bundle("promptfoo/echo_repeat.results.json", criteria=CRITERIA["promptfoo/echo_repeat.results.json"],
                                           declared={"systemUnderTest": {"model": "echo", "family": "openai"}})
        comp = gs.computation(run_bundle(inputs, manifest, plan))
        self.assertNotIn("family_declaration_conflict", {w["code"] for w in comp["warnings"]})
        inputs, manifest, plan = gs.bundle("garak/tiny.report.jsonl", criteria=CRITERIA["garak/tiny.report.jsonl"],
                                           declared={"judges": [{"ref": "J1", "model": "meta/llama3-70b-instruct", "family": "meta"}]})
        comp = gs.computation(run_bundle(inputs, manifest, plan))
        self.assertIn("declared_judge_not_observed", {w["code"] for w in comp["warnings"]})


class CliTest(unittest.TestCase):
    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_ingest_verify_kappa_detect(self):
        name = "pyrit/attacks.pyrit-export.jsonl"
        inputs, manifest, plan = gs.bundle(name, criteria=CRITERIA[name])
        source = str(gs.FIXTURES / "pyrit" / "attacks.pyrit-export.jsonl")
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (tmp / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
            code, out, err = self.run_cli("ingest", "--manifest", str(tmp / "manifest.json"), "--plan", str(tmp / "plan.json"), "--input", source,
                                          "--output", str(tmp / "result.json"), "--items-output", str(tmp / "items.jsonl"))
            self.assertEqual(code, 0, err)
            summary = json.loads(out)
            env = json.loads((tmp / "result.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["computationSha256"], env["computationSha256"])
            self.assertEqual(hashlib.sha256((tmp / "items.jsonl").read_bytes()).hexdigest(), env["itemsSha256"])
            # Outputs are created once.
            code, _, err = self.run_cli("ingest", "--manifest", str(tmp / "manifest.json"), "--plan", str(tmp / "plan.json"), "--input", source, "--output", str(tmp / "result.json"))
            self.assertEqual((code, json.loads(err)), (2, {"error": "output_exists"}))
            code, out, _ = self.run_cli("verify", "--envelope", str(tmp / "result.json"), "--manifest", str(tmp / "manifest.json"), "--plan", str(tmp / "plan.json"), "--input", source)
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(out)["verified"])
            env["computationJSON"] = env["computationJSON"].replace("PromptSendingAttack", "PromptSendingAttacK", 1)
            (tmp / "tampered.json").write_text(json.dumps(env), encoding="utf-8")
            code, out, _ = self.run_cli("verify", "--envelope", str(tmp / "tampered.json"), "--manifest", str(tmp / "manifest.json"), "--plan", str(tmp / "plan.json"), "--input", source)
            self.assertEqual(code, 3)
            bad_plan = dict(plan, minimums={"sampleSize": 5})
            (tmp / "bad.json").write_text(json.dumps(bad_plan), encoding="utf-8")
            code, _, err = self.run_cli("ingest", "--manifest", str(tmp / "manifest.json"), "--plan", str(tmp / "bad.json"), "--input", source, "--output", str(tmp / "none.json"))
            self.assertEqual((code, json.loads(err)), (2, {"error": "plan_invalid"}))
            self.assertFalse((tmp / "none.json").exists())
        code, out, _ = self.run_cli("kappa", "--labels", str(gs.FIXTURES / "judge_validation" / "judge_small_60.jsonl"))
        self.assertEqual(code, 0)
        self.assertAlmostEqual(json.loads(out)["kappa"], 0.673913, places=6)
        code, out, _ = self.run_cli("detect", "--input", source, "--input", str(gs.FIXTURES / "README.md"))
        rows = json.loads(out)["inputs"]
        self.assertEqual([r["format"] for r in rows], ["pyrit_export", None])


MARKING_ROWS = [
    {"checkId": f"img-{i}", "modality": "image", "format": "png", "channel": "api", "stratum": {"model": "gen-a"}, "transformation": None,
     "metadata": {"standard": "c2pa", "present": True, "validationStatus": ["claimSignature.validated"] if i % 5 else ["claimSignature.mismatch"], "signer": "Example signer", "signatureVerified": True},
     "watermark": {"detectorId": "wm-detector", "detectorVersion": "2.1", "score": 0.9, "threshold": 0.5, "decision": "marked" if i % 4 else "not_marked"},
     "groundTruth": "marked", "selfIdentification": None}
    for i in range(40)
] + [
    {"checkId": f"human-{i}", "modality": "image", "format": "jpeg", "channel": "upload", "stratum": {"model": "none"}, "transformation": None, "metadata": None,
     "watermark": {"detectorId": "wm-detector", "detectorVersion": "2.1", "score": 0.1, "threshold": 0.5, "decision": "marked" if i == 0 else "not_marked"},
     "groundTruth": "human_made", "selfIdentification": None}
    for i in range(40)
] + [
    {"checkId": f"crop-{i}", "modality": "image", "format": "png", "channel": "api", "stratum": {"model": "gen-a"}, "transformation": {"id": "crop", "parameters": {"fraction": 0.5}},
     "metadata": None, "watermark": {"detectorId": "wm-detector", "detectorVersion": "2.1", "score": 0.6, "threshold": 0.5, "decision": "marked" if i % 3 else "not_marked"},
     "groundTruth": "marked", "selfIdentification": None}
    for i in range(30)
] + [
    {"checkId": f"chat-{i}", "modality": "text", "format": "text", "channel": "chat", "stratum": {}, "transformation": None, "metadata": None, "watermark": None,
     "groundTruth": "other_ai", "selfIdentification": i != 7}
    for i in range(30)
]


class MarkingCheckTest(unittest.TestCase):
    def bundle(self, rows=None):
        data = "".join(json.dumps({"schemaVersion": "genai-marking-check/0.1", "outputSha256": hashlib.sha256(r["checkId"].encode()).hexdigest(), **r}) + "\n" for r in (rows or MARKING_ROWS)).encode()
        spec = {"name": "marking.jsonl", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": "marking_check_jsonl", "role": "marking"}
        criteria = [
            {"id": "presence", "kind": "genai_marking", "metric": "marking_presence", "band": {"lower": 0.7}},
            {"id": "detection", "kind": "genai_marking", "metric": "detection_rate", "band": {"lower": 0.6}},
            {"id": "fpr", "kind": "genai_marking", "metric": "false_positive_rate", "band": {"upper": 0.2}},
            {"id": "crop", "kind": "genai_marking", "metric": "detection_rate_after_transformation", "transformation": "crop", "band": {"lower": 0.4}},
            {"id": "self-id", "kind": "genai_marking", "metric": "self_identification_rate", "band": {"lower": 0.7}},
            {"id": "detection-gen-a", "kind": "genai_marking", "metric": "detection_rate", "stratum": "model=gen-a", "band": {"lower": 0.5}, "role": "exploratory"},
        ]
        manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditor_rerun", "inputs": [spec]}
        return {spec["sha256"]: data}, manifest, {"schemaVersion": "genai-plan/0.1", "criteria": criteria}

    def test_marking_criteria(self):
        env = run_bundle(*self.bundle())
        _, result, computation, _ = gs.schema_validators()
        result.validate(env)
        comp = gs.computation(env)
        computation.validate(comp)
        by_id = {c["id"]: c for c in comp["criteria"]}
        presence = by_id["presence"]["members"][0]
        self.assertEqual(presence["counts"]["n"], 100)
        detection = by_id["detection"]["members"][0]
        self.assertEqual((detection["counts"]["x"], detection["counts"]["n"]), (30, 40))
        self.assertEqual(by_id["fpr"]["members"][0]["counts"]["x"], 1)
        self.assertEqual((by_id["crop"]["members"][0]["counts"]["x"], by_id["crop"]["members"][0]["counts"]["n"]), (20, 30))
        self.assertEqual((by_id["self-id"]["members"][0]["counts"]["x"], by_id["self-id"]["members"][0]["counts"]["n"]), (29, 30))
        self.assertEqual(by_id["self-id"]["outcome"], "pass")
        self.assertEqual(comp["marking"][0]["count"], len(MARKING_ROWS))
        self.assertIn("marking_signature_unverified", {w["code"] for w in comp["warnings"]})
        self.assertFalse(any(r["metadata"] and r["metadata"]["signatureVerifiedByEngine"] for r in comp["marking"][0]["records"]))

    def test_malformed_marking_rows(self):
        for bad in ({"groundTruth": "maybe"}, {"modality": "smell"}, {"checkId": "bad id"}, {"unknown": 1}, {"watermark": {"detectorId": "x", "decision": "yes"}}):
            row = dict(MARKING_ROWS[0], **bad)
            with self.subTest(bad=bad):
                with self.assertRaises(GenaiInputError):
                    run_bundle(*self.bundle([row]))


if __name__ == "__main__":
    import sys
    if "--write-example" in sys.argv:
        target = gs.SCHEMAS / "fixtures" / "genai-result.example.json"
        target.write_text(json.dumps(example_envelope(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {target}")
    else:
        unittest.main()
