"""Art. 50 marking checks (`genai-marking-check/0.1`; research edits A50-ED-30, A50-ED-31 and A50-ED-34 of #59).

One record per checked output: its hash, modality, format and channel, the
pre-registered stratum keys, the transformation applied (if any), the
metadata validation (for example a C2PA validator's status codes and
signer) and the watermark detector's identity, score, threshold and
decision, plus the ground truth (marked, human-made, other AI) and, for
interaction disclosure, whether the system identified itself as AI.

The engine recomputes the marking criteria from these records with Wilson
intervals. It never runs a provider's detector or a C2PA validator itself.
A signature or validator verdict in a `genai-marking-check/0.1` record is the
provider's or the validator's claim, so every such record with a claimed
signature verdict carries the warning `marking_signature_unverified`. Two
further inputs feed the same records (#128, A50-ED-33): C2PA validator
reports (`c2pa.py`) and detection results signed by the provider's detection
solution (`signed_detection.py`, Code Sub-measure 2.1.2), whose signatures
the engine verifies against keys pinned in the frozen plan.

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
# The fields every marking input line shares (sample_fields).
SAMPLE_KEYS = ("checkId", "outputSha256", "modality", "format", "channel", "stratum", "transformation", "groundTruth")


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("schemaVersion") == SCHEMA


def _text(value, maximum=300, nullable=True):
    return (nullable and value is None) or (isinstance(value, str) and 0 < len(value) <= maximum)


def sample_fields(row, where, *, ids):
    """The fields every marking record shares, from one input line: the check, the sampled output and its design.

    `ids` collects the checkIds of the input, which must be unique key components.
    """
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
    require(row.get("groundTruth") in GROUND_TRUTH, "invalid_json", f"{where}: groundTruth")
    return {"checkId": check_id, "outputSha256": row["outputSha256"], "modality": row["modality"], "format": hashing.clean(row.get("format")), "channel": hashing.clean(row.get("channel")),
            "stratum": {k: hashing.clean(v) for k, v in stratum.items()}, "transformation": transformation, "groundTruth": row["groundTruth"]}


def record(run_key, spec, where, fields, *, metadata=None, watermark=None, self_identification=None, **extra):
    """One marking record in the shape of `computation.marking[].records[]` (schemas/genai-result.schema.json#/$defs/markingCheck)."""
    out = {
        "schemaVersion": SCHEMA, "recordKey": f"{run_key}|{fields['checkId']}", "checkId": fields["checkId"], "runKey": run_key,
        "source": {"fileSha256": spec["sha256"], "locator": where[:1024]},
        "outputSha256": fields["outputSha256"], "modality": fields["modality"], "format": fields["format"], "channel": fields["channel"],
        "stratum": fields["stratum"], "transformation": fields["transformation"], "metadata": metadata, "watermark": watermark,
        "groundTruth": fields["groundTruth"], "selfIdentification": self_identification,
    }
    out.update(extra)
    return out


def detector_result(watermark, where):
    """A detector's identity, score, threshold and decision: the `watermark` slot of a record."""
    require(isinstance(watermark, dict), "invalid_json", f"{where}: watermark")
    require(_text(watermark.get("detectorId"), 100, False) and _text(watermark.get("detectorVersion"), 100) and watermark.get("decision") in DECISIONS, "invalid_json", f"{where}: watermark detector")
    for key in ("score", "threshold"):
        value = watermark.get(key)
        require(value is None or (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)), "invalid_json", f"{where}: watermark.{key}")
    return {"detectorId": hashing.clean(watermark["detectorId"]), "detectorVersion": hashing.clean(watermark.get("detectorVersion")),
            "score": watermark.get("score"), "threshold": watermark.get("threshold"), "decision": watermark["decision"]}


