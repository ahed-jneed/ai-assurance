"""CLI: python -m engine --data file.csv --config policy.json --output run.json."""
import argparse
import json
import sys
from pathlib import Path

from .diagnostics import MAX_BYTES, run, validate_config, write_report
from .contract import validate_report


def main() -> int:
    parser = argparse.ArgumentParser(description="Run versioned traditional-ML audit diagnostics over saved predictions.")
    parser.add_argument("--data", required=True)
    parser.add_argument("--reference")
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model")
    parser.add_argument("--model-format", choices=["onnx", "pmml", "xgboost_json", "lightgbm_text"])
    parser.add_argument("--trusted-model", action="store_true", help="Explicitly authorize a client-owned reviewed local artifact. Never apply this to untrusted uploads.")
    args = parser.parse_args()
    try:
        config_path = Path(args.config)
        if config_path.stat().st_size > min(MAX_BYTES, 1024*1024):
            raise ValueError("Configuration exceeds 1 MiB limit")
        config = json.loads(config_path.read_text(encoding="utf-8-sig"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON numbers are forbidden")))
        adapter = None
        if args.model:
            if not args.model_format or not isinstance(config.get("modelSpec"), dict):
                raise ValueError("--model requires --model-format and frozen config.modelSpec")
            from .optional_adapters import load_adapter
            # The same favourable label run() freezes, including its default.
            positive_label = validate_config(config).get("positiveLabel")
            adapter = load_adapter(args.model, args.model_format, config["modelSpec"], trusted_model=args.trusted_model, positive_label=positive_label)
        elif args.trusted_model or args.model_format:
            raise ValueError("Model flags require --model")
        report = run(args.data, config, args.reference, adapter=adapter)
        validate_report(report)
        write_report(report, args.output)
    except (ValueError, OSError, OverflowError, KeyError, TypeError) as exc:
        print(f"Diagnostic run rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"id": report["id"], "state": report["state"], "overallOutcome": report["overallOutcome"], "resultCount": len(report["results"]), "paperIds": report["paperIds"], "reportSha256": report["reportSha256"], "output": str(Path(args.output).resolve())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
