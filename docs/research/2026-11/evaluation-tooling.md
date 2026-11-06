> **Research record: Technical model evaluation and testing.** Kept as written on 5 November 2026. Only this note was added and line endings were normalised to LF; everything below the rule is the original. The current plan is [ROADMAP.md](../../../ROADMAP.md) and the distilled direction is [docs/product/direction.md](../../product/direction.md); where they differ from this record, they win. See the [folder index](README.md) for how the research was done.
>
> - **Date:** status as of 5 November 2026; not updated since.
> - **Method:** desk research of the AI Act text, NIST publications, research papers, tool documentation and repositories, in the same planning session. The worked statistics in §2 were computed for the brief, and "Where the code stands today" was checked against the repository at `74c6463`.
> - **Verification limits:** as the note under Sources says, the shared search budget ran out near the end; items marked "unverified" or "not re-checked" rely on prior knowledge or secondary trackers, and the LL144 definitions come from search extracts of the city's rule. **Out of date:** §1 says no AI Act standard is cited in the Official Journal (CEN-CENELEC status of 27 May 2026). EN 18286:2026 was cited in October 2026 (synthesis §2.5).
> - **Links (checked 5 November 2026):** 70 distinct links: 68 returned a page, 2 refused automated requests, none returned 404. A page that loads was not re-read for the claim it supports.
> - **Local paths:** `C:\Users\Ahedj\Documents\dev\AI Assurance\` is the repository root at commit `74c6463`, so read those paths as repository-relative (for example `site-app/lib/diagnostics.ts`). Line numbers predate the Prettier reformat in [#1](https://github.com/ahed-jneed/ai-assurance/issues/1).

---

# Technical model evaluation and testing for an auditor-focused AI assurance platform (status: 5 November 2026)

## Bottom line

- No EU AI Act provision or harmonised standard sets a "good enough" number for accuracy, bias or robustness. The Act does require thresholds fixed in advance, accuracy per group, and "test logs and all test reports dated and signed by the responsible persons" (Annex IV 2(g)). An auditor platform competes on **statistical defensibility and evidence integrity**, not on how many metrics it offers.
- A frequent technical flaw in bias audits is a point estimate reported without its uncertainty. On realistic sample sizes, an impact ratio of 0.60 can be noise, while 0.90 can be a highly significant disparity.
- Mature open-source harnesses already cover GenAI testing: Inspect, promptfoo, garak, PyRIT, lm-evaluation-harness, DeepEval and Ragas. The platform should **ingest their per-item outputs, recompute the statistics and attest the result**, not build its own runners.

## 1. Regulatory and standards anchor

**AI Act requirements that shape test design.**
- **Art. 9(8):** testing "against prior defined metrics and probabilistic thresholds".
- **Art. 10(2)(f)–(g) and 10(3):** examine data for bias, take measures to "detect, prevent and mitigate" it, and use data with "appropriate statistical properties" for the groups concerned.
- **Art. 15:**
  - 15(3): accuracy metrics must be "declared in the accompanying instructions of use".
  - 15(4): bias from feedback loops.
  - 15(5): poisoning, adversarial examples and model evasion, confidentiality attacks and model flaws.
- **Annex IV 2(g) and IV 3:** metrics on "potentially discriminatory impacts", and "the degrees of accuracy for specific persons or groups of persons".

**The Digital Omnibus.** Regulation (EU) 2026/1744 entered into force on 27 July 2026.
- **New dates:** Annex III high-risk duties apply from **2 December 2027**. Annex I duties apply from **2 August 2028**.
- **Unchanged:** Art. 50 transparency kept its 2 August 2026 date. Generative systems already on the market have until 2 December 2026 to meet Art. 50(2).
- **Bias data:** the new **Art. 4a** replaces Art. 10(5). It allows special-category personal data to be processed "to the extent strictly necessary to ensure bias detection and correction". Three conditions apply:
  - synthetic or anonymised data would not work;
  - the data is deleted afterwards;
  - the need is documented.

  Bias tests that use such data now need that paper trail.

**Standards give no numeric safe harbour yet.** CEN-CENELEC's 27 May 2026 update gave this status:
- prEN 18283 (bias): working draft.
- prEN 18286 (quality management): at formal vote.
- prEN 18228 (risk management): in public enquiry.

Secondary trackers put the accuracy and robustness parts of prEN 18229 at an earlier stage still (unverified). None of these is cited in the Official Journal, so none gives a presumption of conformity. Interim method references are ISO/IEC TS 12791:2024, TR 24027, TS 4213, and the 24029 and 5259 series (not re-checked).

**NIST/CAISI.**
- AI 800-2 (draft, 30 January 2026) sets practices for automated benchmark testing of LLMs and agents.
- AI 800-3 (19 February 2026) separates accuracy on the fixed benchmark from "generalized accuracy" on the wider population of questions. It asks evaluators to state their statistical model and suggests generalized linear mixed models.
- AI 100-2 E2025 is the taxonomy of adversarial machine-learning attacks. AI 600-1 is the GenAI risk profile.

**US: the four-fifths rule is losing federal force.**
- On 9 June 2026, DOJ's Office of Legal Counsel called the EEOC's disparate-impact guidelines unconstitutional.
- On 16 October 2026, the EEOC sent OIRA a final rule rescinding the interpretive parts of the Uniform Guidelines on Employee Selection Procedures (UGESP). That likely includes the 4/5 rule. The rule is projected to take effect in January 2027.
- Title VII disparate-impact liability, state law and NYC Local Law 144 (LL144) remain in force.
- Colorado's SB 26-189 (effective 1 January 2027) replaced SB 24-205 with a notice-only regime.
- The Guidelines themselves warn that large differences "based on small numbers" may not be significant.

## 2. Fairness metrics and their statistical pitfalls

| Metric | Definition (decision Ŷ, outcome Y, group g) | Note |
|---|---|---|
| Selection rate (SR) | SR_g = (TP_g+FP_g)/n_g | |
| Demographic parity difference / ratio | max SR − min SR; min SR / max SR | Fairlearn naming |
| Impact ratio (NYC LL144) | SR_g / SR of most-selected category; or scoring rate (share above the sample median) / highest category's | categories under 2% may be excluded with justification; counts still reported |
| Four-fifths screen | impact ratio < 0.8 | heuristic, not a legal test |
| Equalized odds | TPR_g = TP/(TP+FN); FPR_g = FP/(FP+TN); EOD = max(TPR range, FPR range) | denominators are positives or negatives only |
| Predictive parity | PPV_g = TP/(TP+FP) | |
| Calibration within groups | P(Y=1 \| S=s, g) = s; ECE_g = Σ_b (n_bg/n_g)·\|ȳ_bg − s̄_bg\| | for systems that output scores |

**The criteria conflict.** When groups have different base rates, calibration within groups and equal error rates cannot all hold at once (Kleinberg et al.; Chouldechova; Pleiss et al.). The auditor must choose a criterion for the use case and record why, rather than face a wall of pass/fail tiles.

**Sample size dominates.** I computed these examples for this brief:
- **Small sample:** 6/20 vs 10/20 selected gives an impact ratio (IR) of 0.60, which "fails" 4/5. Yet Fisher's exact p = 0.33 and the 95% CI is 0.27–1.34.
- **Large sample:** 22,500/50,000 vs 25,000/50,000 gives IR 0.90, which "passes". Yet z = −15.8 (p ≈ 2×10⁻⁵⁶; CI 0.888–0.912).
- **Power:** detecting 40% vs 50% selection with 80% power needs about 388 per group. Detecting 8% vs 10% needs about 3,213.
- **Error rates:** a true positive rate (TPR) of 0.80 measured on 50 positives has a Wilson interval of 0.67–0.89.

**Other pitfalls.**
- The max-minus-min range overstates disparity when there are many small groups.
- Every extra group, metric and slice adds false alarms.
- Aggregate parity can hide subgroup disparity ("fairness gerrymandering", Kearns et al.; Gender Shades).
- Results depend on the reference group and the decision threshold.
- Labels may be biased, and repeated records break independence.
- As Fairlearn notes, "overlapping confidence intervals do not imply statistical equality".

**Safeguards to build in.**
- **Intervals:** Wilson for rates, Newcombe for differences, Katz-log or BCa bootstrap for ratios.
- **Small cells:** Fisher or Boschloo exact tests when a cell is under 5. Cluster-robust intervals for repeated individuals.
- **Multiple comparisons:** Holm correction for confirmatory tests, Benjamini–Hochberg (BH) for exploratory ones.
- **Pre-registration:** fix the primary metric, reference group and materiality band before testing.
- **Three outcomes:**
  - **fail** if the interval lies wholly beyond the threshold;
  - **pass** only if it lies wholly inside the materiality band (for example, the lower bound of IR is at least 0.8);
  - otherwise **inconclusive**.
- **Small subgroups:** beta-binomial shrinkage, plus a power calculator at the planning stage.

## 3. Robustness and stress testing

Robustness tests for predictive models, mapped to Art. 15(5) and NIST AI 100-2:
- noise and missing-value injection;
- out-of-range and boundary inputs;
- per-slice performance under distribution shift;
- CheckList-style invariance tests;
- the counterfactual flip rate: the share of decisions that change when the protected attribute or a proxy is flipped;
- adversarial evasion and poisoning (IBM ART).

Report each loss of performance with paired intervals (McNemar's test for paired binary outcomes). These tests need model access, so natively they run only on models the engine can load.

## 4. Explainability

SHAP and LIME show whether a model relies on protected attributes or their proxies, but they are weak audit evidence:
- A biased model can be wrapped so both show harmless explanations (Slack et al.).
- Different methods often disagree (Krishna et al.).
- Shapley importance misleads when features are correlated (Kumar et al.).

Use them as supporting evidence only. Record the explainer, a hash of the background data and the random seed, and check stability across bootstrap resamples.

## 5. Data quality and drift

The data checks for Art. 10(3) are completeness, label quality, duplicates, train/test leakage, and how well each group is represented (see ISO/IEC 5259).

Drift measures are PSI = Σ (c_i − r_i)·ln(c_i/r_i), Kolmogorov–Smirnov (KS), chi-squared, Wasserstein and Jensen–Shannon. PSI cut-offs of 0.1/0.25 are an industry convention, not a standard.

Evidently's defaults show the sample-size trap. Up to 1,000 reference rows it uses p-value tests at p ≤ 0.05. Above that it switches to distance metrics with a 0.1 threshold, because in large samples almost every difference is "significant". Use effect sizes, correct for multiple comparisons, and fix bins on the reference data.

## 6. LLM and generative-AI evaluation

| Dimension | Core metric | Typical tools |
|---|---|---|
| Accuracy / hallucination | accuracy ± SE; RAG faithfulness = supported claims / total claims; abstention rate | lm-eval-harness, Inspect Evals, Ragas, DeepEval |
| Toxicity, bias, safety | violation rate per hazard (AILuminate Safety v1.2.1, 12 hazards); BBQ-style bias | AILuminate, Moonshot, DeepEval |
| Jailbreak / prompt injection | attack success rate (ASR) = successful / attempted attacks, per technique (AILuminate Jailbreak v1.1) | garak, PyRIT, promptfoo |
| RAG | faithfulness, context precision/recall, response relevancy | Ragas, DeepEval, Evidently |
| Agents | task success; pass^k = C(c,k)/C(n,k) averaged over tasks (τ-bench); utility under attack and targeted ASR (AgentDojo); tool-call accuracy | Inspect (sandboxed), DeepEval, Ragas |

Map risks to the OWASP Top 10 for LLM Applications (2026 edition) and the OWASP Top 10 for Agentic Applications (December 2025).

**Safeguards for LLM results.**
- **Uncertainty:** report standard errors (SEs) and n. Cluster the SEs when items share a passage.
- **Comparisons:** compare models on paired, per-item differences, and plan for power (Miller).
- **Scope of claims:** state whether a claim covers the benchmark itself or generalized accuracy (NIST AI 800-3).
- **LLM judges:** judges favour certain answer positions, longer answers and their own outputs (Zheng et al.). Validate them against human labels (Cohen's κ), swap answer positions, and use a judge from a different model family.
- **Non-determinism:** outputs vary even at temperature 0, because batch size changes with server load (Thinking Machines). Pin model snapshots, record decoding parameters and run several epochs.
- **Protocol and limits:** prompts, tools and budgets change results, and models may notice they are being evaluated (NIST AI 800-2). A low ASR holds only for that attack set and judge; it never proves safety.

## 7. Open-source tools (status checked November 2026)

| Tool | Focus | Licence / status | Stance |
|---|---|---|---|
| Fairlearn | group metrics, MetricFrame bootstrap CIs | MIT; v0.15.0, 12 Oct 2026 | reference; ingest exports |
| AIF360 | metric and mitigation catalogue | last release v0.6.1 (Apr 2024) | reference only |
| Aequitas | bias audit, Aequitas Flow | MIT; v1.0 | reference / ingest |
| Giskard | v3 rewrite focused on LLM agents | v2 tabular scan appears legacy (unverified) | ingest |
| Evidently | 100+ metrics: drift, data quality, LLM evals | Apache-2.0 | ingest monitoring snapshots |
| deepchecks | tabular, NLP and vision checks | **AGPL-3.0** core | ingest only; do not embed |
| DeepEval | RAG, agent and safety metrics | Apache-2.0 | ingest |
| promptfoo | evals and red teaming | MIT; OpenAI announced its acquisition 9 Mar 2026, still open source | ingest; note ownership |
| Inspect (UK AISI, Meridian Labs) | 200+ evals, sandboxed agents, .eval logs | open source | primary ingest format; external-worker runner |
| garak (NVIDIA) | LLM vulnerability scanner | Apache-2.0 | ingest JSONL report and hit log |
| PyRIT (Microsoft) | red-team orchestration | open source; powers the Foundry AI Red Teaming Agent | ingest |
| HELM (Stanford CRFM) | holistic benchmarks | Apache-2.0; maintenance mode since 1 Jun 2026 | reference only |
| lm-evaluation-harness | 60+ academic benchmarks | MIT; `--log_samples` | ingest |
| OpenAI evals | eval registry | MIT; README points to hosted Evals | low priority |
| Ragas | RAG and agent metrics | open source | ingest |

## 8. Documentation artefacts

Relevant formats:
- model cards (Mitchell et al.);
- datasheets (Gebru et al.), which Annex IV 2(d) names directly;
- Hugging Face and vendor system cards;
- Croissant dataset metadata (spec 1.1);
- the transparency chapter of the GPAI Code of Practice (10 July 2025).

For machine-readable exchange, the CycloneDX 1.6 `modelCard` holds `performanceMetrics` with `slice` and `confidenceInterval`, and `fairnessAssessments` with `groupAtRisk` and `mitigationStrategy`. SPDX 3.0 adds AI and Dataset profiles. Treat all cards as claims to test, not as evidence.

## 9. Reproducibility and evidence integrity

A run is reproducible only if it records:
- hashes of the data, predictions and model;
- tool versions and container digest;
- configuration, seeds and decoding parameters;
- model snapshot and system-prompt hash;
- the judge model;
- timestamps.

Building blocks for integrity:
- the in-toto Test Result predicate (`https://in-toto.io/attestation/test-result/v0.1`), which records tested artefacts, configuration and a PASSED/WARNED/FAILED result;
- SLSA provenance (v1.2);
- Sigstore bundles with transparency-log inclusion;
- RFC 3161 timestamps;
- OpenSSF Model Signing (v1.0, April 2025), a detached signature over a manifest of file hashes.

