"""Local trusted-artifact adapters. No pickle/joblib deserialization, ever."""
from __future__ import annotations

import importlib
import importlib.metadata
import json
import math
import re
import subprocess
import sys
from pathlib import Path

from .adapters import Feature, ModelDescriptor
from .diagnostics import MAX_BYTES, sha256
from .errors import EngineError


def require_artifact(path, format_name, trusted_model):
    if trusted_model is not True:
        raise ValueError("Model loading requires explicit --trusted-model; user uploads are not trusted artifacts")
    suffixes = {"onnx": {".onnx"}, "pmml": {".pmml"}, "xgboost_json": {".json"}, "lightgbm_text": {".txt"}}
    if format_name not in suffixes:
        raise ValueError("Supported trusted formats: ONNX, PMML, native XGBoost JSON, native LightGBM text; pickle/joblib is prohibited")
    source = Path(path).resolve(strict=True)
    if not source.is_file() or source.suffix.lower() not in suffixes[format_name] or source.stat().st_size > MAX_BYTES:
        raise EngineError("model_artifact_invalid", "Model path/format/size is outside the adapter protocol")
    data = source.read_bytes()
    if format_name == "xgboost_json":
        try:
            parsed = json.loads(data)
        except ValueError as exc:
            raise EngineError("model_artifact_invalid", "Expected a native XGBoost JSON model") from exc
        if not isinstance(parsed, dict) or "learner" not in parsed:
            raise EngineError("model_artifact_invalid", "Expected a native XGBoost JSON model")
    if format_name == "lightgbm_text" and not data.lstrip().startswith(b"tree\n") and not data.lstrip().startswith(b"tree\r\n"):
        raise EngineError("model_artifact_invalid", "Expected native LightGBM text model")
    if format_name == "pmml":
        check_pmml_text(data)
    return source, data


# Byte-order marks and the no-BOM first bytes of "<" (XML 1.0 Appendix F).
_XML_BOMS = ((b"\x00\x00\xfe\xff", "utf-32-be"), (b"\xff\xfe\x00\x00", "utf-32-le"), (b"\xef\xbb\xbf", "utf-8"), (b"\xfe\xff", "utf-16-be"), (b"\xff\xfe", "utf-16-le"))
_XML_NO_BOM = ((b"\x00\x00\x00<", "utf-32-be"), (b"<\x00\x00\x00", "utf-32-le"), (b"\x00<", "utf-16-be"), (b"<\x00", "utf-16-le"))
# Declared encodings accepted for each detected family. Anything else (UTF-7,
# EBCDIC, multi-byte legacy code pages) is refused rather than guessed at.
_XML_DECLARED = {
    "ascii": {"utf-8", "utf8", "us-ascii", "ascii", "iso-8859-1", "latin-1", "latin1", "iso_8859-1", "windows-1252", "cp1252"},
    "utf-8": {"utf-8", "utf8"},
    "utf-16-le": {"utf-16", "utf-16le"},
    "utf-16-be": {"utf-16", "utf-16be"},
    "utf-32-le": {"utf-32", "utf-32le", "ucs-4"},
    "utf-32-be": {"utf-32", "utf-32be", "ucs-4"},
}
_XML_DECLARATION = re.compile(r"<\?xml\s[^>]*?\?>")
_XML_ENCODING = re.compile(r"\sencoding\s*=\s*(?:\"([A-Za-z][A-Za-z0-9._-]*)\"|'([A-Za-z][A-Za-z0-9._-]*)')")


