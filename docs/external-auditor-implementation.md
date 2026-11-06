# External auditor implementation and operator setup

Implementation record: 8 October 2026. This document describes the delivered application and portable tools, alongside the operator work needed to use external execution and optional model assistance. It updates the capability status of the earlier [technical advancement assessment](external-auditor-technical-advancement.md); it does not replace the audit methodology, approve a legal interpretation or attest the deployed infrastructure.

The platform supports an independent auditor's working process: establish scope, select procedures, collect permitted evidence, perform or commission diagnostics, assess sufficiency, document findings, obtain independent review and hand over a verifiable audit file. Automation prepares evidence and draft working papers. It does not decide conformity, approve a source as truthful or discharge an actor's obligations.

## Delivered capability boundaries

| Area | Delivered behavior | Remaining qualification or operator responsibility |
| --- | --- | --- |
| Engagement access | Active practice membership plus internal engagement grants; separate practice administration; client-scoped views and contributor grants; revocation checks in commands and worker authorization | Review legacy adopted grants, configure Site access separately, assess identity lifecycle and periodically recertify access |
| Audit workflow | Versioned brief and program, procedure execution and evidence assessments, working papers, independent reviews, findings, scope-change records, report capture and client release controls | Professional methodology approval, competence, independence, materiality, sufficiency and opinion remain human decisions |
| System inventory | Immutable system revisions, ordered typed feature declarations, output/class/threshold semantics, model/dataset/pipeline pins and declared prediction lineage | The declarations do not verify deployed behavior, preprocessing or actual model production of submitted predictions |
| Registry collection | Read-only MLflow/Hugging Face snapshot collector resolves versions/commits, preserves response hashes and explicit contract unknowns; approved same-host artifact acquisition requires expected SHA-256 | Real registry accounts, provider-specific authentication, gateways and live acquisition were not qualified; imported records are proposals |
| Evidence reasoning | Located excerpts, source hashes, assertion support/contradiction/supersession relationships and independent assessment review | Excerpts are manually transcribed; document parsing/OCR, source truth and exhaustive collection are not established automatically |
| Sampling and statistics | Hosted deterministic record-ID sampling; portable reproducible sampling, exclusions, probabilities, quality/leakage diagnostics, intersectional slices and seeded IID/cluster bootstrap | Population completeness and assumptions must be assessed; low support is inconclusive; hosted stratified sample size means per stratum |
| Operational evidence | Portable bounded JSONL collection, source/population counts, duplicate IDs, sequence gaps, deployment-version references, final decisions and overrides; selected supplied-output replay comparison | Collector output does not prove omitted logs are absent or invoke actual deployed inference; an independent replay runner must supply the compared outputs |
| External execution | Frozen requests, queued jobs, leased/fenced attempts, heartbeats, authenticated result bytes, stale/cancelled attempt rejection, retained results and explicit paper compilation | No production external worker is deployed; container/native adapters and actual private-Site service enrollment need qualification |
| Evidence briefing | Working deterministic source assistant plus signed allowed-source export and manual model-draft import; portable optional provider-backed service rejects invalid scope/citations and produces pinned drafts | No generative provider is configured or deployed; manually uploaded provenance is unverified until an authenticated service receipt is captured |
| Regulatory subitems | Versioned selective obligation prompts, actor/applicability rationale, accepted evidence references, independent review and source-change assessment | The catalog is selective and proposed for methodology review; it is not an exhaustive legal obligation database or automatic legal decision engine |
| Portable handover | Audience-specific dossier with exact report JSON, readable HTML, captured papers/assurance records/evidence, explicit withheld reasons, canonical manifest and application Ed25519 signature | Trust pinning is independent; signing keys are held by the Worker, wrapped in D1 under a Worker secret (`docs/security/signing-keys.md`), not KMS/HSM keys; no external timestamp, qualified signature or remote runtime attestation |
| Storage and histories | Scoped D1 access/assurance/job records, command CAS, immutable history triggers, R2 content-addressed paper histories, result arrays and captured report projections | Active engagement metadata remains an aggregate with bounds; full PostgreSQL normalization, production RLS, outbox/broker, retention and disaster recovery remain staged architecture work |

The independent ML engine evaluates observed outputs against frozen internal acceptance criteria. A diagnostic pass or signed result is not legal certification. Provided predictions, auditor-controlled native inference and client-local evidence have different independence and lineage implications and retain distinct execution-mode labels.

## Set up a practice and audit engagement