C2PA (spec 2.3, January 2026) matters mainly for testing the content marking required by Art. 50.

Inspect logs can be edited after a run, and the edits are recorded in `log_updates`. Rescoring a log, or opening it with `trust_log=True`, executes code the log names. Hash each log on ingest and never execute ingested code.

## Implications for our platform

**Where the code stands today (checked):**
- `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\diagnostics.py` puts Wilson intervals on per-group rates, with minimums of 30 per group and 10 per class. The headline demographic parity, disparate impact and equalized odds figures are bare point estimates. `evaluate()` compares that point estimate directly with the frozen threshold.
- `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\assurance.py` already offers `intersectional_slices`: up to five protected fields, with a seeded IID or cluster percentile bootstrap. But one stratum under 30 makes the whole result inconclusive, there is no multiplicity control, and the intervals do not drive pass/fail.
- `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\lib\diagnostics.ts` (the hosted runner) states "No confidence intervals are estimated". It defaults to minimums of 20 rows and 5 per class.
- The fieldwork template (`C:\Users\Ahedj\Documents\dev\AI Assurance\templates\article-fieldwork.md`) asks for approval of metrics, reference group, threshold, minimums and uncertainty policy before the run. Nothing checks statistical power.
- Nothing evaluates LLMs.
- Dossiers are Ed25519-signed with a key held on the server. Runs have no standard attestation, external timestamp or transparency log.

