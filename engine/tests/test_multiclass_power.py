"""Multiclass power assumptions (docs/design/audit-statistics.md section 8, #113, #152).

The testing lab now enters a share and a recall for every class of the target
column. site-app/app/power-assumptions.test.ts runs the same criterion through
the hosted runner's criterionPower and expects the same numbers (CASE below).
"""
import json
import unittest
from pathlib import Path

from engine import statistics as st

try:
    import jsonschema
except ImportError:  # engine/requirements-dev.txt installs it; CI has it
    jsonschema = None

PLAN_SCHEMA = Path(__file__).resolve().parents[2]/"schemas"/"statistics-plan.schema.json"

# A multiclass criterion with accuracy and balanced accuracy; the macro members are added below (#152).
CASE = {
    "kind": "criterion",
    "criterion": {
        "id": "performance",
        "kind": "multiclass_performance",
        "members": [
            {"metric": "accuracy", "band": {"lower": 0.75, "upper": None}},
            {"metric": "balanced_accuracy", "band": {"lower": 0.7, "upper": None}},
        ],
        "powerAssumptions": {"n": 300, "classShares": {"a": 0.5, "b": 0.3, "c": 0.2}, "perClassRecall": {"a": 0.85, "b": 0.8, "c": 0.7}},
    },
}
EXPECTED = {"passProbability": 0.4948113668931178, "passProbabilityUpperBound": 0.6034697048198907, "requiredNForPass": 483,
            "members": {"accuracy": (0.805, 0.6034697048198907), "balanced_accuracy": (0.7833333333333333, 0.8913416620732271)}}
# CASE with macro F1 >= 0.7 and macro precision >= 0.7 added (#152).
MACRO = {"passProbabilityUpperBound": 0.07755466798616595, "requiredNForPass": 969,
         "members": {"macro_f1": (0.7800613945479498, 0.3629895303213081), "macro_precision": (0.777158419950862, 0.07755466798616595)}}


def with_assumptions(**changes):
    criterion = {**CASE["criterion"], "powerAssumptions": {**CASE["criterion"]["powerAssumptions"], **changes}}
    return {**CASE, "criterion": criterion}


