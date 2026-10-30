import copy
import hashlib
import hmac
import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from engine.diagnostics import read_csv, run, sha256
from engine.worker import LeaseKeeper, LeaseLost, ProcessExecutor, ProtocolError, Transport, Worker, compute_job, docker_control_env, runtime_readiness, stripped_compute_env, verify_result_bytes
from engine.worker_contract import Claim, MAX_RESULT_BYTES, completion_body, evidence_envelope, hosted_results, json_bytes, result_signature, strict_json, translate_config, validate_request

TOKEN = "dummy-application-worker-token-for-tests"
PLATFORM = "dummy-platform-service-token-for-tests"
IMAGE = "sha256:"+"a"*64
CSV = b"actual,predicted,group\n1,1,A\n1,1,A\n0,0,A\n0,0,A\n1,1,B\n1,0,B\n0,0,B\n0,0,B\n"


def hosted_request(data=CSV, *, task="Binary classification", suite=None):
    c = {"labelColumn": "actual", "predictionColumn": "predicted", "groupColumn": "group", "positiveLabel": "1", "minimumGroupSize": 2, "maximumParityGap": .15, "minimumImpactRatio": .8, "minimumAccuracy": .8, "minimumSampleSize": 2, "minimumClassCount": 2, "maximumOddsGap": .1, "minimumRecall": .7, "minimumMacroF1": .6, "maximumRmse": .8}
    return {"schemaVersion": "1.0", "executionMode": "provided_predictions", "model": {"id": "model-fixture", "format": "Prediction file", "task": task, "sourceSha256": sha256(data)}, "dataset": {"id": "data-fixture", "name": "predictions.csv", "sha256": sha256(data), "size": len(data)}, "profile": None, "engineConfig": {"contractVersion": "1.1", "id": "run-fixture", "engagementId": "engagement-fixture", "modelId": "model-fixture", "datasetId": "data-fixture", "task": task, "suite": suite or ["performance", "demographic_parity", "disparate_impact", "equalized_odds"], "config": c, "policyId": "fixture-policy", "policyVersion": "1", "seed": 42}, "seed": 42, "inputHashes": {"dataset": sha256(data), "modelArtifact": sha256(data)}}


def claim_body(request=None):
    request = request or hosted_request()
    # Deliberately use the server's original insertion order, not canonical
    # object sorting: requestJSON is authoritative for the transport hash.
    text = json.dumps(request, separators=(",", ":"), ensure_ascii=False)
    return {"jobId": "job-fixture", "attemptId": "attempt-fixture", "fence": 7, "nonce": "nonce-fixture-at-least-16-characters", "leaseUntil": (datetime.now(timezone.utc)+timedelta(seconds=60)).isoformat(), "requestSha256": sha256(text.encode("utf-8")), "request": request, "requestJSON": text}


