"""GenAI recomputation against the design-time values in engine/tests/fixtures/genai/expected.json (design section 8).

Every value is reproduced to 1e-6 through the full pipeline (run_bundle), not through the helpers
alone: estimates, IID and clustered standard errors, Wilson intervals (also on the effective sample
size), attack members per groupBy, pass^k, paired differences, kappa, reconciliation and gates.
"""
from __future__ import annotations

import math
import unittest

from engine import statistics as core
from engine.genai import recompute
from engine.genai.errors import GenaiInputError
from engine.genai.formats import judge_validation
from engine.genai.ingest import run_bundle
from engine.tests import genai_support as gs

TOL = 1e-6


def ingest(name, criteria=(), **kwargs):
    inputs, manifest, plan = gs.bundle(name, criteria=criteria, **kwargs)
    return gs.computation(run_bundle(inputs, manifest, plan))


def members(comp, criterion_id):
    criterion = next(c for c in comp["criteria"] if c["id"] == criterion_id)
    return {m["memberId"].split("|")[-1]: m for m in criterion["members"]}, criterion


class Close(unittest.TestCase):
    def close(self, actual, expected, tol=TOL, msg=None):
        self.assertIsNotNone(actual, msg)
        self.assertLessEqual(abs(actual - expected), tol, f"{msg}: {actual} != {expected}")

    def interval(self, member, expected, msg=None):
        self.close(member["interval"]["lower"], expected[0], msg=msg)
        self.close(member["interval"]["upper"], expected[1], msg=msg)


