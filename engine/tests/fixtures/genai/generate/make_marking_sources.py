"""Write the synthetic C2PA validator report and signed detection fixtures (#128).

    python -I engine/tests/fixtures/genai/generate/make_marking_sources.py engine/tests/fixtures/genai/marking

Both files are synthetic format samples, not evidence about any real system:

- c2pa_reports.jsonl (`genai-c2pa-report/0.1`): 80 sampled outputs. Each `report` is shaped like the
  manifest store report of the C2PA reference implementation (c2patool / c2pa-rs `Reader::json()`:
  `active_manifest`, `manifests`, `validation_results`, `validation_state`); it was written by this
  script, not by running a validator.
- signed_detections.jsonl (`genai-signed-detection/0.1`): 100 detection results in DSSE envelopes,
  signed with the TEST-ONLY Ed25519 key below; detection-key.json holds its public key as the plan
  pins it. Ed25519 signatures are deterministic, so the bytes are reproducible.

Needs the `cryptography` package (engine/requirements-dev.txt).
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# TEST-ONLY signing key: derived from a public phrase, so anyone can sign with it. Never trust it outside tests.
SEED = hashlib.sha256(b"ai-assurance genai test detection key, never trusted outside tests").digest()
KEY_ID = "test-detector-key-1"
SOLUTION = "example-detector"
PAYLOAD_TYPE = "application/vnd.ai-assurance.detection-result+json"
IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/"


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def line(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n"


def c2pa_report(i, *, failure=None, ai=True, trusted=True):
    label = f"urn:c2pa:00000000-0000-4000-8000-{i:012d}"
    actions = [{"action": "c2pa.created", "digitalSourceType": IPTC + ("trainedAlgorithmicMedia" if ai else "digitalCapture")}]
    success = [{"code": "claimSignature.insideValidity", "url": "self#jumbf=/c2pa/" + label + "/c2pa.signature", "explanation": "claim signature valid"},
               {"code": "claimSignature.validated", "url": "self#jumbf=/c2pa/" + label + "/c2pa.signature", "explanation": "claim signature valid"},
               {"code": "assertion.dataHash.match", "url": "self#jumbf=/c2pa/" + label + "/c2pa.assertions/c2pa.hash.data", "explanation": "data hash valid"}]
    if trusted:
        success.insert(0, {"code": "signingCredential.trusted", "url": "self#jumbf=/c2pa/" + label + "/c2pa.signature", "explanation": "signing certificate trusted"})
    failures = [{"code": failure, "url": "self#jumbf=/c2pa/" + label + "/c2pa.assertions/c2pa.hash.data", "explanation": "synthetic failure"}] if failure else []
    return {
        "active_manifest": label,
        "manifests": {label: {
            "claim_generator": "example-generator/1.0 c2pa-rs/0.0.0",
            "title": f"output-{i}.png", "format": "image/png", "instance_id": f"xmp:iid:{i:08d}",
            "assertions": [{"label": "c2pa.actions.v2", "data": {"actions": actions}}, {"label": "c2pa.hash.data", "data": {"name": "jumbf manifest"}}],
            "signature_info": {"alg": "Ps256", "issuer": "Example Provider Signing CA", "cert_serial_number": "1234", "time": "2026-11-10T09:00:00+00:00"},
        }},
        "validation_results": {"activeManifest": {"success": success, "informational": [], "failure": failures}},
        "validation_state": "Invalid" if failure else "Trusted" if trusted else "Valid",
    }


def c2pa_rows():
    rows = []
    for i in range(40):
        failure = "assertion.dataHash.mismatch" if i in (3, 17, 29) else None
        report = c2pa_report(i, failure=failure, ai=i not in (11, 23), trusted=i % 10 != 9)
        rows.append({"schemaVersion": "genai-c2pa-report/0.1", "checkId": f"img-{i}", "outputSha256": digest(f"img-{i}"), "modality": "image", "format": "png",
                     "channel": "api", "stratum": {"model": "gen-a"}, "transformation": None, "groundTruth": "marked",
                     "validator": {"name": "c2patool", "version": "0.0.0-synthetic"}, "report": report})
    for i in range(10):
        rows.append({"schemaVersion": "genai-c2pa-report/0.1", "checkId": f"stripped-{i}", "outputSha256": digest(f"stripped-{i}"), "modality": "image", "format": "png",
                     "channel": "share", "stratum": {"model": "gen-a"}, "transformation": {"id": "reencode", "parameters": {"quality": 80}}, "groundTruth": "marked",
                     "validator": {"name": "c2patool", "version": "0.0.0-synthetic"}, "report": None})
    for i in range(30):
        rows.append({"schemaVersion": "genai-c2pa-report/0.1", "checkId": f"human-{i}", "outputSha256": digest(f"human-{i}"), "modality": "image", "format": "jpeg",
                     "channel": "upload", "stratum": {"model": "none"}, "transformation": None, "groundTruth": "human_made",
                     "validator": {"name": "c2patool", "version": "0.0.0-synthetic"}, "report": None})
    return rows


def pae(payload):
    kind = PAYLOAD_TYPE.encode()
    return b"DSSEv1 %d %s %d %s" % (len(kind), kind, len(payload), payload)


def signed(key, check_id, decision, score, basis="watermark", **sample):
    content = digest(check_id)
    payload = json.dumps({"schemaVersion": "genai-detection-result/0.1", "contentSha256": content, "solutionId": SOLUTION, "solutionVersion": "2.1",
                          "timestamp": "2026-11-10T10:00:00Z", "basis": basis, "decision": decision, "score": score, "threshold": 0.5},
                         separators=(",", ":")).encode()
    envelope = {"payloadType": PAYLOAD_TYPE, "payload": base64.b64encode(payload).decode(),
                "signatures": [{"keyid": KEY_ID, "sig": base64.b64encode(key.sign(pae(payload))).decode()}]}
    return {"schemaVersion": "genai-signed-detection/0.1", "checkId": check_id, "outputSha256": content, **sample, "envelope": envelope}


def detection_rows(key):
    rows = []
    for i in range(40):
        rows.append(signed(key, f"img-{i}", "marked" if i % 8 else "not_marked", 0.9 if i % 8 else 0.2, modality="image", format="png", channel="api",
                           stratum={"model": "gen-a"}, transformation=None, groundTruth="marked"))
    for i in range(30):
        rows.append(signed(key, f"crop-{i}", "marked" if i % 3 else "not_marked", 0.6 if i % 3 else 0.4, modality="image", format="png", channel="api",
                           stratum={"model": "gen-a"}, transformation={"id": "crop", "parameters": {"fraction": 0.5}}, groundTruth="marked"))
    for i in range(30):
        rows.append(signed(key, f"human-{i}", "marked" if i == 4 else "inconclusive" if i == 5 else "not_marked", 0.1, modality="image", format="jpeg",
                           channel="upload", stratum={"model": "none"}, transformation=None, groundTruth="human_made"))
    return rows


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.from_private_bytes(SEED)
    spki = base64.b64encode(key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)).decode()
    (out / "c2pa_reports.jsonl").write_text("".join(line(r) for r in c2pa_rows()), encoding="utf-8", newline="\n")
    (out / "signed_detections.jsonl").write_text("".join(line(r) for r in detection_rows(key)), encoding="utf-8", newline="\n")
    (out / "detection-key.json").write_text(json.dumps({"keyId": KEY_ID, "solutionId": SOLUTION, "algorithm": "Ed25519", "publicKeySPKI": spki}, indent=1) + "\n",
                                            encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