**P0: make current conclusions defensible**
1. **One statistics core for both runners.** Move the existing bootstrap and cluster machinery into the decision path. Add analytic intervals (Newcombe, Katz), exact tests for small cells and Holm/BH correction. Decide pass, fail or inconclusive from the interval against the materiality band. Use golden-file tests to keep the TypeScript and Python runners in agreement. *Why:* a bare point estimate can reverse the conclusion, and Art. 9(8) requires thresholds set in advance.
2. **Power check and threshold library in the frozen policy.** Add a minimum-detectable-effect check to the approved plan. Add a threshold library tagged by jurisdiction:
   - 4/5 as a screening heuristic;
   - LL144 ratios on selection and scoring rate, with the 2% exclusion;
   - internal AI Act policies labelled "no legal safe harbour".

   *Why:* underpowered tests produce false "passes". As the 4/5 rule loses force, it should be a setting, not a hard-coded verdict.
3. **Better intersectional analysis and calibration within groups.** Suppress small strata one at a time instead of voiding the whole result. Report coverage, meaning the share of the population in cells large enough to evaluate. Add worst-group metrics with shrinkage and per-group ECE with intervals. Bring the same analysis to the hosted runner. *Why:* Annex IV 3 requires accuracy per group, and aggregate parity can hide subgroup disparity.
4. **A signed attestation for every native run.** Emit an in-toto statement over the run's input hashes, signed in a Sigstore-compatible bundle, timestamped under RFC 3161 and chained into the audit events. Verify OpenSSF Model Signing signatures on supplied models. *Why:* Annex IV 2(g) requires reports "dated and signed", and others can then verify evidence without trusting our database.
5. **An Art. 4a record for special-category data.** Record why the data was needed, why synthetic or anonymised data would not do, who accessed it, and when it was deleted. *Why:* this is a new condition since the Omnibus, and it is cheap to build.

