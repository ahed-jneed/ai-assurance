"""Recomputation and decisions for GenAI criteria (design section 8).

Intervals, closed-form decision p-values, Bonferroni and Benjamini-Hochberg
come from the statistics core (`engine/statistics.py`, statistics 1.0.0);
this module adds what GenAI evidence needs on top: epoch reduction, the
clustered standard error (CR1, as Inspect implements it), Wilson on the
effective sample size, attack members per `groupBy`, pass^k, paired
differences and the run-level gates. The interval decides, never the point
estimate.
"""
from __future__ import annotations

import math
from math import comb

from .. import statistics as core
from .errors import fail
from .formats import common, deepeval, garak, lm_eval, promptfoo, pyrit

VALUE_RULES = {
    "inspect_eval": "inspect.value_to_float", "inspect_json": "inspect.value_to_float", "lm_eval_samples": "lm_eval.metric_value",
    "deepeval_test_run": "deepeval.metric_score", "ragas_results": "ragas.metric_value",
}
VARIANT_FORMATS_WITH_KEY = ("inspect_eval", "inspect_json", "deepeval_test_run", "ragas_results")


# ---------------------------------------------------------------- outcomes per criterion


def primary_for(run, plan, criterion):
    return criterion.get("primaryScore") or plan.get("primaryScore") or run.primary_default


def item_outcomes(run, plan, criterion):
    """(item, status, reason, value) for every item under the criterion's primary score and success rule."""
    primary = primary_for(run, plan, criterion)
    rule = criterion.get("successRule") or plan["successRule"]
    out = []
    for item, ctx in zip(run.items, run.contexts):
        fmt = run.format
        if fmt in VALUE_RULES:
            if fmt in ("inspect_eval", "inspect_json") and plan["scorePolicy"] == "as_edited":
                ctx = dict(ctx, invalidated=ctx.get("invalidatedPostRun", False))
            status, reason, value, _ = common.value_outcome(item, ctx, primary, rule, VALUE_RULES[fmt])
        elif fmt == "promptfoo_results":
            status, reason, value, _ = promptfoo.outcome(item, ctx, primary or "overall", rule)
        elif fmt == "garak_report":
            status, reason, value, _ = garak.outcome(item, ctx, criterion.get("primaryScore") or plan.get("primaryScore"), rule)
        elif fmt == "pyrit_export":
            status, reason, value, _ = pyrit.outcome(item, ctx, criterion.get("primaryScore") or plan.get("primaryScore"), rule)
        else:
            raise ValueError(fmt)
        out.append((item, status, reason, value))
    return out


def reduce(values, reducer, metric):
    if not values:
        return None
    if reducer == "mean":
        return math.fsum(values) / len(values)
    if reducer == "any":
        return 1.0 if any(v >= 1.0 for v in values) else 0.0
    if reducer == "all":
        return 1.0 if all(v >= 1.0 for v in values) else 0.0
    ones = sum(1 for v in values if v >= 1.0)
    if metric == "attack_success":
        return 1.0 if ones * 2 >= len(values) else 0.0
    return 1.0 if ones * 2 > len(values) else 0.0


def groups_of(outcomes, reducer, item_filter=None):
    """Group by groupKey; the reducer runs over scored epochs. Returns ordered {groupKey: group}."""
    groups = {}
    for item, status, reason, value in outcomes:
        if item_filter is not None and not item_filter(item):
            continue
        g = groups.setdefault(item["groupKey"], {"values": [], "items": [], "statuses": [], "cluster": None})
        g["items"].append(item)
        g["statuses"].append(status)
        if status == "scored":
            g["values"].append(value)
        if g["cluster"] is None and item["clusterId"] is not None:
            g["cluster"] = item["clusterId"]
    for g in groups.values():
        metric = g["items"][0]["outcome"]["metric"]
        g["y"] = reduce(g["values"], reducer, metric)
        g["unstable"] = len(set(g["values"])) > 1
        g["withinVariance"] = _variance(g["values"]) if len(g["values"]) > 1 else 0.0
    return groups


def _variance(values):
    mean = math.fsum(values) / len(values)
    return math.fsum((v - mean) ** 2 for v in values) / len(values)


# ---------------------------------------------------------------- standard errors and intervals


def se_iid(values):
    n = len(values)
    if n < 2:
        return None
    mean = math.fsum(values) / n
    return math.sqrt(math.fsum((v - mean) ** 2 for v in values) / (n * (n - 1)))


