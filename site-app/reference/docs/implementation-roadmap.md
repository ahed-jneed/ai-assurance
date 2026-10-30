# Implementation status and production acceptance roadmap

Baseline: 5 October 2026. The repository supplies a working control-plane prototype, reusable methodology templates, a local diagnostic runner, common contracts, a normalized PostgreSQL migration baseline and a production architecture specification. A deployable prototype is not yet an enterprise compliance service. Only capabilities demonstrated by code and tests should be described as implemented.

The 7 October business/workflow increment adds auditor-recorded evidence requests, explicit sufficiency decisions, mandatory limitation memos and stricter final readiness checks. See [the current business completeness review](audit-business-completeness.md) for implemented versus remaining operational capabilities and prioritized acceptance criteria.

## Current implementation boundaries

| Area | Reference implementation | Production work / acceptance evidence |
|---|---|---|
| Workspace | Client/engagement workspace, stage-based papers and memos, evidence references, findings, review/sign-off gates | Usability/accessibility validation; a complete supervised engagement; approved methodology ownership and change control |
| Storage | Hosted worker uses private D1 tenant/member/client tables and engagement aggregate state, append-only snapshots/events; object bucket for evidence | Normalize using `db/postgres.sql` or equivalent; prove RLS, composite FKs, encrypted regional vault, signed manifests and regulated retention |
| Identity | Host-provided authenticated user identity; server-side scope/role checks | Enterprise OIDC/MFA/SCIM lifecycle; expiry/revocation; engagement assignments; administrator/content separation; break-glass procedures |
| Interactive diagnostics | CSV saved-prediction evaluation; four binary performance/fairness procedures | Independent model inference is a separate capability; production metric policies need client/domain approval and uncertainty review |
| Python diagnostics | Saved-prediction binary/multiclass/regression performance, binary group fairness and numeric reference/current drift, provenance and auto-generated drafts | Trusted model adapters, full preprocessing contracts, genuine explanations, training reproduction/CV, feasible robustness and deployment logs |
| Model formats | Metadata registration and adapter contracts for sklearn/XGBoost/LightGBM/ONNX/PMML | Verify each pinned runtime/model family; native executable formats confined to isolated short-lived jobs; no unsafe deserialization in API |
| Async jobs | Interactive queue/claim state and external worker integration specification | Transactional outbox; durable distributed leases, callbacks, idempotency, bounded retries, cancellation, recovery and quota scheduling |
| Evidence/report integrity | Content hashes and write-once diagnostic outputs; revision-specific review metadata | KMS-backed signatures, independent verification, WORM/object-lock behavior, external chain anchors and restoration exercises |
| Regulatory mapping | Versioned applicability and Art. 9–15 / Annex IV methodology | Qualified review of current law/effective dates; broader actor duties and scope exclusions; jurisprudence/guidance updates; approved client interpretation |

The Python runner's unsupported suites return `inconclusive` or an appropriate scope outcome with a reason. Do not relabel unavailable SHAP/LIME, CV, model inference, logging or adversarial tests as successful. Saved predictions allow evaluation of those predictions; they cannot establish that the submitted binary produced them, that test data is independent, or that the deployment is robust.

## Phase 1 — domain and methodology foundation

Deliver acceptance/continuance and independence workflows, versioned system inventory, actor roles, engagement letter, period, deliverables, limitations, materiality and scope-change approvals. Establish a template owner, reviewer and release schedule. Instantiate every engagement from the same versioned methodology pack, preserving template version and approved exclusions.

Required paper/memo families: engagement acceptance; scope/planning; regulatory applicability; system description; risk register; sampling/threshold rationale; data quality/lineage; fairness and protected-attribute justification; model/pipeline validation; explainability; drift; robustness; logging; transparency/instructions; oversight walkthrough; cybersecurity; Annex IV evidence index; findings; management-response/disagreement memo; residual-risk/completeness memo; final report; independent review; closing memo; remediation retest; post-audit monitoring/change/incident memo.

Acceptance: an experienced auditor can complete a manual engagement with no automation and preserve a traceable criterion → procedure → evidence → human conclusion → finding → report chain. Missing evidence and unresolved disagreements remain visible in the report.

## Phase 2 — secure persistence, identity and commands

Apply schema through an approved migration pipeline. Bootstrap firm/client/engagement authorization through a narrow provisioning service. Runtime role owns no tables and has no bypass/superuser/DDL/TRUNCATE rights. Access both tenant and engagement scope on every command, export, download and background callback. Freeze schemas and authorize allowed columns instead of updating arbitrary aggregates from a client body.

Use transactional command handlers for record creation and lifecycle state changes. Optimistic concurrency requires an expected version, with all associated metadata/events/evidence-release/role changes guarded by the **same command's successful CAS**. Version increment alone cannot establish that this command won. Return conflict and make no side effects on CAS loss. Idempotency binds request hash and principal; changed content with the same key is rejected.

