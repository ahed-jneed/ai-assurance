"""Statistics 1.0.0 criteria for engine reports (report contract 1.3).

engine/statistics.py decides on counts; this module turns validated prediction
rows into those counts, evaluates the recorded plan and maps every criterion to
a report result (docs/design/audit-statistics.md sections 4, 5.11 and 11).
"""
from __future__ import annotations

import copy
import json
import math
import random
from collections import Counter, defaultdict
from typing import Any

from . import statistics as st
from .errors import EngineError

# Section 5.11: the descriptive row-level bootstrap (ECE and R2) stays within rows x replicates <= 5,000,000.
MAX_DESCRIPTIVE_BOOTSTRAP_WORK = 5_000_000
ARTICLES = {"performance": "15", "multiclass_performance": "15", "regression_performance": "15", "calibration": "15", "group_comparison": "10"}
KIND_LABELS = {"performance": "Binary classification performance", "multiclass_performance": "Multiclass classification performance", "regression_performance": "Regression performance", "calibration": "Probability calibration"}
GROUP_LABELS = {"selection_rate_difference": "Demographic parity difference", "selection_rate_ratio": "Disparate impact ratio", "equalized_odds": "Equalized odds difference"}
UNITS = {"mae": "target_units", "rmse": "target_units", "r2": "dimensionless", "baseline_rmse": "target_units", "mse_reduction": "target_units_squared"}
# Plain-language limitation text for each reason code (section 4.4). Codes stay in decision.reasons.
REASON_TEXT = {
    "below_minimum_sample_size": "Fewer rows were evaluated than the pre-registered minimum sample size, so no claim is made either way.",
    "undefined_zero_denominator": "A metric has a zero denominator (for example no predicted positives), so it is undefined and blocks a pass.",
    "single_class": "A class is absent from the evaluated rows, so a class-conditional metric is undefined and blocks a pass.",
    "below_minimum_class_count": "A class-conditional denominator is below the pre-registered minimum class count, so that metric cannot support a pass.",
    "group_suppressed_below_minimum": "Groups or bins below the minimum group size are suppressed: they are reported but never decide.",
    "group_below_minimum_size": "A comparison involves a suppressed group and is reported descriptively.",
    "insufficient_coverage": "The eligible groups cover less of the population than the pre-registered minimum coverage, so a pass is not possible.",
    "empty_declared_group": "A pre-registered group has no rows, so there is no evidence for it and a pass is not possible.",
    "insufficient_groups": "Fewer than two eligible groups (or no eligible reference group) remain, so no comparison can pass or fail.",
    "too_many_groups": "The number of groups exceeds the limit for this comparison mode; per-group rates are reported without a decision.",
    "small_cell_exact_test_not_significant": "A comparison has a cell under 5 and Fisher's exact test does not confirm the disparity, so the fail is not claimed.",
    "chance_exact_test_not_significant": "The exact test of independence between predictions and truth is not significant, so performance above chance is not claimed.",
    "mean_baseline_not_beaten": "The model's mean squared error is not shown to be below that of predicting the mean of the reference values on every row (the mean-prediction baseline), so a pass is not claimed.",
    "interval_straddles_band": "The confidence interval straddles the acceptable band, so the evidence is inconclusive.",
    "within_criterion_multiplicity": "A comparison is outside the band on its own, but not after the Bonferroni adjustment over the criterion's comparisons.",
    "multiplicity_adjustment": "The claim does not survive the adjustment for the number of criteria in its family.",
    "estimate_on_band_boundary": "An estimate lies exactly on a band bound, which supports no claim.",
    "degenerate_interval": "The errors have zero variance, so no interval can be estimated.",
    "no_threshold": "The policy sets no threshold that statistics 1.0.0 can decide, so every metric is descriptive and no conclusion is drawn.",
    "undecidable_metric": "The policy depends on a metric that statistics 1.0.0 cannot decide by an interval (R² or expected calibration error), so a pass is not possible.",
    "invalid_band": "The configured acceptance band is not a valid band for this metric, so the criterion cannot decide.",
    "bootstrap_budget_exceeded": "A bootstrap exceeds its work budget, so no bootstrap interval is reported; in a clustered design no member can then decide.",
    "bootstrap_insufficient_valid_replicates": "Too few bootstrap replicates are defined, so no bootstrap interval is reported.",
    "small_cell_clustered": "A comparison has a cell under 5 in a clustered design. Fisher's exact test assumes independent rows, so that comparison supports no claim.",
    "below_minimum_cluster_count": "A metric or compared group has fewer than 10 independent clusters, so it cannot support a pass.",
    # Hosted-runner codes (section 4.4): the engine never emits them; the text matches site-app/lib/hosted-statistics.ts.
    "clustered_design_requires_engine": "The plan declares a cluster design that this runner cannot evaluate, so the criterion is inconclusive; the engine decides it by the cluster bootstrap.",
    "interval_requires_engine": "The required interval needs score columns that this runner does not evaluate, so the criterion is inconclusive; the engine computes it.",
}
CLUSTER_NOTE = "Rows are clustered by '{field}': every member and descriptive interval is a cluster percentile bootstrap over {clusters} clusters ({replicates} replicates, seed {seed}). The per-group rates are cluster percentile intervals too; the prevalence and majority-class baseline intervals still assume independent rows."
BASE_NOTES = {
    "performance": "Performance is measured on supplied labels and predictions; independence, representativeness, temporal validity and target leakage require review.",
    "multiclass_performance": "Saved predictions do not establish cross-validation, dataset independence or freedom from leakage.",
    "regression_performance": "Saved predictions do not establish cross-validation, dataset independence or freedom from leakage; R² is descriptive. A pass also needs the model to beat the mean-prediction baseline (baseline_rmse).",
    "calibration": "Calibration uses fixed equal-width probability bins; the expected calibration error is descriptive and never decides.",
    "group_comparison": "Group comparisons are not a causal finding of discrimination or a legal compliance verdict; intervals assume independent observations.",
}


