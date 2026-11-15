"""The `genai_ingest` worker job end to end (docs/design/genai-evidence.md section 10.2, step G5; #128).

A loopback stand-in for site-app/app/api/runner/route.ts serves frozen `genai-1.0` requests the way
lib/commands/assurance/genai.ts `queueGenaiIngest` freezes them, the evidence inputs by index, and
checks completions as `assertGenaiResult` does. The worker claims, downloads, runs the compute child
process (ProcessExecutor) and posts the signed exact result; bad bundles fail with their codes and
the daemon goes on to the next job.
"""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from engine.diagnostics import sha256
from engine.errors import EngineError
from engine.genai.envelope import envelope_json
from engine.genai.ingest import run_bundle
from engine.tests import genai_support as gs
from engine.tests.test_genai_marking_sources import KEY, has_cryptography
from engine.tests.test_worker import IMAGE, TOKEN, WORKER_ID, claim_body
from engine.worker import ProcessExecutor, Transport, Worker, compute_genai_job, genai_readiness, runtime_readiness
from engine.worker_contract import COMPUTE_FAILURE_CODES, FAILURE_CODES, WORKER_VERSION, Claim, json_bytes, result_signature, validate_request, verify_genai_result_bytes
from engine.genai.errors import ERROR_CODES

PIN_KEYS = ("jobId", "attemptId", "fence", "nonce", "requestSha256")
PROMPTFOO = "promptfoo/redteam_shaped.results.json"
MARKER_MODULE = "genai_worker_marker_128"


def genai_request(entries, plan, *, job="JOB-0123456789ab", manifest_extra=None):
    """A frozen request shaped like queueGenaiIngest's: entries are (name, bytes, format, role)."""
    inputs = [{"index": i, "artifactId": f"EV-{i:012d}", "name": name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "role": role, "format": fmt}
              for i, (name, data, fmt, role) in enumerate(entries)]
    manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied",
                "inputs": [{"name": e["name"], "sha256": e["sha256"], "bytes": e["size"], "format": e["format"], "role": e["role"]} for e in inputs],
                "declaredBy": "auditor-fixture", "declaredAt": "2026-11-13T09:00:00.000Z", **(manifest_extra or {})}
    return {"schemaVersion": "genai-1.0", "executionMode": "genai_ingest", "engagementId": "ENG-0123456789ab", "jobId": job,
            "procedure": {"id": "PROC-1", "revision": 3, "planHash": "a" * 64, "briefRevision": 1, "programRevision": 1},
            "inputs": inputs, "manifest": manifest, "plan": plan, "inputHashes": {str(e["index"]): e["sha256"] for e in inputs},
            "records": {"bundle": "REC-bundle", "plan": "REC-plan"},
            "limitations": ["The engine recomputed the statistics from the pinned tool logs; it ran no harness and executed nothing the logs name."]}


def promptfoo_entries():
    spec, data = gs.input_spec(PROMPTFOO, "promptfoo_results")
    return [(spec["name"], data, "promptfoo_results", "log")]


def promptfoo_plan():
    _, _, plan = gs.bundle(PROMPTFOO)
    return plan


