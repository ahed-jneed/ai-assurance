"""Read-only, bounded registry acquisition. Never load a registered model.

Registry/card metadata describes declarations. A proposal is neither an
approved system contract nor evidence of independent model inference.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .diagnostics import MAX_BYTES, sha256
from .worker import NoRedirect, create_once
from .worker_contract import json_bytes, strict_json, valid_hash

MAX_METADATA = 2 * 1024 * 1024
MAX_CARD = 512 * 1024
COMMIT = re.compile(r"^[a-f0-9]{40}$")
REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
VERSION = re.compile(r"^[1-9][0-9]{0,31}$")
PRIMITIVE_TYPES = {"double": "number", "float": "number", "float32": "number", "float64": "number", "integer": "integer", "long": "integer", "int32": "integer", "int64": "integer", "boolean": "boolean", "bool": "boolean", "string": "text", "str": "text"}


class AcquisitionError(ValueError):
    """Sanitized errors never include response content or credentials."""


class ReadOnlyHTTP:
    def __init__(self, origin, allowed_host, *, token_env=None, timeout=15, opener=None, allow_loopback_test_only=False):
        base = urllib.parse.urlsplit(origin)
        local = base.hostname in {"localhost", "127.0.0.1", "::1"}
        if not allowed_host or base.netloc.lower() != allowed_host.lower() or base.username or base.password or base.query or base.fragment or not base.hostname:
            raise AcquisitionError("Registry origin does not match the explicit allowed host")
        if base.scheme != "https" and not (allow_loopback_test_only and local and base.scheme == "http"):
            raise AcquisitionError("Registry acquisition requires HTTPS")
        if not 1 <= timeout <= 30 or any(part in {".", ".."} for part in urllib.parse.unquote(base.path).split("/")):
            raise AcquisitionError("Registry timeout/base path is outside the protocol")
        if token_env is not None and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", token_env):
            raise AcquisitionError("Token environment variable name is invalid")
        self.origin = origin.rstrip("/")
        self.scheme, self.allowed_host, self.timeout = base.scheme, allowed_host.lower(), timeout
        self.token = os.environ.get(token_env) if token_env else None
        if token_env and not self.token or self.token and any(c in self.token for c in "\r\n"):
            raise AcquisitionError("Registry token environment variable is unavailable or invalid")
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.responses = []

    def url(self, path, params=None):
        if not isinstance(path, str) or not path.startswith("/"):
            raise AcquisitionError("Application-owned endpoint path required")
        return self.origin+path+("?"+urllib.parse.urlencode(params) if params else "")

    def validate_url(self, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != self.scheme or parsed.netloc.lower() != self.allowed_host or parsed.username or parsed.password or parsed.fragment or any(ord(c) < 32 for c in url):
            raise AcquisitionError("URL is outside the exact allowed registry host")
        if any(part in {".", ".."} for part in urllib.parse.unquote(parsed.path).replace("\\", "/").split("/")):
            raise AcquisitionError("URL contains an unsafe relative path")
        if any(re.search(r"token|secret|credential|signature|authorization|api.?key", key, re.I) for key, _ in urllib.parse.parse_qsl(parsed.query)):
            raise AcquisitionError("Credential-bearing URLs are prohibited")
        return url

    def get(self, url, *, maximum=MAX_METADATA, kind="metadata"):
        self.validate_url(url)
        if not 1 <= maximum <= MAX_BYTES:
            raise AcquisitionError("Acquisition byte limit is invalid")
        headers = {"Accept": "application/json" if kind == "metadata" else "application/octet-stream", "Accept-Encoding": "identity", "User-Agent": "ai-assurance-registry-import/1.0.0"}
        if self.token:
            headers["Authorization"] = "Bearer "+self.token
        started = time.monotonic()
        try:
            with self.opener.open(urllib.request.Request(url, method="GET", headers=headers), timeout=self.timeout) as response:
                if response.geturl() != url or not 200 <= response.status < 300:
                    raise AcquisitionError("Registry redirect/status rejected")
                if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise AcquisitionError("Compressed registry responses are unsupported")
                length = response.headers.get("Content-Length")
                if length and (not length.isdigit() or int(length) > maximum):
                    raise AcquisitionError("Registry response exceeds byte limits")
                chunks, count = [], 0
                read = getattr(response, "read1", response.read)
                while True:
                    if time.monotonic()-started >= self.timeout:
                        raise AcquisitionError("Registry acquisition deadline exceeded")
                    block = read(min(64*1024, maximum+1-count))
                    if not block:
                        break
                    chunks.append(block)
                    count += len(block)
                    if count > maximum:
                        raise AcquisitionError("Registry response exceeds byte limits")
                raw = b"".join(chunks)
                if length is not None and len(raw) != int(length):
                    raise AcquisitionError("Registry response byte count mismatch")
        except AcquisitionError:
            raise
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            raise AcquisitionError("Registry transport failed or redirected") from exc
        self.responses.append({"url": url, "kind": kind, "acquiredAt": datetime.now(timezone.utc).isoformat(), "sha256": sha256(raw), "bytes": len(raw)})
        return raw

    def get_json(self, url):
        value = strict_json(self.get(url), maximum=MAX_METADATA)
        if not isinstance(value, dict):
            raise AcquisitionError("Registry metadata must be a JSON object")
        return value


def _schema_fields(value, role):
    if isinstance(value, str):
        value = strict_json(value, maximum=MAX_CARD)
    if value is None:
        return [], [role]
    if not isinstance(value, list) or len(value) > 200:
        raise AcquisitionError("Signature fields must be a bounded array")
    output, unknown, names = [], ([] if value else [role]), set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise AcquisitionError("Signature field must be an object")
        name = item.get("name")
        if name is not None and (not isinstance(name, str) or not name.strip() or len(name) > 300 or name in names):
            raise AcquisitionError("Signature field name is invalid or duplicated")
        if name is not None:
            names.add(name)
        declared = item.get("type")
        tensor = item.get("tensor-spec", {}) if declared == "tensor" else {}
        if not isinstance(tensor, dict):
            raise AcquisitionError("Tensor signature is malformed")
        dtype = tensor.get("dtype") if tensor else declared
        normalized = PRIMITIVE_TYPES.get(dtype, "unknown") if isinstance(dtype, str) else "unknown"
        shape = tensor.get("shape")
        if shape is not None and (not isinstance(shape, list) or len(shape) > 8 or any(isinstance(n, bool) or not isinstance(n, int) or not -1 <= n <= 1_000_000 for n in shape)):
            raise AcquisitionError("Tensor signature shape is outside bounds")
        required = item.get("required")
        if required is not None and not isinstance(required, bool):
            raise AcquisitionError("Signature required must be a boolean")
        prefix = role+"["+str(index)+"]"
        unknown.extend([prefix+".nullable", prefix+".unit", prefix+".nullHandling"])
        if name is None:
            unknown.append(prefix+".name")
        if normalized == "unknown":
            unknown.append(prefix+".type")
        output.append({"name": name, "type": normalized, "declaredType": copy.deepcopy(declared), "tensorDtype": tensor.get("dtype"), "shape": shape, "presenceRequired": required, "nullable": None, "nullHandling": "unknown", "unit": None, "declarationAssurance": "source_declared_unverified"})
    return output, unknown


def system_contract(signature=None, *, signature_source=None):
    """Do not equate optional column presence with value nullability."""
    if signature is not None and not isinstance(signature, dict):
        raise AcquisitionError("Signature must be an object")
    signature = signature or {}
    features, missing_input = _schema_fields(signature.get("inputs"), "features")
    output_fields, missing_output = _schema_fields(signature.get("outputs"), "outputs.fields")
    return {"schemaVersion": "1.0", "features": features, "outputs": {"fields": output_fields, "semantics": None, "classOrder": None, "threshold": None}, "preprocessing": {"status": "unknown", "artifactSha256": None}, "signatureSource": signature_source, "signature": copy.deepcopy(signature) if signature else None, "unknownFields": [*missing_input, *missing_output, "outputs.semantics", "outputs.classOrder", "outputs.threshold", "preprocessing", "population", "intendedUse", "humanDecision", "runtime"], "declarationAssurance": "source_declared_unverified", "executionReadiness": "not_assessed"}


def snapshot_base(provider, client, requested, resolved, metadata, contract, *, card=None):
    return {"schemaVersion": "1.0", "type": "registry_snapshot", "provider": provider, "status": "proposed", "auditApproval": "not_granted", "registration": {"name": resolved.get("modelName", resolved.get("repoId")), "version": resolved.get("version", resolved.get("commit")), "task": None, "format": None, "framework": metadata.get("library_name"), "declaredPipelineTag": metadata.get("pipeline_tag"), "status": "proposed", "declarationAssurance": "source_declared_unverified"}, "source": {"registryOrigin": client.origin, "allowedHost": client.allowed_host, "requestedReference": requested, "resolvedReference": resolved, "acquiredAt": datetime.now(timezone.utc).isoformat(), "responses": copy.deepcopy(client.responses), "declarationAssurance": "registry_metadata_and_card_statements_are_unverified_declarations"}, "metadata": metadata, "card": card, "systemContract": contract, "artifact": {"acquired": False, "associationAssurance": "not_acquired"}, "limitations": ["Registry identity/metadata and model-card statements are declarations until independently corroborated.", "This proposal grants no audit approval, runtime readiness, artifact safety, dataset independence or legal compliance conclusion.", "No model, custom loader, package or repository code is executed.", "Feature presence/type declarations do not establish preprocessing, null handling, units, population, output semantics or class order."]}


def mlflow_snapshot(client, name, *, version=None, alias=None, signature=None, signature_source=None):
    if not isinstance(name, str) or not 1 <= len(name) <= 300 or any(ord(c) < 32 for c in name) or bool(version) == bool(alias):
        raise AcquisitionError("Specify a model name and exactly one exact version or alias")
    observation = None
    if alias:
        if not isinstance(alias, str) or not 1 <= len(alias) <= 256 or any(ord(c) < 32 for c in alias):
            raise AcquisitionError("Invalid model alias")
        observation = client.get_json(client.url("/api/2.0/mlflow/registered-models/alias", {"name": name, "alias": alias})).get("model_version")
        if not isinstance(observation, dict) or observation.get("name") != name:
            raise AcquisitionError("Alias response does not match the requested model")
        version = str(observation.get("version", ""))
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise AcquisitionError("Model version must resolve to an exact positive numeric version")
    response = client.get_json(client.url("/api/2.0/mlflow/model-versions/get", {"name": name, "version": version}))
    model = response.get("model_version")
    if not isinstance(model, dict) or model.get("name") != name or str(model.get("version")) != version:
        raise AcquisitionError("Exact model-version response identity mismatch")
    if observation and any(observation.get(key) != model.get(key) for key in ("source", "run_id")):
        raise AcquisitionError("Resolved model source/run changed during alias acquisition")
    requested = {"modelName": name, "version": None if alias else version, "alias": alias}
    resolved = {"modelName": name, "version": version, "sourceURI": model.get("source"), "runId": model.get("run_id"), "aliasObservation": {"alias": alias, "resolvedVersion": version, "mutable": True} if alias else None}
    result = snapshot_base("mlflow", client, requested, resolved, response, system_contract(signature, signature_source=signature_source))
    result["limitations"].extend(["A frozen registry version identifies the observed record; mutable tags/descriptions and artifact bytes require separate hashes.", "The model-version REST response does not establish a feature signature. Supply a separately acquired MLflow signature JSON export with its source reference; absent signatures remain explicit unknowns.", "External source URIs are retained as declarations and never followed automatically."])
    return result


def huggingface_snapshot(client, repo, *, revision="main", signature=None, signature_source=None, include_card=True):
    if not isinstance(repo, str) or not REPO.fullmatch(repo) or not isinstance(revision, str) or not 1 <= len(revision) <= 200 or any(ord(c) < 32 for c in revision):
        raise AcquisitionError("Hugging Face requires owner/repository and a bounded revision")
    prefix = "/api/models/"+repo+"/revision/"
    observed = client.get_json(client.url(prefix+urllib.parse.quote(revision, safe=""), {"blobs": "true"}))
    commit = observed.get("sha")
    if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        raise AcquisitionError("Repository revision did not resolve to a full commit")
    if COMMIT.fullmatch(revision) and commit != revision:
        raise AcquisitionError("Requested exact commit does not match the response")
    pinned = client.get_json(client.url(prefix+commit, {"blobs": "true"})) if revision != commit else observed
    if pinned.get("sha") != commit or pinned.get("id", pinned.get("modelId")) != repo:
        raise AcquisitionError("Pinned repository metadata identity mismatch")
    card_data = pinned.get("cardData")
    if card_data is not None and not isinstance(card_data, dict):
        raise AcquisitionError("Model card metadata is malformed")
    card_data = card_data or {}
    if signature is None and isinstance(card_data.get("signature"), dict):
        signature = card_data["signature"]
        signature_source = {"kind": "model_card_declared_signature", "repoId": repo, "commit": commit, "location": "cardData.signature", "assurance": "unverified_source_declaration"}
    card = {"metadata": card_data, "text": None, "sha256": None, "declarationAssurance": "source_declared_unverified", "acquisition": "metadata_only"}
    siblings = pinned.get("siblings", [])
    if not isinstance(siblings, list) or len(siblings) > 10000:
        raise AcquisitionError("Repository file listing exceeds bounds")
    if include_card and any(isinstance(item, dict) and item.get("rfilename") == "README.md" for item in siblings):
        url = client.url("/"+repo+"/raw/"+commit+"/README.md")
        raw = client.get(url, maximum=MAX_CARD, kind="model_card")
        try:
            card.update(text=raw.decode("utf-8"), sha256=sha256(raw), acquisition="exact_commit_card")
        except UnicodeError as exc:
            raise AcquisitionError("Model card is not bounded UTF-8") from exc
    result = snapshot_base("huggingface", client, {"repoId": repo, "revision": revision}, {"repoId": repo, "commit": commit, "requestedRevisionWasMutable": revision != commit}, pinned, system_contract(signature, signature_source=signature_source), card=card)
    result["limitations"].extend(["The initial mutable revision is resolved once; subsequent metadata/card paths use the frozen commit.", "Model-card prose and provider evaluation values are preserved as statements, not measured audit results.", "Missing card signatures leave feature/output contracts unknown. No raw-text pipeline, remote code or dependency installation is performed."])
    return result


def acquire_artifact(client, snapshot, *, url, approved_url, expected_sha256, output):
    """Only explicit exact URL+digest acquisition, without deserialization."""
    if not isinstance(url, str) or url != approved_url:
        raise AcquisitionError("Artifact URL must equal the explicit operator-approved URL")
    client.validate_url(url)
    valid_hash(expected_sha256, "approved artifact")
    if snapshot.get("provider") == "huggingface":
        resolved = snapshot["source"]["resolvedReference"]
        prefix = urllib.parse.urlsplit(client.origin).path.rstrip("/")+"/"+resolved["repoId"]+"/resolve/"+resolved["commit"]+"/"
        path = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
        if not path.startswith(prefix) or not path[len(prefix):] or ".." in path[len(prefix):].split("/"):
            raise AcquisitionError("Artifact URL must identify this exact repository commit")
        filename = path[len(prefix):]
        sibling = next((item for item in snapshot["metadata"].get("siblings", []) if isinstance(item, dict) and item.get("rfilename") == filename), None)
        if sibling is None:
            raise AcquisitionError("Approved artifact is absent from the pinned repository listing")
        lfs_hash = sibling.get("lfs", {}).get("sha256") if isinstance(sibling.get("lfs"), dict) else None
        if lfs_hash is not None and lfs_hash != expected_sha256:
            raise AcquisitionError("Approved artifact hash differs from pinned LFS metadata")
    target = Path(output)
    if target.exists() or target.is_symlink() or not target.parent.is_dir():
        raise AcquisitionError("Artifact output requires a new file in an existing approved local directory")
    raw = client.get(url, maximum=MAX_BYTES, kind="artifact")
    if sha256(raw) != expected_sha256:
        raise AcquisitionError("Actual artifact bytes differ from the approved SHA-256")
    create_once(target, raw)
    snapshot["artifact"] = {"acquired": True, "url": url, "expectedSha256": expected_sha256, "sha256": sha256(raw), "bytes": len(raw), "filename": target.name, "associationAssurance": "exact_repo_commit_path_and_hash" if snapshot["provider"] == "huggingface" else "operator_declared_URL_association_to_frozen_registry_version", "safetyApproval": "not_granted", "execution": "not_executed"}
    snapshot["source"]["responses"] = copy.deepcopy(client.responses)
    snapshot["limitations"].append("Matching artifact bytes prove the supplied digest association; they do not establish model safety or independently validate source metadata.")
    return snapshot


def seal_snapshot(snapshot):
    snapshot["snapshotDigestEncoding"] = "engine-canonical-json-v1"
    body = {key: value for key, value in snapshot.items() if key != "snapshotSha256"}
    snapshot["snapshotSha256"] = sha256(json_bytes(body))
    return snapshot


def verify_snapshot(snapshot):
    expected = snapshot.get("snapshotSha256")
    return isinstance(expected, str) and expected == sha256(json_bytes({key: value for key, value in snapshot.items() if key != "snapshotSha256"}))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Acquire a read-only proposed registry snapshot; never load a model")
    parser.add_argument("provider", choices=["mlflow", "huggingface"])
    parser.add_argument("--origin", required=True)
    parser.add_argument("--allowed-host", required=True, help="Exact hostname[:port], no wildcard")
    parser.add_argument("--token-env", help="Name of an environment variable containing a read-only registry bearer token")
    parser.add_argument("--name", help="MLflow registered model name")
    parser.add_argument("--version")
    parser.add_argument("--alias")
    parser.add_argument("--repo", help="Hugging Face owner/repository")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--signature-json", help="Optional bounded MLflow-style signature JSON export")
    parser.add_argument("--signature-reference", help="Exact artifact/source reference for the separately acquired signature")
    parser.add_argument("--no-card", action="store_true")
    parser.add_argument("--artifact-url")
    parser.add_argument("--approved-artifact-url")
    parser.add_argument("--expected-artifact-sha256")
    parser.add_argument("--artifact-output")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        client = ReadOnlyHTTP(args.origin, args.allowed_host, token_env=args.token_env)
        signature, signature_source = None, None
        if args.signature_json:
            path = Path(args.signature_json)
            if not args.signature_reference or not path.is_file() or path.stat().st_size > MAX_CARD:
                raise AcquisitionError("Signature export needs a bounded file and exact source reference")
            raw = path.read_bytes()
            signature = strict_json(raw, maximum=MAX_CARD)
            signature_source = {"kind": "separately_acquired_signature_export", "reference": args.signature_reference, "sha256": sha256(raw), "bytes": len(raw), "assurance": "operator_declared_association"}
        elif args.signature_reference:
            raise AcquisitionError("Signature reference requires a signature export")
        snapshot = mlflow_snapshot(client, args.name, version=args.version, alias=args.alias, signature=signature, signature_source=signature_source) if args.provider == "mlflow" else huggingface_snapshot(client, args.repo, revision=args.revision, signature=signature, signature_source=signature_source, include_card=not args.no_card)
        artifact_options = (args.artifact_url, args.approved_artifact_url, args.expected_artifact_sha256, args.artifact_output)
        if any(artifact_options):
            if not all(artifact_options):
                raise AcquisitionError("Artifact acquisition needs URL, exact approval URL, digest and local output")
            acquire_artifact(client, snapshot, url=args.artifact_url, approved_url=args.approved_artifact_url, expected_sha256=args.expected_artifact_sha256, output=args.artifact_output)
        seal_snapshot(snapshot)
        create_once(Path(args.output), json_bytes(snapshot)+b"\n")
    except (ValueError, OSError, TypeError):
        print(json.dumps({"state": "rejected", "error": "registry_acquisition_or_contract_rejected"}), file=sys.stderr)
        return 2
    print(json.dumps({"state": "proposed", "provider": snapshot["provider"], "snapshotSha256": snapshot["snapshotSha256"], "artifactAcquired": snapshot["artifact"]["acquired"], "output": str(Path(args.output).absolute())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
