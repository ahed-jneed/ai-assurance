import copy
import json
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
from pathlib import Path

from engine.adapters import Feature, ModelDescriptor
from engine.connectors import readonly_sqlite, sqlite_snapshot
from engine.contract import validate_report
from engine.diagnostics import run, sha256, validate_config
from engine.model_diagnostics import permutation_importance, perturbation
from engine.optional_adapters import NativeTreeAdapter, load_adapter, require_artifact
from engine.tests.test_diagnostics import config


class TrustedThresholdAdapter:
    """Application-owned test predictor; never loaded from an uploaded artifact."""
    runtime_packages = ()
    def __init__(self):
        self.spec = {"task": "binary_classification", "featureColumns": ["x", "noise"], "outputLabels": ["0", "1"]}
        self.descriptor = ModelDescriptor(sha256(b"application-owned-test-model"), "test_numeric", "binary_classification", (Feature("x", "float64"), Feature("noise", "float64")), ("0", "1"), "test-1")
        self.capabilities = frozenset({"predict"})

    def predict(self, records):
        return ["1" if row["x"] >= 0.5 else "0" for row in records]


class ConnectorAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def database(self):
        path = self.directory / "source.db"
        with closing(sqlite3.connect(path)) as connection:
            with connection:
                connection.execute("CREATE TABLE predictions (id INTEGER PRIMARY KEY, actual TEXT, predicted TEXT, feature REAL)")
                connection.executemany("INSERT INTO predictions VALUES (?, ?, ?, ?)", [(1, "0", "0", 0.1), (2, "1", "1", 0.8), (3, "0", "1", 0.7)])
        return path

    def test_sql_snapshot_read_only_bounds_and_integrity(self):
        path = self.database()
        spec = {"table": "predictions", "columns": ["id", "actual", "predicted"], "orderBy": "id", "boundColumn": "id", "lower": 1, "upper": 3, "limit": 10}
        before = path.read_bytes()
        data, manifest = sqlite_snapshot(path, spec)
        self.assertEqual(data, b"id,actual,predicted\n1,0,0\n2,1,1\n")
        self.assertEqual(manifest["snapshotSha256"], sha256(data))
        self.assertEqual(path.read_bytes(), before)
        connection = readonly_sqlite(path)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("INSERT INTO predictions VALUES (4,'0','0',0.2)")
        finally:
            connection.close()

    def test_sql_injection_unknown_names_and_truncation_rejected(self):
        path = self.database()
        base = {"table": "predictions", "columns": ["id", "actual"], "orderBy": "id", "limit": 10}
        for modification in ({"table": 'predictions; DROP TABLE predictions'}, {"columns": ["id", "missing"]}, {"columns": [{}]}, {"sql": "DELETE FROM predictions"}, {"limit": 1}, {"boundColumn": "id", "lower": "1 OR 1=1"}, {"orderBy": "actual"}):
            with self.assertRaises(ValueError):
                sqlite_snapshot(path, {**base, **modification})

    def test_model_gate_precedes_optional_imports_and_pickle_is_prohibited(self):
        path = self.directory / "model.json"
        path.write_text('{"learner": {}}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "trusted-model"):
            load_adapter(path, "xgboost_json", {}, trusted_model=False)
        with self.assertRaisesRegex(ValueError, "pickle/joblib"):
            require_artifact(path, "pickle", True)
        invalid = self.directory / "invalid.json"
        invalid.write_text('{"pythonCode": "unsafe"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "native XGBoost"):
            require_artifact(invalid, "xgboost_json", True)
        pmml = self.directory / "model.pmml"
        pmml.write_text('<!DOCTYPE test><PMML/>', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "entities"):
            require_artifact(pmml, "pmml", True)

    def rows(self):
        return [{"actual": str(i % 2), "x": str(i % 2), "noise": str(i % 3)} for i in range(80)]

    def test_native_subprocess_timeout_is_sanitized(self):
        path = self.directory / "native.json"
        path.write_text('{"learner": {}}', encoding="utf-8")
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"]}
        with patch("engine.optional_adapters.importlib.metadata.version", return_value="test-installed-runtime"):
            adapter = NativeTreeAdapter(path, "xgboost_json", spec, trusted_model=True)
        with patch("engine.optional_adapters.subprocess.run", side_effect=subprocess.TimeoutExpired("fixed-native-worker", 60)):
            with self.assertRaisesRegex(ValueError, "60-second"):
                adapter.predict([{"x": 1.0}])

    def test_actual_seeded_permutation_distinguishes_signal_and_noise(self):
        adapter = TrustedThresholdAdapter()
        cfg = validate_config(config(suites=["permutation_importance"]))
        one = permutation_importance(self.rows(), cfg, adapter)
        two = permutation_importance(self.rows(), cfg, adapter)
        self.assertEqual(one, two)
        values = {m["details"]["feature"]: m["value"] for m in one["metrics"]}
        self.assertGreater(values["x"], 0.3)
        self.assertEqual(values["noise"], 0)
        self.assertEqual(one["outcome"], "inconclusive")

    def test_approved_perturbation_detects_loss_and_rejects_bad_domain(self):
        cfg = validate_config(config(suites=["perturbation"]))
        cfg["perturbation"] = {"approvalId": "domain-approval-test", "rationale": "Test domain ±1 measurement sensitivity", "features": {"x": {"lower": 0, "upper": 1, "delta": 1}}}
        diagnostic = perturbation(self.rows(), cfg, TrustedThresholdAdapter())
        self.assertEqual(diagnostic["metrics"][0]["value"], 0.5)
        cfg["perturbation"]["features"]["x"]["upper"] = 0.8
        with self.assertRaises(ValueError):
            perturbation(self.rows(), cfg, TrustedThresholdAdapter())
        del cfg["perturbation"]
        self.assertEqual(perturbation(self.rows(), cfg, TrustedThresholdAdapter())["outcome"], "inconclusive")

    def test_model_backed_common_contract_and_no_foreign_scores(self):
        path = self.directory / "features.csv"
        path.write_text("actual,x,noise,score\n"+"".join(f"{i%2},{i%2},{i%3},0.99\n" for i in range(80)), encoding="utf-8")
        adapter = TrustedThresholdAdapter()
        cfg = config(suites=["performance", "permutation_importance", "perturbation"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted", "score": "score"}
        cfg["modelSpec"] = adapter.spec
        report = run(path, cfg, adapter=adapter)
        validate_report(report)
        self.assertEqual(report["provenance"]["inputHashes"]["model"], adapter.descriptor.artifact_sha256)
        self.assertEqual(report["results"][1]["outcome"], "not_applicable")
        self.assertEqual(report["results"][2]["testId"], "EXPL-PERM")


if __name__ == "__main__":
    unittest.main()
