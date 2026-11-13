"""Audit statistics core: statistics specification 1.0.0 (docs/design/audit-statistics.md).

Standard library only. Every interval, decision p-value, exact test, family
adjustment, power formula, plan normalisation and plan hash here follows the
normative text of the specification, and schemas/fixtures/statistics-golden.json
is the arbiter (engine/tests/test_statistics_golden.py). The functions work on
counts; engine/diagnostics.py turns rows into counts and results.

The interval decides, never the point estimate: a criterion passes only when its
interval lies inside the pre-registered band, fails only when it lies outside,
and is inconclusive otherwise (section 4). Confirmatory criteria are adjusted
with Bonferroni and exploratory criteria with Benjamini-Hochberg (section 6).
"""
from __future__ import annotations

import hashlib
import json
import math
import operator
import random
import re
from pathlib import Path
from statistics import NormalDist


class StatisticsError(ValueError):
    """A plan, configuration or input that statistics 1.0.0 rejects."""


def _require(condition, message):
    if not condition:
        raise StatisticsError(message)


ND = NormalDist()
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
# Section 5.9: a regression pass also needs the model to beat the mean-prediction baseline; an MSE reduction of at
# most this share of the baseline MSE is floating-point rounding and never counts as beating it.
BASELINE_TOLERANCE = 1e-9
RATE_KEYS = {"selection_rate_difference": "selection", "selection_rate_ratio": "selection", "tpr_difference": "tpr", "fpr_difference": "fpr"}
# Headline names keep each runner's existing metric names (section 11).
HEADLINE_NAMES = {
    "selection_rate_difference": {"engine": "demographic_parity_difference", "hosted": "maximum_selection_rate_gap"},
    "selection_rate_ratio": {"engine": "disparate_impact_ratio", "hosted": "minimum_selection_rate_ratio"},
    "equalized_odds": {"engine": "equalized_odds_difference", "hosted": "maximum_tpr_fpr_gap"},
    "calibration": {"engine": "maximum_calibration_gap", "hosted": None},
}
# Section 10.1: the threshold library is data. engine/threshold-library.json is the generated copy of
# schemas/threshold-library.json (npm run sync in site-app/), kept beside this module so that the compute image,
# whose build context is engine/, ships it; the hosted runner reads its own copy of the same file. A criterion can
# reference the entries whose kind is a criterion kind; the attribute-sampling entries (Art 50) wait for M2.
LIBRARY_FILE = Path(__file__).resolve().parent/"threshold-library.json"
CRITERION_KINDS = PERFORMANCE_KINDS + ("group_comparison", "calibration")
LIBRARY_FIELDS = ("version", "kind", "metric", "parameters", "legalStatus", "caveat")


def load_library(path=LIBRARY_FILE):
    """The entries of the threshold library a plan criterion can reference, keyed by id."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return {entry["id"]: {key: entry[key] for key in LIBRARY_FIELDS} for entry in data["entries"] if entry["kind"] in CRITERION_KINDS}


LIBRARY = load_library()


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
    _require(entry.get("version", spec["version"]) == spec["version"], "unknown library version")
    _require(criterion["kind"] == spec["kind"] and spec["metric"] in (None, criterion.get("metric")), "criterion does not match its library entry")
    params = {}
    for name, rule in spec["parameters"].items():
        value = entry.get("parameters", {}).get(name, rule["default"])
        _require(value is not None, f"library parameter {name} is required")
        _require(("enum" in rule and value in rule["enum"]) or ("enum" not in rule and rule["minimum"] <= value <= rule["maximum"]), f"library parameter {name} outside its range")
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
        _require(abs(math.fsum(assumptions["classShares"].values()) - 1.0) <= 1e-9, "class shares must sum to 1")
        # Section 8: each class's expected support n*share is a denominator, and every class needs its recall (#113).
        _require(all(share > 0 for share in assumptions["classShares"].values()), "every class share must be above 0")
        _require(set(assumptions.get("perClassRecall") or {}) == set(assumptions["classShares"]), "perClassRecall must name exactly the classes of classShares")
        return {key: assumptions[key] for key in ("n", "classShares", "perClassRecall")}
    if kind == "regression_performance":
        out = {key: assumptions[key] for key in ("n", "errorSd")}
        if assumptions.get("targetSd") is not None:  # optional: models the mean baseline gate (section 8)
            out["targetSd"] = assumptions["targetSd"]
        return out
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
        _require(set(out["passBlockedBy"]) <= {UNDECIDABLE[kind]} and len(set(out["passBlockedBy"])) == len(out["passBlockedBy"]), "passBlockedBy names this kind's undecidable metric at most once")
    out["libraryEntry"] = normalize_library(c.get("libraryEntry"), out)
    if out["libraryEntry"] is not None and kind in ("group_comparison", "calibration"):
        expected = library_band(out["libraryEntry"]["id"], out["libraryEntry"]["parameters"])
        if out["band"] is None:
            out["band"] = expected
        _require(out["band"] == expected, "the band must equal the one its library entry derives")
    out["powerAssumptions"] = normalize_assumptions(out, c.get("powerAssumptions"))
    return out


def normalize_plan(p):
    minimums = {key: p.get("minimums", {}).get(key, FLOORS[key]) for key in FLOORS}
    _require(all(minimums[key] >= FLOORS[key] for key in FLOORS), "plan minimums below platform floors")
    multiplicity = {"confirmatory": "bonferroni", "exploratory": "benjamini_hochberg"}
    _require(p.get("multiplicity", multiplicity) == multiplicity, "1.0.0 fixes the family adjustments")
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
    _require(plan["statisticsVersion"] == SPEC_VERSION, "statisticsVersion must be 1.0.0")
    _require(plan["confidenceLevel"] in (0.90, 0.95, 0.99), "confidenceLevel must be 0.90, 0.95 or 0.99")
    ids = [c["id"] for c in plan["criteria"]]
    _require(len(set(ids)) == len(ids), "criterion ids must be unique")
    _require(plan["derivedFrom"] is not None or not any(c.get("passBlockedBy") for c in plan["criteria"]), "passBlockedBy occurs only in derived plans")
    return plan


PROPORTION_METRICS = frozenset(BINARY_METRICS + MULTICLASS_METRICS)
ERROR_METRICS = frozenset(("mae", "rmse", "brier_score"))
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _real(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def band_problem(metric, band, mode="all_pairs"):
    """Section 3: why a band is not allowed for this metric, or None. `metric` is a member metric, a group
    criterion metric (selection_rate_difference, selection_rate_ratio, equalized_odds) or calibration_gap."""
    if not isinstance(band, dict) or set(band) - {"lower", "upper"}:
        return "a band is an object with lower and upper"
    lower, upper = band.get("lower"), band.get("upper")
    if lower is None and upper is None:
        return "a band needs at least one bound"
    if any(v is not None and not _real(v) for v in (lower, upper)):
        return "band bounds must be finite numbers"
    if metric in PROPORTION_METRICS:
        if any(v is not None and not 0.0 < v < 1.0 for v in (lower, upper)):
            return "proportion bounds must lie strictly inside (0, 1)"
        if lower is not None and upper is not None and not lower < upper:
            return "the lower bound must be below the upper bound"
        return None
    if metric in ERROR_METRICS:
        return None if lower is None and upper is not None and upper > 0 else "error metrics take an upper bound above 0 only"
    if metric in ("selection_rate_difference", "equalized_odds", "tpr_difference", "fpr_difference", "calibration_gap"):
        if lower is not None and upper is not None:
            return None if lower == -upper and 0.0 < upper < 1.0 else "a difference band is symmetric, {lower: -delta, upper: delta} with 0 < delta < 1"
        if mode != "reference" or metric == "calibration_gap":
            return "a difference band in all_pairs mode is symmetric"
        return None if (lower is not None and -1.0 < lower < 0.0) or (upper is not None and 0.0 < upper < 1.0) else "a one-sided difference band needs 0 < delta < 1"
    if metric == "selection_rate_ratio":
        if lower is None or not 0.0 < lower < 1.0:
            return "a ratio band needs a lower bound tau with 0 < tau < 1"
        if upper is None:
            return None if mode == "reference" else "a ratio band in all_pairs mode is [tau, 1/tau]"
        return None if upper == 1.0 / lower else "a ratio band's upper bound is exactly 1/tau"
    return "unknown metric " + str(metric)


def criterion_band_problem(c):
    """The first section 3 violation among a normalised criterion's bands, or None."""
    for item in c.get("members") or []:
        problem = band_problem(item["metric"], item["band"])
        if problem:
            return f"{item['metric']}: {problem}"
    if c["kind"] == "group_comparison" and c["band"] is not None:
        problem = band_problem(c["metric"], c["band"], c["comparison"]["mode"])
        if problem:
            return f"{c['metric']}: {problem}"
    if c["kind"] == "calibration" and c["band"] is not None:
        problem = band_problem("calibration_gap", c["band"])
        if problem:
            return f"calibration_gap: {problem}"
    return None


