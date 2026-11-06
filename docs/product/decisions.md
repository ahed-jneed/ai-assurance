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

[c18]: https://github.com/ahed-jneed/ai-assurance/issues/18#issuecomment-6666623902
[c21]: https://github.com/ahed-jneed/ai-assurance/issues/21#issuecomment-6666624939
[c22]: https://github.com/ahed-jneed/ai-assurance/issues/22#issuecomment-6666625399
[c27]: https://github.com/ahed-jneed/ai-assurance/issues/27#issuecomment-6666626278
[c28]: https://github.com/ahed-jneed/ai-assurance/issues/28#issuecomment-6666626807
[c33]: https://github.com/ahed-jneed/ai-assurance/issues/33#issuecomment-6666627792
[c47]: https://github.com/ahed-jneed/ai-assurance/pull/47#issuecomment-6663908598
[c47fix]: https://github.com/ahed-jneed/ai-assurance/pull/47#issuecomment-6667423208
[PR #43]: https://github.com/ahed-jneed/ai-assurance/pull/43
[PR #47]: https://github.com/ahed-jneed/ai-assurance/pull/47
[#3]: https://github.com/ahed-jneed/ai-assurance/issues/3
[#18]: https://github.com/ahed-jneed/ai-assurance/issues/18
[#26]: https://github.com/ahed-jneed/ai-assurance/issues/26
[#27]: https://github.com/ahed-jneed/ai-assurance/issues/27
[#31]: https://github.com/ahed-jneed/ai-assurance/issues/31
[#33]: https://github.com/ahed-jneed/ai-assurance/issues/33
[#38]: https://github.com/ahed-jneed/ai-assurance/issues/38
[#57]: https://github.com/ahed-jneed/ai-assurance/issues/57
[#58]: https://github.com/ahed-jneed/ai-assurance/issues/58
[#60]: https://github.com/ahed-jneed/ai-assurance/issues/60
