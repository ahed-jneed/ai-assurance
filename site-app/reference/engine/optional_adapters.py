"""Local trusted-artifact adapters. No pickle/joblib deserialization, ever."""
from __future__ import annotations

import importlib
import importlib.metadata
import json
import math
import subprocess
import sys
from pathlib import Path

from .adapters import Feature, ModelDescriptor
from .diagnostics import MAX_BYTES, sha256


def require_artifact(path, format_name, trusted_model):
    if trusted_model is not True:
        raise ValueError("Model loading requires explicit --trusted-model; user uploads are not trusted artifacts")
    suffixes = {"onnx": {".onnx"}, "pmml": {".pmml"}, "xgboost_json": {".json"}, "lightgbm_text": {".txt"}}
    if format_name not in suffixes:
        raise ValueError("Supported trusted formats: ONNX, PMML, native XGBoost JSON, native LightGBM text; pickle/joblib is prohibited")
    source = Path(path).resolve(strict=True)
    if not source.is_file() or source.suffix.lower() not in suffixes[format_name] or source.stat().st_size > MAX_BYTES:
        raise ValueError("Model path/format/size is outside the adapter protocol")
    data = source.read_bytes()
    if format_name == "xgboost_json":
        parsed = json.loads(data)
        if not isinstance(parsed, dict) or "learner" not in parsed:
            raise ValueError("Expected a native XGBoost JSON model")
    if format_name == "lightgbm_text" and not data.lstrip().startswith(b"tree\n") and not data.lstrip().startswith(b"tree\r\n"):
        raise ValueError("Expected native LightGBM text model")
    if format_name == "pmml" and (b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper()):
        raise ValueError("PMML external entities and document types are prohibited")
    return source, data


class NumericAdapter:
    runtime_packages = ("numpy",)
    def __init__(self, path, format_name, spec, *, trusted_model=False):
        self.path, self.artifact_bytes = require_artifact(path, format_name, trusted_model)
        names = spec.get("featureColumns")
        if not isinstance(names, list) or not names or len(names) > 100 or any(not isinstance(name, str) or not name for name in names) or len(set(names)) != len(names):
            raise ValueError("Trusted adapter requires unique ordered numeric featureColumns (maximum 100)")
        if spec.get("task") not in {"binary_classification", "multiclass_classification", "regression"}:
            raise ValueError("Invalid trusted adapter task")
        labels = spec.get("outputLabels", [])
        if spec["task"] != "regression" and (not isinstance(labels, list) or len(labels) < 2 or any(not isinstance(label, str) for label in labels) or len(set(labels)) != len(labels)):
            raise ValueError("Classification requires explicit ordered outputLabels")
        if spec["task"] == "binary_classification" and len(labels) != 2:
            raise ValueError("Binary adapter requires exactly two outputLabels")
        self.spec = dict(spec)
        self.descriptor = ModelDescriptor(sha256(self.artifact_bytes), format_name, spec["task"], tuple(Feature(name, "float64") for name in names), tuple(labels), "1.0.0")
        self.capabilities = frozenset({"predict"})

    def matrix(self, records):
        import numpy as np
        if not records or len(records) > 100_000:
            raise ValueError("Adapter batch requires 1..100000 rows")
        values = []
        for row in records:
            vector = []
            for feature in self.descriptor.feature_schema:
                value = row.get(feature.name)
                if isinstance(value, bool):
                    raise ValueError("Boolean feature requires a separately approved encoding")
                try:
                    number = float(value)
                except (ValueError, TypeError) as exc:
                    raise ValueError("Trusted adapter requires finite, non-missing numeric features") from exc
                if not math.isfinite(number):
                    raise ValueError("Trusted adapter requires finite numeric features")
                vector.append(number)
            values.append(vector)
        return np.asarray(values, dtype=np.float64)

    def predict_probability(self, records):
        raise ValueError("Probability output not declared by this model adapter")

    def labels_from_values(self, values):
        import numpy as np
        array = np.asarray(values)
        if not np.isfinite(array).all():
            raise ValueError("Model returned non-finite predictions")
        if self.descriptor.task == "regression":
            return array.reshape(-1).astype(float).tolist()
        labels = self.descriptor.output_labels
        if self.descriptor.task == "binary_classification" and array.ndim == 1:
            cutoff = float(self.spec.get("decisionThreshold", 0.5))
            if not 0 <= cutoff <= 1 or (array < 0).any() or (array > 1).any():
                raise ValueError("Binary native model must output probabilities with a threshold in [0,1]")
            return [labels[int(value >= cutoff)] for value in array]
        if array.ndim != 2 or array.shape[1] != len(labels):
            raise ValueError("Multiclass probability shape differs from declared class ordering")
        return [labels[int(index)] for index in array.argmax(axis=1)]