def _keys(value, allowed, required, where):
    _require(isinstance(value, dict), where + " must be an object")
    unknown = set(value) - set(allowed)
    _require(not unknown, where + " has unknown fields: " + ", ".join(sorted(unknown)))
    missing = [key for key in required if key not in value]
    _require(not missing, where + " is missing " + ", ".join(missing))


def _integer_in(value, lower, upper):
    return isinstance(value, int) and not isinstance(value, bool) and lower <= value <= upper


CRITERION_FIELDS = {
    "performance": ("members", "powerAssumptions"),
    "multiclass_performance": ("members", "powerAssumptions"),
    "regression_performance": ("members", "passBlockedBy", "powerAssumptions"),
    "group_comparison": ("metric", "band", "comparison", "groupFields", "declaredGroups", "minimumCoverage", "powerAssumptions"),
    "calibration": ("band", "members", "minimumCoverage", "subgroup", "passBlockedBy", "powerAssumptions"),
}
MEMBER_METRICS = {"performance": BINARY_METRICS, "multiclass_performance": MULTICLASS_METRICS, "regression_performance": REGRESSION_METRICS, "calibration": ("brier_score",)}
MEMBER_LIMITS = {"performance": 7, "multiclass_performance": 4, "regression_performance": 2, "calibration": 1}
PLAN_FIELDS = ("statisticsVersion", "confidenceLevel", "minimums", "configuredMinimums", "multiplicity", "clusterField", "bootstrap", "calibrationBins", "power", "derivedFrom", "criteria")


def _validate_group_fields(c, where):
    _require(c["metric"] in ("selection_rate_difference", "selection_rate_ratio", "equalized_odds"), where + ".metric is not a group metric")
    comparison = c.get("comparison", {"mode": "all_pairs"})
    _keys(comparison, ("mode", "referenceGroup"), ("mode",), where + ".comparison")
    _require(comparison["mode"] in MAX_GROUPS, where + ".comparison.mode must be all_pairs or reference")
    reference = comparison.get("referenceGroup")
    _require((comparison["mode"] == "reference") == (reference is not None), where + ".comparison.referenceGroup is required in reference mode, and only there")
    _require(reference is None or isinstance(reference, str) and 1 <= len(reference) <= 5000, where + ".comparison.referenceGroup must be a group label")
    fields = c.get("groupFields")
    _require(fields is None or isinstance(fields, list) and 1 <= len(fields) <= 5 and len(set(fields)) == len(fields) and all(isinstance(f, str) and 1 <= len(f) <= 300 for f in fields), where + ".groupFields must be null or 1 to 5 unique column names")
    declared = c.get("declaredGroups")
    _require(declared is None or isinstance(declared, list) and 1 <= len(declared) <= 1000 and len(set(declared)) == len(declared) and all(isinstance(g, str) and 1 <= len(g) <= 5000 for g in declared), where + ".declaredGroups must be null or unique group labels")
    _require(c.get("band") is not None or c.get("libraryEntry") is not None, where + ".band is required")


def _validate_criterion(c, where):
    _require(isinstance(c, dict) and c.get("kind") in CRITERION_FIELDS, where + ".kind is not a statistics 1.0.0 criterion kind")
    kind = c["kind"]
    required = ("id", "kind") + (("members",) if kind in PERFORMANCE_KINDS else ("metric",) if kind == "group_comparison" else ())
    _keys(c, ("id", "kind", "role", "rationale", "libraryEntry") + CRITERION_FIELDS[kind], required, where)
    _require(isinstance(c["id"], str) and ID_PATTERN.fullmatch(c["id"]) is not None, where + ".id must match the run schema's id pattern")
    _require(c.get("role", "confirmatory") in ("confirmatory", "exploratory"), where + ".role must be confirmatory or exploratory")
    rationale = c.get("rationale")
    _require(rationale is None or isinstance(rationale, str) and 1 <= len(rationale) <= 5000, where + ".rationale must be null or text")
    _require(not c.get("passBlockedBy"), where + ".passBlockedBy occurs only in derived plans")
    if kind in MEMBER_METRICS:
        items = c.get("members", [])
        _require(isinstance(items, list) and len(items) <= MEMBER_LIMITS[kind], f"{where}.members holds at most {MEMBER_LIMITS[kind]} members")
        for item in items:
            _keys(item, ("metric", "band"), ("metric", "band"), where + ".members[]")
            _require(item["metric"] in MEMBER_METRICS[kind], f"{where}: {item['metric']!r} is not a {kind} metric")
        _require(kind == "calibration" or items, where + ".members must name at least one metric")
    if kind == "group_comparison":
        _validate_group_fields(c, where)
    if kind in ("group_comparison", "calibration"):
        coverage = c.get("minimumCoverage", 1.0)
        _require(_real(coverage) and 0.5 <= coverage <= 1.0, where + ".minimumCoverage must lie in [0.5, 1]")
    if kind == "calibration":
        subgroup = c.get("subgroup")
        if subgroup is not None:
            _keys(subgroup, ("field", "value"), ("field", "value"), where + ".subgroup")
            _require(all(isinstance(subgroup[k], str) and subgroup[k] for k in ("field", "value")), where + ".subgroup needs a field and a value")
        _require(c.get("band") is not None or c.get("members") or c.get("libraryEntry") is not None, where + " needs a gap band or a Brier member")
        _require(c.get("powerAssumptions") is None, where + ".powerAssumptions is not defined for calibration")
    if c.get("libraryEntry") is not None:
        entry = c["libraryEntry"]
        _keys(entry, ("id", "version", "parameters", "overriddenParameters"), ("id",), where + ".libraryEntry")
        _require(entry["id"] in LIBRARY, where + ".libraryEntry.id is not a library entry")