class GenaiRunner:
    """Loopback /api/runner for GenAI jobs: claim filtering, evidence by index, heartbeat and completion checks."""

    def __init__(self, requests, *, capabilities=("provided_predictions", "genai_ingest"), tamper_index=None):
        self.queue = [claim_body(r, job=r["jobId"], attempt="ATTEMPT-" + r["jobId"][-12:]) for r in requests]
        self.data = {}
        self.jobs, self.posts, self.gets, self.errors = {}, [], [], []
        self.capabilities, self.tamper_index = set(capabilities), tamper_index
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def respond(self, value, status=200, content_type="application/json"):
                raw = value if isinstance(value, bytes) else json_bytes(value)
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def reject(self, status, message):
                fixture.errors.append((status, message))
                self.respond({"error": message}, status)

            def authorized(self):
                return self.headers.get("Authorization") == "Bearer " + TOKEN

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if not self.authorized():
                    return self.reject(401, "Runner authentication required")
                if not hmac.compare_digest(self.headers.get("X-Result-Signature") or "", result_signature(TOKEN, raw)):
                    return self.reject(401, "Result signature verification failed")
                body = json.loads(raw)
                fixture.posts.append(body)
                op = body.get("op")
                if op == "claim":
                    if body.get("imageDigest") != IMAGE:
                        return self.reject(403, "Worker identity or enrolled image digest mismatch")
                    formats = [f for f in body.get("formats", []) if f in fixture.capabilities]
                    for index, queued in enumerate(fixture.queue):
                        mode = "genai_ingest" if json.loads(queued["requestJSON"]).get("executionMode") == "genai_ingest" else "provided_predictions"
                        if mode in formats:
                            claim = fixture.queue.pop(index)
                            fixture.jobs[claim["jobId"]] = {"claim": claim, "state": "running", "lease": datetime.now(timezone.utc) + timedelta(seconds=120)}
                            return self.respond(claim)
                    return self.respond({"idle": True})
                job = fixture.jobs.get(body.get("jobId"))
                if job is None or any(job["claim"][k] != body.get(k) for k in PIN_KEYS) or job["state"] != "running":
                    return self.reject(409, "Attempt identity or frozen request mismatch")
                if op == "heartbeat":
                    job["lease"] = datetime.now(timezone.utc) + timedelta(seconds=120)
                    return self.respond({"leaseUntil": job["lease"].isoformat(timespec="milliseconds").replace("+00:00", "Z")})
                if op == "fail":
                    job.update(state="failed", error=body.get("error"))
                    return self.respond({"accepted": True})
                if op == "complete":
                    problem = fixture.result_problem(job, body)
                    if problem:
                        return self.reject(400, problem)
                    job.update(state="succeeded", result=body["resultJSON"])
                    return self.respond({"accepted": True})
                return self.reject(400, "Unknown runner operation")

            def do_GET(self):
                if not self.authorized():
                    return self.reject(401, "Runner authentication required")
                query = {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()}
                fixture.gets.append(query)
                job = fixture.jobs.get(query.get("jobId"))
                if job is None or job["claim"]["attemptId"] != query.get("attemptId") or str(job["claim"]["fence"]) != query.get("fence"):
                    return self.reject(404, "Attempt input not found")
                request = json.loads(job["claim"]["requestJSON"])
                if query.get("input") != "evidence" or request.get("executionMode") != "genai_ingest":
                    return self.reject(403, "These input bytes are not authorized for this request")
                pin = next((i for i in request["inputs"] if str(i["index"]) == query.get("index")), None)
                if pin is None:
                    return self.reject(404, "Attempt input not found")
                data = fixture.data[pin["sha256"]]
                if fixture.tamper_index is not None and pin["index"] == fixture.tamper_index:
                    data = data[:-1] + bytes([data[-1] ^ 1])
                return self.respond(data, content_type="application/octet-stream")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @staticmethod
    def result_problem(job, body):
        """assertGenaiResult and readGenaiEnvelope (site-app/lib/genai/envelope.ts), check by check."""
        if sha256(body["resultJSON"].encode("utf-8")) != body.get("resultSha256"):
            return "Result bytes hash mismatch"
        envelope = json.loads(body["resultJSON"])
        if envelope.get("schemaVersion") != "genai-result/0.1" or set(envelope) != {"schemaVersion", "computationJSON", "computationSha256", "itemsJSONL", "itemsSha256", "provenance"}:
            return "The file is not a genai-result/0.1 envelope"
        if sha256(envelope["computationJSON"].encode("utf-8")) != envelope["computationSha256"]:
            return "computationSha256 does not match computationJSON"
        if envelope["itemsJSONL"] is not None and sha256(envelope["itemsJSONL"].encode("utf-8")) != envelope["itemsSha256"]:
            return "itemsSha256 does not match itemsJSONL"
        frozen, pins = json.loads(job["claim"]["requestJSON"]), envelope["provenance"]
        if pins["channel"] != "runner" or pins["requestSha256"] != job["claim"]["requestSha256"] or pins["inputHashes"] != frozen["inputHashes"] or pins["imageDigest"] != IMAGE:
            return "Consumed input or runtime pins mismatch"
        inputs = sorted(i["sha256"] for i in json.loads(envelope["computationJSON"])["inputs"])
        if inputs != sorted(frozen["inputHashes"].values()):
            return "The provenance input hashes differ from the computation inputs"
        return None

    def add(self, entries):
        for _, data, _, _ in entries:
            self.data[hashlib.sha256(data).hexdigest()] = data

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def transport(self):
        return Transport(self.origin, TOKEN, timeout=5, retries=1, allow_local_http=True)


