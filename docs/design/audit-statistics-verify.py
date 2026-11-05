#!/usr/bin/env python3
"""VERIFICATION AID for docs/design/audit-statistics.md. This is not runtime code.

It regenerates and checks schemas/fixtures/statistics-golden.json.

* Reference values are computed with the Python standard library only, following the
  normative algorithms in the design document. Fisher's exact test uses exact integers.
* --cross-check recomputes every primitive independently with scipy and statsmodels
  (Wilson, Newcombe, Katz-log, Koopman, Fisher, Holm, Benjamini-Hochberg, normal
  quantiles, two-proportion sample size) and rebuilds the composite quantities from
  those primitives. Install scipy and statsmodels only in a throwaway virtualenv OUTSIDE
  the repository; they must never become runtime dependencies.
* --simulate runs Monte Carlo checks of the power formulas and of interval coverage.

Usage (from the repository root):
  python docs/design/audit-statistics-verify.py --check
  python docs/design/audit-statistics-verify.py --write
  python docs/design/audit-statistics-verify.py --check --cross-check --simulate
  python docs/design/audit-statistics-verify.py --markdown
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from statistics import NormalDist

ND = NormalDist()
ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "schemas" / "fixtures" / "statistics-golden.json"
SPEC_VERSION = "1.0.0"
Z_MAX = 37.0
FLOORS = {"sampleSize": 30, "groupSize": 30, "classCount": 10}
EPS = 1e-12


# ---------------------------------------------------------------- numerics
def zcrit(level):
    return ND.inv_cdf(1.0 - (1.0 - level) / 2.0)


def p_from_z(z):
    """Two-sided-equivalent decision p-value 2*(1 - Phi(z)) for z >= 0."""
    return math.erfc(min(max(z, 0.0), Z_MAX) / math.sqrt(2.0))


def on_boundary(value, bound):
    return abs(value - bound) <= EPS * max(1.0, abs(bound))


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


def koopman_z(x1, n1, x2, n2, phi):
    """Score statistic for H0: p1/p2 = phi (Koopman 1984 = Farrington-Manning/Miettinen-Nurminen without n/(n-1))."""
    a = (n1 + n2) * phi
    b = -(n1 * phi + x1 + n2 + x2 * phi)
    c = x1 + x2
    p2 = 2.0 * c / (-b + math.sqrt(max(b * b - 4.0 * a * c, 0.0)))  # smaller root, cancellation-free
    p1 = phi * p2
    variance = p1 * (1.0 - p1) / n1 + phi * phi * p2 * (1.0 - p2) / n2
    numerator = x1 / n1 - phi * x2 / n2
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


# ---------------------------------------------------------------- exact test and multiplicity
def fisher_two_sided(x1, n1, x2, n2):
    """Two-sided Fisher exact p: sum of hypergeometric probabilities <= the observed one (exact integers)."""
    k_total = x1 + x2
    observed = math.comb(n1, x1) * math.comb(n2, x2)
    weights = [math.comb(n1, k) * math.comb(n2, k_total - k) for k in range(max(0, k_total - n2), min(k_total, n1) + 1)]
    return min(1.0, sum(w for w in weights if w <= observed) / sum(weights))


def holm(pvalues):
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [1.0] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def benjamini_hochberg(pvalues):
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted, running = [1.0] * m, 1.0
    for rank in range(m - 1, -1, -1):
        i = order[rank]
        running = min(running, m * pvalues[i] / (rank + 1))
        adjusted[i] = min(1.0, running)
    return adjusted


# ---------------------------------------------------------------- members
def member(metric, band, estimate, method, ci_at, zstar_closed=None, *, subject=None, comparator=None, counts=None, status="evaluated", reasons=(), small_cell=False, fisher=None, level=0.95):
    out = {"memberId": metric if subject is None else f"{metric}:{subject}|{comparator}", "metric": metric, "subject": subject, "comparator": comparator, "counts": counts, "estimate": estimate, "interval": None, "band": band, "status": status, "direction": "none", "pValue": 1.0, "smallCell": small_cell, "fisherExactP": fisher, "reasons": list(reasons)}
    if estimate is None or ci_at is None:
        return out
    lo, hi = ci_at(zcrit(level))
    out["interval"] = {"lower": lo, "upper": hi, "level": level, "method": method}
    out["_ci_at"] = ci_at
    if status != "evaluated":
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
    return out


def proportion_member(metric, x, n, band, minimum, level, zero_reason="undefined_zero_denominator"):
    counts = {"x": x, "n": n}
    if n == 0:
        return member(metric, band, None, "wilson", None, counts=counts, status="undefined", reasons=[zero_reason], level=level)
    status, reasons = ("evaluated", []) if n >= minimum else ("insufficient_support", ["below_minimum_class_count"])
    return member(metric, band, x / n, "wilson", lambda z: wilson(x, n, z), lambda d: wilson_zstar(x, n, band, d), counts=counts, status=status, reasons=reasons, level=level)


def performance_member(spec, cm, mins, level):
    tp, fp, fn, tn = cm["tp"], cm["fp"], cm["fn"], cm["tn"]
    pos, neg, total = tp + fn, fp + tn, tp + fp + fn + tn
    metric, band, cls = spec["metric"], spec["band"], mins["classCount"]
    if metric == "accuracy":
        return proportion_member(metric, tp + tn, total, band, mins["sampleSize"], level)
    if metric == "precision":
        return proportion_member(metric, tp, tp + fp, band, cls, level)
    if metric == "recall":
        return proportion_member(metric, tp, pos, band, cls, level, "single_class")
    if metric == "specificity":
        return proportion_member(metric, tn, neg, band, cls, level, "single_class")
    if metric == "false_positive_rate":
        return proportion_member(metric, fp, neg, band, cls, level, "single_class")
    if metric == "balanced_accuracy":
        counts = {"tp": tp, "positives": pos, "tn": tn, "negatives": neg}
        if pos == 0 or neg == 0:
            return member(metric, band, None, "mover_wilson", None, counts=counts, status="undefined", reasons=["single_class"], level=level)
        status, reasons = ("evaluated", []) if min(pos, neg) >= cls else ("insufficient_support", ["below_minimum_class_count"])
        return member(metric, band, (tp / pos + tn / neg) / 2.0, "mover_wilson", lambda z: mover_mean([(tp, pos), (tn, neg)], z), counts=counts, status=status, reasons=reasons, level=level)
    if metric == "f1":
        m = tp + fp + fn
        counts = {"tp": tp, "tpPlusFpPlusFn": m, "positives": pos}
        if pos == 0:
            return member(metric, band, None, "jaccard_wilson", None, counts=counts, status="undefined", reasons=["single_class"], level=level)
        status, reasons = ("evaluated", []) if pos >= cls else ("insufficient_support", ["below_minimum_class_count"])
        jband = {"lower": None if band.get("lower") is None else j_from_f1(band["lower"]), "upper": None if band.get("upper") is None else j_from_f1(band["upper"])}
        return member(metric, band, 2.0 * tp / (2 * tp + fp + fn), "jaccard_wilson", lambda z: jaccard_f1(tp, m, z), lambda d: wilson_zstar(tp, m, jband, d), counts=counts, status=status, reasons=reasons, level=level)
    raise ValueError(metric)


def rates_for(metric, g):
    if "selected" in g:
        return g["selected"], g["n"]
    tp, fp, fn, tn = g["tp"], g["fp"], g["fn"], g["tn"]
    if metric.startswith("selection_rate"):
        return tp + fp, tp + fp + fn + tn
    if metric == "tpr_difference":
        return tp, tp + fn
    if metric == "fpr_difference":
        return fp, fp + tn
    raise ValueError(metric)


def pair_member(metric, subject, comparator, s, c, band, mins, level, suppressed=False):
    (xs, ns), (xc, nc) = s, c
    counts = {"subject": {"x": xs, "n": ns}, "comparator": {"x": xc, "n": nc}}
    cells = (xs, ns - xs, xc, nc - xc)
    small = min(cells) < 5
    if ns == 0 or nc == 0:
        return member(metric, band, None, "newcombe_hybrid_score", None, subject=subject, comparator=comparator, counts=counts, status="suppressed" if suppressed else "undefined", reasons=["undefined_zero_denominator"], level=level)
    minimum = mins["classCount"] if metric in ("tpr_difference", "fpr_difference") else mins["groupSize"]
    if suppressed:
        status, reasons = "suppressed", ["group_below_minimum_size"]
    else:
        status, reasons = ("evaluated", []) if min(ns, nc) >= minimum else ("insufficient_support", ["below_minimum_class_count"])
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


def code_point_key(text):
    return [ord(ch) for ch in text]


def group_members(spec, data, mins, level):
    groups = {g["group"]: g for g in data["groups"]}
    declared = spec.get("declaredGroups")
    names = sorted(set(groups) | set(declared or []), key=code_point_key)
    size = {name: (groups[name]["n"] if "n" in groups.get(name, {}) else sum(groups[name][k] for k in ("tp", "fp", "fn", "tn"))) if name in groups else 0 for name in names}
    present = [name for name in names if size[name] > 0]
    eligible = [name for name in present if size[name] >= mins["groupSize"]]
    suppressed = [{"group": name, "n": size[name]} for name in names if size[name] < mins["groupSize"]]
    unknown = data.get("unknownGroupRows", 0)
    population = sum(size.values()) + unknown
    coverage = {"eligibleRows": sum(size[n] for n in eligible), "populationRows": population, "unknownGroupRows": unknown, "value": sum(size[n] for n in eligible) / population if population else 0.0, "minimum": spec.get("minimumCoverage", 1.0)}
    metrics = ["tpr_difference", "fpr_difference"] if spec["metric"] == "equalized_odds" else [spec["metric"]]
    band = spec["band"]
    mode = spec.get("comparison", {"mode": "all_pairs"})
    members = []
    for metric in metrics:
        if mode["mode"] == "reference":
            ref = mode["referenceGroup"]
            pairs = [(name, ref) for name in present if name != ref] if ref in present else []
        else:
            pairs = []
            for i, a in enumerate(present):
                for b in present[i + 1:]:
                    ra, rb = rates_for(metric, groups[a]), rates_for(metric, groups[b])
                    rate_a = ra[0] / ra[1] if ra[1] else math.inf
                    rate_b = rb[0] / rb[1] if rb[1] else math.inf
                    pairs.append((b, a) if rate_b < rate_a else (a, b))
        for s, c in pairs:
            members.append(pair_member(metric, s, c, rates_for(metric, groups[s]), rates_for(metric, groups[c]), band, mins, level, suppressed=s not in eligible or c not in eligible))
    reasons, blocked = [], False
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
    context = {"sampleSize": sum(size.values()), "suppressedGroups": suppressed, "coverage": coverage, "passBlocked": blocked, "reasons": reasons, "scale": "log" if spec["metric"] == "selection_rate_ratio" else "linear", "headlineMetric": {"selection_rate_difference": "largest_selection_rate_difference", "selection_rate_ratio": "smallest_selection_rate_ratio", "equalized_odds": "largest_tpr_or_fpr_difference", "tpr_difference": "largest_tpr_difference", "fpr_difference": "largest_fpr_difference"}[spec["metric"]]}
    return members, context


def calibration_members(spec, data, mins, level):
    band, members, eligible_rows = spec["band"], [], 0
    total = sum(b["n"] for b in data["bins"])
    for b in data["bins"]:
        if b["n"] < mins["groupSize"]:
            continue
        eligible_rows += b["n"]
        x, n, s = b["positives"], b["n"], b["meanScore"]
        pband = {"lower": None if band.get("lower") is None else s + band["lower"], "upper": None if band.get("upper") is None else s + band["upper"]}
        m = member("calibration_gap", band, x / n - s, "wilson", lambda z, x=x, n=n, s=s: tuple(v - s for v in wilson(x, n, z)), lambda d, x=x, n=n, pb=pband: wilson_zstar(x, n, pb, d), counts={"x": x, "n": n, "meanScore": s}, level=level)
        m["memberId"] = f"calibration_gap:bin{b['bin']}"
        m["subject"] = f"bin{b['bin']}"
        members.append(m)
    ece = sum(b["n"] / total * abs(b["positives"] / b["n"] - b["meanScore"]) for b in data["bins"] if b["n"])
    coverage = {"eligibleRows": eligible_rows, "populationRows": total, "unknownGroupRows": 0, "value": eligible_rows / total, "minimum": spec.get("minimumCoverage", 1.0)}
    blocked = coverage["value"] < coverage["minimum"] - EPS
    suppressed = [{"group": f"bin{b['bin']}", "n": b["n"]} for b in data["bins"] if b["n"] < mins["groupSize"]]
    reasons = (["group_suppressed_below_minimum"] if suppressed else []) + (["insufficient_coverage"] if blocked else [])
    return members, {"sampleSize": total, "suppressedGroups": suppressed, "coverage": coverage, "passBlocked": blocked, "reasons": reasons, "scale": "linear", "headlineMetric": "largest_calibration_gap", "ece": ece}


def multiclass_members(spec, data, mins, level):
    labels, matrix = data["labels"], data["matrix"]
    k, total = len(labels), sum(map(sum, matrix))
    support = [sum(matrix[i]) for i in range(k)]
    predicted = [sum(matrix[r][i] for r in range(k)) for i in range(k)]
    tps = [matrix[i][i] for i in range(k)]
    out = []
    for item in spec["members"]:
        metric, band = item["metric"], item["band"]
        if metric == "accuracy":
            out.append(proportion_member(metric, sum(tps), total, band, mins["sampleSize"], level))
            continue
        status, reasons = ("evaluated", []) if min(support) >= mins["classCount"] else ("insufficient_support", ["below_minimum_class_count"])
        if min(support) == 0:
            out.append(member(metric, band, None, "mover_wilson", None, status="undefined", reasons=["single_class"], level=level))
            continue
        if metric == "balanced_accuracy":
            parts = list(zip(tps, support))
            out.append(member(metric, band, sum(x / n for x, n in parts) / k, "mover_wilson", lambda z, parts=parts: mover_mean(parts, z), counts={"perClass": [{"label": l, "tp": x, "support": n} for l, (x, n) in zip(labels, parts)]}, status=status, reasons=reasons, level=level))
        elif metric == "macro_f1":
            classes = [(tps[i], support[i] + predicted[i] - tps[i]) for i in range(k)]
            estimate = sum(2 * tps[i] / (support[i] + predicted[i]) for i in range(k)) / k
            out.append(member(metric, band, estimate, "jaccard_wilson_bonferroni", lambda z, classes=classes: macro_f1_interval(classes, z), counts={"perClass": [{"label": l, "tp": x, "tpPlusFpPlusFn": m} for l, (x, m) in zip(labels, classes)]}, status=status, reasons=reasons, level=level))
        else:
            raise ValueError(metric)
    return out, {"sampleSize": total, "passBlocked": False, "reasons": []}


def regression_members(spec, data, mins, level):
    errors, out = data["errors"], []
    n = len(errors)
    for item in spec["members"]:
        metric, band = item["metric"], item["band"]
        values = [abs(e) for e in errors] if metric == "mae" else [e * e for e in errors]
        mean, sd = mean_sd(values)
        se = sd / math.sqrt(n)
        if se == 0.0:
            out.append(member(metric, band, mean if metric == "mae" else math.sqrt(mean), "normal_approximation", None, status="undefined", reasons=["degenerate_interval"], level=level))
            continue
        if metric == "mae":
            out.append(member(metric, band, mean, "normal_approximation", lambda z, m=mean, s=se: (max(0.0, m - z * s), m + z * s), lambda d, m=mean, s=se: normal_zstar(m, s, band, d), counts={"n": n, "meanAbsoluteError": mean, "sdAbsoluteError": sd}, level=level))
        else:
            sq_band = {"lower": None if band.get("lower") is None else band["lower"] ** 2, "upper": None if band.get("upper") is None else band["upper"] ** 2}
            out.append(member(metric, band, math.sqrt(mean), "normal_approximation_mse", lambda z, m=mean, s=se: (math.sqrt(max(0.0, m - z * s)), math.sqrt(m + z * s)), lambda d, m=mean, s=se: normal_zstar(m, s, sq_band, d), counts={"n": n, "meanSquaredError": mean, "sdSquaredError": sd}, level=level))
    return out, {"sampleSize": n, "passBlocked": False, "reasons": []}


# ---------------------------------------------------------------- criteria and plans
def headline(members, context, level):
    alpha = 1.0 - level
    members = [m for m in members if m["status"] != "suppressed"]
    evaluable = [m for m in members if m["status"] == "evaluated"]
    if not evaluable or "scale" not in context:
        return None
    band = members[0]["band"]
    log = context["scale"] == "log"
    tr = (lambda v: math.log(v) if v > 0 else -math.inf) if log else (lambda v: v)
    lower, upper = band.get("lower"), band.get("upper")
    two_sided = lower is not None and upper is not None
    z_nom, z_bon = zcrit(level), zcrit(1.0 - alpha / len(evaluable))
    complete = all(m["status"] == "evaluated" for m in members)

    def dev(m, z):
        lo, hi = m["_ci_at"](z)
        return tr(lo), tr(hi)

    # A pass-side bound that cannot be computed (some member undefined or unsupported) is reported as the
    # statistic's natural limit, which is a valid but uninformative bound: 1 for |difference|, 0 for a ratio.
    if two_sided:
        def abs_bounds(lo, hi):
            return max(0.0, lo, -hi), max(abs(lo), abs(hi))
        value = max(abs(tr(m["estimate"])) for m in evaluable)
        fail_side = max(abs_bounds(*dev(m, z_bon))[0] for m in evaluable)
        pass_side = max(abs_bounds(*dev(m, z_nom))[1] for m in evaluable) if complete else math.inf
        if log:
            return {"metric": context["headlineMetric"], "estimate": math.exp(-value), "interval": {"lower": math.exp(-pass_side), "upper": math.exp(-fail_side), "level": level, "method": "worst_member_bounds"}}
        return {"metric": context["headlineMetric"], "estimate": value, "interval": {"lower": fail_side, "upper": min(pass_side, 1.0), "level": level, "method": "worst_member_bounds"}}
    back = math.exp if log else (lambda v: v)
    if lower is not None:  # one-sided lower band: worst member = smallest deviation
        value = min(tr(m["estimate"]) for m in evaluable)
        pass_side = min(dev(m, z_nom)[0] for m in evaluable) if complete else -math.inf
        fail_side = min(dev(m, z_bon)[1] for m in evaluable)
        return {"metric": context["headlineMetric"], "estimate": back(value), "interval": {"lower": back(pass_side) if log else max(pass_side, -1.0), "upper": back(fail_side), "level": level, "method": "worst_member_bounds"}}
    value = max(tr(m["estimate"]) for m in evaluable)  # one-sided upper band (differences only)
    fail_side = max(dev(m, z_bon)[0] for m in evaluable)
    pass_side = max(dev(m, z_nom)[1] for m in evaluable) if complete else 1.0
    return {"metric": context["headlineMetric"], "estimate": value, "interval": {"lower": fail_side, "upper": min(pass_side, 1.0), "level": level, "method": "worst_member_bounds"}}


def evaluate_criterion(spec, data, level, mins):
    alpha = 1.0 - level
    kind = spec["kind"]
    if kind == "performance":
        cm = {k: sum(g[k] for g in data["groups"]) + data.get("unknownGroup", {}).get(k, 0) for k in ("tp", "fp", "fn", "tn")}
        members = [performance_member(item, cm, mins, level) for item in spec["members"]]
        context = {"sampleSize": sum(cm.values()), "passBlocked": False, "reasons": []}
    elif kind == "group_comparison":
        members, context = group_members(spec, data, mins, level)
    elif kind == "calibration":
        members, context = calibration_members(spec, data, mins, level)
    elif kind == "multiclass_performance":
        members, context = multiclass_members(spec, data, mins, level)
    elif kind == "regression_performance":
        members, context = regression_members(spec, data, mins, level)
    else:
        raise ValueError(kind)
    reasons = list(context["reasons"])
    gated = context["sampleSize"] < mins["sampleSize"]
    if gated:
        reasons.insert(0, "below_minimum_sample_size")
    deciding_pool = [m for m in members if m["status"] != "suppressed"]
    evaluable = [m for m in deciding_pool if m["status"] == "evaluated"]
    fails = [m for m in evaluable if m["direction"] == "fail"]
    deciding = None
    if gated or not evaluable:
        direction, p = "none", 1.0
    elif fails:
        direction = "fail"
        deciding = min(fails, key=lambda m: (m["pValue"], m["memberId"]))
        p = min(1.0, len(evaluable) * deciding["pValue"])
        ungated = min(1.0, len(evaluable) * min(m.get("_pInterval", m["pValue"]) for m in fails))
        if p > alpha + EPS and ungated <= alpha + EPS:
            reasons.append("small_cell_exact_test_not_significant")
        elif p > alpha + EPS and deciding["pValue"] <= alpha + EPS:
            reasons.append("within_criterion_multiplicity")
        elif p > alpha + EPS:
            reasons.append("interval_straddles_band")
    else:
        complete = bool(deciding_pool) and all(m["status"] == "evaluated" and m["direction"] == "pass" for m in deciding_pool)
        direction = "pass" if any(m["direction"] == "pass" for m in evaluable) else "none"
        if complete and not context["passBlocked"]:
            deciding = max(deciding_pool, key=lambda m: (m["pValue"], m["memberId"]))
            p = deciding["pValue"]
            if p > alpha + EPS:
                reasons.append("interval_straddles_band")
        else:
            p = 1.0
    for m in deciding_pool:
        for r in m["reasons"]:
            if r not in reasons:
                reasons.append(r)
    result = {"id": spec["id"], "role": spec.get("role", "confirmatory"), "kind": kind, "members": members, "headline": headline(members, context, level) if kind in ("group_comparison", "calibration") else None, "sampleSize": context["sampleSize"], "coverage": context.get("coverage"), "suppressedGroups": context.get("suppressedGroups"), "direction": direction, "pValue": p, "decidingMemberId": deciding["memberId"] if deciding else None, "unadjustedOutcome": direction if direction in ("pass", "fail") and p <= alpha + EPS else "inconclusive", "reasons": reasons}
    if "ece" in context:
        result["expectedCalibrationError"] = context["ece"]
    return result


def aggregate(outcomes):
    for state in ("fail", "inconclusive", "pass"):
        if state in outcomes:
            return state
    return "not_applicable"


def evaluate_plan(plan, data):
    level = plan.get("confidenceLevel", 0.95)
    alpha = 1.0 - level
    mins = {**FLOORS, **plan.get("minimums", {})}
    assert all(mins[k] >= FLOORS[k] for k in FLOORS), "plan minimums below platform floors"
    results = [evaluate_criterion(c, data, level, mins) for c in plan["criteria"]]
    for role, method, adjust in (("confirmatory", "holm", holm), ("exploratory", "benjamini_hochberg", benjamini_hochberg)):
        family = [r for r in results if r["role"] == role]
        for r, a in zip(family, adjust([r["pValue"] for r in family])):
            r["adjustment"], r["familySize"], r["adjustedPValue"] = method, len(family), a
            r["outcome"] = r["direction"] if r["direction"] in ("pass", "fail") and a <= alpha + EPS else "inconclusive"
            if r["unadjustedOutcome"] != "inconclusive" and r["outcome"] == "inconclusive":
                r["reasons"].append("multiplicity_adjustment")
    confirmatory = [r["outcome"] for r in results if r["role"] == "confirmatory"]
    return {"criteria": results, "overallOutcome": aggregate(confirmatory), "reviewFlags": [r["id"] for r in results if r["role"] == "exploratory" and r["outcome"] == "fail"]}


# ---------------------------------------------------------------- power (normal approximations at assumed true values)
def phi(x):
    return ND.cdf(x)


def power_difference(p_subject, p_comparator, n_subject, n_comparator, band, level):
    z = zcrit(level)
    se = math.sqrt(p_subject * (1 - p_subject) / n_subject + p_comparator * (1 - p_comparator) / n_comparator)
    d = p_subject - p_comparator
    return _band_probabilities(d, se, band, z)


def power_ratio(p_subject, p_comparator, n_subject, n_comparator, band, level):
    z = zcrit(level)
    se = math.sqrt((1 - p_subject) / (n_subject * p_subject) + (1 - p_comparator) / (n_comparator * p_comparator))
    lband = {"lower": None if band.get("lower") is None else math.log(band["lower"]), "upper": None if band.get("upper") is None else math.log(band["upper"])}
    return _band_probabilities(math.log(p_subject / p_comparator), se, lband, z)


def _band_probabilities(theta, se, band, z):
    lower, upper = band.get("lower"), band.get("upper")
    if lower is not None and upper is not None:
        passing = max(0.0, phi((upper - theta) / se - z) + phi((theta - lower) / se - z) - 1.0)
    elif lower is not None:
        passing = phi((theta - lower) / se - z)
    else:
        passing = phi((upper - theta) / se - z)
    failing = (phi((lower - theta) / se - z) if lower is not None else 0.0) + (phi((theta - upper) / se - z) if upper is not None else 0.0)
    return {"pass": passing, "fail": failing}


def power_proportion(p_true, n, band, level):
    """Probability that the Wilson rule passes / fails a single proportion (score-test form)."""
    z = zcrit(level)
    se = math.sqrt(p_true * (1 - p_true) / n)
    lower, upper = band.get("lower"), band.get("upper")
    passing, failing = 1.0, 0.0
    if lower is not None:
        passing *= phi((p_true - lower - z * math.sqrt(lower * (1 - lower) / n)) / se)
        failing += phi((lower - z * math.sqrt(lower * (1 - lower) / n) - p_true) / se)
    if upper is not None:
        passing *= phi((upper - z * math.sqrt(upper * (1 - upper) / n) - p_true) / se)
        failing += phi((p_true - upper - z * math.sqrt(upper * (1 - upper) / n)) / se)
    return {"pass": passing, "fail": failing}


def smallest_n(probability_at, target, start=2, limit=10_000_000):
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


def fail_mde_difference(p_comparator, n, band, level, power):
    """Smallest true shortfall Delta beyond the lower band edge with P(fail) >= power (subject = comparator - Delta)."""
    def failing(delta):
        return power_difference(p_comparator - delta, p_comparator, n, n, band, level)["fail"]
    lo, hi = -band["lower"], p_comparator - 1e-12
    if failing(hi) < power:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if failing(mid) >= power:
            hi = mid
        else:
            lo = mid
    return hi


def fail_mde_ratio(p_comparator, n, band, level, power):
    """Largest true ratio below the lower band edge with P(fail) >= power. P(fail) is unimodal in r (it falls
    again as r -> 0 because the variance of log r explodes), so search between its peak and the band edge."""
    def failing(r):
        return power_ratio(r * p_comparator, p_comparator, n, n, band, level)["fail"]
    grid = [band["lower"] * math.exp(-12.0 * i / 4000) for i in range(1, 4001)]
    peak = max(grid, key=failing)
    lo, hi = peak, band["lower"]
    if failing(lo) < power:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if failing(mid) >= power:
            lo = mid
        else:
            hi = mid
    return lo


def evaluate_power(inp):
    level, target = inp.get("confidenceLevel", 0.95), inp.get("targetPower", 0.8)
    kind = inp["kind"]
    if kind == "equality_test":
        raw, n = equality_test_n(inp["p1"], inp["p2"], level, target)
        return {"groupSizeExact": raw, "groupSize": n}
    if kind == "proportion":
        probs = power_proportion(inp["assumedValue"], inp["n"], inp["band"], level)
        need = smallest_n(lambda n: power_proportion(inp["assumedValue"], n, inp["band"], level)["pass"], target)
        return {"passProbability": probs["pass"], "failProbability": probs["fail"], "requiredNForPass": need}
    fn = power_difference if kind == "difference" else power_ratio
    p0, n = inp["baselineRate"], inp["groupSize"]
    p_subject = p0 + inp.get("assumedDifference", 0.0) if kind == "difference" else p0 * inp.get("assumedRatio", 1.0)
    probs = fn(p_subject, p0, n, n, inp["band"], level)
    need = smallest_n(lambda m: fn(p_subject, p0, m, m, inp["band"], level)["pass"], target)
    mde = fail_mde_difference(p0, n, inp["band"], level, target) if kind == "difference" else fail_mde_ratio(p0, n, inp["band"], level, target)
    out = {"passProbability": probs["pass"], "requiredGroupSizeForPass": need}
    out["failMdeDifference" if kind == "difference" else "failMdeRatio"] = mde
    return out


# ---------------------------------------------------------------- NYC LL144 reporting (selection rates)
def evaluate_ll144(inp, level=0.95):
    z = zcrit(level)
    cats = inp["categories"]
    total = sum(c["n"] for c in cats)
    excluded = set(inp.get("excluded", []))
    rows = []
    for c in cats:
        share = c["n"] / total
        assert c["name"] not in excluded or share < 0.02, "2% exclusion only allowed below 2% of the data"
        lo, hi = wilson(c["selected"], c["n"], z)
        rows.append({"category": c["name"], "n": c["n"], "selected": c["selected"], "selectionRate": c["selected"] / c["n"], "selectionRateInterval": {"lower": lo, "upper": hi, "level": level, "method": "wilson"}, "shareOfData": share, "eligibleForTwoPercentExclusion": share < 0.02, "excluded": c["name"] in excluded})
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
    return {"referenceCategory": ref["category"], "totalAssessedKnown": total, "unknownCategoryCount": inp.get("unknownCount", 0), "categories": rows}


# ---------------------------------------------------------------- golden cases
def band(lower=None, upper=None):
    return {"lower": lower, "upper": upper}


def perf(id_, members, role="confirmatory"):
    return {"id": id_, "role": role, "kind": "performance", "members": [{"metric": m, "band": b} for m, b in members]}


def grp(id_, metric, b, mode=None, role="confirmatory", minimum_coverage=1.0, declared=None):
    out = {"id": id_, "role": role, "kind": "group_comparison", "metric": metric, "comparison": mode or {"mode": "all_pairs"}, "band": b, "minimumCoverage": minimum_coverage}
    if declared:
        out["declaredGroups"] = declared
    return out


def cm(group, tp, fp, fn, tn):
    return {"group": group, "tp": tp, "fp": fp, "fn": fn, "tn": tn}


def sel(group, selected, n):
    return {"group": group, "selected": selected, "n": n}


DP10, IR45, EO10 = band(-0.1, 0.1), band(0.8, 1.25), band(-0.1, 0.1)

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
    {"id": "GC-15", "category": "zero_denominator", "title": "Nobody selected in either group: parity difference passes, impact ratio undefined", "type": "plan",
     "data": {"groups": [sel("A", 0, 50), sel("B", 0, 50)]}, "plan": {"criteria": [grp("parity-0.10", "selection_rate_difference", DP10), grp("four-fifths-screen", "selection_rate_ratio", IR45)]}},
    {"id": "GC-37", "category": "all_events", "title": "Everyone selected in both groups: Katz-log degenerates to a zero-width interval, so the Koopman interval is used", "type": "plan",
     "data": {"groups": [sel("A", 40, 40), sel("B", 35, 35)]}, "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45), grp("parity-0.10", "selection_rate_difference", DP10)]}},
    {"id": "GC-16", "category": "empty_group", "title": "A declared group has no rows: comparisons among the others are evaluated but the criterion cannot pass", "type": "plan",
     "data": {"groups": [sel("A", 200, 400), sel("B", 196, 400)]}, "plan": {"criteria": [grp("parity-0.10", "selection_rate_difference", DP10, declared=["A", "B", "C"])]}},
    {"id": "GC-17", "category": "multiplicity", "title": "Three groups: one comparison lies beyond the band at 95% but not after Bonferroni within the criterion", "type": "plan",
     "data": {"groups": [sel("A", 300, 600), sel("B", 290, 600), sel("C", 234, 600)]}, "plan": {"criteria": [grp("parity-0.05", "selection_rate_difference", band(-0.05, 0.05))]}},
    {"id": "GC-18", "category": "multiplicity", "title": "Holm across four confirmatory criteria", "type": "multiplicity",
     "input": {"method": "holm", "alpha": 0.05, "pValues": [0.004, 0.030, 0.012, 0.200]}},
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
     "input": {"kind": "ratio", "baselineRate": 0.50, "groupSize": 388, "assumedRatio": 1.0, "band": IR45, "confidenceLevel": 0.95, "targetPower": 0.80}},
    {"id": "GC-28", "category": "power", "title": "Band-based check for a 0.05 parity band at 30% selection and 500 per group", "type": "power",
     "input": {"kind": "difference", "baselineRate": 0.30, "groupSize": 500, "assumedDifference": 0.0, "band": band(-0.05, 0.05), "confidenceLevel": 0.95, "targetPower": 0.80}},
    {"id": "GC-29", "category": "power", "title": "Single proportion: recall truly 0.80 against a 0.70 minimum with 50 positives", "type": "power",
     "input": {"kind": "proportion", "assumedValue": 0.80, "n": 50, "band": band(0.70), "confidenceLevel": 0.95, "targetPower": 0.80}},
    {"id": "GC-30", "category": "reference_group", "title": "Fixed reference group with a one-sided ratio band", "type": "plan",
     "data": {"groups": [sel("A", 200, 400), sel("B", 150, 400), sel("C", 190, 400)]}, "plan": {"criteria": [grp("impact-vs-A", "selection_rate_ratio", band(0.8), mode={"mode": "reference", "referenceGroup": "A"})]}},
    {"id": "GC-31", "category": "end_to_end", "title": "Hosted suite on two groups: four confirmatory criteria with Holm", "type": "plan",
     "data": {"groups": [cm("A", 180, 40, 20, 360), cm("B", 166, 42, 34, 358)]}, "plan": {"criteria": [perf("performance", [("accuracy", band(0.80)), ("recall", band(0.70)), ("balanced_accuracy", band(0.50))]), grp("demographic_parity", "selection_rate_difference", DP10), grp("disparate_impact", "selection_rate_ratio", IR45), grp("equalized_odds", "equalized_odds", EO10)]}},
    {"id": "GC-32", "category": "ll144", "title": "NYC DCWP worked example (race/ethnicity selection rates) reproduced with intervals", "type": "ll144",
     "input": {"unknownCount": 250, "categories": [{"name": "Hispanic or Latino", "n": 408, "selected": 204}, {"name": "White", "n": 797, "selected": 412}, {"name": "Black or African American", "n": 390, "selected": 170}, {"name": "Native Hawaiian or Pacific Islander", "n": 119, "selected": 52}, {"name": "Asian", "n": 616, "selected": 302}, {"name": "Native American or Alaska Native", "n": 41, "selected": 18}, {"name": "Two or More Races", "n": 213, "selected": 96}]}},
    {"id": "GC-33", "category": "ll144", "title": "DCWP example under the four-fifths screen: published ratios of 0.84 do not demonstrate a pass", "type": "plan",
     "data": {"groups": [sel("Hispanic or Latino", 204, 408), sel("White", 412, 797), sel("Black or African American", 170, 390), sel("Native Hawaiian or Pacific Islander", 52, 119), sel("Asian", 302, 616), sel("Native American or Alaska Native", 18, 41), sel("Two or More Races", 96, 213)], "unknownGroupRows": 250},
     "plan": {"criteria": [grp("four-fifths-screen", "selection_rate_ratio", IR45, minimum_coverage=0.9)]}},
    {"id": "GC-34", "category": "multiclass", "title": "Three-class confusion matrix: accuracy, macro recall (balanced accuracy) and macro F1", "type": "plan",
     "data": {"kind": "multiclass", "labels": ["high", "low", "medium"], "matrix": [[150, 10, 40], [8, 270, 22], [30, 25, 245]]},
     "plan": {"criteria": [{"id": "multiclass-performance", "role": "confirmatory", "kind": "multiclass_performance", "members": [{"metric": "accuracy", "band": band(0.75)}, {"metric": "balanced_accuracy", "band": band(0.75)}, {"metric": "macro_f1", "band": band(0.75)}]}]}},
    {"id": "GC-36", "category": "small_cell", "title": "Fisher's exact test reference values (two-sided; tables with probability <= the observed one)", "type": "fisher",
     "input": {"tables": [{"subject": {"x": 6, "n": 20}, "comparator": {"x": 10, "n": 20}}, {"subject": {"x": 0, "n": 30}, "comparator": {"x": 5, "n": 30}}, {"subject": {"x": 0, "n": 40}, "comparator": {"x": 10, "n": 40}}, {"subject": {"x": 2, "n": 40}, "comparator": {"x": 4500, "n": 9000}}, {"subject": {"x": 1, "n": 10}, "comparator": {"x": 1, "n": 10}}, {"subject": {"x": 3, "n": 8}, "comparator": {"x": 7, "n": 9}}, {"subject": {"x": 0, "n": 50}, "comparator": {"x": 0, "n": 50}}]}},
    {"id": "GC-35", "category": "regression", "title": "Regression errors: MAE and RMSE with normal-approximation intervals", "type": "plan",
     "data": {"kind": "regression", "errors": [0.8, -1.1, 0.3, 2.2, -0.4, 0.0, 1.5, -0.9, 0.6, -2.0, 0.2, 1.1, -0.7, 0.4, -1.6, 0.9, -0.2, 1.8, -1.3, 0.5, -0.6, 1.0, -0.1, 0.7, -1.4, 0.3, 1.2, -0.8, 0.1, -0.5, 2.5, -1.0, 0.6, -0.3, 1.4, -1.2, 0.2, 0.9, -0.4, 1.6]},
     "plan": {"criteria": [{"id": "regression-performance", "role": "confirmatory", "kind": "regression_performance", "members": [{"metric": "mae", "band": band(None, 1.2)}, {"metric": "rmse", "band": band(None, 1.5)}]}]}},
]


# ---------------------------------------------------------------- serialisation and checks
def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite value in fixture")
        return float(f"{value:.12g}")
    return value


def compute(case):
    if case["type"] == "plan":
        return evaluate_plan(case["plan"], case["data"])
    if case["type"] == "multiplicity":
        inp = case["input"]
        adjusted = (holm if inp["method"] == "holm" else benjamini_hochberg)(inp["pValues"])
        return {"adjustedPValues": adjusted, "rejected": [a <= inp["alpha"] + EPS for a in adjusted]}
    if case["type"] == "power":
        return evaluate_power(case["input"])
    if case["type"] == "ll144":
        return evaluate_ll144(case["input"])
    if case["type"] == "fisher":
        return {"pValues": [fisher_two_sided(t["subject"]["x"], t["subject"]["n"], t["comparator"]["x"], t["comparator"]["n"]) for t in case["input"]["tables"]]}
    raise ValueError(case["type"])


def numerics():
    levels = [0.90, 0.95, 0.99, 1 - 0.05 / 3, 1 - 0.05 / 6, 1 - 0.05 / 21]
    return {"normalQuantiles": [{"twoSidedLevel": lv, "z": zcrit(lv)} for lv in levels], "erfc": [{"x": x, "value": math.erfc(x)} for x in (0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 26.0)]}


def end_to_end(case):
    """Whether a case can also be run through a runner on expanded rows (see section 13 of the design)."""
    if case["type"] != "plan":
        return {"engine": False, "hosted": False}
    data, criteria = case["data"], case["plan"]["criteria"]
    if "groups" in data:
        rows = sum(g["n"] if "n" in g else g["tp"] + g["fp"] + g["fn"] + g["tn"] for g in data["groups"]) + data.get("unknownGroupRows", 0)
        hosted = rows <= 10_000 and not data.get("unknownGroupRows") and all(c["kind"] in ("performance", "group_comparison") and c.get("comparison", {"mode": "all_pairs"})["mode"] == "all_pairs" and not c.get("declaredGroups") for c in criteria)
        return {"engine": rows <= 1_000_000, "hosted": hosted}
    if "bins" in data:
        return {"engine": True, "hosted": False}
    return {"engine": True, "hosted": True}


def build():
    cases = []
    for case in sorted(CASES, key=lambda c: int(c["id"].split("-")[1])):
        out = {k: v for k, v in case.items()}
        out["runners"] = ["engine"] if case["category"] == "calibration" else ["engine", "hosted"]
        out["endToEnd"] = end_to_end(case)
        out["expected"] = compute(case)
        cases.append(out)
    return clean({
        "schemaVersion": "1.0",
        "specification": "docs/design/audit-statistics.md",
        "specificationVersion": SPEC_VERSION,
        "generatedBy": "docs/design/audit-statistics-verify.py (stdlib reference; scipy/statsmodels cross-check)",
        "howToUse": {
            "comparison": "Numbers: |actual - expected| <= tolerance (p-values: absolute + relative). Members are matched by memberId; reasons are compared as sets; all other fields exactly.",
            "coreLevel": "Every case runs through the statistics core on the counts given in data (both runners unless runners says otherwise).",
            "rowExpansion": "For endToEnd cases, expand each group in order into rows (label, prediction, group): tp -> (1,1), fp -> (0,1), fn -> (1,0), tn -> (0,0); selection-only groups: selected -> (1,1), others -> (0,0). Multiclass: matrix[i][j] rows with label labels[i] and prediction labels[j]. Regression: target 0 and prediction = error. Calibration bins: label 1 for positives, score = meanScore, prediction 1 when score >= 0.5. Positive label '1'.",
        },
        "defaults": {"confidenceLevel": 0.95, "minimums": FLOORS, "minimumCoverage": 1.0, "confirmatoryAdjustment": "holm", "exploratoryAdjustment": "benjamini_hochberg"},
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


# ---------------------------------------------------------------- independent cross-check (scipy / statsmodels)
def cross_check(fixture):
    import numpy as np
    from scipy import optimize, stats
    from scipy.stats.contingency import relative_risk
    from statsmodels.stats.multitest import multipletests
    from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint, samplesize_proportions_2indep_onetail

    problems, checks = [], 0

    def expect(ok, message):
        nonlocal checks
        checks += 1
        if not ok:
            problems.append(message)

    def near(a, b, tol=1e-7):
        return abs(a - b) <= tol * max(1.0, abs(b))

    for item in fixture["numerics"]["normalQuantiles"]:
        expect(near(stats.norm.isf((1 - item["twoSidedLevel"]) / 2), item["z"], 1e-9), f"quantile {item}")

    def sm_wilson(x, n, alpha):
        lo, hi = proportion_confint(x, n, alpha=alpha, method="wilson")
        return (0.0 if x == 0 else float(lo)), (1.0 if x == n else float(hi))

    def koopman_independent(x1, n1, x2, n2, alpha):
        """statsmodels' Nam cubic, except where it is unstable (a group rate of 1): then root-find a constrained-MLE score statistic."""
        if x1 < n1 and x2 < n2 and x1 > 0:
            lo, hi = confint_proportions_2indep(x1, n1, x2, n2, compare="ratio", method="score", correction=False, alpha=alpha)
            return float(lo), float(hi)
        zc = stats.norm.isf(alpha / 2)

        def stat(ph):
            res = optimize.minimize_scalar(lambda p2: -(stats.binom.logpmf(x1, n1, min(ph * p2, 1 - 1e-15)) + stats.binom.logpmf(x2, n2, p2)), bounds=(1e-12, min(1.0, 1.0 / ph) - 1e-12), method="bounded", options={"xatol": 1e-14})
            p2 = res.x
            p1 = ph * p2
            v = p1 * (1 - p1) / n1 + ph * ph * p2 * (1 - p2) / n2
            return (x1 / n1 - ph * x2 / n2) / math.sqrt(v)

        est = (x1 / n1) / (x2 / n2)
        lo = 0.0 if x1 == 0 else optimize.brentq(lambda ph: stat(ph) - zc, est * 1e-6, est * (1 - 1e-12))
        hi = optimize.brentq(lambda ph: stat(ph) + zc, max(est, 1e-9) * (1 + 1e-12), max(est, 1e-3) * 1e6)
        return lo, hi

    def independent_interval(m, alpha):
        metric, c = m["metric"], m["counts"]
        method = m["interval"]["method"]
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
            expect(near(float(lo), second.low, 1e-9) and near(float(hi), second.high, 1e-9), f"Katz statsmodels vs scipy.relative_risk {s} {k}")
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
        if method in ("normal_approximation", "normal_approximation_mse"):
            mean = c["meanAbsoluteError"] if method == "normal_approximation" else c["meanSquaredError"]
            sd = c["sdAbsoluteError"] if method == "normal_approximation" else c["sdSquaredError"]
            zc = stats.norm.isf(alpha / 2)
            lo, hi = max(0.0, mean - zc * sd / math.sqrt(c["n"])), mean + zc * sd / math.sqrt(c["n"])
            return (lo, hi) if method == "normal_approximation" else (math.sqrt(lo), math.sqrt(hi))
        raise ValueError(method)

    def check_member(m, case_id):
        if m["interval"] is None:
            return
        alpha = 1 - m["interval"]["level"]
        lo, hi = independent_interval(m, alpha)
        expect(near(lo, m["interval"]["lower"], 1e-6) and near(hi, m["interval"]["upper"], 1e-6), f"{case_id} {m['memberId']} interval {lo, hi} vs {m['interval']}")
        if m["status"] != "evaluated" or m["direction"] == "none":
            return
        p_interval = m["pValue"]
        if m["smallCell"] and m["direction"] == "fail" and m["fisherExactP"] is not None:
            s, k = m["counts"]["subject"], m["counts"]["comparator"]
            p_scipy = stats.fisher_exact([[s["x"], s["n"] - s["x"]], [k["x"], k["n"] - k["x"]]]).pvalue
            expect(near(p_scipy, m["fisherExactP"], 1e-9), f"{case_id} {m['memberId']} fisher {p_scipy} vs {m['fisherExactP']}")
            if m["pValue"] == m["fisherExactP"]:
                return
        if p_interval < 1e-12:
            return
        lo, hi = independent_interval(m, p_interval)  # the interval at level 1 - p must touch the band edge
        b = m["band"]
        if m["metric"] == "rmse":
            b = {key: (None if v is None else v) for key, v in b.items()}
        edges = [v for v in (b["lower"], b["upper"]) if v is not None]
        touch = min(min(abs(lo - e), abs(hi - e)) for e in edges)
        expect(touch <= 1e-6 * max(1.0, max(abs(e) for e in edges)), f"{case_id} {m['memberId']} p={p_interval} does not invert to the band edge (gap {touch})")

    for case in fixture["cases"]:
        exp = case["expected"]
        if case["type"] == "plan":
            alpha = 1 - case["plan"].get("confidenceLevel", 0.95)
            for crit in exp["criteria"]:
                for m in crit["members"]:
                    check_member(m, case["id"])
            for role, method in (("confirmatory", "holm"), ("exploratory", "fdr_bh")):
                fam = [c for c in exp["criteria"] if c["role"] == role]
                if fam:
                    adj = multipletests([c["pValue"] for c in fam], alpha=alpha, method=method)[1]
                    for c, a in zip(fam, adj):
                        expect(near(a, c["adjustedPValue"], 1e-9), f"{case['id']} {c['id']} adjusted {a} vs {c['adjustedPValue']}")
        elif case["type"] == "multiplicity":
            method = "holm" if case["input"]["method"] == "holm" else "fdr_bh"
            rej, adj, _, _ = multipletests(case["input"]["pValues"], alpha=case["input"]["alpha"], method=method)
            expect(all(near(a, b, 1e-9) for a, b in zip(adj, exp["adjustedPValues"])) and list(map(bool, rej)) == exp["rejected"], f"{case['id']} multipletests")
        elif case["type"] == "power" and case["input"]["kind"] == "equality_test":
            inp = case["input"]
            n = samplesize_proportions_2indep_onetail(diff=inp["p1"] - inp["p2"], prop2=inp["p2"], power=inp["targetPower"], ratio=1, alpha=1 - inp["confidenceLevel"], value=0, alternative="two-sided")
            expect(near(n, exp["groupSizeExact"], 1e-7) and math.ceil(n) == exp["groupSize"], f"{case['id']} sample size {n}")
        elif case["type"] == "power":
            inp, zc = case["input"], stats.norm.isf((1 - case["input"]["confidenceLevel"]) / 2)
            if inp["kind"] == "ratio":
                p0, n, r = inp["baselineRate"], inp["groupSize"], inp["assumedRatio"]
                se = math.sqrt((1 - r * p0) / (n * r * p0) + (1 - p0) / (n * p0))
                lo, hi = math.log(inp["band"]["lower"]), math.log(inp["band"]["upper"])
                val = stats.norm.cdf((hi - math.log(r)) / se - zc) + stats.norm.cdf((math.log(r) - lo) / se - zc) - 1
                expect(near(val, exp["passProbability"], 1e-9), f"{case['id']} pass probability")
            elif inp["kind"] == "difference":
                p0, n, d = inp["baselineRate"], inp["groupSize"], inp["assumedDifference"]
                se = math.sqrt((p0 + d) * (1 - p0 - d) / n + p0 * (1 - p0) / n)
                val = max(0.0, stats.norm.cdf((inp["band"]["upper"] - d) / se - zc) + stats.norm.cdf((d - inp["band"]["lower"]) / se - zc) - 1)
                expect(near(val, exp["passProbability"], 1e-9), f"{case['id']} pass probability")
            else:
                p, n, t = inp["assumedValue"], inp["n"], inp["band"]["lower"]
                val = stats.norm.sf((t + zc * math.sqrt(t * (1 - t) / n) - p) / math.sqrt(p * (1 - p) / n))
                expect(near(val, exp["passProbability"], 1e-9), f"{case['id']} pass probability")
        elif case["type"] == "fisher":
            for t, p in zip(case["input"]["tables"], exp["pValues"]):
                s, k = t["subject"], t["comparator"]
                q = stats.fisher_exact([[s["x"], s["n"] - s["x"]], [k["x"], k["n"] - k["x"]]]).pvalue
                expect(near(q, p, 1e-9), f"{case['id']} fisher {t} scipy {q} vs {p}")
        elif case["type"] == "ll144":
            for row in exp["categories"]:
                lo, hi = sm_wilson(row["selected"], row["n"], 0.05)
                expect(near(lo, row["selectionRateInterval"]["lower"], 1e-6) and near(hi, row["selectionRateInterval"]["upper"], 1e-6), f"{case['id']} {row['category']} wilson")
                if row["impactRatioInterval"]:
                    ref = next(r for r in exp["categories"] if r["category"] == exp["referenceCategory"])
                    lo, hi = confint_proportions_2indep(row["selected"], row["n"], ref["selected"], ref["n"], compare="ratio", method="log")
                    expect(near(float(lo), row["impactRatioInterval"]["lower"], 1e-6) and near(float(hi), row["impactRatioInterval"]["upper"], 1e-6), f"{case['id']} {row['category']} katz")
    return checks, problems


