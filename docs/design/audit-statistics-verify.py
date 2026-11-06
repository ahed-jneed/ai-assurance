#!/usr/bin/env python3
"""VERIFICATION AID for docs/design/audit-statistics.md. This is not runtime code.

It regenerates and checks schemas/fixtures/statistics-golden.json.

* Reference values are computed with the Python standard library only, following the
  normative algorithms in the design document. Fisher's exact test uses exact integers and
  plan hashes use RFC 8785 (JCS) canonical JSON.
* --cross-check recomputes the fixture independently. Every interval is rebuilt from scipy
  and statsmodels primitives, every decision p-value is checked by inverting the library
  interval, and every derived number (headline bounds, coverage, ECE, R2, criterion P,
  family adjustment, outcomes, power, sample sizes, minimum detectable effects and LL144
  shares) is recomputed by separately written code, as is every plan derived from a
  legacy configuration. Plan hashes are recomputed with Node.js, and every plan is
  validated against the draft plan schema with jsonschema.
  Install scipy, statsmodels, numpy and jsonschema only in a throwaway virtualenv OUTSIDE
  the repository; they must never become runtime dependencies.
* --mutation-test corrupts fixture values one at a time and confirms --cross-check reports each.
* --simulate runs Monte Carlo checks of the power formulas and of interval coverage.
* --enumerate computes exact binomial false-fail probabilities for a two-sided band, and the exact pass
  probabilities of the chance baseline for predictors that ignore the truth, with and without the chance
  gate (stdlib).

Usage (from the repository root):
  python docs/design/audit-statistics-verify.py --check --enumerate
  python docs/design/audit-statistics-verify.py --write
  python docs/design/audit-statistics-verify.py --check --cross-check --mutation-test --simulate
  python docs/design/audit-statistics-verify.py --show-plan GC-38
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from statistics import NormalDist

ND = NormalDist()
ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "schemas" / "fixtures" / "statistics-golden.json"
PLAN_SCHEMA = Path(__file__).resolve().with_name("audit-statistics-plan.schema.json")
SPEC_VERSION = "1.0.0"
Z_MAX = 37.0
FLOORS = {"sampleSize": 30, "groupSize": 30, "classCount": 10}
EPS = 1e-12
MAX_GROUPS = {"all_pairs": 50, "reference": 1000}
POWER_SEARCH_LIMIT = 10_000_000
BINARY_METRICS = ("accuracy", "precision", "recall", "specificity", "false_positive_rate", "balanced_accuracy", "f1")
BINARY_DESCRIPTIVE = ("accuracy", "precision", "recall", "specificity", "balanced_accuracy", "f1")
MULTICLASS_METRICS = ("accuracy", "balanced_accuracy", "macro_precision", "macro_f1")
REGRESSION_METRICS = ("mae", "rmse")
REGRESSION_DESCRIPTIVE = ("mae", "rmse", "r2")
PERFORMANCE_KINDS = ("performance", "multiclass_performance", "regression_performance")
# Metrics that today's engine rule makes a pass depend on but that 1.0.0 cannot decide by an interval (section 4.8).
UNDECIDABLE = {"regression_performance": "r2", "calibration": "expected_calibration_error"}
RATE_KEYS = {"selection_rate_difference": "selection", "selection_rate_ratio": "selection", "tpr_difference": "tpr", "fpr_difference": "fpr"}
# Headline names keep each runner's existing metric names (section 11).
HEADLINE_NAMES = {
    "selection_rate_difference": {"engine": "demographic_parity_difference", "hosted": "maximum_selection_rate_gap"},
    "selection_rate_ratio": {"engine": "disparate_impact_ratio", "hosted": "minimum_selection_rate_ratio"},
    "equalized_odds": {"engine": "equalized_odds_difference", "hosted": "maximum_tpr_fpr_gap"},
    "calibration": {"engine": "maximum_calibration_gap", "hosted": None},
}
EU_CAVEAT = "Internal policy. The EU AI Act sets no numerical fairness threshold, and meeting this one gives no presumption of conformity."
LIBRARY = {
    "screen.us.four-fifths": {"version": 1, "kind": "group_comparison", "metric": "selection_rate_ratio", "parameters": {"tau": {"default": 0.8, "minimum": 0.5, "maximum": 0.95}}, "legalStatus": "screening_heuristic", "caveat": "Four-fifths screen: a rule of thumb from the US Uniform Guidelines (29 CFR 1607.4(D)), not a legal test of discrimination."},
    "policy.eu-aia.selection-rate-difference": {"version": 1, "kind": "group_comparison", "metric": "selection_rate_difference", "parameters": {"delta": {"default": 0.10, "minimum": 0.01, "maximum": 0.30}}, "legalStatus": "no_legal_safe_harbour", "caveat": EU_CAVEAT},
    "policy.eu-aia.impact-ratio": {"version": 1, "kind": "group_comparison", "metric": "selection_rate_ratio", "parameters": {"tau": {"default": 0.80, "minimum": 0.5, "maximum": 0.95}}, "legalStatus": "no_legal_safe_harbour", "caveat": EU_CAVEAT},
    "policy.eu-aia.equalized-odds": {"version": 1, "kind": "group_comparison", "metric": "equalized_odds", "parameters": {"delta": {"default": 0.10, "minimum": 0.01, "maximum": 0.30}}, "legalStatus": "no_legal_safe_harbour", "caveat": EU_CAVEAT},
    "policy.eu-aia.declared-performance": {"version": 1, "kind": "performance", "metric": None, "parameters": {"metric": {"default": None, "enum": list(BINARY_METRICS)}, "declaredValue": {"default": None, "minimum": 0.0, "maximum": 1.0}, "tolerance": {"default": None, "minimum": 0.0, "maximum": 0.2}}, "legalStatus": "no_legal_safe_harbour", "caveat": "Checks consistency with the accuracy level declared under Art. 15(3); not a conformity assessment."},
    "policy.eu-aia.calibration": {"version": 1, "kind": "calibration", "metric": None, "parameters": {"delta": {"default": None, "minimum": 0.01, "maximum": 0.2}}, "legalStatus": "no_legal_safe_harbour", "caveat": EU_CAVEAT},
}


# ---------------------------------------------------------------- numerics
def zcrit(level):
    return ND.inv_cdf(1.0 - (1.0 - level) / 2.0)


def p_from_z(z):
    """Decision p-value 2*(1 - Phi(z)) for z >= 0."""
    return math.erfc(min(max(z, 0.0), Z_MAX) / math.sqrt(2.0))


def on_boundary(value, bound):
    return abs(value - bound) <= EPS * max(1.0, abs(bound))


def code_point_key(text):
    return [ord(ch) for ch in text]


def phi(x):
    return ND.cdf(x)


# ---------------------------------------------------------------- intervals at critical value z
def wilson(x, n, z):
    p = x / n
    denominator = 1.0 + z * z / n
    center = (p + z * z / (2.0 * n)) / denominator
    half = z * math.sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n)) / denominator
    lower = 0.0 if x == 0 else max(0.0, center - half)
    upper = 1.0 if x == n else min(1.0, center + half)
    return lower, upper


def newcombe(x1, n1, x2, n2, z):
    p1, p2 = x1 / n1, x2 / n2
    l1, u1 = wilson(x1, n1, z)
    l2, u2 = wilson(x2, n2, z)
    d = p1 - p2
    return d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)


def katz(x1, n1, x2, n2, z):
    r = (x1 / n1) / (x2 / n2)
    se = math.sqrt(1.0 / x1 - 1.0 / n1 + 1.0 / x2 - 1.0 / n2)
    return r * math.exp(-z * se), r * math.exp(z * se)


def koopman_z(x1, n1, x2, n2, phi_):
    """Score statistic for H0: p1/p2 = phi (Koopman 1984 = Farrington-Manning/Miettinen-Nurminen without n/(n-1))."""
    a = (n1 + n2) * phi_
    b = -(n1 * phi_ + x1 + n2 + x2 * phi_)
    c = x1 + x2
    p2 = 2.0 * c / (-b + math.sqrt(max(b * b - 4.0 * a * c, 0.0)))  # smaller root, cancellation-free
    p1 = phi_ * p2
    variance = p1 * (1.0 - p1) / n1 + phi_ * phi_ * p2 * (1.0 - p2) / n2
    numerator = x1 / n1 - phi_ * x2 / n2
    if variance <= 0.0:
        return 0.0 if numerator == 0 else math.copysign(math.inf, numerator)
    return numerator / math.sqrt(variance)


def _koopman_solve(x1, n1, x2, n2, target, lo, hi):
    for _ in range(200):  # bisection on log(phi); the statistic decreases in phi
        mid = (lo + hi) / 2.0
        if koopman_z(x1, n1, x2, n2, math.exp(mid)) > target:
            lo = mid
        else:
            hi = mid
        if hi - lo <= 1e-13:
            break
    return math.exp((lo + hi) / 2.0)


def koopman(x1, n1, x2, n2, z):
    estimate = (x1 / n1) / (x2 / n2)
    if z == 0.0:
        return estimate, estimate
    anchor = math.log(estimate) if x1 > 0 else -60.0
    lower = 0.0 if x1 == 0 else _koopman_solve(x1, n1, x2, n2, z, anchor - 60.0, anchor)
    upper = _koopman_solve(x1, n1, x2, n2, -z, anchor, anchor + 120.0)
    return lower, upper


def ratio_method(x1, n1, x2, n2):
    if x2 == 0:
        return None
    if x1 >= 1 and not (x1 == n1 and x2 == n2):
        return "katz_log"
    return "koopman_score"


def mover_mean(parts, z):
    """MOVER (Zou & Donner 2008) interval for the mean of independent proportions, Wilson limits."""
    k = len(parts)
    estimates = [x / n for x, n in parts]
    limits = [wilson(x, n, z) for x, n in parts]
    mean = sum(estimates) / k
    lower = mean - math.sqrt(sum((p - lo) ** 2 for p, (lo, _) in zip(estimates, limits))) / k
    upper = mean + math.sqrt(sum((hi - p) ** 2 for p, (_, hi) in zip(estimates, limits))) / k
    return lower, upper


def f1_from_j(j):
    return 2.0 * j / (1.0 + j)


def j_from_f1(f):
    return f / (2.0 - f)


def jaccard_f1(tp, m, z):
    lo, hi = wilson(tp, m, z)
    return f1_from_j(lo), f1_from_j(hi)


def per_class_z(z, k):
    """Critical value for each of k per-class intervals when the macro interval uses Bonferroni at the level of z."""
    tail = math.erfc(z / math.sqrt(2.0)) / 2.0  # 1 - Phi(z)
    return min(Z_MAX, -ND.inv_cdf(tail / k)) if tail / k > 0 else Z_MAX


def macro_f1_interval(classes, z):
    zk = per_class_z(z, len(classes)) if z > 0 else 0.0
    bounds = [jaccard_f1(tp, m, zk) for tp, m in classes]
    return sum(lo for lo, _ in bounds) / len(bounds), sum(hi for _, hi in bounds) / len(bounds)


def mean_bonferroni_wilson(parts, z):
    """Macro precision: per-class Wilson intervals at the Bonferroni level, averaged (conservative, any dependence)."""
    zk = per_class_z(z, len(parts)) if z > 0 else 0.0
    bounds = [wilson(x, n, zk) for x, n in parts]
    return sum(lo for lo, _ in bounds) / len(bounds), sum(hi for _, hi in bounds) / len(bounds)


def mean_sd(values):
    n = len(values)
    mean = math.fsum(values) / n
    sd = math.sqrt(math.fsum((v - mean) ** 2 for v in values) / (n - 1))
    return mean, sd


# ---------------------------------------------------------------- decision p-values
def direction_of(estimate, band):
    lower, upper = band.get("lower"), band.get("upper")
    if (lower is not None and on_boundary(estimate, lower)) or (upper is not None and on_boundary(estimate, upper)):
        return "none"
    if (lower is not None and estimate < lower) or (upper is not None and estimate > upper):
        return "fail"
    return "pass"


def invert(ci_at, band, direction):
    """z* = sup{z >= 0 : the interval at z decides `direction`}; bisection, normative for composite methods."""
    lower, upper = band.get("lower"), band.get("upper")

    def holds(z):
        lo, hi = ci_at(z)
        if direction == "pass":
            return (lower is None or lo >= lower) and (upper is None or hi <= upper)
        return (lower is not None and hi < lower) or (upper is not None and lo > upper)

    if not holds(0.0):
        return 0.0
    if holds(Z_MAX):
        return Z_MAX
    lo, hi = 0.0, Z_MAX
    while hi - lo > 1e-12:
        mid = (lo + hi) / 2.0
        if holds(mid):
            lo = mid
        else:
            hi = mid
    return lo


def wilson_zstar(x, n, band, direction):
    """Closed form: the Wilson interval is the inversion of the score test, z(T) = (p - T)/sqrt(T(1-T)/n)."""
    p = x / n
    lower, upper = band.get("lower"), band.get("upper")
    lower = None if lower is not None and lower <= 0.0 else lower
    upper = None if upper is not None and upper >= 1.0 else upper

    def score(t):
        return (p - t) / math.sqrt(t * (1.0 - t) / n)

    if direction == "pass":
        candidates = ([score(lower)] if lower is not None else []) + ([-score(upper)] if upper is not None else [])
        return min(candidates) if candidates else Z_MAX
    if lower is not None and p < lower:
        return -score(lower)
    return score(upper)


def log_zstar(estimate, se, band, direction):
    lower, upper = band.get("lower"), band.get("upper")
    le = math.log(estimate)
    if direction == "pass":
        candidates = ([(le - math.log(lower)) / se] if lower is not None else []) + ([(math.log(upper) - le) / se] if upper is not None else [])
        return min(candidates)
    if lower is not None and estimate < lower:
        return (math.log(lower) - le) / se
    return (le - math.log(upper)) / se


def koopman_zstar(x1, n1, x2, n2, band, direction):
    lower, upper = band.get("lower"), band.get("upper")
    if direction == "pass":
        candidates = ([koopman_z(x1, n1, x2, n2, lower)] if lower is not None else []) + ([-koopman_z(x1, n1, x2, n2, upper)] if upper is not None else [])
        return min(candidates)
    estimate = (x1 / n1) / (x2 / n2)
    if lower is not None and estimate < lower:
        return -koopman_z(x1, n1, x2, n2, lower)
    return koopman_z(x1, n1, x2, n2, upper)


def normal_zstar(mean, se, band, direction):
    lower, upper = band.get("lower"), band.get("upper")
    if direction == "pass":
        candidates = ([(mean - lower) / se] if lower is not None else []) + ([(upper - mean) / se] if upper is not None else [])
        return min(candidates)
    if lower is not None and mean < lower:
        return (lower - mean) / se
    return (mean - upper) / se


def square_band(band):
    return {"lower": None if band.get("lower") is None else band["lower"] ** 2, "upper": None if band.get("upper") is None else band["upper"] ** 2}


def jaccard_band(band):
    return {"lower": None if band.get("lower") is None else j_from_f1(band["lower"]), "upper": None if band.get("upper") is None else j_from_f1(band["upper"])}


def log_band(band):
    return {"lower": None if band.get("lower") is None else math.log(band["lower"]), "upper": None if band.get("upper") is None else math.log(band["upper"])}


# ---------------------------------------------------------------- exact test and multiplicity
def fisher_two_sided(x1, n1, x2, n2):
    """Two-sided Fisher exact p: sum of hypergeometric probabilities <= the observed one (exact integers)."""
    k_total = x1 + x2
    observed = math.comb(n1, x1) * math.comb(n2, x2)
    weights = [math.comb(n1, k) * math.comb(n2, k_total - k) for k in range(max(0, k_total - n2), min(k_total, n1) + 1)]
    return min(1.0, sum(w for w in weights if w <= observed) / sum(weights))


def fisher_greater(x, successes, draws, total):
    """One-sided Fisher exact p for positive association: P(X >= x) for X ~ Hypergeometric(total, successes, draws)
    (exact integers). It is the upper tail of the observed cell of a 2x2 table given both margins."""
    lo, hi = max(0, draws - (total - successes)), min(successes, draws)
    if x <= lo:
        return 1.0
    weights = [math.comb(successes, k) * math.comb(total - successes, draws - k) for k in range(lo, hi + 1)]
    return min(1.0, sum(weights[x - lo:]) / sum(weights))


def chance_exact_p(tables):
    """The chance gate of section 5.2: the one-sided Fisher p of each one-vs-rest table (tp, support, predicted, n),
    Bonferroni over the k tables when k >= 3 (binary data, and k = 2, have one table), on the two-sided scale."""
    tests = 1 if len(tables) <= 2 else len(tables)
    return min(1.0, 2.0 * tests * min(fisher_greater(tp, support, predicted, n) for tp, support, predicted, n in tables))


def chance_gated(band, chance):
    """Section 5.2: a balanced-accuracy member whose lower bound is at or above chance carries the chance gate."""
    lower = None if band is None else band.get("lower")
    return chance is not None and lower is not None and (lower > chance[0] or on_boundary(lower, chance[0]))


def bonferroni(pvalues):
    m = len(pvalues)
    return [min(1.0, m * p) for p in pvalues]


def benjamini_hochberg(pvalues):
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted, running = [1.0] * m, 1.0
    for rank in range(m - 1, -1, -1):
        i = order[rank]
        running = min(running, m * pvalues[i] / (rank + 1))
        adjusted[i] = min(1.0, running)
    return adjusted


# ---------------------------------------------------------------- canonical JSON (RFC 8785) and plan hash
def jcs_number(value):
    if isinstance(value, bool):
        raise TypeError("booleans are not numbers")
    if isinstance(value, int):
        if abs(value) > 2**53 - 1:
            raise ValueError("integer outside the I-JSON range")
        return str(value)
    if not math.isfinite(value):
        raise ValueError("non-finite number")
    if value == 0.0:
        return "0"
    if value < 0:
        return "-" + jcs_number(-value)
    text = repr(value)  # shortest round-trip digits, the same digits as ECMAScript Number::toString
    mantissa, _, exponent = text.partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = (whole + fraction).lstrip("0")
    leading = len(whole + fraction) - len(digits)
    digits = digits.rstrip("0")
    k = len(digits)
    n = len(whole) + (int(exponent) if exponent else 0) - leading  # value = 0.digits x 10^n
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    e = n - 1
    return digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def jcs(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return jcs_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(jcs(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))  # UTF-16 code-unit order
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + jcs(value[key]) for key in keys) + "}"
    raise TypeError(type(value))


def plan_sha256(plan):
    return hashlib.sha256(jcs(plan).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- plan normalisation, library and legacy derivation
def band_norm(band):
    return None if band is None else {"lower": band.get("lower"), "upper": band.get("upper")}


def library_band(entry_id, params):
    if entry_id in ("screen.us.four-fifths", "policy.eu-aia.impact-ratio"):
        return {"lower": params["tau"], "upper": 1.0 / params["tau"]}
    if entry_id in ("policy.eu-aia.selection-rate-difference", "policy.eu-aia.equalized-odds", "policy.eu-aia.calibration"):
        return {"lower": -params["delta"], "upper": params["delta"]}
    raise ValueError(entry_id)


def normalize_library(entry, criterion):
    if entry is None:
        return None
    spec = LIBRARY[entry["id"]]
    assert entry.get("version", spec["version"]) == spec["version"], "unknown library version"
    assert criterion["kind"] == spec["kind"] and spec["metric"] in (None, criterion.get("metric")), "criterion does not match its library entry"
    params = {}
    for name, rule in spec["parameters"].items():
        value = entry.get("parameters", {}).get(name, rule["default"])
        assert value is not None, f"library parameter {name} is required"
        assert ("enum" in rule and value in rule["enum"]) or ("enum" not in rule and rule["minimum"] <= value <= rule["maximum"]), f"library parameter {name} outside its range"
        params[name] = value
    overridden = sorted(name for name, rule in spec["parameters"].items() if params[name] != rule["default"])
    return {"id": entry["id"], "version": spec["version"], "parameters": params, "overriddenParameters": overridden}


def normalize_assumptions(criterion, assumptions):
    if assumptions is None:
        return None
    kind = criterion["kind"]
    if kind == "group_comparison":
        return {"groupSizes": dict(assumptions["groupSizes"]), "baselineRate": assumptions.get("baselineRate"), "assumedRates": assumptions.get("assumedRates"), "prevalence": assumptions.get("prevalence"), "truePositiveRate": assumptions.get("truePositiveRate"), "falsePositiveRate": assumptions.get("falsePositiveRate")}
    if kind == "performance":
        return {key: assumptions[key] for key in ("n", "prevalence", "truePositiveRate", "trueNegativeRate")}
    if kind == "multiclass_performance":
        assert abs(math.fsum(assumptions["classShares"].values()) - 1.0) <= 1e-9, "class shares must sum to 1"
        return {key: assumptions[key] for key in ("n", "classShares", "perClassRecall")}
    if kind == "regression_performance":
        return {key: assumptions[key] for key in ("n", "errorSd")}
    raise ValueError("power assumptions are not defined for " + kind)


def normalize_criterion(c):
    kind = c["kind"]
    out = {"id": c["id"], "kind": kind, "role": c.get("role", "confirmatory"), "rationale": c.get("rationale")}
    if kind in PERFORMANCE_KINDS:
        out["members"] = [{"metric": m["metric"], "band": band_norm(m["band"])} for m in c.get("members", [])]
    elif kind == "group_comparison":
        mode = c.get("comparison") or {"mode": "all_pairs"}
        out.update(metric=c["metric"], band=band_norm(c.get("band")), comparison={"mode": mode["mode"], "referenceGroup": mode.get("referenceGroup")}, groupFields=c.get("groupFields"), declaredGroups=c.get("declaredGroups"), minimumCoverage=c.get("minimumCoverage", 1.0))
    elif kind == "calibration":
        out.update(band=band_norm(c.get("band")), members=[{"metric": m["metric"], "band": band_norm(m["band"])} for m in c.get("members", [])], minimumCoverage=c.get("minimumCoverage", 1.0), subgroup=c.get("subgroup"))
    else:
        raise ValueError(kind)
    if kind in UNDECIDABLE:
        out["passBlockedBy"] = list(c.get("passBlockedBy", []))
        assert set(out["passBlockedBy"]) <= {UNDECIDABLE[kind]} and len(set(out["passBlockedBy"])) == len(out["passBlockedBy"]), "passBlockedBy names this kind's undecidable metric at most once"
    out["libraryEntry"] = normalize_library(c.get("libraryEntry"), out)
    if out["libraryEntry"] is not None and kind in ("group_comparison", "calibration"):
        expected = library_band(out["libraryEntry"]["id"], out["libraryEntry"]["parameters"])
        if out["band"] is None:
            out["band"] = expected
        assert out["band"] == expected, "the band must equal the one its library entry derives"
    out["powerAssumptions"] = normalize_assumptions(out, c.get("powerAssumptions"))
    return out


def normalize_plan(p):
    minimums = {key: p.get("minimums", {}).get(key, FLOORS[key]) for key in FLOORS}
    assert all(minimums[key] >= FLOORS[key] for key in FLOORS), "plan minimums below platform floors"
    multiplicity = {"confirmatory": "bonferroni", "exploratory": "benjamini_hochberg"}
    assert p.get("multiplicity", multiplicity) == multiplicity, "1.0.0 fixes the family adjustments"
    power = p.get("power", {})
    plan = {
        "statisticsVersion": p.get("statisticsVersion", SPEC_VERSION),
        "confidenceLevel": p.get("confidenceLevel", 0.95),
        "minimums": minimums,
        "configuredMinimums": p.get("configuredMinimums"),
        "multiplicity": multiplicity,
        "clusterField": p.get("clusterField"),
        "bootstrap": {"replicates": p.get("bootstrap", {}).get("replicates", 2000)},
        "calibrationBins": p.get("calibrationBins", 10),
        "power": {"targetPower": power.get("targetPower", 0.8), "acknowledgement": power.get("acknowledgement")},
        "derivedFrom": p.get("derivedFrom"),
        "criteria": [normalize_criterion(c) for c in p["criteria"]],
    }
    assert plan["statisticsVersion"] == SPEC_VERSION and plan["confidenceLevel"] in (0.90, 0.95, 0.99)
    ids = [c["id"] for c in plan["criteria"]]
    assert len(set(ids)) == len(ids), "criterion ids must be unique"
    assert plan["derivedFrom"] is not None or not any(c.get("passBlockedBy") for c in plan["criteria"]), "passBlockedBy occurs only in derived plans"
    return plan


def legacy_ratio_band(tau):
    return {"lower": tau, "upper": (1.0 / tau) if tau > 0 else None}


def target_label_count(data):
    """k for the multiclass chance baseline: the labels that occur in the target column (section 4.8)."""
    if data is None or "matrix" not in data:
        raise ValueError("a multiclass derivation reads the number of target labels from the data")
    return sum(1 for row in data["matrix"] if sum(row) > 0)


def chance_level(data):
    return 1.0 / max(2, target_label_count(data))


def derive_hosted(legacy, data=None):
    """Section 9: a hosted 1.1 profile (task, suite, config) without a stored plan."""
    task, suite, c = legacy["task"], legacy["suite"], legacy["config"]
    criteria = []
    for test in suite:
        if test == "performance" and task == "Binary classification":
            criteria.append({"id": "performance", "kind": "performance", "members": [{"metric": "accuracy", "band": {"lower": c["minimumAccuracy"]}}, {"metric": "recall", "band": {"lower": c.get("minimumRecall", 0.7)}}, {"metric": "balanced_accuracy", "band": {"lower": 0.5}}]})
        elif test == "performance":
            criteria.append({"id": "performance", "kind": "multiclass_performance", "members": [{"metric": "accuracy", "band": {"lower": c["minimumAccuracy"]}}, {"metric": "balanced_accuracy", "band": {"lower": chance_level(data)}}, {"metric": "macro_f1", "band": {"lower": c.get("minimumMacroF1", 0.7)}}]})
        elif test == "regression":
            criteria.append({"id": "regression", "kind": "regression_performance", "members": [{"metric": "rmse", "band": {"upper": c.get("maximumRmse", 1.0)}}]})
        elif test == "demographic_parity":
            criteria.append({"id": test, "kind": "group_comparison", "metric": "selection_rate_difference", "band": {"lower": -c["maximumParityGap"], "upper": c["maximumParityGap"]}})
        elif test == "disparate_impact":
            criteria.append({"id": test, "kind": "group_comparison", "metric": "selection_rate_ratio", "band": legacy_ratio_band(c["minimumImpactRatio"])})
        elif test == "equalized_odds":
            delta = c.get("maximumOddsGap", c["maximumParityGap"])
            criteria.append({"id": test, "kind": "group_comparison", "metric": "equalized_odds", "band": {"lower": -delta, "upper": delta}})
    configured = {"sampleSize": c.get("minimumSampleSize", 20), "groupSize": c["minimumGroupSize"], "classCount": c.get("minimumClassCount", 5)}
    return {"minimums": {key: max(FLOORS[key], configured[key]) for key in FLOORS}, "configuredMinimums": configured, "derivedFrom": {"source": "hosted_config", "contractVersion": "1.1"}, "criteria": criteria}


def derive_engine(legacy, data=None):
    """Section 9: an engine 1.0 configuration whose thresholds.values define the criteria."""
    c = legacy["config"]
    task, suites, values = c["task"], c["suite"], c["thresholds"]["values"]

    def band_of(name):
        rule = values[name]
        return {"lower": rule["value"], "upper": None} if rule["operator"] == ">=" else {"lower": None, "upper": rule["value"]}

    def baseline(name, chance):
        """The chance baseline: lower bound max(chance, the policy's own lower bound); a policy upper bound is kept."""
        rule = values.get(name)
        if rule is None:
            return {"lower": chance, "upper": None}
        return {"lower": max(chance, rule["value"]), "upper": None} if rule["operator"] == ">=" else {"lower": chance, "upper": rule["value"]}

    def classification_members(order, chance, aliases=None):
        """Members in standard order; the balanced-accuracy baseline joins whenever the policy sets any of them."""
        aliases = aliases or {}
        if not any(aliases.get(metric, metric) in values for metric in order):
            return []
        return [{"metric": metric, "band": baseline(aliases.get(metric, metric), chance) if metric == "balanced_accuracy" else band_of(aliases.get(metric, metric))} for metric in order if metric == "balanced_accuracy" or aliases.get(metric, metric) in values]

    def members_for(order):
        return [{"metric": metric, "band": band_of(metric)} for metric in order if metric in values]

    criteria = []
    if "performance" in suites:
        if task == "binary_classification":
            criteria.append({"id": "PERF-BINARY", "kind": "performance", "members": classification_members(BINARY_METRICS, 0.5)})
            if c.get("columns", {}).get("score"):
                criteria.append({"id": "PERF-CAL", "kind": "calibration", "band": None, "members": members_for(("brier_score",)), "passBlockedBy": [UNDECIDABLE["calibration"]]})
        elif task == "multiclass_classification":
            criteria.append({"id": "PERF-MULTI", "kind": "multiclass_performance", "members": classification_members(MULTICLASS_METRICS, chance_level(data), {"balanced_accuracy": "macro_recall"})})
        else:
            criteria.append({"id": "PERF-REG", "kind": "regression_performance", "members": members_for(REGRESSION_METRICS), "passBlockedBy": [UNDECIDABLE["regression_performance"]]})
    if "fairness" in suites and task == "binary_classification":
        for cid, metric, key in (("FAIR-DP", "selection_rate_difference", "demographic_parity_difference"), ("FAIR-DI", "selection_rate_ratio", "disparate_impact_ratio"), ("FAIR-EO", "equalized_odds", "equalized_odds_difference")):
            rule = values.get(key)
            band = None if rule is None else legacy_ratio_band(rule["value"]) if metric == "selection_rate_ratio" else {"lower": -rule["value"], "upper": rule["value"]}
            criteria.append({"id": cid, "kind": "group_comparison", "metric": metric, "band": band})
    configured = {"sampleSize": c.get("minSampleSize", 30), "groupSize": c.get("minGroupSize", 30), "classCount": c.get("minClassCount", 10)}
    return {"minimums": {key: max(FLOORS[key], configured[key]) for key in FLOORS}, "configuredMinimums": configured, "derivedFrom": {"source": "engine_thresholds", "contractVersion": c["contractVersion"]}, "criteria": criteria}


def plan_for(case):
    if "legacy" not in case:
        return normalize_plan(case["plan"])
    legacy = case["legacy"]
    return normalize_plan((derive_hosted if legacy["source"] == "hosted_config" else derive_engine)(legacy, case.get("data")))


# ---------------------------------------------------------------- members
def escape_label(label):
    return label.replace("\\", "\\\\").replace("|", "\\|")


def member_id(metric, subject=None, comparator=None):
    return metric if subject is None else f"{metric}:{escape_label(subject)}|{escape_label(comparator)}"


def member(metric, band, estimate, method, ci_at, zstar_closed=None, *, subject=None, comparator=None, counts=None, status="evaluated", reasons=(), small_cell=False, fisher=None, chance=None, level=0.95, descriptive=False):
    out = {"memberId": member_id(metric, subject, comparator), "metric": metric, "subject": subject, "comparator": comparator, "counts": counts, "estimate": estimate, "interval": None, "band": None if descriptive else band, "status": status, "direction": "none", "pValue": None if descriptive else 1.0, "smallCell": small_cell, "fisherExactP": fisher, "chanceExactP": None, "reasons": list(reasons)}
    if estimate is None or ci_at is None:
        return out
    if not descriptive and chance_gated(band, chance):
        out["chanceExactP"] = chance_exact_p(chance[1])
    lo, hi = ci_at(zcrit(level))
    out["interval"] = {"lower": lo, "upper": hi, "level": level, "method": method}
    out["_ci_at"] = ci_at
    if descriptive or status != "evaluated":
        return out
    direction = direction_of(estimate, band)
    out["direction"] = direction
    if direction == "none":
        out["reasons"].append("estimate_on_band_boundary")
        return out
    zs = invert(ci_at, band, direction)
    if zstar_closed is not None:
        closed = zstar_closed(direction)
        assert abs(min(closed, Z_MAX) - zs) <= 1e-8 * max(1.0, zs), (metric, closed, zs)
        zs = min(closed, Z_MAX)
    out["pValue"] = p_from_z(zs)
    out["_pInterval"] = out["pValue"]
    if small_cell and direction == "fail" and fisher is not None:
        out["pValue"] = max(out["pValue"], fisher)
    if direction == "pass" and out["chanceExactP"] is not None:  # the chance gate (section 5.2) gates passes only
        out["pValue"] = max(out["pValue"], out["chanceExactP"])
    return out


class Stat:
    """Estimate, interval method and support status of one single-sample metric. `chance` is (chance level,
    one-vs-rest tables) for balanced accuracy and macro recall, which the chance gate needs (section 5.2)."""
    def __init__(self, estimate, method, ci_at, closed, counts, status="evaluated", reasons=(), chance=None):
        self.estimate, self.method, self.ci_at, self.closed, self.counts, self.status, self.reasons, self.chance = estimate, method, ci_at, closed, counts, status, list(reasons), chance


def support(n, minimum, reason="below_minimum_class_count"):
    return ("evaluated", []) if n >= minimum else ("insufficient_support", [reason])


def stat_entry(metric, band, stat, level, descriptive=False):
    closed = None if descriptive or stat.closed is None else stat.closed(band)
    return member(metric, band, stat.estimate, stat.method, stat.ci_at, closed, counts=stat.counts, status=stat.status, reasons=stat.reasons, chance=stat.chance, level=level, descriptive=descriptive)


def wilson_stat(x, n, minimum, zero_reason, short_reason="below_minimum_class_count"):
    counts = {"x": x, "n": n}
    if n == 0:
        return Stat(None, "wilson", None, None, counts, "undefined", [zero_reason])
    return Stat(x / n, "wilson", lambda z: wilson(x, n, z), lambda band: (lambda d: wilson_zstar(x, n, band, d)), counts, *support(n, minimum, short_reason))


def binary_stat(metric, cm, mins):
    tp, fp, fn, tn = cm["tp"], cm["fp"], cm["fn"], cm["tn"]
    pos, neg, total = tp + fn, fp + tn, tp + fp + fn + tn
    cls = mins["classCount"]
    if metric == "accuracy":
        return wilson_stat(tp + tn, total, mins["sampleSize"], "undefined_zero_denominator", "below_minimum_sample_size")
    if metric == "precision":
        return wilson_stat(tp, tp + fp, cls, "undefined_zero_denominator")
    if metric == "recall":
        return wilson_stat(tp, pos, cls, "single_class")
    if metric == "specificity":
        return wilson_stat(tn, neg, cls, "single_class")
    if metric == "false_positive_rate":
        return wilson_stat(fp, neg, cls, "single_class")
    if metric == "balanced_accuracy":
        counts = {"tp": tp, "positives": pos, "tn": tn, "negatives": neg}
        if pos == 0 or neg == 0:
            return Stat(None, "mover_wilson", None, None, counts, "undefined", ["single_class"])
        return Stat((tp / pos + tn / neg) / 2.0, "mover_wilson", lambda z: mover_mean([(tp, pos), (tn, neg)], z), None, counts, *support(min(pos, neg), cls), chance=(0.5, [(tp, pos, tp + fp, total)]))
    if metric == "f1":
        m = tp + fp + fn
        counts = {"tp": tp, "tpPlusFpPlusFn": m, "positives": pos}
        if pos == 0:
            return Stat(None, "jaccard_wilson", None, None, counts, "undefined", ["single_class"])
        return Stat(2.0 * tp / (2 * tp + fp + fn), "jaccard_wilson", lambda z: jaccard_f1(tp, m, z), lambda band: (lambda d: wilson_zstar(tp, m, jaccard_band(band), d)), counts, *support(pos, cls))
    raise ValueError(metric)


def multiclass_stat(metric, data, mins):
    labels, matrix = data["labels"], data["matrix"]
    k, total = len(labels), sum(map(sum, matrix))
    supports = [sum(matrix[i]) for i in range(k)]
    predicted = [sum(matrix[r][i] for r in range(k)) for i in range(k)]
    tps = [matrix[i][i] for i in range(k)]
    cls = mins["classCount"]
    if metric == "accuracy":
        return wilson_stat(sum(tps), total, mins["sampleSize"], "undefined_zero_denominator", "below_minimum_sample_size")
    if metric == "balanced_accuracy":
        parts = list(zip(tps, supports))
        counts = {"perClass": [{"label": label, "tp": x, "support": n, "predicted": m} for label, (x, n), m in zip(labels, parts, predicted)]}
        if min(supports) == 0 or k < 2:
            return Stat(None, "mover_wilson", None, None, counts, "undefined", ["single_class"])
        tables = [(tps[i], supports[i], predicted[i], total) for i in range(k)]
        return Stat(sum(x / n for x, n in parts) / k, "mover_wilson", lambda z: mover_mean(parts, z), None, counts, *support(min(supports), cls), chance=(1.0 / k, tables))
    if metric == "macro_f1":
        classes = [(tps[i], supports[i] + predicted[i] - tps[i]) for i in range(k)]
        counts = {"perClass": [{"label": label, "tp": x, "tpPlusFpPlusFn": m} for label, (x, m) in zip(labels, classes)]}
        if min(supports) == 0 or k < 2:
            return Stat(None, "jaccard_wilson_bonferroni", None, None, counts, "undefined", ["single_class"])
        estimate = sum(2 * tps[i] / (supports[i] + predicted[i]) for i in range(k)) / k
        return Stat(estimate, "jaccard_wilson_bonferroni", lambda z: macro_f1_interval(classes, z), None, counts, *support(min(supports), cls))
    if metric == "macro_precision":
        parts = list(zip(tps, predicted))
        counts = {"perClass": [{"label": label, "tp": x, "predicted": n} for label, (x, n) in zip(labels, parts)]}
        if k < 2:
            return Stat(None, "wilson_bonferroni_mean", None, None, counts, "undefined", ["single_class"])
        if min(predicted) == 0:
            return Stat(None, "wilson_bonferroni_mean", None, None, counts, "undefined", ["undefined_zero_denominator"])
        return Stat(sum(x / n for x, n in parts) / k, "wilson_bonferroni_mean", lambda z: mean_bonferroni_wilson(parts, z), None, counts, *support(min(predicted), cls))
    raise ValueError(metric)


def regression_stat(metric, data, mins):
    errors = data["errors"]
    n = len(errors)
    status = support(n, mins["sampleSize"], "below_minimum_sample_size")
    if metric == "r2":
        targets = data.get("targets", [0.0] * n)
        mean_t = math.fsum(targets) / n
        sst = math.fsum((t - mean_t) ** 2 for t in targets)
        if sst == 0.0:
            return Stat(None, None, None, None, {"n": n}, "undefined", ["undefined_zero_denominator"])
        return Stat(1.0 - math.fsum(e * e for e in errors) / sst, None, None, None, {"n": n}, *status)
    values = [abs(e) for e in errors] if metric == "mae" else [e * e for e in errors]
    mean, sd = mean_sd(values)
    se = sd / math.sqrt(n)
    if metric == "mae":
        counts = {"n": n, "meanAbsoluteError": mean, "sdAbsoluteError": sd}
        if se == 0.0:
            return Stat(mean, "normal_approximation", None, None, counts, "undefined", ["degenerate_interval"])
        return Stat(mean, "normal_approximation", lambda z: (max(0.0, mean - z * se), mean + z * se), lambda band: (lambda d: normal_zstar(mean, se, band, d)), counts, *status)
    counts = {"n": n, "meanSquaredError": mean, "sdSquaredError": sd}
    if se == 0.0:
        return Stat(math.sqrt(mean), "normal_approximation_mse", None, None, counts, "undefined", ["degenerate_interval"])
    return Stat(math.sqrt(mean), "normal_approximation_mse", lambda z: (math.sqrt(max(0.0, mean - z * se)), math.sqrt(mean + z * se)), lambda band: (lambda d: normal_zstar(mean, se, square_band(band), d)), counts, *status)


def rate_counts(key, g):
    if g is None:
        return 0, 0
    if "selected" in g:
        if key != "selection":
            raise ValueError("selection-only data cannot give TPR or FPR")
        return g["selected"], g["n"]
    tp, fp, fn, tn = g["tp"], g["fp"], g["fn"], g["tn"]
    return {"selection": (tp + fp, tp + fp + fn + tn), "tpr": (tp, tp + fn), "fpr": (fp, fp + tn)}[key]


def rate_entry(x, n, level):
    if n == 0:
        return {"x": 0, "n": 0, "estimate": None, "interval": None}
    lo, hi = wilson(x, n, zcrit(level))
    return {"x": x, "n": n, "estimate": x / n, "interval": {"lower": lo, "upper": hi, "level": level, "method": "wilson"}}


def pair_member(metric, subject, comparator, s, c, band, mins, level, suppressed=False):
    (xs, ns), (xc, nc) = s, c
    counts = {"subject": {"x": xs, "n": ns}, "comparator": {"x": xc, "n": nc}}
    cells = (xs, ns - xs, xc, nc - xc)
    small = min(cells) < 5
    if ns == 0 or nc == 0:
        reason = "single_class" if metric in ("tpr_difference", "fpr_difference") else "undefined_zero_denominator"
        return member(metric, band, None, "newcombe_hybrid_score", None, subject=subject, comparator=comparator, counts=counts, status="suppressed" if suppressed else "undefined", reasons=[reason], level=level)
    minimum = mins["classCount"] if metric in ("tpr_difference", "fpr_difference") else mins["groupSize"]
    if suppressed:
        status, reasons = "suppressed", ["group_below_minimum_size"]
    else:
        status, reasons = support(min(ns, nc), minimum)
    fisher = fisher_two_sided(xs, ns, xc, nc) if small else None
    if metric == "selection_rate_ratio":
        method = ratio_method(xs, ns, xc, nc)
        if method is None:
            return member(metric, band, None, "katz_log", None, subject=subject, comparator=comparator, counts=counts, status="undefined", reasons=["undefined_zero_denominator"], small_cell=small, level=level)
        estimate = (xs / ns) / (xc / nc)
        if method == "katz_log":
            se = math.sqrt(1 / xs - 1 / ns + 1 / xc - 1 / nc)
            return member(metric, band, estimate, method, lambda z: katz(xs, ns, xc, nc, z), lambda d: log_zstar(estimate, se, band, d), subject=subject, comparator=comparator, counts=counts, status=status, reasons=reasons, small_cell=small, fisher=fisher, level=level)
        return member(metric, band, estimate, method, lambda z: koopman(xs, ns, xc, nc, z), lambda d: koopman_zstar(xs, ns, xc, nc, band, d), subject=subject, comparator=comparator, counts=counts, status=status, reasons=reasons, small_cell=small, fisher=fisher, level=level)
    return member(metric, band, xs / ns - xc / nc, "newcombe_hybrid_score", lambda z: newcombe(xs, ns, xc, nc, z), subject=subject, comparator=comparator, counts=counts, status=status, reasons=reasons, small_cell=small, fisher=fisher, level=level)


def group_rows(g):
    return g["n"] if "n" in g else g["tp"] + g["fp"] + g["fn"] + g["tn"]


def group_members(spec, data, mins, level):
    groups = {g["group"]: g for g in data["groups"]}
    declared = spec["declaredGroups"] or []
    names = sorted(set(groups) | set(declared), key=code_point_key)
    size = {name: group_rows(groups[name]) if name in groups else 0 for name in names}
    present = [name for name in names if size[name] > 0]
    eligible = [name for name in present if size[name] >= mins["groupSize"]]
    suppressed = [{"group": name, "n": size[name]} for name in names if size[name] < mins["groupSize"]]
    unknown = data.get("unknownGroupRows", 0)
    population = sum(size.values()) + unknown
    eligible_rows = sum(size[name] for name in eligible)
    coverage = {"eligibleRows": eligible_rows, "populationRows": population, "unknownGroupRows": unknown, "value": eligible_rows / population if population else 0.0, "minimum": spec["minimumCoverage"]}
    metrics = ["tpr_difference", "fpr_difference"] if spec["metric"] == "equalized_odds" else [spec["metric"]]
    keys = list(dict.fromkeys(RATE_KEYS[metric] for metric in metrics))
    per_group = [{"group": name, "n": size[name], "declared": name in declared, "suppressed": size[name] < mins["groupSize"], **{key: rate_entry(*rate_counts(key, groups.get(name)), level) for key in keys}} for name in names]
    band, mode = spec["band"], spec["comparison"]
    members, reasons, blocked = [], [], False
    if len(names) > MAX_GROUPS[mode["mode"]]:
        reasons.append("too_many_groups")
        blocked = True
    elif band is not None:
        for metric in metrics:
            key = RATE_KEYS[metric]
            if mode["mode"] == "reference":
                ref = mode["referenceGroup"]
                pairs = [(name, ref) for name in present if name != ref] if ref in present else []
            else:
                pairs = []
                for i, a in enumerate(present):
                    for b in present[i + 1:]:
                        (xa, na), (xb, nb) = rate_counts(key, groups[a]), rate_counts(key, groups[b])
                        rate_a = xa / na if na else math.inf  # an undefined rate sorts as +infinity
                        rate_b = xb / nb if nb else math.inf
                        pairs.append((b, a) if rate_b < rate_a else (a, b))
            for s, c in pairs:
                members.append(pair_member(metric, s, c, rate_counts(key, groups[s]), rate_counts(key, groups[c]), band, mins, level, suppressed=s not in eligible or c not in eligible))
    if suppressed:
        reasons.append("group_suppressed_below_minimum")
    if declared and any(size[name] == 0 for name in declared):
        reasons.append("empty_declared_group")
        blocked = True
    if coverage["value"] < coverage["minimum"] - EPS:
        reasons.append("insufficient_coverage")
        blocked = True
    if len(eligible) < 2 or (mode["mode"] == "reference" and mode["referenceGroup"] not in eligible):
        reasons.append("insufficient_groups")
        blocked = True
    context = {"sampleSize": sum(size.values()), "suppressedGroups": suppressed, "coverage": coverage, "passBlocked": blocked, "reasons": reasons, "scale": "log" if spec["metric"] == "selection_rate_ratio" else "linear", "headlineMetric": spec["metric"], "groups": per_group, "descriptive": []}
    return members, context


def calibration_members(spec, data, mins, level):
    if spec["members"]:
        raise NotImplementedError("Brier members need row-level scores; no golden case uses them")
    band, members, eligible_rows, per_bin = spec["band"], [], 0, []
    total = sum(b["n"] for b in data["bins"])
    for b in data["bins"]:
        x, n, s = b["positives"], b["n"], b["meanScore"]
        per_bin.append({"group": f"bin{b['bin']}", "n": n, "declared": False, "suppressed": n < mins["groupSize"], "observed": rate_entry(x, n, level), "meanScore": s})
        if n < mins["groupSize"]:
            continue
        eligible_rows += n
        if band is None:
            continue
        pband = {"lower": None if band.get("lower") is None else s + band["lower"], "upper": None if band.get("upper") is None else s + band["upper"]}
        m = member("calibration_gap", band, x / n - s, "wilson", lambda z, x=x, n=n, s=s: tuple(v - s for v in wilson(x, n, z)), lambda d, x=x, n=n, pb=pband: wilson_zstar(x, n, pb, d), counts={"x": x, "n": n, "meanScore": s}, level=level)
        m["memberId"] = f"calibration_gap:bin{b['bin']}"
        m["subject"] = f"bin{b['bin']}"
        members.append(m)
    ece = sum(b["n"] / total * abs(b["positives"] / b["n"] - b["meanScore"]) for b in data["bins"] if b["n"])
    descriptive = [member("expected_calibration_error", None, ece, "percentile_bootstrap", None, counts={"n": total, "bins": len(data["bins"])}, level=level, descriptive=True)]
    coverage = {"eligibleRows": eligible_rows, "populationRows": total, "unknownGroupRows": 0, "value": eligible_rows / total, "minimum": spec["minimumCoverage"]}
    blocked = coverage["value"] < coverage["minimum"] - EPS
    suppressed = [{"group": f"bin{b['bin']}", "n": b["n"]} for b in data["bins"] if b["n"] < mins["groupSize"]]
    reasons = (["group_suppressed_below_minimum"] if suppressed else []) + (["insufficient_coverage"] if blocked else [])
    return members, {"sampleSize": total, "suppressedGroups": suppressed, "coverage": coverage, "passBlocked": blocked, "reasons": reasons, "scale": "linear", "headlineMetric": "calibration", "groups": per_bin, "descriptive": descriptive}


# ---------------------------------------------------------------- criteria and plans
def headline(members, context, level):
    alpha = 1.0 - level
    pool = [m for m in members if m["status"] != "suppressed"]
    evaluable = [m for m in pool if m["status"] == "evaluated"]
    if not evaluable or "headlineMetric" not in context:
        return None
    band = evaluable[0]["band"]
    log = context["scale"] == "log"
    tr = (lambda v: math.log(v) if v > 0 else -math.inf) if log else (lambda v: v)
    lower, upper = band.get("lower"), band.get("upper")
    z_nom, z_bon = zcrit(level), zcrit(1.0 - alpha / len(evaluable))
    complete = all(m["status"] == "evaluated" for m in pool)
    names = HEADLINE_NAMES[context["headlineMetric"]]

    def dev(m, z):
        lo, hi = m["_ci_at"](z)
        return tr(lo), tr(hi)

    def out(value, lo, hi, headline_band):
        return {"names": names, "estimate": value, "interval": {"lower": lo, "upper": hi, "level": level, "method": "worst_member_bounds"}, "band": headline_band}

    # A pass-side bound that cannot be computed (some pool member is not evaluated) is reported as the
    # statistic's natural limit, which is valid but uninformative: 1 for a gap, 0 for a ratio.
    if lower is not None and upper is not None:
        def abs_bounds(lo, hi):
            return max(0.0, lo, -hi), max(abs(lo), abs(hi))
        value = max(abs(tr(m["estimate"])) for m in evaluable)
        fail_side = max(abs_bounds(*dev(m, z_bon))[0] for m in evaluable)
        pass_side = max(abs_bounds(*dev(m, z_nom))[1] for m in evaluable) if complete else math.inf
        if log:
            return out(math.exp(-value), math.exp(-pass_side), math.exp(-fail_side), {"lower": lower, "upper": None})
        return out(value, fail_side, min(pass_side, 1.0), {"lower": None, "upper": upper})
    if log:  # one-sided ratio band {lower: tau} (reference mode): the smallest ratio
        value = min(tr(m["estimate"]) for m in evaluable)
        pass_side = min(dev(m, z_nom)[0] for m in evaluable) if complete else -math.inf
        fail_side = min(dev(m, z_bon)[1] for m in evaluable)
        return out(math.exp(value), math.exp(pass_side), math.exp(fail_side), {"lower": lower, "upper": None})
    # One-sided difference band (reference mode): the largest gap in the constrained direction,
    # -d for {lower: -delta} and +d for {upper: delta}, so the headline band is always {upper: delta}.
    sign = -1.0 if lower is not None else 1.0

    def gap(m, z):
        lo, hi = m["_ci_at"](z)
        return (lo, hi) if sign > 0 else (-hi, -lo)

    value = max(sign * m["estimate"] for m in evaluable)
    fail_side = max(gap(m, z_bon)[0] for m in evaluable)
    pass_side = max(gap(m, z_nom)[1] for m in evaluable) if complete else 1.0
    return out(value, fail_side, min(pass_side, 1.0), {"lower": None, "upper": upper if sign > 0 else -lower})


def library_view(entry):
    if entry is None:
        return None
    spec = LIBRARY[entry["id"]]
    return {"id": entry["id"], "version": entry["version"], "legalStatus": spec["legalStatus"], "caveat": spec["caveat"]}


def evaluate_criterion(spec, data, level, mins):
    alpha = 1.0 - level
    kind = spec["kind"]
    descriptive, groups = [], None
    if kind == "performance":
        cm = {k: sum(g[k] for g in data["groups"]) + data.get("unknownGroup", {}).get(k, 0) for k in ("tp", "fp", "fn", "tn")}
        planned = [item["metric"] for item in spec["members"]]
        members = [stat_entry(item["metric"], item["band"], binary_stat(item["metric"], cm, mins), level) for item in spec["members"]]
        descriptive = [stat_entry(metric, None, binary_stat(metric, cm, mins), level, descriptive=True) for metric in BINARY_DESCRIPTIVE if metric not in planned]
        context = {"sampleSize": sum(cm.values()), "passBlocked": False, "reasons": []}
    elif kind == "multiclass_performance":
        planned = [item["metric"] for item in spec["members"]]
        members = [stat_entry(item["metric"], item["band"], multiclass_stat(item["metric"], data, mins), level) for item in spec["members"]]
        descriptive = [stat_entry(metric, None, multiclass_stat(metric, data, mins), level, descriptive=True) for metric in MULTICLASS_METRICS if metric not in planned]
        context = {"sampleSize": sum(map(sum, data["matrix"])), "passBlocked": False, "reasons": []}
    elif kind == "regression_performance":
        planned = [item["metric"] for item in spec["members"]]
        members = [stat_entry(item["metric"], item["band"], regression_stat(item["metric"], data, mins), level) for item in spec["members"]]
        descriptive = [stat_entry(metric, None, regression_stat(metric, data, mins), level, descriptive=True) for metric in REGRESSION_DESCRIPTIVE if metric not in planned]
        context = {"sampleSize": len(data["errors"]), "passBlocked": False, "reasons": []}
    elif kind == "group_comparison":
        members, context = group_members(spec, data, mins, level)
        groups = context["groups"]
    elif kind == "calibration":
        members, context = calibration_members(spec, data, mins, level)
        groups, descriptive = context["groups"], context["descriptive"]
    else:
        raise ValueError(kind)
    reasons = list(context["reasons"])
    if (kind in PERFORMANCE_KINDS and not spec["members"]) or (kind in ("group_comparison", "calibration") and spec["band"] is None and not spec.get("members")):
        reasons.append("no_threshold")
    if spec.get("passBlockedBy"):  # section 4.8: a metric today's rule needs and 1.0.0 cannot decide blocks a pass
        context["passBlocked"] = True
        reasons.append("undecidable_metric")
        for entry in descriptive:
            if entry["metric"] in spec["passBlockedBy"]:
                entry["reasons"].append("undecidable_metric")
    gated = context["sampleSize"] < mins["sampleSize"]
    if gated:
        reasons.insert(0, "below_minimum_sample_size")
    pool = [m for m in members if m["status"] != "suppressed"]
    evaluable = [m for m in pool if m["status"] == "evaluated"]
    fails = [m for m in evaluable if m["direction"] == "fail"]
    deciding = None
    if gated or not evaluable:
        direction, p = "none", 1.0
    elif fails:
        direction = "fail"
        deciding = min(fails, key=lambda m: (m["pValue"], code_point_key(m["memberId"])))
        p = min(1.0, len(evaluable) * deciding["pValue"])
        ungated = min(1.0, len(evaluable) * min(m.get("_pInterval", m["pValue"]) for m in fails))
        if p > alpha + EPS and ungated <= alpha + EPS:
            reasons.append("small_cell_exact_test_not_significant")
        elif p > alpha + EPS and deciding["pValue"] <= alpha + EPS:
            reasons.append("within_criterion_multiplicity")
        elif p > alpha + EPS:
            reasons.append("interval_straddles_band")
    else:
        complete = bool(pool) and all(m["status"] == "evaluated" and m["direction"] == "pass" for m in pool)
        direction = "pass" if any(m["direction"] == "pass" for m in evaluable) else "none"
        if complete and not context["passBlocked"]:
            deciding = min(pool, key=lambda m: (-m["pValue"], code_point_key(m["memberId"])))
            p = deciding["pValue"]
            if p > alpha + EPS:
                ungated = max(m["_pInterval"] for m in pool)  # without the chance gate of section 5.2
                reasons.append("chance_exact_test_not_significant" if ungated <= alpha + EPS else "interval_straddles_band")
        else:
            p = 1.0
    for m in pool:
        for r in m["reasons"]:
            if r not in reasons:
                reasons.append(r)
    decision = {"statisticsVersion": SPEC_VERSION, "confidenceLevel": level, "role": spec["role"], "kind": kind, "direction": direction, "pValue": p, "adjustedPValue": None, "adjustment": None, "familySize": None, "unadjustedOutcome": direction if direction in ("pass", "fail") and p <= alpha + EPS else "inconclusive", "decidingMemberId": deciding["memberId"] if deciding else None, "sampleSize": context["sampleSize"], "coverage": context.get("coverage"), "suppressedGroups": context.get("suppressedGroups"), "libraryEntry": library_view(spec["libraryEntry"]), "reasons": reasons}
    return {"id": spec["id"], "outcome": None, "headline": headline(members, context, level) if kind in ("group_comparison", "calibration") else None, "members": members, "descriptive": descriptive, "groups": groups, "decision": decision}


def aggregate(outcomes):
    for state in ("fail", "inconclusive", "pass"):
        if state in outcomes:
            return state
    return "not_applicable"


def evaluate_plan(plan, data):
    level = plan["confidenceLevel"]
    alpha = 1.0 - level
    results = [evaluate_criterion(c, data, level, plan["minimums"]) for c in plan["criteria"]]
    for role, method, adjust in (("confirmatory", "bonferroni", bonferroni), ("exploratory", "benjamini_hochberg", benjamini_hochberg)):
        family = [r for r in results if r["decision"]["role"] == role]
        for r, adjusted in zip(family, adjust([r["decision"]["pValue"] for r in family])):
            d = r["decision"]
            d["adjustedPValue"], d["adjustment"], d["familySize"] = adjusted, method, len(family)
            r["outcome"] = d["direction"] if d["direction"] in ("pass", "fail") and adjusted <= alpha + EPS else "inconclusive"
            if d["unadjustedOutcome"] != "inconclusive" and r["outcome"] == "inconclusive":
                d["reasons"].append("multiplicity_adjustment")
    confirmatory = [r["outcome"] for r in results if r["decision"]["role"] == "confirmatory"]
    return {"planSha256": plan_sha256(plan), "normalizedPlan": plan, "criteria": results, "overallOutcome": aggregate(confirmatory), "reviewFlags": [r["id"] for r in results if r["decision"]["role"] == "exploratory" and r["outcome"] == "fail"]}


# ---------------------------------------------------------------- power (normal approximations at assumed true values)
def two_sides(terms):
    return terms[0] if len(terms) == 1 else max(0.0, terms[0] + terms[1] - 1.0)


def proportion_probs(p, n, band, z):
    """Pass and fail probability of the Wilson (score-test) rule for a true proportion p with denominator n."""
    s = math.sqrt(p * (1.0 - p) / n)
    lower, upper = band.get("lower"), band.get("upper")
    passing, failing = [], 0.0
    if lower is not None:
        edge = lower + z * math.sqrt(lower * (1.0 - lower) / n)
        passing.append(phi((p - edge) / s))
        failing += phi((lower - z * math.sqrt(lower * (1.0 - lower) / n) - p) / s)
    if upper is not None:
        edge = upper - z * math.sqrt(upper * (1.0 - upper) / n)
        passing.append(phi((edge - p) / s))
        failing += phi((p - upper - z * math.sqrt(upper * (1.0 - upper) / n)) / s)
    return two_sides(passing), failing


def normal_probs(theta, se, band, z):
    """Pass and fail probability of an interval theta-hat +/- z*se (normal approximation) against a band."""
    lower, upper = band.get("lower"), band.get("upper")
    passing, failing = [], 0.0
    if lower is not None:
        passing.append(phi((theta - lower) / se - z))
        failing += phi((lower - theta) / se - z)
    if upper is not None:
        passing.append(phi((upper - theta) / se - z))
        failing += phi((theta - upper) / se - z)
    return two_sides(passing), failing


def assumed(value, group):
    return value[group] if isinstance(value, dict) else value


def power_model(member_id_, metric, value, denominator, probs, supported, computed=True, subject=None, comparator=None):
    return {"memberId": member_id_, "metric": metric, "subject": subject, "comparator": comparator, "assumedValue": value, "denominator": denominator, "probs": probs, "supported": supported, "computed": computed}


def performance_models(crit, a, n, mins):
    cls, models = mins["classCount"], []
    if crit["kind"] == "performance":
        pi, tpr, tnr = a["prevalence"], a["truePositiveRate"], a["trueNegativeRate"]
        positives, negatives = n * pi, n * (1.0 - pi)
        predicted = n * (pi * tpr + (1.0 - pi) * (1.0 - tnr))
        union = n * (pi + (1.0 - pi) * (1.0 - tnr))  # expected TP + FP + FN
        for item in crit["members"]:
            metric, band = item["metric"], item["band"]
            if metric == "balanced_accuracy":
                theta, se = (tpr + tnr) / 2.0, 0.5 * math.sqrt(tpr * (1.0 - tpr) / positives + tnr * (1.0 - tnr) / negatives)
                models.append(power_model(metric, metric, theta, {"positives": positives, "negatives": negatives}, lambda z, t=theta, s=se, b=band: normal_probs(t, s, b, z), min(positives, negatives) >= cls))
            elif metric == "f1":
                j = n * pi * tpr / union
                models.append(power_model(metric, metric, f1_from_j(j), union, lambda z, j=j, d=union, b=jaccard_band(band): proportion_probs(j, d, b, z), positives >= cls))
            else:
                p, d, minimum = {"accuracy": (pi * tpr + (1.0 - pi) * tnr, n, mins["sampleSize"]), "precision": (n * pi * tpr / predicted, predicted, cls), "recall": (tpr, positives, cls), "specificity": (tnr, negatives, cls), "false_positive_rate": (1.0 - tnr, negatives, cls)}[metric]
                models.append(power_model(metric, metric, p, d, lambda z, p=p, d=d, b=band: proportion_probs(p, d, b, z), d >= minimum))
    elif crit["kind"] == "multiclass_performance":
        labels = sorted(a["classShares"], key=code_point_key)
        shares, recalls = [a["classShares"][label] for label in labels], [a["perClassRecall"][label] for label in labels]
        k = len(labels)
        for item in crit["members"]:
            metric, band = item["metric"], item["band"]
            if metric == "accuracy":
                p = math.fsum(s * r for s, r in zip(shares, recalls))
                models.append(power_model(metric, metric, p, n, lambda z, p=p, b=band: proportion_probs(p, n, b, z), n >= mins["sampleSize"]))
            elif metric == "balanced_accuracy":
                theta = math.fsum(recalls) / k
                se = math.sqrt(math.fsum(r * (1.0 - r) / (n * s) for s, r in zip(shares, recalls))) / k
                models.append(power_model(metric, metric, theta, {"perClass": {label: n * s for label, s in zip(labels, shares)}}, lambda z, t=theta, s=se, b=band: normal_probs(t, s, b, z), min(n * s for s in shares) >= cls))
            else:
                models.append(power_model(metric, metric, None, None, None, False, computed=False))
    else:
        sigma = a["errorSd"]  # errors assumed normal with mean zero
        for item in crit["members"]:
            metric, band = item["metric"], item["band"]
            if metric == "mae":
                theta, se = sigma * math.sqrt(2.0 / math.pi), sigma * math.sqrt(1.0 - 2.0 / math.pi) / math.sqrt(n)
                models.append(power_model(metric, metric, theta, n, lambda z, t=theta, s=se, b=band: normal_probs(t, s, b, z), n >= mins["sampleSize"]))
            else:
                q, se = sigma * sigma, math.sqrt(2.0) * sigma * sigma / math.sqrt(n)
                models.append(power_model(metric, metric, sigma, n, lambda z, t=q, s=se, b=square_band(band): normal_probs(t, s, b, z), n >= mins["sampleSize"]))
    return models


def group_models(crit, a, sizes, mins):
    names = sorted(sizes, key=code_point_key)
    metric, band, mode = crit["metric"], crit["band"], crit["comparison"]
    metrics = ["tpr_difference", "fpr_difference"] if metric == "equalized_odds" else [metric]
    eligible = [g for g in names if sizes[g] >= mins["groupSize"]]

    def rate(key, g):
        if key == "selection":
            return (a["assumedRates"] or {}).get(g, a["baselineRate"])
        return assumed(a["truePositiveRate"] if key == "tpr" else a["falsePositiveRate"], g)

    def denominator(key, g):
        if key == "selection":
            return sizes[g]
        prevalence = assumed(a["prevalence"], g)
        return sizes[g] * prevalence if key == "tpr" else sizes[g] * (1.0 - prevalence)

    models = []
    for mt in metrics:
        key = RATE_KEYS[mt]
        if mode["mode"] == "reference":
            ref = mode["referenceGroup"]
            pairs = [(g, ref) for g in eligible if g != ref] if ref in eligible else []
        else:
            pairs = [(y, x) if rate(key, y) < rate(key, x) else (x, y) for i, x in enumerate(eligible) for y in eligible[i + 1:]]
        for s, c in pairs:
            rs, rc, ns, nc = rate(key, s), rate(key, c), denominator(key, s), denominator(key, c)
            supported = key == "selection" or min(ns, nc) >= mins["classCount"]
            if mt == "selection_rate_ratio":
                theta, se = math.log(rs / rc), math.sqrt((1.0 - rs) / (ns * rs) + (1.0 - rc) / (nc * rc))
                probs, value = (lambda z, t=theta, e=se: normal_probs(t, e, log_band(band), z)), rs / rc
            else:
                theta, se = rs - rc, math.sqrt(rs * (1.0 - rs) / ns + rc * (1.0 - rc) / nc)
                probs, value = (lambda z, t=theta, e=se: normal_probs(t, e, band, z)), theta
            models.append(power_model(member_id(mt, s, c), mt, value, {"subject": ns, "comparator": nc}, probs, supported, subject=s, comparator=c))
    total = sum(sizes.values())
    coverage = sum(sizes[g] for g in eligible) / total
    reasons = []
    if total < mins["sampleSize"]:
        reasons.append("below_minimum_sample_size")
    if coverage < crit["minimumCoverage"] - EPS:
        reasons.append("insufficient_planned_coverage")
    if len(eligible) < 2 or (mode["mode"] == "reference" and mode["referenceGroup"] not in eligible):
        reasons.append("insufficient_groups")
    return models, reasons


def summarize(models, z_pass, z_fail, blocked_pass, blocked_fail):
    members = []
    for m in models:
        entry = {"memberId": m["memberId"], "metric": m["metric"]}
        if m["subject"] is not None:
            entry.update(subject=m["subject"], comparator=m["comparator"])
        entry.update(assumedValue=m["assumedValue"], denominator=m["denominator"])
        if not m["computed"]:
            entry.update(status="not_computed", passProbability=None, failProbability=None, reasons=["power_not_specified_for_metric"])
        elif not m["supported"]:
            entry.update(status="computed", passProbability=0.0, failProbability=0.0, reasons=["planned_below_minimum"])
        else:
            entry.update(status="computed", passProbability=m["probs"](z_pass)[0], failProbability=m["probs"](z_fail)[1], reasons=[])
        members.append(entry)
    if not members or any(e["status"] != "computed" for e in members):
        return members, None, None, None
    lower = 0.0 if blocked_pass else max(0.0, 1.0 - math.fsum(1.0 - e["passProbability"] for e in members))
    upper = 0.0 if blocked_pass else min(e["passProbability"] for e in members)
    fail = 0.0 if blocked_fail else max(e["failProbability"] for e in members)
    return members, lower, upper, fail


def smallest_n(probability_at, target, start=2, limit=POWER_SEARCH_LIMIT):
    if probability_at(limit) < target:
        return None
    lo, hi = start, limit
    while lo < hi:
        mid = (lo + hi) // 2
        if probability_at(mid) >= target:
            hi = mid
        else:
            lo = mid + 1
    return lo


def equality_test_n(p1, p2, level, power):
    """Classic two-sided two-proportion z-test sample size per group (pooled null variance; Fleiss without continuity correction)."""
    za, zb = zcrit(level), ND.inv_cdf(power)
    pbar = (p1 + p2) / 2
    raw = (za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2
    return raw, math.ceil(raw - 1e-9)


def difference_mde(rc, ns, nc, band, z, target, direction):
    """Smallest true gap beyond the band edge (subject rate rc - gap, or rc + gap) that fails with probability >= target."""
    def failing(gap):
        rs = rc + direction * gap
        return normal_probs(direction * gap, math.sqrt(rs * (1.0 - rs) / ns + rc * (1.0 - rc) / nc), band, z)[1]
    lo = -band["lower"] if direction < 0 else band["upper"]
    hi = (rc if direction < 0 else 1.0 - rc) - 1e-12
    if failing(hi) < target:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if failing(mid) >= target:
            hi = mid
        else:
            lo = mid
    return hi


def ratio_mde(rc, ns, nc, band, z, target):
    """Largest true ratio below the lower band edge with P(fail) >= target. P(fail) is unimodal in r (it falls
    again as r -> 0 because the variance of log r explodes), so search between its peak and the band edge."""
    def failing(r):
        rs = r * rc
        return normal_probs(math.log(r), math.sqrt((1.0 - rs) / (ns * rs) + (1.0 - rc) / (nc * rc)), log_band(band), z)[1]
    grid = [band["lower"] * math.exp(-12.0 * i / 4000) for i in range(1, 4001)]
    peak = max(grid, key=failing)
    lo, hi = peak, band["lower"]
    if failing(lo) < target:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if failing(mid) >= target:
            lo = mid
        else:
            hi = mid
    return lo


def fail_mdes(crit, a, sizes, z, target):
    names = sorted(sizes, key=code_point_key)
    mode, metric, band = crit["comparison"], crit["metric"], crit["band"]
    if mode["mode"] == "reference":
        comparator = mode["referenceGroup"]
        subject = min((g for g in names if g != comparator), key=lambda g: (sizes[g], code_point_key(g)))
    else:
        subject = min(names, key=lambda g: (sizes[g], code_point_key(g)))
        comparator = min((g for g in names if g != subject), key=lambda g: (-sizes[g], code_point_key(g)))
    if metric == "selection_rate_difference":
        rc = (a["assumedRates"] or {}).get(comparator, a["baselineRate"])
        return {"failMdeDifference": difference_mde(rc, sizes[subject], sizes[comparator], band, z, target, -1 if band["lower"] is not None else 1)}
    if metric == "selection_rate_ratio":
        rc = (a["assumedRates"] or {}).get(comparator, a["baselineRate"])
        return {"failMdeRatio": ratio_mde(rc, sizes[subject], sizes[comparator], band, z, target)}
    ps, pc = assumed(a["prevalence"], subject), assumed(a["prevalence"], comparator)
    return {"failMdeTprDifference": difference_mde(assumed(a["truePositiveRate"], comparator), sizes[subject] * ps, sizes[comparator] * pc, band, z, target, -1),
            "failMdeFprDifference": difference_mde(assumed(a["falsePositiveRate"], comparator), sizes[subject] * (1.0 - ps), sizes[comparator] * (1.0 - pc), band, z, target, 1)}


def not_computed(reason, members=()):
    return {"status": "not_computed", "passProbability": None, "passProbabilityUpperBound": None, "failProbability": None, "members": list(members), "reasons": [reason]}


def criterion_power(crit, level, target, family, mins):
    a = crit["powerAssumptions"]
    if a is None:
        return not_computed("missing_assumptions")
    alpha = 1.0 - level
    if crit["kind"] == "group_comparison":
        sizes = a["groupSizes"]
        models, reasons = group_models(crit, a, sizes, mins)
        m = max(1, len(models))
        z_pass, z_fail = zcrit(1.0 - alpha / family), zcrit(1.0 - alpha / (family * m))

        def at(sz):
            mods, rs = group_models(crit, a, sz, mins)
            return summarize(mods, z_pass, z_fail, bool(rs), "below_minimum_sample_size" in rs or "insufficient_groups" in rs)

        members, lower, upper, fail = at(sizes)
        names = sorted(sizes, key=code_point_key)
        out = {"status": "computed", "passProbability": lower, "passProbabilityUpperBound": upper, "failProbability": fail, "requiredGroupSizeForPass": smallest_n(lambda k: at({g: k for g in names})[1], target)}
        out.update(fail_mdes(crit, a, sizes, z_fail, target))
        out["members"], out["reasons"] = members, list(reasons)
        if out["requiredGroupSizeForPass"] is None:
            out["reasons"].append("target_unreachable")
        if any(out[key] is None for key in out if key.startswith("failMde")):
            out["reasons"].append("fail_mde_unreachable")
        return out
    if crit["kind"] in PERFORMANCE_KINDS:
        m = len(crit["members"])
        z_pass, z_fail = zcrit(1.0 - alpha / family), zcrit(1.0 - alpha / (family * max(1, m)))

        undecidable = bool(crit.get("passBlockedBy"))

        def at(n):
            blocked = n < mins["sampleSize"]
            return summarize(performance_models(crit, a, n, mins), z_pass, z_fail, blocked or undecidable, blocked)

        members, lower, upper, fail = at(a["n"])
        if lower is None:
            return not_computed("member_power_not_computed" if members else "no_threshold", members)
        out = {"status": "computed", "passProbability": lower, "passProbabilityUpperBound": upper, "failProbability": fail, "requiredNForPass": smallest_n(lambda n: at(n)[1], target), "members": members, "reasons": []}
        if a["n"] < mins["sampleSize"]:
            out["reasons"].append("below_minimum_sample_size")
        if undecidable:
            out["reasons"].append("undecidable_metric")
        if any("planned_below_minimum" in e["reasons"] for e in members):
            out["reasons"].append("planned_below_minimum")
        if out["requiredNForPass"] is None:
            out["reasons"].append("target_unreachable")
        return out
    return not_computed("power_not_specified_for_metric")


def evaluate_power(inp):
    level, target = inp.get("confidenceLevel", 0.95), inp.get("targetPower", 0.8)
    if inp["kind"] == "equality_test":
        raw, n = equality_test_n(inp["p1"], inp["p2"], level, target)
        return {"groupSizeExact": raw, "groupSize": n}
    crit = normalize_criterion(inp["criterion"])
    return criterion_power(crit, level, target, inp.get("familySize", 1), {**FLOORS, **inp.get("minimums", {})})


# ---------------------------------------------------------------- NYC LL144 reporting (selection rates)
def evaluate_ll144(inp, level=0.95):
    z = zcrit(level)
    cats = inp["categories"]
    known = sum(c["n"] for c in cats)
    unknown = inp.get("unknownCount", 0)
    total = known + unknown  # "the data being used for the bias audit" includes the unknown category (section 10.2)
    excluded = set(inp.get("excluded", []))
    rows = []
    for c in cats:
        share = c["n"] / total
        assert c["name"] not in excluded or share < 0.02, "2% exclusion only allowed below 2% of the data"
        lo, hi = wilson(c["selected"], c["n"], z)
        rows.append({"category": c["name"], "n": c["n"], "selected": c["selected"], "selectionRate": c["selected"] / c["n"], "selectionRateInterval": {"lower": lo, "upper": hi, "level": level, "method": "wilson"}, "shareOfData": share, "shareOfKnown": c["n"] / known, "eligibleForTwoPercentExclusion": share < 0.02, "excluded": c["name"] in excluded})
    included = [r for r in rows if not r["excluded"]]
    ref = max(included, key=lambda r: r["selectionRate"])  # first maximum in input order
    for r in rows:
        if r["excluded"]:
            r["impactRatio"], r["impactRatioInterval"] = None, None
        elif r is ref:
            r["impactRatio"], r["impactRatioInterval"] = 1.0, None
        else:
            xs, ns, xc, nc = r["selected"], r["n"], ref["selected"], ref["n"]
            method = ratio_method(xs, ns, xc, nc)
            lo, hi = katz(xs, ns, xc, nc, z) if method == "katz_log" else koopman(xs, ns, xc, nc, z)
            r["impactRatio"] = (xs / ns) / (xc / nc)
            r["impactRatioInterval"] = {"lower": lo, "upper": hi, "level": level, "method": method}
    return {"referenceCategory": ref["category"], "totalIndividuals": total, "totalAssessedKnown": known, "unknownCategoryCount": unknown, "categories": rows}


# ---------------------------------------------------------------- golden cases
def band(lower=None, upper=None):
    return {"lower": lower, "upper": upper}


def perf(id_, members, role="confirmatory"):
    return {"id": id_, "role": role, "kind": "performance", "members": [{"metric": m, "band": b} for m, b in members]}


def grp(id_, metric, b, mode=None, role="confirmatory", minimum_coverage=1.0, declared=None, library=None):
    out = {"id": id_, "role": role, "kind": "group_comparison", "metric": metric, "comparison": mode or {"mode": "all_pairs"}, "band": b, "minimumCoverage": minimum_coverage}
    if declared:
        out["declaredGroups"] = declared
    if library:
        out["libraryEntry"] = library
    return out


def cm(group, tp, fp, fn, tn):
    return {"group": group, "tp": tp, "fp": fp, "fn": fn, "tn": tn}


def sel(group, selected, n):
    return {"group": group, "selected": selected, "n": n}


DP10, IR45, EO10 = band(-0.1, 0.1), band(0.8, 1.25), band(-0.1, 0.1)
LEGACY_HOSTED_CONFIG = {"labelColumn": "actual", "predictionColumn": "predicted", "groupColumn": "group", "positiveLabel": "1", "minimumGroupSize": 2, "maximumParityGap": 0.1, "minimumImpactRatio": 0.8, "minimumAccuracy": 0.85, "minimumSampleSize": 20, "minimumClassCount": 5, "maximumOddsGap": 0.1, "minimumRecall": 0.7, "minimumMacroF1": 0.7, "maximumRmse": 1}
LEGACY_ENGINE_CONFIG = {"contractVersion": "1.0", "id": "run-legacy-derivation", "engagementId": "eng-fixture", "modelId": "model-fixture", "datasetId": "data-fixture", "task": "binary_classification", "suite": ["performance", "fairness"], "seed": 1729, "columns": {"target": "actual", "prediction": "predicted", "protected": "group", "score": "score"}, "positiveLabel": "1", "negativeLabel": "0", "minGroupSize": 20, "minClassCount": 5, "minSampleSize": 30, "thresholds": {"policyId": "fixture-policy", "policyVersion": "1", "source": "internal_policy", "values": {"accuracy": {"operator": ">=", "value": 0.8}, "precision": {"operator": ">=", "value": 0.6}, "recall": {"operator": ">=", "value": 0.7}, "f1": {"operator": ">=", "value": 0.65}, "brier_score": {"operator": "<=", "value": 0.2}, "expected_calibration_error": {"operator": "<=", "value": 0.05}, "demographic_parity_difference": {"operator": "<=", "value": 0.1}, "disparate_impact_ratio": {"operator": ">=", "value": 0.8}, "equalized_odds_difference": {"operator": "<=", "value": 0.15}}}}
MULTICLASS_3X3 = {"kind": "multiclass", "labels": ["high", "low", "medium"], "matrix": [[150, 10, 40], [8, 270, 22], [30, 25, 245]]}
# GC-48: dyadic targets symmetric about 5 (so every runner gets R2 = 0 exactly) and the mean predictor 5.
MEAN_PREDICTOR_DEVIATIONS = ((0.125, 63), (0.375, 53), (0.625, 39), (0.875, 24), (1.125, 12), (1.375, 6), (1.625, 2), (1.875, 1))
MEAN_PREDICTOR_TARGETS = [5.0 + sign * d for d, count in MEAN_PREDICTOR_DEVIATIONS for _ in range(count) for sign in (1.0, -1.0)]


def engine_legacy(task, values):
    """An engine 1.0 performance-only configuration with the floors as its minimums and the given policy values."""
    config = {**LEGACY_ENGINE_CONFIG, "task": task, "suite": ["performance"], "columns": {"target": "actual", "prediction": "predicted"}, "minGroupSize": 30, "minClassCount": 10, "minSampleSize": 30, "thresholds": {**LEGACY_ENGINE_CONFIG["thresholds"], "values": values}}
    if task != "binary_classification":
        del config["positiveLabel"], config["negativeLabel"]
    return {"source": "engine_thresholds", "config": config}

CASES = [
    {"id": "GC-01", "category": "small_sample", "title": "Recall 40/50 = 0.80 against a 0.70 minimum: the point estimate passes, the interval does not", "type": "plan",
     "data": {"groups": [cm("all", 40, 6, 10, 144)]}, "plan": {"criteria": [perf("recall-minimum", [("recall", band(0.70))])]}},
    {"id": "GC-02", "category": "large_sample", "title": "Accuracy 9,120/10,000 against a 0.90 minimum passes", "type": "plan",
     "data": {"groups": [cm("all", 1520, 400, 480, 7600)]}, "plan": {"criteria": [perf("accuracy-minimum", [("accuracy", band(0.90))])]}},
    {"id": "GC-03", "category": "fail", "title": "Accuracy 80/100 against a 0.90 minimum fails", "type": "plan",
     "data": {"groups": [cm("all", 30, 8, 12, 50)]}, "plan": {"criteria": [perf("accuracy-minimum", [("accuracy", band(0.90))])]}},
    {"id": "GC-04", "category": "zero_numerator", "title": "False-positive rate 0/40 against a 0.10 maximum passes (Wilson handles zero events)", "type": "plan",
     "data": {"groups": [cm("all", 50, 0, 10, 40)]}, "plan": {"criteria": [perf("fpr-maximum", [("false_positive_rate", band(None, 0.10))])]}},
    {"id": "GC-05", "category": "all_events", "title": "Precision 30/30 against a 0.85 minimum passes", "type": "plan",
     "data": {"groups": [cm("all", 30, 0, 20, 50)]}, "plan": {"criteria": [perf("precision-minimum", [("precision", band(0.85))])]}},
    {"id": "GC-06", "category": "zero_denominator", "title": "Constant negative predictor: precision undefined, recall 0, criterion fails on recall", "type": "plan",
     "data": {"groups": [cm("all", 0, 0, 60, 940)]}, "plan": {"criteria": [perf("performance", [("accuracy", band(0.90)), ("recall", band(0.70)), ("balanced_accuracy", band(0.50)), ("precision", band(0.50)), ("f1", band(0.50))])]}},
    {"id": "GC-07", "category": "single_class", "title": "Reference labels contain one class: specificity and balanced accuracy undefined, criterion inconclusive", "type": "plan",
     "data": {"groups": [cm("all", 45, 0, 5, 0)]}, "plan": {"criteria": [perf("performance", [("accuracy", band(0.80)), ("balanced_accuracy", band(0.50)), ("specificity", band(0.80))])]}},
    {"id": "GC-08", "category": "small_sample", "title": "Issue example: 6/20 vs 10/20 selected; impact ratio 0.60 is inconclusive (and below the group minimum)", "type": "plan",
     "data": {"groups": [sel("A", 6, 20), sel("B", 10, 20)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45)]}},
    {"id": "GC-09", "category": "large_sample", "title": "Issue example: 22,500/50,000 vs 25,000/50,000; ratio 0.90 passes the screen while a 0.02 parity band fails", "type": "plan",
     "data": {"groups": [sel("A", 22500, 50000), sel("B", 25000, 50000)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45), grp("parity-0.02", "selection_rate_difference", band(-0.02, 0.02))]}},
    {"id": "GC-10", "category": "perfect_parity", "title": "Perfect parity with 300 per group passes both the difference and the ratio band", "type": "plan",
     "data": {"groups": [sel("A", 150, 300), sel("B", 150, 300)]}, "plan": {"criteria": [grp("parity-0.10", "selection_rate_difference", DP10), grp("four-fifths-screen", "selection_rate_ratio", IR45)]}},
    {"id": "GC-11", "category": "perfect_parity", "title": "Perfect parity with 30 per group is inconclusive: equality is not evidence of parity", "type": "plan",
     "data": {"groups": [sel("A", 15, 30), sel("B", 15, 30)]}, "plan": {"criteria": [grp("parity-0.10", "selection_rate_difference", DP10)]}},
    {"id": "GC-12", "category": "extreme_imbalance", "title": "9,000 vs 40: a 0.60 ratio cannot be resolved for the small group", "type": "plan",
     "data": {"groups": [sel("majority", 4500, 9000), sel("minority", 12, 40)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45), grp("parity-0.10", "selection_rate_difference", DP10)]}},
    {"id": "GC-13", "category": "zero_numerator", "title": "0/40 vs 10/40: Koopman interval for a zero count; Fisher confirms the fail", "type": "plan",
     "data": {"groups": [sel("A", 0, 40), sel("B", 10, 40)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45)]}},
    {"id": "GC-14", "category": "small_cell", "title": "0/30 vs 5/30: the interval lies below 0.8 but Fisher p > 0.05, so the small-cell rule blocks the fail", "type": "plan",
     "data": {"groups": [sel("A", 0, 30), sel("B", 5, 30)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45)]}},
    {"id": "GC-15", "category": "zero_denominator", "title": "Nobody selected in either group: parity difference passes, impact ratio undefined (only one label is observed)", "type": "plan",
     "data": {"groups": [sel("A", 0, 50), sel("B", 0, 50)]}, "plan": {"criteria": [grp("parity-0.10", "selection_rate_difference", DP10), grp("four-fifths-screen", "selection_rate_ratio", IR45)]}},
    {"id": "GC-37", "category": "all_events", "title": "Everyone selected in both groups: Koopman replaces the zero-width Katz interval; the parity pass does not survive Bonferroni (only one label is observed)", "type": "plan",
     "data": {"groups": [sel("A", 40, 40), sel("B", 35, 35)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45), grp("parity-0.10", "selection_rate_difference", DP10)]}},
    {"id": "GC-16", "category": "empty_group", "title": "A declared group has no rows: comparisons among the others are evaluated but the criterion cannot pass", "type": "plan",
     "data": {"groups": [sel("A", 200, 400), sel("B", 196, 400)]}, "plan": {"criteria": [grp("parity-0.10", "selection_rate_difference", DP10, declared=["A", "B", "C"])]}},
    {"id": "GC-17", "category": "multiplicity", "title": "Three groups: one comparison lies beyond the band at 95% but not after Bonferroni within the criterion", "type": "plan",
     "data": {"groups": [sel("A", 300, 600), sel("B", 290, 600), sel("C", 234, 600)]}, "plan": {"criteria": [grp("parity-0.05", "selection_rate_difference", band(-0.05, 0.05))]}},
    {"id": "GC-18", "category": "multiplicity", "title": "Bonferroni across four confirmatory criteria", "type": "multiplicity",
     "input": {"method": "bonferroni", "alpha": 0.05, "pValues": [0.004, 0.030, 0.012, 0.200]}},
    {"id": "GC-19", "category": "multiplicity", "title": "Benjamini-Hochberg across eight exploratory criteria", "type": "multiplicity",
     "input": {"method": "benjamini_hochberg", "alpha": 0.05, "pValues": [0.001, 0.008, 0.039, 0.041, 0.042, 0.060, 0.074, 0.205]}},
    {"id": "GC-20", "category": "equalized_odds", "title": "Equalized odds with two groups fails on the true-positive-rate gap", "type": "plan",
     "data": {"groups": [cm("A", 160, 30, 40, 270), cm("B", 100, 33, 100, 267)]}, "plan": {"criteria": [grp("equalized-odds-0.10", "equalized_odds", EO10)]}},
    {"id": "GC-21", "category": "performance", "title": "Performance criterion with balanced accuracy and F1 members passes", "type": "plan",
     "data": {"groups": [cm("all", 170, 40, 30, 760)]}, "plan": {"criteria": [perf("performance", [("accuracy", band(0.90)), ("recall", band(0.75)), ("balanced_accuracy", band(0.50)), ("f1", band(0.75))])]}},
    {"id": "GC-22", "category": "intersectional_suppression", "title": "Sex x race strata: two small strata suppressed, coverage 0.981 meets a pre-registered 0.95, parity passes", "type": "plan",
     "data": {"groups": [sel("F/X", 200, 400), sel("F/Y", 172, 350), sel("M/X", 214, 420), sel("M/Y", 190, 380), sel("F/Z", 5, 12), sel("M/Z", 8, 18)]}, "plan": {"criteria": [grp("intersectional-parity-0.10", "selection_rate_difference", DP10, minimum_coverage=0.95)]}},
    {"id": "GC-23", "category": "intersectional_suppression", "title": "Same strata, default coverage 1.0 and one disparate stratum: suppression does not void the analysis, the fail stands", "type": "plan",
     "data": {"groups": [sel("F/X", 200, 400), sel("F/Y", 105, 350), sel("M/X", 214, 420), sel("M/Y", 190, 380), sel("F/Z", 5, 12), sel("M/Z", 8, 18)]}, "plan": {"criteria": [grp("intersectional-parity-0.10", "selection_rate_difference", DP10)]}},
    {"id": "GC-24", "category": "calibration", "title": "Calibration gaps per probability bin with a 0.10 band: one sparse bin suppressed, the rest pass", "type": "plan",
     "data": {"bins": [{"bin": 0, "n": 1200, "positives": 66, "meanScore": 0.05}, {"bin": 1, "n": 600, "positives": 93, "meanScore": 0.15}, {"bin": 2, "n": 400, "positives": 100, "meanScore": 0.25}, {"bin": 3, "n": 300, "positives": 108, "meanScore": 0.35}, {"bin": 4, "n": 250, "positives": 112, "meanScore": 0.45}, {"bin": 5, "n": 250, "positives": 140, "meanScore": 0.55}, {"bin": 6, "n": 250, "positives": 160, "meanScore": 0.65}, {"bin": 7, "n": 200, "positives": 152, "meanScore": 0.75}, {"bin": 8, "n": 150, "positives": 129, "meanScore": 0.85}, {"bin": 9, "n": 20, "positives": 20, "meanScore": 0.96}]},
     "plan": {"criteria": [{"id": "calibration-0.10", "role": "confirmatory", "kind": "calibration", "band": band(-0.10, 0.10), "minimumCoverage": 0.95}]}},
    {"id": "GC-25", "category": "power", "title": "Classic test of equality: 40% vs 50% at 80% power needs 388 per group", "type": "power",
     "input": {"kind": "equality_test", "p1": 0.40, "p2": 0.50, "confidenceLevel": 0.95, "targetPower": 0.80}},
    {"id": "GC-26", "category": "power", "title": "Classic test of equality: 8% vs 10% at 80% power needs 3,213 per group", "type": "power",
     "input": {"kind": "equality_test", "p1": 0.08, "p2": 0.10, "confidenceLevel": 0.95, "targetPower": 0.80}},
    {"id": "GC-27", "category": "power", "title": "Band-based check: at 388 per group and true parity, the four-fifths band passes with probability 0.75", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {**grp("four-fifths-screen", "selection_rate_ratio", IR45), "powerAssumptions": {"groupSizes": {"A": 388, "B": 388}, "baselineRate": 0.50}}}},
    {"id": "GC-28", "category": "power", "title": "Band-based check for a 0.05 parity band at 30% selection and 500 per group", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {**grp("parity-0.05", "selection_rate_difference", band(-0.05, 0.05)), "powerAssumptions": {"groupSizes": {"A": 500, "B": 500}, "baselineRate": 0.30}}}},
    {"id": "GC-29", "category": "power", "title": "Single proportion: recall truly 0.80 against a 0.70 minimum with 50 expected positives (200 rows at prevalence 0.25)", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {**perf("recall-minimum", [("recall", band(0.70))]), "powerAssumptions": {"n": 200, "prevalence": 0.25, "truePositiveRate": 0.80, "trueNegativeRate": 0.90}}}},
    {"id": "GC-30", "category": "reference_group", "title": "Fixed reference group with a one-sided ratio band", "type": "plan",
     "data": {"groups": [sel("A", 200, 400), sel("B", 150, 400), sel("C", 190, 400)]}, "plan": {"criteria": [grp("impact-vs-A", "selection_rate_ratio", band(0.8), mode={"mode": "reference", "referenceGroup": "A"})]}},
    {"id": "GC-31", "category": "end_to_end", "title": "Hosted suite on two groups: four confirmatory criteria with Bonferroni", "type": "plan",
     "data": {"groups": [cm("A", 180, 40, 20, 360), cm("B", 166, 42, 34, 358)]}, "plan": {"criteria": [perf("performance", [("accuracy", band(0.80)), ("recall", band(0.70)), ("balanced_accuracy", band(0.50))]), grp("demographic_parity", "selection_rate_difference", DP10), grp("disparate_impact", "selection_rate_ratio", IR45), grp("equalized_odds", "equalized_odds", EO10)]}},
    {"id": "GC-32", "category": "ll144", "title": "NYC DCWP worked example (race/ethnicity selection rates) reproduced with intervals", "type": "ll144",
     "input": {"unknownCount": 250, "categories": [{"name": "Hispanic or Latino", "n": 408, "selected": 204}, {"name": "White", "n": 797, "selected": 412}, {"name": "Black or African American", "n": 390, "selected": 170}, {"name": "Native Hawaiian or Pacific Islander", "n": 119, "selected": 52}, {"name": "Asian", "n": 616, "selected": 302}, {"name": "Native American or Alaska Native", "n": 41, "selected": 18}, {"name": "Two or More Races", "n": 213, "selected": 96}]}},
    {"id": "GC-33", "category": "ll144", "title": "DCWP example under the four-fifths library screen: published ratios of 0.84 do not demonstrate a pass", "type": "plan",
     "data": {"groups": [sel("Hispanic or Latino", 204, 408), sel("White", 412, 797), sel("Black or African American", 170, 390), sel("Native Hawaiian or Pacific Islander", 52, 119), sel("Asian", 302, 616), sel("Native American or Alaska Native", 18, 41), sel("Two or More Races", 96, 213)], "unknownGroupRows": 250},
     "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45, minimum_coverage=0.9, library={"id": "screen.us.four-fifths", "version": 1, "parameters": {"tau": 0.8}})]}},
    {"id": "GC-34", "category": "multiclass", "title": "Three-class confusion matrix: accuracy, macro recall (balanced accuracy) and macro F1; macro precision descriptive", "type": "plan",
     "data": MULTICLASS_3X3,
     "plan": {"criteria": [{"id": "multiclass-performance", "role": "confirmatory", "kind": "multiclass_performance", "members": [{"metric": "accuracy", "band": band(0.75)}, {"metric": "balanced_accuracy", "band": band(0.75)}, {"metric": "macro_f1", "band": band(0.75)}]}]}},
    {"id": "GC-36", "category": "small_cell", "title": "Fisher's exact test reference values (two-sided; tables with probability <= the observed one)", "type": "fisher",
     "input": {"tables": [{"subject": {"x": 6, "n": 20}, "comparator": {"x": 10, "n": 20}}, {"subject": {"x": 0, "n": 30}, "comparator": {"x": 5, "n": 30}}, {"subject": {"x": 0, "n": 40}, "comparator": {"x": 10, "n": 40}}, {"subject": {"x": 2, "n": 40}, "comparator": {"x": 4500, "n": 9000}}, {"subject": {"x": 1, "n": 10}, "comparator": {"x": 1, "n": 10}}, {"subject": {"x": 3, "n": 8}, "comparator": {"x": 7, "n": 9}}, {"subject": {"x": 0, "n": 50}, "comparator": {"x": 0, "n": 50}}]}},
    {"id": "GC-35", "category": "regression", "title": "Regression errors: MAE and RMSE with normal-approximation intervals; R2 descriptive", "type": "plan",
     "data": {"kind": "regression", "targets": [2.0 + 0.5 * i for i in range(40)], "errors": [0.8, -1.1, 0.3, 2.2, -0.4, 0.0, 1.5, -0.9, 0.6, -2.0, 0.2, 1.1, -0.7, 0.4, -1.6, 0.9, -0.2, 1.8, -1.3, 0.5, -0.6, 1.0, -0.1, 0.7, -1.4, 0.3, 1.2, -0.8, 0.1, -0.5, 2.5, -1.0, 0.6, -0.3, 1.4, -1.2, 0.2, 0.9, -0.4, 1.6]},
     "plan": {"criteria": [{"id": "regression-performance", "role": "confirmatory", "kind": "regression_performance", "members": [{"metric": "mae", "band": band(None, 1.2)}, {"metric": "rmse", "band": band(None, 1.5)}]}]}},
    {"id": "GC-38", "category": "descriptive_metrics", "title": "Legacy hosted profile without a plan: derived criteria, minimums raised to the floors, the balanced-accuracy baseline, and descriptive precision, specificity and F1", "type": "plan",
     "data": {"groups": [cm("A", 120, 20, 30, 330), cm("B", 110, 25, 40, 325)]},
     "legacy": {"source": "hosted_config", "task": "Binary classification", "suite": ["performance", "demographic_parity"], "config": LEGACY_HOSTED_CONFIG}},
    {"id": "GC-39", "category": "derivation", "title": "Engine thresholds.values to a plan: the balanced-accuracy baseline, a Brier member, ECE descriptive, group bands and the configured minimums recorded", "type": "derivation",
     "legacy": {"source": "engine_thresholds", "config": LEGACY_ENGINE_CONFIG}},
    {"id": "GC-40", "category": "power", "title": "Three groups, all pairs: a 0.10 parity band at 30% selection with 500, 500 and 250 per group", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {**grp("parity-0.10", "selection_rate_difference", DP10), "powerAssumptions": {"groupSizes": {"A": 500, "B": 500, "C": 250}, "baselineRate": 0.30}}}},
    {"id": "GC-41", "category": "power", "title": "Multi-member performance criterion in a family of three: one-sided lower and upper bands, balanced accuracy and F1", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 3, "criterion": {**perf("performance", [("accuracy", band(0.85)), ("recall", band(0.70)), ("balanced_accuracy", band(0.50)), ("f1", band(0.70)), ("false_positive_rate", band(None, 0.15))]), "powerAssumptions": {"n": 400, "prevalence": 0.25, "truePositiveRate": 0.85, "trueNegativeRate": 0.92}}}},
    {"id": "GC-42", "category": "power", "title": "Equalized odds with per-group prevalence: a true TPR gap on the band edge makes the target unreachable", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {**grp("equalized-odds-0.10", "equalized_odds", EO10), "powerAssumptions": {"groupSizes": {"A": 600, "B": 300}, "prevalence": {"A": 0.3, "B": 0.2}, "truePositiveRate": {"A": 0.75, "B": 0.65}, "falsePositiveRate": 0.10}}}},
    {"id": "GC-43", "category": "power", "title": "Multiclass criterion: accuracy and macro recall are computed, macro F1 is not, so the criterion is not_computed", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {"id": "multiclass-performance", "role": "confirmatory", "kind": "multiclass_performance", "members": [{"metric": "accuracy", "band": band(0.75)}, {"metric": "balanced_accuracy", "band": band(0.70)}, {"metric": "macro_f1", "band": band(0.70)}], "powerAssumptions": {"n": 600, "classShares": {"a": 0.5, "b": 0.3, "c": 0.2}, "perClassRecall": {"a": 0.9, "b": 0.8, "c": 0.7}}}}},
    {"id": "GC-44", "category": "power", "title": "Regression criterion: MAE and RMSE maxima under normal errors with standard deviation 1", "type": "power",
     "input": {"kind": "criterion", "confidenceLevel": 0.95, "targetPower": 0.80, "familySize": 1, "criterion": {"id": "regression-performance", "role": "confirmatory", "kind": "regression_performance", "members": [{"metric": "mae", "band": band(None, 0.9)}, {"metric": "rmse", "band": band(None, 1.15)}], "powerAssumptions": {"n": 120, "errorSd": 1.0}}}},
    {"id": "GC-45", "category": "no_threshold", "title": "Engine policy with no performance threshold: every metric is descriptive and the criterion stays inconclusive (no_threshold), as today", "type": "plan",
     "data": {"groups": [cm("all", 170, 40, 30, 760)]},
     "legacy": {"source": "engine_thresholds", "config": {**LEGACY_ENGINE_CONFIG, "suite": ["performance"], "columns": {"target": "actual", "prediction": "predicted"}, "minGroupSize": 30, "minClassCount": 10, "thresholds": {**LEGACY_ENGINE_CONFIG["thresholds"], "values": {}}}}},
    {"id": "GC-46", "category": "chance_baseline", "title": "Engine multiclass policy with only an accuracy minimum: the derived criterion adds the macro-recall chance baseline 1/k, on which a constant majority-class predictor sits, so it cannot pass", "type": "plan",
     "data": {"kind": "multiclass", "labels": ["high", "low", "medium"], "matrix": [[0, 40, 0], [0, 1900, 0], [0, 60, 0]]},
     "legacy": engine_legacy("multiclass_classification", {"accuracy": {"operator": ">=", "value": 0.9}})},
    {"id": "GC-47", "category": "chance_baseline", "title": "Engine binary policy with a balanced-accuracy minimum below chance: the baseline is max(0.5, 0.40), on which a constant negative predictor sits, so it cannot pass", "type": "plan",
     "data": {"groups": [cm("all", 0, 0, 100, 1900)]},
     "legacy": engine_legacy("binary_classification", {"accuracy": {"operator": ">=", "value": 0.9}, "balanced_accuracy": {"operator": ">=", "value": 0.4}})},
    {"id": "GC-48", "category": "undecidable_metric", "title": "Engine regression policy with an R2 minimum and a mean predictor (R2 = 0): MAE and RMSE pass, but R2, which 1.0.0 cannot decide, blocks the pass", "type": "plan",
     "data": {"kind": "regression", "targets": MEAN_PREDICTOR_TARGETS, "errors": [5.0 - t for t in MEAN_PREDICTOR_TARGETS]},
     "legacy": engine_legacy("regression", {"mae": {"operator": "<=", "value": 1.0}, "rmse": {"operator": "<=", "value": 1.2}, "r2": {"operator": ">=", "value": 0.5}})},
    {"id": "GC-49", "category": "chance_baseline", "title": "Legacy hosted multiclass profile: the derived criterion adds the macro-recall chance baseline 1/3 between accuracy and macro F1, and the GC-34 model passes all three", "type": "plan",
     "data": MULTICLASS_3X3,
     "legacy": {"source": "hosted_config", "task": "Multiclass classification", "suite": ["performance"], "config": {**LEGACY_HOSTED_CONFIG, "minimumAccuracy": 0.75}}},
    {"id": "GC-50", "category": "chance_baseline", "title": "GC-47's policy and a predictor that rarely says positive: one lucky positive (TP 1 of 100) puts the balanced-accuracy interval above 0.5, but the exact chance gate does not reject, so the criterion is inconclusive", "type": "plan",
     "data": {"groups": [cm("all", 1, 0, 99, 1900)]},
     "legacy": engine_legacy("binary_classification", {"accuracy": {"operator": ">=", "value": 0.9}, "balanced_accuracy": {"operator": ">=", "value": 0.4}})},
    {"id": "GC-51", "category": "chance_baseline", "title": "GC-46's policy and a predictor that rarely predicts two of three classes: one correct 'high' puts the macro-recall interval above 1/3, but the exact chance gate (Bonferroni over the classes) does not reject, so the criterion is inconclusive", "type": "plan",
     "data": {"kind": "multiclass", "labels": ["high", "low", "medium"], "matrix": [[1, 39, 0], [0, 1900, 0], [0, 60, 0]]},
     "legacy": engine_legacy("multiclass_classification", {"accuracy": {"operator": ">=", "value": 0.9}})},
]


