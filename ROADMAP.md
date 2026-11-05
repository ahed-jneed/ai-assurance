# Roadmap

The plan for the current cycle, set on 5 November 2026. The [product direction](docs/product/direction.md) says what we are building and why. The [research record](docs/research/2026-11/README.md) holds the evidence behind it, and the [codebase map](docs/engineering/codebase-map.md) describes the code the plan starts from (commit `74c6463`).

Issue status lives on GitHub, and the issues are the source of truth for scope. This file records the plan and its order; [#38] updates it with the outcome at the end of the cycle.

## Milestones

| Milestone | Goal | Issues |
|---|---|---|
| [M0 Foundation](https://github.com/ahed-jneed/ai-assurance/milestone/1) | CI pipeline, formatting and lint baseline, warning-free build, repo hygiene. Must land before parallel feature work. | 6 |
| [M1 Defensible core](https://github.com/ahed-jneed/ai-assurance/milestone/2) | Correctness, security and legal currency: verified bug fixes, identity hardening, rule pack 2026.11, report model v2, audit-grade statistics, independence and quality review. | 18 |
| [M2 Multi-framework and GenAI evidence](https://github.com/ahed-jneed/ai-assurance/milestone/3) | Criteria as data with typed crosswalks, EN 18286 + ISO/IEC 42001 and NYC LL144 packs, NIST AI RMF crosswalk, GenAI evaluation evidence ingestion. | 8 |
| [M3 Release readiness](https://github.com/ahed-jneed/ai-assurance/milestone/4) | End-to-end persona tests, UX and accessibility hardening, dead-code removal, documentation that matches the code, final verification. | 6 |

In the tables below, "Depends on" lists the issues that must merge first, as each issue states. "Findings" lists the codebase-review finding ids that the issue quotes ([codebase map](docs/engineering/codebase-map.md) section 3.3 groups all of them by area). F-75, which asks every issue to delete the dead code it touches, is left out.

### M0 Foundation

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#1] | Foundation: CI pipeline, Prettier baseline, zero-warning lint and build. **Merged** with [PR #2] on 5 Nov 2026 | P0 | — | none quoted; [PR #2] addressed F-01, F-11, F-12 and F-13 and parts of F-14, F-15, F-17, F-18, F-47 and F-76 |
| [#3] | Single source of truth for contracts and methodology data; remove `site-app/reference` | P0 | [#1] | F-14, F-22, F-50, F-77 |
| [#4] | Refactor: split `lib/store.ts` and the `/api/workspace` command bus into modules | P0 | [#1] | — |
| [#5] | Refactor: split `app/workspace.tsx` into a workspace shell, data hooks, modal host and views | P0 | [#1] | F-07, F-33, F-48 |
| [#6] | Refactor: split `lib/domain.ts` and `lib/workflow-service.ts` into cohesive modules | P0 | [#1] | F-20 |
| [#7] | Docs: record the product direction, roadmap and research behind it (this roadmap and the docs it links) | P1 | — | — |

### M1 Defensible core

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#8] | Research: verify EU AI Act milestones and EN 18286 status for rule pack 2026.11 | P0 | — | F-51 |
| [#9] | Design: audit-grade statistics specification with hand-computed golden cases | P0 | — | — |
| [#10] | Engine: make the external worker robust to bad jobs, slow transfers and contract drift | P1 | — | F-10, F-21, F-34, F-35, F-36, F-37, F-39, F-59, F-67 |
| [#11] | Security: identity adapter that rejects forged identity headers, plus dev personas and sign-out | P0 | [#4] | F-02, F-19, F-25, F-53 |
| [#12] | Security: access lifecycle — revoke cascades, practice admins, invitations, self-provisioning control | P1 | [#11] | F-09, F-24, F-43, F-44, F-56 |
| [#13] | Bug: plan edits invalidate all executed work, and program history caps lock engagements | P1 | [#6] | F-04, F-29, F-64 |
| [#14] | Bug: orphaned signed papers, circular final-stage gates and unsuperseded released reports | P1 | [#6], [#4] | F-05, F-30, F-32, F-61, F-62, F-65, F-66 |
| [#15] | Bug: testing lab passes a constant predictor and reuses stale dataset cards | P1 | [#5] | F-06, F-07, F-33, F-58, F-63 |
| [#16] | Performance and resilience: stop hydrating every engagement and isolate corrupt blobs | P2 | [#4] | F-08, F-26, F-54 |
| [#17] | Bug: more than 1,000 assurance records permanently breaks an engagement | P1 | [#1] | F-03 |
| [#18] | Regulatory rule pack 2026.11: provision dates, 2 Dec 2026 milestones, EN 18286 register, version stamps | P0 | [#8], [#3], [#5] | F-50, F-51 |
| [#19] | Classification v2: enumerated Art 5 practices, GPAI roles, Art 50 triggers and tri-state facts | P1 | [#18], [#6] | F-31 |
| [#20] | Report model v2: engagement type, assurance level and ISAE 3000 conclusion types | P0 | [#14] | F-57 |
| [#21] | Engine statistics core: intervals, exact tests and multiplicity control decide outcomes | P0 | [#9], [#10] | — |
| [#22] | Hosted runner statistics parity: intervals, pre-registered decision rule and cross-runner golden tests | P0 | [#21], [#15] | — |
| [#23] | Acceptance, independence and competence gate before fieldwork | P0 | [#14] | — |
| [#24] | Engagement Quality Reviewer role and completion gate | P1 | [#12], [#20] | — |
| [#25] | Security: wrap dossier signing keys and restrict key rotation | P2 | [#17], [#12] | F-23 |

### M2 Multi-framework and GenAI evidence

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#26] | Design: multi-framework criteria model with typed crosswalks | P1 | — | — |
| [#27] | Criteria model: frameworks and engagement packs as data, AI Act pack migration, coverage view | P1 | [#26], [#18], [#19] | — |
| [#28] | EN 18286 + ISO/IEC 42001 management-system audit pack | P1 | [#27], [#20] | — |
| [#29] | NIST AI RMF 1.0 and AI 600-1 crosswalk | P2 | [#27], [#28] | — |
| [#30] | NYC Local Law 144 bias audit: computations, pack and publishable summary | P1 | [#22], [#27] | — |
| [#31] | Design: GenAI evaluation evidence ingestion — formats, per-item schema, evidence levels | P1 | — | — |
| [#32] | Engine: ingest and recompute GenAI evaluation evidence (Inspect, lm-eval-harness, promptfoo, garak) | P1 | [#31], [#21] | — |
| [#33] | GenAI evidence in the workspace: intake, evidence levels, results and readiness gate | P1 | [#32], [#27] | — |

### M3 Release readiness

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#34] | E2E: Playwright persona suite with accessibility checks in CI | P1 | [#11] | F-19 |
| [#35] | UX: attestation dialogs, permission-aware actions and consistent error handling | P2 | [#5], [#24], [#23] | F-45, F-70, F-71, F-74 |
| [#36] | Accessibility fixes and a dedicated client portal shell | P2 | [#34], [#35] | F-46, F-69, F-72, F-73 |
| [#37] | Remove dead code, unused components and unused dependencies | P3 | All M1 and M2 feature work (run near the end) | F-76 |
| [#38] | Docs: capability matrix, README and status docs that match the code | P1 | All other roadmap issues (last) | F-52, F-78 |
| [#39] | Triage the 62 React Compiler lint disables as potential render bugs | P2 | [#5]; coordinate with [#35] and [#36] | — |

## Dependency order

Each step holds the issues whose longest chain of prerequisites has that many links. Issues in the same step can run in parallel once their own prerequisites, listed in the tables above, have merged.

| Step | Issues | What they wait for |
|---|---|---|
| 0 | [#1] (merged), [#7], [#8], [#9], [#10], [#26], [#31] | Nothing. #8, #9, #26 and #31 are research or design; #10 changes only `engine/` |
| 1 | [#3], [#4], [#5], [#6], [#17], [#21] | #1, except #21, which needs #9 and #10 |
| 2 | [#11], [#13], [#14], [#15], [#16], [#18], [#32], [#39] | An M0 split (#4, #5 or #6); #18 also needs #3 and #8, and #32 needs #21 and #31 |
| 3 | [#12], [#19], [#20], [#22], [#23], [#34] | #11 (for #12 and #34), #14 (for #20 and #23), #18 (for #19), #15 and #21 (for #22) |
| 4 | [#24], [#25], [#27] | #12 and #20 (for #24), #12 and #17 (for #25), #18, #19 and #26 (for #27) |
| 5 | [#28], [#30], [#33], [#35] | #27 (for #28, #30 and #33); #23 and #24 (for #35) |
| 6 | [#29], [#36] | #28 (for #29); #34 and #35 (for #36) |
| 7 | [#37] | All M1 and M2 feature work |
| 8 | [#38] | Everything else |

- **Longest chain:** [#1] → [#3] and [#5] (with [#8]) → [#18] → [#19] → [#27] → [#28] → [#29], then [#37] → [#38].
- **Date-critical:** the obligations that start on 2 Dec 2026 (new Art 5 prohibitions and the end of the Art 50(2) transition) reach the product through [#8] → [#18] → [#19], and [#18] also waits for [#3] and [#5]. The brief asks for that content to ship before the date ([synthesis](docs/research/2026-11/synthesis.md) section 4).
- **Lanes** (an arrow means "unblocks"):
  - content: #8 → #18 → #19 → #27 → #28 → #29;
  - workflow and reporting: #6 → #13; #4 and #6 → #14 → #20 and #23; #20 → #24 and #28;
  - statistics and GenAI evidence: #9 and #10 → #21 → #22 → #30; #21 and #31 → #32 → #33;
  - identity and security: #4 → #11 → #12 → #24 and #25; #11 → #34;
  - workspace UI: #5 → #15 → #22; #5 → #39; #23 and #24 → #35 → #36.
- **Shared files.** Work that changes `lib/store.ts`, `app/api/workspace/route.ts`, `app/workspace.tsx`, `lib/domain.ts` or `lib/workflow-service.ts` (under `site-app/`) depends on the split that restructures the file (#4, #5 or #6). The other hot files and their rules are in [codebase map](docs/engineering/codebase-map.md) section 3.2. An issue that needs a D1 migration takes the next free number and renumbers on rebase.

## Later

These themes were deliberately deferred from this cycle. The section numbers point to the [synthesis](docs/research/2026-11/synthesis.md), where each is scoped; the order here is not a ranking.

- **Verifiable outputs:** RFC 3161 timestamps and public report verification (R7.2, R7.3); in-toto run attestations and re-performance packs (R7.1, R3.6).
- **Engagement quality:** review notes as records of their own (R2.5); anti-templating guardrails (R2.6); assistant governance (R2.7).
- **Client collaboration:** request lists 2.0, inbox digests and completeness-and-accuracy panels (R8.1 to R8.3).
- **Interoperability:** governance-platform importers, post-market evidence, and OSCAL and CycloneDX exports (R9.1 to R9.3).
- **Recurring assurance and practice operations:** roll-forward, schedules, a portfolio board and certification-body operations (R10.1 to R10.4).
- **Packs:** GPAI downstream and Art 50 (R4.5); AIUC-1 and SOC 2 + AI (R4.6).
- **Platform:** SCIM and an EU data-residency option (R5.3); upload malware scanning and retention (R7.4).
- **Persistence cliffs and hardening** (codebase-review findings at `74c6463`):
  - F-28: every save appends the full engagement body to undeletable snapshots and re-uploads every blob, so paper histories grow O(n²);
  - F-27: uploads of up to 50 MB and dossiers of up to 30 MB are buffered whole about three times against a 128 MB isolate limit, and bodies are read before authentication;
  - F-41 and F-42: the audit hash chain is never verified and management events are not chained; downloads and denied requests leave no custody record;
  - F-38 and F-40: the compute image lacks the ONNX, XGBoost, LightGBM and PMML runtimes, and worker memory limits fall well short of the dataset sizes the platform accepts;
  - F-68: Hugging Face artifact downloads cannot succeed, because the redirects are refused;
  - F-55: the runner's result "signature" is an HMAC keyed by the stored token hash; it should become a per-worker Ed25519 signature;
  - F-60: no Dependabot or CodeQL, and `npm audit` is disabled;
  - F-49: 11 order-dependent global stylesheets with about 249 duplicated selectors and 74 `!important` rules.

### Not yet placed

The research and the codebase review also recommend the items below. No issue covers them and they are not on the Later list, so each needs a decision: schedule it or defer it.

- **From the synthesis:**
  - fairness for multiclass and regression models, counterfactual flip-rate and monotonicity tests, and bootstrap stability for permutation importance (R3.5);
  - an Art 4a record that gates any run on special-category data (R3.7; [#8] only researches the Art 4a conditions);
  - a validation dossier for each engine release (R3.8);
  - Colorado SB 26-189, CCPA ADMT and Illinois HB 3773 in the bias and ADMT pack ([#30] covers LL144 only; R4.4);
  - a deployer pack with an Art 27 FRIA template (R4.7);
  - per-practice OIDC/SAML sign-in and MFA, which the brief wants before any paid pilot ([#11] covers forged headers and Cloudflare Access; R5.1);
  - an external-specialist role and break-glass access (R5.2; [#24] adds only the EQR role);
  - auditor re-runs (evidence level L3) of Inspect, garak and promptfoo through the external worker (R6.4);
  - Art 50 content-marking checks, such as C2PA manifests and watermark-detector output (R6.5, which builds on the Art 50 pack);
  - verification of OpenSSF Model Signing signatures on supplied models (part of R7.5; [#25] covers key wrapping, rotation and published keys);
  - a client assurance-summary page (R8.4), and a client evidence API with a read-only MCP server (R9.4).
- **From the codebase review:** F-16 (test harnesses that are not portable, which CI works around); the idempotent local migration script from F-15 (the README itself was corrected in [PR #2]); and the splits of `app/api/assurance/route.ts`, `app/audit-program.tsx`, `app/assurance-workbench.tsx`, `app/testing-lab.tsx` and `scripts/integration-check.mjs` ([codebase map](docs/engineering/codebase-map.md) section 3.2).
- **Frameworks the brief itself puts later** (synthesis section 2.3): the JTC 21 standards once cited, a model-risk pack for SR 26-2 and PRA SS1/23, an MDR/IVDR and FDA PCCP overlay, the Korea AI Basic Act, China's GB 45438-2025, and OSCAL exchange.

[PR #2]: https://github.com/ahed-jneed/ai-assurance/pull/2
[#1]: https://github.com/ahed-jneed/ai-assurance/issues/1
[#3]: https://github.com/ahed-jneed/ai-assurance/issues/3
[#4]: https://github.com/ahed-jneed/ai-assurance/issues/4
[#5]: https://github.com/ahed-jneed/ai-assurance/issues/5
[#6]: https://github.com/ahed-jneed/ai-assurance/issues/6
[#7]: https://github.com/ahed-jneed/ai-assurance/issues/7
[#8]: https://github.com/ahed-jneed/ai-assurance/issues/8
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
[#26]: https://github.com/ahed-jneed/ai-assurance/issues/26
[#27]: https://github.com/ahed-jneed/ai-assurance/issues/27
[#28]: https://github.com/ahed-jneed/ai-assurance/issues/28
[#29]: https://github.com/ahed-jneed/ai-assurance/issues/29
[#30]: https://github.com/ahed-jneed/ai-assurance/issues/30
[#31]: https://github.com/ahed-jneed/ai-assurance/issues/31
[#32]: https://github.com/ahed-jneed/ai-assurance/issues/32
[#33]: https://github.com/ahed-jneed/ai-assurance/issues/33
[#34]: https://github.com/ahed-jneed/ai-assurance/issues/34
[#35]: https://github.com/ahed-jneed/ai-assurance/issues/35
[#36]: https://github.com/ahed-jneed/ai-assurance/issues/36
[#37]: https://github.com/ahed-jneed/ai-assurance/issues/37
[#38]: https://github.com/ahed-jneed/ai-assurance/issues/38
[#39]: https://github.com/ahed-jneed/ai-assurance/issues/39