**P1: GenAI and external evidence**

6. **Evidence adapters with strength levels.** Write parsers for outputs from Inspect `.eval`, lm-evaluation-harness, promptfoo, garak, PyRIT, DeepEval/Ragas, Evidently and Fairlearn, all feeding one shared schema. Recompute SEs and ASR intervals from the per-item records, then grade the evidence:
   - L0: aggregate reported by the vendor;
   - L1: hashed tool log;
   - L2: recomputed by us from per-item data;
   - L3: re-run by the auditor, with an attestation.

   Never execute ingested code, and never embed AGPL tools. *Why:* auditors need independence and the ability to re-run tests, not another harness.
7. **A GenAI audit programme, with the method before any runner.**
   - Working papers mapped to the OWASP LLM and Agentic Top 10 lists, NIST AI 600-1, and Art. 15 and 50.
   - A required-metadata checklist: model snapshot, system-prompt hash, decoding parameters, attack-set version, judge model and its κ, epochs, n.
   - Readiness gates that block GenAI conclusions lacking SEs or a validated judge.
   - Re-runs of Inspect, garak or promptfoo through the existing external worker protocol, since Cloudflare Workers suit neither long nor sandboxed runs.

   *Why:* this is the largest product gap, and the Art. 50 and GPAI obligations already apply.
