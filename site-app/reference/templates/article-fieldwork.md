# Article fieldwork programs

Instantiate the catalog id selected for the engagement and complete every field in `working-paper.md`. Tailor these procedures to the approved system boundary and operator role. Where a provision is not yet applicable, label the result as readiness. Each conclusion requires sufficient reviewed evidence, with an explicit result for each selected procedure.

## WP-A09-01 — Risk management system

Objective: assess whether risks for the intended purpose, reasonably foreseeable misuse and lifecycle are identified, treated and kept under review. Regulatory anchor: [Article 9](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-9).

Evidence: {{risk_policy_and_register}}, {{design_reviews}}, {{harm_and_misuse_analysis}}, {{test_plan}}, {{residual_risk_approval}}, {{monitoring_feedback}}.

Procedures:

1. Walk through an actual risk from identification through treatment, test, residual acceptance and ongoing monitoring. Record owners, dates and system versions.
2. Challenge the completeness of harm scenarios, vulnerable groups, misuse, interacting controls, feedback effects and downstream decisions with specialists where needed.
3. Inspect treatment rationale and evidence that the selected control operated. Distinguish design changes, mitigations and deployer instructions.
4. Reconcile key risks to approved tests with predefined metrics and thresholds. Investigate missing or stale tests.
5. Sample risk changes following incidents, complaints, drift or release changes; confirm reassessment and escalation.

Risk-to-control-to-test traceability: {{matrix}}. Residual acceptability basis and accountable approval: {{basis}}. Auditor challenge and conclusion: {{evaluation}}.

## WP-A10-01 — Data governance, quality and representation

Objective: assess the data lifecycle and suitability for the specific intended population/use. Regulatory anchor: [Article 10](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-10).

Evidence: {{dataset_datasheets}}, {{source_contracts}}, {{collection_and_original_purpose}}, {{lineage}}, {{label_protocol}}, {{splits}}, {{quality_profiles}}, {{target_population_definition}}, {{privacy_approval}}.

Procedures:

1. Trace sampled records and derived features to source, transformations, labels and versioned train/validation/test manifests.
2. Assess missingness, duplicates, impossible ranges, label disagreement, leakage, related-record contamination and target availability at decision time.
3. Compare coverage by relevant geography, context, language, time and affected groups with the intended population. Examine exclusions and sampling effects.
4. Challenge construct/label validity and proxy features; assess whether historical outcomes encode biased practices.
5. Inspect gaps, correction plans, monitoring, feedback-loop controls and ownership. Evaluate current Article 4a/privacy conditions separately before sensitive-category processing.

Missing/gap register and effect: {{gaps}}. Quality/representation diagnostic run ids: {{runs}}. Manual relevance assessment: {{assessment}}.

## WP-A10-02 — Fairness and potential discriminatory impacts

Evidence: {{approved_attribute_basis}}, {{favorable_outcome}}, {{reference_group_rationale}}, {{cohort_manifest}}, {{ground_truth}}, {{run_manifest}}, {{domain_context}}, {{mitigation_retest}}.

Procedures:

1. Approve task-appropriate fairness metrics, reference choice, threshold, cohort minimums, intersectional analysis and uncertainty policy before the run.
2. Reconcile predictions, labels, weights and groups. Inspect missing protected attributes and suppression without imputing sensitive labels by default.
3. Review demographic parity/disparate impact for selection rates and equalized-odds differences where validated outcomes and sufficient samples exist.
4. Investigate signals with domain context, error consequences, proxy effects and alternative explanations. Do not infer causation from group differences alone.
5. Assess mitigation design, performance/fairness tradeoffs, new harms and retest evidence. Document inability to assess where evidence is insufficient.

No fixed ratio is a statutory EU AI Act compliance threshold. Diagnostic criterion: {{policy}}. Cohort limits: {{limitations}}. Legal/contextual evaluation and consultation: {{judgment}}.

## WP-A11-01 — Technical documentation and Annex IV compiler

Objective: assess versioned technical documentation and consistency with the actual system. Regulatory anchors: [Article 11](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-11), [Annex IV](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-4).

| Annex IV group | Applicable subitems and reason | Responsible owner | Approved paper/artifact revisions | Missing/stale items | Reviewer conclusion |
|---|---|---|---|---|---|
| 1 System overview and intended use | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 2 Development, data, design and testing | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 3 Functioning, control and limitations | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 4 Metric suitability | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 5 Risk management | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 6 Lifecycle changes | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 7 Standards/alternative solutions | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 8 Provider conformity declaration | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |
| 9 Post-market monitoring | {{items}} | {{owner}} | {{refs}} | {{gaps}} | {{assessment}} |

Procedures: evaluate every applicable subitem, confirm source facts and versions, inspect updates following changes, identify stale or missing evidence, review justified exclusions and reconcile instructions/results/architecture. A generated index is a compilation aid. Provider declarations and authorized signatures must be supplied by accountable persons; the compiler leaves missing declarations explicitly missing.

## WP-A12-01 — Automatic logs and operational traceability

Objective: assess events recorded by the audited AI system, independently of the audit platform's own event trail. Regulatory anchor: [Article 12](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12).