1. Sign in and verify the account ID and practice identity. Site sharing/access and application membership are separate permissions; configure both through their respective administration paths.
2. The practice administrator manages clients and active membership. Assign the appropriate audit role and client scope. Internal staff additionally need an engagement grant; practice administration alone does not grant audit-content access.
3. Review migrated engagements: the one-time legacy adoption preserves prior internal access, then a policy marker prevents a revoked grant from being recreated by later reads. New members receive no automatic engagement grants. Record an explicit recertification decision before using sensitive client evidence.
4. Establish acceptance, independence, scope, audited system/version, intended use, population, period, actor duties, criteria versions, application-period analysis, materiality and deliverables. Approve the brief and program before executing bound procedures.
5. Register immutable system/model revisions and accepted evidence. Describe typed ordered features, class order, output meaning, thresholds, expected null handling and any transformation. A source hash and declared signature are evidence pins, not proof of runtime compatibility.
6. Record procedure work and evidence quality separately from metric output. Review assertion, impact and obligation assessments independently. Resolve contradictions and limitations before selecting an opinion.
7. Capture the report at approved revisions. Review the client projection and release decision separately from the internal file. Seal a dossier for its intended audience only after the relevant captured report and release conditions are met.

Active membership and engagement access are checked again during writes. Optimistic concurrency binds metadata, associated records, snapshots and events to the same successful command ID. A conflict must be reloaded and reassessed. Do not bypass these APIs by editing backing records or object-store data directly.

## Register a model without executing it

The [registry collector](../engine/REGISTRY_IMPORT.md) is a separate read-only operator tool. Configure one explicit HTTPS origin/allowlisted host and a read-only registry token through a named environment variable. Never put credentials in an artifact, command argument, model card or checked-in configuration.

MLflow aliases resolve to a captured numeric version. Hugging Face references resolve to a captured full commit. A registry source URI, card statement, optional signature or license remains a declaration until corroborated. Unknown features, output order, nullability and preprocessing remain unknown; the collector does not invent them from examples.

Model bytes require an explicitly approved exact URL and expected SHA-256. They remain inert during acquisition. Redirected artifact hosts require a separately reviewed connector or gateway; the collector does not widen authority automatically. Acquisition of a pickle file does not permit execution. Upload the resulting registry JSON as permitted evidence, accept it through the normal vault controls and import its normalized proposal summary before making a separate system-registration decision.

The delivered registry tests use synthetic fixtures and mocked transport. Actual MLflow/Hugging Face accounts, server policies, enterprise authentication, CDN/gateway behavior and real client artifacts were not tested.

## Commission an external execution

The hosted service has a pull protocol and server-side job lifecycle; an external execution service has not been deployed for the practice. Jobs require a configured worker. Follow the [worker runbook](../engine/WORKER.md) before enrollment.

An execution request freezes system/model/dataset/profile identities and hashes, internal policy criteria, seed, selected tests, execution mode and approved procedure/brief/program revisions. A changed source or protocol needs a new run. The server does not grant an arbitrary worker access to an engagement.

An audit lead enrolls a worker for one engagement with an image digest, reviewed capabilities and a security-review statement. Copy the one-time application token to a secret store. Configure private Site service access separately and provide these environment variables to the operator-controlled worker:

    ASSURANCE_SITE_ORIGIN
    ASSURANCE_WORKER_ID
    ASSURANCE_WORKER_IMAGE_DIGEST
    ASSURANCE_WORKER_TOKEN
    ASSURANCE_SITE_SERVICE_TOKEN  (where private Site service access requires it)

A baseline command for provided predictions is:

    python -m engine.worker --once --executor process --workspace worker-jobs

Process execution uses a fixed trusted module, strips service credentials from compute and enforces available process/time bounds. It is not an OS memory/network sandbox and cannot load native model artifacts. The process-mode image identity is an operator declaration rather than measured attestation.

For auditor model inference, provision a locally present digest-pinned Docker image with reviewed runtime dependencies and golden model fixtures. Configure the local SHA-256 model allowlist and explicitly enroll supported formats. The delivered container executor uses no network, read-only inputs/image, a separate output mount, a nonroot user and resource limits. Claimed job content cannot install dependencies or approve its own model hash. Docker execution, native ONNX/XGBoost/LightGBM/PMML runtimes and actual enrollment were not validated by the implementation environment.

The worker downloads pinned bytes, verifies them, computes within its allowed mode, preserves the full conservative external engine report and projects only selected hosted acceptance criteria. Request/result hashes and a credential-bound exact-body HMAC authenticate transport under the enrolled trust policy. They do not prove worker honesty, correct metrics, complete source data or independence.

