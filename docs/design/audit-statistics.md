# Audit-grade statistics: decision rule, intervals, multiplicity, power and golden cases

| | |
|---|---|
| Issue | #9 (milestone M1, "Defensible core") |
| Status | Statistics specification version **1.0.0** (revised after independent review and re-review; its questions were decided on 5 November 2026, section 15). Implemented in the engine by #21 (PR #87: `engine/statistics.py`, engine report 1.3, worker translation of `engineConfig` 1.1 and 1.4) and in the hosted runner by #22 (`site-app/lib/statistics.ts`, hosted run 1.4, external intake 1.5). Both runners pass every golden case they run. Amended 6 November 2026 by #68: the mean-prediction baseline gate for regression criteria (section 5.9). Amended 6 November 2026 by #93: cluster-bootstrap decisions for plans with a `clusterField` (section 5.11, engine only), the MAE/RMSE bootstrap sensitivity interval (section 5.9) and the mean baseline gate in regression power (section 8). |
| Date | 5 November 2026 |
| Implemented by | #21 (engine, `engine/`, including the external worker), #22 (hosted runner, `site-app/`; threshold library data in `schemas/threshold-library.json`) |
| Consumed by | #30 (NYC Local Law 144 pack), #15 (binary performance fixes) |
| Contract files | `schemas/fixtures/statistics-golden.json` (58 golden cases), `docs/design/audit-statistics-plan.schema.json` (draft plan schema), `docs/design/audit-statistics-verify.py` (verification aid, not runtime code) |

The words MUST, MUST NOT, SHOULD and MAY are normative. "Runner" means the Python engine, the external worker's projection of an engine report, or the hosted TypeScript runner. Anything not marked as engine-only applies to all of them, and the golden fixture is the arbiter when this text and an implementation disagree.

## 1. Key conclusions

1. **The interval decides; a point estimate never does.** Every criterion has a pre-registered acceptable region (the *band*). The outcome is **pass** only when the interval lies wholly inside the band, **fail** only when it lies wholly outside, and **inconclusive** otherwise (section 4). This holds on all three decision paths that exist today: the engine, the hosted runner and the external worker's projection (section 2.2).
2. **One decision p-value per claim, obtained by inverting the reported interval.** For a single comparison, "p ≤ α" is exactly "the (1 − α) interval lies inside (or outside) the band". The p-value is what lets the family adjustments act on interval decisions without changing the interval methods (sections 4.2 and 6).
3. **Multiplicity.**
   - A criterion passes only if all its comparisons pass, an intersection–union test that needs no adjustment. It fails if any comparison fails, with Bonferroni within the criterion.
   - Across the confirmatory criteria of one plan run, **Bonferroni** bounds the probability of any wrong claim at α under any dependence between criteria. Holm's step-down is not used: claims point in data-dependent directions, and for that case its guarantee needs independent criteria, which criteria computed on one dataset are not (section 6).
   - Across exploratory criteria, Benjamini–Hochberg (BH) applies.
4. **Interval methods.**
   - Wilson for proportions.
   - Newcombe hybrid score for differences.
   - Katz-log for ratios, switching to the Koopman score interval when a selected count is zero or both groups are fully selected. Katz is undefined or degenerate there.
   - MOVER-Wilson for balanced accuracy.
   - Wilson on the Jaccard index for F1; Bonferroni-combined per-class intervals for macro F1 and macro precision.
   - **Fisher's exact test** as the small-cell rule. When any cell of a 2×2 comparison is under 5, a *fail* also needs Fisher's p to clear the same threshold.
   - **Fisher's exact test, one-sided, as the chance gate.** A pass of balanced accuracy or macro recall at or above chance also needs it to reject independence of prediction and truth (section 5.2).
   - **The mean baseline gate for regression.** A regression pass also needs the model's MSE to be shown below that of predicting the mean of the evaluated targets, so no constant prediction can pass (section 5.9).
   - The seeded percentile bootstrap is engine-only (section 5).
5. **One set of minimums, as floors that a plan cannot lower:** at least 30 evaluated rows, at least 30 rows per compared group, and at least 10 in every class-conditional denominator. They apply to the engine, the hosted runner and the worker alike. A legacy configuration with lower values is raised to the floors, and both values are recorded (section 7).
6. **Group criteria compare every pair of groups by default.** This is exactly equivalent to today's "max − min" gap and "min/max" ratio, so legacy thresholds keep their meaning.
   - Groups under the minimum are **suppressed** one at a time rather than voiding the analysis.
   - A pass also needs the pre-registered **coverage** (default 1.0).
   - All-pairs mode allows at most 50 groups (section 5.10).
7. **Metrics without a band are descriptive.** They are reported with an interval but never decide, and they do not count in any multiplicity adjustment. A criterion with no band at all is inconclusive (`no_threshold`).
   - This changes behaviour: an engine result no longer needs a threshold on every metric to pass.
   - Three derivation rules keep the change from letting a degenerate model pass, meaning one whose output does not depend on the truth (section 4.8):
     - Every derived classification criterion carries a **chance baseline**: balanced accuracy ≥ 0.5 for binary data, and macro recall ≥ 1/k for k classes, or the policy's own bound when it is higher. A degenerate model's population value is exactly chance.
       - The interval alone does not keep such a model out. When a class is predicted only a few times, exact enumeration shows passes up to 12% of the time (section 5.2).
       - So the baseline also needs Fisher's exact test of independence to reject (the chance gate). A degenerate model then passes with probability at most α/2, at any sample size and however rarely it predicts a class (at most 0.022 in the enumerated designs).
       - A constant model, whose estimate is exactly chance, never passes.
     - R² and ECE, which 1.0.0 cannot decide, **block a pass** in criteria derived from engine thresholds, as today's rule makes a pass depend on them.
     - A policy with no threshold that 1.0.0 can decide still never passes.
8. **Power is checked when the plan is approved.**
   - Each member's pass probability comes from a normal approximation at the family-adjusted level.
   - The members are combined into a range whose lower bound holds under any dependence. Required sizes and the smallest detectable disparity are derived from it.
   - Where 1.0.0 has no formula (macro F1, calibration), the output is an explicit `not_computed`.
   - A shortfall needs a recorded acknowledgement, not a block (section 8).
9. **The plan is a schema-validated, normalised object** stored with the profile or configuration. Its SHA-256 over RFC 8785 canonical JSON is recorded with every run (section 9 and the draft schema).
10. **Threshold library.**
    - The four-fifths rule is a configurable **screen**, never a legal verdict.
    - NYC LL144 is a **reporting** profile with no pass/fail; the scoring-rate median is taken over the full sample, as § 5-301(c)(1) requires.
    - EU AI Act entries are internal policies labelled **"no legal safe harbour"**.
    - Caveats are timeless; time-sensitive status is a dated note that is not frozen into results (section 10).
11. **One output shape in three new contract versions**: engine report 1.3, hosted run 1.4 and external run 1.5. A version number is never reused.
    - Every result carries a `decision` object.
    - The existing headline metric names are kept.
    - The run outcome aggregates the confirmatory criteria and the results this specification does not govern, never exploratory criteria.
    - The external worker copies the engine's decisions instead of re-deciding (sections 11 and 12).
12. **What the hosted runner mirrors.** It mirrors every analytic part exactly: intervals, p-values, Fisher, the family adjustments, minimums, plan normalisation and hashing, legacy derivation, power and the library. Bootstrap, clustered data, score-based calibration and the mean baseline gate in regression power stay engine-only (section 12).
13. **Verification.**
    - All 58 golden cases are recomputed by a standard-library reference.
    - They are then recomputed again, independently, with scipy, statsmodels, numpy, jsonschema and Node.js: 2,154 checks with 0 discrepancies, including a second, separately written legacy derivation, the chance gate, the mean baseline gate and the cluster bootstrap of the four clustered cases.
    - A mutation test confirms that the cross-check catches each of 41 deliberately corrupted values.
    - Exact enumeration confirms the false-fail figures of section 6 and the chance gate of section 5.2. Monte Carlo runs confirm interval coverage and the power formulas (section 13.3).

**Where this design departs from the issue text** (each departure is also a question decided in section 15):

- **Multiplicity.** The issue asked for Holm on the confirmatory family. This design uses Bonferroni there, because Holm's step-down is not valid for data-dependent pass/fail claims on one dataset (section 6, Q9). BH is kept for the exploratory family.
- **Ratios.** The issue asked for Katz-log. Katz-log is kept, but it is incomputable when a group has zero selections and has zero width when everyone is selected. In those cases the design falls back to the Koopman score interval, following Fagerland, Lydersen & Laake (2015).
- **Small cells.** Fisher was chosen over Boschloo.
- **Bootstrap.** Phase 1 uses the percentile bootstrap only, not BCa.
- **Extra metrics.** Specificity, F1, macro precision, multiclass and regression interval methods are specified even though the issue did not list them. #22 has to report an interval for every headline and descriptive metric.

## 2. Problem and current state

### 2.1 Why point estimates are not enough

