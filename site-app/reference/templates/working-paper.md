# {{paper_id}} — {{title}}

| Field | Value |
|---|---|
| Tenant / Client / Engagement | {{tenant_id}} / {{client_id}} / {{engagement_id}} |
| Catalog id / Template version | {{catalog_id}} / {{template_version}} |
| Revision / Status / Stage | {{revision}} / {{status}} / {{stage}} |
| System / Model version / Audit period | {{system_id}} / {{model_version_id}} / {{period_start}}–{{period_end}} |
| Criteria / Legal snapshot / Operator role | {{criteria}} / {{rule_pack_id}} / {{operator_role}} |
| Preparer / Reviewer / Lead | {{preparer}} / {{reviewer}} / {{lead}} |
| Confidentiality / Client release | {{classification}} / {{release_status}} |
| Created / Last revised | {{created_at}} / {{revised_at}} |

## Purpose, scope and assertions

Objective: {{control_objective}}

Auditable assertion: {{assertion}}

System boundary and population: {{boundary_and_population}}

Applicability: {{applicability}}. Rationale and source version: {{applicability_rationale}}. Approved by: {{approver_and_time}}.

In-scope interfaces, preprocessing, decision rules and deployment versions: {{versions}}.

Excluded scope and effect on conclusion: {{exclusions}}.

## Risk and criteria

Risk/hazard ids: {{risk_ids}}. Inherent/residual risk: {{risk_assessment}}.

Legal, contractual or internal policy criterion: {{criterion_text_and_reference}}.

Threshold and tolerance, justification, uncertainty policy and approval: {{predefined_criterion}}.

Test selection and alternatives considered: {{audit_response}}.

## Procedures and observations

| Procedure id | Procedure and expected evidence | Manual/automated/hybrid | Population/sample or run id | Observation | Diagnostic state | Exception/finding id |
|---|---|---|---|---|---|---|
| {{procedure_id}} | {{action_and_criterion}} | {{mode}} | {{scope_reference}} | {{observed_fact}} | {{result}} | {{finding_id}} |

For automated work, reference the signed result manifest, input artifact-version digests, data/feature contracts, test implementation version, environment digest, threshold-policy version, seed, cohort counts, timestamps and limitations. Preserve the exact output; editorial interpretation belongs in the evaluation section.

## Evidence index and reliability

| Evidence id/version | Content digest | Source/custodian | Period/system version | Assertion supported | Relevance/reliability/completeness assessment | Contradiction or limitation |
|---|---|---|---|---|---|---|
| {{artifact_version_id}} | {{sha256}} | {{origin}} | {{period_and_version}} | {{assertion}} | {{assessment}} | {{limitation}} |

Custody and transformations: {{custody}}. Reconciliation to source population: {{reconciliation}}. Sensitive-data safeguards: {{privacy_controls}}.

## Sampling and reproducibility

Population frame and units: {{population}}. Method, strata, inclusion/exclusion, sample ids and seed: {{sampling}}. Sample size and statistical/judgmental basis: {{sample_rationale}}. Deviations and effect on generalization: {{deviations}}. Reperformance instructions: {{reproduction}}.

## Evaluation and significant judgments

Evidence sufficiency: {{sufficiency}}. Conflicting evidence and resolution: {{contradictions}}. Exceptions, root cause and aggregation: {{exceptions}}. Specialist consultation and rationale: {{consultation}}. Consequences for other controls: {{cross_control_effect}}.

Auditor conclusion: {{not_assessed|supported|deficiency|unable_to_conclude|not_applicable}}.

Conclusion rationale and practical limits: {{human_conclusion_rationale}}. Finding ids: {{finding_ids}}. Management response: {{management_response_reference}}. Subsequent events through: {{date}}.

## Review and sign-off

| Comment id | Severity | Referenced revision | Reviewer comment | Preparer response/evidence | Reviewer resolution | State |
|---|---|---|---|---|---|---|
| {{comment_id}} | {{blocking_or_nonblocking}} | {{revision}} | {{comment}} | {{response}} | {{resolution}} | {{status}} |

Preparer completion: {{identity_timestamp_digest}}. Independent review: {{identity_timestamp_digest}}. Lead approval where required: {{identity_timestamp_digest}}. Approval binds to **this revision and content digest**. Amendment reason/supersedes: {{prior_revision_and_reason}}.
