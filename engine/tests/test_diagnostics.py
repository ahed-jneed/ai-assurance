import copy
import csv
import json
import math
import tempfile
import unittest
from pathlib import Path

from engine.diagnostics import fairness, ks_statistic, prediction_rows, psi, run, validate_config, verify_report, wasserstein, wilson, write_report
from engine.contract import validate_report


def config(task="binary_classification", suites=None):
    return {"contractVersion": "1.0", "id": "run-test-001", "engagementId": "eng-001", "modelId": "model-001", "datasetId": "data-001", "task": task, "suite": suites or ["performance", "fairness"], "seed": 1729, "columns": {"target": "actual", "prediction": "predicted", "protected": "group", "score": "score"}, "minGroupSize": 2, "minClassCount": 2, "minSampleSize": 2, "thresholds": {"policyId": "test-policy", "policyVersion": "1", "source": "internal_policy", "values": {"accuracy": {"operator": ">=", "value": 0.8}, "precision": {"operator": ">=", "value": 0.8}, "recall": {"operator": ">=", "value": 0.8}, "f1": {"operator": ">=", "value": 0.8}, "balanced_accuracy": {"operator": ">=", "value": 0.8}, "brier_score": {"operator": "<=", "value": 0.2}, "expected_calibration_error": {"operator": "<=", "value": 0.2}, "demographic_parity_difference": {"operator": "<=", "value": 0.15}, "disparate_impact_ratio": {"operator": ">=", "value": 0.8}, "equalized_odds_difference": {"operator": "<=", "value": 0.15}}}}


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def csv(self, name, rows, headers=None):
        path = self.directory / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers or list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        return path

    def balanced(self):
        return [{"actual": actual, "predicted": predicted, "group": group, "score": 0.9 if predicted == "1" else 0.1} for group in ("A", "B") for actual, predicted in [("1", "1"), ("1", "1"), ("0", "0"), ("0", "0")]]

    def test_perfect_binary_metrics_and_draft_lineage(self):
        report = run(self.csv("input.csv", self.balanced()), config())
        performance = report["results"][0]
        self.assertEqual(performance["outcome"], "pass")
        self.assertTrue(all(m["value"] == 1 for m in performance["metrics"]))
        self.assertEqual(performance["metrics"][0]["numerator"], 8)
        self.assertEqual(performance["metrics"][0]["denominator"], 8)
        self.assertIsNotNone(performance["metrics"][0]["confidenceInterval"])
        self.assertEqual(len(report["paperIds"]), len(report["results"]))
        self.assertTrue(all(p["status"] == "draft" and p["review"]["required"] for p in report["workingPapers"]))
        self.assertTrue(verify_report(report))

    def test_fairness_detects_gap_with_observed_counts(self):
        observations = [{"target": target, "prediction": "1" if group == "A" else "0", "group": group, "score": None} for group in ("A", "B") for target in ("1", "1", "0", "0")]
        results = fairness(observations, validate_config(config()))
        self.assertEqual([r["outcome"] for r in results], ["fail", "fail", "fail"])
        self.assertEqual(results[0]["metrics"][0]["value"], 1)
        self.assertEqual(results[1]["metrics"][0]["value"], 0)
        self.assertEqual(results[2]["metrics"][0]["value"], 1)
        self.assertEqual(results[0]["metrics"][0]["slices"][0]["selectionDenominator"], 4)

    def test_small_or_missing_groups_never_pass(self):
        rows = self.balanced()
        cfg = config()
        cfg["minGroupSize"] = 5
        report = run(self.csv("small.csv", rows), cfg)
        self.assertTrue(all(r["outcome"] == "inconclusive" for r in report["results"] if r["testId"].startswith("FAIR-")))
        cfg["minGroupSize"] = 2
        for row in rows:
            row["group"] = ""
        report = run(self.csv("missing.csv", rows), cfg)
        self.assertTrue(all(r["outcome"] == "inconclusive" for r in report["results"] if r["testId"].startswith("FAIR-")))

    def test_zero_selection_di_and_missing_class_are_inconclusive(self):
        observations = [{"target": "0", "prediction": "0", "group": group, "score": None} for group in ("A", "B") for _ in range(4)]
        dp, di, eo = fairness(observations, validate_config(config()))
        self.assertEqual(dp["metrics"][0]["value"], 0)
        self.assertEqual(di["outcome"], "inconclusive")
        self.assertIsNone(di["metrics"][0]["value"])
        self.assertEqual(eo["outcome"], "inconclusive")

    def test_missing_policy_does_not_pass(self):
        cfg = config()
        cfg["thresholds"]["values"] = {}
        report = run(self.csv("missing-policy.csv", self.balanced()), cfg)
        self.assertEqual(report["overallOutcome"], "inconclusive")

    def test_regression_known_values_and_constant_target(self):
        cfg = config("regression", ["performance"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted"}
        cfg["thresholds"]["values"] = {"mae": {"operator": "<=", "value": 1}, "rmse": {"operator": "<=", "value": 1}, "r2": {"operator": ">=", "value": 0.5}}
        rows = [{"actual": 1, "predicted": 1}, {"actual": 2, "predicted": 3}, {"actual": 3, "predicted": 2}]
        result = run(self.csv("regression.csv", rows), cfg)["results"][0]
        measurements = {m["name"]: m["value"] for m in result["metrics"]}
        self.assertAlmostEqual(measurements["mae"], 2/3)
        self.assertAlmostEqual(measurements["rmse"], math.sqrt(2/3))
        self.assertAlmostEqual(measurements["r2"], 0)
        self.assertEqual(result["outcome"], "fail")
        rows = [{"actual": 2, "predicted": 2}, {"actual": 2, "predicted": 2}]
        result = run(self.csv("constant.csv", rows), cfg)["results"][0]
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertIsNone(result["metrics"][2]["value"])

    def test_multiclass_confusion_and_macro_metrics(self):
        cfg = config("multiclass_classification", ["performance"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted"}
        cfg["thresholds"]["values"] = {name: {"operator": ">=", "value": 0.9} for name in ("accuracy", "macro_precision", "macro_recall", "macro_f1")}
        rows = [{"actual": label, "predicted": label} for label in ("a", "b", "c") for _ in range(2)]
        result = run(self.csv("multiclass.csv", rows), cfg)["results"][0]
        self.assertEqual(result["outcome"], "pass")
        self.assertEqual(result["metrics"][0]["details"]["confusionMatrix"], [[2, 0, 0], [0, 2, 0], [0, 0, 2]])

    def test_drift_identical_and_shifted_distributions(self):
        reference = [0, 0, 1, 1, 2, 2]
        shifted = [v+3 for v in reference]
        self.assertEqual(ks_statistic(reference, reference), 0)
        self.assertEqual(wasserstein(reference, reference), 0)
        self.assertEqual(psi(reference, reference, 3)[0], 0)
        self.assertEqual(ks_statistic(reference, shifted), 1)
        self.assertAlmostEqual(wasserstein(reference, shifted), 3)
        value, details = psi(reference, shifted, 3)
        self.assertGreater(value, 0)
        self.assertEqual(details["referenceEdges"], [0, 1])
        self.assertEqual(details["currentCounts"], [0, 0, 6])

    def test_drift_uses_reference_bins_missingness_and_no_baseline(self):
        cfg = config(suites=["drift"])
        cfg["driftFeatures"] = ["feature"]
        cfg["thresholds"]["values"] = {"psi:feature": {"operator": "<=", "value": 0.2}, "ks:feature": {"operator": "<=", "value": 0.2}, "wasserstein:feature": {"operator": "<=", "value": 0.2}}
        reference = self.csv("reference.csv", [{"feature": 0}, {"feature": 1}, {"feature": 2}, {"feature": 3}])
        current = self.csv("current.csv", [{"feature": 0}, {"feature": 1}, {"feature": 2}, {"feature": ""}])
        report = run(current, cfg, reference)
        details = report["results"][0]["metrics"][0]["details"]
        self.assertEqual(details["currentMissing"], 1)
        self.assertEqual(details["currentMissingRate"], 0.25)
        self.assertEqual(details["referenceN"], 4)
        self.assertEqual(run(current, cfg)["overallOutcome"], "inconclusive")

    def test_nonfinite_duplicates_bad_labels_and_unsafe_thresholds_rejected(self):
        for bad in ("NaN", "Infinity", "-inf"):
            rows = self.balanced()
            rows[0]["score"] = bad
            with self.assertRaises(ValueError):
                run(self.csv(bad.replace("-", "")+".csv", rows), config())
        duplicate = self.directory / "duplicate.csv"
        duplicate.write_text("actual,actual\n1,1\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            run(duplicate, config())
        rows = self.balanced()
        rows[0]["actual"] = "unexpected"
        with self.assertRaises(ValueError):
            run(self.csv("labels.csv", rows), config())
        cfg = config()
        cfg["thresholds"]["source"] = "EU_AI_Act"
        with self.assertRaises(ValueError):
            validate_config(cfg)

    def test_null_predictions_excluded_and_report_tamper_detected(self):
        rows = self.balanced()
        rows[0]["predicted"] = ""
        report = run(self.csv("null.csv", rows), config())
        self.assertEqual(report["results"][0]["metrics"][0]["sampleSize"], 7)
        self.assertEqual(report["results"][0]["metrics"][0]["details"]["excludedMissingTargetOrPrediction"], 1)
        report["results"][0]["metrics"][0]["value"] = 0.5
        self.assertFalse(verify_report(report))

    def test_create_once_output_and_explicit_unavailable_capability(self):
        cfg = config(suites=["performance", "shap", "cross_validation", "record_keeping"])
        report = run(self.csv("unsupported.csv", self.balanced()), cfg)
        unsupported = report["results"][2:]
        self.assertTrue(all(r["outcome"] == "inconclusive" and not r["metrics"] for r in unsupported))
        self.assertEqual(report["overallOutcome"], "inconclusive")
        destination = self.directory / "report.json"
        write_report(report, destination)
        with self.assertRaises(FileExistsError):
            write_report(report, destination)
        self.assertTrue(verify_report(json.loads(destination.read_text(encoding="utf-8"))))

    def test_config_copy_and_input_hash_change(self):
        cfg = config()
        frozen = validate_config(cfg)
        cfg["thresholds"]["values"]["accuracy"]["value"] = 0
        self.assertEqual(frozen["thresholds"]["values"]["accuracy"]["value"], 0.8)
        path = self.csv("hash.csv", self.balanced())
        first = run(path, config())
        path.write_text(path.read_text(encoding="utf-8")+"1,1,A,0.9\n", encoding="utf-8")
        second = run(path, config())
        self.assertNotEqual(first["provenance"]["inputHashes"]["data"], second["provenance"]["inputHashes"]["data"])
        self.assertNotEqual(first["paperIds"], second["paperIds"])

    def test_wilson_finite_bounds_known_zero_denominator(self):
        self.assertIsNone(wilson(0, 0))
        interval = wilson(10, 10)
        self.assertAlmostEqual(interval["lower"], 0.7224672, places=6)
        self.assertEqual(interval["upper"], 1)

    def test_completed_report_contract_and_tampered_shape(self):
        report = run(self.csv("contract.csv", self.balanced()), config())
        validate_report(report)
        malformed = copy.deepcopy(report)
        malformed["suite"] = [{"testId": "fairness"}]
        with self.assertRaises(ValueError):
            validate_report(malformed, require_integrity=False)
        malformed = copy.deepcopy(report)
        malformed["results"][0]["metrics"][0]["sampleSize"] = "8"
        with self.assertRaises(ValueError):
            validate_report(malformed, require_integrity=False)
        malformed = copy.deepcopy(report)
        malformed["results"][0]["metrics"][0]["threshold"]["value"] = 0
        with self.assertRaises(ValueError):
            validate_report(malformed, require_integrity=False)


if __name__ == "__main__":
    unittest.main()
