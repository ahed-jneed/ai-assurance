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

[c18]: https://github.com/ahed-jneed/ai-assurance/issues/18#issuecomment-6666623902
[c21]: https://github.com/ahed-jneed/ai-assurance/issues/21#issuecomment-6666624939
[c22]: https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6666625399
[c22b]: https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6680839160
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