def validate_plan(p):
    """Validate a new plan as written (section 9.1, the rules of schemas/statistics-plan.schema.json and the
    section 3 bands) and return it normalised. A new plan with an invalid band, minimums below the floors
    or an unknown field is rejected; derived plans come from derive_engine() and derive_hosted()."""
    _keys(p, PLAN_FIELDS, ("criteria",), "statistics")
    _require(p.get("derivedFrom") is None, "statistics.derivedFrom is set only by legacy derivation")
    _require(p.get("configuredMinimums") is None, "statistics.configuredMinimums is set only by legacy derivation")
    if "minimums" in p:
        _keys(p["minimums"], tuple(FLOORS), (), "statistics.minimums")
        for key, value in p["minimums"].items():
            _require(_integer_in(value, FLOORS[key], 1_000_000), f"statistics.minimums.{key} must be an integer from {FLOORS[key]} (the platform floor) to 1000000")
    if "bootstrap" in p:
        _keys(p["bootstrap"], ("replicates",), (), "statistics.bootstrap")
        _require(_integer_in(p["bootstrap"].get("replicates", 2000), 1000, 10000), "statistics.bootstrap.replicates must be an integer from 1000 to 10000")
    _require(_integer_in(p.get("calibrationBins", 10), 2, 100), "statistics.calibrationBins must be an integer from 2 to 100")
    if "power" in p:
        _keys(p["power"], ("targetPower", "acknowledgement"), (), "statistics.power")
        target = p["power"].get("targetPower", 0.8)
        _require(_real(target) and 0.5 <= target <= 0.99, "statistics.power.targetPower must lie in [0.5, 0.99]")
        note = p["power"].get("acknowledgement")
        _require(note is None or isinstance(note, str) and 1 <= len(note) <= 5000, "statistics.power.acknowledgement must be null or text")
    cluster = p.get("clusterField")
    _require(cluster is None or isinstance(cluster, str) and 1 <= len(cluster) <= 300, "statistics.clusterField must be null or a column name")
    criteria = p["criteria"]
    _require(isinstance(criteria, list) and 1 <= len(criteria) <= 20, "statistics.criteria must hold 1 to 20 criteria")
    for index, c in enumerate(criteria):
        _validate_criterion(c, f"statistics.criteria[{index}]")
    try:
        plan = normalize_plan(p)
    except (KeyError, TypeError) as exc:
        raise StatisticsError("statistics plan is malformed: " + str(exc)) from exc
    for c in plan["criteria"]:
        problem = criterion_band_problem(c)
        _require(problem is None, f"criterion {c['id']}: {problem}")
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


def member(metric, band, estimate, method, ci_at, zstar_closed=None, *, subject=None, comparator=None, counts=None, status="evaluated", reasons=(), small_cell=False, fisher=None, chance=None, level=0.95, descriptive=False, decide=True):
    out = {"memberId": member_id(metric, subject, comparator), "metric": metric, "subject": subject, "comparator": comparator, "counts": counts, "estimate": estimate, "interval": None, "band": None if descriptive else band, "status": status, "direction": "none", "pValue": None if descriptive else 1.0, "smallCell": small_cell, "fisherExactP": fisher, "chanceExactP": None, "reasons": list(reasons)}
    if estimate is None or ci_at is None:
        return out
    if not descriptive and chance_gated(band, chance):
        out["chanceExactP"] = chance_exact_p(chance[1])
    lo, hi = ci_at(zcrit(level))
    out["interval"] = {"lower": lo, "upper": hi, "level": level, "method": method}
    out["_ci_at"] = ci_at
    if descriptive or status != "evaluated" or not decide:  # decide=False: a derived band that section 3 rejects
        return out
    direction = direction_of(estimate, band)
    out["direction"] = direction
    if direction == "none":
        out["reasons"].append("estimate_on_band_boundary")
        return out
    # Score-test inversions use their closed form (section 4.2); composite methods use bisection.
    zs = min(max(zstar_closed(direction), 0.0), Z_MAX) if zstar_closed is not None else invert(ci_at, band, direction)
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


def stat_entry(metric, band, stat, level, descriptive=False, decide=True):
    closed = None if descriptive or not decide or stat.closed is None else stat.closed(band)
    return member(metric, band, stat.estimate, stat.method, stat.ci_at, closed, counts=stat.counts, status=stat.status, reasons=stat.reasons, chance=stat.chance, level=level, descriptive=descriptive, decide=decide)


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
        if k < 2 or min(supports) == 0:
            return Stat(None, "mover_wilson", None, None, counts, "undefined", ["single_class"])
        tables = [(tps[i], supports[i], predicted[i], total) for i in range(k)]
        return Stat(sum(x / n for x, n in parts) / k, "mover_wilson", lambda z: mover_mean(parts, z), None, counts, *support(min(supports), cls), chance=(1.0 / k, tables))
    if metric == "macro_f1":
        classes = [(tps[i], supports[i] + predicted[i] - tps[i]) for i in range(k)]
        counts = {"perClass": [{"label": label, "tp": x, "tpPlusFpPlusFn": m} for label, (x, m) in zip(labels, classes)]}
        if k < 2 or min(supports) == 0:
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
    if n < 2:  # no rows, or one row without a sample standard deviation
        estimate = None if n == 0 or metric == "r2" else abs(errors[0])
        return Stat(estimate, None if metric == "r2" else "normal_approximation", None, None, {"n": n}, "undefined", ["undefined_zero_denominator" if n == 0 or metric == "r2" else "degenerate_interval"])
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


def mean_baseline(data, mins):
    """Section 5.9: the mean-prediction baseline and its gate. Returns (the descriptive `baseline_rmse` Stat, gate p).

    The baseline predicts the mean of the evaluated targets on every row; its RMSE is the targets' population
    standard deviation, and no constant prediction has a lower one. The gate tests that the model's MSE lies below
    the baseline's: d_i = e_i^2 - (mean - y_i)^2, one-sided normal approximation on the decision scale (p <= alpha
    exactly when the upper bound of mean(d)'s interval is below 0). A reduction of at most BASELINE_TOLERANCE of the
    baseline MSE is rounding, not evidence, so the gate does not reject (p = 1)."""
    errors = data["errors"]
    n = len(errors)
    targets = data.get("targets")
    if n < 2 or targets is None:
        return Stat(None, None, None, None, {"n": n}, "undefined", ["undefined_zero_denominator"]), 1.0
    mean_t = math.fsum(targets) / n
    residuals = [mean_t - t for t in targets]
    sst = math.fsum(r * r for r in residuals)
    if sst == 0.0:
        return Stat(None, None, None, None, {"n": n}, "undefined", ["undefined_zero_denominator"]), 1.0
    baseline_mse = sst / n
    mean_d, sd_d = mean_sd([e * e - r * r for e, r in zip(errors, residuals)])
    se = sd_d / math.sqrt(n)
    reduction = 0.0 - mean_d  # never -0.0
    if reduction <= BASELINE_TOLERANCE * baseline_mse:
        p = 1.0
    else:
        p = p_from_z(Z_MAX if se == 0.0 else reduction / se)
    counts = {"n": n, "meanSquaredError": baseline_mse, "meanSquaredErrorReduction": reduction, "sdSquaredErrorDifference": sd_d, "gatePValue": p}
    return Stat(math.sqrt(baseline_mse), None, None, None, counts, *support(n, mins["sampleSize"], "below_minimum_sample_size")), p


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


def pair_member(metric, subject, comparator, s, c, band, mins, level, suppressed=False, decide=True, withheld=False):
    (xs, ns), (xc, nc) = s, c
    counts = {"subject": {"x": xs, "n": ns}, "comparator": {"x": xc, "n": nc}}
    if withheld:
        # A pair with a group withheld in a client-held run (#102): suppressed, with no counts to compare.
        return member(metric, band, None, "newcombe_hybrid_score", None, subject=subject, comparator=comparator, counts=None, status="suppressed", reasons=["group_below_minimum_size"], level=level)
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
            return member(metric, band, estimate, method, lambda z: katz(xs, ns, xc, nc, z), lambda d: log_zstar(estimate, se, band, d), subject=subject, comparator=comparator, counts=counts, status=status, reasons=reasons, small_cell=small, fisher=fisher, level=level, decide=decide)
        return member(metric, band, estimate, method, lambda z: koopman(xs, ns, xc, nc, z), lambda d: koopman_zstar(xs, ns, xc, nc, band, d), subject=subject, comparator=comparator, counts=counts, status=status, reasons=reasons, small_cell=small, fisher=fisher, level=level, decide=decide)
    return member(metric, band, xs / ns - xc / nc, "newcombe_hybrid_score", lambda z: newcombe(xs, ns, xc, nc, z), subject=subject, comparator=comparator, counts=counts, status=status, reasons=reasons, small_cell=small, fisher=fisher, level=level, decide=decide)


