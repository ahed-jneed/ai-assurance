"""Cluster-bootstrap decisions (docs/design/audit-statistics.md section 5.11) and the MAE/RMSE sensitivity
interval (section 5.9): determinism, one shared replicate set, the decision budget, the valid-replicate and
minimum-cluster rules, and the end-to-end path through engine.diagnostics.run()."""
import copy
import csv
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from engine import statistics as st
from engine.contract import validate_report
from engine.diagnostics import run
from engine.errors import EngineError
from engine.tests.test_diagnostics import plan_config, schema_violations
from engine.tests.test_statistics_golden import GOLDEN, public

try:
    import jsonschema
except ImportError:  # Installed by engine/requirements-dev.txt.
    jsonschema = None


def golden(case_id):
    return copy.deepcopy(next(c for c in GOLDEN["cases"] if c["id"] == case_id))


def recall_plan(replicates=1000, criteria=1):
    return st.validate_plan({"clusterField": "person", "bootstrap": {"replicates": replicates}, "criteria": [
        {"id": f"recall-{i}", "kind": "performance", "members": [{"metric": "recall", "band": {"lower": 0.7}}]} for i in range(criteria)]})


def people(count, rows=3):
    """`count` clusters of `rows` positives each; every fifth person's positives are all missed."""
    return [{"cluster": f"p{i:05d}", "groups": [{"group": "all", "tp": 0 if i % 5 == 0 else rows, "fp": 0, "fn": rows if i % 5 == 0 else 0, "tn": 1}]} for i in range(count)]


class ClusterBootstrapCoreTests(unittest.TestCase):
    def test_same_seed_same_result_and_another_seed_other_replicates(self):
        case = golden("GC-54")
        plan = st.plan_for(case)
        first = public(st.evaluate_plan(plan, case["data"]))
        self.assertEqual(public(st.evaluate_plan(plan, copy.deepcopy(case["data"]))), first)
        # Input order does not matter: clusters are ordered by their canonical bytes.
        shuffled = {**case["data"], "clusters": list(reversed(case["data"]["clusters"]))}
        self.assertEqual(public(st.evaluate_plan(plan, shuffled)), first)
        other = public(st.evaluate_plan(plan, {**case["data"], "seed": 20261106}))
        recall = [c["members"][0]["interval"] for c in (first["criteria"][0], other["criteria"][0])]
        self.assertNotEqual(recall[0], recall[1])
        self.assertEqual(recall[0]["method"], "cluster_percentile_bootstrap")

    def test_clustered_plan_needs_its_cluster_data(self):
        case = golden("GC-54")
        plan = st.plan_for(case)
        with self.assertRaisesRegex(st.StatisticsError, "cluster bootstrap"):
            st.evaluate_criteria(plan, lambda criterion: case["data"])

    def test_one_replicate_set_serves_every_criterion(self):
        data = {"seed": 7, "clusters": people(40)}
        together = st.evaluate_plan(recall_plan(criteria=2), data)["criteria"]
        alone = st.evaluate_plan(recall_plan(criteria=1), data)["criteria"]
        self.assertEqual(together[0]["members"][0]["interval"], together[1]["members"][0]["interval"])
        self.assertEqual(together[0]["members"][0]["interval"], alone[0]["members"][0]["interval"])
        self.assertEqual(together[0]["members"][0]["pValue"], alone[0]["members"][0]["pValue"])

    def test_decision_p_is_twice_the_smallest_deciding_tail(self):
        member = st.evaluate_plan(recall_plan(), {"seed": 7, "clusters": people(40)})["criteria"][0]["members"][0]
        self.assertEqual(member["direction"], "pass")
        self.assertEqual(member["bootstrap"], {"replicates": 1000, "validReplicates": 1000, "clusters": 40})
        # p <= alpha exactly when the reported percentile interval lies inside the band, and never below 2/(B + 1).
        self.assertEqual(member["pValue"] <= 0.05, member["interval"]["lower"] >= 0.7)
        self.assertGreaterEqual(member["pValue"], 2 / 1001)

    def test_budget_exceeded_makes_every_member_inconclusive_without_drawing(self):
        data = {"seed": 7, "clusters": people(40)}
        plan = recall_plan(replicates=1000)
        with mock.patch.object(st, "MAX_DECISION_DRAWS", 1000 * 40 - 1), mock.patch.object(st.random, "Random", side_effect=AssertionError("no replicate may be drawn")):
            out = st.evaluate_plan(plan, data)
        criterion = out["criteria"][0]
        member = criterion["members"][0]
        self.assertEqual((member["status"], member["interval"], member["pValue"]), ("undefined", None, 1.0))
        self.assertIn("bootstrap_budget_exceeded", member["reasons"])
        self.assertEqual(member["bootstrap"]["validReplicates"], 0)
        self.assertEqual(criterion["outcome"], "inconclusive")
        self.assertIn("bootstrap_budget_exceeded", criterion["decision"]["reasons"])
        with mock.patch.object(st, "MAX_DECISION_DRAWS", 1000 * 40):  # exactly at the budget still runs
            self.assertEqual(st.evaluate_plan(plan, data)["criteria"][0]["members"][0]["bootstrap"]["validReplicates"], 1000)
        self.assertEqual(st.MAX_DECISION_DRAWS, 50_000_000)

    def test_replicate_count_and_time(self):
        """B = 1000 over 2,000 clusters is 2,000,000 draws; the 50,000,000-draw budget is sized at about one
        minute of CPython, so this run must stay far below that."""
        plan = recall_plan(replicates=1000)
        started = time.perf_counter()
        member = st.evaluate_plan(plan, {"seed": 11, "clusters": people(2000)})["criteria"][0]["members"][0]
        elapsed = time.perf_counter() - started
        self.assertEqual(member["bootstrap"], {"replicates": 1000, "validReplicates": 1000, "clusters": 2000})
        self.assertLess(elapsed, 30.0)
        with self.assertRaises(st.StatisticsError):
            recall_plan(replicates=999)

    def test_too_few_valid_replicates_and_too_few_clusters(self):
        clusters = [{"cluster": f"a{i:02d}", "groups": [{"group": "A", "selected": 1, "n": 2}]} for i in range(30)]
        clusters.append({"cluster": "b01", "groups": [{"group": "B", "selected": 20, "n": 40}]})
        plan = st.validate_plan({"clusterField": "person", "bootstrap": {"replicates": 1000}, "criteria": [{"id": "parity", "kind": "group_comparison", "metric": "selection_rate_difference", "band": {"lower": -0.2, "upper": 0.2}}]})
        member = st.evaluate_plan(plan, {"seed": 3, "clusters": clusters})["criteria"][0]["members"][0]
        # Group B is one cluster: about a third of the replicates miss it, so its difference is undefined there.
        self.assertLess(member["bootstrap"]["validReplicates"], 900)
        self.assertEqual(member["status"], "undefined")
        self.assertIn("bootstrap_insufficient_valid_replicates", member["reasons"])
        self.assertIn("below_minimum_cluster_count", member["reasons"])
        self.assertIsNone(member["interval"])


class ClusterBootstrapEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def csv(self, rows, name="data.csv"):
        path = self.directory / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_a_row_without_a_cluster_id_is_rejected(self):
        rows = [{"actual": "1", "predicted": "1", "group": "A", "score": "0.9", "person": f"p{i % 12}"} for i in range(40)]
        rows[5]["person"] = ""
        plan = {"clusterField": "person", "bootstrap": {"replicates": 1000}, "criteria": [{"id": "accuracy", "kind": "performance", "members": [{"metric": "accuracy", "band": {"lower": 0.8}}]}]}
        with self.assertRaisesRegex(EngineError, "cluster id"):
            run(self.csv(rows), plan_config(plan, suites=["performance"]))

    def test_clustered_calibration_and_report_contract(self):
        rows = []
        for i in range(60):
            score = 0.15 if i % 2 else 0.85
            rows += [{"actual": "1" if (j < 3) == (score > 0.5) or j == 4 else "0", "predicted": "1" if score > 0.5 else "0", "group": "AB"[i % 2], "score": repr(score), "person": f"p{i:02d}"} for j in range(5)]
        plan = {"clusterField": "person", "bootstrap": {"replicates": 1000}, "criteria": [
            {"id": "calibration", "kind": "calibration", "band": {"lower": -0.2, "upper": 0.2}, "members": [{"metric": "brier_score", "band": {"upper": 0.3}}]},
            {"id": "parity", "kind": "group_comparison", "metric": "selection_rate_difference", "band": {"lower": -0.3, "upper": 0.3}}]}
        report = run(self.csv(rows), plan_config(plan, suites=["performance", "fairness"]))
        validate_report(report)
        if jsonschema:
            self.assertEqual(schema_violations(report), [])
        calibration = report["results"][0]
        for metric in calibration["metrics"][1:]:
            if metric["name"] != "expected_calibration_error":
                self.assertEqual(metric["confidenceInterval"]["method"], "cluster_percentile_bootstrap", metric["name"])
                # Brier resamples all 60 people; each calibration bin holds 30 of them.
                self.assertEqual(metric["details"]["bootstrap"]["clusters"], 60 if metric["name"] == "brier_score" else 30, metric["name"])
        self.assertTrue(any("clustered by 'person'" in note for note in calibration["limitations"]))
        again = run(self.csv(rows, "again.csv"), plan_config(plan, suites=["performance", "fairness"]))
        self.assertEqual([r["metrics"] for r in again["results"]], [r["metrics"] for r in report["results"]])

    def test_regression_members_carry_a_sensitivity_interval_that_never_decides(self):
        case = golden("GC-35")
        rows = [{"actual": repr(t), "predicted": repr(t + e)} for t, e in zip(case["data"]["targets"], case["data"]["errors"])]
        config = plan_config(case["plan"], task="regression", suites=["performance"])
        config["columns"] = {"target": "actual", "prediction": "predicted"}
        report = run(self.csv(rows), config)
        result = report["results"][0]
        for metric in result["metrics"]:
            if metric["name"] in ("mae", "rmse"):
                sensitivity = metric["details"]["sensitivityInterval"]
                self.assertEqual(sensitivity["method"], "percentile_bootstrap")
                self.assertLess(sensitivity["lower"], metric["value"])
                self.assertGreater(sensitivity["upper"], metric["value"])
                self.assertEqual(metric["confidenceInterval"]["method"], "normal_approximation" if metric["name"] == "mae" else "normal_approximation_mse")
            else:
                self.assertNotIn("sensitivityInterval", metric["details"])
        expected = next(c for c in case["expected"]["criteria"])
        self.assertAlmostEqual(result["decision"]["pValue"], expected["decision"]["pValue"], delta=1e-9)
        if jsonschema:
            self.assertEqual(schema_violations(report), [])


