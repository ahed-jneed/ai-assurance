"""Pull worker for /api/runner; no submitted code or dynamic package installs.

Default execution is provided predictions in a bounded child process. Native
inference requires an explicitly selected, digest-pinned Docker executor with
network disabled and a local artifact SHA-256 allowlist. A client's own worker
with a client data directory also runs client-local jobs whose dataset never
leaves the client: it reads the file locally by its SHA-256 pin.
"""
from __future__ import annotations

import argparse
import email.utils
import hashlib
import http.client
import importlib
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .contract import validate_report
from .diagnostics import MAX_BYTES, read_csv, run, sha256
from .errors import EngineError
from .worker_contract import COMPUTE_FAILURE_CODES, Claim, FORMAT_ALIASES, MAX_ENVELOPE_BYTES, MAX_RESULT_BYTES, WORKER_VERSION, claim_pins, client_held, completion_body, evidence_envelope, failure_code, json_bytes, result_signature, strict_json, timestamp, translate_config, valid_hash, valid_id

# Compute writes the sanitized code to ERROR_FILE and a local-only message to
# DETAIL_FILE; the control plane appends every job outcome to OPERATOR_LOG.
ERROR_FILE, DETAIL_FILE, OPERATOR_LOG = "error.json", "operator-detail.json", "operator-log.jsonl"
MODEL_SUFFIXES = {"onnx": ".onnx", "pmml": ".pmml", "xgboost_json": ".json", "lightgbm_text": ".txt"}
RUNTIME_PACKAGES = {"onnx": ("numpy", "onnxruntime"), "pmml": ("numpy", "pandas", "pypmml"), "xgboost_json": ("numpy", "xgboost"), "lightgbm_text": ("numpy", "lightgbm")}
WIRE_FORMATS = {"onnx": "ONNX", "pmml": "PMML", "xgboost_json": "XGBoost", "lightgbm_text": "LightGBM"}
MODULES = {"onnxruntime": "onnxruntime", "pypmml": "pypmml"}
IMAGE_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
# Slowest sustained transfer an attempt is budgeted for (1 Mbit/s): a 100 MiB
# dataset gets the idle timeout plus about 13 minutes per attempt.
MIN_TRANSFER_RATE = 128 * 1024
MAX_TRANSPORT_TIMEOUT = 120
# A client data directory is searched only at its top level, up to this many
# entries; only regular files of the pinned size are read.
MAX_CLIENT_DATA_ENTRIES = 10000
CLIENT_COPY_CHUNK = 1024 * 1024


class ProtocolError(Exception):
    """Sanitized transport failure; never contains tokens or response bodies."""
    def __init__(self, code, *, retryable=False, status=None):
        super().__init__(code)
        self.code, self.retryable, self.status = code, retryable, status


class LeaseLost(ProtocolError):
    pass


