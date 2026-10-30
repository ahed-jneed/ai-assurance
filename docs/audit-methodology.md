# Audit methodology and operating model

Methodology version: `2026.10.1`. Regulatory research date: **5 October 2026**. Scope: traditional ML systems, including tabular classification/regression, time-dependent tabular predictions, and classical NLP. The auditable object is the **AI system in its intended use**, including people, preprocessing, decision thresholds, deployment, and downstream decisions; a model binary alone is insufficient.

## Regulatory snapshot and rule governance

The European Commission's current explorer identifies Regulation (EU) 2026/1744 as the amending Digital Omnibus on AI and bases its text on the consolidated AI Act dated 27 July 2026. The consolidated document is a research aid; legally authentic legislation remains the Official Journal acts. Capture both in the platform's source register. [Commission AI Act Explorer](https://ai-act-service-desk.ec.europa.eu/en/ai-act-explorer), [EUR-Lex consolidated AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727), [authentic 2026 amendment](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744).

As at the research date, the Commission timeline gives **2 December 2027** for Annex III high-risk rules and **2 August 2028** for Annex I product high-risk rules. The amendment specifies Chapter III Sections 1–3, except Article 6(5). Article 50 transparency rules began applying on 2 August 2026. Earlier prohibitions and general provisions have their own dates. These dates must be versioned applicability inputs; the system must examine the individual provision, operator role, placement/service date, changes, and transition provisions instead of applying a single engagement-wide deadline. Before high-risk requirements apply, label assessments as readiness assessments unless another applicable rule or contractual criterion is being assessed. [Commission implementation timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act), [amended Article 113](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744).

The amended Article 10 refers to Article 4a and no longer contains its former paragraph 5. Sensitive-category data collection cannot be enabled by a stale Article 10(5) toggle. Record the exact current legal basis, necessity, safeguards, retention and accountable privacy approval before a fairness run processes sensitive data. If unavailable, record an evidence limitation and use an approved alternative. [Current Article 10](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-10).

When relying on Article 4a, its safeguards include restrictions on other-party access to special-category data. An external auditor's cloud upload cannot be authorized by that provision alone. Require reviewed processing/access arrangements and prefer a client-controlled execution boundary with approved, privacy-reviewed aggregate evidence returned to the platform. Also distinguish Annex I Sections A and B: amended Article 2(2) gives Section B a sector-integration route; the engine must not automatically apply the whole direct Articles 9–15 program to those products. Track specific delegated measures and limitations under Article 2(13) when relevant. [Official amendment, Articles 2 and 4a](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744).

Use a reviewable rule pack containing source URL, source version, jurisdiction, effective-from and effective-to dates, applicability predicate, operator role, reference, reviewer, approval time and change history. New rule versions create change tasks; they never silently overwrite issued reports. Store legislation, implementing measures, standards and guidance separately, including whether standards are cited in the Official Journal and whether a claimed presumption of conformity is relevant. An audit assessment and internal readiness score must not be represented as a statutory conformity certificate or regulator approval.

## Assurance model

An engagement specifies its criteria, intended audience, assurance level or agreed procedures, period, system boundary, versions, operator roles and limitations. Acceptance examines independence, conflicts, competence, access, ownership and evidence availability. No assurance level is implied by a dashboard percentage. Findings use criteria–condition–cause–effect–recommendation, with evidence and management response separated from the auditor's assessment.

Each control receives three independent states:

| Dimension | Allowed values | Meaning |
|---|---|---|
| Applicability | pending, applicable, not_applicable, readiness | A reviewer approves the reason and legal version. |
| Diagnostic result | pending, pass, attention, fail, inconclusive, not_run, error | Computation or procedural observation against a preapproved test criterion. |
| Auditor conclusion | not_assessed, supported, deficiency, unable_to_conclude, not_applicable | Human assessment of evidence against the scoped obligation. |

A passing disparate-impact ratio, a SHAP chart or complete Annex IV index does not establish legal compliance. Automated coverage is a count of completed eligible tests; audit coverage measures applicable controls with sufficient reviewed evidence. Display denominators and exclusions for both. Unknown, failed and not-run tests never contribute as passes.

## Client and engagement permissions

Roles are engagement-scoped grants inside a tenant. An Auditor prepares papers, uploads evidence and proposes findings. A Lead Auditor approves scope, test plans, material judgments and the report. A Reviewer independently clears comments and approves conclusions but cannot approve a revision they prepared. A Client Viewer sees only explicitly released documents and findings; submission rights, if enabled, create client-origin evidence and management responses, never auditor conclusions. Service accounts may write computation outputs and draft paper sections only. Platform administration does not imply access to evidence; break-glass access needs recorded purpose, limited time and subsequent review.

Separate the client organization from the audit firm's tenant and the contractual engagement. One client can have many engagements, while model and artifact versions are pinned within each engagement. Cross-engagement reuse requires an approved reference and freshness evaluation; sharing an artifact does not automatically share its access grants. Track individual preparer, reviewer and lead identities even where a user holds several roles. Every export enforces the same object-level authorization as online views.

## Standard workspace

```text
Client / Engagement [engagement-id]
  00 Administration / acceptance, independence, contract, contacts, access
  01 Planning / inventory, classification, scope, risks, criteria, sampling
  02 Evidence Vault
     Governance / policies, approvals, competence, oversight
     Data / datasheets, provenance, snapshots, labels, split manifests
     Model / binaries, registry metadata, model cards, training logs
     Pipeline / code revision, dependencies, transforms, interfaces
     Validation / evaluation runs, reproducibility, charts, signed reports
     Operations / inference logs, change records, incidents, monitoring
  03 Fieldwork / WP-A09 ... WP-A15, cross-cutting procedures
  04 Evaluation / contradictions, exceptions, findings, management response
  05 Reporting / draft reports, Annex IV compilation, issued versions
  06 Review and Sign-off / review notes, approvals, sealed manifest
  07 Remediation and Monitoring / actions, retests, closure, future changes
```

Folders are navigation; evidence identity is an immutable artifact-version id and digest. Papers reference artifact versions, not mutable filenames. Categorization changes do not alter content identity. Client-origin uploads stay in quarantine until type, size, integrity, malware and access checks finish. Track evidence requests with owner, requested period, due date, confidentiality, purpose, state and acceptance/rejection rationale. Download links are short-lived and tenant-bound.

## Lifecycle and gates

| Stage | Required work | Exit evidence and gate |
|---|---|---|
| Planning | Acceptance; independence; system inventory; role and scope; regulatory routing; risk assessment; audit program; criteria and thresholds; sample design; access and evidence request list | Approved acceptance memo, classification rationale, plan and pinned rule pack. Lead approval. |
| Fieldwork | Obtain and validate evidence; walkthroughs; design and operating tests; approved automated runs; interviews; sample exceptions | Procedures have results or approved limitation reasons; immutable input/run provenance; preparer completion. |
| Evidence Evaluation | Evaluate relevance, reliability and sufficiency; reconcile contradictions; investigate signals; aggregate deficiencies; obtain management response | Reviewed conclusions, supported findings, logged unresolved limitations and cleared review notes. Independent reviewer approval. |
| Reporting | Draft findings and scoped conclusion; compile Annex IV package; reconcile disclosures; evaluate subsequent events | Report cross-references match approved paper revisions and artifact versions; management factual accuracy response captured. Lead approval. |
| Sign-off | Final completeness and independence check; approval of exact revisions; issue sealed package; authorized release | Distinct preparer/reviewer where required; no unresolved blocking notes; signed content digest, timestamp and export manifest. |
| Remediation and Monitoring | Track actions and dates; inspect implemented controls; rerun appropriate tests; independent closure; reassess changes | Closure requires fresh evidence and reviewer approval. Monitoring alerts create new tasks or engagements rather than rewriting issued conclusions. |

Changing a reviewed paper's substantive content creates a new revision and invalidates approvals bound to its former digest. A reviewer comment has severity, referenced revision, owner, status, response and resolution evidence. A preparer response does not clear a blocking comment; the reviewer or delegated authorized independent reviewer clears it. Stage reversal records reason, actor and old/new stage. Due dates and assignments do not substitute for authorization.

## Classification and applicability

Collect system definition, intended use, affected persons, decision consequences, geography, operator roles, product legislation, release dates and material changes. Screen prohibited practices before high-risk routing, and retain evidence for all answers. Article 6 examines Annex I product/safety-component conditions and Annex III uses, including exceptions and profiling. Current Article 6 also contains amended provisions, so exception questions must reference the approved rule version. Any unresolved case remains `pending` and generates a classification consultation memo. [Article 6](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-6?trk=article-ssr-frontend-pulse_little-text-block).

High-risk and specific transparency obligations can coexist. Minimal risk is a workflow label for the assessed scope, not a statutory exemption from GDPR, consumer protection, sector law, security, contractual requirements or future reassessment. Capture provider/deployer/importer/distributor roles separately and assess whether rebranding, substantial modification or purpose changes alter responsibilities. Maintain cross-cutting work for quality management, documentation retention, value-chain allocation, deployer use, fundamental-rights impact assessment applicability, conformity route, registration, post-market monitoring and serious incidents. Do not imply that Articles 9–15 are the complete high-risk obligation set.

## Fieldwork mapping

The following is the platform's audit program; procedural examples are design choices, not prescribed statutory tests.

| Reference | Control objective | Automated evidence support | Required human work | Paper |
|---|---|---|---|---|
| Art. 9 | Maintain lifecycle risk identification, evaluation, treatment and testing. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-9) | Risk-register completeness, test-to-risk links, retest dates, threshold provenance | Challenge intended use and misuse, harms, vulnerable groups, mitigation order and residual-risk acceptance | WP-A09-01 |
| Art. 10 | Govern appropriate, sufficiently representative data for intended use. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-10) | Quality profiles, splits/leakage, representation, approved fairness diagnostics | Validate provenance, lawful use, label meaning, target population, feedback effects and remaining gaps | WP-A10-01/02 |
| Art. 11 | Maintain technical documentation before release and thereafter. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-11) | Index completeness, version consistency, generated sections | Assess correctness, completeness, justified exclusions, accountability and actual system alignment | WP-A11-01 |
| Art. 12 | Enable appropriate automatic event recording and traceability. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12) | Schema checks, event reconciliation, gaps, integrity and retrieval tests | Observe production logging, event scope, privacy, outage/failure paths and applicable special logging requirements | WP-A12-01 |
| Art. 13 | Enable deployers to interpret and use the system through suitable information. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-13) | Instruction field coverage, metric/version reconciliation, explanation stability | Observe comprehension and usability; evaluate purpose, limitations, oversight and operational instructions | WP-A13-01 |
| Art. 14 | Enable effective human oversight appropriate to the risk. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14) | Override/stop event tests, access checks and sampled response times | Walk through authority, competence, automation bias, escalation and safe interruption; assess special verification obligations where applicable | WP-A14-01 |
| Art. 15 | Sustain suitable accuracy, resilience and security through the lifecycle. [Source](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-15) | Performance, calibration, feasible perturbation, drift, reproducibility and security evidence integration | Challenge metrics, deployment conditions, threat model, supply chain, failure modes and independently evidenced security testing | WP-A15-01/02/03 |