def threshold_for(config: dict[str, Any], name: str) -> dict[str, Any] | None:
    """The frozen legacy policy rule for a metric name, or None (section 11.2: shown, never applied)."""
    policy = config["thresholds"]
    spec = policy["values"].get(name)
    if spec is None:
        return None
    return {**spec, "policyId": policy["policyId"], "policyVersion": policy["policyVersion"], "source": "internal_policy"}


def group_columns(plan: dict[str, Any] | None, config: dict[str, Any]) -> list[str]:
    """Row columns the plan reads besides target, prediction and score: group fields and calibration subgroups."""
    columns = []
    protected = config.get("columns", {}).get("protected")
    if protected:
        columns.append(protected)
    if (plan or {}).get("clusterField"):
        columns.append(plan["clusterField"])
    for criterion in (plan or {}).get("criteria", []):
        columns.extend(criterion.get("groupFields") or [])
        if criterion.get("subgroup"):
            columns.append(criterion["subgroup"]["field"])
    return list(dict.fromkeys(columns))


def group_label(values: list[str]) -> str:
    """One protected column gives its value; several give an intersectional stratum label (a JSON array)."""
    return values[0] if len(values) == 1 else json.dumps(values, ensure_ascii=False, separators=(",", ":"))


def cluster_ids(plan, observations):
    """The clusters of a clustered plan in section 5.11 order, and each cluster's observations."""
    field = plan["clusterField"]
    parts = defaultdict(list)
    for o in observations:
        value = o["fields"].get(field)
        if value is None:
            raise EngineError("missing_value", f"Every evaluated row needs a cluster id in column {field!r} (statistics.clusterField)")
        parts[value].append(o)
    ordered = sorted(parts, key=st.cluster_key)
    return ordered, [parts[cluster] for cluster in ordered]


def performance_labels(config):
    """(positive, other) for binary performance: the class recall is measured on (performancePositiveLabel,
    which defaults to the favourable positiveLabel) and the other declared label. Group comparisons and
    calibration keep counting the favourable positiveLabel."""
    positive = config.get("performancePositiveLabel") or config["positiveLabel"]
    return positive, config["negativeLabel"] if positive == config["positiveLabel"] else config["positiveLabel"]


def binary_counts(observations, positive):
    cm = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    for o in observations:
        actual, predicted = o["target"] == positive, o["prediction"] == positive
        cm["tp" if actual and predicted else "fn" if actual else "fp" if predicted else "tn"] += 1
    return cm


