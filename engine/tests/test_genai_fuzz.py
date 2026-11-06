"""Seeded mutation fuzzer for every GenAI format, standard library only (design section 11.5).

Oracles: only GenaiInputError with an enumerated code escapes; any envelope validates against the
schema; the same input gives the same output; an input up to 1 MiB takes under 2 s. CI runs
GENAI_FUZZ_ITERATIONS (default 300) mutations per format with GENAI_FUZZ_SEED (default 31); a
nightly or local run can raise the count to 20,000.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
import tracemalloc
import unittest

from engine.genai import ingest
from engine.genai.errors import ERROR_CODES, GenaiInputError
from engine.genai.ingest import run_bundle
from engine.tests import genai_support as gs

ITERATIONS = int(os.environ.get("GENAI_FUZZ_ITERATIONS", "300"))
SEED = int(os.environ.get("GENAI_FUZZ_SEED", "31"))
PLAN = {"schemaVersion": "genai-plan/0.1", "criteria": [], "allowUnverifiedFormatVersion": True}


def mutate_bytes(rng, data):
    data = bytearray(data)
    choice = rng.randrange(6)
    if not data:
        return bytes(data)
    i = rng.randrange(len(data))
    if choice == 0:
        data[i] ^= 1 << rng.randrange(8)
    elif choice == 1:
        data[i:i] = bytes(rng.randrange(256) for _ in range(rng.randrange(1, 8)))
    elif choice == 2:
        del data[i:i + rng.randrange(1, 64)]
    elif choice == 3:
        del data[i:]
    elif choice == 4:
        j = min(len(data), i + rng.randrange(1, 256))
        data[j:j] = data[i:j]
    else:
        data[i:i] = rng.choice([b"NaN", b"1e999", b"\\ud800", b"\xef\xbb\xbf", b"\r\n", b"\n\n", b"[" * 100, b"\xff\xfe", b'"', b"{", b"}", b"null"])
    return bytes(data)


def _walk(value, rng, depth=0):
    """Pick a random container and key/index inside a decoded JSON value."""
    node = value
    path = []
    for _ in range(rng.randrange(1, 8)):
        if isinstance(node, dict) and node:
            key = rng.choice(list(node))
            path.append((node, key))
            node = node[key]
        elif isinstance(node, list) and node:
            key = rng.randrange(len(node))
            path.append((node, key))
            node = node[key]
        else:
            break
    return path


def mutate_json(rng, value):
    path = _walk(value, rng)
    if not path:
        return value
    parent, key = path[-1]
    choice = rng.randrange(8)
    replacements = [None, True, -1, 10 ** 30, "", "x" * 300, [], {}, "C", 0.5, "h-0123456789abcdef", "a:b|c", "‮", "sk-" + "a" * 30]
    if choice == 0 and isinstance(parent, dict):
        del parent[key]
    elif choice == 1:
        parent[key] = rng.choice(replacements)
    elif choice == 2 and isinstance(parent, list):
        parent.append(parent[key])
    elif choice == 3:
        nested = rng.choice(replacements)
        for _ in range(rng.randrange(1, 70)):
            nested = [nested]
        parent[key] = nested
    elif choice == 4 and isinstance(parent, dict):
        parent["x" * rng.randrange(1, 130)] = parent[key]
    elif choice == 5 and isinstance(parent[key], str):
        parent[key] = parent[key] * rng.randrange(2, 5)
    elif choice == 6 and isinstance(parent[key], (int, float)) and not isinstance(parent[key], bool):
        parent[key] = -parent[key] if rng.random() < 0.5 else parent[key] * 1000
    else:
        parent[key] = str(parent[key])[:50]
    return value


def mutate_jsonl(rng, data):
    lines = data.split(b"\n")
    choice = rng.randrange(5)
    i = rng.randrange(len(lines))
    if choice == 0:
        lines.insert(i, b"")
    elif choice == 1:
        lines.insert(i, b"[1, 2]")
    elif choice == 2 and len(lines) > 2:
        rng.shuffle(lines)
    elif choice == 3:
        lines.insert(i, lines[i])
    else:
        try:
            row = json.loads(lines[i])
            lines[i] = json.dumps(mutate_json(rng, {"row": row}).get("row")).encode()
        except ValueError:
            pass
    return b"\n".join(lines)


def run(entries):
    manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied", "inputs": [
        {"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": fmt, "role": role} for name, data, fmt, role in entries]}
    inputs = {}
    for _, data, _, _ in entries:
        inputs[hashlib.sha256(data).hexdigest()] = data
    return run_bundle(inputs, manifest, PLAN)


def base_entries(name):
    out = []
    for path, fmt in gs.BUNDLES[name]:
        spec, data = gs.input_spec(path, fmt)
        out.append((spec["name"], data, fmt, spec["role"]))
    return out


class FuzzTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = gs.schema_validators()[1]
        ingest.STRICT = True  # a parser crash must surface here, not as the production fallback code

    @classmethod
    def tearDownClass(cls):
        ingest.STRICT = False

    def oracle(self, entries):
        started = time.process_time()
        try:
            env = run(entries)
        except GenaiInputError as exc:
            self.assertIn(exc.code, ERROR_CODES)
            return None
        except Exception as exc:  # noqa: BLE001 - the oracle reports any other escape
            self.fail(f"{type(exc).__name__} escaped: {exc!r} for {[e[0] for e in entries]}")
        if sum(len(e[1]) for e in entries) <= 1 << 20:
            self.assertLess(time.process_time() - started, 2.0)
        return env

    def fuzz(self, name):
        rng = random.Random(f"{SEED}:{name}")
        entries = base_entries(name)
        validated = 0
        for iteration in range(ITERATIONS):
            target = rng.randrange(len(entries))
            fname, data, fmt, role = entries[target]
            kind = rng.randrange(3)
            if kind == 0 or fmt == "inspect_eval":
                mutated = mutate_bytes(rng, data)
            elif data.lstrip()[:1] == b"{" and fmt in ("inspect_json", "promptfoo_results", "deepeval_test_run") or (fmt == "lm_eval_samples" and role == "results"):
                mutated = json.dumps(mutate_json(rng, {"doc": json.loads(data)}).get("doc")).encode()
            else:
                mutated = mutate_jsonl(rng, data)
            changed = list(entries)
            changed[target] = (fname, mutated, fmt, role)
            env = self.oracle(changed)
            if env is not None and validated < 5:
                self.validator.validate(env)
                again = run(changed)
                self.assertEqual(env["computationJSON"], again["computationJSON"])
                validated += 1

    def test_fuzz_every_format(self):
        for name in gs.BUNDLES:
            if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            with self.subTest(bundle=name):
                self.fuzz(name)

    def test_format_confusion(self):
        """Every declared format on every other format's fixture fails with a coded error."""
        formats = sorted({fmt for files in gs.BUNDLES.values() for _, fmt in files})
        for name in gs.BUNDLES:
            if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            entries = base_entries(name)
            for fmt in formats:
                if fmt == entries[0][2]:
                    continue
                confused = [(n, d, fmt, r) for n, d, _, r in entries]
                with self.assertRaises(GenaiInputError):
                    run(confused)

    def test_memory_bound_for_small_inputs(self):
        tracemalloc.start()
        try:
            for name in ("promptfoo/redteam_shaped.results.json", "garak/tiny.report.jsonl", "lm_eval/*"):
                run(base_entries(name))
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 64 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
