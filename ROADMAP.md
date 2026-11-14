# Roadmap

> GitHub issues and milestones are the source of truth. This file records the outcome of the November 2026 cycle as of **14 Nov 2026** ([#38]); the plan it started from (5 Nov 2026, with its dependency order) is in this file's Git history, last at commit `ffe27c1`.

The cycle was planned on 5 November 2026. The [product direction](docs/product/direction.md) says what we are building and why, the [decision log](docs/product/decisions.md) records the product and technical decisions taken since (D-01 to D-44), and the [capability matrix](docs/capabilities.md) says what `main` does now, with the code and tests behind each row. The [research record](docs/research/2026-11/README.md) holds the evidence behind the plan, and the [codebase map](docs/engineering/codebase-map.md) describes the code (it started as a snapshot at commit `74c6463`; its module paths are updated to the current layout). The [changelog](CHANGELOG.md) lists what each merged PR changed.

## Outcome

Every roadmap issue in M0, M1 and M2 is closed with a merged PR. In M3, seven issues remain open, each with a PR in review: [#37] (dead-code removal, [PR #196]), the five release-verification issues [#204], [#199], [#201], [#203] and [#202] ([PR #207], [PR #200], [PR #205], [PR #206] and [PR #208]), and [#38] (this refresh, [PR #198]). The PRs are stacked to merge in that order, each on top of the one before. Issues opened during the cycle as follow-ups were added to the milestone whose work they continued, so the issue counts below are larger than the plan's.

| Milestone | Goal | Issues | Open |
|---|---|---|---|
| [M0 Foundation](https://github.com/ahed-jneed/ai-assurance/milestone/1) | CI pipeline, formatting and lint baseline, warning-free build, repo hygiene | 6 closed | none |
| [M1 Defensible core](https://github.com/ahed-jneed/ai-assurance/milestone/2) | Correctness, security and legal currency: verified bug fixes, identity hardening, rule pack 2026.11, report model v2, audit-grade statistics, independence and quality review | 46 closed | none |
| [M2 Multi-framework and GenAI evidence](https://github.com/ahed-jneed/ai-assurance/milestone/3) | Criteria as data with typed crosswalks, EN 18286 + ISO/IEC 42001 and NYC LL144 packs, NIST AI RMF crosswalk, GenAI evaluation evidence ingestion | 18 closed | none |
| [M3 Release readiness](https://github.com/ahed-jneed/ai-assurance/milestone/4) | End-to-end persona tests, UX and accessibility hardening, dead-code removal, documentation that matches the code, final verification | 28 closed | [#37], [#38], [#199], [#201], [#202], [#203], [#204] |

[#57] (owner actions) has no milestone and is not a roadmap item; see [Owner actions](#owner-actions-outside-the-roadmap).

What did not ship as planned:

- **Pack #2 (EN 18286 + ISO/IEC 42001)** is built but ships as drafts until the owner actions in [#57] are done ([decision D-37](docs/product/decisions.md)).
- **Legal content** (the rule pack, the Art 50 research, the LL144 pack) shows as pending qualified legal review ([decisions D-02, D-17 and D-34](docs/product/decisions.md)).
- **GitHub CI** has been refused since about 06:15 UTC on 14 Nov 2026 because of an account billing problem only the owner can fix ([#57, comment](https://github.com/ahed-jneed/ai-assurance/issues/57#issuecomment-6872999518)). The last two merges, [PR #195] and [PR #197], had green PR CI before the stoppage; their post-merge `main` runs are unverified until they are re-run, and later work is checked locally.

## Issues and their merged PRs

Merge dates are UTC, all in November 2026. Titles are the issues' own.

### M0 Foundation

| Issue | Title | Outcome |
|---|---|---|
| [#1] | Foundation: CI pipeline, Prettier baseline, zero-warning lint and build | [PR #2], merged 5 Nov |
| [#3] | Single source of truth for contracts and methodology data; remove site-app/reference | [PR #42], merged 6 Nov |
| [#4] | Refactor: split lib/store.ts and the /api/workspace command bus into modules | [PR #41], merged 5 Nov |
| [#5] | Refactor: split app/workspace.tsx into a workspace shell, data hooks, modal host and views | [PR #48], merged 5 Nov |
| [#6] | Refactor: split lib/domain.ts and lib/workflow-service.ts into cohesive modules | [PR #44], merged 5 Nov |
| [#7] | Docs: record the product direction, roadmap and research behind it | [PR #40], merged 6 Nov |

### M1 Defensible core

| Issue | Title | Outcome |
|---|---|---|
| [#8] | Research: verify EU AI Act milestones and EN 18286 status for rule pack 2026.11 | [PR #43], merged 5 Nov |
| [#9] | Design: audit-grade statistics specification with hand-computed golden cases | [PR #46], merged 6 Nov |
| [#10] | Engine: make the external worker robust to bad jobs, slow transfers and contract drift | [PR #47], merged 6 Nov |
| [#11] | Security: identity adapter that rejects forged identity headers, plus dev personas and sign-out | [PR #55], merged 6 Nov |
| [#12] | Security: access lifecycle — revoke cascades, practice admins, invitations, self-provisioning control | [PR #84], merged 6 Nov |
| [#13] | Bug: plan edits invalidate all executed work, and program history caps lock engagements | [PR #54], merged 6 Nov |
| [#14] | Bug: orphaned signed papers, circular final-stage gates and unsuperseded released reports | [PR #85], merged 6 Nov |
| [#15] | Bug: testing lab passes a constant predictor and reuses stale dataset cards | [PR #56], merged 6 Nov |
| [#16] | Performance and resilience: stop hydrating every engagement and isolate corrupt blobs | [PR #108], merged 6 Nov |
| [#17] | Bug: more than 1,000 assurance records permanently breaks an engagement | [PR #72], merged 6 Nov |
| [#18] | Regulatory rule pack 2026.11: provision dates, 2 Dec 2026 milestones, EN 18286 register, version stamps | [PR #73], merged 6 Nov |
| [#19] | Classification v2: enumerated Art 5 practices, GPAI roles, Art 50 triggers and tri-state facts | [PR #97], merged 6 Nov |
| [#20] | Report model v2: engagement type, assurance level and ISAE 3000 conclusion types | [PR #100], merged 6 Nov |
| [#21] | Engine statistics core: intervals, exact tests and multiplicity control decide outcomes | [PR #87], merged 6 Nov |
| [#22] | Hosted runner statistics parity: intervals, pre-registered decision rule and cross-runner golden tests | [PR #101], merged 6 Nov |
| [#23] | Acceptance, independence and competence gate before fieldwork | [PR #99], merged 6 Nov |
| [#24] | Engagement Quality Reviewer role and completion gate | [PR #115], merged 6 Nov |
| [#25] | Security: wrap dossier signing keys and restrict key rotation | [PR #107], merged 6 Nov |
| [#50] | Refactor: split the /api/assurance and /api/management command buses into command modules | [PR #53], merged 5 Nov |
| [#51] | Contracts: map app papers and dataset cards to the canonical schemas, including memo narrative | [PR #130], merged 12 Nov |
| [#58] | External jobs: queue only jobs the worker can run, and explain failures to the auditor | [PR #91], merged 6 Nov |
| [#59] | Research: what an auditor tests for the Art 50 transparency obligations | [PR #71], merged 6 Nov |
| [#60] | Art 4a: record the legal basis before special-category data reaches the platform, and test fairness client-side by default | [PR #92], merged 6 Nov |
| [#65] | Engine: apply the 2.1.0 performance rules and the performance positive class to external runs (F-06) | [PR #98], merged 6 Nov |
| [#66] | Assurance API: aggregate imported external runs with aggregateOutcome, and reject blank rows in audit sampling (F-63) | [PR #106], merged 6 Nov |
| [#67] | Testing lab: keep the dataset card pin on retries and planned evaluations, and refuse duplicate queued runs per procedure | [PR #114], merged 6 Nov |
| [#68] | Regression performance: compare RMSE with the mean-prediction baseline, so a constant predictor cannot pass | [PR #117], merged 6 Nov |
| [#69] | Workflow: bind run retries, active-job guards and sample pins to the procedure plan, not the program revision | [PR #89], merged 6 Nov |
| [#74] | Docs: record decisions D-15 to D-24 and the new Later items | [PR #75], merged 6 Nov |
| [#76] | Bug: a stale recovery draft retries its autosave every second after a 409 | [PR #90], merged 6 Nov |
| [#77] | Rule pack 2026.11.2: apply the Art 50 research edits A50-ED-10 to A50-ED-15 | [PR #109], merged 6 Nov |
| [#78] | Catalogue: Art 50 working papers (restructure WP-XC-07, add WP-XC-10 marking and detection and WP-XC-11 deep fakes and public-interest text) | [PR #109], merged 6 Nov |
| [#79] | Workbench: label obligation subitems AIA-AIV-8 and AIA-AIV-9 as pending legal review (LR-02) in the obligation picker | Done in [PR #73] (with [#18]); closed 6 Nov |
| [#81] | Assurance workbench at scale: page long registers and the Briefing source picker, and run review-queue search on the server | [PR #110], merged 6 Nov |
| [#82] | Bug: assist returns 500 instead of 400 for unknown or non-source record ids | [PR #88], merged 6 Nov |
| [#93] | Engine statistics: cluster-bootstrap decisions for clustered plans, and bootstrap sensitivity intervals for MAE and RMSE | [PR #132], merged 12 Nov |
| [#102] | Client-local external jobs: keep special-category datasets off the platform | [PR #126], merged 6 Nov |
| [#103] | Art 4a gate follow-ups: Parquet and spreadsheet uploads, basis form guard, and limitation text on external papers | [PR #125], merged 6 Nov |
| [#104] | Classification follow-ups: re-review work items, workbench trigger suggestions, and a migration notice | [PR #129], merged 12 Nov |
| [#105] | Bind external jobs and sample records to the procedure planHash | [PR #123], merged 6 Nov |
| [#111] | Reports: a readiness output with gaps, firm-level report settings and a live record sheet | [PR #131], merged 6 Nov |
| [#112] | Independence follow-ups: conflict checks on access grants, inbox items and display names | [PR #124], merged 6 Nov |
| [#113] | Hosted testing lab follow-ups: multiclass power, a single threshold library and intersectional strata | [PR #147], merged 13 Nov |
| [#119] | E2E: flaky auditor-prepares-paper spec (predicate timeout after the Worker loses its connection) | [PR #122], merged 6 Nov |
| [#120] | Art 50 follow-ups: suggest paper applicability from the classification, structure the statistical criteria, and check the research JSON in CI | [PR #149], merged 13 Nov |
| [#127] | Quality reviewer follow-ups: acceptance-record team, access grants as team membership, signer re-check at release, practice-level cooling-off | [PR #138], merged 12 Nov |

### M2 Multi-framework and GenAI evidence

| Issue | Title | Outcome |
|---|---|---|
| [#26] | Design: multi-framework criteria model with typed crosswalks | [PR #45], merged 6 Nov |
| [#27] | Criteria model: frameworks and engagement packs as data, AI Act pack migration, coverage view | [PR #133], merged 6 Nov |
| [#28] | EN 18286 + ISO/IEC 42001 management-system audit pack | [PR #141], merged 12 Nov |
| [#29] | NIST AI RMF 1.0 and AI 600-1 crosswalk | [PR #154], merged 13 Nov |
| [#30] | NYC Local Law 144 bias audit: computations, pack and publishable summary | [PR #142], merged 12 Nov |
| [#31] | Design: GenAI evaluation evidence ingestion — formats, per-item schema, evidence levels | [PR #49], merged 6 Nov |
| [#32] | Engine: ingest and recompute GenAI evaluation evidence (Inspect, lm-eval-harness, promptfoo, garak) | [PR #118], merged 6 Nov |
| [#33] | GenAI evidence in the workspace: intake, evidence levels, results and readiness gate | [PR #143], merged 13 Nov |
| [#61] | Criteria model phase 2: explicit pins, framework stamps in reports, generated obligation and Annex IV maps, criteria refs on findings | [PR #140], merged 12 Nov |
| [#80] | Report: state the generative-AI limitation only for engagements whose system is generative | Done in [PR #143] (with [#33]); closed 13 Nov |
| [#83] | Dossier: scoped export for large audit files | [PR #139], merged 12 Nov |
| [#128] | GenAI evidence follow-ups: genai_ingest worker job, signed marking results and C2PA reports, inert excerpts | [PR #160], merged 13 Nov |
| [#135] | Coverage views: actor and date filters, CSV export, and requirement-level applicability from the rule pack | [PR #157], merged 13 Nov |
| [#136] | Hosted runner: clustered plans, regression baseline parity and reason texts | [PR #158], merged 13 Nov |
| [#144] | Management-system and LL144 pack follow-ups: pack clauses in findings, certification defaults, draft caveats and per-group LL144 runs | [PR #155], merged 13 Nov |
| [#145] | GenAI workspace follow-ups: evidence levels in the vault, re-run attestation, extra crosswalk links and the dev dependency scan | [PR #159], merged 13 Nov |
| [#152] | Statistics and Art 50 follow-ups: macro F1 power, multiclass assumption schema, Art 50 readiness by period | [PR #164], merged 13 Nov |
| [#161] | Link the GenAI evaluation pack to NIST AI 600-1 risks | [PR #168], merged 13 Nov |

### M3 Release readiness

| Issue | Title | Outcome |
|---|---|---|
| [#34] | E2E: Playwright persona suite with accessibility checks in CI | [PR #86], merged 6 Nov |
| [#35] | UX: attestation dialogs, permission-aware actions and consistent error handling | [PR #177], merged 13 Nov |
| [#36] | Accessibility fixes and a dedicated client portal shell | [PR #180], merged 14 Nov |
| [#37] | Remove dead code, unused components and unused dependencies | **Open.** [PR #196] in review |
| [#38] | Docs: capability matrix, README and status docs that match the code | **Open.** This refresh, [PR #198], stacked last |
| [#39] | UI correctness: triage the 62 React Compiler lint disables and fix runtime React warnings | [PR #171], merged 13 Nov |
| [#52] | Test: move pure-module harness checks into Vitest and unit-test commands covered only over HTTP | [PR #172], merged 13 Nov |
| [#62] | Engine packaging: one supported Python version, cryptography in the runtime image, signature tests that cannot skip in CI | [PR #146], merged 13 Nov |
| [#63] | Client data layer: one cached assurance query for the workspace views, and per-view memoisation (F-47, F-48) | [PR #176], merged 13 Nov |
| [#64] | Refactor: split audit-program.tsx, assurance-workbench.tsx and testing-lab.tsx along their views | Done through [#186], [#187], [#188] and [#193] ([PR #190], [PR #192], [PR #191] and [PR #195]); closed 14 Nov |
| [#70] | Refactor: retire the lib/store.ts barrel and import ids and bindings from their own modules | [PR #169], merged 13 Nov |
| [#94] | Report release polish: drawer refresh, client notification, and paper and procedure cues for retired or release-time records | [PR #163], merged 13 Nov |
| [#95] | Access lifecycle follow-ups: membership email, invitation sender, lapsed grants and practice deletion | [PR #148], merged 13 Nov |
| [#96] | E2E: add the remaining persona flows from #34 | [PR #165], merged 13 Nov |
| [#121] | Integrity and workbench follow-ups: an incident view for admins, a lighter workbench snapshot and a review-subject index | [PR #150], merged 13 Nov |
| [#134] | Client-local jobs follow-ups: pin tool, declared columns checked at queue time, client attestation, group-size floor | [PR #156], merged 13 Nov |
| [#137] | Exports: validate stored dataset cards, decide the package proof scope, and show exported working papers | [PR #153], merged 13 Nov |
| [#151] | Operator and integrity follow-ups: retention of issued work, operator listing, incident handling | [PR #162], merged 13 Nov |
| [#166] | Client-local jobs: check the cluster column against the pin's declared header at queue time | [PR #167], merged 13 Nov |
| [#170] | Test: dataset-header worksheet-budget test times out under load | [PR #173], merged 13 Nov |
| [#174] | Test: heavy Vitest cases time out under parallel load | [PR #175], merged 13 Nov |
| [#178] | UX follow-ups: fetchJson for the remaining consumers, canSee for views, explained role narrowing | [PR #179], merged 14 Nov |
| [#181] | Paginated, filterable engagement audit trail and practice Access log with export (F-73) | [PR #184], merged 14 Nov |
| [#182] | Client portal and accessibility follow-ups from #36 | [PR #183], merged 14 Nov |
| [#185] | Access log and permission follow-ups from #181 and #182 | [PR #189], merged 14 Nov |
| [#186] | Split app/audit-program.tsx along its views (part of #64) | [PR #190], merged 14 Nov |
| [#187] | Split app/assurance-workbench.tsx along its views (part of #64) | [PR #192], merged 14 Nov |
| [#188] | Split app/testing-lab.tsx along its views (part of #64) | [PR #191], merged 14 Nov |
| [#193] | Finish #64: split acceptance-panel.tsx and tidy the split modules | [PR #195], merged 14 Nov |
| [#194] | Flaky e2e: workerd 'Network connection lost' in report-release.spec.ts | [PR #197], merged 14 Nov |
| [#199] | Test the 50 MB evidence upload limit and harden the e2e server start | **Open.** [PR #200] in review: boundary tests for the evidence and client submission limits, and an e2e server that refuses an incomplete build |
| [#201] | Release verification: server-side defects (client projection leak, missing guards, refusal messages) | **Open.** [PR #205] in review: no staff ids in client projections, 409 and 404 guards, clearer refusals, strict filters (D-46), withdrawal of a superseded client-visible report (D-45), #19's label confirmed (D-47) |
| [#202] | Release verification: UI defects (revoked screen, labels, guidance, LL144 checklist, compile draft) | **Open.** [PR #208] in review: the eleven items, one capture-gate list for UI and server (D-48), and Withdraw for a superseded client-visible report |
| [#203] | Release verification: keyboard focus in record sheets and the client portal | **Open.** [PR #206] in review: focus returns to the opener from every dialog and sheet; the portal forms take and return focus |
| [#204] | Release verification: dev server returns 500 on server-rendered pages; local setup docs | **Open.** [PR #207] in review: SSR errors logged on the dev server, a short harness temp directory on Windows, the migration step in the README Quick start |

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

These themes are deferred from this cycle; the order is not a ranking. R-numbers are recommendation ids from section 4 of the [synthesis](docs/research/2026-11/synthesis.md), which scopes each one; F-numbers are codebase-review findings at `74c6463`. The items are kept as they were written when deferred; some name prerequisites that have since landed, such as the signing keys of [#25] and the client portal shell of [#36], and they stay deferred until an issue picks them up.

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
  - an engine validation dossier for each release (R3.8): the [#9] golden cases are its start;
  - an exact (Fisher lower-tail) gate on chance-baseline fails, decided on 6 Nov 2026 ([decision D-21](docs/product/decisions.md)): a fail never lets a model that ignores the truth pass, and section 6 of the specification documents how often such a model fails.
- **Criteria model** (the design for [#26], [PR #45]):
  - phase 3, repin with diff, impact review and revert, and reviewed links for pack #1: it builds on phases 1 and 2 ([#27], [#61]), and until then a pin never moves and pack #1's migrated links stay conservative;
  - phase 6, OSCAL export, a tenant default pack, engagement-level link tailoring and tenant-authored packs: no pack this cycle needs them, and tenant-authored packs would need a new D1 table.
- **GenAI evidence** (the design for [#31], [PR #49]):
  - signed L3 attestations and worker-executed re-runs (R6.4): they come after [#25], which provides the signing keys;
  - multi-gigabyte agent logs (design Q9): they exceed the 50 MB upload and parse limits and need chunked or streamed upload and an incremental parser;
  - an unpaired two-sample criterion for prompt-variant comparisons (design Q13): the first version compares systems on the same inputs only.
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

Deferred during the cycle:

- **Dossier keys** (from [#25], [PR #107]; [#38, comment](https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6689952129)):
  - KEK rotation: accept `DOSSIER_KEK_PREVIOUS` and re-wrap active keys when they are used;
  - publish verification keys publicly or signed, with a key history and a revocation list;
  - KMS- or HSM-backed dossier signing.
- **Access log** (from [#181] and [#185]; [decision D-41](docs/product/decisions.md)):
  - exact sign-in recording through Cloudflare Access hooks, which needs owner configuration;
  - moving `pruneSignIns` (`site-app/lib/tenancy.ts`) to a scheduled Worker handler if one is added.
- **Hosting:** whether to drop the Sites connector runtime, which the app does not use, is the hosting owner's call ([decision D-44](docs/product/decisions.md)).

## Watch list

Facts and risks the product depends on that are still moving. On each date, re-check the item and update the issue or file it names. "Verified" means the primary source was read on the date given; "secondary" means only secondary sources were found.

### Regulatory and standards

| Re-check | What to check | Status at 14 Nov 2026 | Affects |
|---|---|---|---|
| 1 Dec 2026, then monthly | Final adoption of the Commission's Art 6 high-risk classification guidelines | Still a draft: the [Commission page](https://digital-strategy.ec.europa.eu/en/library/draft-guidelines-high-risk) shows publication 19 May 2026, last update 23 July 2026, and the title "Draft Commission guidelines". Verified 14 Nov 2026 | classifications record the guidance status and version they used ([#19]) |
| 1 Dec 2026 | CEN-CENELEC JTC 21 votes: prEN 18229-1 (logging; forecast vote 30 Nov 2026) and the formal vote on prEN 18228 (risk management) | Not re-checked in this refresh; last verified 5 Nov 2026 ([PR #43]) | the standards register in the rule pack ([#18]) |
| 4 Jan 2027 | The vote on prEN ISO/IEC 42006 (forecast 31 Dec 2026) | Not re-checked; last verified 5 Nov 2026 ([PR #43]) | the standards register ([#18]) |
| 1 Dec 2026, then monthly | The EEOC's rescission of its interpretation of the Uniform Guidelines (UGESP) | No published final rule found. The agency's agenda reportedly lists final action for November 2026 (secondary: [Ogletree](https://ogletree.com/insights-resources/blog-posts/the-eeocs-regulatory-agenda-10-signs-of-intent/), [SHRM](https://www.shrm.org/content/shrm/us/en/topics-tools/employment-law-compliance/eeoc-moves-to-roll-back-longstanding-hiring-guidelines.html)); search of 14 Nov 2026, secondary only | the four-fifths screen's caveat ([#22], [#30]) |
| 2 Feb 2027 | The Code of Practice's watermark-detection interoperability milestone (Section 1, Measure 3.4) | Due 2 Feb 2027 per the Code ([Art 50 research](docs/research/art50-transparency-2026-11.md), verified 5 Nov 2026); procedure A50-P-02D-S03 tests it for periods from that date | Art 50 working papers WP-XC-10 ([#78], [#120]) |
| 1 Dec 2026, then quarterly | Updates to the Code of Practice on AI-generated content, and reviews of the Art 50 guidelines (the Commission says it will review them as experience grows; the Code is reviewed at least every two years) | No change found; last verified 5 Nov 2026 ([Art 50 research](docs/research/art50-transparency-2026-11.md)) | Art 50 papers and criteria ([#77], [#120]) |
| 1 Dec 2026 | A Romanian version of the Art 50 guidelines | Still missing: the [Commission page](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems) lists 23 language versions without Romanian (last update 5 Nov 2026). Verified 14 Nov 2026 | Romanian-language engagements cite the English text |
| 1 Dec 2026 | The status of the C2PA interim trust list (UV-A50-01) | Unverified: only a secondary source says it was frozen on 1 January 2026 and replaced by the official C2PA trust list ([Art 50 research](docs/research/art50-transparency-2026-11.md), source SEC-CAI-TRUST-LISTS) | C2PA report checks in the engine ([#128]) |
| 1 Dec 2026, and at each PyRIT minor release | PyRIT's planned `--output json` | Not re-checked; until it ships, the engine reads PyRIT through its own `pyrit-export/1` contract ([PR #49], Q5) | GenAI ingestion ([#32]) |
| 1 Dec 2026, and before the OWASP pack is released | The official OWASP Top 10 for LLM Applications 2026 document | Not re-checked; the 2026 identifiers come from secondary summaries ([PR #49], Q1) | GenAI pack mappings ([#33]) |

### Engineering

| What to watch | Why | Where |
|---|---|---|
| GitHub Actions billing | Every CI job is refused before it starts; nothing should merge on red or missing CI. The two `main` runs for [PR #195] and [PR #197] need a re-run | [#57, comment](https://github.com/ahed-jneed/ai-assurance/issues/57#issuecomment-6872999518) |
| Dev server SSR 500 on a cold start | Not reproduced in about 15 cold starts; server-rendering errors are now logged with their stack, so a recurrence names its cause. `build/ssr-error-log.ts` patches Vinext and its test fails if an upgrade moves the anchor | `site-app/build/ssr-error-log.ts`; [#204] |
| Release does not recheck LL144 per-group runs | `assertReleasable` rechecks the report gates only; capture already refuses incomplete runs ([decision D-48](docs/product/decisions.md)) | `site-app/lib/workflow/report-release.ts`; [#202] |
| Building beside a running e2e server | `npm run build` or `npm run check` in the same checkout as a running e2e server rewrites `dist/` mid-run | `site-app/e2e/README.md`; [#194] |
| Sign-ins are recorded after an 8-hour gap, not at session start | The Access log shows first requests, not sessions ([decision D-41](docs/product/decisions.md)) | `site-app/lib/access-events.ts` |
| `pruneSignIns` runs on the request path | Pruning happens when a sign-in is recorded; a scheduled handler would take it off the request path | `site-app/lib/tenancy.ts` |
| The Sites connector runtime | Kept as part of the hosting contract although the app has no connectors ([decision D-44](docs/product/decisions.md)) | `site-app/build/sites-worker.ts`, `site-app/lib/connector-context.ts` |
| Large engagements on real D1 | Local tests cannot reproduce production D1 limits; the owner offered a load test of an engagement with more than 1,000 assurance records after a deploy | [#57, comment](https://github.com/ahed-jneed/ai-assurance/issues/57#issuecomment-6681963181) |

## Owner actions (outside the roadmap)

[#57] tracks what only the owner can provide. It is not a roadmap item and has no milestone. The issues it unblocks shipped without it, with the affected content marked unapproved, pending review or draft.

| Action | Unblocks |
|---|---|
| **Fix GitHub Actions billing** (blocking since 14 Nov 2026) and re-run the failed `main` runs | CI on every PR and on `main` |
| Qualified legal review of LR-01 to LR-10 (rule pack, [PR #43]), LR-A50-01 to LR-A50-14 (Art 50, [PR #71]), LR-LL144-01 to LR-LL144-08 (LL144, [PR #142]) and the LL144-based exclusion wording in the independence gate ([#23]) | Rule-pack, Art 50 and LL144 content shown as approved ([decisions D-02, D-17 and D-34](docs/product/decisions.md)) |
| A purchased copy of EN 18286:2026, a licensed copy of ISO/IEC 42001 for clause checks, counsel's sign-off on citing clause numbers with our own titles, a legal review of pack #2's two legal effects and a methodology review of its `superset_of` links | Releasing pack #2 ([#28], [decision D-37](docs/product/decisions.md)) |
| A qualified reviewer for the remaining 34 AI Act article and annex headings in `templates/criteria/` (only Arts 9, 16, 17 and 50 were checked) | A new framework data version without "unverified" headings ([#27]) |
| A qualified assurance practitioner's review of the ISAE 3000 conclusion wording (`site-app/lib/domain/report-model.ts`) and the readiness-with-gaps wording ([#111]) | Report wording that is our own drafting today (D-03) |
| A written AIUC-1 licence and a decision on the CSA AI Controls Matrix licence terms | Any AIUC-1 or AICM content |
| Deploy: set the `DOSSIER_KEK` Worker secret, and expire or restrict D1 backups taken before [#25]'s migration (they hold unwrapped signing keys) | Dossier sealing and briefing export in production (they answer 503 without the secret) |
| Deploy: run the pre-deploy legacy check of the criteria model (section 11.4 of the [criteria-model design](docs/design/criteria-model.md)) on staging and production | Deploying [#27] safely |
| Deploy: pin the compute image's reviewed base digest ([#62], `engine/WORKER.md`) | Production use of the external worker image |
| Deploy, optional: set `PLATFORM_OPERATORS` to use the `/operator` view ([#95], [#151]) | Removing abandoned practices |
| After the next Sites publish: check that sign-in still works ([#11]) | Confirms the compiled-in `sites` identity default |
| Optional: an email provider for invitations ([#12]); a promptfoo account for a genuine red-team fixture ([#32]); report the `commit_refs_rules` push error to GitHub support | Invitation emails; a stronger fixture; nothing is blocked |

[PR #2]: https://github.com/ahed-jneed/ai-assurance/pull/2
[PR #40]: https://github.com/ahed-jneed/ai-assurance/pull/40
[PR #41]: https://github.com/ahed-jneed/ai-assurance/pull/41
[PR #42]: https://github.com/ahed-jneed/ai-assurance/pull/42
[PR #43]: https://github.com/ahed-jneed/ai-assurance/pull/43
[PR #44]: https://github.com/ahed-jneed/ai-assurance/pull/44
[PR #45]: https://github.com/ahed-jneed/ai-assurance/pull/45
[PR #46]: https://github.com/ahed-jneed/ai-assurance/pull/46
[PR #47]: https://github.com/ahed-jneed/ai-assurance/pull/47
[PR #48]: https://github.com/ahed-jneed/ai-assurance/pull/48
[PR #49]: https://github.com/ahed-jneed/ai-assurance/pull/49
[PR #53]: https://github.com/ahed-jneed/ai-assurance/pull/53
[PR #54]: https://github.com/ahed-jneed/ai-assurance/pull/54
[PR #55]: https://github.com/ahed-jneed/ai-assurance/pull/55
[PR #56]: https://github.com/ahed-jneed/ai-assurance/pull/56
[PR #71]: https://github.com/ahed-jneed/ai-assurance/pull/71
[PR #72]: https://github.com/ahed-jneed/ai-assurance/pull/72
[PR #73]: https://github.com/ahed-jneed/ai-assurance/pull/73
[PR #75]: https://github.com/ahed-jneed/ai-assurance/pull/75
[PR #84]: https://github.com/ahed-jneed/ai-assurance/pull/84
[PR #85]: https://github.com/ahed-jneed/ai-assurance/pull/85
[PR #86]: https://github.com/ahed-jneed/ai-assurance/pull/86
[PR #87]: https://github.com/ahed-jneed/ai-assurance/pull/87
[PR #88]: https://github.com/ahed-jneed/ai-assurance/pull/88
[PR #89]: https://github.com/ahed-jneed/ai-assurance/pull/89
[PR #90]: https://github.com/ahed-jneed/ai-assurance/pull/90
[PR #91]: https://github.com/ahed-jneed/ai-assurance/pull/91
[PR #92]: https://github.com/ahed-jneed/ai-assurance/pull/92
[PR #97]: https://github.com/ahed-jneed/ai-assurance/pull/97
[PR #98]: https://github.com/ahed-jneed/ai-assurance/pull/98
[PR #99]: https://github.com/ahed-jneed/ai-assurance/pull/99
[PR #100]: https://github.com/ahed-jneed/ai-assurance/pull/100
[PR #101]: https://github.com/ahed-jneed/ai-assurance/pull/101
[PR #106]: https://github.com/ahed-jneed/ai-assurance/pull/106
[PR #107]: https://github.com/ahed-jneed/ai-assurance/pull/107
[PR #108]: https://github.com/ahed-jneed/ai-assurance/pull/108
[PR #109]: https://github.com/ahed-jneed/ai-assurance/pull/109
[PR #110]: https://github.com/ahed-jneed/ai-assurance/pull/110
[PR #114]: https://github.com/ahed-jneed/ai-assurance/pull/114
[PR #115]: https://github.com/ahed-jneed/ai-assurance/pull/115
[PR #117]: https://github.com/ahed-jneed/ai-assurance/pull/117
[PR #118]: https://github.com/ahed-jneed/ai-assurance/pull/118
[PR #122]: https://github.com/ahed-jneed/ai-assurance/pull/122
[PR #123]: https://github.com/ahed-jneed/ai-assurance/pull/123
[PR #124]: https://github.com/ahed-jneed/ai-assurance/pull/124
[PR #125]: https://github.com/ahed-jneed/ai-assurance/pull/125
[PR #126]: https://github.com/ahed-jneed/ai-assurance/pull/126
[PR #129]: https://github.com/ahed-jneed/ai-assurance/pull/129
[PR #130]: https://github.com/ahed-jneed/ai-assurance/pull/130
[PR #131]: https://github.com/ahed-jneed/ai-assurance/pull/131
[PR #132]: https://github.com/ahed-jneed/ai-assurance/pull/132
[PR #133]: https://github.com/ahed-jneed/ai-assurance/pull/133
[PR #138]: https://github.com/ahed-jneed/ai-assurance/pull/138
[PR #139]: https://github.com/ahed-jneed/ai-assurance/pull/139
[PR #140]: https://github.com/ahed-jneed/ai-assurance/pull/140
[PR #141]: https://github.com/ahed-jneed/ai-assurance/pull/141
[PR #142]: https://github.com/ahed-jneed/ai-assurance/pull/142
[PR #143]: https://github.com/ahed-jneed/ai-assurance/pull/143
[PR #146]: https://github.com/ahed-jneed/ai-assurance/pull/146
[PR #147]: https://github.com/ahed-jneed/ai-assurance/pull/147
[PR #148]: https://github.com/ahed-jneed/ai-assurance/pull/148
[PR #149]: https://github.com/ahed-jneed/ai-assurance/pull/149
[PR #150]: https://github.com/ahed-jneed/ai-assurance/pull/150
[PR #153]: https://github.com/ahed-jneed/ai-assurance/pull/153
[PR #154]: https://github.com/ahed-jneed/ai-assurance/pull/154
[PR #155]: https://github.com/ahed-jneed/ai-assurance/pull/155
[PR #156]: https://github.com/ahed-jneed/ai-assurance/pull/156
[PR #157]: https://github.com/ahed-jneed/ai-assurance/pull/157
[PR #158]: https://github.com/ahed-jneed/ai-assurance/pull/158
[PR #159]: https://github.com/ahed-jneed/ai-assurance/pull/159
[PR #160]: https://github.com/ahed-jneed/ai-assurance/pull/160
[PR #162]: https://github.com/ahed-jneed/ai-assurance/pull/162
[PR #163]: https://github.com/ahed-jneed/ai-assurance/pull/163
[PR #164]: https://github.com/ahed-jneed/ai-assurance/pull/164
[PR #165]: https://github.com/ahed-jneed/ai-assurance/pull/165
[PR #167]: https://github.com/ahed-jneed/ai-assurance/pull/167
[PR #168]: https://github.com/ahed-jneed/ai-assurance/pull/168
[PR #169]: https://github.com/ahed-jneed/ai-assurance/pull/169
[PR #171]: https://github.com/ahed-jneed/ai-assurance/pull/171
[PR #172]: https://github.com/ahed-jneed/ai-assurance/pull/172
[PR #173]: https://github.com/ahed-jneed/ai-assurance/pull/173
[PR #175]: https://github.com/ahed-jneed/ai-assurance/pull/175
[PR #176]: https://github.com/ahed-jneed/ai-assurance/pull/176
[PR #177]: https://github.com/ahed-jneed/ai-assurance/pull/177
[PR #179]: https://github.com/ahed-jneed/ai-assurance/pull/179
[PR #180]: https://github.com/ahed-jneed/ai-assurance/pull/180
[PR #183]: https://github.com/ahed-jneed/ai-assurance/pull/183
[PR #184]: https://github.com/ahed-jneed/ai-assurance/pull/184
[PR #189]: https://github.com/ahed-jneed/ai-assurance/pull/189
[PR #190]: https://github.com/ahed-jneed/ai-assurance/pull/190
[PR #191]: https://github.com/ahed-jneed/ai-assurance/pull/191
[PR #192]: https://github.com/ahed-jneed/ai-assurance/pull/192
[PR #195]: https://github.com/ahed-jneed/ai-assurance/pull/195
[PR #196]: https://github.com/ahed-jneed/ai-assurance/pull/196
[PR #198]: https://github.com/ahed-jneed/ai-assurance/pull/198
[PR #200]: https://github.com/ahed-jneed/ai-assurance/pull/200
[PR #205]: https://github.com/ahed-jneed/ai-assurance/pull/205
[PR #206]: https://github.com/ahed-jneed/ai-assurance/pull/206
[PR #207]: https://github.com/ahed-jneed/ai-assurance/pull/207
[PR #208]: https://github.com/ahed-jneed/ai-assurance/pull/208
[PR #197]: https://github.com/ahed-jneed/ai-assurance/pull/197
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
[#69]: https://github.com/ahed-jneed/ai-assurance/issues/69
[#70]: https://github.com/ahed-jneed/ai-assurance/issues/70
[#74]: https://github.com/ahed-jneed/ai-assurance/issues/74
[#76]: https://github.com/ahed-jneed/ai-assurance/issues/76
[#77]: https://github.com/ahed-jneed/ai-assurance/issues/77
[#78]: https://github.com/ahed-jneed/ai-assurance/issues/78
[#79]: https://github.com/ahed-jneed/ai-assurance/issues/79
[#80]: https://github.com/ahed-jneed/ai-assurance/issues/80
[#81]: https://github.com/ahed-jneed/ai-assurance/issues/81
[#82]: https://github.com/ahed-jneed/ai-assurance/issues/82
[#83]: https://github.com/ahed-jneed/ai-assurance/issues/83
[#93]: https://github.com/ahed-jneed/ai-assurance/issues/93
[#94]: https://github.com/ahed-jneed/ai-assurance/issues/94
[#95]: https://github.com/ahed-jneed/ai-assurance/issues/95
[#96]: https://github.com/ahed-jneed/ai-assurance/issues/96
[#102]: https://github.com/ahed-jneed/ai-assurance/issues/102
[#103]: https://github.com/ahed-jneed/ai-assurance/issues/103
[#104]: https://github.com/ahed-jneed/ai-assurance/issues/104
[#105]: https://github.com/ahed-jneed/ai-assurance/issues/105
[#111]: https://github.com/ahed-jneed/ai-assurance/issues/111
[#112]: https://github.com/ahed-jneed/ai-assurance/issues/112
[#113]: https://github.com/ahed-jneed/ai-assurance/issues/113
[#119]: https://github.com/ahed-jneed/ai-assurance/issues/119
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
[#170]: https://github.com/ahed-jneed/ai-assurance/issues/170
[#174]: https://github.com/ahed-jneed/ai-assurance/issues/174
[#178]: https://github.com/ahed-jneed/ai-assurance/issues/178
[#181]: https://github.com/ahed-jneed/ai-assurance/issues/181
[#182]: https://github.com/ahed-jneed/ai-assurance/issues/182
[#185]: https://github.com/ahed-jneed/ai-assurance/issues/185
[#186]: https://github.com/ahed-jneed/ai-assurance/issues/186
[#187]: https://github.com/ahed-jneed/ai-assurance/issues/187
[#188]: https://github.com/ahed-jneed/ai-assurance/issues/188
[#193]: https://github.com/ahed-jneed/ai-assurance/issues/193
[#194]: https://github.com/ahed-jneed/ai-assurance/issues/194
[#199]: https://github.com/ahed-jneed/ai-assurance/issues/199
[#201]: https://github.com/ahed-jneed/ai-assurance/issues/201
[#202]: https://github.com/ahed-jneed/ai-assurance/issues/202
[#203]: https://github.com/ahed-jneed/ai-assurance/issues/203
[#204]: https://github.com/ahed-jneed/ai-assurance/issues/204
