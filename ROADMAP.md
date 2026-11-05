# Roadmap

> GitHub issues and milestones are the source of truth; this file is the plan as of 5 Nov 2026 and is refreshed at milestone boundaries.

The plan for the current cycle, set on 5 November 2026. The [product direction](docs/product/direction.md) says what we are building and why, and the [decision log](docs/product/decisions.md) records the product and technical decisions taken since. The [research record](docs/research/2026-11/README.md) holds the evidence behind the plan, and the [codebase map](docs/engineering/codebase-map.md) describes the code it starts from (commit `74c6463`). [#38] updates this file with the outcome at the end of the cycle.

## Milestones

| Milestone | Goal | Issues |
|---|---|---|
| [M0 Foundation](https://github.com/ahed-jneed/ai-assurance/milestone/1) | CI pipeline, formatting and lint baseline, warning-free build, repo hygiene. Must land before parallel feature work. | 6, of which 4 merged |
| [M1 Defensible core](https://github.com/ahed-jneed/ai-assurance/milestone/2) | Correctness, security and legal currency: verified bug fixes, identity hardening, rule pack 2026.11, report model v2, audit-grade statistics, independence and quality review. | 27 |
| [M2 Multi-framework and GenAI evidence](https://github.com/ahed-jneed/ai-assurance/milestone/3) | Criteria as data with typed crosswalks, EN 18286 + ISO/IEC 42001 and NYC LL144 packs, NIST AI RMF crosswalk, GenAI evaluation evidence ingestion. | 9 |
| [M3 Release readiness](https://github.com/ahed-jneed/ai-assurance/milestone/4) | End-to-end persona tests, UX and accessibility hardening, dead-code removal, documentation that matches the code, final verification. | 10 |

In the tables below, rows are in dependency order: no row comes before an issue it depends on. "Depends on" lists the issues that must merge first, as each issue states. After a semicolon come softer orderings: issues to coordinate with or to decide a rule with, an issue to land after or before, a prerequisite for one part only, and another issue's "Blocks" line. "Findings" lists the codebase-review finding ids that the issue, or an orchestrator comment on it, quotes ([codebase map](docs/engineering/codebase-map.md) section 3.3 groups all of them by area). F-75, which asks every issue to delete the dead code it touches, is left out.

### M0 Foundation

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#1] | Foundation: CI pipeline, Prettier baseline, zero-warning lint and build. **Merged** with [PR #2] on 5 Nov 2026 | P0 | — | none quoted; [PR #2] addressed F-01, F-11, F-12 and F-13 and parts of F-14, F-15, F-17, F-18, F-47 and F-76 |
| [#3] | Single source of truth for contracts and methodology data; remove `site-app/reference` | P0 | [#1] | F-14, F-22, F-50, F-77 |
| [#4] | Refactor: split `lib/store.ts` and the `/api/workspace` command bus into modules. **Merged** with [PR #41] on 5 Nov 2026 | P0 | [#1] | — |
| [#5] | Refactor: split `app/workspace.tsx` into a workspace shell, data hooks, modal host and views. **Merged** with [PR #48] on 5 Nov 2026 | P0 | [#1] | F-07, F-33, F-48 |
| [#6] | Refactor: split `lib/domain.ts` and `lib/workflow-service.ts` into cohesive modules. **Merged** with [PR #44] on 5 Nov 2026 | P0 | [#1] | F-20 |
| [#7] | Docs: record the product direction, roadmap and research behind it (this roadmap and the docs it links) | P1 | — | — |

### M1 Defensible core

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#8] | Research: verify EU AI Act milestones and EN 18286 status for rule pack 2026.11 | P0 | — | F-51 |
| [#59] | Research: what an auditor tests for the Art 50 transparency obligations | P1 | [#8] | — |
| [#9] | Design: audit-grade statistics specification with hand-computed golden cases | P0 | — | — |
| [#10] | Engine: make the external worker robust to bad jobs, slow transfers and contract drift | P1 | — | F-10, F-21, F-34, F-35, F-36, F-37, F-39, F-59, F-67 |
| [#11] | Security: identity adapter that rejects forged identity headers, plus dev personas and sign-out | P0 | [#4] | F-02, F-19, F-25, F-53 |
| [#50] | Refactor: split the `/api/assurance` and `/api/management` command buses into command modules | P1 | [#4] | — |
| [#58] | External jobs: queue only jobs the worker can run, and explain failures to the auditor | P1 | [#10], [#50] | — |
| [#12] | Security: access lifecycle — revoke cascades, practice admins, invitations, self-provisioning control | P1 | [#11]; [#50] blocks it | F-09, F-24, F-43, F-44, F-56 |
| [#13] | Bug: plan edits invalidate all executed work, and program history caps lock engagements | P1 | [#6] | F-04, F-29, F-64 |
| [#14] | Bug: orphaned signed papers, circular final-stage gates and unsuperseded released reports | P1 | [#6], [#4] | F-05, F-30, F-32, F-61, F-62, F-65, F-66 |
| [#15] | Bug: testing lab passes a constant predictor and reuses stale dataset cards | P1 | [#5] | F-06, F-07, F-33, F-58, F-63 |
| [#65] | Engine: apply the 2.1.0 performance rules and the performance positive class to external runs | P1 | [#15], [#10]; coordinate with [#21] and [#22] | F-06 |
| [#66] | Assurance API: aggregate imported external runs with `aggregateOutcome`, and reject blank rows in audit sampling | P2 | [#50], [#15] | F-63 |
| [#67] | Testing lab: keep the dataset card pin on retries and planned evaluations, and refuse duplicate queued runs per procedure | P2 | [#15] | F-33 |
| [#68] | Regression performance: compare RMSE with the mean-prediction baseline, so a constant predictor cannot pass | P2 | [#15]; decide the rule with [#9] and [#22] | — |
| [#60] | Art 4a: record the legal basis before special-category data reaches the platform, and test fairness client-side by default | P1 | [#15], [#8]; coordinate with [#18] | F-58 |
| [#16] | Performance and resilience: stop hydrating every engagement and isolate corrupt blobs | P2 | [#4]; [#50] blocks it | F-08, F-26, F-54 |
| [#17] | Bug: more than 1,000 assurance records permanently breaks an engagement | P1 | [#1]; [#50] blocks it | F-03 |
| [#18] | Regulatory rule pack 2026.11: provision dates, 2 Dec 2026 milestones, EN 18286 register, version stamps | P0 | [#8], [#3], [#5] | F-50, F-51 |
| [#19] | Classification v2: enumerated Art 5 practices, GPAI roles, Art 50 triggers and tri-state facts | P1 | [#18], [#6] | F-31 |
| [#20] | Report model v2: engagement type, assurance level and ISAE 3000 conclusion types | P0 | [#14] | F-57 |
| [#21] | Engine statistics core: intervals, exact tests and multiplicity control decide outcomes | P0 | [#9], [#10] | — |
| [#22] | Hosted runner statistics parity: intervals, pre-registered decision rule and cross-runner golden tests | P0 | [#21], [#15] | — |
| [#23] | Acceptance, independence and competence gate before fieldwork | P0 | [#14] | — |
| [#24] | Engagement Quality Reviewer role and completion gate | P1 | [#12], [#20] | — |
| [#51] | Contracts: map app papers and dataset cards to the canonical schemas, including memo narrative | P1 | [#3], [#6]; coordinate with [#23] and [#24] | — |
| [#25] | Security: wrap dossier signing keys and restrict key rotation | P2 | [#17], [#12] | F-23 |

### M2 Multi-framework and GenAI evidence

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#26] | Design: multi-framework criteria model with typed crosswalks | P1 | — | — |
| [#27] | Criteria model: frameworks and engagement packs as data, AI Act pack migration, coverage view | P1 | [#26], [#18], [#19] | — |
| [#61] | Criteria model phase 2: explicit pins, framework stamps in reports, generated obligation and Annex IV maps, criteria refs on findings | P2 | [#27]; [#20] for the report roll-up | — |
| [#28] | EN 18286 + ISO/IEC 42001 management-system audit pack | P1 | [#27], [#20] | — |
| [#29] | NIST AI RMF 1.0 and AI 600-1 crosswalk | P2 | [#27], [#28] | — |
| [#30] | NYC Local Law 144 bias audit: computations, pack and publishable summary | P1 | [#22], [#27] | — |
| [#31] | Design: GenAI evaluation evidence ingestion — formats, per-item schema, evidence levels | P1 | — | — |
| [#32] | Engine: ingest and recompute GenAI evaluation evidence (Inspect, lm-eval-harness, promptfoo, garak) | P1 | [#31], [#21]; coordinate with [#62] (zstd) | — |
| [#33] | GenAI evidence in the workspace: intake, evidence levels, results and readiness gate | P1 | [#32], [#27] | — |

### M3 Release readiness

| Issue | Scope | Priority | Depends on | Findings |
|---|---|---|---|---|
| [#34] | E2E: Playwright persona suite with accessibility checks in CI | P1 | [#11] | F-15, F-19 |
| [#35] | UX: attestation dialogs, permission-aware actions and consistent error handling | P2 | [#5], [#24], [#23] | F-45, F-70, F-71, F-74 |
| [#36] | Accessibility fixes and a dedicated client portal shell | P2 | [#34], [#35] | F-46, F-69, F-72, F-73 |
| [#39] | UI correctness: triage the 62 React Compiler lint disables and fix runtime React warnings | P1 | [#5]; coordinate with [#35] and [#36] | — |
| [#62] | Engine packaging: one supported Python version, `cryptography` in the runtime image, signature tests that cannot skip in CI | P2 | [#10], [#3] | F-17 |
| [#63] | Client data layer: one cached assurance query for the workspace views, and per-view memoisation | P2 | [#15], [#39] | F-47, F-48 |
| [#52] | Test: move pure-module harness checks into Vitest and unit-test commands covered only over HTTP | P2 | [#6]; lands after [#13], [#14], [#23] and [#24] | F-16 |
| [#64] | Refactor: split `audit-program.tsx`, `assurance-workbench.tsx` and `testing-lab.tsx` along their views | P3 | [#15], [#33], [#39], [#58], [#60], [#63]; last in M3, before [#37] | — |
| [#37] | Remove dead code, unused components and unused dependencies | P3 | All M1 and M2 feature work (run near the end); [#64] first | F-76 |
| [#38] | Docs: capability matrix, README and status docs that match the code | P1 | All other roadmap issues (last) | F-52, F-78 |

## Dependency order

Each step holds the issues whose longest chain of prerequisites has that many links. Here a "Blocks" line, a "lands after" or "before" instruction and a prerequisite for one part count as prerequisites; "coordinate with" and "decide the rule with" do not. The last column names every prerequisite that has not merged, and merged ones only for issues that wait for nothing else. Issues in the same step can run in parallel once their own prerequisites, listed in the tables above, have merged.

| Step | Issues | What they wait for |
|---|---|---|
| 0 | [#1] (merged), [#7], [#8], [#9], [#10], [#26], [#31] | Nothing. #8, #9, #26 and #31 are research or design; #10 changes only `engine/` |
| 1 | [#3], [#4] (merged), [#5] (merged), [#6] (merged), [#21], [#59] | #1, except #21, which needs #9 and #10, and #59, which needs #8 |
| 2 | [#11], [#13], [#14], [#15], [#18], [#32], [#39], [#50], [#51], [#62] | #11, #13, #14, #15, #39 and #50 wait only for M0 splits, which have merged. #18 needs #3 and #8; #51 needs #3; #62 needs #3 and #10; #32 needs #21 and #31 |
| 3 | [#12], [#16], [#17], [#19], [#20], [#22], [#23], [#34], [#58], [#60], [#63], [#65], [#66], [#67], [#68] | #11 (for #12 and #34); #50 (for #12, #16, #17, #58 and #66); #14 (for #20 and #23); #18 (for #19); #15 (for #22, #60, #63 and #65 to #68). Also #10 (for #58 and #65), #21 (for #22), #8 (for #60) and #39 (for #63) |
| 4 | [#24], [#25], [#27] | #12 and #20 (for #24), #12 and #17 (for #25), #18, #19 and #26 (for #27) |
| 5 | [#28], [#30], [#33], [#35], [#52], [#61] | #27 (for #28, #30, #33 and #61); #23 and #24 (for #35); the M1 workflow fixes #13, #14, #23 and #24 (for #52). Also #20 (for #28, and for #61's report roll-up), #22 (for #30) and #32 (for #33) |
| 6 | [#29], [#36], [#64] | #28 (for #29); #34 and #35 (for #36); #33, #58, #60 and #63 (for #64). Also #27 (for #29), and #15 and #39 (for #64) |
| 7 | [#37] | All M1 and M2 feature work, and #64 |
| 8 | [#38] | Everything else |

- **Longest chain:** [#1] → [#3] and [#5] (with [#8]) → [#18] → [#19] → [#27] → [#28] → [#29], then [#37] → [#38]. [#27] → [#33] → [#64] → [#37] is as long. With #1 and #5 merged, the chain now starts at #3 and #8.
- **Date-critical:** the obligations that start on 2 Dec 2026 (new Art 5 prohibitions and the end of the Art 50(2) transition) reach the product through [#8] → [#18] → [#19]. [#18] also waits for [#3]; [#5] and [#6], which #18 and #19 also need, have merged. The brief asks for #18's per-provision dates (R1.1) and the Art 5 and Art 50(2) parts of #19's classification v2 (R1.3) to ship before 2 Dec 2026 ([synthesis](docs/research/2026-11/synthesis.md) section 4). [#59] researches what an auditor tests for Art 50 and feeds #18 and #19.
- **Lanes** (an arrow means "unblocks"):
  - content: #8 → #18 → #19 → #27 → #28 → #29; #8 → #59, which feeds #18 and #19; #27 → #61;
  - workflow and reporting: #6 → #13; #4 and #6 → #14 → #20 and #23; #20 → #24 and #28; #3 and #6 → #51;
  - statistics and GenAI evidence: #9 and #10 → #21 → #22 → #30; #21 and #31 → #32 → #33;
  - identity and security: #4 → #11 → #12 → #24 and #25; #11 → #34;
  - API and worker: #4 → #50 → #12, #16 and #17; #10 and #50 → #58;
  - workspace UI: #5 → #15 → #22; #5 → #39; #15 and #8 → #60; #15 and #39 → #63; #23 and #24 → #35 → #36; #33, #58, #60 and #63 → #64;
  - evaluation follow-ups to #15: #10 and #15 → #65; #15 and #50 → #66; #15 → #67 and #68;
  - tests and packaging: #3 and #10 → #62; #13, #14, #23 and #24 → #52.
- **Shared files.** The M0 splits have merged: `/api/workspace` ops live in `lib/commands/**`, the workspace UI in `app/workspace/**`, and `lib/store.ts`, `lib/domain.ts` and `lib/workflow-service.ts` are barrels over their new modules (under `site-app/`). [#50] splits `app/api/assurance/route.ts` and `app/api/management/route.ts` next, ahead of the issues that change them, and [#64] splits `app/audit-program.tsx`, `app/assurance-workbench.tsx` and `app/testing-lab.tsx` last. The other hot files and their rules are in [codebase map](docs/engineering/codebase-map.md) section 3.2. An issue that needs a D1 migration takes the next free number and renumbers on rebase.

## Placed on 5 Nov 2026

When this roadmap was first written, the research and the codebase review recommended some items that no issue covered and that were not on the Later list. On 5 Nov 2026 each was placed:

- the Art 4a record that gates runs on special-category data (R3.7) → [#60];
- F-17, `cryptography` declared wherever signatures are verified and signature tests that cannot skip → [#62];
- F-18, porting the standalone check scripts to Vitest, and F-16, harness portability → [#52];
- F-47, one cached `/api/assurance` query, and F-48, per-view memoisation → [#63];
- the CI gate on build warnings (the rest of F-47) → [#3], as the strict-build gate of [PR #42];
- F-15, an idempotent local migration script → [#34];
- the `app/api/assurance/route.ts` split, together with `app/api/management/route.ts` → [#50];
- the splits of `app/audit-program.tsx`, `app/assurance-workbench.tsx` and `app/testing-lab.tsx` → [#64];
- the `scripts/integration-check.mjs` split → [#52];
- everything else → [Later](#later).

## Later

These themes are deferred from this cycle; the order is not a ranking. R-numbers are recommendation ids from section 4 of the [synthesis](docs/research/2026-11/synthesis.md), which scopes each one; F-numbers are codebase-review findings at `74c6463`.

Deferred when the cycle was planned ([#7]'s list):

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

Deferred on 5 Nov 2026, each with the reason it waits:

- **Statistics** (the specification for [#9], [PR #46]):
  - interval-based drift decisions (PSI, KS, Wasserstein): drift has no interval specification yet, so it stays point-estimate screening outside the families ([decision D-06](docs/product/decisions.md));
  - a delta-method macro-F1 interval, and engine-only Boschloo, BCa and shrinkage: the conservative 1.0.0 methods already decide safely, and these would only be reported until specified;
  - fairness for multiclass and regression models, counterfactual flip-rate and monotonicity tests, and bootstrap stability for permutation importance (R3.5): the specification defines group criteria for binary outcomes only and none of these tests;
  - an engine validation dossier for each release (R3.8): the [#9] golden cases are its start.
- **Criteria model** (the design for [#26], [PR #45]):
  - phase 3, repin with diff, impact review and revert, and reviewed links for pack #1: it builds on phases 1 and 2 ([#27], [#61]), and until then a pin never moves and pack #1's migrated links stay conservative;
  - phase 6, OSCAL export, a tenant default pack, engagement-level link tailoring and tenant-authored packs: no pack this cycle needs them, and tenant-authored packs would need a new D1 table.
- **GenAI evidence** (the design for [#31], [PR #49]):
  - signed L3 attestations and worker-executed re-runs (R6.4): they come after [#25], which provides the signing keys;
  - multi-gigabyte agent logs: they exceed the 50 MB upload and parse limits and need chunked upload and a streaming parser;
  - an unpaired two-sample criterion for prompt-variant comparisons: the first version compares systems on the same inputs only.
- **Identity and roles:**
  - per-practice SSO and MFA (R5.1): they come through the hosting identity provider, and [#11]'s adapter is the seam;
  - an external-specialist role and break-glass access (R5.2): they reuse the role plumbing that [#24] adds for the EQR.
- **Packs:**
  - Colorado SB 26-189 and CCPA ADMT audit packs, with Illinois HB 3773 (R4.4): the first new packs once [#27] to [#30] land, and they need verified research first;
  - a deployer pack with an Art 27 FRIA template (R4.7): the brief ranks it P2, behind the packs of [#28] and [#30].
- **Checks on supplied content and models:**
  - C2PA and other Art 50 marking checks (R6.5): [#59] decides first what an auditor tests;
  - verification of OpenSSF Model Signing signatures on supplied models (the rest of R7.5): [#25] does its key-custody part first.
- **Client access:** a client assurance-summary page (R8.4), and a client evidence API with a read-only MCP server (R9.4): they come after [#36] builds the client portal shell.
- **Frameworks the brief itself puts later** (synthesis section 2.3): the JTC 21 standards once cited, a model-risk pack for SR 26-2 and PRA SS1/23, an MDR/IVDR and FDA PCCP overlay, the Korea AI Basic Act, China's GB 45438-2025, and OSCAL exchange: the brief ranks them after this cycle's frameworks.

## Watch list

Facts the plan depends on that are still moving. On each date, re-check the item and update the issue it names.

| Re-check | What to check | Why it matters | Affects |
|---|---|---|---|
| 1 Dec 2026, then monthly | Final adoption of the Commission's Art 6 high-risk classification guidelines, still a draft of 19 May 2026 with no adoption date announced ([PR #43]) | Classifications record the guidance status and version they used, and are re-reviewed once the guidelines are final | [#19] |
| 1 Dec 2026 | CEN-CENELEC JTC 21 votes: prEN 18229-1 (logging; forecast vote 30 Nov 2026) and the formal vote on prEN 18228 (risk management), whose forecast date has passed ([PR #43]) | A draft that passes moves towards citation; until it is cited, the standards register labels it "not harmonised — state of the art" | [#18] |
| 4 Jan 2027 | The vote on prEN ISO/IEC 42006, the EN adoption of ISO/IEC 42006 (forecast 31 Dec 2026; [PR #43]) | The standards register records each standard's EN status | [#18] |
| 1 Dec 2026, then monthly | The published text of the EEOC's rescission of the Uniform Guidelines (UGESP); the final rule was reportedly sent to OIRA on 16 Oct 2026 (secondary source) | Until the text is published, the four-fifths screen's caveat states only what is stable ([PR #46], Q5) | [#22] |
| 1 Dec 2026, and at each PyRIT minor release | PyRIT's planned `--output json` | Until PyRIT ships it, the engine reads PyRIT through its own `pyrit-export/1` contract ([PR #49], Q5) | [#32] |
| 1 Dec 2026, and before the OWASP pack is released | The official OWASP Top 10 for LLM Applications 2026 document | The 2026 identifiers and order, including the `owasp:llm10` mapping, come from secondary summaries ([PR #49], Q1) | [#33] |

## Owner actions (outside the roadmap)

[#57] tracks what only the owner can provide: qualified legal review of the rule-pack research (LR-01 to LR-10), a purchased copy of EN 18286:2026, counsel's sign-off on how standards text is cited, a written AIUC-1 licence and a decision on the CSA AI Controls Matrix licence terms. It is not a roadmap item and has no milestone. The issues it unblocks ship without it, with the affected content marked unapproved or unreleased until the action is done.

[PR #2]: https://github.com/ahed-jneed/ai-assurance/pull/2
[PR #41]: https://github.com/ahed-jneed/ai-assurance/pull/41
[PR #42]: https://github.com/ahed-jneed/ai-assurance/pull/42
[PR #43]: https://github.com/ahed-jneed/ai-assurance/pull/43
[PR #44]: https://github.com/ahed-jneed/ai-assurance/pull/44
[PR #45]: https://github.com/ahed-jneed/ai-assurance/pull/45
[PR #46]: https://github.com/ahed-jneed/ai-assurance/pull/46
[PR #48]: https://github.com/ahed-jneed/ai-assurance/pull/48
[PR #49]: https://github.com/ahed-jneed/ai-assurance/pull/49
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
[#50]: https://github.com/ahed-jneed/ai-assurance/issues/50
[#51]: https://github.com/ahed-jneed/ai-assurance/issues/51
[#52]: https://github.com/ahed-jneed/ai-assurance/issues/52
[#57]: https://github.com/ahed-jneed/ai-assurance/issues/57
[#58]: https://github.com/ahed-jneed/ai-assurance/issues/58
[#59]: https://github.com/ahed-jneed/ai-assurance/issues/59
[#60]: https://github.com/ahed-jneed/ai-assurance/issues/60
[#61]: https://github.com/ahed-jneed/ai-assurance/issues/61
[#62]: https://github.com/ahed-jneed/ai-assurance/issues/62
[#63]: https://github.com/ahed-jneed/ai-assurance/issues/63
[#64]: https://github.com/ahed-jneed/ai-assurance/issues/64
[#65]: https://github.com/ahed-jneed/ai-assurance/issues/65
[#66]: https://github.com/ahed-jneed/ai-assurance/issues/66
[#67]: https://github.com/ahed-jneed/ai-assurance/issues/67
[#68]: https://github.com/ahed-jneed/ai-assurance/issues/68
