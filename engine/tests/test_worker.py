import copy
import hashlib
import hmac
import io
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from engine.diagnostics import read_csv, run, sha256
from engine.errors import EngineError
from engine.worker import LeaseKeeper, LeaseLost, ProcessExecutor, ProtocolError, ServerClock, Transport, Worker, compute_failure_code, compute_job, compute_main, docker_control_env, job_failure_code, main as worker_main, stripped_compute_env, verify_result_bytes
from engine.worker_contract import COMPUTE_FAILURE_CODES, FAILURE_CODES, WORKER_VERSION, Claim, MAX_RESULT_BYTES, completion_body, failure_code, hosted_results, json_bytes, result_signature, strict_json, translate_config, validate_model_spec, validate_request
from engine.tests.test_connectors_adapters import THRESHOLD_ROWS, FakeOnnxSession, fake_onnxruntime, out_of_memory, requires_numpy

# Same shape as an enrolled platform token: two UUIDs, 72 characters.
TOKEN = "00000000-0000-4000-8000-000000000001"+"00000000-0000-4000-8000-000000000002"
PLATFORM = "dummy-platform-service-token-for-tests"
WORKER_ID = "worker-fixture"
IMAGE = "sha256:"+"a"*64
CSV = b"actual,predicted,group\n1,1,A\n1,1,A\n0,0,A\n0,0,A\n1,1,B\n1,0,B\n0,0,B\n0,0,B\n"


def hosted_request(data=CSV, *, task="Binary classification", suite=None):
    c = {"labelColumn": "actual", "predictionColumn": "predicted", "groupColumn": "group", "positiveLabel": "1", "minimumGroupSize": 2, "maximumParityGap": .15, "minimumImpactRatio": .8, "minimumAccuracy": .8, "minimumSampleSize": 2, "minimumClassCount": 2, "maximumOddsGap": .1, "minimumRecall": .7, "minimumMacroF1": .6, "maximumRmse": .8}
    suite = suite or ["performance", "demographic_parity", "disparate_impact", "equalized_odds"]
    # Like the platform's frozen request, the evaluation profile travels too.
    profile = {"id": "fixture-policy", "version": "1", "task": task, "suite": suite, "config": c}
    return {"schemaVersion": "1.0", "executionMode": "provided_predictions", "model": {"id": "model-fixture", "format": "Prediction file", "task": task, "sourceSha256": sha256(data)}, "dataset": {"id": "data-fixture", "name": "predictions.csv", "sha256": sha256(data), "size": len(data)}, "profile": profile, "engineConfig": {"contractVersion": "1.1", "id": "run-fixture", "engagementId": "engagement-fixture", "modelId": "model-fixture", "datasetId": "data-fixture", "task": task, "suite": suite, "config": c, "negativeLabel": "0", "policyId": "fixture-policy", "policyVersion": "1", "seed": 42}, "seed": 42, "inputHashes": {"dataset": sha256(data), "modelArtifact": sha256(data)}}