def block(fmt, run_key, spec, records, warnings):
    """One parsed marking input: a block of `computation.marking[]` once ingest adds its evidence level."""
    return {"format": fmt, "runKey": run_key, "inputSha256": spec["sha256"], "records": records, "warnings": warnings}


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
        fields = sample_fields(row, where, ids=ids)
        metadata = row.get("metadata")
        if metadata is not None:
            require(isinstance(metadata, dict) and set(metadata) <= {"standard", "present", "validationStatus", "signer", "signatureVerified"}, "invalid_json", f"{where}: metadata")
            require(_text(metadata.get("standard"), 100) and isinstance(metadata.get("present"), bool), "invalid_json", f"{where}: metadata.present")
            codes = metadata.get("validationStatus", [])
            require(isinstance(codes, list) and len(codes) <= 50 and all(isinstance(c, str) and CODE.match(c) for c in codes), "invalid_json", f"{where}: metadata.validationStatus")
            require(_text(metadata.get("signer")) and metadata.get("signatureVerified") in (None, True, False), "invalid_json", f"{where}: metadata.signer")
            metadata = {"standard": hashing.clean(metadata.get("standard")), "present": metadata["present"], "validationStatus": list(codes),
                        "signer": hashing.redact(hashing.clean(metadata["signer"]), warnings, where) if metadata.get("signer") else None,
                        "signatureClaimed": metadata.get("signatureVerified"), "signatureVerifiedByEngine": False}
            if metadata["signatureClaimed"] is not None:
                warnings.add("marking_signature_unverified", where)
        watermark = row.get("watermark")
        if watermark is not None:
            require(isinstance(watermark, dict) and set(watermark) <= {"detectorId", "detectorVersion", "score", "threshold", "decision"}, "invalid_json", f"{where}: watermark")
            watermark = detector_result(watermark, where)
        require(row.get("selfIdentification") in (None, True, False), "invalid_json", f"{where}: selfIdentification")
        records.append(record(run_key, spec, where, fields, metadata=metadata, watermark=watermark, self_identification=row.get("selfIdentification")))
    return block(FORMAT, run_key, spec, records, warnings)


# Status codes whose last segment marks a failed validation (C2PA validator vocabulary, for example
# claimSignature.mismatch or signingCredential.revoked); any such code makes the metadata invalid.
FAILURE_SUFFIXES = ("mismatch", "missing", "invalid", "revoked", "expired", "untrusted", "error", "failure", "malformed", "outsideValidity")


def metadata_valid(record, *, require_trusted=False):
    """Whether a record's metadata mark counts as present and valid.

    A C2PA validator report (`record["c2pa"]`) counts only when the active manifest is present, the
    validator reported no failure, its validation state is not Invalid and an actions assertion states
    AI generation or manipulation; with `require_trusted`, its state must also be Trusted (the signer
    chains to the validator's trust list). Other metadata counts when present and no status code ends
    in a failure suffix; with `require_trusted` it never counts, because nothing establishes the signer.
    """
    meta = record["metadata"]
    if not (meta and meta["present"]):
        return False
    c2pa = record.get("c2pa")
    if c2pa is not None:
        state = c2pa["validationState"]
        return not c2pa["failureCodes"] and state != "Invalid" and c2pa["aiAssertion"] and (state == "Trusted" or not require_trusted)
    if require_trusted:
        return False
    return not any(code.rsplit(".", 1)[-1] in FAILURE_SUFFIXES for code in meta["validationStatus"])


def _marked(record, require_trusted):
    wm = record["watermark"]
    return metadata_valid(record, require_trusted=require_trusted) or bool(wm and wm["decision"] == "marked")


def _stratum_matches(record, stratum):
    if not stratum:
        return True
    key, _, value = stratum.partition("=")
    return record["stratum"].get(key) == value


def criterion_members(criterion, marking_runs, plan, level):
    from ..recompute import proportion_member
    metric = criterion["metric"]
    trusted = criterion.get("requireTrustedSigner", False)
    members, total = [], 0
    for run in marking_runs:
        records = [r for r in run["records"] if _stratum_matches(r, criterion.get("stratum"))]
        if metric == "marking_presence":
            pool = [r for r in records if r["groundTruth"] != "human_made"]
            values = [1.0 if _marked(r, trusted) else 0.0 for r in pool]
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
