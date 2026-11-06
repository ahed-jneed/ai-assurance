"""End-to-end golden tests: every endToEnd.engine case of schemas/fixtures/statistics-golden.json.

Each case is expanded into rows (howToUse.rowExpansion) and run through
engine.diagnostics.run(): an explicit plan as a 1.3 configuration, an
engine_thresholds case as its legacy 1.0 configuration, and a hosted_config case
through the worker's translation of a hosted engineConfig 1.1 request. The
report's results are mapped back to the fixture's shape (section 11.4) and must
reproduce the expected criteria, plan, plan hash, run outcome and review flags.
"""
import csv
import json
import tempfile
import unittest
from pathlib import Path

from engine import statistics as st
from engine.contract import validate_report
from engine.diagnostics import run
from engine.tests.test_statistics_golden import GOLDEN, differences, public

try:
    import jsonschema
except ImportError:  # Installed by engine/requirements-dev.txt.
    jsonschema = None

CASES = [case for case in GOLDEN["cases"] if case["endToEnd"]["engine"]]
TASKS = {"multiclass": "multiclass_classification", "regression": "regression"}


def expand(data):
    """Rows (actual, predicted, group, score) from the case data, exactly as howToUse.rowExpansion states."""
    rows = []
    if "groups" in data:
        for g in data["groups"]:
            if "selected" in g:
                pairs = [("1", "1", g["selected"]), ("0", "0", g["n"] - g["selected"])]
            else:
                pairs = [("1", "1", g["tp"]), ("0", "1", g["fp"]), ("1", "0", g["fn"]), ("0", "0", g["tn"])]
            rows += [{"actual": a, "predicted": p, "group": g["group"]} for a, p, count in pairs for _ in range(count)]
        rows += [{"actual": "0", "predicted": "0", "group": ""} for _ in range(data.get("unknownGroupRows", 0))]
    elif "bins" in data:
        for b in data["bins"]:
            prediction = "1" if b["meanScore"] >= 0.5 else "0"
            rows += [{"actual": "1" if i < b["positives"] else "0", "predicted": prediction, "score": repr(b["meanScore"])} for i in range(b["n"])]
    elif data.get("kind") == "multiclass":
        labels = data["labels"]
        rows += [{"actual": labels[i], "predicted": labels[j]} for i, row in enumerate(data["matrix"]) for j, count in enumerate(row) for _ in range(count)]
    else:
        targets = data.get("targets") or [0.0] * len(data["errors"])
        rows += [{"actual": repr(t), "predicted": repr(t + e)} for t, e in zip(targets, data["errors"])]
    return rows


def plan_configuration(case):
    data, plan = case["data"], case["plan"]
    kinds = {c["kind"] for c in plan["criteria"]}
    task = TASKS.get(data.get("kind"), "binary_classification")
    columns = {"target": "actual", "prediction": "predicted"}
    if "groups" in data:
        columns["protected"] = "group"
    if "bins" in data:
        columns["score"] = "score"
    suite = (["performance"] if kinds - {"group_comparison"} else []) + (["fairness"] if "group_comparison" in kinds else [])
    config = {"contractVersion": "1.3", "id": "run-" + case["id"].lower(), "engagementId": "eng-golden", "modelId": "model-golden", "datasetId": "data-golden", "task": task, "suite": suite, "seed": 1729, "columns": columns, "statistics": plan, "thresholds": {"policyId": "golden-plan", "policyVersion": "1", "source": "internal_policy", "values": {}}}
    if task == "binary_classification":
        config.update(positiveLabel="1", negativeLabel="0")
    return config


def fixture_view(result, criterion):
    """Map a report result back to the fixture's criterion shape (the inverse of section 11.4)."""
    metrics = result["metrics"]
    headline = groups = None
    if criterion["kind"] in ("group_comparison", "calibration"):
        top = metrics[0]
        metric = "calibration" if criterion["kind"] == "calibration" else criterion["metric"]
        if top["value"] is not None:
            headline = {"names": st.HEADLINE_NAMES[metric], "estimate": top["value"], "interval": top["confidenceInterval"], "band": top["details"]["band"]}
        groups = [group_view(s) for s in top["slices"]]

    def entry(m):
        d = m["details"]
        return {"memberId": "balanced_accuracy" if m["name"] == "macro_recall" else m["name"], "metric": d["metric"], "subject": d["subject"], "comparator": d["comparator"], "counts": d["counts"], "estimate": m["value"], "interval": m["confidenceInterval"], "band": d["band"], "status": d["status"], "direction": d["direction"], "pValue": m["pValue"], "smallCell": d["smallCell"], "fisherExactP": d["fisherExactP"], "chanceExactP": d["chanceExactP"], "reasons": d["reasons"]}

    members = [entry(m) for m in metrics if m["details"]["role"] == "member"]
    descriptive = [entry(m) for m in metrics if m["details"]["role"] == "descriptive"]
    return {"id": result["testId"], "outcome": result["outcome"], "headline": headline, "members": members, "descriptive": descriptive, "groups": groups, "decision": result["decision"]}


