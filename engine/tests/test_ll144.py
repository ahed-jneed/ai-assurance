"""NYC Local Law 144 golden cases (schemas/fixtures/ll144-golden.json) through engine/ll144.py.

site-app/lib/ll144.test.ts runs the same cases through the hosted runner, so both agree on every case.
docs/design/ll144-golden-verify.py recomputes the expected values independently.
"""
import json
import unittest
from pathlib import Path

from engine import ll144, statistics as st

FIXTURE = Path(__file__).resolve().parents[2]/"schemas"/"fixtures"/"ll144-golden.json"
GOLDEN = json.loads(FIXTURE.read_text(encoding="utf-8"))


def differences(actual, expected, path="", out=None, key=""):
    out = [] if out is None else out
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            out.append(f"{path}: keys differ")
            return out
        for k in expected:
            differences(actual[k], expected[k], f"{path}.{k}", out, k)
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            out.append(f"{path}: length differs")
        else:
            for i, (a, e) in enumerate(zip(actual, expected)):
                differences(a, e, f"{path}[{i}]", out, key)
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool) and isinstance(actual, (int, float)) and not isinstance(actual, bool):
        tolerance = GOLDEN["tolerances"]["interval" if key in ("lower", "upper") else "number"]
        if abs(actual - expected) > tolerance:
            out.append(f"{path}: {actual} != {expected}")
    elif actual != expected or type(actual) is not type(expected):
        out.append(f"{path}: {actual!r} != {expected!r}")
    return out


class GoldenCases(unittest.TestCase):
    def test_every_case_reproduces(self):
        self.assertEqual(len(GOLDEN["cases"]), 5)
        for case in GOLDEN["cases"]:
            with self.subTest(case["id"]):
                self.assertEqual(differences(ll144.ll144_audit(case["input"]), case["expected"]), [])

    def test_error_cases_are_rejected(self):
        for case in GOLDEN["errorCases"]:
            with self.subTest(case["id"]):
                with self.assertRaises(ll144.Ll144Error) as raised:
                    ll144.ll144_audit(case["input"])
                self.assertIn(case["error"], str(raised.exception))

    def test_the_dcwp_race_table_equals_gc32(self):
        statistics = json.loads((FIXTURE.parent/"statistics-golden.json").read_text(encoding="utf-8"))
        gc32 = next(c for c in statistics["cases"] if c["id"] == "GC-32")
        case = next(c for c in GOLDEN["cases"] if c["id"] == "LL-04")
        race = ll144.ll144_audit(case["input"])["tables"][1]
        self.assertEqual(differences([{k: v for k, v in row.items() if k not in ("components", "exclusionJustification")} for row in race["categories"]], gc32["expected"]["categories"]), [])
        self.assertEqual((race["referenceCategory"], race["unknownCategoryCount"], race["totalIndividuals"]), ("White", 250, 2834))

    def test_the_median_counts_the_unknown_category(self):
        case = next(c for c in GOLDEN["cases"] if c["id"] == "LL-02")
        self.assertEqual(ll144.ll144_audit(case["input"])["medianScore"], 5.0)
        known = {**case["input"], "records": [r for r in case["input"]["records"] if r["sex"] is not None]}
        self.assertEqual(ll144.ll144_audit(known)["medianScore"], 4.5)

    def test_median_of_counted_pairs(self):
        self.assertEqual(ll144.median([(3.0, 1), (1.0, 2)]), 1.0)
        self.assertEqual(ll144.median([(1.0, 2), (3.0, 2)]), 2.0)
        self.assertEqual(ll144.median([(2.5, 1)]), 2.5)

    def test_blank_categories_are_unknown_and_labels_match_the_criteria_module(self):
        out = ll144.ll144_audit({"rate": "selection", "records": [{"sex": " ", "raceEthnicity": "Asian", "selected": True}, {"sex": "Male", "raceEthnicity": "Asian", "selected": False}]})
        self.assertEqual(out["tables"][0]["unknownCategoryCount"], 1)
        self.assertEqual(out["tables"][2]["categories"][0]["category"], '["Male","Asian"]')
        from engine import criteria
        self.assertEqual(ll144.category_label(["Male", "Asian"]), criteria.group_label(["Male", "Asian"]))

    def test_the_statistics_table_keeps_its_selection_shape(self):
        table = st.evaluate_ll144({"categories": [{"name": "a", "n": 0, "selected": 0}, {"name": "b", "n": 4, "selected": 2}]})
        self.assertEqual(table["referenceCategory"], "b")
        self.assertIsNone(table["categories"][0]["selectionRate"])
        with self.assertRaises(st.StatisticsError):
            st.evaluate_ll144({"categories": []})


if __name__ == "__main__":
    unittest.main()
