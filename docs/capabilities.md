# Capability matrix

What the platform does on `main` as of **14 Nov 2026**, after the November 2026 roadmap cycle ([ROADMAP.md](../ROADMAP.md)) and the dead-code sweep of [#37] ([PR #196]), which deletes the `lib/domain.ts` and `lib/workflow-service.ts` barrels. Paths are relative to `site-app/` unless they start with `engine/`, `schemas/`, `templates/` or `docs/`.

**Status** is one of:

- **Implemented**: in the code on `main`, and covered by the tests named in the row. A row with a gap in its tests says so.
- **Implemented, content pending review**: the code ships, but the legal or standards content it carries is marked pending qualified review or draft until the owner actions of [#57] are done ([decisions D-02, D-03, D-17, D-34 and D-37](product/decisions.md)).
- **Specified**: designed in a document in this repository, not built.
- **Planned**: on the [Later list](../ROADMAP.md#later) or the watch list, with neither a design nor code.

Test kinds: **Vitest** files are colocated `*.test.ts(x)` (`npm test`); **harnesses** are `scripts/*-check.mjs`, run against the built Worker in Miniflare (`npm run check:harnesses`); **e2e** specs are `e2e/*.spec.ts`, the Playwright persona suite with axe checks (`npm run test:e2e`); **engine** tests are `engine/tests/test_*.py` (`python -m unittest discover -s engine/tests`). How to run each is in the [README](../README.md#checks).

The platform is a reference implementation for independent AI auditors. It is not a certified or fully hardened compliance service, and a diagnostic result is evidence for an auditor's judgement, not a conformity decision.

## Identity, tenancy and access

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Identity adapter that denies by default: trusts only the source `IDENTITY_MODE` names (`sites`, `cloudflare-access`, loopback `trusted-headers`, `dev`), strips forged `oai-*` headers otherwise, answers 401 with no mode ([#11], D-23) | Implemented | `lib/identity.ts`, `lib/cloudflare-access.ts`, `build/sites-worker.ts`, `build/sites-vite-plugin.ts`; [docs/security/identity.md](security/identity.md) | Vitest `lib/identity.test.ts`, `lib/cloudflare-access.test.ts`, `lib/auth-paths.test.ts`; harness `scripts/identity-check.mjs` |
| Dev personas, persona switch and sign-out on the development server; demo seed through the app's own API | Implemented | `fixtures/dev-personas.json`, `build/sites-vite-plugin.ts`, `app/account-menu.tsx`, `scripts/seed-demo.mjs` | e2e `e2e/seed.setup.ts` (seeds twice to check idempotence) and every spec that signs in as a persona |
| Practice membership and six roles (Auditor, Lead Auditor, Reviewer, Engagement Quality Reviewer, Client Viewer, Client Contributor) plus the practice-admin flag; per-engagement grants for internal roles, client scoping for client roles | Implemented | `lib/tenancy.ts` (`context`, `requireRole`, `requireAdmin`), `lib/domain/types.ts` (`roles`), `lib/access-policy.ts` | Vitest `lib/tenancy.test.ts`; harness `scripts/workspace-access-check.mjs`; e2e `e2e/isolation.spec.ts`, `e2e/cross-tenant.spec.ts` |
| One permission map for every POST op and route action, driving permission-aware buttons with the server's reason ([#35], [#178]) | Implemented | `lib/permissions.ts`, `app/workspace/decision-button.tsx` | Vitest `lib/permissions.test.ts` (compares the map with every dispatcher's roles), `lib/client-consumers.test.ts`; e2e `e2e/self-approval.spec.ts` |
| Access lifecycle: revoke cascades, practice admins, invitations redeemed at sign-in, self-provisioning control (`SELF_SIGNUP`), membership email, lapsed grants ([#12], [#95]) | Implemented | `lib/commands/management/{members,invitations,admins,engagement-grants}.ts`, `lib/invitations.ts` | Vitest `lib/commands/management/dispatcher.test.ts`; harnesses `scripts/access-lifecycle-check.mjs`, `scripts/access-followups-check.mjs`, `scripts/access-adoption-check.mjs`; e2e `e2e/practice-administration.spec.ts` |
| Independence checks on access grants and inbox items; grant history as team membership ([#112], [#127]) | Implemented | `lib/workflow/acceptance.ts`, `lib/access-policy.ts`, `drizzle/0011_quality_review_policy.sql` | Vitest `lib/workflow/acceptance.test.ts`, `lib/access-history-migration.test.ts` |
| Paged, filterable engagement audit trail, and a practice Access log (sign-ins and membership events) with CSV export, for practice administrators with a staff role ([#181], [#185], D-38 to D-42) | Implemented | `app/api/audit-trail/route.ts`, `app/api/access-log/route.ts`, `lib/read-models/audit-trail.ts`, `lib/read-models/access-log.ts`, `lib/access-events.ts`, `app/audit-trail.tsx`, `app/access-log.tsx`, `drizzle/0017_access_log.sql` | Vitest `lib/read-models/audit-trail.test.ts`, `lib/read-models/access-log.test.ts`, `lib/event-log-queries.test.ts`; e2e `e2e/access-log.spec.ts` |
| Platform operator view: list practices, archive a practice with issued work, delete an abandoned one (`PLATFORM_OPERATORS`) ([#95], [#151]) | Implemented | `app/operator/`, `app/api/operator/route.ts`, `lib/operator.ts`, `drizzle/0013_access_followups.sql`, `drizzle/0015_practice_archives.sql` | Vitest `lib/operator.test.ts`; harness `scripts/practice-management-check.mjs` |
| Per-practice SSO, MFA and SCIM; an external-specialist role; break-glass access | Planned | — (the hosting identity provider and [#11]'s adapter are the seam) | — |

## Engagement records and persistence

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Engagement aggregate in D1 with optimistic version checks, append-only snapshots and a hash-chained audit trail; content-addressed blobs in R2 | Implemented | `lib/engagement-repo.ts`, `lib/engagement-storage.ts`, `db/schema.ts`, `drizzle/0000`–`0017` | Vitest `lib/engagement-repo.test.ts`, `lib/engagement-storage.test.ts`, `lib/workflow/persistence.test.ts`; e2e `e2e/stale-versions.spec.ts` |
| Bounded hydration: the engagement list no longer hydrates every engagement, and a corrupt blob isolates its engagement and records an integrity incident; admins see and handle incidents ([#16], [#121], [#151]) | Implemented | `lib/engagement-repo.ts`, `lib/read-models/workspace-view.ts`, `lib/commands/management/incidents.ts`, `app/integrity-incidents.tsx`, `drizzle/0008_integrity_incidents.sql`, `drizzle/0016_incident_handling.sql` | Vitest `lib/read-models/workspace-view.test.ts`; harness `scripts/engagement-integrity-check.mjs` |
| More than 1,000 assurance records per engagement, with SQL gates and cursor paging; paged workbench registers and server-side review-queue search ([#17], [#81]) | Implemented | `lib/assurance-store.ts`, `lib/assurance-query.ts`, `lib/assurance-search.ts`, `lib/read-models/assurance-view.ts` | Vitest `lib/assurance-store.test.ts`, `lib/assurance-query.test.ts`, `lib/assurance-search.test.ts`; harness `scripts/workbench-scale-check.mjs` |
| Engagement metadata limit of 1.5 MB, refusing a whole write that would exceed it (D-15) | Implemented | `lib/workflow-state.ts` (`metadataLimit`) | Vitest `lib/workflow-state.test.ts` |
| Normalised PostgreSQL store with row-level security | Specified, superseded | `db/postgres.sql` (a v0 design, superseded by D-13: the platform stays on D1). Its RLS tests were never committed (F-78) | — |

## Audit workflow

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Engagement brief and audit program: prepare, submit, return, independent approval; scope decisions with reasons; plan hashes bind executed work so plan edits invalidate only what they change; returns-only submission limits ([#13], D-15) | Implemented | `lib/workflow/brief-program.ts`, `lib/workflow/dispatch.ts`, `lib/commands/workflow.ts`, `app/audit-program/` | Vitest `lib/workflow/brief-program.test.ts`, `lib/workflow/dispatch.test.ts`, `lib/workflow-state.test.ts`; e2e `e2e/scope-and-program.spec.ts` |
| Procedures: execute, evaluate, compile paper, review with returns, sign; run retries, active-job guards and sample pins bound to the procedure plan ([#69], [#105]) | Implemented | `lib/workflow/procedures.ts`, `lib/procedure-readiness.ts`, `app/audit-program/procedure-*.tsx` | Vitest `lib/workflow/procedures.test.ts`, `lib/procedure-readiness.test.ts`, `lib/active-job-guard.test.ts`; harness `scripts/engagement-lifecycle-check.mjs` |
| Working papers with revisions, review comments, separation of duties (no self-review; signer differs from reviewer), retired orphans and release-time records that never gate capture ([#14], [#94]) | Implemented | `lib/paper-workflow.ts`, `lib/papers/revision.ts`, `lib/papers/completion.ts`, `lib/commands/papers.ts`, `lib/domain/release-time.ts`, `app/paper-editor.tsx` | Vitest `lib/paper-workflow.test.ts`, `lib/papers/revision.test.ts`, `lib/commands/papers.test.ts`; e2e `e2e/auditor-prepares-paper.spec.ts`, `e2e/reviewer-reviews-paper.spec.ts`, `e2e/self-review.spec.ts`, `e2e/release-time-records.spec.ts` |
| Attested decisions: signing, classification approval, stage moves, evidence acceptance and finding closure open a dialog that binds a rationale and a SHA-256 of the content ([#35]) | Implemented | `lib/attestation.ts`, `app/workspace/attestation-dialog.tsx` | Vitest `lib/attestation.test.ts`, `app/workspace/attestation-dialog.test.tsx` |
| Acceptance, independence and competence gate before fieldwork; declarations whose disqualifying relationships carry across periods (D-28) ([#23]) | Implemented | `lib/workflow/acceptance.ts`, `lib/workflow/acceptance-commands.ts`, `app/audit-program/acceptance-panel.tsx` | Vitest `lib/workflow/acceptance.test.ts` |
| Engagement Quality Reviewer: read-only role with a stand-back checklist and package sign-off, cooling-off policy per practice, signer re-check at release (D-31) ([#24], [#127]) | Implemented | `lib/domain/quality-review.ts`, `lib/commands/quality-review.ts`, `lib/quality-review-policy.ts`, `lib/quality-review-records.ts`, `app/quality-review-panel.tsx` | Vitest `lib/domain/quality-review.test.ts`, `lib/commands/quality-review.test.ts`; e2e `e2e/quality-reviewer.spec.ts` |
| Stage gates from Planning to Sign-off, with no skipping or moving back | Implemented | `lib/domain/gates.ts` | Vitest `lib/domain/gates.test.ts` |
| Findings with risk rating, remediation, independent retest and closure; criteria references on findings ([#61]) | Implemented | `lib/finding-workflow.ts`, `lib/commands/findings.ts`, `lib/workflow/finding-assurance.ts`, `lib/domain/risk.ts` | Vitest `lib/workflow/finding-assurance.test.ts`, `lib/commands/dispatcher.test.ts`; harness `scripts/engagement-lifecycle-check.mjs` |
| Monitoring and follow-up cases | Implemented | `lib/workflow/monitoring.ts`, `app/audit-program/followup-panel.tsx` | Vitest `lib/workflow/monitoring.test.ts`, `lib/workflow/monitoring-commands.test.ts` |
| My work inbox with team workload, snooze and paging | Implemented | `lib/work-inbox.ts`, `lib/work-items.ts`, `app/api/work-inbox/route.ts`, `app/work-inbox.tsx` | Vitest `lib/work-inbox.test.ts`, `lib/work-items.test.ts`, `app/api/work-inbox/route.test.ts`; harness `scripts/work-inbox-api-check.mjs` |
| Recovery drafts that stop retrying after a conflict ([#76]) | Implemented | `lib/workspace-state.ts`, `app/api/workspace-state/route.ts`, `app/recoverable-draft.tsx` | Vitest `app/recoverable-draft.test.ts` |

## Evidence and client collaboration

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Evidence vault: uploads up to 50 MB to R2 under engagement-scoped keys with SHA-256, acceptance disposition, preview and hashed download | Implemented; the 50 MB limit itself has no test | `app/api/evidence/route.ts`, `app/evidence-workspace.tsx`, `lib/evidence-presentation.ts` | Vitest `lib/evidence-presentation.test.ts`; harness `scripts/engagement-lifecycle-check.mjs` (custody); e2e `e2e/client-viewer.spec.ts` |
| Evidence requests and time-boxed client grants; client contributor deliveries of 1–10 files up to 10 MB in total | Implemented | `lib/evidence-requests.ts`, `lib/workflow/client-grants.ts`, `lib/commands/evidence-requests.ts`, `app/api/client-submission/route.ts` | Vitest `lib/evidence-requests.test.ts`, `lib/workflow/client-grants.test.ts`, `lib/workflow/client-grant-commands.test.ts`; e2e `e2e/evidence-requests.spec.ts`, `e2e/client-contributor.spec.ts` |
| Client portal shell: client roles see only their projection, without practice navigation; Contributors get no Findings destination (D-39) ([#36], [#182]) | Implemented | `app/workspace/client-portal-shell.tsx`, `app/client-portal.tsx`, `lib/client-projection.ts` | Vitest `app/workspace/client-portal-shell.test.tsx`, `lib/client-projection.test.ts`, `app/workspace/views/client-overview.test.ts`; e2e `e2e/client-viewer.spec.ts`, `e2e/client-contributor.spec.ts` |
| Upload malware scanning and evidence retention controls | Planned | — | — |

## Regulatory content and classification

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Rule pack 2026.11.2: per-provision dates, the 2 Dec 2026 milestones, the EN 18286 standards register, version stamps on engagements and reports ([#18], [#77]) | Implemented, content pending review | `lib/rule-pack.ts`, `templates/catalog.json` (`regulatorySnapshot`), `schemas/rule-pack.schema.json`; research in [docs/research/rule-pack-2026-11.md](research/rule-pack-2026-11.md) | Vitest `lib/rule-pack.test.ts`, `lib/rule-pack-schema.test.ts`, `lib/rule-pack-stamps.test.ts`; `node schemas/validate-rule-pack.mjs` |
| Classification v2: tri-state facts, enumerated Art 5 practices, GPAI roles, Art 50 triggers, independent approval; re-review items and trigger suggestions ([#19], [#104]) | Implemented | `lib/domain/classification.ts`, `lib/classification-rules.ts`, `lib/commands/classification.ts`, `app/workspace/views/classification-panel.tsx` | Vitest `lib/domain/classification.test.ts`; harness `scripts/engagement-lifecycle-check.mjs`; e2e `e2e/classification.spec.ts` |
| Art 50 working papers (WP-XC-07, WP-XC-10 to WP-XC-12), applicability suggested from the classification, structured Art 50 criteria, readiness by period ([#78], [#120], [#152]) | Implemented, content pending review | `lib/domain/art50-papers.ts`, `lib/art50-criteria.ts`, `lib/art50-criteria.json`, `app/audit-program/art50-plan.tsx`, `app/audit-program/art50-suggestion.ts`; research in [docs/research/art50-transparency-2026-11.md](research/art50-transparency-2026-11.md) | Vitest `lib/domain/art50-papers.test.ts`, `lib/art50-criteria.test.ts`, `lib/art50-research.test.ts`, `lib/catalog-art50.test.ts`, `app/audit-program/art50-plan.test.tsx`, `app/audit-program/art50-suggestion.test.ts`; `node schemas/validate-art50-research.mjs`; e2e `e2e/art50-paper-suggestion.spec.ts` |
| Annex IV nine-section evidence map, generated from the default criteria pack ([#61]) | Implemented | `lib/annex-iv.ts`, `templates/annex-iv-map.json` (generated) | Vitest `lib/annex-iv.test.ts` |
| Generative-AI limitation stated only for generative or GPAI-based systems without supported GenAI evidence (D-01, [#80]) | Implemented | `lib/genai/limitation.ts` | Vitest `lib/genai/genai.test.ts` |

## Criteria model and framework packs

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Frameworks, engagement packs and typed crosswalks as data; AI Act pack #1; explicit pins and framework stamps in reports ([#27], [#61]) | Implemented | `templates/criteria/`, `lib/criteria/registry.ts`, `lib/criteria/pin.ts`, `lib/criteria/projection.ts`, `lib/criteria/bundle.generated.json` (generated); design in [docs/design/criteria-model.md](design/criteria-model.md) | Vitest `lib/criteria/registry.test.ts`, `lib/criteria/phase2.test.ts`, `lib/criteria/legacy-golden.test.ts`, `lib/criteria/validate-criteria.test.ts`; harness `scripts/criteria-pins-check.mjs`; `node schemas/validate-criteria.mjs` |
| Coverage summary and heatmap, filters by actor and date, CSV export, requirement-level applicability from the rule pack ([#27], [#135]) | Implemented | `lib/criteria/coverage.ts`, `lib/criteria/coverage-filters.ts`, `lib/criteria/applicability.ts`, `app/api/coverage/route.ts`, `lib/read-models/coverage-view.ts`, `app/workspace/views/criteria-coverage.tsx` | Vitest `lib/criteria/coverage.test.ts`, `lib/criteria/coverage-filters.test.ts`, `lib/criteria/coverage-properties.test.ts`, `lib/criteria/applicability.test.ts`; e2e `e2e/coverage-filters.spec.ts` |
| Pack #2, EN 18286 + ISO/IEC 42001 management-system audit, with certification defaults and pack clauses in findings ([#28], [#144]) | Implemented, content pending review (ships as drafts, D-37) | `templates/criteria/packs/`, `lib/domain/management-system.ts`, `lib/commands/management-system.ts`, `app/workspace/views/management-system.tsx` | Vitest `lib/criteria/management-system-pack.test.ts`, `app/workspace/views/management-system.test.tsx`, `lib/criteria/pack-followups.test.ts`; e2e `e2e/pack-features.spec.ts` |
| NIST AI RMF 1.0 and AI 600-1 frameworks with crosswalks, including the GenAI evaluation pack's links to AI 600-1 risks ([#29], [#161]) | Implemented | `templates/criteria/frameworks/`, `templates/criteria/crosswalks/` | Vitest `lib/criteria/nist-crosswalk.test.ts` |
| NYC Local Law 144 bias audit: impact-ratio computations, pack, per-group runs and a publishable summary page ([#30], [#144]) | Implemented, content pending review (released, D-34) | `lib/ll144.ts`, `lib/ll144-audit.ts`, `lib/commands/ll144.ts`, `app/ll144-panel.tsx`, `app/ll144-summary/`, `app/api/ll144-summary/route.ts`, `lib/read-models/ll144-summary.ts`, `engine/ll144.py` | Vitest `lib/ll144.test.ts`, `lib/commands/ll144.test.ts`, `lib/criteria/ll144-pack.test.ts`, `app/ll144-summary/summary-render.test.tsx`; engine `engine/tests/test_ll144.py` |
| Criteria-model phase 3 (repin with diff, impact review, revert) and phase 6 (OSCAL export, tenant default and tenant-authored packs) | Specified | [docs/design/criteria-model.md](design/criteria-model.md) | — |
| Colorado, CCPA ADMT and Illinois packs; a deployer pack with an Art 27 FRIA template; AIUC-1 and SOC 2 + AI packs | Planned | — | — |

## Evaluation and statistics

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Testing lab: model registry, reusable protocols, dataset cards, hosted diagnostics in the Worker (at most 10,000 rows, 200 columns and 50 groups; binary, multiclass and regression; demographic parity, impact ratio, equalized odds), auto-drafted papers ([#15], [#67]) | Implemented | `lib/diagnostics.ts`, `lib/evaluation-service.ts`, `lib/evaluation.ts`, `lib/dataset-card.ts`, `lib/commands/runs.ts`, `app/testing-lab/` | Vitest `lib/diagnostics.test.ts`, `lib/evaluation-service.test.ts`, `lib/dataset-card.test.ts`, `lib/commands/runs.test.ts`; harness `scripts/engagement-lifecycle-check.mjs`; e2e `e2e/testing-lab.spec.ts` |
| Statistics that decide outcomes: intervals (Katz-log with Koopman fallback), exact tests, Bonferroni families, pre-registered decision rules, chance and mean-prediction baselines, in the engine and the hosted runner with shared golden files (D-04, D-05, D-19, D-26, D-30) ([#9], [#21], [#22], [#68], [#136]) | Implemented | `engine/statistics.py`, `lib/statistics.ts`, `lib/hosted-statistics.ts`, `lib/external-decision-rule.ts`; design in [docs/design/audit-statistics.md](design/audit-statistics.md) | Engine `engine/tests/test_statistics_golden.py`, `engine/tests/test_statistics_end_to_end.py`, `engine/tests/test_performance_rules.py`; Vitest `lib/statistics.test.ts`, `lib/hosted-statistics.test.ts`, `lib/hosted-evaluation.test.ts`, `lib/performance-rules-golden.test.ts`, `lib/external-decision-rule.test.ts` |
| Cluster-bootstrap decisions for clustered plans and bootstrap sensitivity intervals for MAE and RMSE ([#93], [#136]) | Implemented | `engine/statistics.py`, `lib/hosted-statistics.ts` | Engine `engine/tests/test_cluster_bootstrap.py`; Vitest `lib/hosted-statistics.test.ts` |
| Power checks (including multiclass and macro F1), one threshold library, intersectional strata ([#113], [#152]) | Implemented | `app/power-check.tsx`, `app/power-assumptions.ts`, `lib/threshold-library.json`, `engine/threshold-library.json`, `schemas/threshold-library.json` | Vitest `app/power-assumptions.test.ts`; engine `engine/tests/test_multiclass_power.py`, `engine/tests/test_threshold_library.py` |
| Art 4a gate: record the legal basis before special-category data reaches the platform, including Parquet, spreadsheet and UTF-16 uploads (D-11) ([#60], [#103]) | Implemented, content pending review (LR-06) | `lib/special-category.ts`, `lib/commands/special-category.ts`, `lib/dataset-header.ts`, `app/special-category.tsx` | Vitest `lib/special-category.test.ts`, `app/special-category.test.ts`, `lib/dataset-header.test.ts` |
| Client-local external jobs on a client-held SHA-256 pin, with a pin tool, queue-time column checks, client attestation and small-group suppression (D-32, D-33) ([#102], [#134], [#166]) | Implemented | `engine/client_pin.py`, `lib/commands/assurance/execution.ts`, `lib/external-worker-contract.ts` | Engine `engine/tests/test_client_pin.py`; Vitest `lib/commands/assurance/execution.test.ts`, `lib/external-worker-contract.test.ts` |
| Interval-based drift decisions; fairness for multiclass and regression models; counterfactual and monotonicity tests; an engine validation dossier per release | Planned | — (drift stays point-estimate screening, D-06) | — |

## External execution and the Python engine

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| External job queue with fenced leases; runner enrolment with hashed bearer tokens; only jobs the worker can run are queued, and failures are explained ([#58]) | Implemented | `app/api/runner/route.ts`, `lib/commands/assurance/workers.ts`, `lib/commands/assurance/execution.ts`, `lib/worker-failures.ts` | Vitest `app/api/runner/route.test.ts`, `lib/worker-failures.test.ts`, `lib/commands/assurance/dispatcher.test.ts`; harness `scripts/assurance-integration-check.mjs` |
| Python pull worker (child process or digest-pinned Docker) robust to bad jobs, slow transfers and contract drift ([#10]) | Implemented | `engine/worker.py`, `engine/worker_contract.py`, `engine/contract.py`; [engine/WORKER.md](../engine/WORKER.md) | Engine `engine/tests/test_worker.py` |
| Diagnostics CLI, read-only SQL extraction, optional model adapters (ONNX, PMML, tree runtimes where installed) | Implemented; the optional runtimes are not in the default image | `engine/diagnostics.py`, `engine/model_diagnostics.py`, `engine/connectors.py`, `engine/optional_adapters.py`; [engine/README.md](../engine/README.md) | Engine `engine/tests/test_diagnostics.py`, `engine/tests/test_connectors_adapters.py` |
| Portable runtime package and offline verifier; one supported Python (3.12), `cryptography` and zstd in the compute image ([#62]) | Implemented | `engine/package_runtime.py`, `public/tools/assurance-runtime.zip` and `public/tools/assurance-verifier.py` (generated), `engine/Dockerfile` | Engine `engine/tests/test_package_runtime.py`, `engine/tests/test_packaging.py` |
| Registry import and a cited assistant (drafts with citations, never decisions) | Implemented | `engine/registry_import.py`, `engine/cited_assistant.py`, `lib/commands/assurance/assistant.ts` | Engine `engine/tests/test_registry_import.py`, `engine/tests/test_cited_assistant.py`; Vitest `lib/commands/assurance/assistant.test.ts` |
| Run provenance and plan hashes on external jobs and samples ([#105]) | Implemented | `engine/provenance.py`, `lib/commands/assurance/execution.ts` | Engine `engine/tests/test_provenance.py`; Vitest `lib/active-job-guard.test.ts` |
| Native-runtime golden-model tests, SHAP or LIME explanations, training reproduction, adversarial evaluations, inference-log connectors | Planned | — | — |

## GenAI evaluation evidence

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Ingest and recompute evaluation evidence from Inspect, lm-eval-harness, promptfoo and garak (plus PyRIT through its own export contract), never executing ingested code ([#32]) | Implemented | `engine/genai/`; [engine/GENAI.md](../engine/GENAI.md); design in [docs/design/genai-evidence.md](design/genai-evidence.md) | Engine `engine/tests/test_genai_parsers.py`, `engine/tests/test_genai_recompute.py`, `engine/tests/test_genai_security.py`, `engine/tests/test_genai_fuzz.py`, `engine/tests/test_genai_properties.py`, `engine/tests/test_genai_envelope.py` |
| `genai_ingest` worker job, signed marking-detection results, C2PA reports and inert excerpts ([#128]) | Implemented | `engine/genai/`, `engine/worker.py`, `lib/commands/assurance/genai.ts` | Engine `engine/tests/test_genai_worker.py`, `engine/tests/test_genai_marking_sources.py`; Vitest `lib/commands/assurance/genai.test.ts` |
| GenAI evidence in the workspace: intake, evidence levels (also in the vault), results, judge-validation floors (D-10, D-16), re-run attestation and a readiness gate ([#33], [#145]) | Implemented | `lib/genai/`, `lib/read-models/genai-view.ts`, `app/genai-evidence.tsx`, `app/workspace/use-genai-levels.ts` | Vitest `lib/genai/genai.test.ts`, `lib/genai/evidence-levels.test.ts`, `lib/genai/labels.test.ts`, `lib/workflow/genai-gate.test.ts`, `app/genai-evidence.test.tsx`; e2e `e2e/genai-evidence.spec.ts` |
| Signed L3 attestations and worker-executed re-runs; multi-gigabyte agent logs; an unpaired two-sample criterion | Planned | — | — |

## Reporting, release and integrity

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Report model v2: engagement type, assurance level and ISAE 3000 conclusion types, with our own wording; readiness with gaps; firm-level report settings ([#20], [#111]) | Implemented, content pending review (practitioner review in [#57]) | `lib/domain/report-model.ts`, `lib/domain/report-gates.ts`, `lib/report-settings.ts`, `drizzle/0010_practice_report_settings.sql` | Vitest `lib/domain/report-model.test.ts`, `lib/domain/report-gates.test.ts`; e2e `e2e/report-settings.spec.ts` |
| Fixed report snapshots, approval by someone other than the creator, release by someone other than the approver, automatic supersession, withdrawal, client notification; packages captured before v2 are recaptured (D-27) ([#14], [#94]) | Implemented | `lib/workflow/report-release.ts`, `lib/commands/reports.ts`, `lib/report-package.ts`, `app/api/report-package/route.ts`, `app/audit-program/report-release.tsx` | Vitest `lib/workflow/report-release.test.ts`, `lib/workflow/report-release-commands.test.ts`, `lib/commands/reports.test.ts`, `lib/report-package.test.ts`; e2e `e2e/report-release.spec.ts` |
| Server-rendered print view of a report | Implemented | `app/report/page.tsx`, `app/report/report-markup.tsx` | Vitest `app/report/report-render.test.tsx` |
| Ed25519-signed dossiers per audience, scoped exports for large files, wrapped practice keys (`DOSSIER_KEK`) and admin-only rotation; offline verification ([#25], [#83]) | Implemented | `lib/dossier.ts`, `lib/dossier-scope.ts`, `lib/signing-keys.ts`, `app/api/dossier/route.ts`, `app/api/dossier/keys/route.ts`, `engine/assurance.py`; [docs/security/signing-keys.md](security/signing-keys.md) | Vitest `lib/signing-keys.test.ts`, `lib/dossier-scope.test.ts`; harness `scripts/signing-keys-check.mjs`; engine `engine/tests/test_assurance.py`; e2e `e2e/dossier.spec.ts` |
| Paper, memo and dataset-card exports mapped to the canonical schemas; stored dataset cards validated; exported papers shown ([#51], [#137]) | Implemented | `lib/papers/export.ts`, `lib/dataset-card.ts`, `app/exported-papers.tsx`, `schemas/working-paper.schema.json`, `schemas/dataset-card.schema.json` | Vitest `lib/papers/export.test.ts`, `lib/dataset-card-contract.test.ts`, `app/exported-papers.test.tsx`; `npm run check:fixtures` |
| RFC 3161 timestamps, qualified signatures, public report verification, WORM storage; KEK rotation and published key history ([#25] follow-ups) | Planned | — | — |

## Assurance workbench

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Append-only assurance records: systems, sources, assessments, impact, access events, audit sampling with reproducible draws (blank rows rejected), and aggregate outcomes for imported runs ([#66]) | Implemented | `lib/assurance-core.ts`, `lib/assurance-store.ts`, `lib/commands/assurance/`, `lib/python-random.ts`, `app/assurance-workbench/` | Vitest `lib/assurance-store.test.ts`, `lib/commands/assurance/dispatcher.test.ts`, `lib/python-random.test.ts`, `lib/workbench-presentation.test.ts`; harness `scripts/assurance-integration-check.mjs`; e2e `e2e/assurance-workbench.spec.ts` |

## Workspace and accessibility

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| Workspace shell with URL state, navigation guards for unsaved work, one cached assurance query, per-view loading states and error boundaries ([#5], [#63], [#35]) | Implemented | `app/workspace/` (shell, hooks, modals, views), `lib/fetch-json.ts` | Vitest `app/workspace/workspace-url.test.ts`, `app/workspace/navigation-guards.test.ts`, `app/workspace/panels.test.tsx`, `lib/fetch-json.test.ts` |
| WCAG AA fixes and whole-page axe checks on the views each persona flow visits ([#34], [#36]) | Implemented | `e2e/a11y.ts` | e2e `e2e/accessibility.spec.ts` and every spec through `e2e/a11y.ts` |

## Repository and tooling

| Capability | Status | Implemented in | Tests |
|---|---|---|---|
| One source of truth: the root `schemas/`, `templates/`, `engine/` and `docs/obligation-subitems.json` are canonical, and generated copies in `site-app/` are checked (D-14) ([#3]) | Implemented | `scripts/sync-generated.mjs` | `npm run check:sync` |
| CI with the `engine`, `web` and `e2e` jobs; a warning-free build; lint with no warnings ([#1]) | Implemented; GitHub Actions has been refused since 14 Nov 2026 for an account billing problem ([#57]) | `.github/workflows/ci.yml`, `scripts/strict-build.mjs`, `scripts/run-checks.mjs` | `npm run check` |
| Idempotent local D1 migrations | Implemented | `scripts/db-migrate-local.mjs` | used by `e2e/server.mjs` on every e2e run |
| Dependabot or CodeQL; `npm audit` in CI | Planned (F-60) | — | — |

## Older documents and historical paths

The dated documents in `docs/` (5 to 8 October 2026: the architecture, methodology increments, UX updates and validation record) describe earlier increments. Each now carries a banner saying it is superseded for status by this matrix. Design and research documents (`docs/design/`, `docs/research/`) and the [codebase map](engineering/codebase-map.md)'s snapshot sections cite paths as they were when written. These paths have since moved:

| Historical path | Now |
|---|---|
| `lib/store.ts` | `lib/http.ts`, `lib/tenancy.ts`, `lib/engagement-repo.ts`, `lib/factories.ts`, `lib/ids.ts`, `lib/bindings.ts` ([#4], [#70]) |
| `lib/domain.ts` | `lib/domain/` (`types.ts`, `classification.ts`, `risk.ts`, `gates.ts` and others) ([#6], [#37]) |
| `lib/workflow-service.ts` | `lib/workflow/dispatch.ts` (`workflowOps`, `workflowCommand`), over the `lib/workflow/` modules ([#6], [#37]) |
| `app/workspace.tsx` | `app/workspace/` ([#5]) |
| `app/audit-program.tsx`, `app/assurance-workbench.tsx`, `app/testing-lab.tsx` | `app/audit-program/`, `app/assurance-workbench/`, `app/testing-lab/`; each old file is a re-export of its directory's entry ([#64]) |
| `app/api/workspace/route.ts` ops, `app/api/assurance/route.ts`, `app/api/management/route.ts` | `lib/commands/`, `lib/commands/assurance/`, `lib/commands/management/`; GETs in `lib/read-models/` ([#4], [#50]) |
| `site-app/reference/` | removed; the root folders are canonical ([#3]) |

[PR #196]: https://github.com/ahed-jneed/ai-assurance/pull/196
[#1]: https://github.com/ahed-jneed/ai-assurance/issues/1
[#3]: https://github.com/ahed-jneed/ai-assurance/issues/3
[#4]: https://github.com/ahed-jneed/ai-assurance/issues/4
[#5]: https://github.com/ahed-jneed/ai-assurance/issues/5
[#6]: https://github.com/ahed-jneed/ai-assurance/issues/6
[#9]: https://github.com/ahed-jneed/ai-assurance/issues/9
[#10]: https://github.com/ahed-jneed/ai-assurance/issues/10
[#11]: https://github.com/ahed-jneed/ai-assurance/issues/11
[#12]: https://github.com/ahed-jneed/ai-assurance/issues/12
[#13]: https://github.com/ahed-jneed/ai-assurance/issues/13
[#14]: https://github.com/ahed-jneed/ai-assurance/issues/14
[#15]: https://github.com/ahed-jneed/ai-assurance/issues/15
[#16]: https://github.com/ahed-jneed/ai-assurance/issues/16
[#17]: https://github.com/ahed-jneed/ai-assurance/issues/17
[#18]: https://github.com/ahed-jneed/ai-assurance/issues/18
[#19]: https://github.com/ahed-jneed/ai-assurance/issues/19
[#20]: https://github.com/ahed-jneed/ai-assurance/issues/20
[#21]: https://github.com/ahed-jneed/ai-assurance/issues/21
[#22]: https://github.com/ahed-jneed/ai-assurance/issues/22
[#23]: https://github.com/ahed-jneed/ai-assurance/issues/23
[#24]: https://github.com/ahed-jneed/ai-assurance/issues/24
[#25]: https://github.com/ahed-jneed/ai-assurance/issues/25
[#27]: https://github.com/ahed-jneed/ai-assurance/issues/27
[#28]: https://github.com/ahed-jneed/ai-assurance/issues/28
[#29]: https://github.com/ahed-jneed/ai-assurance/issues/29
[#30]: https://github.com/ahed-jneed/ai-assurance/issues/30
[#32]: https://github.com/ahed-jneed/ai-assurance/issues/32
[#33]: https://github.com/ahed-jneed/ai-assurance/issues/33
[#34]: https://github.com/ahed-jneed/ai-assurance/issues/34
[#35]: https://github.com/ahed-jneed/ai-assurance/issues/35
[#36]: https://github.com/ahed-jneed/ai-assurance/issues/36
[#37]: https://github.com/ahed-jneed/ai-assurance/issues/37
[#50]: https://github.com/ahed-jneed/ai-assurance/issues/50
[#51]: https://github.com/ahed-jneed/ai-assurance/issues/51
[#57]: https://github.com/ahed-jneed/ai-assurance/issues/57
[#58]: https://github.com/ahed-jneed/ai-assurance/issues/58
[#60]: https://github.com/ahed-jneed/ai-assurance/issues/60
[#61]: https://github.com/ahed-jneed/ai-assurance/issues/61
[#62]: https://github.com/ahed-jneed/ai-assurance/issues/62
[#63]: https://github.com/ahed-jneed/ai-assurance/issues/63
[#64]: https://github.com/ahed-jneed/ai-assurance/issues/64
[#66]: https://github.com/ahed-jneed/ai-assurance/issues/66
[#67]: https://github.com/ahed-jneed/ai-assurance/issues/67
[#68]: https://github.com/ahed-jneed/ai-assurance/issues/68
[#69]: https://github.com/ahed-jneed/ai-assurance/issues/69
[#70]: https://github.com/ahed-jneed/ai-assurance/issues/70
[#76]: https://github.com/ahed-jneed/ai-assurance/issues/76
[#77]: https://github.com/ahed-jneed/ai-assurance/issues/77
[#78]: https://github.com/ahed-jneed/ai-assurance/issues/78
[#80]: https://github.com/ahed-jneed/ai-assurance/issues/80
[#81]: https://github.com/ahed-jneed/ai-assurance/issues/81
[#83]: https://github.com/ahed-jneed/ai-assurance/issues/83
[#93]: https://github.com/ahed-jneed/ai-assurance/issues/93
[#94]: https://github.com/ahed-jneed/ai-assurance/issues/94
[#95]: https://github.com/ahed-jneed/ai-assurance/issues/95
[#102]: https://github.com/ahed-jneed/ai-assurance/issues/102
[#103]: https://github.com/ahed-jneed/ai-assurance/issues/103
[#104]: https://github.com/ahed-jneed/ai-assurance/issues/104
[#105]: https://github.com/ahed-jneed/ai-assurance/issues/105
[#111]: https://github.com/ahed-jneed/ai-assurance/issues/111
[#112]: https://github.com/ahed-jneed/ai-assurance/issues/112
[#113]: https://github.com/ahed-jneed/ai-assurance/issues/113
[#120]: https://github.com/ahed-jneed/ai-assurance/issues/120
[#121]: https://github.com/ahed-jneed/ai-assurance/issues/121
[#127]: https://github.com/ahed-jneed/ai-assurance/issues/127
[#128]: https://github.com/ahed-jneed/ai-assurance/issues/128
[#134]: https://github.com/ahed-jneed/ai-assurance/issues/134
[#135]: https://github.com/ahed-jneed/ai-assurance/issues/135
[#136]: https://github.com/ahed-jneed/ai-assurance/issues/136
[#137]: https://github.com/ahed-jneed/ai-assurance/issues/137
[#144]: https://github.com/ahed-jneed/ai-assurance/issues/144
[#145]: https://github.com/ahed-jneed/ai-assurance/issues/145
[#151]: https://github.com/ahed-jneed/ai-assurance/issues/151
[#152]: https://github.com/ahed-jneed/ai-assurance/issues/152
[#161]: https://github.com/ahed-jneed/ai-assurance/issues/161
[#166]: https://github.com/ahed-jneed/ai-assurance/issues/166
[#178]: https://github.com/ahed-jneed/ai-assurance/issues/178
[#181]: https://github.com/ahed-jneed/ai-assurance/issues/181
[#182]: https://github.com/ahed-jneed/ai-assurance/issues/182
[#185]: https://github.com/ahed-jneed/ai-assurance/issues/185