Attempts have expiring leases, heartbeats, monotonic fences and nonces. Revoked workers/sponsors, stale procedures, expired leases and cancelled jobs cannot publish a current accepted result. The same accepted completion digest is idempotent. An ambiguous completion is retained locally and reported as uncertain; operators reconcile it instead of overwriting a possibly committed result with failure. Archive job evidence securely before exhausting the bounded workspace.

Compile an accepted external result explicitly into the engagement. Compilation preserves the raw accepted result as evidence, binds a run to the frozen procedure context and creates a supplementary draft working paper. The auditor still records the procedure actually performed and assesses reliability, coverage and limitations. Human review and sign-off remain separate.

The current protocol has no reference-dataset endpoint for numeric drift. Missing baseline, unavailable genuine model execution, SHAP/LIME, training/cross-validation/adversarial procedures, raw text NLP and executable preprocessing must remain visible as unavailable or inconclusive; they are not simulated into passing results.

## Collect reproducible statistical and operational evidence

Use the dependency-free portable assurance module locally or in an approved client-controlled environment:

    python engine/assurance.py sample --input population.json --config sampling.json --output new-sample.json
    python engine/assurance.py quality --input records.json --config quality.json --output new-quality.json
    python engine/assurance.py slices --input records.json --config slices.json --output new-slices.json
    python engine/assurance.py bootstrap --input records.json --config bootstrap.json --output new-interval.json
    python engine/assurance.py collect --logs permitted-events.jsonl --output new-collection.json
    python engine/assurance.py replay --logged selected-logged.json --replayed independently-replayed.json --config replay.json --output new-comparison.json

Sampling records the source population digest, unique record IDs, seed, deterministic rank method, selected IDs, stratum allocations, exclusions and inclusion probabilities. Reordering a population cannot change selection. A submitted population digest does not establish that the submission includes every relevant decision.

Quality procedures identify duplicate record/entity participation across declared splits, missing fields and temporal cutoff issues. Slice and bootstrap procedures record their assumptions and minimum-support limits; IID intervals require the corresponding independence assumption, while cluster resampling requires a meaningful cluster definition and independent clusters. Neither method resolves biased selection or missing outcomes.

The operational collector reads bounded submitted JSONL files only. It reports per-source/population counts, duplicate event IDs, declared sequence gaps and model/pipeline/threshold/decision/override fields. Replay compares the selected provided logged and reproduced outputs using explicit tolerances. It does not load a production system or claim to have executed inference.

Upload only legally and contractually permitted outputs, preserve their exact bytes/hash in accepted evidence and import their scoped summary in the assurance workbench. A normalized diagnostic record does not replace the underlying artifact, collection protocol or auditor assessment. Do not upload sensitive records merely because an automated test can consume them.

## Evidence briefing, provider approval and manual import

The deterministic assistant works from selected permitted locations/assertions, attributes source text and recorded relationships, and drafts collection questions or support gaps. It has no document-controlled tools. Adopted edited text creates a separate draft paper revision, preserves the proposal/adoption record and clears revision-dependent reviews/signatures.

The [optional provider service](../engine/CITED_ASSISTANT.md) exists as a portable implementation, not a configured hosted provider. Export only accepted source locations after verifying underlying bytes. The allowed-source packet captures tenant/engagement/principal, exact source IDs and pins, excerpts, version and an expiring evidence-briefing permission. It is signed with the practice application key.

Provider configuration, exact HTTPS host, selected model, environment-variable key name and explicit destination approval belong to the operator. The portable service accepts a separately authenticated expected packet digest or an independently trusted exporter public key. A public key shipped inside the same untrusted download is not sufficient trust.

The signed packet currently authorizes source scope and briefing purpose. The Site's destination/governance declaration is a separate export record; it is not a provider-side transfer-policy enforcement or verified privacy approval. Independently establish actual processing authority, destination, contract, residency and retention before sending excerpts. The service's explicit approved-destination argument records that independent operator decision.

Provider output must satisfy strict citations and bounds. Unknown citations, uncited suggestions, refusals, tool calls, incomplete JSON and unmatched contradiction scope reject the entire answer. Preserved hashes, model/provider/prompt versions and source pins support tracing, not factual entailment. Every suggestion requires independent human source assessment and edited-text adoption.

Manual Site uploads have verified artifact bytes and authorized source citations, but **provider/model/prompt provenance is declared and unverified**. A self-recomputed draft hash cannot authenticate provider origin. The portable verification helper accepts an independently captured expected draft hash; the manual upload path does not yet have an authenticated service receipt. Do not describe a manual import as authenticated provider execution. Source-pin checks and human review still apply.

Provider requests and raw response bodies are ephemeral in the portable service: hashes and selected draft content/provenance are returned, but no complete provider transcript is automatically stored. Retain original allowed-source exports and approved draft evidence through an organization-controlled custody route when reproducibility requires them. Do not treat a response hash as access to missing original bytes. Do not put credentials or excessive personal content into transcripts, source locations or diagnostic logs.