class CompletionUncertain(ProtocolError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A service redirect must never forward worker credentials.
        return None


class Collected:
    """Response bytes kept in memory: small protocol envelopes only."""
    def start(self):
        self.chunks = []

    def write(self, chunk):
        self.chunks.append(chunk)

    def finish(self):
        return b"".join(self.chunks)

    def discard(self):
        self.chunks = []


class StreamedFile:
    """A download streamed into a partial file and hashed as it arrives.

    Every attempt starts again from an empty file, so a retry never appends
    to bytes from a failed attempt.
    """
    def __init__(self, path):
        self.path, self.handle = path, None

    def start(self):
        self.discard()
        self.size, self.digest = 0, hashlib.sha256()
        self.handle = local_write(lambda: self.path.open("xb"))

    def write(self, chunk):
        local_write(lambda: self.handle.write(chunk))
        self.digest.update(chunk)
        self.size += len(chunk)

    def finish(self):
        local_write(self.handle.close)
        self.handle = None
        return self.path, self.size, self.digest.hexdigest()

    def discard(self):
        try:
            if self.handle is not None:
                self.handle.close()
            self.path.unlink(missing_ok=True)
        except OSError:
            pass
        self.handle = None


def local_write(operation):
    """Run one local file operation; its failure is never retried as transport."""
    try:
        return operation()
    except OSError as exc:
        raise ProtocolError("workspace_unavailable") from exc


def http_date(value):
    """The time in an HTTP Date header, or None if it is absent or invalid."""
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    # An HTTP date is always GMT; a date without a zone is not trusted.
    return parsed if parsed.tzinfo is not None else None


class ServerClock:
    """The server's time when it answered one request, on this host's monotonic clock.

    Lease timestamps come from the server's clock. A lease's deadline is
    counted on time.monotonic() from when the request was sent, for as long
    as the response's Date header says is left. A host whose wall clock runs
    fast or slow therefore neither expires a valid lease nor extends an
    expired one. The deadline is never later than the real one: the server
    answered after the request was sent, and one second covers the Date
    header's whole-second resolution. Only without a usable Date header does
    the deadline depend on this host's wall clock.
    """
    def __init__(self, sent, date):
        self.sent, self.server_now = sent, http_date(date)
        self.source = "this host's clock (the response had no usable Date header)" if self.server_now is None else "the server's clock (response Date header)"

    def deadline(self, lease_until):
        """Monotonic time by which a lease that the server ends at lease_until has ended."""
        until = timestamp(lease_until)
        if self.server_now is None:
            return time.monotonic()+(until-datetime.now(timezone.utc)).total_seconds()
        return self.sent+(until-self.server_now).total_seconds()-1


class Transport:
    """Bounded HTTPS client for /api/runner.

    `timeout` is the idle timeout: the longest any connect or single read may
    wait. Each attempt also has a wall-clock budget of the idle timeout plus
    the time to move its maximum byte count at MIN_TRANSFER_RATE, and every
    retry starts a fresh budget.
    """
    def __init__(self, site, application_token, platform_token=None, *, timeout=15, retries=2, allow_local_http=False):
        parsed = urllib.parse.urlsplit(site)
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"} or not parsed.hostname:
            raise ValueError("Site must be an HTTPS origin without credentials/path/query")
        if parsed.scheme != "https" and not (allow_local_http and local and parsed.scheme == "http"):
            raise ValueError("Worker transport requires HTTPS; local HTTP is test-only")
        if not application_token or any(c in application_token for c in "\r\n") or platform_token and any(c in platform_token for c in "\r\n"):
            raise ValueError("Invalid worker credential configuration")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= MAX_TRANSPORT_TIMEOUT or not 0 <= retries <= 3:
            raise ValueError("Transport timeout/retry bounds exceeded")
        self.endpoint = site.rstrip("/")+"/api/runner"
        self.application_token, self.platform_token = application_token, platform_token
        self.timeout, self.retries = timeout, retries
        self.opener = urllib.request.build_opener(NoRedirect())

    def budget(self, size):
        """Wall-clock seconds one attempt may take to move size bytes."""
        return self.timeout+size/MIN_TRANSFER_RATE

    def _request(self, method, url, *, body=None, maximum=MAX_ENVELOPE_BYTES, retry=False, sign=False, check_active=None, sink=None):
        """One bounded request: (what the sink collected, ServerClock of the answering attempt)."""
        headers = {"Authorization": "Bearer "+self.application_token, "Accept": "application/json", "User-Agent": "ai-assurance-worker/"+WORKER_VERSION}
        if self.platform_token:
            headers["OAI-Sites-Authorization"] = "Bearer "+self.platform_token
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        if sign:
            headers["X-Result-Signature"] = result_signature(self.application_token, body)
        sink = sink or Collected()
        for attempt in range((self.retries if retry else 0)+1):
            sent = time.monotonic()
            deadline = sent+self.budget(len(body or b"")+maximum)
            try:
                sink.start()
                if check_active:
                    check_active()
                date = self._exchange(urllib.request.Request(url, data=body, method=method, headers=headers), maximum, deadline, check_active, sink)
                return sink.finish(), ServerClock(sent, date)
            except urllib.error.HTTPError as exc:
                error = ProtocolError("http_"+str(exc.code), retryable=exc.code in {429, 502, 503, 504}, status=exc.code)
                exc.close()
            except ProtocolError as exc:
                error = exc
            except urllib.error.URLError as exc:
                error = ProtocolError("transport_idle_timeout" if isinstance(exc.reason, TimeoutError) else "transport_unavailable", retryable=True)
            except TimeoutError:
                error = ProtocolError("transport_idle_timeout", retryable=True)
            except (OSError, http.client.HTTPException):
                error = ProtocolError("transport_unavailable", retryable=True)
            except BaseException:
                sink.discard()
                raise
            sink.discard()
            if not retry or not error.retryable or attempt >= self.retries:
                raise error
            time.sleep(min(2, .25 * 2**attempt))
        raise ProtocolError("transport_unavailable")

    def _exchange(self, request, maximum, deadline, check_active, sink):
        """Stream one response body into sink; return its Date header."""
        def active():
            if check_active:
                check_active()
            if time.monotonic() >= deadline:
                raise ProtocolError("response_deadline_exceeded", retryable=True)
        with self.opener.open(request, timeout=self.timeout) as response:
            declared = response.headers.get("Content-Length")
            if declared is not None and (not declared.isdigit() or int(declared) > maximum):
                raise ProtocolError("response_size_rejected")
            # HTTPResponse.read1 performs at most one raw read, which the idle
            # timeout bounds. read(n) could wait for n slowly trickling bytes.
            reader = getattr(response, "read1", response.read)
            size = 0
            while True:
                active()
                chunk = reader(min(65536, maximum+1-size))
                active()
                if not chunk:
                    # read1 reports a connection closed early as a clean end.
                    if declared is not None and size != int(declared):
                        raise ProtocolError("response_truncated", retryable=True)
                    return response.headers.get("Date")
                size += len(chunk)
                if size > maximum:
                    raise ProtocolError("response_size_rejected")
                sink.write(chunk)

    def post(self, body, *, retry=False):
        return self.post_timed(body, retry=retry)[0]

    def post_timed(self, body, *, retry=False):
        """POST one signed envelope: (its JSON response, the ServerClock to read its leases with)."""
        payload = body if isinstance(body, bytes) else json_bytes(body)
        raw, clock = self._request("POST", self.endpoint, body=payload, retry=retry, sign=True)
        return (strict_json(raw) if raw else None), clock

    def download(self, claim, purpose, destination, *, maximum, check_active=None):
        """Stream one pinned input to `destination` + ".partial" while hashing.

        Returns (partial path, byte count, SHA-256). The caller verifies the
        pins before giving the bytes their final name.
        """
        if purpose not in {"dataset", "model"}:
            raise ValueError("Unsupported input purpose")
        query = urllib.parse.urlencode({"jobId": claim.job_id, "attemptId": claim.attempt_id, "fence": claim.fence, "input": purpose})
        return self._request("GET", self.endpoint+"?"+query, maximum=maximum, retry=True, check_active=check_active, sink=StreamedFile(destination.with_name(destination.name+".partial")))[0]


class LeaseKeeper:
    """Renews one attempt's lease and says when it has ended.

    `deadline` is the time.monotonic() value at which the lease ends
    (ServerClock.deadline), so the host's wall clock plays no part.
    """
    def __init__(self, transport, claim, deadline, *, interval=10):
        self.transport, self.claim = transport, claim
        self.interval = max(.05, interval)
        self.deadline = deadline
        self.stop = threading.Event()
        self.lost = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="worker-lease", daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def valid(self):
        if self.lost.is_set() or time.monotonic() >= self.deadline:
            self.lost.set()
            raise LeaseLost("lease_lost")

    def _loop(self):
        while not self.stop.is_set():
            remaining = self.deadline-time.monotonic()
            if remaining <= 0:
                self.lost.set()
                return
            if self.stop.wait(min(self.interval, max(.05, remaining/3))):
                return
            try:
                response, clock = self.transport.post_timed({"op": "heartbeat", **self.claim.pins()}, retry=True)
                if not isinstance(response, dict):
                    raise ProtocolError("invalid_heartbeat_response")
                deadline = clock.deadline(response.get("leaseUntil"))
                if deadline <= time.monotonic():
                    raise ProtocolError("heartbeat_lease_expired")
                self.deadline = deadline
            except ProtocolError as error:
                # A temporary failure can consume the remaining lease; stale
                # workers never publish after authoritative expiry/rejection.
                if not error.retryable or time.monotonic() >= self.deadline:
                    self.lost.set()
                    return
            except (ValueError, TypeError):
                self.lost.set()
                return

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=60)