class RunnerServer:
    """Real loopback HTTP fixture; no platform or native runtime assumed."""
    def __init__(self, request=None, data=CSV, *, altered_input=False, redirect=False, transient_get=0, transient_claim=0, transient_complete=0, heartbeat_rejected=False):
        self.claim = claim_body(request)
        self.data = data+b"tampered" if altered_input else data
        self.redirect, self.transient_get, self.transient_claim = redirect, transient_get, transient_claim
        self.transient_complete, self.heartbeat_rejected = transient_complete, heartbeat_rejected
        self.posts, self.gets, self.errors = [], [], []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def respond(self, value, status=200):
                raw = value if isinstance(value, bytes) else json_bytes(value)
                self.send_response(status)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def credentials(self):
                if self.headers.get("Authorization") != "Bearer "+TOKEN or self.headers.get("OAI-Sites-Authorization") != "Bearer "+PLATFORM:
                    fixture.errors.append("credential mismatch")
                    self.respond({"error": "unauthorized"}, 401)
                    return False
                return True

            def do_POST(self):
                if not self.credentials():
                    return
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                if self.headers.get("X-Result-Signature") != result_signature(TOKEN, raw):
                    fixture.errors.append("signature mismatch")
                    return self.respond({"error": "signature"}, 401)
                body = strict_json(raw, maximum=MAX_RESULT_BYTES+2*1024*1024)
                fixture.posts.append((body, raw))
                if body["op"] == "claim":
                    if fixture.transient_claim:
                        fixture.transient_claim -= 1
                        return self.respond({"error": "temporary"}, 503)
                    return self.respond(fixture.claim)
                if any(body.get(key) != fixture.claim[key] for key in ("jobId", "attemptId", "fence", "nonce", "requestSha256")):
                    fixture.errors.append("attempt pin mismatch")
                    return self.respond({"error": "fence"}, 409)
                if body["op"] == "heartbeat":
                    if fixture.heartbeat_rejected:
                        return self.respond({"error": "stale_fence"}, 409)
                    return self.respond({"leaseUntil": (datetime.now(timezone.utc)+timedelta(seconds=60)).isoformat()})
                if body["op"] == "complete":
                    if sha256(body["resultJSON"].encode("utf-8")) != body["resultSha256"]:
                        fixture.errors.append("exact result hash mismatch")
                        return self.respond({"error": "digest"}, 400)
                    if fixture.transient_complete:
                        fixture.transient_complete -= 1
                        return self.respond({"error": "ambiguous_commit"}, 503)
                    return self.respond({"state": "completed"})
                return self.respond({"state": "failed"})

            def do_GET(self):
                if not self.credentials():
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
                    return self.respond({"error": "temporary"}, 503)
                return self.respond(fixture.data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = "http://127.0.0.1:"+str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

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

    def worker(self, transport, **kwargs):
        return Worker(transport, ProcessExecutor(), self.root/"jobs", worker_id="worker-fixture", image_digest=IMAGE, heartbeat=1, **kwargs)

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

    def test_changed_download_never_completes_and_error_is_sanitized(self):
        with RunnerServer(altered_input=True) as server:
            result = self.worker(server.transport()).once()
            self.assertEqual(result["state"], "failed")
            self.assertFalse(any(body["op"] == "complete" for body, _ in server.posts))
            self.assertTrue(any(body["op"] == "fail" for body, _ in server.posts))
            self.assertNotIn(TOKEN, json.dumps(result))
            self.assertNotIn("tampered", json.dumps(result))

    def test_get_retries_are_bounded_and_claim_is_not_retried(self):
        with RunnerServer(transient_get=2) as server:
            transport = server.transport()
            self.assertEqual(transport.input(Claim.parse(server.claim), "dataset", maximum=len(CSV)), CSV)
            self.assertEqual(len(server.gets), 3)
        with RunnerServer(transient_claim=1) as server:
            with self.assertRaises(ProtocolError):
                self.worker(server.transport()).claim()
            self.assertEqual(len(server.posts), 1)

    def test_credentials_are_not_forwarded_on_redirects(self):
        with RunnerServer(redirect=True) as server:
            with self.assertRaises(ProtocolError) as error:
                server.transport().input(Claim.parse(server.claim), "dataset", maximum=len(CSV))
            self.assertEqual(error.exception.status, 302)
            self.assertEqual(len(server.gets), 1)
        with self.assertRaises(ValueError):
            Transport("http://example.org", TOKEN)

    def test_stale_lease_cannot_publish_and_compute_has_no_service_secrets(self):
        claim = Claim.parse(claim_body())
        keeper = LeaseKeeper(None, claim)
        keeper.until = datetime.now(timezone.utc)-timedelta(seconds=1)
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
        with RunnerServer() as server:
            claim = Claim.parse(server.claim)
            with LeaseKeeper(server.transport(), claim, interval=.05) as lease:
                deadline = __import__("time").monotonic()+3
                while not any(body["op"] == "heartbeat" for body, _ in server.posts) and __import__("time").monotonic() < deadline:
                    __import__("time").sleep(.02)
                lease.valid()
            self.assertTrue(any(body["op"] == "heartbeat" for body, _ in server.posts))
            self.assertEqual(server.errors, [])
        with RunnerServer(heartbeat_rejected=True) as server:
            with LeaseKeeper(server.transport(), Claim.parse(server.claim), interval=.05) as lease:
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

    def test_chunked_input_checks_deadline_and_lease_during_read(self):
        class Response:
            headers = {}
            reads = 0
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def read(self, *_):
                raise AssertionError("Accumulating read must not be used")
            def read1(self, _):
                self.reads += 1
                return b"x"
        class Opener:
            def __init__(self, response):
                self.response = response
            def open(self, *_args, **_kwargs):
                return self.response
        transport = Transport("https://runner.example", TOKEN, timeout=2, retries=0)
        response = Response()
        transport.opener = Opener(response)
        with patch("engine.worker.time.monotonic", side_effect=[0, 0, 0, .5, .5, 2]):
            with self.assertRaisesRegex(ProtocolError, "response_deadline_exceeded"):
                transport.input(Claim.parse(claim_body()), "dataset", maximum=100)
        self.assertEqual(response.reads, 2)
        response = Response()
        transport.opener = Opener(response)
        checks = 0
        def active():
            nonlocal checks
            checks += 1
            if checks == 3:
                raise LeaseLost("lease_lost")
        with self.assertRaisesRegex(LeaseLost, "lease_lost"):
            transport.input(Claim.parse(claim_body()), "dataset", maximum=100, check_active=active)
        self.assertEqual(response.reads, 1)


if __name__ == "__main__":
    unittest.main()
