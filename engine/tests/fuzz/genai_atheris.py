"""Optional coverage-guided fuzz harness for the GenAI parsers (design section 11.5; #128).

atheris (Apache-2.0, https://github.com/google/atheris) is never a runtime or CI dependency: install
it in a throwaway virtual environment outside the repository and run from the repository root, for
example with the committed fixtures as the seed corpus:

    python -m venv <tmp>/atheris && <tmp>/atheris/bin/pip install atheris -r engine/requirements-dev.txt
    <tmp>/atheris/bin/python engine/tests/fuzz/genai_atheris.py -atheris_runs=200000 <corpus-dir>

Each input is one file; its first byte picks the declared format and the rest is the file. The only
acceptable outcome besides a computed envelope is a GenaiInputError with an enumerated code; anything
else (another exception, a hang the fuzzer reports, a crash) is a parser defect. `ingest.STRICT` is
set, so a parser crash surfaces instead of becoming the production fallback code `invalid_json`. The
plan pins the TEST-ONLY detection key of engine/tests/fixtures/genai/marking and enables excerpts, so
the signature and excerpt paths are reached too.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import atheris  # noqa: E402  (optional; see the docstring)

with atheris.instrument_imports():
    from engine.genai import ingest  # noqa: E402
    from engine.genai.errors import ERROR_CODES, GenaiInputError  # noqa: E402

FORMATS = (
    ("inspect_eval", "log"), ("inspect_json", "log"), ("lm_eval_samples", "samples"), ("promptfoo_results", "log"),
    ("garak_report", "log"), ("pyrit_export", "log"), ("deepeval_test_run", "log"), ("ragas_results", "log"),
    ("judge_validation_jsonl", "judge_validation"), ("marking_check_jsonl", "marking"), ("c2pa_validator_report", "marking"),
    ("signed_detection_jsonl", "marking"),
)
KEY = json.loads((ROOT / "engine/tests/fixtures/genai/marking/detection-key.json").read_text(encoding="utf-8"))
PLAN = {"schemaVersion": "genai-plan/0.1", "criteria": [], "allowUnverifiedFormatVersion": True, "excerpts": "all", "detectionKeys": [KEY]}
ingest.STRICT = True


def one_input(data: bytes):
    if not data:
        return
    fmt, role = FORMATS[data[0] % len(FORMATS)]
    body = data[1:]
    digest = hashlib.sha256(body).hexdigest()
    manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied",
                "inputs": [{"name": "fuzz.input", "sha256": digest, "bytes": len(body), "format": fmt, "role": role}],
                "declared": {"harness": {"name": "fuzz", "version": "4.3.0" if fmt == "deepeval_test_run" else "0.4.0"}}}
    try:
        ingest.run_bundle({digest: body}, manifest, PLAN)
    except GenaiInputError as exc:
        if exc.code not in ERROR_CODES:
            raise


def main():
    atheris.Setup(sys.argv, one_input)
    atheris.Fuzz()


if __name__ == "__main__":
    main()
