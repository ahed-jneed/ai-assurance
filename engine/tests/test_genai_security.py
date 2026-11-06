"""Hostile inputs: logs that name code run nothing, zip and JSON limits hold, secrets are redacted (design section 11)."""
from __future__ import annotations

import hashlib
import io
import json
import socket
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path
from unittest import mock

from engine.genai import hashing, limits, readers
from engine.genai.errors import GenaiInputError
from engine.genai.ingest import detect, run_bundle
from engine.tests import genai_support as gs

TOOL_PACKAGES = ("inspect_ai", "lm_eval", "garak", "promptfoo", "pyrit", "deepeval", "ragas")
MARKER_MODULE = "genai_marker_module_31"


def manifest_for(entries):
    return {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied", "inputs": [
        {"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": fmt, "role": role} for name, data, fmt, role in entries]}


def ingest(entries, plan=None):
    manifest = manifest_for(entries)
    inputs = {hashlib.sha256(data).hexdigest(): data for _, data, _, _ in entries}
    return run_bundle(inputs, manifest, plan or {"schemaVersion": "genai-plan/0.1", "criteria": []})


def code(callable_, *args):
    try:
        callable_(*args)
    except GenaiInputError as exc:
        return exc.code
    return None


class NamesCodeRunsNothingTest(unittest.TestCase):
    """Design section 11.5: logs that name a module, a !function hook and JavaScript assertions are parsed as data."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.marker = self.dir / "marker.txt"
        (self.dir / f"{MARKER_MODULE}.py").write_text(f"open({str(self.marker)!r}, 'w').write('imported')\n", encoding="utf-8")
        sys.path.insert(0, str(self.dir))

    def tearDown(self):
        sys.path.remove(str(self.dir))
        sys.modules.pop(MARKER_MODULE, None)
        self.tmp.cleanup()

    def guarded(self, fn):
        before = set(sys.modules)
        with mock.patch.object(socket, "socket", side_effect=AssertionError("network used")), \
             mock.patch.object(subprocess, "Popen", side_effect=AssertionError("subprocess used")), \
             mock.patch("os.system", side_effect=AssertionError("os.system used")):
            result = fn()
        self.assertFalse(self.marker.exists(), "an ingested name was imported")
        self.assertNotIn(MARKER_MODULE, sys.modules)
        loaded = set(sys.modules) - before
        self.assertFalse([m for m in loaded if m.split(".")[0] in TOOL_PACKAGES], loaded)
        return result

    def test_inspect_log_naming_a_module(self):
        doc = json.loads((gs.FIXTURES / "inspect" / "canary_injection.json").read_text(encoding="utf-8"))
        doc["eval"]["task_file"] = str(self.dir / f"{MARKER_MODULE}.py")
        doc["eval"]["task_registry_name"] = f"{MARKER_MODULE}/canary"
        doc["eval"]["scorers"][0]["metrics"][0]["name"] = f"{MARKER_MODULE}/accuracy"
        doc["eval"]["scorers"][0]["options"] = {"module": MARKER_MODULE, "trust_log": True}
        for sample in doc["samples"]:
            sample["scores"] = {f"{MARKER_MODULE}.scorer": next(iter(sample["scores"].values()))}
        data = json.dumps(doc).encode()
        env = self.guarded(lambda: ingest([("evil.json", data, "inspect_json", "log")], {"schemaVersion": "genai-plan/0.1", "criteria": [], "primaryScore": f"{MARKER_MODULE}.scorer"}))
        comp = gs.computation(env)
        self.assertEqual(comp["runs"][0]["items"]["count"], 4)
        self.assertEqual(comp["runs"][0]["scoreKinds"], {f"{MARKER_MODULE}.scorer": ["unknown"]})

    def test_lm_eval_function_hook_is_a_string(self):
        results = json.loads((gs.FIXTURES / "lm_eval" / "results_2026-11-05T16-54-06.848117.json").read_text(encoding="utf-8"))
        results["configs"]["tiny_mc"]["process_results"] = f"def process_results(doc, results):\n    import {MARKER_MODULE}\n"
        results["configs"]["tiny_mc"]["metric_list"][0]["metric"] = f"!function {MARKER_MODULE}.metric"
        data = json.dumps(results).encode()
        entries = [("results_2026-11-05T16-54-06.848117.json", data, "lm_eval_samples", "results")]
        for task in ("tiny_mc", "tiny_gen"):
            path = gs.FIXTURES / "lm_eval" / f"samples_{task}_2026-11-05T16-54-06.848117.jsonl"
            entries.append((path.name, path.read_bytes(), "lm_eval_samples", "samples"))
        comp = gs.computation(self.guarded(lambda: ingest(entries)))
        mc = next(r for r in comp["runs"] if r["runKey"].endswith("tiny_mc"))
        self.assertEqual(mc["scoreKinds"]["acc,none"], ["unknown"])
        self.assertEqual(mc["scoreKinds"]["acc_norm,none"], ["unknown"])

    def test_promptfoo_javascript_and_file_provider(self):
        for name in ("echo_repeat.results.json", "redteam_shaped.results.json"):
            data = (gs.FIXTURES / "promptfoo" / name).read_bytes()
            comp = gs.computation(self.guarded(lambda: ingest([(name, data, "promptfoo_results", "log")])))
            self.assertGreater(comp["runs"][0]["items"]["count"], 0)

    def test_no_tool_package_after_every_fixture(self):
        for bundle in gs.BUNDLES:
            if bundle in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            self.guarded(lambda: run_bundle(*gs.bundle(bundle)))


class SecretTest(unittest.TestCase):
    def test_secret_patterns_redact_and_hash(self):
        secrets = ["sk-" + "a" * 20, "AKIA" + "A" * 16, "ghp_" + "b" * 36, "xoxb-" + "1" * 12, "AIza" + "c" * 35,
                   "-----BEGIN RSA PRIVATE KEY-----", "https://api.example/v1?key=abc", "https://user:pass@host.example/x"]
        for secret in secrets:
            with self.subTest(secret=secret[:12]):
                self.assertTrue(hashing.is_secret_like(secret))
                self.assertTrue(hashing.redact(secret).startswith("[redacted:"))
                self.assertTrue(hashing.c(secret).startswith("h-"))
        self.assertFalse(hashing.is_secret_like("openai:gpt-4o"))

    def test_provider_key_in_promptfoo_is_redacted(self):
        doc = json.loads((gs.FIXTURES / "promptfoo" / "echo_repeat.results.json").read_text(encoding="utf-8"))
        secret = "https://user:hunter2@llm.example/v1"
        for row in doc["results"]["results"]:
            row["provider"]["id"] = secret
        doc["config"]["env"] = {"OPENAI_API_KEY": "sk-" + "z" * 40}
        data = json.dumps(doc).encode()
        env = ingest([("pf.json", data, "promptfoo_results", "log")])
        text = env["computationJSON"] + (env["itemsJSONL"] or "")
        self.assertNotIn("hunter2", text)
        self.assertNotIn("sk-zzzz", text)
        self.assertIn("secret_like_value_redacted", {w["code"] for w in gs.computation(env)["warnings"]})


class JsonLimitsTest(unittest.TestCase):
    def test_reader_rejections(self):
        cases = {
            b"\xef\xbb\xbf{}": "invalid_utf8",
            b"{\"a\": \xff}": "invalid_utf8",
            b'{"a": 1, "a": 2}': "duplicate_key",
            b'{"a": 1e999}': "number_out_of_range",
            b"[" * 10000 + b"]" * 10000: "nesting_too_deep",
            b'{"a": ' + b"1" * 5000 + b"}": "invalid_json",
            b"{} trailing": "invalid_json",
            b"[" * 70 + b"]" * 70: "nesting_too_deep",
        }
        for data, expected in cases.items():
            with self.subTest(data=data[:20]):
                self.assertEqual(code(readers.load_json, data), expected)

    def test_non_finite_tokens_are_markers(self):
        value = readers.load_json(b'{"a": NaN, "b": [Infinity, -Infinity]}')
        self.assertIsInstance(value["a"], readers.NonFinite)
        self.assertEqual([v.token for v in value["b"]], ["Infinity", "-Infinity"])

    def test_lone_surrogate_is_hashed_and_cleaned(self):
        value = readers.load_json(b'{"a": "x\\ud800y"}')
        self.assertTrue(hashing.has_lone_surrogate(value["a"]))
        self.assertEqual(hashing.sha256_text(value["a"]), hashlib.sha256("x\ud800y".encode("utf-8", "surrogatepass")).hexdigest())
        self.assertEqual(hashing.clean(value["a"]), "x\ufffdy")

    def test_jsonl_rules(self):
        stats = readers.JsonlStats()
        rows = readers.load_jsonl(b'{"a":1}\r\n\n{"b":2}\n', "f.jsonl", stats)
        self.assertEqual([n for n, _ in rows], [1, 3])
        self.assertEqual((stats.crlf, stats.blank), (1, 1))
        self.assertEqual(code(readers.load_jsonl, b'{"a":1}\n[1]\n', "f"), "invalid_json")
        with mock.patch.object(limits, "MAX_JSONL_LINE_BYTES", 10):
            self.assertEqual(code(readers.load_jsonl, b'{"a":"0123456789"}\n', "f"), "line_too_long")


def _zip(entries, method=zipfile.ZIP_DEFLATED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=method) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return bytearray(buffer.getvalue())


def _central_offset(data, name):
    index = data.find(b"PK\x01\x02")
    while index >= 0:
        name_len = struct.unpack("<H", data[index + 28:index + 30])[0]
        if data[index + 46:index + 46 + name_len] == name.encode():
            return index
        index = data.find(b"PK\x01\x02", index + 4)
    raise AssertionError(name)


class ZipLimitsTest(unittest.TestCase):
    def archive(self, data):
        return readers.ZipArchive(bytes(data))

    def read(self, data, name="header.json"):
        return self.archive(data).read(name)

    def test_reads_stored_and_deflated(self):
        for method in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            self.assertEqual(self.read(_zip([("header.json", b"{}")], method)), b"{}")

    def test_unsafe_names(self):
        # Every name has the 11 bytes of "header.json", so it replaces it in the local header and the central directory.
        for name in (b"../x.json__", b"/abs.json__", b"C:\\x.json__", b"a\\b.json___", b"a/../b.json", b"head\x00r.json"):
            with self.subTest(name=name):
                data = bytes(_zip([("header.json", b"{}")])).replace(b"header.json", name)
                self.assertEqual(code(self.archive, data), "zip_entry_unsafe_name")

    def test_crc_method_encryption_and_size(self):
        data = _zip([("header.json", b'{"version": 2}')], zipfile.ZIP_STORED)
        cd = _central_offset(data, "header.json")
        bad_crc = bytearray(data)
        bad_crc[cd + 16] ^= 0xFF
        self.assertEqual(code(self.read, bad_crc), "zip_crc_mismatch")
        method = bytearray(data)
        method[cd + 10:cd + 12] = struct.pack("<H", 99)
        self.assertEqual(code(self.read, method), "zip_method_unsupported")
        encrypted = bytearray(data)
        encrypted[cd + 8] |= 0x01
        self.assertEqual(code(self.read, encrypted), "zip_encrypted")
        size = bytearray(data)
        size[cd + 24:cd + 28] = struct.pack("<I", 5)
        self.assertEqual(code(self.read, size), "zip_entry_size_mismatch")
        local = bytearray(data)
        local[22:26] = struct.pack("<I", 9999)  # local-header sizes are ignored
        self.assertEqual(self.read(local), b'{"version": 2}')

    def test_duplicates_and_local_name_mismatch(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("header.json", b"{}")
            with self.assertWarns(UserWarning):
                archive.writestr("header.json", b"[]")
        self.assertEqual(code(self.archive, buffer.getvalue()), "zip_invalid")
        data = _zip([("header.json", b"{}")])
        data[30:41] = b"heaDer.json"
        self.assertEqual(code(self.read, data), "zip_invalid")

    def test_entry_and_ratio_limits(self):
        zeros = b"0" * (2 * limits.MiB)
        data = _zip([("header.json", zeros)])
        with mock.patch.object(limits, "MAX_ENTRY_BYTES", limits.MiB):
            self.assertEqual(code(self.read, data), "zip_entry_too_large")
        self.assertEqual(code(self.read, data), "zip_ratio_exceeded")

    @unittest.skipUnless(gs.has_zstd(), "no zstd back-end")
    def test_zstd_bomb(self):
        import zstandard
        bomb = zstandard.ZstdCompressor(level=19).compress(b"\x00" * (256 * limits.MiB))
        data = _zip([("header.json", b"{}")], zipfile.ZIP_STORED)
        cd = _central_offset(data, "header.json")
        # Replace the stored payload with the zstd bomb while the central directory declares 2 bytes.
        payload_start = 30 + 11
        patched = bytearray(data[:payload_start]) + bomb + data[payload_start + 2:]
        cd += len(bomb) - 2
        patched[cd + 10:cd + 12] = struct.pack("<H", 93)
        patched[cd + 20:cd + 24] = struct.pack("<I", len(bomb))
        eocd = patched.rfind(b"PK\x05\x06")
        patched[eocd + 16:eocd + 20] = struct.pack("<I", cd)
        self.assertEqual(code(self.read, patched), "zip_entry_size_mismatch")
        declared_huge = bytearray(patched)
        declared_huge[cd + 24:cd + 28] = struct.pack("<I", 1 << 30)
        self.assertEqual(code(self.read, declared_huge), "zip_entry_too_large")

    def test_zstd_unavailable(self):
        data = _zip([("header.json", b"{}")], zipfile.ZIP_STORED)
        cd = _central_offset(data, "header.json")
        data[cd + 10:cd + 12] = struct.pack("<H", 93)
        with mock.patch.object(readers, "zstd_backend", return_value=None):
            self.assertEqual(code(self.read, data), "zstd_unavailable")


class PipelineReaderCodesTest(unittest.TestCase):
    """Design section 11.2 rule 4: through run_bundle a rejected input keeps the reader's code; unknown_format is for well-formed input only."""

    def expect(self, data, fmt, expected, role="log"):
        self.assertEqual(code(ingest, [("input", bytes(data), fmt, role)]), expected)

    def test_zip_codes(self):
        unsafe = bytes(_zip([("header.json", b"{}")])).replace(b"header.json", b"../x.json__")
        self.expect(unsafe, "inspect_eval", "zip_entry_unsafe_name")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("header.json", b"{}")
            with self.assertWarns(UserWarning):
                archive.writestr("header.json", b"[]")
        self.expect(buffer.getvalue(), "inspect_eval", "zip_invalid")
        mismatch = _zip([("header.json", b'{"version": 2}')])
        mismatch[30:41] = b"heaDer.json"
        self.expect(mismatch, "inspect_eval", "zip_invalid")
        self.expect(_zip([("other.json", b"{}")]), "inspect_eval", "unknown_format")
        self.assertEqual(detect(unsafe), (None, None))  # CLI detection never raises

    def test_json_codes(self):
        cases = [
            (b'{"a": 1, "a": 2}', "inspect_json", "duplicate_key"),
            (b'{\n  "a": 1,\n  "a": 2\n}\n', "inspect_json", "duplicate_key"),
            (b'{"a": 1e999}', "promptfoo_results", "number_out_of_range"),
            (b'{"a": ' + b"[" * 70 + b"]" * 70 + b"}", "inspect_json", "nesting_too_deep"),
            (b'{"a": 1, "a": 2}\n{"b": 1}\n', "garak_report", "duplicate_key"),
            (b'{"x": 1}', "inspect_json", "unknown_format"),
            (b'{\n  "x": 1\n}\n', "inspect_json", "unknown_format"),
        ]
        for data, fmt, expected in cases:
            with self.subTest(data=data[:24]):
                self.expect(data, fmt, expected)
                self.assertEqual(detect(data), (None, None))


if __name__ == "__main__":
    unittest.main()