def check_pmml_text(data):
    """Reject a PMML document type or entity declaration in whatever encoding an XML parser would read.

    A plain byte search misses "<!DOCTYPE" written in UTF-16 or UTF-32, so the
    bytes are decoded the way XML 1.0 Appendix F detects the encoding, and an
    encoding that cannot be checked reliably is refused.
    """
    invalid = EngineError("model_artifact_invalid", "PMML encoding is unsupported; use UTF-8, UTF-16 or UTF-32")
    family, body = None, data
    for mark, name in _XML_BOMS:
        if data.startswith(mark):
            family, body = name, data[len(mark):]
            break
    else:
        for prefix, name in _XML_NO_BOM:
            if data.startswith(prefix):
                family = name
                break
    if family is None:
        # Single-byte ASCII-compatible text never contains NUL; anything that
        # does is a wide encoding this detection did not recognise.
        # A recognised ASCII-compatible document starts with "<" (whitespace
        # may precede a root element without an XML declaration); EBCDIC and
        # other ASCII-incompatible encodings do not.
        if b"\x00" in data or not data.lstrip(b" \t\r\n").startswith(b"<"):
            raise invalid
        family = "ascii"
    try:
        text = body.decode("latin-1" if family == "ascii" else family)
    except UnicodeDecodeError as exc:
        raise invalid from exc
    if "\x00" in text:
        raise invalid
    if re.match(r"<\?xml\s", text):
        declaration = _XML_DECLARATION.match(text)
        if declaration is None:
            raise invalid
        if "encoding" in declaration.group(0):
            declared = _XML_ENCODING.search(declaration.group(0))
            if declared is None or (declared.group(1) or declared.group(2)).lower() not in _XML_DECLARED[family]:
                raise invalid
    folded = text.upper()
    if "<!DOCTYPE" in folded or "<!ENTITY" in folded:
        raise EngineError("model_artifact_invalid", "PMML external entities and document types are prohibited")


class NumericAdapter:
    """Shared validation for local numeric adapters.

    For a binary model, positive_label is the frozen favourable label. The
    decisionThreshold applies to that label's probability. It defaults to
    outputLabels[1], the label a one-column native binary score refers to.
    """
    runtime_packages = ("numpy",)
    def __init__(self, path, format_name, spec, *, trusted_model=False, positive_label=None):
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
        # Report-level notes about how this adapter's outputs were produced.
        self.limitations = []
        self.positive_label = None
        if spec["task"] == "binary_classification":
            self.positive_label = labels[1] if positive_label is None else positive_label
            if self.positive_label not in labels:
                raise EngineError("label_set_mismatch", "The favourable label is not one of the model's outputLabels")
            threshold = spec.get("decisionThreshold", 0.5)
            if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0 <= threshold <= 1:
                raise EngineError("protocol_config_invalid", "decisionThreshold must be a number in [0, 1]")
            self.decision_threshold = float(threshold)

    def note_label_output(self):
        """Record that a binary model's own labels bypass the frozen threshold."""
        if self.descriptor.task == "binary_classification":
            frozen = f"the frozen decisionThreshold ({self.spec['decisionThreshold']})" if "decisionThreshold" in self.spec else "a frozen decision threshold"
            self.limitations.append(f"The binary model outputs class labels, so {frozen} could not be applied; the model's internal decision rule produced every prediction. Confirm that rule matches the deployed decision threshold.")

    def matrix(self, records):
        import numpy as np
        if not records or len(records) > 100_000:
            raise EngineError("dataset_limit_exceeded", "Adapter batch requires 1..100000 rows")
        values = []
        for row in records:
            vector = []
            for feature in self.descriptor.feature_schema:
                value = row.get(feature.name)
                if value is None:
                    raise EngineError("missing_value", "Trusted adapter requires non-missing numeric features")
                if isinstance(value, bool):
                    raise EngineError("invalid_numeric_value", "Boolean feature requires a separately approved encoding")
                try:
                    number = float(value)
                except (ValueError, TypeError) as exc:
                    raise EngineError("invalid_numeric_value", "Trusted adapter requires finite numeric features") from exc
                if not math.isfinite(number):
                    raise EngineError("invalid_numeric_value", "Trusted adapter requires finite numeric features")
                vector.append(number)
            values.append(vector)
        return np.asarray(values, dtype=np.float64)

    def predict_probability(self, records):
        raise EngineError("model_interface_mismatch", "Probability output not declared by this model adapter")

    def labels_from_values(self, values):
        import numpy as np
        array = np.asarray(values)
        if not np.issubdtype(array.dtype, np.number) or not np.isfinite(array).all():
            raise EngineError("model_output_invalid", "Model returned non-finite or non-numeric predictions")
        if self.descriptor.task == "regression":
            return array.reshape(-1).astype(float).tolist()
        if self.descriptor.task == "binary_classification":
            return self.binary_decisions(array)
        labels = self.descriptor.output_labels
        if array.ndim != 2 or array.shape[1] != len(labels):
            raise EngineError("model_output_invalid", "Multiclass probability shape differs from declared class ordering")
        return [labels[int(index)] for index in array.argmax(axis=1)]

    def binary_decisions(self, array):
        """Classify positive when P(positive label) >= decisionThreshold.

        Shape (n,) is P(outputLabels[1]), the native binary objective
        convention; shape (n, 2) has one column per label in outputLabels
        order. Any other shape is rejected rather than guessed.
        """
        import numpy as np
        labels = self.descriptor.output_labels
        positive = labels.index(self.positive_label)
        if (array < 0).any() or (array > 1).any():
            raise EngineError("model_output_invalid", "Binary model output must be probabilities in [0, 1]")
        if array.ndim == 1:
            probability = array if positive == 1 else 1-array
        elif array.ndim == 2 and array.shape[1] == 2:
            if not np.allclose(array.sum(axis=1), 1.0, rtol=0, atol=1e-5):
                raise EngineError("model_output_invalid", "Binary class probabilities must sum to one")
            probability = array[:, positive]
        else:
            raise EngineError("model_output_invalid", "Binary probability output must have shape (n,) or (n, 2)")
        negative = labels[1-positive]
        return [self.positive_label if value >= self.decision_threshold else negative for value in probability.tolist()]