def se_clustered(values, clusters):
    """CR1: (1/n) * sqrt(C/(C-1) * sum_c (sum_{i in c} (y_i - mean))^2), Miller (2024) eq. 4."""
    n = len(values)
    mean = math.fsum(values) / n
    sums = {}
    for v, c in zip(values, clusters):
        sums[c] = sums.get(c, 0.0) + (v - mean)
    count = len(sums)
    if count < 2:
        return None
    return math.sqrt(count / (count - 1) * math.fsum(s * s for s in sums.values())) / n


def effective_n(values, clusters=None):
    """n_eff = min(n, p(1-p)/SE^2); the worst-case design effect when the variance is degenerate (section 8.3)."""
    n = len(values)
    mean = math.fsum(values) / n
    se = se_clustered(values, clusters) if clusters is not None else se_iid(values)
    if se is None or se == 0.0 or mean in (0.0, 1.0):
        if clusters is None:
            return float(n), se
        sizes = {}
        for c in clusters:
            sizes[c] = sizes.get(c, 0) + 1
        return n * n / math.fsum(m * m for m in sizes.values()), se
    return min(float(n), mean * (1.0 - mean) / (se * se)), se


def proportion_member(member_id, metric, band, values, clusters, level, mins, *, subject=None, descriptive=False, extra_reasons=(), size_floor=None, size_reason=None):
    """A Wilson member on n (binary, unclustered) or on the effective sample size."""
    n = len(values)
    reasons = list(extra_reasons)
    counts = {"n": n}
    if n == 0:
        out = core.member(metric, band, None, "wilson", None, status="undefined", reasons=reasons + ["no_scored_groups"], level=level, descriptive=descriptive)
        out["memberId"] = member_id
        out["subject"] = subject
        out["counts"] = counts
        return out
    mean = math.fsum(values) / n
    binary = all(v in (0.0, 1.0) for v in values)
    status = "evaluated"
    seiid = se_iid(values)
    secl = None
    if clusters is not None:
        if any(c is None for c in clusters):
            status = "insufficient_support"
            reasons.append("missing_cluster_id")
            clusters = None
        else:
            distinct = len(set(clusters))
            counts["clusters"] = distinct
            secl = se_clustered(values, clusters)
            if distinct < mins["clusters"]:
                status = "insufficient_support"
                reasons.append("below_minimum_clusters")
    if size_floor is not None and n < size_floor:
        status = "insufficient_support"
        reasons.append(size_reason)
    if binary and clusters is None:
        x = sum(1 for v in values if v == 1.0)
        counts["x"] = x
        n_eff, method = float(n), "wilson"
        ci_at = (lambda z, x=x, n=n: core.wilson(x, n, z))
        closed = (lambda d, x=x, n=n: core.wilson_zstar(x, n, band, d))
    else:
        n_eff, _ = effective_n(values, clusters)
        method = "wilson_effective_n"
        ci_at = (lambda z, m=mean, k=n_eff: core.wilson(m * k, k, z))
        closed = (lambda d, m=mean, k=n_eff: core.wilson_zstar(m * k, k, band, d))
    counts["nEff"] = n_eff
    out = core.member(metric, band, mean, method, ci_at, None if descriptive else closed, counts=counts, status=status, reasons=reasons, level=level, descriptive=descriptive)
    out["memberId"] = member_id
    out["subject"] = subject
    out["seIid"] = seiid
    out["seCluster"] = secl
    out["nEff"] = n_eff
    if clusters is not None and secl is not None and seiid:
        out["designEffect"] = (secl / seiid) ** 2
    return out


# ---------------------------------------------------------------- criteria


def select_runs(runs, sel):
    if not sel:
        return list(runs)
    out = []
    for run in runs:
        if "runKey" in sel and run.run_key != sel["runKey"]:
            continue
        if "format" in sel and run.format != sel["format"]:
            continue
        if "task" in sel and not (run.items and all(i["task"]["name"] == sel["task"] for i in run.items)):
            continue
        out.append(run)
    return out


def _run_gates(run, outcomes, plan, reasons):
    total = len(outcomes)
    if total:
        unscored = sum(1 for _, s, _, _ in outcomes if s == "unscored")
        errors = sum(1 for _, s, _, _ in outcomes if s == "error")
        if unscored / total > plan["maxUnscoredFraction"] + core.EPS:
            reasons.append("unscored_fraction_exceeded")
        if errors / total > plan["maxErrorFraction"] + core.EPS:
            reasons.append("error_fraction_exceeded")
    if run.incomplete:
        reasons.append("run_incomplete")