@unittest.skipUnless(gs.has_zstd(), "no zstd back-end")
class InspectRecomputeTest(Close):
    expected = gs.expected()["fixtures"]

    def test_judged_qa_30_decision_example(self):
        exp = self.expected["inspect/judged_qa_30.eval"]["primary"]["original"]
        comp = ingest("inspect/judged_qa_30.eval", [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.7}}])
        found, criterion = members(comp, "acc")
        m = found["model_graded_qa"]
        self.close(m["estimate"], exp["estimate"])
        self.close(m["seIid"], exp["seIid"])
        self.interval(m, exp["wilson95"])
        self.assertEqual(m["interval"]["method"], "wilson")
        self.close(m["pValue"], exp["decisionExample"]["pValue"])
        self.assertEqual(criterion["outcome"], "pass")
        self.assertEqual(criterion["decision"]["sampleSize"], 30)
        # model-graded score without a label file: the workspace gate must block.
        self.assertTrue(any(f["flag"] == "judge_not_validated" for f in criterion["flags"]))
        # Every tool aggregate reconciles.
        run = comp["runs"][0]
        self.assertTrue(all(r["status"] == "match" for r in run["reconciliation"]), run["reconciliation"])
        self.assertEqual(run["evidenceLevel"], "L2")

    def test_tiny_qa_clustered_standard_error(self):
        exp = self.expected["inspect/tiny_qa.eval"]["primary"]["original"]
        comp = ingest("inspect/tiny_qa.eval", [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.3}}])
        m = members(comp, "acc")[0]["match"]
        self.close(m["estimate"], exp["estimate"])
        self.close(m["seIid"], exp["seIid"])
        self.close(m["seCluster"], exp["seCluster"]["value"])
        self.assertEqual(m["counts"]["clusters"], exp["seCluster"]["clusters"])
        self.assertEqual(m["status"], "insufficient_support")
        self.assertIn("below_minimum_clusters", m["reasons"])
        self.assertEqual(m["interval"]["method"], "wilson_effective_n")

    def test_tiny_qa_edited_views(self):
        exp = self.expected["inspect/tiny_qa.edited.eval"]
        criteria = [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.3}}]
        original = ingest("inspect/tiny_qa.edited.eval", criteria)
        edited = ingest("inspect/tiny_qa.edited.eval", criteria, plan_extra={"scorePolicy": "as_edited"})
        for comp, key in ((original, "original"), (edited, "asEdited")):
            m = members(comp, "acc")[0]["match"]
            self.close(m["estimate"], exp["primary"][key]["estimate"], msg=key)
            self.close(m["seIid"], exp["primary"][key]["seIid"], msg=key)
            self.close(m["seCluster"], exp["primary"][key]["seCluster"]["value"], msg=key)
            self.assertEqual(m["counts"]["n"], exp["primary"][key]["n"])
        run = original["runs"][0]
        counts = run["postRunEdits"]["counts"]
        for key, value in exp["postRunEdits"].items():
            self.assertEqual(counts[key], value, key)
        self.assertEqual(edited["runs"][0]["statusCounts"]["invalidated"], 1)
        rows = {r["metric"]: r for r in run["reconciliation"]}
        self.assertEqual(rows["match.accuracy"]["status"], "match")
        self.close(rows["match.accuracy"]["ours"], exp["primary"]["reconciliationView"]["estimate"])
        self.close(rows["match.stderr"]["ours"], exp["primary"]["reconciliationView"]["seIid"])
        self.assertTrue(any("edited after the run" in s for s in run["claimScope"]))

    def test_canary_attack_members(self):
        exp = self.expected["inspect/canary_injection.json"]["primary"]["original"]
        comp = ingest("inspect/canary_injection.json", [
            {"id": "by-technique", "kind": "genai_attack_success", "band": {"upper": 0.05}},
            {"id": "pooled", "kind": "genai_attack_success", "groupBy": "none", "band": {"upper": 0.05}, "role": "exploratory"},
        ])
        found, criterion = members(comp, "by-technique")
        for key, value in exp["attackMembers"]["technique"].items():
            self.assertEqual(found[key]["counts"]["x"], value["x"])
            self.assertEqual(found[key]["counts"]["n"], value["n"])
            self.interval(found[key], value["wilson95"], key)
        self.assertEqual(criterion["outcome"], "inconclusive")
        self.assertIn("below_minimum_sample_size", criterion["decision"]["reasons"])
        pooled = members(comp, "pooled")[0]["all"]
        self.interval(pooled, exp["attackMembers"]["none"]["all"]["wilson95"])
        self.assertEqual(criterion["headline"]["memberId"], "direct_override")

    def test_tiny_agent_pass_k(self):
        exp = self.expected["inspect/tiny_agent.eval"]["passK"]
        comp = ingest("inspect/tiny_agent.eval", [{"id": "reliability", "kind": "genai_pass_k", "k": [1, 2, 3, 4], "band": {"lower": 0.2}}])
        found = members(comp, "reliability")[0]
        for k in (1, 2, 3, 4):
            self.close(found[f"pass^{k}"]["estimate"], exp[f"pass^{k}"], msg=f"pass^{k}")
        self.close(found["pass^1"]["passAtK"], exp["pass@1"])
        self.close(found["pass^2"]["passAtK"], exp["pass@2"])
        self.assertEqual(comp["runs"][0]["runMetadata"]["tools"]["offered"][0]["name"], "add")


