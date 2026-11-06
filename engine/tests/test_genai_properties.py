"""Property tests for GenAI recomputation and keys (design section 11.5)."""
from __future__ import annotations

import hashlib
import json
import random
import unittest

from engine import statistics as core
from engine.genai import hashing, recompute
from engine.genai.families import heuristic_family, valid_family
from engine.genai.formats import judge_validation
from engine.genai.ingest import run_bundle
from engine.tests import genai_support as gs

RNG = random.Random(31)


def entries_bundle(entries, criteria=()):
    manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied", "inputs": [
        {"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "format": fmt, "role": role} for name, data, fmt, role in entries]}
    return run_bundle({hashlib.sha256(d).hexdigest(): d for _, d, _, _ in entries}, manifest, {"schemaVersion": "genai-plan/0.1", "criteria": list(criteria)})


def fixture(path, fmt, role="log"):
    return (path.split("/")[-1], (gs.FIXTURES / path).read_bytes(), fmt, role)


def shuffled_jsonl(data, keep_first=False, seed=1):
    lines = [line for line in data.split(b"\n") if line.strip()]
    head, rest = (lines[:1], lines[1:]) if keep_first else ([], lines)
    random.Random(seed).shuffle(rest)
    return b"\n".join(head + rest) + b"\n"


class StatisticsProperties(unittest.TestCase):
    def test_singleton_clusters_equal_iid(self):
        for _ in range(50):
            values = [RNG.random() for _ in range(RNG.randrange(2, 40))]
            clusters = [f"c{i}" for i in range(len(values))]
            self.assertAlmostEqual(recompute.se_clustered(values, clusters), recompute.se_iid(values), places=12)

    def test_degenerate_effective_n(self):
        for clusters_count in range(2, 12):
            size = RNG.randrange(1, 20)
            clusters = [f"c{i // size}" for i in range(clusters_count * size)]
            n_eff, _ = recompute.effective_n([1.0] * len(clusters), clusters)
            self.assertAlmostEqual(n_eff, clusters_count)
            n_eff, _ = recompute.effective_n([0.0] * len(clusters))
            self.assertEqual(n_eff, len(clusters))

    def test_wilson_contains_estimate(self):
        for _ in range(200):
            n = RNG.uniform(1, 500)
            p = RNG.random()
            lower, upper = core.wilson(p * n, n, core.zcrit(0.95))
            self.assertTrue(0.0 <= lower <= p + 1e-12 and p - 1e-12 <= upper <= 1.0, (p, n, lower, upper))

    def test_effective_n_never_exceeds_n(self):
        for _ in range(100):
            values = [float(RNG.random() < 0.7) for _ in range(RNG.randrange(3, 60))]
            clusters = [f"c{RNG.randrange(5)}" for _ in values]
            n_eff, _ = recompute.effective_n(values, clusters)
            self.assertLessEqual(n_eff, len(values) + 1e-9)
            self.assertGreater(n_eff, 0)

    def test_pass_at_one_equals_mean(self):
        from math import comb
        for _ in range(50):
            tasks = [(n, RNG.randrange(n + 1)) for n in (RNG.randrange(1, 9) for _ in range(RNG.randrange(1, 10)))]
            hat = sum(comb(c, 1) / comb(n, 1) for n, c in tasks) / len(tasks)
            at = sum(1 - comb(n - c, 1) / comb(n, 1) for n, c in tasks) / len(tasks)
            mean = sum(c / n for n, c in tasks) / len(tasks)
            self.assertAlmostEqual(hat, mean)
            self.assertAlmostEqual(at, mean)

    def test_kappa_symmetric(self):
        for _ in range(30):
            labels = [(RNG.choice("ab"), RNG.choice("ab")) for _ in range(RNG.randrange(10, 80))]
            swapped = [(j, h) for h, j in labels]
            a = judge_validation.kappa(labels, ["a", "b"])
            b = judge_validation.kappa(swapped, ["a", "b"])
            if a["kappa"] is None:
                self.assertIsNone(b["kappa"])
                continue
            self.assertAlmostEqual(a["kappa"], b["kappa"])
            self.assertAlmostEqual(a["se"], b["se"])

    def test_single_label_kappa_is_undefined(self):
        k = judge_validation.kappa([("a", "a")] * 60, ["a", "b"])
        self.assertIsNone(k["kappa"])
        self.assertIn("kappa_undefined", k["reasons"])


class KeyProperties(unittest.TestCase):
    def test_component_rule(self):
        for text in ("", " ", "a:b", "x" * 129, "h-0123456789abcdef", "openai:gpt-4o", "file://target.js", "sk-" + "a" * 30, "a|b", "\ud800"):
            component = hashing.c(text)
            self.assertTrue(hashing.COMPONENT.match(component), text)
            self.assertTrue(component.startswith("h-"), text)
        for text in ("q1", "test-0-vars-0", "lmrc.Anthropomorphisation", "a" * 128):
            self.assertEqual(hashing.c(text), text)

    def test_composed_keys_stay_bounded(self):
        components = ["a" * 128] * 4
        key = hashing.compose("promptfoo", *components)
        self.assertLessEqual(len(key), 250)
        self.assertTrue(key.startswith("promptfoo:h-"))
        self.assertTrue(hashing.KEY.match(hashing.item_key(key, hashing.compose(*components), 10000)))

    def test_item_keys_unique_and_valid_for_every_fixture(self):
        for name in gs.BUNDLES:
            if name in gs.ZSTD_BUNDLES and not gs.has_zstd():
                continue
            env = run_bundle(*gs.bundle(name))
            keys = [json.loads(line)["itemKey"] for line in env["itemsJSONL"].splitlines()]
            self.assertEqual(len(keys), len(set(keys)), name)
            for key in keys:
                self.assertTrue(hashing.KEY.match(key), key)
                run_key, group_key, _ = key.split("|")
                self.assertLessEqual(len(run_key), 250)
                self.assertLessEqual(len(group_key), 250)


class PermutationProperties(unittest.TestCase):
    def aggregates(self, env):
        comp = gs.computation(env)
        return [(c["id"], [(m["memberId"], m["estimate"], (m.get("counts") or {}).get("n")) for m in c["members"]]) for c in comp["criteria"]]

    def keys(self, env):
        return sorted(json.loads(line)["itemKey"] for line in env["itemsJSONL"].splitlines())

    def test_garak_lines_permuted(self):
        report = fixture("garak/tiny.report.jsonl", "garak_report")
        hitlog = fixture("garak/tiny.hitlog.jsonl", "garak_report", "hitlog")
        criteria = [{"id": "asr", "kind": "genai_attack_success", "band": {"upper": 0.1}}]
        base = entries_bundle([report, hitlog], criteria)
        permuted = (report[0], shuffled_jsonl(report[1], keep_first=True), report[2], report[3])
        other = entries_bundle([permuted, hitlog], criteria)
        self.assertEqual(self.aggregates(base), self.aggregates(other))
        self.assertEqual(self.keys(base), self.keys(other))

    def test_lm_eval_rows_permuted_and_duplicated_filters(self):
        results = fixture("lm_eval/results_2026-11-05T16-54-06.848117.json", "lm_eval_samples", "results")
        gen = fixture("lm_eval/samples_tiny_gen_2026-11-05T16-54-06.848117.jsonl", "lm_eval_samples", "samples")
        mc = fixture("lm_eval/samples_tiny_mc_2026-11-05T16-54-06.848117.jsonl", "lm_eval_samples", "samples")
        criteria = [{"id": "mc", "kind": "genai_mean", "metric": "accuracy", "select": {"task": "tiny_mc"}, "band": {"lower": 0.1}}]
        base = entries_bundle([results, gen, mc], criteria)
        mc_perm = (mc[0], shuffled_jsonl(mc[1]), mc[2], mc[3])
        other = entries_bundle([results, gen, mc_perm], criteria)
        self.assertEqual(self.aggregates(base), self.aggregates(other))
        self.assertEqual(self.keys(base), self.keys(other))
        # A second filter for every document leaves n unchanged and adds one score per row.
        rows = [json.loads(line) for line in mc[1].splitlines() if line.strip()]
        extra = [dict(row, filter="second") for row in rows]
        mc_two = (mc[0], b"".join(json.dumps(r).encode() + b"\n" for r in rows + extra), mc[2], mc[3])
        doubled = entries_bundle([results, gen, mc_two], criteria)
        comp = gs.computation(doubled)
        run = next(r for r in comp["runs"] if r["runKey"].endswith("tiny_mc"))
        self.assertEqual(run["items"]["count"], len(rows))
        item = json.loads(next(line for line in doubled["itemsJSONL"].splitlines() if "tiny_mc" in line))
        self.assertEqual(len(item["scores"]), 4)

    def test_ragas_and_pyrit_rows_permuted(self):
        ragas = fixture("ragas/results.jsonl", "ragas_results")
        declared = gs.bundle("ragas/results.jsonl")[1]["declared"]
        criteria = [{"id": "em", "kind": "genai_mean", "metric": "score_mean", "primaryScore": "exact_match", "band": {"lower": 0.1}}]
        for source, perm in ((ragas, (ragas[0], shuffled_jsonl(ragas[1]), ragas[2], ragas[3])),):
            envs = []
            for entry in (source, perm):
                manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied", "declared": declared, "inputs": [
                    {"name": entry[0], "sha256": hashlib.sha256(entry[1]).hexdigest(), "bytes": len(entry[1]), "format": entry[2], "role": entry[3], "runKey": "ragas:declared"}]}
                envs.append(run_bundle({hashlib.sha256(entry[1]).hexdigest(): entry[1]}, manifest, {"schemaVersion": "genai-plan/0.1", "criteria": criteria}))
            self.assertEqual(self.aggregates(envs[0]), self.aggregates(envs[1]))
        pyrit = fixture("pyrit/attacks.pyrit-export.jsonl", "pyrit_export")
        criteria = [{"id": "asr", "kind": "genai_attack_success", "groupBy": "technique_variant", "band": {"upper": 0.1}}]
        a = entries_bundle([pyrit], criteria)
        b = entries_bundle([(pyrit[0], shuffled_jsonl(pyrit[1]), pyrit[2], pyrit[3])], criteria)
        self.assertEqual(self.aggregates(a), self.aggregates(b))
        self.assertEqual(self.keys(a), self.keys(b))

    def test_second_garak_detector_leaves_n_unchanged(self):
        lines = []
        for line in (gs.FIXTURES / "garak" / "tiny.report.jsonl").read_bytes().splitlines():
            row = json.loads(line)
            if row.get("entry_type") == "attempt" and row.get("detector_results"):
                row["detector_results"]["extra.Detector"] = [0.0] * len(row["outputs"])
            lines.append(json.dumps(row).encode())
        data = b"\n".join(lines) + b"\n"
        criteria = [{"id": "asr", "kind": "genai_attack_success", "band": {"upper": 0.1}}]
        base = gs.computation(entries_bundle([fixture("garak/tiny.report.jsonl", "garak_report")], criteria))
        other = gs.computation(entries_bundle([("tiny.report.jsonl", data, "garak_report", "log")], criteria))
        self.assertEqual(base["runs"][0]["items"]["count"], other["runs"][0]["items"]["count"])
        self.assertEqual([m["counts"]["n"] for m in base["criteria"][0]["members"]], [m["counts"]["n"] for m in other["criteria"][0]["members"]])
        self.assertEqual(other["runs"][0]["scoreKinds"]["extra.Detector"], ["unknown"])


class FamilyProperties(unittest.TestCase):
    def test_heuristic_examples(self):
        cases = {
            "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0": "anthropic", "us.anthropic.claude-3-haiku": "anthropic",
            "together/meta-llama/Llama-3.3-70B-Instruct-Turbo": "meta", "openai/meta-llama/Llama-3.1-8B-Instruct": "meta",
            "ft:gpt-4o-mini:acme::abc": "openai", "deepseek-ai/DeepSeek-R1-Distill-Llama-70B": "deepseek",
            "mockllm/model": None, "Qwen2.5-7B": "alibaba", "phi3-mini": "microsoft", "openai/gpt-4o": "openai",
        }
        for model, family in cases.items():
            self.assertEqual(heuristic_family(model), family, model)

    def test_vocabulary(self):
        for value in ("openai", "other-acme", None):
            self.assertTrue(valid_family(value))
        for value in ("meta-llama", "other-meta", "Other-acme", "other-", ""):
            self.assertFalse(valid_family(value))


if __name__ == "__main__":
    unittest.main()
