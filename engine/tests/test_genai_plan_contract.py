"""The genai-plan/0.1 contract shared with the workspace (#248).

engine/tests/fixtures/genai/plan-contract.json lists valid and invalid plans. The engine's
normalize_plan accepts every valid plan and refuses every invalid one with plan_invalid, naming
the location the fixture names; site-app/lib/genai/plan-contract.test.ts holds the workspace's
check before it freezes a plan to the same cases, so a plan the workspace freezes never fails its
ingest job as plan_invalid.
"""
from __future__ import annotations

import json
import unittest

from engine.genai import plan as plans
from engine.genai.errors import GenaiInputError
from engine.tests import genai_support as gs

CONTRACT = json.loads((gs.FIXTURES / "plan-contract.json").read_text(encoding="utf-8"))


class PlanContract(unittest.TestCase):
    def test_accepts_every_valid_plan(self):
        self.assertGreater(len(CONTRACT["valid"]), 0)
        for case in CONTRACT["valid"]:
            with self.subTest(case["name"]):
                plan = plans.normalize_plan(case["plan"])
                self.assertEqual([c["id"] for c in plan["criteria"]], [c["id"] for c in case["plan"]["criteria"]])

    def test_refuses_every_invalid_plan_where_the_fixture_says(self):
        self.assertGreater(len(CONTRACT["invalid"]), 0)
        for case in CONTRACT["invalid"]:
            with self.subTest(case["name"]):
                with self.assertRaises(GenaiInputError) as raised:
                    plans.normalize_plan(case["plan"])
                self.assertEqual(raised.exception.code, "plan_invalid")
                self.assertIn(case["engine"], str(raised.exception))

    def test_case_names_are_unique(self):
        names = [c["name"] for c in CONTRACT["valid"] + CONTRACT["invalid"]]
        self.assertEqual(len(names), len(set(names)))


if __name__ == "__main__":
    unittest.main()
