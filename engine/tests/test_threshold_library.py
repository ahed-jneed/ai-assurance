"""The engine loads the threshold library (docs/design/audit-statistics.md section 10.1, #113).

schemas/threshold-library.json is the only place the library is written down.
engine/threshold-library.json and site-app/lib/threshold-library.json are its
generated copies (npm run sync in site-app/); engine/statistics.py reads the
copy beside it, so the compute image built from engine/ carries the library,
and the hosted runner reads its own copy. A plan that names an entry therefore
normalises to the same band and shows the same legal status and caveat in both
runners.
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from engine import statistics as st

ROOT = Path(__file__).resolve().parents[2]
CANONICAL = ROOT/"schemas"/"threshold-library.json"
LIBRARY = json.loads(CANONICAL.read_text(encoding="utf-8"))
CRITERION_KINDS = {"performance", "multiclass_performance", "regression_performance", "group_comparison", "calibration"}
FIELDS = ("version", "kind", "metric", "parameters", "legalStatus", "caveat")


class ThresholdLibraryTests(unittest.TestCase):
    def test_engine_copy_is_the_canonical_file(self):
        self.assertEqual(st.LIBRARY_FILE, ROOT/"engine"/"threshold-library.json")
        self.assertEqual(st.LIBRARY_FILE.read_bytes(), CANONICAL.read_bytes(), "run npm run sync in site-app/")

    def test_engine_loads_every_decidable_entry(self):
        decidable = {e["id"]: {key: e[key] for key in FIELDS} for e in LIBRARY["entries"] if e["kind"] in CRITERION_KINDS}
        self.assertEqual(decidable, st.LIBRARY)
        self.assertEqual(set(st.CRITERION_KINDS), CRITERION_KINDS)

    def test_the_data_decides_the_caveat_and_parameter_ranges(self):
        # An edited library changes what the engine accepts, without a code change.
        data = json.loads(CANONICAL.read_text(encoding="utf-8"))
        entry = next(e for e in data["entries"] if e["id"] == "policy.eu-aia.selection-rate-difference")
        entry["parameters"]["delta"]["maximum"] = 0.5
        entry["caveat"] = "Edited caveat."
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"library.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            edited = st.load_library(path)
        self.assertEqual(edited["policy.eu-aia.selection-rate-difference"]["caveat"], "Edited caveat.")
        self.assertNotIn("policy.eu-aia.art50-marking-presence", edited)
        self.assertNotIn("report.us-nyc.ll144", edited)
        criterion = {"id": "parity", "kind": "group_comparison", "metric": "selection_rate_difference",
                     "libraryEntry": {"id": "policy.eu-aia.selection-rate-difference", "parameters": {"delta": 0.4}}}
        with self.assertRaisesRegex(st.StatisticsError, "outside its range"):
            st.normalize_criterion(criterion)
        with patch.object(st, "LIBRARY", edited):
            normalized = st.normalize_criterion(criterion)
        self.assertEqual(normalized["band"], {"lower": -0.4, "upper": 0.4})
        self.assertEqual(normalized["libraryEntry"]["overriddenParameters"], ["delta"])

    def test_declared_performance_metrics_are_the_binary_metrics(self):
        rule = st.LIBRARY["policy.eu-aia.declared-performance"]["parameters"]["metric"]
        self.assertEqual(tuple(rule["enum"]), st.BINARY_METRICS)

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