Acceptance: automated cross-tenant and cross-client attacks fail; guessing valid IDs reveals no sensitive existence; a revoked/expired member cannot use stale sessions; no signed URL/export endpoint bypasses authorization; two concurrent edits cannot produce an unlogged side effect. Tenant administrators do not inherit audit-content access. Client-visible reports use a separately reviewed release projection and must not embed an internal aggregate snapshot.

## Phase 3 — evidence vault and custody

Add resumable bounded uploads, format/decompression checks, quarantine, scanner dispositions, read-only SQL extraction, hash verification and immutable object versions. Capture source, submitter, timestamps, scope, sensitivity, lawful access, dataset purpose, query/snapshot identity and retain-until policy. Sign canonical manifests with a managed key and retain key-version verification material. Evidence intake acceptance records custody/reliability; it does not authorize executing an uploaded model.

Build explicit resource-release decisions and redacted client projections. Minimize sensitive slices and free text; record the responsible data controller/processor relationships separately. Implement legal hold, dual-approved destruction, tombstones, release revocation and privacy-request handling. Keep credentials and raw personal values out of logs/job envelopes.

Acceptance: bytes changed after upload fail before computation/export; rejected/quarantined objects cannot be downloaded through a normal evidence route or executed; all access is recorded; ordinary app administrators cannot shorten a vault lock; hold blocks destruction; a restore reproduces manifest verification.

## Phase 4 — reproducible testing plane

Create a registered adapter interface with `describe`, `validate_input`, `predict` and optional `predict_proba`/training/explanation capabilities. Model registration binds binary hash, training/library versions, feature order/types, preprocessing/tokenizer, positive class, score calibration and inference fixture. Dataset registration binds byte/content hash, schema, population/time window, missing/proxy/sensitive fields, labels, lineage and rights.

Approve the audit test plan and threshold policy before submitting a run. Store sampling manifest/seed and actual row selections. Prevent training/holdout leakage and train-fold preprocessing leakage. Existing-model holdout evaluation and training-reproduction cross-validation are separate procedures. Metrics include actual numerators/denominators, method-appropriate confidence intervals, slice support, limitations and reasoned undefined/inconclusive outcomes.

Sandbox workers run trusted adapters in pinned images with no egress, no shared tenant volumes, read-only inputs and bounded CPU/memory/disk/time. Treat pickle/joblib/native Python deserialization as executable input. Consider stronger VM isolation for untrusted binaries. Validate outputs as data, not executable HTML or formulas.

Acceptance: deterministic analytic fixtures verify confusion counts, zero denominators, tiny groups, missing labels, multiclass/regression scope, PSI bins/smoothing, KS/Wasserstein units and absent-reference behavior. Malicious artifacts, decompression bombs, infinity/NaN, incompatible feature schemas and quota overruns fail safely. Performance baselines use agreed dataset/model sizes. A test produces provenance for actual consumed bytes; model hashes cannot be fabricated for a saved-prediction-only runner.

## Phase 5 — distributed orchestration

Implement PostgreSQL outbox insertion in the job-submission transaction, bounded RabbitMQ/Celery publishing, per-tenant concurrency quotas, CPU/large-data routing, leased attempts, heartbeats, monotonic fencing tokens and result-service authentication. Store source of truth in the DB; broker state is delivery state only. Distinguish permanent input failures from retryable infrastructure failures. Add backoff/jitter/cap, dead-letter triage and a reconciler.

Cancellation is durable and fences stale completion. Invalid/failed/cancelled work is `inconclusive`; partial metrics retain limitations and cannot silently become passes. Callback acceptance validates schema, matching tenant/engagement/input/plan, attempt token, hashes, cancellation and absence of earlier committed results. Compile papers idempotently without overwriting human edits.

Acceptance: simulate duplicate delivery/completion, process death before/after commit, lost publish acknowledgement, retry exhaustion, stale lease, cancelled callback, cross-tenant callback, oversized result and worker outage. Every valid request either completes or reaches a visible actionable failure; no duplicate papers/current results appear.

## Phase 6 — review, findings and report issuance

Freeze complete working-paper revisions and exact evidence/run links. Protect frozen revision content and attachments; preserve historical reviews/signatures after reopening and mark them stale for the current revision. The approving reviewer cannot be the preparer. An author cannot disguise authorship by copying a paper. Independence safeguards are assessed at team and work-item levels.

Findings move through controlled states with management response, due date, remediation evidence, independent retest and closure rationale. A retester must be independent of the remediation implementer and must assess effective operation, not just the presence of a file. Risk acceptance preserves the nonconformity and statutory duty; it does not manufacture compliance.