class MseReductionMemberTests(unittest.TestCase):
    """#136: the optional "beats the mean baseline" member and its fail direction."""

    def plan(self, band, cluster=False):
        return st.validate_plan({**({"clusterField": "site"} if cluster else {}), "criteria": [{"id": "r", "kind": "regression_performance", "members": [{"metric": "rmse", "band": {"upper": 1.2}}, {"metric": "mse_reduction", "band": band}]}]})

    def test_band_rules(self):
        self.plan({"lower": 0})
        self.plan({"lower": 0.25})
        for band in ({"lower": -0.1}, {"upper": 1.0}, {"lower": 0, "upper": 1.0}):
            with self.assertRaises(st.StatisticsError, msg=band):
                self.plan(band)
        with self.assertRaisesRegex(st.StatisticsError, "at most 3"):
            st.validate_plan({"criteria": [{"id": "r", "kind": "regression_performance", "members": [{"metric": m, "band": {"upper": 1}} for m in ("mae", "rmse")] + [{"metric": "mse_reduction", "band": {"lower": 0}}] * 2}]})

    def test_a_model_worse_than_the_mean_fails_and_a_good_one_passes(self):
        worse = st.evaluate_plan(st.plan_for(golden("GC-59")), golden("GC-59")["data"])["criteria"][0]
        self.assertEqual((worse["outcome"], worse["decision"]["decidingMemberId"]), ("fail", "mse_reduction"))
        targets = [10.0 + 0.5 * ((i % 5) - 2) for i in range(60)]
        errors = [0.1 * (1 + i % 3) * (-1.0) ** i for i in range(60)]
        better = st.evaluate_plan(self.plan({"lower": 0}), {"kind": "regression", "targets": targets, "errors": errors})["criteria"][0]
        self.assertEqual(better["outcome"], "pass")
        member = better["members"][1]
        self.assertAlmostEqual(member["estimate"], 0.5 - sum(e * e for e in errors) / 60, delta=1e-12)
        # Without targets the member is undefined and blocks a pass.
        blind = st.evaluate_plan(self.plan({"lower": 0}), {"kind": "regression", "errors": errors})["criteria"][0]
        self.assertEqual((blind["members"][1]["status"], blind["outcome"]), ("undefined", "inconclusive"))

    def test_clustered_member_uses_the_shared_replicates(self):
        case = golden("GC-55")
        plan = self.plan({"lower": 0}, cluster=True)
        plan["criteria"][0]["members"][0]["band"] = {"lower": None, "upper": 0.6}
        data = {**case["data"], "clusters": [{**part, "cluster": part["cluster"]} for part in case["data"]["clusters"]]}
        result = st.evaluate_plan(plan, data)["criteria"][0]
        member = result["members"][1]
        self.assertEqual(member["interval"]["method"], "cluster_percentile_bootstrap")
        self.assertEqual(member["bootstrap"]["clusters"], 60)
        gate = next(e for e in result["descriptive"] if e["metric"] == "baseline_rmse")["counts"]
        self.assertAlmostEqual(member["estimate"], gate["meanSquaredErrorReduction"], delta=1e-12)
        self.assertEqual(member["direction"], "pass")
        # The member and the gate test the same statistic on the same replicates.
        self.assertAlmostEqual(member["pValue"], gate["gatePValue"], delta=1e-12)

    def test_power_needs_the_target_sd(self):
        criterion = {"id": "r", "kind": "regression_performance", "members": [{"metric": "mse_reduction", "band": {"lower": 0}}], "powerAssumptions": {"n": 120, "errorSd": 1.0}}
        missing = st.evaluate_power({"kind": "criterion", "criterion": criterion})
        self.assertEqual((missing["status"], missing["members"][0]["reasons"]), ("not_computed", ["power_not_specified_for_metric"]))
        criterion["powerAssumptions"]["targetSd"] = 1.1
        computed = st.evaluate_power({"kind": "criterion", "criterion": criterion})
        self.assertAlmostEqual(computed["members"][0]["passProbability"], golden("GC-58")["expected"]["members"][2]["passProbability"], delta=1e-12)
        self.assertEqual([m["memberId"] for m in computed["members"]], ["mse_reduction"])


if __name__ == "__main__":
    unittest.main()