def runtime_readiness():
    formats = {}
    for format_name, names in RUNTIME_PACKAGES.items():
        packages, errors = {}, []
        for name in names:
            try:
                packages[name] = importlib.metadata.version(name)
                importlib.import_module(MODULES.get(name, name))
            except (ImportError, OSError, importlib.metadata.PackageNotFoundError):
                packages[name] = None
                errors.append("runtime_unavailable:"+name)
        if format_name == "pmml" and not shutil.which("java"):
            errors.append("runtime_unavailable:java")
        formats[format_name] = {"runtimePresent": not errors, "packages": packages, "limitations": errors or ["Runtime import availability does not validate native inference or model safety; golden model fixtures are required before enrollment."]}
    return {"schemaVersion": "1.0", "workerVersion": WORKER_VERSION, "provided_predictions": {"runtimePresent": True, "packages": {}}, "modelFormats": formats}


def stripped_compute_env():
    # No service tokens, proxy credentials or user package paths in compute.
    keep = {name: os.environ[name] for name in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL") if name in os.environ}
    keep.update(PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")
    return keep


def docker_control_env():
    # Operator-selected local/rootless Docker connection belongs to the
    # launcher, not inference. These values never enter `docker run -e`.
    result = stripped_compute_env()
    for name in ("DOCKER_HOST", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"):
        if name in os.environ:
            result[name] = os.environ[name]
    return result


class ProcessExecutor:
    network_isolation = "local_process_only"
    permits_models = False

    def readiness(self):
        return runtime_readiness()

    def command(self, inputs, outputs):
        return [sys.executable, "-I", "-c", "import sys;sys.path.insert(0,sys.argv.pop(1));from engine.worker import compute_main;sys.exit(compute_main(sys.argv[1],sys.argv[2]))", str(Path(__file__).resolve().parent.parent), str(inputs), str(outputs)]

    def environment(self):
        return stripped_compute_env()

    def execute(self, inputs, outputs, lease, timeout):
        self._execute_command(self.command(inputs, outputs), inputs, outputs, lease, timeout)

    def _execute_command(self, command, inputs, outputs, lease, timeout):
        try:
            process = subprocess.Popen(command, cwd=Path(__file__).resolve().parent.parent, env=self.environment(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            raise ProtocolError("compute_unavailable") from exc
        started = time.monotonic()
        try:
            while process.poll() is None:
                lease.valid()
                if time.monotonic()-started > timeout:
                    raise ProtocolError("compute_timeout")
                time.sleep(.05)
            lease.valid()
            if process.returncode != 0:
                raise ProtocolError(compute_failure_code(outputs))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)


class DockerExecutor(ProcessExecutor):
    network_isolation = "docker_network_none"
    permits_models = True

    def environment(self):
        return docker_control_env()

    def __init__(self, image, *, memory="1g", cpus="1", pids=64):
        # Digest only: mutable tags cannot establish enrolled runtime identity.
        if not isinstance(image, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[a-f0-9]{64}", image):
            raise ValueError("Docker computation requires a repository@sha256 digest")
        if not re.fullmatch(r"[1-9][0-9]{0,4}[mg]", memory) or not re.fullmatch(r"[1-9][0-9]?(?:\.[0-9]{1,2})?", cpus) or not 16 <= pids <= 256:
            raise ValueError("Invalid container resource configuration")
        if not shutil.which("docker"):
            raise ValueError("Docker executor is unavailable")
        self.image, self.memory, self.cpus, self.pids = image, memory, cpus, pids
        self.uid = os.getuid() if os.name == "posix" and os.getuid() != 0 else 10001
        self.gid = os.getgid() if os.name == "posix" and os.getuid() != 0 else 10001

    def base_command(self):
        return ["docker", "run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user", str(self.uid)+":"+str(self.gid), "--memory", self.memory, "--memory-swap", self.memory, "--cpus", self.cpus, "--pids-limit", str(self.pids), "--ulimit", "nofile=64:64", "--ulimit", "fsize=33554432:33554432", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m", "--log-driver=none"]

    def readiness(self):
        process = subprocess.run(self.base_command()+[self.image, "--readiness"], capture_output=True, timeout=30, env=self.environment(), check=False)
        if process.returncode or len(process.stdout) > MAX_ENVELOPE_BYTES:
            raise ValueError("Digest-pinned compute-image readiness probe failed")
        result = strict_json(process.stdout)
        if not isinstance(result, dict) or result.get("workerVersion") != WORKER_VERSION:
            raise ValueError("Compute image and control-plane worker versions differ")
        return result

    def execute(self, inputs, outputs, lease, timeout):
        name = "assurance-compute-"+uuid.uuid4().hex
        # Fixed job-owned paths; input is mounted read-only, output is separate.
        command = self.base_command()+["--name", name, "--mount", "type=bind,src="+str(inputs.resolve())+",dst=/inputs,readonly", "--mount", "type=bind,src="+str(outputs.resolve())+",dst=/outputs", self.image, "--compute", "--input-dir", "/inputs", "--output-dir", "/outputs"]
        try:
            self._execute_command(command, inputs, outputs, lease, timeout)
        finally:
            # Killing a docker CLI is insufficient; stop only this generated
            # container, including native-model grandchildren.
            subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False, env=self.environment())


def bound_bytes(path, maximum):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("Compute file violates workspace byte/type bounds")
    raw = path.read_bytes()
    if len(raw) > maximum:
        raise ValueError("Compute file grew beyond bounds")
    return raw


def create_once(path, raw):
    with path.open("xb") as handle:
        handle.write(raw)


def promote(partial, destination):
    """Rename verified bytes into place without replacing an existing file."""
    if destination.exists():
        raise FileExistsError(destination)
    partial.rename(destination)


def enforce_compute_limits():
    if os.name == "posix":
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (300, 300))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32*1024*1024, 32*1024*1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    # Windows process mode has no OS memory/network sandbox. Native model
    # execution is therefore prohibited there by the outer executor gate.


@contextmanager
def failure_stage(code):
    """Give uncoded validation errors from one compute stage a stable code."""
    try:
        yield
    except EngineError:
        raise
    except ValueError as exc:
        raise EngineError(code, str(exc)) from exc


def compute_job(inputs, outputs):
    # The control plane wrote the envelope and verified the dataset, so a
    # failure in these first steps is a worker defect, not a client problem.
    with failure_stage("compute_internal_error"):
        envelope = strict_json(bound_bytes(inputs/"envelope.json", MAX_ENVELOPE_BYTES))
        claim = Claim.parse(envelope["claim"])
        request = claim.request
        data_path = inputs/"dataset.csv"
        data = bound_bytes(data_path, request["dataset"]["size"])
    if len(data) != request["dataset"]["size"] or sha256(data) != request["inputHashes"]["dataset"]:
        raise EngineError("dataset_input_pin_mismatch", "Dataset byte/hash mismatch")
    with failure_stage("dataset_malformed"):
        rows, _ = read_csv(data_path)
    with failure_stage("protocol_config_invalid"):
        native = translate_config(request, rows)
    adapter = None
    format_name = FORMAT_ALIASES.get(request["model"].get("format")) if request["executionMode"] == "auditor_model" else None
    if format_name:
        expected = request["inputHashes"]["modelArtifact"]
        if envelope.get("approvedModelSha256") != expected or envelope["execution"].get("networkIsolation") != "docker_network_none":
            raise EngineError("model_not_locally_approved_or_runtime_unavailable", "Model is outside the local approved isolated execution boundary")
        spec = native.get("modelSpec")
        if not isinstance(spec, dict):
            raise EngineError("request_contract_rejected", "Independent inference requires frozen modelSpec")
        model_path = inputs/("model"+MODEL_SUFFIXES[format_name])
        with failure_stage("compute_internal_error"):
            model_bytes = bound_bytes(model_path, MAX_BYTES)
        if sha256(model_bytes) != expected:
            raise EngineError("model_input_pin_mismatch", "Model byte/hash mismatch")
        from .optional_adapters import load_adapter
        with failure_stage("model_artifact_invalid"):
            adapter = load_adapter(model_path, format_name, spec, trusted_model=True, positive_label=native.get("positiveLabel"))
    elif request["executionMode"] == "auditor_model":
        raise EngineError("request_contract_rejected", "Model format is unsupported")
    # Data, label and model problems inside run() carry their own codes; an
    # uncoded error at this point is an engine defect.
    with failure_stage("compute_internal_error"):
        # A client-held dataset's report withholds groups below the minimum group size (#102).
        report = run(data_path, native, adapter=adapter, withhold_small_groups=client_held(request))
        validate_report(report)
        result = evidence_envelope(report, claim, image_digest=envelope["imageDigest"], execution=envelope["execution"])
    payload = json_bytes(result)+b"\n"
    if len(payload) > MAX_RESULT_BYTES:
        raise EngineError("evidence_too_large", "Completed evidence exceeds result byte bounds")
    create_once(outputs/"result.json", payload)
    return result


def compute_main(input_dir, output_dir):
    outputs = None
    try:
        enforce_compute_limits()
        inputs, candidate = Path(input_dir).resolve(strict=True), Path(output_dir).resolve(strict=True)
        if inputs == candidate or not inputs.is_dir() or not candidate.is_dir():
            raise ValueError("Input/output directories must be separate")
        outputs = candidate
        compute_job(inputs, outputs)
    except Exception as error:
        if outputs is not None:
            record_compute_failure(outputs, error)
        return 2
    return 0


def record_compute_failure(outputs, error):
    """Write the enumerated code for the control plane and a local operator note.

    No raw source rows, secrets or native stack traces leave the compute
    process. Engine-authored ValueError messages are written for operators;
    any other exception may carry native-library text, so only its type is
    kept. Neither file's message is ever posted to the platform.
    """
    if isinstance(error, EngineError) and error.code in COMPUTE_FAILURE_CODES:
        code = error.code
    else:
        code = "compute_resource_exhausted" if isinstance(error, MemoryError) else "compute_internal_error"
    message = str(error)[:1000] if isinstance(error, ValueError) else None
    for name, value in ((ERROR_FILE, {"schemaVersion": "1.0", "code": code}), (DETAIL_FILE, {"schemaVersion": "1.0", "code": code, "exceptionType": type(error).__name__, "message": message})):
        try:
            create_once(outputs/name, json_bytes(value)+b"\n")
        except OSError:
            pass


def compute_failure_code(outputs):
    """The compute process's enumerated code; compute_rejected without one."""
    try:
        value = strict_json(bound_bytes(outputs/ERROR_FILE, 4096), maximum=4096)
    except (OSError, ValueError):
        return "compute_rejected"
    code = value.get("code") if isinstance(value, dict) and value.get("schemaVersion") == "1.0" else None
    # Compute may run a native parser on client bytes; trust only listed codes.
    return code if code in COMPUTE_FAILURE_CODES else "compute_rejected"


def compute_failure_detail(outputs):
    """Bounded local operator note from the compute process, if present."""
    try:
        value = strict_json(bound_bytes(outputs/DETAIL_FILE, 16384), maximum=16384)
    except (OSError, ValueError):
        return None
    if not isinstance(value, dict):
        return None
    kind, message = value.get("exceptionType"), value.get("message")
    return {"exceptionType": kind[:100] if isinstance(kind, str) else None, "message": message[:1000] if isinstance(message, str) else None}


class Worker:
    def __init__(self, transport, executor, workspace, *, worker_id, image_digest, formats=(), approved_hashes=(), heartbeat=10, compute_timeout=300, maximum_jobs=100, client_data=None):
        valid_id(worker_id, "workerId")
        if not IMAGE_DIGEST.fullmatch(image_digest):
            raise ValueError("Worker image identity must be sha256:<64 lowercase hex>")
        if not 1 <= heartbeat <= 60 or not 1 <= compute_timeout <= 600 or not 1 <= maximum_jobs <= 10000:
            raise ValueError("Worker resource/time bounds exceeded")
        self.transport, self.executor = transport, executor
        original = Path(workspace).absolute()
        if any(part.is_symlink() for part in (original, *original.parents)):
            raise ValueError("Workspace and its existing ancestors cannot be symlinks")
        self.workspace = original.resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.worker_id, self.image_digest = worker_id, image_digest
        if isinstance(executor, DockerExecutor) and executor.image.rsplit("@", 1)[1] != image_digest:
            raise ValueError("Enrolled worker identity differs from compute-image digest")
        self.approved_hashes = frozenset(valid_hash(value, "approved local model") for value in approved_hashes)
        readiness = executor.readiness()
        requested = set(formats)
        if requested - set(MODEL_SUFFIXES):
            raise ValueError("Requested worker format is unsupported")
        if requested and (not executor.permits_models or not self.approved_hashes):
            raise ValueError("Model formats require no-network Docker and locally approved artifact hashes")
        unavailable = [f for f in requested if not readiness.get("modelFormats", {}).get(f, {}).get("runtimePresent")]
        if unavailable:
            raise ValueError("Selected model runtimes are unavailable: "+", ".join(sorted(unavailable)))
        self.client_data = client_data_directory(client_data, self.workspace) if client_data is not None else None
        self.formats = ["provided_predictions", *sorted(requested)]
        # "client_local" asks for jobs whose dataset stays with the client;
        # only a worker that can read the client's files offers it.
        self.wire_formats = ["provided_predictions", *(WIRE_FORMATS[name] for name in sorted(requested)), *(["client_local"] if self.client_data else [])]
        self.heartbeat, self.compute_timeout, self.maximum_jobs = heartbeat, compute_timeout, maximum_jobs

    def request_claim(self):
        """Ask for one attempt: (raw claim body, ServerClock), or None when idle.

        The platform answers {"idle": true} when it has nothing to run.
        """
        # No transport retry: an ambiguous claim can have acquired a lease.
        body, clock = self.transport.post_timed({"op": "claim", "workerId": self.worker_id, "imageDigest": self.image_digest, "formats": self.wire_formats})
        if isinstance(body, dict) and body.get("idle") is True:
            return None
        return body, clock

    def at_capacity(self):
        return sum(1 for _ in self.workspace.glob("job-*")) >= self.maximum_jobs

    def job_directory(self, claim):
        identity = sha256(json_bytes([claim.job_id, claim.attempt_id, claim.fence, claim.nonce, claim.request_sha256]))[:32]
        return self.workspace/("job-"+identity)

    def execute(self, claim, deadline):
        """Run one claimed attempt whose lease ends at monotonic `deadline`."""
        directory = self.job_directory(claim)
        if sum(1 for item in self.workspace.glob("job-*")) >= self.maximum_jobs:
            raise ProtocolError("workspace_job_limit")
        directory.mkdir(mode=0o700)
        inputs, outputs = directory/"inputs", directory/"outputs"
        inputs.mkdir(mode=0o700)
        outputs.mkdir(mode=0o700)
        # Docker's fixed UID needs this job-owned output directory. On Windows
        # bind-mount permission semantics are managed by Docker Desktop.
        if isinstance(self.executor, DockerExecutor) and os.name == "posix" and os.getuid() == 0:
            os.chown(outputs, 10001, 10001)
            os.chmod(inputs, 0o755)
            os.chmod(directory, 0o755)
        request = claim.request
        format_name = FORMAT_ALIASES.get(request["model"].get("format")) if request["executionMode"] == "auditor_model" else None
        inference = format_name is not None
        if inference and (format_name not in self.formats or request["inputHashes"]["modelArtifact"] not in self.approved_hashes or not self.executor.permits_models):
            raise ProtocolError("model_not_locally_approved_or_runtime_unavailable")
        if request.get("preprocessing") or request["model"].get("preprocessingArtifactId"):
            if request.get("inputPreparation") != "already_preprocessed":
                raise ProtocolError("executable_preprocessing_unsupported")
        local = client_held(request)
        if local and self.client_data is None:
            raise ProtocolError("client_dataset_unavailable")
        execution = {"kind": "model_inference" if inference else "provided_predictions", "networkIsolation": self.executor.network_isolation, "controller": "client_local_worker" if request["executionMode"] == "client_local" else "external_auditor_worker", "datasetCustody": "client" if local else "platform", "limitations": (["Provided predictions do not establish independent inference or source-label truth."] if not inference else ["This worker evaluates already prepared numeric columns. Feature preparation, dataset independence and artifact safety require separate review."])+(["The dataset stayed in the client's environment: the worker read it there by its SHA-256 pin, and only the aggregate results in this envelope reached the platform. Groups and calibration bins below the minimum group size are withheld; groups at or above it are reported exactly."] if local else [])}
        with LeaseKeeper(self.transport, claim, deadline, interval=self.heartbeat) as lease:
            lease.valid()
            if local:
                self.stage_client_dataset(request, inputs/"dataset.csv", lease)
            else:
                self.fetch(claim, "dataset", inputs/"dataset.csv", lease, digest=request["inputHashes"]["dataset"], size=request["dataset"]["size"], digest_code="dataset_input_pin_mismatch", size_code="dataset_input_pin_mismatch")
            if inference:
                self.fetch(claim, "model", inputs/("model"+MODEL_SUFFIXES[format_name]), lease, digest=request["inputHashes"]["modelArtifact"], size=request["model"].get("size"), digest_code="model_input_pin_mismatch", size_code="model_input_size_mismatch")
            envelope = {"claim": claim.transport_dict(), "imageDigest": self.image_digest, "execution": execution, "approvedModelSha256": request["inputHashes"].get("modelArtifact") if inference else None}
            create_once(inputs/"envelope.json", json_bytes(envelope))
            lease.valid()
            self.executor.execute(inputs, outputs, lease, self.compute_timeout)
            try:
                result = bound_bytes(outputs/"result.json", MAX_RESULT_BYTES)
                verify_result_bytes(result, claim, self.image_digest)
            except (ValueError, KeyError, TypeError, AttributeError) as exc:
                raise ProtocolError("result_verification_failed") from exc
            lease.valid()
            body = completion_body(claim, result)
            create_once(directory/"completion.json", body)
            try:
                response = self.transport.post(body, retry=True)
            except ProtocolError as error:
                # Completion may already have committed. Never overwrite it
                # with fail on an ambiguous timeout or retryable server error.
                if error.retryable:
                    raise CompletionUncertain("completion_uncertain") from error
                raise
            return {"jobId": claim.job_id, "attemptId": claim.attempt_id, "resultSha256": sha256(result), "resultFile": str((outputs/"result.json").resolve()), "response": response}

    def fetch(self, claim, purpose, destination, lease, *, digest, size, digest_code, size_code):
        """Download one pinned input; only verified bytes get the final name."""
        partial, received, received_digest = self.transport.download(claim, purpose, destination, maximum=size or MAX_BYTES, check_active=lease.valid)
        failure = digest_code if received_digest != digest else size_code if size is not None and received != size else None
        if failure:
            try:
                partial.unlink(missing_ok=True)
            except OSError:
                pass  # The pin mismatch, not the cleanup, is the failure to report.
            raise ProtocolError(failure)
        local_write(lambda: promote(partial, destination))

    def stage_client_dataset(self, request, destination, lease):
        """Copy the client-held file whose size and SHA-256 equal the pin into the job; nothing is downloaded.

        The pin, not a name, selects the file: request fields never become
        paths. Each regular top-level file of the pinned size is hashed while
        it is copied, so the job receives exactly the bytes that were hashed.
        """
        digest, size = request["inputHashes"]["dataset"], request["dataset"]["size"]
        candidates = []
        try:
            with os.scandir(self.client_data) as entries:
                for index, entry in enumerate(entries):
                    if index >= MAX_CLIENT_DATA_ENTRIES:
                        break
                    if not entry.is_symlink() and entry.is_file(follow_symlinks=False) and entry.stat(follow_symlinks=False).st_size == size:
                        candidates.append(entry.name)
        except OSError as exc:
            raise ProtocolError("client_dataset_unavailable") from exc
        if not candidates:
            raise ProtocolError("client_dataset_unavailable")
        partial = destination.with_name(destination.name+".partial")
        for name in sorted(candidates):
            lease.valid()
            if self.copy_pinned(self.client_data/name, partial, digest, size, lease):
                local_write(lambda: promote(partial, destination))
                return
        # Files of the pinned size exist, but none has the pinned SHA-256.
        raise ProtocolError("dataset_input_pin_mismatch")

    def copy_pinned(self, source, partial, digest, size, lease):
        """Copy `source` to `partial` while hashing; True when the copy matches the pin, else it is deleted."""
        hasher, copied = hashlib.sha256(), 0
        try:
            with local_write(lambda: partial.open("xb")) as handle:
                try:
                    reader = open(os.open(source, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)), "rb")
                except OSError as exc:
                    raise ProtocolError("client_dataset_unavailable") from exc
                with reader:
                    # Read at most one byte past the pin: a grown file fails without being copied whole.
                    while copied <= size:
                        try:
                            chunk = reader.read(min(CLIENT_COPY_CHUNK, size+1-copied))
                        except OSError as exc:
                            raise ProtocolError("client_dataset_unavailable") from exc
                        if not chunk:
                            break
                        copied += len(chunk)
                        hasher.update(chunk)
                        local_write(lambda: handle.write(chunk))
                        lease.valid()
        except BaseException:
            try:
                partial.unlink(missing_ok=True)
            except OSError:
                pass  # The copy's own failure is the one to report.
            raise
        if copied == size and hasher.hexdigest() == digest:
            return True
        local_write(lambda: partial.unlink(missing_ok=True))
        return False

    def once(self):
        if self.at_capacity():
            return {"state": "workspace_capacity_reached", "error": "archive_job_evidence_before_claiming_more_work"}
        claimed = self.request_claim()
        if claimed is None:
            return {"state": "idle"}
        body, clock = claimed
        try:
            claim = Claim.parse(body)
            deadline = clock.deadline(claim.lease_until)
            if deadline <= time.monotonic():
                raise EngineError("lease_expired_on_receipt", "The attempt lease had already ended when the claim arrived, by "+clock.source)
        except Exception as error:
            # The claim body is untrusted input: any parse failure is a
            # per-claim problem, never a reason to stop the worker.
            return self.reject_claim(body, error)
        return self.run_claim(claim, deadline)

    def reject_claim(self, body, error):
        """Fail a claimed attempt this worker cannot run, if its pins allow."""
        try:
            pins = claim_pins(body)
        except ValueError:
            # A fail must echo valid pins. Without them the lease expires
            # on the server and the job becomes claimable again.
            self.record({"event": "claim_rejected", "code": "claim_pins_invalid", "detail": exception_detail(error)})
            return {"state": "claim_rejected", "error": "claim_pins_invalid"}
        # A coded problem keeps its code, such as an ended lease or a model
        # whose labels are not the frozen pair; anything else breaks the contract.
        code = failure_code(error.code) if isinstance(error, EngineError) else "request_contract_rejected"
        attempt = {"jobId": pins["jobId"], "attemptId": pins["attemptId"]}
        posted = self.post_failure(pins, code)
        self.record({"event": "failed", **attempt, "code": code, "failPosted": posted, "detail": exception_detail(error)})
        return {"state": "failed", **attempt, "error": code}

    def run_claim(self, claim, deadline):
        attempt = {"jobId": claim.job_id, "attemptId": claim.attempt_id}
        try:
            outcome = {"state": "completed", **self.execute(claim, deadline)}
            self.record({"event": "completed", **attempt, "resultSha256": outcome["resultSha256"]})
            return outcome
        except CompletionUncertain:
            self.record({"event": "completion_uncertain", **attempt})
            return {"state": "completion_uncertain", **attempt}
        except LeaseLost:
            # A stale worker never publishes, not even a failure.
            self.record({"event": "lease_lost", **attempt})
            return {"state": "failed", **attempt, "error": "lease_lost"}
        except Exception as error:
            # Every per-job failure is reported; none may stop the worker.
            code = job_failure_code(error)
            detail = compute_failure_detail(self.job_directory(claim)/"outputs") or exception_detail(error)
            posted = self.post_failure(claim.pins(), code)
            self.record({"event": "failed", **attempt, "code": code, "failPosted": posted, "detail": detail})
            return {"state": "failed", **attempt, "error": code}

    def post_failure(self, pins, code):
        """Post one sanitized fail; True when the platform acknowledged it."""
        try:
            self.transport.post({"op": "fail", **pins, "error": failure_code(code)}, retry=True)
            return True
        except ProtocolError:
            return False

    def record(self, entry):
        """Append one line to the local operator log; never sent to the platform."""
        line = json.dumps({"at": datetime.now(timezone.utc).isoformat(), "workerId": self.worker_id, **entry}, ensure_ascii=False, allow_nan=False, sort_keys=True)
        try:
            # Owner-only, like the job directories: entries name jobs and
            # columns. O_BINARY (Windows only) keeps "\n" line endings as written.
            descriptor = os.open(self.workspace/OPERATOR_LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_BINARY", 0), 0o600)
            with open(descriptor, "a", encoding="utf-8", newline="\n") as handle:
                handle.write(line+"\n")
        except OSError:
            print(json.dumps({"state": "operator_log_unavailable"}), file=sys.stderr, flush=True)


def client_data_directory(value, workspace):
    """The operator's client data directory: an existing directory, no symlinks, apart from the workspace."""
    original = Path(value).absolute()
    if any(part.is_symlink() for part in (original, *original.parents)):
        raise ValueError("Client data directory and its existing ancestors cannot be symlinks")
    path = original.resolve(strict=True)
    if not path.is_dir():
        raise ValueError("Client data directory must be a directory")
    if path == workspace or path in workspace.parents or workspace in path.parents:
        raise ValueError("Client data directory and workspace must be separate")
    return path


def job_failure_code(error):
    """Map a per-job exception to its sanitized, documented failure code."""
    if isinstance(error, (ProtocolError, EngineError)):
        return failure_code(error.code)
    if isinstance(error, OSError):
        return "workspace_unavailable"
    return "worker_internal_error"


def exception_detail(error):
    """Local operator detail for a control-plane failure (never posted)."""
    return {"exceptionType": type(error).__name__, "message": str(error)[:1000] if isinstance(error, (ValueError, OSError)) else None}


def verify_result_bytes(result_bytes, claim, image_digest):
    result = strict_json(result_bytes, maximum=MAX_RESULT_BYTES)
    if not isinstance(result, dict) or result.get("schemaVersion") != "1.0":
        raise ValueError("Invalid worker evidence envelope")
    report = result.get("externalReport")
    validate_report(report)
    for field in ("id", "engagementId", "modelId", "datasetId", "seed"):
        if report[field] != claim.request["engineConfig"][field]:
            raise ValueError("Result identity/seed differs from request")
    provenance = result.get("provenance", {})
    if provenance.get("requestSha256") != claim.request_sha256 or provenance.get("imageDigest") != image_digest or provenance.get("executionMode") != claim.request["executionMode"]:
        raise ValueError("Result request/worker identity mismatch")
    if (provenance.get("execution", {}).get("datasetCustody") == "client") != client_held(claim.request):
        raise ValueError("Result dataset custody differs from request")
    if provenance.get("externalReportSha256") != report["reportSha256"]:
        raise ValueError("Embedded report digest mismatch")
    if provenance.get("inputHashes", {}).get("dataset") != claim.request["inputHashes"]["dataset"] or report["provenance"]["inputHashes"]["data"] != claim.request["inputHashes"]["dataset"]:
        raise ValueError("Result dataset hash mismatch")
    inference = claim.request["executionMode"] == "auditor_model"
    if inference and (provenance.get("inputHashes", {}).get("modelArtifact") != claim.request["inputHashes"]["modelArtifact"] or report["provenance"]["inputHashes"].get("model") != claim.request["inputHashes"]["modelArtifact"]):
        raise ValueError("Result model inference hash mismatch")
    from .worker_contract import hosted_results
    if result.get("hostedResults") != hosted_results(report, claim.request):
        raise ValueError("Result projection differs from selected frozen criteria")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bounded external pull worker for the assurance platform")
    parser.add_argument("--readiness", action="store_true")
    parser.add_argument("--compute", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--input-dir", help=argparse.SUPPRESS)
    parser.add_argument("--output-dir", help=argparse.SUPPRESS)
    parser.add_argument("--site", default=os.environ.get("ASSURANCE_SITE_ORIGIN"))
    parser.add_argument("--worker-id", default=os.environ.get("ASSURANCE_WORKER_ID"))
    parser.add_argument("--image-digest", default=os.environ.get("ASSURANCE_WORKER_IMAGE_DIGEST"))
    parser.add_argument("--workspace", default="worker-jobs")
    parser.add_argument("--executor", choices=["process", "docker"], default="process")
    parser.add_argument("--compute-image", default=os.environ.get("ASSURANCE_COMPUTE_IMAGE"))
    parser.add_argument("--formats", default="", help="Explicit reviewed native formats, e.g. onnx,xgboost_json; default provided predictions only")
    parser.add_argument("--approved-model-hashes", default=os.environ.get("ASSURANCE_APPROVED_MODEL_HASHES", ""), help="Local reviewed SHA-256 allowlist; never take this from claimed jobs")
    parser.add_argument("--client-data-dir", default=os.environ.get("ASSURANCE_CLIENT_DATA_DIR"), help="The client's own worker: directory of client-held datasets, read locally by SHA-256 pin for client-local jobs")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=5)
    parser.add_argument("--heartbeat-seconds", type=float, default=10)
    parser.add_argument("--compute-timeout", type=float, default=300)
    parser.add_argument("--maximum-jobs", type=int, default=100)
    parser.add_argument("--transport-timeout", type=float, default=15, help=f"Idle timeout in seconds for any connect or single read (1-{MAX_TRANSPORT_TIMEOUT}); each attempt's total budget also scales with its size")
    args = parser.parse_args(argv)
    if args.readiness:
        print(json.dumps(runtime_readiness(), ensure_ascii=False, allow_nan=False))
        return 0
    if args.compute:
        return compute_main(args.input_dir, args.output_dir)
    try:
        if not args.site or not args.worker_id or not args.image_digest or not 1 <= args.poll_seconds <= 60:
            raise ValueError("Site, enrolled worker ID, image digest and bounded poll interval are required")
        token = os.environ.get("ASSURANCE_WORKER_TOKEN")
        if not token:
            raise ValueError("ASSURANCE_WORKER_TOKEN must be provided through the environment/secret manager")
        transport = Transport(args.site, token, os.environ.get("ASSURANCE_SITE_SERVICE_TOKEN"), timeout=args.transport_timeout)
        executor = DockerExecutor(args.compute_image) if args.executor == "docker" else ProcessExecutor()
        worker = Worker(transport, executor, args.workspace, worker_id=args.worker_id, image_digest=args.image_digest, formats=filter(None, (f.strip() for f in args.formats.split(","))), approved_hashes=filter(None, (h.strip() for h in args.approved_model_hashes.split(","))), heartbeat=args.heartbeat_seconds, compute_timeout=args.compute_timeout, maximum_jobs=args.maximum_jobs, client_data=args.client_data_dir or None)
        while True:
            try:
                result = worker.once()
            except ProtocolError as error:
                result = {"state": "transport_failed", "error": failure_code(error.code)}
            except Exception as error:
                # once() reports every per-job failure itself; this keeps an
                # unexpected defect from ending the daemon too.
                worker.record({"event": "worker_error", "detail": exception_detail(error)})
                result = {"state": "worker_error", "error": "worker_internal_error"}
            print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
            if args.once:
                return 0 if result["state"] in {"completed", "idle"} else 2
            time.sleep(args.poll_seconds)
    except (ValueError, OSError, subprocess.SubprocessError):
        print(json.dumps({"state": "configuration_rejected", "error": "invalid_worker_configuration_or_runtime"}), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
