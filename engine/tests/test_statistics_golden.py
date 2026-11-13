"""Core-level golden tests: every case of schemas/fixtures/statistics-golden.json.

The fixture is the arbiter of docs/design/audit-statistics.md (statistics 1.0.0).
Numbers match within the fixture's tolerances, p-values within its absolute plus
relative tolerance, reasons as sets, and everything else exactly, including the
normalised plan and its RFC 8785 SHA-256.
"""
import json
import math
import unittest
from pathlib import Path

from engine import statistics as st

FIXTURE = Path(__file__).resolve().parents[2]/"schemas"/"fixtures"/"statistics-golden.json"
GOLDEN = json.loads(FIXTURE.read_text(encoding="utf-8"))
TOLERANCES = GOLDEN["tolerances"]


def public(value):
    """Drop the private helpers the core attaches to members (keys starting with an underscore)."""
    if isinstance(value, dict):
        return {key: public(item) for key, item in value.items() if not key.startswith("_")}
    if isinstance(value, list):
        return [public(item) for item in value]
    return value


def compute(case):
    kind = case["type"]
    if kind == "plan":
        return st.evaluate_plan(st.plan_for(case), case["data"])
    if kind == "derivation":
        plan = st.plan_for(case)
        return {"planSha256": st.plan_sha256(plan), "normalizedPlan": plan}
    if kind == "multiplicity":
        given = case["input"]
        adjusted = (st.bonferroni if given["method"] == "bonferroni" else st.benjamini_hochberg)(given["pValues"])
        return {"adjustedPValues": adjusted, "rejected": [value <= given["alpha"] + st.EPS for value in adjusted]}
    if kind == "power":
        return st.evaluate_power(case["input"])
    if kind == "ll144":
        return st.evaluate_ll144(case["input"])
    if kind == "fisher":
        return {"pValues": [st.fisher_two_sided(t["subject"]["x"], t["subject"]["n"], t["comparator"]["x"], t["comparator"]["n"]) for t in case["input"]["tables"]]}
    raise AssertionError("unknown golden case type " + kind)


def close(actual, expected, key):
    if isinstance(actual, bool) or isinstance(expected, bool) or actual is None or expected is None or isinstance(actual, str) or isinstance(expected, str):
        return actual == expected
    if isinstance(actual, int) and isinstance(expected, int):
        return actual == expected
    if "pvalue" in key.lower() or "fisher" in key.lower() or "chanceexactp" in key.lower():
        return abs(actual - expected) <= TOLERANCES["pValueAbsolute"] + TOLERANCES["pValueRelative"] * abs(expected)
    return abs(actual - expected) <= TOLERANCES["estimate"]


def differences(actual, expected, path="", out=None, exact=False):
    """Paths where actual differs from expected. Inside normalizedPlan every value must match exactly."""
    out = [] if out is None else out
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            out.append(f"{path}: keys differ ({sorted(set(actual) ^ set(expected)) if isinstance(actual, dict) else type(actual).__name__})")
            return out
        for key in expected:
            if key == "reasons":
                if set(actual[key]) != set(expected[key]):
                    out.append(f"{path}.{key}: {actual[key]} != {expected[key]}")
            else:
                differences(actual[key], expected[key], f"{path}.{key}", out, exact or key == "normalizedPlan")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            out.append(f"{path}: list length differs")
        else:
            for index, (left, right) in enumerate(zip(actual, expected)):
                differences(left, right, f"{path}[{index}]", out, exact)
    elif exact:
        if actual != expected or type(actual) is not type(expected) and not (isinstance(actual, (int, float)) and isinstance(expected, (int, float)) and actual == expected):
            out.append(f"{path}: {actual!r} != {expected!r} (exact)")
    elif not close(actual, expected, path):
        out.append(f"{path}: {actual!r} != {expected!r}")
    return out


class GoldenFixtureTests(unittest.TestCase):
    def test_fixture_shape(self):
        self.assertEqual(GOLDEN["specificationVersion"], st.SPEC_VERSION)
        self.assertEqual(len(GOLDEN["cases"]), 62)
        self.assertEqual(GOLDEN["defaults"]["minimums"], st.FLOORS)

    def test_every_case_reproduces_at_core_level(self):
        for case in GOLDEN["cases"]:
            with self.subTest(case=case["id"], type=case["type"]):
                problems = differences(public(compute(case)), case["expected"])
                self.assertEqual(problems, [], case["id"])

    def test_plan_hashes_are_recomputed_from_the_canonical_bytes(self):
        for case in GOLDEN["cases"]:
            if "planSha256" in case["expected"]:
                with self.subTest(case=case["id"]):
                    plan = case["expected"]["normalizedPlan"]
                    self.assertEqual(st.plan_sha256(plan), case["expected"]["planSha256"])
                    # Normalising a normalised plan returns it unchanged (section 9.2).
                    self.assertEqual(st.normalize_plan(plan), plan)

    def test_numerics(self):
        for entry in GOLDEN["numerics"]["normalQuantiles"]:
            self.assertAlmostEqual(st.zcrit(entry["twoSidedLevel"]), entry["z"], delta=1e-9)
        # The fixture stores 12 significant digits, so the comparison allows their rounding.
        for entry in GOLDEN["numerics"]["erfc"]:
            self.assertLessEqual(abs(math.erfc(entry["x"]) - entry["value"]), 1e-11 * entry["value"])


class CoreBehaviourTests(unittest.TestCase):
    def test_jcs_number_serialisation_matches_ecmascript(self):
        for value, text in [(1.0, "1"), (0.95, "0.95"), (1e21, "1e+21"), (1e20, "100000000000000000000"), (1e-7, "1e-7"), (0.000001, "0.000001"), (-0.0, "0"), (123456789012, "123456789012"), (5e-324, "5e-324")]:
            self.assertEqual(st.jcs_number(value), text)
        self.assertEqual(st.jcs({"b": 1, "a": [True, None, "é"]}), '{"a":[true,null,"é"],"b":1}')
        with self.assertRaises(ValueError):
            st.jcs_number(float("nan"))

    def test_minimums_below_the_floors_are_rejected(self):
        plan = {"minimums": {"sampleSize": 20}, "criteria": [{"id": "c", "kind": "performance", "members": [{"metric": "accuracy", "band": {"lower": 0.8}}]}]}
        with self.assertRaises(st.StatisticsError):
            st.normalize_plan(plan)

    def test_fisher_matches_known_tables(self):
        self.assertAlmostEqual(st.fisher_two_sided(6, 20, 10, 20), 0.33325, places=4)
        self.assertEqual(st.fisher_two_sided(1, 10, 1, 10), 1.0)
        self.assertAlmostEqual(st.fisher_greater(1, 100, 1, 2000), 0.05, places=12)

    def test_closed_form_zstar_agrees_with_bisection(self):
        band = {"lower": 0.7, "upper": None}
        closed = st.wilson_zstar(40, 50, band, "pass")
        bisected = st.invert(lambda z: st.wilson(40, 50, z), band, "pass")
        self.assertAlmostEqual(closed, bisected, delta=1e-8)
        ratio_band = {"lower": 0.8, "upper": 1.25}
        se = math.sqrt(1/150 - 1/300 + 1/150 - 1/300)
        closed = st.log_zstar(1.0, se, ratio_band, "pass")
        bisected = st.invert(lambda z: st.katz(150, 300, 150, 300, z), ratio_band, "pass")
        self.assertAlmostEqual(closed, bisected, delta=1e-8)


if __name__ == "__main__":
    unittest.main()