Annex IV compilation indexes nine top-level groups: system description; development; operation/control; metric suitability; risk management; lifecycle changes; standards/alternative solutions; conformity declaration; post-market monitoring. The compiler fills referenced facts and identifies missing sections; it cannot invent a declaration of conformity, sign provider statements or establish that a standard confers presumption of conformity. Use a per-subitem applicability reason and evidence link. [Annex IV](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-4).

## ML diagnostic discipline

Before computation, pin the model, preprocessing code, dataset, labels, feature contract, positive outcome, decision threshold, cohorts, reference groups, weights, intended population, reference period, policy thresholds, seeds, environment digest and test implementation version. Separate training, validation, locked test and production-reference data. Repeatedly tuning to audit holdout results invalidates the holdout; capture the contamination and require a new evaluation plan. Use grouped/time-aware splits where observations are related or ordered. Compare independently supplied predictions with model-generated predictions when the ingestion route permits both.

Fairness diagnostics need a stated favorable outcome, minimum cohort count, reference definition, intersectional plan, valid labels where required, missing-group policy, uncertainty and privacy suppression. Demographic parity and disparate impact are selection-rate diagnostics; equalized odds conditions on actual outcomes and requires sufficient positive and negative observations. For multiclass and regression define a suitable cohort metric rather than silently binarizing outcomes. A ratio such as 0.80 is a configurable diagnostic policy, not an EU AI Act legal safe harbor. When the reference selection rate is zero, report undefined rather than infinity or pass. Small or absent cohorts produce `inconclusive` and an evidence limitation.