class ONNXAdapter(NumericAdapter):
    runtime_packages = ("numpy", "onnxruntime")
    def __init__(self, path, spec, *, trusted_model=False, positive_label=None):
        super().__init__(path, "onnx", spec, trusted_model=trusted_model, positive_label=positive_label)
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise EngineError("model_runtime_unavailable", "ONNX capability unavailable: onnxruntime is not installed") from exc
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        try:
            self.session = ort.InferenceSession(self.artifact_bytes, sess_options=options, providers=["CPUExecutionProvider"])
        except MemoryError:
            raise  # compute_resource_exhausted, not an invalid artifact
        except Exception as exc:
            raise EngineError("model_artifact_invalid", "ONNX Runtime could not load the model ("+type(exc).__name__+")") from exc
        inputs = self.session.get_inputs()
        if len(inputs) != 1 or inputs[0].type not in {"tensor(float)", "tensor(double)"} or len(inputs[0].shape) != 2:
            raise EngineError("model_interface_mismatch", "ONNX adapter accepts one rank-2 numeric input tensor only")
        self.input = inputs[0]
        output_names = {item.name for item in self.session.get_outputs()}
        self.output = spec.get("predictionOutput")
        if self.output not in output_names:
            raise EngineError("model_interface_mismatch", "ONNX predictionOutput must explicitly name an output tensor")
        self.probability_output = spec.get("probabilityOutput")
        if self.probability_output is not None:
            if self.probability_output not in output_names:
                raise EngineError("model_interface_mismatch", "ONNX probabilityOutput is not present")
            self.capabilities = frozenset({"predict", "probability"})
        if spec.get("predictionKind", "label") != "probability":
            self.note_label_output()

    def execute(self, records, output):
        import numpy as np
        matrix = self.matrix(records).astype(np.float32 if self.input.type == "tensor(float)" else np.float64)
        if not np.isfinite(matrix).all():
            raise EngineError("invalid_numeric_value", "ONNX input overflows declared tensor dtype")
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
            if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or int(value) != value or not 0 <= int(value) < len(labels) for value in flattened):
                raise EngineError("model_output_invalid", "Invalid ONNX class-index output")
            return [labels[int(value)] for value in flattened]
        output = [str(value) for value in flattened]
        if any(value not in labels for value in output):
            raise EngineError("model_output_invalid", "ONNX labels differ from declared outputLabels")
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
    def __init__(self, path, spec, *, trusted_model=False, positive_label=None):
        super().__init__(path, "pmml", spec, trusted_model=trusted_model, positive_label=positive_label)
        # The PMML prediction field is a class label for classification.
        self.note_label_output()
        try:
            from pypmml import Model
        except ImportError as exc:
            raise EngineError("model_runtime_unavailable", "PMML capability unavailable: pypmml plus a separately provisioned Java runtime are required") from exc
        if not isinstance(spec.get("predictionOutput"), str):
            raise EngineError("model_interface_mismatch", "PMML requires explicit predictionOutput field")
        try:
            self.model = Model.load(str(self.path))
        except MemoryError:
            raise  # compute_resource_exhausted, not an invalid artifact
        except Exception as exc:
            raise EngineError("model_artifact_invalid", "pypmml could not load the model ("+type(exc).__name__+")") from exc

    def predict(self, records):
        import pandas as pd
        matrix = self.matrix(records)
        frame = pd.DataFrame(matrix, columns=[feature.name for feature in self.descriptor.feature_schema])
        output = self.model.predict(frame)[self.spec["predictionOutput"]].tolist()
        if self.descriptor.task == "regression":
            return self.labels_from_values(output)
        labels = [str(value) for value in output]
        if any(value not in self.descriptor.output_labels for value in labels):
            raise EngineError("model_output_invalid", "PMML returned labels outside declared outputLabels")
        return labels


