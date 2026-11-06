"""The traditional-ml-2.1.0 performance rules on the external worker path (#65).

Binary performance is measured on the frozen performancePositiveLabel while
fairness keeps counting the favourable label, and performance results report
prevalence, the majority-class baseline, a per-class table and predicted labels
absent from the reference column. schemas/fixtures/performance-rules-golden.json
is shared with the hosted runner (site-app/lib/performance-rules-golden.test.ts).
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from engine.diagnostics import read_csv, run, validate_config
from engine.errors import EngineError
from engine.tests.test_worker import hosted_request
from engine.worker_contract import TRANSLATION_VERSION, hosted_results, translate_config

GOLDEN = Path(__file__).resolve().parents[2]/"schemas"/"fixtures"/"performance-rules-golden.json"


def csv_bytes(rows, header=("actual", "predicted")):
    lines = [",".join(header)] + [",".join(row[:-1]) for row in rows for _ in range(row[-1])]
    return ("\n".join(lines)+"\n").encode()


def metric_values(result):
    return {m["name"]: m["value"] for m in result["metrics"]}


class PerformanceRuleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def evaluate(self, data, config, negative, suite=("performance",)):
        request = hosted_request(data, suite=list(suite))
        request["engineConfig"]["config"] = request["profile"]["config"] = copy.deepcopy(config)
        request["engineConfig"]["negativeLabel"] = negative
        path = self.root/f"fixture-{len(list(self.root.glob('*.csv')))}.csv"
        path.write_bytes(data)
        rows, _ = read_csv(path)
        native = translate_config(request, rows)
        report = run(path, native)
        return native, report, hosted_results(report, request)

    def config(self, **changes):
        return {**json.loads(GOLDEN.read_text(encoding="utf-8"))["cases"][0]["config"], **changes}

    def test_shared_golden_cases_match_the_hosted_runner(self):
        golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
        self.assertTrue(any(case["outcome"]["hosted"] == case["outcome"]["engine"] for case in golden["cases"]))
        for case in golden["cases"]:
            with self.subTest(case=case["id"]):
                _, report, results = self.evaluate(csv_bytes(case["rows"], golden["columns"]), case["config"], case["negativeLabel"])
                self.assertEqual(results[0]["outcome"], case["outcome"]["engine"])
                values = metric_values(results[0])
                for name, expected in case["metrics"].items():
                    self.assertAlmostEqual(values[name], expected, delta=1e-12, msg=name)
                # A hosted fail is never an engine pass.
                if case["outcome"]["hosted"] == "fail":
                    self.assertNotEqual(results[0]["outcome"], "pass")
                self.assertEqual(report["configuration"]["hostedTranslation"]["version"], TRANSLATION_VERSION)

    def test_always_approve_predictor_never_passes(self):
        # Reproduction 1: 34 approved and 6 declined, every prediction approved. Before #65 it passed through
        # translate_config and hosted_results on accuracy 0.85 and recall 1.0 alone.
        for scale, reason in ((1, "below_minimum_class_count"), (10, "estimate_on_band_boundary")):
            data = csv_bytes([("approved", "approved", 34*scale), ("declined", "approved", 6*scale)])
            native, _, results = self.evaluate(data, self.config(), "declined")
            self.assertEqual(native["performancePositiveLabel"], "approved")
            result = results[0]
            self.assertEqual(result["outcome"], "inconclusive", scale)
            self.assertIn(reason, result["decision"]["reasons"])
            values = metric_values(result)
            self.assertEqual((values["accuracy"], values["recall"], values["specificity"], values["balanced_accuracy"]), (.85, 1, 0, .5))
            self.assertEqual((values["prevalence"], values["majority_baseline_accuracy"]), (.85, .85))
            baseline = next(m for m in result["metrics"] if m["name"] == "balanced_accuracy")
            self.assertEqual((baseline["details"]["role"], baseline["details"]["band"]), ("member", {"lower": .5, "upper": None}))

    def test_recall_is_measured_on_the_performance_positive_class(self):
        # Reproduction 2: favourable ok, performance positive class fraud, minimum recall 0.7, minimum accuracy
        # 0.8. Fraud 5 caught and 5 missed, ok 29 right and 1 flagged. The worker measured recall 0.9667 on ok.
        rows = [("fraud", "fraud", 5), ("fraud", "ok", 5), ("ok", "ok", 29), ("ok", "fraud", 1)]
        config = self.config(positiveLabel="ok", performancePositiveLabel="fraud")
        native, report, results = self.evaluate(csv_bytes(rows), config, "fraud")
        self.assertEqual((native["positiveLabel"], native["negativeLabel"], native["performancePositiveLabel"]), ("ok", "fraud", "fraud"))
        self.assertEqual(report["configuration"]["performancePositiveLabel"], "fraud")
        recall = next(m for m in results[0]["metrics"] if m["name"] == "recall")
        self.assertEqual((recall["value"], recall["numerator"], recall["denominator"]), (.5, 5, 10))
        self.assertEqual(recall["details"]["direction"], "fail")
        # At 40 rows the Wilson interval [0.24, 0.76] straddles 0.7: statistics 1.0.0 does not claim the fail.
        self.assertEqual(results[0]["outcome"], "inconclusive")
        self.assertIn("interval_straddles_band", results[0]["decision"]["reasons"])
        # With ten times the rows the interval lies below 0.7 and the criterion fails on recall of fraud.
        native, _, results = self.evaluate(csv_bytes([(a, p, n*10) for a, p, n in rows]), config, "fraud")
        self.assertEqual(results[0]["outcome"], "fail")
        self.assertEqual(results[0]["decision"]["decidingMemberId"], "recall")
        self.assertEqual(metric_values(results[0])["recall"], .5)
        notes = " ".join(results[0]["limitations"])
        self.assertIn("refer to the performance positive class 'fraud'", notes)
        self.assertIn("Fairness tests count the favourable outcome 'ok'", notes)
        table = next(m for m in results[0]["metrics"] if m["name"] == "balanced_accuracy")["slices"]
        self.assertEqual([(row["slice"], row["support"], row["predicted"], row["tp"]) for row in table], [("fraud", 100, 60, 50), ("ok", 300, 340, 290)])
        self.assertEqual((table[0]["recall"], table[1]["recall"]), (.5, 290/300))

    def test_fairness_keeps_counting_the_favourable_outcome(self):
        rows = [("fraud", "fraud", "A", 30), ("ok", "ok", "A", 70), ("fraud", "fraud", "B", 30), ("ok", "ok", "B", 40), ("ok", "fraud", "B", 30)]
        data = csv_bytes(rows, ("actual", "predicted", "group"))
        config = self.config(positiveLabel="ok", performancePositiveLabel="fraud", groupColumn="group")
        _, _, results = self.evaluate(data, config, "fraud", suite=("performance", "demographic_parity"))
        parity = results[1]
        rates = {s["slice"]: s["selectionRate"] for s in parity["metrics"][0]["slices"]}
        # Selection rate of the favourable "ok": A 70/100, B 40/100.
        self.assertEqual(rates, {"A": .7, "B": .4})
        self.assertEqual(metric_values(results[0])["recall"], 1)

    def test_positive_class_defaults_and_validation(self):
        data = csv_bytes([("1", "1", 40), ("0", "0", 40)])
        # Empty means the favourable label; a fairness-only binary run records none.
        native, _, _ = self.evaluate(data, self.config(positiveLabel="1"), "0")
        self.assertEqual(native["performancePositiveLabel"], "1")
        group = csv_bytes([("1", "1", "A", 40), ("0", "0", "B", 40)], ("actual", "predicted", "group"))
        native, _, _ = self.evaluate(group, self.config(positiveLabel="1", groupColumn="group", performancePositiveLabel="0"), "0", suite=("demographic_parity",))
        self.assertNotIn("performancePositiveLabel", native)
        with self.assertRaises(EngineError) as error:
            self.evaluate(data, self.config(positiveLabel="1", performancePositiveLabel="fraud"), "0")
        self.assertEqual(error.exception.code, "protocol_config_invalid")
        # A request frozen without negativeLabel takes the separate positive class as the other label.
        request = hosted_request(data, suite=["performance"])
        request["engineConfig"]["config"] = self.config(positiveLabel="1", performancePositiveLabel="0")
        del request["engineConfig"]["negativeLabel"]
        single = [{"actual": "1", "predicted": "1"}] * 30
        native = translate_config(request, single)
        self.assertEqual((native["negativeLabel"], native["performancePositiveLabel"]), ("0", "0"))
        base = {key: native[key] for key in native if key != "performancePositiveLabel"}
        with self.assertRaisesRegex(ValueError, "positiveLabel or negativeLabel"):
            validate_config({**base, "performancePositiveLabel": "maybe"})
        multiclass = {**base, "task": "multiclass_classification", "performancePositiveLabel": "1"}
        for key in ("positiveLabel", "negativeLabel"):
            multiclass.pop(key)
        with self.assertRaisesRegex(ValueError, "binary classification only"):
            validate_config(multiclass)

    def test_multiclass_reports_the_baseline_class_table_and_unexpected_predictions(self):
        rows = [("A", "A", 40), ("B", "B", 30), ("B", "D", 10), ("C", "C", 35), ("C", "A", 5)]
        data = csv_bytes(rows)
        request = hosted_request(data, task="Multiclass classification", suite=["performance"])
        request["engineConfig"]["config"]["minimumAccuracy"] = .6
        path = self.root/"multi.csv"
        path.write_bytes(data)
        report = run(path, translate_config(request, read_csv(path)[0]))
        result = hosted_results(report, request)[0]
        values = metric_values(result)
        self.assertEqual(values["majority_baseline_accuracy"], 40/120)
        table = next(m for m in result["metrics"] if m["name"] == "balanced_accuracy")["slices"]
        self.assertEqual([(row["slice"], row["support"], row["tp"]) for row in table], [("A", 40, 40), ("B", 40, 30), ("C", 40, 35), ("D", 0, 0)])
        self.assertIsNone(table[3]["recall"])
        self.assertIn("Predicted labels absent from the reference column: 'D' (10 rows). They count as errors.", result["limitations"])
        # The prediction-only class has no support, so macro recall is undefined and blocks a pass (section 4.8).
        self.assertNotEqual(result["outcome"], "pass")
        self.assertIn("single_class", result["decision"]["reasons"])


if __name__ == "__main__":
    unittest.main()