class Ready(ProcessExecutor):
    """ProcessExecutor whose readiness says what the test needs about the GenAI runtime."""

    def __init__(self, present):
        self.present = present

    def readiness(self):
        return {"genaiIngest": {"runtimePresent": self.present}}


@unittest.skipUnless(gs.has_zstd(), "GenAI ingest is claimed only with a zstd back-end")
class GenaiWorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def worker(self, transport, executor=None, workspace="jobs", **kwargs):
        return Worker(transport, executor or ProcessExecutor(), self.root / workspace, worker_id=WORKER_ID, image_digest=IMAGE, heartbeat=1, compute_timeout=120, **kwargs)

    def run_jobs(self, jobs, polls=None, **server):
        """Serve (entries, request) jobs and poll the worker; (server, outcomes)."""
        with GenaiRunner([r for _, r in jobs], **server) as runner:
            for entries, _ in jobs:
                runner.add(entries)
            worker = self.worker(runner.transport())
            outcomes = [worker.once() for _ in range(polls or len(jobs))]
        return runner, outcomes

    def test_readiness_and_claim_advertisement(self):
        readiness = runtime_readiness()["genaiIngest"]
        self.assertTrue(readiness["runtimePresent"])
        self.assertIn(readiness["zstdBackend"], ("stdlib", "zstandard"))
        self.assertEqual(genai_readiness()["signatureVerification"], has_cryptography())
        self.assertIn("genai_ingest", self.worker(None).wire_formats)
        self.assertNotIn("genai_ingest", self.worker(None, genai_ingest=False, workspace="off").wire_formats)
        # Without a zstd back-end every .eval job would end in zstd_unavailable: the worker does not claim GenAI work.
        self.assertNotIn("genai_ingest", self.worker(None, Ready(False), workspace="no-zstd").wire_formats)
        self.assertLessEqual(len(self.worker(None, workspace="count").wire_formats), 10)

    def test_queue_to_completion_matches_the_cli_computation(self):
        entries, plan = promptfoo_entries(), promptfoo_plan()
        request = genai_request(entries, plan)
        runner, (outcome,) = self.run_jobs([(entries, request)])
        self.assertEqual(outcome["state"], "completed", outcome)
        self.assertEqual(runner.errors, [])
        self.assertIn("genai_ingest", next(p for p in runner.posts if p["op"] == "claim")["formats"])
        self.assertEqual([(g["input"], g["index"]) for g in runner.gets], [("evidence", "0")])
        job = runner.jobs[request["jobId"]]
        self.assertEqual(job["state"], "succeeded")
        envelope = json.loads(job["result"])
        _, result_schema, computation_schema, _ = gs.schema_validators()
        result_schema.validate(envelope)
        self.assertEqual(envelope["provenance"]["workerVersion"], WORKER_VERSION)
        self.assertEqual(envelope["provenance"]["channel"], "runner")
        # The worker channel and the CLI channel give the same computation and items for the same inputs (design 10.3).
        cli = run_bundle({e["sha256"]: entries[0][1] for e in request["inputs"]}, request["manifest"], request["plan"])
        self.assertEqual((envelope["computationSha256"], envelope["itemsSha256"]), (cli["computationSha256"], cli["itemsSha256"]))
        inputs = Path(outcome["resultFile"]).parent.parent / "inputs"
        self.assertEqual(sorted(p.name for p in inputs.iterdir()), ["envelope.json", "genai-0.bin"])
        self.assertEqual(Path(outcome["resultFile"]).read_text(encoding="utf-8"), job["result"])

    @unittest.skipUnless(has_cryptography(), "cryptography is not installed")
    def test_marking_bundle_with_signed_results_and_c2pa_reports(self):
        entries = [("signed_detections.jsonl", (gs.FIXTURES / "marking" / "signed_detections.jsonl").read_bytes(), "signed_detection_jsonl", "marking"),
                   ("c2pa_reports.jsonl", (gs.FIXTURES / "marking" / "c2pa_reports.jsonl").read_bytes(), "c2pa_validator_report", "marking")]
        plan = {"schemaVersion": "genai-plan/0.1", "detectionKeys": [KEY], "criteria": [
            {"id": "detection", "kind": "genai_marking", "metric": "detection_rate", "band": {"lower": 0.7}},
            {"id": "presence", "kind": "genai_marking", "metric": "marking_presence", "requireTrustedSigner": True, "band": {"lower": 0.5}}]}
        request = genai_request(entries, plan)
        runner, (outcome,) = self.run_jobs([(entries, request)])
        self.assertEqual(outcome["state"], "completed", outcome)
        computation = json.loads(json.loads(runner.jobs[request["jobId"]]["result"])["computationJSON"])
        self.assertEqual([b["format"] for b in computation["marking"]], ["signed_detection_jsonl", "c2pa_validator_report"])
        self.assertTrue(all(r["signedResult"]["verifiedByEngine"] for r in computation["marking"][0]["records"]))
        self.assertEqual([g["index"] for g in runner.gets], ["0", "1"])

    def test_bad_bundles_fail_with_their_codes_and_the_daemon_continues(self):
        good_entries, plan = promptfoo_entries(), promptfoo_plan()
        deep = [("deep.jsonl", (b'{"schemaVersion":"genai-marking-check/0.1","x":' + b"[" * 200 + b"]" * 200 + b"}\n") * 2, "marking_check_jsonl", "marking")]
        bomb = [("bomb.json", b'{"a":1e999}', "promptfoo_results", "log")]
        jobs = [(deep, genai_request(deep, plan, job="JOB-000000000001")), (bomb, genai_request(bomb, plan, job="JOB-000000000002")),
                (good_entries, genai_request(good_entries, plan, job="JOB-000000000003"))]
        runner, outcomes = self.run_jobs(jobs)
        self.assertEqual([o["state"] for o in outcomes], ["failed", "failed", "completed"])
        self.assertEqual([o.get("error") for o in outcomes[:2]], ["nesting_too_deep", "number_out_of_range"])
        self.assertEqual([runner.jobs[j]["state"] for j in ("JOB-000000000001", "JOB-000000000002", "JOB-000000000003")], ["failed", "failed", "succeeded"])
        self.assertEqual([p["error"] for p in runner.posts if p["op"] == "fail"], ["nesting_too_deep", "number_out_of_range"])

    def test_changed_evidence_bytes_never_reach_compute(self):
        entries = promptfoo_entries()
        runner, (outcome,) = self.run_jobs([(entries, genai_request(entries, promptfoo_plan()))], tamper_index=0)
        self.assertEqual((outcome["state"], outcome["error"]), ("failed", "evidence_input_pin_mismatch"))
        self.assertEqual(list((self.root / "jobs").glob("job-*/inputs/genai-0.bin*")), [])
        self.assertFalse(list((self.root / "jobs").glob("job-*/outputs/result.json")))

    def test_request_contract_is_checked_before_any_download(self):
        entries, plan = promptfoo_entries(), promptfoo_plan()
        cases = []
        mismatch = genai_request(entries, plan, job="JOB-000000000011")
        mismatch["manifest"]["inputs"][0]["name"] = "other.json"
        cases.append((mismatch, "request_contract_rejected"))
        too_big = genai_request(entries, plan, job="JOB-000000000012")
        too_big["inputs"][0]["size"] = 51 * 1024 * 1024
        cases.append((too_big, "request_contract_rejected"))
        bad_plan = genai_request(entries, dict(plan, minimums={"sampleSize": 5}), job="JOB-000000000013")
        cases.append((bad_plan, "plan_invalid"))
        bad_manifest = genai_request(entries, plan, job="JOB-000000000014", manifest_extra={"origin": "vendor"})
        cases.append((bad_manifest, "manifest_invalid"))
        extra = genai_request(entries, plan, job="JOB-000000000015")
        extra["model"] = {"id": "x"}
        cases.append((extra, "request_contract_rejected"))
        runner, outcomes = self.run_jobs([(entries, r) for r, _ in cases])
        self.assertEqual([o.get("error") for o in outcomes], [c for _, c in cases])
        self.assertEqual(runner.gets, [])

    def test_a_worker_that_does_not_claim_genai_refuses_a_genai_claim(self):
        entries = promptfoo_entries()
        request = genai_request(entries, promptfoo_plan())
        with GenaiRunner([request]) as runner:
            runner.add(entries)
            worker = self.worker(runner.transport(), genai_ingest=False)
            self.assertEqual(worker.once(), {"state": "idle"})  # the platform does not serve it
            claim = Claim.parse(claim_body(request, job=request["jobId"]))
            runner.jobs[claim.job_id] = {"claim": claim.transport_dict(), "state": "running", "lease": datetime.now(timezone.utc) + timedelta(seconds=120)}
            outcome = worker.run_claim(claim, __import__("time").monotonic() + 60)
        self.assertEqual(outcome["error"], "request_contract_rejected")
        self.assertEqual(runner.gets, [])


