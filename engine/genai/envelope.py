"""The result envelope `genai-result/0.1` (design section 10.3).

Hashed parts travel as exact strings: TypeScript verifies SHA-256 over the
string's UTF-8 bytes and then parses it, never re-serialising, because
Python writes `1.0` where JavaScript writes `1`. Items always pin by
`itemsSha256`; they travel inline only when they fit (size procedure).
"""
from __future__ import annotations

import json

from . import hashing, limits
from .errors import fail, require

ENVELOPE_SCHEMA = "genai-result/0.1"


def _json_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build_envelope(computation, items_jsonl, manifest, provenance=None):
    computation_json = hashing.canonical(computation).decode("utf-8")
    prov = dict(provenance or {})
    out_prov = {
        "channel": prov.get("channel", "cli"),
        "producedAt": prov.get("producedAt"),
        "requestSha256": prov.get("requestSha256"),
        "inputHashes": {str(i): spec["sha256"] for i, spec in enumerate(manifest["inputs"])},
        "workerVersion": prov.get("workerVersion"),
        "imageDigest": prov.get("imageDigest"),
        "executionMode": "genai_ingest",
    }
    base = {
        "schemaVersion": ENVELOPE_SCHEMA,
        "computationJSON": computation_json,
        "computationSha256": hashing.sha256_bytes(computation_json.encode("utf-8")),
        "itemsJSONL": items_jsonl,
        "itemsSha256": hashing.sha256_bytes(items_jsonl.encode("utf-8")),
        "provenance": out_prov,
    }
    if len(items_jsonl.encode("utf-8")) <= limits.MAX_INLINE_ITEMS_BYTES and fits(base):
        return base
    base["itemsJSONL"] = None
    if fits(base):
        return base
    fail("evidence_too_large", "the computation alone exceeds the result limits")


def fits(envelope) -> bool:
    result = _json_bytes(envelope)
    if len(result) > limits.MAX_RESULT_BYTES:
        return False
    return len(_json_bytes(result.decode("utf-8"))) + limits.COMPLETION_OVERHEAD_BYTES <= limits.MAX_COMPLETION_BYTES


def envelope_json(envelope) -> str:
    """The exact `resultJSON` string a worker returns and the CLI writes."""
    return _json_bytes(envelope).decode("utf-8")


def verify(envelope, expected=None):
    """Check the envelope's own pins; with `expected` (a fresh run_bundle result), also re-performance."""
    require(isinstance(envelope, dict) and envelope.get("schemaVersion") == ENVELOPE_SCHEMA, "invalid_json", "not a genai-result/0.1 envelope")
    computation_json = envelope.get("computationJSON")
    require(isinstance(computation_json, str), "invalid_json", "computationJSON")
    problems = []
    if hashing.sha256_bytes(computation_json.encode("utf-8")) != envelope.get("computationSha256"):
        problems.append("computationSha256")
    items = envelope.get("itemsJSONL")
    if items is not None and hashing.sha256_bytes(items.encode("utf-8")) != envelope.get("itemsSha256"):
        problems.append("itemsSha256")
    if expected is not None:
        if expected["computationSha256"] != envelope.get("computationSha256"):
            problems.append("computationSha256 differs from the re-performance")
        if expected["itemsSha256"] != envelope.get("itemsSha256"):
            problems.append("itemsSha256 differs from the re-performance")
    return problems