def group_rows(g):
    return g["n"] if "n" in g else g["tp"] + g["fp"] + g["fn"] + g["tn"]


def group_members(spec, data, mins, level):
    groups = {g["group"]: g for g in data["groups"]}
    # A client-held run (#102) leaves the rows of groups below the minimum group size out of the data. They
    # still count as present, suppressed groups and towards the coverage population, so no decision changes.
    withheld = data.get("withheldGroups") or {}
    declared = spec["declaredGroups"] or []
    names = sorted(set(groups) | set(declared) | set(withheld), key=code_point_key)
    size = {name: group_rows(groups[name]) if name in groups else withheld.get(name, 0) for name in names}
    present = [name for name in names if size[name] > 0]
    eligible = [name for name in present if size[name] >= mins["groupSize"]]
    suppressed = [{"group": name, "n": size[name]} for name in names if size[name] < mins["groupSize"]]
    unknown = data.get("unknownGroupRows", 0)
    population = sum(size.values()) + unknown + data.get("withheldRows", 0) - sum(withheld.values())
    # A row left out for another column set still belongs to its eligible group here (withheldMembers).
    members_withheld = data.get("withheldMembers") or {}
    eligible_rows = sum(size[name] + members_withheld.get(name, 0) for name in eligible)
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
                        (xa, na), (xb, nb) = rate_counts(key, groups.get(a)), rate_counts(key, groups.get(b))
                        rate_a = xa / na if na else math.inf  # an undefined rate sorts as +infinity
                        rate_b = xb / nb if nb else math.inf
                        pairs.append((b, a) if rate_b < rate_a else (a, b))
            for s, c in pairs:
                members.append(pair_member(metric, s, c, rate_counts(key, groups.get(s)), rate_counts(key, groups.get(c)), band, mins, level, suppressed=s not in eligible or c not in eligible, decide=spec.get("_decide", True), withheld=s in withheld or c in withheld))
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
    context = {"sampleSize": sum(size[name] for name in names if name not in withheld), "suppressedGroups": suppressed, "coverage": coverage, "passBlocked": blocked, "reasons": reasons, "scale": "log" if spec["metric"] == "selection_rate_ratio" else "linear", "headlineMetric": spec["metric"], "groups": per_group, "descriptive": []}
    return members, context


def brier_stat(data, mins):
    """Brier score: mean (s - y)^2 with the normal approximation of section 5.9 (closed-form z*)."""
    values = data["brierErrors"]
    n = len(values)
    if n < 2:
        return Stat(math.fsum(values) / n if n else None, "normal_approximation", None, None, {"n": n}, "undefined", ["degenerate_interval"])
    mean, sd = mean_sd(values)
    se = sd / math.sqrt(n)
    counts = {"n": n, "meanSquaredError": mean, "sdSquaredError": sd}
    if se == 0.0:
        return Stat(mean, "normal_approximation", None, None, counts, "undefined", ["degenerate_interval"])
    return Stat(mean, "normal_approximation", lambda z: (max(0.0, mean - z * se), mean + z * se), lambda band: (lambda d: normal_zstar(mean, se, band, d)), counts, *support(n, mins["sampleSize"], "below_minimum_sample_size"))


def calibration_members(spec, data, mins, level):
    """Calibration gaps per eligible bin; a Brier member and the descriptive Brier score need row-level
    squared errors (data["brierErrors"]), which only the engine supplies end to end."""
    if spec["members"] and "brierErrors" not in data:
        raise StatisticsError("a Brier member needs row-level scores")
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
        m = member("calibration_gap", band, x / n - s, "wilson", lambda z, x=x, n=n, s=s: tuple(v - s for v in wilson(x, n, z)), lambda d, x=x, n=n, pb=pband: wilson_zstar(x, n, pb, d), counts={"x": x, "n": n, "meanScore": s}, level=level, decide=spec.get("_decide", True))
        m["memberId"] = f"calibration_gap:bin{b['bin']}"
        m["subject"] = f"bin{b['bin']}"
        members.append(m)
    gaps = list(members)
    planned = [item["metric"] for item in spec["members"]]
    members += [stat_entry(item["metric"], item["band"], brier_stat(data, mins), level, decide=spec.get("_decide", True)) for item in spec["members"]]
    ece = sum(b["n"] / total * abs(b["positives"] / b["n"] - b["meanScore"]) for b in data["bins"] if b["n"]) if total else None
    descriptive = [stat_entry("brier_score", None, brier_stat(data, mins), level, descriptive=True)] if "brierErrors" in data and "brier_score" not in planned else []
    descriptive.append(member("expected_calibration_error", None, ece, "percentile_bootstrap", None, counts={"n": total, "bins": len(data["bins"])}, level=level, descriptive=True))
    coverage = {"eligibleRows": eligible_rows, "populationRows": total, "unknownGroupRows": 0, "value": eligible_rows / total if total else 0.0, "minimum": spec["minimumCoverage"]}
    blocked = coverage["value"] < coverage["minimum"] - EPS
    suppressed = [{"group": f"bin{b['bin']}", "n": b["n"]} for b in data["bins"] if b["n"] < mins["groupSize"]]
    reasons = (["group_suppressed_below_minimum"] if suppressed else []) + (["insufficient_coverage"] if blocked else [])
    return members, {"sampleSize": total, "suppressedGroups": suppressed, "coverage": coverage, "passBlocked": blocked, "reasons": reasons, "scale": "linear", "headlineMetric": "calibration", "headlineMembers": gaps, "groups": per_bin, "descriptive": descriptive}


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


def evaluate_criterion(spec, data, level, mins, derived=False):
    return decide_criterion(build_criterion(spec, data, level, mins, derived), level, mins)


def build_criterion(spec, data, level, mins, derived=False):
    """Members, descriptive entries and gates of one criterion before its decision (section 4.3). The cluster
    bootstrap (section 5.11) replaces the members' intervals and p-values between this step and the decision."""
    kind = spec["kind"]
    # Section 3: a derived legacy plan keeps a band the table rejects; that criterion is inconclusive (invalid_band).
    invalid_band = derived and criterion_band_problem(spec) is not None
    if invalid_band:
        spec = {**spec, "_decide": False}
    decide = not invalid_band
    descriptive, groups = [], None
    if kind == "performance":
        cm = {k: sum(g[k] for g in data["groups"]) + data.get("unknownGroup", {}).get(k, 0) for k in ("tp", "fp", "fn", "tn")}
        planned = [item["metric"] for item in spec["members"]]
        members = [stat_entry(item["metric"], item["band"], binary_stat(item["metric"], cm, mins), level, decide=decide) for item in spec["members"]]
        descriptive = [stat_entry(metric, None, binary_stat(metric, cm, mins), level, descriptive=True) for metric in BINARY_DESCRIPTIVE if metric not in planned]
        context = {"sampleSize": sum(cm.values()), "passBlocked": False, "reasons": []}
    elif kind == "multiclass_performance":
        planned = [item["metric"] for item in spec["members"]]
        members = [stat_entry(item["metric"], item["band"], multiclass_stat(item["metric"], data, mins), level, decide=decide) for item in spec["members"]]
        descriptive = [stat_entry(metric, None, multiclass_stat(metric, data, mins), level, descriptive=True) for metric in MULTICLASS_METRICS if metric not in planned]
        context = {"sampleSize": sum(map(sum, data["matrix"])), "passBlocked": False, "reasons": []}
    elif kind == "regression_performance":
        planned = [item["metric"] for item in spec["members"]]
        members = [stat_entry(item["metric"], item["band"], regression_stat(item["metric"], data, mins), level, decide=decide) for item in spec["members"]]
        descriptive = [stat_entry(metric, None, regression_stat(metric, data, mins), level, descriptive=True) for metric in REGRESSION_DESCRIPTIVE if metric not in planned]
        baseline, baseline_p = mean_baseline(data, mins)
        descriptive.append(stat_entry("baseline_rmse", None, baseline, level, descriptive=True))
        context = {"sampleSize": len(data["errors"]), "passBlocked": False, "reasons": [], "baselineP": baseline_p}
    elif kind == "group_comparison":
        members, context = group_members(spec, data, mins, level)
        groups = context["groups"]
    elif kind == "calibration":
        members, context = calibration_members(spec, data, mins, level)
        groups, descriptive = context["groups"], context["descriptive"]
    else:
        raise ValueError(kind)
    return {"spec": spec, "kind": kind, "members": members, "descriptive": descriptive, "groups": groups, "context": context, "invalidBand": invalid_band}