def claim_body(request=None, *, job="JOB-0123456789ab", attempt="ATTEMPT-0123456789ab", lease_seconds=120):
    """A claim response shaped like route.ts: id('JOB'), crypto.randomUUID() nonce, toISOString()."""
    request = request or hosted_request()
    # Deliberately use the server's original insertion order, not canonical
    # object sorting: requestJSON is authoritative for the transport hash.
    text = json.dumps(request, separators=(",", ":"), ensure_ascii=False)
    lease = (datetime.now(timezone.utc)+timedelta(seconds=lease_seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {"jobId": job, "attemptId": attempt, "fence": 7, "nonce": "c0ffee00-0000-4000-8000-00000000f1x7", "leaseUntil": lease, "requestSha256": sha256(text.encode("utf-8")), "requestJSON": text, "request": request}


@contextmanager
def skewed_worker_clock(seconds):
    """Run the worker's wall clock `seconds` fast (negative: slow); the server's stays right."""
    class Skewed(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz)+timedelta(seconds=seconds)
    with patch("engine.worker.datetime", Skewed), patch("engine.worker_contract.datetime", Skewed):
        yield


class FakeMonotonic:
    """Stands in for time.monotonic(); scripted reads and backoff sleeps advance it."""
    def __init__(self, now=0.0):
        self.now = now

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


PIN_KEYS = ("jobId", "attemptId", "fence", "nonce", "requestSha256")
CONTRACT_VIOLATION = "Runner payload violates the versioned result contract"
REQUEST_FAILED = "The request could not be completed. Your changes were not confirmed."
HEX64 = re.compile(r"^[a-f0-9]{64}$")


def short(value):
    """route.ts / assurance-core `short`: a string of 1-300 characters."""
    return isinstance(value, str) and 1 <= len(value) <= 300


def pins_envelope(body, extra):
    """route.ts `pins.extend(...).strict()`: exactly the pins plus `extra` keys."""
    return set(body) <= set(PIN_KEYS) | extra and set(PIN_KEYS) <= set(body) and all(short(body[key]) for key in ("jobId", "attemptId", "nonce")) and isinstance(body["fence"], int) and not isinstance(body["fence"], bool) and body["fence"] > 0 and isinstance(body["requestSha256"], str) and HEX64.fullmatch(body["requestSha256"]) is not None


def result_envelope_ok(packet):
    """site-app/lib/assurance-core.ts `resultEnvelope`, field by field."""
    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")
    if not isinstance(packet, dict) or packet.get("schemaVersion") != "1.0" or not isinstance(packet.get("externalReport"), dict):
        return False
    results, provenance = packet.get("hostedResults"), packet.get("provenance")
    if not isinstance(results, list) or len(results) > 30:
        return False
    for result in results:
        if not isinstance(result, dict) or not short(result.get("testId")) or not short(result.get("label")) or result.get("article") not in {"10", "15"} or result.get("outcome") not in {"pass", "fail", "inconclusive", "not_applicable"}:
            return False
        metrics, notes = result.get("metrics"), result.get("limitations")
        if not isinstance(metrics, list) or len(metrics) > 100 or not isinstance(notes, list) or len(notes) > 100 or any(not isinstance(note, str) or len(note.strip()) > 10000 for note in notes):
            return False
        for metric in metrics:
            if not isinstance(metric, dict) or not short(metric.get("name")) or "value" not in metric or not (metric["value"] is None or number(metric["value"])) or not isinstance(metric.get("unit"), str) or len(metric["unit"]) > 100 or not isinstance(metric.get("sampleSize"), int) or isinstance(metric["sampleSize"], bool) or metric["sampleSize"] < 0:
                return False
    return isinstance(provenance, dict) and isinstance(provenance.get("requestSha256"), str) and HEX64.fullmatch(provenance["requestSha256"]) is not None and isinstance(provenance.get("inputHashes"), dict) and all(isinstance(value, str) and HEX64.fullmatch(value) for value in provenance["inputHashes"].values())


class ModelReadyExecutor(ProcessExecutor):
    """Reports a ready ONNX runtime so a worker may advertise ONNX.

    Tests using it never reach native model execution.
    """
    permits_models = True

    def readiness(self):
        return {"modelFormats": {"onnx": {"runtimePresent": True}}}


class RunnerServer:
    """Loopback stand-in for site-app/app/api/runner/route.ts.

    It enforces the route's observable contract: the bearer-token format
    and lookup, strict per-operation envelopes, format filtering and
    {"idle": true}, attempt pins and leases, HMAC verification of complete
    and fail bodies, the result envelope and frozen-request checks,
    duplicate completion, and GET input authorization. A restricted Site's
    front door additionally requires the platform token. Database, R2 and
    membership checks are out of scope. Fault injection (transient_*,
    truncated_get, redirect, heartbeat_rejected) simulates infrastructure.
    """
    def __init__(self, request=None, data=CSV, *, claims=None, capabilities=("provided_predictions",), lease_seconds=120, altered_input=False, swapped_input=False, redirect=False, transient_get=0, truncated_get=0, transient_claim=0, transient_complete=0, heartbeat_rejected=False):
        # Claims are served once each, in order; then the queue is idle.
        self.queue = list(claims) if claims is not None else [claim_body(request)]
        self.claim = self.queue[0] if self.queue else None
        self.jobs, self.issued = {}, []
        self.capabilities, self.lease_seconds = list(capabilities), lease_seconds
        # altered_input appends bytes; swapped_input keeps the size but not the hash.
        self.data = data+b"tampered" if altered_input else data[:-2]+(b"1\n" if data[-2:] != b"1\n" else b"0\n") if swapped_input else data
        self.truncated_get = truncated_get
        self.redirect, self.transient_get, self.transient_claim = redirect, transient_get, transient_claim
        self.transient_complete, self.heartbeat_rejected = transient_complete, heartbeat_rejected
        # errors: every rejection (status, message); unsigned: ops posted without a valid signature.
        self.posts, self.gets, self.errors, self.unsigned = [], [], [], []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def respond(self, value, status=200, headers=(("Content-Type", "application/json"),)):
                raw = value if isinstance(value, bytes) else json_bytes(value)
                self.send_response(status)
                for name, header in headers:
                    self.send_header(name, header)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def reject(self, status, message):
                fixture.errors.append((status, message))
                self.respond({"error": message}, status)

            def authenticated(self):
                if self.headers.get("OAI-Sites-Authorization") != "Bearer "+PLATFORM:
                    self.reject(401, "Sites service authentication required")
                    return False
                match = re.fullmatch(r"Bearer ([a-zA-Z0-9-]{60,100})", self.headers.get("Authorization") or "")
                if not match:
                    self.reject(401, "Runner authentication required")
                    return False
                if not hmac.compare_digest(match.group(1), TOKEN):
                    self.reject(401, "Runner credential invalid or revoked")
                    return False
                return True

            def do_POST(self):
                # Read the body before replying, even with a 401. A socket closed
                # with unread bytes resets the connection, which on Windows loses
                # the reply; draining after replying races the client's own close.
                # The checks below still run in route.ts's order.
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length <= 10*1024*1024 else None
                if not self.authenticated():
                    return
                if raw is None:
                    return self.reject(413, "Request exceeds the permitted size")
                try:
                    body = json.loads(raw.decode("utf-8"))
                except ValueError:
                    return self.reject(500, REQUEST_FAILED)
                fixture.posts.append((body, raw))
                if self.headers.get("X-Result-Signature") != result_signature(TOKEN, raw):
                    fixture.unsigned.append(body.get("op") if isinstance(body, dict) else None)
                op = body.get("op") if isinstance(body, dict) else None
                if op == "claim":
                    return self.claim(body)
                if op == "heartbeat":
                    return self.heartbeat(body)
                if op in {"complete", "fail"}:
                    return self.settle(body, raw)
                return self.reject(400, "Unknown runner operation")

            def claim(self, body):
                if fixture.transient_claim:
                    fixture.transient_claim -= 1
                    return self.reject(503, "temporary")
                formats = body.get("formats")
                if set(body) - {"op", "workerId", "imageDigest", "formats", "capabilities"} or "workerId" in body and not short(body["workerId"]) or not isinstance(body.get("imageDigest"), str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", body["imageDigest"]) or not isinstance(formats, list) or not 1 <= len(formats) <= 10 or not all(short(item) for item in formats) or "capabilities" in body and not isinstance(body["capabilities"], dict):
                    return self.reject(400, CONTRACT_VIOLATION)
                if body.get("workerId", WORKER_ID) != WORKER_ID or body["imageDigest"] != IMAGE:
                    return self.reject(403, "Worker identity or enrolled image digest mismatch")
                aliases = {"onnx": "ONNX", "xgboost_json": "XGBoost", "lightgbm_text": "LightGBM", "pmml": "PMML"}
                accepted = [aliases.get(item, item) for item in formats if aliases.get(item, item) in fixture.capabilities]
                if not accepted:
                    return self.reject(409, "No compatible enrolled capability")
                for index, queued in enumerate(fixture.queue):
                    frozen = json.loads(queued["requestJSON"])
                    if (frozen.get("model", {}).get("format") if frozen.get("executionMode") == "auditor_model" else "provided_predictions") in accepted:
                        fixture.start(fixture.queue.pop(index))
                        return self.respond(fixture.issued[-1], headers=(("Content-Type", "application/json"), ("Cache-Control", "no-store")))
                return self.respond({"idle": True})

            def heartbeat(self, body):
                if not pins_envelope(body, {"op"}):
                    return self.reject(400, CONTRACT_VIOLATION)
                job = fixture.live(body)
                if job is None:
                    return self.reject(409, "Attempt identity or frozen request mismatch")
                if not fixture.leased(job):
                    return self.reject(409, "Attempt is expired, cancelled or already complete")
                if fixture.heartbeat_rejected:
                    return self.reject(409, "Attempt no longer active")
                job["leaseUntil"] = datetime.now(timezone.utc)+timedelta(seconds=fixture.lease_seconds)
                return self.respond({"leaseUntil": job["leaseUntil"].isoformat(timespec="milliseconds").replace("+00:00", "Z")})

            def settle(self, body, raw):
                # Not `finish`: StreamRequestHandler.finish flushes the response.
                if not pins_envelope(body, {"op", "resultJSON", "resultSha256", "error"}) or "resultJSON" in body and not (isinstance(body["resultJSON"], str) and len(body["resultJSON"]) <= 9*1024*1024) or "resultSha256" in body and not (isinstance(body["resultSha256"], str) and HEX64.fullmatch(body["resultSha256"])) or "error" in body and not (isinstance(body["error"], str) and len(body["error"]) <= 1000):
                    return self.reject(400, CONTRACT_VIOLATION)
                job = fixture.live(body)
                if job is None:
                    return self.reject(409, "Attempt identity or frozen request mismatch")
                signature = self.headers.get("X-Result-Signature") or ""
                if not HEX64.fullmatch(signature):
                    return self.reject(401, "Authenticated result signature required")
                if not hmac.compare_digest(signature, result_signature(TOKEN, raw)):
                    return self.reject(401, "Result signature verification failed")
                if job["state"] == "succeeded" and body["op"] == "complete" and body.get("resultSha256") == job["resultSha256"]:
                    return self.respond({"accepted": True, "duplicate": True})
                if not fixture.leased(job):
                    return self.reject(409, "Attempt is expired, cancelled or already complete")
                if body["op"] == "complete":
                    status, problem = fixture.result_problem(job, body)
                    if problem:
                        return self.reject(status, problem)
                    if fixture.transient_complete:
                        fixture.transient_complete -= 1
                        return self.reject(503, "temporary")
                    job.update(state="succeeded", resultSha256=body["resultSha256"])
                else:
                    job.update(state="failed", error=body.get("error") or "Worker execution failed")
                return self.respond({"accepted": True})

            def do_GET(self):
                if not self.authenticated():
                    return
                query = parse_qs(urlsplit(self.path).query)
                fixture.gets.append(query)
                if fixture.redirect:
                    self.send_response(302)
                    self.send_header("Location", fixture.origin+"/redirected")
                    self.end_headers()
                    return
                if fixture.transient_get:
                    fixture.transient_get -= 1
                    return self.reject(503, "temporary")
                first = {key: values[0] for key, values in query.items()}
                job = fixture.find(first.get("jobId"), first.get("attemptId"), first.get("fence"))
                if job is None:
                    return self.reject(404, "Attempt input not found")
                if not fixture.leased(job):
                    return self.reject(409, "Attempt is expired, cancelled or already complete")
                if first.get("input") not in {"dataset", "model"}:
                    return self.reject(500, REQUEST_FAILED)
                if first["input"] == "model" and json.loads(job["claim"]["requestJSON"]).get("executionMode") != "auditor_model":
                    return self.reject(403, "Model bytes are not authorized for this prediction-only request")
                if first["input"] == "model":
                    return self.reject(404, "Pinned input bytes unavailable")
                headers = (("Content-Type", "application/octet-stream"), ("Cache-Control", "private, no-store"), ("X-Evidence-SHA256", sha256(fixture.data)))
                if fixture.truncated_get:
                    # Declare the full length, send half, then close the connection.
                    fixture.truncated_get -= 1
                    self.send_response(200)
                    for name, value in headers:
                        self.send_header(name, value)
                    self.send_header("Content-Length", str(len(fixture.data)))
                    self.end_headers()
                    self.wfile.write(fixture.data[:len(fixture.data)//2])
                    self.close_connection = True
                    return
                return self.respond(fixture.data, headers=headers)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = "http://127.0.0.1:"+str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self, claim):
        """Lease an attempt as the route does; the server keeps its own lease clock."""
        self.issued.append(claim)
        self.jobs[claim["jobId"]] = {"claim": claim, "state": "running", "leaseUntil": datetime.now(timezone.utc)+timedelta(seconds=self.lease_seconds), "resultSha256": None, "error": None}

    def job(self, job_id):
        # Tests that drive Transport/LeaseKeeper directly skip the claim POST;
        # treat the first queued claim as already leased to this worker.
        if not self.jobs and self.claim is not None:
            self.start(self.claim)
            self.queue = [claim for claim in self.queue if claim is not self.claim]
        return self.jobs.get(job_id)

    def live(self, pins):
        """route.ts live(): the current attempt must match every pin."""
        job = self.job(pins.get("jobId"))
        return job if job and all(job["claim"][key] == pins.get(key) for key in PIN_KEYS) else None

    def find(self, job_id, attempt_id, fence):
        job = self.job(job_id)
        return job if job and job["claim"]["attemptId"] == attempt_id and str(job["claim"]["fence"]) == fence else None

    @staticmethod
    def leased(job):
        return job["state"] == "running" and job["leaseUntil"] > datetime.now(timezone.utc)

    @staticmethod
    def result_problem(job, body):
        """route.ts completion checks after the signature: (status, message) or (None, None)."""
        if not body.get("resultJSON") or not body.get("resultSha256") or sha256(body["resultJSON"].encode("utf-8")) != body["resultSha256"]:
            return 400, "Result bytes hash mismatch"
        try:
            packet = json.loads(body["resultJSON"])
        except ValueError:
            return 500, REQUEST_FAILED
        if not result_envelope_ok(packet):
            return 400, CONTRACT_VIOLATION
        frozen, provenance = json.loads(job["claim"]["requestJSON"]), packet["provenance"]
        if provenance["requestSha256"] != job["claim"]["requestSha256"] or provenance["inputHashes"].get("dataset") != frozen["inputHashes"]["dataset"] or frozen["executionMode"] == "auditor_model" and provenance["inputHashes"].get("modelArtifact") != frozen["inputHashes"]["modelArtifact"] or provenance.get("imageDigest") != IMAGE or provenance.get("executionMode") != frozen["executionMode"]:
            return 400, "Consumed input or runtime pins mismatch"
        suite, results = frozen["profile"]["suite"], packet["hostedResults"]
        if len({result["testId"] for result in results}) != len(results) or len(suite) != len(results) or any(result["testId"] not in suite or result["article"] != ("15" if result["testId"] in {"performance", "regression"} else "10") for result in results):
            return 400, "Result definitions do not match requested tests"
        return None, None

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def transport(self):
        return Transport(self.origin, TOKEN, PLATFORM, timeout=2, retries=2, allow_local_http=True)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def evaluate(self, request, data=CSV):
        data_path = self.root/("fixture-"+str(len(list(self.root.glob("*.csv"))))+".csv")
        data_path.write_bytes(data)
        rows, _ = read_csv(data_path)
        report = run(data_path, translate_config(request, rows))
        return report, hosted_results(report, request)

    def worker(self, transport, workspace="jobs", **kwargs):
        return Worker(transport, ProcessExecutor(), self.root/workspace, worker_id=WORKER_ID, image_digest=IMAGE, heartbeat=1, **kwargs)

    def test_exact_request_bytes_and_duplicate_nonfinite_json_rejected(self):
        body = claim_body()
        claim = Claim.parse(body)
        self.assertEqual(claim.request_sha256, sha256(body["requestJSON"].encode()))
        changed = copy.deepcopy(body)
        changed["request"]["seed"] = 43
        with self.assertRaises(ValueError):
            Claim.parse(changed)
        for raw in (b'{"a":1,"a":2}', b'{"n":NaN}', b'{"n":1e999}'):
            with self.assertRaises(ValueError):
                strict_json(raw)
        missing = copy.deepcopy(body)
        del missing["requestJSON"]
        with self.assertRaises(ValueError):
            Claim.parse(missing)

    def test_hmac_is_full_exact_body_with_derived_key(self):
        body = b'{"resultJSON":"unicode \\u00e9\\n"}'
        expected = hmac.new(hashlib.sha256(TOKEN.encode()).digest(), body, hashlib.sha256).hexdigest()
        self.assertEqual(result_signature(TOKEN, body), expected)
        self.assertNotEqual(result_signature(TOKEN, body+b"\n"), expected)

    def test_binary_and_individual_fairness_golden_values(self):
        report, results = self.evaluate(hosted_request())
        values = {r["testId"]: {m["name"]: m["value"] for m in r["metrics"]} for r in results}
        self.assertEqual([r["testId"] for r in results], hosted_request()["engineConfig"]["suite"])
        self.assertEqual(values["performance"]["accuracy"], 7/8)
        self.assertEqual(values["performance"]["recall"], .75)
        self.assertEqual(values["demographic_parity"]["maximum_selection_rate_gap"], .25)
        self.assertEqual(values["disparate_impact"]["minimum_selection_rate_ratio"], .5)
        self.assertEqual(values["equalized_odds"]["maximum_tpr_fpr_gap"], .5)
        self.assertEqual([r["outcome"] for r in results], ["pass", "fail", "fail", "fail"])
        self.assertEqual(report["results"][0]["outcome"], "inconclusive")
        self.assertIsNotNone(results[0]["metrics"][0]["confidenceInterval"])
        self.assertTrue(any(m["details"]["acceptanceRole"] == "supplemental_descriptive" for m in results[0]["metrics"]))

    def test_unselected_fairness_is_not_emitted(self):
        request = hosted_request(suite=["demographic_parity"])
        report, results = self.evaluate(request)
        self.assertEqual(len(report["results"]), 3)
        self.assertEqual([r["testId"] for r in results], ["demographic_parity"])

    def test_regression_and_multiclass_golden_values(self):
        data = b"actual,predicted\n1,2\n2,2\n3,4\n4,4\n"
        request = hosted_request(data, task="Regression", suite=["regression"])
        _, result = self.evaluate(request, data)
        metrics = {m["name"]: m["value"] for m in result[0]["metrics"]}
        self.assertAlmostEqual(metrics["mae"], .5)
        self.assertAlmostEqual(metrics["rmse"], .5**.5)
        self.assertAlmostEqual(metrics["r2"], .6)
        self.assertEqual(result[0]["outcome"], "pass")
        multi = b"actual,predicted\nA,A\nA,A\nB,B\nB,C\nC,B\nC,C\n"
        request = hosted_request(multi, task="Multiclass classification", suite=["performance"])
        request["engineConfig"]["config"]["minimumAccuracy"] = .6
        _, result = self.evaluate(request, multi)
        metrics = {m["name"]: m["value"] for m in result[0]["metrics"]}
        self.assertAlmostEqual(metrics["accuracy"], 2/3)
        self.assertAlmostEqual(metrics["macro_f1"], 2/3)
        self.assertEqual(result[0]["outcome"], "pass")

    def test_small_group_absent_class_and_constant_target_semantics(self):
        request = hosted_request()
        request["engineConfig"]["config"]["minimumGroupSize"] = 5
        _, results = self.evaluate(request)
        self.assertTrue(all(r["outcome"] == "inconclusive" for r in results[1:]))
        absent = b"actual,predicted\n0,1\n0,0\n0,1\n0,0\n"
        request = hosted_request(absent, suite=["performance"])
        _, results = self.evaluate(request, absent)
        self.assertEqual(results[0]["outcome"], "inconclusive")
        self.assertIsNone(next(m["value"] for m in results[0]["metrics"] if m["name"] == "recall"))
        constant = b"actual,predicted\n2,2\n2,2\n"
        request = hosted_request(constant, task="Regression", suite=["regression"])
        _, results = self.evaluate(request, constant)
        self.assertEqual(results[0]["outcome"], "pass")
        self.assertIsNone(next(m["value"] for m in results[0]["metrics"] if m["name"] == "r2"))

    def test_minimum_one_is_explicit_separate_projection(self):
        data = b"actual,predicted\n1,1\n0,0\n"
        request = hosted_request(data, suite=["performance"])
        request["engineConfig"]["config"]["minimumClassCount"] = 1
        report, results = self.evaluate(request, data)
        self.assertEqual(report["results"][0]["outcome"], "inconclusive")
        self.assertEqual(results[0]["outcome"], "pass")
        self.assertTrue(any("minimum of one" in note for note in results[0]["limitations"]))

    def test_single_observed_label_is_inconclusive_not_rejected(self):
        data = b"actual,predicted,group\n1,1,A\n1,1,A\n1,1,B\n1,1,B\n"
        request = hosted_request(data, suite=["performance", "equalized_odds"])
        report, results = self.evaluate(request, data)
        self.assertEqual((report["configuration"]["positiveLabel"], report["configuration"]["negativeLabel"]), ("1", "0"))
        self.assertEqual([r["outcome"] for r in results], ["inconclusive", "inconclusive"])
        with RunnerServer(request, data) as server:
            self.assertEqual(self.worker(server.transport()).once()["state"], "completed")

    def test_frozen_negative_label_defines_the_binary_label_pair(self):
        data = b"actual,predicted\n1,1\n0,0\n0,1\n"
        request = hosted_request(data, suite=["performance"])
        request["engineConfig"]["negativeLabel"] = " 0 "
        self.assertEqual(self.evaluate(request, data)[0]["configuration"]["negativeLabel"], "0")
        for negative, code in (("", "protocol_config_invalid"), ("1", "protocol_config_invalid"), (7, "protocol_config_invalid"), ("no", "label_set_mismatch")):
            request["engineConfig"]["negativeLabel"] = negative
            with self.assertRaises(EngineError) as error:
                self.evaluate(request, data)
            self.assertEqual(error.exception.code, code, negative)
        # Requests frozen without negativeLabel still derive it from two observed labels.
        del request["engineConfig"]["negativeLabel"]
        self.assertEqual(self.evaluate(request, data)[0]["configuration"]["negativeLabel"], "0")
        single = b"actual,predicted\n1,1\n1,1\n"
        legacy = hosted_request(single, suite=["performance"])
        del legacy["engineConfig"]["negativeLabel"]
        with self.assertRaises(EngineError) as error:
            self.evaluate(legacy, single)
        self.assertEqual(error.exception.code, "label_set_mismatch")

    def test_model_output_labels_must_equal_the_frozen_label_pair(self):
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["no", "yes"], "decisionThreshold": .5, "predictionOutput": "label", "predictionKind": "label"}
        request = hosted_request(suite=["performance"])
        request["executionMode"] = "auditor_model"
        request["model"].update(format="ONNX", sha256="b"*64, sourceSha256="b"*64)
        request["inputHashes"]["modelArtifact"] = "b"*64
        request["engineConfig"]["modelSpec"] = spec
        request["engineConfig"]["config"]["positiveLabel"] = "yes"
        rows = [{"actual": "yes", "x": "1"}]
        with self.assertRaises(EngineError) as error:
            translate_config(request, rows)
        self.assertEqual(error.exception.code, "label_set_mismatch")
        request["engineConfig"]["negativeLabel"] = "no"
        native = translate_config(request, rows)
        self.assertEqual((native["positiveLabel"], native["negativeLabel"]), ("yes", "no"))

    def test_worker_accepts_exactly_the_platform_test_catalog(self):
        for test in ("drift", "permutation", "perturbation", "explainability", "cross_validation"):
            with self.assertRaises(ValueError):
                validate_request(hosted_request(suite=[test]))
        evaluation = Path(__file__).resolve().parents[2]/"site-app"/"lib"/"evaluation.ts"
        if not evaluation.is_file():
            self.skipTest("site-app is not part of this checkout")
        enum = re.search(r"suiteSchema = z\s*\.array\(\s*z\.enum\(\[(.*?)\]", evaluation.read_text(encoding="utf-8"), re.S)
        self.assertIsNotNone(enum, "site-app suiteSchema changed shape; update this catalog check")
        from engine.worker_contract import LABELS, SUITES
        self.assertEqual(set(re.findall(r'"([a-z_]+)"', enum.group(1))), set(SUITES))
        self.assertEqual(set(LABELS), set(SUITES))

    def test_missing_cells_incompatible_tasks_and_unsafe_formats_fail(self):
        data = b"actual,predicted\n1,1\n0,\n"
        with self.assertRaises(ValueError):
            self.evaluate(hosted_request(data, suite=["performance"]), data)
        request = hosted_request(task="Regression")
        with self.assertRaises(ValueError):
            validate_request(request)
        request = hosted_request()
        request["executionMode"] = "auditor_model"
        request["model"]["format"] = "pickle"
        with self.assertRaises(ValueError):
            validate_request(request)

    def test_saved_predictions_for_native_registered_model_never_load_model_bytes(self):
        request = hosted_request(suite=["performance"])
        request["model"].update(format="ONNX", sourceSha256="b"*64, sha256="b"*64)
        request["inputHashes"]["modelArtifact"] = "b"*64
        with RunnerServer(request) as server:
            result = self.worker(server.transport()).once()
            self.assertEqual(result["state"], "completed")
            self.assertTrue(all(query["input"] == ["dataset"] for query in server.gets))
            packet = strict_json(Path(result["resultFile"]).read_bytes(), maximum=MAX_RESULT_BYTES)
            self.assertEqual(packet["provenance"]["execution"]["kind"], "provided_predictions")
            self.assertNotIn("modelArtifact", packet["provenance"]["inputHashes"])

    def test_created_once_exact_result_bytes_and_projection_tampering(self):
        claim = Claim.parse(claim_body())
        inputs, outputs = self.root/"inputs", self.root/"outputs"
        inputs.mkdir()
        outputs.mkdir()
        (inputs/"dataset.csv").write_bytes(CSV)
        (inputs/"envelope.json").write_bytes(json_bytes({"claim": claim.transport_dict(), "imageDigest": IMAGE, "execution": {"kind": "provided_predictions", "networkIsolation": "local_process_only"}}))
        compute_job(inputs, outputs)
        raw = (outputs/"result.json").read_bytes()
        self.assertTrue(raw.endswith(b"\n"))
        parsed = strict_json(completion_body(claim, raw), maximum=MAX_RESULT_BYTES)
        self.assertEqual(parsed["resultJSON"].encode(), raw)
        self.assertEqual(parsed["resultSha256"], sha256(raw))
        verify_result_bytes(raw, claim, IMAGE)
        tampered = strict_json(raw, maximum=MAX_RESULT_BYTES)
        tampered["hostedResults"][0]["outcome"] = "fail"
        with self.assertRaises(ValueError):
            verify_result_bytes(json_bytes(tampered), claim, IMAGE)
        with self.assertRaises(FileExistsError):
            compute_job(inputs, outputs)

    def inference_inputs(self, spec, data, model):
        request = hosted_request(data, suite=["performance"])
        request["executionMode"] = "auditor_model"
        request["model"].update(format="ONNX", sha256=sha256(model), sourceSha256=sha256(model), size=len(model))
        request["inputHashes"]["modelArtifact"] = sha256(model)
        request["engineConfig"]["modelSpec"] = spec
        claim = Claim.parse(claim_body(request))
        inputs, outputs = self.root/"inputs", self.root/"outputs"
        inputs.mkdir()
        outputs.mkdir()
        (inputs/"dataset.csv").write_bytes(data)
        (inputs/"model.onnx").write_bytes(model)
        execution = {"kind": "model_inference", "networkIsolation": "docker_network_none", "controller": "external_auditor_worker", "limitations": ["Fixture container boundary."]}
        (inputs/"envelope.json").write_bytes(json_bytes({"claim": claim.transport_dict(), "imageDigest": IMAGE, "execution": execution, "approvedModelSha256": sha256(model)}))
        return claim, inputs, outputs

    @requires_numpy
    def test_native_inference_applies_the_frozen_threshold_in_compute(self):
        data, model = THRESHOLD_ROWS.encode(), b"fixture ONNX bytes; scored by a fake runtime"
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"], "decisionThreshold": .3, "predictionOutput": "probabilities", "predictionKind": "probability"}
        claim, inputs, outputs = self.inference_inputs(spec, data, model)
        with patch.dict(sys.modules, {"onnxruntime": fake_onnxruntime()}):
            compute_job(inputs, outputs)
        packet = verify_result_bytes((outputs/"result.json").read_bytes(), claim, IMAGE)
        performance = packet["hostedResults"][0]
        self.assertEqual(next(m["value"] for m in performance["metrics"] if m["name"] == "accuracy"), 1.0)
        self.assertEqual(performance["outcome"], "pass")
        self.assertEqual(packet["provenance"]["inputHashes"]["modelArtifact"], sha256(model))

    @requires_numpy
    def test_running_out_of_memory_while_scoring_is_compute_resource_exhausted(self):
        data, model = THRESHOLD_ROWS.encode(), b"fixture ONNX bytes; scored by a fake runtime"
        spec = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"], "predictionOutput": "probabilities", "predictionKind": "probability"}
        _, inputs, outputs = self.inference_inputs(spec, data, model)
        runtime = types.SimpleNamespace(SessionOptions=types.SimpleNamespace, InferenceSession=lambda *_args, **_kwargs: FakeOnnxSession({"probabilities": out_of_memory}))
        # compute_main normally runs in a child; keep POSIX rlimits off the test runner.
        with patch.dict(sys.modules, {"onnxruntime": runtime}), patch("engine.worker.enforce_compute_limits"):
            self.assertEqual(compute_main(str(inputs), str(outputs)), 2)
        # Not model_inference_failed: the model is not at fault.
        self.assertEqual(compute_failure_code(outputs), "compute_resource_exhausted")

    def test_real_http_claim_download_process_and_signed_complete(self):
        with RunnerServer() as server:
            result = self.worker(server.transport()).once()
            self.assertEqual(result["state"], "completed")
            complete = next(body for body, _ in server.posts if body["op"] == "complete")
            raw = Path(result["resultFile"]).read_bytes()
            self.assertEqual(complete["resultJSON"].encode(), raw)
            self.assertEqual(complete["resultSha256"], sha256(raw))
            self.assertEqual(server.gets[0]["input"], ["dataset"])
            self.assertEqual(server.gets[0]["fence"], ["7"])
            self.assertEqual(server.errors, [])
            inputs = Path(result["resultFile"]).parent.parent/"inputs"
            self.assertEqual((inputs/"dataset.csv").read_bytes(), CSV)
            self.assertEqual(list(inputs.glob("*.partial")), [])

    def test_changed_download_never_completes_and_error_is_sanitized(self):
        for option, code in (("altered_input", "response_size_rejected"), ("swapped_input", "dataset_input_pin_mismatch")):
            with RunnerServer(**{option: True}) as server:
                result = self.worker(server.transport(), workspace=option).once()
                self.assertEqual((result["state"], result["error"]), ("failed", code))
                self.assertFalse(any(body["op"] == "complete" for body, _ in server.posts))
                self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], [code])
                self.assertNotIn(TOKEN, json.dumps(result))
                self.assertNotIn("tampered", json.dumps(result))
            # Rejected bytes never receive the dataset's name, even partially.
            self.assertEqual(list((self.root/option).glob("job-*/inputs/dataset.csv*")), [])

    def operator_log(self):
        return [json.loads(line) for line in (self.root/"jobs"/"operator-log.jsonl").read_text(encoding="utf-8").splitlines()]

    def test_compute_failure_posts_its_code_and_keeps_details_local(self):
        data = b"truth,predicted,group\n1,1,A\n0,0,B\n"
        with RunnerServer(hosted_request(data, suite=["performance"]), data) as server:
            result = self.worker(server.transport()).once()
            self.assertEqual(result, {"state": "failed", "jobId": server.claim["jobId"], "attemptId": server.claim["attemptId"], "error": "missing_column"})
            fails = [(body, raw) for body, raw in server.posts if body["op"] == "fail"]
            self.assertEqual(len(fails), 1)
            body, raw = fails[0]
            self.assertEqual(set(body), {"op", "jobId", "attemptId", "fence", "nonce", "requestSha256", "error"})
            self.assertEqual(body["error"], "missing_column")
            # The column name and the operator message never leave the host.
            self.assertNotIn(b"actual", raw)
            self.assertFalse(any(body["op"] == "complete" for body, _ in server.posts))
        outputs = next((self.root/"jobs").glob("job-*/outputs"))
        self.assertEqual(json.loads((outputs/"error.json").read_text(encoding="utf-8")), {"schemaVersion": "1.0", "code": "missing_column"})
        entry = self.operator_log()[-1]
        self.assertEqual((entry["event"], entry["code"], entry["failPosted"]), ("failed", "missing_column", True))
        self.assertIn("'actual'", entry["detail"]["message"])
        self.assertEqual(entry["detail"]["exceptionType"], "EngineError")
        if os.name == "posix":  # Windows has no POSIX permission bits.
            # Owner-only, like the job directories, because it names columns.
            self.assertEqual(stat.S_IMODE((self.root/"jobs"/"operator-log.jsonl").stat().st_mode), 0o600)

    def test_label_set_mismatch_reaches_the_auditor_as_its_code(self):
        data = b"actual,predicted\n1,1\n0,2\n1,0\n"
        with RunnerServer(hosted_request(data, suite=["performance"]), data) as server:
            self.assertEqual(self.worker(server.transport()).once()["error"], "label_set_mismatch")
            self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], ["label_set_mismatch"])

    def test_compute_main_writes_only_enumerated_codes(self):
        cases = [
            (EngineError("model_objective_mismatch", "Native objective differs from the declared task"), "model_objective_mismatch", "Native objective differs from the declared task"),
            (EngineError("transport_unavailable", "not a compute code"), "compute_internal_error", "not a compute code"),
            (RuntimeError("row 7 belongs to alice@example.com"), "compute_internal_error", None),
            (MemoryError(), "compute_resource_exhausted", None),
        ]
        # compute_main normally runs in a child; keep POSIX rlimits off the test runner.
        with patch("engine.worker.enforce_compute_limits"):
            for index, (error, code, message) in enumerate(cases):
                inputs, outputs = self.root/f"in-{index}", self.root/f"out-{index}"
                inputs.mkdir()
                outputs.mkdir()
                with patch("engine.worker.compute_job", side_effect=error):
                    self.assertEqual(compute_main(str(inputs), str(outputs)), 2)
                self.assertEqual(json.loads((outputs/"error.json").read_text(encoding="utf-8")), {"schemaVersion": "1.0", "code": code})
                detail = json.loads((outputs/"operator-detail.json").read_text(encoding="utf-8"))
                self.assertEqual((detail["exceptionType"], detail["message"]), (type(error).__name__, message))
                self.assertEqual(compute_failure_code(outputs), code)
            # Without separate, valid directories nothing is written anywhere.
            self.assertEqual(compute_main(str(inputs), str(inputs)), 2)
            self.assertEqual(sorted(path.name for path in inputs.iterdir()), [])

    def test_supervisor_trusts_only_listed_compute_codes(self):
        outputs = self.root/"outputs"
        outputs.mkdir()
        self.assertEqual(compute_failure_code(outputs), "compute_rejected")
        for raw, expected in (
            (b'{"schemaVersion":"1.0","code":"missing_column"}', "missing_column"),
            (b'{"schemaVersion":"1.0","code":"transport_unavailable"}', "compute_rejected"),
            (b'{"schemaVersion":"1.0","code":"x; DROP TABLE jobs"}', "compute_rejected"),
            (b'{"schemaVersion":"2.0","code":"missing_column"}', "compute_rejected"),
            (b'{"schemaVersion":"1.0","code":"missing_column","code":"missing_value"}', "compute_rejected"),
            (b"not json", "compute_rejected"),
            (b'{"schemaVersion":"1.0","code":"missing_column","padding":"'+b"x"*5000+b'"}', "compute_rejected"),
        ):
            (outputs/"error.json").write_bytes(raw)
            self.assertEqual(compute_failure_code(outputs), expected)

    def test_control_plane_failures_are_posted_and_never_stop_the_worker(self):
        for error, code in ((RuntimeError("unexpected"), "worker_internal_error"), (PermissionError("job directory"), "workspace_unavailable")):
            with RunnerServer() as server, patch.object(Worker, "execute", side_effect=error):
                result = self.worker(server.transport()).once()
                self.assertEqual(result["error"], code)
                self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], [code])
        with RunnerServer() as server, patch("engine.worker.verify_result_bytes", side_effect=ValueError("tampered evidence")):
            self.assertEqual(self.worker(server.transport()).once()["error"], "result_verification_failed")
            self.assertFalse(any(body["op"] == "complete" for body, _ in server.posts))
            self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], ["result_verification_failed"])
        self.assertEqual(self.operator_log()[-1]["detail"], {"exceptionType": "ProtocolError", "message": None})

    def test_failure_codes_are_enumerated_and_documented(self):
        engine = Path(__file__).resolve().parents[1]
        section = (engine/"WORKER.md").read_text(encoding="utf-8").split("\n## Failure codes\n", 1)[1].split("\n## ", 1)[0]
        documented = set(re.findall(r"^\| `([a-z0-9_<>]+)` \|", section, re.M))
        self.assertEqual(documented, FAILURE_CODES | {"http_<status>"})
        self.assertLess(COMPUTE_FAILURE_CODES, FAILURE_CODES)
        raised = set()
        for path in engine.glob("*.py"):
            # Literal codes only; http_<status> is built from the response.
            raised.update(re.findall(r"(?:EngineError|ProtocolError)\(\"([a-z0-9_]+)\"[,)]", path.read_text(encoding="utf-8")))
        # Heartbeat outcomes end the lease locally and are never posted.
        self.assertEqual(raised - FAILURE_CODES, {"invalid_heartbeat_response", "heartbeat_lease_expired"})
        self.assertEqual([failure_code(code) for code in ("missing_column", "http_404", "http_4040", "Traceback: secret", None)], ["missing_column", "http_404", "worker_internal_error", "worker_internal_error", "worker_internal_error"])
        self.assertEqual(job_failure_code(EngineError("not_a_code", "x")), "worker_internal_error")
        self.assertEqual(job_failure_code(ProtocolError("http_503")), "http_503")

    def download(self, transport, claim, maximum=len(CSV), **kwargs):
        destination = self.root/"dataset.csv"
        return destination, transport.download(claim, "dataset", destination, maximum=maximum, **kwargs)

    def model_request(self, **spec):
        """An auditor_model request the platform can queue (its classOrder/features limits are wider)."""
        request = hosted_request(suite=["performance"])
        request["executionMode"] = "auditor_model"
        request["model"].update(format="ONNX", sha256="b"*64, sourceSha256="b"*64)
        request["inputHashes"]["modelArtifact"] = "b"*64
        request["engineConfig"]["modelSpec"] = {"task": "binary_classification", "featureColumns": ["x"], "outputLabels": ["0", "1"], **spec}
        return request

    def run_daemon(self, server, polls, *arguments):
        """Run the long-running CLI loop against the loopback fixture for `polls` polls."""
        real_sleep, seen = time.sleep, []
        def sleep(seconds):
            if seconds == 1.5:  # The poll interval below; backoff and compute polling differ.
                seen.append(seconds)
                if len(seen) >= polls:
                    raise KeyboardInterrupt
                return
            real_sleep(seconds)
        def loopback(site, token, platform, *, timeout):
            # The public CLI refuses plain HTTP; only this fixture may use it.
            self.assertEqual(site, server.origin)
            return Transport(site, token, platform, timeout=timeout, allow_local_http=True)
        argv = ["--site", server.origin, "--worker-id", "worker-fixture", "--image-digest", IMAGE, "--workspace", str(self.root/"daemon"), "--poll-seconds", "1.5", "--heartbeat-seconds", "1", *arguments]
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {"ASSURANCE_WORKER_TOKEN": TOKEN, "ASSURANCE_SITE_SERVICE_TOKEN": PLATFORM}), patch("engine.worker.Transport", side_effect=loopback), patch("engine.worker.time.sleep", side_effect=sleep), redirect_stdout(stdout), redirect_stderr(stderr):
            code = worker_main(argv)
        return code, [json.loads(line) for line in stdout.getvalue().splitlines()], stderr.getvalue()

    def model_worker(self, transport, workspace="jobs"):
        return Worker(transport, ModelReadyExecutor(), self.root/workspace, worker_id=WORKER_ID, image_digest=IMAGE, heartbeat=1, formats=["onnx"], approved_hashes=["b"*64])

    def test_malformed_claim_is_failed_and_the_daemon_continues(self):
        claims = [claim_body(self.model_request(outputLabels=["0", "1", "2"]), job="job-malformed", attempt="attempt-malformed"), claim_body(job="job-next", attempt="attempt-next")]
        with RunnerServer(claims=claims, capabilities=("provided_predictions", "ONNX")) as server, patch("engine.worker.ProcessExecutor", ModelReadyExecutor):
            code, results, errors = self.run_daemon(server, 3, "--formats", "onnx", "--approved-model-hashes", "b"*64)
            self.assertEqual(code, 130, errors)
            self.assertEqual([result["state"] for result in results], ["failed", "completed", "idle"])
            self.assertEqual(results[0], {"state": "failed", "jobId": "job-malformed", "attemptId": "attempt-malformed", "error": "request_contract_rejected"})
            fails = [body for body, _ in server.posts if body["op"] == "fail"]
            self.assertEqual(fails, [{"op": "fail", **{key: claims[0][key] for key in PIN_KEYS}, "error": "request_contract_rejected"}])
            self.assertEqual([body["jobId"] for body, _ in server.posts if body["op"] == "complete"], ["job-next"])
            self.assertEqual(server.errors, [])

    def test_claims_the_platform_accepts_but_the_worker_cannot_run_are_failed(self):
        unhashable = hosted_request()
        unhashable["executionMode"] = ["provided_predictions"]
        mismatched = claim_body()
        mismatched["request"] = {**mismatched["request"], "seed": 43}
        for index, body in enumerate((
            claim_body(self.model_request(outputLabels=["0", "1", "2"])),
            claim_body(self.model_request(featureColumns=[f"feature-{n}" for n in range(101)])),
            claim_body(unhashable),
            mismatched,
        )):
            with RunnerServer(claims=[body], capabilities=("provided_predictions", "ONNX")) as server:
                result = self.model_worker(server.transport(), workspace=f"jobs-{index}").once()
                self.assertEqual((result["state"], result["error"]), ("failed", "request_contract_rejected"), index)
                self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], ["request_contract_rejected"])
                self.assertEqual(server.gets, [])

    def test_model_labels_outside_the_frozen_pair_fail_at_claim_before_any_download(self):
        # The platform freezes negativeLabel "0" by default; this model labels "no"/"yes".
        request = self.model_request(outputLabels=["no", "yes"])
        request["engineConfig"]["config"]["positiveLabel"] = "yes"
        with self.assertRaises(EngineError) as error:
            validate_request(request)
        self.assertEqual(error.exception.code, "label_set_mismatch")
        self.assertEqual(str(error.exception), "Model outputLabels ['no', 'yes'] differ from the frozen positiveLabel and negativeLabel ['yes', '0']")
        with RunnerServer(claims=[claim_body(request)], capabilities=("provided_predictions", "ONNX")) as server:
            result = self.model_worker(server.transport()).once()
            self.assertEqual((result["state"], result["error"]), ("failed", "label_set_mismatch"))
            self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], ["label_set_mismatch"])
            self.assertEqual(server.gets, [])
        self.assertEqual(self.operator_log()[-1]["detail"]["message"], str(error.exception))
        # A request frozen without negativeLabel still needs positiveLabel among the model's labels.
        del request["engineConfig"]["negativeLabel"]
        validate_request(request)
        request["engineConfig"]["config"]["positiveLabel"] = "approved"
        with self.assertRaises(EngineError) as error:
            validate_request(request)
        self.assertEqual(error.exception.code, "label_set_mismatch")
        request["engineConfig"]["config"]["positiveLabel"] = "yes"
        request["engineConfig"]["negativeLabel"] = "no"
        validate_request(request)

    def test_lease_expired_on_receipt_is_failed_with_its_own_code(self):
        with RunnerServer(claims=[claim_body(lease_seconds=-30)]) as server:
            result = self.worker(server.transport()).once()
            self.assertEqual(result["error"], "lease_expired_on_receipt")
            self.assertEqual([body["error"] for body, _ in server.posts if body["op"] == "fail"], ["lease_expired_on_receipt"])
            self.assertEqual(server.gets, [])
        self.assertIn("by the server's clock", self.operator_log()[-1]["detail"]["message"])

    def test_a_skewed_worker_clock_honours_the_server_lease(self):
        # Ten minutes fast used to fail every claim with lease_expired_on_receipt;
        # leases now count down from the server's Date header on the monotonic clock.
        with RunnerServer() as server, skewed_worker_clock(600):
            result = self.worker(server.transport()).once()
            self.assertEqual(result["state"], "completed")
            self.assertEqual(server.errors, [])
            self.assertEqual([body["op"] for body, _ in server.posts if body["op"] in {"complete", "fail"}], ["complete"])
        # Ten minutes slow cannot keep alive a lease the server has already ended.
        with RunnerServer(claims=[claim_body(lease_seconds=-30)]) as server, skewed_worker_clock(-600):
            self.assertEqual(self.worker(server.transport(), workspace="slow").once()["error"], "lease_expired_on_receipt")
            self.assertEqual(server.gets, [])

    def test_lease_deadlines_count_down_from_the_server_clock(self):
        clock = ServerClock(1000.0, "Thu, 05 Nov 2026 12:00:00 GMT")
        # 120 s left by the server, less one second for the Date header's resolution.
        self.assertEqual(clock.deadline("2026-11-05T12:02:00.000Z"), 1119.0)
        self.assertEqual(clock.deadline("2026-11-05T12:00:00.250Z"), 999.25)
        with skewed_worker_clock(3600):
            self.assertEqual(clock.deadline("2026-11-05T12:02:00.000Z"), 1119.0)
        with self.assertRaises(ValueError):
            clock.deadline("12:02")
        # Without a usable Date header only this host's clock can say what is left.
        lease = (datetime.now(timezone.utc)+timedelta(seconds=60)).isoformat()
        for date in (None, "", "yesterday", "Thu, 05 Nov 2026 12:00:00 -0000"):
            with self.subTest(date=date):
                fallback = ServerClock(1000.0, date)
                self.assertIn("no usable Date header", fallback.source)
                self.assertAlmostEqual(fallback.deadline(lease)-time.monotonic(), 60, delta=5)

    def test_a_lease_counts_down_from_when_the_answering_attempt_was_sent(self):
        # The server reads its clock while it answers, after the request left.
        # Counting from receipt would end the local lease after the real one.
        monotonic = FakeMonotonic(1000.0)
        lease = json_bytes({"leaseUntil": "2026-11-05T12:02:00.000Z"})
        # The first attempt times out after 2 s; the retry's answer takes 7.5 s to read.
        transport = self.scripted_transport(([(2, TimeoutError("timed out"))], None), ([(7.5, lease), b""], len(lease)), clock=monotonic, date="Thu, 05 Nov 2026 12:00:00 GMT")
        with patch("engine.worker.time.monotonic", monotonic), patch("engine.worker.time.sleep", monotonic.sleep):
            response, clock = transport.post_timed({"op": "heartbeat"}, retry=True)
        # The retry was sent at 1002.25, after a 0.25 s backoff, and answered at 1009.75.
        self.assertEqual((len(transport.opener.responses), monotonic()), (2, 1009.75))
        # 120 s left by the Date header, less one second, counted from 1002.25.
        self.assertEqual(clock.deadline(response["leaseUntil"]), 1121.25)

    def test_claim_without_valid_pins_is_logged_and_never_failed(self):
        unaddressable = {**claim_body(), "jobId": "../../etc/passwd"}
        with RunnerServer(claims=[unaddressable, claim_body(job="job-next", attempt="attempt-next")]) as server:
            worker = self.worker(server.transport())
            self.assertEqual(worker.once(), {"state": "claim_rejected", "error": "claim_pins_invalid"})
            self.assertFalse(any(body["op"] == "fail" for body, _ in server.posts))
            self.assertEqual(worker.once()["state"], "completed")
            self.assertEqual(worker.once(), {"state": "idle"})
        self.assertEqual([(entry["event"], entry.get("code")) for entry in self.operator_log()], [("claim_rejected", "claim_pins_invalid"), ("completed", None)])

    def raw(self, server, method, *, body=None, token=TOKEN, sign=True, query=""):
        """One request that bypasses the worker's own encoders: (status, JSON or bytes)."""
        data = body if body is None or isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        headers = {"Authorization": "Bearer "+token, "OAI-Sites-Authorization": "Bearer "+PLATFORM}
        if data is not None and sign:
            headers["X-Result-Signature"] = result_signature(token, data)
        request = urllib.request.Request(server.origin+"/api/runner"+query, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                status, content = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, content = error.code, error.read()
        try:
            return status, json.loads(content)
        except ValueError:
            return status, content

    def test_fixture_enforces_the_runner_route_contract(self):
        claim = {"op": "claim", "workerId": WORKER_ID, "imageDigest": IMAGE, "formats": ["provided_predictions"]}
        with RunnerServer(claims=[]) as server:
            # The platform issues 72-character tokens; a 40-character one is malformed.
            self.assertEqual(self.raw(server, "POST", body=claim, token="dummy-application-worker-token-for-tests"), (401, {"error": "Runner authentication required"}))
            self.assertEqual(self.raw(server, "POST", body=claim, token="f"*72), (401, {"error": "Runner credential invalid or revoked"}))
            self.assertEqual(self.raw(server, "POST", body=claim), (200, {"idle": True}))
            self.assertEqual(self.raw(server, "POST", body={**claim, "extra": 1})[0], 400)
            self.assertEqual(self.raw(server, "POST", body={**claim, "imageDigest": "sha256:"+"b"*64})[0], 403)
            self.assertEqual(self.raw(server, "POST", body={**claim, "formats": ["ONNX"]})[0], 409)
            self.assertEqual(self.raw(server, "POST", body={"op": "release"})[0], 400)
            self.assertEqual(self.raw(server, "POST", body=b"{not json")[0], 500)
        with RunnerServer() as server:
            status, issued = self.raw(server, "POST", body=claim)
            self.assertEqual((status, set(issued)), (200, {"jobId", "attemptId", "fence", "nonce", "leaseUntil", "requestSha256", "requestJSON", "request"}))
            pins = {key: issued[key] for key in PIN_KEYS}
            self.assertEqual(self.raw(server, "POST", body={"op": "heartbeat", **pins, "extra": 1})[0], 400)
            self.assertEqual(self.raw(server, "POST", body={"op": "heartbeat", **pins, "fence": 8})[0], 409)
            self.assertEqual(self.raw(server, "POST", body={"op": "heartbeat", **pins})[0], 200)
            self.assertEqual(self.raw(server, "POST", body={"op": "fail", **pins, "error": "x"}, sign=False), (401, {"error": "Authenticated result signature required"}))
            self.assertEqual(self.raw(server, "POST", body={"op": "fail", **pins, "error": "x"*1001})[0], 400)
            self.assertEqual(self.raw(server, "POST", body={"op": "complete", **pins, "resultJSON": "{}", "resultSha256": "0"*64}), (400, {"error": "Result bytes hash mismatch"}))
            fence = "&fence="+str(pins["fence"])
            base = "?jobId="+pins["jobId"]+"&attemptId="+pins["attemptId"]
            self.assertEqual(self.raw(server, "GET", query=base+"&fence=8&input=dataset")[0], 404)
            self.assertEqual(self.raw(server, "GET", query=base+fence+"&input=report")[0], 500)
            self.assertEqual(self.raw(server, "GET", query=base+fence+"&input=model")[0], 403)
            self.assertEqual(self.raw(server, "GET", query=base+fence+"&input=dataset"), (200, CSV))
            self.assertEqual(self.raw(server, "POST", body={"op": "fail", **pins, "error": "request_contract_rejected"}), (200, {"accepted": True}))
            # A settled attempt can neither renew its lease nor download inputs.
            self.assertEqual(self.raw(server, "POST", body={"op": "heartbeat", **pins})[0], 409)
            self.assertEqual(self.raw(server, "GET", query=base+fence+"&input=dataset")[0], 409)

    def test_worker_envelopes_pass_every_route_check(self):
        with RunnerServer() as server:
            worker = self.worker(server.transport())
            result = worker.once()
            self.assertEqual(result["state"], "completed")
            self.assertEqual(result["response"], {"accepted": True})
            self.assertEqual((server.errors, server.unsigned), ([], []))
            complete = next(raw for body, raw in server.posts if body["op"] == "complete")
            # The route makes a retried completion of the same digest idempotent.
            self.assertEqual(server.transport().post(complete), {"accepted": True, "duplicate": True})
            self.assertEqual(worker.once(), {"state": "idle"})

    def cli(self, argv, environment=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        variables = {key: value for key, value in os.environ.items() if not key.startswith("ASSURANCE_")}
        with patch.dict(os.environ, {**variables, **(environment or {})}, clear=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = worker_main(argv)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_cli_rejects_incomplete_or_unsafe_configuration(self):
        credentials = {"ASSURANCE_WORKER_TOKEN": TOKEN}
        base = ["--site", "https://runner.example", "--worker-id", WORKER_ID, "--image-digest", IMAGE, "--workspace", str(self.root/"cli"), "--once"]
        for name, argv, environment in (
            ("token missing", base, {}),
            ("site missing", base[2:], credentials),
            ("plain HTTP site", ["--site", "http://runner.example", *base[2:]], credentials),
            ("site with a path", ["--site", "https://runner.example/api", *base[2:]], credentials),
            ("poll interval", [*base, "--poll-seconds", "0"], credentials),
            ("transport timeout", [*base, "--transport-timeout", "500"], credentials),
            ("image digest", [*base, "--image-digest", "sha256:short"], credentials),
            ("worker id", [*base, "--worker-id", "worker id with spaces"], credentials),
            ("native format without Docker", [*base, "--formats", "onnx", "--approved-model-hashes", "b"*64], credentials),
            ("Docker without a pinned image", [*base, "--executor", "docker"], credentials),
            ("unbounded job count", [*base, "--maximum-jobs", "0"], credentials),
        ):
            with self.subTest(name), patch("engine.worker.shutil.which", return_value="docker"):
                code, stdout, stderr = self.cli(argv, environment)
                self.assertEqual(code, 2)
                self.assertEqual(stdout, "")
                self.assertEqual(json.loads(stderr), {"state": "configuration_rejected", "error": "invalid_worker_configuration_or_runtime"})
                self.assertNotIn(TOKEN, stderr)

    def test_cli_once_exit_codes_follow_the_outcome(self):
        def once(server, token=TOKEN):
            loopback = lambda site, token, platform, *, timeout: Transport(site, token, platform, timeout=timeout, allow_local_http=True)
            with patch("engine.worker.Transport", side_effect=loopback):
                code, stdout, _ = self.cli(["--site", server.origin, "--worker-id", WORKER_ID, "--image-digest", IMAGE, "--workspace", str(self.root/"cli"), "--heartbeat-seconds", "1", "--once"], {"ASSURANCE_WORKER_TOKEN": token, "ASSURANCE_SITE_SERVICE_TOKEN": PLATFORM})
            return code, json.loads(stdout)
        with RunnerServer(claims=[]) as server:
            self.assertEqual(once(server), (0, {"state": "idle"}))
        with RunnerServer() as server:
            code, result = once(server)
            self.assertEqual((code, result["state"]), (0, "completed"))
        with RunnerServer(claims=[claim_body(lease_seconds=-30, job="job-expired")]) as server:
            self.assertEqual(once(server), (2, {"state": "failed", "jobId": "job-expired", "attemptId": "ATTEMPT-0123456789ab", "error": "lease_expired_on_receipt"}))
        with RunnerServer() as server:
            self.assertEqual(once(server, token="f"*72), (2, {"state": "transport_failed", "error": "http_401"}))
        code, stdout, _ = self.cli(["--readiness"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout)["workerVersion"], WORKER_VERSION)

    def test_cli_runs_as_a_module(self):
        root = Path(__file__).resolve().parents[2]
        environment = {key: value for key, value in os.environ.items() if not key.startswith("ASSURANCE_")}
        readiness = subprocess.run([sys.executable, "-m", "engine.worker", "--readiness"], cwd=root, env=environment, capture_output=True, text=True, timeout=60)
        self.assertEqual(readiness.returncode, 0, readiness.stderr)
        self.assertEqual(json.loads(readiness.stdout)["workerVersion"], WORKER_VERSION)
        rejected = subprocess.run([sys.executable, "-m", "engine.worker", "--once", "--workspace", str(self.root/"module")], cwd=root, env=environment, capture_output=True, text=True, timeout=60)
        self.assertEqual(rejected.returncode, 2)
        self.assertEqual(json.loads(rejected.stderr)["state"], "configuration_rejected")

    def test_validate_model_spec_enforces_the_typed_contract(self):
        binary = {"task": "binary_classification", "featureColumns": ["age", "income"], "outputLabels": ["0", "1"], "decisionThreshold": .5, "predictionOutput": "label", "predictionKind": "probability", "labelEncoding": "class_index", "probabilityOutput": "probabilities"}
        validate_model_spec(binary, "binary_classification")
        validate_model_spec({**binary, "featureColumns": [f"feature-{n}" for n in range(100)], "decisionThreshold": 1}, "binary_classification")
        validate_model_spec({"task": "regression", "featureColumns": ["x"], "outputLabels": []}, "regression")
        validate_model_spec({"task": "multiclass_classification", "featureColumns": ["x"], "outputLabels": [str(n) for n in range(100)]}, "multiclass_classification")
        for name, spec, task in (
            ("not an object", [], "binary_classification"),
            ("unknown field", {**binary, "pipeline": "scaler.pkl"}, "binary_classification"),
            ("task differs", binary, "regression"),
            ("no features", {**binary, "featureColumns": []}, "binary_classification"),
            ("101 features", {**binary, "featureColumns": [f"feature-{n}" for n in range(101)]}, "binary_classification"),
            ("duplicate feature", {**binary, "featureColumns": ["age", "age"]}, "binary_classification"),
            ("blank feature", {**binary, "featureColumns": ["age", " "]}, "binary_classification"),
            ("long feature", {**binary, "featureColumns": ["x"*301]}, "binary_classification"),
            ("non-text feature", {**binary, "featureColumns": [1]}, "binary_classification"),
            ("three binary classes", {**binary, "outputLabels": ["0", "1", "2"]}, "binary_classification"),
            ("one binary class", {**binary, "outputLabels": ["1"]}, "binary_classification"),
            ("duplicate class", {**binary, "outputLabels": ["1", "1"]}, "binary_classification"),
            ("empty class", {**binary, "outputLabels": ["", "1"]}, "binary_classification"),
            ("regression with classes", {"task": "regression", "featureColumns": ["x"], "outputLabels": ["0", "1"]}, "regression"),
            ("101 classes", {"task": "multiclass_classification", "featureColumns": ["x"], "outputLabels": [str(n) for n in range(101)]}, "multiclass_classification"),
            ("threshold above one", {**binary, "decisionThreshold": 1.5}, "binary_classification"),
            ("negative threshold", {**binary, "decisionThreshold": -.1}, "binary_classification"),
            ("boolean threshold", {**binary, "decisionThreshold": True}, "binary_classification"),
            ("text threshold", {**binary, "decisionThreshold": "0.5"}, "binary_classification"),
            ("NaN threshold", {**binary, "decisionThreshold": float("nan")}, "binary_classification"),
            ("prediction kind", {**binary, "predictionKind": "score"}, "binary_classification"),
            ("label encoding", {**binary, "labelEncoding": "one_hot"}, "binary_classification"),
            ("empty output name", {**binary, "predictionOutput": ""}, "binary_classification"),
            ("non-text output name", {**binary, "probabilityOutput": 3}, "binary_classification"),
        ):
            with self.subTest(name), self.assertRaises(ValueError):
                validate_model_spec(spec, task)

    def test_get_retries_are_bounded_and_claim_is_not_retried(self):
        with RunnerServer(transient_get=2) as server:
            destination, (partial, size, digest) = self.download(server.transport(), Claim.parse(server.claim))
            self.assertEqual((partial, size, digest), (destination.with_name("dataset.csv.partial"), len(CSV), sha256(CSV)))
            self.assertEqual(partial.read_bytes(), CSV)
            self.assertEqual(len(server.gets), 3)
        with RunnerServer(transient_get=3) as server:
            with self.assertRaises(ProtocolError) as error:
                self.download(server.transport(), Claim.parse(server.claim))
            self.assertEqual((error.exception.code, len(server.gets)), ("http_503", 3))
            # A failed download leaves no partial bytes behind.
            self.assertEqual(list(self.root.glob("dataset.csv*")), [])
        with RunnerServer(transient_claim=1) as server:
            with self.assertRaises(ProtocolError):
                self.worker(server.transport()).request_claim()
            self.assertEqual(len(server.posts), 1)

    def test_credentials_are_not_forwarded_on_redirects(self):
        with RunnerServer(redirect=True) as server:
            with self.assertRaises(ProtocolError) as error:
                self.download(server.transport(), Claim.parse(server.claim))
            self.assertEqual(error.exception.status, 302)
            self.assertEqual(len(server.gets), 1)
            self.assertEqual(list(self.root.glob("dataset.csv*")), [])
        with self.assertRaises(ValueError):
            Transport("http://example.org", TOKEN)

    def test_stale_lease_cannot_publish_and_compute_has_no_service_secrets(self):
        keeper = LeaseKeeper(None, Claim.parse(claim_body()), time.monotonic()-1)
        with self.assertRaises(LeaseLost):
            keeper.valid()
        with patch.dict(os.environ, {"ASSURANCE_WORKER_TOKEN": TOKEN, "ASSURANCE_SITE_SERVICE_TOKEN": PLATFORM, "HTTP_PROXY": "fixture-proxy", "DOCKER_HOST": "unix:///fixture-rootless-docker.sock"}):
            environment = stripped_compute_env()
            control = docker_control_env()
        self.assertNotIn("ASSURANCE_WORKER_TOKEN", environment)
        self.assertNotIn("ASSURANCE_SITE_SERVICE_TOKEN", environment)
        self.assertNotIn("HTTP_PROXY", environment)
        self.assertNotIn("DOCKER_HOST", environment)
        self.assertEqual(control["DOCKER_HOST"], "unix:///fixture-rootless-docker.sock")
        self.assertNotIn("ASSURANCE_WORKER_TOKEN", control)

    def test_native_format_advertisement_requires_isolation_allowlist_and_runtime(self):
        with self.assertRaises(ValueError):
            self.worker(None, formats=["onnx"], approved_hashes=["b"*64])
        class MissingRuntime:
            permits_models = True
            def readiness(self):
                return {"modelFormats": {"onnx": {"runtimePresent": False}}}
        with self.assertRaises(ValueError):
            Worker(None, MissingRuntime(), self.root/"separate", worker_id="worker-fixture", image_digest=IMAGE, formats=["onnx"], approved_hashes=["b"*64])

    def test_heartbeat_renews_and_rejected_fence_stops_compute(self):
        # A host clock ten minutes fast once made every renewed lease look expired.
        with RunnerServer() as server, skewed_worker_clock(600):
            claim, initial = Claim.parse(server.claim), time.monotonic()+30
            with LeaseKeeper(server.transport(), claim, initial, interval=.05) as lease:
                deadline = time.monotonic()+3
                while lease.deadline == initial and time.monotonic() < deadline:
                    time.sleep(.02)
                lease.valid()
                # Renewed from the server's Date header: about two minutes from now.
                self.assertGreater(lease.deadline, initial)
            self.assertTrue(any(body["op"] == "heartbeat" for body, _ in server.posts))
            self.assertEqual(server.errors, [])
        with RunnerServer(heartbeat_rejected=True) as server:
            with LeaseKeeper(server.transport(), Claim.parse(server.claim), time.monotonic()+30, interval=.05) as lease:
                self.assertTrue(lease.lost.wait(timeout=3))
                with self.assertRaises(LeaseLost):
                    lease.valid()

    def test_ambiguous_completion_retries_same_bytes_and_never_sends_fail(self):
        with RunnerServer(transient_complete=3) as server:
            result = self.worker(server.transport()).once()
            self.assertEqual(result["state"], "completion_uncertain")
            completed = [raw for body, raw in server.posts if body["op"] == "complete"]
            self.assertEqual(len(completed), 3)
            self.assertTrue(all(raw == completed[0] for raw in completed))
            self.assertFalse(any(body["op"] == "fail" for body, _ in server.posts))
            self.assertEqual(len(list((self.root/"jobs").glob("job-*/outputs/result.json"))), 1)

    def test_workspace_capacity_does_not_acquire_another_lease(self):
        with RunnerServer() as server:
            worker = self.worker(server.transport(), maximum_jobs=1)
            (self.root/"jobs"/"job-existing").mkdir()
            self.assertEqual(worker.once()["state"], "workspace_capacity_reached")
            self.assertEqual(server.posts, [])


    def test_workspace_symlink_rejected_before_resolving(self):
        # Portable on Windows without symlink-creation privileges.
        with patch.object(Path, "is_symlink", autospec=True,
                side_effect=lambda path: path.name == "linked-jobs"), \
                patch.object(Path, "resolve", autospec=True) as resolving:
            with self.assertRaisesRegex(ValueError, "symlinks"):
                Worker(None, ProcessExecutor(), self.root/"linked-jobs",
                    worker_id="worker-fixture", image_digest=IMAGE)
            resolving.assert_not_called()

    def scripted_transport(self, *scripts, timeout=2, retries=2, clock=None, date=None):
        """Transport whose attempts replay scripted read1 results in order.

        A script item is bytes, an exception to raise, or None for "one byte
        after a second", a live but far too slow trickle on `clock`. A
        (seconds, item) pair is that item after `seconds` on `clock`. Every
        response carries `date`, when given, as its Date header.
        """
        class Response:
            def __init__(self, script, length):
                self.script, self.reads = list(script), 0
                self.headers = {} if length is None else {"Content-Length": str(length)}
                if date is not None:
                    self.headers["Date"] = date
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def read(self, *_):
                raise AssertionError("Accumulating read must not be used")
            def read1(self, _):
                self.reads += 1
                item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
                if isinstance(item, tuple):
                    seconds, item = item
                    clock.now += seconds
                if item is None:
                    clock.now += 1
                    return b"x"
                if isinstance(item, Exception):
                    raise item
                return item
        class Opener:
            def __init__(self):
                self.responses = []
            def open(self, _request, *, timeout):
                # The idle timeout bounds every connect and single read.
                test.assertEqual(timeout, transport.timeout)
                script, length = scripts[len(self.responses)]
                self.responses.append(Response(script, length))
                return self.responses[-1]
        test = self
        transport = Transport("https://runner.example", TOKEN, timeout=timeout, retries=retries)
        transport.opener = Opener()
        return transport

    def test_trickling_download_is_bounded_and_each_retry_gets_a_fresh_budget(self):
        clock, claim = FakeMonotonic(), Claim.parse(claim_body())
        transport = self.scripted_transport(*[([None], None)]*3, clock=clock)
        with patch("engine.worker.time.monotonic", clock), patch("engine.worker.time.sleep"):
            with self.assertRaisesRegex(ProtocolError, "response_deadline_exceeded"):
                self.download(transport, claim, maximum=100)
        # Budget: 2 s idle timeout plus 100 bytes at the minimum rate. Every
        # attempt reads for just over two seconds, including both retries.
        self.assertEqual([response.reads for response in transport.opener.responses], [3, 3, 3])
        self.assertEqual(list(self.root.glob("dataset.csv*")), [])
        # The lease is checked around every read, and a lost lease is final.
        transport = self.scripted_transport(*[([None], None)]*3, clock=clock)
        checks = 0
        def active():
            nonlocal checks
            checks += 1
            if checks == 3:
                raise LeaseLost("lease_lost")
        with patch("engine.worker.time.monotonic", clock):
            with self.assertRaisesRegex(LeaseLost, "lease_lost"):
                self.download(transport, claim, maximum=100, check_active=active)
        self.assertEqual([response.reads for response in transport.opener.responses], [1])

    def test_idle_timeout_retry_restarts_the_partial_file(self):
        claim = Claim.parse(claim_body())
        transport = self.scripted_transport(([CSV[:10], TimeoutError("timed out")], len(CSV)), ([CSV, b""], len(CSV)), retries=1)
        with patch("engine.worker.time.sleep"):
            _, (partial, size, digest) = self.download(transport, claim)
        self.assertEqual((partial.read_bytes(), size, digest), (CSV, len(CSV), sha256(CSV)))
        transport = self.scripted_transport(*[([CSV[:10], TimeoutError("timed out")], len(CSV))]*2, retries=1)
        with patch("engine.worker.time.sleep"):
            with self.assertRaisesRegex(ProtocolError, "transport_idle_timeout"):
                self.download(transport, claim)
        self.assertEqual(list(self.root.glob("dataset.csv*")), [])

    def test_truncated_transfer_is_retried_over_real_http(self):
        with RunnerServer(truncated_get=1) as server:
            _, (partial, size, digest) = self.download(server.transport(), Claim.parse(server.claim))
            self.assertEqual(len(server.gets), 2)
            self.assertEqual((partial.read_bytes(), size, digest), (CSV, len(CSV), sha256(CSV)))
        with RunnerServer(truncated_get=3) as server, patch("engine.worker.time.sleep"):
            with self.assertRaisesRegex(ProtocolError, "response_truncated"):
                self.download(server.transport(), Claim.parse(server.claim))
            self.assertEqual(len(server.gets), 3)

    def test_budget_scales_with_size_and_transport_timeout_is_bounded(self):
        transport = Transport("https://runner.example", TOKEN, timeout=15)
        self.assertEqual(transport.budget(100*1024*1024), 15+800)
        self.assertEqual(transport.budget(0), 15)
        self.assertEqual(Transport("https://runner.example", TOKEN, timeout=120).timeout, 120)
        for timeout in (0.5, 121, True, float("nan"), "15"):
            with self.assertRaises(ValueError):
                Transport("https://runner.example", TOKEN, timeout=timeout)


if __name__ == "__main__":
    unittest.main()