def _feeding_scores(run, plan, criterion):
    """Score names (and kinds) that feed the criterion's outcomes, composites expanded."""
    primary = primary_for(run, plan, criterion)
    names = set()
    if run.format == "promptfoo_results" and (primary or "overall") == "overall":
        # The composite takes the most restrictive kind of its parts; the gate checks every part (section 7.1).
        names = set(run.score_kinds) - {"overall"}
    elif run.format == "garak_report" and not (criterion.get("primaryScore") or plan.get("primaryScore")):
        names = set(run.score_kinds)
    elif run.format == "pyrit_export" and not (criterion.get("primaryScore") or plan.get("primaryScore")):
        names = set(run.score_kinds)
    elif primary:
        names = {primary}
    return {n: sorted(run.score_kinds.get(n, ())) for n in sorted(names)}


def _cluster_key_set(plan, run):
    key = plan.get("clusterKey")
    if isinstance(key, dict):
        tasks = {i["task"]["name"] for i in run.items}
        return any(t in key for t in tasks)
    return key is not None


def mean_criterion(criterion, runs, plan, level):
    members, reasons, sizes, kinds = [], [], [], {}
    reducer = criterion.get("epochReducer") or plan.get("epochReducer") or "mean"
    for run in runs:
        outcomes = item_outcomes(run, plan, criterion)
        groups = groups_of(outcomes, reducer)
        scored = [g for g in groups.values() if g["y"] is not None]
        values = [g["y"] for g in scored]
        clusters = [g["cluster"] for g in scored] if _cluster_key_set(plan, run) else None
        run_reasons = []
        _run_gates(run, outcomes, plan, run_reasons)
        if run.format == "lm_eval_samples":
            primary = primary_for(run, plan, criterion)
            agg = lm_eval.aggregation_of(run, primary) if primary else None
            if agg != "mean" or (primary or "").split(",", 1)[0] == "acc_all":
                run_reasons.append("unsupported_aggregation")
        member = proportion_member(primary_for(run, plan, criterion) or "primary", criterion["metric"], criterion["band"], values, clusters, level, plan["minimums"],
                                   subject=run.run_key, extra_reasons=[], size_floor=plan["minimums"]["sampleSize"], size_reason="below_minimum_sample_size")
        member["memberId"] = f"{run.run_key}|{member['memberId']}"
        member["unstableGroups"] = sum(1 for g in groups.values() if g["unstable"])
        member["meanWithinGroupVariance"] = (math.fsum(g["withinVariance"] for g in groups.values()) / len(groups)) if groups else None
        members.append(member)
        sizes.append(len(values))
        reasons.extend(r for r in run_reasons if r not in reasons)
        kinds[run.run_key] = _feeding_scores(run, plan, criterion)
    return members, reasons, (min(sizes) if sizes else 0), kinds


def _member_key(item, group_by):
    if group_by == "technique":
        return [item["technique"]] if item["technique"] is not None else []
    if group_by == "variant":
        return [item["variant"]] if item["variant"] is not None else []
    if group_by == "technique_variant":
        return [f"{item['technique']}/{item['variant']}"] if item["technique"] is not None and item["variant"] is not None else []
    if group_by == "category":
        return list(item["categories"])
    return ["all"]


