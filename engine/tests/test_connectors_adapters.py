import io
import json
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import closing
from unittest.mock import patch
from pathlib import Path

from engine import model_process
from engine.adapters import Feature, ModelDescriptor
from engine.connectors import readonly_sqlite, sqlite_snapshot
from engine.contract import validate_report
from engine.diagnostics import _inference, run, sha256, validate_config
from engine.errors import EngineError
from engine.model_diagnostics import permutation_importance, perturbation
from engine.optional_adapters import NativeTreeAdapter, NumericAdapter, load_adapter, require_artifact, scoring_failure_code
from engine.tests.test_diagnostics import config, jsonschema, schema_violations

try:
    import numpy
except ImportError:  # Installed by engine/requirements-dev.txt.
    numpy = None

requires_numpy = unittest.skipUnless(numpy, "numpy is not installed; install engine/requirements-dev.txt")
# Shape of a native LightGBM text model; the runtime itself is optional.
LIGHTGBM_MODEL = "tree\nversion=v4\nnum_class=1\nnum_tree_per_iteration=1\nlabel_index=0\nmax_feature_idx=0\nobjective={objective}\nfeature_names=x\n\nTree=0\nnum_leaves=1\n\nend of trees\n\nparameters:\n[objective: {objective}]\nend of parameters\n"


class FakeLightGBMBooster:
    """Like lightgbm.Booster(model_str=...): params stay empty after a string load."""
    def __init__(self, model_str):
        self.params = {}
        self.model_str = model_str

    def predict(self, matrix, num_threads):
        return numpy.asarray(matrix)[:, 0]


class FakeOnnxSession:
    """The part of onnxruntime.InferenceSession that ONNXAdapter uses."""
    def __init__(self, outputs):
        self.outputs = outputs

    def get_inputs(self):
        return [types.SimpleNamespace(name="features", type="tensor(double)", shape=[None, 1])]

    def get_outputs(self):
        return [types.SimpleNamespace(name=name) for name in self.outputs]

    def run(self, names, feeds):
        return [self.outputs[names[0]](feeds["features"])]


def out_of_memory(*_args, **_kwargs):
    """A native runtime call that runs out of memory."""
    raise MemoryError


def fake_onnxruntime():
    """Scores P(class "1") = x, as labels (internal 0.5 rule) or as (n, 2) probabilities."""
    outputs = {"label": lambda matrix: numpy.where(matrix[:, 0] >= .5, "1", "0"), "probabilities": lambda matrix: numpy.column_stack([1-matrix[:, 0], matrix[:, 0]])}
    return types.SimpleNamespace(SessionOptions=types.SimpleNamespace, InferenceSession=lambda *_args, **_kwargs: FakeOnnxSession(outputs))


