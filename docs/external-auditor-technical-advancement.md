# Technical advancement for the external AI auditor

> **Superseded for status (14 Nov 2026).** This is a dated record of an earlier increment, kept as written. For what the platform does now, see the [capability matrix](capabilities.md) and [ROADMAP.md](../ROADMAP.md); file paths, counts and limits below are as they were when this was written ([historical paths](capabilities.md#older-documents-and-historical-paths)).

Assessment: 7 October 2026. This analysis treats the external AI auditor as an independent professional assessing a client's AI system. An AI assistant is a supporting component with its own controls. Recommendations below are proposed capabilities, not newly deployed services. The assessment uses the current application and external engine source; it does not establish the deployed infrastructure's security or operating effectiveness.

The product objective is to let an auditor independently collect, reproduce, challenge and explain evidence, then hand over an audit file that remains verifiable after access to the platform ends. The existing engagement workflow is a useful foundation. The largest gains now come from execution, evidence quality and verification.

**Current baseline and gaps**

| Area | Implemented baseline | Gap affecting an external auditor |
| --- | --- | --- |
| Audit workflow | Approved scope/program revisions; actual procedure work; evidence assessment; independent review; separate paper sign-off and report release | Structured claims, exact evidence locations, change impact and sampling need deeper support |
| Registration | Immutable model/card versions, source hashes, saved protocols and frozen run manifests | Input schemas and preprocessing are mainly descriptive; a prediction file is tied to a registration rather than to a separately verified inference record |
| Hosted evaluation | Actual binary, multiclass and regression saved-prediction diagnostics, byte verification and procedure bindings | Interactive datasets are limited to 1 MB; computation occurs in an HTTP handler; no independent native model inference |
| External engine | CLI diagnostics, calibration, numeric drift, Wilson intervals and conditional model diagnostics; optional native adapters | Separate runtime, no authenticated hosted ingestion/dispatch; optional native integrations were not runtime-validated |
| Run contracts | Hosted 1.1 and external 1.0 contracts with provenance and integrity checks | Configurations, test identifiers and result shapes require explicit versioned translation before integration |
| Evidence/report integrity | Hashes, append-only application records, immutable report snapshots and two audience digests | Current package verification checks snapshots and referenced hashes; it does not re-read every artifact or establish independent signing/time anchoring |
| Authorization | Tenant membership, client-role restrictions and per-request Contributor grants | Internal roles can read the practice's engagements; procedure assignment is not an engagement read-access boundary |
| Scale | Bounded D1 engagement aggregates and guarded writes | A 1.5 MB engagement aggregate, repeated snapshots and engagement-wide contention constrain large audit files |

**1. Connect independent testing to the audit workflow**

Provide three explicit execution modes, with their evidence limitations visible on every result:

| Mode | What the auditor obtains | What must be assessed |
| --- | --- | --- |
| Client-supplied predictions | Diagnostics of the submitted labels, scores and predictions | Whether the named model generated those predictions, population completeness and selection bias |
| Auditor-controlled model execution | Predictions reproduced from pinned model and preprocessing artifacts in an isolated approved runtime | Artifact identity, adapter compatibility, dataset suitability and correspondence to the deployed system |
| Client-local execution | Approved collection/tests run within the client's environment, exporting authorized evidence | Collector identity/configuration, client control of the environment, omitted records and independent corroboration |

A signed client-local output establishes origin and integrity under its trust policy; it does not prove that the client supplied a complete or truthful population. Record those limitations separately from the technical result.

The server freezes an approved execution request and writes the job intent and outbox in one authoritative transaction. A dispatcher delivers it to a durable queue. An approved worker image claims an expiring attempt lease with a monotonic fencing token, verifies consumed bytes and performs the job. The result service checks service identity, signature, audience, nonce, expiry, input/protocol/scope pins and active attempt before accepting outputs. Duplicate delivery must have one accepted effect. Cancellation must block stale completion. Infrastructure retries retain the original request and create distinct attempts; changed inputs or protocols create a new run.

Keep workers outside the web request and outside the UI's trust domain. Use resource limits, approved adapters, read-only inputs, scoped short-lived access, controlled egress and per-job isolation. Do not let an uploaded model install packages or choose executable plugins. ONNX still needs sandboxing, and pickle/joblib can execute arbitrary code when loaded. Preserve the current prohibition on untrusted Python deserialization. [Scikit-learn persistence guidance](https://scikit-learn.org/stable/model_persistence.html).

Use a versioned translation layer between hosted 1.1 and external 1.0. Preserve the received external envelope unchanged; store authenticated associations and translated views separately. Compare both paths on analytical golden fixtures for task semantics, support, undefined outcomes, thresholds, test definitions and provenance. A schema-valid result alone cannot establish trustworthy origin.

**2. Register the complete tested system and separate prediction artifacts**

Add an AI system revision linking intended use, model versions, preprocessing, feature schema, decision thresholds, deployment configuration and human decision process. A deployed system may contain several models. A pipeline change can affect behavior even when the model weights remain unchanged.

Model registration should validate ordered typed features, categories, units, null handling, expected outputs, class/probability order, runtime requirements and preprocessing dependencies. Capture a safe input example and perform a small compatibility probe before allowing a planned test. Keep a capability matrix keyed by adapter and runner-image digest: format, task, sparse/text support, probabilities, explanation methods and limits.

Borrow Hugging Face's model-card documentation pattern and use MLflow interoperability for existing client model versions, experiment lineage and typed input/output contracts. Snapshot mutable aliases to exact versions and consumed-byte hashes. A registry import must preserve its source and acquisition time, and must not infer audit approval from client tags. [Hugging Face model cards](https://huggingface.co/docs/hub/en/model-cards), [MLflow registry](https://mlflow.org/docs/latest/ml/model-registry/), [MLflow model signatures](https://mlflow.org/docs/latest/ml/model/signatures/).

Separate a model version from its prediction artifacts. A prediction artifact should identify the producing model/pipeline, source dataset snapshot, inference configuration, run identity and hashes. The same verified model version should support evaluation over several authorized populations and periods without registering a new model merely because its prediction CSV changed. Migration must preserve existing prediction-file lineage and its more limited meaning.

For classical NLP, include fitted vocabulary/vectorizer and text preprocessing in the tested pipeline, then validate sparse inputs, language coverage and per-class performance. Supported formats and tasks must reflect tested adapters, rather than inventory labels.

**3. Make evidence searchable at the assertion level**

Extend existing evidence IDs with exact locations: document page/paragraph, table row range, dataset snapshot/sample, code commit/path/line range or log interval. Each location binds an artifact revision and hash. Extracted text and OCR are derived artifacts with their own parser version, hash and quality limitations; the original remains available.

Represent an assertion's relationship to evidence as supporting, contradicting, missing or superseded. Link assertions to the applicable duty, approved procedure, actual execution, human assessment, finding and report statement. Automatically flag missing support and changes to dependencies. Let the auditor decide sufficiency and the effect of contradictory evidence.

These relationships can use relational tables; a separate graph database is not required initially. The reviewer should open a report statement and see its criterion, actual work, source locations, exceptions and current review status. Reuse earlier evidence only after relevance, period and system-version checks, with an attributed reuse decision.

**4. Collect and reconcile operational evidence**

Build approved read-only collectors for deployment manifests, registry metadata, inference/decision events, monitoring alerts, human overrides, incidents and change approvals. Credentials stay in a scoped service or approved client-local environment. Restrict source queries, record extraction parameters and capture source totals, date boundaries, sequence gaps, duplicate IDs and rejected/excluded records.

An operational procedure should reconcile the expected transaction population to captured events and trace a selected decision through input references, preprocessing/model version, score or output, threshold, final decision and human intervention. Where records permit, replay the same decision against the pinned pipeline and explain differences using an approved numerical tolerance.

The platform's own activity log is distinct from the audited AI system's operational log. Article 12 concerns lifecycle event logging appropriate to the system's purpose; Article 14 concerns human oversight of that system. These require operational evidence beyond metric outputs or reviewer clicks inside the audit platform. [EU AI Act consolidated text, Articles 12 and 14](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727).

**5. Add statistical protocols that support defensible judgments**

Replace sampling declarations alone with reproducible sample manifests: population snapshot/hash, selection method, seed, units, strata, time/group constraints, selected record IDs, inclusion probabilities where relevant and exclusion reasons. Show population reconciliation separately from sample size.

Add subgroup and intersectional performance/fairness, practical effect sizes, uncertainty and calibration. Reuse the external engine's existing Wilson intervals where independent-observation assumptions hold. Add reviewed bootstrap, clustered or temporal procedures as separate capabilities; handle multiple comparisons explicitly. Small or absent subgroup support remains inconclusive. Bootstrapping depends on sample suitability and cannot establish representativeness on its own. [Fairlearn intersectional assessment](https://fairlearn.org/main/user_guide/assessment/intersecting_groups.html), [confidence interval guidance](https://fairlearn.org/v0.13/user_guide/assessment/confidence_interval_estimation.html).

Include leakage checks against entity IDs, temporal cutoffs, exact/near duplicate observations and fitted preprocessing. Cross-validation requires the training recipe and correct grouped/time-aware folds; saved predictions alone do not enable training reproduction. Add SHAP/LIME only with validated background data, runtime compatibility, output semantics and fidelity/stability checks. Domain-approved perturbations need valid joint-feature constraints and an explicit threat model.

Thresholds remain approved engagement criteria with recorded rationale. Keep execution failure, diagnostic failure, unavailable capability and insufficient evidence as distinct states. None becomes an automatic legal conclusion.

**6. Deliver an independently verifiable audit dossier**

Extend the current snapshot download into an authorized dossier containing the rendered report, exact paper/procedure revisions, permitted evidence bytes, diagnostic outputs/plots, provenance, custody records, manifest and standalone verification instructions/tool. Record withheld, externally retained or unavailable evidence explicitly. Reverify all included bytes before sealing.

Sign the sealed manifest using managed versioned keys, include the approved verification trust material and independently anchor the report/event digest. Specify canonical serialization and algorithm versions. Keep report content fixed; corrections and access withdrawal are separate recorded events. Sigstore's bundle pattern illustrates packaging signature verification material alongside an artifact; the implementation must choose a trust model appropriate for confidential client material. [Sigstore bundle documentation](https://docs.sigstore.dev/about/bundle/).

Client and internal dossiers must preserve their separately approved projections. A client release must not acquire internal files because those files are referenced by the full report. Hashes/signatures establish defined integrity and origin properties; they do not establish the correctness of an audit conclusion or qualified-signature status.

**7. Add cited AI assistance to the auditor's current work item**

Useful actions are: summarize selected evidence, locate contradictions, compare versions, draft collection questions, identify unsupported statements and challenge a draft conclusion. Each factual suggestion cites an exact authorized source revision/location. Show missing support and allow the auditor to inspect originals before accepting a draft.

Apply tenant, engagement and audience permissions before retrieval, reranking, caching and tool execution. Treat client documents as untrusted content, not instructions. Store assistant/model/prompt versions, retrieved sources, tool actions and accepted edits. Use approved processing destinations and data minimization. Human users continue to record execution, assess evidence, review, sign and release.

Evaluate citation correctness, unsupported claims, missed contradictions, permission leakage and malicious-document instructions on representative case files before enabling the assistant. Compare review effort and missed exceptions against a measured baseline before claiming time savings. The NIST GenAI profile is a supporting risk-management reference for this additional AI component, not an EU conformity certificate. [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1).

**8. Strengthen production access, storage and operations**

Add explicit internal engagement grants and a separate practice-administration capability. Enforce scope on lists, search, source files, dossier downloads, jobs and callbacks. Preserve independent assignment/review checks. Enterprise identity should support verified stable principals, MFA, revocation and controlled provisioning. Site access and application membership are separate boundaries and both need testing.

Normalize large paper histories, runs, artifacts, assertions and reports incrementally through repository interfaces. Preserve current IDs, approved revisions, signatures and existing snapshot bytes. The PostgreSQL reference design provides useful RLS, custody, outbox and retention structures but needs extensions for the newer workflow records and a migration plan. A successful schema test is not evidence of a deployed production database.

Retain the existing UI and workflow semantics. Introduce narrow execution and dossier services, then migrate persistence as required. Maintain one authoritative job state; a hybrid rollout must use an explicit idempotent bridge rather than assuming a transaction spans D1 and PostgreSQL.

Add telemetry for queue age, attempt failures, ingestion rejection, integrity mismatch, unauthorized access and stalled review work, without raw client data in logs. Demonstrate backup/restore, key rotation, retention/legal hold and incident response. Resource quotas, region choices, security testing and performance targets require validation on the chosen deployed environment.

Extend the reviewed regulatory catalog with typed clause/subitem obligations, responsible actor, trigger facts, dates, source revision and evidence dependencies. Rules suggest applicability and unanswered questions; reviewers approve conclusions/exclusions. Legal/source or system changes create targeted impact-review tasks while historical decisions remain fixed.

**Common records to extend**

| Record | Minimum purpose |
| --- | --- |
| AISystemRevision | Pin intended use, constituent model/pipeline/deployment versions and operational boundary |
| DatasetSnapshot / PredictionArtifact | Separate consumed data, source population and producing inference lineage |
| TestDefinition / RunnerCapability | Version method, required inputs, task eligibility, outcomes and tested runtime capabilities |
| ExecutionRequest / Attempt / ResultEnvelope | Freeze approved work; track leased attempts; authenticate immutable outputs |
| SampleManifest | Reproduce population selection, record inclusions/exclusions and support counts |
| EvidenceLocation / Assertion / EvidenceRelation | Trace a claim to precise supporting and contradictory source material |
| CustodyEvent / AuditDossier | Preserve receipt/use/export history and independently verify the sealed authorized audit file |
| EngagementGrant / ImpactAssessment | Constrain team access and record consequences of changed dependencies |

**Recommended delivery sequence**

| Increment | Concrete outcome | Acceptance before completion |
| --- | --- | --- |
| 1. Trustworthy execution and access | Explicit execution modes, typed input/capability contracts, authenticated result import, approved isolated worker and engagement grants | Analytical fixtures agree across translated contracts; wrong tenant, altered inputs, forged/replayed results and revoked access are rejected |
| 2. Reliable scale and evidence collection | Durable jobs/outbox/leases, object-based large inputs, source extraction and actual sampling manifests | Worker death, duplicate delivery and cancellation cannot create stale/duplicate results; population reconciliation and sample reproduction pass |
| 3. Reviewer-ready dossier | Exact evidence locations, assertion relationships, operational replay and sealed portable packages | Another reviewer traces a report statement to actual work/source and verifies permitted bytes offline; missing/tampered evidence is detected |
| 4. Advanced analytical assistance | Validated uncertainty/slices/explainers, targeted change impact and cited assistant actions | Domain fixtures and independent methodological review pass; assistant confidentiality/citation tests pass; pilot measures quality and effort |

Run these increments against one agreed pilot system and realistic authorized artifacts. Prioritize ONNX/native tree and tabular support that can be validated, then extend to classical NLP and additional runtimes. Security, privacy, independence and source integrity are acceptance requirements from the first increment.

The first business demonstration should show an auditor selecting an approved procedure, validating the actual system/data, launching work without waiting in the browser, receiving a reproducible evidence packet, challenging a contradiction, completing independent review and handing over a verifiable dossier. Measure manual handling effort, reproducibility, source-tracing success, recovery behavior and missed exceptions against the current workflow. More tests become valuable when their results improve those outcomes.