def attack_criterion(criterion, runs, plan, level):
    group_by = criterion["groupBy"]
    reducer = criterion.get("epochReducer") or plan.get("epochReducer") or "any"
    members, reasons, total, kinds = [], [], 0, {}
    mins = plan["minimums"]
    for run in runs:
        if group_by in ("variant", "technique_variant") and (run.format == "garak_report" or (run.format in VARIANT_FORMATS_WITH_KEY and not plan.get("variantKey"))):
            fail("plan_invalid", f"groupBy {group_by} needs a variant, which {run.format} does not define here")
        outcomes = item_outcomes(run, plan, criterion)
        groups = groups_of(outcomes, reducer, lambda i: i["itemType"] == "attack")
        run_reasons = []
        _run_gates(run, [o for o in outcomes if o[0]["itemType"] == "attack"], plan, run_reasons)
        by_member, missing = {}, 0
        clustered = _cluster_key_set(plan, run)
        for g in groups.values():
            if g["y"] is None:
                continue
            keys = _member_key(g["items"][0], group_by)
            if not keys:
                missing += 1
                continue
            for key in keys:
                by_member.setdefault(key, []).append(g)
            total += 1
        if missing:
            run_reasons.append("member_key_missing")
        for key in sorted(by_member, key=core.code_point_key):
            gs = by_member[key]
            values = [g["y"] for g in gs]
            clusters = [g["cluster"] for g in gs] if clustered else None
            member = proportion_member(key, "attack_success_rate", criterion["band"], values, clusters, level, mins, subject=run.run_key,
                                       descriptive=group_by == "none", size_floor=mins["memberSize"], size_reason="below_minimum_member_size")
            member["memberId"] = f"{run.run_key}|{key}" if len(runs) > 1 else key
            members.append(member)
        reasons.extend(r for r in run_reasons if r not in reasons)
        kinds[run.run_key] = _feeding_scores(run, plan, criterion)
    return members, reasons, total, kinds


def pass_k_criterion(criterion, runs, plan, level):
    members, reasons, kinds, sizes = [], [], {}, []
    for run in runs:
        outcomes = item_outcomes(run, plan, criterion)
        tasks = {}
        for item, status, _, value in outcomes:
            t = tasks.setdefault(item["groupKey"], {"n": 0, "c": 0, "cluster": item["clusterId"]})
            if status == "scored":
                t["n"] += 1
                t["c"] += 1 if value >= 1.0 else 0
        run_reasons = []
        _run_gates(run, outcomes, plan, run_reasons)
        clustered = _cluster_key_set(plan, run)
        for k in criterion["k"]:
            eligible = [t for t in tasks.values() if t["n"] >= k]
            excluded = len(tasks) - len(eligible)
            values = [comb(t["c"], k) / comb(t["n"], k) for t in eligible]
            at_k = [1.0 - comb(t["n"] - t["c"], k) / comb(t["n"], k) for t in eligible]
            member = proportion_member(f"pass^{k}", "pass_hat_k", criterion["band"], values, [t["cluster"] for t in eligible] if clustered else None, level, plan["minimums"],
                                       subject=run.run_key, extra_reasons=["below_k_trials"] if excluded else [], size_floor=plan["minimums"]["sampleSize"], size_reason="below_minimum_sample_size")
            member["memberId"] = f"{run.run_key}|pass^{k}" if len(runs) > 1 else f"pass^{k}"
            member["k"] = k
            member["tasksExcluded"] = excluded
            member["passAtK"] = (math.fsum(at_k) / len(at_k)) if at_k else None
            members.append(member)
            sizes.append(len(values))
        reasons.extend(r for r in run_reasons if r not in reasons)
        kinds[run.run_key] = _feeding_scores(run, plan, criterion)
    return members, reasons, (min(sizes) if sizes else 0), kinds


def _identities(groups):
    out, inconsistent = {}, 0
    for key, g in groups.items():
        triples = {(i["groupKey"], i["promptSha256"], i["targetSha256"]) for i in g["items"]}
        if len(triples) != 1:
            inconsistent += 1
            continue
        out[triples.pop()] = g
    return out, inconsistent