class MulticlassPowerTests(unittest.TestCase):
    def test_per_class_assumptions_give_the_shared_numbers(self):
        power = st.evaluate_power(CASE)
        self.assertEqual(power["status"], "computed")
        self.assertEqual(power["reasons"], [])
        for key in ("passProbability", "passProbabilityUpperBound"):
            self.assertAlmostEqual(power[key], EXPECTED[key], delta=1e-12)
        self.assertEqual(power["requiredNForPass"], EXPECTED["requiredNForPass"])
        for member in power["members"]:
            value, probability = EXPECTED["members"][member["metric"]]
            self.assertAlmostEqual(member["assumedValue"], value, delta=1e-12)
            self.assertAlmostEqual(member["passProbability"], probability, delta=1e-12)
        self.assertEqual(power["members"][1]["denominator"], {"perClass": {"a": 150.0, "b": 90.0, "c": 60.0}})

    def test_macro_members_are_computed_under_the_even_spread_assumption(self):
        # The testing lab's multiclass plan also has macro F1; since #152 it has a formula (section 8, GC-43, GC-61,
        # GC-62). site-app/app/power-assumptions.test.ts expects the same numbers from the hosted runner.
        case = with_assumptions()
        case["criterion"]["members"] = [*case["criterion"]["members"], {"metric": "macro_f1", "band": {"lower": 0.7, "upper": None}}, {"metric": "macro_precision", "band": {"lower": 0.7, "upper": None}}]
        power = st.evaluate_power(case)
        self.assertEqual((power["status"], power["reasons"]), ("computed", []))
        self.assertEqual(power["passProbability"], 0.0)
        self.assertAlmostEqual(power["passProbabilityUpperBound"], MACRO["passProbabilityUpperBound"], delta=1e-12)
        self.assertEqual(power["requiredNForPass"], MACRO["requiredNForPass"])
        for member in power["members"][2:]:
            value, probability = MACRO["members"][member["metric"]]
            self.assertAlmostEqual(member["assumedValue"], value, delta=1e-12)
            self.assertAlmostEqual(member["passProbability"], probability, delta=1e-12)
        # Expected predicted counts: 300 x (TP share + the other classes' errors spread evenly).
        for label, count in {"a": 145.5, "b": 92.25, "c": 62.25}.items():
            self.assertAlmostEqual(power["members"][3]["denominator"]["perClass"][label], count, delta=1e-9)

    @unittest.skipIf(jsonschema is None, "jsonschema is not installed (engine/requirements-dev.txt)")
    def test_plan_schema_states_the_multiclass_rules_it_can(self):
        # schemas/statistics-plan.schema.json (#152): a share or recall outside (0, 1) and a single class are schema
        # errors; labels that differ and shares that do not sum to 1 are left to validate_plan, as its description says.
        schema = json.loads(PLAN_SCHEMA.read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator({"$schema": schema["$schema"], "$defs": schema["$defs"], "$ref": "#/$defs/multiclassAssumptions"})
        good = CASE["criterion"]["powerAssumptions"]
        self.assertTrue(validator.is_valid(good))
        for changes in ({"classShares": {"a": 0.0, "b": 0.5, "c": 0.5}}, {"perClassRecall": {"a": 1.0, "b": 0.8, "c": 0.7}}, {"classShares": {"a": 1.0}, "perClassRecall": {"a": 0.9}}):
            with self.subTest(changes=changes):
                self.assertFalse(validator.is_valid({**good, **changes}))
        self.assertIn("validate_plan", schema["$defs"]["multiclassAssumptions"]["description"])
        for changes, message in (({"perClassRecall": {"a": 0.85, "b": 0.8, "d": 0.7}}, "perClassRecall must name exactly the classes"), ({"classShares": {"a": 0.5, "b": 0.3, "c": 0.3}}, "class shares must sum to 1")):
            with self.subTest(changes=changes):
                self.assertTrue(validator.is_valid({**good, **changes}))
                plan = {"criteria": [{**CASE["criterion"], "powerAssumptions": {**good, **changes}}]}
                with self.assertRaisesRegex(st.StatisticsError, message):
                    st.validate_plan(plan)

    def test_even_spread_cells(self):
        cells = st.even_spread_cells([0.5, 0.3, 0.2], [0.85, 0.8, 0.7])
        expected = [[0.425, 0.0375, 0.0375], [0.03, 0.24, 0.03], [0.03, 0.03, 0.14]]
        for row, want in zip(cells, expected):
            for value, target in zip(row, want):
                self.assertAlmostEqual(value, target, delta=1e-15)
        # Two classes: every error goes to the other class.
        two = st.even_spread_cells([0.7, 0.3], [0.9, 0.5])
        for value, target in zip(two[0] + two[1], (0.63, 0.07, 0.15, 0.15)):
            self.assertAlmostEqual(value, target, delta=1e-15)

    def test_wilson_slope_matches_the_bound_numerically(self):
        for x, n, z in ((0.8, 120.0, 2.39), (0.2, 45.5, 2.13), (0.97, 300.0, 2.8)):
            for side, pick in ((-1, 0), (1, 1)):
                h = 1e-7
                numeric = (st.wilson((x + h) * n, n, z)[pick] - st.wilson((x - h) * n, n, z)[pick]) / (2 * h)
                self.assertAlmostEqual(st.wilson_slope(x, n, z, side), numeric, delta=1e-6)

    def test_a_class_never_predicted_has_no_planned_precision(self):
        # Class c is never recognised and the other classes never err, so nothing is predicted as c.
        case = with_assumptions(perClassRecall={"a": 1.0, "b": 1.0, "c": 0.0})
        case["criterion"]["members"] = [{"metric": "macro_precision", "band": {"lower": 0.5, "upper": None}}]
        member = st.evaluate_power(case)["members"][0]
        self.assertEqual((member["passProbability"], member["reasons"]), (0.0, ["planned_below_minimum"]))
        self.assertEqual(member["denominator"]["perClass"]["c"], 0.0)

    def test_assumptions_must_cover_every_class_with_a_positive_share(self):
        for changes, message in (
            ({"perClassRecall": {"a": 0.85, "b": 0.8}}, "perClassRecall must name exactly the classes"),
            ({"perClassRecall": {"a": 0.85, "b": 0.8, "c": 0.7, "d": 0.9}}, "perClassRecall must name exactly the classes"),
            ({"classShares": {"a": 0.8, "b": 0.2, "c": 0.0}}, "every class share must be above 0"),
            ({"classShares": {"a": 0.5, "b": 0.3, "c": 0.3}}, "class shares must sum to 1"),
        ):
            with self.subTest(changes=changes), self.assertRaisesRegex(st.StatisticsError, message):
                st.evaluate_power(with_assumptions(**changes))


if __name__ == "__main__":
    unittest.main()