class LmEvalRecomputeTest(Close):
    exp = gs.expected()["fixtures"]["lm_eval/results_2026-11-05T16-54-06.848117.json"]

    def test_metrics_and_reconciliation(self):
        comp = ingest("lm_eval/*", [
            {"id": "mc", "kind": "genai_mean", "metric": "accuracy", "select": {"task": "tiny_mc"}, "primaryScore": "acc_norm,none", "band": {"lower": 0.1}},
            {"id": "gen", "kind": "genai_mean", "metric": "accuracy", "select": {"task": "tiny_gen"}, "primaryScore": "exact_match,strip", "band": {"lower": 0.1}},
        ])
        mc = next(iter(members(comp, "mc")[0].values()))
        exp_mc = self.exp["tasks"]["tiny_mc"]["metrics"]["acc_norm,none"]
        self.close(mc["estimate"], exp_mc["estimate"])
        self.close(mc["seIid"], exp_mc["seIid"])
        self.close(mc["seCluster"], exp_mc["seCluster"]["value"])
        self.assertEqual(mc["counts"]["clusters"], exp_mc["seCluster"]["clusters"])
        gen = next(iter(members(comp, "gen")[0].values()))
        exp_gen = self.exp["tasks"]["tiny_gen"]["metrics"]["exact_match,strip"]
        self.close(gen["estimate"], exp_gen["estimate"])
        self.close(gen["seIid"], exp_gen["seIid"])
        for run in comp["runs"]:
            task = run["runKey"].rsplit(":", 1)[-1]
            self.assertEqual(run["evidenceLevel"], "L2")
            statuses = {r["metric"]: r["status"] for r in run["reconciliation"]}
            for metric in self.exp["tasks"][task]["metrics"]:
                self.assertEqual(statuses[f"{metric}.value"], "match", metric)
                self.assertEqual(statuses[f"{metric}.stderr"], "match", metric)
            self.assertEqual(run["runMetadata"]["systemPrompt"]["sha256"], self.exp["tasks"][task]["systemPromptSha256"])

    def test_default_primary_score(self):
        from engine.tests.test_genai_parsers import parse_reference_bundle
        runs = {r.run_key.rsplit(":", 1)[-1]: r for r in parse_reference_bundle("lm_eval/*")}
        for task, run in runs.items():
            self.assertEqual(run.primary_default, self.exp["tasks"][task]["primaryScoreDefault"])


class PromptfooRecomputeTest(Close):
    expected = gs.expected()["fixtures"]

    def test_echo_repeat_pass_rate_and_gate(self):
        exp = self.expected["promptfoo/echo_repeat.results.json"]
        comp = ingest("promptfoo/echo_repeat.results.json", [{"id": "pass", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.5}}])
        found, criterion = members(comp, "pass")
        m = next(iter(found.values()))
        self.close(m["estimate"], exp["passRate"]["estimate"])
        self.close(m["seIid"], exp["passRate"]["seIid"])
        self.assertEqual(m["counts"]["n"], exp["groups"])
        self.assertEqual(m["unstableGroups"], exp["unstableGroups"])
        run = comp["runs"][0]
        for name, kinds in exp["scorerKinds"].items():
            self.assertEqual(run["scoreKinds"][name], kinds, name)
        self.assertTrue(any(f["reasons"] == ["scorer_kind_unknown"] and f["score"] == "javascript" for f in criterion["flags"]))
        statuses = {r["metric"]: r["status"] for r in run["reconciliation"]}
        for key in ("stats.successes", "stats.failures", "stats.errors"):
            self.assertEqual(statuses[key], "match")

    def test_declared_deterministic_score_needs_acknowledgement(self):
        comp = ingest("promptfoo/echo_repeat.results.json", [{"id": "pass", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.5}}],
                      declared={"scorers": [{"score": "javascript", "kind": "deterministic", "rationale": "The recorded source only compares the output length."}]})
        flags = members(comp, "pass")[1]["flags"]
        self.assertTrue(any(f["flag"] == "scorer_kind_declared" for f in flags))
        self.assertFalse(any(f["reasons"] == ["scorer_kind_unknown"] for f in flags))

    def test_redteam_members(self):
        exp = self.expected["promptfoo/redteam_shaped.results.json"]
        criteria = [{"id": f"by-{g}", "kind": "genai_attack_success", "groupBy": g, "band": {"upper": 0.05}, "role": "exploratory"} for g in ("technique", "variant", "technique_variant", "none")]
        comp = ingest("promptfoo/redteam_shaped.results.json", criteria)
        for group_by, expected_members in exp["attackMembers"].items():
            found = members(comp, f"by-{group_by}")[0]
            self.assertEqual(set(found), set(expected_members), group_by)
            for key, value in expected_members.items():
                self.assertEqual((found[key]["counts"]["x"], found[key]["counts"]["n"]), (value["x"], value["n"]), key)
                self.interval(found[key], value["wilson95"], key)
        run = comp["runs"][0]
        self.assertEqual(run["statusCounts"]["error"], exp["errorsExcluded"])
        self.assertEqual(run["runMetadata"]["systemPrompt"]["sha256"], exp["systemPromptSha256"])

    def test_bonferroni_level_for_four_techniques(self):
        exp = gs.expected()["workedExamples"]["bonferroniWilsonForFourTechniques"]
        z = core.zcrit(exp["level"])
        self.close(z, exp["z_scipy"])
        lower, upper = core.wilson(2, 2, z)
        self.close(lower, exp["intervals"]["excessive-agency"][0])
        self.close(upper, exp["intervals"]["excessive-agency"][1])


