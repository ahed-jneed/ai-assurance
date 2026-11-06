"""CLI: python -m engine.genai detect | ingest | verify | kappa (design section 10.1).

Exit codes: 0 success; 2 input rejected, with {"error": "<code>"} on stderr
and no partial output; 3 `verify` found a different computationSha256 or
itemsSha256. Outputs are created once and never overwritten. Ingested text
is never printed; the CLI prints hashes, codes and counts only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import limits
from .envelope import envelope_json, verify
from .errors import GenaiInputError
from .formats import judge_validation
from .ingest import detect, ingest_bundle, run_bundle
from .readers import decode_text, loads


def _read(path, maximum):
    source = Path(path)
    if not source.is_file():
        raise GenaiInputError("manifest_invalid", f"{path}: not a file")
    if source.stat().st_size > maximum:
        raise GenaiInputError("input_too_large", f"{path}: too large")
    return source.read_bytes()


def _json_file(path, code):
    try:
        return loads(decode_text(_read(path, limits.MAX_PLAN_BYTES)))
    except GenaiInputError as exc:
        raise GenaiInputError(code, f"{path}: {exc}") from exc


def _write_once(path, text):
    target = Path(path)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def _inputs(paths):
    out = {}
    for path in paths:
        data = _read(path, limits.MAX_INPUT_FILE_BYTES)
        out[hashlib.sha256(data).hexdigest()] = data
    return out


def cmd_detect(args):
    rows = []
    for path in args.input:
        data = _read(path, limits.MAX_INPUT_FILE_BYTES)
        fmt, role = detect(data)
        rows.append({"name": Path(path).name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": fmt, "role": role})
    print(json.dumps({"inputs": rows}, ensure_ascii=True, indent=1))
    return 0


def cmd_ingest(args):
    manifest = _json_file(args.manifest, "manifest_invalid")
    plan = _json_file(args.plan, "plan_invalid")
    for target in (args.output, args.items_output):
        if target and Path(target).exists():
            raise FileExistsError(target)
    envelope, items = ingest_bundle(_inputs(args.input), manifest, plan, provenance={"channel": "cli", "producedAt": datetime.now(timezone.utc).isoformat()})
    _write_once(args.output, envelope_json(envelope))
    if args.items_output:
        _write_once(args.items_output, items)
    computation = json.loads(envelope["computationJSON"])
    print(json.dumps({"computationSha256": envelope["computationSha256"], "itemsSha256": envelope["itemsSha256"], "itemsInline": envelope["itemsJSONL"] is not None,
                      "runs": [{"runKey": r["runKey"], "evidenceLevel": r["evidenceLevel"], "items": r["items"]["count"]} for r in computation["runs"]],
                      "criteria": {c["id"]: c["outcome"] for c in computation["criteria"]}, "overallOutcome": computation["overallOutcome"],
                      "output": str(Path(args.output).resolve())}, ensure_ascii=True, indent=1))
    return 0


def cmd_verify(args):
    envelope = loads(decode_text(_read(args.envelope, limits.MAX_RESULT_BYTES + limits.MAX_INLINE_ITEMS_BYTES)))
    manifest = _json_file(args.manifest, "manifest_invalid")
    plan = _json_file(args.plan, "plan_invalid")
    fresh = run_bundle(_inputs(args.input), manifest, plan, provenance={"channel": "cli"})
    problems = verify(envelope, fresh)
    print(json.dumps({"verified": not problems, "problems": problems, "computationSha256": fresh["computationSha256"], "itemsSha256": fresh["itemsSha256"]}, ensure_ascii=True, indent=1))
    return 0 if not problems else 3


def cmd_kappa(args):
    data = _read(args.labels, limits.MAX_INPUT_FILE_BYTES)
    spec = {"name": Path(args.labels).name, "sha256": hashlib.sha256(data).hexdigest()}
    parsed = judge_validation.parse(spec, data)
    result = judge_validation.kappa(parsed["labels"], parsed["labelSet"], args.level)
    result["positionConsistency"] = judge_validation.position_consistency(parsed["pairs"], args.level)
    result["sha256"] = spec["sha256"]
    print(json.dumps(result, ensure_ascii=True, indent=1))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.genai", description="Ingest and recompute GenAI evaluation evidence. Never executes ingested code.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("detect")
    p.add_argument("--input", action="append", required=True)
    p = sub.add_parser("ingest")
    p.add_argument("--manifest", required=True)
    p.add_argument("--plan", required=True)
    p.add_argument("--input", action="append", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--items-output")
    p.add_argument("--timeout", type=int, default=300, help="Accepted for the worker interface; the CLI itself does not fork.")
    p = sub.add_parser("verify")
    p.add_argument("--envelope", required=True)
    p.add_argument("--manifest", required=True)
    p.add_argument("--plan", required=True)
    p.add_argument("--input", action="append", required=True)
    p = sub.add_parser("kappa")
    p.add_argument("--labels", required=True)
    p.add_argument("--level", type=float, default=0.95, choices=[0.90, 0.95, 0.99])
    args = parser.parse_args(argv)
    try:
        return {"detect": cmd_detect, "ingest": cmd_ingest, "verify": cmd_verify, "kappa": cmd_kappa}[args.command](args)
    except GenaiInputError as exc:
        print(json.dumps({"error": exc.code}), file=sys.stderr)
        return 2
    except FileExistsError:
        print(json.dumps({"error": "output_exists"}), file=sys.stderr)
        return 2
    except OSError:
        print(json.dumps({"error": "io_error"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