def paired_criterion(criterion, runs, plan, level, warnings):
    candidates = select_runs(runs, criterion["candidate"])
    baselines = select_runs(runs, criterion["baseline"])
    if len(candidates) != 1 or len(baselines) != 1:
        fail("plan_invalid", f"criterion {criterion['id']}: candidate and baseline must each select exactly one run")
    cand, base = candidates[0], baselines[0]
    reducer = criterion.get("epochReducer") or plan.get("epochReducer") or "mean"
    reasons = []
    co = item_outcomes(cand, plan, criterion)
    bo = item_outcomes(base, plan, criterion)
    _run_gates(cand, co, plan, reasons)
    _run_gates(base, bo, plan, reasons)
    cg, ci = _identities(groups_of(co, reducer))
    bg, bi = _identities(groups_of(bo, reducer))
    if ci or bi:
        warnings.add("inconsistent_group_identity", count=ci + bi)
        reasons.append("inconsistent_group_identity")
    shared = sorted(set(cg) & set(bg), key=lambda t: tuple((0, "") if v is None else (1, v) for v in t))
    pairs = [(cg[t]["y"], bg[t]["y"], cg[t]["cluster"]) for t in shared if cg[t]["y"] is not None and bg[t]["y"] is not None]
    diffs = [a - b for a, b, _ in pairs]
    n = len(diffs)
    band = criterion["band"]
    counts = {"n": n, "unmatchedCandidate": len(set(cg) - set(bg)), "unmatchedBaseline": len(set(bg) - set(cg)), "sameFingerprint": cand.meta["datasetFingerprint"] == base.meta["datasetFingerprint"]}
    member_reasons = []
    status = "evaluated"
    if n < 2:
        out = core.member("paired_difference", band, None, "normal_paired", None, counts=counts, status="undefined", reasons=["no_scored_groups"], level=level)
        return [out], reasons, n, {cand.run_key: _feeding_scores(cand, plan, criterion), base.run_key: _feeding_scores(base, plan, criterion)}
    dbar = math.fsum(diffs) / n
    clustered = _cluster_key_set(plan, cand)
    se = se_iid(diffs)
    if clustered:
        clusters = [c for _, _, c in pairs]
        if any(c is None for c in clusters):
            status, member_reasons = "insufficient_support", ["missing_cluster_id"]
        else:
            counts["clusters"] = len(set(clusters))
            se = se_clustered(diffs, clusters)
            if counts["clusters"] < plan["minimums"]["clusters"]:
                status, member_reasons = "insufficient_support", ["below_minimum_clusters"]
    if n < plan["minimums"]["sampleSize"]:
        status = "insufficient_support"
        member_reasons.append("below_minimum_sample_size")
    if not se:
        out = core.member("paired_difference", band, dbar, "normal_paired", None, counts=counts, status="undefined", reasons=member_reasons + ["degenerate_interval"], level=level)
    else:
        out = core.member("paired_difference", band, dbar, "normal_paired", lambda z, d=dbar, s=se: (max(-1.0, d - z * s), min(1.0, d + z * s)),
                          lambda direction, d=dbar, s=se: core.normal_zstar(d, s, band, direction), counts=counts, status=status, reasons=member_reasons, level=level)
    a = [p[0] for p in pairs]
    b = [p[1] for p in pairs]
    sea, seb = se_iid(a), se_iid(b)
    out["sePaired"] = se
    out["seUnpaired"] = math.sqrt(sea * sea + seb * seb) if sea is not None and seb is not None else None
    out["correlation"] = _corr(a, b)
    out["subject"] = cand.run_key
    out["comparator"] = base.run_key
    return [out], reasons, n, {cand.run_key: _feeding_scores(cand, plan, criterion), base.run_key: _feeding_scores(base, plan, criterion)}


def _corr(a, b):
    n = len(a)
    if n < 2:
        return None
    ma, mb = math.fsum(a) / n, math.fsum(b) / n
    sab = math.fsum((x - ma) * (y - mb) for x, y in zip(a, b))
    saa = math.fsum((x - ma) ** 2 for x in a)
    sbb = math.fsum((y - mb) ** 2 for y in b)
    if saa == 0.0 or sbb == 0.0:
        return None
    return sab / math.sqrt(saa * sbb)


def decide(criterion, members, reasons, sample_size, level, mins, gate_size=True):
    """The criterion decision of statistics 1.0.0 section 4.3: intersection-union pass, Bonferroni fail."""
    alpha = 1.0 - level
    reasons = list(reasons)
    descriptive = criterion["kind"] == "genai_attack_success" and criterion.get("groupBy") == "none"
    gated = False
    if gate_size and sample_size < mins["sampleSize"]:
        reasons.insert(0, "below_minimum_sample_size")
        gated = True
    inconclusive = {"unscored_fraction_exceeded", "error_fraction_exceeded", "run_incomplete", "member_key_missing", "unsupported_aggregation", "inconsistent_group_identity"}
    if inconclusive & set(reasons):
        gated = True
    if descriptive:
        reasons.append("descriptive_only")
        gated = True
    pool = list(members)
    evaluable = [m for m in pool if m["status"] == "evaluated"]
    fails = [m for m in evaluable if m["direction"] == "fail"]
    deciding = None
    if gated or not evaluable:
        direction, p = "none", 1.0
    elif fails:
        direction = "fail"
        deciding = min(fails, key=lambda m: (m["pValue"], core.code_point_key(m["memberId"])))
        p = min(1.0, len(evaluable) * deciding["pValue"])
        if p > alpha + core.EPS:
            reasons.append("within_criterion_multiplicity" if deciding["pValue"] <= alpha + core.EPS else "interval_straddles_band")
    else:
        complete = bool(pool) and all(m["status"] == "evaluated" and m["direction"] == "pass" for m in pool)
        direction = "pass" if any(m["direction"] == "pass" for m in evaluable) else "none"
        if complete:
            deciding = min(pool, key=lambda m: (-m["pValue"], core.code_point_key(m["memberId"])))
            p = deciding["pValue"]
            if p > alpha + core.EPS:
                reasons.append("interval_straddles_band")
        else:
            p = 1.0
    for m in pool:
        for r in m["reasons"]:
            if r not in reasons:
                reasons.append(r)
    return {"statisticsVersion": core.SPEC_VERSION, "confidenceLevel": level, "role": criterion["role"], "kind": criterion["kind"], "direction": direction, "pValue": p,
            "adjustedPValue": None, "adjustment": None, "familySize": None,
            "unadjustedOutcome": direction if direction in ("pass", "fail") and p <= alpha + core.EPS else "inconclusive",
            "decidingMemberId": deciding["memberId"] if deciding else None, "sampleSize": sample_size, "reasons": reasons}