- **Small sample.** 6 of 20 selected against 10 of 20 gives an impact ratio of 0.60, which "fails" the four-fifths screen. Yet Fisher's exact p = 0.3332 and the Katz 95% interval is 0.2696–1.3355 (GC-08, GC-36).
- **Large sample.** 22,500 of 50,000 against 25,000 of 50,000 gives a ratio of 0.90 with interval 0.8883–0.9118: a precisely measured 10% disparity that a 0.8 screen passes. A pre-registered parity band of ±0.02 fails it (GC-09).
- **The law asks for thresholds set in advance.** Article 9(8) of the AI Act requires testing "against prior defined metrics and probabilistic thresholds" ([Art. 9](https://artificialintelligenceact.eu/article/9/)).
- **US guidance says the same about small numbers.** The Uniform Guidelines warn that large differences "based on small numbers" may not constitute adverse impact if not statistically significant ([29 CFR 1607.4(D)](https://www.law.cornell.edu/cfr/text/29/1607.4)).

### 2.2 What the code does today (checked on `main@582657f`; locate code by the quoted identifiers)

| Topic | Hosted runner (`site-app/lib/diagnostics.ts`, `evaluation.ts`) | Engine (`engine/diagnostics.py`, `engine/assurance.py`) | External worker projection (`engine/worker_contract.py`) |
|---|---|---|---|
| Intervals | None. The limitation text in `evaluate()` says "No confidence intervals are estimated." | `wilson()` at `CONFIDENCE = 0.95` on accuracy, precision, recall and per-group rates. The headline demographic-parity (DP), disparate-impact (DI) and equalized-odds (EO) figures have no interval. | Copies the engine's metrics, intervals included, but decides without them. |
| Decision | `atLeast`/`atMost` compare the point estimate with the threshold, using a 1e-12 tolerance | `evaluate()` compares `m["value"]` with `threshold`. `result()` cannot pass while any of its metrics lacks a threshold. | `hosted_results()` re-decides every selected test. It keeps the metrics whose `threshold is not None`, and `accepted()` compares each point estimate with its threshold. |
| Fairness statistics | DP gap = max − min selection rate; DI = min/max; EO = max(TPR range, FPR range) | Same definitions (`fairness()`) | The engine's, renamed through `METRIC_ALIASES` |
| Minimums | `minimumSampleSize ?? 20`, `minimumClassCount ?? 5`, `minimumGroupSize` set in config, with 2 allowed (`configSchema`) | Defaults `minSampleSize` 30, `minGroupSize` 30, `minClassCount` 10; `validate_config` accepts any value ≥ 2 | Hosted values again. `translate_config()` passes `minSampleSize` (default 20), `minClassCount` = max(2, configured; default 5) and `minGroupSize` as configured. `hosted_results()` then applies `minimumSampleSize` 20 and `minimumClassCount` 5 a second time, and adds a separate projection for a minimum class count of one. |
| Small groups | Any group under the minimum makes the test inconclusive | The same, in `fairness()`. In `intersectional_slices`, one small stratum voids the whole result. | Any group under `minimumGroupSize` makes the test inconclusive |
| Bootstrap | None | `bootstrap_interval` and `intersectional_slices`: seeded percentile bootstrap (`random.Random(seed)`). `_bootstrap_protocol` accepts 100–2000 replicates and requires rows × replicates ≤ `MAX_BOOTSTRAP_WORK` (5,000,000). The bootstrap does not feed the outcome; there, "pass" means only that an interval could be estimated. | None |
| Multiplicity and power | None | None. The drift details state this. | None |
| Run outcome | `executeRun` in `site-app/lib/commands/runs.ts` aggregates every result | `run()` and `engine/contract.py` `validate_report` aggregate every result | `importJob` in `site-app/lib/commands/assurance/execution.ts` aggregates every `hostedResults` entry into the compiled 1.2 run, as do `schemas/generate-external-fixtures.py` `project()` and `schemas/validate-run-schema.mjs` |
| Worker result intake | – | – | `resultEnvelope` in `site-app/lib/assurance-core.ts` allows at most 100 metrics per result and metric names of at most 300 characters. On completion, `site-app/app/api/runner/route.ts` requires the `hostedResults` test ids to equal the profile's suite. |

The three paths report different evidence for the same test, and all three decide from point estimates. This specification replaces them with one decision path:

- The engine decides.
- The hosted runner mirrors the engine exactly.
- The worker projection copies the engine's decisions and never re-decides (sections 12 and 14, E4).

## 3. Concepts

- **Plan.** The pre-registered statistical part of an evaluation profile or engine configuration: the confidence level, the minimums and a list of criteria (section 9). It is frozen when the profile is approved, and any change creates a new profile version. A profile without a stored plan derives one deterministically.
- **Criterion.** One test with one outcome, for example the `disparate_impact` result.
  - It has a `kind`: `performance`, `group_comparison`, `calibration`, `multiclass_performance` or `regression_performance`.
  - It has a `role`, either `confirmatory` (the default) or `exploratory`.
  - It has zero or more **members**. Zero occurs only in a derived plan whose policy sets no threshold; such a criterion is inconclusive with `no_threshold`.
- **Member.** One estimate compared with one band. Examples are "recall ≥ 0.70" and "selection-rate ratio of B vs A within [0.8, 1.25]". A member has:
  - an estimate and an interval;
  - a status: `evaluated`, `undefined`, `insufficient_support` or `suppressed`;
  - a direction: `pass`, `fail` or `none`;
  - a decision p-value.
- **Descriptive entry.** A metric reported with an estimate and an interval but no band: band null, direction `none` and p-value null. It never decides and is not counted in m (section 4.8).
- **Band.** The acceptable region `{lower, upper}`. Either bound may be absent, and present bounds are inclusive. Allowed bands:

| Metric type | Allowed band | Validation |
|---|---|---|
| Proportions and scores in [0, 1]: accuracy, precision, recall, specificity, FPR, balanced accuracy, F1, macro F1, macro precision | `{lower: t}` or `{upper: t}` or both | each bound strictly inside (0, 1); with both, lower < upper |
| Difference of rates in `all_pairs` mode: selection rate, TPR, FPR; calibration gap | `{lower: −δ, upper: δ}` | 0 < δ < 1 |
| Difference of rates in `reference` mode | symmetric, or `{lower: −δ}`, or `{upper: δ}` | 0 < δ < 1 |
| Ratio of selection rates in `all_pairs` mode | `{lower: τ, upper: 1/τ}` | 0 < τ < 1 |
| Ratio in `reference` mode | `{lower: τ, upper: 1/τ}` or `{lower: τ}` | 0 < τ < 1. A ratio cannot have an upper bound only. |
| Error metrics: MAE, RMSE, Brier | `{upper: t}` | t > 0 |

New plans with an invalid band MUST be rejected. A plan derived from a frozen legacy configuration keeps the mapped band, and that criterion evaluates as inconclusive with reason `invalid_band`. Two examples: `minimumImpactRatio: 1` maps to the zero-width band [1, 1], and an engine policy `balanced_accuracy <= 0.4` maps, beside the chance baseline, to [0.5, 0.4] (section 9.3).

- **Family.** The set of criteria in one plan run that share a role. The confirmatory family is adjusted with Bonferroni, the exploratory family with BH.

## 4. Decision rule (normative)

### 4.1 Intervals as functions of the critical value

Every interval method in section 5 is a function `CI(z) = [L(z), U(z)]` of the normal critical value z ≥ 0. As z grows, the interval widens and stays nested. `CI(0)` collapses to the method's centre, which is the point estimate for every analytic method in this document.

The reported interval uses `z = Φ⁻¹(1 − α/2)`, where `α = 1 − confidenceLevel`. The confidence level is set per plan to 0.90, 0.95 (the default) or 0.99. With the default, z = 1.959963984540054.

### 4.2 Direction and decision p-value

1. **Direction.**
   - `none` if the estimate is on a band bound, meaning `|θ̂ − b| ≤ 1e−12·max(1, |b|)`.
   - Otherwise `fail` if θ̂ lies outside the band, and `pass` if it lies inside.
2. **Inversion.**
   - For a pass: `z* = sup{z ∈ [0, 37] : CI(z) ⊆ band}`, with inclusive bounds.
   - For a fail: `z* = sup{z ∈ [0, 37] : CI(z) ∩ band = ∅}`, with strict inequalities.
3. **Decision p-value.** `p = erfc(z*/√2) = 2·(1 − Φ(z*))`. Direction `none` gives p = 1.

Consequently `p ≤ α` holds exactly when the reported (1 − α) interval lies inside the band (pass) or outside it (fail).

The error rate of one claim depends on its kind:
- **Pass claims, and fail claims under a one-sided band**, are made at an error rate of at most α/2. This is the convention of equivalence testing with two one-sided tests ([Schuirmann 1987](https://doi.org/10.1007/BF01068419)).
- **Fail claims under a two-sided band** can be made on either side of the band, because the interval can lie wholly above or wholly below it. Their error rate is therefore at most α, not α/2 (section 6).

**Computing z\*.** For methods that are themselves score-test inversions, runners MUST use the closed forms below. The reference implementation asserts that they agree with bisection to 1e−8.

| Method | Closed-form z\* for a band bound b |
|---|---|
| Wilson | `\|p̂ − b\| / sqrt(b(1 − b)/n)` (the score statistic). A bound ≤ 0 or ≥ 1 is vacuous. |
| Katz-log | `\|ln r̂ − ln b\| / SE`, with `SE = sqrt(1/x₁ − 1/n₁ + 1/x₂ − 1/n₂)` |
| Koopman | `\|z_K(b)\|`, the Koopman statistic at b (section 5.6) |
| Normal approximation (MAE, MSE, Brier) | `\|m − b\| / SE`. RMSE uses MSE against b². |
| Jaccard–Wilson (F1) | Wilson z\* for TP out of TP + FP + FN, against `b/(2 − b)` |

For a pass with two bounds, `z* = min(z*_lower, z*_upper)`. For a fail, use the bound on the side where the estimate lies.

The composite methods (Newcombe, MOVER and the Bonferroni macro intervals) MUST use bisection, as follows:

1. Set lo = 0 and hi = 37.
2. While hi − lo > 1e−12: set mid = (lo + hi)/2. If the property holds at mid, set lo = mid; otherwise set hi = mid.
3. Return z\* = lo.

A claim is made when `p ≤ α + 1e−12`.

### 4.3 From members to a criterion

Let the **pool** be the members that are not `suppressed`, and **E** the pool members with status `evaluated` (m = |E|). Descriptive entries are never in the pool.

1. **No usable evidence.** If the criterion is gated (`sampleSize` below `minimums.sampleSize`), has no members, or E is empty: direction `none`, P = 1.
2. **Fail evidence.** Otherwise, if any member of E has direction `fail`: direction is `fail`, and `P = min(1, m · min p_fail)`. This is Bonferroni within the criterion. "Some comparison is outside the band" is a union claim, and the false-claim rate needs union control.
3. **Pass evidence.** Otherwise, direction is `pass` if any member of E points to pass, and `none` if every member of E sits on a bound.
   - P = max p_pass over the pool, but only if every pool member is evaluated and points to pass, and no pass gate applies (section 4.4). Otherwise P = 1. A chance-gated member's p_pass already includes its exact test (section 5.2).
   - "Every comparison is inside the band" is an intersection–union test. It has size α when each component test has size α, so no adjustment is needed or applied ([Berger 1982](https://doi.org/10.2307/1267823)).
4. `unadjustedOutcome` = direction when P ≤ α, otherwise `inconclusive`.
5. `decidingMemberId`:
   - For a fail, the member with the smallest p_fail.
   - For a pass whose P comes from rule 3, the member with the largest p_pass.
   - Ties are broken by the smallest memberId in code-point order.
   - Otherwise it is null: no usable evidence, direction `none`, or a pass blocked by a gate or an unevaluated pool member (GC-07, GC-16).

A `performance` criterion uses the same rule on heterogeneous members. "Accuracy ≥ 0.90, recall ≥ 0.70 and balanced accuracy ≥ 0.50" passes only if all three pass, and fails if any one fails after Bonferroni over the evaluated members.

### 4.4 Gates and reason codes

| Reason code | Where | Effect |
|---|---|---|
| `below_minimum_sample_size` | criterion; also accuracy and regression members | `sampleSize` < `minimums.sampleSize`: P = 1, no claim either way. A member whose denominator is the row count is `insufficient_support`. |
| `undefined_zero_denominator` | member | A zero denominator that is not a class count: precision with no predicted positives, a ratio whose comparator count is 0, R² with a constant target, macro precision with a class never predicted. The member is `undefined`, p = 1, and it blocks a pass. |
| `single_class` | member | The zero denominator is a class count: recall, specificity, FPR, balanced accuracy or F1 with a class absent; a TPR or FPR member whose group has no positives or no negatives; a multiclass class with no support; multiclass data with fewer than two classes (macro recall, macro F1 and macro precision). The member is `undefined` and blocks a pass. |
| `below_minimum_class_count` | member | A class-conditional denominator is below `minimums.classCount`. The member is `insufficient_support`, p = 1, and it blocks a pass. |
| `group_suppressed_below_minimum` | criterion | A group (or calibration bin) has fewer than `minimums.groupSize` rows. It is listed in `suppressedGroups`, and coverage falls. |
| `group_below_minimum_size` | member | A member of a suppressed group. It is reported descriptively and never decides. |
| `insufficient_coverage` | criterion | Coverage is below `minimumCoverage`. A pass is blocked; a fail stays possible. |
| `empty_declared_group` | criterion | A declared group has no rows. A pass is blocked. |
| `insufficient_groups` | criterion | Fewer than two eligible groups, or the reference group is ineligible. A pass is blocked, and no member can fail. |
| `too_many_groups` | criterion | More than 50 groups in `all_pairs` mode, or more than 1,000 in `reference` mode. No members are formed, and the criterion is inconclusive. Per-group rates are still reported. |
| `small_cell_exact_test_not_significant` | criterion | When any 2×2 cell is under 5 and the direction is fail, p_fail = max(p_interval, p_Fisher). The code is recorded when this alone prevents the fail. |
| `chance_exact_test_not_significant` | criterion | A balanced-accuracy member under the chance gate points to pass, and p_pass = max(p_interval, `chanceExactP`) (section 5.2). The code is recorded when the gate alone prevents the pass: every pool member's interval lies inside its band, yet P > α. |
| `mean_baseline_not_beaten` | criterion | A regression criterion has no failing member, and the mean baseline gate does not reject: the model's MSE is not shown to be below the mean-prediction baseline's (section 5.9). A pass takes p_pass = max(P, gate p), so the gate blocks it; a fail stays possible through the members. The runners add a limitation naming the model's RMSE and the baseline RMSE. |
| `interval_straddles_band` | criterion | No claim: the interval straddles the band. |
| `within_criterion_multiplicity` | criterion | A member's own p ≤ α, but m·p > α. |
| `multiplicity_adjustment` | criterion | The family adjustment removes a claim. |
| `estimate_on_band_boundary` | member | The estimate is exactly on a bound; member p = 1. |
| `degenerate_interval` | member | Zero-variance errors (MAE, RMSE). The member is `undefined`. |
| `no_threshold` | criterion | The plan gives this criterion no member and no band, because its derived legacy policy sets no threshold that 1.0.0 can decide. The criterion is inconclusive, and all its metrics are descriptive. |
| `undecidable_metric` | criterion; descriptive entry | The criterion's `passBlockedBy` names a metric that today's engine rule makes a pass depend on but that 1.0.0 cannot decide by an interval: R² for `PERF-REG` or ECE for `PERF-CAL`, in a plan derived from engine thresholds (section 4.8). That metric is reported as a descriptive entry carrying the code, with its legacy threshold, if any, shown and not applied. A pass is blocked; a fail stays possible through the members. |
| `invalid_band` | criterion | A derived legacy band violates section 3. The criterion is inconclusive. |
| `interval_requires_engine`, `clustered_design_requires_engine` | criterion (hosted) | The hosted runner cannot compute the required interval (score columns, cluster designs) and returns inconclusive. Today the hosted runner rejects a plan with a `clusterField` when it is validated, so no hosted run of a clustered plan exists and `clustered_design_requires_engine` stays reserved (section 5.11). |
| `bootstrap_insufficient_valid_replicates`, `bootstrap_budget_exceeded`, `small_cell_clustered`, `below_minimum_cluster_count` | member (engine) | See section 5.11. A member with `small_cell_clustered` makes no claim (p = 1); the criterion then records the code instead of `interval_straddles_band`. |

No golden case produces `too_many_groups`, `invalid_band`, `interval_requires_engine`, `clustered_design_requires_engine`, `bootstrap_insufficient_valid_replicates` or `bootstrap_budget_exceeded`. They appear only in runner output; the engine tests pin the two bootstrap codes (`engine/tests/test_cluster_bootstrap.py`). `no_threshold` is pinned by GC-45, `undecidable_metric` by GC-48, `chance_exact_test_not_significant` by GC-50 and GC-51, `mean_baseline_not_beaten` by GC-48, GC-52 and GC-53, and `small_cell_clustered` and `below_minimum_cluster_count` by GC-56. The power reason codes are listed in section 8.

Gates never hide numbers. Every member whose estimate is defined still reports its estimate and interval, including suppressed and insufficiently supported members, so the auditor can see how uncertain the evidence is.

### 4.5 Family adjustment and outcome

The criterion P-values in each family are adjusted (section 6): Bonferroni for confirmatory criteria, `min(1, F·P)` with F the confirmatory family size, and BH for exploratory ones. The final `outcome` equals the direction when the adjusted P ≤ α, and is `inconclusive` otherwise.

### 4.6 Run outcome

The run outcome aggregates two sets of results:
- the criteria whose `decision.role` is `confirmatory`;
- the results this specification does not govern, which carry no `decision`: drift (Q6), capabilities unavailable in the runner, and suites that are not applicable.

The aggregation is `fail` if any of them fails, else `inconclusive` if any is inconclusive, else `pass` if any passes, else `not_applicable`. This matches today's aggregation and never defaults to pass.

Exploratory criteria never change the run outcome. Each failing exploratory criterion is listed in the run's `reviewFlags` for the auditor.

### 4.7 Headline metric and interval

Group and calibration criteria report one headline, the worst member, so that existing displays keep a single number. The headline keeps each runner's existing metric name (section 11).

- **Two-sided difference band:** the largest |difference|. The interval's lower bound is the largest member lower |d|-bound at the Bonferroni level α/m. The upper bound is the largest member upper |d|-bound at the nominal level. For a member interval [L, U], the lower |d|-bound is `max(0, L, −U)` and the upper is `max(|L|, |U|)`. The headline band is `{upper: δ}`.
- **Two-sided ratio band:** the same construction on |ln r|, reported as the smallest ratio folded below 1, `min(r, 1/r)`. Its upper bound never exceeds 1, and the headline band is `{lower: τ}`. In `all_pairs` mode the value is min/max.
- **One-sided difference band (reference mode):** the largest gap in the constrained direction. That is `max(−d)` for `{lower: −δ}` and `max(d)` for `{upper: δ}`, so the headline band is always `{upper: δ}`. The pass side uses nominal bounds and the fail side Bonferroni bounds.
- **One-sided ratio band (reference mode):** the smallest ratio, with band `{lower: τ}`. Its value can exceed 1.
- **Missing pass-side bound:** if a pool member is not evaluated, the bound becomes the statistic's natural limit: 1 for a gap and 0 for a ratio. This is valid but uninformative and keeps the existing `confidenceInterval` shape numeric.

The pass side needs no adjustment because the population worst case is attained at one fixed (unknown) pair. The fail side needs the union bound. The headline interval therefore covers the population worst case with probability of approximately 1 − α (Appendix A.3):
- at least 1 − α, up to the member intervals' own coverage error, when the criterion has one member or every true difference is 0;
- at least 1 − (3/2 − 1/(2m))·α in general, by the union bound, which is loose unless the worst true difference is near 0.

The simulations in section 13.3 give at least 0.943 over 2, 3 and 5 groups, the lowest being Newcombe's own coverage at d = 0, and 0.983 for 3 groups at 0.50, 0.45 and 0.40.

Before the small-cell gate and family adjustment, a criterion passes exactly when its headline interval is inside the headline band and fails exactly when it is outside. `method` is `worst_member_bounds`.

### 4.8 Descriptive metrics

Each criterion kind has a standard metric set, shown in the table below. Every metric of that set that the plan does not make a member is reported as a **descriptive entry**:
- It has an estimate and an interval, by the method in the section 5 table, at the plan's confidence level.
- Its band is null, its direction `none` and its p-value null.
- Its status is computed as for a member (`evaluated`, `undefined` or `insufficient_support`), so the auditor sees the support.
- It is not in the pool, does not count in m, never decides and is not adjusted.

| Criterion kind | Standard metric set (members first, the rest descriptive) |
|---|---|
| `performance` (binary) | accuracy, precision, recall, specificity, balanced accuracy, F1. FPR is available as a member only, since it equals 1 − specificity. |
| `multiclass_performance` | accuracy, balanced accuracy (macro recall), macro precision, macro F1 |
| `regression_performance` | MAE, RMSE, R², and the baseline RMSE (`baseline_rmse`, always descriptive, after R²). R² is always descriptive: the engine gives a bootstrap interval, and the hosted runner gives no interval. In a criterion derived from engine thresholds, R² also blocks a pass (rule 2 below). Every regression criterion carries the mean baseline gate (section 5.9). |
| `calibration` (engine) | Brier score and expected calibration error (ECE), descriptive unless the plan makes Brier a member. ECE always gets a bootstrap interval (section 5.11). In a criterion derived from engine thresholds, ECE also blocks a pass (rule 2 below). |
| `group_comparison` | none. Per-group rates with Wilson intervals are reported in the headline's `slices` (section 11). |

**Legacy rule.** Today the engine's `result()` cannot pass while any of its metrics lacks a threshold. Under 1.0.0, a metric without a band is descriptive and does not block a pass. A **degenerate model** here is one whose output does not depend on the truth: a constant prediction, or predictions drawn independently of the label. Three derivation rules (section 9.3) keep the change from letting such a model pass.

1. **Chance baselines.** Every derived classification criterion that has a member includes a balanced-accuracy member. Its lower bound is the larger of chance and the policy's own lower bound b on that metric (engine `balanced_accuracy`, or `macro_recall` for multiclass):
   - binary data: `max(0.5, b)`;
   - multiclass data: `max(1/k, b)`, where k is the number of labels that occur in the target column of the evaluated rows, and at least 2;
   - a policy upper bound on the metric is kept as the member's upper bound.

   For a degenerate model, the recall of class c is P(ŷ = c | y = c) = P(ŷ = c), so its population balanced accuracy is Σ_c P(ŷ = c) / k = 1/k when it predicts only labels that occur in the target, and 0.5 for binary data. A prediction outside those labels leaves a class without support, which makes macro recall undefined (`single_class`) and blocks a pass. The baseline member's population value therefore lies on its bound, or below it when the policy's bound is higher.
   - **The interval alone is not enough.** Its one-sided non-coverage is near α/2 only when every class is predicted often. When a class is predicted only a few times, Wilson's lower limit is anti-conservative, and exact enumeration shows a degenerate model passing up to 12% of the time (section 5.2).
   - **So the member carries the chance gate** (section 5.2). It passes only if Fisher's exact test also rejects independence of prediction and truth. That test is exact at every sample size, so a degenerate model passes the member with probability at most α/2, whatever the design and however rarely it predicts a class. Exact enumeration gives at most 0.022 over the designs of section 5.2.
   - A constant model's estimate is exactly chance, 1/k or 0.5, so it sits on the bound (`estimate_on_band_boundary`), or below it, and never passes.
   - A criterion passes only if every member passes, so these bounds hold for the criterion (GC-06, GC-46, GC-47, GC-50, GC-51).
2. **Metrics that cannot be decided.** R² and ECE have no interval that decides in 1.0.0, yet today's rule makes a pass depend on them. So a criterion derived from engine thresholds lists them in `passBlockedBy`, whether or not the policy sets their threshold: `PERF-REG` gets `["r2"]` and `PERF-CAL` `["expected_calibration_error"]`. Such a criterion never passes (`undecidable_metric`), and it can still fail on its MAE, RMSE or Brier members (GC-48). An explicit 1.3 plan has no `passBlockedBy`, because the auditor then chooses the members.
3. **No threshold.** A criterion whose policy sets no threshold that 1.0.0 can decide has no members and is inconclusive with `no_threshold`. So such a policy still never passes, as today (GC-45).

The consequences for performance and calibration criteria, compared with today's rules on the same data:
- **Hosted-derived criteria** pass only where today's hosted rule would also pass. Their members are today's criteria, decided by the interval instead of the point estimate, plus the chance baseline, at higher minimums.
- **Engine-derived classification criteria** can now pass without a threshold on every metric. This is the intended change, and the chance baseline with its gate keeps degenerate models out.
- **Engine-derived regression and calibration criteria** never pass in 1.0.0. Today they pass only when R² or ECE meets its threshold by point estimate, and 1.0.0 never decides by point estimate.

**Explicit hosted plans (decided 6 November 2026, extending D-19 from derived criteria to explicit plans).** Without a baseline, an accuracy-only explicit plan passes a constant predictor, the F-06 failure that #15 fixed for derived plans. So an explicit hosted performance criterion also carries the chance baseline:
- **Binary.** Normalisation of a hosted 1.1 profile inserts `balanced_accuracy ≥ 0.5` after the written members unless the criterion's `rationale` records why the baseline is left out. A written balanced-accuracy bound below 0.5 also needs a rationale.
- **Multiclass.** The baseline is macro recall above 1/k, and k is not known when a plan is written by hand, so a multiclass criterion without a balanced-accuracy member and without a rationale is rejected. The testing lab's plan step fills 1/k from the number of classes in the registered dataset's reference column.
- **Display.** The plan the approval screen shows lists every member, so a criterion without the baseline, and its rationale, are visible before approval.

Engine 1.3 configurations are taken as written; the chance gate applies to them as to every plan (section 5.2).

GC-38 and GC-49 pin descriptive entries and the derived plans of legacy hosted profiles. Every performance-kind golden case also carries its descriptive entries.

**Supplementary descriptive entries (`traditional-ml-2.1.0`, #65).** Engine reports add, after the standard set, `prevalence` (binary: reference rows of the performance positive class over all rows) and `majority_baseline_accuracy` (the most frequent reference class over all rows), each with a Wilson interval and the descriptive shape above, and put a per-class table (`slice`, `support`, `predicted`, `tp`, `recall`, `precision`, `f1`) in the `slices` of the balanced-accuracy entry. They keep the descriptive evidence of hosted `traditional-ml-2.1.0` results in external reports; a hosted 1.4 result does not carry them (section 9.3, reconciliation with #15). They are never members and are outside the golden cases' core level. The majority-class baseline decides nothing here: the chance baseline replaces it (section 5.2).

## 5. Per-metric specification

Notation: TP, FP, FN, TN are counts; positives P = TP + FN; negatives N = FP + TN; n = rows. `wilson(x, n, z)` is defined in section 5.1.

| Metric (id) | Estimator | Interval | z\* | Small-cell rule | Minimum support (denominator) | Undefined when |
|---|---|---|---|---|---|---|
| accuracy | (TP+TN)/n | Wilson | closed | – | n ≥ 30 | n = 0 |
| precision | TP/(TP+FP) | Wilson | closed | – | TP+FP ≥ 10 | TP+FP = 0 (`undefined_zero_denominator`) |
| recall (TPR) | TP/P | Wilson | closed | – | P ≥ 10 | P = 0 (`single_class`) |
| specificity (TNR) | TN/N | Wilson | closed | – | N ≥ 10 | N = 0 (`single_class`) |
| false_positive_rate | FP/N | Wilson | closed | – | N ≥ 10 | N = 0 (`single_class`) |
| balanced_accuracy | (TP/P + TN/N)/2 | MOVER-Wilson | bisection | chance gate on a pass when the lower bound is ≥ 0.5 (section 5.2) | P ≥ 10 and N ≥ 10 | P = 0 or N = 0 |
| f1 | 2TP/(2TP+FP+FN) | Wilson on J = TP/(TP+FP+FN), mapped by F1 = 2J/(1+J) | closed | – | P ≥ 10 | P = 0 |
| selection rate (per group) | (TP+FP)/n_g | Wilson (reported in slices, not a criterion) | – | – | n_g ≥ 30 | n_g = 0 |
| selection_rate_difference (demographic-parity difference) | SR_subject − SR_comparator | Newcombe hybrid score | bisection | Fisher gate | both groups ≥ 30 | a group with no rows |
| selection_rate_ratio (demographic-parity ratio and impact ratio) | SR_subject / SR_comparator | Katz-log; Koopman when the subject count is 0 or both groups are fully selected | closed | Fisher gate | both groups ≥ 30 | comparator rate = 0 |
| tpr_difference, fpr_difference (equalized-odds members) | rate difference within positives (TPR) or negatives (FPR) | Newcombe | bisection | Fisher gate | TPR: P_g ≥ 10 in both groups; FPR: N_g ≥ 10 in both groups (groups ≥ 30) | P_g = 0 (TPR) or N_g = 0 (FPR) (`single_class`) |
| calibration_gap (engine) | ȳ_b − s̄_b per probability bin | Wilson on ȳ_b, shifted by s̄_b | closed | – | n_b ≥ 30 (bins under 30 suppressed) | n_b = 0 |
| expected_calibration_error (engine, descriptive) | Σ (n_b/n)·\|ȳ_b − s̄_b\| | percentile bootstrap | – (never decides) | – | – | no scored rows |
| brier_score (engine) | mean (s − y)² | normal approximation | closed | – | n ≥ 30 | zero variance (`degenerate_interval`) |
| macro_f1 (multiclass) | mean of per-class F1 | per-class Jaccard–Wilson at α/k, averaged (Bonferroni) | bisection | – | every class support ≥ 10 | a class has no support, or fewer than two classes (`single_class`) |
| macro_precision (multiclass) | mean of per-class precision | per-class Wilson at α/k, averaged (Bonferroni) | bisection | – | every class predicted ≥ 10 times | fewer than two classes (`single_class`); a class is never predicted (`undefined_zero_denominator`) |
| balanced_accuracy (multiclass macro recall) | mean of per-class recall | MOVER-Wilson over k classes | bisection | chance gate on a pass when the lower bound is ≥ 1/k (section 5.2) | every class support ≥ 10 | a class has no support, or fewer than two classes (`single_class`) |
| mae, rmse | mean \|e\|; sqrt(mean e²) | normal approximation (RMSE via MSE) | closed | – | n ≥ 30 | zero variance (`degenerate_interval`) |
| r2 (descriptive) | 1 − SSE/SST | engine percentile bootstrap; hosted: none | – | – | n ≥ 30 | SST = 0 (`undefined_zero_denominator`) |
| baseline_rmse (descriptive) | sqrt(SST/n), the RMSE of predicting the mean of the evaluated targets | none | – | mean baseline gate on every regression pass (section 5.9) | n ≥ 30 | SST = 0, no targets or n < 2 (`undefined_zero_denominator`) |

### 5.1 Wilson interval (proportions)

For x successes in n trials and critical value z:

```
p = x/n,  d = 1 + z²/n,  c = (p + z²/(2n))/d,  h = z·sqrt(p(1−p)/n + z²/(4n²))/d
L = 0 if x = 0 else max(0, c − h);   U = 1 if x = n else min(1, c + h)
```

This is exactly today's `engine/diagnostics.py` `wilson()` generalized to any z ([Wilson 1927](https://doi.org/10.1080/01621459.1927.10502953)). [Brown, Cai & DasGupta (2001)](https://doi.org/10.1214/ss/1009213286) recommend Wilson for small n. Golden examples: GC-01 (40/50 → [0.6696, 0.8876]), GC-04 (0/40 → [0, 0.0876]), GC-05 (30/30 → [0.8865, 1]).

### 5.2 Balanced accuracy and macro recall (MOVER), and the chance gate

TPR and TNR are estimated on disjoint rows and are independent given the class counts. For the mean of k independent proportions p_i with Wilson limits (l_i, u_i), the MOVER interval ([Zou & Donner 2008](https://doi.org/10.1002/sim.3095)) is:

```
L = mean − sqrt(Σ (p_i − l_i)²)/k,   U = mean + sqrt(Σ (u_i − p_i)²)/k
```

Use k = 2 for binary balanced accuracy and k = number of classes for multiclass macro recall. Simulated coverage is 0.9509 with 60 positives at a TPR of 0.7 and 340 negatives at a TNR of 0.9 (section 13.3). When a class's count is 1 to 3 the interval is anti-conservative, as shown below.

**The chance baseline.** The majority-baseline check of #15 is the member `balanced_accuracy ≥ 0.50`, and its multiclass form is macro recall ≥ 1/k. Derived plans always carry this chance baseline (section 4.8). A model whose predictions do not depend on the truth has balanced accuracy exactly 0.5, or macro recall exactly 1/k.
- A constant predictor sits exactly on the bound and can never pass (GC-06, GC-46).
- A predictor that draws its predictions at random must not pass more often than α/2. The interval alone lets it pass more often when a class is predicted only a few times.
  - A pass of `balanced_accuracy ≥ 0.5` is exactly "Newcombe's lower bound for TPR − FPR is at least 0".
  - A rarely predicted class puts its recall at 1 to 3 successes, where Wilson's lower limit is anti-conservative. For 1/100 it is 0.00177, while P(X ≥ 1 | n = 100, p = 0.00177) = 0.16.

Exact enumeration (`--enumerate`, section 13.3) takes a binary predictor that says "positive" with probability q whatever the label. The table gives the largest pass probability over q of the member `balanced_accuracy ≥ 0.5` alone, and the q where it occurs:

| Positives / negatives | Interval only | With the chance gate |
|---|---|---|
| 100 / 1,900 | 0.0708 (q = 0.0013) | 0.0199 (q = 0.48) |
| 50 / 950 | 0.0708 (q = 0.0025) | 0.0181 (q = 0.29) |
| 10 / 1,000 | 0.1107 (q = 0.014) | 0.0165 (q = 0.67) |
| 20 / 5,000 | 0.1215 (q = 0.0070) | 0.0190 (q = 0.50) |
| 30 / 30 | 0.0260 (q = 0.50) | 0.0137 (q = 0.50) |
| 100 / 100 | 0.0280 (q = 0.50) | 0.0200 (q = 0.50) |
| 300 / 700 | 0.0281 (q = 0.026) | 0.0216 (q = 0.49) |

- **GC-47's derived plan** (accuracy ≥ 0.90 and balanced accuracy ≥ 0.5), at 100/1,900 and q = 0.00125: the pass probability is 0.0708 with the interval alone and 0.0057 with the gate. GC-50 is one of the tables that pass the interval: TP 1, FP 0, FN 99, TN 1,900 passes it at p = 0.0041, although Fisher's exact test of that table gives 0.05.
- **GC-46's derived plan**, for three classes with supports 40/1,900/60 and predictions drawn with probabilities 0.001/0.998/0.001: 0.0757 with the interval alone and 0.0036 with the gate. GC-51 is one of its passing tables, [[1, 39, 0], [0, 1900, 0], [0, 60, 0]].

**The chance gate.** A balanced-accuracy member whose band has a lower bound at or above chance carries an exact test of independence of prediction and truth. Chance is 0.5 for binary data and 1/k for k classes.
- **Binary.** p_one = P(X ≥ TP) for X ~ Hypergeometric(n, P, TP + FP). This is the one-sided Fisher exact p for positive association in the 2×2 table of truth against prediction, given its margins.
- **Multiclass.** Each class c has a one-vs-rest table with p_c = P(X_c ≥ TP_c) for X_c ~ Hypergeometric(n, support_c, predicted_c), where predicted_c counts the rows predicted as c.
  - With k ≥ 3 classes, p_one = k · min_c p_c, Bonferroni over the classes.
  - With k = 2 the two tables are the same table, and p_one is its p.
- **`chanceExactP`** = min(1, 2·p_one). This puts the test on the two-sided scale of section 4.2, so p ≤ α means p_one ≤ α/2.
- **Use.** When the member points to pass, its p_pass is max(p_interval, `chanceExactP`). Fails are not gated (section 6).
- **Reporting.** `chanceExactP` is reported on every such member whose estimate is defined, including one that is not evaluated or sits on its bound. It is null on every other metric and descriptive entry. The criterion records `chance_exact_test_not_significant` when the gate alone prevents a pass (section 4.4; GC-50, GC-51).
- **Scope.** Explicit plans get the gate too, because it depends only on the member's metric and bound.

**Why it holds.** If predictions are independent of the truth, each table is hypergeometric given its margins. Fisher's one-sided test is then valid at every sample size: P(p_one ≤ α/2) ≤ α/2 for binary data, and for k classes at most k · α/(2k) = α/2 by the union bound. Since p_pass ≥ `chanceExactP`, the member passes with probability at most α/2, whatever the design, the prediction rates or how rarely a class is predicted. The gate tests only what a pass claims anyway:
- balanced accuracy above 0.5 means TPR > FPR;
- macro recall above 1/k means Σ_c TPR_c > 1 ≥ Σ_c P(ŷ = c), so for some class c, P(ŷ = c | y = c) > P(ŷ = c), which is positive association in that class's table.

**Cost.** The gate binds only near chance. In every golden case whose balanced-accuracy member points to pass, `chanceExactP` is below 1e−112, except in GC-50 (0.10) and GC-51 (0.12). In GC-06, GC-46 and GC-47, whose estimates sit on the bound, it is 1. The power formulas of section 8 ignore the gate.

### 5.3 F1 (Jaccard–Wilson)

Under multinomial sampling, and conditional on M = TP + FP + FN, TP follows a binomial distribution Bin(M, J) with J = π_TP/(π_TP + π_FP + π_FN). Population F1 is 2J/(1 + J), a monotone transform. A Wilson interval for J on (TP, M), mapped through 2J/(1+J), is therefore a valid interval for F1. The derivation is in Appendix A.1; simulated coverage is 0.9513.

The pass threshold maps the same way: F1 ≥ b exactly when J ≥ b/(2 − b). GC-21 gives F1 0.8293, [0.7863, 0.8651].

### 5.4 Macro F1 and macro precision (multiclass, conservative)

Per-class F1 values share rows, so their dependence is unknown.
- Each class gets a Jaccard–Wilson interval at the per-class critical value `z_k = −Φ⁻¹((1 − Φ(z))/k)`, which is Bonferroni over k classes.
- The macro interval is the mean of the lower bounds and the mean of the upper bounds.
- If every per-class interval covers, the mean is covered, so coverage is at least 1 − α without any independence assumption.

Simulated coverage is 0.9989, which is conservative. GC-34 gives [0.7770, 0.8634]. A tighter delta-method interval is on the Later list (Q7).

Macro precision uses the same construction on per-class Wilson intervals for TP_c out of the class's predicted count. GC-34 reports it descriptively as 0.8271, [0.7639, 0.8760]; its simulated coverage is 1.000.

### 5.5 Differences of rates (Newcombe hybrid score, "method 10")

For d = p₁ − p₂ with Wilson limits (l₁, u₁), (l₂, u₂) at the same z:

```
L = d − sqrt((p₁ − l₁)² + (u₂ − p₂)²),   U = d + sqrt((u₁ − p₁)² + (p₂ − l₂)²)
```

The source is [Newcombe 1998](https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C873::AID-SIM779%3E3.0.CO;2-I). Fagerland et al. prefer it for samples above 30 per group because it copes better with proportions near 0 or 1 ([Fagerland, Lydersen & Laake 2015](https://doi.org/10.1177/0962280211415469), section 8.1). It handles zero counts (GC-15: 0/50 vs 0/50 → [−0.0713, 0.0713]). It matches `statsmodels` `confint_proportions_2indep(method="newcomb")`.

### 5.6 Ratios of selection rates (Katz-log with a Koopman fallback)

- **Katz-log** ([Katz et al. 1978](https://doi.org/10.2307/2530610)) is used when the subject's selected count is ≥ 1 and the two groups are not both fully selected:
  `exp(ln r̂ ± z·sqrt(1/x₁ − 1/n₁ + 1/x₂ − 1/n₂))`.
- **Koopman asymptotic score interval** ([Koopman 1984](https://doi.org/10.2307/2531405)) is used when the subject count is 0, where Katz cannot be computed, or when both groups are fully selected, where Katz has zero width. The interval is `{φ : |z_K(φ)| ≤ z}`, where:

```
restricted MLE under p₁ = φp₂:  a = (n₁+n₂)φ,  b = −(n₁φ + x₁ + n₂ + x₂φ),  c = x₁ + x₂
                                 p̃₂ = 2c / (−b + sqrt(b² − 4ac)),  p̃₁ = φ·p̃₂      (cancellation-free root)
z_K(φ) = (x₁/n₁ − φ·x₂/n₂) / sqrt(p̃₁(1 − p̃₁)/n₁ + φ²·p̃₂(1 − p̃₂)/n₂)
```

z_K decreases in φ. This held on all 400 random tables checked.

**Computing the bounds.** L solves z_K = +z by bisection on ln φ over [ln r̂ − 60, ln r̂]; when x₁ = 0, L = 0. U solves z_K = −z over [ln r̂, ln r̂ + 120]; when x₁ = 0, use [−60, 60]. Iterate 200 times or until the width is ≤ 1e−13. This statistic is the Farrington–Manning / Miettinen–Nurminen score statistic without the n/(n−1) factor ([Miettinen & Nurminen 1985](https://doi.org/10.1002/sim.4780040211)).

**Undefined case.** A comparator count of 0 leaves the ratio undefined (`undefined_zero_denominator`). In `all_pairs` mode the comparator is the group with the higher rate, so this happens only when both counts are 0 (GC-15).

**Why not Katz everywhere?**
- Fagerland et al. find Katz "usually quite conservative", which is acceptable for audit claims.
- But Katz "cannot be computed when n11 = 0", and it gives a zero-width interval when every case is selected.
- The "adjusted log" fix that adds 0.5 "is not to be trusted" ([Fagerland et al. 2015](https://doi.org/10.1177/0962280211415469), sections 6.2–6.3).
- Zero selections are common in low-selection hiring data: at a 5% selection rate, P(0 of 30) = 21%.
- Koopman is the review's recommended interval for the ratio in both small and large samples.

**Implementation warning.** `statsmodels` (0.14 and 0.15) computes Koopman by Nam's closed-form cubic, which returns degenerate intervals when a group's rate is 1. For example, 11/385 vs 84/84 gives [0.2026, 0.2026] instead of [0.0160, 0.0504]. Runners MUST use the bisection above. Golden cases:
- GC-13: 0/40 vs 10/40 → [0, 0.3579].
- GC-14: 0/30 vs 5/30 → [0, 0.7143].
- GC-37: 40/40 vs 35/35 → [0.9124, 1.1098], which equals `[n₁/(n₁+z²), 1 + z²/n₂]` analytically.

### 5.7 Equalized odds

The criterion `equalized_odds` has two members per pair of groups: `tpr_difference` (within positives) and `fpr_difference` (within negatives). Both use Newcombe and share the band ±δ. Its headline is the largest |TPR or FPR difference|, which equals today's `max(TPR range, FPR range)` in the population (GC-20). In 1.0.0 a group criterion's metric is `selection_rate_difference`, `selection_rate_ratio` or `equalized_odds`. A TPR-only criterion (equal opportunity) would be a later minor version with its own headline name.

### 5.8 Calibration (engine; in the hosted runner only when it accepts score columns)

**Bins.** Use B equal-width bins on [0, 1]. B is `calibrationBins` from the plan, 10 by default. Bin index = `min(floor(s·B), B − 1)`, which is today's rule. For each bin, compute n_b, positives y_b and mean score s̄_b.

**Decision.** For every bin with n_b ≥ 30, a member `calibration_gap:bin<b>` compares ȳ_b − s̄_b with the band ±δ, where δ is plan-set with no default.
- The interval is the Wilson interval for y_b/n_b minus s̄_b.
- Treating s̄_b as fixed is conservative. Given the scores, the labels in a bin are independent Bernoulli trials whose variance is at most the binomial variance at their mean (a Poisson-binomial property).

**Suppression and coverage.** Bins under 30 are suppressed, and coverage is the share of scored rows in eligible bins (GC-24).

**ECE.** The expected calibration error is reported for continuity but never decides. It is biased upward with sparse bins, and its bootstrap interval is not a reliable decision basis. The engine reports a descriptive percentile-bootstrap interval for it (section 5.11). GC-24 pins its estimate, 0.0060.

**Brier score.** Uses the normal approximation of section 5.9 on the squared score errors. It is a member when the plan gives it a band `{upper: t}`, and descriptive otherwise.

**Per-group calibration.** Run one calibration criterion per group, using the criterion's `subgroup` field. These criteria are exploratory by default.

### 5.9 Regression (MAE, RMSE)

- **MAE:** `m ± z·s/√n`, with s the sample standard deviation (n − 1 denominator) of |e| and the lower bound clamped at 0.
- **RMSE:** first build `q ± z·s_q/√n` for the MSE q = mean(e²), with the lower bound clamped at 0. Then take square roots of both bounds. Decisions on RMSE ≤ t use MSE ≤ t².
- **Degenerate case.** Zero variance makes the member undefined (`degenerate_interval`).
- **R².** Stays descriptive: the engine gives a bootstrap interval and the hosted runner gives no interval. GC-35 pins its estimate, 0.9657.
- **The mean baseline gate (amendment of 6 November 2026, #68).** An RMSE threshold is absolute, in target units. Predicting the mean ȳ of the evaluated targets on every row has an RMSE equal to their population standard deviation, sqrt(SST/n), and every other constant c does worse, sqrt(SST/n + (ȳ − c)²). Without a further rule, any constant prediction passes a threshold above that deviation. So:
  - Every regression criterion reports the descriptive entry `baseline_rmse` = sqrt(SST/n). Its `counts` are `n`, `meanSquaredError` (SST/n), `meanSquaredErrorReduction` (−mean d), `sdSquaredErrorDifference` (s_d) and `gatePValue`.
  - **The gate.** With e_i = ŷ_i − y_i and d_i = e_i² − (ȳ − y_i)², mean d = MSE − SST/n = −R²·SST/n. The gate p is `2(1 − Φ(−mean d / (s_d/√n)))` on the decision scale, with s_d the sample standard deviation (n − 1 denominator), so p ≤ α exactly when the upper bound of the (1 − α) normal-approximation interval for mean d lies below 0. A reduction −mean d of at most 10⁻⁹ of SST/n counts as rounding and gives p = 1; zero-variance differences with a larger reduction give p for z = 37. SST = 0, missing targets or n < 2 give p = 1.
  - **Pass only.** When every pool member passes, P = max(member P, gate p). The gate never fails a criterion and never changes a fail, like the chance gate (section 5.2). When no member fails and the gate p exceeds α, the criterion records `mean_baseline_not_beaten`, and the limitations name the model's RMSE and the baseline RMSE.
  - **Every constant is excluded.** For a constant c, mean d = (ȳ − c)² ≥ 0, so the gate never rejects: the mean predictor gives d ≡ 0 (GC-52), any other constant a positive mean. A model with R² > 0 passes only when its MSE reduction is significant (GC-53 is a weak model with R² 0.063 that does not, GC-35 a strong one that does).
  - **Scope and power.** ȳ is estimated from the same rows; the gate treats it as fixed, which changes the variance of mean d by O(1/n²). The power check of section 8 adds the gate as a pass condition when the plan states the assumed target standard deviation (`targetSd`, #93, engine only for now); without it the formulas assume a model that clearly beats the mean.
  - **No fail direction (decided by #93).** A model whose MSE is significantly *above* the baseline's is not failed by the gate. A fail is a claim against the pre-registered band, and the band is the auditor's statement of what is acceptable: a model worse than the mean that still meets an absolute RMSE threshold fails nothing that was registered, and it already cannot pass. This matches the chance gate, which also guards only passes (section 5.2). A plan that wants that claim can register it as a band; a "beats the baseline" member is on the Later list.
  - In a clustered plan the gate is decided by the cluster bootstrap instead (section 5.11).
- **Caveat.** This is a CLT approximation; heavy-tailed errors can undercover. So the engine also reports, end to end and for independent rows only, a percentile-bootstrap **sensitivity interval** for every MAE and RMSE member and descriptive entry in `details.sensitivityInterval` (`{lower, upper, level, method: "percentile_bootstrap"}`, section 11.2). It never decides.
  - It resamples rows with the plan's B and the run seed, exactly as the R² bootstrap does (type-7 quantiles at the plan's level), within the descriptive budget rows × B ≤ 5,000,000. Beyond the budget, or with fewer than 0.9·B valid replicates, it is null and the result's limitations say so.
  - In a clustered plan the member interval is itself a bootstrap, and no sensitivity interval is added.
  - The fixture's core level does not carry it, as for the ECE and R² intervals; for GC-35 end to end, both lie close to the normal-approximation intervals.

### 5.10 Group comparisons, suppression and coverage

1. **Groups.**
   - Groups are all non-missing values of the group column (or, with `groupFields`, all combinations of up to five protected columns), plus any `declaredGroups`.
   - Groups are ordered by Unicode code points. TypeScript MUST use a code-point comparator, not the default UTF-16 `sort()`.
   - Rows with a missing group are `unknownGroupRows`. They are excluded from comparisons and from the criterion's `sampleSize`, but they count in coverage.
   - A criterion may have at most 50 groups in `all_pairs` mode and at most 1,000 in `reference` mode. Beyond that it is inconclusive with `too_many_groups`. This bounds a result at 2,451 metrics (section 11).
2. **Modes.**
   - `all_pairs` (default): every pair of non-empty groups.
     - Each pair is oriented so that the **subject** has the lower observed rate of that member's metric.
     - A rate with a zero denominator sorts as +∞, so the group with a defined rate becomes the subject. Ties keep code-point order.
     - The band must be symmetric. "All pairs within ±δ" is exactly "max − min ≤ δ", and "all pairs within [τ, 1/τ]" is exactly "min/max ≥ τ", so legacy thresholds keep their meaning.
   - `reference`: every other group against a pre-registered `referenceGroup`. One-sided bands are allowed. The LL144 convention of a "most selected category" is data-chosen and is used only for reporting (section 10.2).
   - **Member ids.** A member's id is `metric:subject|comparator`. Within a label, a backslash is written `\\` and a vertical bar `\|`, so ids stay unique.
3. **Suppression.** A group with n < `minimums.groupSize` is suppressed: it is listed in `suppressedGroups` with its count, and its pairs become `suppressed` members. Those members are reported descriptively, with an estimate, an interval and Fisher's p when a cell is small, but never decide and are not counted in m.
4. **Coverage.** `coverage = rows in eligible groups / (rows in all groups + unknownGroupRows)`, the share of the population the decision speaks for.
   - A pass needs coverage ≥ `minimumCoverage`. The default is 1.0, the allowed range is [0.5, 1.0], and the plan records a rationale.
   - A fail never needs coverage: a demonstrated disparity between eligible groups stands (GC-23).
5. **Declared groups.** A declared group with no rows blocks a pass (GC-16): there is no evidence at all for a pre-registered group.
6. **Intersectional analysis.** Strata are combinations of up to five protected fields (`intersectional_slices` today). They are just groups with composite labels, so everything above applies. Small strata are suppressed one at a time instead of voiding the result (GC-22, GC-23). The default role is exploratory.

### 5.11 Bootstrap and clustered data (engine-only)

Implemented in the engine by #93 (`cluster_bootstrap_criteria` in `engine/statistics.py`; GC-54 to GC-57).

- **When analytic intervals are invalid.** Analytic intervals assume independent rows. When the plan declares a `clusterField`, for example a person id for repeated applications:
  - the engine MUST use the cluster bootstrap for every member;
  - the hosted runner MUST NOT decide the plan with analytic intervals. It MUST either return `inconclusive` with `clustered_design_requires_engine` or reject the plan. Today it rejects the plan at validation ("statistics.clusterField needs the engine's cluster bootstrap; the hosted runner assumes independent rows"), and the worker rejects a hosted `engineConfig` 1.4 plan with a cluster design, so only engine 1.3 configurations run clustered plans.
  - Every evaluated row needs a cluster id; a row without one rejects the run (`missing_value`).
- **Resampling clusters, not rows.**
  - Every statistic in this specification is a function of per-group, per-class or per-bin counts. The engine therefore precomputes one count vector per cluster: the cells every cluster-mode member needs. Per criterion kind they are: TP, FP, FN, TN (binary performance); the k × k confusion matrix (multiclass); n and the sums of |e|, e², t − c and (t − c)², with c the mean of all targets (regression); each group's cells (group criteria); and each bin's n, positives and score sum, then the scored rows and their sum of squared score errors (calibration).
  - The criterion's own data, from which the estimates, statuses, gates, Fisher's p, `chanceExactP` and the per-group rates are computed as without clusters, is the sum of the clusters' data.
  - Clusters are ordered by the UTF-8 bytes of their canonical JSON (`canonical_bytes`, as in `_draws`). A replicate draws C cluster indices uniformly with replacement using `rng.randrange(C)` from one `random.Random(seed)` stream, where seed is the run seed. The replicate's counts are the sum of the drawn vectors; the engine adds each cluster's vector times the number of times it was drawn, which is the same sum.
  - One set of B replicates serves every cluster-mode member of the run, in every criterion: replicate b of one member and replicate b of another use the same draws.
  - B = `bootstrap.replicates`: default 2000, allowed 1000–10000.
- **What is bootstrapped.** Every member and every descriptive entry with an analytic interval gets a cluster bootstrap interval with method `cluster_percentile_bootstrap`, and `bootstrap: {replicates, validReplicates, clusters}`. R², ECE and `baseline_rmse` keep their own treatment (below and section 5.9). The per-group rates in a headline's slices, and the engine's supplementary `prevalence` and `majority_baseline_accuracy` entries, keep their Wilson intervals; the result's limitations say that these assume independent rows.
- **Decision budget.** B × C ≤ 50,000,000 cluster draws per run, about one minute of CPython at the measured 1.2 µs per draw (the `randrange` calls dominate).
  - Rows per cluster no longer matter. At B = 2000 the budget allows 25,000 clusters, and at B = 1000 it allows 50,000, whatever the number of rows.
  - Beyond the budget no replicate is drawn: every cluster-mode member and descriptive entry is `undefined` (or stays `suppressed`) with no interval, p = 1 and `bootstrap_budget_exceeded`, so every criterion is inconclusive.
- **Undefined replicates.** Replicates where the estimate is undefined are dropped. With fewer than 0.9·B valid replicates, the entry is undefined, has no interval and carries `bootstrap_insufficient_valid_replicates`.
- **Interval.** The percentile interval `[q(α/2), q(1 − α/2)]` uses type-7 linear interpolation (today's `_quantile`) over the sorted valid replicates.
- **Direction.** Taken from the median replicate q(0.5), with the boundary rule of section 4.2 (`estimate_on_band_boundary`).
- **Decision p.** `p = max(2u*, 2/(B_valid + 1))`, where `u* = inf{u ∈ (0, 0.5] : [q(u), q(1 − u)] decides}`, with inclusive bounds for a pass and strict ones for a fail as in section 4.2. Find u\* by bisection on [0, 0.5] to 1e−9 (u\* = 0 when the range of the replicates already decides). The first term keeps `p ≤ α` equivalent to "the percentile interval decides". A pass of a chance-gated member still takes `max(p, chanceExactP)` (section 5.2): the exact test assumes independent rows, so under clustering it is one more necessary condition, not a guarantee.
- **Headline.** The worst-member bounds of section 4.7 use each member's percentile interval at the two-sided level of the critical value: `CI(z) = [q(u), q(1 − u)]` with `u = Φ(−z)`, at the nominal level and at α/m.
- **Small cells.** Fisher assumes independence, so in cluster mode any member with a 2×2 cell under 5 makes no claim either way: its p is 1 and it carries `small_cell_clustered`. Fisher's p is still reported. The criterion records `small_cell_clustered` instead of `interval_straddles_band` (GC-56).
- **Minimum clusters.** Every compared group needs at least 10 clusters (`min_clusters`, as today). For a pairwise member the smaller of its two groups' cluster counts applies, for a calibration gap the clusters with rows in its bin, and for every other entry the clusters with rows in the criterion. An evaluated entry below 10 becomes `insufficient_support` with `below_minimum_cluster_count`: it is reported with its interval, blocks a pass and cannot fail (GC-56).
- **The mean baseline gate** (section 5.9) uses the same replicates: with mean d = MSE − SST/n computed on each replicate, `p = max(2u*, 2/(B_valid + 1))` with `u* = inf{u : q(1 − u) < 0}`, and p = 1 when the median is not below 0. The rounding rule of section 5.9, fewer than 10 clusters, fewer than 0.9·B valid replicates or a run beyond the budget give p = 1. `baseline_rmse.counts` keeps the whole-sample figures, `gatePValue` is the bootstrap p and `gateMethod` is `cluster_percentile_bootstrap` (GC-55).
- **Descriptive bootstrap.**
  - ECE and R² get an iid row-level percentile bootstrap with the same B and seed, for display only.
  - Its budget stays rows × B ≤ `MAX_BOOTSTRAP_WORK` (5,000,000). Beyond it, the descriptive entry has no interval and carries `bootstrap_budget_exceeded`.
- **`_bootstrap_protocol` (E3).** It gains `purpose`:
  - `"decision"` accepts 1000–10000 replicates with the cluster-draw budget above;
  - `"descriptive"` accepts 100–10000 with the row budget. Today's procedures (`bootstrap_interval`, the descriptive part of `intersectional_slices`) use it.
- **Not adopted in phase 1.** BCa is not used: it needs a jackknife, which is O(n²) for ECE, and bootstrap results never decide outside cluster designs. It may be added later as an engine option with a pinned definition (Q8; on the Later list).

### 5.12 Fisher's exact test (the small-cell rule)

**When.** Compute Fisher's exact test for every pairwise member, suppressed or not, when any of its four cells (x₁, n₁ − x₁, x₂, n₂ − x₂) is under 5. Report it as `fisherExactP`. Otherwise `fisherExactP` is null.

**Definition.** The two-sided p is the sum of hypergeometric probabilities over all tables with the same margins whose probability is ≤ the observed table's. This is the definition used by [scipy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html) and [R](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/fisher.test.html).

**Numerics.**
- Runners compute in log space, from log-factorials or the pmf recurrence.
- They normalise by the sum of all table weights.
- Probabilities within a relative 1e−7 of the observed one count as "≤". This absorbs floating-point noise in symmetric tables.
- The reference implementation uses exact integers. GC-36 gives seven reference tables, including the issue's 6/20 vs 10/20 → 0.3332.

**Use.** The two-sided test gates only fails of pairwise members: `p_fail = max(p_interval, p_Fisher)`.
- A claim that the band is violated implies that parity is excluded, because every group band contains parity. If an exact test cannot even reject parity, the asymptotic fail is not trusted.
- This mirrors the Uniform Guidelines' pairing of practical and statistical significance ([29 CFR 1607.4(D)](https://www.law.cornell.edu/cfr/text/29/1607.4)).
- GC-14 shows the gate binding: the Koopman interval [0, 0.7143] lies below 0.8, but Fisher's p = 0.0522, so the outcome is inconclusive.
- Pairwise passes are not gated. A pass needs the whole interval inside a band around parity, which small counts make wide, and a ratio pass is impossible when a count is zero.

**One-sided use: the chance gate.** A balanced-accuracy member at or above chance uses the upper tail P(X ≥ TP) of the same hypergeometric distribution, for its own 2×2 table or for each class's one-vs-rest table (section 5.2). It is computed from the same weights: the sum over the tables with at least the observed count, divided by the sum of all weights. No tolerance is needed, and the reference implementation again uses exact integers. Unlike the two-sided test, it gates passes.

**Why Fisher rather than Boschloo.**
- Boschloo's test is more powerful, as the [scipy documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html) notes.
- But it maximises over a nuisance parameter numerically (scipy evaluates a grid), so two implementations can differ at the fourth decimal.
- Fisher is exact, deterministic and identical in both runners. Its conservatism errs on the safe side: it can only make a fail or a chance-baseline pass harder.
- Boschloo may later be reported by the engine as a sensitivity statistic (Q8; on the Later list).

### 5.13 Numerical requirements (all runners)

- **Normal quantile.** Use Wichura's AS241 ([Wichura 1988](https://doi.org/10.2307/2347330)). Python's `statistics.NormalDist.inv_cdf` implements AS241. TypeScript MUST port it.
- **`erfc`.** Must have relative error ≤ 1e−12 on [0, 27]. Python has `math.erfc`; TypeScript needs a Cody-type rational approximation. Validate against `numerics` in the fixture.
- **Arithmetic.** IEEE-754 doubles. No other special functions are needed.
- **Performance.** At most 50 groups in all-pairs mode gives at most 1,225 pairs per metric. Each Koopman bound is about 200 statistic evaluations, well within a Worker's CPU budget.

## 6. Multiplicity

**Families.** One plan evaluated on one dataset in one run forms two families:
- all `confirmatory` criteria, adjusted with **Bonferroni**: `p̃ = min(1, F·P)`, where F is the family size;
- all `exploratory` criteria, adjusted with BH at q = α ([Benjamini & Hochberg 1995](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x)): sort ascending, p₍₁₎ ≤ … ≤ p₍F₎, then `p̃₍ᵢ₎ = min(1, min over j ≥ i of F·p₍ⱼ₎/j)`, which is invariant to the order of ties.

Defaults:
- Hosted suite tests are confirmatory.
- Engine results derived from `thresholds` are confirmatory.
- Intersectional analyses and per-group calibration are exploratory.
- Per-group performance without a criterion is descriptive and not in any family.

**Family size.** The family size is the number of criteria pre-registered with that role. It includes criteria that end up gated, so the family does not depend on the data.

**Error control of one criterion.** Each criterion can make at most one wrong claim: a false pass if its truth lies outside the band, or a false fail if it lies inside. Its P is a valid p-value for whichever claim would be wrong (sections 4.2–4.3; Appendix A.2).
- A false pass is made with probability at most α/2 at P ≤ α. So is a false fail under a one-sided band.
- A false fail under a two-sided band has probability at most α, not α/2, because the interval can lie wholly above or wholly below the band.
  - Exact binomial enumeration with this specification's Newcombe rule shows this. Take one member, 100 per group, a band of ±0.02 and the true difference on the band edge (0.51 vs 0.49), with no multiplicity: P(false fail) = 0.0345, of which 0.0279 is above the band and 0.0066 below.
  - With 300 per group and ±0.01 it is 0.0354. The part below the band is structural, not interval approximation error.
- So the bound per claim is **at most α**, up to the approximation error of the interval methods.
  - That error is largest when a count is 1 to 3, where Wilson's lower limit is anti-conservative. It matters most for the chance baseline. There the interval alone would let a model that ignores the truth pass up to 12% of the time, so that pass carries an exact gate (section 5.2).
  - The gate guards only passes. Mirroring the predictions (TP ↔ FN and FP ↔ TN) turns a pass of `balanced_accuracy ≥ 0.5` into a fail. So a model that ignores the truth is failed on a baseline at chance as often as its mirror image passes without the gate: up to 0.12 in the designs of section 5.2. A fail never lets it pass.

**Why Bonferroni and not Holm across criteria.** Bonferroni bounds the probability of any wrong claim among the F confirmatory criteria at F·(α/F) = α, under any dependence between criteria. Holm's step-down would give more power, but its standard proof needs a fixed set of true null hypotheses. Here it has none:
- Each criterion has two complementary hypotheses, "outside the band" (the null of a pass claim) and "inside the band" (the null of a fail claim). Exactly one is true, and the data choose which one is tested.
- A correct claim ranked first relaxes the threshold for another criterion's wrong claim. Closed testing over the 2F complementary hypotheses with Bonferroni local tests rejects a hypothesis only at α/F at every step. This is because every hypothesis belongs to a consistent intersection of F hypotheses, one per criterion ([Shaffer 1986](https://doi.org/10.1080/01621459.1986.10478341)). The closure is therefore single-step Bonferroni.
- Holm's procedure with data-dependent directional decisions controls this error when the criteria's test statistics are independent and their distributions meet regularity conditions ([Shaffer 1980](https://doi.org/10.1214/aos/1176345205), which also gives counterexamples, even with two hypotheses). Criteria computed on one dataset are dependent; DP and DI, for example, use the same counts. So the condition does not hold.

**BH and exploratory claims.** BH with directional decisions controls the directional false discovery rate under independence or positive regression dependence ([Benjamini & Yekutieli 2005](https://doi.org/10.1198/016214504000001907)), not under arbitrary dependence. That is acceptable for exploratory criteria because they never change the run outcome (section 4.6). Their results are labelled as screening.

**Not adjusted:**
- descriptive entries, suppressed members and per-group rates;
- LL144 reporting figures;
- drift statistics (section 15, Q6).

**Worked examples.**
- **GC-31.** Four confirmatory criteria have P = 6.0e−13, 0.0035, 0.0313 and 0.3792. Bonferroni with F = 4 gives 2.4e−12, 0.0142, 0.1252 and 1. So `disparate_impact` becomes inconclusive with `multiplicity_adjustment`, although its 95% interval [0.8121, 1.1007] lies inside [0.8, 1.25].
- **GC-37.** The parity criterion passes on its own (P = 0.0486) but not in a family of two (0.0972).
- **GC-18 and GC-19** pin Bonferroni and BH on raw p-values. GC-17 shows within-criterion Bonferroni.

## 7. Minimum support: one set for every runner

| Floor | Value | Applies to | Rationale |
|---|---|---|---|
| `minimums.sampleSize` | 30 | rows evaluated by a criterion | Today's engine default. Below about 30, even a proportion near 0.5 has a 95% Wilson half-width of at least ±0.17 (15/30 → [0.3315, 0.6685]), too wide for any material conclusion. It is also a common floor for normal approximations. |
| `minimums.groupSize` | 30 | each compared group or stratum (and calibration bin) | The same argument per group. At 30 vs 30 with equal rates, the Newcombe interval is ±0.24 (GC-11). Groups this small rarely support a pass under any realistic band, and suppressing them limits re-identification risk in client exports. |
| `minimums.classCount` | 10 | every class-conditional denominator: positives for recall and F1, negatives for specificity and FPR, predicted positives for precision, per-group positives and negatives for equalized odds, per-class support and predicted counts | Today's engine default. With fewer than 10, a Wilson interval is wider than ±0.25 (8/10 → [0.4902, 0.9433]). The small-cell rule (cells < 5) adds the exact test below this level. |

These are **floors**. A plan MAY raise them and MUST NOT lower them. The same rule applies on every path:

- **New plans and new configurations** (hosted profile `schemaVersion` 1.1, engine configuration 1.3, worker `engineConfig` 1.4) MUST be rejected when a minimum is below its floor. The hosted `configSchema` defaults become 30/30/10, with `minimumSampleSize ≥ 30`, `minimumGroupSize ≥ 30` and `minimumClassCount ≥ 10`.
- **Legacy configurations** are not rejected: today's hosted profiles (`schemaVersion` 1.0, whose `config` is the configuration of hosted 1.1 runs), engine configuration 1.0 and worker `engineConfig` 1.1. Running them applies `max(floor, configured)` and records both: `minimums` holds the applied values, and `configuredMinimums` holds the configured ones (GC-38, GC-39). The worker also records both in `hostedTranslation`.
- **Frozen runs** keep their recorded values and are not recomputed.
- The hosted projection's separate "minimum class count of one" disappears: 1 is raised to 10.

Because the interval now decides, minimums are a safety net rather than the main defence, so they need not be larger.

## 8. Power and minimum detectable effect (at plan approval)

**Inputs.** Each confirmatory criterion carries `powerAssumptions` in the plan, in a shape that depends on its kind (section 9). The approval step also needs the target power (plan `power.targetPower`, default 0.80), the confidence level and the family size F.
- Planned sizes may be pre-filled from the registered dataset's row and group counts. The testing lab does so (#113): `n` is the row count, `groupSizes` are the rows of each value of the protected-group column, and a multiclass criterion asks for a share and a recall for every class of the target column.
- Outcome-derived quantities (prevalence, assumed rates, assumed metric values) are entered by the auditor, never read from the data being tested.

| Kind | `powerAssumptions` | What follows from them |
|---|---|---|
| `performance` (binary) | `n`, `prevalence` π, `truePositiveRate`, `trueNegativeRate` | P = nπ, N = n(1 − π), and every binary metric's true value and denominator (table below) |
| `multiclass_performance` | `n`, `classShares` {label: share} (sum 1, every share above 0), `perClassRecall` {label: recall} (the same labels; #113) | accuracy = Σ share·recall; balanced accuracy = mean recall |
| `regression_performance` | `n`, `errorSd` σ, and optionally `targetSd` σ_y (#93, engine only until the hosted runner mirrors it) | Errors are assumed normal with mean 0: MAE = σ√(2/π), SD(\|e\|) = σ√(1 − 2/π), MSE = σ², SD(e²) = √2·σ². With σ_y, the mean baseline gate (section 5.9) becomes a pass condition (below) |
| `group_comparison` | `groupSizes` {group: n}. Selection-rate metrics: `baselineRate` and optional `assumedRates` {group: rate} (default: every group at the baseline). Equalized odds: `prevalence`, `truePositiveRate`, `falsePositiveRate` (each a number or per group). | Members as they would be formed at evaluation; for equalized odds, the per-group positives n_g·π_g and negatives n_g·(1 − π_g) |
| `calibration` | none | not computed (`power_not_specified_for_metric`) |

**Critical values.**
- Pass probabilities use `z_P = Φ⁻¹(1 − α/(2F))`, because a confirmatory pass needs P ≤ α/F under Bonferroni.
- Fail probabilities use `z_F = Φ⁻¹(1 − α/(2Fm))`, where m is the number of members the criterion would have at the planned sizes.
- For exploratory criteria, F = 1.

**Member pass and fail probabilities**, from normal approximations at the assumed true values. Write s for the standard error at those values.

| Member | Pass probability P_i (lower bound l, upper bound u) | Fail probability Q_i |
|---|---|---|
| Proportion p, denominator n (Wilson, score form; accuracy, precision, recall, specificity, FPR) | `P_l = Φ((p − l − z_P·sqrt(l(1−l)/n))/s)`, `P_u = Φ((u − z_P·sqrt(u(1−u)/n) − p)/s)`, s = sqrt(p(1−p)/n) | `Φ((l − z_F·sqrt(l(1−l)/n) − p)/s) + Φ((p − u − z_F·sqrt(u(1−u)/n))/s)` |
| Normal-approximation statistic θ (difference, log ratio, balanced accuracy, macro recall, MAE, MSE) | `P_l = Φ((θ − l)/s − z_P)`, `P_u = Φ((u − θ)/s − z_P)` | `Φ((l − θ)/s − z_F) + Φ((θ − u)/s − z_F)` |
| Two bounds | `max(0, P_l + P_u − 1)` | sum of both terms |
| One bound | that bound's term | that bound's term |

The members' true values and standard errors are:

| Member | True value | Denominator or standard error |
|---|---|---|
| accuracy | πTPR + (1 − π)TNR | n |
| precision | πTPR / (πTPR + (1 − π)(1 − TNR)) | n(πTPR + (1 − π)(1 − TNR)) |
| recall, specificity, false_positive_rate | TPR, TNR, 1 − TNR | P, N, N |
| balanced_accuracy (binary) | (TPR + TNR)/2 | s = ½·sqrt(TPR(1 − TPR)/P + TNR(1 − TNR)/N) |
| f1 | the proportion formula on J = πTPR/(π + (1 − π)(1 − TNR)) with bounds mapped b → b/(2 − b); the reported value is 2J/(1 + J) | n(π + (1 − π)(1 − TNR)) |
| accuracy (multiclass) | Σ share·recall | n |
| balanced_accuracy (multiclass) | mean recall | s = sqrt(Σ r_c(1 − r_c)/(n·share_c))/k |
| macro_f1, macro_precision | not computed (`power_not_specified_for_metric`) | – |
| mae | σ√(2/π) | s = σ√(1 − 2/π)/√n |
| rmse | σ, decided on MSE: θ = σ², bound t → t² | s = √2·σ²/√n |
| `mean_baseline_gate` (regression with `targetSd`; metric `baseline_rmse`, assumed value σ_y) | MSE reduction θ = σ_y² − σ², pass only: `P = Φ(θ/s − z_P)`, and P = 0 when σ ≥ σ_y; Q = 0 | s = sqrt(2(σ_y⁴ − σ⁴))/√n |
| selection_rate_difference, tpr_difference, fpr_difference | r_s − r_c | s = sqrt(r_s(1 − r_s)/n_s + r_c(1 − r_c)/n_c) |
| selection_rate_ratio | ln(r_s/r_c), bounds on the log scale | s = sqrt((1 − r_s)/(n_s r_s) + (1 − r_c)/(n_c r_c)) |

**The mean baseline gate in power (#93, from the #68 follow-up).** The gate's statistic is d = e² − r² with r = ȳ − y. The model is assumed to predict the conditional mean of the target, so its error is the noise: e and r are jointly normal with Var e = σ², Var r = σ_y² and Cov(e, r) = σ², R² = 1 − σ²/σ_y². By Isserlis' theorem Var d = 2σ⁴ + 2σ_y⁴ − 4σ⁴ = 2(σ_y⁴ − σ⁴). The gate is listed after the members as the entry `mean_baseline_gate` and enters `passProbability` and its upper bound like a member; it never fails, so it does not count in the m of z_F. Without `targetSd` the formulas leave the gate out, as before (GC-44).

**Gates.** The approval check applies the section 4.4 gates to the planned sizes. Denominators are expected counts and need not be integers.
- **Member below its minimum.** A member whose planned denominator is below its minimum has P_i = Q_i = 0, with reason `planned_below_minimum`.
- **Too few rows.** If the planned total rows are below `minimums.sampleSize`, the criterion's pass and fail probabilities are 0 (`below_minimum_sample_size`).
- **Undecidable metric.** A criterion with a non-empty `passBlockedBy` has pass probability 0 (`undecidable_metric`). Only derived plans have one, and they carry no power assumptions.
- **Group criteria.**
  - Groups below `minimums.groupSize` are treated as suppressed.
  - If the planned coverage is below `minimumCoverage`, the pass probability is 0 (`insufficient_planned_coverage`).
  - If fewer than two groups are eligible, pass and fail are both 0 (`insufficient_groups`).

**Criterion outputs.**

| Output | Definition |
|---|---|
| `passProbability` | `max(0, 1 − Σ(1 − P_i))`. A lower bound on the probability that every member passes, valid under any dependence between members (Appendix A.4), and exact for one member. |
| `passProbabilityUpperBound` | `min_i P_i` |
| `failProbability` | `max_i Q_i`: a lower bound on the criterion's fail probability at the assumed values |
| `requiredGroupSizeForPass` (group criteria) | The smallest common group size k, with every planned group set to k, for which `passProbability` ≥ target. Integers 2–10,000,000 are searched by bisection; `passProbability` is non-decreasing in k when every assumed value lies inside the band. When the target is not reached at 10,000,000, the value is null and the reason is `target_unreachable`. |
| `requiredNForPass` (performance kinds) | The smallest total n, with every denominator scaled with n, for which `passProbability` ≥ target. It uses the same search and the same null rule. |
| `failMdeDifference`, `failMdeRatio`, `failMdeTprDifference`, `failMdeFprDifference` (group criteria) | The smallest disparity that fails with probability ≥ target at z_F. One subject group carries it against a comparator at its assumed rate. See the rules below the table. |
| `equalityTestGroupSize` (reference only, kind `equality_test`) | The classic two-sided z-test size, Fleiss's formula without continuity correction: `n = [z₁₋α/₂·sqrt(2p̄q̄) + z₁₋β·sqrt(p₁q₁ + p₂q₂)]² / (p₁ − p₂)²`, rounded up. It answers "is there any difference?", not "is the difference within the band?". |
| `status`, `reasons` | `status` is `computed`, or `not_computed` when any member has no formula (`member_power_not_computed`), the kind has none (`power_not_specified_for_metric`), or the criterion has no assumptions (`missing_assumptions`). Members are listed with their own status either way. |

The failMde fields follow these rules:
- **Subject and comparator.** The subject is the smallest planned group (ties broken by code point). The comparator is the largest other planned group, or the reference group in reference mode.
- **Differences.** The subject's rate is r_c − Δ; under an upper-only band it is r_c + Δ.
- **Ratios.** The value is the largest r < τ, searched between the peak of the fail-probability curve and τ. The peak is located on the grid τ·e^(−12i/4000), i = 1…4000, because the curve falls again as r → 0.
- **Equalized odds.** For TPR the subject's rate is TPR_c − Δ; for FPR it is FPR_c + Δ.
- **Search.** Bisection runs for 200 steps. When the target is not reached, the value is null and the reason is `fail_mde_unreachable`.

**Golden values:**
- **GC-25, GC-26.** 40% vs 50% needs 388 per group (387.34 before rounding); 8% vs 10% needs 3,213 (3,212.94). Both match statsmodels `samplesize_proportions_2indep_onetail` to 1e−7.
- **GC-27.** With 388 per group at true parity and 50% selection, the four-fifths band passes with probability only 0.749. It needs 423 per group for 80%, and a true ratio of 0.620 would fail with 80% probability.
- **GC-28.** A ±0.05 parity band at 30% selection and 500 per group can **never** pass (probability 0); it needs 1,766 per group.
- **GC-29.** Recall that is truly 0.80, measured on 50 expected positives against a 0.70 minimum, passes with probability 0.316. It needs 610 rows at prevalence 0.25, that is, 152.5 expected positives.
- **GC-40 (three groups).**
  - With 500, 500 and 250 per group at parity, the pairs pass with probabilities 0.864, 0.609 and 0.609, so the criterion passes with probability between 0.081 and 0.609.
  - It needs 605 per group.
  - A shortfall of 0.192 in the smallest group fails with 80% probability at the Bonferroni level for three members.
- **GC-41 (five members, family of three).** The members pass with probabilities 0.745, 0.870, 1.000, 0.830 and 0.906, giving a range of [0.352, 0.745]. It needs 558 rows.
- **GC-42 (equalized odds, per-group prevalence).** A true TPR gap of exactly 0.10 sits on the band edge, so the target is unreachable at any size (`target_unreachable`). The FPR member alone would pass with probability 0.969.
- **GC-43.** Macro F1 has no formula in 1.0.0, so the criterion is `not_computed`, while its accuracy and macro-recall members are still reported.
- **GC-44 (regression).** With σ = 1 and 120 rows, MAE ≤ 0.9 and RMSE ≤ 1.15 pass with probabilities 0.458 and 0.705, so the criterion's range is [0.163, 0.458]. It needs 293 rows.
- **GC-58 (regression with the mean baseline gate).** GC-44 with σ_y = 1.1 (R² ≈ 0.17): the gate passes with probability 0.666 at 120 rows, so the range falls to [0, 0.458], and the criterion needs 312 rows instead of 293.

**Accuracy.** Simulating the actual decision rules (section 13.3) gives these results:
- Every member formula is within 0.02 of its simulated rate. The largest gaps are GC-44's: 0.020 for RMSE and 0.009 for MAE, whose formula is low.
- The range bounds the criterion's pass probability exactly only for the true member probabilities. Built from the formulas, it holds up to their approximation error of at most 0.02, not merely up to Monte Carlo error:
  - GC-40: 0.429 in [0.081, 0.609]; GC-41: 0.654 in [0.352, 0.745].
  - GC-44: 0.461, which is 0.003 above its upper bound of 0.4585, the MAE formula. A 200,000-run simulation puts the MAE member at 0.469 and the criterion at 0.462, both ±0.001.
- The lower bound is loose when members share groups, as in GC-40. That is the price of holding under any dependence. The approval display shows the range, and the required sizes are conservative.
- The balanced-accuracy formulas ignore the chance gate (section 5.2). It binds only near chance, where a member's pass probability is already small. GC-41's simulation applies it, and its rates are the same as without it.
- The mean baseline gate's formula is coarser, because d = e² − r² is skewed: for GC-58 it gives 0.666 against a simulated 0.632, so it overstates the gate's pass probability by 0.033. `--simulate` holds it to 0.04. The criterion's simulated rate, 0.321, lies inside its range.

**Approval behaviour.**
- If any confirmatory criterion's `passProbability` is below the target, or its power is `not_computed`, approval shows the numbers in plain language. For example: "With 388 people per group, a system with identical selection rates would pass this screen only 3 times in 4."
- Approval then requires a recorded acknowledgement (`power.acknowledgement`, free text). It does not block: small populations are sometimes all there is.
- The power section is frozen with the plan.

## 9. Pre-registered plan

The plan is stored in three places:
- the hosted evaluation profile (profile `schemaVersion` 1.1, field `statistics`);
- the engine configuration (contractVersion 1.3, field `statistics`);
- the worker request (`engineConfig` contractVersion 1.4, field `statistics`).

The runs record the normalised plan that decided and its hash (section 11). `docs/design/audit-statistics-plan.schema.json` is the draft JSON Schema (Draft 2020-12). #21 and #22 copy it into the `schemas/` generator. `--cross-check` validates every fixture plan against it, both as written and normalised.

### 9.1 Fields

| Field | Type | Default (normalisation) | Rule |
|---|---|---|---|
| `statisticsVersion` | `"1.0.0"` | `"1.0.0"` | |
| `confidenceLevel` | 0.90, 0.95 or 0.99 | 0.95 | |
| `minimums.sampleSize`, `.groupSize`, `.classCount` | integers | 30, 30, 10 | each ≥ its floor (section 7) |
| `configuredMinimums` | `{sampleSize, groupSize, classCount}` or null | null | derived plans only: the configured values beside the applied ones |
| `multiplicity` | `{confirmatory: "bonferroni", exploratory: "benjamini_hochberg"}` | that object | fixed in 1.0.0 |
| `clusterField` | string or null | null | engine only (section 5.11) |
| `bootstrap.replicates` | integer 1000–10000 | 2000 | |
| `calibrationBins` | integer 2–100 | 10 | |
| `power.targetPower` | number 0.5–0.99 | 0.8 | |
| `power.acknowledgement` | string or null | null | required at approval in the cases of section 8 |
| `derivedFrom` | `{source: "hosted_config" \| "engine_thresholds", contractVersion}` or null | null | set by legacy derivation |
| `criteria` | 1–20 criteria | – | ids unique in the plan; `id` uses the run schema's id pattern |

Every criterion has `id`, `kind`, `role` (default `confirmatory`), `rationale` (default null), `libraryEntry` (default null) and `powerAssumptions` (default null, with the shape for its kind in section 8). The other fields depend on the kind:

| Kind | Fields (defaults) |
|---|---|
| `performance`, `multiclass_performance`, `regression_performance` | `members`: an array of `{metric, band}`. Metrics: binary accuracy, precision, recall, specificity, false_positive_rate, balanced_accuracy, f1; multiclass accuracy, balanced_accuracy, macro_precision, macro_f1; regression mae, rmse. Regression criteria also have `passBlockedBy` (`[]`; derived plans only, at most `["r2"]`). |
| `group_comparison` | `metric` (selection_rate_difference, selection_rate_ratio or equalized_odds); `band`; `comparison` (`{mode: "all_pairs", referenceGroup: null}`); `groupFields` (null, meaning the configuration's protected column; else 1–5 columns); `declaredGroups` (null); `minimumCoverage` (1.0) |
| `calibration` (engine) | `band`, the per-bin gap band (null in a derived plan); `members` (`[]`; at most one `{metric: "brier_score", band: {upper: t}}`); `minimumCoverage` (1.0); `subgroup` (null, else `{field, value}`); `passBlockedBy` (`[]`; derived plans only, at most `["expected_calibration_error"]`) |

`passBlockedBy` lists the metrics that block a pass because 1.0.0 cannot decide them (section 4.8). A plan whose `derivedFrom` is null MUST have it empty, and the schema rejects anything else.

A band is `{lower, upper}`. After normalisation both keys are present, with null for an absent bound.

**Library entries.** `libraryEntry` is `{id, version, parameters, overriddenParameters}`:
- `parameters` holds every parameter value after defaults, each validated against the entry's range (section 10.1).
- `overriddenParameters` lists, in sorted order, the names of parameters whose value differs from the default.
- The band is **derived from the entry**. If the plan omits the band, normalisation fills it in. If the plan states it, it MUST equal the derived band exactly; for example, 1/τ is computed in IEEE double. A mismatch is rejected (GC-33 uses the four-fifths entry this way).
- `policy.eu-aia.declared-performance` derives one performance member, `{metric, band: {lower: declaredValue − tolerance}}`.

**Explicit plan or legacy fields, never both.**
- An engine 1.3 configuration with `statistics` MUST have empty `thresholds.values`. Its `minSampleSize`, `minGroupSize` and `minClassCount` are set to the plan's applied minimums.
- A hosted profile (`schemaVersion` 1.1) with `statistics` keeps in `config` only the column mappings and the declared labels (`positiveLabel`, `negativeLabel`). Bands and minimums live in the plan.

### 9.2 Normalisation and hash

- **Normalisation.** Fill every default above. Keep array order (criteria, members, `declaredGroups`). Copy numbers as given. Normalising a normalised plan returns it unchanged; the cross-check asserts this.
- **Canonical form.** [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JSON Canonicalization Scheme (JCS) of the normalised plan, encoded as UTF-8:
  - object keys are sorted by UTF-16 code units;
  - there is no whitespace;
  - numbers use ECMAScript serialisation, so 1.0 is written `1` and 0.95 `0.95`;
  - strings use `JSON.stringify` escaping.
- **Hash.** `planSha256` is the lowercase hexadecimal SHA-256 of those bytes.
- **Pitfalls.**
  - Python's `json.dumps(sort_keys=True)` is not JCS: it writes `1.0`, sorts by code point, and formats exponents differently.
  - In TypeScript, `JSON.stringify` on a rebuilt object is not JCS either. JavaScript places integer-like keys first in numeric order, for example group names `"9"` and `"10"` in `groupSizes`. Keys MUST therefore be sorted and written explicitly, as the short `jcs` function in the verifier's `--cross-check` does.
  - The reference `jcs()` and Node agree on 25,016 test numbers, including exponent thresholds, subnormals and integers above 2^53.
- **Fixture.** Every plan case gives `expected.normalizedPlan` and `expected.planSha256`; `--show-plan` prints the canonical bytes.

### 9.3 Legacy derivation (when no plan is stored)

Every runner MUST derive the plan deterministically, so existing profiles keep their meaning. The derived plan sets `derivedFrom` and `configuredMinimums`, and its minimums are `max(floor, configured)`.

The derivation reads one fact from the data: for a multiclass task, k, the number of labels that occur in the target column of the evaluated rows, which sets the chance baseline 1/max(k, 2). Everything else comes from the configuration. Both runners already list the labels when they evaluate (the sorted union of target and prediction labels, `labels` in the engine and `names` in the hosted runner), and the worker's `translate_config` receives the rows. The recorded plan therefore carries the baseline as a number; for three classes it is 1/3 = 0.3333333333333333 in IEEE double.

- **Today's hosted profile** (`schemaVersion` 1.0, with the configuration of hosted 1.1 runs, so `derivedFrom.contractVersion` is "1.1"; the worker uses the same rules for `engineConfig` 1.1; GC-38, GC-49). Each selected test becomes a confirmatory criterion with the test's id:
  - `performance` (binary): accuracy ≥ `minimumAccuracy`, recall ≥ `minimumRecall` (default 0.7), and balanced accuracy ≥ 0.50. Recall, precision, specificity and F1 refer to the profile's `performancePositiveLabel` (#15), or to `positiveLabel` when it is empty; group criteria count the favourable `positiveLabel`. The worker's translation 2.1.0 records it in the engine configuration as `performancePositiveLabel` and the engine measures on it (#65).
  - `performance` (multiclass): accuracy ≥ `minimumAccuracy`, the chance baseline balanced accuracy (macro recall) ≥ 1/k, and macro F1 ≥ `minimumMacroF1` (default 0.7), in that order.
  - `regression`: RMSE ≤ `maximumRmse` (default 1), with `passBlockedBy` empty, because today's hosted rule decides on RMSE alone.
  - `demographic_parity`: selection-rate difference within ±`maximumParityGap`.
  - `disparate_impact`: selection-rate ratio within [`minimumImpactRatio`, 1/`minimumImpactRatio`]. A ratio of 0 maps to `{lower: 0}`, which is an invalid band.
  - `equalized_odds`: ±`maximumOddsGap`, falling back to `maximumParityGap`.
  - Group criteria use `all_pairs` mode, `minimumCoverage` 1.0 and the profile's group column.
  - The configured minimums are `minimumSampleSize` (default 20), `minimumGroupSize` and `minimumClassCount` (default 5).
- **Engine 1.0 configuration** (GC-39, GC-45 to GC-48, GC-50, GC-51). The criteria take today's test ids, and `thresholds.values` supply the bands: `>=` gives a lower bound and `<=` an upper bound.
  - `PERF-BINARY` takes members from accuracy, precision, recall, specificity, false_positive_rate, balanced_accuracy and f1, in that order, when the policy sets at least one of them. Balanced accuracy is then always a member, the chance baseline: lower bound `max(0.5, b)` for a policy `balanced_accuracy >= b`, and 0.5 otherwise. A policy `balanced_accuracy <= u` gives the band [0.5, u].
  - `PERF-MULTI` takes accuracy, `macro_recall` (as balanced_accuracy), macro_precision and macro_f1 in the same way. Its chance baseline is `max(1/k, b)` for a policy `macro_recall >= b`, and 1/k otherwise.
  - `PERF-REG` takes mae and rmse, and has `passBlockedBy: ["r2"]`.
  - `PERF-CAL` exists when a score column is mapped. It has gap band null, a Brier member from `brier_score`, and `passBlockedBy: ["expected_calibration_error"]`.
  - `FAIR-DP`, `FAIR-DI` and `FAIR-EO` get the bands ±δ, [τ, 1/τ] and ±δ from `demographic_parity_difference`, `disparate_impact_ratio` and `equalized_odds_difference`.
  - A criterion whose policy has no value it can decide gets no member or band (`no_threshold`).
  - Thresholds on `expected_calibration_error` and `r2` are never applied: those metrics are descriptive entries, and `passBlockedBy` makes them block a pass whether or not the policy sets a threshold (section 4.8).
- **Freezing.** Changing any field after approval MUST create a new profile version (#22 acceptance criterion). Hosted profiles are immutable once saved: a profile with the same name and version is refused, and each run freezes the plan that decides it into `manifest.statistics`, with its hash in `provenance.inputHashes.statisticsPlan`.

**Reconciliation with #15 (recorded for H2, 6 November 2026).** #15 (PR #56) changed the hosted point-estimate rule after this section was first written: binary performance gained `performancePositiveLabel`, failed when balanced accuracy did not exceed 1/2 (1/k for multiclass), and was inconclusive when accuracy did not exceed the majority-class share. Under 1.0.0:
- `performancePositiveLabel` is kept. It is part of the hosted 1.0 configuration and of the 1.1 profile's `config`, and the binary performance criterion's counts are taken relative to it. The derived plan, and so its hash, does not change: the positive class decides which rows are counted, not which members the plan holds.
- The "balanced accuracy above chance" rule becomes the chance-baseline member `balanced_accuracy ≥ 0.5` (macro recall ≥ 1/k), decided by its interval and, for a pass, by the chance gate of section 5.2. A point estimate at or below chance can no longer fail by itself: it fails only when the interval lies below the bound.
- The majority-class rule has no member. Its purpose, keeping a model that ignores the truth from passing on accuracy, is met by the chance baseline and its gate, which bound such a pass at α/2 whatever the class balance (section 5.2). As decided for statistics 1.0.0, a chance-baseline fail does not get an extra exact (Fisher lower-tail) gate; section 6 documents its rate, and the gate is on the Later list.
- #15's descriptive `prevalence` and `majority_baseline_accuracy` metrics are not part of the 1.4 standard metric set (section 4.8); the counts they come from are in the members' `details.counts`.

## 10. Threshold library

### 10.1 Library entries

Library entries are versioned data, shipped identically in both runners. The data file is `schemas/threshold-library.json` (#22); both runners read generated copies of it (`npm run sync`): the hosted runner `site-app/lib/threshold-library.json`, and `engine/statistics.py` `engine/threshold-library.json`, from which it loads the entries a criterion can reference (#113; the copy sits in `engine/` so that the compute image built from that folder carries it). `engine/tests/test_threshold_library.py` checks the copy and the loaded entries.
- A plan references an entry by `id` and `version` and stores the parameter values (section 9.1).
- Every result that uses an entry MUST show its `legalStatus` label and `caveat` text verbatim. `decision.libraryEntry` carries both.
- The run schema's `threshold.source` stays `"internal_policy"`, because the auditor adopts every entry as an internal acceptance rule.
- **Caveats are timeless.** Facts that can change are kept in the entry's `statusNotes` as `{asOf, text, source}`. Results show the current notes beside the frozen caveat, but the notes are not frozen into results. Updating a note does not change the entry version.

| id@version | Metric and band | Parameters (default; range) | legalStatus | Caveat shown with every result | Sources |
|---|---|---|---|---|---|
| `screen.us.four-fifths@1` | selection_rate_ratio, `all_pairs`, [τ, 1/τ] | τ (0.8; 0.5–0.95) | `screening_heuristic` | "Four-fifths screen: a rule of thumb from the US Uniform Guidelines (29 CFR 1607.4(D)), not a legal test of discrimination." | [29 CFR 1607.4(D)](https://www.law.cornell.edu/cfr/text/29/1607.4) |
| `report.us-nyc.ll144@1` | reporting profile (section 10.2); no band, no pass/fail | 2% exclusion on or off per category, with a justification | `reporting_only` | "NYC Local Law 144 requires these figures to be published; it sets no pass or fail threshold." | [DCWP final rule](https://www.sidley.com/-/media/resource-pages/ai-monitor/laws-and-regulations/20230406-nyc-dcwp-notice-of-adoption-of-final-rule-for-local-law-144.pdf?la=en); [NYC rules page](https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/) |
| `policy.eu-aia.selection-rate-difference@1` | selection_rate_difference, `all_pairs`, ±δ | δ (0.10; 0.01–0.30) | `no_legal_safe_harbour` | "Internal policy. The EU AI Act sets no numerical fairness threshold, and meeting this one gives no presumption of conformity." | [Art. 10](https://artificialintelligenceact.eu/article/10/), [Art. 9(8)](https://artificialintelligenceact.eu/article/9/) |
| `policy.eu-aia.impact-ratio@1` | selection_rate_ratio, `all_pairs`, [τ, 1/τ] | τ (0.80; 0.5–0.95) | `no_legal_safe_harbour` | same | same |
| `policy.eu-aia.equalized-odds@1` | equalized_odds (TPR and FPR differences), ±δ | δ (0.10; 0.01–0.30) | `no_legal_safe_harbour` | same | same |
| `policy.eu-aia.declared-performance@1` | one performance metric, lower bound = declared − tolerance | `metric`, `declaredValue` (required), `tolerance` (required; 0–0.2) | `no_legal_safe_harbour` | "Checks consistency with the accuracy level declared under Art. 15(3); not a conformity assessment." | [Art. 15](https://artificialintelligenceact.eu/article/15/) |
| `policy.eu-aia.calibration@1` (engine) | calibration_gap per bin, ±δ | δ (required; 0.01–0.2) | `no_legal_safe_harbour` | same as the EU fairness entries | [Annex IV](https://artificialintelligenceact.eu/annex/4/) |
| `policy.eu-aia.art50-marking-presence@1` | marking presence rate (attribute sampling), lower bound | lower (0.95; 0.90–0.999) | `no_legal_safe_harbour` | "Internal policy. Art 50 sets no numerical marking, detection or labelling threshold, and meeting these bands is not by itself evidence of legal compliance or a presumption of conformity." | Art 50 research, MD-A50-01 |
| `policy.eu-aia.art50-declared-detection@1` | detection rate on unaltered outputs, lower bound = declared − tolerance | declaredValue (0.97; 0–1), tolerance (0.02; 0–0.05) | `no_legal_safe_harbour` | same as the Art 50 entries | MD-A50-02 |
| `policy.eu-aia.art50-false-positive@1` | false-positive rate of detection, upper bound = declared + tolerance | declaredValue (0.005; 0–0.045), tolerance (0.005; 0–0.005) | `no_legal_safe_harbour` | same | MD-A50-03 |
| `policy.eu-aia.art50-disclosure-probe@1` | self-identification rate under probing, lower bound | lower (0.98; 0.95–0.999) | `no_legal_safe_harbour` | same | MD-A50-04 |
| `policy.eu-aia.art50-disclosure-compliance@1` | disclosure compliance rate (labels, notices, exempt-feature classification, completeness), lower bound | lower (0.95; 0.90–0.99) | `no_legal_safe_harbour` | same | MD-A50-05 |

The Art 50 entries come from the Art 50 research (#59, PR #71, A50-ED-40) and stay pending the qualified legal review of #57 (D-02). Their kind is `attribute_sampling`, which no plan criterion has in 1.0.0: they are data for the GenAI evidence work of M2, and no runner decides them until then (D-01). The research defaults for an undeclared rate (0.95 detection, 0.01 false positives) are the entries' default parameters, and a status note records the finding that no rate was declared.

Status notes:

- **`screen.us.four-fifths@1`, as of 5 November 2026.** The EEOC has sent OIRA a final rule rescinding the Guidelines' interpretive provisions. The rule text is unpublished, and its scope, including whether it removes the four-fifths rule, is unconfirmed ([DirectEmployers, 23 Oct 2026](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/), secondary). The entry stays a configurable screen either way (Q5).
- **Standards.** No harmonised standard gives a numerical safe harbour as of November 2026. The research brief says prEN 18283 is a working draft; this was not re-verified here.

### 10.2 NYC LL144 reporting computations

These computations follow the DCWP rule (6 RCNY §§ 5-300 to 5-303). #30 builds the pack and summary; this section fixes the arithmetic.

- **Selection rate.** The number of a category's individuals who were selected or classified, divided by the category's total. The rule defines it as "the rate at which individuals in a category are either selected to move forward … or assigned a classification" (§ 5-300).
- **Scoring rate.** The share of a category scoring strictly **above the sample's median score** (§ 5-300).
  - The median is computed over the **full sample**: every scored individual in the audit data, including those in an unknown category. § 5-301(c)(1) requires the auditor to "Calculate the median score for the full sample of applicants".
  - Unknown-category individuals are left out only of the per-category scoring rates and impact ratios (§ 5-301(c)(5)).
  - The median is the ordinary sample median, the mean of the two middle values when n is even.
- **Impact ratio.** The category's rate divided by the rate of the most selected (or highest-scoring) category, computed for sex, race/ethnicity and intersectional categories. The reference category is the first maximum in input order among the categories that are not excluded.
- **2% exclusion.** The auditor MAY exclude a category representing less than 2% of "the data being used for the bias audit" from the impact-ratio calculations (§ 5-301(d)).
  - The denominator is every individual in that data, including the unknown category: `shareOfData = n_c / (Σ n_known + n_unknown)`, compared strictly below 0.02.
  - The runner also reports `shareOfKnown`, the share among known categories only, so the justification can address both readings.
  - The runner flags eligible categories (`eligibleForTwoPercentExclusion`) but never excludes them automatically.
  - If a category is excluded, the summary must give the justification, the number of applicants and the category's rate (§ 5-301(d)).
- **Unknown category.** Report the number of individuals in an unknown category, who are not included in the per-category calculations (§ 5-301(b)(5) and (c)(5)).
- **Supplementary intervals.** Each rate gets a Wilson interval, and each impact ratio a Katz/Koopman interval against the reference category. These are labelled "supplementary; not required by the rule; the reference category is chosen from the data, so intervals are conditional on that choice".
- **Published summary fields (§ 5-303).**
  - the date of the most recent bias audit;
  - the source and explanation of the data, plus why test data was used, if it was (§ 5-302);
  - the number of individuals in the unknown category;
  - the number of applicants or candidates;
  - selection or scoring rates and impact ratios for all categories;
  - the AEDT's distribution date.

GC-32 reproduces the DCWP worked example for race/ethnicity exactly.
- Black or African American has an impact ratio of 0.8432, which the rule shows as 0.84, with interval [0.7394, 0.9616].
- Native American or Alaska Native is 41 of 2,834 individuals (1.45%; 1.59% of the known categories), so it is eligible for the 2% exclusion under either reading.
- GC-33 runs the same data through the four-fifths library screen. The published ratios of 0.84–0.85 look like passes, but the screen is **inconclusive**: the worst ratio's interval reaches 0.5970.

The quoted rule text was checked against an unofficial reproduction of the adopted rule ([AGORA](https://agora.eto.tech/instrument/2002)), because the official PDF could not be text-extracted during this revision.

## 11. Output contract

### 11.1 Contract versions

The run schema's `oneOf` discriminates by `contractVersion`, and each number names exactly one contract. New numbers continue the sequence and are never reused:

| contractVersion | Contract | Status |
|---|---|---|
| 1.0 | engine report and legacy hosted run | frozen; validated with today's rules |
| 1.1 | hosted saved-prediction run | frozen; today's rules |
| 1.2 | compiled external audit run | frozen; today's rules |
| **1.3** | engine report under statistics 1.0.0 (#21, E2) | new |
| **1.4** | hosted run under statistics 1.0.0 (#22, H2) | new |
| **1.5** | compiled external audit run under statistics 1.0.0 (#21 E4 with #22 H4) | new |

Related documents get their own new versions:
- engine configuration 1.3, with `statistics`;
- hosted profile `schemaVersion` 1.1, with `statistics` and `config.negativeLabel`;
- worker `engineConfig` 1.4, with `statistics` and the profile's declared label pair in `config`; its top-level `negativeLabel` MUST equal `config.negativeLabel` (E4);
- `hostedTranslation.sourceContract` "1.1" or "1.4", with a new `TRANSLATION_VERSION`.

The engine, the hosted runner and the worker accept both the legacy and the new configuration, and always emit the new report or run version.

### 11.2 Result, metric and decision shapes (1.3, 1.4, 1.5)

All three share one result shape: `{testId, label, article, outcome, metrics, limitations, decision}`.
- `testId` is the criterion `id`, so derived plans keep today's ids (the result-id rule below).
- `article` follows the criterion's kind: "15" for the performance kinds and calibration, "10" for group criteria.
- `outcome` is the adjusted outcome.
- `limitations` gains plain-language messages for the reasons. The text "No confidence intervals are estimated." MUST be removed.

**Result ids.** One rule binds results to the plan on every path. It replaces every check that ties results to the five hosted test names (sites in H2, E4 and H4):
- `results` holds exactly one result per criterion of the recorded plan, in plan order, and each `testId` is its criterion's `id`. An engine report may also hold results this specification does not govern (section 4.6), which keep today's ids.
- The article and the allowed metric names follow the criterion's `kind`, and for group criteria its `metric`, never the test id:
  - performance kinds: the standard metric set of the kind (section 4.8) and, for binary data, `false_positive_rate`, with `macro_recall` for multiclass balanced accuracy in the engine, plus the supplementary descriptive entries `prevalence` (binary) and `majority_baseline_accuracy` (section 4.8);
  - group criteria: the headline name of section 11.3 for the criterion's metric, and member names `metric:subject|comparator` whose metric is the criterion's `selection_rate_difference` or `selection_rate_ratio`, or `tpr_difference` and `fpr_difference` for `equalized_odds`;
  - calibration: `maximum_calibration_gap`, `calibration_gap:bin<b>`, `brier_score` and `expected_calibration_error`.
- A derived plan's criterion ids are today's test ids: the hosted suite names, or `PERF-*` and `FAIR-*` in the engine. So a derived run keeps today's ids, one result per suite test. An explicit plan chooses its own ids, up to 20 (GC-31, GC-37).

**`suite`.** Profiles, configurations and runs keep `suite`, with today's meaning: the test families that run.
- A hosted profile with `schemaVersion` 1.1 that stores a plan MUST have as `suite` exactly the families its criteria use, compared as sets:
  - `performance` for a binary or multiclass performance criterion, and `regression` for a regression criterion;
  - for group criteria, `demographic_parity` (selection_rate_difference), `disparate_impact` (selection_rate_ratio) or `equalized_odds`.

  A hosted plan cannot contain calibration criteria, because hosted profiles map no score column. A profile without a stored plan selects tests with `suite` as today, and the plan is derived from it.
- Hosted 1.4 and external 1.5 runs keep `suite`, copied from the profile. It still enters the configuration hash, and today's task rules on `suite` still apply. Only the requirement that the results' test ids equal `suite` is replaced, by the result-id rule.
- An engine 1.3 configuration keeps its `suite`. It MUST include `performance` when the plan has a performance or calibration criterion, and `fairness` when it has a group criterion.

A **metric** has the shape the external 1.2 projection already uses (`externalMetric`): `{name, value, unit, sampleSize, numerator, denominator, threshold, confidenceInterval, slices, details, pValue}`.
- **Order.** `metrics` lists the headline first (group and calibration criteria), then the members in formation order, then the descriptive entries in standard order (section 4.8).
- **`threshold`** is the legacy policy rule for the metric's name, or null. That is exactly `threshold_for` today, so a member such as `selection_rate_difference:A|B` has null.
- **`details`** is `{role, metric, subject, comparator, counts, band, status, direction, smallCell, fisherExactP, chanceExactP, reasons}`, with role `headline`, `member` or `descriptive`. `chanceExactP` is the chance gate's p (section 5.2), and null on every metric that has no gate.
  - Two optional, engine-only keys (#93): `bootstrap` `{replicates, validReplicates, clusters}` on every member and descriptive entry that a clustered plan decides by the cluster bootstrap (section 5.11), and `sensitivityInterval` (an interval or null) on MAE and RMSE entries for independent rows (section 5.9). The hosted runner emits neither, and the worker copies them unchanged.
- **`confidenceInterval`** is `{lower, upper, level, method}`, or null when undefined. The method values are `wilson`, `newcombe_hybrid_score`, `katz_log`, `koopman_score`, `mover_wilson`, `jaccard_wilson`, `jaccard_wilson_bonferroni`, `wilson_bonferroni_mean`, `normal_approximation`, `normal_approximation_mse`, `percentile_bootstrap`, `cluster_percentile_bootstrap` and `worst_member_bounds`.

The **decision** object is:

```
{statisticsVersion, confidenceLevel, role, kind, direction, pValue, adjustedPValue, adjustment,
 familySize, unadjustedOutcome, decidingMemberId, sampleSize, coverage, suppressedGroups,
 libraryEntry, reasons}
```

- `sampleSize` counts the rows the criterion evaluated:
  - performance kinds: all rows, including the unknown group;
  - group criteria: rows with a known group;
  - calibration: scored rows.
- `coverage` is `{eligibleRows, populationRows, unknownGroupRows, value, minimum}` for group and calibration criteria, and null otherwise.
  - `eligibleRows` is the rows in groups (bins) with n ≥ `minimums.groupSize`.
  - `populationRows` is the rows in all groups plus `unknownGroupRows`; for calibration it is all scored rows.
  - `value` is eligibleRows / populationRows, and `minimum` is the criterion's `minimumCoverage`.
- `suppressedGroups` is a list of `{group, n}`, including declared groups with n = 0, or null.
- `libraryEntry` is `{id, version, legalStatus, caveat}` or null.

The **run** adds `reviewFlags` and records the plan:
- engine: `configuration.statistics` and `provenance.statisticsPlanSha256`;
- hosted and external: `manifest.statistics` and `provenance.inputHashes.statisticsPlan`.

### 11.3 Metric names

Headline names keep each runner's existing names, so `threshold_for` keys, `METRIC_ALIASES` and the headline values of `hostedMetric.name` stay valid. The per-test `resultRules` of `schemas/.build-run-schema.py` stay valid only for these headline names. A 1.4 `demographic_parity` result also carries members such as `selection_rate_difference:B|A`, and a performance result carries descriptive entries such as `specificity` (GC-38). So the 1.4 and 1.5 schemas key their name and article rules on the criterion kind instead (section 11.2; H2, H4).

The headline names are:

| Criterion metric | Engine name (1.3) | Hosted and external name (1.4, 1.5) | Value |
|---|---|---|---|
| selection_rate_difference | `demographic_parity_difference` | `maximum_selection_rate_gap` | largest gap (section 4.7); in all-pairs mode, max − min |
| selection_rate_ratio | `disparate_impact_ratio` | `minimum_selection_rate_ratio` | smallest folded ratio; in all-pairs mode, min/max |
| equalized_odds | `equalized_odds_difference` | `maximum_tpr_fpr_gap` | largest \|TPR or FPR difference\| |
| calibration (engine) | `maximum_calibration_gap` | – | largest \|gap\| over eligible bins |

Member and descriptive names are the fixture's memberIds in both runners, with one exception: the engine keeps `macro_recall` for multiclass balanced accuracy. The worker's `METRIC_ALIASES` keeps its three headline entries and adds `macro_recall → balanced_accuracy` for multiclass results.

In 1.4 the value range of `maximum_selection_rate_gap` widens to [−1, 1], because a one-sided gap can be negative, and the range of `minimum_selection_rate_ratio` to ≥ 0, because a reference-mode ratio can exceed 1.

### 11.4 Fixture-to-output mapping

| Fixture | Output |
|---|---|
| `criteria[i].id` | result `testId` |
| `criteria[i].outcome` | result `outcome` |
| `criteria[i].decision.*` | result `decision.*`: same names, same values |
| `criteria[i].headline` | `metrics[0]`, with details.role `headline` |
| `headline.names.engine` / `.hosted` | `name` in the engine / in hosted and external results |
| `headline.estimate`, `.interval`, `.band` | `value`, `confidenceInterval` (method `worst_member_bounds`), `details.band` |
| (headline) | `pValue` null; `threshold` = legacy rule for the name or null; `details.metric` = the criterion metric |
| `criteria[i].members[j]` | the next metrics, with details.role `member` |
| `criteria[i].descriptive[j]` | the metrics after the members, with details.role `descriptive` |
| member or descriptive `memberId` | `name` (engine multiclass `balanced_accuracy` → `macro_recall`) |
| `estimate` | `value` |
| `interval` | `confidenceInterval` |
| `pValue` | `pValue` (null for descriptive entries) |
| `counts.x`, `counts.n` (single proportions) | `numerator`, `denominator`, which are null for every other method |
| `metric`, `subject`, `comparator`, `counts`, `band`, `status`, `direction`, `smallCell`, `fisherExactP`, `chanceExactP`, `reasons` | `details.*` with the same names |
| (member or descriptive) | `unit` (today's units), `sampleSize` (= `decision.sampleSize`), `threshold`, `slices` [] |
| `criteria[i].groups[k]` | the headline metric's `slices[k]` |
| `group`, `n`, `declared`, `suppressed` | `slice`, `n`, `declared`, `suppressed` |
| `selection.{x, n, estimate, interval}` | `selectionNumerator`, `selectionDenominator`, `selectionRate`, `selectionConfidenceInterval` (today's `fairness()` names) |
| `tpr.*`, `fpr.*` | `tprNumerator`, `tprDenominator`, `tpr`, `tprConfidenceInterval`, and likewise for `fpr` |
| bin `observed.*`, `meanScore` (calibration) | `numerator`, `denominator`, `observedRate`, `confidenceInterval`, `meanProbability`; the runner adds the bin edges `lower` and `upper` |
| `expected_calibration_error`, `r2` intervals | null at core level; the engine adds a bootstrap interval end to end, and the comparison skips them |
| member or descriptive `bootstrap` (clustered plans) | `details.bootstrap` |
| (MAE, RMSE, independent rows) | `details.sensitivityInterval`, added end to end only; the comparison skips it |
| `normalizedPlan`, `planSha256` | `configuration.statistics` with `provenance.statisticsPlanSha256` (engine); `manifest.statistics` with `provenance.inputHashes.statisticsPlan` (hosted and external) |
| `overallOutcome`, `reviewFlags` | run `outcome` and `overallOutcome`; run `reviewFlags` |

### 11.5 Limits

- **Metrics per result:** at most 2,451, that is, one headline plus 2 × C(50, 2) all-pairs equalized-odds members. Reference mode with 1,000 groups needs at most 1,999. This replaces three limits: `hostedResult.metrics` `maxItems` 20, the external `maxItems` 100, and the 100 metrics that `resultEnvelope` in `site-app/lib/assurance-core.ts` allows.
- **Slices:** at most 1,000 per metric in the engine and 50 in the hosted runner.
- **Names:** metric names may have up to 20,480 characters (two escaped group labels of up to 5,000 characters, plus the metric prefix). This replaces the 300-character limits of `externalMetric.name` and of `resultEnvelope`.
- **Results:** a hosted run holds up to 20 results, one per plan criterion, up from 5.

### 11.6 Validation rules for 1.3, 1.4 and 1.5

These rules replace today's point-estimate checks: `validate_report`'s contractVersion check (L34), its pass rule (L99–100) and its aggregation (L104–106), and the aggregations in `schemas/validate-run-schema.mjs` (L80, L238), `site-app/lib/commands/runs.ts` (`executeRun`, L180; it was `site-app/app/api/workspace/route.ts` L982 before the command split), `site-app/lib/commands/assurance/execution.ts` (`importJob`, L371; it was `site-app/app/api/assurance/route.ts` L1367 before the command split of #50) and `schemas/generate-external-fixtures.py` (`project()`). Frozen 1.0–1.2 documents keep today's rules.

1. **Outcome agrees with the decision.** `outcome` is pass or fail exactly when `decision.direction` has that value and `decision.adjustedPValue ≤ α + 1e−12`, with α = 1 − `decision.confidenceLevel`. Otherwise it is inconclusive. `unadjustedOutcome` is the same function of `decision.pValue`.
2. **A pass** needs four things:
   - every role-`member` metric whose status is not `suppressed` is `evaluated` with direction pass;
   - `decision.reasons` contains no pass-blocking code (`below_minimum_sample_size`, `insufficient_coverage`, `empty_declared_group`, `insufficient_groups`, `too_many_groups`, `no_threshold`, `undecidable_metric`, `invalid_band`), and the plan criterion's `passBlockedBy` is empty;
   - `decision.pValue` equals the largest of those members' pValues;
   - `decidingMemberId` names that member.
3. **A fail** needs an evaluated member with direction fail, `decision.pValue = min(1, m · its pValue)` with m the number of evaluated members, and `decidingMemberId` naming it.
4. **Descriptive entries** have `details.band` null, `details.direction` `none` and `pValue` null.
5. **Bands and thresholds.** Every member's `details.band` equals the band of its plan criterion (for performance kinds, of the plan member). A metric's `threshold` is null or equals the legacy policy rule for its name.
6. **Family.** `decision.familySize` equals the number of plan criteria with that role. `adjustedPValue` equals `min(1, F·pValue)` (confirmatory) or BH recomputed over the family's pValues (exploratory).
7. **Run outcome** is the section 4.6 aggregation: confirmatory criteria and results without a `decision`, never exploratory criteria. `reviewFlags` lists the exploratory criteria whose outcome is fail.
8. **Plan.** The recorded plan validates against the plan schema, is normalised, and hashes to the recorded `planSha256`. Every `decision.statisticsVersion` equals the plan's.
9. **Limits.** Section 11.5.
10. **Result ids and `suite`.** The results' test ids equal the recorded plan's criterion ids, in plan order, apart from engine results without a `decision`. Each result's article and metric names follow its criterion's kind (section 11.2). For a hosted profile with a stored plan, and the 1.4 and 1.5 runs made from it, `suite` equals the families of the plan's criteria.
11. **Chance gate.** A balanced-accuracy member whose band's lower bound is at or above chance (0.5 for binary data; 1/k for multiclass data, with k the number of classes in `details.counts.perClass`) has a non-null `details.chanceExactP` when its value is defined. When its direction is pass, its `pValue` is at least `details.chanceExactP`. Every other metric has `details.chanceExactP` null (section 5.2).

## 12. What each runner mirrors

| Component | Hosted runner (`site-app/lib`) | Engine | Worker projection (`engine/worker_contract.py`) |
|---|---|---|---|
| Normal quantile and `erfc`; Wilson, Newcombe, Katz-log, Koopman, MOVER, Jaccard–Wilson, Bonferroni macro intervals, normal approximation | **mirror exactly** (golden, 1e−6) | yes | not computed: copied from the engine |
| Decision p-values (closed forms and bisection), gates, criterion combination, headline bounds, descriptive entries | **mirror exactly** | yes | copied |
| Fisher's exact test: two-sided (small-cell gate on fails) and one-sided (chance gate on passes) | **mirror exactly** | yes | copied |
| Bonferroni and BH, families, run aggregation, `reviewFlags` | **mirror exactly** | yes | copied; the compiled external run aggregates per section 4.6 (H4) |
| Minimum floors; suppression; coverage; `all_pairs` and `reference` modes; group limits | **mirror exactly** | yes | `translate_config` applies `max(floor, configured)` and records both |
| Plan normalisation, RFC 8785 hash, legacy derivation | **mirror exactly** | yes | derives the hosted plan for `engineConfig` 1.1, or carries 1.4's `statistics` |
| Binary data in which only one of the two declared labels occurs (GC-15, GC-37) | **evaluate** when both labels are declared (`positiveLabel` and the new `negativeLabel`); the gates of section 4.4 decide. A legacy profile without `negativeLabel` keeps today's two-label check. | yes (`positiveLabel` and `negativeLabel` are already declared) | `engineConfig` 1.4: the profile's declared pair, with the top-level `negativeLabel` equal to `config.negativeLabel`. `engineConfig` 1.1: #47's top-level `negativeLabel`; without it, the other label derived from the data, or in `auditor_model` mode from `modelSpec.outputLabels` (E4) |
| Power and MDE at plan approval | **mirror** (approval UI), except the mean baseline gate of `targetSd`: the hosted plan normaliser drops `targetSd` and the approval UI does not ask for it (a follow-up of #93) | yes (CLI and report) | – |
| Threshold library (data) | **mirror** | yes | copied |
| LL144 computations | via #30 (same arithmetic) | via #30 | – |
| Intersectional strata (several protected columns) | **mirror** once the profile accepts up to five group columns, which #30 adds (section 15); until then one column | yes (`intersectional_slices`) | – |
| Calibration bins, ECE and Brier (need score columns) | not available; `interval_requires_engine` | engine-only | copied |
| Cluster bootstrap, descriptive bootstrap (ECE, R²) and the MAE/RMSE sensitivity interval | not available: a plan with a `clusterField` is rejected (section 5.11) | engine-only (#93) | copied; a hosted `engineConfig` 1.4 plan with a cluster design is rejected |
| Boschloo, BCa, shrinkage | not in 1.0.0 | possible engine-only additions (Q8; on the Later list) | – |

## 13. Golden cases and how they were verified

### 13.1 Fixture format (`schemas/fixtures/statistics-golden.json`, fixture `schemaVersion` 1.1)

**Top level.** The fixture has `specificationVersion`, `howToUse`, `defaults`, `tolerances`, `numerics` and `cases[]`. The `numerics` section holds normal quantiles and `erfc` reference values for validating special functions.

**Case types:**
- `plan`: data and a plan (`plan`, or `legacy` to be derived; a multiclass derivation takes k from the data) in; out come `planSha256`, `normalizedPlan`, the criteria (each with `id`, `outcome`, `headline`, `members`, `descriptive`, `groups` and `decision`), `overallOutcome` and `reviewFlags`.
- `derivation`: a legacy configuration in; `planSha256` and `normalizedPlan` out.
- `multiplicity`: raw p-values in, adjusted values out.
- `power`: kind `equality_test`, or kind `criterion`, which takes a criterion with `powerAssumptions`, the confidence level, the target power and the family size.
- `fisher`.
- `ll144`.

**Data shapes:**
- `groups[]` with `{tp, fp, fn, tn}` or `{selected, n}`, plus optional `unknownGroupRows`;
- `bins[]` for calibration;
- `labels` and `matrix` for multiclass;
- `errors` and optional `targets` for regression;
- for a plan with a `clusterField` (GC-54 to GC-57): `{seed, clusters: [{cluster, ...that cluster's data in one of the shapes above}]}`. The criterion data is the sum of the clusters' data (section 5.11), and every bootstrapped member and descriptive entry also carries `bootstrap`.

**Fields per case:**
- `runners`: `["engine"]` for calibration, the clustered cases and GC-58 (the mean baseline gate in power), otherwise both.
- `endToEnd`: whether the case can also be expanded into rows and run through the real runner.
  - The expansion rule is in `howToUse.rowExpansion`. Binary labels are declared as positive `"1"` and negative `"0"`, and data with only one observed label must be evaluated.
  - The hosted runner skips cases with more than 10,000 rows, unknown-group rows, declared groups or reference mode.
  - A `legacy` case runs with its legacy configuration. A `hosted_config` case runs directly in the hosted runner and through the worker translation in the engine; an `engine_thresholds` case runs directly in the engine only.

**Comparison rules:**
- Numbers: |Δ| ≤ 1e−6. P-values: |Δ| ≤ 1e−9 + 1e−5·|expected|.
- Members and descriptive entries are matched by memberId, and groups by group.
- `reasons` are compared as sets.
- Everything else must match exactly, including `normalizedPlan` and `planSha256`.
- Stored numbers have 12 significant digits, except in `normalizedPlan`, which is stored exactly. The tables below round to 4 decimal places.
- Section 11.4 maps every fixture field to the emitted output.

### 13.2 The cases

Inputs are counts (x/n means x selected out of n). The key member is the deciding member. "Decision p" is the criterion P before family adjustment, and "adjusted p" is after Bonferroni (confirmatory) or BH (exploratory). Every performance-kind case also carries its descriptive entries, and every group case its per-group rates.

| Case | Category | Criterion (band) and input | Key member: estimate, 95% interval | Decision p | Adjusted p | Outcome; reasons |
|---|---|---|---|---|---|---|
| GC-01 | small sample | recall ≥ 0.70; TP 40, FN 10 | recall 0.8000 [0.6696, 0.8876] | 0.1228 | 0.1228 | **inconclusive**; interval_straddles_band |
| GC-02 | large sample | accuracy ≥ 0.90; 9,120/10,000 correct | accuracy 0.9120 [0.9063, 0.9174] | 6.3e−05 | 6.3e−05 | **pass** |
| GC-03 | fail | accuracy ≥ 0.90; 80/100 correct | accuracy 0.8000 [0.7112, 0.8666] | 0.0009 | 0.0009 | **fail** |
| GC-04 | zero numerator | FPR ≤ 0.10; FP 0 of 40 negatives | FPR 0.0000 [0.0000, 0.0876] | 0.0350 | 0.0350 | **pass** |
| GC-05 | all events | precision ≥ 0.85; TP 30, FP 0 | precision 1.0000 [0.8865, 1.0000] | 0.0214 | 0.0214 | **pass** |
| GC-06 | zero denominator; constant predictor | accuracy ≥ .9, recall ≥ .7, BA ≥ .5, precision ≥ .5, F1 ≥ .5; TP 0, FP 0, FN 60, TN 940 | recall 0.0000 [0.0000, 0.0602]; precision undefined; BA on bound | 1.1e−31 | 1.1e−31 | **fail**; estimate_on_band_boundary, undefined_zero_denominator |
| GC-07 | single class | accuracy ≥ .8, BA ≥ .5, specificity ≥ .8; TP 45, FN 5, no negatives | accuracy 0.9000 [0.7864, 0.9565]; BA and specificity undefined | 1 | 1 | **inconclusive**; single_class |
| GC-08 | small sample (issue) | four-fifths [0.8, 1.25]; A 6/20, B 10/20 | ratio A\|B 0.6000 [0.2696, 1.3355] (suppressed, descriptive) | 1 | 1 | **inconclusive**; group_suppressed_below_minimum, insufficient_coverage, insufficient_groups |
| GC-09 | large sample (issue) | four-fifths; A 22,500/50,000, B 25,000/50,000 | ratio 0.9000 [0.8883, 0.9118] | 7.5e−70 | 1.5e−69 | **pass** |
| GC-09 | large sample (issue) | parity ±0.02, same data | difference −0.0500 [−0.0562, −0.0438] | 2.1e−21 | 4.2e−21 | **fail** |
| GC-10 | perfect parity | parity ±0.10; 150/300 each | difference 0.0000 [−0.0795, 0.0795] | 0.0133 | 0.0267 | **pass** |
| GC-10 | perfect parity | four-fifths, same data | ratio 1.0000 [0.8521, 1.1735] | 0.0063 | 0.0126 | **pass** |
| GC-11 | perfect parity, small | parity ±0.10; 15/30 each | difference 0.0000 [−0.2382, 0.2382] | 0.4339 | 0.4339 | **inconclusive**; interval_straddles_band |
| GC-12 | extreme imbalance | four-fifths; majority 4,500/9,000, minority 12/40 | ratio 0.6000 [0.3736, 0.9637] | 0.2341 | 0.4681 | **inconclusive**; interval_straddles_band |
| GC-12 | extreme imbalance | parity ±0.10, same data | difference −0.2000 [−0.3197, −0.0454] | 0.1977 | 0.3954 | **inconclusive**; interval_straddles_band |
| GC-13 | zero numerator | four-fifths; A 0/40, B 10/40 | ratio 0.0000 [0.0000, 0.3579] Koopman; Fisher 0.0010 | 0.0027 | 0.0027 | **fail** |
| GC-14 | small cell | four-fifths; A 0/30, B 5/30 | ratio 0.0000 [0.0000, 0.7143] Koopman; Fisher 0.0522 | 0.0522 | 0.0522 | **inconclusive**; small_cell_exact_test_not_significant |
| GC-15 | zero denominator; one observed label | parity ±0.10; A 0/50, B 0/50 | difference 0.0000 [−0.0713, 0.0713] | 0.0184 | 0.0368 | **pass** |
| GC-15 | zero denominator | four-fifths, same data | ratio undefined (0/0) | 1 | 1 | **inconclusive**; undefined_zero_denominator |
| GC-16 | empty group | parity ±0.10; A 200/400, B 196/400, declared C has no rows | difference −0.0100 [−0.0789, 0.0590] | 1 | 1 | **inconclusive**; group_suppressed_below_minimum, empty_declared_group |
| GC-17 | multiplicity (within criterion) | parity ±0.05; A 300/600, B 290/600, C 234/600 | C\|A −0.1100 [−0.1652, −0.0538], own p 0.0365 | 0.1093 | 0.1093 | **inconclusive**; within_criterion_multiplicity |
| GC-18 | multiplicity | Bonferroni of [0.004, 0.030, 0.012, 0.200] | adjusted [0.016, 0.120, 0.048, 0.800] | | | claims at 1 and 3 |
| GC-19 | multiplicity | BH of [0.001, 0.008, 0.039, 0.041, 0.042, 0.060, 0.074, 0.205] | adjusted [0.008, 0.032, 0.0672, 0.0672, 0.0672, 0.080, 0.0846, 0.205] | | | claims at 1 and 2 |
| GC-20 | equalized odds | EO ±0.10; A TP 160, FN 40, FP 30, TN 270; B TP 100, FN 100, FP 33, TN 267 | TPR B\|A −0.3000 [−0.3847, −0.2083] | 5.4e−05 | 5.4e−05 | **fail** |
| GC-21 | performance | accuracy ≥ .9, recall ≥ .75, BA ≥ .5, F1 ≥ .75; TP 170, FP 40, FN 30, TN 760 | accuracy 0.9300 [0.9125, 0.9442]; F1 0.8293 [0.7863, 0.8651]; BA 0.9000 [0.8707, 0.9224] | 0.0016 | 0.0016 | **pass** |
| GC-22 | intersectional suppression | parity ±0.10, minimum coverage 0.95; strata F/X 200/400, F/Y 172/350, M/X 214/420, M/Y 190/380, F/Z 5/12, M/Z 8/18 | F/Y\|M/X −0.0181 [−0.0885, 0.0526]; coverage 0.9810 | 0.0224 | 0.0224 | **pass**; group_suppressed_below_minimum |
| GC-23 | intersectional suppression | parity ±0.10, coverage 1.0; F/Y 105/350, otherwise as GC-22 | F/Y\|M/X −0.2095 [−0.2754, −0.1405] | 0.0121 | 0.0121 | **fail**; group_suppressed_below_minimum, insufficient_coverage |
| GC-24 | calibration (engine) | gap ±0.10, minimum coverage 0.95; 10 bins, bin 9 has n = 20 | bin 6 −0.0100 [−0.0712, 0.0470]; coverage 0.9945; ECE 0.0060 (descriptive) | 0.0042 | 0.0042 | **pass**; group_suppressed_below_minimum |
| GC-25 | power | equality test, 0.40 vs 0.50 | n = 388 per group (387.34) | | | |
| GC-26 | power | equality test, 0.08 vs 0.10 | n = 3,213 per group (3,212.94) | | | |
| GC-27 | power | four-fifths band, p₀ 0.5, 388 per group | pass probability 0.7491; 423 per group needed; fail MDE ratio 0.6196 | | | |
| GC-28 | power | ±0.05 band, p₀ 0.3, 500 per group | pass probability 0; 1,766 needed; fail MDE 0.1246 | | | |
| GC-29 | power | recall truly 0.80 vs ≥ 0.70; 200 rows at prevalence 0.25 | pass probability 0.3164; 610 rows needed | | | |
| GC-30 | reference group | ratio ≥ 0.8 vs A; A 200/400, B 150/400, C 190/400 | B\|A 0.7500 [0.6391, 0.8802]; C\|A 0.9500 [0.8241, 1.0952] | 0.8586 | 0.8586 | **inconclusive**; interval_straddles_band |
| GC-31 | end to end (hosted suite) | performance (accuracy ≥ .8, recall ≥ .7, BA ≥ .5); A TP 180, FP 40, FN 20, TN 360; B TP 166, FP 42, FN 34, TN 358 | recall 0.8650 [0.8280, 0.8950] | 6.0e−13 | 2.4e−12 | **pass** |
| GC-31 | | demographic parity ±0.10 | B\|A −0.0200 [−0.0740, 0.0341] | 0.0035 | 0.0142 | **pass** |
| GC-31 | | disparate impact [0.8, 1.25] | B\|A 0.9455 [0.8121, 1.1007] | 0.0313 | 0.1252 | **inconclusive**; multiplicity_adjustment |
| GC-31 | | equalized odds ±0.10 | TPR B\|A −0.0700 [−0.1375, −0.0027] | 0.3792 | 1 | **inconclusive**; interval_straddles_band (run: inconclusive) |
| GC-32 | LL144 reporting | DCWP race/ethnicity example; reference White 412/797; unknown 250 | impact ratios: Hispanic 0.9672 [0.8596, 1.0884]; Black 0.8432 [0.7394, 0.9616]; NHPI 0.8453 [0.6820, 1.0478]; Asian 0.9484 [0.8540, 1.0532]; Native American 0.8493 [0.5970, 1.2081] (1.45% of 2,834: 2% eligible); Two or more 0.8719 [0.7409, 1.0260] | | | reporting only |
| GC-33 | LL144 + four-fifths library entry | same data, all pairs, minimum coverage 0.9 (coverage 0.9118) | worst ratio 0.8432; headline [0.5970, 1.0000] | 0.7396 | 0.7396 | **inconclusive**; interval_straddles_band |
| GC-34 | multiclass | accuracy, BA, macro F1 ≥ 0.75; 3×3 matrix, n = 800 | accuracy 0.8313 [0.8037, 0.8556]; macro recall 0.8222 [0.7925, 0.8468]; macro F1 0.8243 [0.7770, 0.8634]; macro precision 0.8271 (descriptive) | 0.0009 | 0.0009 | **pass** |
| GC-35 | regression | MAE ≤ 1.2, RMSE ≤ 1.5; 40 errors | MAE 0.8825 [0.6928, 1.0722]; RMSE 1.0697 [0.8398, 1.2583]; R² 0.9657 (descriptive) | 0.0010 | 0.0010 | **pass** |
| GC-36 | small cell (Fisher) | 6/20 vs 10/20; 0/30 vs 5/30; 0/40 vs 10/40; 2/40 vs 4,500/9,000; 1/10 vs 1/10; 3/8 vs 7/9; 0/50 vs 0/50 | p = 0.3332; 0.0522; 0.0010; 1.4e−09; 1; 0.1534; 1 | | | |
| GC-37 | all events; one observed label | four-fifths; A 40/40, B 35/35 | ratio 1.0000 [0.9124, 1.1098] Koopman | 0.0031 | 0.0062 | **pass** |
| GC-37 | | parity ±0.10, same data | difference 0.0000 [−0.0876, 0.0989] | 0.0486 | 0.0972 | **inconclusive**; multiplicity_adjustment |
| GC-38 | descriptive metrics; legacy derivation | today's hosted profile (accuracy ≥ .85, recall ≥ .7, parity ±0.10, minimums 20/2/5); A TP 120, FP 20, FN 30, TN 330; B TP 110, FP 25, FN 40, TN 325 | derived: + BA ≥ .5, minimums 30/30/10 (configured recorded); recall 0.7667 [0.7156, 0.8110]; descriptive precision 0.8364 [0.7881, 0.8754], specificity 0.9357, F1 0.8000 | 0.0117; 0.0013 | 0.0235; 0.0027 | **pass**; **pass** |
| GC-39 | derivation | engine 1.0 thresholds (accuracy, precision, recall, F1, Brier, ECE, DP, DI, EO), minimums 30/20/5 | plan: PERF-BINARY with the BA baseline, PERF-CAL with a Brier member and `passBlockedBy` ECE, FAIR-DP ±0.10, FAIR-DI [0.8, 1.25], FAIR-EO ±0.15 | | | plan hash pinned |
| GC-40 | power | parity ±0.10 over A 500, B 500, C 250 at p₀ 0.3 | pairs 0.864, 0.609, 0.609; range [0.0812, 0.6087]; 605 per group; fail MDE 0.1918 (C vs A, α/3) | | | |
| GC-41 | power | accuracy ≥ .85, recall ≥ .7, BA ≥ .5, F1 ≥ .7, FPR ≤ .15; n 400, prevalence 0.25, TPR 0.85, TNR 0.92; family of 3 | members 0.745, 0.870, 1.000, 0.830, 0.906; range [0.3518, 0.7447]; 558 rows | | | |
| GC-42 | power | EO ±0.10; A 600, B 300; prevalence 0.3/0.2; TPR 0.75/0.65; FPR 0.10 | TPR member on the band edge: pass 0; target unreachable; fail MDEs TPR 0.3207, FPR 0.2019 | | | target_unreachable |
| GC-43 | power | multiclass accuracy ≥ .75, BA ≥ .7, macro F1 ≥ .7; n 600 | accuracy 0.9984 and BA 0.9998 computed; macro F1 not computed | | | not_computed |
| GC-44 | power | MAE ≤ 0.9, RMSE ≤ 1.15; n 120, error SD 1 | members 0.4585, 0.7047; range [0.1632, 0.4585]; 293 rows | | | |
| GC-45 | no threshold | engine 1.0 policy with no values; data as GC-21 | all six metrics descriptive, e.g. accuracy 0.9300 [0.9125, 0.9442]; no members | 1 | 1 | **inconclusive**; no_threshold |
| GC-46 | chance baseline (multiclass) | engine 1.0 policy accuracy ≥ .90 only; supports 40/1,900/60, constant majority-class predictor | derived: + macro recall ≥ 1/3; accuracy 0.9500 [0.9396, 0.9587] (p 9.1e−14); macro recall 0.3333 [0.3327, 0.3688] on the bound; descriptive macro F1 0.3248, macro precision undefined | 1 | 1 | **inconclusive**; estimate_on_band_boundary |
| GC-47 | chance baseline (binary) | engine 1.0 policy accuracy ≥ .90, BA ≥ .40; TP 0, FP 0, FN 100, TN 1,900 | derived: BA ≥ max(0.5, 0.40) = 0.5; accuracy 0.9500 [0.9396, 0.9587]; BA 0.5000 [0.4990, 0.5185] on the bound; descriptive recall 0, specificity 1, precision undefined | 1 | 1 | **inconclusive**; estimate_on_band_boundary |
| GC-48 | undecidable metric | engine 1.0 policy MAE ≤ 1, RMSE ≤ 1.2, R² ≥ .5; 400 targets symmetric about 5, mean predictor | MAE 0.5000 [0.4637, 0.5363]; RMSE 0.6220 [0.5779, 0.6632]; R² 0.0000 descriptive; `passBlockedBy` R²; baseline RMSE 0.6220, gate p 1 | 1 | 1 | **inconclusive**; undecidable_metric, mean_baseline_not_beaten |
| GC-49 | chance baseline (hosted multiclass) | today's hosted profile, multiclass (accuracy ≥ .75, macro F1 ≥ .7); data as GC-34 | derived: + macro recall ≥ 1/3 between them; accuracy 0.8313 [0.8037, 0.8556]; macro recall 0.8222 [0.7925, 0.8468]; macro F1 0.8243 [0.7770, 0.8634] | 1.1e−07 | 1.1e−07 | **pass** |
| GC-50 | chance gate (binary) | GC-47's policy; TP 1, FP 0, FN 99, TN 1,900, a predictor that rarely says positive | BA 0.5050 [0.5008, 0.5272], interval p 0.0041; `chanceExactP` 0.1000 (one-sided Fisher 0.05, doubled) | 0.1000 | 0.1000 | **inconclusive**; chance_exact_test_not_significant |
| GC-51 | chance gate (multiclass) | GC-46's policy; matrix [[1, 39, 0], [0, 1,900, 0], [0, 60, 0]], a predictor that rarely predicts high or medium | macro recall 0.3417 [0.3348, 0.3817], interval p 6.9e−05; `chanceExactP` 0.1200 (3 classes × 2 × 0.02, from high) | 0.1200 | 0.1200 | **inconclusive**; chance_exact_test_not_significant |
| GC-52 | mean baseline | today's hosted regression profile (RMSE ≤ 1); GC-48's 400 targets and the mean predictor | derived: RMSE ≤ 1; RMSE 0.6220, interval p 2.9e−114; descriptive R² 0.0000 and baseline RMSE 0.6220, gate p 1 | 1 | 1 | **inconclusive**; mean_baseline_not_beaten |
| GC-53 | mean baseline | the same profile and targets; a weak model, 0.25 × each deviation from the mean ± 0.375 | RMSE 0.6020, interval p 1.5e−153; R² 0.0631; baseline RMSE 0.6220, MSE reduction 0.0244, gate p 0.2281 | 0.2281 | 0.2281 | **inconclusive**; mean_baseline_not_beaten |
| GC-54 | clustered (binary) | recall ≥ 0.70 and BA ≥ 0.5, parity ±0.20; 40 applicants × 6 applications (3 positive), every fifth applicant's positives all missed; groups A and B of 20 applicants | recall 0.8000 [0.6750, 0.9250] by cluster bootstrap (independent rows: Wilson [0.7196, 0.8618], p 0.0168); difference 0.0000 [−0.1411, 0.1362] | 0.0720; 0.0072 | 0.1441; 0.0144 | **inconclusive**; interval_straddles_band; parity **pass** |
| GC-55 | clustered (regression) | MAE ≤ 0.5, RMSE ≤ 0.6; 60 sites × 5 rows, errors dominated by a site effect | MAE 0.4363 [0.3771, 0.4967] (independent rows [0.4073, 0.4652]); RMSE 0.5057 [0.4501, 0.5567]; mean baseline gate p 0.0010 on the same replicates | 0.0375 | 0.0375 | **pass** |
| GC-56 | clustered (small cells, few clusters) | four-fifths; A 36 people × 2 rows (36/72), B 8 people × 5 rows (20/40), C 40 people × 1 row (3/40) | C\|A ratio 0.1500 [0, 0.3530], p 1 (`small_cell_clustered`); A\|B and C\|B `below_minimum_cluster_count` (8 clusters). With independent rows the criterion fails (P 0.0096) | 1 | 1 | **inconclusive**; small_cell_clustered, below_minimum_cluster_count |
| GC-57 | clustered (multiclass) | accuracy ≥ 0.6, macro recall ≥ 0.35; 45 clusters × 4 rows, errors concentrated in every fourth cluster | accuracy 0.7722 [0.6722, 0.8611] (independent rows [0.7056, 0.8274]); macro recall 0.7722 [0.6729, 0.8627], chance gate applied | 0.0010 | 0.0010 | **pass** |
| GC-58 | power (mean baseline gate) | GC-44 with `targetSd` 1.1 | gate pass probability 0.666; range [0, 0.458]; 312 rows needed (GC-44: 293) | | | |

GC-46 to GC-48 follow the first re-review's three examples of a degenerate model that would pass without the rules of section 4.8: each would pass on its other members, and today's engine rule does not pass it. GC-50 and GC-51 follow the second re-review's predictors that ignore the truth and rarely predict a class: each passes the interval of its chance baseline and is stopped by the chance gate (section 5.2). GC-52 and GC-53 (#68) are regression models that meet today's hosted RMSE threshold without beating the mean-prediction baseline: each passes its RMSE member and is stopped by the mean baseline gate (section 5.9). GC-48 now also records `mean_baseline_not_beaten`, and GC-35 reports a baseline RMSE of 5.7717 with gate p 1.4e−11. GC-54 to GC-57 (#93) are clustered plans decided by the cluster bootstrap (section 5.11), with seed 1729 and B = 2000: GC-54 is the reason for the method, a recall that passes with independent rows but not with its 40 applicants as the unit; GC-56 pins the clustered small-cell and minimum-cluster rules. GC-58 adds the mean baseline gate to regression power (section 8).

All categories the issue asks for are covered:
- small sample: GC-01, 08, 11;
- large sample: GC-02, 09;
- zero denominators: GC-06, 15;
- a single class: GC-07, and a single observed label: GC-15, 37;
- perfect parity: GC-10, 11;
- extreme imbalance: GC-12;
- intersectional suppression: GC-22, 23.

The remaining cases cover zero numerators, all events, empty groups, small cells, multiplicity, power for single, three-group and multi-member criteria, calibration, reference mode, the hosted end-to-end suite, LL144, multiclass, regression, descriptive entries, legacy derivation, a policy with no thresholds, the chance baselines and their gate, a metric that blocks a pass because 1.0.0 cannot decide it, the mean baseline gate, and clustered designs.

### 13.3 Verification method

**1. Reference computation (stdlib only).** `docs/design/audit-statistics-verify.py` implements sections 4–10 with the Python standard library.
- Fisher's test, two-sided and one-sided, uses exact integer binomials, and plan hashes use its RFC 8785 `jcs()`.
- The script asserts that every closed-form z\* equals bisection within 1e−8, and it regenerates the fixture.

Commands, from the repository root:
- `python docs/design/audit-statistics-verify.py --check` recomputes everything and diffs it against the committed fixture: 0 differences across 58 cases.
- `--write` regenerates the fixture.
- `--show-plan GC-38` prints a case's normalised plan, its canonical bytes and its hash.

**2. Independent recomputation.** This revision ran it with scipy 1.11.4, statsmodels 0.14.0, numpy 1.26.2 and jsonschema 4.19.2, installed outside the repository, plus Node.js 22.21.1; the #68 amendment was rechecked with scipy 1.18.1, statsmodels 0.15.0, numpy 2.3.5 and jsonschema 4.26.0, and the #93 amendment with scipy 1.17.1, statsmodels 0.15.0, numpy 2.3.5 and jsonschema 4.26.0. These MUST NOT be added to any requirements file.

`--cross-check` recomputes the fixture with separately written code:

| Category | Checks | What is recomputed |
|---|---|---|
| intervals | 292 | Every member and descriptive interval:<br>• Wilson: `proportion_confint(method="wilson")`<br>• Newcombe: `confint_proportions_2indep(method="newcomb")`<br>• Katz: statsmodels `method="log"` and `scipy.stats.contingency.relative_risk`<br>• Koopman: `method="score"`, or a constrained-MLE root-finder where statsmodels is degenerate<br>• MOVER, Jaccard–Wilson and the Bonferroni macro intervals: rebuilt from statsmodels Wilson limits<br>• Normal approximations: `scipy.stats.norm` |
| decision_p_values, directions | 83, 107 | Each member's interval at level 1 − p touches the band edge, and each direction follows from estimate and band |
| fisher | 14 | `scipy.stats.fisher_exact` on every member with a small cell, and on every GC-36 table |
| chance_gate | 259 | `chanceExactP` on every member and descriptive entry: null without a gate; on each balanced-accuracy member at or above chance, `scipy.stats.fisher_exact(alternative="greater")` for binary data or `scipy.stats.hypergeom.sf` per one-vs-rest table with the Bonferroni factor for multiclass data, doubled. Where the gate decides a pass p, the library interval at level 1 − `chanceExactP` lies inside the band; elsewhere the pass p is at least `chanceExactP`. `chance_exact_test_not_significant` on exactly the criteria where the gate alone prevents a pass |
| member_status | 210 | Member status (suppressed, undefined, insufficient_support or evaluated) from the counts and minimums; `smallCell` flags; `suppressedGroups` lists |
| group_rates | 155 | Per-group Wilson intervals and suppression flags |
| headlines | 26 | Worst-member bounds rebuilt from library intervals at the nominal and Bonferroni levels |
| coverage, sample_sizes, ece_r2 | 26, 47, 5 | From the raw case data |
| criterion_p, outcomes | 94, 183 | Criterion P and `decidingMemberId` from the member p-values (intersection–union and Bonferroni), with the pass blocked where `passBlockedBy` is set and a regression pass P raised to the mean baseline gate p; unadjusted, adjusted and run outcomes; `reviewFlags` |
| mean_baseline | 55 | On every regression criterion: the baseline RMSE, baseline MSE and MSE reduction from numpy, the gate p from `scipy.stats.norm.sf` with the 10⁻⁹ rounding floor, and `mean_baseline_not_beaten` on exactly the criteria with no failing member whose gate p exceeds α |
| cluster_bootstrap | 80 | The four clustered cases: the same draws (they are the definition), but every replicate statistic rebuilt with numpy as a multiplicity matrix times per-cluster counts from the raw case data; `bootstrap` counts and cluster numbers; intervals by `numpy.quantile(method="linear")`; directions from `numpy.median`; u\* solved exactly on the linear pieces of the quantile function instead of by bisection; `small_cell_clustered` and `below_minimum_cluster_count`; criterion P; the clustered mean baseline gate; the headline bounds |
| family_adjustment | 54 | `statsmodels.stats.multitest.multipletests` (`bonferroni`, `fdr_bh`) |
| power, sample_size_search, minimum_detectable_effects | 33, 8, 5 | Member and criterion probabilities from scipy formulas, the mean baseline gate's variance from the covariance matrix by Isserlis' theorem; each required size is the smallest passing integer; MDEs by `scipy.optimize.brentq` (the ratio peak by `minimize_scalar`); equality-test sizes by `samplesize_proportions_2indep_onetail` |
| ll144 | 22 | Totals, reference category, shares, eligibility, Wilson and Katz intervals |
| derivation | 11 | Every derived plan (GC-38, GC-39, GC-45 to GC-53), rebuilt by a second, separately written implementation of section 9.3 and compared field by field: criteria, member order, the chance baselines (k counted from the data with numpy), `passBlockedBy`, applied and configured minimums |
| plan_schema, plan_hashes | 137, 43 | jsonschema Draft 2020-12 validation of every plan as written and normalised; idempotent normalisation; 10 invalid plans that the schema must reject (a minimum below its floor, Holm, an unknown field, an unknown metric, a band without bounds, reference mode without a reference group, coverage below 0.5, `passBlockedBy` in a plan that was not derived, naming another kind's metric, or on a binary criterion); Node.js JCS hashes |
| descriptive_entries, numerics | 191, 14 | Descriptive shape; `undecidable_metric` on exactly the criteria with a non-empty `passBlockedBy` and on their R² or ECE entries; normal quantiles and `erfc` against scipy |

Result: **2,154 checks, 0 problems.** Ajv 8.20.0 (Draft 2020-12, the validator the repository's schema checks use, from `site-app/node_modules`, with the options of `schemas/validate-run-schema.mjs`) gives the same verdicts on the fixture plans and the 10 invalid ones.

What the cross-check does not recompute: the library view in `decision.libraryEntry` and the text fields.

`--mutation-test` corrupts 41 fixture values one at a time and the cross-check reports all 41. The corrupted values span:
- headlines, coverage, ECE, R², criterion and adjusted P, the deciding member, member status, outcomes, descriptive and per-group intervals, directions;
- the plan hash, a plan below the floors, required sizes, MDEs and power probabilities;
- a binary chance baseline lowered to the policy bound, a dropped multiclass chance baseline and an emptied `passBlockedBy`, each with the plan hash recomputed so that only the derivation check can notice;
- a pass P despite an undecidable metric;
- the chance gate's p, its Bonferroni factor for three classes, and GC-50 recomputed consistently without the gate, as a runner that omits it would report it;
- GC-35's baseline RMSE, GC-53's mean baseline gate p, and GC-52 recomputed consistently without the mean baseline gate;
- a cluster-bootstrap interval, decision p, valid-replicate count and clustered gate p, a clustered small cell decided as if rows were independent, and GC-58's gate probability.

**3. Monte Carlo (`--simulate`, 20,000 replications, seed 20261105).**
- Power formulas against the actual decision rules, at the family-adjusted level:

| Case | Formula | Simulated decision rule |
|---|---|---|
| GC-27 | 0.7491 | 0.7442 |
| GC-28 | 0 | 0 |
| GC-29 | 0.3164 | 0.3297 (random class counts; the formula holds them at 50) |
| GC-40 | range [0.0812, 0.6087]; members 0.8639, 0.6087, 0.6087 | 0.4292; members 0.8673, 0.6160, 0.6176 |
| GC-41 | range [0.3518, 0.7447] | 0.6541 (with the chance gate on its balanced-accuracy member) |
| GC-42 | 0 | 0 |
| GC-44 | range [0.1632, 0.4585]; members 0.4585, 0.7047 | 0.4612; members 0.4677, 0.6847 |
| GC-58 | range [0, 0.4585]; members 0.4585, 0.7047; gate 0.6656 | 0.3213; members 0.4758, 0.6907; gate 0.6325 (a conditional-mean model, its own seed 20261106) |

  - Every member formula is within 0.02 of simulation; the largest gap is GC-44's RMSE member, 0.020.
  - A criterion's simulated rate lies in its formula range only up to the member formulas' approximation error, at most 0.02, not up to Monte Carlo error. GC-44's 0.4612 is 0.0028 above its upper bound, because its MAE formula is 0.009 low. A single-member criterion's range is one point, so GC-27 and GC-29 differ from it by their member's gap.
  - `--simulate` checks both distances against 0.02 and exits non-zero if either is exceeded. The mean baseline gate's formula is held to 0.04 (GC-58: 0.033, section 8).
- Coverage of the derived intervals:
  - F1 Jaccard–Wilson: 0.9513.
  - Balanced-accuracy MOVER: 0.9509, with 60 positives at TPR 0.7 and 340 negatives at TNR 0.9. It undercovers when a class's count is 1 to 3, which the enumeration below quantifies for the chance baseline.
  - Koopman with frequent zero counts: 0.9628.
  - Macro-F1 Bonferroni: 0.9989, and macro-precision Bonferroni: 1.000 (both conservative).
  - Headline worst-member bounds for 3 groups at rates 0.50, 0.45 and 0.40: 0.9833.
  - Under clustering (section 5.11; 40 clusters of 6 rows with cluster rates from Beta(4, 1), 2,000 replications, its own seed 20261107): the row-level Wilson interval covers 0.8510 and the cluster percentile bootstrap (B = 1000) 0.9370. The percentile bootstrap is somewhat liberal with 40 clusters, as expected; the analytic interval is far off.
  - Headline worst-member bounds over 18 designs: 2, 3 and 5 groups, a true worst gap W of 0, 0.02 or 0.10, and 100 or 1,000 per group. The lowest coverage is 0.9428, at 2 groups, W = 0 and 100 per group. There the headline is the one Newcombe interval, whose exact coverage at d = 0 is 0.9440 (enumerated with statsmodels), so the shortfall is the member interval's own (Appendix A.3).

  All are at or above the nominal 0.95 within Monte Carlo error, except where the member interval itself undercovers, as Newcombe does at d = 0 with 100 per group.

**4. Exact enumeration (`--enumerate`, stdlib, about 6 seconds).** It sums binomial or multinomial probabilities over every table.
- **False fails under a two-sided band** (section 6): 0.0345 (0.0279 above the band, 0.0066 below) and 0.0354.
- **The chance baseline** (section 5.2), for predictors that ignore the truth:
  - the member `balanced_accuracy ≥ 0.5` alone, over seven binary designs, maximised over q on a logit grid of 242 values refined around the maximum. With the interval alone the largest value is 0.1215, and with the chance gate 0.0216, below α/2;
  - GC-47's derived plan at q = 0.00125, computed by `evaluate_plan` itself: 0.0708, and 0.0057 with the gate;
  - GC-46's derived plan for 40/1,900/60 and predictions 0.001/0.998/0.001: 0.0757, and 0.0036 with the gate. The rows are truncated at 4, 20 and 5 predictions outside the majority class, which omits a probability of 2.4e−8;
  - the interval p and `chanceExactP` of GC-50 and GC-51.
- **Fails of the baseline** (section 6): at 1 − q the member fails a predictor exactly as often as it passes at q without the gate, to within 5e−14.
- The fast pass predicates of the enumeration are checked against `evaluate_plan` on 480 binary and 3,544 three-class tables. `--enumerate` exits non-zero on a mismatch, if the gated maximum exceeds α/2, or if the mirrored fail probabilities differ.

The original revision's runs, with scipy 1.17.1 and statsmodels 0.15.0 in a throwaway virtualenv, also found the statsmodels Koopman defect described in section 5.6. Reproduce everything with the commands below. Put `<temp>` outside the repository; on Windows use `Scripts\` instead of `bin/`.

```
python -m venv <temp>/stats-venv && <temp>/stats-venv/bin/pip install scipy statsmodels numpy jsonschema
<temp>/stats-venv/bin/python docs/design/audit-statistics-verify.py --check --enumerate --cross-check --mutation-test --simulate
```

## 14. Phased implementation plan

| PR | Issue | Scope | Size | Depends on | Done when |
|---|---|---|---|---|---|
| E1 | #21 | `engine/statistics.py` (stdlib only): numerics, every interval in section 5, inversion, Fisher (two-sided, and one-sided for the chance gate), Bonferroni/BH, criterion combination, power and MDE (section 8), plan normalisation, RFC 8785 hash and legacy derivation (section 9). `engine/tests/test_statistics_golden.py` loads the fixture: every case at core level, including `normalizedPlan` and `planSha256`. | M | #10 merged | all core golden values match; no new runtime dependencies |
| E2 | #21 | The decision engine in `engine/diagnostics.py`, the 1.3 contract and the validators (list below) | L | E1 | engine end-to-end golden cases pass; migrated tests and schema validators pass |
| E3 | #21 | `intersectional_slices` rebuilt on the same machinery (suppression, coverage, exploratory BH); calibration criterion with bins and a Brier member; ECE/R² descriptive bootstrap; cluster-bootstrap decisions with the section 5.11 budget (deferred to #93, which adds them with the MAE/RMSE sensitivity interval and GC-54 to GC-58); `_bootstrap_protocol(purpose=…)`; `python -m engine.assurance power` | M | E2 | GC-22, 23, 24 pass end to end; with #93, GC-54 to GC-57 end to end, a cluster determinism test and a budget test (`engine/tests/test_cluster_bootstrap.py`) |
| E4 | #21 | The external worker's projection (list below) | M | E2 and #10 merged | `verify_result_bytes` accepts only copied decisions; worker and schema validators pass |
| H1 | #22 | `site-app/lib/statistics.ts`: port of E1 (AS241, `erfc`, Koopman bisection, two- and one-sided Fisher in log space, JCS with explicit key sorting); a Vitest suite over the fixture at core level for every case with `"hosted"` in `runners` | M | E1 (the roadmap makes #22 depend on #21; H1 can be developed in parallel because the fixture is final, but it merges after E1) | Vitest golden suite green in CI |
| H2 | #22 | The hosted decision path, the 1.4 contract and the validators (list below) | L | H1, #15 | cross-runner agreement in CI; schema validators pass |
| H3 | #22 | Plan step in `testing-lab.tsx`: bands, role, mode, reference group, coverage, confidence level, power assumptions; its profile summary `criterionSummary` (L2148–2179) lists the plan's criteria and bands instead of reading thresholds from `config`; threshold-library data file with status notes; power/MDE panel showing the range, with acknowledgement; frozen plan and hash in the manifest; plain-language reason messages | M | H2 | changing an approved plan creates a new profile version (test) |
| H4 | #22 | External intake of 1.5 results (list below) | S | E4, H2 | the 1.5 external fixtures validate; aggregation and intake-limit tests |
| L1 | #30 | LL144 computations (section 10.2), scoring-rate path with the full-sample median, publishable summary; hosted profiles accept up to five group columns, so intersectional strata run in the hosted runner (section 5.10; decided on #22, section 15) | M | H2, #27 | GC-32 and new scoring-rate cases match |

**E2 file list and checks.**
- `engine/diagnostics.py`:
  - `validate_config` accepts configuration 1.0 and derives the plan (section 9.3), raising minimums to the floors and recording both. The derivation adds the chance baselines, taking k for multiclass data from the evaluated rows, and sets `passBlockedBy` on `PERF-REG` and `PERF-CAL`. The chance gate applies at evaluation (section 5.2). It accepts 1.3 and rejects minimums below the floors, `thresholds.values` beside `statistics`, or a non-empty `passBlockedBy`.
  - `result()`, `evaluate()` and `fairness()` produce criterion results with `decision`, descriptive entries and the kept headline names.
  - `run()` aggregates per section 4.6, emits contractVersion 1.3 and records the plan and its hash.
- `engine/contract.py` `validate_report`:
  - accepts 1.0 with today's rules unchanged, and 1.3 with the section 11.6 rules;
  - the 1.3 rules replace the L34 version check, the L99–100 point-estimate pass rule and the L104–106 aggregation;
  - the L90–92 threshold check stays, because `threshold` keeps today's meaning.
- `schemas/.build-run-schema.py` and `.extend-assurance-schema.py`:
  - add a 1.3 engine-report branch to the `oneOf`;
  - add a `statisticsPlan` definition from the draft schema, a `decision` definition and the 1.3 metric shape with the section 11.5 limits;
  - add configuration 1.3 (`pythonConfig` with `statistics`).
  - Then regenerate `test-run.schema.json` and update `schemas/README.md`.
- `engine/examples/`: keep the 1.0 reports and add a 1.3 report. `schemas/validate-run-schema.mjs` validates both.
- `engine/tests/test_diagnostics.py`: the `config()` helper uses minimums 2/2/2 on 8-row data (`balanced()`), and `test_small_or_missing_groups_never_pass` sets `minGroupSize` 5 and 2 (L60, L63).
  - Under the floors these runs are gated, so the tests get datasets with ≥ 30 per group and ≥ 10 per class.
  - Two new assertions cover raising-and-recording for 1.0 and rejection for 1.3.
  - `test_missing_policy_does_not_pass` keeps its meaning through `no_threshold`.
  - In `test_regression_known_values_and_constant_target`, the R² threshold blocks a pass (`undecidable_metric`) instead of failing the result, so the expected outcome is inconclusive; its 3-row data is also below the minimum.
- New `engine/tests/test_statistics_end_to_end.py` runs every `endToEnd.engine` case through `run()` on expanded CSVs.

**E4 file list and checks** (worker, after PR #47, which closes #10). PR #47 leaves the worker with the five platform tests only: drift, permutation, perturbation, explainability and cross-validation leave `SUITES`, `LABELS` and `_selected_sources`, and `hosted_results` loses its external-only branch. Every hosted result is therefore a criterion of the plan, and the worker copies all of them.

Line numbers below are those of `main@582657f`. Of the files listed, #47 changes only `engine/worker.py`, `engine/worker_contract.py` and `engine/tests/test_worker.py`. Where it moves a cited line, the line on #47's head `37a2ea5` follows in brackets; #47 is still open, so these may move again, and the quoted identifiers locate the code.
- `engine/worker_contract.py` `translate_config`:
  - accepts `engineConfig` 1.1 and derives the hosted plan (section 9.3; the multiclass chance baseline takes k from the rows it receives), or 1.4 and carries `statistics` after validating it;
  - maps `suite` to engine suites through `SUITES` as today, since a 1.1 profile's `suite` lists the families of its plan's criteria (section 11.2);
  - applies `max(floor, configured)` and records the configured and applied minimums in `statistics.configuredMinimums` and in `hostedTranslation`;
  - drops the `max(2, …)` class-count adjustment and the hosted defaults of 20 and 5;
  - bumps `TRANSLATION_VERSION`.
- **Label pair** (`binary_labels()`, added by #47). #47 reads the top-level `engineConfig.negativeLabel`. When it is absent, #47 derives the other label: from the data, or in `auditor_model` mode from `modelSpec.outputLabels`, which must then be exactly the label pair.
  - `engineConfig` 1.4 carries the 1.1 profile's declared pair in `config` (`positiveLabel`, `negativeLabel`). Its top-level `negativeLabel` MUST be present and equal `config.negativeLabel`. The worker rejects a mismatch as `protocol_config_invalid` and uses that label, so data in which one label is observed is evaluated.
  - The derivation of a missing label stays, for `engineConfig` 1.1 only.
- `_selected_sources` and `hosted_results` (result-id rule, section 11.2):
  - `hosted_results` builds one result per criterion of the recorded plan, in plan order, by copying the engine result with that criterion's id: its `outcome`, `metrics`, `limitations` and `decision`. The engine runs the translated plan, so its result ids are the criterion ids. The map in `_selected_sources` from suite tests to `PERF-*` and `FAIR-*` results goes.
  - It no longer selects metrics by `threshold is not None`, applies no `accepted()`, no minimums of 20 or 5 and no "minimum of one" projection, and stops writing `acceptanceRole` (replaced by `details.role`).
  - It applies `METRIC_ALIASES` to headline names and multiclass `macro_recall`, and sets the article by criterion kind.
- `engine/worker.py` `verify_result_bytes` keeps recomputing the projection (L509 [L817]), which is now a pure copy.
- `engine/tests/test_worker.py`:
  - `hosted_request` uses minimums 2/2/2 on an 8-row CSV, and L209 [L454] sets `minimumGroupSize` 5. They are migrated to data that meets the floors.
  - `test_minimum_one_is_explicit_separate_projection` becomes a test that 1 is raised to 10 and both values are recorded.
  - The constant-target regression case becomes inconclusive (`degenerate_interval`, and below the minimum).
- `schemas/generate-external-fixtures.py`:
  - L70 sets 2/2/2 on 4–8-row datasets. It moves to the floors, with synthetic datasets of ≥ 30 per group and ≥ 10 per class.
  - `project()` builds 1.5 runs with results keyed by criterion id, aggregating per section 4.6 (L38–39). One of them uses an explicit plan whose ids differ from the suite names.
  - It writes a new `schemas/fixtures/external-runs.v1.5.json`. `external-runs.v1.2.json` stays as a frozen fixture for the 1.2 branch.
- `schemas/validate-run-schema.mjs` `externalBindings` gets the 1.5 aggregation (L238) and the section 11.6 rules. For 1.5, the result-id rule replaces L232's check that the results' test ids equal `run.suite`; `run.suite` still equals `profile.suite` (L201).

**H2 file list and checks.**
- `site-app/lib/diagnostics.ts`:
  - `evaluate()` produces one result per plan criterion, keyed by criterion id (section 11.2), with intervals, `decision`, descriptive entries, per-group slices and the chance gate (section 5.2). It derives the plan for legacy profiles, with the multiclass chance baseline 1/k taken from the rows (GC-49), and removes the "No confidence intervals" text.
  - `validateEvaluation` evaluates binary data with one observed label when `negativeLabel` is declared, and keeps today's two-label check otherwise.
- `site-app/lib/evaluation.ts`:
  - `configSchema` gets floors 30/30/10 and `negativeLabel` for profiles with `schemaVersion` 1.1; the plan schema and `statistics` are added.
  - A 1.1 profile with a plan has `suite` equal to the families of its criteria and no calibration criterion (section 11.2). `assertSuite` and `protocolConfigKeys` apply to that `suite`.
- `site-app/lib/domain/types.ts`:
  - `EvaluationConfig` (L133–148) requires the legacy `minimumGroupSize`, `maximumParityGap`, `minimumImpactRatio` and `minimumAccuracy` (L138–141), and `EvaluationProfile.schemaVersion` is `"1.0"` (L151).
  - A 1.1 profile with a plan keeps only the column mappings and the declared labels in `config` (section 9.1). So the profile type admits `schemaVersion` 1.1 with `statistics`, and the config type gains a variant without the thresholds and minimums, with `negativeLabel`. A 1.4 run's `Run.config` (L263) takes the same variant.
- `site-app/app/record-details.tsx` `Criterion` (L373–400):
  - Today it renders each result's criterion text from `run.config` by test id. For a 1.4 run from a 1.1 profile with a plan, whose `config` has no thresholds, it would print "Accuracy ≥ NaN%" or "Maximum gap ≤ NaN pp".
  - For 1.4 and 1.5 results it renders the bands from the members' `details.band`, and the role, adjusted p and outcome reasons from `decision`. Frozen 1.1 and 1.2 runs keep today's text.
- `site-app/lib/commands/runs.ts` `executeRun` (L180) aggregates per section 4.6, writes `reviewFlags` and emits contractVersion 1.4 with `manifest.statistics`; the run's `suite` is the profile's.
- `schemas/.build-run-schema.py`, a hosted 1.4 branch:
  - `hostedMetric` is replaced by the shared metric shape, `hostedResult` gains `decision`, and results may number up to 20; profile `schemaVersion` 1.1; the section 11.5 limits.
  - `hostedResult.testId` takes the id pattern instead of the five-name enum (L102).
  - The per-testId `resultRules` (L104–105), which fix the article and the allowed metric names, become rules keyed on `decision.kind` and, for group criteria, the headline's `details.metric` (section 11.2).
  - The per-task rule on result test ids (L122–124) becomes a rule on `decision.kind`: binary runs hold `performance` and `group_comparison` criteria, multiclass runs `multiclass_performance`, and regression runs `regression_performance`. `taskSuiteRules` keeps constraining `suite`.
- `schemas/validate-run-schema.mjs` `hostedBindings`: the 1.4 aggregation (L80) and the section 11.6 rules. For 1.4, the result-id rule replaces L76's check that the results' test ids equal `run.suite`; `profile.suite` still equals `run.suite` (L68). New `schemas/fixtures/hosted-runs.v1.4.json` includes an explicit plan whose ids differ from the suite names. `hosted-runs.v1.1.json` stays frozen.
- End-to-end Vitest over `endToEnd.hosted` cases, and `ml-evaluation-check` updated.

**H4 file list and checks.**
- `site-app/lib/commands/assurance/execution.ts`, the `/api/assurance` execution commands that #50 moved out of `site-app/app/api/assurance/route.ts`:
  - `queueExternal` builds `engineConfig` 1.4, with `statistics`, for a profile with `schemaVersion` 1.1. Its top-level `negativeLabel` (L198, today the request's `negativeLabel`) is the profile's `config.negativeLabel`, and a request that states a different one is rejected (E4).
  - `importJob` compiles 1.5 runs. It keeps `suite: frozen.profile.suite` (L401), whose meaning is unchanged (section 11.2), and takes the results as keyed by criterion id. It aggregates per section 4.6 (L371), adds `reviewFlags` and `manifest.statistics`, and writes paper text from the decisions.
- `schemas/.extend-assurance-schema.py`, the 1.5 branch: `externalHostedResult.testId` takes the id pattern instead of the suite-item enum (L48), and the article rule keyed on `testId` (L59) is keyed on `decision.kind`.
- `site-app/lib/assurance-core.ts` `resultEnvelope`:
  - raises the per-result metric limit from 100 to 2,451 and the metric name limit from 300 to 20,480 characters (section 11.5);
  - admits `decision` and the full metric shape. The route checks the parsed envelope, but `importJob` stores the exact result bytes, so the parse must not reject them.
- `site-app/app/api/runner/route.ts` completion check:
  - `hostedResults` test ids must equal the plan's criterion ids, in plan order, rather than the profile's suite (they coincide for derived plans);
  - the article follows the criterion kind: 15 for performance kinds, 10 for group criteria.

Each PR adds its tests with the code. Nothing here changes runner code before #21 and #22.

## 15. Decided questions (5 November 2026)

Every question below was decided on 5 November 2026, in the decision comments on [#21](https://github.com/ahed-jneed/ai-assurance/issues/21#issuecomment-6666624939) and [#22](https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6666625399):
- Q1 keeps Katz-log with the Koopman fallback.
- Q4 is resolved by the rule text.
- For Q2, Q3, Q5, Q6, Q7, Q8, Q9 and Q10, the default of this specification is accepted.

The decisions apply to the engine and the hosted runner alike, and none of them changes a method or a fixture value. The work they defer, interval-based drift decisions (Q6) and the methods of Q7 and Q8, is on the Later list in [`ROADMAP.md`](../../ROADMAP.md#later).

The decision comment on #22 also places intersectional strata in hosted profiles, meaning several group columns, under #30, which needs them for LL144. Section 12 and step L1 record this.

| # | Question | Decision (5 Nov 2026) |
|---|---|---|
| Q1 | Ratios: keep Katz-log with the Koopman fallback (as here), or use Koopman everywhere as Fagerland et al. recommend? | **Decided: keep Katz-log with the Koopman fallback.** Katz is conservative, which errs safe for audit claims, and switching later is a local change: `ratio_method` plus regeneration of the cases that use Katz-log (GC-08, 09, 10, 12, 30, 31, 32, 33), which `--cross-check` and `--mutation-test` then confirm. |
| Q2 | Default `minimumCoverage` of 1.0 makes any unknown or suppressed group block a pass. Should LL144-style plans default to 0.95? | **Default accepted: 1.0.** A pass that covers part of the population must be a deliberate pre-registered choice with a rationale. |
| Q3 | Pass claims, and fail claims under one-sided bands, have an error rate of at most α/2; fail claims under two-sided bands at most α (section 6). Should 90% intervals be offered, for a 5% one-sided pass error? | **Default accepted.** 90% intervals are allowed through `confidenceLevel: 0.90`, and the default stays 0.95. |
| Q4 | LL144 scoring rate: is the median taken over all scored applicants or only those with a known category? | **Resolved by the rule text.** § 5-301(c)(1) requires the median "for the full sample of applicants", so the median is taken over the full sample, including the unknown category (section 10.2). #30 records this reading in the pack. |
| Q5 | The EEOC's UGESP rescission is reported but its text is unpublished (verified only through a secondary source). Does the four-fifths entry need updating? | **Default accepted.** The entry stays a configurable screen. Its caveat states only what is stable; the rescission status lives in a dated status note that is updated without changing the entry version or frozen results. |
| Q6 | Drift (PSI, KS, Wasserstein) is out of scope. Should drift tests stop contributing to the run outcome until they have intervals? | **Default accepted: not yet.** Drift stays point-estimate screening. #21 leaves drift computation unchanged. Drift results carry no `decision` and stay outside the families; they count in the run outcome as results without a `decision` (section 4.6) and carry the limitation "point-estimate screening; not interval-based". Interval-based drift decisions are on the Later list in `ROADMAP.md`. |
| Q7 | Macro F1 uses a conservative Bonferroni interval (coverage 0.999). Should a delta-method interval be specified ([Takahashi et al. 2022](https://doi.org/10.1007/s10489-021-02635-5))? | **Default accepted.** The conservative interval stays in 1.0.0. A delta-method interval is on the Later list in `ROADMAP.md`. |
| Q8 | Boschloo, BCa and beta-binomial shrinkage for small strata were not adopted. | **Default accepted.** None of them is in 1.0.0. They are on the Later list in `ROADMAP.md` as possible engine-only additions, which would be reported, never deciding, until specified. |
| Q9 | Could a step-down procedure regain power over Bonferroni in the confirmatory family? | **Default accepted: Bonferroni.** A step-down would need either pre-registered claim directions (which give a fixed set of null hypotheses) or an independence argument that one dataset cannot supply (section 6). |
| Q10 | Power for macro F1, macro precision and calibration criteria has no formula in 1.0.0. | **Default accepted.** Power is `not_computed` with a reason, and approval then needs the acknowledgement. A later version can add formulas once the per-class or per-bin assumptions are specified. |

## 16. Sources

Regulation and guidance:
- EU AI Act: [Art. 9](https://artificialintelligenceact.eu/article/9/), [Art. 10](https://artificialintelligenceact.eu/article/10/), [Art. 15](https://artificialintelligenceact.eu/article/15/), [Annex IV](https://artificialintelligenceact.eu/annex/4/). The application dates of 2 December 2027 and 2 August 2028 shown on the Art. 9 page reflect the Digital Omnibus.
- US: [29 CFR 1607.4](https://www.law.cornell.edu/cfr/text/29/1607.4).
- US UGESP rescission status: [DirectEmployers, 23 October 2026](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/) (secondary) and [SHRM](https://www.shrm.org/mena/topics-tools/employment-law-compliance/eeoc-moves-to-roll-back-longstanding-hiring-guidelines).
- NYC:
  - [DCWP Notice of Adoption, Local Law 144 rules (6 RCNY §§ 5-300–5-304)](https://www.sidley.com/-/media/resource-pages/ai-monitor/laws-and-regulations/20230406-nyc-dcwp-notice-of-adoption-of-final-rule-for-local-law-144.pdf?la=en) and the [NYC rules page](https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/), effective 5 July 2023. No later amendment was found; this was not re-verified beyond these pages.
  - The § 5-300 definitions and § 5-301(b)(5), (c)(1), (c)(5) and (d) were checked against the unofficial reproduction at [AGORA](https://agora.eto.tech/instrument/2002).

Statistics:
- [Wilson 1927](https://doi.org/10.1080/01621459.1927.10502953); [Brown, Cai & DasGupta 2001](https://doi.org/10.1214/ss/1009213286); [Newcombe 1998](https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C873::AID-SIM779%3E3.0.CO;2-I).
- [Katz, Baptista, Azen & Pike 1978](https://doi.org/10.2307/2530610); [Koopman 1984](https://doi.org/10.2307/2531405); [Miettinen & Nurminen 1985](https://doi.org/10.1002/sim.4780040211).
- [Fagerland, Lydersen & Laake 2015](https://doi.org/10.1177/0962280211415469) (quotations from sections 6.2–6.3 and 8 of the [preprint](https://www.ms.uky.edu/~mai/sta635/FagerlandLydersenLaake2011---RecommendedCIsForTwoIndependent....pdf)).
- [Zou & Donner 2008](https://doi.org/10.1002/sim.3095) (MOVER); [Berger 1982](https://doi.org/10.2307/1267823) (intersection–union tests); [Schuirmann 1987](https://doi.org/10.1007/BF01068419) (TOST).
- [Holm 1979](https://www.jstor.org/stable/4615733); [Shaffer 1980](https://doi.org/10.1214/aos/1176345205) (directional errors in stagewise procedures); [Shaffer 1986](https://doi.org/10.1080/01621459.1986.10478341) (logically related hypotheses); [Benjamini & Hochberg 1995](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x); [Benjamini & Yekutieli 2005](https://doi.org/10.1198/016214504000001907) (directional FDR).
- [Wichura 1988, AS241](https://doi.org/10.2307/2347330); [Takahashi, Yamamoto, Kuchiba & Koyama 2022](https://doi.org/10.1007/s10489-021-02635-5) (macro-F1 intervals; Q7, on the Later list).
- Fleiss, Levin & Paik, *Statistical Methods for Rates and Proportions*, 3rd ed., Wiley 2003, for the sample-size formula. The formula was verified numerically against statsmodels, not against the book.

Software and formats:
- [scipy `fisher_exact`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html), [R `fisher.test`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/fisher.test.html), [statsmodels `confint_proportions_2indep`](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.confint_proportions_2indep.html).
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785).

These items are unverified or secondary and are marked where they are used: the CEN-CENELEC drafting status and the EEOC rule scope. The LL144 rule text comes from an unofficial reproduction.

## Appendix A. Derivations

**A.1 F1 interval.**
1. Let the N rows fall into the cells (TP, FP, FN, TN) with probabilities π. Conditional on M = TP + FP + FN, the counts (TP, FP, FN) are multinomial with probabilities renormalised over those three cells. So TP | M ~ Bin(M, J), with J = π_TP/(π_TP + π_FP + π_FN).
2. Population F1 = 2π_TP/(2π_TP + π_FP + π_FN) = 2J/(1 + J), which increases in J.
3. A (1 − α) Wilson interval [l, u] for J, mapped to [2l/(1 + l), 2u/(1 + u)], therefore has the same conditional coverage.
4. Because the Wilson interval is the inversion of the score test, the decision rule is the score test of J against b/(2 − b).

**A.2 Criterion combination and the family.**
- **Pass** claims "θ_i ∈ band for all i". If some θ_j is outside the band, the probability that P_pass = max_i p_i ≤ u is at most P(p_j ≤ u) ≤ u. So the max is a valid p-value with no adjustment (intersection–union).
- **Fail** claims "θ_i ∉ band for some i". If all θ_i are inside the band, P(m·min p_i ≤ u) ≤ Σ P(p_i ≤ u/m) ≤ u (Bonferroni).
- **One criterion.** The truth is either inside or outside the band, so a criterion has exactly one possible wrong claim. Its P satisfies P(P ≤ u and the claim is wrong) ≤ u.
- **The confirmatory family.** P(some wrong claim) ≤ Σ_i P(P_i ≤ α/F and claim i is wrong) ≤ F·α/F = α, whatever the dependence between criteria.
- **Why not a step-down.** A step-down such as Holm would need a fixed set of true null hypotheses. Here each criterion contributes the pair {outside, inside}, one of which is true, and its data choose which is tested. Every hypothesis lies in a consistent intersection of F hypotheses (one per criterion), so closed testing with Bonferroni local tests rejects it only at α/F (Shaffer 1986).

**A.3 Headline bounds.** Take a two-sided difference band. Member i has true difference θ_i, nominal interval [L_i, U_i] and Bonferroni interval [L′_i, U′_i] at level α/m, which contains it. The headline interval is [max_i ℓ_i, max_i u_i], with ℓ_i = max(0, L′_i, −U′_i) and u_i = max(|L_i|, |U_i|); neither depends on how the pair is oriented. Let W = max_i |θ_i|, attained at a fixed, unknown member i\*, oriented so that θ_i\* = W ≥ 0. Each statement below holds up to the member intervals' own coverage error.
- **Upper bound.** W > max_i u_i implies θ_i\* > U_i\*: member i\*'s nominal interval misses on one side, with probability at most α/2. If W = 0, the upper bound cannot fail. The pass side needs no adjustment.
- **Lower bound.** W < max_i ℓ_i implies ℓ_i > W ≥ |θ_i| for some member i. Its interval at level α/m then lies wholly above W, and so above θ_i, or wholly below −W, and so below θ_i.
  - Near θ_i = 0 both misses are possible, so the bound per member is α/m, not α/(2m).
  - For i\* the second miss, U′_i\* < −W, implies U_i\* < θ_i\*, the event that bounds the upper-bound failure. So the upper-bound failure and member i\*'s lower-bound failure together have probability at most α/2 + α/(2m).
- **Together.** By the union bound, P(the headline misses W) ≤ α/2 + α/(2m) + (m − 1)·α/m = (3/2 − 1/(2m))·α.
  - With one member (m = 1), this is α: the two failures are the two one-sided misses of one interval, which are disjoint.
  - When every θ_i is 0 (W = 0), the upper bound cannot fail and the lower bound fails with probability at most α.
  - Otherwise, with every pair oriented so that θ_i ≥ 0, the excess over α comes from the far-side misses U′_i < −W. Each is a miss by at least W, so the excess becomes negligible once W is a few standard errors from 0.

  The headline coverage is therefore approximately 1 − α rather than guaranteed. The simulations in section 13.3, over 2, 3 and 5 groups, W of 0, 0.02 and 0.10 and 100 or 1,000 per group, give at least 0.943. The lowest value is at 2 groups and W = 0, where the headline is one Newcombe interval and has its exact coverage of 0.944.
- The same argument holds on the |ln r| scale, and for one-sided gaps with |θ| replaced by the signed gap.

**A.4 Power combination.**
- For member pass events A_i, P(∩A_i) = 1 − P(∪A_iᶜ) ≥ 1 − Σ(1 − P(A_i)) (Boole–Bonferroni), and P(∩A_i) ≤ min_i P(A_i). Neither bound needs any assumption about the dependence between members.
- For the criterion's fail event ∪F_i, P(∪F_i) ≥ max_i P(F_i).
- These are the `passProbability`, `passProbabilityUpperBound` and `failProbability` of section 8, applied to the normal-approximation member probabilities.
