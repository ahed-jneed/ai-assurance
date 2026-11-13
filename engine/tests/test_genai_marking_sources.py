"""C2PA validator reports, signed detection results and inert excerpts (#128; research edit A50-ED-33, design Q12).

Fixtures: engine/tests/fixtures/genai/marking (generate/make_marking_sources.py). The signed results
are signed with a TEST-ONLY key whose seed is public; tests that forge or tamper sign with it too.
"""
from __future__ import annotations

import base64
import builtins
import hashlib
import json
import os
import random
import sys
import unittest
from unittest.mock import patch

from engine.genai import ingest
from engine.genai.errors import ERROR_CODES, GenaiInputError
from engine.genai.formats import signed_detection
from engine.genai.ingest import run_bundle
from engine.tests import genai_support as gs
from engine.tests.test_genai_fuzz import mutate_bytes, mutate_jsonl

MARKING = gs.FIXTURES / "marking"
KEY = json.loads((MARKING / "detection-key.json").read_text(encoding="utf-8"))
REQUIRE_CRYPTO = os.environ.get("ENGINE_REQUIRE_CRYPTOGRAPHY") == "1"


def has_cryptography():
    try:
        import cryptography  # noqa: F401
    except ImportError:
        return False
    return True


requires_crypto = unittest.skipUnless(has_cryptography() or REQUIRE_CRYPTO, "cryptography is not installed")


def test_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    return Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"ai-assurance genai test detection key, never trusted outside tests").digest())


def bundle(entries, criteria=(), **plan_extra):
    """(inputs, manifest, plan) for (name, bytes, format) entries; all marking inputs take role `marking`."""
    specs = [{"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": fmt, "role": "marking" if fmt in ("c2pa_validator_report", "signed_detection_jsonl", "marking_check_jsonl") else "log"}
             for name, data, fmt in entries]
    manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditor_rerun", "inputs": specs}
    plan = {"schemaVersion": "genai-plan/0.1", "criteria": list(criteria), **plan_extra}
    return {s["sha256"]: d for s, (_, d, _) in zip(specs, entries)}, manifest, plan


def c2pa_data():
    return (MARKING / "c2pa_reports.jsonl").read_bytes()


def signed_data():
    return (MARKING / "signed_detections.jsonl").read_bytes()


def rows(data):
    return [json.loads(line) for line in data.decode("utf-8").splitlines() if line.strip()]


def jsonl(values):
    return "".join(json.dumps(v, separators=(",", ":")) + "\n" for v in values).encode()


def resign(row, payload, key=None, keyid=None):
    """A copy of a signed row whose envelope carries `payload` (a dict), signed with the test key."""
    raw = json.dumps(payload, separators=(",", ":")).encode()
    sig = (key or test_key()).sign(signed_detection.pae(signed_detection.PAYLOAD_TYPE, raw))
    out = dict(row)
    out["envelope"] = {"payloadType": signed_detection.PAYLOAD_TYPE, "payload": base64.b64encode(raw).decode(),
                       "signatures": [{"keyid": keyid or KEY["keyId"], "sig": base64.b64encode(sig).decode()}]}
    return out


def payload_of(row):
    return json.loads(base64.b64decode(row["envelope"]["payload"]))


C2PA_CRITERIA = [
    {"id": "presence", "kind": "genai_marking", "metric": "marking_presence", "band": {"lower": 0.5}},
    {"id": "presence-trusted", "kind": "genai_marking", "metric": "marking_presence", "requireTrustedSigner": True, "band": {"lower": 0.5}},
]
DETECTION_CRITERIA = [
    {"id": "detection", "kind": "genai_marking", "metric": "detection_rate", "band": {"lower": 0.7}},
    {"id": "fpr", "kind": "genai_marking", "metric": "false_positive_rate", "band": {"upper": 0.2}},
    {"id": "crop", "kind": "genai_marking", "metric": "detection_rate_after_transformation", "transformation": "crop", "band": {"lower": 0.4}},
]