Evidence: {{logging_spec}}, {{production_event_export}}, {{inference_population}}, {{retention_access_policy}}, {{clock_sync}}, {{failure_path_tests}}, {{retrieval_test}}.

Procedures:

1. Define relevant events, correlation and version identifiers, coverage, timestamp convention and privacy-aware content for the intended use.
2. Reconcile sampled inference/decision events to source operations and log exports; investigate absent, duplicate or inconsistent events.
3. Observe logs for override, stop, failure, changes and monitoring events; test outage, retry and retrieval behavior.
4. Assess integrity, access, deletion permissions, clock synchronization and applicable retention obligations through cross-cutting papers.
5. Where special logging obligations apply, map each required item to evidence; do not apply biometric-specific requirements to every traditional model by default.

Source/log reconciliation: {{reconciliation}}. Unlogged events and consequence: {{gaps}}. Design and operating conclusion: {{assessment}}.

## WP-A13-01 — Deployer information and interpretability

Objective: assess whether deployers receive suitable instructions and can interpret the outputs needed for the intended use. Regulatory anchor: [Article 13](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-13).

Evidence: {{instructions}}, {{interface}}, {{support_process}}, {{known_limitations}}, {{explanation_outputs}}, {{user_walkthrough}}.

Procedures: reconcile instructions with model versions and validated metrics; inspect purpose, limitations, input requirements, oversight and operating information; challenge potentially misleading claims; observe representative deployer tasks; assess language, accessibility, explanation fidelity/stability and actual comprehension. Evaluate SHAP/LIME/permutation artifacts as supporting diagnostics, including background data and correlated-feature limits. Record gaps that an explanation chart cannot resolve.

Instruction-to-fact reconciliation: {{matrix}}. Deployer walkthrough observations: {{observations}}. Explanation run ids and limits: {{runs}}. Conclusion: {{assessment}}.

## WP-A14-01 — Human oversight

Objective: assess oversight design and observed operation. Regulatory anchor: [Article 14](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14).

Evidence: {{authority_and_training}}, {{oversight_procedure}}, {{interface}}, {{override_and_stop_logs}}, {{escalation_records}}, {{scenario_walkthrough}}.

Procedures: observe people recognizing limitations, interpreting output, challenging recommendations, disregarding/overriding output and interrupting safely where appropriate; assess competence, authority, workload and automation bias; test escalation and absence/continuity paths; sample real overrides and assess consequences; evaluate applicable special verification conditions separately.

Scenario, expected action, observed action and follow-up: {{table}}. Operator independence/authority: {{assessment}}. Failure/stop recovery: {{recovery}}. Manual conclusion: {{conclusion}}.

## WP-A15-01 — Performance and calibration

Objective: assess suitable performance for the intended decisions. Regulatory anchor: [Article 15](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-15).

Evidence: {{approved_metrics}}, {{locked_holdout}}, {{split_manifest}}, {{validation_runs}}, {{baseline}}, {{instructions_metric_claims}}.

Procedures: approve metric/cost/threshold suitability; verify holdout independence and preprocessing; evaluate overall and slice metrics with uncertainty; inspect calibration when probabilities inform decisions; reconcile instructions with actual tested values; evaluate dependency-aware cross-validation and performance in the intended context. For regression inspect residual patterns and tails; for NLP inspect language/domain and class coverage.

Intended-use criterion: {{criterion}}. Diagnostic estimates/intervals: {{results}}. Generalization limits and manual conclusion: {{assessment}}.

## WP-A15-02 — Robustness, stability and drift

Evidence: {{threat_and_failure_scenarios}}, {{feasible_input_constraints}}, {{perturbation_plan}}, {{reference_windows}}, {{drift_bins}}, {{robustness_runs}}, {{fallback_tests}}.

Procedures: apply plausible missingness/noise/out-of-range and domain changes; document constrained feature/text edits and threat assumptions; inspect recovery/fallback; evaluate PSI/KS/Wasserstein with counts, units and multiple-testing policy; investigate operational meaning and corroborate with label/performance evidence when available. A drift signal requires evaluation; drift absence cannot establish stable outcomes.

Change/perturbation feasibility and effect: {{results}}. Nondeterminism tolerance: {{tolerance}}. Follow-up and conclusion: {{assessment}}.

## WP-A15-03 — Cybersecurity and model supply chain

Evidence: {{threat_model}}, {{architecture}}, {{dependency_inventory}}, {{signed_model_provenance}}, {{access_reviews}}, {{security_assessment}}, {{incident_and_patch_records}}.

Procedures: inspect model/code/data integrity and provenance, access and separation, dependency/patch controls and secrets; obtain scoped independent security testing; assess poisoning/evasion/extraction risks relevant to the system; inspect monitoring, incident response and recovery; evaluate security findings beyond model metrics. Never deserialize untrusted pickle/joblib in the API process; ingestion approval and sandbox evidence are required for executable formats.

Threat coverage and specialist scope limits: {{coverage}}. Outstanding vulnerabilities and control evidence: {{findings}}. Security conclusion: {{manual_assessment}}.