class ONNXAdapter(NumericAdapter):
    runtime_packages = ("numpy", "onnxruntime")
    def __init__(self, path, spec, *, trusted_model=False):
        super().__init__(path, "onnx", spec, trusted_model=trusted_model)
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise ValueError("ONNX capability unavailable: onnxruntime is not installed") from exc
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(self.artifact_bytes, sess_options=options, providers=["CPUExecutionProvider"])
        inputs = self.session.get_inputs()
        if len(inputs) != 1 or inputs[0].type not in {"tensor(float)", "tensor(double)"} or len(inputs[0].shape) != 2:
            raise ValueError("ONNX adapter accepts one rank-2 numeric input tensor only")
        self.input = inputs[0]
        output_names = {item.name for item in self.session.get_outputs()}
        self.output = spec.get("predictionOutput")
        if self.output not in output_names:
            raise ValueError("ONNX predictionOutput must explicitly name an output tensor")
        self.probability_output = spec.get("probabilityOutput")
        if self.probability_output is not None:
            if self.probability_output not in output_names:
                raise ValueError("ONNX probabilityOutput is not present")
            self.capabilities = frozenset({"predict", "probability"})

    def execute(self, records, output):
        import numpy as np
        matrix = self.matrix(records).astype(np.float32 if self.input.type == "tensor(float)" else np.float64)
        if not np.isfinite(matrix).all():
            raise ValueError("ONNX input overflows declared tensor dtype")
        return self.session.run([output], {self.input.name: matrix})[0]

    def predict(self, records):
        values = self.execute(records, self.output)
        if self.spec.get("predictionKind", "label") == "probability":
            return self.labels_from_values(values)
        if self.descriptor.task == "regression":
            return self.labels_from_values(values)
        flattened = values.reshape(-1).tolist()
        labels = self.descriptor.output_labels
        if self.spec.get("labelEncoding") == "class_index":
            if any(not isinstance(value, (int, float)) or int(value) != value or not 0 <= int(value) < len(labels) for value in flattened):
                raise ValueError("Invalid ONNX class-index output")
            return [labels[int(value)] for value in flattened]
        output = [str(value) for value in flattened]
        if any(value not in labels for value in output):
            raise ValueError("ONNX labels differ from declared outputLabels")
        return output

    def predict_probability(self, records):
        if not self.probability_output:
            return super().predict_probability(records)
        output = self.execute(records, self.probability_output)
        if isinstance(output, list) and output and isinstance(output[0], dict):
            return [[float(row.get(label, row.get(index))) for index, label in enumerate(self.descriptor.output_labels)] for row in output]
        return output.tolist()


class PMMLAdapter(NumericAdapter):
    runtime_packages = ("numpy", "pandas", "pypmml")
    def __init__(self, path, spec, *, trusted_model=False):
        super().__init__(path, "pmml", spec, trusted_model=trusted_model)
        try:
            from pypmml import Model
        except ImportError as exc:
            raise ValueError("PMML capability unavailable: pypmml plus a separately provisioned Java runtime are required") from exc
        self.model = Model.load(str(self.path))
        if not isinstance(spec.get("predictionOutput"), str):
            raise ValueError("PMML requires explicit predictionOutput field")

    def predict(self, records):
        import pandas as pd
        matrix = self.matrix(records)
        frame = pd.DataFrame(matrix, columns=[feature.name for feature in self.descriptor.feature_schema])
        output = self.model.predict(frame)[self.spec["predictionOutput"]].tolist()
        if self.descriptor.task == "regression":
            return self.labels_from_values(output)
        labels = [str(value) for value in output]
        if any(value not in self.descriptor.output_labels for value in labels):
            raise ValueError("PMML returned labels outside declared outputLabels")
        return labels


class NativeTreeAdapter(NumericAdapter):
    """Native data formats score in a client-owned child Python process.

    This is process separation with a timeout, not an OS security sandbox.
    Production additionally requires the resource-limited worker isolation.
    """
    def __init__(self, path, format_name, spec, *, trusted_model=False):
        super().__init__(path, format_name, spec, trusted_model=trusted_model)
        if format_name not in {"xgboost_json", "lightgbm_text"}:
            raise ValueError("NativeTreeAdapter requires XGBoost JSON or LightGBM text")
        package = "xgboost" if format_name == "xgboost_json" else "lightgbm"
        self.runtime_packages = ("numpy", package)
        try:
            importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as exc:
            raise ValueError(f"Native tree capability unavailable: {package} is not installed") from exc

    def predict(self, records):
        self.matrix(records)
        payload = {"path": str(self.path), "format": self.descriptor.format, "expectedSha256": self.descriptor.artifact_sha256, "spec": self.spec, "records": records}
        try:
            process = subprocess.run([sys.executable, "-m", "engine.model_process"], input=json.dumps(payload, allow_nan=False), capture_output=True, text=True, timeout=60, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ValueError("Native model scoring process exceeded its 60-second time budget") from exc
        if process.returncode:
            raise ValueError("Native model scoring process failed; inspect the client-owned worker's sanitized error log")
        return self.labels_from_values(json.loads(process.stdout))


def load_adapter(path, format_name, spec, *, trusted_model=False):
    require_artifact(path, format_name, trusted_model)
    if format_name == "onnx":
        return ONNXAdapter(path, spec, trusted_model=trusted_model)
    if format_name == "pmml":
        return PMMLAdapter(path, spec, trusted_model=trusted_model)
    return NativeTreeAdapter(path, format_name, spec, trusted_model=trusted_model)
