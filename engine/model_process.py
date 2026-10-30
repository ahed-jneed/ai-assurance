"""Internal fixed native-model scorer. Never import code from a model artifact."""
import json
import sys

from .diagnostics import sha256
from .optional_adapters import NumericAdapter


def main():
    payload = json.load(sys.stdin)
    adapter = NumericAdapter(payload["path"], payload["format"], payload["spec"], trusted_model=True)
    if sha256(adapter.artifact_bytes) != payload["expectedSha256"]:
        raise ValueError("Native model artifact changed after eligibility review")
    matrix = adapter.matrix(payload["records"])
    if payload["format"] == "xgboost_json":
        import xgboost as xgb
        model = xgb.Booster(params={"nthread": 1})
        model.load_model(bytearray(adapter.artifact_bytes))
        objective = json.loads(model.save_config())["learner"]["objective"]["name"]
        if objective not in {"binary:logistic", "multi:softprob", "reg:squarederror", "reg:absoluteerror"}:
            raise ValueError("XGBoost objective is outside the reviewed adapter protocol")
        expected = {"binary_classification": {"binary:logistic"}, "multiclass_classification": {"multi:softprob"}, "regression": {"reg:squarederror", "reg:absoluteerror"}}
        if objective not in expected[adapter.descriptor.task]:
            raise ValueError("XGBoost objective differs from declared task")
        values = model.predict(xgb.DMatrix(matrix, feature_names=[feature.name for feature in adapter.descriptor.feature_schema]))
    else:
        import lightgbm as lgb
        model = lgb.Booster(model_str=adapter.artifact_bytes.decode("utf-8"))
        objective = str(model.params.get("objective", "")).split()[0]
        if objective not in {"binary", "multiclass", "regression", "regression_l1"}:
            raise ValueError("LightGBM objective is outside the reviewed adapter protocol")
        expected = {"binary_classification": {"binary"}, "multiclass_classification": {"multiclass"}, "regression": {"regression", "regression_l1"}}
        if objective not in expected[adapter.descriptor.task]:
            raise ValueError("LightGBM objective differs from declared task")
        values = model.predict(matrix, num_threads=1)
    print(json.dumps(values.tolist(), allow_nan=False))


if __name__ == "__main__":
    main()