def headline(members, level):
    """Worst member (largest estimate): fail-side bound at the Bonferroni level, pass-side bound at the nominal level (section 4.7)."""
    evaluable = [m for m in members if m.get("_ci_at")]
    if not evaluable:
        return None
    alpha = 1.0 - level
    z_nom, z_bon = core.zcrit(level), core.zcrit(1.0 - alpha / len(evaluable))
    top = max(m["estimate"] for m in evaluable)
    worst = min((m for m in evaluable if m["estimate"] == top), key=lambda m: core.code_point_key(m["memberId"]))
    complete = all(m["status"] == "evaluated" for m in members)
    lower = max(m["_ci_at"](z_bon)[0] for m in evaluable)
    upper = max(m["_ci_at"](z_nom)[1] for m in evaluable) if complete else 1.0
    return {"memberId": worst["memberId"], "estimate": worst["estimate"], "interval": {"lower": lower, "upper": upper, "level": level, "method": "worst_member_bounds"}}


def clean_member(m):
    return {k: v for k, v in m.items() if not k.startswith("_")}


def evaluate(plan, runs, marking_runs, warnings):
    level = plan["confidenceLevel"]
    alpha = 1.0 - level
    mins = plan["minimums"]
    results = []
    for criterion in plan["criteria"]:
        kind = criterion["kind"]
        selected = []
        if kind == "genai_marking":
            from .formats import marking
            members, reasons, size = marking.criterion_members(criterion, marking_runs, plan, level)
            kinds = {}
        else:
            selected = select_runs(runs, criterion.get("select"))
            if kind != "genai_paired_difference" and not selected:
                fail("plan_invalid", f"criterion {criterion['id']} selects no run")
            primary_named = criterion.get("primaryScore") or plan.get("primaryScore")
            if primary_named and kind != "genai_paired_difference" and not any(primary_named in r.score_kinds for r in selected):
                fail("plan_invalid", f"criterion {criterion['id']}: no selected run has the score {primary_named!r}")
            if kind in ("genai_mean", "genai_pass_k") and any(r.format in ("deepeval_test_run", "ragas_results") for r in selected) and not primary_named:
                fail("plan_invalid", f"criterion {criterion['id']}: DeepEval and Ragas runs need a primaryScore")
            if kind == "genai_mean":
                members, reasons, size, kinds = mean_criterion(criterion, selected, plan, level)
            elif kind == "genai_attack_success":
                members, reasons, size, kinds = attack_criterion(criterion, selected, plan, level)
            elif kind == "genai_pass_k":
                members, reasons, size, kinds = pass_k_criterion(criterion, selected, plan, level)
            else:
                members, reasons, size, kinds = paired_criterion(criterion, runs, plan, level, warnings)
        decision = decide(criterion, members, reasons, size, level, mins)
        head = headline(members, level) if kind == "genai_attack_success" else None
        flags = judge_flags(kinds, runs)
        results.append({"id": criterion["id"], "kind": kind, "outcome": None, "headline": head, "members": [clean_member(m) for m in members],
                        "decision": decision, "runKeys": sorted(kinds) if kinds else [r.run_key for r in selected], "scoreKinds": kinds, "flags": flags})
    for role, method, adjust in (("confirmatory", "bonferroni", core.bonferroni), ("exploratory", "benjamini_hochberg", core.benjamini_hochberg)):
        family = [r for r in results if r["decision"]["role"] == role]
        for r, adjusted in zip(family, adjust([r["decision"]["pValue"] for r in family])):
            d = r["decision"]
            d["adjustedPValue"], d["adjustment"], d["familySize"] = adjusted, method, len(family)
            r["outcome"] = d["direction"] if d["direction"] in ("pass", "fail") and adjusted <= alpha + core.EPS else "inconclusive"
            if d["unadjustedOutcome"] != "inconclusive" and r["outcome"] == "inconclusive":
                d["reasons"].append("multiplicity_adjustment")
    confirmatory = [r["outcome"] for r in results if r["decision"]["role"] == "confirmatory"]
    return results, core.aggregate(confirmatory), [r["id"] for r in results if r["decision"]["role"] == "exploratory" and r["outcome"] == "fail"]