8. **Robustness and explanation tests on models the adapters can load (ONNX, PMML, XGBoost, LightGBM).** Cover perturbation, the counterfactual flip rate and monotonicity, plus TreeSHAP and permutation importance with bootstrap stability. *Why:* these address Art. 15(4)–(5), and the adapters already exist.

**P2: breadth and positioning**

9. Ingest monitoring outputs (for example from Evidently) as post-market evidence instead of building continuous monitoring.
10. Export CycloneDX `modelCard` files. Ingest Hugging Face cards and Croissant metadata, mapped to Annex IV.
11. **Position the product as a tool-neutral, independent verification layer.** Key testing tools are owned by vendors: promptfoo by OpenAI, PyRIT by Microsoft, garak by NVIDIA. Judge models should also come from a different family than the system under test. On timing, Annex III obligations start on 2 December 2027, about 13 months away, and GenAI transparency work is due now.

**Native vs ingest:**

| Approach | Capabilities |
|---|---|
| Native | tabular performance and fairness with proper inference; intersectional and calibration analysis; point-in-time drift; robustness and explanations for loadable models; recomputation from ingested per-item data; attestations |
| Ingest | LLM benchmarks; red teaming; RAG and agent evaluations; continuous monitoring; model and dataset cards; client SHAP/LIME output |
| Reference only | AIF360, HELM, OpenAI evals |

