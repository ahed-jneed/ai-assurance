import base64
import copy
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from engine.assurance import (
    _bootstrap_protocol, bootstrap_interval, build_dossier, canonical_bytes, collect_jsonl,
    compare_replay, intersectional_slices, main, power, quality_checks, read_json,
    sample_records, sign_dossier, verify_dossier,
)
from engine.tests.test_statistics_golden import GOLDEN

from engine.tests.signature_support import Ed25519PrivateKey, requires_cryptography, serialization


def population(count=80):
    return [{"id": f"record-{i:04}", "split": "training" if i < count // 2 else "test", "entity": f"entity-{i}", "region": "A" if i < count // 2 else "B", "band": "young" if i % 4 < 2 else "older", "actual": str(i % 2), "predicted": str(i % 2), "cluster": f"person-{i // 2}", "at": "2025-01-01T00:00:00Z" if i < count // 2 else "2025-02-01T00:00:00Z"} for i in range(count)]


def event(identifier="event-1", sequence=1):
    return {"eventId": identifier, "timestamp": "2025-01-01T00:00:00Z", "streamId": "deployment-A", "sequence": sequence, "modelVersion": "model-v3", "pipelineVersion": "pipeline-v2", "thresholdVersion": "policy-v1", "finalDecision": 0.75, "override": {"applied": False}}


def dossier():
    return build_dossier({"report.json": b'{"reportId":"R-1","scope":"synthetic"}', "evidence/observations.csv": b"id,value\n1,2\n"}, report_id="R-1", report_path="report.json", created_at="2025-01-01T00:00:00Z", custody=[{"id": "C-1", "action": "collected", "actor": "fixture-auditor", "at": "2025-01-01T00:00:00Z", "path": "evidence/observations.csv"}], withheld=[{"id": "private-interview", "reason": "Outside this audience's release scope"}])


def dossier_v1_1(key_id="KEY-fixture", rule_pack=None, methodology="2026.11.1"):
    """The web app's manifest 1.1: the key ID and captured versions are signed."""
    container = dossier()
    container["manifest"].update(schemaVersion="1.1", signingKeyId=key_id, rulePack={"version": "2026.11.1", "legalVersion": "02024R1689-20260727", "researchedAsOf": "2026-11-05", "legalReview": "pending"} if rule_pack is None else rule_pack, methodologyVersion=methodology)
    return rehash(container)


def rehash(container):
    container["manifestSha256"] = hashlib.sha256(canonical_bytes(container["manifest"], integer_only=True)).hexdigest()
    return container


def temporary_directory():
    # Keep disposable test keys/files inside the known writable workspace.
    # Validate the generated absolute target before TemporaryDirectory cleanup.
    workspace = Path(__file__).resolve().parents[2]
    directory = tempfile.TemporaryDirectory(dir=workspace, prefix=".assurance-test-")
    Path(directory.name).resolve().relative_to(workspace)
    return directory


class SamplingTests(unittest.TestCase):
    def test_keyed_sample_is_order_independent_and_reproducible(self):
        first = sample_records(population(), count=12, seed=42)
        second = sample_records(list(reversed(population())), count=12, seed=42)
        self.assertEqual(first, second)
        self.assertEqual(first["type"], "sampling")
        self.assertEqual(first["selectedCount"], 12)
        self.assertEqual(len(set(first["selectedIds"])), 12)
        self.assertNotEqual(first["selectedIds"], sample_records(population(), count=12, seed=43)["selectedIds"])
        self.assertEqual(first["selection"][0]["inclusionProbability"], {"numerator": 12, "denominator": 80})

    def test_exclusions_and_population_digest_are_preserved(self):
        result = sample_records(population(10), count=3, exclusions={"record-0000": "Outside agreed audit period"})
        self.assertNotIn("record-0000", result["selectedIds"])
        self.assertEqual(result["population"]["eligibleCount"], 9)
        self.assertEqual(result["population"]["excludedCount"], 1)
        changed = population(10)
        changed[0]["predicted"] = "different"
        self.assertNotEqual(result["population"]["sha256"], sample_records(changed, count=3, exclusions={"record-0000": "Outside agreed audit period"})["population"]["sha256"])

    def test_stratified_allocations_and_probabilities(self):
        result = sample_records(population(10), count=3, seed=3, strata=["region"], allocations={'["A"]': 2, '["B"]': 1})
        self.assertEqual([g["selectedCount"] for g in result["stratumCounts"]], [2, 1])
        for item in result["selection"]:
            self.assertEqual(item["inclusionProbability"], {"numerator": 2 if item["stratum"] == '["A"]' else 1, "denominator": 5})
        proportional = sample_records(population(10), count=4, strata=["region"])
        self.assertEqual([g["selectedCount"] for g in proportional["stratumCounts"]], [2, 2])

    def test_duplicate_ids_unknown_exclusion_and_bad_allocations_rejected(self):
        rows = population(10)
        for changed in [rows + [rows[0]], [{**rows[0], "id": ""}]]:
            with self.assertRaises(ValueError):
                sample_records(changed, count=1)
        with self.assertRaises(ValueError):
            sample_records(rows, count=2, exclusions={"unlisted": "Unknown"})
        with self.assertRaises(ValueError):
            sample_records(rows, count=11)
        with self.assertRaises(ValueError):
            sample_records(rows, count=3, strata=["region"], allocations={'["A"]': 3})
        with self.assertRaises(ValueError):
            sample_records(rows, count=2, seed=True)

    def test_zero_allocated_stratum_is_explicit(self):
        result = sample_records(population(10), count=1, strata=["region"])
        self.assertEqual(sum(g["selectedCount"] == 0 for g in result["stratumCounts"]), 1)
        self.assertIn("zero inclusion probability", " ".join(result["limitations"]))


class QualityTests(unittest.TestCase):
    def test_clean_split_and_temporal_cutoff(self):
        result = quality_checks(population(10), entity_field="entity", timestamp_field="at", temporal_cutoff="2025-01-15T00:00:00Z")
        self.assertEqual(result["outcome"], "pass")
        self.assertEqual(result["entityLeakage"], [])

    def test_cross_split_record_entity_and_temporal_leakage(self):
        rows = population(10)
        rows[-1]["entity"] = rows[0]["entity"]
        rows[-2]["id"] = rows[0]["id"]
        rows[0]["at"] = "2025-02-01T00:00:00Z"
        result = quality_checks(rows, entity_field="entity", timestamp_field="at", temporal_cutoff="2025-01-15T00:00:00Z")
        self.assertEqual(result["outcome"], "fail")
        self.assertEqual(len(result["entityLeakage"]), 1)
        self.assertEqual(len(result["recordLeakage"]), 1)
        self.assertEqual(result["temporalViolations"]["count"], 1)

    def test_missing_fields_invalid_time_and_empty_population(self):
        rows = population(10)
        del rows[0]["entity"]
        rows[1]["at"] = "2025-01-01"
        result = quality_checks(rows, entity_field="entity", timestamp_field="at", temporal_cutoff="2025-01-15T00:00:00Z")
        self.assertEqual(result["outcome"], "fail")
        self.assertEqual(result["missingFields"][0]["field"], "entity")
        self.assertEqual(result["invalidFields"]["count"], 1)
        self.assertEqual(quality_checks([])["outcome"], "inconclusive")
        with self.assertRaises(ValueError):
            quality_checks(rows, temporal_cutoff="2025-01-15T00:00:00Z")

    def test_explicit_content_fingerprints_find_changed_ids_across_splits(self):
        rows = population(10)
        rows[0]["feature"] = "same-source-record"
        rows[5]["feature"] = "same-source-record"
        for position in range(1, 5):
            rows[position]["feature"] = f"feature-{position}"
        for position in range(6, 10):
            rows[position]["feature"] = f"feature-{position}"
        result = quality_checks(rows, content_fields=["feature"])
        self.assertEqual(result["outcome"], "fail")
        self.assertEqual(len(result["contentLeakage"]), 1)
        self.assertEqual(quality_checks(rows[:5])["outcome"], "inconclusive")


class StatisticalTests(unittest.TestCase):
    def test_iid_seed_and_constant_interval(self):
        first = bootstrap_interval(list(range(40)), seed=19, replicates=100, min_support=10)
        self.assertEqual(first, bootstrap_interval(list(range(40)), seed=19, replicates=100, min_support=10))
        self.assertEqual(first["estimate"], 19.5)
        self.assertEqual(first["outcome"], "pass")
        self.assertLess(first["confidenceInterval"]["lower"], first["estimate"])
        self.assertGreater(first["confidenceInterval"]["upper"], first["estimate"])
        constant = bootstrap_interval([4] * 40, replicates=100)
        self.assertEqual(constant["confidenceInterval"]["lower"], 4)
        self.assertEqual(constant["confidenceInterval"]["upper"], 4)

    def test_cluster_bootstrap_and_low_support(self):
        result = bootstrap_interval([1, 1, 9, 9], clusters=["A", "A", "B", "B"], min_support=2, min_clusters=2, replicates=100)
        self.assertEqual(result["method"], "cluster")
        self.assertEqual(result["clusterCount"], 2)
        self.assertEqual(result["estimate"], 5)
        self.assertEqual(result["confidenceInterval"]["lower"], 1)
        self.assertEqual(result["confidenceInterval"]["upper"], 9)
        low = bootstrap_interval([1, 2], clusters=["A", "A"], min_support=2, min_clusters=2, replicates=100)
        self.assertEqual(low["outcome"], "inconclusive")
        self.assertIsNone(low["confidenceInterval"])

    def test_statistics_and_nonfinite_or_work_bounds(self):
        self.assertAlmostEqual(bootstrap_interval([-1, 2], statistic="mae", min_support=2, replicates=100)["estimate"], 1.5)
        self.assertAlmostEqual(bootstrap_interval([-1, 2], statistic="rmse", min_support=2, replicates=100)["estimate"], (2.5)**0.5)
        for values in [[float("nan")], [True], [float("inf")]]:
            with self.assertRaises(ValueError):
                bootstrap_interval(values)
        with self.assertRaises(ValueError):
            bootstrap_interval(list(range(5001)), replicates=1000)

    def test_intersectional_counts_and_bootstrap_order_invariance(self):
        first = intersectional_slices(population(), protected_fields=["region", "band"], min_support=5, min_class_count=1, replicates=100, seed=2)
        second = intersectional_slices(list(reversed(population())), protected_fields=["region", "band"], min_support=5, min_class_count=1, replicates=100, seed=2)
        self.assertEqual(first, second)
        self.assertEqual(len(first["slices"]), 4)
        self.assertEqual(first["outcome"], "pass")
        self.assertTrue(all(g["n"] == 20 for g in first["slices"]))
        self.assertTrue(all(m["value"] == 0 for m in first["metrics"] if m["name"] != "disparate_impact_ratio"))
        self.assertEqual(first["metrics"][1]["value"], 1)

    def test_intersectional_exclusions_and_small_groups_are_inconclusive(self):
        rows = population(8)
        del rows[0]["band"]
        result = intersectional_slices(rows, protected_fields=["region", "band"], min_support=5, replicates=100)
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertEqual(len(result["exclusions"]), 1)
        self.assertTrue(all(m["confidenceInterval"] is None for m in result["metrics"]))
        rows[1]["predicted"] = "unexpected"
        with self.assertRaises(ValueError):
            intersectional_slices(rows, protected_fields=["region"])

    def test_bootstrap_protocol_purposes_and_budgets(self):
        # Descriptive: 100-10000 replicates within rows x replicates <= 5,000,000 (section 5.11).
        _bootstrap_protocol(400, 1, 10000, 0.95, 30, 10)
        with self.assertRaises(ValueError):
            _bootstrap_protocol(600, 1, 10000, 0.95, 30, 10)
        # Decision: 1000-10000 replicates within clusters x replicates <= 50,000,000 draws.
        _bootstrap_protocol(25000, 1, 2000, 0.95, 30, 10, purpose="decision")
        for n, replicates in ((25001, 2000), (100, 999)):
            with self.assertRaises(ValueError):
                _bootstrap_protocol(n, 1, replicates, 0.95, 30, 10, purpose="decision")
        with self.assertRaises(ValueError):
            _bootstrap_protocol(10, 1, 1000, 0.95, 30, 10, purpose="other")

    def test_intersectional_strata_decided_like_golden_cases_22_and_23(self):
        for case_id in ("GC-22", "GC-23"):
            case = next(c for c in GOLDEN["cases"] if c["id"] == case_id)
            criterion = case["plan"]["criteria"][0]
            rows, index = [], 0
            for g in case["data"]["groups"]:
                sex, band = g["group"].split("/")
                for actual, predicted, count in (("1", "1", g["selected"]), ("0", "0", g["n"] - g["selected"])):
                    for _ in range(count):
                        rows.append({"id": f"r{index}", "actual": actual, "predicted": predicted, "sex": sex, "band": band})
                        index += 1
            result = intersectional_slices(rows, protected_fields=["sex", "band"], replicates=100, bands={criterion["metric"]: criterion["band"]}, minimum_coverage=criterion["minimumCoverage"])
            decided = result["statistics"]["criteria"][0]
            expected = case["expected"]["criteria"][0]
            self.assertEqual(decided["outcome"], expected["outcome"], case_id)
            self.assertAlmostEqual(decided["decision"]["pValue"], expected["decision"]["pValue"], delta=1e-9 + 1e-5 * expected["decision"]["pValue"])
            for key, value in expected["decision"]["coverage"].items():
                self.assertAlmostEqual(decided["decision"]["coverage"][key], value, delta=1e-9)
            self.assertEqual(set(decided["decision"]["reasons"]), set(expected["decision"]["reasons"]))
            self.assertEqual(decided["decision"]["role"], "exploratory")
            self.assertEqual(len(decided["decision"]["suppressedGroups"]), 2)
        self.assertIsNone(intersectional_slices(population(), protected_fields=["region"], min_support=5, min_class_count=1, replicates=100)["statistics"])
        with self.assertRaises(ValueError):
            intersectional_slices(population(), protected_fields=["region"], replicates=100, bands={"selection_rate_difference": {"lower": -0.1}})

    def test_power_for_a_case_and_for_a_plan(self):
        case = next(c for c in GOLDEN["cases"] if c["id"] == "GC-27")
        result = power(case["input"])["result"]
        self.assertAlmostEqual(result["passProbability"], case["expected"]["passProbability"], delta=1e-6)
        self.assertEqual(result["requiredGroupSizeForPass"], case["expected"]["requiredGroupSizeForPass"])
        plan = {"criteria": [dict(case["input"]["criterion"], id="four-fifths"), {"id": "accuracy-minimum", "kind": "performance", "members": [{"metric": "accuracy", "band": {"lower": 0.8}}]}]}
        report = power(plan)
        self.assertEqual([c["familySize"] for c in report["criteria"]], [2, 2])
        self.assertEqual(report["criteria"][1]["status"], "not_computed")
        self.assertTrue(report["acknowledgementRequired"])
        self.assertEqual(report["shortfalls"], ["four-fifths", "accuracy-minimum"])
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory)/"plan.json", Path(directory)/"power.json"
            source.write_text(json.dumps(plan), encoding="utf-8")
            self.assertEqual(main(["power", "--input", str(source), "--output", str(output)]), 0)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["planSha256"], report["planSha256"])
            source.write_text(json.dumps({"criteria": [{"id": "x", "kind": "performance", "members": []}]}), encoding="utf-8")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(main(["power", "--input", str(source)]), 2)

    def test_intersectional_cluster_protocol(self):
        result = intersectional_slices(population(), protected_fields=["region"], cluster_field="cluster", min_support=5, min_clusters=5, min_class_count=1, replicates=100)
        self.assertEqual(result["outcome"], "pass")
        self.assertEqual(result["bootstrap"]["method"], "cluster")
        self.assertEqual(result["bootstrap"]["clusterCount"], 40)