class C2paReportTest(unittest.TestCase):
    def run_c2pa(self, data=None, criteria=C2PA_CRITERIA):
        return run_bundle(*bundle([("c2pa_reports.jsonl", data or c2pa_data(), "c2pa_validator_report")], criteria))

    def test_reports_become_marking_records_and_criteria(self):
        env = self.run_c2pa()
        _, result, computation, _ = gs.schema_validators()
        result.validate(env)
        comp = gs.computation(env)
        computation.validate(comp)
        block = comp["marking"][0]
        self.assertEqual((block["format"], block["count"], block["evidenceLevel"]), ("c2pa_validator_report", 80, "L2"))
        by_id = {c["id"]: c["members"][0]["counts"] for c in comp["criteria"]}
        # 50 marked outputs (40 with a manifest, 10 stripped by re-encoding); 3 report a failure and 2 lack an AI assertion.
        self.assertEqual((by_id["presence"]["x"], by_id["presence"]["n"]), (35, 50))
        # Trusted only: 3 more (img-9, img-19, img-39) were signed by a credential the validator did not trust (Valid, not Trusted).
        self.assertEqual(by_id["presence-trusted"]["x"], 32)
        records = {r["checkId"]: r for r in block["records"]}
        self.assertEqual(records["img-3"]["c2pa"]["failureCodes"], ["assertion.dataHash.mismatch"])
        self.assertEqual(records["img-3"]["c2pa"]["validationState"], "Invalid")
        self.assertFalse(records["img-11"]["c2pa"]["aiAssertion"])
        self.assertEqual(records["img-0"]["c2pa"]["digitalSourceTypes"], ["trainedAlgorithmicMedia"])
        self.assertEqual(records["img-0"]["metadata"]["signer"], "Example Provider Signing CA")
        self.assertFalse(records["stripped-0"]["metadata"]["present"])
        self.assertFalse(any(r["metadata"]["signatureVerifiedByEngine"] for r in block["records"]))
        self.assertIn("marking_signature_unverified", {w["code"] for w in comp["warnings"]})

    def test_legacy_validation_status_reports(self):
        data = rows(c2pa_data())
        for row in data[:5]:
            report = row["report"]
            del report["validation_results"], report["validation_state"]
            report["validation_status"] = [{"code": "claimSignature.mismatch"}] if row["checkId"] == "img-0" else []
        env = self.run_c2pa(jsonl(data))
        records = {r["checkId"]: r for r in gs.computation(env)["marking"][0]["records"]}
        self.assertEqual((records["img-0"]["c2pa"]["validationState"], records["img-0"]["c2pa"]["failureCodes"]), ("Invalid", ["claimSignature.mismatch"]))
        self.assertEqual(records["img-1"]["c2pa"]["validationState"], None)

    def test_hostile_report_content_stays_inert_data(self):
        data = rows(c2pa_data())
        manifest = next(iter(data[0]["report"]["manifests"].values()))
        manifest["claim_generator"] = "<script>alert(1)</script>‮\x1b[31m sk-" + "a" * 30
        manifest["assertions"].append({"label": "c2pa.actions", "data": {"actions": [{"digitalSourceType": "javascript:import('os').system('x')"}]}})
        data[0]["report"]["thumbnail"] = {"format": "image/png", "data": "A" * 100_000}
        data[0]["report"]["validation_results"]["activeManifest"]["failure"] = [{"code": "bad code with spaces"}, "not an object", {"code": 7}]
        env = self.run_c2pa(jsonl(data))
        record = gs.computation(env)["marking"][0]["records"][0]
        self.assertTrue(record["c2pa"]["claimGenerator"].startswith("<script>"))  # a string, never rendered here
        self.assertEqual(record["c2pa"]["failureCodes"], [])
        self.assertEqual(record["c2pa"]["digitalSourceTypes"], ["trainedAlgorithmicMedia"])  # the javascript: string is not a term
        self.assertNotIn("thumbnail", json.dumps(record))

    def test_malformed_lines_are_rejected_with_codes(self):
        base = rows(c2pa_data())
        for bad in ({"report": "not an object"}, {"report": {"validation_state": "Maybe"}}, {"validator": {"name": ""}}, {"validator": None},
                    {"extra": 1}, {"checkId": "bad id"}, {"groundTruth": "unknown"}):
            row = dict(base[0], **bad)
            with self.subTest(bad=bad), self.assertRaises(GenaiInputError) as caught:
                self.run_c2pa(jsonl([row] + base[1:]))
            self.assertEqual(caught.exception.code, "invalid_json")
        without_report = dict(base[0])
        del without_report["report"]
        with self.assertRaises(GenaiInputError):
            self.run_c2pa(jsonl([without_report] + base[1:]))

    def test_trusted_signer_option_is_plan_validated(self):
        for bad in ({"requireTrustedSigner": False}, {"metric": "detection_rate", "requireTrustedSigner": True}):
            criterion = dict(C2PA_CRITERIA[1], **bad)
            with self.subTest(bad=bad), self.assertRaises(GenaiInputError) as caught:
                self.run_c2pa(criteria=[criterion])
            self.assertEqual(caught.exception.code, "plan_invalid")