def multiclass_data(observations):
    labels = sorted({o["target"] for o in observations} | {o["prediction"] for o in observations}, key=st.code_point_key)
    position = {label: i for i, label in enumerate(labels)}
    matrix = [[0] * len(labels) for _ in labels]
    for o in observations:
        matrix[position[o["target"]]][position[o["prediction"]]] += 1
    return {"labels": labels, "matrix": matrix}


def group_data(criterion, observations, config, withheld=()):
    """withheld: the observations a client-held run leaves out (#102). A group with no other rows is passed
    as withheld with its size, and the coverage population counts every withheld row. A withheld row whose
    group in these columns kept other rows (it was left out for another column set's small group or missing
    value) is passed in withheldMembers, so it counts as eligible for coverage as in a run on every row."""
    fields = criterion.get("groupFields") or [config["columns"]["protected"]]
    groups, unknown = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "tn": 0}), 0
    positive = config["positiveLabel"]
    for o in observations:
        values = [o["fields"].get(field) for field in fields]
        if any(value is None for value in values):
            unknown += 1
            continue
        cm = groups[group_label(values)]
        actual, predicted = o["target"] == positive, o["prediction"] == positive
        cm["tp" if actual and predicted else "fn" if actual else "fp" if predicted else "tn"] += 1
    data = {"groups": [{"group": name, **groups[name]} for name in sorted(groups, key=st.code_point_key)], "unknownGroupRows": unknown}
    if withheld:
        labels = Counter(label for label in (stratum(o["fields"], fields) for o in withheld) if label is not None)
        data.update(withheldGroups={label: n for label, n in labels.items() if label not in groups}, withheldMembers={label: n for label, n in labels.items() if label in groups}, withheldRows=len(withheld))
    return data


def stratum(fields, columns):
    """The group label of a row's values in these columns, or None when one is missing."""
    values = [fields.get(column) for column in columns]
    return None if any(value is None for value in values) else group_label(values)


def withheld_strata(observations, plan, config):
    """For a run on a client-held dataset (#102): the groups whose rows are left out of every criterion, as
    {columns: labels}. A group is left out when fewer than the minimum group size of the remaining observations
    fall in it, in any column set the plan groups or subsets by (the protected column, each criterion's group
    fields, each calibration subgroup's field). The rows with no value in a column set are left out the same
    way (as the label None) when fewer than the minimum of them remain, since the totals minus the groups would
    give them back too. Leaving rows out can shrink a group of another column set below the minimum, so this
    repeats until nothing changes: every group that remains then has at least the minimum number of rows in
    every column set, and no total in the result includes a left-out row."""
    minimum = plan["minimums"]["groupSize"]
    protected = config["columns"].get("protected")
    sets = [(protected,)] if protected else []
    for criterion in plan["criteria"]:
        if criterion["kind"] == "group_comparison":
            sets.append(tuple(criterion["groupFields"] or [protected]))
        if criterion.get("subgroup"):
            sets.append((criterion["subgroup"]["field"],))
    sets = list(dict.fromkeys(columns for columns in sets if None not in columns))
    strata = {columns: set() for columns in sets}
    remaining = list(observations)
    while True:
        changed = False
        for columns in sets:
            counts = Counter(stratum(o["fields"], columns) for o in remaining)
            small = {label for label, n in counts.items() if n < minimum}
            if small:
                strata[columns] |= small
                changed = True
        if not changed:
            return {columns: labels for columns, labels in strata.items() if labels}
        remaining = [o for o in remaining if not is_withheld(o["fields"], strata)]


def is_withheld(fields, strata):
    """Whether a row with these group values (column -> label or None) belongs to a withheld group (the label
    None stands for the rows with no value in those columns)."""
    return any(stratum(fields, columns) in labels for columns, labels in strata.items())


def scored_rows(criterion, observations, config):
    subgroup = criterion.get("subgroup")
    positive = config["positiveLabel"]
    return [(o["score"], 1 if o["target"] == positive else 0) for o in observations if o["score"] is not None and (subgroup is None or o["fields"].get(subgroup["field"]) == subgroup["value"])]


