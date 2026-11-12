import copy
import csv
import json
import math
import tempfile
import unittest
from pathlib import Path

from engine.contract import validate_report
from engine.diagnostics import DRIFT_LIMITATION, ks_statistic, psi, run, validate_config, verify_report, wasserstein, write_report

try:
    import jsonschema
except ImportError:  # Installed by engine/requirements-dev.txt.
    jsonschema = None

SCHEMA = Path(__file__).resolve().parents[2]/"schemas"/"test-run.schema.json"
requires_jsonschema = unittest.skipUnless(jsonschema, "jsonschema is not installed; install engine/requirements-dev.txt")
_validators = {}


def schema_violations(report):
    """Readable violations of the shared run schema for an engine report (contract 1.3)."""
    if not _validators:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(schema)
        # Narrowing the version-discriminated oneOf to the engine branch makes
        # an error name the offending field instead of several branch mismatches.
        _validators["engine"] = jsonschema.Draft202012Validator({**schema, "oneOf": [{"$ref": "#/$defs/engineReport"}]})
        _validators["full"] = jsonschema.Draft202012Validator(schema)
    errors = ["/".join(map(str, error.absolute_path))+": "+error.message[:300] for error in _validators["engine"].iter_errors(report)]
    if not errors and not _validators["full"].is_valid(report):
        errors.append("report does not match exactly one schema branch")
    return errors


def config(task="binary_classification", suites=None):
    """A legacy 1.0 configuration whose minimums (2/2/2) sit below the statistics 1.0.0 floors."""
    return {"contractVersion": "1.0", "id": "run-test-001", "engagementId": "eng-001", "modelId": "model-001", "datasetId": "data-001", "task": task, "suite": suites or ["performance", "fairness"], "seed": 1729, "columns": {"target": "actual", "prediction": "predicted", "protected": "group", "score": "score"}, "minGroupSize": 2, "minClassCount": 2, "minSampleSize": 2, "thresholds": {"policyId": "test-policy", "policyVersion": "1", "source": "internal_policy", "values": {"accuracy": {"operator": ">=", "value": 0.8}, "precision": {"operator": ">=", "value": 0.8}, "recall": {"operator": ">=", "value": 0.8}, "f1": {"operator": ">=", "value": 0.8}, "balanced_accuracy": {"operator": ">=", "value": 0.8}, "brier_score": {"operator": "<=", "value": 0.2}, "expected_calibration_error": {"operator": "<=", "value": 0.2}, "demographic_parity_difference": {"operator": "<=", "value": 0.15}, "disparate_impact_ratio": {"operator": ">=", "value": 0.8}, "equalized_odds_difference": {"operator": "<=", "value": 0.15}}}}


def plan_config(plan, task="binary_classification", suites=None):
    """A 1.3 configuration with an explicit statistics plan and no legacy thresholds."""
    cfg = config(task, suites)
    cfg.update(contractVersion="1.3", statistics=plan)
    cfg["thresholds"]["values"] = {}
    for key in ("minGroupSize", "minClassCount", "minSampleSize"):
        del cfg[key]
    return cfg


def cells(group, tp, fp, fn, tn, scores=(0.9, 0.1)):
    """Rows for one group from confusion counts: tp (1,1), fp (0,1), fn (1,0), tn (0,0)."""
    rows = []
    for actual, predicted, count in (("1", "1", tp), ("0", "1", fp), ("1", "0", fn), ("0", "0", tn)):
        rows += [{"actual": actual, "predicted": predicted, "group": group, "score": scores[0] if predicted == "1" else scores[1]} for _ in range(count)]
    return rows