class GarakPyritRecomputeTest(Close):
    expected = gs.expected()["fixtures"]

    def test_garak_members_and_reconciliation(self):
        exp = self.expected["garak/tiny.report.jsonl"]
        comp = ingest("garak/tiny.report.jsonl", [{"id": "probes", "kind": "genai_attack_success", "band": {"upper": 0.05}},
                                                   {"id": "pooled", "kind": "genai_attack_success", "groupBy": "none", "band": {"upper": 0.05}, "role": "exploratory"}])
        found = members(comp, "probes")[0]
        for key, value in exp["attackMembers"]["technique"].items():
            self.assertEqual((found[key]["counts"]["x"], found[key]["counts"]["n"]), (value["x"], value["n"]))
            self.interval(found[key], value["wilson95"], key)
        pooled = members(comp, "pooled")[0]["all"]
        self.interval(pooled, exp["attackMembers"]["none"]["all"]["wilson95"])
        run = comp["runs"][0]
        self.assertEqual(run["runMetadata"]["n"]["items"], exp["items"])
        statuses = {r["metric"]: r for r in run["reconciliation"]}
        for label, value in exp["perProbeDetector"].items():
            for field in ("passed", "fails", "nones"):
                row = statuses[f"eval.{field}[{label}]"]
                self.assertEqual(row["status"], "match", label)
                self.assertEqual(row["tool"], value["toolReported"][field])
        self.assertEqual(statuses["hitlog.rows"]["tool"], exp["hitlogRows"])
        self.assertEqual(statuses["hitlog.rows"]["status"], "match")
        self.assertIn("naive_timestamp", {w["code"] for w in run["warnings"]})

    def test_garak_declared_offset_converts_naive_times(self):
        comp = ingest("garak/tiny.report.jsonl", declared={"dates": {"utcOffset": "+01:00"}})
        dates = comp["runs"][0]["runMetadata"]["dates"]
        self.assertEqual(dates["runStartedAt"], "2026-11-05T17:03:50.084284+01:00")
        self.assertEqual(dates["source"]["kind"], "declared")

    def test_pyrit_members(self):
        exp = self.expected["pyrit/attacks.pyrit-export.jsonl"]
        criteria = [{"id": f"by-{g}", "kind": "genai_attack_success", "groupBy": g, "band": {"upper": 0.05}, "role": "exploratory"} for g in ("technique", "variant", "technique_variant", "none")]
        comp = ingest("pyrit/attacks.pyrit-export.jsonl", criteria)
        for group_by, expected_members in exp["attackMembers"].items():
            found = members(comp, f"by-{group_by}")[0]
            for key, value in expected_members.items():
                self.assertEqual((found[key]["counts"]["x"], found[key]["counts"]["n"]), (value["x"], value["n"]))
                self.interval(found[key], value["wilson95"], key)

    def test_variant_grouping_on_garak_is_plan_invalid(self):
        with self.assertRaises(GenaiInputError) as caught:
            ingest("garak/tiny.report.jsonl", [{"id": "v", "kind": "genai_attack_success", "groupBy": "variant", "band": {"upper": 0.05}}])
        self.assertEqual(caught.exception.code, "plan_invalid")