def simulate(fixture, sims=20000):
    import numpy as np

    rng = np.random.default_rng(20261105)
    z = zcrit(0.95)
    report = []
    # Power formulas against the actual decision rules.
    for case in fixture["cases"]:
        if case["type"] != "power" or case["input"]["kind"] == "equality_test":
            continue
        inp = case["input"]
        if inp["kind"] == "proportion":
            x = rng.binomial(inp["n"], inp["assumedValue"], sims)
            rate = np.mean([wilson(int(v), inp["n"], z)[0] >= inp["band"]["lower"] for v in x])
        else:
            n, p0 = inp["groupSize"], inp["baselineRate"]
            ps = p0 * inp["assumedRatio"] if inp["kind"] == "ratio" else p0 + inp["assumedDifference"]
            xs, xc = rng.binomial(n, ps, sims), rng.binomial(n, p0, sims)
            hits = 0
            for a, b in zip(xs, xc):
                a, b = int(a), int(b)
                if inp["kind"] == "ratio":
                    lo, hi = katz(a, n, b, n, z)
                else:
                    lo, hi = newcombe(a, n, b, n, z)
                hits += inp["band"]["lower"] <= lo and hi <= inp["band"]["upper"]
            rate = hits / sims
        report.append(f"{case['id']}: formula pass probability {case['expected']['passProbability']:.4f}, simulated decision rule {rate:.4f}")
    # Coverage of the derived intervals.
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

    def macro_draw():
        cells = rng.multinomial(600, conf.ravel()).reshape(3, 3)
        return ([(int(cells[i, i]), int(cells[i].sum() + cells[:, i].sum() - cells[i, i])) for i in range(3)],)
    coverage("macro F1 Bonferroni Jaccard-Wilson, n=600, 3 classes", macro_draw, true_macro, lambda classes: macro_f1_interval(classes, z))
    rates, n_group = (0.50, 0.45, 0.40), 300
    z_bon = zcrit(1 - 0.05 / 3)

    def worst_gap(*xs):
        pairs = [(i, j) for i in range(3) for j in range(i + 1, 3)]
        lows = [max(0.0, lo, -hi) for lo, hi in (newcombe(int(xs[i]), n_group, int(xs[j]), n_group, z_bon) for i, j in pairs)]
        highs = [max(abs(lo), abs(hi)) for lo, hi in (newcombe(int(xs[i]), n_group, int(xs[j]), n_group, z) for i, j in pairs)]
        return max(lows), max(highs)
    coverage("headline worst-member bounds, 3 groups (0.50/0.45/0.40, n=300)", lambda: tuple(rng.binomial(n_group, r) for r in rates), 0.10, worst_gap)
    return report