@requires_crypto
class SignedDetectionTest(unittest.TestCase):
    def run_signed(self, data=None, keys=None, criteria=DETECTION_CRITERIA):
        return run_bundle(*bundle([("signed_detections.jsonl", data or signed_data(), "signed_detection_jsonl")], criteria,
                                  detectionKeys=[KEY] if keys is None else keys))

    def expect(self, code, data=None, keys=None):
        with self.assertRaises(GenaiInputError) as caught:
            self.run_signed(data, keys)
        self.assertEqual(caught.exception.code, code)

    def test_verified_results_become_marking_records(self):
        env = self.run_signed()
        _, result, computation, _ = gs.schema_validators()
        result.validate(env)
        comp = gs.computation(env)
        computation.validate(comp)
        block = comp["marking"][0]
        self.assertEqual((block["format"], block["count"]), ("signed_detection_jsonl", 100))
        self.assertTrue(all(r["signedResult"]["verifiedByEngine"] and r["signedResult"]["keyId"] == KEY["keyId"] for r in block["records"]))
        by_id = {c["id"]: c["members"][0]["counts"] for c in comp["criteria"]}
        self.assertEqual((by_id["detection"]["x"], by_id["detection"]["n"]), (35, 40))
        self.assertEqual((by_id["fpr"]["x"], by_id["fpr"]["n"]), (1, 29))  # one inconclusive control is excluded
        self.assertEqual((by_id["crop"]["x"], by_id["crop"]["n"]), (20, 30))
        self.assertNotIn("marking_signature_unverified", {w["code"] for w in comp["warnings"]})
        first = block["records"][0]
        self.assertEqual(first["watermark"]["detectorId"], "example-detector")
        self.assertEqual(first["signedResult"]["payloadSha256"], hashlib.sha256(base64.b64decode(rows(signed_data())[0]["envelope"]["payload"])).hexdigest())

    def test_deterministic(self):
        self.assertEqual(self.run_signed()["computationJSON"], self.run_signed()["computationJSON"])

    def test_tampered_payload_fails_the_signature(self):
        data = rows(signed_data())
        payload = payload_of(data[0])
        payload["decision"] = "marked" if payload["decision"] != "marked" else "not_marked"
        data[0]["envelope"]["payload"] = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
        self.expect("signature_invalid", jsonl(data))

    def test_forged_signature_bytes(self):
        data = rows(signed_data())
        data[0]["envelope"]["signatures"][0]["sig"] = base64.b64encode(b"\0" * 64).decode()
        self.expect("signature_invalid", jsonl(data))
        data[0]["envelope"]["signatures"][0]["sig"] = base64.b64encode(b"\0" * 10).decode()
        self.expect("signature_invalid", jsonl(data))

    def test_untrusted_keys(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        data = rows(signed_data())
        # A valid signature by a key the plan does not pin.
        forged = resign(data[0], payload_of(data[0]), key=Ed25519PrivateKey.generate(), keyid="attacker-key")
        self.expect("signature_untrusted", jsonl([forged] + data[1:]))
        # The pinned key, claiming another solution's results.
        other = dict(payload_of(data[0]), solutionId="another-detector")
        self.expect("signature_untrusted", jsonl([resign(data[0], other)] + data[1:]))
        # No pinned keys at all.
        self.expect("signature_untrusted", keys=[])
        # The right key id with another key's bytes pinned: the signature no longer verifies.
        wrong = dict(KEY, publicKeySPKI=base64.b64encode(bytes.fromhex("302a300506032b6570032100") + b"\1" * 32).decode())
        self.expect("signature_invalid", keys=[wrong])

    def test_result_for_other_content(self):
        data = rows(signed_data())
        data[0]["outputSha256"] = hashlib.sha256(b"something else").hexdigest()
        self.expect("detection_content_mismatch", jsonl(data))

    def test_malformed_envelopes(self):
        base = rows(signed_data())
        cases = [
            {"payloadType": "text/plain"},
            {"payload": "not base64!"},
            {"payload": base64.b64encode(b"x" * (70 * 1024)).decode()},
            {"signatures": []},
            {"signatures": [{"keyid": KEY["keyId"]}]},
            {"signatures": [{"keyid": KEY["keyId"], "sig": "AAAA"}] * 9},
            {"extra": True},
        ]
        for change in cases:
            row = dict(base[0])
            row["envelope"] = dict(row["envelope"], **change)
            with self.subTest(change=sorted(change)), self.assertRaises(GenaiInputError) as caught:
                self.run_signed(jsonl([row] + base[1:]))
            self.assertIn(caught.exception.code, {"invalid_json", "signature_invalid"})
        for payload_change in ({"timestamp": "2026-11-10T10:00:00"}, {"basis": "magic"}, {"decision": "yes"}, {"score": "high"}, {"schemaVersion": "x"}, {"unknown": 1}):
            row = resign(base[0], dict(payload_of(base[0]), **payload_change))
            with self.subTest(payload=sorted(payload_change)), self.assertRaises(GenaiInputError) as caught:
                self.run_signed(jsonl([row] + base[1:]))
            self.assertEqual(caught.exception.code, "invalid_json")
        # A payload that is not JSON at all is rejected by the strict reader after the envelope checks.
        raw = b'{"a":1,"a":2}'
        row = dict(base[0])
        row["envelope"] = {"payloadType": signed_detection.PAYLOAD_TYPE, "payload": base64.b64encode(raw).decode(), "signatures": base[0]["envelope"]["signatures"]}
        self.expect("duplicate_key", jsonl([row] + base[1:]))

    def test_plan_keys_are_validated_before_any_result(self):
        for bad in ([dict(KEY, algorithm="RSA")], [dict(KEY, publicKeySPKI="AAAA")], [KEY, KEY], [dict(KEY, keyId="bad key")], [dict(KEY, extra=1)], "key"):
            with self.subTest(bad=bad):
                self.expect("plan_invalid", keys=bad)

    def test_without_cryptography_the_input_fails_with_its_code(self):
        real_import = builtins.__import__

        def blocked(name, *args, **kwargs):
            if name.startswith("cryptography"):
                raise ImportError(name)
            return real_import(name, *args, **kwargs)
        with patch("builtins.__import__", blocked):
            self.expect("signature_backend_unavailable")


class ExcerptTest(unittest.TestCase):
    name = "promptfoo/redteam_shaped.results.json"

    def items(self, mode, name=None):
        name = name or self.name
        inputs, manifest, plan = gs.bundle(name, plan_extra={"excerpts": mode})
        env = run_bundle(inputs, manifest, plan)
        return env, [json.loads(line) for line in env["itemsJSONL"].splitlines()]

    def test_off_by_default(self):
        inputs, manifest, plan = gs.bundle(self.name)
        env = run_bundle(inputs, manifest, plan)
        self.assertNotIn('"excerpt"', env["itemsJSONL"])
        self.assertEqual(gs.computation(env)["plan"]["normalized"]["excerpts"], "none")

    def test_all_and_failures(self):
        item_schema = gs.schema_validators()[0]
        _, every = self.items("all")
        self.assertTrue(every and all("excerpt" in i for i in every))
        for item in every:
            item_schema.validate(item)
            self.assertLessEqual(len(item["excerpt"]["prompt"] or ""), 1000)
        _, failures = self.items("failures")
        selected = [i for i in failures if "excerpt" in i]
        self.assertTrue(selected)
        self.assertLess(len(selected), len(failures))
        for item in failures:
            succeeded_attack = item["status"] == "scored" and item["itemType"] == "attack" and item["outcome"]["value"] > 0
            failed = item["status"] == "scored" and item["itemType"] != "attack" and item["outcome"]["value"] < 1
            self.assertEqual("excerpt" in item, succeeded_attack or failed, item["itemKey"])

    def test_excerpts_change_items_but_not_their_hashes_of_text(self):
        off_env = run_bundle(*gs.bundle(self.name))
        on_env, items = self.items("all")
        off = [json.loads(line) for line in off_env["itemsJSONL"].splitlines()]
        self.assertEqual([i["promptSha256"] for i in off], [i["promptSha256"] for i in items])
        self.assertNotEqual(off_env["computationSha256"], on_env["computationSha256"])  # the plan choice is bound

    def test_every_format_keeps_inert_text(self):
        for name in gs.BUNDLES:
            if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            with self.subTest(bundle=name):
                _, items = self.items("all", name)
                for item in items:
                    self.assertIn("excerpt", item)
                    self.assertEqual(set(item["excerpt"]), {"prompt", "response", "truncated"})

    def test_long_secret_and_control_text(self):
        from engine.genai.formats import common
        warnings = __import__("engine.genai.errors", fromlist=["Warnings"]).Warnings()
        text, cut = common.excerpt_text("x" * 995 + "sk-" + "b" * 40 + "\x1b[2J‮" + "y" * 2000, warnings, "loc")
        self.assertTrue(cut)
        self.assertEqual(len(text), 1000)
        self.assertNotIn("sk-bbbb", text)
        self.assertIn("secret_like_value_redacted", warnings)
        chat, _ = common.excerpt_text([{"role": "system", "content": "be nice"}, {"role": "user", "content": [{"type": "text", "text": "hi"}]}])
        self.assertTrue(chat.startswith("system: be nice\nuser: "))
        self.assertEqual(common.excerpt_text("\ud800 lone"), ("� lone", False))


class MarkingSourceFuzzTest(unittest.TestCase):
    """The design section 11.5 oracles on the new formats: only coded GenaiInputErrors escape, outputs validate."""
    iterations = int(os.environ.get("GENAI_FUZZ_ITERATIONS", "300")) // 3 or 1

    @classmethod
    def setUpClass(cls):
        cls.validator = gs.schema_validators()[1]
        ingest.STRICT = True

    @classmethod
    def tearDownClass(cls):
        ingest.STRICT = False

    def fuzz(self, name, data, fmt):
        rng = random.Random(f"{os.environ.get('GENAI_FUZZ_SEED', '31')}:{name}")
        validated = 0
        for _ in range(self.iterations):
            mutated = mutate_bytes(rng, data) if rng.random() < 0.5 else mutate_jsonl(rng, data)
            try:
                env = run_bundle(*bundle([(name, mutated, fmt)], detectionKeys=[KEY], excerpts="all"))
            except GenaiInputError as exc:
                self.assertIn(exc.code, ERROR_CODES)
                continue
            if validated < 5:
                self.validator.validate(env)
                validated += 1

    def test_c2pa_reports(self):
        self.fuzz("c2pa_reports.jsonl", c2pa_data(), "c2pa_validator_report")

    @requires_crypto
    def test_signed_detections(self):
        self.fuzz("signed_detections.jsonl", signed_data(), "signed_detection_jsonl")

    def test_format_confusion(self):
        for name, data, fmt in (("c2pa_reports.jsonl", c2pa_data(), "signed_detection_jsonl"), ("signed_detections.jsonl", signed_data(), "c2pa_validator_report"),
                                ("signed_detections.jsonl", signed_data(), "marking_check_jsonl")):
            with self.subTest(fmt=fmt), self.assertRaises(GenaiInputError) as caught:
                run_bundle(*bundle([(name, data, fmt)], detectionKeys=[KEY]))
            self.assertEqual(caught.exception.code, "format_mismatch")


if __name__ == "__main__":
    unittest.main()