class OperationalTests(unittest.TestCase):
    def collect(self, events):
        with temporary_directory() as directory:
            path = Path(directory) / "logs.jsonl"
            content = "".join(json.dumps(row) + "\n" for row in events)
            path.write_bytes(content.encode("utf-8"))
            result = collect_jsonl([path])
            self.assertEqual(result["sources"][0]["sha256"], hashlib.sha256(content.encode()).hexdigest())
            return result

    def test_complete_declared_source_counts(self):
        result = self.collect([event("first", 1), event("second", 2)])
        self.assertEqual(result["outcome"], "pass")
        self.assertEqual(result["recordCount"], 2)
        self.assertEqual(result["sourceCounts"]["modelVersion"], {'"model-v3"': 2})
        self.assertIn("do not prove completeness", " ".join(result["limitations"]))

    def test_duplicate_ids_sequences_gaps_and_override_details(self):
        first = event("same", 1)
        second = event("same", 3)
        second["override"] = True
        third = event("third", 3)
        del third["pipelineVersion"]
        result = self.collect([first, second, third])
        self.assertEqual(result["outcome"], "fail")
        self.assertEqual(result["duplicateIds"][0]["count"], 2)
        self.assertEqual(result["sequenceGaps"][0]["missingCount"], 1)
        self.assertEqual(result["duplicateSequences"][0]["count"], 2)
        self.assertEqual(result["overrideIssues"]["count"], 1)
        self.assertEqual(result["missingFields"]["count"], 1)

    def test_malformed_duplicate_keys_and_oversize_line_rejected(self):
        with temporary_directory() as directory:
            path = Path(directory) / "bad.jsonl"
            for content in ['{"eventId":"A","eventId":"B"}\n', '{"value":NaN}\n', '{"value":"' + "x" * 65536 + '"}\n']:
                path.write_text(content, encoding="utf-8")
                with self.assertRaises(ValueError):
                    collect_jsonl([path])

    def test_selected_replay_tolerance_and_version_mismatch(self):
        logged = [event()]
        replayed = [event()]
        replayed[0]["finalDecision"] += 1e-7
        self.assertEqual(compare_replay(logged, replayed, selected_ids=["event-1"], absolute_tolerance=1e-6)["outcome"], "pass")
        self.assertEqual(compare_replay(logged, replayed, selected_ids=["event-1"])["outcome"], "fail")
        replayed[0]["pipelineVersion"] = "pipeline-other"
        result = compare_replay(logged, replayed, selected_ids=["event-1"], absolute_tolerance=1e-6)
        self.assertEqual(result["comparisons"][0]["metadataMismatches"], ["pipelineVersion"])
        self.assertIn("no actual model inference", result["scope"])

    def test_missing_replay_and_boolean_numeric_are_not_pass(self):
        result = compare_replay([event()], [], selected_ids=["event-1"])
        self.assertEqual(result["outcome"], "inconclusive")
        logged, replayed = [event()], [event()]
        logged[0]["finalDecision"], replayed[0]["finalDecision"] = True, 1
        with self.assertRaises(ValueError):
            compare_replay(logged, replayed, selected_ids=["event-1"])
        with self.assertRaises(ValueError):
            compare_replay(logged, replayed, selected_ids=[])