class DeclaredFormatsRecomputeTest(Close):
    expected = gs.expected()["fixtures"]

    def test_deepeval_metrics(self):
        exp = self.expected["deepeval/test_run_20261105_170925.json"]
        criteria = [{"id": f"m{i}", "kind": "genai_mean", "metric": "score_mean", "primaryScore": name, "band": {"lower": 0.5}} for i, name in enumerate(exp["metrics"])]
        comp = ingest("deepeval/test_run_20261105_170925.json", criteria)
        for i, (name, value) in enumerate(exp["metrics"].items()):
            m = next(iter(members(comp, f"m{i}")[0].values()))
            self.close(m["estimate"], value["estimate"], msg=name)
            if value["seIid"]:
                self.close(m["seIid"], value["seIid"], msg=name)
        run = comp["runs"][0]
        for name, kinds in exp["scorerKinds"].items():
            self.assertEqual(run["scoreKinds"][name], kinds)
        self.assertEqual(run["runMetadata"]["harness"]["version"], "4.3.3")
        self.assertIn("harness", run["runMetadata"]["completeness"]["declaredOnly"])
        self.assertTrue(all(r["status"] == "match" for r in run["reconciliation"]), run["reconciliation"])

    def test_deepeval_without_declared_version_is_rejected(self):
        inputs, manifest, plan = gs.bundle("deepeval/test_run_20261105_170925.json", declared={"harness": {"name": "deepeval", "version": None}})
        with self.assertRaises(GenaiInputError) as caught:
            run_bundle(inputs, manifest, plan)
        self.assertEqual(caught.exception.code, "unsupported_format_version")

    def test_ragas_metrics(self):
        exp = self.expected["ragas/results.jsonl"]
        criteria = [{"id": f"m{i}", "kind": "genai_mean", "metric": "score_mean", "primaryScore": name, "band": {"lower": 0.1}} for i, name in enumerate(exp["metrics"])]
        comp = ingest("ragas/results.jsonl", criteria)
        for i, (name, value) in enumerate(exp["metrics"].items()):
            m = next(iter(members(comp, f"m{i}")[0].values()))
            self.close(m["estimate"], value["estimate"], msg=name)
            self.close(m["seIid"], value["seIid"], msg=name)

    def test_ragas_llm_column_declared_model_graded(self):
        comp = ingest("ragas/results.jsonl", [{"id": "m", "kind": "genai_mean", "metric": "score_mean", "primaryScore": "exact_match", "band": {"lower": 0.1}}],
                      declared={"judges": [{"ref": "J1", "model": "openai/gpt-4o-2024-08-06", "family": "openai", "scores": ["non_llm_string_similarity"]}]})
        run = comp["runs"][0]
        self.assertEqual(run["scoreKinds"]["non_llm_string_similarity"], ["model_graded"])
        judges = run["runMetadata"]["judges"]
        self.assertEqual(judges[0]["model"]["source"]["kind"], "declared")