def group_view(s):
    out = {"group": s["slice"], "n": s["n"], "declared": s["declared"], "suppressed": s["suppressed"]}
    for key, estimate in (("selection", "selectionRate"), ("tpr", "tpr"), ("fpr", "fpr")):
        if f"{key}Numerator" in s:
            out[key] = {"x": s[f"{key}Numerator"], "n": s[f"{key}Denominator"], "estimate": s[estimate], "interval": s[f"{key}ConfidenceInterval"]}
    if "observedRate" in s:
        out["observed"] = {"x": s["numerator"], "n": s["denominator"], "estimate": s["observedRate"], "interval": s["confidenceInterval"]}
        out["meanScore"] = s["meanProbability"]
    return out


def comparable(view, expected):
    """End-to-end additions the core level leaves out: bootstrap intervals for ECE and R2 (null at core level)
    and the descriptive Brier score, which needs row-level scores (section 4.8), and the supplementary
    descriptive entries of test definitions traditional-ml-2.1.0 (prevalence, majority-class baseline)."""
    view = json.loads(json.dumps(view))
    view["descriptive"] = [e for e in view["descriptive"] if e["memberId"] not in ("brier_score", "prevalence", "majority_baseline_accuracy")]
    for e in view["descriptive"]:
        if e["metric"] in ("expected_calibration_error", "r2"):
            e["interval"] = None
            e["reasons"] = [r for r in e["reasons"] if not r.startswith("bootstrap_")]
    return view


class EndToEndGoldenTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def report_for(self, case):
        rows = expand(case["data"])
        path = self.directory / (case["id"] + ".csv")
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        legacy = case.get("legacy")
        if legacy is None:
            return run(path, plan_configuration(case))
        if legacy["source"] == "engine_thresholds":
            return run(path, legacy["config"])
        from engine.tests.test_worker import translated_report
        return translated_report(path, legacy)

    def test_every_engine_case_reproduces_end_to_end(self):
        self.assertGreaterEqual(len(CASES), 36)
        for case in CASES:
            with self.subTest(case=case["id"]):
                report = self.report_for(case)
                validate_report(report)
                expected = case["expected"]
                plan = report["configuration"]["statistics"]
                self.assertEqual(plan, expected["normalizedPlan"])
                self.assertEqual(report["provenance"]["statisticsPlanSha256"], expected["planSha256"])
                decided = [r for r in report["results"] if "decision" in r]
                self.assertEqual([r["testId"] for r in decided], [c["id"] for c in expected["criteria"]])
                for result, criterion, wanted in zip(decided, plan["criteria"], expected["criteria"]):
                    view = comparable(public(fixture_view(result, criterion)), wanted)
                    self.assertEqual(differences(view, wanted), [], f"{case['id']} {criterion['id']}")
                self.assertEqual(report["outcome"], expected["overallOutcome"])
                self.assertEqual(report["reviewFlags"], expected["reviewFlags"])

    @unittest.skipUnless(jsonschema, "jsonschema is not installed; install engine/requirements-dev.txt")
    def test_end_to_end_reports_validate_against_the_run_schema(self):
        from engine.tests.test_diagnostics import schema_violations
        for case in CASES:
            if case.get("legacy") is None and case["id"] in ("GC-09", "GC-16", "GC-24", "GC-30", "GC-31", "GC-34", "GC-35"):
                with self.subTest(case=case["id"]):
                    self.assertEqual(schema_violations(self.report_for(case)), [])

    def test_calibration_end_to_end_adds_brier_and_a_bootstrap_budget_reason(self):
        case = next(c for c in CASES if c["id"] == "GC-24")
        result = self.report_for(case)["results"][0]
        names = [m["name"] for m in result["metrics"]]
        self.assertEqual(names[0], "maximum_calibration_gap")
        self.assertIn("brier_score", names)
        ece = next(m for m in result["metrics"] if m["name"] == "expected_calibration_error")
        # 3,620 rows x 2,000 replicates exceeds the 5,000,000 descriptive budget (section 5.11).
        self.assertIsNone(ece["confidenceInterval"])
        self.assertIn("bootstrap_budget_exceeded", ece["details"]["reasons"])
        self.assertEqual(result["metrics"][0]["slices"][0]["lower"], 0.0)


if __name__ == "__main__":
    unittest.main()