No real model provider, API key, production destination or network generation was configured for QA. The 30 dedicated service tests use mocked completions/transports and synthetic trust keys. They establish local validation behavior, not provider quality, legal permission or deployed security.

## Seal and verify the portable audit file

A dossier is a JSON container with a canonical versioned manifest, audience/report identity and digest, exact file names/digests/sizes/media types, explicit withheld evidence and custody entries. Files are base64-encoded exact bytes. The manifest signature uses Ed25519 over recursively sorted compact UTF-8 JSON; numeric manifest fields are integers.

The internal dossier may contain captured report JSON/HTML, paper revisions, pinned assurance records and evidence. Client dossiers use the separately captured released projection and permitted evidence; client access cannot fetch the internal bundle. Missing captured evidence is an error unless an explicit audience-specific exclusion is recorded with a reason. The hosted dossier budget is 30 MB.

The lead seals a captured audience package. Download it and retain its public key identifier/SPKI through an independent trusted channel. Verify outside the application:

    python engine/assurance.py verify --dossier dossier.json --trusted-keys trust.json --require-trusted-signature

The distributed standalone verifier uses the same checks. It rejects changed, missing or extra files, duplicate/unsafe paths, digest/size mismatches, changed report bytes and invalid/untrusted signatures. An embedded self-key is never trusted automatically. Check withheld evidence and opinion limitations as well as technical verification.

The practice application stores signing private keys in D1 as server-readable material. These are not KMS/HSM-protected keys, independently attested keys or qualified signatures. Key rotation retains prior verification material and requires a reviewed trust policy. Application custody timestamps and audit-chain hashes are not independent time anchors. External timestamp anchoring, legal hold, regulated destruction and disaster-recovery qualification remain future operational controls.

## Storage, migration and scale

The deployed storage design now normalizes practice/engagement grants, assurance records, worker enrollment, jobs/attempts and signing-key records in D1. Scoped assurance records and frozen execution requests have immutability triggers. Membership/client/engagement identity and composite relationships remain explicit.

Active engagement metadata still contains audit-domain collections. Content-addressed R2 objects hold expanding paper history, run result arrays and captured internal/client report snapshots; D1 snapshots retain their reference pins. Hydration verifies exact bytes and fails closed on missing or corrupt objects. This avoids repeatedly embedding historical content in every active metadata update while preserving existing records.

R2 keys and a hash are application immutability conventions, not object-lock retention. Object writes may occur before the winning D1 CAS, so unused content-addressed objects need a reference-aware cleanup/retention process; referenced snapshots must never be deleted as orphaned content. The current active metadata bound is 1.5 MB and the job-list bound 100. The number of assurance records is not bounded: the workbench and the views that need one record kind read them in cursor pages of 200 in creation order (records created at the same instant follow in ID order), each operation looks up only the records it names, and report gates and pins are computed in D1 without reading every record. The internal dossier still embeds every pinned record within its 30 MB budget. Large audit files still need independent load qualification rather than an unlimited-scale claim.

The [PostgreSQL reference](../db/postgres.sql) provides a staged normalization target with composite tenant constraints, engagement membership, FORCE RLS and revision/control tables. It is not the hosted runtime database. Move collections incrementally behind existing contracts, preserve IDs/hashes and historical references, and use read verification/shadow migration before switching authoritative writes. A durable broker/outbox, worker fleet quotas, regional encrypted retention, SSO/SCIM and formal backup/failover controls remain production rollout work.

## Release evidence and qualification

Local unit and synthetic integration fixtures validate bounded contract/state behavior. Recorded cases cover source/protocol pinning, role/scoped access, stale/cancelled attempts, deterministic calculations, artifact/dossier tampering and manual-versus-authenticated provenance. Those fixtures do not establish a live external worker, registry account, Docker/native runtime, generative provider or operating effectiveness.

The implementation's release notes should identify the exact build, exercised suites and environment, deployed UI/API capabilities and unconfigured external capabilities. Capture approved release evidence separately from disposable terminal/test transcripts; a temporary test transcript is not a retained audit record or independent attestation.

Before external onboarding, qualify a controlled pilot using permitted evidence. Exercise actual identity revocation, worker enrollment, lease crash/reclaim/cancellation, reviewed native golden fixtures, model/pipeline correspondence, key rotation/trust pinning, client redaction/release/revocation, evidence recovery and independently verified dossier handover. Record limitations that remain unresolved. Technical completion of a feature does not approve its use for a particular client's audit.
