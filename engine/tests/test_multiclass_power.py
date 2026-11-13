"""Multiclass power assumptions (docs/design/audit-statistics.md section 8, #113).

The testing lab now enters a share and a recall for every class of the target
column. site-app/app/power-assumptions.test.ts runs the same criterion through
the hosted runner's criterionPower and expects the same numbers (CASE below).
"""
import unittest

from engine import statistics as st

# A multiclass criterion without macro F1, so every member has a formula and the criterion is computed.
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

    def test_macro_f1_keeps_the_criterion_not_computed(self):
        # The testing lab's multiclass plan also has macro F1, which has no formula in 1.0.0 (GC-43).
        case = with_assumptions()
        case["criterion"]["members"] = [*case["criterion"]["members"], {"metric": "macro_f1", "band": {"lower": 0.7, "upper": None}}]
        power = st.evaluate_power(case)
        self.assertEqual((power["status"], power["reasons"]), ("not_computed", ["member_power_not_computed"]))
        self.assertEqual([m["status"] for m in power["members"]], ["computed", "computed", "not_computed"])

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