def judge_flags(kinds, runs):
    """Gate flags the workspace enforces: a model-graded or unknown score feeds the criterion and its judge is not validated."""
    flags = []
    by_key = {r.run_key: r for r in runs}
    for run_key, scores in kinds.items():
        run = by_key.get(run_key)
        if run is None:
            continue
        validated = {j["ref"]: bool(j.get("_validated")) for j in run.meta["judges"]}
        declared_det = run.extra.get("declaredDeterministic", set())
        for name, score_kinds in scores.items():
            refs = {s["scorer"]["judgeRef"] for i in run.items for s in i["scores"] if s["name"] == name and s["scorer"]["kind"] == "model_graded"}
            if "model_graded" in score_kinds:
                if not refs or None in refs:
                    flags.append({"flag": "judge_not_validated", "runKey": run_key, "score": name, "judgeRef": None, "reasons": ["judge_unknown"]})
                for ref in sorted(r for r in refs if r):
                    if validated.get(ref):
                        continue
                    entry = next((j for j in run.meta["judges"] if j["ref"] == ref), None)
                    reasons = list((entry or {}).get("_reasons") or ["no_validation_labels"])
                    flags.append({"flag": "judge_not_validated", "runKey": run_key, "score": name, "judgeRef": ref, "reasons": reasons})
            if "unknown" in score_kinds:
                if name in declared_det:
                    flags.append({"flag": "scorer_kind_declared", "runKey": run_key, "score": name, "judgeRef": None, "reasons": ["acknowledgement_required"]})
                else:
                    flags.append({"flag": "judge_not_validated", "runKey": run_key, "score": name, "judgeRef": None, "reasons": ["scorer_kind_unknown"]})
    return flags


# ---------------------------------------------------------------- reconciliation


def reconcile(run, plan):
    tol = plan["reconciliationTolerance"]
    rows = []
    if run.format in ("inspect_eval", "inspect_json"):
        reducer = run.extra.get("evalReducer") or "mean"
        by_score = {}
        for item, ctx in zip(run.items, run.contexts):
            for name, value in (ctx.get("editedValues") or {}).items():
                by_score.setdefault(name, {}).setdefault(item["groupKey"], []).append(value)
        for agg in run.tool_aggregates:
            groups = by_score.get(agg["score"], {})
            values = [reduce([v for v in vs if v is not None], reducer if reducer in ("mean", "any", "all", "majority") else "mean", "correct") for vs in groups.values()]
            values = [v for v in values if v is not None]
            ours = None
            comparable = reducer in ("mean",)
            if agg["metric"] in ("accuracy", "mean") and values:
                ours = math.fsum(values) / len(values)
            elif agg["metric"] == "stderr" and len(values) >= 2:
                ours = se_iid(values)
            elif agg["metric"] == "scored_samples":
                ours = len(values)
            rows.append(_row(f"{agg['score']}.{agg['metric']}", agg["value"], ours, tol, comparable))
    elif run.format == "lm_eval_samples":
        for agg in run.tool_aggregates:
            name = agg["score"]
            metric = name.split(",", 1)[0]
            values = [s["value"] for i in run.items for s in i["scores"] if s["name"] == name]
            comparable = lm_eval.aggregation_of(run, name) == "mean" and metric != "acc_all" and None not in values and bool(values)
            if agg["metric"] == "stderr" and agg.get("raw") == "N/A":
                comparable = False
            ours = None
            if comparable:
                ours = math.fsum(values) / len(values) if agg["metric"] == "value" else se_iid(values)
            rows.append(_row(f"{name}.{agg['metric']}", agg["value"], ours, tol, comparable))
    else:
        for agg in run.tool_aggregates:
            label = agg["metric"] + (f"[{agg['group']}]" if agg.get("group") else "")
            if agg.get("informationOnly"):
                rows.append({"metric": label, "tool": agg["tool"], "ours": None, "absDiff": None, "status": "information"})
            else:
                rows.append(_row(label, agg["tool"], agg.get("ours"), tol, agg.get("tool") is not None))
    return rows