Performance testing uses task-appropriate metrics, uncertainty, calibration when probabilities drive decisions, clinically/operationally relevant costs where scoped, and slice coverage. Report denominator, class balance, prevalence and baseline comparison. Perturbations must preserve realistic input constraints; changing immutable characteristics, crossing invalid feature combinations or applying arbitrary text edits can invalidate the interpretation. Adversarial testing follows an approved threat model and scope. No model diagnostic can establish platform or deployment cybersecurity by itself.

Drift tests identify a distribution change; they do not prove performance deterioration or its absence. Pin reference windows, bins, missing-value handling, scale, cohort sizes, multiple-testing policy and correction, effect sizes and operational follow-up. PSI thresholds are policy-specific; KS significance depends on sample size and assumptions, and Wasserstein distance has feature units. Distinguish covariate shift from label/concept shift. For NLP review language/domain coverage, tokenization, text privacy, out-of-vocabulary behavior, label ambiguity and negation/typo perturbations appropriate to intended use.

Explanation work evaluates background-data choice, correlated features, stability, fidelity and deployment-user comprehension. SHAP, LIME and permutation importance are evidence aids; associations in an explanation do not establish causal effects. Manual papers assess what a deployer actually needs to interpret outputs. Every unsupported adapter, failed test, undefined metric and skipped procedure receives an explicit reason. A test can fail operationally without producing an adverse audit finding; the auditor evaluates whether missing evidence creates a scope limitation or control deficiency.

