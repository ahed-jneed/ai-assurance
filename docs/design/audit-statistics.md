# Audit-grade statistics: decision rule, intervals, multiplicity, power and golden cases

| | |
|---|---|
| Issue | #9 (milestone M1, "Defensible core") |
| Status | Proposed design. Statistics specification version **1.0.0** |
| Date | 5 November 2026 |
| Implemented by | #21 (engine, `engine/`), #22 (hosted runner, `site-app/lib/`) |
| Consumed by | #30 (NYC Local Law 144 pack), #15 (binary performance fixes) |
| Contract files | `schemas/fixtures/statistics-golden.json` (37 golden cases), `docs/design/audit-statistics-verify.py` (verification aid, not runtime code) |

The words MUST, MUST NOT, SHOULD and MAY are normative. "Runner" means either the Python engine or the hosted TypeScript runner. Anything not marked as engine-only applies to both runners, and the golden fixture is the arbiter when this text and an implementation disagree.

## 1. Key conclusions

1. **The interval decides; a point estimate never does.** Every criterion has a pre-registered acceptable region (the *band*). The outcome is **pass** only when the interval lies wholly inside the band, **fail** only when it lies wholly outside, and **inconclusive** otherwise (section 4).
2. **One decision p-value per claim, obtained by inverting the reported interval.** For a single comparison, "p ≤ α" is exactly "the 95% interval lies inside (or outside) the band". The p-value is what lets Holm and Benjamini–Hochberg (BH) adjust interval-based decisions without changing the interval methods (sections 4.2 and 6).
3. **A criterion passes only if all its comparisons pass, and fails if any one fails.** "All pass" is an intersection–union test that needs no multiplicity adjustment. "Any fails" uses Bonferroni within the criterion. Across the confirmatory criteria of one plan, Holm applies. Across exploratory criteria, BH applies (sections 4.3 and 6).
4. **Interval methods.**
   - Wilson for proportions.
   - Newcombe hybrid score for differences.
   - Katz-log for ratios, switching to the Koopman score interval when a selected count is zero or both groups are fully selected. Katz is undefined or degenerate there.
   - MOVER-Wilson for balanced accuracy.
   - Wilson on the Jaccard index for F1.
   - **Fisher's exact test** as the small-cell rule. When any cell of a 2×2 comparison is under 5, a *fail* also needs Fisher's p to clear the same threshold.
   - The seeded percentile bootstrap is engine-only (section 5).
5. **One set of minimums for both runners, as floors that a plan cannot lower:** at least 30 evaluated rows, at least 30 rows per compared group, and at least 10 in every class-conditional denominator. The hosted runner's 20/5 defaults go (section 7).
6. **Group criteria compare every pair of groups by default.** This is exactly equivalent to today's "max − min" gap and "min/max" ratio. Groups under the minimum are **suppressed** one at a time rather than voiding the analysis. A pass also needs the pre-registered **coverage** (default 1.0) (section 5.10).
7. **Power is checked when the plan is approved.**
   - For each confirmatory criterion, the platform shows the probability of a pass if the system is fair, the smallest disparity that would reliably produce a fail, and the group size needed.
   - For reference it also shows the classical test-of-equality sample size. Detecting 40% vs 50% needs 388 per group; 8% vs 10% needs 3,213.
   - A shortfall needs a recorded acknowledgement, not a block (section 8).
8. **Threshold library.**
   - The four-fifths rule is a configurable **screen**, never a legal verdict.
   - NYC LL144 is a **reporting** profile, with no pass/fail.
   - EU AI Act entries are internal policies labelled **"no legal safe harbour"** (section 10).
9. **What the hosted runner mirrors.** It mirrors every analytic part exactly: intervals, p-values, Fisher, Holm/BH, minimums, power and the library. Bootstrap, clustered data and score-based calibration stay engine-only (section 12).
10. **Verification.**
    - All 37 golden cases were recomputed independently: 310 checks against scipy 1.17.1 and statsmodels 0.15.0 in a throwaway virtualenv outside the repository, with 0 discrepancies.
    - Monte Carlo checks confirm the coverage of the intervals this design derives (section 13.3).

**Where this design departs from the issue text** (also listed as open questions in section 15):

- **Ratios.** The issue asked for Katz-log. Katz-log is kept, but it is incomputable when a group has zero selections and has zero width when everyone is selected. In those cases the design falls back to the Koopman score interval, following Fagerland, Lydersen & Laake (2015).
- **Small cells.** Fisher was chosen over Boschloo.
- **Bootstrap.** Phase 1 uses the percentile bootstrap only, not BCa.
- **Extra metrics.** F1, multiclass and regression interval methods are specified even though the issue did not list them. #22 has to report an interval for every headline metric.

## 2. Problem and current state

### 2.1 Why point estimates are not enough