class GenaiContractTest(unittest.TestCase):
    def test_failure_codes_cover_every_genai_error(self):
        self.assertLessEqual(ERROR_CODES, COMPUTE_FAILURE_CODES)
        self.assertIn("evidence_input_pin_mismatch", FAILURE_CODES - COMPUTE_FAILURE_CODES)

    def test_validate_request_dispatches_on_the_schema_version(self):
        entries = promptfoo_entries()
        request = genai_request(entries, promptfoo_plan())
        validate_request(request)
        for change in ({"executionMode": "provided_predictions"}, {"inputHashes": {}}, {"inputs": []}, {"engagementId": "bad id"}):
            with self.subTest(change=sorted(change)), self.assertRaises(ValueError):
                validate_request(dict(request, **change))
        many = copy.deepcopy(request)
        many["inputs"] = [dict(many["inputs"][0], index=i) for i in range(65)]
        with self.assertRaises(ValueError):
            validate_request(many)

    def result(self):
        entries = promptfoo_entries()
        request = genai_request(entries, promptfoo_plan())
        claim = Claim.parse(claim_body(request, job=request["jobId"]))
        envelope = run_bundle({request["inputs"][0]["sha256"]: entries[0][1]}, request["manifest"], request["plan"],
                              provenance={"channel": "runner", "requestSha256": claim.request_sha256, "workerVersion": WORKER_VERSION, "imageDigest": IMAGE})
        return claim, envelope

    def test_verify_genai_result_bytes_rejects_tampering(self):
        claim, envelope = self.result()
        verify_genai_result_bytes(envelope_json(envelope).encode(), claim, IMAGE)
        computation = json.loads(envelope["computationJSON"])
        other_plan = copy.deepcopy(computation)
        other_plan["plan"]["planSha256"] = "0" * 64
        rehashed = json.dumps(other_plan)
        tampered = [
            dict(envelope, computationJSON=envelope["computationJSON"].replace('"runs"', '"runs" ', 1)),
            dict(envelope, itemsJSONL=(envelope["itemsJSONL"] or "") + "{}\n"),
            dict(envelope, provenance=dict(envelope["provenance"], requestSha256="0" * 64)),
            dict(envelope, provenance=dict(envelope["provenance"], workerVersion="0.0.0")),
            dict(envelope, provenance=dict(envelope["provenance"], channel="cli")),
            dict(envelope, provenance=dict(envelope["provenance"], inputHashes={"0": "0" * 64})),
            dict(envelope, computationJSON=rehashed, computationSha256=sha256(rehashed.encode())),
            dict(envelope, extra=1),
        ]
        for i, bad in enumerate(tampered):
            with self.subTest(case=i), self.assertRaises(ValueError):
                verify_genai_result_bytes(envelope_json(bad).encode(), claim, IMAGE)
        with self.assertRaises(ValueError):
            verify_genai_result_bytes(envelope_json(envelope).encode(), claim, "sha256:" + "b" * 64)


