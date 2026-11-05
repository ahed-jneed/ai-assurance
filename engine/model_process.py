"""Internal fixed native-model scorer. Never import code from a model artifact."""
import json
import sys

from .diagnostics import sha256
from .errors import EngineError
from .optional_adapters import NumericAdapter

# Codes this child reports to NativeTreeAdapter as {"error": code} on stdout.
# The parent maps anything else to model_inference_failed.
FAILURE_CODES = frozenset({"model_artifact_invalid", "model_runtime_unavailable", "model_objective_mismatch", "model_output_invalid", "model_inference_failed", "invalid_numeric_value", "missing_value", "dataset_limit_exceeded"})
OBJECTIVES = {
    "xgboost_json": {"binary_classification": {"binary:logistic"}, "multiclass_classification": {"multi:softprob"}, "regression": {"reg:squarederror", "reg:absoluteerror"}},
    "lightgbm_text": {"binary_classification": {"binary"}, "multiclass_classification": {"multiclass"}, "regression": {"regression", "regression_l1"}},
}


def check_objective(format_name, objective, task):
    """Reject native objectives outside the reviewed protocol or the declared task."""
    expected = OBJECTIVES[format_name]
    if objective not in set().union(*expected.values()):
        raise EngineError("model_objective_mismatch", "Native objective is outside the reviewed adapter protocol")
    if objective not in expected[task]:
        raise EngineError("model_objective_mismatch", "Native objective differs from the declared task")


def lightgbm_objective(model_text):
    """The objective a LightGBM text model declares in its header.

    Booster.params is empty when a model is loaded with model_str, so it
    cannot be used. The header's `objective=` line is what LightGBM itself
    reads to build the model's objective function.
    """
    declared = []
    for line in model_text.splitlines():
        if line.startswith("Tree=") or line.strip() == "end of trees":
            break
        if line.startswith("objective="):
            declared.append(line[len("objective="):].split())
    if len(declared) != 1 or not declared[0]:
        raise EngineError("model_artifact_invalid", "LightGBM model text must declare exactly one objective before its trees")
    return declared[0][0]


def runtime(name):
    try:
        return __import__(name)
    except ImportError as exc:
        raise EngineError("model_runtime_unavailable", name+" is not installed in the compute runtime") from exc


def score(payload):
    adapter = NumericAdapter(payload["path"], payload["format"], payload["spec"], trusted_model=True)
    if sha256(adapter.artifact_bytes) != payload["expectedSha256"]:
        raise EngineError("model_artifact_invalid", "Native model artifact changed after eligibility review")
    matrix = adapter.matrix(payload["records"])
    task = adapter.descriptor.task
    if payload["format"] == "xgboost_json":
        xgb = runtime("xgboost")
        model = xgb.Booster(params={"nthread": 1})
        try:
            model.load_model(bytearray(adapter.artifact_bytes))
            objective = json.loads(model.save_config())["learner"]["objective"]["name"]
        except Exception as exc:
            raise EngineError("model_artifact_invalid", "XGBoost could not load the model ("+type(exc).__name__+")") from exc
        check_objective("xgboost_json", objective, task)
        values = model.predict(xgb.DMatrix(matrix, feature_names=[feature.name for feature in adapter.descriptor.feature_schema]))
    else:
        try:
            model_text = adapter.artifact_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise EngineError("model_artifact_invalid", "LightGBM model text must be UTF-8") from exc
        check_objective("lightgbm_text", lightgbm_objective(model_text), task)
        lgb = runtime("lightgbm")
        try:
            model = lgb.Booster(model_str=model_text)
        except Exception as exc:
            raise EngineError("model_artifact_invalid", "LightGBM could not load the model ("+type(exc).__name__+")") from exc
        values = model.predict(matrix, num_threads=1)
    try:
        return json.dumps(values.tolist(), allow_nan=False)
    except (AttributeError, TypeError, ValueError) as exc:
        raise EngineError("model_output_invalid", "Native model returned non-finite or non-numeric values") from exc


def main():
    try:
        output = score(json.load(sys.stdin))
    except Exception as error:
        # Only an allowed code reaches the parent; never a native message.
        print(json.dumps({"error": error.code if isinstance(error, EngineError) and error.code in FAILURE_CODES else "model_inference_failed"}))
        return 2
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