def calibration_bins(rows, bins):
    index = [min(int(score * bins), bins - 1) for score, _ in rows]
    totals = defaultdict(lambda: [0, 0, 0.0])
    for position, (score, label) in zip(index, rows):
        cell = totals[position]
        cell[0] += 1
        cell[1] += label
        cell[2] += score
    return [{"bin": b, "n": totals[b][0], "positives": totals[b][1], "meanScore": totals[b][2] / totals[b][0]} for b in sorted(totals)], index


def bootstrap_interval(n, statistic, replicates, seed, level):
    """Seeded iid row-level percentile bootstrap (type-7 quantiles), display only (section 5.11).
    Returns (interval or None, reasons)."""
    if n == 0:
        return None, []
    if n * replicates > MAX_DESCRIPTIVE_BOOTSTRAP_WORK:
        return None, ["bootstrap_budget_exceeded"]
    rng = random.Random(seed)
    values = []
    for _ in range(replicates):
        value = statistic([rng.randrange(n) for _ in range(n)])
        if value is not None:
            values.append(value)
    if len(values) < 0.9 * replicates:
        return None, ["bootstrap_insufficient_valid_replicates"]
    values.sort()
    tail = (1.0 - level) / 2.0
    return {"lower": quantile(values, tail), "upper": quantile(values, 1.0 - tail), "level": level, "method": "percentile_bootstrap"}, []


quantile = st.quantile


class Evaluation:
    """Build the per-criterion data from validated observations and evaluate a normalised plan."""

    def __init__(self, plan, observations, config, withheld=()):
        self.plan, self.observations, self.config, self.withheld = plan, observations, config, list(withheld)
        self.task = config["task"]
        self.scored = {}

    def data_for(self, criterion, observations=None):
        kind = criterion["kind"]
        whole = observations is None
        observations = self.observations if whole else observations
        if kind == "performance":
            return {"groups": [{"group": "all", **binary_counts(observations, performance_labels(self.config)[0])}]}
        if kind == "multiclass_performance":
            return multiclass_data(observations)
        if kind == "regression_performance":
            return {"errors": [o["prediction"] - o["target"] for o in observations], "targets": [o["target"] for o in observations]}
        if kind == "group_comparison":
            # Only the whole sample carries a client-held run's withheld rows (#102); a clustered plan attaches
            # them once (cluster_parts) and merge_parts restores them for coverage (section 5.11).
            return group_data(criterion, observations, self.config, self.withheld if whole else ())
        rows = scored_rows(criterion, observations, self.config)
        bins, index = calibration_bins(rows, self.plan["calibrationBins"])
        if whole:
            self.scored[criterion["id"]] = (rows, index)
        return {"bins": bins, "brierErrors": [(score - label) ** 2 for score, label in rows]}

    def evaluate(self):
        if self.plan["clusterField"] is None:
            evaluation = st.evaluate_criteria(self.plan, self.data_for)
        else:
            # Section 5.11: every member is decided by the cluster bootstrap over one data object per cluster.
            ids, parts = cluster_ids(self.plan, self.observations)
            for criterion in self.plan["criteria"]:
                if criterion["kind"] == "calibration":
                    self.data_for(criterion)  # the whole sample's scored rows, for the descriptive ECE bootstrap
            evaluation = st.evaluate_criteria(self.plan, None, clustered=(ids, lambda criterion: self.cluster_parts(criterion, parts), self.config["seed"]))
        for spec, outcome in zip(self.plan["criteria"], evaluation["criteria"]):
            self.add_bootstrap(spec, outcome)
        return evaluation

    def cluster_parts(self, criterion, parts):
        """One data object per cluster. In a client-held run (#102) the withheld rows are attached once, to the
        first cluster's group data: they count only towards suppressed groups and coverage, never a replicate."""
        data = [self.data_for(criterion, rows) for rows in parts]
        if criterion["kind"] == "group_comparison" and self.withheld and data:
            whole = group_data(criterion, self.observations, self.config, self.withheld)
            data[0] = {**data[0], **{key: whole[key] for key in ("withheldGroups", "withheldMembers", "withheldRows") if key in whole}}
        return data

    def add_bootstrap(self, spec, outcome):
        """End to end, the engine adds descriptive percentile-bootstrap intervals for ECE and R2 and, for
        independent rows, the MAE and RMSE sensitivity interval (section 5.9), which never decides."""
        replicates, seed, level = self.plan["bootstrap"]["replicates"], self.config["seed"], self.plan["confidenceLevel"]
        if spec["kind"] == "regression_performance" and self.plan["clusterField"] is None:
            errors = [o["prediction"] - o["target"] for o in self.observations]
            for entry in outcome["members"] + outcome["descriptive"]:
                if entry["metric"] in ("mae", "rmse") and entry["interval"] is not None:
                    statistic = mean_absolute if entry["metric"] == "mae" else root_mean_square
                    entry["sensitivityInterval"], entry["_sensitivityReasons"] = bootstrap_interval(len(errors), lambda draw, f=statistic: f(errors, draw), replicates, seed, level)
        for entry in outcome["descriptive"]:
            if entry["metric"] == "expected_calibration_error" and entry["estimate"] is not None:
                rows, index = self.scored[spec["id"]]
                entry["interval"], reasons = bootstrap_interval(len(rows), lambda draw: ece(rows, index, draw), replicates, seed, level)
                entry["reasons"].extend(reasons)
            elif entry["metric"] == "r2" and entry["estimate"] is not None:
                targets = [o["target"] for o in self.observations]
                errors = [o["prediction"] - o["target"] for o in self.observations]
                entry["interval"], reasons = bootstrap_interval(len(targets), lambda draw: r_squared(targets, errors, draw), replicates, seed, level)
                entry["reasons"].extend(reasons)