class ComputeGenaiTest(unittest.TestCase):
    """The compute child's GenAI branch, run in this process with network and subprocesses forbidden."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.inputs, self.outputs = self.root / "inputs", self.root / "outputs"
        self.inputs.mkdir()
        self.outputs.mkdir()
        self.marker = self.root / "marker.txt"
        (self.root / f"{MARKER_MODULE}.py").write_text(f"open({str(self.marker)!r}, 'w').write('imported')\n", encoding="utf-8")
        sys.path.insert(0, str(self.root))

    def tearDown(self):
        sys.path.remove(str(self.root))
        sys.modules.pop(MARKER_MODULE, None)
        self.temp.cleanup()

    def stage(self, entries, plan, corrupt=False):
        request = genai_request(entries, plan)
        claim = Claim.parse(claim_body(request, job=request["jobId"]))
        for entry, (_, data, _, _) in zip(request["inputs"], entries):
            (self.inputs / f"genai-{entry['index']}.bin").write_bytes(data[:-1] + b" " if corrupt else data)
        envelope = {"claim": claim.transport_dict(), "imageDigest": IMAGE, "execution": {}}
        (self.inputs / "envelope.json").write_bytes(json_bytes(envelope))
        return envelope, claim

    def test_logs_naming_code_run_nothing_in_compute(self):
        doc = json.loads((gs.FIXTURES / "inspect" / "canary_injection.json").read_text(encoding="utf-8"))
        doc["eval"]["task_file"] = str(self.root / f"{MARKER_MODULE}.py")
        doc["eval"]["scorers"][0]["options"] = {"module": MARKER_MODULE, "trust_log": True}
        entries = [("evil.json", json.dumps(doc).encode(), "inspect_json", "log")]
        envelope, claim = self.stage(entries, {"schemaVersion": "genai-plan/0.1", "criteria": []})
        before = set(sys.modules)
        with mock.patch.object(socket, "socket", side_effect=AssertionError("network used")), \
             mock.patch.object(subprocess, "Popen", side_effect=AssertionError("subprocess used")):
            result = compute_genai_job(self.inputs, self.outputs, envelope, claim)
        self.assertFalse(self.marker.exists())
        self.assertNotIn(MARKER_MODULE, set(sys.modules) - before)
        self.assertEqual((self.outputs / "result.json").read_text(encoding="utf-8"), envelope_json(result))
        verify_genai_result_bytes((self.outputs / "result.json").read_bytes(), claim, IMAGE)

    def test_bytes_that_changed_after_download_are_input_hash_mismatch(self):
        envelope, claim = self.stage(promptfoo_entries(), promptfoo_plan(), corrupt=True)
        with self.assertRaises(EngineError) as caught:
            compute_genai_job(self.inputs, self.outputs, envelope, claim)
        self.assertEqual(caught.exception.code, "input_hash_mismatch")
        self.assertFalse((self.outputs / "result.json").exists())


if __name__ == "__main__":
    unittest.main()