def _row(metric, tool, ours, tol, comparable=True):
    if not comparable or tool is None or ours is None:
        return {"metric": metric, "tool": tool, "ours": ours, "absDiff": None, "status": "not_comparable"}
    diff = abs(float(tool) - float(ours))
    return {"metric": metric, "tool": tool, "ours": ours, "absDiff": diff, "status": "match" if diff <= tol else "mismatch"}


# ---------------------------------------------------------------- evidence levels and claim scope


def evidence_level(run):
    reasons = []
    if "unverified_format_version" in run.level_caps:
        reasons.append("unverified_format_version")
    if "tool_hash_mismatch" in run.level_caps:
        reasons.append("tool_hash_mismatch")
    if not any(i["status"] == "scored" for i in run.items):
        reasons.append("no_scored_items")
    return ("L1" if reasons else "L2"), reasons


def _fmt(value):
    return "n/a" if value is None else f"{value:.4f}".rstrip("0").rstrip(".") if isinstance(value, float) else str(value)


def claim_scope(run, results, judge_results):
    meta = run.meta
    statements = []
    dataset = meta["dataset"]
    harness = meta["harness"]
    sut = meta["systemUnderTest"]
    snapshot = sut["snapshot"] or sut["model"] or "an unidentified system"
    sp = meta["systemPrompt"]["sha256"]
    for result in results:
        for member in result["members"]:
            if member.get("subject") != run.run_key:
                continue
            interval = member.get("interval")
            n = (member.get("counts") or {}).get("n")
            span = f"{int(round(interval['level'] * 100))}% interval {_fmt(interval['lower'])}-{_fmt(interval['upper'])}" if interval else "no interval"
            if result["kind"] == "genai_mean":
                statements.append(f"{member['metric']} {_fmt(member['estimate'])} ({span}; n = {n} items of {dataset['name'] or 'an undeclared dataset'}@{dataset['version'] or 'unversioned'}) for {snapshot}, "
                                  f"with the recorded system prompt (SHA-256 {sp[:12] if sp else 'not recorded'}), decoding settings and harness {harness['name']}@{harness['version'] or 'undeclared'}. "
                                  "This is accuracy on this benchmark, not accuracy on the population of real inputs (NIST AI 800-3).")
            elif result["kind"] == "genai_attack_success":
                attack = meta["attackSet"] or {}
                judges = ", ".join(sorted({j["model"]["model"] or j["ref"] for j in meta["judges"]})) or "the recorded scorers"
                statements.append(f"Attack-success rate {_fmt(member['estimate'])} ({span}; n = {n}) for {member['memberId'].split('|')[-1]} from {attack.get('name') or 'an undeclared attack set'}@{attack.get('version') or 'unversioned'}, judged by {judges}. "
                                  "It holds only for this attack set, this configuration and this judge; a low rate does not show that the system is secure against other attacks.")
    for jv in judge_results:
        for binding in jv["bindings"]:
            if binding["runKey"] == run.run_key and jv["kappa"] is not None:
                statements.append(f"Judge {jv['judge']['model']} agreed with human labels with kappa {_fmt(jv['kappa'])} ({int(round(jv['level'] * 100))}% interval {_fmt(jv['lower'])}-{_fmt(jv['upper'])}; n = {jv['n']}).")
    edits = run.post_run_edits
    if edits and edits["counts"]["scoreEdits"]:
        authors = sorted({e["author"] for s in edits["scoreEdits"] for e in s["edits"] if e["author"]}) or ["unrecorded authors"]
        statements.append(f"{edits['counts']['scoreEdits']} scores were edited after the run by {', '.join(authors)}; the reported figures use the {run.extra.get('policy', 'original')} scores.")
    return statements