# x is P(class "1"); with decisionThreshold 0.3 the deployed rule labels every
# row correctly, while a 0.5 rule (argmax, or the model's own labels) misses x=0.35.
THRESHOLD_ROWS = "actual,x\n"+"".join(f"{int(x >= .3)},{x}\n" for x in (.1, .35, .6, .9)*5)


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

    def lightgbm_payload(self, objective, task="binary_classification"):
        path = self.directory/"model.txt"
        path.write_text(LIGHTGBM_MODEL.format(objective=objective), encoding="utf-8")
        spec = {"task": task, "featureColumns": ["x"], "outputLabels": ["0", "1"] if task != "regression" else []}
        return {"path": str(path), "format": "lightgbm_text", "expectedSha256": sha256(path.read_bytes()), "spec": spec, "records": [{"x": 0.2}, {"x": 0.9}]}

    def test_lightgbm_objective_is_read_from_the_model_header(self):
        self.assertEqual(model_process.lightgbm_objective(LIGHTGBM_MODEL.format(objective="binary sigmoid:1")), "binary")
        self.assertEqual(model_process.lightgbm_objective(LIGHTGBM_MODEL.format(objective="multiclass num_class:3").replace("\n", "\r\n")), "multiclass")
        # Only the header counts: a parameters-section echo is not a declaration.
        for text in ("tree\nversion=v4\n\nTree=0\n\nend of trees\n\nparameters:\n[objective: binary]\nend of parameters\n", "tree\nobjective=\n\nTree=0\n", "tree\nobjective=binary\nobjective=regression\n\nTree=0\n"):
            with self.assertRaises(EngineError) as error:
                model_process.lightgbm_objective(text)
            self.assertEqual(error.exception.code, "model_artifact_invalid")
        for objective, task in (("regression", "binary_classification"), ("lambdarank", "binary_classification"), ("binary", "regression")):
            with self.assertRaises(EngineError) as error:
                model_process.check_objective("lightgbm_text", objective, task)
            self.assertEqual(error.exception.code, "model_objective_mismatch")
        model_process.check_objective("lightgbm_text", "regression_l1", "regression")

    @requires_numpy
    def test_lightgbm_scoring_does_not_depend_on_booster_params(self):
        with patch.dict(sys.modules, {"lightgbm": types.SimpleNamespace(Booster=FakeLightGBMBooster)}):
            self.assertEqual(json.loads(model_process.score(self.lightgbm_payload("binary sigmoid:1"))), [0.2, 0.9])
            with self.assertRaises(EngineError) as error:
                model_process.score(self.lightgbm_payload("regression"))
            self.assertEqual(error.exception.code, "model_objective_mismatch")

    @requires_numpy
    def test_scoring_child_reports_only_allowed_codes(self):
        with patch.object(sys, "stdin", io.StringIO(json.dumps(self.lightgbm_payload("regression")))), patch.object(sys, "stdout", new_callable=io.StringIO) as output:
            self.assertEqual(model_process.main(), 2)
        self.assertEqual(json.loads(output.getvalue()), {"error": "model_objective_mismatch"})
        self.assertEqual(scoring_failure_code('{"error":"model_objective_mismatch"}'), "model_objective_mismatch")
        for stdout in ('{"error":"Traceback: /home/client/model.txt"}', "Segmentation fault", '{"error":"'+"x"*5000+'"}'):
            self.assertEqual(scoring_failure_code(stdout), "model_inference_failed")
        path = self.directory/"native.json"
        path.write_text('{"learner": {}}', encoding="utf-8")
        with patch("engine.optional_adapters.importlib.metadata.version", return_value="test-installed-runtime"):
            adapter = NativeTreeAdapter(path, "xgboost_json", {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"]}, trusted_model=True)
        child = subprocess.CompletedProcess([], 2, stdout='{"error":"model_objective_mismatch"}\n', stderr="native details stay local")
        with patch("engine.optional_adapters.subprocess.run", return_value=child):
            with self.assertRaises(EngineError) as error:
                adapter.predict([{"x": 1.0}])
        self.assertEqual(error.exception.code, "model_objective_mismatch")

    def test_running_out_of_memory_is_not_reported_as_a_model_defect(self):
        # Loading: the ONNX and PMML wrappers let MemoryError through.
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"], "predictionOutput": "label"}
        (self.directory/"model.onnx").write_bytes(b"fixture ONNX bytes")
        (self.directory/"model.pmml").write_text("<PMML/>", encoding="utf-8")
        runtimes = {"onnxruntime": types.SimpleNamespace(SessionOptions=types.SimpleNamespace, InferenceSession=out_of_memory), "pypmml": types.SimpleNamespace(Model=types.SimpleNamespace(load=out_of_memory))}
        with patch.dict(sys.modules, runtimes):
            for format_name in ("onnx", "pmml"):
                with self.subTest(format_name), self.assertRaises(MemoryError):
                    load_adapter(self.directory/("model."+format_name), format_name, spec, trusted_model=True)
        # Scoring: _inference lets it through, so compute reports compute_resource_exhausted.
        with self.assertRaises(MemoryError):
            _inference(out_of_memory, [{"x": 1.0}])
        # The native scoring child names the exhausted resource for its parent.
        with patch.object(model_process, "score", side_effect=MemoryError), patch.object(sys, "stdin", io.StringIO("{}")), patch.object(sys, "stdout", new_callable=io.StringIO) as output:
            self.assertEqual(model_process.main(), 2)
        self.assertEqual(scoring_failure_code(output.getvalue()), "compute_resource_exhausted")

    @requires_numpy
    def test_native_tree_loading_lets_memory_errors_reach_the_child_main(self):
        model = self.directory/"model.json"
        model.write_text('{"learner": {}}', encoding="utf-8")
        xgboost = {**self.lightgbm_payload("binary sigmoid:1"), "path": str(model), "format": "xgboost_json", "expectedSha256": sha256(model.read_bytes())}
        runtimes = {"lightgbm": types.SimpleNamespace(Booster=out_of_memory), "xgboost": types.SimpleNamespace(Booster=lambda params: types.SimpleNamespace(load_model=out_of_memory))}
        with patch.dict(sys.modules, runtimes):
            for payload in (self.lightgbm_payload("binary sigmoid:1"), xgboost):
                with self.subTest(payload["format"]), self.assertRaises(MemoryError):
                    model_process.score(payload)

    def numeric_adapter(self, labels, *, threshold=None, positive=None):
        path = self.directory/"threshold-model.txt"
        path.write_text(LIGHTGBM_MODEL.format(objective="binary"), encoding="utf-8")
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": labels, **({"decisionThreshold": threshold} if threshold is not None else {})}
        return NumericAdapter(path, "lightgbm_text", spec, trusted_model=True, positive_label=positive)

    @requires_numpy
    def test_binary_threshold_applies_to_the_positive_label_probability(self):
        adapter = self.numeric_adapter(["0", "1"], threshold=.3)
        probabilities = numpy.array([[.75, .25], [.6, .4], [.2, .8]])
        # argmax would have given ["0", "0", "1"], ignoring the frozen threshold.
        self.assertEqual(adapter.labels_from_values(probabilities), ["0", "1", "1"])
        self.assertEqual(adapter.labels_from_values(probabilities[:, 1]), ["0", "1", "1"])
        self.assertEqual(self.numeric_adapter(["0", "1"]).labels_from_values(probabilities), ["0", "0", "1"])
        # A favourable label in the first column is thresholded on its own probability.
        first = self.numeric_adapter(["approved", "denied"], threshold=.3, positive="approved")
        self.assertEqual(first.labels_from_values(numpy.array([[.25, .75], [.4, .6]])), ["denied", "approved"])
        self.assertEqual(first.labels_from_values(numpy.array([.75, .6])), ["denied", "approved"])
        for values in (numpy.zeros((2, 3)), numpy.full((2, 1), .5), numpy.zeros((2, 2, 1)), numpy.array([[.6, .6], [.5, .5]]), numpy.array([1.2, .1]), numpy.array([[1.5, -.5]]), numpy.array(["0", "1"])):
            with self.assertRaises(EngineError) as error:
                adapter.labels_from_values(values)
            self.assertEqual(error.exception.code, "model_output_invalid")
        for labels, positive, threshold, code in ((["0", "1"], "yes", .5, "label_set_mismatch"), (["0", "1"], None, 1.5, "protocol_config_invalid"), (["0", "1"], None, True, "protocol_config_invalid")):
            with self.assertRaises(EngineError) as error:
                self.numeric_adapter(labels, threshold=threshold, positive=positive)
            self.assertEqual(error.exception.code, code)

    def onnx_run(self, prediction_output, prediction_kind):
        model = self.directory/"model.onnx"
        model.write_bytes(b"fixture ONNX bytes; scored by a fake runtime")
        data = self.directory/"threshold.csv"
        data.write_text(THRESHOLD_ROWS, encoding="utf-8")
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"], "decisionThreshold": .3, "predictionOutput": prediction_output, "predictionKind": prediction_kind}
        cfg = config(suites=["performance", "inference"])
        cfg["columns"] = {"target": "actual", "prediction": "predicted"}
        cfg["modelSpec"] = spec
        with patch.dict(sys.modules, {"onnxruntime": fake_onnxruntime()}):
            adapter = load_adapter(model, "onnx", spec, trusted_model=True, positive_label="1")
            return adapter, run(data, cfg, adapter=adapter)

    @requires_numpy
    def test_probability_outputs_use_the_frozen_threshold_end_to_end(self):
        adapter, report = self.onnx_run("probabilities", "probability")
        self.assertEqual(adapter.limitations, [])
        performance = report["results"][0]
        self.assertEqual(performance["metrics"][0]["value"], 1.0)
        balanced = next(m for m in performance["metrics"] if m["name"] == "balanced_accuracy")
        self.assertEqual(balanced["details"]["counts"], {"tp": 15, "positives": 15, "tn": 5, "negatives": 5})
        validate_report(report)
        if jsonschema:
            self.assertEqual(schema_violations(report), [])

    @requires_numpy
    def test_label_outputs_record_that_the_threshold_was_not_applied(self):
        adapter, report = self.onnx_run("label", "label")
        self.assertEqual(len(adapter.limitations), 1)
        note = adapter.limitations[0]
        self.assertIn("decisionThreshold (0.3) could not be applied", note)
        self.assertEqual(report["results"][0]["metrics"][0]["value"], .75)
        for diagnostic in report["results"]:
            self.assertIn(note, diagnostic["limitations"])
        self.assertIn(note, report["limitations"])
        validate_report(report)
        if jsonschema:
            self.assertEqual(schema_violations(report), [])

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
        # Saved scores never attach to fresh predictions, so calibration has no scored rows to decide on.
        self.assertEqual(report["results"][1]["testId"], "PERF-CAL")
        self.assertEqual(report["results"][1]["outcome"], "inconclusive")
        self.assertEqual(report["results"][1]["decision"]["sampleSize"], 0)
        self.assertEqual(report["results"][2]["testId"], "EXPL-PERM")


if __name__ == "__main__":
    unittest.main()