def decide_criterion(state, level, mins):
    alpha = 1.0 - level
    spec, kind, members, descriptive, groups, context = state["spec"], state["kind"], state["members"], state["descriptive"], state["groups"], state["context"]
    invalid_band = state["invalidBand"]
    # Section 5.11: a clustered member with a small 2x2 cell makes no claim; its own code explains the outcome.
    small_clustered = any("small_cell_clustered" in m["reasons"] for m in members if m["status"] != "suppressed")
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
    if invalid_band:
        reasons.append("invalid_band")
        gated = True
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
        elif p > alpha + EPS and not small_clustered:
            reasons.append("interval_straddles_band")
    else:
        complete = bool(pool) and all(m["status"] == "evaluated" and m["direction"] == "pass" for m in pool)
        direction = "pass" if any(m["direction"] == "pass" for m in evaluable) else "none"
        if complete and not context["passBlocked"]:
            deciding = min(pool, key=lambda m: (-m["pValue"], code_point_key(m["memberId"])))
            p = deciding["pValue"]
            if p > alpha + EPS and not small_clustered:
                ungated = max(m["_pInterval"] for m in pool)  # without the chance gate of section 5.2
                reasons.append("chance_exact_test_not_significant" if ungated <= alpha + EPS else "interval_straddles_band")
            p = max(p, context.get("baselineP", 0.0))  # the mean baseline gate (section 5.9) gates passes only
        else:
            p = 1.0
        if context.get("baselineP", 0.0) > alpha + EPS:
            reasons.append("mean_baseline_not_beaten")
    for m in pool:
        for r in m["reasons"]:
            if r not in reasons:
                reasons.append(r)
    decision = {"statisticsVersion": SPEC_VERSION, "confidenceLevel": level, "role": spec["role"], "kind": kind, "direction": direction, "pValue": p, "adjustedPValue": None, "adjustment": None, "familySize": None, "unadjustedOutcome": direction if direction in ("pass", "fail") and p <= alpha + EPS else "inconclusive", "decidingMemberId": deciding["memberId"] if deciding else None, "sampleSize": context["sampleSize"], "coverage": context.get("coverage"), "suppressedGroups": context.get("suppressedGroups"), "libraryEntry": library_view(spec["libraryEntry"]), "reasons": reasons}
    return {"id": spec["id"], "outcome": None, "headline": headline(context.get("headlineMembers", members), context, level) if kind in ("group_comparison", "calibration") else None, "members": members, "descriptive": descriptive, "groups": groups, "decision": decision}


def aggregate(outcomes):
    for state in ("fail", "inconclusive", "pass"):
        if state in outcomes:
            return state
    return "not_applicable"


def evaluate_plan(plan, data):
    """Evaluate a normalised plan on one data object (the golden cases' shape). A plan with a clusterField takes
    the clustered shape {"seed", "clusters": [{"cluster", ...one cluster's data}]} (section 5.11)."""
    if plan["clusterField"] is not None:
        _require(isinstance(data.get("clusters"), list) and data["clusters"] and isinstance(data.get("seed"), int), "a clustered plan needs data.clusters and data.seed")
        ordered = sorted(data["clusters"], key=lambda part: cluster_key(part["cluster"]))
        parts = [{key: value for key, value in part.items() if key != "cluster"} for part in ordered]
        return evaluate_criteria(plan, None, clustered=([part["cluster"] for part in ordered], lambda criterion: parts, data["seed"]))
    return evaluate_criteria(plan, lambda criterion: data)


def evaluate_criteria(plan, data_for, clustered=None):
    """Evaluate every criterion of a normalised plan on the data `data_for(criterion)` returns, then apply
    the family adjustments (section 4.5) and the run aggregation over confirmatory criteria (section 4.6).
    With `clustered` = (cluster ids, parts_for, seed), parts_for(criterion) gives one data object per cluster,
    in the order of the ids, and every member is decided by the cluster bootstrap (section 5.11)."""
    level = plan["confidenceLevel"]
    alpha = 1.0 - level
    derived = plan["derivedFrom"] is not None
    if clustered is None:
        results = [evaluate_criterion(c, data_for(c), level, plan["minimums"], derived) for c in plan["criteria"]]
    else:
        results = cluster_bootstrap_criteria(plan, *clustered)
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


# ---------------------------------------------------------------- cluster bootstrap (section 5.11, engine-only)
MAX_DECISION_DRAWS = 50_000_000  # B x C cluster draws per run
MIN_CLUSTERS = 10
VALID_REPLICATE_SHARE = 0.9
U_TOLERANCE = 1e-9
UNBOOTSTRAPPED = frozenset(("r2", "expected_calibration_error", "baseline_rmse"))