class JudgeValidationTest(Close):
    expected = gs.expected()["judgeValidation"]

    def test_kappa_values(self):
        for path, exp in self.expected.items():
            spec, data = gs.input_spec(path, "judge_validation_jsonl")
            parsed = judge_validation.parse(spec, data)
            k = judge_validation.kappa(parsed["labels"], parsed["labelSet"])
            self.assertEqual(k["n"], exp["n"])
            self.close(k["kappa"], exp["kappa"], msg=path)
            self.close(k["se"], exp["seFleissCohenEveritt"], msg=path)
            self.close(k["lower"], exp["ci95"][0], msg=path)
            self.close(k["upper"], exp["ci95"][1], msg=path)
            self.close(k["observedAgreement"], exp["observedAgreement"])
            self.close(k["chanceAgreement"], exp["chanceAgreement"])

    @unittest.skipUnless(gs.has_zstd(), "no zstd back-end")
    def test_acceptance_scenario_binding(self):
        """Design section 12.3: small label file blocks, large one validates J1 of judged_qa_30."""
        declared = {"systemUnderTest": {"snapshot": "model-2026-11-05", "provider": "fixture", "family": "other-fixture-sut"},
                    "tools": {"agentic": False, "offered": []}, "dataset": {"name": "judged_qa_30", "version": "1.0.0"},
                    "judges": [{"ref": "J1", "model": "mockllm/judge", "snapshot": "judge-2026-11-05", "family": "other-fixture-judge", "promptTemplateSha256": None, "scores": []}],
                    "scorers": [], "dates": {"utcOffset": None}}
        criteria = [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.7}}]
        for path, validated in (("judge_validation/judge_small_60.jsonl", False), ("judge_validation/judge_large_200.jsonl", True)):
            label = gs.input_spec(path, "judge_validation_jsonl", role="judge_validation", judgeRef="J1")
            comp = ingest("inspect/judged_qa_30.eval", criteria, declared=declared, plan_extra={"primaryScore": "model_graded_qa"}, extra_inputs=[label])
            jv = comp["judgeValidation"][0]
            binding = jv["bindings"][0]
            self.assertEqual(binding["binding"], self.expected[path]["bindingAgainstJudgedQa30J1"])
            self.assertEqual(binding["validated"], validated, path)
            flags = members(comp, "acc")[1]["flags"]
            self.assertEqual(bool(flags), not validated, flags)
            run = comp["runs"][0]
            self.assertEqual(run["runMetadata"]["completeness"]["missing"], [])
            self.assertEqual(run["runMetadata"]["judges"][0]["validation"]["artifactSha256"], self.expected[path]["sha256"])
            self.assertNotIn("declaration_conflict", {w["code"] for w in comp["warnings"]})

    @unittest.skipUnless(gs.has_zstd(), "no zstd back-end")
    def test_same_family_judge_is_not_validated(self):
        declared = {"systemUnderTest": {"snapshot": "model-2026-11-05", "family": "other-fixture"},
                    "judges": [{"ref": "J1", "model": "mockllm/judge", "snapshot": "judge-2026-11-05", "family": "other-fixture"}]}
        label = gs.input_spec("judge_validation/judge_large_200.jsonl", "judge_validation_jsonl", role="judge_validation", judgeRef="J1")
        comp = ingest("inspect/judged_qa_30.eval", [{"id": "acc", "kind": "genai_mean", "metric": "accuracy", "band": {"lower": 0.7}}], declared=declared,
                      plan_extra={"primaryScore": "model_graded_qa"}, extra_inputs=[label])
        binding = comp["judgeValidation"][0]["bindings"][0]
        self.assertFalse(binding["validated"])
        self.assertIn("same_family", binding["reasons"])

    def test_position_consistency(self):
        pairs = {("p1", "AB"): "A", ("p1", "BA"): "B", ("p2", "AB"): "tie", ("p2", "BA"): "tie", ("p3", "AB"): "A", ("p3", "BA"): "A", ("p4", "AB"): "A"}
        pc = judge_validation.position_consistency(pairs)
        self.assertEqual((pc["consistent"], pc["pairs"]), (2, 3))
        self.close(pc["lower"], core.wilson(2, 3, core.zcrit(0.95))[0])
        self.assertEqual(judge_validation.position_consistency({})["lower"], None)