## Evidence and sampling

Evaluate each item for origin, custody, integrity, period, version, relevance, reliability, completeness, contradictions and sufficiency. Hashes demonstrate content identity, not truthfulness. Interviews require notes, role, date and corroboration; screenshots need context; client representations supplement evidence. Reconcile exported logs to the population before sampling. Capture population frame, sample unit, selection method, seed, exclusions, strata, expected exception rate, precision/confidence or judgmental rationale, selected ids and deviations. Do not describe a judgmental sample as statistically representative or generalize exceptions without a justified basis.

Materiality considers harm to health, safety, fundamental rights, number of affected persons, irreversibility, vulnerability, intended use and legal significance, alongside operational impact. Quantitative score `likelihood × impact` is a triage aid. Legally prohibited behavior or serious individual harm can require escalation regardless of low prevalence. Record inherent and residual risk separately, control reliance and uncertainty; aggregate recurring deficiencies rather than letting individually low scores conceal a systemic issue. Management risk acceptance cannot override a legal obligation or close an unverified action.

## Memos, findings and reporting

The catalog provides acceptance, classification, privacy, sampling, significant-judgment, exception, management-response, reporting, sign-off, remediation and incident memos. Each memo records the question, relevant facts, evidence, options, decision, rationale, consultation, approver and consequences for the audit program. A specialist's opinion is attached with scope and qualifications; the engagement lead remains responsible for the engagement conclusion.

Findings preserve criterion, observed condition, root cause where established, potential/observed effect, supporting evidence, affected model/control versions, severity rationale, recommendation, management position, action owner, target date and status. A management disagreement does not alter evidence; preserve both positions. Remediation states are open, planned, in_progress, evidence_submitted, retest_required, verified_closed, risk_accepted and superseded, with rationale and approval. `risk_accepted` remains visible as unresolved compliance risk when the criterion still fails.

An issued package includes report, criteria and scope, assessment period, rule-pack version, approved paper revisions, findings, management responses, limitations, model/data/code digests, signed run manifests, Annex IV index and provider-supplied declarations where applicable. Seal a canonical manifest and the actual exported bytes, sign through a production key-management service and store in retention-protected object storage. Corrections create a new issued version with an explicit supersedes link and notification record. Retention is set by applicable obligation and engagement policy; legal hold overrides routine deletion and personal-data minimization is implemented separately. Do not use a blanket forever-retention setting.

## Platform acceptance criteria

1. A user from tenant A cannot read, list, search, download, export, reference or enqueue work for tenant B. This applies to workers, search indexes and caches as well as APIs.
2. The same approved inputs and execution contract produce a replayable result manifest; any nondeterminism and tolerance are disclosed.
3. No automated job writes an auditor conclusion or reviewer approval. Draft sections identify automation origin and run id.
4. Issuing a report rejects incomplete applicable controls without a documented approved limitation, unresolved blocking review notes, stale signatures and unapproved report content.
5. Unknown applicability, invalid cohorts and unsupported model/data formats remain explicit and cannot increase a success score.
6. A signed paper can be amended only by creating a new revision; its prior content and approvals remain retrievable.
7. Evidence reuse, client release and remediation closure enforce engagement authorization and freshness checks.
8. A rule-pack update flags affected engagements and reports without changing previously issued statements.
9. Model artifacts that can execute code are evaluated only in a constrained, isolated compute environment with no credentials or unrestricted network access.
10. A production readiness review covers availability, backup restoration, retention enforcement, access reviews, worker isolation, incident handling and operational monitoring.
