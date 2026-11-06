"""Art. 50 marking checks (`genai-marking-check/0.1`; research edits A50-ED-30, A50-ED-31 and A50-ED-34 of #59).

One record per checked output: its hash, modality, format and channel, the
pre-registered stratum keys, the transformation applied (if any), the
metadata validation (for example a C2PA validator's status codes and
signer) and the watermark detector's identity, score, threshold and
decision, plus the ground truth (marked, human-made, other AI) and, for
interaction disclosure, whether the system identified itself as AI.

The engine recomputes the marking criteria from these records with Wilson
intervals. It never runs a provider's detector or a C2PA validator itself.
A signature or validator verdict in a record is the provider's or the
validator's claim: until signature verification lands (follow-up), every
record whose `metadata.signatureVerified` is not established by the engine
carries the warning `marking_signature_unverified`.

Marking evidence levels (A50-ED-34): L0 provider-declared figures (entered
in the workspace, never an engine output); L1 a hashed provider test log
that could not be recomputed; L2 per-item marking records recomputed here;
L3 an auditor-run sampling and transformation battery with an attestation
that pins detector versions and inputs (workspace, #33).
"""
from __future__ import annotations

import math
import re

from .. import hashing
from ..errors import Warnings, require
from ..readers import load_jsonl

FORMAT = "marking_check_jsonl"
SCHEMA = "genai-marking-check/0.1"
MODALITIES = ("text", "image", "audio", "video", "multimodal")
GROUND_TRUTH = ("marked", "human_made", "other_ai")
DECISIONS = ("marked", "not_marked", "inconclusive")
CODE = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
KEYS = ("schemaVersion", "checkId", "outputSha256", "modality", "format", "channel", "stratum", "transformation", "metadata", "watermark", "groundTruth", "selfIdentification")


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("schemaVersion") == SCHEMA


def _text(value, maximum=300, nullable=True):
    return (nullable and value is None) or (isinstance(value, str) and 0 < len(value) <= maximum)


def parse(spec, data):
    name = spec["name"]
    rows = load_jsonl(data, name)
    require(rows and detect(rows[0][1]), "format_mismatch", name)
    run_key = spec.get("runKey") or hashing.compose("marking", hashing.t16(spec["sha256"]))
    records, ids = [], set()
    warnings = Warnings()
    for number, row in rows:
        where = f"{name}:{number}"
        require(set(row) <= set(KEYS) and row.get("schemaVersion") == SCHEMA, "invalid_json", f"{where}: unknown keys or schema")
        check_id = row.get("checkId")
        require(isinstance(check_id, str) and hashing.COMPONENT.match(check_id) and check_id not in ids, "invalid_json", f"{where}: checkId must be a unique key component")
        ids.add(check_id)
        require(isinstance(row.get("outputSha256"), str) and hashing.SHA256.match(row["outputSha256"]), "invalid_json", f"{where}: outputSha256")
        require(row.get("modality") in MODALITIES, "invalid_json", f"{where}: modality")
        require(_text(row.get("format"), 100) and _text(row.get("channel"), 100), "invalid_json", f"{where}: format or channel")
        stratum = row.get("stratum", {})
        require(isinstance(stratum, dict) and len(stratum) <= 20 and all(CODE.match(k) and isinstance(v, str) and 0 < len(v) <= 300 for k, v in stratum.items()), "invalid_json", f"{where}: stratum")
        transformation = row.get("transformation")
        if transformation is not None:
            require(isinstance(transformation, dict) and set(transformation) <= {"id", "parameters"} and isinstance(transformation.get("id"), str) and CODE.match(transformation["id"]), "invalid_json", f"{where}: transformation")
            params = transformation.get("parameters", {})
            require(isinstance(params, dict) and len(params) <= 20 and all(CODE.match(k) and isinstance(v, (str, int, float, bool)) and not (isinstance(v, float) and not math.isfinite(v)) for k, v in params.items()), "invalid_json", f"{where}: transformation.parameters")
            transformation = {"id": transformation["id"], "parameters": {k: (hashing.clean(v)[:300] if isinstance(v, str) else v) for k, v in params.items()}}
        metadata = row.get("metadata")
        if metadata is not None:
            require(isinstance(metadata, dict) and set(metadata) <= {"standard", "present", "validationStatus", "signer", "signatureVerified"}, "invalid_json", f"{where}: metadata")
            require(_text(metadata.get("standard"), 100) and isinstance(metadata.get("present"), bool), "invalid_json", f"{where}: metadata.present")
            codes = metadata.get("validationStatus", [])
            require(isinstance(codes, list) and len(codes) <= 50 and all(isinstance(c, str) and CODE.match(c) for c in codes), "invalid_json", f"{where}: metadata.validationStatus")
            require(_text(metadata.get("signer")) and metadata.get("signatureVerified") in (None, True, False), "invalid_json", f"{where}: metadata.signer")
            metadata = {"standard": metadata.get("standard"), "present": metadata["present"], "validationStatus": list(codes),
                        "signer": hashing.redact(hashing.clean(metadata["signer"]), warnings, where) if metadata.get("signer") else None,
                        "signatureClaimed": metadata.get("signatureVerified"), "signatureVerifiedByEngine": False}
            if metadata["signatureClaimed"] is not None:
                warnings.add("marking_signature_unverified", where)
        watermark = row.get("watermark")
        if watermark is not None:
            require(isinstance(watermark, dict) and set(watermark) <= {"detectorId", "detectorVersion", "score", "threshold", "decision"}, "invalid_json", f"{where}: watermark")
            require(_text(watermark.get("detectorId"), 100, False) and _text(watermark.get("detectorVersion"), 100) and watermark.get("decision") in DECISIONS, "invalid_json", f"{where}: watermark detector")
            for key in ("score", "threshold"):
                value = watermark.get(key)
                require(value is None or (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)), "invalid_json", f"{where}: watermark.{key}")
            watermark = {k: watermark.get(k) for k in ("detectorId", "detectorVersion", "score", "threshold", "decision")}
        require(row.get("groundTruth") in GROUND_TRUTH, "invalid_json", f"{where}: groundTruth")
        require(row.get("selfIdentification") in (None, True, False), "invalid_json", f"{where}: selfIdentification")
        records.append({
            "schemaVersion": SCHEMA, "recordKey": f"{run_key}|{check_id}", "checkId": check_id, "runKey": run_key,
            "source": {"fileSha256": spec["sha256"], "locator": where},
            "outputSha256": row["outputSha256"], "modality": row["modality"], "format": row.get("format"), "channel": row.get("channel"),
            "stratum": dict(stratum), "transformation": transformation, "metadata": metadata, "watermark": watermark,
            "groundTruth": row["groundTruth"], "selfIdentification": row.get("selfIdentification"),
        })
    return {"runKey": run_key, "inputSha256": spec["sha256"], "records": records, "warnings": warnings}