class WorkedExamplesTest(Close):
    worked = gs.expected()["workedExamples"]

    def test_effective_sample_size_wilson(self):
        exp = self.worked["effectiveSampleSizeWilson"]
        values, clusters = [], []
        for c, mean in enumerate((1.0, 1.0, 0.6, 0.6)):
            ones = round(mean * 10)
            values += [1.0] * ones + [0.0] * (10 - ones)
            clusters += [f"c{c}"] * 10
        self.close(recompute.se_iid(values), exp["seIid"])
        self.close(recompute.se_clustered(values, clusters), exp["seCluster"])
        n_eff, _ = recompute.effective_n(values, clusters)
        self.close(n_eff, exp["nEff"])
        lower, upper = core.wilson(0.8 * n_eff, n_eff, core.zcrit(0.95))
        self.close(lower, exp["wilson95OnNEff"][0])
        self.close(upper, exp["wilson95OnNEff"][1])
        self.close((exp["seCluster"] / exp["seIid"]) ** 2, exp["designEffect"], tol=1e-3)

    def test_degenerate_clustered(self):
        exp = self.worked["degenerateClusteredWilson"]
        values = [0.0] * 300
        clusters = [f"c{i // 30}" for i in range(300)]
        n_eff, _ = recompute.effective_n(values, clusters)
        self.close(n_eff, exp["nEff"])
        lower, upper = core.wilson(0.0, n_eff, core.zcrit(0.95))
        self.close(upper, exp["wilson95OnNEff"][1])
        self.close(core.wilson(0, 300, core.zcrit(0.95))[1], exp["wilson95IgnoringClusters"][1])
        z2 = core.zcrit(0.95) ** 2
        self.assertEqual(next(c for c in range(1, 1000) if z2 / (c + z2) <= 0.05), exp["minimumEqualClustersToPassUpper005"])
        unequal = self.worked["degenerateClusteredWilsonUnequal"]
        clusters = sum(([f"u{i}"] * size for i, size in enumerate(unequal["clusterSizes"])), [])
        n_eff, _ = recompute.effective_n([0.0] * len(clusters), clusters)
        self.close(n_eff, unequal["nEff"])
        self.close(core.wilson(0.0, n_eff, core.zcrit(0.95))[1], unequal["wilson95OnNEff"][1])

    def test_clustered_standard_error_example(self):
        exp = self.worked["clusteredStandardError"]
        self.close(recompute.se_clustered(exp["values"], exp["clusters"]), exp["se"])
        self.close(recompute.se_iid(exp["values"]), exp["seIid"])

    def test_paired_difference(self):
        exp = self.worked["pairedDifference"]
        diffs = [a - b for a, b in zip(exp["A"], exp["B"])]
        se = recompute.se_iid(diffs)
        self.close(se, exp["sePaired"])
        dbar = sum(diffs) / len(diffs)
        z = core.zcrit(0.95)
        self.close(dbar - z * se, exp["ci95"][0])
        self.close(dbar + z * se, exp["ci95"][1])
        self.close(dbar / se, exp["our_t_equivalent"])
        sea, seb = recompute.se_iid([float(v) for v in exp["A"]]), recompute.se_iid([float(v) for v in exp["B"]])
        self.close(math.sqrt(sea ** 2 + seb ** 2), exp["seUnpaired"])
        self.close(recompute._corr([float(v) for v in exp["A"]], [float(v) for v in exp["B"]]), exp["corrAB"])

    def test_wilson_cross_checks(self):
        for case in self.worked["wilson95"]:
            lower, upper = core.wilson(case["x"], case["n"], core.zcrit(0.95))
            self.close(lower, case["statsmodels"][0])
            self.close(upper, case["statsmodels"][1])


@unittest.skipUnless(gs.has_zstd(), "no zstd back-end")
class PairedCriterionTest(Close):
    def test_paired_difference_between_two_inspect_runs(self):
        """tiny_qa and its edited copy share every item, so the paired difference pairs all four groups."""
        a = gs.input_spec("inspect/tiny_qa.eval", "inspect_eval")
        b = gs.input_spec("inspect/canary_injection.json", "inspect_json")
        inputs = {a[0]["sha256"]: a[1], b[0]["sha256"]: b[1]}
        manifest = {"schemaVersion": "genai-bundle/0.1", "origin": "auditee_supplied", "inputs": [a[0], b[0]]}
        plan = {"schemaVersion": "genai-plan/0.1", "criteria": [{"id": "pd", "kind": "genai_paired_difference", "candidate": {"format": "inspect_eval"}, "baseline": {"format": "inspect_json"}, "band": {"lower": -0.1}}]}
        comp = gs.computation(run_bundle(inputs, manifest, plan))
        member = comp["criteria"][0]["members"][0]
        self.assertEqual(member["counts"]["n"], 0)
        self.assertEqual(member["status"], "undefined")
        self.assertEqual(member["counts"]["unmatchedCandidate"], 4)


if __name__ == "__main__":
    unittest.main()
