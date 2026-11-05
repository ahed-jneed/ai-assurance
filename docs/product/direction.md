# Product direction

Set on 5 November 2026 for the current roadmap cycle. It distils the [product-direction brief](../research/2026-11/synthesis.md) and its five research briefs; [ROADMAP.md](../../ROADMAP.md) is the plan that implements it. Claims marked *(secondary)*, and findings attributed to "the research", rest on secondary sources. The other external claims were checked against primary sources on 5 November 2026 (see [Sources and verification](#sources-and-verification)).

## 1. Who we serve

**The independent assessor.** The buyer leads AI assurance, or is the engagement partner, at an independent assurance provider of roughly 5 to 200 practitioners: a specialist AI-audit firm, the technology-assurance team of a mid-tier audit or testing, inspection and certification (TIC) firm, or an AI testing lab. They sign conclusions about AI systems and must defend them to peer reviewers, accreditation bodies, regulators and insurers.

- **Daily users** are the engagement team: lead auditor, technical specialist (the practitioner's expert), reviewer and engagement quality reviewer (EQR).
- **AI owners are clients, not buyers.** They contribute evidence and read released reports through the client portal; their governance tools reach us through imports.
- **Not first:** AI owners' governance teams, the Big Four (building their own services) and internal audit (served by Optro and TeamMate+) *(secondary)*.

**Why this user.**

- **Nobody builds their workflow.** The AI-governance platforms that lead the analyst rankings sell to the AI owner: IBM, ServiceNow and Truyo in Gartner's 2026 Magic Quadrant, Credo AI and IBM in Forrester's Q3 2025 Wave *(secondary)*. The research found none that offers independence checks, sampling, review and an opinion, and no AI testing method in audit tools such as Fieldguide, Caseware and TeamMate+.
- **The profession is forming.** European accreditation bodies voted in November 2025 to make ISO/IEC 42006 mandatory for accrediting ISO/IEC 42001 certifiers *(secondary)*. AIUC-1 has had an authorised auditor since 3 February 2026, and the AICPA and AIUC announced a joint SOC 2 + AIUC-1 offering on 19 October 2026. NYC Local Law 144 requires a yearly bias audit by an independent auditor.
- **Rigour is becoming a buying criterion.** From 1 June 2026 AICPA peer review targets SOC 2 work and checks for identical risk assessments, sample sizes and test procedures across engagements. The research found the same pressure on the first EU DSA audits and on LL144 audits.
- **Our base already fits:** engagement-scoped roles with separation of duties, diagnostic results kept apart from auditor conclusions, immutable snapshots, hash-chained events, content-addressed evidence, signed dossiers and an external worker ([codebase map](../engineering/codebase-map.md)).

**What we sell first:** AI Act readiness built on an EN 18286 + ISO/IEC 42001 management-system assessment ([#28]), and LL144 bias audits ([#30]). Art 50 and GPAI reviews, AIUC-1 and SOC 2 + AI programmes, and a certification-body mode are on the Later list. Colorado SB 26-189 and CCPA ADMT audits, whose duties start on 1 January 2027 *(secondary)*, are not yet scheduled.

**Packaging:** per engagement or per practitioner seat, unlimited client users, SSO and MFA in every tier, no per-framework fees. Owner-side platforms are priced for enterprises; IBM's watsonx.governance Risk & Compliance edition starts at $3,500 a month.

## 2. What sets us apart

| Differentiator | What it means | This cycle | Later |
|---|---|---|---|
| Engagement quality built in | Acceptance, independence and competence gates, an EQR, reports that conform to ISAE 3000 | [#20], [#23], [#24] | Review notes as records; anti-templating guardrails |
| Statistically defensible testing | Intervals, exact tests and multiplicity control decide outcomes against thresholds fixed in advance | [#9], [#21], [#22], [#30] | Multiclass and regression fairness (not yet placed) |
| Evidence others can re-check | Content-addressed evidence, hash-chained events, signed dossiers whose keys are never stored in plaintext | [#25] | Run attestations, re-performance packs, RFC 3161 timestamps, public report verification |
| Tool-neutral evidence ingestion | Per-item records from any harness, graded L0 to L3 and recomputed, never executed | [#31], [#32], [#33] | Governance-platform importers; post-market evidence |
| Versioned criteria across schemes | Every conclusion cites the law and standards versions it used; typed crosswalks never overstate coverage | [#8], [#18], [#19], [#26] to [#29] | GPAI/Art 50 and AIUC-1 packs |

Two rules sit under all five:

- **Correctness before breadth.** Current law ([#8], [#18]), reporting that conforms to assurance standards ([#20]), independence ([#23]) and statistics where the interval decides ([#9], [#21], [#22]) are P0.
- **Identity is verified, never asserted.** [#11] replaces today's trust in upstream identity headers with a deny-by-default adapter, and [#12] closes the access-lifecycle gaps. Per-practice SSO and MFA, which the research says audit firms expect before a pilot, are not yet scheduled.

## 3. What we will not build

- **The AI owner's runtime stack:** AI discovery, runtime guardrails, LLM firewalls, MCP gateways, observability and monitoring, policy management, vendor risk. Large suites are absorbing these markets; on 3 November 2026 CrowdStrike agreed to acquire Fiddler and pitches agent observability as evidence for compliance and audits. We ingest such outputs instead.
- **Our own test infrastructure:** no native red-team runner, benchmark hosting or default LLM-judge service. Auditor re-runs go through the existing external worker.
- **Unsafe ingestion:** we never execute ingested code or pickled models, never rescore logs that reference code, and never embed AGPL-licensed tools such as deepchecks.
- **Overclaiming:** no "compliant" badges, nothing that resembles a certificate or regulator approval, no partial crosswalk shown as full coverage, and no vendor-steered auditor marketplace.

## 4. Evaluation principles

1. **Defensibility beats metric count.** Every reported number carries n, an interval, the pre-registered criterion and the plan version.
2. **The interval decides.** Pass only when the interval lies wholly inside the pre-registered materiality band, fail when it lies wholly beyond the threshold, and otherwise report inconclusive; point estimates never decide ([#9], [#21], [#22]). Recomputed for this document:

   | Case | The point estimate says | The interval says |
   |---|---|---|
   | 6 of 20 selected vs 10 of 20 | Impact ratio 0.60 "fails" the four-fifths screen | 95% CI 0.27 to 1.34, Fisher's exact p = 0.33: inconclusive |
   | 22,500 of 50,000 vs 25,000 of 50,000 | Impact ratio 0.90 "passes" | 95% CI 0.888 to 0.912 (z = −15.8): a precisely measured 10% gap, for the band to judge |
   | Planning | — | 80% power to tell 40% from 50% selection needs about 388 per group; 8% from 10% needs about 3,213 |

3. **Thresholds are fixed before the data arrives,** as AI Act Art 9(8) requires for high-risk systems ("prior defined metrics and probabilistic thresholds"): metric, reference group, threshold, materiality band, multiple-comparison policy and a minimum-detectable-effect check, frozen into the run manifest.
4. **The auditor chooses the fairness criterion.** When base rates differ, common fairness criteria cannot all hold at once (Kleinberg et al.; Chouldechova), so the plan records which one fits and why.
5. **The four-fifths rule is a configurable screen, never a verdict.** LL144 figures follow the city's rule; internal AI Act thresholds are labelled "no legal safe harbour".
6. **Ingest, recompute, attest.** We take per-item records from whichever harness ran the test (Inspect, lm-evaluation-harness, promptfoo, garak, PyRIT, DeepEval, Ragas), hash them on arrival, recompute the statistics and attest the result ([#31] to [#33]). Evidence is graded L0 (a client or vendor aggregate), L1 (a hashed tool log), L2 (recomputed by us from per-item records) or L3 (re-run by the auditor, with an attestation). Logs are data: Inspect's documentation warns that rescoring (`inspect score`) and retrying (`inspect eval-retry`) a log run code and use settings that the log names, and that `edit_score()`, `recompute_metrics()` and `recover_eval_log()` import a log's task file only when called with `trust_log=True`. We never rescore or retry an ingested log and never pass `trust_log=True`; we recompute from its per-item records. Neutrality sells because the main harnesses belong to vendors: promptfoo agreed in March 2026 to be acquired by OpenAI, PyRIT is Microsoft's and garak is NVIDIA's.
7. **Method before runner.** The GenAI audit programme and its metadata gates come first. A GenAI conclusion needs n, standard errors and a validated judge from a different model family than the system under test, because LLM judges show position, verbosity and self-enhancement biases.
8. **Claims are scoped.** Benchmark accuracy is not accuracy on the wider population of questions (NIST AI 800-3), and a low attack-success rate holds only for that attack set and judge.

## 5. UX principles

1. **Two clicks from conclusion to evidence,** with the hash, parameters, period and who did what.
2. **Tools propose, people conclude.** A diagnostic pass never fills in the auditor's conclusion.
3. **Honest status.** "Not run", "inconclusive", "exception" and "pass" stay distinct; n, intervals, exclusions and population completeness come before any pass rate.
4. **Independence is visible.** Client evidence is labelled; clients cannot edit auditor work or see drafts; submitted evidence cannot change.
5. **The legal basis is always on screen,** with "readiness" marked on anything assessed before its obligation applies.
6. **Tailor, don't clone.** The risk assessment decides scope, and engagements that look too alike are flagged.
7. **Calm queues.** One inbox per role, digests instead of pings, and requests that state what is needed, why, an example, the format and the due date.
8. **AI assistance is opt-in, cited, shown as a diff and logged.** It names its model provider and never writes the opinion or signs off.
9. **Statistics in plain language:** "With 20 people per group, this test cannot tell a 10-point gap from noise."
10. **Export-ready:** DOCX, PDF and XLSX, saved filters, and an export for peer review.

## 6. Open questions

- **Law and standards.** Legal content stays unverified against primary sources until [#8] lands, and [#18] labels what needs qualified legal review. EUR-Lex refused automated fetching, so the Official Journal references (Regulation (EU) 2026/1744, Implementing Decision (EU) 2026/2274) rest on secondary sources, which disagree on the EN 18286 citation date (14 or 19 October 2026). No AI Act notified body could be verified in NANDO.
- **Unconfirmed claims the design must not lean on:** the EEOC's rescission of its Uniform Guidelines' interpretive parts (the Justice Department's 9 June 2026 opinion against those guidelines is confirmed), and whether AIUC-1's "quarterly" means retests or revisions of the standard (plan for both). AIUC-1 content licensing is unconfirmed.
- **Scope:** per-practice SSO and MFA, Colorado and CCPA ADMT audits, the Art 4a record and the rest of [Not yet placed](../../ROADMAP.md#not-yet-placed) need a decision.

## Sources and verification

"Verified" means the primary source was fetched on 5 November 2026 and supports the statement.

| Claim | Source | Status |
|---|---|---|
| AI Act milestones on 2 Aug 2026, 2 Dec 2026 (new Art 5 prohibitions, end of the Art 50(2) transition), 2 Dec 2027 (Annex III) and 2 Aug 2028 (Annex I); Art 9(8) wording | [AI Act Service Desk timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act), [Article 9](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-9) | Verified |
| EN 18286:2026 is the first harmonised standard cited in the OJ for the AI Act | [CEN-CENELEC](https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/) | Verified |
| Its decision number (EU) 2026/2274, the 14 Oct 2026 date, and a presumption limited to the requirements covered | [Orrick](https://www.orrick.com/en/Insights/2026/10/First-Harmonised-Technical-Standard-Published-Under-the-EU-AI-Act) | Secondary |
| ISO/IEC 42006 vote of 20 Nov 2025; analyst placements | [Bright Defense](https://brightdefense.com/news/iso-42006-raises-the-bar-for-iso-42001-certifiers), [OneTrust](https://onetrust.com/resources/gartner-magic-quadrant-for-ai-governance-platforms-2026-report/), [Forrester](https://www.forrester.com/report/the-forrester-wave-tm-ai-governance-solutions-q3-2025/RES184849) | Secondary |
| First authorised AIUC-1 auditor (Schellman); the AICPA–AIUC offering | [Schellman](https://www.schellman.com/blog/news/schellman-becomes-the-first-accredited-auditor-for-aiuc-1), [AICPA release](https://www.prnewswire.com/news-releases/auditors-meet-urgent-demand-for-ai-assurance-with-new-offering-from-aicpa-and-aiuc-302912598.html) | Verified |
| AICPA peer review of SOC 2 work from 1 Jun 2026 | [Journal of Accountancy](https://www.journalofaccountancy.com/issues/2026/may/aicpa-guides-peer-reviewers-to-address-soc-2-risks/) | Verified |
| LL144 bias audit by an independent auditor, relied on for one year | [NYC DCWP](https://www.nyc.gov/site/dca/businesses/faq-automated-employment-decision-tools.page) | Verified |
| IBM price; CrowdStrike–Fiddler agreement | [IBM](https://www.ibm.com/products/watsonx-governance/pricing), [CrowdStrike](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-to-acquire-fiddler-to-deliver-agent-observability/) | Verified |
| Harness ownership; deepchecks licence; which Inspect operations run code that a log names (rescoring, retries, `trust_log=True`) | [Promptfoo](https://www.promptfoo.dev/blog/promptfoo-joining-openai/), [PyRIT](https://microsoft.github.io/PyRIT/), [garak](https://github.com/NVIDIA/garak), [deepchecks](https://github.com/deepchecks/deepchecks), [Inspect, "Logs from Others"](https://inspect.aisi.org.uk/eval-logs.html#logs-from-others) | Verified (PyRIT and garak by publisher) |
| Fairness criteria conflict; LLM-judge biases | [Kleinberg et al.](https://arxiv.org/abs/1609.05807), [Chouldechova](https://arxiv.org/abs/1610.07524), [Zheng et al.](https://arxiv.org/abs/2306.05685) | Verified (abstracts) |
| Benchmark vs generalized accuracy; crosswalk relationship types | [NIST AI 800-3](https://www.nist.gov/node/1906641), [NIST IR 8477](https://doi.org/10.6028/NIST.IR.8477) | Verified |
| Worked statistics in section 4 | Recomputed: Katz-log intervals, two-proportion z, normal-approximation sample size (two-sided α = 0.05, 80% power), SciPy Fisher exact | Verified |
| SR 26-2 (17 Apr 2026) supersedes SR 11-7; footnote 3 of its attached guidance puts generative and agentic AI models out of scope | [Federal Reserve](https://www.federalreserve.gov/supervisionreg/srletters/sr2602.htm), [attachment, footnote 3](https://www.federalreserve.gov/supervisionreg/srletters/SR2602a1.pdf) | Verified |
| DOJ opinion; EEOC rescission | [DOJ](https://www.justice.gov/opa/pr/justice-department-concludes-eeoc-disparate-impact-guidelines-violate-constitution), [DirectEmployers](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/) | Verified; rescission secondary |
| Competitors and market structure, DSA and LL144 critiques, Colorado and CCPA dates, audit-firm security expectations, UX patterns | [Research briefs](../research/2026-11/README.md) | Secondary |

[#8]: https://github.com/ahed-jneed/ai-assurance/issues/8
[#9]: https://github.com/ahed-jneed/ai-assurance/issues/9
[#11]: https://github.com/ahed-jneed/ai-assurance/issues/11
[#12]: https://github.com/ahed-jneed/ai-assurance/issues/12
[#18]: https://github.com/ahed-jneed/ai-assurance/issues/18
[#19]: https://github.com/ahed-jneed/ai-assurance/issues/19
[#20]: https://github.com/ahed-jneed/ai-assurance/issues/20
[#21]: https://github.com/ahed-jneed/ai-assurance/issues/21
[#22]: https://github.com/ahed-jneed/ai-assurance/issues/22
[#23]: https://github.com/ahed-jneed/ai-assurance/issues/23
[#24]: https://github.com/ahed-jneed/ai-assurance/issues/24
[#25]: https://github.com/ahed-jneed/ai-assurance/issues/25
[#26]: https://github.com/ahed-jneed/ai-assurance/issues/26
[#28]: https://github.com/ahed-jneed/ai-assurance/issues/28
[#29]: https://github.com/ahed-jneed/ai-assurance/issues/29
[#30]: https://github.com/ahed-jneed/ai-assurance/issues/30
[#31]: https://github.com/ahed-jneed/ai-assurance/issues/31
[#32]: https://github.com/ahed-jneed/ai-assurance/issues/32
[#33]: https://github.com/ahed-jneed/ai-assurance/issues/33
