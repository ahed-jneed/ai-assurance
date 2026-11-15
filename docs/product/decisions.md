# Decision log

Product and technical decisions for the platform, oldest first. Each entry links to where it was recorded, usually an orchestrator comment on the issue that carries it out; that issue governs the details. The [product direction](direction.md) states what the decisions serve, and [ROADMAP.md](../../ROADMAP.md) places the work.

- **Adding a decision:** append a row with the next ID, the date, the decision, why, and a link to where it was recorded.
- **Changing a decision:** append a new row that names the decision it replaces, and add "Superseded by D-nn" to the old row. Old rows are not otherwise rewritten.
- **IDs:** D-01 onwards. The codebase review's own architectural decisions (D1 to D6, in a section of the review that the [codebase map](../engineering/codebase-map.md) does not reproduce) are cited here as "review decision D2" and so on.

| ID | Date | Decision | Why | Where recorded |
|---|---|---|---|---|
| D-01 | 5 Nov 2026 | Generative systems are in scope for classification, the Art 5 prohibitions and the Art 50 transparency obligations from rule pack 2026.11. Their evaluation evidence arrives with M2 ([#31] to [#33]); until then, reports state that limitation. | The 2 Dec 2026 milestones concern generative systems, which the methodology's "traditional ML" scope sentence leaves out (RD-49 in [PR #43]'s research). | [#18, comment point 3][c18] |
| D-02 | 5 Nov 2026 | Legal content shows as pending legal review, not approved, until a qualified reviewer signs it off. | The rule-pack research is not legal advice, and ten of its points (LR-01 to LR-10) need qualified legal review, which only the owner can commission. Review decision D5 already required such content to be labelled. | [#18, comment point 2][c18]; [#57] |
| D-03 | 5 Nov 2026 | Standards text is never reproduced: clauses are cited by number with our own titles of at most 80 characters, and no text, tables or figures. The EN 18286 + ISO/IEC 42001 pack is built with its release blocked until counsel confirms this policy and the standard has been purchased. | ISO/IEC and CEN-CENELEC standards are paywalled, and counsel has not yet confirmed the policy (design question Q1 of [#26]). | [#28, comment][c28]; [#57] |
| D-04 | 5 Nov 2026 | Ratio intervals keep Katz-log with the Koopman fallback, in the engine and in the hosted runner. | It is conservative, which errs safe for audit claims, and switching later is a local change. | [#21, comment (Q1)][c21]; [#22, comment][c22] |
| D-05 | 5 Nov 2026 | The confirmatory family uses Bonferroni, not Holm. | A step-down procedure needs pre-registered claim directions or an independence argument that one dataset cannot supply. | [#21, comment (Q9)][c21]; [#22, comment][c22] |
| D-06 | 5 Nov 2026 | Drift stays point-estimate screening outside the families: its results carry no decision and the limitation "point-estimate screening; not interval-based". | Drift (PSI, KS, Wasserstein) has no interval specification yet; one is on the [Later list](../../ROADMAP.md#later). | [#21, comment (Q6)][c21]; [#22, comment][c22] |
| D-07 | 5 Nov 2026 | [#18] defines the engagement-level rule-pack stamp (field name and values). [#27] reads it from #18's merged code and converts methodology 2026.11.1 into pack #1 2026.11.1. | #18 merges first and does not know the criteria model (design question Q5 of [#26]). | [#27, comment (Q5)][c27]; [#18, comment point 5][c18] |
| D-08 | 5 Nov 2026 | Release approvers: a qualified legal reviewer for framework documents for legislation; the methodology owner for packs and crosswalks; both, as two different people, for entries with `legalEffect`. | Legislation needs qualified legal review (review decision D5), packs and crosswalks are methodology, and a `legalEffect` entry records a legal consequence, such as a presumption of conformity, inside methodology data. | [#27, comment (Q4)][c27] |
| D-09 | 5 Nov 2026 | Obligation records count as direct coverage sources from phase 1 of the criteria model, on packs with `features.obligationAssessments`. | An obligation record's code is a requirement id, so it is a direct, requirement-level assessment. | [#27, comment (Q6)][c27] |
| D-10 | 5 Nov 2026 | Judge-validation floor: the lower bound of the 95% interval for Cohen's kappa against human labels is at least 0.60, on at least 50 items. Plans may raise the floor, never lower it. The judge's model family must differ from that of the system under test, with families taken at developer level (fine-tunes and distillations inherit their base model's family). | LLM judges show position, verbosity and self-enhancement biases, and a same-family judge's errors correlate with the system's. A floor stops a plan from weakening the check. | [#33, comment (Q3, Q6)][c33] |
| D-11 | 5 Nov 2026 | Special-category fairness data stays client-side by default: such tests run through the external worker or the runtime package and return approved aggregates. Before such data reaches the platform, the client's Art 4a or GDPR Art 9(2) basis must be recorded, and a hosted run also needs an explicit acknowledgement. | Art 4a(1)(d) bars access by "other parties", so on its face it cannot by itself let a client upload such data to an external auditor's platform (LR-06, pending legal review). | [#60] |
| D-12 | 5 Nov 2026 | The external worker fails fast at claim time, before any download, on a label-set mismatch. The platform derives the label pair from the registered model at queue time and rejects a pair that is not exactly the model's two labels. | Since [PR #47] the frozen negative label decides outcomes, and the queue's default of `"0"` makes a job for a model labelled, say, `no` and `yes` fail with `label_set_mismatch`, at first only after its inputs had been downloaded; PR #47 now rejects it at claim time. | [#58]; proposed in the [PR #47 review][c47]; the worker half is in the [PR #47 fixes][c47fix] |
| D-13 | 5 Nov 2026 | Stay on Cloudflare D1 with the engagement-aggregate persistence model: remove its scaling cliffs instead of replatforming, and label `db/postgres.sql` a superseded design. | The PostgreSQL design has never been built, and migrating now would stall every feature (review decision D2). | [#38] (scope) |
| D-14 | 5 Nov 2026 | One source of truth for contracts and methodology data: the root `schemas/`, `templates/` and `engine/` folders (and `docs/obligation-subitems.json`) are canonical, and CI checks the generated copies in `site-app/` against them. | The copies had already drifted: five files in `site-app/reference/` had diverged, four of them newer in the copy (F-22; review decision D3). | [#3] |
| D-15 | 5 Nov 2026 | The scope and program submission limits (40 and 75) count returns only. An approved or withdrawn submission uses none, so a scope or program in force always has a submission left. Approval cycles and Lead withdrawals are bounded only by the 1.5 MB engagement metadata limit, which refuses a write that would exceed it whole. | Counting submissions let a change land that its next submission could not complete, so the approved records were lost (F-29). Each approval took an independent decision and each withdrawal a Lead's substantive change. | [PR #54], decision 8; [round-2 response, item 4][c54] |
| D-16 | 5 Nov 2026 | Extends D-10: a pairwise judge is validated only if the Wilson lower bound of its position-swap consistency is at least 0.80, and a label file without AB/BA pairs never validates it. The kappa and position-consistency values are both floors of the GenAI plan, which a plan must not lower. | LLM judges show position bias (D-10), and swapping the order of the two outputs measures it. | [PR #49], design [8.1][g81] and [8.7][g87]; [re-review round 1, nit 4][c49] |
| D-17 | 6 Nov 2026 | Qualifies D-08: the methodology owner may release a legislation framework, and pack #1, while its qualified legal review is still pending. The UI shows that status, and the legal reviewer's approval is appended later without changing frozen content. [#27] is not blocked by [#57]. | Pack #1 2026.11.1 contains rule-pack entries pending legal review (D-02), so requiring the legal approval first would have blocked #27 on an owner action, although #57 says the issues it unblocks ship without it. | [#27, comment][c27b]; recommended in the [PR #45 review][c45] |
| D-18 | 6 Nov 2026 | At [#27]'s deploy, AI Act engagements replace the "Article coverage" bars and the article-to-evidence percentages with the coverage summary and heatmap, as designed, and the migration note in the drawer explains the change. Papers signed are never shown as coverage. | Otherwise the Overview would keep AI Act article bars beside the new coverage view ([PR #45] review). Papers-signed progress already has its own place in the overview. | [#27, comment][c27b] |
| D-19 | 5 Nov 2026 | Every classification criterion derived from a legacy configuration, when it has members, carries a chance baseline member: balanced accuracy of at least 0.5 for binary data, or macro recall of at least 1/k for k classes, or the policy's own bound when it is higher. Any balanced-accuracy member whose lower bound is at or above chance, in explicit plans too, also needs the exact chance gate to pass. Whether explicit plans must carry a baseline is left to [#15] (F-06). | A model whose predictions ignore the truth sits exactly on chance. Once metrics without a threshold stop blocking a pass, the baseline and its gate keep such models from passing. The gate depends only on the metric and the bound, and it can only make a pass harder. | [PR #46], statistics design [4.8][s48] and [5.2][s52]; [re-review round 2][c46r3] |
| D-20 | 5 Nov 2026 | A criterion derived from engine thresholds lists R² (regression) or ECE (calibration) in `passBlockedBy`, whether or not the policy sets their threshold: it never passes (`undecidable_metric`), and it can still fail on its MAE, RMSE or Brier members. Explicit plans have no `passBlockedBy`. | Statistics 1.0.0 has no interval that decides R² or ECE, yet today's rule makes a pass depend on them. Without the block, a mean predictor would pass on MAE and RMSE alone (GC-48). | [PR #46], statistics design [4.8][s48]; [re-review round 1, comment 1][c46r1] |
| D-21 | 6 Nov 2026 | Statistics 1.0.0 adds no exact (Fisher lower-tail) gate to a chance-baseline fail. That gate is on the [Later list](../../ROADMAP.md#later). | A fail never lets a model that ignores the truth pass, and section 6 of the statistics design documents how often such a model fails. A lower-tail exact gate would fit only a bound that equals chance exactly. | [#22, comment][c22b]; recommended in the [PR #46 review][c46r3] |
| D-22 | 5 Nov 2026 | Until [#65] ports the 2.1.0 performance rules and the performance positive class to the engine, `queueExternal` refuses (400) an external run of a binary performance protocol whose performance positive class differs from the favourable label. Superseded by D-25. | The external worker measures recall on the favourable label only. A refusal at queue time tells the auditor at once and also covers workers that are already deployed. | [PR #56, round-1 response, item 1][c56] |
| D-23 | 5 Nov 2026 | Identity denies by default: with `IDENTITY_MODE` unset, empty or unknown, every request is anonymous and the API answers 401. The Sites build compiles `sites` in as its default, which applies only while `IDENTITY_MODE` is unset, so an explicit value wins. Dev personas exist only on the dev server and are compiled out of builds. | Setting `sites` for every build would leave F-02, forged identity headers, open on any non-Sites deployment. The compiled-in default keeps the Site working even if the publisher does not apply `vars`, which nobody had verified. | [PR #55, round-1 response, item 2][c55]; proposed in the [PR #55 review][c55r] |
| D-24 | 6 Nov 2026 | [#70] owns retiring the `lib/store.ts` barrel: moving its remaining importers and deleting it. [#37]'s barrel item is narrowed to `lib/domain.ts` and `lib/workflow-service.ts`. | #70 already scopes the `lib/store.ts` importers, and it runs in a quiet window after [#12], [#16] and [#17], which change them. | [#37, comment][c37b] |
| D-25 | 6 Nov 2026 | Replaces D-22: `queueExternal` no longer refuses a binary performance protocol whose performance positive class differs from the favourable label. The worker (translation 2.1.0) records the class as the engine's `performancePositiveLabel`, and the engine measures recall, precision and F1 on it. | [#65] ported the performance positive class to the engine, so the refusal no longer protects anything. Statistics 1.0.0 decides hosted and external runs alike, and a shared golden file pins one decision per case. | [PR #98] |
| D-26 | 6 Nov 2026 | Extends D-19 to explicit plans: an explicit (non-derived) hosted performance plan also carries a chance baseline by default (balanced accuracy of at least 0.5 for binary data; macro recall above 1/k for k classes). Normalisation inserts it unless the plan records a rationale for leaving it out, and the approval screen shows when it was left out. Implemented with [#22]. | Without a baseline, an accuracy-only explicit plan passes a constant predictor: the F-06 failure that [#15] fixed for derived plans. | [#22, comment][c22c]; [PR #101]; [#38, comments][c38b] |
| D-27 | 6 Nov 2026 | Final packages captured before report model v2 cannot be released; they must be captured again. No issued snapshot is rewritten. | Report model v2 ([#20]) adds the engagement type, assurance level and ISAE 3000 conclusion type that the released report states, and an issued snapshot keeps the content it was issued with. | [PR #100]; [#38, comment][c38c] |
| D-28 | 6 Nov 2026 | Disqualifying relationships (employment, financial interest, system involvement) declared in the independence gate carry across engagement periods until someone other than the declarant withdraws them. | No safeguard resolves a disqualifying relationship, so neither renewing a declaration nor moving the period clears it; only a Lead Auditor or Reviewer other than the declarant can withdraw one declared in error, with a reason that stays on the declaration ([#23]). | [PR #99]; [#38, comment][c38c] |
| D-29 | 6 Nov 2026 | Accepted departure in the engine: a constant predictor is inconclusive rather than fail, and it never passes. | A constant predictor's balanced accuracy sits exactly on the chance bound, so the interval rule reports it inconclusive (for example `below_minimum_class_count` or `estimate_on_band_boundary`) and it never passes (statistics design section 5.2; [#65]). | [PR #98]; [#38, comment][c38c] |
| D-30 | 6 Nov 2026 | Regression criteria must beat the mean-prediction baseline on RMSE, on both the hosted and the external runner. | Without the baseline, a constant (mean) predictor could pass on MAE and RMSE alone ([#68]). | [PR #117]; [#38, comment][c38d] |
| D-31 | 6 Nov 2026 | The Engagement Quality Reviewer edits nothing except their own quality review and sign-off. Every new command is refused to the EQR by default, until its roles admit the EQR explicitly. | The EQR stands outside the engagement team ([#24]). Refusing the role centrally, instead of leaving it out of each op's role list, makes new ops safe by default and answers 403 rather than a validation 400. | [PR #115]; [#38, comment][c38d] |
| D-32 | 6 Nov 2026 | Extends D-11: special-category fairness data runs without a recorded basis only as a client-local job, on a client-held SHA-256 pin. The platform never receives the bytes. | D-11's reason (LR-06, pending legal review) applies to any upload of such data; a client-local job keeps the bytes with the client, and the platform holds only the SHA-256 pin ([#102]). | [PR #126]; [#38, comment][c38e] |
| D-33 | 6 Nov 2026 | Client-held results withhold groups below the minimum group size, including rows with no group value. Secondary suppression stops a withheld group from being worked out by subtraction, and coverage row counts are blanked. Comparing results across runs to recover a group remains a stated limitation. | Approved aggregates must not reveal small groups of special-category data ([#102]). | [PR #126]; [#38, comment][c38e] |
| D-34 | 12 Nov 2026 | The NYC Local Law 144 pack ships released with its legal review marked pending, as D-17 allowed for the AI Act pack. | Its legal points (LR-LL144-01 to LR-LL144-08) wait for the owner's legal review in [#57], and holding the release back would block [#30] on an owner action. | [PR #142]; [#38, comment][c38f]; [#57, comment][c57ll] |
| D-35 | 12 Nov 2026 | The GenAI workspace ([#33]) merges before the `genai_ingest` worker job ([#128]) and says so in the product. | Intake, evidence levels and the readiness gate did not depend on the worker job. `genai_ingest` later merged with [PR #160]. | [PR #143]; [#38, comment][c38f] |
| D-36 | 12 Nov 2026 | A High or Critical internal-only finding that matches no procedure opens its own client criterion row, with the status 'exceptions'. Lower severities do not. | A serious exception reaches the client's results by criterion even when no selected procedure carries it, while an internal Low or Medium finding adds no row to the client report ([#61]). | [PR #140]; [#38, comment][c38f] |
| D-37 | 12 Nov 2026 | Applies D-03: pack #2 (EN 18286 and ISO/IEC 42001, [#28]) ships as drafts until the owner actions in [#57] are done. | Its clause numbers and Annex ZA scope must be confirmed against licensed copies, and counsel has not yet confirmed the citation policy. | [PR #141]; [#38, comment][c38f]; [#57, comment][c57ll] |
| D-38 | 14 Nov 2026 | The practice Access log is open only to practice administrators who hold a staff role (least privilege, the same as the admin-only rule for management events). Lead Auditors without the admin flag are refused. There is no Partner role. | Least privilege: the same rule already limits management events to practice administrators ([#181], [#185]). | [PR #184], [PR #189]; [#38, comment][c38g] |
| D-39 | 14 Nov 2026 | Client Contributors do not see the Findings destination; the client projection gives them none. | The client projection carries no findings for a Contributor, so the destination would always be empty ([#36], [#182]). | [PR #180], [PR #183]; [#38, comment][c38g] |
| D-40 | 14 Nov 2026 | No practice switch for client users. | No current flow puts a client in two practices ([#36], [#182]). | [#38, comment][c38g] |
| D-41 | 14 Nov 2026 | A sign-in is recorded as a member's first request to a practice after an 8-hour gap (`signInGapHours` in `site-app/lib/access-events.ts`). | No identity mode reports a session start, and identity is resolved on every request ([#181]). Exact recording is on the watch list. | [PR #184]; [#38, comment][c38g] |
| D-42 | 14 Nov 2026 | Recorded sign-ins (`sign_in_events`) are kept for 400 days and pruned when a new one is recorded; management events are kept. | A year plus a margin covers an annual audit cycle ([#185]). | [PR #189]; [#38, comment][c38g] |
| D-43 | 14 Nov 2026 | [#64] is split into [#186], [#187] and [#188], one file each, so they could run in parallel; [#193] finishes it. | One file per issue let the three splits run in parallel. | [#38, comment][c38g]; [#64, comment][c64] |
| D-44 | 14 Nov 2026 | Keep the Sites connector runtime (`build/sites-worker.ts`, the connector-preview build pieces, `lib/connector-context.ts` and `lib/connector-contract.mts`), although the app has no connectors. Whether to drop it is the hosting owner's call. Superseded by D-49. | These files are part of the Sites hosting contract: the worker entry wraps every request in the connector binding ([#37]). | [PR #196]; [#38, comment][c38h] |
| D-45 | 14 Nov 2026 | A superseded report that the client can still read can also be withdrawn, under the same rules as an approved or released one: Lead Auditor only, a required reason and an attested event. A superseded report that was never released still cannot be withdrawn. The release controls offer Withdraw for it. | Once its successor is withdrawn, the client keeps reading the superseded report, and before this nobody could withdraw it ([#201], item 5). `isWithdrawable` in `site-app/lib/workflow-state.ts` is the one rule that the server and the UI ([#202]) both use. | [#201]; [PR #205], [PR #208] |
| D-46 | 14 Nov 2026 | Read endpoints reject an unknown filter value with 400 naming the value, as the Access log already did: the coverage CSV (state, actor, date) and the audit trail and Access log (`action`). An empty parameter still means "all". For the audit trail, an `action` is known when it is an event type recorded in the engagement (the list the response offers). | Lenient parsing answered 200 with an empty result for a typo, which reads as "no matching records" ([#201], item 8). A static list of audit-trail event types would drift from the command modules. | [#201]; [PR #205] |
| D-47 | 14 Nov 2026 | Confirms [#19]'s label behaviour as decided in [PR #97]: facts that decide the risk class (route, Art 5, Art 50 triggers and exclusions) give "Needs information" while unknown; GPAI roles and SME status are required for approval but do not change the label. On a high-risk route, an unknown GPAI, SME or Art 50 fact therefore reads "High risk", and the approval stays blocked. | No answer to those facts can change the class on that route, so the release verification's "regression" was the decided behaviour ([#201], item 9); a test now pins it for every required fact. | [#201]; [PR #97], [PR #205] |
| D-48 | 14 Nov 2026 | The UI and the server list the same final-capture blockers from one function, `captureGates` in `site-app/lib/domain/capture-gates.ts` (the report gates plus one gate per incomplete LL144 per-group run). The release recheck still uses the report gates only. | The completion checklist and "Outstanding at capture" left out the LL144 runs that the server refuses on ([#202], item 7); one function keeps the two lists from drifting. Whether release should also recheck LL144 runs is open. | [#202]; [PR #208] |
| D-49 | 15 Nov 2026 | Remove the ChatGPT sign-in and the whole Sites hosting integration: the `sites` identity mode, the Sites build packaging, the connector runtime, the execution profiles and the managed-Linux scripts. Production identity is Cloudflare Access only. The development persona sign-in stays, renamed to `/auth/sign-in` with `x-assurance-user-*` loopback headers. Supersedes D-44. | The owner does not want ChatGPT authentication, and the app does not use the connector runtime. One deployment path is simpler to secure and document before the repository is public. | Owner instruction, 15 Nov 2026 |

[c18]: https://github.com/ahed-jneed/ai-assurance/issues/18#issuecomment-6666623902
[c21]: https://github.com/ahed-jneed/ai-assurance/issues/21#issuecomment-6666624939
[c22]: https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6666625399
[c22b]: https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6680839160
[c22c]: https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6681483015
[c38b]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6681965139
[c38c]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6688173153
[c38d]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6691700278
[c38e]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6697597891
[c38f]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6835424081
[c38g]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6871453274
[c38h]: https://github.com/ahed-jneed/ai-assurance/issues/38#issuecomment-6872938082
[c57ll]: https://github.com/ahed-jneed/ai-assurance/issues/57#issuecomment-6835423621
[c64]: https://github.com/ahed-jneed/ai-assurance/issues/64
[c27]: https://github.com/ahed-jneed/ai-assurance/issues/27#issuecomment-6666626278
[c27b]: https://github.com/ahed-jneed/ai-assurance/issues/27#issuecomment-6680839690
[c28]: https://github.com/ahed-jneed/ai-assurance/issues/28#issuecomment-6666626807
[c33]: https://github.com/ahed-jneed/ai-assurance/issues/33#issuecomment-6666627792
[c37b]: https://github.com/ahed-jneed/ai-assurance/issues/37#issuecomment-6680838666
[c45]: https://github.com/ahed-jneed/ai-assurance/pull/45#issuecomment-6670523242
[c46r1]: https://github.com/ahed-jneed/ai-assurance/pull/46#issuecomment-6667386474
[c46r3]: https://github.com/ahed-jneed/ai-assurance/pull/46#issuecomment-6670785042
[c47]: https://github.com/ahed-jneed/ai-assurance/pull/47#issuecomment-6663908598
[c47fix]: https://github.com/ahed-jneed/ai-assurance/pull/47#issuecomment-6667423208
[c49]: https://github.com/ahed-jneed/ai-assurance/pull/49#issuecomment-6667269695
[c54]: https://github.com/ahed-jneed/ai-assurance/pull/54#issuecomment-6669822890
[c55]: https://github.com/ahed-jneed/ai-assurance/pull/55#issuecomment-6667665622
[c55r]: https://github.com/ahed-jneed/ai-assurance/pull/55#issuecomment-6667120334
[c56]: https://github.com/ahed-jneed/ai-assurance/pull/56#issuecomment-6667912958
[g81]: ../design/genai-evidence.md#81-plan-genai-plan01
[g87]: ../design/genai-evidence.md#87-judge-validation-and-why-the-judge-must-come-from-another-family
[s48]: ../design/audit-statistics.md#48-descriptive-metrics
[s52]: ../design/audit-statistics.md#52-balanced-accuracy-and-macro-recall-mover-and-the-chance-gate
[PR #43]: https://github.com/ahed-jneed/ai-assurance/pull/43
[PR #45]: https://github.com/ahed-jneed/ai-assurance/pull/45
[PR #46]: https://github.com/ahed-jneed/ai-assurance/pull/46
[PR #47]: https://github.com/ahed-jneed/ai-assurance/pull/47
[PR #49]: https://github.com/ahed-jneed/ai-assurance/pull/49
[PR #54]: https://github.com/ahed-jneed/ai-assurance/pull/54
[PR #98]: https://github.com/ahed-jneed/ai-assurance/pull/98
[PR #99]: https://github.com/ahed-jneed/ai-assurance/pull/99
[PR #100]: https://github.com/ahed-jneed/ai-assurance/pull/100
[PR #101]: https://github.com/ahed-jneed/ai-assurance/pull/101
[PR #115]: https://github.com/ahed-jneed/ai-assurance/pull/115
[PR #117]: https://github.com/ahed-jneed/ai-assurance/pull/117
[PR #126]: https://github.com/ahed-jneed/ai-assurance/pull/126
[PR #140]: https://github.com/ahed-jneed/ai-assurance/pull/140
[PR #141]: https://github.com/ahed-jneed/ai-assurance/pull/141
[PR #142]: https://github.com/ahed-jneed/ai-assurance/pull/142
[PR #143]: https://github.com/ahed-jneed/ai-assurance/pull/143
[PR #160]: https://github.com/ahed-jneed/ai-assurance/pull/160
[PR #180]: https://github.com/ahed-jneed/ai-assurance/pull/180
[PR #183]: https://github.com/ahed-jneed/ai-assurance/pull/183
[PR #184]: https://github.com/ahed-jneed/ai-assurance/pull/184
[PR #189]: https://github.com/ahed-jneed/ai-assurance/pull/189
[PR #196]: https://github.com/ahed-jneed/ai-assurance/pull/196
[#3]: https://github.com/ahed-jneed/ai-assurance/issues/3
[#12]: https://github.com/ahed-jneed/ai-assurance/issues/12
[#15]: https://github.com/ahed-jneed/ai-assurance/issues/15
[#16]: https://github.com/ahed-jneed/ai-assurance/issues/16
[#17]: https://github.com/ahed-jneed/ai-assurance/issues/17
[#18]: https://github.com/ahed-jneed/ai-assurance/issues/18
[#26]: https://github.com/ahed-jneed/ai-assurance/issues/26
[#27]: https://github.com/ahed-jneed/ai-assurance/issues/27
[#31]: https://github.com/ahed-jneed/ai-assurance/issues/31
[#33]: https://github.com/ahed-jneed/ai-assurance/issues/33
[#37]: https://github.com/ahed-jneed/ai-assurance/issues/37
[#38]: https://github.com/ahed-jneed/ai-assurance/issues/38
[#57]: https://github.com/ahed-jneed/ai-assurance/issues/57
[#58]: https://github.com/ahed-jneed/ai-assurance/issues/58
[#60]: https://github.com/ahed-jneed/ai-assurance/issues/60
[#65]: https://github.com/ahed-jneed/ai-assurance/issues/65
[#70]: https://github.com/ahed-jneed/ai-assurance/issues/70
[#20]: https://github.com/ahed-jneed/ai-assurance/issues/20
[#22]: https://github.com/ahed-jneed/ai-assurance/issues/22
[#23]: https://github.com/ahed-jneed/ai-assurance/issues/23
[#24]: https://github.com/ahed-jneed/ai-assurance/issues/24
[#28]: https://github.com/ahed-jneed/ai-assurance/issues/28
[#30]: https://github.com/ahed-jneed/ai-assurance/issues/30
[#36]: https://github.com/ahed-jneed/ai-assurance/issues/36
[#61]: https://github.com/ahed-jneed/ai-assurance/issues/61
[#64]: https://github.com/ahed-jneed/ai-assurance/issues/64
[#68]: https://github.com/ahed-jneed/ai-assurance/issues/68
[#102]: https://github.com/ahed-jneed/ai-assurance/issues/102
[#128]: https://github.com/ahed-jneed/ai-assurance/issues/128
[#181]: https://github.com/ahed-jneed/ai-assurance/issues/181
[#182]: https://github.com/ahed-jneed/ai-assurance/issues/182
[#185]: https://github.com/ahed-jneed/ai-assurance/issues/185
[#186]: https://github.com/ahed-jneed/ai-assurance/issues/186
[#187]: https://github.com/ahed-jneed/ai-assurance/issues/187
[#188]: https://github.com/ahed-jneed/ai-assurance/issues/188
[#193]: https://github.com/ahed-jneed/ai-assurance/issues/193
[PR #97]: https://github.com/ahed-jneed/ai-assurance/pull/97
[PR #205]: https://github.com/ahed-jneed/ai-assurance/pull/205
[PR #208]: https://github.com/ahed-jneed/ai-assurance/pull/208
[#19]: https://github.com/ahed-jneed/ai-assurance/issues/19
[#201]: https://github.com/ahed-jneed/ai-assurance/issues/201
[#202]: https://github.com/ahed-jneed/ai-assurance/issues/202
