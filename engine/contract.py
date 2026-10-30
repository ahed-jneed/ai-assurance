"""Strict application validation of completed runner reports, not attestation.

This validates the implemented report contract without adding a JSON Schema
runtime dependency. Production APIs should additionally use the shared schema.
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

OUTCOMES = {"pass", "fail", "inconclusive", "not_applicable"}
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
HASH = re.compile(r"^[a-f0-9]{64}$")


def validate_report(report: dict[str, Any], *, require_integrity: bool = True) -> None:
    """Raise ValueError for a malformed completed v1.0 engine report.

    Checksums do not establish origin/authenticity: an external report must be
    treated as unverified evidence until its signed custody chain is verified.
    """
    from .diagnostics import evaluate, verify_report

    def expect(condition: bool, message: str) -> None:
        if not condition:
            raise ValueError("Report contract violation: "+message)

    def number(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    expect(isinstance(report, dict), "report must be an object")
    expect(report.get("contractVersion") == "1.0", "contractVersion must be 1.0")
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
    from .diagnostics import canonical_bytes, sha256
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
            if diagnostic["outcome"] == "pass":
                expect(evaluate(measurement) == "pass", "pass contradicts numeric acceptance policy")
        if diagnostic["outcome"] in {"inconclusive", "not_applicable"}:
            expect(bool(notes), "inconclusive/not_applicable results need a reason")
    expect(len(test_ids) == len(set(test_ids)), "duplicate test identifiers")
    outcomes = [diagnostic["outcome"] for diagnostic in results]
    overall = "fail" if "fail" in outcomes else "inconclusive" if "inconclusive" in outcomes else "pass" if "pass" in outcomes else "not_applicable"
    expect(report["outcome"] == overall, "aggregate outcome contradicts results")
    paper_ids = report.get("paperIds")
    expect(isinstance(paper_ids, list) and all(isinstance(item, str) and ID.fullmatch(item) is not None for item in paper_ids) and len(set(paper_ids)) == len(paper_ids), "invalid paper identifiers")
    papers = report.get("workingPapers")
    expect(isinstance(papers, list) and [paper.get("id") for paper in papers if isinstance(paper, dict)] == paper_ids, "working papers and paperIds mismatch")
    if require_integrity:
        expect(verify_report(report), "report SHA-256 mismatch")