class NativeTreeAdapter(NumericAdapter):
    """Native data formats score in a client-owned child Python process.

    This is process separation with a timeout, not an OS security sandbox.
    Production additionally requires the resource-limited worker isolation.
    """
    def __init__(self, path, format_name, spec, *, trusted_model=False, positive_label=None):
        super().__init__(path, format_name, spec, trusted_model=trusted_model, positive_label=positive_label)
        if format_name not in {"xgboost_json", "lightgbm_text"}:
            raise ValueError("NativeTreeAdapter requires XGBoost JSON or LightGBM text")
        package = "xgboost" if format_name == "xgboost_json" else "lightgbm"
        self.runtime_packages = ("numpy", package)
        try:
            importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as exc:
            raise EngineError("model_runtime_unavailable", f"Native tree capability unavailable: {package} is not installed") from exc

    def predict(self, records):
        self.matrix(records)
        payload = {"path": str(self.path), "format": self.descriptor.format, "expectedSha256": self.descriptor.artifact_sha256, "spec": self.spec, "records": records}
        try:
            process = subprocess.run(native_scorer_command(), input=json.dumps(payload, allow_nan=False), capture_output=True, text=True, timeout=60, check=False)
        except subprocess.TimeoutExpired as exc:
            raise EngineError("compute_timeout", "Native model scoring process exceeded its 60-second time budget") from exc
        if process.returncode:
            raise EngineError(scoring_failure_code(process.stdout), "Native model scoring process failed")
        try:
            values = json.loads(process.stdout)
        except ValueError as exc:
            raise EngineError("model_output_invalid", "Native model scoring process returned invalid JSON") from exc
        return self.labels_from_values(values)


# Isolated mode (-I): neither the working directory nor PYTHON* variables nor
# user site-packages reach sys.path; only the resolved engine package root is
# inserted before the fixed scorer module runs.
_SCORER_BOOTSTRAP = "import runpy,sys;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('engine.model_process',run_name='__main__',alter_sys=True)"


def native_scorer_command():
    return [sys.executable, "-I", "-c", _SCORER_BOOTSTRAP, str(Path(__file__).resolve().parent.parent)]


def scoring_failure_code(stdout):
    """The scoring child's own sanitized code, if it reported an allowed one."""
    from .model_process import FAILURE_CODES
    try:
        reported = json.loads(stdout[:4096]) if len(stdout) <= 4096 else None
    except ValueError:
        reported = None
    code = reported.get("error") if isinstance(reported, dict) else None
    return code if code in FAILURE_CODES else "model_inference_failed"


def load_adapter(path, format_name, spec, *, trusted_model=False, positive_label=None):
    require_artifact(path, format_name, trusted_model)
    if format_name == "onnx":
        return ONNXAdapter(path, spec, trusted_model=trusted_model, positive_label=positive_label)
    if format_name == "pmml":
        return PMMLAdapter(path, spec, trusted_model=trusted_model, positive_label=positive_label)
    return NativeTreeAdapter(path, format_name, spec, trusted_model=trusted_model, positive_label=positive_label)