def ece(rows, index, draw):
    totals = defaultdict(lambda: [0, 0, 0.0])
    for position in draw:
        cell = totals[index[position]]
        score, label = rows[position]
        cell[0] += 1
        cell[1] += label
        cell[2] += score
    n = len(draw)
    return math.fsum(count / n * abs(positives / count - scores / count) for count, positives, scores in totals.values())


def mean_absolute(errors, draw):
    return math.fsum(abs(errors[i]) for i in draw) / len(draw)


def root_mean_square(errors, draw):
    return math.sqrt(math.fsum(errors[i] ** 2 for i in draw) / len(draw))


def r_squared(targets, errors, draw):
    sample = [targets[i] for i in draw]
    mean = math.fsum(sample) / len(sample)
    total = math.fsum((t - mean) ** 2 for t in sample)
    return None if total == 0.0 else 1.0 - math.fsum(errors[i] ** 2 for i in draw) / total


def _entry_metric(entry, role, name, unit, sample_size, config):
    counts = entry["counts"]
    single = entry["interval"] is not None and entry["interval"]["method"] == "wilson" and isinstance(counts, dict) and set(counts) == {"x", "n"}
    return {
        "name": name, "value": entry["estimate"], "unit": unit, "sampleSize": sample_size,
        "numerator": counts["x"] if single else None, "denominator": counts["n"] if single else None,
        "threshold": threshold_for(config, name), "confidenceInterval": entry["interval"], "slices": [],
        "details": {"role": role, "metric": entry["metric"], "subject": entry["subject"], "comparator": entry["comparator"], "counts": counts, "band": entry["band"], "status": entry["status"], "direction": entry["direction"], "smallCell": entry["smallCell"], "fisherExactP": entry["fisherExactP"], "chanceExactP": entry["chanceExactP"], "reasons": list(entry["reasons"]),
                    # Section 5.11: the cluster bootstrap's replicates and clusters; section 5.9: the MAE/RMSE sensitivity interval.
                    **({"bootstrap": entry["bootstrap"]} if "bootstrap" in entry else {}),
                    **({"sensitivityInterval": entry["sensitivityInterval"]} if "sensitivityInterval" in entry else {})},
        "pValue": entry["pValue"],
    }


def _slice(group):
    out = {"slice": group["group"], "n": group["n"], "declared": group["declared"], "suppressed": group["suppressed"]}
    for key in ("selection", "tpr", "fpr"):
        if key in group:
            rate = group[key]
            out.update({f"{key}Numerator": rate["x"], f"{key}Denominator": rate["n"], ("selectionRate" if key == "selection" else key): rate["estimate"], f"{key}ConfidenceInterval": rate["interval"]})
    if "observed" in group:
        rate = group["observed"]
        out.update(numerator=rate["x"], denominator=rate["n"], observedRate=rate["estimate"], confidenceInterval=rate["interval"], meanProbability=group["meanScore"])
    return out