# ---------------------------------------------------------------- serialisation and checks
def clean(value, round_floats=True):
    if isinstance(value, dict):
        return {k: clean(v, round_floats and k != "normalizedPlan") for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, list):
        return [clean(v, round_floats) for v in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite value in fixture")
        return float(f"{value:.12g}") if round_floats else value
    return value


def compute(case):
    if case["type"] == "plan":
        return evaluate_plan(plan_for(case), case["data"])
    if case["type"] == "derivation":
        plan = plan_for(case)
        return {"planSha256": plan_sha256(plan), "normalizedPlan": plan}
    if case["type"] == "multiplicity":
        inp = case["input"]
        adjusted = (bonferroni if inp["method"] == "bonferroni" else benjamini_hochberg)(inp["pValues"])
        return {"adjustedPValues": adjusted, "rejected": [a <= inp["alpha"] + EPS for a in adjusted]}
    if case["type"] == "power":
        return evaluate_power(case["input"])
    if case["type"] == "ll144":
        return evaluate_ll144(case["input"])
    if case["type"] == "fisher":
        return {"pValues": [fisher_two_sided(t["subject"]["x"], t["subject"]["n"], t["comparator"]["x"], t["comparator"]["n"]) for t in case["input"]["tables"]]}
    raise ValueError(case["type"])


def numerics():
    levels = [0.90, 0.95, 0.99, 1 - 0.05 / 3, 1 - 0.05 / 6, 1 - 0.05 / 15, 1 - 0.05 / 21]
    return {"normalQuantiles": [{"twoSidedLevel": lv, "z": zcrit(lv)} for lv in levels], "erfc": [{"x": x, "value": math.erfc(x)} for x in (0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 26.0)]}


def end_to_end(case):
    """Whether a case can also be run through a runner on expanded rows (section 13.1)."""
    if case["type"] != "plan":
        return {"engine": False, "hosted": False}
    data, criteria = case["data"], plan_for(case)["criteria"]
    engine_policy = case.get("legacy", {}).get("source") == "engine_thresholds"  # an engine configuration has no hosted form
    if "groups" in data:
        rows = sum(group_rows(g) for g in data["groups"]) + data.get("unknownGroupRows", 0)
        hosted = not engine_policy and rows <= 10_000 and not data.get("unknownGroupRows") and all(c["kind"] in ("performance", "group_comparison") and c.get("comparison", {"mode": "all_pairs"})["mode"] == "all_pairs" and not c.get("declaredGroups") for c in criteria)
        return {"engine": rows <= 1_000_000, "hosted": hosted}
    if "bins" in data:
        return {"engine": True, "hosted": False}
    return {"engine": True, "hosted": not engine_policy}


def build():
    cases = []
    for case in sorted(CASES, key=lambda c: int(c["id"].split("-")[1])):
        out = {k: v for k, v in case.items()}
        out["runners"] = ["engine"] if case["category"] == "calibration" else ["engine", "hosted"]
        out["endToEnd"] = end_to_end(case)
        out["expected"] = compute(case)
        cases.append(out)
    return clean({
        "schemaVersion": "1.1",
        "specification": "docs/design/audit-statistics.md",
        "specificationVersion": SPEC_VERSION,
        "generatedBy": "docs/design/audit-statistics-verify.py (stdlib reference; scipy/statsmodels/jsonschema/Node.js cross-check)",
        "howToUse": {
            "coreLevel": "Every case runs through the statistics core on the counts given in data (both runners unless runners says otherwise). A plan case first normalises its plan (or derives it from legacy, section 9; a multiclass derivation takes k, the number of labels that occur in the target column, from data) and must reproduce expected.normalizedPlan exactly and expected.planSha256, the SHA-256 of its RFC 8785 canonical JSON.",
            "comparison": "Numbers: |actual - expected| <= tolerance (p-values: absolute + relative). Members and descriptive entries are matched by memberId, groups by group; reasons are compared as sets; all other fields exactly. The expected_calibration_error and r2 intervals are null at core level because the engine adds them by bootstrap end to end.",
            "outputMapping": "Section 11 of the specification maps every fixture field to the emitted result: headline, members and descriptive entries become metrics, groups become the headline's slices, decision becomes result.decision.",
            "rowExpansion": "For endToEnd cases, expand each group in order into rows (label, prediction, group): tp -> (1,1), fp -> (0,1), fn -> (1,0), tn -> (0,0); selection-only groups: selected -> (1,1), others -> (0,0). The binary labels are declared: positive '1', negative '0'; a runner must evaluate data in which only one of them occurs (GC-15, GC-37). Multiclass: matrix[i][j] rows with label labels[i] and prediction labels[j]. Regression: target = targets[i] (0 when absent) and prediction = target + errors[i]. Calibration bins: label 1 for positives, score = meanScore, prediction 1 when score >= 0.5. A legacy case runs with its legacy configuration: a hosted_config case directly in the hosted runner and through the worker translation in the engine; an engine_thresholds case directly in the engine.",
        },
        "defaults": {"confidenceLevel": 0.95, "minimums": FLOORS, "minimumCoverage": 1.0, "confirmatoryAdjustment": "bonferroni", "exploratoryAdjustment": "benjamini_hochberg"},
        "tolerances": {"estimate": 1e-6, "interval": 1e-6, "pValueAbsolute": 1e-9, "pValueRelative": 1e-5, "probability": 1e-6, "reasonsComparedAsSets": True},
        "numerics": numerics(),
        "cases": cases,
    })


def close(a, b, key):
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        return a == b
    if isinstance(a, int) and isinstance(b, int):
        return a == b
    if "pvalue" in key.lower() or "fisher" in key.lower():
        return abs(a - b) <= 1e-9 + 1e-5 * abs(b)
    return abs(a - b) <= 1e-6


def diff(a, b, path="", out=None):
    out = [] if out is None else out
    if isinstance(b, dict):
        if not isinstance(a, dict) or set(a) != set(b):
            out.append(f"{path}: keys differ")
            return out
        for k in b:
            if k == "reasons":
                if set(a[k]) != set(b[k]):
                    out.append(f"{path}.{k}: {a[k]} != {b[k]}")
            else:
                diff(a[k], b[k], f"{path}.{k}", out)
    elif isinstance(b, list):
        if not isinstance(a, list) or len(a) != len(b):
            out.append(f"{path}: list length differs")
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                diff(x, y, f"{path}[{i}]", out)
    elif not close(a, b, path):
        out.append(f"{path}: {a!r} != {b!r}")
    return out


# ---------------------------------------------------------------- independent cross-check (scipy / statsmodels / jsonschema / Node.js)
NODE_JCS = r"""
const crypto = require('crypto');
const jcs = v => Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : (v !== null && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}'
  : JSON.stringify(v);
const plans = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(plans.map(p => crypto.createHash('sha256').update(jcs(p), 'utf8').digest('hex'))));
"""


def cross_check(fixture):
    import numpy as np
    from jsonschema import Draft202012Validator
    from scipy import optimize, special, stats
    from scipy.stats.contingency import relative_risk
    from statsmodels.stats.multitest import multipletests
    from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint, samplesize_proportions_2indep_onetail

    problems, tally = [], Counter()
    norm = stats.norm

    def expect(ok, category, message):
        tally[category] += 1
        if not ok:
            problems.append(f"[{category}] {message}")

    def near(a, b, tol=1e-7):
        if a is None or b is None:
            return a is None and b is None
        return abs(a - b) <= tol * max(1.0, abs(b))

    # ---- special functions
    for item in fixture["numerics"]["normalQuantiles"]:
        expect(near(norm.isf((1 - item["twoSidedLevel"]) / 2), item["z"], 1e-9), "numerics", f"quantile {item}")
    for item in fixture["numerics"]["erfc"]:
        expect(abs(special.erfc(item["x"]) - item["value"]) <= 1e-11 * item["value"], "numerics", f"erfc {item}")

    # ---- intervals
    def sm_wilson(x, n, alpha):
        lo, hi = proportion_confint(x, n, alpha=alpha, method="wilson")
        return (0.0 if x == 0 else float(lo)), (1.0 if x == n else float(hi))

    def koopman_independent(x1, n1, x2, n2, alpha):
        """statsmodels' Nam cubic, except where it is unstable (a group rate of 1): then root-find a constrained-MLE score statistic."""
        if x1 < n1 and x2 < n2 and x1 > 0:
            lo, hi = confint_proportions_2indep(x1, n1, x2, n2, compare="ratio", method="score", correction=False, alpha=alpha)
            return float(lo), float(hi)
        zc = norm.isf(alpha / 2)

        def stat(ph):
            res = optimize.minimize_scalar(lambda p2: -(stats.binom.logpmf(x1, n1, min(ph * p2, 1 - 1e-15)) + stats.binom.logpmf(x2, n2, p2)), bounds=(1e-12, min(1.0, 1.0 / ph) - 1e-12), method="bounded", options={"xatol": 1e-14})
            p2 = res.x
            p1 = ph * p2
            return (x1 / n1 - ph * x2 / n2) / math.sqrt(p1 * (1 - p1) / n1 + ph * ph * p2 * (1 - p2) / n2)

        est = (x1 / n1) / (x2 / n2)
        lo = 0.0 if x1 == 0 else optimize.brentq(lambda ph: stat(ph) - zc, est * 1e-6, est * (1 - 1e-12))
        hi = optimize.brentq(lambda ph: stat(ph) + zc, max(est, 1e-9) * (1 + 1e-12), max(est, 1e-3) * 1e6)
        return lo, hi

    def independent_interval(m, alpha):
        metric, c, method = m["metric"], m["counts"], m["interval"]["method"]
        if method == "wilson" and metric == "calibration_gap":
            lo, hi = sm_wilson(c["x"], c["n"], alpha)
            return lo - c["meanScore"], hi - c["meanScore"]
        if method == "wilson":
            return sm_wilson(c["x"], c["n"], alpha)
        if method == "newcombe_hybrid_score":
            s, k = c["subject"], c["comparator"]
            lo, hi = confint_proportions_2indep(s["x"], s["n"], k["x"], k["n"], compare="diff", method="newcomb", alpha=alpha)
            return float(lo), float(hi)
        if method == "katz_log":
            s, k = c["subject"], c["comparator"]
            lo, hi = confint_proportions_2indep(s["x"], s["n"], k["x"], k["n"], compare="ratio", method="log", alpha=alpha)
            second = relative_risk(s["x"], s["n"], k["x"], k["n"]).confidence_interval(confidence_level=1 - alpha)
            expect(near(float(lo), second.low, 1e-9) and near(float(hi), second.high, 1e-9), "intervals", f"Katz statsmodels vs scipy.relative_risk {s} {k}")
            return float(lo), float(hi)
        if method == "koopman_score":
            s, k = c["subject"], c["comparator"]
            return koopman_independent(s["x"], s["n"], k["x"], k["n"], alpha)
        if method == "mover_wilson":
            parts = [(c["tp"], c["positives"]), (c["tn"], c["negatives"])] if "positives" in c else [(p["tp"], p["support"]) for p in c["perClass"]]
            est = np.mean([x / n for x, n in parts])
            lims = [sm_wilson(x, n, alpha) for x, n in parts]
            lo = est - math.sqrt(sum((x / n - l) ** 2 for (x, n), (l, _) in zip(parts, lims))) / len(parts)
            hi = est + math.sqrt(sum((u - x / n) ** 2 for (x, n), (_, u) in zip(parts, lims))) / len(parts)
            return lo, hi
        if method == "jaccard_wilson":
            lo, hi = sm_wilson(c["tp"], c["tpPlusFpPlusFn"], alpha)
            return 2 * lo / (1 + lo), 2 * hi / (1 + hi)
        if method == "jaccard_wilson_bonferroni":
            k = len(c["perClass"])
            bounds = [sm_wilson(p["tp"], p["tpPlusFpPlusFn"], alpha / k) for p in c["perClass"]]
            return np.mean([2 * lo / (1 + lo) for lo, _ in bounds]), np.mean([2 * hi / (1 + hi) for _, hi in bounds])
        if method == "wilson_bonferroni_mean":
            k = len(c["perClass"])
            bounds = [sm_wilson(p["tp"], p["predicted"], alpha / k) for p in c["perClass"]]
            return np.mean([lo for lo, _ in bounds]), np.mean([hi for _, hi in bounds])
        if method in ("normal_approximation", "normal_approximation_mse"):
            mean = c["meanAbsoluteError"] if method == "normal_approximation" else c["meanSquaredError"]
            sd = c["sdAbsoluteError"] if method == "normal_approximation" else c["sdSquaredError"]
            zc = norm.isf(alpha / 2)
            lo, hi = max(0.0, mean - zc * sd / math.sqrt(c["n"])), mean + zc * sd / math.sqrt(c["n"])
            return (lo, hi) if method == "normal_approximation" else (math.sqrt(lo), math.sqrt(hi))
        raise ValueError(method)

    def independent_chance_p(m):
        """The chance gate (section 5.2), written again: None unless a balanced-accuracy member's lower bound is at or
        above chance (0.5, or 1/k for k classes); else the one-sided Fisher p (scipy), Bonferroni over k >= 3 classes, doubled."""
        b, c = m["band"], m["counts"] or {}
        if m["metric"] != "balanced_accuracy" or b is None or b["lower"] is None or m["estimate"] is None:
            return None
        if "positives" in c:
            if b["lower"] < 0.5 - 1e-12:
                return None
            tp, fp, tn = c["tp"], c["negatives"] - c["tn"], c["tn"]
            return min(1.0, 2 * float(stats.fisher_exact([[tp, c["positives"] - tp], [fp, tn]], alternative="greater").pvalue))
        k = len(c["perClass"])
        if b["lower"] < 1.0 / k - 1e-12:
            return None
        n = sum(p["support"] for p in c["perClass"])
        tails = [float(stats.hypergeom.sf(p["tp"] - 1, n, p["support"], p["predicted"])) for p in c["perClass"]]
        return min(1.0, 2 * (1 if k <= 2 else k) * min(tails))

    def inside(interval, b):
        lo, hi = interval
        return (b["lower"] is None or lo >= b["lower"]) and (b["upper"] is None or hi <= b["upper"])

    def check_entry(m, case_id, descriptive=False):
        if m["interval"] is not None:
            alpha = 1 - m["interval"]["level"]
            lo, hi = independent_interval(m, alpha)
            expect(near(lo, m["interval"]["lower"], 1e-6) and near(hi, m["interval"]["upper"], 1e-6), "intervals", f"{case_id} {m['memberId']} interval {lo, hi} vs {m['interval']}")
        want_chance, got_chance = None if descriptive else independent_chance_p(m), m.get("chanceExactP", "missing")
        expect(got_chance != "missing" and ((want_chance is None and got_chance is None) or (want_chance is not None and got_chance is not None and abs(got_chance - want_chance) <= 1e-9 + 1e-6 * want_chance)), "chance_gate", f"{case_id} {m['memberId']} chanceExactP {got_chance} vs {want_chance}")
        if descriptive:
            expect(m["band"] is None and m["direction"] == "none" and m["pValue"] is None, "descriptive_entries", f"{case_id} {m['memberId']} descriptive shape")
            return
        if m["status"] != "evaluated" or m["interval"] is None:
            return
        b = m["band"]
        est = m["estimate"]
        on_edge = any(v is not None and abs(est - v) <= 1e-12 * max(1, abs(v)) for v in (b["lower"], b["upper"]))
        outside = (b["lower"] is not None and est < b["lower"]) or (b["upper"] is not None and est > b["upper"])
        expect(m["direction"] == ("none" if on_edge else "fail" if outside else "pass"), "directions", f"{case_id} {m['memberId']} direction")
        if m["direction"] == "none":
            return
        p_interval = m["pValue"]
        if m["smallCell"] and m["direction"] == "fail" and m["fisherExactP"] is not None:
            s, k = m["counts"]["subject"], m["counts"]["comparator"]
            p_scipy = stats.fisher_exact([[s["x"], s["n"] - s["x"]], [k["x"], k["n"] - k["x"]]]).pvalue
            expect(near(p_scipy, m["fisherExactP"], 1e-9), "fisher", f"{case_id} {m['memberId']} fisher {p_scipy} vs {m['fisherExactP']}")
            if m["pValue"] == m["fisherExactP"]:
                return
        if m["direction"] == "pass" and m.get("chanceExactP") is not None:
            expect(m["pValue"] >= m["chanceExactP"] * (1 - 1e-12), "chance_gate", f"{case_id} {m['memberId']} pass p {m['pValue']} below its chanceExactP {m['chanceExactP']}")
            if m["pValue"] == m["chanceExactP"]:  # the gate binds: the interval alone would decide at level 1 - chanceExactP
                if m["chanceExactP"] < 1.0:
                    expect(inside(independent_interval(m, m["chanceExactP"]), b), "chance_gate", f"{case_id} {m['memberId']} the interval p exceeds chanceExactP, so the gate cannot bind")
                return
        if p_interval < 1e-12:
            return
        lo, hi = independent_interval(m, p_interval)  # the interval at level 1 - p must touch the band edge
        edges = [v for v in (b["lower"], b["upper"]) if v is not None]
        touch = min(min(abs(lo - e), abs(hi - e)) for e in edges)
        expect(touch <= 1e-6 * max(1.0, max(abs(e) for e in edges)), "decision_p_values", f"{case_id} {m['memberId']} p={p_interval} does not invert to the band edge (gap {touch})")

    def independent_headline(crit, alpha):
        pool = [m for m in crit["members"] if m["status"] != "suppressed"]
        ev = [m for m in pool if m["status"] == "evaluated"]
        if not ev:
            return None
        b, k = ev[0]["band"], len(ev)
        complete = all(m["status"] == "evaluated" for m in pool)
        ratio = ev[0]["metric"] == "selection_rate_ratio"
        with np.errstate(divide="ignore"):
            f = (lambda v: float(np.log(v))) if ratio else (lambda v: v)
            nominal = [tuple(map(f, independent_interval(m, alpha))) for m in ev]
            bonf = [tuple(map(f, independent_interval(m, alpha / k))) for m in ev]
            est = [f(m["estimate"]) for m in ev]
        if b["lower"] is not None and b["upper"] is not None:
            value = max(abs(e) for e in est)
            low = max(max(0.0, lo, -hi) for lo, hi in bonf)
            high = max(max(abs(lo), abs(hi)) for lo, hi in nominal) if complete else math.inf
            return (math.exp(-value), math.exp(-high), math.exp(-low)) if ratio else (value, low, min(high, 1.0))
        if ratio:
            return math.exp(min(est)), (math.exp(min(lo for lo, _ in nominal)) if complete else 0.0), math.exp(min(hi for _, hi in bonf))
        sign = -1.0 if b["lower"] is not None else 1.0
        gaps_nominal = [(lo, hi) if sign > 0 else (-hi, -lo) for lo, hi in nominal]
        gaps_bonf = [(lo, hi) if sign > 0 else (-hi, -lo) for lo, hi in bonf]
        return max(sign * e for e in est), max(lo for lo, _ in gaps_bonf), (min(max(hi for _, hi in gaps_nominal), 1.0) if complete else 1.0)

    def sizes_of(data):
        return {g["group"]: (g["n"] if "n" in g else g["tp"] + g["fp"] + g["fn"] + g["tn"]) for g in data["groups"]}

    alpha_of = {}
    # ---- plan cases
    for case in fixture["cases"]:
        exp = case["expected"]
        if case["type"] != "plan":
            continue
        plan = exp["normalizedPlan"]
        level = plan["confidenceLevel"]
        alpha = 1 - level
        alpha_of[case["id"]] = alpha
        mins = plan["minimums"]
        data = case["data"]
        for crit, spec in zip(exp["criteria"], plan["criteria"]):
            d = crit["decision"]
            for m in crit["members"]:
                check_entry(m, case["id"])
            for m in crit["descriptive"]:
                check_entry(m, case["id"], descriptive=True)
            # per-group rates
            for g in crit["groups"] or []:
                for key in ("selection", "tpr", "fpr", "observed"):
                    if key in g and g[key]["n"]:
                        lo, hi = sm_wilson(g[key]["x"], g[key]["n"], alpha)
                        expect(near(lo, g[key]["interval"]["lower"], 1e-6) and near(hi, g[key]["interval"]["upper"], 1e-6) and near(g[key]["x"] / g[key]["n"], g[key]["estimate"]), "group_rates", f"{case['id']} {crit['id']} {g['group']} {key}")
                expect(g["suppressed"] == (g["n"] < mins["groupSize"]), "group_rates", f"{case['id']} {g['group']} suppression flag")
            # headline worst-member bounds, rebuilt from library intervals
            if spec["kind"] in ("group_comparison", "calibration"):
                ind = independent_headline(crit, alpha)
                h = crit["headline"]
                if ind is None:
                    expect(h is None, "headlines", f"{case['id']} {crit['id']} headline should be absent")
                else:
                    expect(near(ind[0], h["estimate"], 1e-6) and near(ind[1], h["interval"]["lower"], 1e-6) and near(ind[2], h["interval"]["upper"], 1e-6), "headlines", f"{case['id']} {crit['id']} headline {ind} vs {h}")
            # coverage, sample size and pass-blocking gates from the raw data
            blocked = False
            if spec["kind"] == "group_comparison":
                sizes = sizes_of(data)
                declared = spec["declaredGroups"] or []
                for name in declared:
                    sizes.setdefault(name, 0)
                eligible = [g for g, n in sizes.items() if n >= mins["groupSize"]]
                unknown = data.get("unknownGroupRows", 0)
                cov = sum(sizes[g] for g in eligible) / (sum(sizes.values()) + unknown)
                expect(near(cov, d["coverage"]["value"], 1e-9) and d["coverage"]["eligibleRows"] == sum(sizes[g] for g in eligible) and d["coverage"]["populationRows"] == sum(sizes.values()) + unknown, "coverage", f"{case['id']} {crit['id']} coverage")
                ref = spec["comparison"]["referenceGroup"]
                blocked = cov < spec["minimumCoverage"] - 1e-12 or any(sizes[g] == 0 for g in declared) or len(eligible) < 2 or (ref is not None and ref not in eligible)
                sample = sum(sizes.values())
            elif spec["kind"] == "calibration":
                total = sum(b["n"] for b in data["bins"])
                eligible_rows = sum(b["n"] for b in data["bins"] if b["n"] >= mins["groupSize"])
                expect(near(eligible_rows / total, d["coverage"]["value"], 1e-9), "coverage", f"{case['id']} calibration coverage")
                ece = float(np.sum([b["n"] / total * abs(b["positives"] / b["n"] - b["meanScore"]) for b in data["bins"]]))
                entry = next(m for m in crit["descriptive"] if m["metric"] == "expected_calibration_error")
                expect(near(ece, entry["estimate"], 1e-9), "ece_r2", f"{case['id']} ECE {ece} vs {entry['estimate']}")
                blocked = eligible_rows / total < spec["minimumCoverage"] - 1e-12
                sample = total
            elif spec["kind"] == "performance":
                sample = sum(g["tp"] + g["fp"] + g["fn"] + g["tn"] for g in data["groups"])
            elif spec["kind"] == "multiclass_performance":
                sample = int(np.sum(data["matrix"]))
            else:
                sample = len(data["errors"])
                r2 = next((m for m in crit["descriptive"] if m["metric"] == "r2"), None)
                if r2 is not None:
                    y = np.array(data.get("targets", [0.0] * sample))
                    e = np.array(data["errors"])
                    sst = float(np.sum((y - y.mean()) ** 2))
                    expect((sst == 0 and r2["estimate"] is None) or near(1 - float(np.sum(e * e)) / sst, r2["estimate"], 1e-9), "ece_r2", f"{case['id']} R2")
            expect(d["sampleSize"] == sample, "sample_sizes", f"{case['id']} {crit['id']} sampleSize {d['sampleSize']} vs {sample}")
            # an undecidable metric that today's rule needs (R2, ECE) blocks a pass and is flagged on its descriptive entry
            undecidable = spec.get("passBlockedBy") or []
            blocked = blocked or bool(undecidable)
            expect(("undecidable_metric" in d["reasons"]) == bool(undecidable), "descriptive_entries", f"{case['id']} {crit['id']} undecidable_metric on the criterion")
            for m in crit["descriptive"]:
                expect(("undecidable_metric" in m["reasons"]) == (m["metric"] in undecidable), "descriptive_entries", f"{case['id']} {m['memberId']} undecidable_metric on the descriptive entry")
            # member status, small-cell flags, Fisher on every small-cell member, and the suppressed-group list
            if spec["kind"] == "group_comparison":
                sizes = sizes_of(data)
                for name in spec["declaredGroups"] or []:
                    sizes.setdefault(name, 0)
                want = [{"group": g, "n": sizes[g]} for g in sorted(sizes) if sizes[g] < mins["groupSize"]]
                expect(d["suppressedGroups"] == want, "member_status", f"{case['id']} {crit['id']} suppressedGroups")
            for m in crit["members"]:
                c = m["counts"] or {}
                if "subject" in c:
                    (xs, ns), (xc, nc) = (c["subject"]["x"], c["subject"]["n"]), (c["comparator"]["x"], c["comparator"]["n"])
                    if spec["kind"] == "group_comparison":
                        sizes = sizes_of(data)
                        if sizes.get(m["subject"], 0) < mins["groupSize"] or sizes.get(m["comparator"], 0) < mins["groupSize"]:
                            want = "suppressed"
                        elif ns == 0 or nc == 0 or (m["metric"] == "selection_rate_ratio" and xc == 0):
                            want = "undefined"
                        else:
                            want = "evaluated" if min(ns, nc) >= (mins["classCount"] if m["metric"] in ("tpr_difference", "fpr_difference") else mins["groupSize"]) else "insufficient_support"
                        expect(m["status"] == want, "member_status", f"{case['id']} {m['memberId']} status {m['status']} vs {want}")
                    if ns and nc:
                        small = min(xs, ns - xs, xc, nc - xc) < 5
                        expect(m["smallCell"] == small, "member_status", f"{case['id']} {m['memberId']} smallCell")
                        if small and m["fisherExactP"] is not None:
                            q = stats.fisher_exact([[xs, ns - xs], [xc, nc - xc]]).pvalue
                            expect(near(q, m["fisherExactP"], 1e-9), "fisher", f"{case['id']} {m['memberId']} fisher {q} vs {m['fisherExactP']}")
                elif "x" in c and m["interval"] is not None:
                    minimum = mins["sampleSize"] if m["metric"] == "accuracy" else mins["groupSize"] if m["metric"] == "calibration_gap" else mins["classCount"]
                    expect(m["status"] == ("evaluated" if c["n"] >= minimum else "insufficient_support"), "member_status", f"{case['id']} {m['memberId']} status")
            # criterion P from the member p-values (intersection-union for pass, Bonferroni for fail)
            pool = [m for m in crit["members"] if m["status"] != "suppressed"]
            ev = [m for m in pool if m["status"] == "evaluated"]
            fails = [m["pValue"] for m in ev if m["direction"] == "fail"]
            deciding, complete = None, False
            if sample < mins["sampleSize"] or not ev:
                p, direction = 1.0, "none"
            elif fails:
                p, direction = min(1.0, len(ev) * min(fails)), "fail"
                deciding = min((m for m in ev if m["direction"] == "fail"), key=lambda m: (m["pValue"], m["memberId"]))["memberId"]
            else:
                complete = bool(pool) and all(m["status"] == "evaluated" and m["direction"] == "pass" for m in pool)
                direction = "pass" if any(m["direction"] == "pass" for m in ev) else "none"
                p = max(m["pValue"] for m in pool) if complete and not blocked else 1.0
                if complete and not blocked:
                    deciding = min(pool, key=lambda m: (-m["pValue"], m["memberId"]))["memberId"]
            expect(near(p, d["pValue"], 1e-9) and direction == d["direction"], "criterion_p", f"{case['id']} {crit['id']} P {p} {direction} vs {d['pValue']} {d['direction']}")
            expect(deciding == d["decidingMemberId"], "criterion_p", f"{case['id']} {crit['id']} decidingMemberId {deciding} vs {d['decidingMemberId']}")
            # the chance gate alone prevents a pass: every pool interval decides at the nominal level, yet P > alpha
            gate_alone = direction == "pass" and complete and not blocked and p > alpha + 1e-12 and all(inside(independent_interval(m, alpha), m["band"]) for m in pool)
            expect(("chance_exact_test_not_significant" in d["reasons"]) == gate_alone, "chance_gate", f"{case['id']} {crit['id']} chance_exact_test_not_significant should be {'present' if gate_alone else 'absent'}")
            expect(d["unadjustedOutcome"] == (direction if direction in ("pass", "fail") and p <= alpha + 1e-12 else "inconclusive"), "outcomes", f"{case['id']} {crit['id']} unadjusted outcome")
        # family adjustment, outcomes, run outcome and review flags
        for role, method in (("confirmatory", "bonferroni"), ("exploratory", "fdr_bh")):
            fam = [c for c in exp["criteria"] if c["decision"]["role"] == role]
            if fam:
                adjusted = multipletests([c["decision"]["pValue"] for c in fam], alpha=alpha, method=method)[1]
                for c, a in zip(fam, adjusted):
                    expect(near(a, c["decision"]["adjustedPValue"], 1e-9) and c["decision"]["familySize"] == len(fam), "family_adjustment", f"{case['id']} {c['id']} adjusted {a} vs {c['decision']['adjustedPValue']}")
                    want = c["decision"]["direction"] if c["decision"]["direction"] in ("pass", "fail") and a <= alpha + 1e-12 else "inconclusive"
                    expect(c["outcome"] == want, "outcomes", f"{case['id']} {c['id']} outcome")
        confirmatory = [c["outcome"] for c in exp["criteria"] if c["decision"]["role"] == "confirmatory"]
        overall = next((s for s in ("fail", "inconclusive", "pass") if s in confirmatory), "not_applicable")
        expect(exp["overallOutcome"] == overall, "outcomes", f"{case['id']} run outcome")
        expect(exp["reviewFlags"] == [c["id"] for c in exp["criteria"] if c["decision"]["role"] == "exploratory" and c["outcome"] == "fail"], "outcomes", f"{case['id']} review flags")

    # ---- multiplicity, equality sizes, Fisher and LL144 cases
    for case in fixture["cases"]:
        exp, inp = case["expected"], case.get("input")
        if case["type"] == "multiplicity":
            rej, adj, _, _ = multipletests(inp["pValues"], alpha=inp["alpha"], method="bonferroni" if inp["method"] == "bonferroni" else "fdr_bh")
            expect(all(near(a, b, 1e-9) for a, b in zip(adj, exp["adjustedPValues"])) and list(map(bool, rej)) == exp["rejected"], "family_adjustment", f"{case['id']} multipletests")
        elif case["type"] == "power" and inp["kind"] == "equality_test":
            n = samplesize_proportions_2indep_onetail(diff=inp["p1"] - inp["p2"], prop2=inp["p2"], power=inp["targetPower"], ratio=1, alpha=1 - inp["confidenceLevel"], value=0, alternative="two-sided")
            expect(near(n, exp["groupSizeExact"], 1e-7) and math.ceil(n) == exp["groupSize"], "power", f"{case['id']} sample size {n}")
        elif case["type"] == "fisher":
            for t, p in zip(inp["tables"], exp["pValues"]):
                s, k = t["subject"], t["comparator"]
                q = stats.fisher_exact([[s["x"], s["n"] - s["x"]], [k["x"], k["n"] - k["x"]]]).pvalue
                expect(near(q, p, 1e-9), "fisher", f"{case['id']} fisher {t} scipy {q} vs {p}")
        elif case["type"] == "ll144":
            known = sum(c["n"] for c in inp["categories"])
            total = known + inp.get("unknownCount", 0)
            expect(exp["totalIndividuals"] == total and exp["totalAssessedKnown"] == known, "ll144", f"{case['id']} totals")
            rates = [r["selected"] / r["n"] for r in exp["categories"]]
            expect(exp["referenceCategory"] == exp["categories"][int(np.argmax(rates))]["category"], "ll144", f"{case['id']} reference category")
            ref = next(r for r in exp["categories"] if r["category"] == exp["referenceCategory"])
            for row in exp["categories"]:
                lo, hi = sm_wilson(row["selected"], row["n"], 0.05)
                expect(near(lo, row["selectionRateInterval"]["lower"], 1e-6) and near(hi, row["selectionRateInterval"]["upper"], 1e-6), "ll144", f"{case['id']} {row['category']} wilson")
                expect(near(row["shareOfData"], row["n"] / total, 1e-12) and near(row["shareOfKnown"], row["n"] / known, 1e-12) and row["eligibleForTwoPercentExclusion"] == (row["n"] / total < 0.02), "ll144", f"{case['id']} {row['category']} shares")
                if row["impactRatioInterval"]:
                    lo, hi = confint_proportions_2indep(row["selected"], row["n"], ref["selected"], ref["n"], compare="ratio", method="log")
                    expect(near(float(lo), row["impactRatioInterval"]["lower"], 1e-6) and near(float(hi), row["impactRatioInterval"]["upper"], 1e-6) and near(row["impactRatio"], (row["selected"] / row["n"]) / (ref["selected"] / ref["n"]), 1e-12), "ll144", f"{case['id']} {row['category']} katz")

    # ---- power: separately written normal-approximation models with scipy
    def ind_side(terms):
        return terms[0] if len(terms) == 1 else max(0.0, terms[0] + terms[1] - 1.0)

    def ind_prop(p, n, b, z):
        s = math.sqrt(p * (1 - p) / n)
        pas, fai = [], 0.0
        if b.get("lower") is not None:
            l = b["lower"]
            pas.append(norm.sf((l + z * math.sqrt(l * (1 - l) / n) - p) / s))
            fai += norm.cdf((l - z * math.sqrt(l * (1 - l) / n) - p) / s)
        if b.get("upper") is not None:
            u = b["upper"]
            pas.append(norm.cdf((u - z * math.sqrt(u * (1 - u) / n) - p) / s))
            fai += norm.sf((u + z * math.sqrt(u * (1 - u) / n) - p) / s)
        return ind_side(pas), fai

    def ind_norm(theta, se, b, z):
        pas, fai = [], 0.0
        if b.get("lower") is not None:
            pas.append(norm.cdf((theta - b["lower"]) / se - z))
            fai += norm.cdf((b["lower"] - theta) / se - z)
        if b.get("upper") is not None:
            pas.append(norm.cdf((b["upper"] - theta) / se - z))
            fai += norm.cdf((theta - b["upper"]) / se - z)
        return ind_side(pas), fai

    def ind_perf_members(crit, a, n, mins, z_pass, z_fail):
        out = []
        kind = crit["kind"]
        for item in crit["members"]:
            metric, b = item["metric"], item["band"]
            if kind == "performance":
                pi, tpr, tnr = a["prevalence"], a["truePositiveRate"], a["trueNegativeRate"]
                pos, neg = n * pi, n * (1 - pi)
                if metric == "balanced_accuracy":
                    theta, se = (tpr + tnr) / 2, 0.5 * math.sqrt(tpr * (1 - tpr) / pos + tnr * (1 - tnr) / neg)
                    ok = min(pos, neg) >= mins["classCount"]
                    out.append((ind_norm(theta, se, b, z_pass)[0], ind_norm(theta, se, b, z_fail)[1], ok, True))
                    continue
                if metric == "f1":
                    tp, fp, fn = n * pi * tpr, n * (1 - pi) * (1 - tnr), n * pi * (1 - tpr)
                    j, m = tp / (tp + fp + fn), tp + fp + fn
                    jb = {k: (None if v is None else v / (2 - v)) for k, v in b.items()}
                    out.append((ind_prop(j, m, jb, z_pass)[0], ind_prop(j, m, jb, z_fail)[1], pos >= mins["classCount"], True))
                    continue
                tp, fp = n * pi * tpr, n * (1 - pi) * (1 - tnr)
                p, d, minimum = {"accuracy": ((n * pi * tpr + n * (1 - pi) * tnr) / n, n, mins["sampleSize"]), "precision": (tp / (tp + fp), tp + fp, mins["classCount"]), "recall": (tpr, pos, mins["classCount"]), "specificity": (tnr, neg, mins["classCount"]), "false_positive_rate": (1 - tnr, neg, mins["classCount"])}[metric]
                out.append((ind_prop(p, d, b, z_pass)[0], ind_prop(p, d, b, z_fail)[1], d >= minimum, True))
            elif kind == "multiclass_performance":
                shares = np.array([a["classShares"][k] for k in sorted(a["classShares"])])
                recalls = np.array([a["perClassRecall"][k] for k in sorted(a["classShares"])])
                if metric == "accuracy":
                    p = float(np.dot(shares, recalls))
                    out.append((ind_prop(p, n, b, z_pass)[0], ind_prop(p, n, b, z_fail)[1], n >= mins["sampleSize"], True))
                elif metric == "balanced_accuracy":
                    theta, se = float(recalls.mean()), float(np.sqrt(np.sum(recalls * (1 - recalls) / (n * shares)))) / len(shares)
                    out.append((ind_norm(theta, se, b, z_pass)[0], ind_norm(theta, se, b, z_fail)[1], float((n * shares).min()) >= mins["classCount"], True))
                else:
                    out.append((None, None, False, False))
            else:
                sigma = a["errorSd"]
                if metric == "mae":
                    theta, se = sigma * math.sqrt(2 / math.pi), sigma * math.sqrt(1 - 2 / math.pi) / math.sqrt(n)
                    out.append((ind_norm(theta, se, b, z_pass)[0], ind_norm(theta, se, b, z_fail)[1], n >= mins["sampleSize"], True))
                else:
                    sb = {k: (None if v is None else v * v) for k, v in b.items()}
                    theta, se = sigma ** 2, math.sqrt(2) * sigma ** 2 / math.sqrt(n)
                    out.append((ind_norm(theta, se, sb, z_pass)[0], ind_norm(theta, se, sb, z_fail)[1], n >= mins["sampleSize"], True))
        return out

    def ind_group_members(crit, a, sizes, mins, z_pass, z_fail):
        names = sorted(sizes)
        eligible = [g for g in names if sizes[g] >= mins["groupSize"]]
        metrics = ["tpr", "fpr"] if crit["metric"] == "equalized_odds" else ["selection"]
        get = lambda v, g: v[g] if isinstance(v, dict) else v
        out = []
        for key in metrics:
            def rate(g):
                return (a["assumedRates"] or {}).get(g, a["baselineRate"]) if key == "selection" else get(a["truePositiveRate"] if key == "tpr" else a["falsePositiveRate"], g)
            def den(g):
                return sizes[g] if key == "selection" else sizes[g] * (get(a["prevalence"], g) if key == "tpr" else 1 - get(a["prevalence"], g))
            ref = crit["comparison"]["referenceGroup"]
            if ref is not None:
                pairs = [(g, ref) for g in eligible if g != ref] if ref in eligible else []
            else:
                pairs = [(y, x) if rate(y) < rate(x) else (x, y) for i, x in enumerate(eligible) for y in eligible[i + 1:]]
            for s, c in pairs:
                rs, rc, ns, nc = rate(s), rate(c), den(s), den(c)
                ok = key == "selection" or min(ns, nc) >= mins["classCount"]
                if crit["metric"] == "selection_rate_ratio":
                    theta, se = math.log(rs / rc), math.sqrt((1 - rs) / (ns * rs) + (1 - rc) / (nc * rc))
                    b = {k: (None if v is None else math.log(v)) for k, v in crit["band"].items()}
                else:
                    theta, se, b = rs - rc, math.sqrt(rs * (1 - rs) / ns + rc * (1 - rc) / nc), crit["band"]
                out.append((ind_norm(theta, se, b, z_pass)[0], ind_norm(theta, se, b, z_fail)[1], ok, True))
        total = sum(sizes.values())
        cov = sum(sizes[g] for g in eligible) / total
        ref = crit["comparison"]["referenceGroup"]
        no_groups = len(eligible) < 2 or (ref is not None and ref not in eligible)
        blocked_pass = total < mins["sampleSize"] or cov < crit["minimumCoverage"] - 1e-12 or no_groups
        blocked_fail = total < mins["sampleSize"] or no_groups
        return out, blocked_pass, blocked_fail

    def ind_summary(members, blocked_pass, blocked_fail):
        if not members or any(not computed for *_, computed in members):
            return None, None, None
        passes = [p if ok else 0.0 for p, _, ok, _ in members]
        fails = [f if ok else 0.0 for _, f, ok, _ in members]
        lower = 0.0 if blocked_pass else max(0.0, 1.0 - sum(1.0 - p for p in passes))
        upper = 0.0 if blocked_pass else min(passes)
        return lower, upper, (0.0 if blocked_fail else max(fails))

    for case in fixture["cases"]:
        inp, exp = case.get("input"), case["expected"]
        if case["type"] != "power" or inp["kind"] != "criterion":
            continue
        crit = normalize_criterion(inp["criterion"])
        a, level, target, family = crit["powerAssumptions"], inp["confidenceLevel"], inp["targetPower"], inp["familySize"]
        mins = {**FLOORS, **inp.get("minimums", {})}
        alpha = 1 - level
        m = len(exp["members"]) or 1
        z_pass, z_fail = norm.isf(alpha / (2 * family)), norm.isf(alpha / (2 * family * m))
        if crit["kind"] == "group_comparison":
            sizes = a["groupSizes"]
            members, bp, bf = ind_group_members(crit, a, sizes, mins, z_pass, z_fail)
            f = lambda k: ind_summary(*ind_group_members(crit, a, {g: k for g in sizes}, mins, z_pass, z_fail))[0]
            need_key = "requiredGroupSizeForPass"
        else:
            members, bp, bf = ind_perf_members(crit, a, a["n"], mins, z_pass, z_fail), a["n"] < mins["sampleSize"], a["n"] < mins["sampleSize"]
            f = lambda n: ind_summary(ind_perf_members(crit, a, n, mins, z_pass, z_fail), n < mins["sampleSize"], n < mins["sampleSize"])[0]
            need_key = "requiredNForPass"
        for (p, fp, ok, computed), e in zip(members, exp["members"]):
            if computed:
                expect(near(p if ok else 0.0, e["passProbability"], 1e-9) and near(fp if ok else 0.0, e["failProbability"], 1e-9), "power", f"{case['id']} {e['memberId']} member probabilities")
            else:
                expect(e["status"] == "not_computed" and e["passProbability"] is None, "power", f"{case['id']} {e['memberId']} not_computed")
        lower, upper, fail = ind_summary(members, bp, bf)
        expect(near(lower, exp["passProbability"], 1e-9) and near(upper, exp["passProbabilityUpperBound"], 1e-9) and near(fail, exp["failProbability"], 1e-9), "power", f"{case['id']} criterion probabilities {lower, upper, fail}")
        if lower is None:
            expect(exp["status"] == "not_computed", "power", f"{case['id']} status")
            continue
        need = exp[need_key]
        if need is None:
            expect(f(POWER_SEARCH_LIMIT) < target, "sample_size_search", f"{case['id']} unreachable target is reachable")
        else:
            expect(f(need) >= target and (need == 2 or f(need - 1) < target), "sample_size_search", f"{case['id']} {need_key} {need} is not the smallest size reaching {target}")
        if crit["kind"] == "group_comparison":
            names = sorted(a["groupSizes"])
            sizes = a["groupSizes"]
            subject = min(names, key=lambda g: (sizes[g], g))
            comparator = min((g for g in names if g != subject), key=lambda g: (-sizes[g], g))
            b = crit["band"]

            def diff_fail(gap, rc, ns, nc, direction):
                rs = rc + direction * gap
                se = math.sqrt(rs * (1 - rs) / ns + rc * (1 - rc) / nc)
                return ind_norm(direction * gap, se, b, z_fail)[1]

            def check_difference(key, rc, ns, nc, direction):
                lo = -b["lower"] if direction < 0 else b["upper"]
                hi = (rc if direction < 0 else 1 - rc) - 1e-12
                if diff_fail(hi, rc, ns, nc, direction) < target:
                    expect(exp[key] is None, "minimum_detectable_effects", f"{case['id']} {key} should be unreachable")
                else:
                    root = optimize.brentq(lambda g: diff_fail(g, rc, ns, nc, direction) - target, lo, hi, xtol=1e-14)
                    expect(near(root, exp[key], 1e-7), "minimum_detectable_effects", f"{case['id']} {key} {root} vs {exp[key]}")

            if crit["metric"] == "selection_rate_difference":
                check_difference("failMdeDifference", (a["assumedRates"] or {}).get(comparator, a["baselineRate"]), sizes[subject], sizes[comparator], -1)
            elif crit["metric"] == "selection_rate_ratio":
                rc, ns, nc = (a["assumedRates"] or {}).get(comparator, a["baselineRate"]), sizes[subject], sizes[comparator]
                lb = {k: (None if v is None else math.log(v)) for k, v in b.items()}

                def ratio_fail(r):
                    rs = r * rc
                    return ind_norm(math.log(r), math.sqrt((1 - rs) / (ns * rs) + (1 - rc) / (nc * rc)), lb, z_fail)[1]

                peak = optimize.minimize_scalar(lambda lr: -ratio_fail(math.exp(lr)), bounds=(math.log(b["lower"]) - 12, math.log(b["lower"])), method="bounded", options={"xatol": 1e-12}).x
                root = optimize.brentq(lambda r: ratio_fail(r) - target, math.exp(peak), b["lower"], xtol=1e-14)
                expect(near(root, exp["failMdeRatio"], 1e-6), "minimum_detectable_effects", f"{case['id']} failMdeRatio {root} vs {exp['failMdeRatio']}")
            else:
                get = lambda v, g: v[g] if isinstance(v, dict) else v
                ps, pc = get(a["prevalence"], subject), get(a["prevalence"], comparator)
                check_difference("failMdeTprDifference", get(a["truePositiveRate"], comparator), sizes[subject] * ps, sizes[comparator] * pc, -1)
                check_difference("failMdeFprDifference", get(a["falsePositiveRate"], comparator), sizes[subject] * (1 - ps), sizes[comparator] * (1 - pc), 1)

    # ---- legacy derivation (section 9.3), written again from the text and compared with every derived plan
    def ind_derivation(legacy, data):
        def criterion(id_, kind, **fields):
            return {"id": id_, "kind": kind, "role": "confirmatory", "rationale": None, **fields, "libraryEntry": None, "powerAssumptions": None}

        def at_least(v):
            return {"lower": v, "upper": None}

        def at_most(v):
            return {"lower": None, "upper": v}

        def group(id_, metric, b):
            return criterion(id_, "group_comparison", metric=metric, band=b, comparison={"mode": "all_pairs", "referenceGroup": None}, groupFields=None, declaredGroups=None, minimumCoverage=1.0)

        def chance():  # 1/k, k = labels occurring in the target column (at least 2)
            return 1.0 / max(2, int(np.count_nonzero(np.asarray(data["matrix"]).sum(axis=1))))

        criteria = []
        if legacy["source"] == "hosted_config":
            c, task = legacy["config"], legacy["task"]
            configured = {"sampleSize": c.get("minimumSampleSize", 20), "groupSize": c["minimumGroupSize"], "classCount": c.get("minimumClassCount", 5)}
            source = {"source": "hosted_config", "contractVersion": "1.1"}
            for test in legacy["suite"]:
                if test == "performance" and task == "Binary classification":
                    criteria.append(criterion(test, "performance", members=[{"metric": "accuracy", "band": at_least(c["minimumAccuracy"])}, {"metric": "recall", "band": at_least(c.get("minimumRecall", 0.7))}, {"metric": "balanced_accuracy", "band": at_least(0.5)}]))
                elif test == "performance":
                    criteria.append(criterion(test, "multiclass_performance", members=[{"metric": "accuracy", "band": at_least(c["minimumAccuracy"])}, {"metric": "balanced_accuracy", "band": at_least(chance())}, {"metric": "macro_f1", "band": at_least(c.get("minimumMacroF1", 0.7))}]))
                elif test == "regression":
                    criteria.append(criterion(test, "regression_performance", members=[{"metric": "rmse", "band": at_most(c.get("maximumRmse", 1.0))}], passBlockedBy=[]))
                elif test == "demographic_parity":
                    criteria.append(group(test, "selection_rate_difference", {"lower": -c["maximumParityGap"], "upper": c["maximumParityGap"]}))
                elif test == "disparate_impact":
                    tau = c["minimumImpactRatio"]
                    criteria.append(group(test, "selection_rate_ratio", {"lower": tau, "upper": 1 / tau if tau > 0 else None}))
                else:
                    delta = c.get("maximumOddsGap", c["maximumParityGap"])
                    criteria.append(group(test, "equalized_odds", {"lower": -delta, "upper": delta}))
        else:
            c = legacy["config"]
            values = c["thresholds"]["values"]
            configured = {"sampleSize": c.get("minSampleSize", 30), "groupSize": c.get("minGroupSize", 30), "classCount": c.get("minClassCount", 10)}
            source = {"source": "engine_thresholds", "contractVersion": c["contractVersion"]}

            def rule(key):
                r = values[key]
                return at_least(r["value"]) if r["operator"] == ">=" else at_most(r["value"])

            def classification(keys, base):
                """keys: plan metric -> policy key, in standard order; balanced accuracy is the chance baseline."""
                if not any(key in values for key in keys.values()):
                    return []
                members = []
                for metric, key in keys.items():
                    if metric == "balanced_accuracy":
                        r = values.get(key)
                        members.append({"metric": metric, "band": at_least(base) if r is None else at_least(max(base, r["value"])) if r["operator"] == ">=" else {"lower": base, "upper": r["value"]}})
                    elif key in values:
                        members.append({"metric": metric, "band": rule(key)})
                return members

            if "performance" in c["suite"]:
                if c["task"] == "binary_classification":
                    names = ("accuracy", "precision", "recall", "specificity", "false_positive_rate", "balanced_accuracy", "f1")
                    criteria.append(criterion("PERF-BINARY", "performance", members=classification({n: n for n in names}, 0.5)))
                    if c.get("columns", {}).get("score"):
                        criteria.append(criterion("PERF-CAL", "calibration", band=None, members=[{"metric": "brier_score", "band": rule("brier_score")}] if "brier_score" in values else [], minimumCoverage=1.0, subgroup=None, passBlockedBy=["expected_calibration_error"]))
                elif c["task"] == "multiclass_classification":
                    criteria.append(criterion("PERF-MULTI", "multiclass_performance", members=classification({"accuracy": "accuracy", "balanced_accuracy": "macro_recall", "macro_precision": "macro_precision", "macro_f1": "macro_f1"}, chance())))
                else:
                    criteria.append(criterion("PERF-REG", "regression_performance", members=[{"metric": n, "band": rule(n)} for n in ("mae", "rmse") if n in values], passBlockedBy=["r2"]))
            if "fairness" in c["suite"] and c["task"] == "binary_classification":
                for cid, metric, key in (("FAIR-DP", "selection_rate_difference", "demographic_parity_difference"), ("FAIR-DI", "selection_rate_ratio", "disparate_impact_ratio"), ("FAIR-EO", "equalized_odds", "equalized_odds_difference")):
                    r = values.get(key)
                    v = None if r is None else r["value"]
                    criteria.append(group(cid, metric, None if r is None else {"lower": v, "upper": 1 / v if v > 0 else None} if metric == "selection_rate_ratio" else {"lower": -v, "upper": v}))
        floors = {"sampleSize": 30, "groupSize": 30, "classCount": 10}
        return {"statisticsVersion": "1.0.0", "confidenceLevel": 0.95, "minimums": {k: max(floors[k], configured[k]) for k in floors}, "configuredMinimums": configured, "multiplicity": {"confirmatory": "bonferroni", "exploratory": "benjamini_hochberg"}, "clusterField": None, "bootstrap": {"replicates": 2000}, "calibrationBins": 10, "power": {"targetPower": 0.8, "acknowledgement": None}, "derivedFrom": source, "criteria": criteria}

    for case in fixture["cases"]:
        if "legacy" in case:
            expect(ind_derivation(case["legacy"], case.get("data")) == case["expected"]["normalizedPlan"], "derivation", f"{case['id']} derived plan differs from the section 9.3 rules")

    # ---- plan schema (jsonschema, Draft 2020-12) and plan hashes (Node.js)
    schema = json.loads(PLAN_SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    plan_validator = Draft202012Validator(schema)
    criterion_validator = Draft202012Validator({"$schema": schema["$schema"], "$defs": schema["$defs"], "$ref": "#/$defs/criterion"})
    hashed = []
    for case in fixture["cases"]:
        exp = case["expected"]
        if "normalizedPlan" in exp:
            errors = [e.message for e in plan_validator.iter_errors(exp["normalizedPlan"])]
            expect(not errors, "plan_schema", f"{case['id']} normalized plan: {errors[:3]}")
            if "plan" in case:
                errors = [e.message for e in plan_validator.iter_errors(case["plan"])]
                expect(not errors, "plan_schema", f"{case['id']} input plan: {errors[:3]}")
            try:
                idempotent = exp["normalizedPlan"] == normalize_plan(exp["normalizedPlan"])
            except (AssertionError, KeyError, ValueError) as error:
                idempotent = False
                problems.append(f"[plan_schema] {case['id']} normalised plan is rejected: {error}")
            expect(idempotent, "plan_schema", f"{case['id']} normalisation is not idempotent")
            hashed.append((case["id"], exp["normalizedPlan"], exp["planSha256"]))
        elif case["type"] == "power" and case["input"]["kind"] == "criterion":
            errors = [e.message for e in criterion_validator.iter_errors(case["input"]["criterion"])]
            expect(not errors, "plan_schema", f"{case['id']} criterion: {errors[:3]}")
    # Negative controls: the schema must reject plans that break section 9.
    base = next(c for c in fixture["cases"] if c["id"] == "GC-38")["expected"]["normalizedPlan"]
    negatives = {
        "minimum below its floor": lambda p: p["minimums"].__setitem__("groupSize", 20),
        "Holm in the confirmatory family": lambda p: p["multiplicity"].__setitem__("confirmatory", "holm"),
        "unknown criterion field": lambda p: p["criteria"][0].__setitem__("arbitrary", 1),
        "unknown metric": lambda p: p["criteria"][0]["members"][0].__setitem__("metric", "auc"),
        "band without bounds": lambda p: p["criteria"][1].__setitem__("band", {"lower": None, "upper": None}),
        "reference mode without a reference group": lambda p: p["criteria"][1].__setitem__("comparison", {"mode": "reference", "referenceGroup": None}),
        "coverage below 0.5": lambda p: p["criteria"][1].__setitem__("minimumCoverage", 0.4),
    }
    for label, mutate in negatives.items():
        plan = json.loads(json.dumps(base))
        mutate(plan)
        expect(not plan_validator.is_valid(plan), "plan_schema", f"schema accepts an invalid plan: {label}")
    # passBlockedBy is set only by derivation, and only to the kind's own undecidable metric.
    for label, case_id, blocked in (("passBlockedBy in a plan that was not derived", "GC-35", ["r2"]), ("passBlockedBy naming another kind's metric", "GC-48", ["expected_calibration_error"]), ("passBlockedBy on a binary criterion", "GC-47", [])):
        plan = json.loads(json.dumps(next(c for c in fixture["cases"] if c["id"] == case_id)["expected"]["normalizedPlan"]))
        plan["criteria"][0]["passBlockedBy"] = blocked
        expect(not plan_validator.is_valid(plan), "plan_schema", f"schema accepts an invalid plan: {label}")
    node = shutil.which("node")
    if node is None:
        problems.append("[plan_hashes] Node.js is not on PATH, so the plan hashes were not cross-checked")
    else:
        result = subprocess.run([node, "-e", NODE_JCS], input=json.dumps([p for _, p, _ in hashed]), capture_output=True, text=True, encoding="utf-8", check=True)
        for (case_id, _, want), got in zip(hashed, json.loads(result.stdout)):
            expect(got == want, "plan_hashes", f"{case_id} Node.js JCS hash {got} vs {want}")
    return sum(tally.values()), problems, tally


def mutation_test(fixture):
    """Corrupt one fixture value at a time and confirm that the independent cross-check reports it."""
    import copy

    def case(f, cid):
        return next(c for c in f["cases"] if c["id"] == cid)

    def crit(f, cid, i=0):
        return case(f, cid)["expected"]["criteria"][i]

    def bump(obj, key, delta):
        obj[key] = obj[key] + delta

    def replan(f, cid, change):
        """Change a derived plan and recompute its hash, so that only the derivation check can notice."""
        expected = case(f, cid)["expected"]
        change(expected["normalizedPlan"]["criteria"][0])
        expected["planSha256"] = plan_sha256(expected["normalizedPlan"])

    def skip_chance_gate(f, cid):
        """A runner without the chance gate: the member keeps its interval p, and the criterion and run pass consistently."""
        expected, c = case(f, cid)["expected"], crit(f, cid)
        source = next(item for item in CASES if item["id"] == cid)
        reference = next(m for m in evaluate_plan(plan_for(source), source["data"])["criteria"][0]["members"] if m["chanceExactP"] is not None)
        gated = next(m for m in c["members"] if m["memberId"] == reference["memberId"])
        gated["chanceExactP"] = None
        gated["pValue"] = reference["_pInterval"]  # the member's interval p, without the gate
        d = c["decision"]
        d.update(pValue=gated["pValue"], adjustedPValue=gated["pValue"], unadjustedOutcome="pass", reasons=[])
        c["outcome"] = expected["overallOutcome"] = "pass"

    mutations = {
        "headline upper bound": lambda f: bump(crit(f, "GC-22")["headline"]["interval"], "upper", 1e-4),
        "one-sided headline estimate": lambda f: crit(f, "GC-30")["headline"].__setitem__("estimate", 0.76),
        "coverage": lambda f: crit(f, "GC-33")["decision"]["coverage"].__setitem__("value", 0.92),
        "ECE": lambda f: crit(f, "GC-24")["descriptive"][0].__setitem__("estimate", 0.03),
        "R2": lambda f: crit(f, "GC-35")["descriptive"][0].__setitem__("estimate", 0.5),
        "criterion P": lambda f: crit(f, "GC-17")["decision"].__setitem__("pValue", 0.05),
        "family-adjusted P": lambda f: crit(f, "GC-31", 2)["decision"].__setitem__("adjustedPValue", 0.0626),
        "criterion outcome": lambda f: crit(f, "GC-37", 1).__setitem__("outcome", "pass"),
        "run outcome": lambda f: case(f, "GC-31")["expected"].__setitem__("overallOutcome", "pass"),
        "descriptive interval": lambda f: crit(f, "GC-38")["descriptive"][0]["interval"].__setitem__("lower", 0.5),
        "per-group interval": lambda f: crit(f, "GC-20")["groups"][0]["tpr"]["interval"].__setitem__("upper", 0.9),
        "member direction": lambda f: crit(f, "GC-03")["members"][0].__setitem__("direction", "pass"),
        "plan hash": lambda f: case(f, "GC-38")["expected"].__setitem__("planSha256", "0" * 64),
        "normalised plan below the floors": lambda f: case(f, "GC-39")["expected"]["normalizedPlan"]["minimums"].__setitem__("groupSize", 20),
        "required group size": lambda f: bump(case(f, "GC-40")["expected"], "requiredGroupSizeForPass", 1),
        "required n": lambda f: bump(case(f, "GC-41")["expected"], "requiredNForPass", -1),
        "fail MDE ratio": lambda f: case(f, "GC-27")["expected"].__setitem__("failMdeRatio", 0.62),
        "fail MDE TPR": lambda f: case(f, "GC-42")["expected"].__setitem__("failMdeTprDifference", 0.2),
        "fail probability": lambda f: case(f, "GC-29")["expected"].__setitem__("failProbability", 0.01),
        "pass-probability lower bound": lambda f: case(f, "GC-41")["expected"].__setitem__("passProbability", 0.4),
        "member pass probability": lambda f: case(f, "GC-44")["expected"]["members"][0].__setitem__("passProbability", 0.5),
        "LL144 share": lambda f: case(f, "GC-32")["expected"]["categories"][5].__setitem__("shareOfData", 0.0159),
        "sample size": lambda f: crit(f, "GC-33")["decision"].__setitem__("sampleSize", 2834),
        "deciding member": lambda f: crit(f, "GC-31")["decision"].__setitem__("decidingMemberId", "accuracy"),
        "suppressed member marked evaluated": lambda f: next(m for m in crit(f, "GC-22")["members"] if m["status"] == "suppressed").__setitem__("status", "evaluated"),
        "binary chance baseline lowered to the policy bound": lambda f: replan(f, "GC-47", lambda c: c["members"][1]["band"].__setitem__("lower", 0.4)),
        "multiclass chance baseline dropped": lambda f: replan(f, "GC-46", lambda c: c["members"].pop(1)),
        "R2 no longer blocking the derived regression criterion": lambda f: replan(f, "GC-48", lambda c: c.__setitem__("passBlockedBy", [])),
        "pass P despite an undecidable metric": lambda f: crit(f, "GC-48")["decision"].__setitem__("pValue", crit(f, "GC-48")["members"][0]["pValue"]),
        "chance gate p-value": lambda f: crit(f, "GC-50")["members"][1].__setitem__("chanceExactP", 0.05),
        "multiclass chance gate without its Bonferroni factor": lambda f: crit(f, "GC-51")["members"][1].__setitem__("chanceExactP", 0.04),
        "chance gate skipped, the pass recomputed without it": lambda f: skip_chance_gate(f, "GC-50"),
    }
    missed = []
    for name, mutate in mutations.items():
        mutated = copy.deepcopy(fixture)
        mutate(mutated)
        if not cross_check(mutated)[1]:
            missed.append(name)
    return len(mutations), missed


def false_fail_enumeration():
    """Exact P(false fail) for one Newcombe member whose true difference sits on the upper edge of a two-sided band
    (section 6): sum binomial probabilities over every table whose interval lies wholly above or below the band."""
    z = zcrit(0.95)
    lines = []
    for n, delta, p2 in ((100, 0.02, 0.49), (300, 0.01, 0.49)):
        p1 = p2 + delta
        a = [math.comb(n, k) * p1 ** k * (1 - p1) ** (n - k) for k in range(n + 1)]
        b = [math.comb(n, k) * p2 ** k * (1 - p2) ** (n - k) for k in range(n + 1)]
        above = below = 0.0
        for x1 in range(n + 1):
            for x2 in range(n + 1):
                lo, hi = newcombe(x1, n, x2, n, z)
                if lo > delta:
                    above += a[x1] * b[x2]
                elif hi < -delta:
                    below += a[x1] * b[x2]
        lines.append(f"exact false-fail probability, {n} per group, band +/-{delta}, true difference {delta} ({p1:.2f} vs {p2:.2f}): {above + below:.4f} (above the band {above:.4f}, below {below:.4f})")
    return lines


CHANCE_DESIGNS = ((100, 1900), (50, 950), (10, 1000), (20, 5000), (30, 30), (100, 100), (300, 700))


def _runs(values):
    """Sorted integers as [first, last] runs."""
    runs = []
    for value in values:
        if runs and value == runs[-1][1] + 1:
            runs[-1][1] = value
        else:
            runs.append([value, value])
    return runs


def _gate_thresholds(positives, total, alpha):
    """For each predicted-positive count m, the smallest TP that passes the binary chance gate (None if none does).
    Tails in log space; a tail too close to alpha to call in floating point is recomputed with exact integers."""
    logf = [math.lgamma(k + 1) for k in range(total + 1)]
    negatives, out = total - positives, []
    for m in range(total + 1):
        lo, hi = max(0, m - negatives), min(positives, m)
        logs = [logf[positives] - logf[x] - logf[positives - x] + logf[negatives] - logf[m - x] - logf[negatives - m + x] for x in range(lo, hi + 1)]
        top = max(logs)
        weights = [math.exp(v - top) for v in logs]
        whole, tail, threshold = math.fsum(weights), 0.0, None
        for x in range(hi, lo - 1, -1):
            tail += weights[x - lo]
            p = min(1.0, 2.0 * tail / whole)
            if abs(p - alpha) < 1e-9:
                p = chance_exact_p([(x, positives, m, total)])
            if p > alpha + EPS:
                break
            threshold = x
        out.append(threshold)
    return out


def chance_baseline_enumeration():
    """Exact pass probabilities of the chance baseline for predictors that ignore the truth (section 5.2), stdlib only.

    * Binary: the balanced_accuracy >= 0.5 member alone, for a predictor that says positive with probability q whatever
      the label, maximised over a logit grid of q, with the interval rule only and with the chance gate.
    * GC-47's derived plan at 100 positives / 1,900 negatives and q = 0.00125, by evaluate_plan itself.
    * GC-46's derived plan for three classes with supports 40/1,900/60 and predictions drawn with probabilities
      0.001/0.998/0.001, enumerated over every table in which each row has at most 4, 20 and 5 predictions outside
      the majority class (the omitted probability is printed).
    The fast predicates are checked against evaluate_plan on the likeliest tables. Returns (lines, ok)."""
    alpha, z = 0.05, zcrit(0.95)
    ok, lines = True, []
    grid = sorted({1.0 / (1.0 + math.exp(-t / 10.0)) for t in range(-120, 121)} | {0.00125})
    lines.append(f"chance baseline (section 5.2): exact pass probability of the member balanced_accuracy >= 0.5 alone, for a binary predictor that says positive with probability q whatever the label (largest over a logit grid of {len(grid)} values of q, refined around the maximum):")
    worst = mirror_gap = 0.0
    for positives, negatives in CHANCE_DESIGNS:
        total = positives + negatives
        thresholds = _gate_thresholds(positives, total, alpha)
        interval_runs, gated_runs, fail_runs = [], [], []
        for tp in range(positives + 1):
            limit = -(-negatives * tp // positives)  # FP < limit exactly when the estimate is above 0.5
            passing = [fp for fp in range(min(limit, negatives + 1)) if mover_mean([(tp, positives), (negatives - fp, negatives)], z)[0] >= 0.5]
            interval_runs.append(_runs(passing))
            gated_runs.append(_runs([fp for fp in passing if thresholds[tp + fp] is not None and tp >= thresholds[tp + fp]]))
            start = negatives * tp // positives + 1  # FP >= start exactly when the estimate is below 0.5
            fail_runs.append(_runs([fp for fp in range(start, negatives + 1) if mover_mean([(tp, positives), (negatives - fp, negatives)], z)[1] < 0.5]))
        log_c_pos = [math.lgamma(positives + 1) - math.lgamma(k + 1) - math.lgamma(positives - k + 1) for k in range(positives + 1)]
        log_c_neg = [math.lgamma(negatives + 1) - math.lgamma(k + 1) - math.lgamma(negatives - k + 1) for k in range(negatives + 1)]

        def pass_probability(runs, q):
            lq, l1q = math.log(q), math.log1p(-q)
            p_tp = [math.exp(c + k * lq + (positives - k) * l1q) for k, c in enumerate(log_c_pos)]
            prefix = [0.0]
            for k, c in enumerate(log_c_neg):
                prefix.append(prefix[-1] + math.exp(c + k * lq + (negatives - k) * l1q))
            return math.fsum(p_tp[tp] * (prefix[b + 1] - prefix[a]) for tp, row in enumerate(runs) for a, b in row)

        best = {}
        for name, runs in (("interval", interval_runs), ("gated", gated_runs)):
            top = max((pass_probability(runs, q), q) for q in grid)
            t0 = math.log(top[1] / (1.0 - top[1]))  # refine on a 40 times finer logit grid around the coarse maximum
            best[name] = max([top] + [(pass_probability(runs, q), q) for q in (1.0 / (1.0 + math.exp(-(t0 + i / 400.0))) for i in range(-40, 41))])
        worst = max(worst, best["gated"][0])
        # Fails are not gated (section 6): at 1 - q the member is failed exactly as often as it passes at q without the gate.
        mirror_gap = max(mirror_gap, abs(pass_probability(fail_runs, 1.0 - best["interval"][1]) - best["interval"][0]))
        lines.append(f"  {positives} positives / {negatives} negatives: interval only {best['interval'][0]:.4f} (q = {best['interval'][1]:.3g}); with the chance gate {best['gated'][0]:.4f} (q = {best['gated'][1]:.3g})")
        if (positives, negatives) == (100, 1900):  # the fast predicate must agree with the normative rule
            member_plan = normalize_plan({"criteria": [perf("baseline", [("balanced_accuracy", band(0.5))])]})
            q = 0.00125
            for tp in range(12):
                for fp in range(40):
                    result = evaluate_plan(member_plan, {"groups": [cm("all", tp, fp, positives - tp, negatives - fp)]})["criteria"][0]
                    fast_interval = any(a <= fp <= b for a, b in interval_runs[tp])
                    fast_gated = any(a <= fp <= b for a, b in gated_runs[tp])
                    m = result["members"][0]
                    rule_interval = m["status"] == "evaluated" and m["direction"] == "pass" and m["_pInterval"] <= alpha + EPS
                    if fast_interval != rule_interval or fast_gated != (result["outcome"] == "pass"):
                        ok = False
                        lines.append(f"  MISMATCH with evaluate_plan at TP {tp}, FP {fp}")
    within = worst <= alpha / 2.0
    ok = ok and within and mirror_gap <= 1e-9
    lines.append(f"  largest pass probability with the chance gate: {worst:.4f} ({'at most' if within else 'ABOVE'} alpha/2 = {alpha / 2})")
    lines.append(f"  fails are not gated: at 1 - q the member fails a predictor with its interval-only pass probability at q (largest difference {mirror_gap:.1e})")

    # GC-47's derived plan, by evaluate_plan itself.
    source = next(c for c in CASES if c["id"] == "GC-47")
    plan, positives, negatives, q = plan_for(source), 100, 1900, 0.00125
    interval = gated = mass = 0.0
    for tp in range(16):
        for fp in range(40):
            probability = math.comb(positives, tp) * q ** tp * (1 - q) ** (positives - tp) * math.comb(negatives, fp) * q ** fp * (1 - q) ** (negatives - fp)
            mass += probability
            result = evaluate_plan(plan, {"groups": [cm("all", tp, fp, positives - tp, negatives - fp)]})["criteria"][0]
            members = result["members"]
            interval += probability * (all(m["status"] == "evaluated" and m["direction"] == "pass" for m in members) and max(m["_pInterval"] for m in members) <= alpha + EPS)
            gated += probability * (result["outcome"] == "pass")
    lines.append(f"GC-47's derived plan (accuracy >= 0.90, balanced accuracy >= 0.5), 100 positives / 1900 negatives, q = 0.00125: interval only {interval:.4f}; with the chance gate {gated:.4f} (omitted probability {max(0.0, 1 - mass):.1e})")

    # GC-46's derived plan for three classes, rows truncated.
    source = next(c for c in CASES if c["id"] == "GC-46")
    plan, labels, supports, probs, limits = plan_for(source), ["high", "low", "medium"], (40, 1900, 60), (0.001, 0.998, 0.001), (4, 20, 5)
    bound = plan["criteria"][0]["members"][1]["band"]["lower"]
    total, majority = sum(supports), 1
    rows = []
    for r, size in enumerate(supports):
        outcomes = []
        for first in range(limits[r] + 1):
            for third in range(limits[r] + 1 - first):
                counts = [first, size - first - third, third]
                log_p = math.lgamma(size + 1) - sum(math.lgamma(c + 1) for c in counts) + sum(c * math.log(p) for c, p in zip(counts, probs) if c)
                outcomes.append((counts, math.exp(log_p)))
        rows.append(outcomes)
    tails = {}

    def tail(x, support, predicted):
        key = (x, support, predicted)
        if key not in tails:
            tails[key] = fisher_greater(x, support, predicted, total)
        return tails[key]

    def fast(matrix):
        correct = sum(matrix[c][c] for c in range(3))
        passes = wilson(correct, total, z)[0] >= 0.9 and mover_mean([(matrix[c][c], supports[c]) for c in range(3)], z)[0] >= bound
        if not passes:
            return False, False
        predicted = [sum(matrix[r][c] for r in range(3)) for c in range(3)]
        return True, min(1.0, 6.0 * min(tail(matrix[c][c], supports[c], predicted[c]) for c in range(3))) <= alpha + EPS

    interval = gated = mass = 0.0
    likeliest = []
    for (high, p_high) in rows[0]:
        for (low, p_low) in rows[1]:
            for (medium, p_medium) in rows[2]:
                probability = p_high * p_low * p_medium
                mass += probability
                matrix = [high, low, medium]
                by_interval, by_gate = fast(matrix)
                interval += probability * by_interval
                gated += probability * by_gate
                if probability > 1e-5 or by_interval and probability > 1e-9:
                    likeliest.append((matrix, by_interval, by_gate))
    for matrix, by_interval, by_gate in likeliest:
        data = {"kind": "multiclass", "labels": labels, "matrix": matrix}
        result = evaluate_plan(plan, data)["criteria"][0]
        members = result["members"]
        rule_interval = all(m["status"] == "evaluated" and m["direction"] == "pass" for m in members) and max(m["_pInterval"] for m in members) <= alpha + EPS
        if rule_interval != by_interval or (result["outcome"] == "pass") != by_gate:
            ok = False
            lines.append(f"  MISMATCH with evaluate_plan at {matrix}")
    lines.append(f"GC-46's derived plan (accuracy >= 0.90, macro recall >= 1/3), supports 40/1900/60, predictions 0.001/0.998/0.001 whatever the label: interval only {interval:.4f}; with the chance gate {gated:.4f} (omitted probability {max(0.0, 1 - mass):.1e}; {len(likeliest)} tables checked against evaluate_plan)")
    for cid in ("GC-50", "GC-51"):
        source = next(c for c in CASES if c["id"] == cid)
        m = next(m for m in evaluate_plan(plan_for(source), source["data"])["criteria"][0]["members"] if m["chanceExactP"] is not None)
        lines.append(f"{cid}: the {m['memberId']} member's interval alone gives p = {m['_pInterval']:.2g}; its chanceExactP is {m['chanceExactP']:.4f}, so its decision p is {m['pValue']:.4f}")
    return lines, ok


def simulate(fixture, sims=20000):
    """Monte Carlo checks; returns the report lines and whether every power figure is within FORMULA_ERROR."""
    import numpy as np

    rng = np.random.default_rng(20261105)
    report = []
    FORMULA_ERROR = 0.02  # sections 8 and 13.3: the member formulas are normal approximations
    worst_member, worst_range = 0.0, 0.0

    def interval_pass(lo, hi, b):
        return (b["lower"] is None or lo >= b["lower"]) and (b["upper"] is None or hi <= b["upper"])

    # Power formulas against the actual decision rules, at the family-adjusted level.
    for case in fixture["cases"]:
        inp = case.get("input") or {}
        if case["type"] != "power" or inp.get("kind") != "criterion" or case["expected"]["status"] != "computed":
            continue
        crit = normalize_criterion(inp["criterion"])
        a, z = crit["powerAssumptions"], zcrit(1 - (1 - inp["confidenceLevel"]) / inp["familySize"])
        hits, member_hits = 0, Counter()
        if crit["kind"] == "group_comparison" and crit["metric"] != "equalized_odds":
            names = sorted(a["groupSizes"])
            sizes = [a["groupSizes"][g] for g in names]
            rates = [(a["assumedRates"] or {}).get(g, a["baselineRate"]) for g in names]
            draws = np.column_stack([rng.binomial(n, p, sims) for n, p in zip(sizes, rates)])
            for row in draws:
                ok = True
                for i in range(len(names)):
                    for j in range(i + 1, len(names)):
                        (xs, ns), (xc, nc) = sorted([(int(row[i]), sizes[i]), (int(row[j]), sizes[j])], key=lambda t: t[0] / t[1])
                        if crit["metric"] == "selection_rate_ratio":
                            method = ratio_method(xs, ns, xc, nc)
                            lo, hi = (katz if method == "katz_log" else koopman)(xs, ns, xc, nc, z) if method else (0.0, math.inf)
                        else:
                            lo, hi = newcombe(xs, ns, xc, nc, z)
                        passed = interval_pass(lo, hi, crit["band"])
                        member_hits[f"{names[i]}|{names[j]}"] += passed
                        ok = ok and passed
                hits += ok
        elif crit["kind"] == "group_comparison":
            names = sorted(a["groupSizes"])
            get = lambda v, g: v[g] if isinstance(v, dict) else v
            for _ in range(sims):
                counts = []
                for g in names:
                    n = a["groupSizes"][g]
                    pos = int(rng.binomial(n, get(a["prevalence"], g)))
                    counts.append((int(rng.binomial(pos, get(a["truePositiveRate"], g))), pos, int(rng.binomial(n - pos, get(a["falsePositiveRate"], g))), n - pos))
                (tp1, p1, fp1, n1), (tp2, p2, fp2, n2) = counts
                tpr_ok, fpr_ok = interval_pass(*newcombe(tp1, p1, tp2, p2, z), crit["band"]), interval_pass(*newcombe(fp1, n1, fp2, n2, z), crit["band"])
                member_hits["tpr"] += tpr_ok
                member_hits["fpr"] += fpr_ok
                hits += tpr_ok and fpr_ok
        elif crit["kind"] == "performance":
            pi, tpr, tnr, n = a["prevalence"], a["truePositiveRate"], a["trueNegativeRate"], a["n"]
            alpha_member = (1 - inp["confidenceLevel"]) / inp["familySize"]
            for tp, fn, fp, tn in rng.multinomial(n, [pi * tpr, pi * (1 - tpr), (1 - pi) * (1 - tnr), (1 - pi) * tnr], sims):
                cmx = {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)}
                ok = True
                for item in crit["members"]:
                    stat = binary_stat(item["metric"], cmx, FLOORS)
                    passed = stat.status == "evaluated" and interval_pass(*stat.ci_at(z), item["band"])
                    if passed and chance_gated(item["band"], stat.chance):  # the chance gate of section 5.2
                        passed = chance_exact_p(stat.chance[1]) <= alpha_member + EPS
                    member_hits[item["metric"]] += passed
                    ok = ok and passed
                hits += ok
        elif crit["kind"] == "regression_performance":
            for errors in rng.normal(0.0, a["errorSd"], (sims, a["n"])):
                data = {"errors": [float(e) for e in errors]}
                ok = True
                for item in crit["members"]:
                    passed = interval_pass(*regression_stat(item["metric"], data, FLOORS).ci_at(z), item["band"])
                    member_hits[item["metric"]] += passed
                    ok = ok and passed
                hits += ok
        else:
            continue
        exp = case["expected"]
        formula_members = ", ".join(f"{m['passProbability']:.4f}" for m in exp["members"])
        simulated_members = ", ".join(f"{count / sims:.4f}" for count in member_hits.values())
        assert len(member_hits) == len(exp["members"])
        rate = hits / sims
        member_gap = max(abs(m["passProbability"] - count / sims) for m, count in zip(exp["members"], member_hits.values()))
        range_gap = max(0.0, exp["passProbability"] - rate, rate - exp["passProbabilityUpperBound"])
        worst_member, worst_range = max(worst_member, member_gap), max(worst_range, range_gap)
        where = "inside the range" if range_gap == 0.0 else f"outside the range by {range_gap:.4f}"
        report.append(f"{case['id']}: criterion pass probability formula [{exp['passProbability']:.4f}, {exp['passProbabilityUpperBound']:.4f}], simulated {rate:.4f} ({where}); members formula ({formula_members}), simulated ({simulated_members}), largest gap {member_gap:.4f}")
    ok = worst_member <= FORMULA_ERROR and worst_range <= FORMULA_ERROR
    report.append(f"power: largest member gap {worst_member:.4f} and largest distance of a criterion's simulated rate from its range {worst_range:.4f}, against the member formulas' error of {FORMULA_ERROR}: {'within' if ok else 'EXCEEDED'}")

    # Coverage of the derived intervals.
    z = zcrit(0.95)

    def coverage(name, draw, truth, interval):
        hits = 0
        for _ in range(sims):
            lo, hi = interval(*draw())
            hits += lo <= truth <= hi
        report.append(f"coverage {name}: {hits / sims:.4f} (nominal 0.95)")

    probs = [0.12, 0.05, 0.08, 0.75]  # tp, fp, fn, tn
    j = probs[0] / (probs[0] + probs[1] + probs[2])
    coverage("F1 via Jaccard-Wilson, n=400", lambda: tuple(rng.multinomial(400, probs)), 2 * j / (1 + j), lambda tp, fp, fn, tn: jaccard_f1(int(tp), int(tp + fp + fn), z))
    coverage("balanced accuracy MOVER, 60 pos / 340 neg", lambda: (rng.binomial(60, 0.7), rng.binomial(340, 0.9)), 0.8, lambda a, b: mover_mean([(int(a), 60), (int(b), 340)], z))
    coverage("Koopman ratio 0/x-prone, n=40 vs 40, p=0.05 vs 0.25", lambda: (rng.binomial(40, 0.05), rng.binomial(40, 0.25)), 0.2, lambda a, b: koopman(int(a), 40, int(b), 40, z) if b > 0 else (0.0, math.inf))
    conf = np.array([[0.20, 0.03, 0.04], [0.02, 0.30, 0.05], [0.05, 0.04, 0.27]])
    true_macro = float(np.mean([2 * conf[i, i] / (conf[i].sum() + conf[:, i].sum()) for i in range(3)]))
    true_precision = float(np.mean([conf[i, i] / conf[:, i].sum() for i in range(3)]))

    def macro_draw():
        cells = rng.multinomial(600, conf.ravel()).reshape(3, 3)
        return (cells,)

    coverage("macro F1 Bonferroni Jaccard-Wilson, n=600, 3 classes", macro_draw, true_macro, lambda cells: macro_f1_interval([(int(cells[i, i]), int(cells[i].sum() + cells[:, i].sum() - cells[i, i])) for i in range(3)], z))
    coverage("macro precision Bonferroni Wilson mean, n=600, 3 classes", macro_draw, true_precision, lambda cells: mean_bonferroni_wilson([(int(cells[i, i]), int(cells[:, i].sum())) for i in range(3)], z))
    rates, n_group = (0.50, 0.45, 0.40), 300
    z_bon = zcrit(1 - 0.05 / 3)

    def worst_gap(*xs):
        pairs = [(i, k) for i in range(3) for k in range(i + 1, 3)]
        lows = [max(0.0, lo, -hi) for lo, hi in (newcombe(int(xs[i]), n_group, int(xs[k]), n_group, z_bon) for i, k in pairs)]
        highs = [max(abs(lo), abs(hi)) for lo, hi in (newcombe(int(xs[i]), n_group, int(xs[k]), n_group, z) for i, k in pairs)]
        return max(lows), max(highs)

    coverage("headline worst-member bounds, 3 groups (0.50/0.45/0.40, n=300)", lambda: tuple(rng.binomial(n_group, r) for r in rates), 0.10, worst_gap)

    # Appendix A.3: headline coverage over 2, 3 and 5 groups, at parity (W = 0), near it and away from it.
    lowest = (1.0, None)
    for k in (2, 3, 5):
        pairs = [(i, j) for i in range(k) for j in range(i + 1, k)]
        z_b = zcrit(1 - 0.05 / len(pairs))
        for spread in (0.0, 0.02, 0.10):
            group_rates = [0.5 - spread * i / (k - 1) for i in range(k)]
            truth = max(abs(group_rates[i] - group_rates[j]) for i, j in pairs)
            for n in (100, 1000):
                hits = 0
                for row in np.column_stack([rng.binomial(n, r, sims) for r in group_rates]):
                    xs = [int(x) for x in row]
                    low = max(max(0.0, lo, -hi) for lo, hi in (newcombe(xs[i], n, xs[j], n, z_b) for i, j in pairs))
                    high = max(max(abs(lo), abs(hi)) for lo, hi in (newcombe(xs[i], n, xs[j], n, z) for i, j in pairs))
                    hits += low <= truth <= high
                lowest = min(lowest, (hits / sims, f"{k} groups, W = {truth:.2f}, n = {n}"))
    report.append(f"coverage headline worst-member bounds over 2, 3 and 5 groups, W = 0, 0.02 and 0.10, n = 100 and 1000 per group (18 designs): lowest {lowest[0]:.4f}, at {lowest[1]} (nominal 0.95)")
    return report, ok


def markdown(fixture):
    def fmt(v):
        return "n/a" if v is None else f"{v:.4f}"

    lines = ["| Case | Criterion / entry | Estimate | 95% interval | Decision p | Outcome |", "|---|---|---|---|---|---|"]
    for case in fixture["cases"]:
        exp = case["expected"]
        if case["type"] == "plan":
            for crit in exp["criteria"]:
                for m in crit["members"] + crit["descriptive"]:
                    iv = m["interval"]
                    lines.append(f"| {case['id']} | {crit['id']} / {m['memberId']} | {fmt(m['estimate'])} | {'n/a' if iv is None else '[' + fmt(iv['lower']) + ', ' + fmt(iv['upper']) + ']'} | {'-' if m['pValue'] is None else format(m['pValue'], '.4g')} | {m['status']}, {m['direction']} |")
                h, d = crit["headline"], crit["decision"]
                hv = "" if h is None else f" headline {fmt(h['estimate'])} [{fmt(h['interval']['lower'])}, {fmt(h['interval']['upper'])}]"
                lines.append(f"| {case['id']} | **{crit['id']}**{hv} | | | P={d['pValue']:.4g}, adj={d['adjustedPValue']:.4g} | **{crit['outcome']}** ({', '.join(d['reasons']) or '-'}) |")
        elif case["type"] == "multiplicity":
            lines.append(f"| {case['id']} | {case['input']['method']} {case['input']['pValues']} | | | adjusted {[round(a, 4) for a in exp['adjustedPValues']]} | rejected {exp['rejected']} |")
        elif case["type"] == "power":
            lines.append(f"| {case['id']} | power | | | | {json.dumps({k: v for k, v in exp.items() if k != 'members'})} |")
        elif case["type"] == "fisher":
            for t, p in zip(case["input"]["tables"], exp["pValues"]):
                lines.append(f"| {case['id']} | Fisher {t['subject']['x']}/{t['subject']['n']} vs {t['comparator']['x']}/{t['comparator']['n']} | | | {p:.6g} | |")
        elif case["type"] == "ll144":
            for row in exp["categories"]:
                iv = row["impactRatioInterval"]
                lines.append(f"| {case['id']} | {row['category']} | rate {fmt(row['selectionRate'])}, IR {fmt(row['impactRatio'])} | {'reference' if iv is None else '[' + fmt(iv['lower']) + ', ' + fmt(iv['upper']) + ']'} | | share {row['shareOfData']:.4f}{' (2% rule)' if row['eligibleForTwoPercentExclusion'] else ''} |")
        else:
            lines.append(f"| {case['id']} | derivation | | | | planSha256 {exp['planSha256'][:16]}... |")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--fixture", default=str(FIXTURE))
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--cross-check", action="store_true")
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--mutation-test", action="store_true", help="corrupt fixture values one at a time and confirm --cross-check reports each")
    parser.add_argument("--enumerate", action="store_true", help="exact false-fail probabilities for a two-sided band (section 6) and exact chance-baseline pass probabilities (section 5.2); stdlib only")
    parser.add_argument("--markdown", action="store_true")
    parser.add_argument("--show-plan", metavar="CASE", help="print a case's normalised plan, its RFC 8785 bytes and its SHA-256")
    args = parser.parse_args()
    built = build()
    path = Path(args.fixture)
    if args.write:
        path.write_text(json.dumps(built, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {path} ({len(built['cases'])} cases)")
    status = 0
    if args.enumerate:
        for line in false_fail_enumeration():
            print(line)
        lines, ok = chance_baseline_enumeration()
        for line in lines:
            print(line)
        status |= not ok
    if args.show_plan:
        case = next(c for c in CASES if c["id"] == args.show_plan)
        plan = plan_for(case)
        print(json.dumps(plan, indent=1, ensure_ascii=False))
        print(jcs(plan))
        print(plan_sha256(plan))
    if args.check:
        stored = json.loads(path.read_text(encoding="utf-8"))
        problems = diff(built, stored)
        print(f"reference recomputation: {len(problems)} differences across {len(stored['cases'])} cases")
        for p in problems[:50]:
            print("  " + p)
        status |= bool(problems)
    if args.cross_check or args.simulate or args.mutation_test:
        try:
            import jsonschema  # noqa: F401
            import numpy  # noqa: F401
            import scipy  # noqa: F401
            import statsmodels  # noqa: F401
        except ImportError:
            print("--cross-check/--simulate need numpy, scipy, statsmodels and jsonschema: install them in a throwaway virtualenv outside the repository (never as project dependencies).")
            return 2
    if args.cross_check:
        checks, problems, tally = cross_check(json.loads(path.read_text(encoding="utf-8")) if path.exists() else built)
        print(f"independent cross-check: {checks} checks, {len(problems)} problems")
        print("  by category: " + ", ".join(f"{k} {v}" for k, v in sorted(tally.items())))
        for p in problems:
            print("  " + p)
        status |= bool(problems)
    if args.mutation_test:
        total, missed = mutation_test(json.loads(path.read_text(encoding="utf-8")))
        print(f"mutation test: {total - len(missed)} of {total} corrupted values reported by the cross-check")
        for name in missed:
            print("  missed: " + name)
        status |= bool(missed)
    if args.simulate:
        lines, ok = simulate(built)
        for line in lines:
            print(line)
        status |= not ok
    if args.markdown:
        print(markdown(built))
    return status


if __name__ == "__main__":
    sys.exit(main())