def markdown(fixture):
    def fmt(v):
        return "n/a" if v is None else f"{v:.4f}"

    lines = ["| Case | Criterion / member | Estimate | 95% interval | Decision p | Outcome |", "|---|---|---|---|---|---|"]
    for case in fixture["cases"]:
        exp = case["expected"]
        if case["type"] == "plan":
            for crit in exp["criteria"]:
                for m in crit["members"]:
                    iv = m["interval"]
                    lines.append(f"| {case['id']} | {crit['id']} / {m['memberId']} | {fmt(m['estimate'])} | {'n/a' if iv is None else '[' + fmt(iv['lower']) + ', ' + fmt(iv['upper']) + ']'} | {m['pValue']:.4g} | {m['status']}, {m['direction']} |")
                h = crit["headline"]
                hv = "" if h is None else f" headline {fmt(h['estimate'])} [{fmt(h['interval']['lower'])}, {fmt(h['interval']['upper'])}]"
                lines.append(f"| {case['id']} | **{crit['id']}**{hv} | | | P={crit['pValue']:.4g}, adj={crit['adjustedPValue']:.4g} | **{crit['outcome']}** ({', '.join(crit['reasons']) or '-'}) |")
        elif case["type"] == "multiplicity":
            lines.append(f"| {case['id']} | {case['input']['method']} {case['input']['pValues']} | | | adjusted {[round(a, 4) for a in exp['adjustedPValues']]} | rejected {exp['rejected']} |")
        elif case["type"] == "power":
            lines.append(f"| {case['id']} | power: {json.dumps(case['input'])} | | | | {json.dumps(exp)} |")
        elif case["type"] == "fisher":
            for t, p in zip(case["input"]["tables"], exp["pValues"]):
                lines.append(f"| {case['id']} | Fisher {t['subject']['x']}/{t['subject']['n']} vs {t['comparator']['x']}/{t['comparator']['n']} | | | {p:.6g} | |")
        else:
            for row in exp["categories"]:
                iv = row["impactRatioInterval"]
                lines.append(f"| {case['id']} | {row['category']} | rate {fmt(row['selectionRate'])}, IR {fmt(row['impactRatio'])} | {'reference' if iv is None else '[' + fmt(iv['lower']) + ', ' + fmt(iv['upper']) + ']'} | | share {row['shareOfData']:.4f}{' (2% rule)' if row['eligibleForTwoPercentExclusion'] else ''} |")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--fixture", default=str(FIXTURE))
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--cross-check", action="store_true")
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--markdown", action="store_true")
    args = parser.parse_args()
    built = build()
    path = Path(args.fixture)
    if args.write:
        path.write_text(json.dumps(built, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {path} ({len(built['cases'])} cases)")
    status = 0
    if args.check:
        stored = json.loads(path.read_text(encoding="utf-8"))
        problems = diff(built, stored)
        print(f"reference recomputation: {len(problems)} differences across {len(stored['cases'])} cases")
        for p in problems[:50]:
            print("  " + p)
        status |= bool(problems)
    if args.cross_check or args.simulate:
        try:
            import numpy  # noqa: F401
            import scipy  # noqa: F401
            import statsmodels  # noqa: F401
        except ImportError:
            print("--cross-check/--simulate need numpy, scipy and statsmodels: install them in a throwaway virtualenv outside the repository (never as project dependencies).")
            return 2
    if args.cross_check:
        checks, problems = cross_check(json.loads(path.read_text(encoding="utf-8")) if path.exists() else built)
        print(f"independent scipy/statsmodels cross-check: {checks} checks, {len(problems)} problems")
        for p in problems:
            print("  " + p)
        status |= bool(problems)
    if args.simulate:
        for line in simulate(built):
            print(line)
    if args.markdown:
        print(markdown(built))
    return status


if __name__ == "__main__":
    sys.exit(main())