### Sources

The shared web-search budget ran out near the end of the research. Items marked "unverified" or "not re-checked" rely on prior knowledge or secondary trackers. The LL144 definitions come from search extracts of the city's rule.

**Regulation and policy**
- [AI Act Explorer: Digital Omnibus](https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/)
- AI Act: [Art. 9](https://artificialintelligenceact.eu/article/9/), [Art. 10](https://artificialintelligenceact.eu/article/10/), [Art. 15](https://artificialintelligenceact.eu/article/15/), [Annex IV](https://artificialintelligenceact.eu/annex/4/)
- [CEN-CENELEC, 27 May 2026](https://www.cencenelec.eu/news-events/news/2026/newsletter/ots-73-etuc/); [JTC 21 tracker (secondary)](https://kla.digital/blog/jtc-21-standards-tracker)
- [GPAI Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai)
- NIST: [AI 800-2](https://www.nist.gov/node/1905466), [CDT comments on AI 800-2](https://cdt.org/insights/cdt-submits-comments-on-nists-draft-guidance-for-automated-benchmark-evaluations-of-language-models/), [AI 800-3](https://www.nist.gov/node/1906641), [AI 100-2 E2025](https://csrc.nist.gov/pubs/ai/100/2/e2025/final), [AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
- US employment: [DOJ OLC](https://www.justice.gov/opa/pr/justice-department-concludes-eeoc-disparate-impact-guidelines-violate-constitution), [UGESP rescission](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/), [29 CFR 1607.4](https://www.law.cornell.edu/cfr/text/29/1607.4)
- US state and local: [NYC LL144 rule](https://www.sidley.com/-/media/resource-pages/ai-monitor/laws-and-regulations/20230406-nyc-dcwp-notice-of-adoption-of-final-rule-for-local-law-144.pdf?la=en), [Colorado SB 26-189](https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/)

**Fairness and statistics**
- Fairlearn: [confidence intervals](https://fairlearn.org/main/user_guide/assessment/confidence_interval_estimation.html), [PyPI](https://pypi.org/project/fairlearn/)
- [Kleinberg et al.](https://arxiv.org/abs/1609.05807); [Chouldechova](https://arxiv.org/abs/1610.07524); [Pleiss et al.](https://arxiv.org/abs/1709.02012); [Hardt et al.](https://arxiv.org/abs/1610.02413)
- [Kearns et al.](https://arxiv.org/abs/1711.05144); [Gender Shades](https://proceedings.mlr.press/v81/buolamwini18a.html); [Miller](https://arxiv.org/abs/2411.00640)

**Robustness, explainability and drift**
- [IBM ART](https://github.com/Trusted-AI/adversarial-robustness-toolbox); [CheckList](https://arxiv.org/abs/2005.04118)
- [Slack et al.](https://arxiv.org/abs/1911.02508); [Krishna et al.](https://arxiv.org/abs/2202.01602); [Kumar et al.](https://arxiv.org/abs/2002.11097)
- Evidently: [drift method docs](https://docs.evidentlyai.com/metrics/explainer_drift), [repository](https://github.com/evidentlyai/evidently)

**LLM and agent evaluation**
- Ragas: [metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/), [faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/)
- [Zheng et al.](https://arxiv.org/abs/2306.05685); [Thinking Machines](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)
- [τ-bench](https://arxiv.org/abs/2406.12045); [AgentDojo](https://arxiv.org/abs/2406.13352); [BBQ](https://arxiv.org/abs/2110.08193); [AILuminate](https://mlcommons.org/ailuminate/)
- OWASP: [Agentic Top 10](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/), [LLM Top 10 2026](https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/)
- Microsoft: [AI Red Teaming Agent](https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/ai-red-teaming-agent), [PyRIT](https://microsoft.github.io/PyRIT/)

**Tools**
- [AIF360 releases](https://github.com/Trusted-AI/AIF360/releases); [Aequitas](https://github.com/dssg/aequitas); [Giskard v3](https://github.com/Giskard-AI/giskard-oss/releases/tag/v3.0.0); [deepchecks](https://github.com/deepchecks/deepchecks); [DeepEval](https://github.com/confident-ai/deepeval)
- promptfoo: [OpenAI announcement](https://openai.com/index/openai-to-acquire-promptfoo/), [Promptfoo announcement](https://www.promptfoo.dev/blog/promptfoo-joining-openai/)
- Inspect: [home](https://inspect.aisi.org.uk/), [eval logs](https://inspect.aisi.org.uk/eval-logs.html)
- [garak](https://github.com/NVIDIA/garak); [HELM](https://github.com/stanford-crfm/helm); [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness); [OpenAI evals](https://github.com/openai/evals); [Moonshot](https://github.com/aiverify-foundation/moonshot)

**Documentation and integrity**
- [Model cards](https://arxiv.org/abs/1810.03993); [Datasheets](https://arxiv.org/abs/1803.09010); [Croissant](https://github.com/mlcommons/croissant)
- [CycloneDX 1.6 schema](https://raw.githubusercontent.com/CycloneDX/specification/master/schema/bom-1.6.schema.json); [in-toto Test Result predicate](https://github.com/in-toto/attestation/blob/main/spec/predicates/test-result.md)
- [SLSA v1.2](https://slsa.dev/blog/2025/11/announce-slsa-v1.2); [OpenSSF Model Signing](https://openssf.org/blog/2025/06/25/an-introduction-to-the-openssf-model-signing-oms-specification/)
- [C2PA 2.3](https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf); [Sigstore bundle](https://docs.sigstore.dev/about/bundle/); [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161)