Report assembly freezes applicability, approved revision hashes, evidence manifest, findings including disagreements, limitations, audit period and opinion. Acquire current-paper locks or use a serializable issuance transaction to prevent revision changes racing the signature check. Require reviewer and lead approval with separation of duties. Produce signed PDF + JSON manifest + verification instructions. Redact client release content explicitly; final report snapshots must not expose internal findings or evidence unintentionally.

Acceptance: a modified/new paper invalidates current approval; self-review, unresolved blocking comments, stale signatures, missing evidence and unfinished runs block applicable issuance. Additional evidence links cannot be inserted into a signed revision. Issued reports never mutate; a correction creates a new signed version plus supersession/withdrawal event. A third party can verify bytes and manifest without DB access.

## Phase 7 — operational/regulatory controls

Assign owners for QMS/governance, deployer instructions, human oversight, logs, post-market monitoring, incident escalation and applicable registration/conformity/rights-impact obligations. Each duty has an applicability rule, responsible actor, evidence request, procedure, approval and cadence. Record legal-source version/date and ruleset activation rationale; changed guidance creates impact review without rewriting earlier audit records.

Build dashboards for review backlog, overdue findings/evidence requests, incomplete controls, material limitations, queue age, failed/cancelled jobs, integrity mismatches and ruleset changes. Separate operational metrics from compliance conclusions. External alerts/messages require explicit organizational configuration and authorization.

Acceptance: qualified reviewers approve the applicable control catalog and reporting language; prohibited/in-scope/high-risk/other duty routes and unknown-fact paths are demonstrated with realistic case files. Users cannot infer universal fairness or performance safe harbors from a default demo threshold.

## Phase 8 — production release and ongoing assurance

Run threat modelling, independent security review, tenant-isolation tests, dependency/SBOM and container scanning, penetration testing, accessibility review and load tests. Exercise regional failover, backup/restore, key rotation, identity revocation, legal hold, corrupted evidence, compromised worker, failed report generation and an externally anchored audit-chain verification. Validate RPO/RTO in practice. Record service ownership, on-call/escalation, rollback and vulnerability-response procedures.

Release gates: approved architecture and methodology; all mandatory security/workflow tests passing; no critical isolation/integrity issues; pilot engagement independently reviewed; signed artifact verification/retention tests complete; production secrets and deployment roles separated; training and runbooks accepted. Use a limited pilot before broad onboarding. Monitor failure cases and investigate rather than removing failed controls from dashboards.

## Contract and migration safeguards

`schemas/test-run.schema.json` uses an extensible v1.0 envelope: string suite IDs, frozen policy/configuration, state, outcome, results, provenance and paper IDs. It validates both current runners and supports richer production suite definitions and approval metadata. `schemas/working-paper.schema.json` separates an automatically generated **draft** from a complete frozen **human-evaluated revision**. Schema conformance is necessary but does not authorize access, validate legal applicability or prove evidence authenticity.

Semantic validators still enforce: metric interval order and denominator consistency; same-engagement/system/purpose input compatibility; test registry version; approved plan identity/hash; timestamps and seed limits; policy approval before execution; succeeded/outcome consistency; no unsafe executable parameters; result aggregation rules; run → paper referential integrity. Contract changes require compatibility tests against the interactive app, Python fixture and exported reports.

Use expand/migrate/contract migrations and tenant-key backfills with validation. Avoid blanket cascade deletion and runtime auto-migration. Check new policies under a runtime role, including failure with absent tenant context. Partition/index only after measuring real workload; preserve tenant keys on every partition/index and test uniqueness scope. Retention deletion is a distinct approved workflow with signed receipts, not a generic CRUD delete.

## Verification performed for this baseline

The SQL migration was applied to an isolated temporary PostgreSQL 17 database. Disposable tests under a non-owner, non-superuser, non-BYPASSRLS runtime role checked tenant isolation, cross-tenant artifact foreign-key rejection, absent-context denial, immutable paper revisions, client-viewer exclusion from internal/draft records, explicit artifact release/revocation, independent reviewer plus lead signatures and invalidation after pending draft edits. A final regression check rejected a prior preparer as reviewer after reassignment, rejected revision-pointer rollback, and accepted a separate independent reviewer. All 43 tenant-bearing physical tables have FORCE RLS. The temporary clusters were stopped and removed; no existing database was used. This is a schema smoke test, not full production penetration/workflow validation.

Both Draft 2020-12 JSON schemas compiled using Ajv. The Python example report and its nine generated paper drafts validated; the interactive TypeScript evaluator's actual four-result output, queued and failed envelopes validated. Invalid completed-run null outcome and disabling required draft review were rejected. These checks demonstrate contract compatibility; the remaining operational/security acceptance gates above still apply.
