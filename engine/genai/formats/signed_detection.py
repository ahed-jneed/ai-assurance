"""Signed detection results as marking evidence (`genai-signed-detection/0.1`; Code Sub-measure 2.1.2, A50-ED-33, #128).

The Code of Practice asks that detection results can be downloaded in signed
form with a content hash, the detection solution's identifier and a timestamp
(research EV-A50-18, procedure A50-P-02B-S03: "verify the signatures"). No
common format exists, so the engine accepts one signed statement per sampled
output in a DSSE envelope (Dead Simple Signing Envelope, the envelope of
in-toto attestations), one JSON object per line:

    {"schemaVersion": "genai-signed-detection/0.1", "checkId": ..., "outputSha256": ...,
     "modality": ..., "format": ..., "channel": ..., "stratum": {...}, "transformation": ...,
     "groundTruth": ..., "envelope": {"payloadType": "application/vnd.ai-assurance.detection-result+json",
     "payload": "<base64>", "signatures": [{"keyid": "...", "sig": "<base64>"}]}}

The payload is the detection solution's statement (`genai-detection-result/0.1`):
`contentSha256` (the checked output), `solutionId`, `solutionVersion`,
`timestamp` (with a UTC offset), `basis` (`metadata`, `watermark`,
`fingerprint` or `forensic`), `decision` (`marked`, `not_marked`,
`inconclusive`) and optional `score` and `threshold`. Each signature is
Ed25519 over the DSSE pre-authentication encoding of the payload type and the
exact payload bytes.

The frozen plan pins the public keys (`plan.detectionKeys`: `keyId`,
`solutionId`, `algorithm` Ed25519, `publicKeySPKI`), so the auditor decides
which keys count before any result is read. A line is accepted only when a
signature by a pinned key of the payload's `solutionId` verifies and the
payload's `contentSha256` is the line's `outputSha256`. A pinned key whose
signature does not verify is tampering (`signature_invalid`); a payload that
no pinned key of its solution signed is `signature_untrusted`; a payload for
other content is `detection_content_mismatch`. Each rejects the whole bundle,
like an input whose hash differs from its pin. Verification needs the
`cryptography` package, which the compute image installs; without it the
input fails with `signature_backend_unavailable` rather than producing a
different computation.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import math
from datetime import datetime

from .. import hashing
from ..errors import Warnings, fail, require
from ..readers import decode_text, load_jsonl, loads
from . import marking

FORMAT = "signed_detection_jsonl"
SCHEMA = "genai-signed-detection/0.1"
PAYLOAD_SCHEMA = "genai-detection-result/0.1"
PAYLOAD_TYPE = "application/vnd.ai-assurance.detection-result+json"
KEYS = ("schemaVersion", *marking.SAMPLE_KEYS, "envelope")
PAYLOAD_KEYS = ("schemaVersion", "contentSha256", "solutionId", "solutionVersion", "timestamp", "basis", "decision", "score", "threshold")
BASES = ("metadata", "watermark", "fingerprint", "forensic")
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_SIGNATURES = 8
# DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410); the 32 key bytes follow.
ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("schemaVersion") == SCHEMA


def spki_key(text):
    """The 32 raw key bytes of a base64 Ed25519 SubjectPublicKeyInfo, or None."""
    raw = b64(text, 64)
    return raw[len(ED25519_SPKI_PREFIX):] if raw is not None and len(raw) == 44 and raw.startswith(ED25519_SPKI_PREFIX) else None


def b64(text, maximum):
    """Strict standard base64 (padding required, no whitespace) of at most `maximum` decoded bytes, or None."""
    if not isinstance(text, str) or len(text) > (maximum + 2) // 3 * 4 or len(text) % 4:
        return None
    try:
        return base64.b64decode(text.encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError, ValueError):
        return None


def pae(payload_type: str, payload: bytes) -> bytes:
    """DSSE v1 pre-authentication encoding: what each signature covers."""
    kind = payload_type.encode("utf-8")
    return b"DSSEv1 %d %s %d %s" % (len(kind), kind, len(payload), payload)


def _backend():
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        fail("signature_backend_unavailable", "verifying signed detection results needs the cryptography package")
    return Ed25519PublicKey, InvalidSignature


def _timestamp(value, where):
    require(isinstance(value, str) and 0 < len(value) <= 64, "invalid_json", f"{where}: payload.timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail("invalid_json", f"{where}: payload.timestamp")
    require(parsed.tzinfo is not None, "invalid_json", f"{where}: payload.timestamp needs a UTC offset")
    return value


def _payload(raw, where):
    doc = loads(decode_text(raw))
    require(isinstance(doc, dict) and set(doc) <= set(PAYLOAD_KEYS) and doc.get("schemaVersion") == PAYLOAD_SCHEMA, "invalid_json", f"{where}: payload keys or schema")
    require(isinstance(doc.get("contentSha256"), str) and hashing.SHA256.match(doc["contentSha256"]), "invalid_json", f"{where}: payload.contentSha256")
    require(marking._text(doc.get("solutionId"), 100, False) and marking._text(doc.get("solutionVersion"), 100), "invalid_json", f"{where}: payload.solutionId")
    require(doc.get("basis") in BASES, "invalid_json", f"{where}: payload.basis")
    for key in ("score", "threshold"):
        value = doc.get(key)
        require(value is None or (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)), "invalid_json", f"{where}: payload.{key}")
    _timestamp(doc.get("timestamp"), where)
    return doc


def verify_envelope(envelope, keys, where):
    """(payload document, verifying key id, payload bytes) of one DSSE envelope signed by a pinned key, or a coded rejection."""
    require(isinstance(envelope, dict) and set(envelope) == {"payloadType", "payload", "signatures"}, "invalid_json", f"{where}: envelope")
    require(envelope["payloadType"] == PAYLOAD_TYPE, "invalid_json", f"{where}: envelope.payloadType")
    raw = b64(envelope["payload"], MAX_PAYLOAD_BYTES)
    require(raw is not None, "invalid_json", f"{where}: envelope.payload is not base64 of at most 64 KiB")
    signatures = envelope["signatures"]
    require(isinstance(signatures, list) and 1 <= len(signatures) <= MAX_SIGNATURES, "invalid_json", f"{where}: envelope.signatures")
    for entry in signatures:
        require(isinstance(entry, dict) and set(entry) <= {"keyid", "sig"} and isinstance(entry.get("keyid"), str) and 0 < len(entry["keyid"]) <= 128 and isinstance(entry.get("sig"), str),
                "invalid_json", f"{where}: envelope.signatures[]")
    doc = _payload(raw, where)
    message = pae(PAYLOAD_TYPE, raw)
    public_key, invalid = None, None
    solution_key = None
    for entry in signatures:
        pinned = keys.get(entry["keyid"])
        if pinned is None:
            continue  # DSSE allows further signatures; only pinned keys count
        if public_key is None:
            public_key, invalid = _backend()
        signature = b64(entry["sig"], 64)
        require(signature is not None and len(signature) == 64, "signature_invalid", f"{where}: an Ed25519 signature has 64 bytes")
        try:
            public_key.from_public_bytes(pinned["raw"]).verify(signature, message)
        except invalid:
            fail("signature_invalid", f"{where}: the signature of pinned key {entry['keyid']} does not verify")
        if pinned["solutionId"] == doc["solutionId"] and solution_key is None:
            solution_key = entry["keyid"]
    require(solution_key is not None, "signature_untrusted", f"{where}: no key pinned for solution {doc['solutionId']!r} signed this result")
    return doc, solution_key, raw


def parse(spec, data, plan):
    name = spec["name"]
    rows = load_jsonl(data, name)
    require(rows and detect(rows[0][1]), "format_mismatch", name)
    keys = {k["keyId"]: {"solutionId": k["solutionId"], "raw": spki_key(k["publicKeySPKI"])} for k in plan.get("detectionKeys", [])}
    run_key = spec.get("runKey") or hashing.compose("signed-detection", hashing.t16(spec["sha256"]))
    records, ids = [], set()
    warnings = Warnings()
    for number, row in rows:
        where = f"{name}:{number}"
        require(set(row) <= set(KEYS) and row.get("schemaVersion") == SCHEMA and "envelope" in row, "invalid_json", f"{where}: unknown keys, schema or no envelope")
        fields = marking.sample_fields(row, where, ids=ids)
        doc, key_id, raw = verify_envelope(row["envelope"], keys, where)
        require(doc["contentSha256"] == fields["outputSha256"], "detection_content_mismatch", f"{where}: the signed result is for other content")
        detector = marking.detector_result({"detectorId": doc["solutionId"], "detectorVersion": doc.get("solutionVersion"), "score": doc.get("score"),
                                            "threshold": doc.get("threshold"), "decision": doc["decision"]}, where)
        signed = {"keyId": key_id, "algorithm": "Ed25519", "signedAt": doc["timestamp"], "basis": doc["basis"],
                  "payloadSha256": hashlib.sha256(raw).hexdigest(), "verifiedByEngine": True}
        records.append(marking.record(run_key, spec, where, fields, watermark=detector, signedResult=signed))
    return marking.block(FORMAT, run_key, spec, records, warnings)