def cluster_key(cluster):
    """Clusters are ordered by the UTF-8 bytes of their canonical JSON, as canonical_bytes writes it."""
    return json.dumps(cluster, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def quantile(ordered, probability):
    """Type-7 (linear interpolation) quantile of an ascending list."""
    position = (len(ordered) - 1) * probability
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def merge_parts(parts):
    """One criterion's data over all clusters: counts summed by group, class label or bin; regression rows and
    Brier errors concatenated in cluster order."""
    first = parts[0]
    if "groups" in first:
        cells = {}
        for part in parts:
            for g in part["groups"]:
                keys = tuple(key for key in g if key != "group")
                acc = cells.setdefault(g["group"], dict.fromkeys(keys, 0))
                _require(set(acc) == set(keys), "a group mixes selection-only and confusion-matrix counts")
                for key in keys:
                    acc[key] += g[key]
        out = {"groups": [{"group": name, **cells[name]} for name in sorted(cells, key=code_point_key)]}
        if any("unknownGroupRows" in part for part in parts):
            out["unknownGroupRows"] = sum(part.get("unknownGroupRows", 0) for part in parts)
        # A client-held run's withheld rows (#102) come with one part only and count towards coverage alone.
        for key in ("withheldGroups", "withheldMembers"):
            if any(part.get(key) for part in parts):
                merged = {}
                for part in parts:
                    for name, n in (part.get(key) or {}).items():
                        merged[name] = merged.get(name, 0) + n
                out[key] = merged
        if any("withheldRows" in part for part in parts):
            out["withheldRows"] = sum(part.get("withheldRows", 0) for part in parts)
        return out
    if "matrix" in first:
        labels = sorted({label for part in parts for label in part["labels"]}, key=code_point_key)
        position = {label: i for i, label in enumerate(labels)}
        matrix = [[0] * len(labels) for _ in labels]
        for part in parts:
            for i, row in enumerate(part["matrix"]):
                for j, count in enumerate(row):
                    matrix[position[part["labels"][i]]][position[part["labels"][j]]] += count
        return {"kind": "multiclass", "labels": labels, "matrix": matrix}
    if "bins" in first:
        totals = {}
        for part in parts:
            for b in part["bins"]:
                cell = totals.setdefault(b["bin"], [0, 0, 0.0])
                cell[0] += b["n"]
                cell[1] += b["positives"]
                cell[2] += b["n"] * b["meanScore"]
        out = {"bins": [{"bin": index, "n": n, "positives": x, "meanScore": s / n} for index, (n, x, s) in sorted(totals.items()) if n]}
        if any("brierErrors" in part for part in parts):
            out["brierErrors"] = [e for part in parts for e in part.get("brierErrors", [])]
        return out
    out = {"kind": "regression", "errors": [e for part in parts for e in part["errors"]]}
    if all("targets" in part for part in parts):
        out["targets"] = [t for part in parts for t in part["targets"]]
    return out


class ClusterLayout:
    """The cells of one criterion that every replicate sums: one count vector per cluster (section 5.11).
    Performance: TP, FP, FN, TN. Multiclass: the k x k matrix. Regression: n and the sums of |e|, e^2, t - c
    and (t - c)^2, with c the mean of all targets. Groups: each group's cells. Calibration: each bin's n,
    positives and score sum, then the scored rows and the sum of squared score errors."""

    def __init__(self, kind, merged):
        self.kind = kind
        if kind == "performance":
            self.size = 4
        elif kind == "multiclass_performance":
            self.labels = merged["labels"]
            self.position = {label: i for i, label in enumerate(self.labels)}
            self.size = len(self.labels) ** 2
        elif kind == "regression_performance":
            targets = merged.get("targets") or [0.0] * len(merged["errors"])
            self.centre = math.fsum(targets) / len(targets) if targets else 0.0
            self.size = 5
        elif kind == "group_comparison":
            self.groups = [g["group"] for g in merged["groups"]]
            self.cells = ("selected", "n") if any("selected" in g for g in merged["groups"]) else ("tp", "fp", "fn", "tn")
            self.offset = {name: i * len(self.cells) for i, name in enumerate(self.groups)}
            self.size = len(self.groups) * len(self.cells)
        else:
            self.bins = [b["bin"] for b in merged["bins"]]
            self.offset = {b: 3 * i for i, b in enumerate(self.bins)}
            self.size = 3 * len(self.bins) + 2

    def vector(self, part):
        """(this cluster's cells, its rows per unit), where a unit is the whole criterion (None), a group, a bin
        or the scored rows ("brier"): the units whose clusters the minimum-cluster rule counts."""
        cells = [0] * self.size
        units = {}
        if self.kind == "performance":
            for g in part["groups"]:
                for i, key in enumerate(("tp", "fp", "fn", "tn")):
                    cells[i] += g[key]
            units[None] = sum(cells)
        elif self.kind == "multiclass_performance":
            k = len(self.labels)
            for i, row in enumerate(part["matrix"]):
                for j, count in enumerate(row):
                    cells[self.position[part["labels"][i]] * k + self.position[part["labels"][j]]] += count
            units[None] = sum(cells)
        elif self.kind == "regression_performance":
            errors = part["errors"]
            targets = part.get("targets") or [0.0] * len(errors)
            shifted = [t - self.centre for t in targets]
            cells = [len(errors), math.fsum(abs(e) for e in errors), math.fsum(e * e for e in errors), math.fsum(shifted), math.fsum(t * t for t in shifted)]
            units[None] = len(errors)
        elif self.kind == "group_comparison":
            for g in part["groups"]:
                base = self.offset[g["group"]]
                for i, key in enumerate(self.cells):
                    cells[base + i] += g[key]
                units[g["group"]] = units.get(g["group"], 0) + group_rows(g)
        else:
            for b in part["bins"]:
                base = self.offset[b["bin"]]
                cells[base] += b["n"]
                cells[base + 1] += b["positives"]
                cells[base + 2] += b["n"] * b["meanScore"]
                units[("bin", b["bin"])] = b["n"]
            errors = part.get("brierErrors", [])
            cells[-2], cells[-1] = len(errors), math.fsum(errors)
            units["brier"] = len(errors)
        return cells, units

    def replicate(self, cells):
        """A replicate's data in the shape the estimators read."""
        if self.kind == "performance":
            return dict(zip(("tp", "fp", "fn", "tn"), cells))
        if self.kind == "multiclass_performance":
            k = len(self.labels)
            return {"labels": self.labels, "matrix": [cells[i * k:(i + 1) * k] for i in range(k)]}
        if self.kind == "regression_performance":
            return cells
        if self.kind == "group_comparison":
            width = len(self.cells)
            return {name: dict(zip(self.cells, cells[self.offset[name]:self.offset[name] + width])) for name in self.groups}
        return {"bins": {b: cells[self.offset[b]:self.offset[b] + 3] for b in self.bins}, "brier": cells[-2:]}

    def units_of(self, entry):
        if self.kind == "group_comparison":
            return (entry["subject"], entry["comparator"])
        if self.kind == "calibration":
            return (("bin", int(entry["subject"][3:])),) if entry["metric"] == "calibration_gap" else ("brier",)
        return (None,)


def cluster_estimator(layout, entry, mins):
    """The estimate of one member or descriptive entry on a replicate's data (None where undefined), or None
    for the entries that keep their own interval (R2, ECE, the baseline RMSE)."""
    metric = entry["metric"]
    if metric in UNBOOTSTRAPPED:
        return None
    if layout.kind == "performance":
        return lambda rep: binary_stat(metric, rep, mins).estimate
    if layout.kind == "multiclass_performance":
        return lambda rep: multiclass_stat(metric, rep, mins).estimate
    if layout.kind == "regression_performance":
        if metric == "mae":
            return lambda rep: rep[1] / rep[0] if rep[0] else None
        return lambda rep: math.sqrt(rep[2] / rep[0]) if rep[0] else None
    if layout.kind == "group_comparison":
        key, subject, comparator = RATE_KEYS[metric], entry["subject"], entry["comparator"]

        def pair(rep):
            (xs, ns), (xc, nc) = rate_counts(key, rep.get(subject)), rate_counts(key, rep.get(comparator))
            if ns == 0 or nc == 0:
                return None
            if metric == "selection_rate_ratio":
                return None if xc == 0 else (xs / ns) / (xc / nc)
            return xs / ns - xc / nc
        return pair
    if metric == "calibration_gap":
        index = int(entry["subject"][3:])
        return lambda rep: (rep["bins"][index][1] - rep["bins"][index][2]) / rep["bins"][index][0] if rep["bins"][index][0] else None
    return lambda rep: rep["brier"][1] / rep["brier"][0] if rep["brier"][0] else None


def mean_difference(rep):
    """mean d = MSE - SST/n on a regression replicate: the statistic of the mean baseline gate (section 5.9)."""
    n = rep[0]
    if n == 0:
        return None
    centred = rep[3] / n
    return rep[2] / n - (rep[4] / n - centred * centred)


def band_holds(band, direction):
    """Whether an interval (lo, hi) lies inside the band (pass, inclusive bounds) or outside it (fail, strict)."""
    lower, upper = band.get("lower"), band.get("upper")
    if direction == "pass":
        return lambda lo, hi: (lower is None or lo >= lower) and (upper is None or hi <= upper)
    return lambda lo, hi: (lower is not None and hi < lower) or (upper is not None and lo > upper)


def bootstrap_u_star(ordered, holds):
    """u* = inf{u in (0, 0.5] : [q(u), q(1 - u)] decides}, by bisection to 1e-9 (section 5.11); None when even
    the median does not decide."""
    middle = quantile(ordered, 0.5)
    if not holds(middle, middle):
        return None
    if holds(ordered[0], ordered[-1]):
        return 0.0
    lo, hi = 0.0, 0.5
    while hi - lo > U_TOLERANCE:
        mid = (lo + hi) / 2.0
        if holds(quantile(ordered, mid), quantile(ordered, 1.0 - mid)):
            hi = mid
        else:
            lo = mid
    return hi


def bootstrap_p(ordered, holds):
    """p = max(2u*, 2/(B_valid + 1)), and 1 when no u decides."""
    u = bootstrap_u_star(ordered, holds)
    return 1.0 if u is None else max(2.0 * u, 2.0 / (len(ordered) + 1))


def apply_cluster_bootstrap(entry, values, clusters, replicates, level, descriptive, within):
    """Replace an entry's analytic interval, direction and p-value by the cluster percentile bootstrap."""
    entry.pop("_ci_at", None)
    entry.pop("_pInterval", None)
    entry["interval"] = None
    entry["reasons"] = [r for r in entry["reasons"] if r != "estimate_on_band_boundary"]
    if not descriptive:
        entry["direction"], entry["pValue"] = "none", 1.0
    entry["bootstrap"] = {"replicates": replicates, "validReplicates": len(values) if within else 0, "clusters": clusters}
    if not within:
        entry["reasons"].append("bootstrap_budget_exceeded")
        if entry["status"] != "suppressed":
            entry["status"] = "undefined"
        return
    if entry["estimate"] is None:
        return  # undefined on the whole sample: its own status and reason stand
    if clusters < MIN_CLUSTERS and entry["status"] == "evaluated":
        entry["status"] = "insufficient_support"
        entry["reasons"].append("below_minimum_cluster_count")
    if len(values) < VALID_REPLICATE_SHARE * replicates:
        if entry["status"] != "suppressed":
            entry["status"] = "undefined"
        entry["reasons"].append("bootstrap_insufficient_valid_replicates")
        return
    ordered = sorted(values)
    tail = (1.0 - level) / 2.0
    entry["interval"] = {"lower": quantile(ordered, tail), "upper": quantile(ordered, 1.0 - tail), "level": level, "method": "cluster_percentile_bootstrap"}

    def ci_at(z):  # the percentile interval at the two-sided level of critical value z, for the headline
        u = 0.5 * math.erfc(z / math.sqrt(2.0))
        return quantile(ordered, u), quantile(ordered, 1.0 - u)
    entry["_ci_at"] = ci_at
    if descriptive or entry["status"] != "evaluated" or not entry["_decide"]:
        return
    direction = direction_of(quantile(ordered, 0.5), entry["band"])  # taken from the median replicate
    entry["direction"] = direction
    if direction == "none":
        entry["reasons"].append("estimate_on_band_boundary")
        return
    p = bootstrap_p(ordered, band_holds(entry["band"], direction))
    entry["pValue"] = entry["_pInterval"] = p
    if entry["smallCell"]:  # Fisher assumes independent rows, so a small cell supports no claim either way
        entry["pValue"] = entry["_pInterval"] = 1.0
        entry["reasons"].append("small_cell_clustered")
    elif direction == "pass" and entry["chanceExactP"] is not None:
        entry["pValue"] = max(p, entry["chanceExactP"])  # the chance gate (section 5.2) stays a pass condition


def cluster_gate(state, values, clusters, replicates, within):
    """The mean baseline gate on the shared replicates (sections 5.9 and 5.11): p = max(2u*, 2/(B_valid + 1))
    with u* = inf{u : q(1 - u) of mean d < 0}. The rounding rule, fewer than 10 clusters or 0.9 B valid
    replicates, or a run beyond the budget give p = 1."""
    entry = next(e for e in state["descriptive"] if e["metric"] == "baseline_rmse")
    counts = entry["counts"]
    p = 1.0
    beaten = "meanSquaredErrorReduction" in counts and counts["meanSquaredErrorReduction"] > BASELINE_TOLERANCE * counts["meanSquaredError"]
    if beaten and within and clusters >= MIN_CLUSTERS and len(values) >= VALID_REPLICATE_SHARE * replicates:
        p = bootstrap_p(sorted(values), lambda lo, hi: hi < 0.0)
    if "gatePValue" in counts:
        counts["gatePValue"] = p
        counts["gateMethod"] = "cluster_percentile_bootstrap"
    state["context"]["baselineP"] = p


def cluster_bootstrap_criteria(plan, cluster_ids, parts_for, seed):
    """Section 5.11: every member of a clustered plan is decided by one shared set of B cluster-bootstrap
    replicates. Clusters come in cluster_key order; a replicate draws C indices with rng.randrange(C) from one
    random.Random(seed) stream and sums the drawn clusters' count vectors."""
    level, mins, derived = plan["confidenceLevel"], plan["minimums"], plan["derivedFrom"] is not None
    replicates, count = plan["bootstrap"]["replicates"], len(cluster_ids)
    within = replicates * count <= MAX_DECISION_DRAWS
    states, width = [], 0
    for spec in plan["criteria"]:
        parts = parts_for(spec)
        _require(len(parts) == count, "every criterion needs one data object per cluster")
        merged = merge_parts(parts)
        state = build_criterion(spec, merged, level, mins, derived)
        layout = ClusterLayout(spec["kind"], merged)
        vectors = [layout.vector(part) for part in parts]
        clusters_in = {}
        for _, units in vectors:
            for unit, rows in units.items():
                if rows:
                    clusters_in[unit] = clusters_in.get(unit, 0) + 1
        entries = []
        for descriptive, items in ((False, state["members"]), (True, state["descriptive"])):
            for entry in items:
                estimator = cluster_estimator(layout, entry, mins)
                if estimator is not None:
                    entry["_decide"] = not state["invalidBand"]
                    entries.append((entry, estimator, min(clusters_in.get(unit, 0) for unit in layout.units_of(entry)), descriptive, []))
        gate = [] if spec["kind"] == "regression_performance" else None
        states.append({"state": state, "layout": layout, "cells": [cells for cells, _ in vectors], "offset": width, "entries": entries, "gate": gate, "clusters": clusters_in.get(None, 0)})
        width += layout.size
    if within:
        # Each cell's nonzero clusters and values: a replicate's cell is sum(multiplicity x value) over them,
        # which equals the sum of the drawn clusters' vectors.
        columns = [([], []) for _ in range(width)]
        for s in states:
            for c, cells in enumerate(s["cells"]):
                for i, value in enumerate(cells):
                    if value:
                        columns[s["offset"] + i][0].append(c)
                        columns[s["offset"] + i][1].append(value)
        rng = random.Random(seed)
        draw = rng.randrange
        for _ in range(replicates):
            multiplicity = [0] * count
            for _ in range(count):
                multiplicity[draw(count)] += 1
            weight = multiplicity.__getitem__
            dense = [sum(map(operator.mul, map(weight, clusters), values)) for clusters, values in columns]
            for s in states:
                rep = s["layout"].replicate(dense[s["offset"]:s["offset"] + s["layout"].size])
                for _, estimator, _, _, values in s["entries"]:
                    value = estimator(rep)
                    if value is not None:
                        values.append(value)
                if s["gate"] is not None:
                    value = mean_difference(rep)
                    if value is not None:
                        s["gate"].append(value)
    results = []
    for s in states:
        for entry, _, clusters, descriptive, values in s["entries"]:
            apply_cluster_bootstrap(entry, values, clusters, replicates, level, descriptive, within)
            del entry["_decide"]
        if s["gate"] is not None:
            cluster_gate(s["state"], s["gate"], s["clusters"], replicates, within)
        results.append(decide_criterion(s["state"], level, mins))
    return results


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


def even_spread_cells(shares, recalls):
    """Section 8 (#152): the expected confusion matrix, as shares of n, when class c is recognised with its assumed
    recall and its errors are spread evenly over the other k - 1 classes (row c is the truth, column j the prediction)."""
    k = len(shares)
    return [[s * (r if j == c else (1.0 - r) / (k - 1)) for j in range(k)] for c, (s, r) in enumerate(zip(shares, recalls))]


def macro_parts(metric, cells):
    """Per class: (TP share, denominator share). Macro precision: TP of the predicted count; macro F1: the Jaccard
    index TP of TP + FP + FN (section 5.4)."""
    k = len(cells)
    rows = [math.fsum(cells[c]) for c in range(k)]
    cols = [math.fsum(cells[i][c] for i in range(k)) for c in range(k)]
    return [(cells[c][c], cols[c] if metric == "macro_precision" else rows[c] + cols[c] - cells[c][c]) for c in range(k)]


def wilson_slope(x, n, z, side):
    """d(Wilson bound)/d(x-hat) at the proportion x with denominator n; side -1 is the lower bound, +1 the upper."""
    root = math.sqrt(x * (1.0 - x) / n + z * z / (4.0 * n * n))
    return (1.0 + side * z * (1.0 - 2.0 * x) / (2.0 * n * root)) / (1.0 + z * z / n)


def macro_bound(metric, n, cells, z, side):
    """Section 8 (#152): a macro bound (side -1 lower, +1 upper) of section 5.4 at critical value z, as it would be
    computed at the expected counts, and its standard deviation by the delta method over the multinomial confusion
    matrix: the gradient of the mean of the per-class bounds in the cell shares, through each class's Wilson slope."""
    k = len(cells)
    zk = per_class_z(z, k)
    values, gradient = [], [[0.0] * k for _ in range(k)]
    for c, (tp, share) in enumerate(macro_parts(metric, cells)):
        x = tp / share
        lo, hi = wilson(n * tp, n * share, zk)
        b = lo if side < 0 else hi
        slope = wilson_slope(x, n * share, zk, side)
        if metric == "macro_f1":  # the Jaccard bound maps to F1 through 2J/(1 + J)
            values.append(f1_from_j(b))
            slope *= 2.0 / (1.0 + b) ** 2
        else:
            values.append(b)
        for i in range(k):
            for j in range(k):
                counted = j == c if metric == "macro_precision" else (i == c or j == c)
                gradient[i][j] += slope * ((1.0 if i == j == c else 0.0) - (x if counted else 0.0)) / share / k
    first = math.fsum(gradient[i][j] * cells[i][j] for i in range(k) for j in range(k))
    second = math.fsum(gradient[i][j] ** 2 * cells[i][j] for i in range(k) for j in range(k))
    return math.fsum(values) / k, math.sqrt(max(0.0, second - first * first) / n)


def normal_tail(distance, sd):
    """Phi(distance / sd); a bound without variance decides by its sign."""
    if sd > 0.0:
        return phi(distance / sd)
    return 1.0 if distance > 0.0 else 0.0 if distance < 0.0 else 0.5


def macro_probs(metric, n, cells, band, z):
    """Pass and fail probability of a macro F1 or macro precision member: the macro bounds at z are taken as normal
    around their values at the expected counts (section 8)."""
    lower, upper = band.get("lower"), band.get("upper")
    (lo, sd_lo), (hi, sd_hi) = macro_bound(metric, n, cells, z, -1), macro_bound(metric, n, cells, z, 1)
    passing, failing = [], 0.0
    if lower is not None:
        passing.append(normal_tail(lo - lower, sd_lo))
        failing += normal_tail(lower - hi, sd_hi)
    if upper is not None:
        passing.append(normal_tail(upper - hi, sd_hi))
        failing += normal_tail(lo - upper, sd_lo)
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
            elif metric in ("macro_f1", "macro_precision"):
                # Section 8 (#152): the errors of each class spread evenly over the other classes.
                cells = even_spread_cells(shares, recalls)
                parts = macro_parts(metric, cells)
                if metric == "macro_f1":
                    theta = math.fsum(2.0 * tp / (tp + share) for tp, share in parts) / k  # 2J/(1 + J) = 2TP/(TP + union)
                    supported = min(n * s for s in shares) >= cls
                else:
                    # Recalls lie strictly inside (0, 1), so each predicted column holds at least s_c * r_c > 0;
                    # the share guard is defensive only. Support counts the predicted column of each class.
                    theta = math.fsum(tp / share if share > 0.0 else 0.0 for tp, share in parts) / k
                    supported = min(n * share for _, share in parts) >= cls
                models.append(power_model(metric, metric, theta, {"perClass": {label: n * share for label, (_, share) in zip(labels, parts)}}, lambda z, c=cells, m=metric, b=band: macro_probs(m, n, c, b, z), supported))
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
        if a.get("targetSd") is not None:
            models.append(baseline_gate_model(sigma, a["targetSd"], n, mins))
    return models


def baseline_gate_model(sigma, target_sd, n, mins):
    """Section 8: the mean baseline gate (section 5.9) as a pass-only condition at the planned size. The model
    is assumed to predict the conditional mean, so e and the deviation from the mean r are jointly normal with
    Var e = sigma^2, Var r = targetSd^2 and Cov(e, r) = sigma^2: the MSE reduction is targetSd^2 - sigma^2 and
    SD(e^2 - r^2) = sqrt(2 (targetSd^4 - sigma^4)). The gate never fails a criterion; with sigma >= targetSd it
    never passes either."""
    reduction = target_sd * target_sd - sigma * sigma
    if reduction <= 0.0:
        probs = lambda z: (0.0, 0.0)
    else:
        se = math.sqrt(2.0 * (target_sd ** 4 - sigma ** 4)) / math.sqrt(n)
        probs = lambda z: (phi(reduction / se - z), 0.0)
    return power_model("mean_baseline_gate", "baseline_rmse", target_sd, n, probs, n >= mins["sampleSize"])


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


# ---------------------------------------------------------------- NYC LL144 reporting (section 10.2)
LL144_RATE_KEYS = {"selection": ("selected", "selectionRate", "selectionRateInterval"), "scoring": ("scoredAboveMedian", "scoringRate", "scoringRateInterval")}


def evaluate_ll144(inp, level=0.95):
    """One LL144 table (sex, race/ethnicity or intersectional categories) from per-category counts.

    Each category gives n and `selected`, the individuals selected (selection rates) or scoring above the
    full-sample median (scoring rates, inp["rate"] == "scoring"). A category with no individuals has no rate.
    The reference category is the first maximum in input order among the categories that are not excluded;
    when its rate is zero every impact ratio is undefined (None)."""
    count_key, rate_key, interval_key = LL144_RATE_KEYS[inp.get("rate", "selection")]
    z = zcrit(level)
    cats = inp["categories"]
    known = sum(c["n"] for c in cats)
    unknown = inp.get("unknownCount", 0)
    total = known + unknown  # "the data being used for the bias audit" includes the unknown category (section 10.2)
    _require(total > 0, "an LL144 table needs at least one individual")
    excluded = set(inp.get("excluded", []))
    rows = []
    for c in cats:
        share = c["n"] / total
        _require(c["name"] not in excluded or share < 0.02, "2% exclusion only allowed below 2% of the data")
        rate, interval = None, None
        if c["n"] > 0:
            lo, hi = wilson(c["selected"], c["n"], z)
            rate, interval = c["selected"] / c["n"], {"lower": lo, "upper": hi, "level": level, "method": "wilson"}
        rows.append({"category": c["name"], "n": c["n"], count_key: c["selected"], rate_key: rate, interval_key: interval, "shareOfData": share, "shareOfKnown": c["n"] / known if known else 0.0, "eligibleForTwoPercentExclusion": share < 0.02, "excluded": c["name"] in excluded, "impactRatio": None, "impactRatioInterval": None})
    included = [r for r in rows if not r["excluded"] and r["n"] > 0]
    ref = max(included, key=lambda r: r[rate_key]) if included else None  # first maximum in input order
    if ref is not None and ref[count_key] > 0:
        for r in included:
            if r is ref:
                r["impactRatio"] = 1.0
                continue
            xs, ns, xc, nc = r[count_key], r["n"], ref[count_key], ref["n"]
            method = ratio_method(xs, ns, xc, nc)
            lo, hi = katz(xs, ns, xc, nc, z) if method == "katz_log" else koopman(xs, ns, xc, nc, z)
            r["impactRatio"] = (xs / ns) / (xc / nc)
            r["impactRatioInterval"] = {"lower": lo, "upper": hi, "level": level, "method": method}
    return {"referenceCategory": ref["category"] if ref else None, "totalIndividuals": total, "totalAssessedKnown": known, "unknownCategoryCount": unknown, "categories": rows}
