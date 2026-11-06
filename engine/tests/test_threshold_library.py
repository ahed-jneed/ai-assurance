"""The engine mirrors schemas/threshold-library.json (docs/design/audit-statistics.md section 10.1).

The hosted runner reads the library file (site-app/lib/threshold-library.json is
its generated copy); engine/statistics.py keeps the entries a plan criterion can
reference. Both runners must ship the same entries, so a plan that names one
normalises to the same band and shows the same legal status and caveat.
"""
import json
import unittest
from pathlib import Path

from engine import statistics as st

LIBRARY = json.loads((Path(__file__).resolve().parents[2]/"schemas"/"threshold-library.json").read_text(encoding="utf-8"))
CRITERION_KINDS = {"performance", "multiclass_performance", "regression_performance", "group_comparison", "calibration"}
FIELDS = ("version", "kind", "metric", "parameters", "legalStatus", "caveat")


class ThresholdLibraryTests(unittest.TestCase):
    def test_engine_mirrors_every_decidable_entry(self):
        decidable = {e["id"]: {key: e[key] for key in FIELDS} for e in LIBRARY["entries"] if e["kind"] in CRITERION_KINDS}
        self.assertEqual(decidable, st.LIBRARY)

    def test_entries_are_versioned_with_timeless_caveats_and_dated_notes(self):
        ids = [e["id"] for e in LIBRARY["entries"]]
        self.assertEqual(len(ids), len(set(ids)))
        for entry in LIBRARY["entries"]:
            self.assertIn(entry["legalStatus"], {"screening_heuristic", "reporting_only", "no_legal_safe_harbour"})
            self.assertTrue(entry["caveat"])
            for note in entry["statusNotes"]:
                self.assertRegex(note["asOf"], r"^\d{4}-\d{2}-\d{2}$")

    def test_article_50_entries_are_internal_policies(self):
        art50 = [e for e in LIBRARY["entries"] if e["id"].startswith("policy.eu-aia.art50-")]
        self.assertEqual(len(art50), 5)
        for entry in art50:
            self.assertEqual(entry["legalStatus"], "no_legal_safe_harbour")
            self.assertNotIn(entry["kind"], CRITERION_KINDS, "no runner decides Art 50 evidence before M2")


if __name__ == "__main__":
    unittest.main()