class DossierTests(unittest.TestCase):
    def test_unsigned_content_integrity_and_required_trust(self):
        proof = verify_dossier(dossier())
        self.assertTrue(proof["integrityValid"])
        self.assertTrue(proof["valid"])
        self.assertEqual(proof["outcome"], "inconclusive")
        self.assertFalse(proof["signature"]["trusted"])
        self.assertFalse(verify_dossier(dossier(), require_trusted_signature=True)["valid"])

    def test_file_manifest_and_report_tampering_rejected(self):
        for change in [
            lambda c: c["files"][0].update(contentBase64=base64.b64encode(b"tampered").decode()),
            lambda c: c["manifest"].update(audience="client"),
            lambda c: c["manifest"].update(reportSha256="a" * 64),
            lambda c: c["files"].pop(),
            lambda c: c["files"].append({"path": "unlisted.txt", "contentBase64": ""}),
        ]:
            container = dossier()
            change(container)
            self.assertFalse(verify_dossier(container)["valid"])

    def test_rehashed_missing_report_reference_is_rejected(self):
        container = dossier()
        container["manifest"]["reportSha256"] = container["manifest"]["files"][0]["sha256"]
        container["manifestSha256"] = hashlib.sha256(canonical_bytes(container["manifest"], integer_only=True)).hexdigest()
        self.assertFalse(verify_dossier(container)["valid"])

    def test_duplicate_case_colliding_reserved_and_unsafe_paths(self):
        for unsafe in ["../report.json", "/report.json", r"dir\report.json", "C:report.json", "dir//file.json", "CON.json", "folder./file", "folder/file "]:
            with self.assertRaises(ValueError):
                build_dossier({unsafe: b"{}"}, report_id="R", report_path=unsafe, created_at="2025-01-01T00:00:00Z")
        for extra in ["REPORT.json", "report.json/child"]:
            with self.assertRaises(ValueError):
                build_dossier({"report.json": b"{}", extra: b"{}"}, report_id="R", report_path="report.json", created_at="2025-01-01T00:00:00Z")
        container = dossier()
        container["files"].append(copy.deepcopy(container["files"][0]))
        self.assertFalse(verify_dossier(container)["valid"])

    def test_manifest_integer_only_and_custody_binding(self):
        with self.assertRaises(ValueError):
            canonical_bytes({"amount": 1.0}, integer_only=True)
        container = dossier()
        container["manifest"]["custody"][0]["sha256"] = "a" * 64
        container["manifestSha256"] = hashlib.sha256(canonical_bytes(container["manifest"], integer_only=True)).hexdigest()
        self.assertFalse(verify_dossier(container)["valid"])
        with self.assertRaises(ValueError):
            build_dossier({"report.json": b"{}"}, report_id="R", report_path="report.json", created_at="2025-01-01")
        self.assertFalse(verify_dossier(build_dossier({"report.json": b"not a JSON report"}, report_id="R", report_path="report.json", created_at="2025-01-01T00:00:00Z"))["valid"])

    @requires_cryptography
    def test_signature_validity_separate_from_external_trust(self):
        with temporary_directory() as directory:
            key = Ed25519PrivateKey.generate()  # Disposable synthetic test key.
            key_path = Path(directory) / "fixture-key.pem"
            key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            signed = sign_dossier(dossier(), private_key_path=key_path, key_id="fixture-key")
            proof = verify_dossier(signed)
            self.assertTrue(proof["signature"]["valid"])
            self.assertFalse(proof["signature"]["trusted"])
            self.assertEqual(proof["outcome"], "inconclusive")
            allowlist = {"fixture-key": signed["signature"]["publicKeySPKI"]}
            proof = verify_dossier(signed, trusted_keys=allowlist, require_trusted_signature=True)
            self.assertTrue(proof["valid"])
            self.assertTrue(proof["signature"]["trusted"])
            self.assertEqual(proof["outcome"], "pass")
            other = Ed25519PrivateKey.generate().public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
            wrong = verify_dossier(signed, trusted_keys={"fixture-key": base64.b64encode(other).decode()}, require_trusted_signature=True)
            self.assertFalse(wrong["valid"])
            self.assertTrue(wrong["integrityValid"])
            self.assertFalse(wrong["signature"]["trusted"])
            changed = copy.deepcopy(signed)
            changed["signature"]["signature"] = base64.b64encode(b"\x00" * 64).decode()
            self.assertFalse(verify_dossier(changed, trusted_keys=allowlist)["valid"])
            with self.assertRaises(ValueError):
                sign_dossier(signed, private_key_path=key_path, key_id="fixture-key")

    @requires_cryptography
    def test_signature_covers_rehashed_manifest(self):
        with temporary_directory() as directory:
            key_path = Path(directory) / "fixture.pem"
            key_path.write_bytes(Ed25519PrivateKey.generate().private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            signed = sign_dossier(dossier(), private_key_path=key_path, key_id="fixture")
            signed["manifest"]["audience"] = "client"
            signed["manifestSha256"] = hashlib.sha256(canonical_bytes(signed["manifest"], integer_only=True)).hexdigest()
            self.assertFalse(verify_dossier(signed)["valid"])

    def test_manifest_1_1_binds_versions_and_keeps_1_0(self):
        self.assertTrue(verify_dossier(dossier())["valid"])
        self.assertTrue(verify_dossier(dossier_v1_1())["valid"])
        uncaptured = dossier_v1_1(methodology=None)
        uncaptured["manifest"]["rulePack"] = None
        self.assertTrue(verify_dossier(rehash(uncaptured))["valid"])
        bad = []
        missing = dossier_v1_1()
        del missing["manifest"]["rulePack"]
        bad.append(rehash(missing))
        extra = dossier_v1_1()
        extra["manifest"]["signedBy"] = "someone"
        bad.append(rehash(extra))
        old_with_new = dossier_v1_1()
        old_with_new["manifest"]["schemaVersion"] = "1.0"
        bad.append(rehash(old_with_new))
        future = dossier_v1_1()
        future["manifest"]["schemaVersion"] = "1.2"
        bad.append(rehash(future))
        review = dossier_v1_1()
        review["manifest"]["rulePack"]["legalReview"] = "assumed"
        bad.append(rehash(review))
        pack_keys = dossier_v1_1()
        pack_keys["manifest"]["rulePack"]["notes"] = "x"
        bad.append(rehash(pack_keys))
        empty_key = dossier_v1_1(key_id=" ")
        bad.append(empty_key)
        methodology = dossier_v1_1(methodology=7)
        bad.append(methodology)
        for container in bad:
            self.assertFalse(verify_dossier(container)["valid"], container["manifest"])

    @requires_cryptography
    def test_manifest_1_1_signature_names_the_signed_key_id(self):
        with temporary_directory() as directory:
            key_path = Path(directory) / "fixture.pem"
            key_path.write_bytes(Ed25519PrivateKey.generate().private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            with self.assertRaises(ValueError):
                sign_dossier(dossier_v1_1(), private_key_path=key_path, key_id="KEY-other")
            signed = sign_dossier(dossier_v1_1(), private_key_path=key_path, key_id="KEY-fixture")
            trust = {"KEY-fixture": signed["signature"]["publicKeySPKI"]}
            proof = verify_dossier(signed, trusted_keys=trust, require_trusted_signature=True)
            self.assertTrue(proof["valid"], proof)
            self.assertEqual(proof["outcome"], "pass")
            # A relabelled signature (and a trust entry under the new label) fails.
            relabelled = copy.deepcopy(signed)
            relabelled["signature"]["keyId"] = "KEY-other"
            proof = verify_dossier(relabelled, trusted_keys={"KEY-other": signed["signature"]["publicKeySPKI"]})
            self.assertFalse(proof["valid"])
            self.assertEqual(proof["signature"]["status"], "invalid")
            # The captured versions are covered by the signature.
            downgraded = copy.deepcopy(signed)
            downgraded["manifest"]["rulePack"]["legalReview"] = "approved"
            self.assertFalse(verify_dossier(rehash(downgraded), trusted_keys=trust)["valid"])

    def test_read_json_rejects_duplicate_keys_and_nonfinite(self):
        with temporary_directory() as directory:
            path = Path(directory) / "bad.json"
            for text in ['{"a":1,"a":2}', '{"a":Infinity}']:
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(ValueError):
                    read_json(path)

    def test_single_file_cli_and_create_once_outputs(self):
        script = Path(__file__).resolve().parents[1] / "assurance.py"
        with temporary_directory() as directory:
            standalone = Path(directory) / "assurance.py"
            standalone.write_bytes(script.read_bytes())
            source = Path(directory) / "population.json"
            source.write_text(json.dumps(population(10)), encoding="utf-8")
            config = Path(directory) / "sample-config.json"
            config.write_text('{"count":3,"seed":7}', encoding="utf-8")
            output = Path(directory) / "sample.json"
            args = [sys.executable, str(standalone), "sample", "--input", str(source), "--config", str(config), "--output", str(output)]
            first = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(json.loads(output.read_text())["selectedCount"], 3)
            second = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(second.returncode, 2)
            self.assertEqual(json.loads(output.read_text())["selectedCount"], 3)
            package = Path(directory) / "dossier.json"
            package.write_text(json.dumps(dossier()), encoding="utf-8")
            verified = subprocess.run([sys.executable, str(standalone), "verify", "--dossier", str(package)], capture_output=True, text=True)
            self.assertEqual(verified.returncode, 0, verified.stderr)
            self.assertTrue(json.loads(verified.stdout)["integrityValid"])


class PackCommandTests(unittest.TestCase):
    """`pack` may produce a client dossier; sources must stay inside one base directory."""

    def setUp(self):
        self.temp = temporary_directory()
        self.root = Path(self.temp.name)
        self.specs = self.root / "specs"
        (self.specs / "evidence").mkdir(parents=True)
        (self.specs / "report.json").write_bytes(b'{"reportId":"R-1"}')
        (self.specs / "evidence" / "observations.csv").write_bytes(b"id,value\n1,2\n")
        (self.root / "outside.json").write_bytes(b'{"private":"outside the engagement"}')

    def tearDown(self):
        self.temp.cleanup()

    def pack(self, *sources, base_dir=None):
        spec = self.specs / "spec.json"
        files = [{"path": "report.json", "source": "report.json"}] + [{"path": f"evidence/{index}.bin", "source": source} for index, source in enumerate(sources)]
        spec.write_text(json.dumps({"reportId": "R-1", "reportPath": "report.json", "audience": "client", "createdAt": "2025-01-01T00:00:00Z", "files": files}), encoding="utf-8")
        output = self.root / f"dossier-{len(list(self.root.glob('dossier-*')))}.json"
        argv = ["pack", "--spec", str(spec), "--output", str(output)] + (["--base-dir", str(base_dir)] if base_dir else [])
        errors = io.StringIO()
        with redirect_stderr(errors):
            code = main(argv)
        return code, errors.getvalue(), output

    def test_relative_sources_inside_the_spec_directory_are_packed(self):
        code, errors, output = self.pack("evidence/observations.csv", "./evidence/observations.csv")
        self.assertEqual(code, 0, errors)
        container = json.loads(output.read_text(encoding="utf-8"))
        self.assertTrue(verify_dossier(container)["integrityValid"])
        self.assertEqual(base64.b64decode(container["files"][0]["contentBase64"]), b"id,value\n1,2\n")

    def test_absolute_parent_and_drive_paths_are_rejected(self):
        # Each case must fail its own check: re-rooted under the base, an
        # absolute path would otherwise fail only because nothing is there.
        relative, leaves = "must be relative to the specification directory", "cannot leave the base directory"
        for source, reason in ((str(self.root / "outside.json"), relative), ("C:outside.json", relative), ("/outside.json", relative), ("\\\\server\\share\\outside.json", relative), ("../outside.json", leaves), ("evidence/../../outside.json", leaves), ("evidence\\..\\..\\outside.json", leaves), ("..", leaves)):
            with self.subTest(source=source):
                code, errors, output = self.pack(source)
                self.assertEqual(code, 2)
                self.assertIn("Assurance procedure rejected: Pack sources "+reason, errors)
                self.assertNotIn("outside the engagement", errors)
                self.assertFalse(output.exists())

    def test_symlinked_sources_are_rejected(self):
        # Portable on Windows without symlink-creation privileges.
        (self.specs / "linked.json").write_bytes(b"{}")
        with patch.object(Path, "is_symlink", autospec=True, side_effect=lambda path: path.name == "linked.json"):
            code, errors, output = self.pack("linked.json")
        self.assertEqual(code, 2)
        self.assertIn("symbolic links", errors)
        self.assertFalse(output.exists())
        with patch.object(Path, "is_symlink", autospec=True, side_effect=lambda path: path.name == "evidence"):
            code, errors, _ = self.pack("evidence/observations.csv")
        self.assertEqual(code, 2)
        self.assertIn("symbolic links", errors)

    def test_real_symlink_to_outside_file_is_rejected(self):
        link = self.specs / "real-link.json"
        try:
            os.symlink(self.root / "outside.json", link)
        except (OSError, NotImplementedError):
            self.skipTest("Creating symbolic links requires a privilege this account lacks")
        code, errors, output = self.pack("real-link.json")
        self.assertEqual(code, 2)
        self.assertFalse(output.exists())

    def test_base_dir_confines_sources_instead_of_the_spec_directory(self):
        evidence = self.root / "evidence-root"
        evidence.mkdir()
        (evidence / "report.json").write_bytes(b'{"reportId":"R-1"}')
        (evidence / "extra.csv").write_bytes(b"a\n1\n")
        code, errors, output = self.pack("extra.csv", base_dir=evidence)
        self.assertEqual(code, 0, errors)
        self.assertTrue(verify_dossier(json.loads(output.read_text(encoding="utf-8")))["integrityValid"])
        code, errors, _ = self.pack("../outside.json", base_dir=evidence)
        self.assertEqual(code, 2)
        code, errors, _ = self.pack("evidence/observations.csv", base_dir=evidence)
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