def _calibration_slice(group, bins):
    out = _slice(group)
    index = int(group["group"][3:])
    out.update(lower=index / bins, upper=(index + 1) / bins)
    return out


def short(value, digits):
    """A number to `digits` significant digits without trailing zeros, as the hosted runner writes it."""
    return f"{value:.{digits}g}"


def baseline_note(outcome):
    """Section 5.9: when the mean baseline gate stops a regression pass, name the model's RMSE and the baseline's."""
    if "mean_baseline_not_beaten" not in outcome["decision"]["reasons"]:
        return []
    entries = {e["metric"]: e for e in outcome["members"] + outcome["descriptive"]}
    rmse, base = entries.get("rmse"), entries.get("baseline_rmse")
    if rmse is None or base is None or rmse["estimate"] is None or base["estimate"] is None:
        return []
    return [f"RMSE {short(rmse['estimate'], 4)} does not beat the mean-prediction baseline RMSE {short(base['estimate'], 4)} (gate p {short(base['counts']['gatePValue'], 3)}): the model is not shown to predict better than the mean of the reference values."]


def cluster_count(outcome):
    """The clusters a clustered criterion resampled: the largest count over its bootstrapped entries."""
    return max((entry["bootstrap"]["clusters"] for entry in outcome["members"] + outcome["descriptive"] if "bootstrap" in entry), default=0)


def class_table(observations, labels):
    """Per-class support, predictions, correct predictions, recall, precision and F1 (the hosted runner's
    classPerformance rows), in the given label order."""
    table = []
    for label in labels:
        support = sum(1 for o in observations if o["target"] == label)
        predicted = sum(1 for o in observations if o["prediction"] == label)
        tp = sum(1 for o in observations if o["target"] == label and o["prediction"] == label)
        table.append({"slice": label, "support": support, "predicted": predicted, "tp": tp, "recall": tp / support if support else None, "precision": tp / predicted if predicted else None, "f1": 2 * tp / (support + predicted) if support + predicted else None})
    return table


def unexpected_predictions(observations):
    """Section 4.8 / traditional-ml-2.1.0: predicted labels the reference column never contains. They count as
    errors; a multiclass one also leaves its class without support, which blocks a pass (single_class)."""
    reference = {o["target"] for o in observations}
    counts = defaultdict(int)
    for o in observations:
        if o["prediction"] not in reference:
            counts[o["prediction"]] += 1
    if not counts:
        return []
    listed = ", ".join(f"'{label}' ({counts[label]} rows)" for label in sorted(counts, key=st.code_point_key))
    return [f"Predicted labels absent from the reference column: {listed}. They count as errors."]


def descriptive_proportion(metric, x, n, level):
    """A descriptive Wilson proportion (no band, never decides), in the statistics entry shape."""
    if n == 0:
        return st.member(metric, None, None, "wilson", None, counts={"x": x, "n": n}, status="undefined", reasons=["undefined_zero_denominator"], level=level, descriptive=True)
    return st.member(metric, None, x / n, "wilson", lambda z: st.wilson(x, n, z), counts={"x": x, "n": n}, level=level, descriptive=True)


def performance_context(spec, observations, config, level):
    """Descriptive evidence beside a performance criterion's members (traditional-ml-2.1.0): prevalence and the
    majority-class baseline accuracy as descriptive entries, the per-class table for the balanced-accuracy
    entry's slices, and the notes that say which class recall refers to. None for other kinds."""
    n = len(observations)
    if spec["kind"] == "performance":
        positive, other = performance_labels(config)
        table = class_table(observations, [positive, other])
        positives, negatives = table[0]["support"], table[1]["support"]
        entries = [descriptive_proportion("prevalence", positives, n, level), descriptive_proportion("majority_baseline_accuracy", max(positives, negatives), n, level)]
        notes = [f"Recall (sensitivity), precision and F1 refer to the performance positive class '{positive}'; specificity is the recall of '{other}'. Prevalence is the share of '{positive}' in the reference column; the majority-class baseline is the accuracy of always predicting the more frequent reference class and is descriptive."]
        if positive != config["positiveLabel"]:
            notes.append(f"Fairness tests count the favourable outcome '{config['positiveLabel']}', not the performance positive class.")
    elif spec["kind"] == "multiclass_performance":
        labels = multiclass_data(observations)["labels"]
        table = class_table(observations, labels)
        entries = [descriptive_proportion("majority_baseline_accuracy", max((row["support"] for row in table), default=0), n, level)]
        notes = ["Macro recall (balanced accuracy) averages recall over the classes; the majority-class baseline is the accuracy of always predicting the most frequent reference class and is descriptive."]
    else:
        return None
    return {"entries": entries, "table": table, "notes": notes + unexpected_predictions(observations)}