def by_name(result):
    return {m["name"]: m for m in result["metrics"]}


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
        """A perfect predictor: 40 rows per group, 20 per class, which meets the 30/30/10 floors."""
        return cells("A", 20, 0, 0, 20) + cells("B", 20, 0, 0, 20)

    def test_perfect_binary_metrics_pass_by_interval_and_draft_lineage(self):
        report = run(self.csv("input.csv", self.balanced()), config())
        self.assertEqual(report["contractVersion"], "1.3")
        performance = report["results"][0]
        self.assertEqual(performance["testId"], "PERF-BINARY")
        self.assertEqual(performance["outcome"], "pass")
        self.assertTrue(all(m["value"] == 1 for m in performance["metrics"] if m["details"]["role"] == "member"))
        accuracy = by_name(performance)["accuracy"]
        self.assertEqual((accuracy["numerator"], accuracy["denominator"]), (80, 80))
        self.assertEqual(accuracy["confidenceInterval"]["method"], "wilson")
        self.assertLess(accuracy["pValue"], 0.05)
        self.assertEqual(performance["decision"]["role"], "confirmatory")
        self.assertEqual(performance["decision"]["adjustment"], "bonferroni")
        self.assertEqual(len(report["paperIds"]), len(report["results"]))
        self.assertTrue(all(p["status"] == "draft" and p["review"]["required"] for p in report["workingPapers"]))
        self.assertTrue(verify_report(report))
        validate_report(report)

    def test_legacy_minimums_are_raised_to_the_floors_and_recorded(self):
        report = run(self.csv("input.csv", self.balanced()), config())
        plan = report["configuration"]["statistics"]
        self.assertEqual(plan["derivedFrom"], {"source": "engine_thresholds", "contractVersion": "1.0"})
        self.assertEqual(plan["minimums"], {"sampleSize": 30, "groupSize": 30, "classCount": 10})
        self.assertEqual(plan["configuredMinimums"], {"sampleSize": 2, "groupSize": 2, "classCount": 2})
        self.assertEqual([c["id"] for c in plan["criteria"]], ["PERF-BINARY", "PERF-CAL", "FAIR-DP", "FAIR-DI", "FAIR-EO"])
        # The chance baseline is always a member: here the policy's own 0.8 lower bound is above chance.
        baseline = next(m for m in plan["criteria"][0]["members"] if m["metric"] == "balanced_accuracy")
        self.assertEqual(baseline["band"], {"lower": 0.8, "upper": None})
        self.assertEqual(plan["criteria"][1]["passBlockedBy"], ["expected_calibration_error"])
        self.assertEqual(len(report["provenance"]["statisticsPlanSha256"]), 64)

    def test_plan_configuration_rejects_values_below_the_floors_and_legacy_thresholds(self):
        plan = {"criteria": [{"id": "accuracy-minimum", "kind": "performance", "members": [{"metric": "accuracy", "band": {"lower": 0.8}}]}]}
        validate_config(plan_config(plan, suites=["performance"]))
        for mutate, message in [
            (lambda c: c["statistics"].update(minimums={"sampleSize": 20}), "floor"),
            (lambda c: c["thresholds"]["values"].update(accuracy={"operator": ">=", "value": 0.8}), "empty thresholds.values"),
            (lambda c: c.update(minSampleSize=20), "minSampleSize"),
            (lambda c: c["statistics"]["criteria"][0].update(passBlockedBy=["r2"]), "passBlockedBy"),
            (lambda c: c["statistics"]["criteria"][0]["members"][0].update(band={"lower": 1.2}), "strictly inside"),
            (lambda c: c["statistics"].update(multiplicity={"confirmatory": "holm", "exploratory": "benjamini_hochberg"}), "family adjustments"),
            (lambda c: c.update(contractVersion="1.0"), "requires contractVersion 1.3"),
        ]:
            cfg = plan_config(copy.deepcopy(plan), suites=["performance"])
            mutate(cfg)
            with self.assertRaisesRegex(ValueError, message):
                validate_config(cfg)
        group = {"criteria": [{"id": "parity", "kind": "group_comparison", "metric": "selection_rate_difference", "band": {"lower": -0.1, "upper": 0.1}}]}
        with self.assertRaisesRegex(ValueError, "fairness"):
            validate_config(plan_config(group, suites=["performance"]))
        with self.assertRaisesRegex(ValueError, "do not apply"):
            validate_config(plan_config(group, "multiclass_classification", ["fairness"]))

    def test_explicit_plan_ids_bonferroni_family_and_exploratory_flags(self):
        plan = {"criteria": [
            {"id": "accuracy-minimum", "kind": "performance", "members": [{"metric": "accuracy", "band": {"lower": 0.8}}]},
            {"id": "parity-screen", "kind": "group_comparison", "role": "exploratory", "metric": "selection_rate_difference", "band": {"lower": -0.1, "upper": 0.1}},
        ]}
        rows = cells("A", 40, 0, 0, 40) + cells("B", 0, 0, 40, 40)
        report = run(self.csv("explicit.csv", rows), plan_config(plan))
        self.assertEqual([r["testId"] for r in report["results"]], ["accuracy-minimum", "parity-screen"])
        parity = report["results"][1]
        self.assertEqual(parity["outcome"], "fail")
        self.assertEqual(parity["decision"]["adjustment"], "benjamini_hochberg")
        self.assertEqual(parity["decision"]["familySize"], 1)
        # An exploratory fail is a review flag; it never changes the run outcome (section 4.6).
        self.assertEqual(report["reviewFlags"], ["parity-screen"])
        self.assertEqual(report["results"][0]["decision"]["familySize"], 1)
        self.assertEqual(report["outcome"], report["results"][0]["outcome"])
        validate_report(report)
        if jsonschema:
            self.assertEqual(schema_violations(report), [])

    def test_fairness_detects_gap_with_observed_counts(self):
        rows = cells("A", 20, 20, 0, 0) + cells("B", 0, 0, 20, 20)
        report = run(self.csv("gap.csv", rows), config(suites=["fairness"]))
        dp, di, eo = report["results"]
        self.assertEqual([r["outcome"] for r in (dp, di, eo)], ["fail", "fail", "fail"])
        self.assertEqual(dp["metrics"][0]["value"], 1)
        self.assertEqual(dp["metrics"][0]["details"]["role"], "headline")
        self.assertEqual(di["metrics"][0]["value"], 0)
        self.assertEqual(di["metrics"][1]["confidenceInterval"]["method"], "koopman_score")
        self.assertEqual(eo["metrics"][0]["value"], 1)
        self.assertEqual(dp["metrics"][0]["slices"][0]["selectionDenominator"], 40)
        self.assertEqual(dp["metrics"][1]["name"], "selection_rate_difference:B|A")

    def test_small_or_missing_groups_never_pass(self):
        rows = cells("A", 10, 0, 0, 10) + cells("B", 10, 0, 0, 10)
        cfg = config()
        cfg["minGroupSize"] = 5
        report = run(self.csv("small.csv", rows), cfg)
        fairness = [r for r in report["results"] if r["testId"].startswith("FAIR-")]
        self.assertTrue(all(r["outcome"] == "inconclusive" for r in fairness))
        self.assertTrue(all("group_suppressed_below_minimum" in r["decision"]["reasons"] for r in fairness))
        for row in rows:
            row["group"] = ""
        report = run(self.csv("missing.csv", rows), cfg)
        fairness = [r for r in report["results"] if r["testId"].startswith("FAIR-")]
        self.assertTrue(all(r["outcome"] == "inconclusive" for r in fairness))
        self.assertTrue(all(r["decision"]["coverage"]["unknownGroupRows"] == 40 for r in fairness))

    def test_zero_selection_di_and_missing_class_are_inconclusive(self):
        rows = cells("A", 0, 0, 0, 40) + cells("B", 0, 0, 0, 40)
        dp, di, eo = run(self.csv("zero.csv", rows), config(suites=["fairness"]))["results"]
        self.assertEqual(dp["metrics"][0]["value"], 0)
        self.assertEqual(di["outcome"], "inconclusive")
        self.assertIsNone(di["metrics"][0]["value"])
        self.assertIn("undefined_zero_denominator", di["decision"]["reasons"])
        self.assertEqual(eo["outcome"], "inconclusive")
        self.assertIn("single_class", eo["decision"]["reasons"])

    def test_missing_policy_does_not_pass(self):
        cfg = config()
        cfg["thresholds"]["values"] = {}
        report = run(self.csv("missing-policy.csv", self.balanced()), cfg)
        self.assertEqual(report["overallOutcome"], "inconclusive")
        performance = report["results"][0]
        self.assertIn("no_threshold", performance["decision"]["reasons"])
        self.assertTrue(all(m["details"]["role"] == "descriptive" for m in performance["metrics"]))

    def test_constant_predictor_cannot_pass_through_the_chance_baseline(self):
        cfg = config(suites=["performance"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted"}
        cfg["thresholds"]["values"] = {"accuracy": {"operator": ">=", "value": 0.9}}
        report = run(self.csv("constant.csv", cells("A", 0, 0, 100, 1900)), cfg)
        performance = report["results"][0]
        self.assertEqual(performance["outcome"], "inconclusive")
        self.assertLess(by_name(performance)["accuracy"]["pValue"], 1e-10)
        self.assertEqual(by_name(performance)["balanced_accuracy"]["details"]["direction"], "none")
        self.assertIn("estimate_on_band_boundary", performance["decision"]["reasons"])

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
        # Three rows are below the minimum sample size, and R2 blocks a pass (undecidable_metric).
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertTrue({"below_minimum_sample_size", "undecidable_metric"} <= set(result["decision"]["reasons"]))
        rows = [{"actual": 2, "predicted": 2}, {"actual": 2, "predicted": 2}]
        result = run(self.csv("constant.csv", rows), cfg)["results"][0]
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertIsNone(by_name(result)["r2"]["value"])

    def test_regression_r2_gets_a_descriptive_bootstrap_interval(self):
        cfg = config("regression", ["performance"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted"}
        cfg["thresholds"]["values"] = {"mae": {"operator": "<=", "value": 2}}
        rows = [{"actual": i, "predicted": i + (0.5 if i % 2 else -0.5)} for i in range(60)]
        result = run(self.csv("regression.csv", rows), cfg)["results"][0]
        r2 = by_name(result)["r2"]
        self.assertEqual(r2["details"]["role"], "descriptive")
        self.assertEqual(r2["confidenceInterval"]["method"], "percentile_bootstrap")
        self.assertLessEqual(r2["confidenceInterval"]["lower"], r2["value"])
        again = run(self.csv("regression-2.csv", rows), cfg)["results"][0]
        self.assertEqual(by_name(again)["r2"]["confidenceInterval"], r2["confidenceInterval"])

    def test_multiclass_confusion_and_macro_metrics(self):
        cfg = config("multiclass_classification", ["performance"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted"}
        cfg["thresholds"]["values"] = {name: {"operator": ">=", "value": 0.9} for name in ("accuracy", "macro_precision", "macro_recall", "macro_f1")}
        rows = [{"actual": label, "predicted": label} for label in ("a", "b", "c") for _ in range(60)]
        result = run(self.csv("multiclass.csv", rows), cfg)["results"][0]
        self.assertEqual(result["outcome"], "pass")
        recall = by_name(result)["macro_recall"]
        self.assertEqual(recall["details"]["metric"], "balanced_accuracy")
        self.assertEqual([c["support"] for c in recall["details"]["counts"]["perClass"]], [60, 60, 60])
        self.assertLess(recall["details"]["chanceExactP"], 1e-40)

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
        # Drift stays point-estimate screening without a decision (Q6), and still counts in the run outcome.
        self.assertNotIn("decision", report["results"][0])
        self.assertIn(DRIFT_LIMITATION, report["results"][0]["limitations"])
        self.assertIsNone(report["configuration"]["statistics"])
        self.assertEqual(run(current, cfg)["overallOutcome"], "inconclusive")

    def test_drift_ids_are_positional_and_keep_feature_names(self):
        cfg = config(suites=["drift"])
        cfg["driftFeatures"] = ["annual income", "età", "ratio/raw"]
        cfg["thresholds"]["values"] = {}
        reference = self.csv("reference.csv", [{name: i for name in cfg["driftFeatures"]} for i in range(4)])
        current = self.csv("current.csv", [{name: i+1 for name in cfg["driftFeatures"]} for i in range(4)])
        report = run(current, cfg, reference)
        self.assertEqual([r["testId"] for r in report["results"]], ["DRIFT-1", "DRIFT-2", "DRIFT-3"])
        for diagnostic, feature in zip(report["results"], cfg["driftFeatures"]):
            self.assertEqual(diagnostic["label"], "Distribution drift: "+feature)
            self.assertTrue(diagnostic["metrics"])
            self.assertTrue(all(m["details"]["feature"] == feature for m in diagnostic["metrics"]))
        self.assertEqual(set(report["provenance"]["inputs"]["testDefinitions"]), {"DRIFT-1", "DRIFT-2", "DRIFT-3"})
        validate_report(report)
        if jsonschema:
            self.assertEqual(schema_violations(report), [])

    @requires_jsonschema
    def test_reports_validate_against_shared_schema(self):
        rows = [{**row, "annual income": index} for index, row in enumerate(self.balanced())]
        binary = config(suites=["performance", "fairness", "drift", "shap", "cross_validation", "record_keeping"])
        binary["driftFeatures"] = ["annual income"]
        reference = self.csv("binary-reference.csv", [{"annual income": index+1} for index in range(80)])
        multiclass = config("multiclass_classification", ["performance", "fairness"])
        multiclass["columns"] = {"target": "actual", "prediction": "predicted"}
        regression = config("regression", ["performance"])
        regression["columns"] = {"target": "actual", "prediction": "predicted"}
        reports = [
            run(self.csv("binary.csv", rows), binary, reference),
            run(self.csv("no-reference.csv", rows), binary),
            run(self.csv("multiclass.csv", [{"actual": label, "predicted": label} for label in "abc" for _ in range(2)]), multiclass),
            run(self.csv("regression.csv", [{"actual": 1, "predicted": 1}, {"actual": 2, "predicted": 3}]), regression),
        ]
        self.assertIn("DRIFT-1", [r["testId"] for r in reports[0]["results"]])
        self.assertIn("DRIFT-INPUT", [r["testId"] for r in reports[1]["results"]])
        self.assertIn("FAIR-SCOPE", [r["testId"] for r in reports[2]["results"]])
        for report in reports:
            validate_report(report)
            self.assertEqual(schema_violations(report), [], report["suite"])

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
        performance = report["results"][0]
        self.assertEqual(performance["metrics"][0]["sampleSize"], 79)
        self.assertEqual(performance["decision"]["sampleSize"], 79)
        self.assertTrue(any("Excluded 1 rows" in note for note in performance["limitations"]))
        report["results"][0]["metrics"][0]["value"] = 0.5
        self.assertFalse(verify_report(report))

    def test_create_once_output_and_explicit_unavailable_capability(self):
        cfg = config(suites=["performance", "shap", "cross_validation", "record_keeping"])
        report = run(self.csv("unsupported.csv", self.balanced()), cfg)
        unsupported = report["results"][2:]
        self.assertTrue(all(r["outcome"] == "inconclusive" and not r["metrics"] and "decision" not in r for r in unsupported))
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

    def test_completed_report_contract_and_tampered_shape(self):
        report = run(self.csv("contract.csv", self.balanced()), config())
        validate_report(report)
        for mutate in (
            lambda r: r.update(suite=[{"testId": "fairness"}]),
            lambda r: r["results"][0]["metrics"][0].update(sampleSize="8"),
            lambda r: r["results"][0]["metrics"][0]["threshold"].update(value=0),
            # Statistics 1.0.0 rules (section 11.6).
            lambda r: r["results"][2].update(outcome="pass"),
            lambda r: r["results"][0]["decision"].update(adjustedPValue=0.5),
            lambda r: r["results"][0]["decision"].update(familySize=1),
            lambda r: r.update(reviewFlags=["PERF-BINARY"]),
            lambda r: r["results"].reverse(),
            lambda r: r["provenance"].update(statisticsPlanSha256="0"*64),
            lambda r: r["results"][0]["metrics"][0]["details"].update(band={"lower": 0.5, "upper": None}),
            lambda r: r["results"][0]["metrics"][-1].update(pValue=0.01),
        ):
            malformed = copy.deepcopy(report)
            mutate(malformed)
            with self.assertRaises(ValueError):
                validate_report(malformed, require_integrity=False)


if __name__ == "__main__":
    unittest.main()
