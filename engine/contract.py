"""Strict application validation of completed runner reports, not attestation.

This validates the implemented report contracts without adding a JSON Schema
runtime dependency: engine report 1.0 with its point-estimate rules unchanged,
and engine report 1.3 with the statistics 1.0.0 rules of
docs/design/audit-statistics.md section 11.6. Production APIs should
additionally use the shared schema.
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

OUTCOMES = {"pass", "fail", "inconclusive", "not_applicable"}
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
HASH = re.compile(r"^[a-f0-9]{64}$")
REPORT_VERSIONS = {"1.0", "1.3"}
PASS_BLOCKING = {"below_minimum_sample_size", "insufficient_coverage", "empty_declared_group", "insufficient_groups", "too_many_groups", "no_threshold", "undecidable_metric", "invalid_band"}
MAX_METRICS, MAX_SLICES, MAX_NAME = 2451, 1000, 20480
KIND_ARTICLES = {"performance": "15", "multiclass_performance": "15", "regression_performance": "15", "calibration": "15", "group_comparison": "10"}
KIND_METRICS = {
    "performance": {"accuracy", "precision", "recall", "specificity", "false_positive_rate", "balanced_accuracy", "f1"},
    "multiclass_performance": {"accuracy", "macro_recall", "macro_precision", "macro_f1"},
    "regression_performance": {"mae", "rmse", "r2", "baseline_rmse"},
    "calibration": {"maximum_calibration_gap", "brier_score", "expected_calibration_error"},
}
# Supplementary descriptive entries of test definitions traditional-ml-2.1.0 (#65): reported, never members.
KIND_SUPPLEMENTARY = {"performance": {"prevalence", "majority_baseline_accuracy"}, "multiclass_performance": {"majority_baseline_accuracy"}}
GROUP_NAMES = {"selection_rate_difference": ("demographic_parity_difference", ("selection_rate_difference",)), "selection_rate_ratio": ("disparate_impact_ratio", ("selection_rate_ratio",)), "equalized_odds": ("equalized_odds_difference", ("tpr_difference", "fpr_difference"))}


def validate_report(report: dict[str, Any], *, require_integrity: bool = True) -> None:
    """Raise ValueError for a malformed completed engine report (contract 1.0 or 1.3).

    Checksums do not establish origin/authenticity: an external report must be
    treated as unverified evidence until its signed custody chain is verified.
    """
    from .diagnostics import canonical_bytes, evaluate, sha256, verify_report

    def expect(condition: bool, message: str) -> None:
        if not condition:
            raise ValueError("Report contract violation: "+message)

    def number(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    expect(isinstance(report, dict), "report must be an object")
    version = report.get("contractVersion")
    expect(version in REPORT_VERSIONS, "contractVersion must be 1.0 or 1.3")
    for key in ("id", "engagementId", "modelId", "datasetId"):
        expect(isinstance(report.get(key), str) and ID.fullmatch(report[key]) is not None, key+" must be a valid identifier")
    expect(report.get("state") == "succeeded", "completed engine evidence must have succeeded execution state")
    expect(isinstance(report.get("outcome"), str) and report["outcome"] in OUTCOMES and report.get("overallOutcome") == report["outcome"], "inconsistent overall outcome")
    expect(isinstance(report.get("seed"), int) and not isinstance(report["seed"], bool) and 0 <= report["seed"] <= 2**32-1, "invalid seed")
    suite = report.get("suite")
    expect(isinstance(suite, list) and bool(suite) and all(isinstance(item, str) for item in suite) and len(set(suite)) == len(suite), "suite must be unique string array")
    policy = report.get("thresholds")
    expect(isinstance(policy, dict), "missing threshold policy")
    expect(policy.get("source") == "internal_policy", "threshold source must be internal_policy")
    expect(all(isinstance(policy.get(key), str) and policy[key].strip() for key in ("policyId", "policyVersion")), "policy identifiers required")
    expect(isinstance(policy.get("values"), dict), "policy values must be an object")
    for name, rule in policy["values"].items():
        expect(isinstance(name, str) and isinstance(rule, dict) and isinstance(rule.get("operator"), str) and rule["operator"] in {"<=", ">="} and number(rule.get("value")), "invalid threshold rule")
    provenance = report.get("provenance")
    expect(isinstance(provenance, dict), "provenance required")
    expect(isinstance(provenance.get("runnerVersion"), str) and bool(provenance["runnerVersion"]), "runnerVersion required")
    hashes = provenance.get("inputHashes")
    expect(isinstance(hashes, dict) and isinstance(hashes.get("data"), str) and HASH.fullmatch(hashes["data"]) is not None, "data SHA-256 required")
    expect(hashes.get("reference") is None or isinstance(hashes["reference"], str) and HASH.fullmatch(hashes["reference"]) is not None, "invalid reference SHA-256")
    expect(isinstance(provenance.get("configSha256"), str) and HASH.fullmatch(provenance["configSha256"]) is not None, "configuration SHA-256 required")
    expect(provenance.get("policyVersion") == policy["policyVersion"], "provenance policy version mismatch")
    configuration = report.get("configuration")
    expect(isinstance(configuration, dict), "configuration snapshot required")
    for key in ("id", "engagementId", "modelId", "datasetId", "suite", "thresholds", "seed"):
        expect(configuration.get(key) == report[key], "configuration snapshot mismatch for "+key)
    expect(sha256(canonical_bytes(configuration)) == provenance["configSha256"], "configuration digest mismatch")
    try:
        started, completed = (datetime.fromisoformat(report[key]) for key in ("startedAt", "completedAt"))
        expect(started.tzinfo is not None and completed.tzinfo is not None and completed >= started, "timestamps must be ordered and timezone-aware")
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError("Report contract violation: invalid timestamps") from exc
    results = report.get("results")
    expect(isinstance(results, list) and bool(results), "results required")
    test_ids = []
    for diagnostic in results:
        expect(isinstance(diagnostic, dict), "result must be an object")
        for key in ("testId", "label", "article"):
            expect(isinstance(diagnostic.get(key), str) and bool(diagnostic[key]), "result "+key+" required")
        test_ids.append(diagnostic["testId"])
        expect(isinstance(diagnostic.get("outcome"), str) and diagnostic["outcome"] in OUTCOMES, "invalid result outcome")
        notes = diagnostic.get("limitations")
        expect(isinstance(notes, list) and all(isinstance(note, str) for note in notes), "result limitations must be strings")
        metrics = diagnostic.get("metrics")
        expect(isinstance(metrics, list), "metrics must be an array")
        expect(bool(metrics) or diagnostic["outcome"] in {"inconclusive", "not_applicable"}, "empty evidence cannot pass or fail")
        for measurement in metrics:
            expect(isinstance(measurement, dict), "metric must be an object")
            for key in ("name", "unit"):
                expect(isinstance(measurement.get(key), str) and bool(measurement[key]), "metric "+key+" required")
            expect("value" in measurement and (measurement["value"] is None or number(measurement["value"])), "metric value must be finite or null")
            expect(isinstance(measurement.get("sampleSize"), int) and not isinstance(measurement["sampleSize"], bool) and measurement["sampleSize"] >= 0, "invalid metric sample size")
            expect(isinstance(measurement.get("details"), dict) and isinstance(measurement.get("slices"), list), "metric details/slices required")
            expect(all(isinstance(item, dict) for item in measurement["slices"]), "slices must be objects")
            expected_rule = policy["values"].get(measurement["name"])
            expected_threshold = {**expected_rule, "policyId": policy["policyId"], "policyVersion": policy["policyVersion"], "source": "internal_policy"} if expected_rule else None
            expect(measurement.get("threshold") == expected_threshold, "metric threshold differs from frozen policy")
            for key in ("numerator", "denominator"):
                expect(measurement.get(key) is None or number(measurement[key]) and measurement[key] >= 0, "invalid metric "+key)
            interval = measurement.get("confidenceInterval")
            if interval is not None:
                expect(isinstance(interval, dict) and all(number(interval.get(key)) for key in ("lower", "upper", "level")), "invalid confidence interval")
                expect(interval["lower"] <= interval["upper"] and 0 < interval["level"] < 1 and isinstance(interval.get("method"), str), "invalid confidence interval bounds/method")
            # Contract 1.0 and results that statistics 1.0.0 does not govern keep today's point-estimate rule.
            if diagnostic["outcome"] == "pass" and (version == "1.0" or "decision" not in diagnostic):
                expect(evaluate(measurement) == "pass", "pass contradicts numeric acceptance policy")
        if diagnostic["outcome"] in {"inconclusive", "not_applicable"}:
            expect(bool(notes), "inconclusive/not_applicable results need a reason")
    expect(len(test_ids) == len(set(test_ids)), "duplicate test identifiers")
    if version == "1.0":
        expect(all("decision" not in diagnostic for diagnostic in results), "contract 1.0 results carry no decision")
        outcomes = [diagnostic["outcome"] for diagnostic in results]
        overall = "fail" if "fail" in outcomes else "inconclusive" if "inconclusive" in outcomes else "pass" if "pass" in outcomes else "not_applicable"
        expect(report["outcome"] == overall, "aggregate outcome contradicts results")
    else:
        _validate_statistics(report, expect)
    paper_ids = report.get("paperIds")
    expect(isinstance(paper_ids, list) and all(isinstance(item, str) and ID.fullmatch(item) is not None for item in paper_ids) and len(set(paper_ids)) == len(paper_ids), "invalid paper identifiers")
    papers = report.get("workingPapers")
    expect(isinstance(papers, list) and [paper.get("id") for paper in papers if isinstance(paper, dict)] == paper_ids, "working papers and paperIds mismatch")
    if require_integrity:
        expect(verify_report(report), "report SHA-256 mismatch")


def _close(a, b):
    return a is not None and b is not None and abs(a - b) <= 1e-12 * max(1.0, abs(b))


def _validate_statistics(report, expect):
    """Section 11.6 rules for a 1.3 report."""
    from . import statistics as st

    plan = report["configuration"].get("statistics")
    governed = [r for r in report["results"] if "decision" in r]
    if plan is None:
        expect(not governed and report["provenance"].get("statisticsPlanSha256") is None, "decisions need a recorded statistics plan")
    else:
        try:
            normalised = st.normalize_plan(plan)
        except (ValueError, KeyError, TypeError) as exc:
            raise ValueError("Report contract violation: recorded statistics plan is invalid") from exc
        expect(normalised == plan, "recorded statistics plan is not normalised")
        expect(st.plan_sha256(plan) == report["provenance"].get("statisticsPlanSha256"), "statistics plan SHA-256 mismatch")
        # Rule 10: one result per criterion, in plan order; other results keep today's ids and carry no decision.
        expect([r["testId"] for r in governed] == [c["id"] for c in plan["criteria"]], "decided results must be the plan's criteria in plan order")
        families = {role: [r for r in governed if r["decision"]["role"] == role] for role in ("confirmatory", "exploratory")}
        alpha = 1.0 - plan["confidenceLevel"]
        bh = {role: st.benjamini_hochberg([r["decision"]["pValue"] for r in members]) for role, members in families.items()}
        for criterion, result in zip(plan["criteria"], governed):
            _validate_criterion(criterion, result, plan, alpha, families, bh, expect)
    counted = [r["outcome"] for r in report["results"] if "decision" not in r or r["decision"]["role"] == "confirmatory"]
    overall = next((state for state in ("fail", "inconclusive", "pass") if state in counted), "not_applicable")
    expect(report["outcome"] == overall, "aggregate outcome contradicts confirmatory criteria and undecided results")
    flags = [r["testId"] for r in governed if r["decision"]["role"] == "exploratory" and r["outcome"] == "fail"]
    expect(report.get("reviewFlags") == flags, "reviewFlags must list the failing exploratory criteria")


def _validate_criterion(criterion, result, plan, alpha, families, bh, expect):
    decision = result["decision"]
    kind = criterion["kind"]
    expect(isinstance(decision, dict) and decision.get("kind") == kind and decision.get("role") == criterion["role"], "decision kind/role differs from the plan")
    expect(decision.get("statisticsVersion") == plan["statisticsVersion"] and decision.get("confidenceLevel") == plan["confidenceLevel"], "decision version/level differs from the plan")
    expect(result["article"] == KIND_ARTICLES[kind], "article must follow the criterion kind")
    direction, p, adjusted = decision.get("direction"), decision.get("pValue"), decision.get("adjustedPValue")
    expect(direction in ("pass", "fail", "none") and isinstance(p, (int, float)) and isinstance(adjusted, (int, float)), "invalid decision direction or p-values")

    def outcome_of(value):
        return direction if direction in ("pass", "fail") and value <= alpha + 1e-12 else "inconclusive"

    expect(result["outcome"] == outcome_of(adjusted), "outcome disagrees with the adjusted decision")
    expect(decision.get("unadjustedOutcome") == outcome_of(p), "unadjustedOutcome disagrees with the decision p-value")
    family = families[criterion["role"]]
    expect(decision.get("familySize") == len(family), "familySize differs from the plan's family")
    expected = min(1.0, len(family) * p) if criterion["role"] == "confirmatory" else bh[criterion["role"]][family.index(result)]
    expect(_close(adjusted, expected), "adjustedPValue differs from the family adjustment")
    metrics = result["metrics"]
    expect(len(metrics) <= MAX_METRICS and all(len(m["slices"]) <= MAX_SLICES and len(m["name"]) <= MAX_NAME for m in metrics), "metric limits exceeded")
    roles = [m["details"].get("role") for m in metrics]
    expect(all(role in ("headline", "member", "descriptive") for role in roles), "metric role must be headline, member or descriptive")
    if kind in ("group_comparison", "calibration"):
        expect(roles[:1] == ["headline"] and roles.count("headline") == 1, "group and calibration results start with one headline")
    _validate_names(criterion, metrics, expect)
    members = [m for m in metrics if m["details"]["role"] == "member"]
    for m in metrics:
        details = m["details"]
        if details["role"] == "descriptive":
            expect(details.get("band") is None and details.get("direction") == "none" and m.get("pValue") is None, "descriptive entries carry no band, direction or p-value")
    for m in members:
        expect(m["details"].get("band") == _plan_band(criterion, m["details"]["metric"]), "member band differs from the plan")
        _validate_chance(m, expect)
    for m in metrics:
        if not (m["details"]["role"] == "member" and m["details"]["metric"] == "balanced_accuracy"):
            expect(m["details"].get("chanceExactP") is None, "only a gated balanced-accuracy member carries chanceExactP")
    pool = [m for m in members if m["details"]["status"] != "suppressed"]
    evaluated = [m for m in pool if m["details"]["status"] == "evaluated"]
    if result["outcome"] == "pass":
        expect(bool(pool) and all(m["details"]["status"] == "evaluated" and m["details"]["direction"] == "pass" for m in pool), "a pass needs every pool member evaluated and passing")
        expect(not set(decision.get("reasons", ())) & PASS_BLOCKING and not criterion.get("passBlockedBy"), "a pass-blocking reason or passBlockedBy forbids a pass")
        largest = max(m["pValue"] for m in pool)
        expect(decision.get("decidingMemberId") in {_member_id(m) for m in pool if m["pValue"] == largest}, "a pass's deciding member has the largest member p-value")
        if criterion["kind"] == "regression_performance":
            # Section 5.9: a regression pass also needs the mean-prediction baseline beaten.
            baseline = next((m for m in metrics if m["name"] == "baseline_rmse" and m["details"]["role"] == "descriptive"), None)
            gate = (baseline["details"].get("counts") or {}).get("gatePValue") if baseline else None
            expect(isinstance(gate, (int, float)) and not isinstance(gate, bool), "a regression pass reports the mean baseline gate (baseline_rmse counts.gatePValue)")
            largest = max(largest, gate)
        expect(_close(p, largest), "a pass's p-value is the largest member p-value (and, for regression, the mean baseline gate p)")
    if result["outcome"] == "fail":
        failing = [m for m in evaluated if m["details"]["direction"] == "fail"]
        expect(bool(failing), "a fail needs an evaluated failing member")
        deciding = [m for m in failing if _member_id(m) == decision.get("decidingMemberId")]
        expect(len(deciding) == 1 and _close(p, min(1.0, len(evaluated) * deciding[0]["pValue"])), "a fail's p-value is Bonferroni over the evaluated members")


def _member_id(m):
    return "balanced_accuracy" if m["name"] == "macro_recall" else m["name"]


def _plan_band(criterion, metric):
    if criterion["kind"] == "group_comparison":
        return criterion["band"]
    if metric == "calibration_gap":
        return criterion["band"]
    return next((item["band"] for item in criterion.get("members", []) if item["metric"] == metric), None)


def _validate_names(criterion, metrics, expect):
    kind = criterion["kind"]
    for m in metrics:
        name, role = m["name"], m["details"]["role"]
        if kind == "group_comparison":
            headline, prefixes = GROUP_NAMES[criterion["metric"]]
            allowed = name == headline if role == "headline" else name.split(":", 1)[0] in prefixes and ":" in name
        elif kind == "calibration":
            allowed = name in KIND_METRICS[kind] or role == "member" and name.startswith("calibration_gap:bin")
        else:
            allowed = name in KIND_METRICS[kind] or role == "descriptive" and name in KIND_SUPPLEMENTARY.get(kind, ())
        expect(allowed, f"metric name {name[:80]!r} does not belong to a {kind} criterion")


def _validate_chance(m, expect):
    """Rule 11: a balanced-accuracy member whose lower bound is at or above chance carries the chance gate."""
    from . import statistics as st

    details = m["details"]
    if details["metric"] != "balanced_accuracy":
        return
    per_class = (details.get("counts") or {}).get("perClass")
    chance = 1.0 / len(per_class) if per_class else 0.5
    lower = (details.get("band") or {}).get("lower")
    gated = lower is not None and (lower > chance or st.on_boundary(lower, chance))
    if not gated:
        expect(details.get("chanceExactP") is None, "an ungated balanced-accuracy member carries no chanceExactP")
        return
    if m["value"] is not None:
        expect(isinstance(details.get("chanceExactP"), (int, float)), "a gated balanced-accuracy member reports chanceExactP")
        if details["direction"] == "pass":
            expect(m["pValue"] >= details["chanceExactP"], "a gated pass p-value is at least chanceExactP")