def criterion_result(spec, outcome, config, plan, notes, context=None):
    """Map one evaluated criterion to a report result (section 11.4)."""
    kind, decision = spec["kind"], outcome["decision"]
    sample_size = decision["sampleSize"]
    metrics = []
    if kind in ("group_comparison", "calibration"):
        headline_metric = "calibration" if kind == "calibration" else spec["metric"]
        name = st.HEADLINE_NAMES[headline_metric]["engine"]
        headline = outcome["headline"]
        slices = [_calibration_slice(g, plan["calibrationBins"]) if kind == "calibration" else _slice(g) for g in outcome["groups"]]
        metrics.append({
            "name": name, "value": headline["estimate"] if headline else None, "unit": "ratio", "sampleSize": sample_size,
            "numerator": None, "denominator": None, "threshold": threshold_for(config, name),
            "confidenceInterval": headline["interval"] if headline else None, "slices": slices,
            "details": {"role": "headline", "metric": headline_metric, "subject": None, "comparator": None, "counts": None, "band": headline["band"] if headline else None, "status": "evaluated" if headline else "undefined", "direction": decision["direction"], "smallCell": False, "fisherExactP": None, "chanceExactP": None, "reasons": []},
            "pValue": None,
        })
    multiclass = kind == "multiclass_performance"
    for role, entries in (("member", outcome["members"]), ("descriptive", outcome["descriptive"])):
        for entry in entries:
            name = "macro_recall" if multiclass and entry["memberId"] == "balanced_accuracy" else entry["memberId"]
            metrics.append(_entry_metric(entry, role, name, UNITS.get(entry["metric"], "ratio"), sample_size, config))
            if context and entry["metric"] == "balanced_accuracy" and entry["subject"] is None:
                metrics[-1]["slices"] = copy.deepcopy(context["table"])
    if context:
        metrics.extend(_entry_metric(entry, "descriptive", entry["memberId"], "ratio", sample_size, config) for entry in context["entries"])
        notes = [*notes, *context["notes"]]
    reasons = list(decision["reasons"])
    for entry in outcome["descriptive"]:
        reasons.extend(r for r in entry["reasons"] if r.startswith("bootstrap_"))
    if any(entry.get("_sensitivityReasons") for entry in outcome["members"] + outcome["descriptive"]):
        notes = [*notes, "The MAE and RMSE bootstrap sensitivity interval exceeds its work budget (rows x replicates <= 5,000,000) or has too few valid replicates, so it is not reported."]
    base = BASE_NOTES[kind]
    if plan["clusterField"] is not None:
        base = base.replace("; intervals assume independent observations.", ".")
        notes = [*notes, CLUSTER_NOTE.format(field=plan["clusterField"], clusters=cluster_count(outcome), replicates=plan["bootstrap"]["replicates"], seed=config["seed"])]
    limitations = [base, *notes, *dict.fromkeys(REASON_TEXT[r] for r in reasons if r in REASON_TEXT), *baseline_note(outcome)]
    if decision["libraryEntry"]:
        limitations.append(f"{decision['libraryEntry']['legalStatus']}: {decision['libraryEntry']['caveat']}")
    label = KIND_LABELS.get(kind) or GROUP_LABELS[spec["metric"]]
    return {"testId": spec["id"], "label": label, "article": ARTICLES[kind], "outcome": outcome["outcome"], "metrics": metrics, "limitations": list(dict.fromkeys(limitations)), "decision": decision}


