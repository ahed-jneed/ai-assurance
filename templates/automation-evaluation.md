# {{paper_id}} — Automated diagnostic evaluation

Complete the common working-paper header. This paper is **draft** until an auditor evaluates the run and a reviewer approves the conclusion.

## Approved execution contract

Task and model adapter: {{task_adapter}}. Model/preprocessing/code/dataset digests: {{digests}}. Feature and target contracts: {{contracts}}. Positive/favorable outcome and prediction threshold: {{outcome}}. Weights/group/time keys: {{keys}}. Reference period and cohorts: {{cohorts}}. Sensitive-data approval and permitted parties/execution boundary: {{privacy_approval}}. Where Article 4a is relied on, evaluate its third-party-access safeguard before transfer; use client-controlled computation and reviewed aggregate outputs where required. Test suite and threshold-policy versions: {{versions}}. Minimum counts, uncertainty and suppression: {{statistical_policy}}. Resource/timeout/egress limits: {{compute_policy}}.

## Reproducible run

Run id/attempt/idempotency key: {{run_identifiers}}. Worker identity/environment digest: {{runtime}}. Implementation/dependency versions: {{versions}}. Seed/nondeterminism tolerance: {{seed}}. Started/finished: {{times}}. Manifest digest/signature: {{manifest}}. Job state and errors: {{state}}. Source population reconciliation: {{reconciliation}}.

| Test id | Metric/cohort/reference | Count/denominator | Estimate and interval | Approved threshold | Diagnostic state | Warning/limitation | Output artifact |
|---|---|---|---|---|---|---|---|
| {{test_id}} | {{metric}} | {{n}} | {{estimate_ci}} | {{criterion}} | {{result}} | {{limitation}} | {{artifact_version_id}} |

Undefined ratios, inadequate cohorts, missing labels, unsupported adapters and errors are explicit; do not replace them with zero or pass. Skipped tests have documented prerequisites and an approved alternative or limitation. A distribution-change signal does not establish deteriorating performance; an explanation chart does not establish causality or effective human oversight.

## Auditor evaluation

Run integrity and appropriateness of inputs: {{evaluation}}. Representativeness and generalization: {{scope}}. Threshold and metric suitability: {{criterion_evaluation}}. Follow-up procedures and corroborating evidence: {{followup}}. Findings proposed: {{finding_refs}}. Human conclusion and limitations: {{conclusion}}. Review/sign-off: {{signoff}}.
