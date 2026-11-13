"""C2PA validator reports as marking evidence (`genai-c2pa-report/0.1`; research edit A50-ED-33, #128).

One JSON object per line and per sampled output: the marking-check fields
(checkId, outputSha256, modality, format, channel, stratum, transformation,
groundTruth), the validator that produced the report (`validator.name`,
`validator.version`) and `report`, the validator's own JSON output for that
asset, copied unchanged: the manifest store report that the C2PA reference
implementation writes (c2patool, or `Reader::json()` of c2pa-rs and its
bindings), or null when the validator found no manifest. The engine reads
only these keys of a report, by name:

- `active_manifest` and `manifests[<active>]`: whether a manifest is present,
  `claim_generator`, `signature_info.issuer` and `signature_info.time`, and the
  digital source types of the active manifest's `c2pa.actions` (or
  `c2pa.actions.v2`) assertion;
- `validation_state` (`Invalid`, `Valid` or `Trusted`);
- `validation_results.activeManifest.{success,informational,failure}[].code`,
  or for older reports `validation_status[].code`, whose failure codes are
  told apart by their last segment (`marking.FAILURE_SUFFIXES`).

Everything else in a report (thumbnails, ingredients, other assertions) is
ignored. The engine never runs a C2PA validator and never verifies the COSE
signature of a manifest itself: the validation verdict is the named
validator's, so each record with a manifest carries the warning
`marking_signature_unverified`, as a `genai-marking-check/0.1` record does.
The auditor chooses which validator to trust by running it (A50-P-02D-S01:
independent tooling that implements the declared open standard).
"""
from __future__ import annotations

from .. import hashing
from ..errors import Warnings, require
from ..readers import load_jsonl
from . import marking

FORMAT = "c2pa_validator_report"
SCHEMA = "genai-c2pa-report/0.1"
KEYS = ("schemaVersion", *marking.SAMPLE_KEYS, "validator", "report")
STATES = ("Invalid", "Valid", "Trusted")
# IPTC digital source type terms that state generation or manipulation by a trained model (C2PA 2.5, clause 16.4.1).
AI_SOURCE_TYPES = ("trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia")
ACTION_LABELS = ("c2pa.actions", "c2pa.actions.v2")
MAX_CODES = 50


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("schemaVersion") == SCHEMA


def _string(value, maximum=300):
    return hashing.clean(value)[:maximum] if isinstance(value, str) and value else None


def _codes(entries):
    """Status codes of one list of validation entries; anything that is not a code is dropped."""
    out = []
    for entry in entries if isinstance(entries, list) else []:
        code = entry.get("code") if isinstance(entry, dict) else None
        if isinstance(code, str) and marking.CODE.match(code) and code not in out:
            out.append(code)
    return out


def _source_types(manifest):
    """The IPTC term names (last path segment) of the digital source types in the actions assertions."""
    found = []
    for assertion in manifest.get("assertions") if isinstance(manifest.get("assertions"), list) else []:
        if not isinstance(assertion, dict) or assertion.get("label") not in ACTION_LABELS or not isinstance(assertion.get("data"), dict):
            continue
        actions = assertion["data"].get("actions")
        for action in actions if isinstance(actions, list) else []:
            source = action.get("digitalSourceType") if isinstance(action, dict) else None
            if isinstance(source, str) and source:
                term = source.rstrip("/").rsplit("/", 1)[-1]
                if marking.CODE.match(term) and term not in found and len(found) < 20:
                    found.append(term)
    return found


def read_report(report, where):
    """The validation facts of one report: (metadata, c2pa) for the record."""
    require(report is None or isinstance(report, dict), "invalid_json", f"{where}: report must be an object or null")
    report = report or {}
    manifests = report.get("manifests") if isinstance(report.get("manifests"), dict) else {}
    active_label = report.get("active_manifest")
    active = manifests.get(active_label) if isinstance(active_label, str) else None
    active = active if isinstance(active, dict) else None
    present = active is not None
    state = report.get("validation_state")
    require(state is None or state in STATES, "invalid_json", f"{where}: report.validation_state")
    results = report.get("validation_results")
    if isinstance(results, dict) and isinstance(results.get("activeManifest"), dict):
        current = results["activeManifest"]
        success, informational, failures = _codes(current.get("success")), _codes(current.get("informational")), _codes(current.get("failure"))
    else:
        # Older reports list problems only, in validation_status; tell failures apart by their last segment.
        legacy = _codes(report.get("validation_status"))
        failures = [c for c in legacy if c.rsplit(".", 1)[-1] in marking.FAILURE_SUFFIXES]
        success, informational = [], [c for c in legacy if c not in failures]
    if state is None and failures:
        state = "Invalid"
    signature = active.get("signature_info") if present and isinstance(active.get("signature_info"), dict) else {}
    types = _source_types(active) if present else []
    codes = (failures + success + informational)[:MAX_CODES]
    metadata = {"standard": "C2PA", "present": present, "validationStatus": codes, "signer": _string(signature.get("issuer")),
                "signatureClaimed": (state in ("Valid", "Trusted")) if present and state is not None else None, "signatureVerifiedByEngine": False}
    c2pa = {"validationState": state, "trusted": state == "Trusted", "failureCodes": failures[:MAX_CODES],
            "aiAssertion": any(t in AI_SOURCE_TYPES for t in types), "digitalSourceTypes": types,
            "claimGenerator": _string(active.get("claim_generator")) if present else None, "signedAt": _string(signature.get("time"), 64)}
    return metadata, c2pa


def parse(spec, data):
    name = spec["name"]
    rows = load_jsonl(data, name)
    require(rows and detect(rows[0][1]), "format_mismatch", name)
    run_key = spec.get("runKey") or hashing.compose("c2pa", hashing.t16(spec["sha256"]))
    records, ids = [], set()
    warnings = Warnings()
    for number, row in rows:
        where = f"{name}:{number}"
        require(set(row) <= set(KEYS) and row.get("schemaVersion") == SCHEMA and "report" in row, "invalid_json", f"{where}: unknown keys, schema or no report")
        fields = marking.sample_fields(row, where, ids=ids)
        validator = row.get("validator")
        require(isinstance(validator, dict) and set(validator) <= {"name", "version"} and marking._text(validator.get("name"), 100, False) and marking._text(validator.get("version"), 100), "invalid_json", f"{where}: validator")
        metadata, c2pa = read_report(row["report"], where)
        metadata["signer"] = hashing.redact(metadata["signer"], warnings, where) if metadata["signer"] else None
        c2pa["validator"] = {"name": hashing.clean(validator["name"]), "version": hashing.clean(validator.get("version"))}
        if metadata["present"]:
            warnings.add("marking_signature_unverified", where)
        records.append(marking.record(run_key, spec, where, fields, metadata=metadata, c2pa=c2pa))
    return marking.block(FORMAT, run_key, spec, records, warnings)