- **Small sample.** 6 of 20 selected against 10 of 20 gives an impact ratio of 0.60, which "fails" the four-fifths screen. Yet Fisher's exact p = 0.3332 and the Katz 95% interval is 0.2696–1.3355 (GC-08, GC-36).
- **Large sample.** 22,500 of 50,000 against 25,000 of 50,000 gives a ratio of 0.90 with interval 0.8883–0.9118: a precisely measured 10% disparity that a 0.8 screen passes. A pre-registered parity band of ±0.02 fails it (GC-09).
- **The law asks for thresholds set in advance.** Article 9(8) of the AI Act requires testing "against prior defined metrics and probabilistic thresholds" ([Art. 9](https://artificialintelligenceact.eu/article/9/)).
- **US guidance says the same about small numbers.** The Uniform Guidelines warn that large differences "based on small numbers" may not constitute adverse impact if not statistically significant ([29 CFR 1607.4(D)](https://www.law.cornell.edu/cfr/text/29/1607.4)).

### 2.2 What the code does today (checked on `main@74c6463`)

| Topic | Hosted runner (`site-app/lib/diagnostics.ts`, `evaluation.ts`) | Engine (`engine/diagnostics.py`, `engine/assurance.py`) |
|---|---|---|
| Intervals | None. The limitation text in `evaluate()` says "No confidence intervals are estimated." | `wilson()` at `CONFIDENCE = 0.95` on accuracy, precision, recall and per-group rates. The headline demographic-parity (DP), disparate-impact (DI) and equalized-odds (EO) figures have no interval. |
| Decision | `atLeast`/`atMost` compare the point estimate with the threshold, using a 1e-12 tolerance | `evaluate()` compares `m["value"]` with `threshold` |
| Fairness statistics | DP gap = max − min selection rate; DI = min/max; EO = max(TPR range, FPR range) | Same definitions (`fairness()`) |
| Minimums | `minimumSampleSize ?? 20`, `minimumClassCount ?? 5`, `minimumGroupSize` set in config, with 2 allowed (`configSchema`) | `minSampleSize` 30, `minGroupSize` 30, `minClassCount` 10 (`validate_config`) |
| Small groups | Any group under the minimum makes the test inconclusive | The same, in `fairness()`. In `intersectional_slices`, one small stratum voids the whole result. |
| Bootstrap | None | `bootstrap_interval` and `intersectional_slices`: seeded percentile bootstrap (`random.Random(seed)`, 100–2000 replicates, `MAX_BOOTSTRAP_WORK` = 5,000,000). It does not feed the outcome; there, "pass" means only that an interval could be estimated. |
| Multiplicity | None | None. The drift details state this. |
| Power | None | None |

The two runners therefore report different evidence for the same test and decide both from point estimates. This specification replaces both decision paths with one.

## 3. Concepts

- **Plan.** The pre-registered statistical part of an evaluation profile: the confidence level, the minimums and a list of criteria (section 9). It is frozen when the profile is approved, and any change creates a new profile version.
- **Criterion.** One test with one outcome, for example the `disparate_impact` result. It has a `kind`: `performance`, `group_comparison`, `calibration`, `multiclass_performance` or `regression_performance`. It has a `role`, either `confirmatory` (the default) or `exploratory`. It has one or more **members**.
- **Member.** One estimate compared with one band. Examples are "recall ≥ 0.70" and "selection-rate ratio of B vs A within [0.8, 1.25]". A member has an estimate, an interval, a status (`evaluated`, `undefined`, `insufficient_support` or `suppressed`), a direction (`pass`, `fail` or `none`) and a decision p-value.
- **Band.** The acceptable region `{lower, upper}`. Either bound may be absent, and present bounds are inclusive. Allowed bands:

| Metric type | Allowed band | Validation |
|---|---|---|
| Proportions and scores in [0, 1]: accuracy, precision, recall, specificity, FPR, balanced accuracy, F1, macro F1 | `{lower: t}` or `{upper: t}` or both | each bound strictly inside (0, 1) |
| Difference of rates in `all_pairs` mode: selection rate, TPR, FPR; calibration gap | `{lower: −δ, upper: δ}` | 0 < δ < 1 |
| Difference of rates in `reference` mode | symmetric, or `{lower: −δ}`, or `{upper: δ}` | 0 < δ < 1 |
| Ratio of selection rates in `all_pairs` mode | `{lower: τ, upper: 1/τ}` | 0 < τ < 1 |
| Ratio in `reference` mode | `{lower: τ, upper: 1/τ}` or `{lower: τ}` | 0 < τ < 1. A ratio cannot have an upper bound only. |
| Error metrics: MAE, RMSE, Brier | `{upper: t}` | t > 0 |

New plans with an invalid band MUST be rejected. A frozen legacy profile whose mapped band is invalid evaluates that criterion as inconclusive with reason `invalid_band`. One example is `minimumImpactRatio: 1`, which maps to the zero-width band [1, 1].

- **Family.** The set of criteria in one plan run that share a role. The confirmatory family is adjusted with Holm, the exploratory family with BH.

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

Consequently `p ≤ α` holds exactly when the reported (1 − α) interval lies inside the band (pass) or outside it (fail). The p-value is two-sided-equivalent: each one-sided claim is made at error rate ≤ α/2, which is the conservative convention of equivalence testing with two one-sided tests ([Schuirmann 1987](https://doi.org/10.1007/BF01068419)).

**Computing z\*.** For methods that are themselves score-test inversions, runners MUST use the closed forms below. The reference implementation asserts that they agree with bisection to 1e−8.

| Method | Closed-form z\* for a band bound b |
|---|---|
| Wilson | `\|p̂ − b\| / sqrt(b(1 − b)/n)` (the score statistic). A bound ≤ 0 or ≥ 1 is vacuous. |
| Katz-log | `\|ln r̂ − ln b\| / SE`, with `SE = sqrt(1/x₁ − 1/n₁ + 1/x₂ − 1/n₂)` |
| Koopman | `\|z_K(b)\|`, the Koopman statistic at b (section 5.6) |
| Normal approximation (MAE, MSE, Brier) | `\|m − b\| / SE`. RMSE uses MSE against b². |
| Jaccard–Wilson (F1) | Wilson z\* for TP out of TP + FP + FN, against `b/(2 − b)` |

For a pass with two bounds, `z* = min(z*_lower, z*_upper)`. For a fail, use the bound on the side where the estimate lies.

The composite methods (Newcombe, MOVER and the Bonferroni macro-F1) MUST use bisection, as follows:

1. Set lo = 0 and hi = 37.
2. While hi − lo > 1e−12: set mid = (lo + hi)/2. If the property holds at mid, set lo = mid; otherwise set hi = mid.
3. Return z\* = lo.

A claim is made when `p ≤ α + 1e−12`.

### 4.3 From members to a criterion

Let the **pool** be the members that are not `suppressed`, and **E** the pool members with status `evaluated` (m = |E|).

1. **No usable evidence.** If the criterion is gated (total rows below `minimums.sampleSize`) or E is empty: direction `none`, P = 1.
2. **Fail evidence.** Otherwise, if any member of E has direction `fail`: direction is `fail`, and `P = min(1, m · min p_fail)`. This is Bonferroni within the criterion. "Some comparison is outside the band" is a union claim, and the false-claim rate needs union control.
3. **Pass evidence.** Otherwise, direction is `pass` if any member of E points to pass. In that case `P = max p_pass` over the pool, but only if every pool member is evaluated and points to pass and no pass gate applies (section 4.4). Otherwise P = 1.

   "Every comparison is inside the band" is an intersection–union test. It has size α when each component test has size α, so no adjustment is needed or applied ([Berger 1982](https://doi.org/10.2307/1267823)).
4. `unadjustedOutcome` = direction when P ≤ α, otherwise `inconclusive`.
5. `decidingMemberId`: for a fail, the member with the smallest p_fail; for a pass, the member with the largest p_pass. Ties are broken by memberId in code-point order.

A `performance` criterion uses the same rule on heterogeneous members. "Accuracy ≥ 0.90, recall ≥ 0.70 and balanced accuracy ≥ 0.50" passes only if all three pass, and fails if any one fails after Bonferroni over the evaluated members.

### 4.4 Gates

| Gate | Effect | Reason code |
|---|---|---|
| Total rows < `minimums.sampleSize` | P = 1 (no claim either way) | `below_minimum_sample_size` |
| A member has a zero denominator | Member `undefined`, p = 1; blocks a pass | `undefined_zero_denominator`; `single_class` when the zero is a class count |
| A member's class-conditional denominator is below `minimums.classCount` | Member `insufficient_support`, p = 1; blocks a pass | `below_minimum_class_count` |
| A group is below `minimums.groupSize` | Group suppressed. Its members are descriptive and never decide. Coverage falls. | `group_suppressed_below_minimum` (member: `group_below_minimum_size`) |
| Coverage below the criterion's `minimumCoverage` | Blocks a pass; a fail stays possible | `insufficient_coverage` |
| A declared group has no rows | Blocks a pass | `empty_declared_group` |
| Fewer than two eligible groups, or the reference group is ineligible | Blocks a pass, and no member can fail | `insufficient_groups` |
| Small cell (any 2×2 cell < 5) and direction is fail | The member's p_fail becomes `max(p_interval, p_Fisher)` | `small_cell_exact_test_not_significant` (when this alone prevents the fail) |
| Interval straddles the band | none (inconclusive) | `interval_straddles_band` |
| A member's own p ≤ α, but m·p > α | none (inconclusive) | `within_criterion_multiplicity` |
| Holm or BH adjustment removes a claim | none (inconclusive) | `multiplicity_adjustment` |
| Estimate exactly on a bound | Member p = 1 | `estimate_on_band_boundary` |
| Zero-variance errors (MAE/RMSE) | Member `undefined` | `degenerate_interval` |

These reason codes are used only by the hosted runner and the engine, never in the fixture: `interval_requires_engine`, `clustered_design_requires_engine`, `bootstrap_insufficient_valid_replicates`, `bootstrap_budget_exceeded`, `small_cell_clustered`, `invalid_band`, `no_threshold`, `descriptive_metric`.

Gates never hide numbers. Every member whose estimate is defined still reports its estimate and interval, including suppressed and insufficiently supported members, so the auditor can see how uncertain the evidence is.

### 4.5 Family adjustment and outcome

The criterion P-values in each family are adjusted (section 6). The final `outcome` equals the direction when the adjusted P ≤ α, and is `inconclusive` otherwise.

### 4.6 Run outcome

The run outcome aggregates the confirmatory criteria: `fail` if any fails, else `inconclusive` if any is inconclusive, else `pass` if any passes, else `not_applicable`. This matches today's engine aggregation and never defaults to pass.

Exploratory criteria never change the run outcome. A failing exploratory criterion is listed in `reviewFlags` for the auditor. Suites that are not available stay `inconclusive`, as today.

### 4.7 Headline metric and interval

Group and calibration criteria report one headline, the worst member, so that existing displays keep a single number:

- **Two-sided difference band:** the largest |difference|. The interval's lower bound is the largest member lower |d|-bound at the Bonferroni level α/m. The upper bound is the largest member upper |d|-bound at the nominal level. For a member interval [L, U], the lower |d|-bound is `max(0, L, −U)` and the upper is `max(|L|, |U|)`.
- **Two-sided ratio band:** the same construction on |ln r|, reported as the smallest ratio, min/max. Its upper bound never exceeds 1.
- **One-sided band (reference mode):** the smallest (lower band) or largest (upper band) member. The pass side uses nominal bounds and the fail side uses Bonferroni bounds.
- **Missing pass-side bound:** if a pool member is not evaluated, the bound becomes the statistic's natural limit: 1 for |difference|, 0 for a ratio, −1 for a one-sided difference. This is valid but uninformative and keeps the existing `confidenceInterval` shape numeric.

The pass side needs no adjustment because the population worst case is attained at one fixed (unknown) pair. The fail side needs the union bound. The headline interval therefore covers the population worst case with probability ≥ 1 − α; the 3-group simulation in section 13.3 gives 0.981.

Before the small-cell gate and family adjustment, a criterion passes exactly when its headline interval is inside the band and fails exactly when it is outside. `method` is `worst_member_bounds`.

## 5. Per-metric specification

Notation: TP, FP, FN, TN are counts; positives P = TP + FN; negatives N = FP + TN; n = rows. `wilson(x, n, z)` is defined in section 5.1.

| Metric (id) | Estimator | Interval | z\* | Small-cell rule | Minimum support (denominator) | Undefined when |
|---|---|---|---|---|---|---|
| accuracy | (TP+TN)/n | Wilson | closed | – | n ≥ 30 | n = 0 |
| precision | TP/(TP+FP) | Wilson | closed | – | TP+FP ≥ 10 | TP+FP = 0 (`undefined_zero_denominator`) |
| recall (TPR) | TP/P | Wilson | closed | – | P ≥ 10 | P = 0 (`single_class`) |
| specificity (TNR) | TN/N | Wilson | closed | – | N ≥ 10 | N = 0 (`single_class`) |
| false_positive_rate | FP/N | Wilson | closed | – | N ≥ 10 | N = 0 (`single_class`) |
| balanced_accuracy | (TP/P + TN/N)/2 | MOVER-Wilson | bisection | – | P ≥ 10 and N ≥ 10 | P = 0 or N = 0 |
| f1 | 2TP/(2TP+FP+FN) | Wilson on J = TP/(TP+FP+FN), mapped by F1 = 2J/(1+J) | closed | – | P ≥ 10 | P = 0 |
| selection rate (per group) | (TP+FP)/n_g | Wilson (reported, not a criterion) | – | – | n_g ≥ 30 | n_g = 0 |
| selection_rate_difference (demographic-parity difference) | SR_subject − SR_comparator | Newcombe hybrid score | bisection | Fisher gate | both groups ≥ 30 | a group with no rows |
| selection_rate_ratio (demographic-parity ratio and impact ratio) | SR_subject / SR_comparator | Katz-log; Koopman when the subject count is 0 or both groups are fully selected | closed | Fisher gate | both groups ≥ 30 | comparator rate = 0 |
| tpr_difference, fpr_difference (equalized-odds gaps) | rate difference within positives (TPR) or negatives (FPR) | Newcombe | bisection | Fisher gate | TPR: P_g ≥ 10 in both groups; FPR: N_g ≥ 10 in both groups (groups ≥ 30) | P_g = 0 (TPR) or N_g = 0 (FPR) |
| calibration_gap (engine) | ȳ_b − s̄_b per probability bin | Wilson on ȳ_b, shifted by s̄_b | closed | – | n_b ≥ 30 (bins under 30 suppressed) | n_b = 0 |
| expected_calibration_error (engine, descriptive) | Σ (n_b/n)·\|ȳ_b − s̄_b\| | percentile bootstrap | – (never decides) | – | – | no scored rows |
| macro_f1 (multiclass) | mean of per-class F1 | per-class Jaccard–Wilson at α/k, averaged (Bonferroni) | bisection | – | every class support ≥ 10 | a class has no support |
| balanced_accuracy (multiclass macro recall) | mean of per-class recall | MOVER-Wilson over k classes | bisection | – | every class support ≥ 10 | a class has no support |
| mae, rmse | mean \|e\|; sqrt(mean e²) | normal approximation (RMSE via MSE) | closed | – | n ≥ 30 | zero variance (`degenerate_interval`) |
| r2, brier_score | as today | engine bootstrap (r2, descriptive); normal approximation (Brier) | – / closed | – | n ≥ 30 | as today |

### 5.1 Wilson interval (proportions)

For x successes in n trials and critical value z:

```
p = x/n,  d = 1 + z²/n,  c = (p + z²/(2n))/d,  h = z·sqrt(p(1−p)/n + z²/(4n²))/d
L = 0 if x = 0 else max(0, c − h);   U = 1 if x = n else min(1, c + h)
```

This is exactly today's `engine/diagnostics.py` `wilson()` generalized to any z ([Wilson 1927](https://doi.org/10.1080/01621459.1927.10502953)). [Brown, Cai & DasGupta (2001)](https://doi.org/10.1214/ss/1009213286) recommend Wilson for small n. Golden examples: GC-01 (40/50 → [0.6696, 0.8876]), GC-04 (0/40 → [0, 0.0876]), GC-05 (30/30 → [0.8865, 1]).

### 5.2 Balanced accuracy and macro recall (MOVER)

TPR and TNR are estimated on disjoint rows and are independent given the class counts. For the mean of k independent proportions p_i with Wilson limits (l_i, u_i), the MOVER interval ([Zou & Donner 2008](https://doi.org/10.1002/sim.3095)) is:

```
L = mean − sqrt(Σ (p_i − l_i)²)/k,   U = mean + sqrt(Σ (u_i − p_i)²)/k
```

Use k = 2 for binary balanced accuracy and k = number of classes for multiclass macro recall. Simulated coverage is 0.9497 (section 13.3). The majority-baseline check of #15 is the member `balanced_accuracy ≥ 0.50`. A constant predictor has balanced accuracy exactly 0.5, sits on the bound and can never pass (GC-06).

### 5.3 F1 (Jaccard–Wilson)

Under multinomial sampling, and conditional on M = TP + FP + FN, TP follows a binomial distribution Bin(M, J) with J = π_TP/(π_TP + π_FP + π_FN). Population F1 is 2J/(1 + J), a monotone transform. A Wilson interval for J on (TP, M), mapped through 2J/(1+J), is therefore a valid interval for F1. The derivation is in Appendix A.1; simulated coverage is 0.9508.

The pass threshold maps the same way: F1 ≥ b exactly when J ≥ b/(2 − b). GC-21 gives F1 0.8293, [0.7863, 0.8651].

### 5.4 Macro F1 (multiclass, conservative)

Per-class F1 values share rows, so their dependence is unknown. Each class gets a Jaccard–Wilson interval at per-class critical value `z_k = −Φ⁻¹((1 − Φ(z))/k)`, which is Bonferroni over k classes. The macro interval is the mean of the lower bounds and the mean of the upper bounds. If every per-class interval covers, the mean is covered, so coverage is at least 1 − α without any independence assumption. Simulated coverage is 0.9989, which is conservative. GC-34 gives [0.7770, 0.8634]. A tighter delta-method interval is listed as a follow-up.

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

**Why not Katz everywhere?** Fagerland et al. find Katz "usually quite conservative", which is acceptable for audit claims. But Katz "cannot be computed when n11 = 0" and gives a zero-width interval when every case is selected. The "adjusted log" fix that adds 0.5 "is not to be trusted" ([Fagerland et al. 2015](https://doi.org/10.1177/0962280211415469), sections 6.2–6.3). Zero selections are common in low-selection hiring data: at a 5% selection rate, P(0 of 30) = 21%. Koopman is the review's recommended interval for the ratio in both small and large samples.

**Implementation warning.** `statsmodels` 0.15 computes Koopman by Nam's closed-form cubic, which returns degenerate intervals when a group's rate is 1. For example, 11/385 vs 84/84 gives [0.2026, 0.2026] instead of [0.0160, 0.0504]. Runners MUST use the bisection above. Golden cases: GC-13 (0/40 vs 10/40 → [0, 0.3579]), GC-14 (0/30 vs 5/30 → [0, 0.7143]), GC-37 (40/40 vs 35/35 → [0.9124, 1.1098], which equals `[n₁/(n₁+z²), 1 + z²/n₂]` analytically).

### 5.7 Equalized odds

The criterion `equalized_odds` has two members per pair of groups: `tpr_difference` (within positives) and `fpr_difference` (within negatives). Both use Newcombe and share the band ±δ. Its headline is the largest |TPR or FPR difference|, which equals today's `max(TPR range, FPR range)` in the population (GC-20).

### 5.8 Calibration (engine; in the hosted runner only when it accepts score columns)

**Bins.** Use B equal-width bins on [0, 1]. B is `calibrationBins` from the plan, 10 by default. Bin index = `min(floor(s·B), B − 1)`, which is today's rule. For each bin, compute n_b, positives y_b and mean score s̄_b.

**Decision.** For every bin with n_b ≥ 30, a member `calibration_gap:bin<b>` compares ȳ_b − s̄_b with the band ±δ, where δ is plan-set with no default. The interval is the Wilson interval for y_b/n_b minus s̄_b. Treating s̄_b as fixed is conservative: given the scores, the labels in a bin are independent Bernoulli trials whose variance is at most the binomial variance at their mean (a Poisson-binomial property).

**Suppression and coverage.** Bins under 30 are suppressed, and coverage is the share of scored rows in eligible bins (GC-24).

**ECE.** The expected calibration error is reported for continuity but never decides. It is biased upward with sparse bins, and its bootstrap interval is not a reliable decision basis. The engine reports a descriptive percentile-bootstrap interval for it (section 5.11).

**Brier score.** Uses the normal approximation of section 5.9.

**Per-group calibration.** Run one calibration criterion per group. These criteria are exploratory by default.

### 5.9 Regression (MAE, RMSE)

- **MAE:** `m ± z·s/√n`, with s the sample standard deviation (n − 1 denominator) of |e| and the lower bound clamped at 0.
- **RMSE:** first build `q ± z·s_q/√n` for the MSE q = mean(e²), with the lower bound clamped at 0. Then take square roots of both bounds. Decisions on RMSE ≤ t use MSE ≤ t².
- **Degenerate case.** Zero variance makes the member undefined (`degenerate_interval`).
- **R².** Stays descriptive: the engine gives a bootstrap interval and the hosted runner gives no interval.
- **Caveat.** This is a CLT approximation; heavy-tailed errors can undercover. The engine also reports a percentile-bootstrap interval as a sensitivity figure, which never decides. Example: GC-35.

### 5.10 Group comparisons, suppression and coverage

1. **Groups.**
   - Groups are all non-missing values of the group column, plus any `declaredGroups`.
   - Groups are ordered by Unicode code points. TypeScript MUST use a code-point comparator, not the default UTF-16 `sort()`.
   - Rows with a missing group are `unknownGroupRows`. They are excluded from comparisons but counted.
2. **Modes.**
   - `all_pairs` (default): every pair of non-empty groups. Each pair is oriented so that the **subject** has the lower observed rate of that member's metric; ties keep code-point order. The member id is `metric:subject|comparator`. The band must be symmetric. "All pairs within ±δ" is exactly "max − min ≤ δ", and "all pairs within [τ, 1/τ]" is exactly "min/max ≥ τ". Legacy thresholds therefore keep their meaning.
   - `reference`: every other group against a pre-registered `referenceGroup`. One-sided bands are allowed. The LL144 convention of a "most selected category" is data-chosen and is used only for reporting (section 10.2).
3. **Suppression.** A group with n < `minimums.groupSize` is suppressed: it is listed in `suppressedGroups` with its count, and its pairs become `suppressed` members. Those members are reported descriptively, with an estimate, an interval and Fisher's p when a cell is small, but never decide and are not counted in m.
4. **Coverage.** `coverage = rows in eligible groups / (rows in all groups + unknownGroupRows)`, the share of the population the decision speaks for. A pass needs coverage ≥ `minimumCoverage` (default 1.0, allowed range [0.5, 1.0], recorded with a rationale in the plan). A fail never needs coverage: a demonstrated disparity between eligible groups stands (GC-23).
5. **Declared groups.** A declared group with no rows blocks a pass (GC-16): there is no evidence at all for a pre-registered group.
6. **Intersectional analysis.** Strata are combinations of up to five protected fields (`intersectional_slices` today). They are just groups with composite labels, so everything above applies. Small strata are suppressed one at a time instead of voiding the result (GC-22, GC-23). The default role is exploratory.

### 5.11 Bootstrap and clustered data (engine-only)

- **When analytic intervals are invalid.** Analytic intervals assume independent rows. When the plan declares a `clusterField`, for example a person id for repeated applications, the engine MUST use the cluster bootstrap for every member, and the hosted runner MUST return `inconclusive` with `clustered_design_requires_engine`.
- **Resampling.** Keep today's `_draws`: clusters ordered by `canonical_bytes`, drawn uniformly with replacement using `random.Random(seed)`, where seed is the run seed. Use B = `bootstrap.replicates` replicates: default 2000, allowed 1000–10000.
- **Work budget.** If n·B would exceed `MAX_BOOTSTRAP_WORK`, the member is inconclusive (`bootstrap_budget_exceeded`).
- **Undefined replicates.** Replicates where the estimate is undefined are dropped. With fewer than 0.9·B valid replicates, the member is undefined (`bootstrap_insufficient_valid_replicates`).
- **Interval.** The percentile interval uses type-7 linear interpolation (today's `_quantile`).
- **Direction.** Taken from the median replicate.
- **Decision p.** `p = max(2u*, 2/(B_valid + 1))`, where `u* = inf{u ∈ (0, 0.5] : [q(u), q(1 − u)] decides}`. Find u\* by bisection to 1e−9. The first term keeps `p ≤ α` equivalent to "the percentile interval decides".
- **Small cells.** Fisher assumes independence, so in cluster mode any member with a 2×2 cell under 5 is inconclusive (`small_cell_clustered`).
- **Minimum clusters.** Every compared group needs at least 10 clusters (`min_clusters`, as today).
- **Descriptive bootstrap.** ECE and R² get an iid percentile bootstrap with the same B and seed, for display only.
- **Not adopted in phase 1.** BCa is not used: it needs a jackknife, which is O(n²) for ECE, and bootstrap results never decide outside cluster designs. It may be added later as an engine option with a pinned definition.

### 5.12 Fisher's exact test (the small-cell rule)

**When.** Compute Fisher's exact test for every pairwise member, suppressed or not, when any of its four cells (x₁, n₁ − x₁, x₂, n₂ − x₂) is under 5. Report it as `fisherExactP`. Otherwise `fisherExactP` is null.

**Definition.** The two-sided p is the sum of hypergeometric probabilities over all tables with the same margins whose probability is ≤ the observed table's. This is the definition used by [scipy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html) and [R](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/fisher.test.html).

**Numerics.**
- Runners compute in log space, from log-factorials or the pmf recurrence.
- They normalise by the sum of all table weights.
- Probabilities within a relative 1e−7 of the observed one count as "≤". This absorbs floating-point noise in symmetric tables.
- The reference implementation uses exact integers. GC-36 gives seven reference tables, including the issue's 6/20 vs 10/20 → 0.3332.

**Use.** Fisher's test only gates fails: `p_fail = max(p_interval, p_Fisher)`. A claim that the band is violated implies that parity is excluded, because every group band contains parity. If an exact test cannot even reject parity, the asymptotic fail is not trusted. This mirrors the Uniform Guidelines' pairing of practical and statistical significance ([29 CFR 1607.4(D)](https://www.law.cornell.edu/cfr/text/29/1607.4)).

GC-14 shows the gate binding: the Koopman interval [0, 0.7143] lies below 0.8, but Fisher's p = 0.0522, so the outcome is inconclusive. Passes are not gated. Wilson and Newcombe behave well with small and zero counts, and a ratio pass is impossible when a count is zero.

**Why Fisher rather than Boschloo.** Boschloo's test is more powerful, as the [scipy documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html) notes. But it maximises over a nuisance parameter numerically (scipy evaluates a grid), so two implementations can differ at the fourth decimal. Fisher is exact, deterministic and identical in both runners. Since it only gates fails, its conservatism errs on the safe side. Boschloo may later be reported by the engine as a sensitivity statistic.

### 5.13 Numerical requirements (both runners)

- **Normal quantile.** Use Wichura's AS241 ([Wichura 1988](https://doi.org/10.2307/2347330)). Python's `statistics.NormalDist.inv_cdf` implements AS241. TypeScript MUST port it.
- **`erfc`.** Must have relative error ≤ 1e−12 on [0, 27]. Python has `math.erfc`; TypeScript needs a Cody-type rational approximation. Validate against `numerics` in the fixture.
- **Arithmetic.** IEEE-754 doubles. No other special functions are needed.
- **Performance.** At most 50 groups in the hosted runner gives at most 1,225 pairs. Each Koopman bound is about 200 statistic evaluations, well within a Worker's CPU budget.

## 6. Multiplicity

- **Families.** One plan evaluated on one dataset in one run forms two families:
  - all `confirmatory` criteria, adjusted with Holm ([Holm 1979](https://www.jstor.org/stable/4615733));
  - all `exploratory` criteria, adjusted with BH at q = α ([Benjamini & Hochberg 1995](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x)).

  Defaults:
  - Hosted suite tests are confirmatory.
  - Engine results derived from `thresholds` are confirmatory.
  - Intersectional analyses and per-group calibration are exploratory.
  - Per-group performance without a criterion is descriptive and not in any family.
- **Family size.** The family size is the number of criteria pre-registered with that role. It includes criteria that end up gated, so the family does not depend on the data.
- **Holm-adjusted p.** Sort ascending, p₍₁₎ ≤ … ≤ p₍ₘ₎; then `p̃₍ᵢ₎ = min(1, max over j ≤ i of (m − j + 1)·p₍ⱼ₎)`.
- **BH-adjusted p.** `p̃₍ᵢ₎ = min(1, min over j ≥ i of m·p₍ⱼ₎/j)`. Both are invariant to the order of ties.
- **Validity.** Each criterion can make at most one false claim, a false pass or a false fail depending on the truth, and its P is a valid p-value for that error (sections 4.2–4.3; Appendix A.2). Holm therefore bounds the probability of any false claim among the confirmatory criteria at α. Because the p-values are two-sided-equivalent, the bound is in fact α/2, up to the approximation error of the interval methods.
- **Not adjusted:**
  - descriptive members (suppressed groups, selection rates per group);
  - LL144 reporting figures;
  - drift statistics (section 15, Q6).
- **Worked example (GC-31).** Four confirmatory criteria have P = 6.0e−13, 0.0035, 0.0313 and 0.3792. Holm adjusts the third to 0.0626, so `disparate_impact` becomes inconclusive with `multiplicity_adjustment`, although its 95% interval [0.8121, 1.1007] lies inside [0.8, 1.25]. GC-18 and GC-19 pin Holm and BH on raw p-values. GC-17 shows within-criterion Bonferroni.

## 7. Minimum support: one set for both runners

| Floor | Value | Applies to | Rationale |
|---|---|---|---|
| `minimums.sampleSize` | 30 | rows evaluated by a criterion | Today's engine value. Below about 30, even a proportion near 0.5 has a 95% Wilson half-width of at least ±0.17 (15/30 → [0.3315, 0.6685]), too wide for any material conclusion. It is also a common floor for normal approximations. |
| `minimums.groupSize` | 30 | each compared group or stratum (and calibration bin) | The same argument per group. At 30 vs 30 with equal rates, the Newcombe interval is ±0.24 (GC-11). Groups this small rarely support a pass under any realistic band, and suppressing them limits re-identification risk in client exports. |
| `minimums.classCount` | 10 | every class-conditional denominator: positives for recall and F1, negatives for specificity and FPR, predicted positives for precision, per-group positives and negatives for equalized odds, per-class support | Today's engine value. With fewer than 10, a Wilson interval is wider than ±0.25 (8/10 → [0.4902, 0.9433]). The small-cell rule (cells < 5) adds the exact test below this level. |

These are **floors**. A plan MAY raise them and MUST NOT lower them.

**Hosted migration (#22).**
- `configSchema` defaults become 30/30/10, with minimums `minimumSampleSize ≥ 30`, `minimumGroupSize ≥ 30` and `minimumClassCount ≥ 10` for new or re-versioned profiles.
- Frozen runs keep their recorded values and are not recomputed.
- Re-running a legacy profile applies `max(floor, configured)` and records both values.

**Engine.** The engine keeps its values and rejects lower ones in `validate_config`.

Because the interval now decides, minimums are a safety net rather than the main defence, so they need not be larger.

## 8. Power and minimum detectable effect (at plan approval)

**Inputs, per confirmatory criterion:**
- planned group sizes, entered by the auditor or pre-filled from the registered dataset's group counts (never its outcomes);
- the assumed true value: a baseline rate p₀ for group criteria (default 0.5), and the expected metric value for performance members;
- the target power (default 0.80) and the plan's confidence level.

**Outputs, from normal approximations at the assumed true values, matching each decision rule:**

| Output | Definition |
|---|---|
| `passProbability` (difference, band ±δ, SE = sqrt(p₁q₁/n₁ + p₂q₂/n₂)) | `max(0, Φ((δ − d)/SE − z) + Φ((d + δ)/SE − z) − 1)`. This is the two-one-sided-tests (TOST) power at the assumed d, default 0. |
| `passProbability` (ratio, band [τ, 1/τ], SE = sqrt(q₁/(n₁p₁) + q₂/(n₂p₂))) | the same on the log scale with bounds ln τ and −ln τ |
| `passProbability` (proportion vs t, Wilson rule) | `Φ((p − t − z·sqrt(t(1 − t)/n)) / sqrt(p(1 − p)/n))` |
| `requiredGroupSizeForPass` | smallest equal n per group with passProbability ≥ target |
| `failMde` | the smallest true disparity beyond the band that fails with probability ≥ target. For a difference: comparator p₀, subject p₀ − Δ. For a ratio: the largest r < τ, searched between the peak of the fail-probability curve and τ, because that curve falls again as r → 0. |
| `equalityTestGroupSize` | the classic two-sided z-test size, Fleiss's formula without continuity correction: `n = [z₁₋α/₂·sqrt(2p̄q̄) + z₁₋β·sqrt(p₁q₁ + p₂q₂)]² / (p₁ − p₂)²`, rounded up. Shown for reference only, since it answers "is there any difference?" rather than "is the difference within the band?". |

**Golden values:**
- GC-25: 40% vs 50% needs 388 per group (387.34 before rounding). GC-26: 8% vs 10% needs 3,213 (3,212.94). Both match statsmodels `samplesize_proportions_2indep_onetail` to 1e−7.
- GC-27: with 388 per group at true parity and 50% selection, the four-fifths band passes with probability only 0.749. It needs 423 per group for 80%. A true ratio of 0.620 would fail with 80% probability.
- GC-28: a ±0.05 parity band at 30% selection and 500 per group can **never** pass (probability 0); it needs 1,766 per group.
- GC-29: recall that is truly 0.80, measured on 50 positives against a 0.70 minimum, passes with probability 0.316; it needs 153.

Simulating the actual decision rules agrees within 0.005 (section 13.3).

**Approval behaviour.**
- If any confirmatory criterion's `passProbability` is below the target, approval shows the numbers in plain language. For example: "With 388 people per group, a system with identical selection rates would pass this screen only 3 times in 4."
- Approval then requires a recorded acknowledgement (`power.acknowledgement`, free text). It does not block: small populations are sometimes all there is.
- The power section is frozen with the plan.

## 9. Pre-registered plan (statistical fields)

The plan is stored in the evaluation profile (#22) and the engine configuration (#21, as `config.statistics`). Its canonical-JSON SHA-256 is recorded in the run manifest.

```json
{
  "statisticsVersion": "1.0.0",
  "confidenceLevel": 0.95,
  "minimums": {"sampleSize": 30, "groupSize": 30, "classCount": 10},
  "clusterField": null,
  "bootstrap": {"replicates": 2000},
  "calibrationBins": 10,
  "criteria": [
    {"id": "performance", "role": "confirmatory", "kind": "performance",
     "members": [{"metric": "accuracy", "band": {"lower": 0.80, "upper": null}},
                 {"metric": "recall", "band": {"lower": 0.70, "upper": null}},
                 {"metric": "balanced_accuracy", "band": {"lower": 0.50, "upper": null}}]},
    {"id": "disparate_impact", "role": "confirmatory", "kind": "group_comparison",
     "metric": "selection_rate_ratio", "comparison": {"mode": "all_pairs"},
     "band": {"lower": 0.8, "upper": 1.25}, "minimumCoverage": 1.0, "declaredGroups": null,
     "libraryEntry": "screen.us.four-fifths@1", "rationale": "Pre-registered screen; see memo."}
  ],
  "power": {"targetPower": 0.8, "assumptions": {"baselineRate": 0.5, "groupSizes": {"A": 388, "B": 388}}, "acknowledgement": null}
}
```

**Legacy derivation, when no plan is stored.** Both runners MUST derive the plan deterministically, so existing profiles keep their meaning:

- Every selected test becomes a confirmatory criterion. Bands come from the configuration:
  - `minimumAccuracy` gives the accuracy lower bound.
  - `minimumRecall` gives the recall lower bound, plus a `balanced_accuracy ≥ 0.50` member (the #15 baseline).
  - `minimumMacroF1` gives the macro-F1 lower bound.
  - `maximumRmse` gives the RMSE upper bound.
  - `maximumParityGap` δ gives the selection-rate difference band ±δ.
  - `minimumImpactRatio` τ gives the ratio band [τ, 1/τ].
  - `maximumOddsGap` (or `maximumParityGap`) δ gives the TPR and FPR difference bands ±δ.
- `all_pairs` mode with `minimumCoverage` 1.0 and confidence level 0.95.
- Minimums are `max(floor, configured)`.
- Engine `thresholds.values` map the same way: `demographic_parity_difference ≤ δ`, `disparate_impact_ratio ≥ τ`, `equalized_odds_difference ≤ δ`, and per-metric bounds for performance.
- An `expected_calibration_error` threshold no longer decides; it is reported with `descriptive_metric`.

**Freezing.** Changing any field after approval MUST create a new profile version (#22 acceptance criterion).

## 10. Threshold library

### 10.1 Library entries

Library entries are versioned data, shipped identically in both runners (#22 adds the data file; the engine mirrors it). A plan references `id@version` and may override only the listed parameters, within their ranges. Overrides are recorded.

Every result that uses an entry MUST show its `legalStatus` label and `caveat` text verbatim. The run schema's `threshold.source` stays `"internal_policy"`, because the auditor adopts every entry as an internal acceptance rule. New fields `libraryEntry` and `legalStatus` say where it came from.

| id@version | Metric and band | Parameters (default; range) | legalStatus | Caveat shown with every result | Sources |
|---|---|---|---|---|---|
| `screen.us.four-fifths@1` | selection_rate_ratio, `all_pairs`, [τ, 1/τ] | τ (0.8; 0.5–0.95) | `screening_heuristic` | "Four-fifths screen: a rule of thumb from the US Uniform Guidelines, not a legal test of discrimination. The EEOC has sent OIRA a final rule rescinding the Guidelines' interpretive provisions." | [29 CFR 1607.4(D)](https://www.law.cornell.edu/cfr/text/29/1607.4); [DirectEmployers, 23 Oct 2026](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/) (secondary) |
| `report.us-nyc.ll144@1` | reporting profile (section 10.2); no band, no pass/fail | 2% exclusion on or off per category, with a justification | `reporting_only` | "NYC Local Law 144 requires these figures to be published; it sets no pass or fail threshold." | [DCWP final rule](https://www.sidley.com/-/media/resource-pages/ai-monitor/laws-and-regulations/20230406-nyc-dcwp-notice-of-adoption-of-final-rule-for-local-law-144.pdf?la=en); [NYC rules page](https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/) |
| `policy.eu-aia.selection-rate-difference@1` | selection_rate_difference, `all_pairs`, ±δ | δ (0.10; 0.01–0.30) | `no_legal_safe_harbour` | "Internal policy. The EU AI Act sets no numerical fairness threshold, and meeting this one gives no presumption of conformity." | [Art. 10](https://artificialintelligenceact.eu/article/10/), [Art. 9(8)](https://artificialintelligenceact.eu/article/9/) |
| `policy.eu-aia.impact-ratio@1` | selection_rate_ratio, `all_pairs`, [τ, 1/τ] | τ (0.80; 0.5–0.95) | `no_legal_safe_harbour` | same | same |
| `policy.eu-aia.equalized-odds@1` | equalized_odds (TPR and FPR differences), ±δ | δ (0.10; 0.01–0.30) | `no_legal_safe_harbour` | same | same |
| `policy.eu-aia.declared-performance@1` | one performance metric, lower bound = declared − tolerance | `declaredValue` (required), `tolerance` (required; 0–0.2) | `no_legal_safe_harbour` | "Checks consistency with the accuracy level declared under Art. 15(3); not a conformity assessment." | [Art. 15](https://artificialintelligenceact.eu/article/15/) |
| `policy.eu-aia.calibration@1` (engine) | calibration_gap per bin, ±δ | δ (required; 0.01–0.2) | `no_legal_safe_harbour` | same as the EU fairness entries | [Annex IV](https://artificialintelligenceact.eu/annex/4/) |

Status notes:

- **Standards.** No harmonised standard gives a numerical safe harbour as of November 2026. The research brief says prEN 18283 is a working draft; this was not re-verified here.
- **EEOC.** The rescission's exact scope, including whether it removes the four-fifths rule, is unconfirmed until the rule text is published (DirectEmployers, above). That is why the entry is a configurable screen.

### 10.2 NYC LL144 reporting computations

These computations follow the DCWP rule (6 RCNY §§ 5-300 to 5-303). #30 builds the pack and summary; this section fixes the arithmetic.

- **Selection rate.** The number of a category's individuals who were selected or classified, divided by the category's total. The rule defines it as "the rate at which individuals in a category are either selected to move forward … or assigned a classification" (§ 5-300).
- **Scoring rate.** The share of a category scoring strictly **above the sample's median score**. The median is the ordinary sample median, the mean of the two middle values when n is even. See Q4 for which sample.
- **Impact ratio.** The category's rate divided by the rate of the most selected (or highest-scoring) category, computed for sex, race/ethnicity and intersectional categories. The reference category is the first maximum in input order among the categories that are not excluded.
- **2% exclusion.** The auditor MAY exclude a category representing less than 2% of the data, comparing n_c/Σn strictly below 0.02, from the impact-ratio calculations. If they do, the summary must give the justification, the number of applicants and the category's rate (§ 5-301(d)). The runner flags eligible categories (`eligibleForTwoPercentExclusion`) but never excludes them automatically.
- **Unknown category.** Report the number of individuals in an unknown category, who are not included in the calculations (§ 5-301(b)(5)).
- **Supplementary intervals.** Each rate gets a Wilson interval and each impact ratio a Katz/Koopman interval against the reference category. These are labelled "supplementary; not required by the rule; the reference category is chosen from the data, so intervals are conditional on that choice".
- **Published summary fields (§ 5-303).**
  - the date of the most recent bias audit;
  - the source and explanation of the data, plus why test data was used, if it was (§ 5-302);
  - the number of individuals in the unknown category;
  - the number of applicants or candidates;
  - selection or scoring rates and impact ratios for all categories;
  - the AEDT's distribution date.

GC-32 reproduces the DCWP worked example for race/ethnicity exactly. For instance, Black or African American has an impact ratio of 0.8432, which the rule shows as 0.84, with interval [0.7394, 0.9616]. Native American or Alaska Native is 1.59% of the data, so it is eligible for the 2% exclusion. GC-33 runs the same data through the four-fifths screen. The published ratios of 0.84–0.85 look like passes, but the screen is **inconclusive**: the worst ratio's interval reaches 0.5970.

## 11. Output contract

Both runners emit the same logical objects. The schema change belongs to #21 and #22: a backward-compatible minor version through `schemas/.build-run-schema.py`, proposed as engine report 1.1 and hosted run 1.3.

- **Member** (one entry in a result's `metrics`):
  - `name` = memberId and `value` = estimate.
  - `confidenceInterval` = `{lower, upper, level, method}`, or null when undefined. Method values are `wilson`, `newcombe_hybrid_score`, `katz_log`, `koopman_score`, `mover_wilson`, `jaccard_wilson`, `jaccard_wilson_bonferroni`, `normal_approximation`, `normal_approximation_mse`, `percentile_bootstrap` and `cluster_percentile_bootstrap`.
  - `pValue` = the member's decision p.
  - `numerator` and `denominator` where they apply.
  - `details` = `{metric, subject, comparator, counts, band, status, direction, smallCell, fisherExactP, reasons}`.
- **Headline metric** (first in `metrics` for group and calibration criteria): `name` = the headline metric id, one of `largest_selection_rate_difference`, `smallest_selection_rate_ratio`, `largest_tpr_or_fpr_difference` or `largest_calibration_gap`. Its `confidenceInterval` uses `method: "worst_member_bounds"`.
- **Result decision** (new `decision` object on every result):

  ```
  {statisticsVersion, confidenceLevel, role, direction, pValue, adjustedPValue, adjustment, familySize,
   unadjustedOutcome, decidingMemberId, coverage, suppressedGroups, reasons}
  ```

  `outcome` = the adjusted outcome. `limitations` gains the plain-language messages for the reasons. The text "No confidence intervals are estimated." MUST be removed.
- **Run.** It adds `reviewFlags` (the failing exploratory criteria) and records `statisticsVersion` and the plan hash in provenance.

The fixture's `expected` objects use exactly these field names. Only the nesting differs: the fixture lists `members` inside each criterion.

## 12. What the hosted runner mirrors

| Component | Hosted runner (`site-app/lib`) | Engine |
|---|---|---|
| Normal quantile and `erfc`; Wilson, Newcombe, Katz-log, Koopman, MOVER, Jaccard–Wilson, Bonferroni macro-F1, normal approximation | **mirror exactly** (golden, 1e−6) | yes |
| Decision p-values (closed forms and bisection), gates, criterion combination, headline bounds | **mirror exactly** | yes |
| Fisher's exact test | **mirror exactly** | yes |
| Holm and BH, families, run aggregation, `reviewFlags` | **mirror exactly** | yes |
| Minimum floors; suppression; coverage; `all_pairs` and `reference` modes | **mirror exactly** | yes |
| Power and MDE at plan approval | **mirror** (approval UI) | yes (CLI and report) |
| Threshold library (data) | **mirror** | yes |
| LL144 computations | via #30 (same arithmetic) | via #30 |
| Intersectional strata (several protected columns) | **mirror** once the profile accepts up to five group columns; until then one column | yes (`intersectional_slices`) |
| Calibration bins, ECE and Brier (need score columns) | not available; `interval_requires_engine` | engine-only |
| Cluster bootstrap and descriptive bootstrap (ECE, R²) | not available; `clustered_design_requires_engine` | engine-only |
| Boschloo, BCa, shrinkage | not in 1.0.0 | possible engine-only additions (section 15) |

## 13. Golden cases and how they were verified

### 13.1 Fixture format (`schemas/fixtures/statistics-golden.json`)

**Top level.** The fixture has `specificationVersion`, `howToUse`, `defaults`, `tolerances`, `numerics` and `cases[]`. The `numerics` section holds normal quantiles and `erfc` reference values for validating special functions.

**Case types:**
- `plan`: data and plan in, criteria with members out, then adjustment and run outcome.
- `multiplicity`: raw p-values in, adjusted values out.
- `power`.
- `fisher`.
- `ll144`.

**Data shapes:**
- `groups[]` with `{tp, fp, fn, tn}` or `{selected, n}`, plus optional `unknownGroupRows`;
- `bins[]` for calibration;
- `labels` and `matrix` for multiclass;
- `errors` for regression.

**Fields per case:**
- `runners`: `["engine"]` for calibration, otherwise both.
- `endToEnd`: whether the case can also be expanded into rows and run through the real runner. The expansion rule is in `howToUse.rowExpansion`. The hosted runner skips cases with more than 10,000 rows, unknown-group rows, declared groups or reference mode.

**Comparison rules:**
- Numbers: |Δ| ≤ 1e−6. P-values: |Δ| ≤ 1e−9 + 1e−5·|expected|.
- Members are matched by memberId.
- `reasons` are compared as sets.
- Everything else must match exactly.
- Stored numbers have 12 significant digits. The tables below round to 4 decimal places.

### 13.2 The 37 cases

Inputs are counts (x/n means x selected out of n). The key member is the deciding member. "Decision p" is the criterion P before family adjustment.

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
| GC-09 | large sample (issue) | parity ±0.02, same data | difference −0.0500 [−0.0562, −0.0438] | 2.1e−21 | 2.1e−21 | **fail** |
| GC-10 | perfect parity | parity ±0.10; 150/300 each | difference 0.0000 [−0.0795, 0.0795] | 0.0133 | 0.0133 | **pass** |
| GC-10 | perfect parity | four-fifths, same data | ratio 1.0000 [0.8521, 1.1735] | 0.0063 | 0.0126 | **pass** |
| GC-11 | perfect parity, small | parity ±0.10; 15/30 each | difference 0.0000 [−0.2382, 0.2382] | 0.4339 | 0.4339 | **inconclusive**; interval_straddles_band |
| GC-12 | extreme imbalance | four-fifths; majority 4,500/9,000, minority 12/40 | ratio 0.6000 [0.3736, 0.9637] | 0.2341 | 0.3954 | **inconclusive**; interval_straddles_band |
| GC-12 | extreme imbalance | parity ±0.10, same data | difference −0.2000 [−0.3197, −0.0454] | 0.1977 | 0.3954 | **inconclusive**; interval_straddles_band |
| GC-13 | zero numerator | four-fifths; A 0/40, B 10/40 | ratio 0.0000 [0.0000, 0.3579] Koopman; Fisher 0.0010 | 0.0027 | 0.0027 | **fail** |
| GC-14 | small cell | four-fifths; A 0/30, B 5/30 | ratio 0.0000 [0.0000, 0.7143] Koopman; Fisher 0.0522 | 0.0522 | 0.0522 | **inconclusive**; small_cell_exact_test_not_significant |
| GC-15 | zero denominator | parity ±0.10; A 0/50, B 0/50 | difference 0.0000 [−0.0713, 0.0713] | 0.0184 | 0.0368 | **pass** |
| GC-15 | zero denominator | four-fifths, same data | ratio undefined (0/0) | 1 | 1 | **inconclusive**; undefined_zero_denominator |
| GC-16 | empty group | parity ±0.10; A 200/400, B 196/400, declared C has no rows | difference −0.0100 [−0.0789, 0.0590] | 1 | 1 | **inconclusive**; group_suppressed_below_minimum, empty_declared_group |
| GC-17 | multiplicity (within criterion) | parity ±0.05; A 300/600, B 290/600, C 234/600 | C\|A −0.1100 [−0.1652, −0.0538], own p 0.0365 | 0.1093 | 0.1093 | **inconclusive**; within_criterion_multiplicity |
| GC-18 | multiplicity | Holm of [0.004, 0.030, 0.012, 0.200] | adjusted [0.016, 0.060, 0.036, 0.200] | | | claims at 1 and 3 |
| GC-19 | multiplicity | BH of [0.001, 0.008, 0.039, 0.041, 0.042, 0.060, 0.074, 0.205] | adjusted [0.008, 0.032, 0.0672, 0.0672, 0.0672, 0.080, 0.0846, 0.205] | | | claims at 1 and 2 |
| GC-20 | equalized odds | EO ±0.10; A TP 160, FN 40, FP 30, TN 270; B TP 100, FN 100, FP 33, TN 267 | TPR B\|A −0.3000 [−0.3847, −0.2083] | 5.4e−05 | 5.4e−05 | **fail** |
| GC-21 | performance | accuracy ≥ .9, recall ≥ .75, BA ≥ .5, F1 ≥ .75; TP 170, FP 40, FN 30, TN 760 | accuracy 0.9300 [0.9125, 0.9442]; F1 0.8293 [0.7863, 0.8651]; BA 0.9000 [0.8707, 0.9224] | 0.0016 | 0.0016 | **pass** |
| GC-22 | intersectional suppression | parity ±0.10, minimum coverage 0.95; strata F/X 200/400, F/Y 172/350, M/X 214/420, M/Y 190/380, F/Z 5/12, M/Z 8/18 | F/Y\|M/X −0.0181 [−0.0885, 0.0526]; coverage 0.9810 | 0.0224 | 0.0224 | **pass**; group_suppressed_below_minimum |
| GC-23 | intersectional suppression | parity ±0.10, coverage 1.0; F/Y 105/350, otherwise as GC-22 | F/Y\|M/X −0.2095 [−0.2754, −0.1405] | 0.0121 | 0.0121 | **fail**; group_suppressed_below_minimum, insufficient_coverage |
| GC-24 | calibration (engine) | gap ±0.10, minimum coverage 0.95; 10 bins, bin 9 has n = 20 | bin 6 −0.0100 [−0.0712, 0.0470]; coverage 0.9945 | 0.0042 | 0.0042 | **pass**; group_suppressed_below_minimum |
| GC-25 | power | equality test, 0.40 vs 0.50 | n = 388 per group (387.34) | | | |
| GC-26 | power | equality test, 0.08 vs 0.10 | n = 3,213 per group (3,212.94) | | | |
| GC-27 | power | four-fifths band, p₀ 0.5, 388 per group | pass probability 0.7491; 423 per group needed; fail MDE ratio 0.6196 | | | |
| GC-28 | power | ±0.05 band, p₀ 0.3, 500 per group | pass probability 0; 1,766 needed; fail MDE 0.1246 | | | |
| GC-29 | power | recall truly 0.80 vs ≥ 0.70, n = 50 | pass probability 0.3164; 153 needed | | | |
| GC-30 | reference group | ratio ≥ 0.8 vs A; A 200/400, B 150/400, C 190/400 | B\|A 0.7500 [0.6391, 0.8802]; C\|A 0.9500 [0.8241, 1.0952] | 0.8586 | 0.8586 | **inconclusive**; interval_straddles_band |
| GC-31 | end to end (hosted suite) | performance (accuracy ≥ .8, recall ≥ .7, BA ≥ .5); A TP 180, FP 40, FN 20, TN 360; B TP 166, FP 42, FN 34, TN 358 | recall 0.8650 [0.8280, 0.8950] | 6.0e−13 | 2.4e−12 | **pass** |
| GC-31 | | demographic parity ±0.10 | B\|A −0.0200 [−0.0740, 0.0341] | 0.0035 | 0.0106 | **pass** |
| GC-31 | | disparate impact [0.8, 1.25] | B\|A 0.9455 [0.8121, 1.1007] | 0.0313 | 0.0626 | **inconclusive**; multiplicity_adjustment |
| GC-31 | | equalized odds ±0.10 | TPR B\|A −0.0700 [−0.1375, −0.0027] | 0.3792 | 0.3792 | **inconclusive**; interval_straddles_band (run: inconclusive) |
| GC-32 | LL144 reporting | DCWP race/ethnicity example; reference White 412/797; unknown 250 | impact ratios: Hispanic 0.9672 [0.8596, 1.0884]; Black 0.8432 [0.7394, 0.9616]; NHPI 0.8453 [0.6820, 1.0478]; Asian 0.9484 [0.8540, 1.0532]; Native American 0.8493 [0.5970, 1.2081] (2% eligible); Two or more 0.8719 [0.7409, 1.0260] | | | reporting only |
| GC-33 | LL144 + four-fifths | same data, all pairs, minimum coverage 0.9 (coverage 0.9118) | worst ratio 0.8432; headline [0.5970, 1.0000] | 0.7396 | 0.7396 | **inconclusive**; interval_straddles_band |
| GC-34 | multiclass | accuracy, BA, macro F1 ≥ 0.75; 3×3 matrix, n = 800 | accuracy 0.8313 [0.8037, 0.8556]; macro recall 0.8222 [0.7925, 0.8468]; macro F1 0.8243 [0.7770, 0.8634] | 0.0009 | 0.0009 | **pass** |
| GC-35 | regression | MAE ≤ 1.2, RMSE ≤ 1.5; 40 errors | MAE 0.8825 [0.6928, 1.0722]; RMSE 1.0697 [0.8398, 1.2583] | 0.0010 | 0.0010 | **pass** |
| GC-36 | small cell (Fisher) | 6/20 vs 10/20; 0/30 vs 5/30; 0/40 vs 10/40; 2/40 vs 4,500/9,000; 1/10 vs 1/10; 3/8 vs 7/9; 0/50 vs 0/50 | p = 0.3332; 0.0522; 0.0010; 1.4e−09; 1; 0.1534; 1 | | | |
| GC-37 | all events | four-fifths and parity ±0.10; A 40/40, B 35/35 | ratio 1.0000 [0.9124, 1.1098] Koopman; difference 0.0000 [−0.0876, 0.0989] | 0.0031; 0.0486 | 0.0062; 0.0486 | **pass**; **pass** |

All categories the issue asks for are covered:
- small sample: GC-01, 08, 11;
- large sample: GC-02, 09;
- zero denominators: GC-06, 15;
- a single class: GC-07;
- perfect parity: GC-10, 11;
- extreme imbalance: GC-12;
- intersectional suppression: GC-22, 23.

The remaining cases cover zero numerators, all events, empty groups, small cells, multiplicity, power, calibration, reference mode, the hosted end-to-end suite, LL144, multiclass and regression.

### 13.3 Verification method

**1. Reference computation (stdlib only).** `docs/design/audit-statistics-verify.py` implements sections 4–10 with the Python standard library. Fisher's test uses exact integer binomials. The script asserts that every closed-form z\* equals bisection within 1e−8 and regenerates the fixture.

Commands, from the repository root:
- `python docs/design/audit-statistics-verify.py --check` recomputes everything and diffs it against the committed fixture: 0 differences across 37 cases.
- `--write` regenerates the fixture.

**2. Independent recomputation (scipy 1.17.1, statsmodels 0.15.0, numpy 2.4.6).** These ran in a throwaway virtualenv in the session's temporary directory, outside the repository. They MUST NOT be added to any requirements file.

`--cross-check` recomputes every member interval with library code:
- Wilson: `proportion_confint(method="wilson")`.
- Newcombe: `confint_proportions_2indep(compare="diff", method="newcomb")`.
- Katz: `confint_proportions_2indep(compare="ratio", method="log")` and `scipy.stats.contingency.relative_risk`.
- Koopman: `method="score", correction=False` where a group rate is below 1; otherwise a root-finder on a constrained-maximum-likelihood score statistic built from `scipy.optimize` and `scipy.stats.binom`.
- Composites (MOVER, Jaccard–Wilson, Bonferroni macro-F1, calibration gaps): rebuilt from statsmodels Wilson limits.
- Normal approximations: from `scipy.stats.norm`.

It then checks the decision p-values by recomputing each member's interval at level 1 − p and confirming that it touches the band bound (within 1e−6). It also checks:
- Fisher's p-values against `scipy.stats.fisher_exact`;
- Holm and BH against `statsmodels.stats.multitest.multipletests`;
- the equality-test sizes against `samplesize_proportions_2indep_onetail`;
- the power formulas against `scipy.stats.norm`;
- normal quantiles against `scipy.stats.norm.isf`.

Result: **310 checks, 0 problems.** The same cross-check also passes with an older, separately installed scipy 1.11.4 and statsmodels 0.14.0.

**3. Monte Carlo (`--simulate`, 20,000 replications, seed 20261105).**
- Power formulas against the actual decision rules: GC-27 0.7491 vs 0.7442 simulated; GC-28 0 vs 0; GC-29 0.3164 vs 0.3147.
- Coverage of the derived intervals:
  - F1 Jaccard–Wilson: 0.9508.
  - Balanced-accuracy MOVER: 0.9497.
  - Koopman with frequent zero counts: 0.9631.
  - Macro-F1 Bonferroni: 0.9989 (conservative).
  - Headline worst-member bounds for 3 groups: 0.9812.

  All are at or above the nominal 0.95 within Monte Carlo error.

The same throwaway runs found the statsmodels Koopman defect described in section 5.6. Reproduce everything with the commands below. Put `<temp>` outside the repository; on Windows use `Scripts\` instead of `bin/`.

```
python -m venv <temp>/stats-venv && <temp>/stats-venv/bin/pip install scipy statsmodels numpy
<temp>/stats-venv/bin/python docs/design/audit-statistics-verify.py --check --cross-check --simulate
```

## 14. Phased implementation plan

| PR | Issue | Scope | Size | Depends on | Done when |
|---|---|---|---|---|---|
| E1 | #21 | `engine/statistics.py` (stdlib only): numerics, every interval in section 5, inversion, Fisher, Holm/BH, power and MDE; `engine/tests/test_statistics_golden.py` loading the fixture (all `multiplicity`, `power`, `fisher` cases and every member of every `plan` case at core level) | M | #10 merged | all core golden values match; no new runtime dependencies |
| E2 | #21 | Decision engine in `engine/diagnostics.py`: plan derivation from `thresholds` (section 9); criteria, gates, headline, families and `decision` objects for `binary_performance`, `fairness`, `multiclass_performance`, `regression_performance`; unified floors in `validate_config`; schema minor version through `schemas/.build-run-schema.py`; regenerated fixtures; end-to-end golden tests through `run()` on expanded CSVs | L | E1 | engine end-to-end golden cases pass; existing tests and schema validators pass |
| E3 | #21 | `intersectional_slices` rebuilt on the same machinery (suppression, coverage, exploratory BH); calibration-bin criterion; Brier and ECE/R² descriptive bootstrap; cluster-bootstrap decisions (section 5.11); `python -m engine.assurance power` | M | E2 | GC-22, 23, 24 pass end to end; cluster determinism test |
| H1 | #22 | `site-app/lib/statistics.ts`: port of E1 (AS241, `erfc`, Koopman bisection, Fisher in log space); Vitest suite over the fixture at core level for every case with `"hosted"` in `runners` | M | E1 (fixture is already final) | Vitest golden suite green in CI |
| H2 | #22 | `diagnostics.ts` and `evaluation.ts`: legacy plan derivation, floors in `configSchema`, results with intervals, p-values and `decision`; the "No confidence intervals" text removed; end-to-end Vitest over `endToEnd.hosted` cases; `ml-evaluation-check` updated | L | H1, #15 | cross-runner agreement in CI; schema validators pass |
| H3 | #22 | Plan step in `testing-lab.tsx`: bands, role, mode, reference group, coverage, confidence level; threshold library data file; power/MDE panel with acknowledgement; frozen plan hash in the manifest; plain-language reason messages | M | H2 | changing an approved plan creates a new profile version (test) |
| L1 | #30 | LL144 computations (section 10.2), scoring-rate path, publishable summary | M | H2, #27 | GC-32 and new scoring-rate cases match |

E1 and H1 can proceed in parallel once this design merges, because the fixture is final. H1 only needs E1 when the two disagree. Each PR adds its tests with the code, and nothing here changes runner code before #21 and #22.

## 15. Open questions (each has a default, so implementation is not blocked)

| # | Question | Default in this specification |
|---|---|---|
| Q1 | Ratios: keep Katz-log with the Koopman fallback (as here), or use Koopman everywhere as Fagerland et al. recommend? | Katz-log with the Koopman fallback. Katz is conservative, which errs safe for audits, and it is what the issue asked for. Switching is a local change in `ratio_method` plus regeneration of the cases that use Katz-log (GC-08, 09, 10, 12, 30, 31, 32, 33). |
| Q2 | Default `minimumCoverage` of 1.0 makes any unknown or suppressed group block a pass. Should LL144-style plans default to 0.95? | 1.0. A pass that covers part of the population must be a deliberate pre-registered choice with a rationale. |
| Q3 | Fail claims use two-sided-equivalent p-values, so each one-sided error is at most 2.5% at 95%. Offer 90% intervals for a 5% one-sided error? | Allowed through `confidenceLevel: 0.90`. The default stays 0.95. |
| Q4 | LL144 scoring rate: is the median taken over all scored applicants or only those with a known category? Unknown-category individuals are "not included in the required calculations", and the median is one of them. | Known-category sample. #30 should confirm with counsel and record the choice in the pack. |
| Q5 | The EEOC's UGESP rescission is reported but its text is unpublished (verified only through a secondary source). Does the four-fifths entry need a jurisdiction note update in January 2027? | Keep it as a configurable screen. Its caveat text already refuses legal weight. |
| Q6 | Drift (PSI, KS, Wasserstein) is out of scope. Should drift tests stop contributing to the run outcome until they have intervals? | #21 leaves drift computation unchanged, excludes drift results from the families, and adds the limitation "point-estimate screening; not interval-based". A follow-up issue should specify drift. |
| Q7 | Macro F1 uses a conservative Bonferroni interval (coverage 0.999). Should a delta-method interval be specified ([Takahashi et al. 2022](https://doi.org/10.1007/s10489-021-02635-5))? | Keep the conservative interval for 1.0.0, and take this up as a follow-up. |
| Q8 | Boschloo, BCa and beta-binomial shrinkage for small strata were not adopted. | Possible engine-only additions after 1.0.0. They would be reported, never deciding, until specified. |

## 16. Sources

Regulation and guidance:
- EU AI Act: [Art. 9](https://artificialintelligenceact.eu/article/9/), [Art. 10](https://artificialintelligenceact.eu/article/10/), [Art. 15](https://artificialintelligenceact.eu/article/15/), [Annex IV](https://artificialintelligenceact.eu/annex/4/). The application dates of 2 December 2027 and 2 August 2028 shown on the Art. 9 page reflect the Digital Omnibus.
- US: [29 CFR 1607.4](https://www.law.cornell.edu/cfr/text/29/1607.4).
- US UGESP rescission status: [DirectEmployers, 23 October 2026](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/) (secondary) and [SHRM](https://www.shrm.org/mena/topics-tools/employment-law-compliance/eeoc-moves-to-roll-back-longstanding-hiring-guidelines).
- NYC: [DCWP Notice of Adoption, Local Law 144 rules (6 RCNY §§ 5-300–5-304)](https://www.sidley.com/-/media/resource-pages/ai-monitor/laws-and-regulations/20230406-nyc-dcwp-notice-of-adoption-of-final-rule-for-local-law-144.pdf?la=en) and the [NYC rules page](https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/), effective 5 July 2023. No later amendment was found; not re-verified beyond these pages.

Statistics:
- [Wilson 1927](https://doi.org/10.1080/01621459.1927.10502953); [Brown, Cai & DasGupta 2001](https://doi.org/10.1214/ss/1009213286); [Newcombe 1998](https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C873::AID-SIM779%3E3.0.CO;2-I).
- [Katz, Baptista, Azen & Pike 1978](https://doi.org/10.2307/2530610); [Koopman 1984](https://doi.org/10.2307/2531405); [Miettinen & Nurminen 1985](https://doi.org/10.1002/sim.4780040211).
- [Fagerland, Lydersen & Laake 2015](https://doi.org/10.1177/0962280211415469) (quotations from sections 6.2–6.3 and 8 of the [preprint](https://www.ms.uky.edu/~mai/sta635/FagerlandLydersenLaake2011---RecommendedCIsForTwoIndependent....pdf)).
- [Zou & Donner 2008](https://doi.org/10.1002/sim.3095) (MOVER); [Berger 1982](https://doi.org/10.2307/1267823) (intersection–union tests); [Schuirmann 1987](https://doi.org/10.1007/BF01068419) (TOST).
- [Holm 1979](https://www.jstor.org/stable/4615733); [Benjamini & Hochberg 1995](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x); [Wichura 1988, AS241](https://doi.org/10.2307/2347330); [Takahashi, Yamamoto, Kuchiba & Koyama 2022](https://doi.org/10.1007/s10489-021-02635-5) (macro-F1 intervals, follow-up Q7).
- Fleiss, Levin & Paik, *Statistical Methods for Rates and Proportions*, 3rd ed., Wiley 2003, for the sample-size formula. The formula was verified numerically against statsmodels, not against the book.

Software:
- [scipy `fisher_exact`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html), [R `fisher.test`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/fisher.test.html), [statsmodels `confint_proportions_2indep`](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.confint_proportions_2indep.html).

Unverified or secondary items are marked where they are used: the CEN-CENELEC drafting status, the EEOC rule scope, and the LL144 median sample (Q4).

## Appendix A. Derivations

**A.1 F1 interval.**
1. Let the N rows fall into the cells (TP, FP, FN, TN) with probabilities π. Conditional on M = TP + FP + FN, the counts (TP, FP, FN) are multinomial with probabilities renormalised over those three cells. So TP | M ~ Bin(M, J), with J = π_TP/(π_TP + π_FP + π_FN).
2. Population F1 = 2π_TP/(2π_TP + π_FP + π_FN) = 2J/(1 + J), which increases in J.
3. A (1 − α) Wilson interval [l, u] for J, mapped to [2l/(1 + l), 2u/(1 + u)], therefore has the same conditional coverage.
4. Because the Wilson interval is the inversion of the score test, the decision rule is the score test of J against b/(2 − b).

**A.2 Criterion combination.**
- Pass claims "θ_i ∈ band for all i". If any θ_j is outside the band, the probability that P_pass = max_i p_i ≤ u is at most P(p_j ≤ u) ≤ u. So max is a valid p-value with no adjustment (intersection–union).
- Fail claims "θ_i ∉ band for some i". If all θ_i are inside the band, P(m·min p_i ≤ u) ≤ Σ P(p_i ≤ u/m) ≤ u (Bonferroni).
- Each criterion's truth admits only one wrong claim. Holm across criteria then controls the family-wise probability of any wrong claim.

**A.3 Headline bounds.**
- Let W = max_i |θ_i| be attained at a fixed i\*. Then P(W > max_i U_i) ≤ P(|θ_i\*| > U_i\*) ≤ α/2. The pass side needs no adjustment.
- P(W < max_i L_i) ≤ P(some i has |θ_i| < L_i) ≤ m·α/(2m) = α/2 at level α/m. The fail side uses Bonferroni.
- Together, coverage is ≥ 1 − α. The same argument holds on the |ln r| scale and for one-sided bands.