# Client-held datasets (#102): what a result keeps of a group or calibration bin below the minimum group size.
WITHHELD_ROWS_NOTE = ("The dataset is held by the client: the rows of groups below the minimum group size, in any column the "
    "plan groups by, and the rows with no value in such a column when there are fewer than the minimum group size of "
    "them, are left out of every criterion, performance and calibration included, and of the reported row count.These results therefore describe only the other rows and can differ from a run on every row. The number of "
    "rows left out and the group comparisons' coverage counts are not reported; whether coverage met its minimum still decides.")
WITHHELD_NOTE = ("The dataset is held by the client: groups and calibration bins below the minimum group size are withheld: "
    "only their labels are reported, without their row counts, rates, intervals or comparisons.")
WITHHELD_BIN_NOTE = ("The calibration figures over all bins (sample size, coverage, expected calibration error and Brier score) "
    "include the rows of the withheld calibration bins, so their scores and labels can be derived by subtraction; "
    "none of those rows belongs to a group below the minimum group size.")
WITHHELD_SUBGROUP_NOTE = ("The dataset is held by the client and this calibration subgroup is below the minimum group size, "
    "so its estimates are withheld.")


def _withheld_slice(s):
    out = {"slice": s["slice"], "n": None, "declared": s["declared"], "suppressed": True, "withheld": True}
    if "lower" in s:
        out.update(lower=s["lower"], upper=s["upper"])
    return out


def _withhold_metric(m):
    m.update(value=None, numerator=None, denominator=None, confidenceInterval=None, pValue=None, slices=[])
    m["details"].update(counts=None, direction="none", smallCell=False, fisherExactP=None, chanceExactP=None)


def withhold_small_groups(results, plan, rows_withheld=False):
    """For a run on a client-held dataset, withhold every value that describes a group or calibration bin below
    the plan's minimum group size: its slice keeps only the label (n null, "withheld": true), each comparison
    involving it loses its estimate, counts and interval, and decision.suppressedGroups no longer states its n.
    rows_withheld: the run left the rows of such groups out (withheld_strata), so every result says so and a
    group comparison's coverage, whose population counts those rows, is not reported. Suppressed groups never
    decide (section 4.3). A calibration subgroup below the minimum group size that is also below the minimum
    sample size (so nothing decides) withholds all its estimates. Results are changed in place."""
    minimum = plan["minimums"]["groupSize"]
    criteria = {c["id"]: c for c in plan["criteria"]}
    for result in results:
        decision = result.get("decision")
        if decision is None:
            continue
        notes = [WITHHELD_ROWS_NOTE] if rows_withheld else []
        kind = decision["kind"]
        if kind in ("group_comparison", "calibration"):
            criterion = criteria.get(result["testId"], {})
            small = {g["group"] for g in decision.get("suppressedGroups") or ()}
            subgroup = kind == "calibration" and criterion.get("subgroup") is not None and decision["sampleSize"] < minimum and "below_minimum_sample_size" in decision["reasons"]
            if kind == "group_comparison" and rows_withheld:
                decision["coverage"] = None
            if small or subgroup:
                decision["suppressedGroups"] = [{"group": g["group"], "n": None} for g in decision.get("suppressedGroups") or ()]
                for m in result["metrics"]:
                    details = m["details"]
                    if details["role"] == "headline":
                        m["slices"] = [_withheld_slice(s) if s.get("suppressed") else s for s in m["slices"]]
                    elif subgroup or details["subject"] in small or details["comparator"] in small:
                        _withhold_metric(m)
                notes.append(WITHHELD_NOTE)
                if kind == "calibration" and small and not subgroup:
                    notes.append(WITHHELD_BIN_NOTE)
                if subgroup:
                    notes.append(WITHHELD_SUBGROUP_NOTE)
        if notes:
            result["limitations"] = list(dict.fromkeys(result["limitations"] + notes))
    return results


def evaluate_plan_results(plan, observations, config, notes=(), withheld=()):
    """Evaluate a normalised plan on validated observations. withheld: the observations a client-held run
    leaves out (withheld_strata); they count only as suppressed groups and towards group coverage.
    Returns (results, evaluation)."""
    evaluation = Evaluation(plan, observations, config, withheld).evaluate()
    level = plan["confidenceLevel"]
    results = [criterion_result(spec, outcome, config, plan, list(notes), performance_context(spec, observations, config, level)) for spec, outcome in zip(plan["criteria"], evaluation["criteria"])]
    return results, evaluation
