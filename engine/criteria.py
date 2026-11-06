"""Statistics 1.0.0 criteria for engine reports (report contract 1.3).

engine/statistics.py decides on counts; this module turns validated prediction
rows into those counts, evaluates the recorded plan and maps every criterion to
a report result (docs/design/audit-statistics.md sections 4, 5.11 and 11).
"""
from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from typing import Any

from . import statistics as st

# Section 5.11: the descriptive row-level bootstrap (ECE and R2) stays within rows x replicates <= 5,000,000.
MAX_DESCRIPTIVE_BOOTSTRAP_WORK = 5_000_000
ARTICLES = {"performance": "15", "multiclass_performance": "15", "regression_performance": "15", "calibration": "15", "group_comparison": "10"}
KIND_LABELS = {"performance": "Binary classification performance", "multiclass_performance": "Multiclass classification performance", "regression_performance": "Regression performance", "calibration": "Probability calibration"}
GROUP_LABELS = {"selection_rate_difference": "Demographic parity difference", "selection_rate_ratio": "Disparate impact ratio", "equalized_odds": "Equalized odds difference"}
UNITS = {"mae": "target_units", "rmse": "target_units", "r2": "dimensionless"}
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
    "interval_straddles_band": "The confidence interval straddles the acceptable band, so the evidence is inconclusive.",
    "within_criterion_multiplicity": "A comparison is outside the band on its own, but not after the Bonferroni adjustment over the criterion's comparisons.",
    "multiplicity_adjustment": "The claim does not survive the adjustment for the number of criteria in its family.",
    "estimate_on_band_boundary": "An estimate lies exactly on a band bound, which supports no claim.",
    "degenerate_interval": "The errors have zero variance, so no interval can be estimated.",
    "no_threshold": "The policy sets no threshold that statistics 1.0.0 can decide, so every metric is descriptive and no conclusion is drawn.",
    "undecidable_metric": "The policy depends on a metric that statistics 1.0.0 cannot decide by an interval (R² or expected calibration error), so a pass is not possible.",
    "invalid_band": "The configured acceptance band is not a valid band for this metric, so the criterion cannot decide.",
    "bootstrap_budget_exceeded": "The descriptive bootstrap exceeds its work budget, so no bootstrap interval is reported.",
    "bootstrap_insufficient_valid_replicates": "Too few bootstrap replicates are defined, so no bootstrap interval is reported.",
}
BASE_NOTES = {
    "performance": "Performance is measured on supplied labels and predictions; independence, representativeness, temporal validity and target leakage require review.",
    "multiclass_performance": "Saved predictions do not establish cross-validation, dataset independence or freedom from leakage.",
    "regression_performance": "Saved predictions do not establish cross-validation, dataset independence or freedom from leakage; R² is descriptive.",
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
    for criterion in (plan or {}).get("criteria", []):
        columns.extend(criterion.get("groupFields") or [])
        if criterion.get("subgroup"):
            columns.append(criterion["subgroup"]["field"])
    return list(dict.fromkeys(columns))


def group_label(values: list[str]) -> str:
    """One protected column gives its value; several give an intersectional stratum label (a JSON array)."""
    return values[0] if len(values) == 1 else json.dumps(values, ensure_ascii=False, separators=(",", ":"))


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


def group_data(criterion, observations, config):
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
    return {"groups": [{"group": name, **groups[name]} for name in sorted(groups, key=st.code_point_key)], "unknownGroupRows": unknown}


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


def quantile(ordered, probability):
    position = (len(ordered) - 1) * probability
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


class Evaluation:
    """Build the per-criterion data from validated observations and evaluate a normalised plan."""

    def __init__(self, plan, observations, config):
        self.plan, self.observations, self.config = plan, observations, config
        self.task = config["task"]
        self.scored = {}

    def data_for(self, criterion):
        kind = criterion["kind"]
        if kind == "performance":
            return {"groups": [{"group": "all", **binary_counts(self.observations, self.config["positiveLabel"])}]}
        if kind == "multiclass_performance":
            return multiclass_data(self.observations)
        if kind == "regression_performance":
            return {"errors": [o["prediction"] - o["target"] for o in self.observations], "targets": [o["target"] for o in self.observations]}
        if kind == "group_comparison":
            return group_data(criterion, self.observations, self.config)
        rows = scored_rows(criterion, self.observations, self.config)
        bins, index = calibration_bins(rows, self.plan["calibrationBins"])
        self.scored[criterion["id"]] = (rows, index)
        return {"bins": bins, "brierErrors": [(score - label) ** 2 for score, label in rows]}

    def evaluate(self):
        evaluation = st.evaluate_criteria(self.plan, self.data_for)
        for spec, outcome in zip(self.plan["criteria"], evaluation["criteria"]):
            self.add_bootstrap(spec, outcome)
        return evaluation

    def add_bootstrap(self, spec, outcome):
        """End to end, the engine adds descriptive percentile-bootstrap intervals for ECE and R2."""
        replicates, seed, level = self.plan["bootstrap"]["replicates"], self.config["seed"], self.plan["confidenceLevel"]
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
        "details": {"role": role, "metric": entry["metric"], "subject": entry["subject"], "comparator": entry["comparator"], "counts": counts, "band": entry["band"], "status": entry["status"], "direction": entry["direction"], "smallCell": entry["smallCell"], "fisherExactP": entry["fisherExactP"], "chanceExactP": entry["chanceExactP"], "reasons": list(entry["reasons"])},
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


def criterion_result(spec, outcome, config, plan, notes):
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
    reasons = list(decision["reasons"])
    for entry in outcome["descriptive"]:
        reasons.extend(r for r in entry["reasons"] if r.startswith("bootstrap_"))
    limitations = [BASE_NOTES[kind], *notes, *dict.fromkeys(REASON_TEXT[r] for r in reasons if r in REASON_TEXT)]
    if decision["libraryEntry"]:
        limitations.append(f"{decision['libraryEntry']['legalStatus']}: {decision['libraryEntry']['caveat']}")
    label = KIND_LABELS.get(kind) or GROUP_LABELS[spec["metric"]]
    return {"testId": spec["id"], "label": label, "article": ARTICLES[kind], "outcome": outcome["outcome"], "metrics": metrics, "limitations": list(dict.fromkeys(limitations)), "decision": decision}


def evaluate_plan_results(plan, observations, config, notes=()):
    """Evaluate a normalised plan on validated observations. Returns (results, evaluation)."""
    evaluation = Evaluation(plan, observations, config).evaluate()
    results = [criterion_result(spec, outcome, config, plan, list(notes)) for spec, outcome in zip(plan["criteria"], evaluation["criteria"])]
    return results, evaluation