# Status codes whose last segment marks a failed validation (C2PA validator vocabulary, for example
# claimSignature.mismatch or signingCredential.revoked); any such code makes the metadata invalid.
FAILURE_SUFFIXES = ("mismatch", "missing", "invalid", "revoked", "expired", "untrusted", "error", "failure", "malformed", "outsideValidity")


def metadata_valid(meta):
    return bool(meta and meta["present"] and not any(code.rsplit(".", 1)[-1] in FAILURE_SUFFIXES for code in meta["validationStatus"]))


def _marked(record):
    wm = record["watermark"]
    return metadata_valid(record["metadata"]) or bool(wm and wm["decision"] == "marked")


def _stratum_matches(record, stratum):
    if not stratum:
        return True
    key, _, value = stratum.partition("=")
    return record["stratum"].get(key) == value


def criterion_members(criterion, marking_runs, plan, level):
    from ..recompute import proportion_member
    metric = criterion["metric"]
    members, total = [], 0
    for run in marking_runs:
        records = [r for r in run["records"] if _stratum_matches(r, criterion.get("stratum"))]
        if metric == "marking_presence":
            pool = [r for r in records if r["groundTruth"] != "human_made"]
            values = [1.0 if _marked(r) else 0.0 for r in pool]
        elif metric == "detection_rate":
            pool = [r for r in records if r["groundTruth"] == "marked" and r["transformation"] is None and r["watermark"] and r["watermark"]["decision"] != "inconclusive"]
            values = [1.0 if r["watermark"]["decision"] == "marked" else 0.0 for r in pool]
        elif metric == "detection_rate_after_transformation":
            pool = [r for r in records if r["groundTruth"] == "marked" and r["transformation"] and r["transformation"]["id"] == criterion["transformation"] and r["watermark"] and r["watermark"]["decision"] != "inconclusive"]
            values = [1.0 if r["watermark"]["decision"] == "marked" else 0.0 for r in pool]
        elif metric == "false_positive_rate":
            pool = [r for r in records if r["groundTruth"] == "human_made" and r["watermark"] and r["watermark"]["decision"] != "inconclusive"]
            values = [1.0 if r["watermark"]["decision"] == "marked" else 0.0 for r in pool]
        else:  # self_identification_rate
            pool = [r for r in records if r["selfIdentification"] is not None]
            values = [1.0 if r["selfIdentification"] else 0.0 for r in pool]
        member = proportion_member(metric, metric, criterion["band"], values, None, level, plan["minimums"], subject=run["runKey"],
                                   size_floor=plan["minimums"]["sampleSize"], size_reason="below_minimum_sample_size")
        member["memberId"] = f"{run['runKey']}|{metric}" if len(marking_runs) > 1 else metric
        members.append(member)
        total += len(values)
    return members, [], (min(m["counts"]["n"] for m in members) if members else 0)
