> **Research record: Product-direction brief (synthesis).** Kept as written on 5 November 2026. Only this note was added and line endings were normalised to LF; everything below the rule is the original. The current plan is [ROADMAP.md](../../../ROADMAP.md) and the distilled direction is [docs/product/direction.md](../../product/direction.md); where they differ from this record, they win. See the [folder index](README.md) for how the research was done.
>
> - **Date:** status as of 5 November 2026; not updated since.
> - **Method:** written in the AI-assisted (Claude Code) planning session that produced the roadmap issues. It combines the five research briefs in this folder with a direct read of the repository at commit `74c6463`. The Commission's AI Act Service Desk timeline was fetched directly, and the worked statistics in §5.3 were recomputed.
> - **Verification limits:** as the "Verification limits" note at the end of §2 says, the session's web-search budget ran out and EUR-Lex returned empty pages to automated fetching, so everything dated after mid-2026, apart from the Commission timeline, rests on the research briefs, many of them on secondary sources. §2.5 lists the conflicts and single-source claims. Nothing here is legal advice: legal content is verified against primary sources in [#8](https://github.com/ahed-jneed/ai-assurance/issues/8) and labelled for qualified legal review in [#18](https://github.com/ahed-jneed/ai-assurance/issues/18) before the platform states it.
> - **Links (checked 5 November 2026):** 154 distinct links: 146 returned a page, 8 refused automated requests, none returned 404. A page that loads was not re-read for the claim it supports.
> - **Re-checked when this record was filed:** two §2.5 items now have primary sources. The Federal Reserve's SR 26-2 letter (17 April 2026) confirms that it supersedes SR 11-7, and footnote 3 of the guidance attached to it puts generative and agentic AI models out of scope. The Justice Department's page confirms its 9 June 2026 opinion on the EEOC guidelines. The [direction's sources table](../../product/direction.md#sources-and-verification) lists every fact re-checked.
> - **Local paths:** `C:\Users\Ahedj\Documents\dev\AI Assurance\` is the repository root at commit `74c6463`, so read those paths as repository-relative (for example `site-app/lib/diagnostics.ts`). Line numbers predate the Prettier reformat in [#1](https://github.com/ahed-jneed/ai-assurance/issues/1).
> - **Superseded planning detail:** the milestone names and dates in §4 predate the GitHub milestones. M3 is now "Release readiness", and many §4 epics moved to the Later list in [ROADMAP.md](../../../ROADMAP.md).

---

# Product direction brief: AI Assurance & Audit Platform

*Status as of 5 November 2026. This brief combines five research briefs (competitors; regulation and standards; audit practice; evaluation tooling; GRC UX) with a read of the repository.*

## Decisions at a glance

1. **We serve the independent assessor, not the AI owner.** The primary buyer is the head of AI assurance at an independent assurance provider. AI owners join as clients, through the client portal and through integrations.
2. **Correctness comes before breadth.** The P0 work is:
   - bringing legal content up to date (the 2 Dec 2026 milestones and EN 18286);
   - reporting that conforms to assurance standards;
   - an independence and engagement-quality-review layer;
   - statistics where confidence intervals, not point estimates, decide outcomes.
3. **Audit criteria become data.** The fixed 33-paper AI Act catalogue becomes one pack in a multi-scheme model, with typed crosswalks between schemes. Next packs, in order:
   - EN 18286 + ISO/IEC 42001;
   - bias and automated-decision (ADMT) audits;
   - GPAI and Article 50;
   - a NIST AI RMF crosswalk;
   - then AIUC-1.
4. **GenAI evidence comes in by ingestion, recomputation and attestation.** When the auditor needs to re-run a test, it goes through the existing external worker. We build no native red-team runner and no monitoring product.
5. **Evidence must be checkable without trusting our database.** That means signed run attestations, RFC 3161 timestamps and a public page for verifying reports.
6. **Identity gets hardened early.** Today the app trusts identity headers set by an upstream proxy. Verify those now, and add OIDC/SAML and MFA before any paid pilot.
7. **We do not build** AI discovery, runtime guardrails, LLM firewalls, MCP gateways, observability, policy management or vendor-risk modules.

**Repository evidence key** (cited below as F1–F15)
- F1: `C:\Users\Ahedj\Documents\dev\AI Assurance\templates\catalog.json`. Identical copies exist at `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\lib\catalog.json` and `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\reference\templates\catalog.json`.
- F2: `C:\Users\Ahedj\Documents\dev\AI Assurance\docs\audit-methodology.md`
- F3: `C:\Users\Ahedj\Documents\dev\AI Assurance\docs\obligation-subitems.json`. Identical copies exist at `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\lib\obligation-subitems.json` and `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\reference\docs\obligation-subitems.json`.
- F4: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\workspace.tsx` (about 85 KB; many features touch it)
- F5: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\lib\domain.ts`
- F6: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\audit-gates.tsx`
- F7: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\audit-program.tsx`
- F8: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\lib\diagnostics.ts`
- F9: `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\diagnostics.py` and `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\assurance.py`
- F10: `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\model_diagnostics.py` and `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\optional_adapters.py`
- F11: `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\registry_import.py`
- F12: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\lib\dossier.ts`
- F13: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\chatgpt-auth.ts`
- F14: `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\api\workspace\route.ts` (about 42 KB; many features touch it)
- F15: `C:\Users\Ahedj\Documents\dev\AI Assurance\engine\cited_assistant.py`
- The repository has no `C:\Users\Ahedj\Documents\dev\AI Assurance\.github` directory, so there is no CI.

---

## 1. Market positioning

### 1.1 Primary buyer and users
- **Buyer.** The head of AI assurance, or the engagement partner, at an independent assurance provider of roughly 5–200 practitioners. This covers:
  - specialist AI-audit firms;
  - technology-assurance teams in mid-tier audit firms and in testing, inspection and certification (TIC) firms;
  - AI testing labs.

  This person signs conclusions about AI systems. They have to defend those conclusions to peer reviewers, accreditation bodies, regulators and insurers, and increasingly in court.
- **Daily users.** The engagement team:
  - the lead auditor;
  - a technical specialist, usually a data scientist acting as the "practitioner's expert";
  - the reviewer;
  - the engagement quality reviewer (EQR).
- **Participants who are not buyers.** Client staff, as contributors and viewers.
- **Qualifier.** Firms that already do at least one of the following and have data-science capability in-house or on call:
  - ISO/IEC 42001 readiness or certification;
  - NYC Local Law 144 (LL144) bias audits;
  - SOC 2 with AI in scope;
  - EU AI Act readiness.

### 1.2 Why this buyer
- **Nobody builds for them.**
  - The leading AI-governance platforms sell to the organisation that owns the AI. That includes the Leaders in Gartner's first AI Governance Platforms Magic Quadrant (Jun 2026: IBM, ServiceNow, Truyo) and the Leaders in Forrester's Wave (Q3 2025: Credo AI, IBM).
  - Those platforms export "audit-ready" evidence. None of the vendors profiled offers the auditor's own workflow: independence, sampling, review and an opinion.
  - General audit tools (Fieldguide, Caseware, TeamMate+, Optro) run SOC and ISO engagements but have no method for testing AI systems.
- **Demand is forming and becoming a profession.**
  - **Certification:** European Accreditation made ISO/IEC 42006 accreditation of ISO/IEC 42001 certifiers mandatory on 20 Nov 2025. BSI was first accredited by UKAS; Schellman was first by ANAB.
  - **Agent assurance:** AIUC-1 has authorised auditors (Schellman since Feb 2026). The AICPA and AIUC launched a combined SOC 2 + AIUC-1 offering on 19 Oct 2026; full launch is early 2027.
  - **Government programmes:** the UK has a DSIT assurance roadmap and an AI Assurance Consortium (Jun 2026). Singapore launched an AI Tester Accreditation Programme on 14 Oct 2026.
  - **Mandated audits:** NYC LL144 requires an annual independent bias audit.
- **Rigor is becoming a buying criterion.**
  - Since 1 Jun 2026, AICPA peer reviewers compare engagements for identical risk assessments, samples and procedures.
  - A compliance-automation startup (Delve) faces allegations of near-identical SOC 2 reports; it denies them and they are unproven.
  - Critiques of the first EU Digital Services Act (DSA) audits and of LL144 enforcement both punish templated work that does little real testing.
- **Our existing assets are already shaped for auditors:**
  - roles scoped to the engagement, and a rule that a reviewer cannot approve their own revision;
  - three separate states for each control: applicability, diagnostic result and auditor conclusion (F2);
  - immutable report snapshots and hash-chained audit events;
  - evidence stored by content address, and signed dossiers;
  - a testing lab and an external worker protocol.
- **There is a price gap.** Owner-side platforms cost roughly $50k to several hundred thousand dollars a year; IBM's Risk & Compliance edition lists from $3,500/month. Mid-tier firms need pricing per engagement or per seat.

### 1.3 Beachhead sequence
1. **Now to Q1 2027 (lead offer).** AI Act readiness engagements built on an EN 18286 + ISO/IEC 42001 management-system assessment, plus Article 50 transparency reviews and GPAI downstream reviews. These obligations apply today.
2. **From 1 Jan 2027.** Bias and ADMT audits: LL144 now, Colorado SB 26-189 and the CCPA ADMT rules from 1 Jan 2027.
3. **Early 2027.** AIUC-1 and SOC 2 + AI evidence programmes for CPA firms, ahead of the full AICPA–AIUC launch.
4. **Second half of 2027.**
   - An ISO/IEC 42001 certification-body mode: Stage 1/2 audits, surveillance, a certificate register and 42006 competence records.
   - Annex III high-risk conformity work ahead of 2 Dec 2027.
   - A notified-body (Annex VII) mode, but only once designations can be verified in NANDO, the EU register of notified bodies.

**Not targeted first:**
- governance teams at AI owners (they reach us as clients);
- the Big Four, which are building in-house (PwC "Assurance for AI", KPMG);
- internal audit, which Optro and TeamMate+ already serve.

**Competitive watch:**
- Owner-side platforms are courting auditors: Vanta has 100+ partner audit firms and an auditor view; Drata has Audit Hub and a Fieldguide integration.
- Optro (AuditBoard plus FairNow) or Fieldguide could add an AI methodology.

### 1.4 White space
1. **One engagement system across schemes,** from acceptance to signed opinion. The schemes are the AI Act, EN 18286, ISO/IEC 42001, AIUC-1, ISAE 3000 / SOC 2 add-ons and bias audits.
2. **Technical test evidence that a reviewer, peer reviewer or notified body can re-run,** with its statistical uncertainty stated.
3. **Chain of custody for evidence imported** from the client's own governance, evaluation and observability tools.
4. **GenAI and agent test plans built for audits:** fixed scope, sampling, reproducibility and mapping to criteria. They also need to be neutral, because the main test harnesses are now owned by vendors:
   - promptfoo by OpenAI;
   - PyRIT by Microsoft;
   - garak by NVIDIA;
   - Fiddler, which CrowdStrike agreed to buy on 3 Nov 2026.
5. **Outputs that buyers, insurers and regulators can verify on their own.**

### 1.5 Differentiators we can credibly own

| Differentiator | Why buyers care | Foundation already in the repo | What closes the gap |
|---|---|---|---|
| 1. Engagement quality built in | Peer reviewers and accreditation bodies inspect independence, EQR and tailoring | Roles scoped to the engagement; a reviewer cannot approve their own revision; three separate states; readiness gates; immutable snapshots | Acceptance and independence gate, EQR gate, anchored review notes, tailoring report, a report model that conforms to standards (Theme 2) |
| 2. Statistically defensible testing | A pass/fail on a point estimate can flip on realistic sample sizes; AI Act Art 9(8) requires thresholds fixed in advance | Wilson intervals per group; seeded bootstrap (independent and cluster) and intersectional slices (F9); approvals bound to the revision and its content digest (F1) | Intervals decide pass, fail or inconclusive; power checks; control for multiple comparisons; the two runners agree (Theme 3) |
| 3. Re-performable, verifiable evidence | Notified bodies and reviewers accept results they can re-run; third parties need checks that don't rely on our database | SHA-256 content-addressed evidence; hash-chained events; Ed25519-signed dossiers and a verifier CLI (F12); signed worker results with container image digests | Re-performance packs, in-toto attestations, RFC 3161 timestamps, public verification (Themes 3 and 7) |
| 4. Tool-neutral ingestion with evidence grading | Clients already run governance platforms and open-source evaluation harnesses; auditors must judge how reliable that evidence is | Worker protocol, provenance module, MLflow and Hugging Face registry snapshots (F11) | Adapters with L0–L3 evidence grading that never execute ingested code (Themes 6 and 9) |
| 5. Versioned, multi-scheme criteria with honest crosswalks | Key dates moved by 16–24 months; every conclusion must cite its exact legal basis; a partial overlap must not look like full coverage | A regulatory snapshot that already reflects the Omnibus; papers carry `sourceVersion`; classifications carry `version` and `asOf` (F1, F5) | Criteria model, crosswalks typed per NIST IR 8477, standards register, version stamps on every output (Themes 1 and 4) |

### 1.6 Packaging and partners
- **Pricing.** Per engagement or per practitioner seat. Unlimited client users. SSO and MFA in every tier. No per-framework fees.
- **Partners.** Build import adapters for, and co-market with, Credo AI, OneTrust, Saidot, ServiceNow, IBM, Vanta and Drata. Position ourselves as the independent layer that consumes what they produce.
- **Professional ecosystems.** Engage the UK AI Assurance Consortium, Singapore's AI Verify Foundation and tester accreditation, ISACA AAIA holders, and ISO/IEC 42006-accredited bodies.

---

## 2. Regulatory reality check (as of 5 November 2026)

### 2.1 Dates that matter

| Date | What applies | Why it matters to our users | Platform today |
|---|---|---|---|
| 2 Feb 2025 | AI Act Art 5 prohibitions. Art 4 AI literacy, which the Omnibus softened to a duty to take supporting measures | Every classification needs a prohibited-practice screen | Not a dated input in the data |
| 2 Aug 2025 | GPAI provider obligations (Arts 53–55); governance; penalties | Downstream providers need their upstream model's GPAI documentation | No GPAI coverage |
| 2 Aug 2026 | General application: Art 50 transparency, EU database, market surveillance, Commission enforcement against GPAI providers. The AI Office gains exclusive competence over systems built on the provider's own GPAI model and systems inside very large online platforms or search engines | Art 50 and GPAI reviews can be sold now | Art 50 date present; no AI Office flag |
| 11 Sep 2026 | Cyber Resilience Act reporting obligations | Evidence that incident timers exist and work | None |
| **2 Dec 2026** | New Art 5 bans on systems that generate non-consensual sexual deepfakes or child sexual abuse material. End of the Art 50(2) marking transition for generative systems already on the market before 2 Aug 2026 | **27 days away.** Classification and transparency work must test both | **Missing** |
| 9 Dec 2026 | New Product Liability Directive applies to products, including software and AI, placed on the market from this date | Audit files become more likely to be disclosed in litigation | — |
| 15 Dec 2026 | ISSA 5000 takes effect for periods beginning on or after this date. Comments close on the IAASB exposure drafts of ISA 500/330/520 | ISSA 5000 is a template for assurance usable by any profession; the definition of audit evidence is being revised | — |
| 1 Jan 2027 | Colorado SB 26-189 duties; CCPA ADMT compliance; NY RAISE Act (secondary source only) | Audits of notices, adverse-decision explanations and human review | None |
| Early 2027 | Full launch of the AICPA–AIUC offering. The EEOC's rescission of the interpretive parts of its Uniform Guidelines (UGESP) is projected to take effect (single source) | CPA firms need AI evidence programmes; the four-fifths rule becomes a heuristic only | None |
| 28 Feb 2027 | Standardisation request M/613 expires | Most harmonised AI Act standards will arrive in 2027 | — |
| 2 Aug 2027 | GPAI models placed on the market before 2 Aug 2025 must comply; national regulatory sandboxes are due; the Commission may disapply AI Act requirements in Annex I sectors whose own law gives equivalent protection | — | Missing |
| **2 Dec 2027** | Annex III high-risk obligations, including the Art 27 fundamental-rights impact assessment (FRIA). Also: Cyber Resilience Act main obligations (11 Dec 2027); CCPA risk assessments due (31 Dec 2027) | The main wave of high-risk conformity work | Present |
| 2 Aug 2028 | Annex I high-risk AI embedded in regulated products | Assessed through sectoral notified bodies (for example MDR/IVDR) | Present |
| 2 Aug 2030 | Legacy high-risk systems used by public authorities | Public-sector engagements | Missing |

### 2.2 What this means for engagements now
- **AI Act high-risk work is readiness work until 2 Dec 2027.** The platform already labels it this way; keep that.
- **Obligations that can be sold and tested today:**
  - Art 5, including the 2 Dec 2026 additions;
  - Art 50 transparency and content marking;
  - GPAI downstream documentation;
  - AI literacy (softened);
  - ISO/IEC 42001 certification and EN 18286 QMS readiness;
  - LL144 bias audits;
  - Colorado and CCPA ADMT duties from 1 Jan 2027;
  - AIUC-1 and SOC 2 + AI from early 2027.
- **Standards.** EN 18286:2026 is the only harmonised AI Act standard cited in the Official Journal (Implementing Decision (EU) 2026/2274).
  - Its presumption of conformity covers only the clauses it addresses: Art 17(1) and the first sentence of Art 11(1).
  - An ISO/IEC 42001 certificate on its own gives no presumption of conformity.
  - The other CEN-CENELEC JTC 21 deliverables (prEN 18228, 18229-1 to -5, 18282, 18283, 18284, 18285) are still drafts. Several failed or are in public enquiry.
  - Until they are cited, auditors test against the Articles and treat the drafts as "state of the art, not harmonised".
- **Notified bodies.** No AI Act designation could be verified in NANDO. Third-party assessment is needed mainly for:
  - Annex III point 1 biometrics, where harmonised standards are not fully applied;
  - Annex I products, through their sectoral notified bodies.
- **Classification guidelines.** The Art 6 guidelines are still a draft, with a final version targeted for end-2026. Classification rationales should cite the draft and carry a trigger to re-review them when the final version appears.
- **Bias data.** Art 4a replaces Art 10(5). Processing special-category data to detect bias needs documented strict necessity, a reason why synthetic or anonymised data will not do, access limits and deletion afterwards.
- **US.** Obligations have shifted from risk-management programmes to notice, explanation and human review.
  - Federal policy is hostile to disparate-impact theory: a DOJ Office of Legal Counsel opinion (Jun 2026) and a pending EEOC rescission of UGESP.
  - Title VII liability, LL144 and state laws still stand.
  - So the four-fifths rule should be a configurable screen, never a verdict.
- **Banking.** SR 26-2 (17 Apr 2026; single source) reportedly supersedes SR 11-7 and excludes generative and agentic AI. PRA SS1/23 still applies in the UK. Both are P2 for us.

### 2.3 Control frameworks, in order of support
1. **EU AI Act as amended by Regulation (EU) 2026/1744,** with dates, operator roles and transitional rules recorded per provision and versioned.
2. **EN 18286:2026 together with ISO/IEC 42001:2023,** plus ISO/IEC 42005 (impact assessment) and ISO/IEC 23894 (risk management).
   - Run them as one management-system programme with two sets of criteria.
   - EN 18286 is the only route to a presumption of conformity; ISO/IEC 42001 is the main certification market.
   - These standards are paywalled, so cite clauses by number only.
3. **NIST AI RMF 1.0 and AI 600-1,** as a crosswalk only, not a separate audit programme. It is the common language for US clients and is cited in the Texas TRAIGA defence.
4. **NYC LL144, then Colorado SB 26-189, CCPA ADMT and Illinois HB 3773.** These are enforceable now or from 1 Jan 2027.
5. **AIUC-1 and SOC 2 + AI,** mapped through the CSA AI Controls Matrix. Confirm AIUC-1 content licensing first.

**Later:**
- the JTC 21 standards as they are cited;
- a model-risk pack for SR 26-2 and SS1/23;
- an MDR/IVDR plus AI Act overlay, and FDA predetermined change control plans (PCCP);
- the Korea AI Basic Act;
- China's labelling standard GB 45438-2025;
- exchange in NIST's OSCAL format.

### 2.4 Platform facts that are stale, incomplete or need verification

| # | Platform fact [where] | Assessment | Action |
|---|---|---|---|
| 1 | The amending act is cited as "Regulation (EU) 2026/1744", with consolidated text CELEX 02024R1689-20260727 [F1, F2, F4] | **Not stale.** All four briefs that discuss it corroborate it, citing the EUR-Lex reference and several law-firm analyses. The Commission's AI Act Service Desk timeline (fetched 5 Nov 2026) reflects the Omnibus dates but does not print the regulation number. EUR-Lex returned an empty page to automated fetching | Keep. Have a person confirm the OJ reference (OJ L, 24 Jul 2026) at the next content release. Record "verified by, on" for each source |
| 2 | Annex III 2027-12-02, Annex I 2028-08-02, Art 50 2026-08-02 [F1, F3] | Checked against the Commission timeline | Keep |
| 3 | No 2 Dec 2026 milestones (new Art 5 bans; end of the Art 50(2) transition). No mention of deepfakes, synthetic content or Art 50(2) anywhere in the repo | **Stale and time-critical** (27 days) | R1.1 and R1.3, before 2 Dec 2026 |
| 4 | The date data holds only three dates. 2 Feb 2025, 2 Aug 2025, 2 Aug 2027 and 2 Aug 2030 appear only as prose, or not at all | Incomplete | R1.1 |
| 5 | Research date is 5 Oct 2026 (7 Oct for the obligation data); EN 18286 does not appear anywhere | **Stale** since the OJ citation of 14 Oct 2026 | R1.2; bump the methodology version from 2026.10.1 to 2026.11.x |
| 6 | Classification is four booleans plus Annex route and operator role [F5] | Incomplete for the amended Act: no GPAI roles, AI Office competence, SME/small mid-cap status or enumerated Art 5 practices | R1.3 |
| 7 | No coverage of GPAI (Arts 53–55) in the methodology or code | Gap: these obligations have applied since 2 Aug 2025, with Commission enforcement since 2 Aug 2026 | R4.5 |
| 8 | Art 10(5) deleted; Art 4a governs bias-data processing [F1, F2] | Consistent with the briefs | Keep; confirm the exact scope of Art 4a in the authentic text |
| 9 | Methodology scope is "traditional ML … classical NLP" [F2] | Out of step with Art 50 and GPAI obligations that already apply | Theme 6 |
| 10 | The report-opinion list has no unmodified (clean) conclusion and no assurance level [F6] | Does not conform to ISAE 3000 reporting | R2.1 |
| 11 | The hosted runner states that no confidence intervals are estimated. Its minimums are 20 rows and 5 per class; the Python engine uses 30 per group and 10 per class [F8, F9] | Two different evidence standards for the same test | R3.1 |
| 12 | Methodology data exists in three identical copies [F1, F3] | Identical today, but any content change risks drift | One canonical source (R1.1) plus a CI sync check (R5.0) |
| 13 | The task context describes 4 roles, a binary-only testing lab and no ML-platform integration | Understated. The code has 5 roles including Client Contributor [F5]. The hosted runner already computes multiclass performance (accuracy, macro-F1, balanced accuracy) and regression performance (MAE, RMSE, R²); only fairness is binary-only [F8]. MLflow and Hugging Face registry snapshots exist [F11] | Correct the internal docs and issue templates |

### 2.5 Conflicts and single-source claims in the research
- **EN 18286 citation date.** CEN-CENELEC, Orrick and the EUR-Lex reference give 14 Oct 2026; the Commission page reportedly says 19 Oct. Record the date from EUR-Lex. The evaluation brief's statement that no AI Act standard is cited reflects the May 2026 status and is out of date.
- **Notified bodies.** No brief could verify any AI Act notified-body designation in NANDO.
- **SR 26-2.** One brief cites the Federal Reserve page; another could not confirm it. Verify before building any model-risk content.
- **DOJ opinion and EEOC rescission.** Only one brief reports them. Our design, with the four-fifths rule as a configurable screen, does not depend on either.
- **AICPA TQA 9561.** Reported only in vendor commentary.
- **What "quarterly" means for AIUC-1.** Two briefs describe quarterly adversarial retests; one describes quarterly revisions of the standard. Plan for both: version the AIUC-1 content and schedule retests.
- **Draft standards and analyst rankings.** JTC 21 statuses come from secondary trackers. Analyst placements come from vendor announcements. The Modulos buyer's guide was written by a competitor.
- **NIST AI RMF.** No revision was known as of Jul 2026, and none has been checked since.

> **Verification limits.** Independent checking for this brief was limited. The session's web-search budget ran out, and EUR-Lex returned an empty page to automated fetching. The Commission's AI Act Service Desk timeline was fetched directly on 5 Nov 2026. It confirms the milestones on 2 Aug 2026, 2 Dec 2026, 2 Dec 2027 and 2 Aug 2028. The repository was read directly. Everything else dated after mid-2026 rests on the research briefs.

---

## 3. Capability gap analysis

| Capability | Competitors who have it | Importance for our user | Our current state | Recommendation |
|---|---|---|---|---|
| Structured acceptance, independence and conflict checks | Separate firm systems; Fieldguide (generic engagement management); no AI-governance vendor | Must | Paper WP-PL-01 and memo MEM-AC-01; a free-text "Competence and independence" field [F7]; no per-person declarations and no gate | R2.2, R2.3 |
| Engagement quality review (ISQM 2) and review notes | TeamMate+, Caseware (generic); none specific to AI | Must | A reviewer cannot approve their own revision; sign-off rules and readiness gates exist; no EQR role and no anchored review-note records | R2.4, R2.5 |
| Reporting that conforms to standards (ISAE 3000 assurance levels and conclusion types; ISO and LL144 outputs) | Fieldguide, Caseware (SOC/ISO, not AI); owner-side platforms only export "audit-ready" packs | Must | Four opinion values (readiness, qualified, adverse, unable to conclude); no clean conclusion and no assurance level [F6] | R2.1 |
| Criteria across several frameworks, with crosswalks | Credo AI, Holistic AI, IBM, OneTrust, Saidot, Trustible, Modulos, Hyperproof, Vanta | Must | AI Act only: 33 papers and 12 memos in a fixed catalogue [F1] | R4.1, R4.3 |
| EN 18286 / ISO/IEC 42001 audit programme | Vanta, Credo AI, Trustible (readiness tools for the AI owner); Fieldguide (generic ISO engagements) | Must | One QMS paper (WP-XC-01); EN 18286 absent | R1.2, R4.2 |
| Versioned regulatory content and timeline | Credo AI, OneTrust and Saidot maintain policy packs | Must | Snapshot reflects the Omnibus; papers and classifications carry versions; the 2 Dec 2026 dates and others are missing | R1.1, R1.4 |
| AI Act classification | OneTrust, Credo AI, Saidot; Vanta (high/low only) | Must | Booleans plus Annex route (including Art 6(3) and Annex I sections A/B) plus operator role; no GPAI, AI Office, SME/small mid-cap status or new Art 5 bans | R1.3 |
| Statistical inference on test results | QuantPi (confidence bounds; TÜV SÜD partner lab); Fairlearn (open source); ValidMind | Must | Engine has Wilson intervals per group, plus bootstrap and intersectional slices that do not feed the verdict; the hosted runner has no intervals; minimums differ between runners [F8, F9] | R3.1–R3.3 |
| Bias audit to the LL144 standard | Holistic AI (grew out of bias auditing); Asenion | Must | Impact ratio (lowest/highest selection rate) for binary decisions only; no scoring rates, 2% exclusion rule or unknown-category counts | R3.4, R4.4 |
| Multiclass, regression and ranking metrics | Holistic AI, IBM, ValidMind, Monitaur; Fiddler, Arize, Arthur | Should | Hosted runner covers multiclass and regression performance; fairness is binary-only; no ranking | R3.5 |
| Robustness and explainability for models we can load | IBM, Holistic AI, ValidMind, Monitaur, Asenion | Should | Adapters for ONNX, PMML, XGBoost and LightGBM; permutation importance; deterministic perturbation; SHAP is a stub [F10] | R3.5 |
| GenAI, LLM and agent evaluation evidence | Holistic AI, IBM, Asenion, Credo AI, Cisco, Palo Alto Networks, Collibra with Giskard, Fiddler, Arize, Arthur | Must (driven by Art 50, GPAI and AIUC-1) | None; the methodology scope excludes GenAI [F2] | R6.1–R6.5, R4.5 |
| Re-performance packs and signed run attestations | Not evident in any vendor. AIUC-1 separates testing from the audit. QuantPi says a notified body accepts its test evidence (vendor claim) | Must | Provenance module; signed worker results; Ed25519 dossiers signed with a server-held key [F12]; verifier CLI | R3.6, R7.1, R7.5 |
| Trusted timestamps and public report verification | AIUC-1 certificates; trust centers (Drata/SafeBase, Vanta) for security documents | Should | Only the offline verifier | R7.2, R7.3 |
| Client request lists and inbox | Vanta auditor view, Drata Audit Hub, Fieldguide, Suralink, Inflo, DataSnipper UpLink | Must | Requests with due date, responsible party, linked papers and statuses; Client Contributor grants; work-inbox API. No reminders, threads, evidence reuse or roll-forward | R8.1, R8.2 |
| Completeness and accuracy of client evidence | Vanta (auditors can see source data behind tests); Drata (point-in-time packages, frozen samples) | Must | Engine `quality_checks` (duplicates, leakage, required fields, timestamps); no completeness-and-accuracy assessment per evidence item | R8.3 |
| Connectors to governance, ML and observability tools | Credo AI, ModelOp (50+ integrations), Securiti (1,000+), Vanta (375+), ServiceNow, Holistic AI | Should | MLflow and Hugging Face registry snapshots; Parquet and SQLite snapshots | R9.1, R9.2 |
| Identity: SSO, MFA, SCIM, custom roles | Vanta and Drata (SCIM and custom roles in enterprise tiers), Optro, Fieldguide | Must for SSO and MFA; Should for SCIM | Trusts upstream `oai-authenticated-user-*` headers [F13]; five fixed roles; no SSO, MFA or SCIM | R5.1–R5.3 |
| Upload security, retention, file lock | Expected by audit-firm security reviews; Caseware and Fieldguide hold platform certifications | Must for malware scanning; Should for retention | 10 MB limit, SHA-256 hashing, quarantine status, pickle/joblib model files blocked; no malware scanning, retention policy or file lock | R7.4 |
| Post-market monitoring and incident evidence | ServiceNow, Fiddler, Arize, Arthur, Monitaur, IBM, Holistic AI | Should (ingest only) | Papers WP-XC-08 and WP-RM-02, memo MEM-IN-01; no data feeds or deadline timers | R9.2 |
| Recurring assurance (roll-forward, retests) | Vanta (duplicate an audit), Caseware (carry-forward), ServiceNow | Should | Remediation stage and finding retests exist; no roll-forward or schedules | R10.1, R10.2 |
| Running a practice or certification body | Fieldguide (firm board, service lines), TeamMate+ (scheduling) | Could (Should for certification bodies) | Multi-tenant practices; no portfolio board, time tracking, competence records or certificate register | R10.3, R10.4 |
| A governed AI assistant | Vanta, Drata, Secureframe, Optro, Fieldguide, Caseware, TeamMate+ | Should | A cited assistant exists [F15]; opt-in, naming the model provider and logging acceptances are not confirmed | R2.7 |
| Deployer pack (FRIA, ADMT notices) | OneTrust, Trustible, Credo AI | Should | Only FRIA-applicability (WP-XC-05) and deployer-use (WP-XC-04) papers | R4.4, R4.7 |
| Art 50 content-marking tests | Not evident in vendor profiles | Should | A manual transparency paper (WP-XC-07) | R4.5, R6.5 |
| Machine-readable exchange (OSCAL, CycloneDX) | Not evident | Could | Signed dossier packages and an HTML rendition of the report | R9.3 |
| AI discovery, guardrails, observability, MCP gateways | Credo AI, Holistic AI, ServiceNow, Cisco, Palo Alto Networks, CrowdStrike/Fiddler, Securiti | Won't | None | Do not build; ingest their outputs |

---

## 4. Recommended roadmap themes

**Planning conventions:**
- **Sizes.** S is about one PR (≤3 days). M is 2–4 PRs (1–2 weeks). L must be split into several issues before work starts.
- **Milestones:**
  - **M1, defensible core:** now to end of Dec 2026. R1.1 and the Art 5 / Art 50(2) parts of R1.3 must ship before 2 Dec 2026.
  - **M2, multi-scheme and GenAI evidence:** Q1 2027.
  - **M3, recurring assurance and practice operations:** Q2 2027 onward.
- **Parallel work.** These lanes overlap little in files:
  - A, content: F1, F3 and classification code;
  - B, workflow and reporting: F6, F7 and the workflow APIs;
  - C, statistics: the engine and F8;
  - D, platform: CI, F13 and auth code.

  F4 (85 KB) and F14 (42 KB) are hotspots. Either sequence the work that touches them or split those files first. R4.1 touches everything, so start it after Theme 1 merges.
- **External services** (timestamp authority, malware scanner, identity provider, email) sit behind provider interfaces with local test doubles, so building does not wait on credentials. Production credentials are a step the owner supplies.
- **Production hardening** is limited to what audit firms check before a pilot: verified identity, MFA, upload scanning, key custody and retention. Certifying the platform itself is a business roadmap item.

### Theme 1: Legal content currency and versioning (P0, M1, lane A)
*Why:* the law moved by 16–24 months and will move again. An audit file must cite the legal basis it used. Two new obligations start on 2 Dec 2026.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R1.1 | Date table per provision in the rule pack. Add 2 Feb 2025, 2 Aug 2025, 2 Dec 2026 (new Art 5 bans; end of the Art 50(2) transition), 2 Aug 2027 and 2 Aug 2030, each with its source and verified-at date. Add an "obligations by date" view per engagement that shows readiness versus applicable. Keep one canonical copy of the catalogue and generate or sync-check the copies. Done when every date is data rather than prose and tests cover each transition | S | P0, before 2 Dec 2026 | R5.0 |
| R1.2 | Standards register. Record EN 18286:2026 as cited (Implementing Decision (EU) 2026/2274), with the presumption limited to the clauses it covers. Label JTC 21 drafts "not harmonised, state of the art". Cite ISO/IEC standards by clause number only. Bump the methodology version. Done when WP-XC-01 and WP-XC-06 use the register and a presumption claim is accepted only for covered clauses | S | P0 | — |
| R1.3 | Classification v2: enumerated Art 5 practices, including the 2 Dec 2026 additions; GPAI roles (model provider, systemic-risk model, downstream provider) and an AI Office competence flag; an SME / small mid-cap flag; Art 6(3) derogation rationale with registration evidence; Art 50(1)–(4) triggers for providers and deployers; a citation of the draft Art 6 guidelines with a re-review task once they are final. Done when each answer is stored with its legal version and unknown answers keep the classification pending | M | P0 (Art 5 and Art 50(2) parts before 2 Dec 2026) | R1.1 |
| R1.4 | Version stamps on report snapshots, test runs and dossiers (consolidated text, standards and methodology versions), extending what papers and classifications already carry. Rule-pack changes open change tasks on affected papers and never alter issued snapshots. Show a staleness banner when the research date passes a set age | S–M | P0 | R1.1 |

### Theme 2: Engagement quality, independence and reporting (P0/P1, M1–M2, lane B)
*Why:* this is the clearest gap against tools built for AI owners, and it is what peer reviewers and accreditation bodies inspect. Today's report model cannot express a clean conclusion.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R2.1 | Report model v2: engagement type (attestation, direct, agreed-upon procedures, readiness, certification audit) and assurance level (limited or reasonable). Conclusions are unmodified, qualified, adverse or disclaimer. Guidance separates adverse (material and pervasive deficiencies) from disclaimer (pervasive inability to obtain evidence). The readiness gate checks the elements ISAE 3000 requires. Results roll up by criterion. Readiness assessment stays as an output that is not assurance. Done when `reportOpinions` [F6] is replaced and issued snapshots are untouched | M | P0 | — |
| R2.2 | Acceptance and continuance gate. Checks the ISAE 3000 preconditions (appropriate subject matter, suitable criteria, access to evidence, rational purpose) and records scope, period, system boundary, access level (white, grey or black box) and the engagement-letter reference. Done when fieldwork cannot start without Lead Auditor approval | M | P0 | R2.1 |
| R2.3 | Independence and competence. Per-person declarations covering IESBA Part 4B, the LL144 exclusions, and the self-review threat from earlier implementation or governance work. Adds a conflict check, a competence matrix and practitioner's-expert designation, replacing the free-text field [F7]. Done when every team member has a current declaration before fieldwork and a conflict blocks assignment | M | P0 | R2.2 |
| R2.4 | Engagement quality reviewer: role, ISQM 2 eligibility checks (not on the team, cooling-off period), stand-back checklist, and a completion gate before the report snapshot | S–M | P0 | R5.2, or add the role directly |
| R2.5 | Review notes as records of their own: threaded, anchored to a paper section, evidence item or test result, and marked open or cleared. All must be cleared before sign-off. Tick-mark cross-references link paper text to evidence | M | P1 | — |
| R2.6 | Guardrails against templated files:<br>- the risk assessment selects procedures, with a rationale;<br>- every sample size needs a written rationale;<br>- a tailoring report compares the engagement with the template and the prior period;<br>- alerts across the practice flag repeated risk text, samples and conclusions;<br>- review and sign-off history can be exported for peer review. | M | P1 | R4.1 |
| R2.7 | Assistant governance. Opt-in per practice. The model provider is named. Prompts, sources and model version are logged as audit events. Output stays a draft outside the evidence record until a person accepts it. The assistant never drafts the conclusion or signs | S | P1 | — |

### Theme 3: Audit-grade statistics and re-performance (P0/P1, M1–M2, lane C)
*Why:* a bare point estimate can reverse a conclusion, and Art 9(8) requires thresholds fixed in advance. Bias audits are the most clearly mandated independent AI audit today.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R3.1 | One statistics core. The Python engine is the reference; the hosted runner mirrors a documented subset. Includes:<br>- Wilson, Newcombe and Katz-log intervals;<br>- percentile or BCa bootstrap;<br>- Fisher or Boschloo exact tests for small cells;<br>- cluster bootstrap;<br>- Holm and Benjamini–Hochberg corrections;<br>- one set of minimums for both runners;<br>- golden-file tests in CI that check the runners agree.<br>Done when every headline metric reports n and an interval, and the hosted runner no longer says it estimates no intervals [F8] | L | P0 | R5.0 |
| R3.2 | Pre-registered plan and decision rule. Fix before data intake: primary metric, reference group, threshold, materiality band, multiple-comparison policy and a minimum-detectable-effect check. The outcome is pass, fail or inconclusive, from the interval against the band. Add a threshold library tagged by jurisdiction: four-fifths as a screen, LL144 reporting, and internal AI Act policies marked "no legal safe harbour" | M | P0 | R3.1 |
| R3.3 | Intersectional and calibration analysis in both runners. Suppress small strata one at a time instead of voiding the whole result. Report coverage, worst-group metrics with shrinkage, and calibration error per group with intervals | M | P0 | R3.1 |
| R3.4 | Computations to the LL144 standard:<br>- selection and scoring rates;<br>- intersectional categories;<br>- the 2% exclusion, with counts kept;<br>- counts of the unknown category;<br>- an attestation of the data source;<br>- a check that demographics were not inferred;<br>- a publishable summary.<br>Done when the output covers every field in the city's rule and matches hand-computed golden cases | M | P0 | R3.1 |
| R3.5 | Breadth: fairness for multiclass (one-vs-rest) and regression (error gaps between groups, scoring-rate ratios); counterfactual flip-rate and monotonicity tests for models we can load; bootstrap stability for permutation importance | M | P1 | R3.1 |
| R3.6 | Re-performance pack: a hashed bundle of inputs, configuration, seeds, frozen plan, engine version and container digest. Flags whether the auditor performed the test or the client supplied it. The verifier re-runs it and compares within a declared tolerance | M | P1 | R3.1 |
| R3.7 | Art 4a record: why the data is needed, why synthetic or anonymised data will not do, who accessed it, and confirmation of deletion. Acts as a gate before any run on special-category data, giving memo MEM-PR-01 a structured form | S | P0 | — |
| R3.8 | Engine validation dossier for each release: version-pinned test results, known limitations and a change log. Firms can use it to show under ISQM 1 that the tool is fit for purpose | S | P1 | R3.1 |

### Theme 4: Multi-scheme criteria and engagement packs (P0 foundation, P1 packs; M1–M2; lane A after Theme 1)
*Why:* the high-risk dates moved to 2027–28, so today's engagements run on other criteria. EN 18286 is the only route to a presumption of conformity, and competitors already sell cross-mapping.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R4.1 | Criteria model. Frameworks, requirements, control objectives and procedures become data, and engagement packs select criteria. The existing 33 papers and 12 memos migrate as the "EU AI Act (amended)" pack without changing open engagements. Crosswalks are typed using NIST IR 8477 relationships (equal, subset, superset, intersects) with a rationale. A coverage heatmap never shows partial coverage as full. Done when a new pack can be added as data alone | L | P0 | R1.2 |
| R4.2 | EN 18286 + ISO/IEC 42001 programme: Statement of Applicability against Annex A; Stage 1 and Stage 2 structure; nonconformity grading (major, minor, opportunity for improvement) with corrective actions. Output is either an ISAE 3000 conclusion or a certification recommendation | L | P1 | R4.1, R2.1 |
| R4.3 | NIST AI RMF 1.0 and AI 600-1 crosswalk: mapping and coverage only | S | P1 | R4.1 |
| R4.4 | Bias and ADMT pack covering LL144, Colorado SB 26-189, CCPA ADMT and Illinois HB 3773: papers, request templates, report and public-summary templates. Target 1 Jan 2027 | M | P1 | R3.4, R4.1 |
| R4.5 | GPAI downstream and Art 50 pack. GPAI: Model Documentation Form, training-content summary, copyright policy and Code of Practice signatory status. Art 50: disclosure design, marking layers, detection mechanisms and deepfake labels | M | P1 | R1.3, R4.1 |
| R4.6 | AIUC-1 and SOC 2 + AI evidence programme, mapped through the CSA AI Controls Matrix, with a quarterly retest schedule. Confirm AIUC-1 licensing first. Target the full AICPA–AIUC launch | M | P1 | R4.1, R6.1 |
| R4.7 | Deployer pack: an Art 27 FRIA template following ISO/IEC 42005, and Art 26 deployer evidence. A Korea high-impact checklist comes later | M | P2 | R4.1 |

### Theme 5: Identity, access and delivery baseline (starts in M1, lane D)
*Why:* identity is currently asserted by request headers set upstream. Audit firms' security reviews require SSO and MFA. There is no CI.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R5.0 | CI on every PR: lint, typecheck, TypeScript and Python tests, build, the check that both runners agree, and the catalogue-copy sync check. Do this first | S | P0 | — |
| R5.1 | Verified identity:<br>- accept `oai-authenticated-user-*` headers [F13] only when the request provably came through the trusted proxy (signed assertion or equivalent), otherwise reject;<br>- add OIDC/SAML per practice;<br>- add MFA, through the practice's identity provider or WebAuthn/TOTP where it has none;<br>- keep "Sign in with ChatGPT" as one provider.<br>Done when spoofed headers fail in tests and a test identity-provider flow passes in CI | L | P0 (header check), P1 (SSO and MFA) | R5.0 |
| R5.2 | Roles v2:<br>- engagement quality reviewer;<br>- external specialist, limited to assigned tests and papers;<br>- practice admin, with no evidence access by default.<br>Access is limited to assigned engagements by default. Break-glass access needs a purpose, a time limit and a review | M | P1 | — |
| R5.3 | SCIM user provisioning; an EU data-residency option; a roadmap to SOC 2, ISO 27001 and ISO 42001 for the platform itself (not code) | M | P2 | R5.1 |

### Theme 6: GenAI and agent evaluation evidence (P1, M2)
*Why:* this is the largest functional gap. Art 50 and GPAI obligations apply now, and AIUC-1 requires recurring adversarial testing. The main harnesses are vendor-owned, so neutrality is a selling point.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R6.1 | Evidence adapters and one shared per-item schema. Parsers for Inspect `.eval` logs, lm-evaluation-harness `--log_samples` output, promptfoo, garak report and hit log, PyRIT, DeepEval and Ragas. Hash every file on arrival. Never execute ingested code: no rescoring and no trusted-log loading. Show the L0–L3 evidence level on every item. Done when fuzz-tested parsers pass and a log that names code paths is ingested without executing anything | L | P1 | R3.1 |
| R6.2 | Recomputation:<br>- accuracy with clustered standard errors;<br>- attack-success rate per technique with Wilson intervals;<br>- paired comparisons between models;<br>- pass^k for agents.<br>LLM-judge validation: agreement with human labels (Cohen's κ), swapped answer positions, and a judge from a different model family | M | P1 | R6.1 |
| R6.3 | GenAI audit programme. Papers mapped to the OWASP LLM Top 10 (2026), the OWASP Agentic Top 10, NIST AI 600-1, MITRE ATLAS, and AI Act Art 15 and Art 50. Adds a required-metadata checklist; a readiness gate that blocks GenAI conclusions lacking n, standard errors or a validated judge; and a statement of what each claim covers | M | P1 | R4.1, R6.2 |
| R6.4 | Re-runs by the auditor (L3) through the external worker: containerised Inspect, garak and promptfoo; execution in the client's environment that returns signed aggregates; sandboxing and run budgets | L | P2 | R6.1, R7.1 |
| R6.5 | Art 50 marking checks: whether a C2PA manifest is present and valid on supplied samples; ingestion of output from the vendor's watermark detector; robustness to common transformations | M | P1 | R4.5 |

### Theme 7: Evidence integrity and verifiable outputs (P1, M2)
*Why:* Annex IV requires test reports that are dated and signed. The new Product Liability Directive makes audit files more likely to be disclosed. Buyers and insurers increasingly rely on these reports.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R7.1 | Run attestations: in-toto Test Result statements over input and output hashes, configuration and engine digest; signed and chained into the audit events | M | P1 | R3.6 |
| R7.2 | RFC 3161 timestamps on evidence hashes, attestations, report snapshots and dossiers. The timestamp authority is pluggable, with a test authority in CI. Verification works offline | M | P1 | — |
| R7.3 | Public verification page. Look up a report ID or hash to see the practice, signer, issue date, scope summary, status (valid, superseded or withdrawn) and timestamp proof. Shows no confidential content. Includes a workflow to supersede or withdraw a report | M | P1 | R7.2 |
| R7.4 | Upload security: a malware-scanner interface that quarantines files until they are clean (reusing the existing quarantined status); a file-type allowlist; retention and legal hold; assembling and locking the file after the report date | M | P1 | — |
| R7.5 | Key custody: signing keys per practice, with rotation, revocation and published public keys; no raw private keys in application storage [F12]; verification of OpenSSF Model Signing signatures on supplied models | M | P1 | — |

### Theme 8: Client collaboration (P1, M2)
*Why:* request lists with comments in context are the most-praised collaboration feature in this category. Vague requests and notification floods are the most common complaints.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R8.1 | Request lists 2.0:<br>- generated from the engagement pack;<br>- every request has a purpose, an example, the accepted format, an owner and a due date;<br>- clarification threads and bulk upload;<br>- reuse of earlier evidence, with a freshness check;<br>- existing links to papers are kept. | M | P1 | R4.1 |
| R8.2 | An inbox per role, with digests, reminders and per-user notification settings. The email provider sits behind an interface | M | P1 | — |
| R8.3 | Completeness-and-accuracy panel for each evidence item: row counts, period covered, hash, how the data was generated, whether the full population was captured (shown before any pass rate), and a reliability assessment | M | P1 | — |
| R8.4 | A client assurance-summary page behind an NDA click-through | S–M | P2 | R7.3 |

### Theme 9: Connectors and interoperability (P2, M3)
*Why:* clients already run governance, evaluation and observability tools. We import and verify their outputs rather than compete with them.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R9.1 | Import exports from governance platforms (CSV/JSON from Credo AI, OneTrust, Saidot, ServiceNow, Vanta, Drata), mapped to criteria with provenance. Build a generic mapper first | M | P2 | R4.1 |
| R9.2 | Post-market evidence: Evidently snapshots and sampled OpenTelemetry traces; an incident log with timers for the AI Act's 15-, 10- and 2-day reporting deadlines and for Cyber Resilience Act reporting | M | P2 | — |
| R9.3 | Exports: CycloneDX 1.6 `modelCard`; OSCAL assessment results | M | P2 | R4.1 |
| R9.4 | A client evidence API, and a read-only MCP server that enforces engagement permissions | M | P2 | R5.2 |

### Theme 10: Recurring assurance and practice operations (P2, M3)
*Why:* ISO surveillance audits are annual, AIUC-1 retests are quarterly and LL144 audits are annual. Certification bodies need competence records and certificate registers.

| ID | Epic (scope; done when) | Size | Priority | Depends on |
|---|---|---|---|---|
| R10.1 | Roll-forward: carry papers and requests into the next cycle with freshness flags; compare with the prior period; track findings that recur | M | P2 | R4.1 |
| R10.2 | Schedules and triggers: ISO surveillance, quarterly AIUC-1 retests and annual LL144 audits. A substantial modification to the system reopens the affected papers | M | P2 | R10.1 |
| R10.3 | Practice portfolio board: stage, overdue requests, review backlog and gate status across engagements; time and budget per paper, planned against actual | M | P2 | — |
| R10.4 | Certification-body operations: ISO/IEC 42006 competence records, a certificate register linked to public verification, a surveillance cycle, and a read-only view for regulators and peer reviewers | L | P2 | R7.3, R10.2 |

---

## 5. Evaluation capabilities

### 5.1 Principles
- **Defensibility beats metric count.** Every reported number carries n, an interval, the pre-registered criterion and the plan version.
- **The interval decides.**
  - **Pass** only when the interval lies wholly inside the materiality band.
  - **Fail** when it lies wholly beyond the threshold.
  - **Inconclusive** otherwise.

  Point estimates never decide.
- **The auditor chooses the fairness criterion.** When base rates differ between groups, calibration within groups and equal error rates cannot all hold at once (Kleinberg et al.; Chouldechova). The plan records which criterion fits the use case and why, rather than showing a wall of pass/fail tiles.
- **Method before runner.** For GenAI, the audit programme and its metadata gates ship before any new runner.
- **Ingest, recompute, attest.** Take per-item records from whichever harness ran the test, recompute the statistics ourselves and attest the result. Never execute ingested code. Never embed AGPL-licensed tools.
- **Claims are scoped.**
  - Accuracy on a benchmark is not accuracy on the wider population of inputs (NIST AI 800-3).
  - A low attack-success rate holds only for that attack set and that judge.

### 5.2 Implement natively

| Area | Metrics | Statistical safeguards | Where |
|---|---|---|---|
| Classification performance | accuracy, precision, recall, F1, balanced accuracy, AUC; multiclass macro-F1 | Wilson intervals for proportions; bootstrap for F1 and AUC; minimum class counts | engine + hosted runner |
| Regression performance | MAE, RMSE, R²; error gaps between groups | bootstrap intervals | engine + hosted runner |
| Group fairness on decisions | selection rate; demographic-parity difference and ratio; impact ratio on selection and scoring rates (LL144); gaps in true-positive and false-positive rates; predictive parity | Newcombe intervals for differences; Katz-log or BCa bootstrap for ratios; Fisher or Boschloo when any cell is under 5; Holm (confirmatory) or Benjamini–Hochberg (exploratory); reference group fixed in the plan | engine + hosted runner |
| Calibration | expected calibration error per group; reliability curves | bootstrap intervals; bins fixed in the plan | engine; subset in hosted runner |
| Intersectional analysis | worst-group metric; coverage (share of the population in cells large enough to evaluate) | small strata suppressed one at a time; beta-binomial shrinkage; cluster bootstrap for individuals who appear more than once | engine + hosted runner |
| Data quality | completeness, duplicates, train/test leakage, representativeness against a reference population | counts with denominators; exclusions listed | engine (partly exists) |
| Drift at a point in time | PSI, Kolmogorov–Smirnov, chi-squared, Wasserstein, Jensen–Shannon | bins fixed on the reference data; effect sizes rather than p-values when n is large; multiple-comparison control; PSI cut-offs labelled as convention, not standard | engine |
| Robustness (ONNX, PMML, XGBoost, LightGBM models) | perturbation loss (exists), counterfactual flip rate, monotonicity | paired tests (McNemar); an approved perturbation protocol | engine / worker |
| Explanations | permutation importance (exists), TreeSHAP | supporting evidence only; record the explainer, a hash of the background data and the seed; bootstrap stability | engine / worker |
| Audit sampling | attribute sample size; evaluation of deviations; seeded selection (exists) | parameters and rationale recorded | engine + UI |
| Power planning | minimum detectable effect; required n per group | run when the plan is approved | engine + UI |
| GenAI recomputation | accuracy ± SE; attack-success rate per technique; pass^k; paired differences | clustered standard errors; Wilson intervals; several epochs; validated judge | engine, from ingested items |

### 5.3 Why the safeguards matter (worked examples; arithmetic re-checked)
- **Small sample.** 6 of 20 selected versus 10 of 20 gives an impact ratio of 0.60, which "fails" the four-fifths screen. Yet Fisher's exact p ≈ 0.33 and the 95% interval runs from 0.27 to 1.34. Verdict: inconclusive.
- **Large sample.** 22,500 of 50,000 versus 25,000 of 50,000 gives a ratio of 0.90, which "passes". Yet the interval is 0.888–0.912 (z ≈ −15.8): a precisely measured 10% disparity. The pre-registered materiality band should decide, not the 0.8 heuristic.
- **Power.** Detecting 40% versus 50% selection with 80% power needs about 388 per group. Detecting 8% versus 10% needs about 3,213.
- **Error rates.** A true-positive rate of 0.80 measured on 50 positives has a Wilson 95% interval of 0.67–0.89.

### 5.4 Ingest from external tools

| Source | Format | What we recompute | Typical evidence level |
|---|---|---|---|
| Inspect (UK AISI) | `.eval` logs | per-sample scores, giving accuracy ± SE and attack-success rate; flag edits made after the run, which Inspect records in `log_updates` | L1 on hash; L2 after recomputation |
| lm-evaluation-harness | `--log_samples` output | accuracy ± SE; paired differences | L2 |
| promptfoo (owned by OpenAI since 2026) | results JSON | pass rates; attack-success rate per plugin and strategy | L2 |
| garak (NVIDIA) | JSONL report and hit log | attack-success rate per probe and detector, with Wilson intervals | L2 |
| PyRIT (Microsoft) | conversation and score exports | attack-success rate per attack strategy | L2 |
| DeepEval, Ragas | result exports | faithfulness, context precision and recall, with standard errors | L2 if per-item records are supplied, otherwise L0 |
| AILuminate, Moonshot | benchmark reports | violation rate per hazard | L0–L1 |
| Evidently | snapshots | drift statistics, when reference and current data are supplied | L1–L2 |
| Fairlearn, Aequitas | metric exports | group metrics and intervals, from per-row data when supplied | L0–L2 |
| Model and dataset documentation | model cards, Hugging Face cards, Croissant, CycloneDX `modelCard`, GPAI Model Documentation Form | nothing; treated as claims to test | L0 |
| Client SHAP or LIME output | exports | stability only, and only if per-row values are supplied | L0–L1 |

**Evidence levels:**
- **L0:** an aggregate reported by the client or a vendor.
- **L1:** a hashed tool log.
- **L2:** recomputed by us from per-item records.
- **L3:** re-run by the auditor, with an attestation.

**Reference only, not integrated:** AIF360 (last release Apr 2024), HELM (in maintenance mode) and OpenAI evals. Never embed deepchecks, whose core is AGPL-3.0.

### 5.5 GenAI, LLM and agent evaluation programme

| Dimension | Core metric | Typical sources |
|---|---|---|
| Accuracy and hallucination | accuracy ± SE; faithfulness for retrieval-augmented generation (supported claims / total claims); abstention rate | lm-evaluation-harness, Inspect, Ragas, DeepEval |
| Safety, toxicity and bias | violation rate per hazard; BBQ-style bias scores | AILuminate, Moonshot, DeepEval |
| Jailbreak and prompt injection | attack-success rate per technique | garak, PyRIT, promptfoo |
| Data leakage | leak rate on canary values and sensitive probes | garak, promptfoo, Inspect |
| Agents | task success; pass^k; utility under attack and targeted attack-success rate; tool-call accuracy | Inspect (sandboxed), AgentDojo-style suites, DeepEval |

Rules:
- **Required metadata on every GenAI result:**
  - model snapshot ID;
  - hash of the system prompt;
  - decoding parameters;
  - tools and permissions available to the model;
  - dataset and attack-set versions;
  - harness version;
  - judge model and family, with its validation κ;
  - number of epochs, n, and run dates.
- **Readiness gate.** No GenAI conclusion without n, standard errors and a validated judge. The judge must come from a different model family than the system under test, because LLM judges favour certain answer positions, longer answers and their own outputs.
- **Non-determinism.** Outputs vary even at temperature 0. Pin model snapshots, record decoding parameters and run several epochs.
- **Mapping:**
  - OWASP Top 10 for LLM Applications (2026);
  - OWASP Top 10 for Agentic Applications (Dec 2025);
  - NIST AI 600-1;
  - MITRE ATLAS;
  - AI Act Art 15(5) and Art 50;
  - AIUC-1 principles;
  - the IMDA Starter Kit categories.
- **Cadence.** Quarterly retests against a baseline, with paired comparisons (AIUC-1).
- **Where tests run.** Re-runs go through the external worker, because Cloudflare Workers suit neither long-running nor sandboxed jobs. Sometimes special-category data or model weights cannot leave the client, because of Art 4a access limits or Annex VII-style remote access. Then the test runs in the client's environment and returns signed aggregates.
- **Article 50.** Validate C2PA manifests natively on supplied samples. Ingest output from the vendor's watermark detector. Record robustness to common transformations.

### 5.6 Not native
- red-team runners on our infrastructure;
- benchmark hosting;
- a default LLM-judge service;
- continuous monitoring;
- embedding AGPL tools;
- executing pickled models, or rescoring logs that reference code.

---

## 6. UX principles

### 6.1 Principles
1. **Two clicks from conclusion to evidence.** Every conclusion links to its paper, test run and evidence, showing the hash, parameters, period and who did what.
2. **Tools propose, people conclude.** Keep the three separate states: applicability, diagnostic result and auditor conclusion. A diagnostic pass never fills in a conclusion.
3. **Honest status.**
   - "Not run", "inconclusive", "exception" and "pass" stay distinct.
   - Show n, intervals, denominators and exclusions.
   - Show whether the full population was captured before showing any pass rate.
4. **Independence is visible.**
   - Evidence from the client is labelled as such.
   - Clients cannot edit auditor work.
   - Drafts stay hidden from the client until released.
   - Submitted evidence cannot change.
5. **The legal basis is always on screen.** Classifications, papers, runs and reports carry a version badge showing the consolidated text, standards, methodology and research date. Anything assessed before its obligation applies is labelled readiness.
6. **Tailor, don't clone.** Templates carry the methodology, but the risk assessment decides scope, and engagements that look too alike get flagged.
7. **Calm queues.** One inbox per role and digests instead of pings. Every request states what is needed, why, an example, the accepted format and the due date.
8. **AI assistance is opt-in, cited, shown as a diff and logged.** It names its model provider. It never writes the opinion or signs off.
9. **Statistics in plain language for non-specialists,** with detail on demand. Example: "With 20 people per group, this test cannot tell a 10-point gap from noise."
10. **Export-ready.** DOCX, PDF and XLSX outputs, saved filters and a peer-review export.

### 6.2 Must-get-right workflows
1. Acceptance → independence declarations → scoping → risk assessment → plan, with a hard gate before fieldwork.
2. Classification with a recorded rationale, legal version and re-review triggers.
3. Pre-registered test plan → data intake with completeness and accuracy checks → run → result (pass, fail or inconclusive) → a separate auditor conclusion.
4. Client requests: request → clarification → upload → accept or return → automatic filing to papers → roll-forward.
5. Exception → finding → management response → retest → closure.
6. Review notes → preparer and reviewer sign-off → EQR → readiness gates → immutable snapshot.
7. Signed report → public verification link → supersede or withdraw.
8. GenAI evidence intake: upload the tool log → hash → recompute → assign evidence level → reviewer acceptance.
9. Roll-forward to the next cycle: surveillance audit, quarterly retest, annual bias audit.
10. Practice oversight and export for peer review.

### 6.3 Anti-patterns
- Integrations that show green ticks without checking population completeness, or one failing item turning a whole control red with no context.
- Pass/fail tiles based on point estimates; walls of metrics with no chosen criterion; the four-fifths rule presented as a legal test.
- Overclaiming: "compliant" badges, partial crosswalks shown as full coverage, or anything resembling a conformity certificate or regulator approval.
- Cloned engagements, and identical risk text across clients.
- Notification floods, and requests that don't say what is needed.
- Black-box AI, AI switched on by default, or client data sent to a third-party model without consent.
- Executing ingested code or pickled models.
- Silently rewriting issued reports when the law changes; open change tasks instead.
- SSO, MFA, SCIM or custom roles locked behind enterprise tiers or support tickets.
- Dashboards that need heavy configuration, filters that don't persist, and prices that creep up module by module.
- Auditor marketplaces steered by a vendor, which blur independence.

---

## 7. Sources

**Checked directly for this brief (5 Nov 2026)**
- [European Commission, AI Act Service Desk: implementation timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act)

**EU AI Act, Omnibus and guidance**
- [EUR-Lex: Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj)
- [EUR-Lex: OJ L 2026/1744 (the platform's authentic-amendment link)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744)
- [EUR-Lex: consolidated AI Act 02024R1689-20260727](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727)
- [Commission: AI Act policy page](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [Council of the EU: AI Act timeline](https://www.consilium.europa.eu/en/policies/artificial-intelligence-act/timeline-artificial-intelligence/)
- [Orrick: Digital Omnibus finalises 8 changes](https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes)
- [Addleshaw Goddard: AI Omnibus formally adopted](https://www.addleshawgoddard.com/en/insights/insights-briefings/2026/technology/eu-ai-act-ai-omnibus-formally-adopted/)
- [Legal500: Omnibus enters into force](https://www.legal500.com/intelligence/european-union/technology/eu-digital-omnibus-on-ai-enters-into-force)
- [NicFab: analysis of 2026/1744](https://www.nicfab.eu/en/posts/ai-act-2-august-2026/)
- [Law & Technology: Omnibus in the Official Journal](https://lawandtechnology.eu/en/digital-omnibus-on-ai-official-journal-regulation-2026-1744/)
- [Gibson Dunn: Omnibus agreement](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- [AI Act Explorer: Digital Omnibus](https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/)
- [Commission: draft Art 6 classification guidelines](https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems)
- [Commission: GPAI Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai)
- [Jones Day: Code of Practice on marking and labelling](https://www.jonesday.com/en/insights/2026/06/european-commission-publishes-final-code-of-practice-on-marking-and-labelling-aigenerated-content)
- [AI Act Art 43](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-43) · [Annex VII](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-7) · [Art 10 (current)](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-10)
- [Art 9](https://artificialintelligenceact.eu/article/9/) · [Art 10](https://artificialintelligenceact.eu/article/10/) · [Art 15](https://artificialintelligenceact.eu/article/15/) · [Annex IV](https://artificialintelligenceact.eu/annex/4/)

**Standards and conformity assessment**
- [EUR-Lex: Implementing Decision (EU) 2026/2274](https://eur-lex.europa.eu/eli/dec_impl/2026/2274/oj)
- [CEN-CENELEC: EN 18286 cited in the OJ](https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/)
- [CEN-CENELEC: EN 18286 published](https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-07-30-ai-quality-management/)
- [CEN-CENELEC: acceleration measures](https://www.cencenelec.eu/news-events/news/2025/brief-news/2025-10-23/)
- [Orrick: first harmonised standard](https://www.orrick.com/en/Insights/2026/10/First-Harmonised-Technical-Standard-Published-Under-the-EU-AI-Act)
- [Nemko: EN 18286](https://digital.nemko.com/news/en-18286-eu-ai-act-cites-new-harmonized-qms-standard)
- [KLA Digital: JTC 21 tracker](https://kla.digital/blog/jtc-21-standards-tracker)
- [AI Standardisation Watch, Sep 2026](https://krogrules.com/news/edition-16-september-2026)
- [ISO/IEC 42006](https://www.iso.org/standard/42006)
- [Bright Defense: ISO 42006](https://brightdefense.com/news/iso-42006-raises-the-bar-for-iso-42001-certifiers)
- [CSA: ISO 42001 certification process](https://cloudsecurityalliance.org/articles/what-to-expect-in-the-iso-42001-certification-process)
- [ISO/IEC 42005 (EVS)](https://www.evs.ee/en/iso-iec-42005-2025)
- [DeepInspect: conformity assessment bodies (unverified count)](https://www.deepinspect.ai/blog/eu-ai-act-conformity-assessment-bodies-list)
- [NIST IR 8477](https://doi.org/10.6028/NIST.IR.8477)

**Assurance standards, schemes and professional bodies**
- [IAASB: ISAE 3000 (Revised)](https://www.iaasb.org/publications/international-standard-assurance-engagements-isae-3000-revised-assurance-engagements-other-audits-or)
- [IAASB: ISSA 5000 fact sheet](https://ifacweb.blob.core.windows.net/publicfiles/2025-01/IAASB-ISSA-5000-Sustainability-Assurance-Fact-Sheet.pdf)
- [IAASB: technology quality-management roundtables](https://www.iaasb.org/publications/technology-quality-management-roundtables-outcomes-and-next-steps)
- [IAASB: ISA 500/330/520 exposure drafts](https://www.iaasb.org/news-events/2026-08/iaasb-proposes-revisions-core-standards-enhance-risk-based-audit-framework-and-address-technological)
- [ACCA: ISQM 2](https://www.accaglobal.com/gb/en/student/exam-support-resources/professional-exams-study-resources/p7/technical-articles/isqm-2.html)
- [ICAEW: ISQM 1 and service providers](https://www.icaew.com/technical/audit-and-assurance/audit/quality-management-in-audit-firms/isqm-1-and-evaluating-resources-from-service-providers)
- [CSA: SOC 2 AI controls gap](https://labs.cloudsecurityalliance.org/research/csa-research-note-soc2-ai-controls-gap-20260830-csa-styled/)
- [Journal of Accountancy, Feb 2026](https://www.journalofaccountancy.com/issues/2026/feb/promises-of-fast-and-easy-threaten-soc-credibility/) · [May 2026](https://www.journalofaccountancy.com/issues/2026/may/aicpa-guides-peer-reviewers-to-address-soc-2-risks/) · [Oct 2026](https://www.journalofaccountancy.com/news/2026/oct/aicpa-partners-on-new-offering-that-assures-ai-systems-and-agents/)
- [AICPA–AIUC offering](https://www.prnewswire.com/news-releases/auditors-meet-urgent-demand-for-ai-assurance-with-new-offering-from-aicpa-and-aiuc-302912598.html)
- [Schellman: first AIUC-1 auditor](https://www.schellman.com/blog/news/schellman-becomes-the-first-accredited-auditor-for-aiuc-1)
- [Arthur: AICPA TQA 9561 (vendor commentary)](https://www.arthur.ai/column/soc-2-ai-agents-aicpa-tqa-9561)
- [GOV.UK: trusted third-party AI assurance roadmap](https://www.gov.uk/government/publications/trusted-third-party-ai-assurance-roadmap/trusted-third-party-ai-assurance-roadmap)
- [techUK: AI Assurance Consortium](https://www.techuk.org/insights/news/dsit-s-ai-assurance-roadmap-takes-its-next-step-techuk-to-lead-the-industry-advisory-group-of-ai-assurance-consortium)
- [AI Verify Foundation: news](https://aiverifyfoundation.sg/news/) · [AI assurance](https://aiverifyfoundation.sg/ai-assurance/)
- [ISACA AAIA](https://www.isaca.org/about-us/newsroom/press-releases/2025/isaca-launches-groundbreaking-advanced-in-ai-audit-aaia-certification)
- [Auditing Algorithms (six national audit offices)](https://www.auditingalgorithms.net/)
- [DSA Delegated Regulation 2024/436](https://eur-lex.europa.eu/eli/reg_del/2024/436/oj/eng)
- [DSA Observatory: first DSA audits](https://dsa-observatory.eu/2025/06/11/shortcomings-of-the-first-dsa-audits-and-how-to-do-better/)
- [JD Supra: Delve allegations](https://www.jdsupra.com/legalnews/the-delve-scandal-why-a-soc-2-report-2567458/)

**US and other jurisdictions**
- [NYC DCWP: AEDT FAQ](https://www.nyc.gov/site/dca/businesses/faq-automated-employment-decision-tools.page)
- [LL144 final rule](https://www.sidley.com/-/media/resource-pages/ai-monitor/laws-and-regulations/20230406-nyc-dcwp-notice-of-adoption-of-final-rule-for-local-law-144.pdf?la=en)
- [NY State Comptroller: LL144 enforcement audit](https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools)
- [Colorado SB26-189](https://leg.colorado.gov/bills/sb26-189) · [Epstein Becker Green analysis](https://www.ebglaw.com/workforce-bulletin/inside-colorados-senate-bill-26-189-impacts-and-implications-for-employers) · [McDermott analysis](https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/)
- [Hunton: CCPA ADMT regulations](https://www.hunton.com/privacy-and-information-security-law/cppa-finalizes-ccpa-regulations-on-automated-decision-making-technology-risk-assessments-and-cybersecurity-audits)
- [FPF: California SB 53](https://fpf.org/blog/californias-sb-53-the-first-frontier-ai-law-explained/)
- [Baker Botts: Texas TRAIGA](https://www.bakerbotts.com/thought-leadership/publications/2025/july/texas-enacts-responsible-ai-governance-act-what-companies-need-to-know)
- [Seyfarth: Illinois IDHR rules withdrawn](https://www.seyfarth.com/news-insights/illinois-department-of-human-rights-temporarily-withdraws-proposed-rules-on-use-of-artificial-intelligence-in-employment.html)
- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) · [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) · [NIST AI 800-2](https://www.nist.gov/node/1905466) · [NIST AI 800-3](https://www.nist.gov/node/1906641) · [NIST AI 100-2 E2025](https://csrc.nist.gov/pubs/ai/100/2/e2025/final)
- [Federal Reserve: SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/sr2602.htm)
- [PRA: SS1/23](https://www.bankofengland.co.uk/prudential-regulation/publication/2023/may/model-risk-management-principles-for-banks-ss)
- [DOJ: EEOC disparate-impact guidelines opinion](https://www.justice.gov/opa/pr/justice-department-concludes-eeoc-disparate-impact-guidelines-violate-constitution)
- [DirectEmployers: UGESP rescission](https://directemployers.org/2026/10/23/eeoc-ugesp-rescission-final-rule-oira/)
- [29 CFR 1607.4](https://www.law.cornell.edu/cfr/text/29/1607.4)
- [Cooley: Korea AI Basic Act](https://www.cooley.com/news/insight/2026/2026-01-27-south-koreas-ai-basic-act-overview-and-key-takeaways)
- [Covington: China labelling rules](https://www.insideprivacy.com/international/china/china-releases-new-labeling-requirements-for-ai-generated-content/)
- [OpenRegulatory: MDCG 2025-6](https://openregulatory.com/mdcg/mdcg-2025-6)
- [Commission: Cyber Resilience Act](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act)
- [Commission: Product Liability Directive](https://single-market-economy.ec.europa.eu/single-market/goods/free-movement-sectors/liability-defective-products_en)

**Market and competitors**
- [OneTrust on the Gartner Magic Quadrant 2026](https://onetrust.com/resources/gartner-magic-quadrant-for-ai-governance-platforms-2026-report/)
- [Forrester Wave: AI Governance, Q3 2025](https://www.forrester.com/report/the-forrester-wave-tm-ai-governance-solutions-q3-2025/RES184849)
- [Credo AI](https://www.credo.ai/product) · [Holistic AI](https://www.holisticai.com/) · [Trustible](https://trustible.ai/) · [Saidot](https://www.saidot.ai/) · [Monitaur](https://www.monitaur.ai/) · [ValidMind](https://validmind.com/)
- [IBM watsonx.governance pricing](https://www.ibm.com/products/watsonx-governance/pricing)
- [ServiceNow AI Control Tower](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-expands-AI-Control-Tower-to-discover-observe-govern-secure-and-measure-AI-deployed-across-any-system-in-the-enterprise/default.aspx)
- [CrowdStrike to acquire Fiddler](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-to-acquire-fiddler-to-deliver-agent-observability/)
- [Promptfoo joining OpenAI](https://www.promptfoo.dev/blog/promptfoo-joining-openai/) · [OpenAI announcement](https://openai.com/index/openai-to-acquire-promptfoo/)
- [Harvey acquires Guardrails AI](https://www.harvey.ai/blog/guardrails-ai-joins-harvey)
- [Optro rebrand](https://optro.ai/blog/meet-optro-auditboard-unveils-new-identity-as-ai-transforms-grc) · [Optro MCP server](https://optro.ai/blog/optro-launches-mcp-server-to-provide-universal-ai-interoperability-for-grc-data)
- [Fieldguide engagement management](https://www.fieldguide.com/products/platform/engagement-management) · [Fieldguide AIUC-1 certification](https://www.globenewswire.com/news-release/2026/05/06/3288862/0/en/Fieldguide-Becomes-First-AI-Platform-for-Audit-and-Advisory-to-Achieve-AIUC-1-Certification.html)
- [TÜV SÜD and QuantPi](https://www.tuvsud.com/ko-kr/press-and-media/2026/october/tuv-sud-and-quantpi-are-joining-forces---to-ensure-ai-safety)
- [Validaitor TIC partnership](https://www.validaitor.com/tic-partnership)
- [Truyo Trust warranty](https://truyo.com/news/truyo-introduces-truyo-trust-offering-up-to-1-million-in-protection-for-qualified-ai-governance-customers/)
- [Modulos buyer's guide (competitor-authored)](https://www.modulos.ai/best-ai-governance-platforms/)
- [Vanta EU AI Act](https://www.vanta.com/products/eu-ai-act)
- [PwC Assurance for AI](https://www.pwc.co.uk/press-room/press-releases/corporate-news/pwc-uk-to-provide-assurance-for-ai-systems-.html)
- [KPMG AI assurance](https://www.cpapracticeadvisor.com/2025/09/25/kpmg-boosts-ai-trust-services-with-new-ai-assurance-offerings/169708/)
- [Caseware Cloud](https://insights.caseware.com/caseware-cloud-audit-software)

**GRC and audit-tool UX**
- [Vanta: audit experience](https://www.vanta.com/resources/audit-experience) · [Vanta: how auditors use Vanta](https://help.vanta.com/en/articles/11345844-how-will-your-auditor-use-vanta)
- [Vanta reviews (AWS Marketplace)](https://aws.amazon.com/marketplace/reviews/reviews-list/prodview-5ophamrbfxt44)
- [Drata Audit Hub](https://drata.com/product/audit-hub)
- [Drata: State of GRC 2026](https://drata.com/about/news/new-drata-research-finds-only-13-of-grc-professionals-are-fully-confident-in-their-ai-visibility)
- [Hyperproof crosswalks](https://help.hyperproof.app/en/articles/14304819-hyperproof-crosswalks)
- [Fieldguide reviews (Capterra)](https://capterra.com/p/215105/Fieldguide/reviews/)
- [G2: best audit management software](https://learn.g2.com/best-audit-management-software)
- [Linford & Co.: AICPA FAQ on SOC 2 tools](https://linfordco.com/blog/soc-2-automation-tools-aicpa-faqs)
- [Vendr: Vanta pricing](https://www.vendr.com/marketplace/vanta)
- [idenhq: SCIM tax (Vanta)](https://www.idenhq.com/scim-tax/vanta)

**Evaluation methods and tools**
- [Fairlearn: confidence intervals](https://fairlearn.org/main/user_guide/assessment/confidence_interval_estimation.html)
- [Kleinberg et al.](https://arxiv.org/abs/1609.05807) · [Chouldechova](https://arxiv.org/abs/1610.07524) · [Kearns et al.](https://arxiv.org/abs/1711.05144) · [Miller](https://arxiv.org/abs/2411.00640) · [Slack et al.](https://arxiv.org/abs/1911.02508) · [Zheng et al.](https://arxiv.org/abs/2306.05685)
- [Thinking Machines: non-determinism](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)
- [Evidently drift methods](https://docs.evidentlyai.com/metrics/explainer_drift)
- [Inspect eval logs](https://inspect.aisi.org.uk/eval-logs.html) · [garak](https://github.com/NVIDIA/garak) · [PyRIT](https://microsoft.github.io/PyRIT/) · [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) · [DeepEval](https://github.com/confident-ai/deepeval) · [Ragas metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/) · [deepchecks](https://github.com/deepchecks/deepchecks)
- [AIF360 releases](https://github.com/Trusted-AI/AIF360/releases) · [HELM](https://github.com/stanford-crfm/helm) · [IBM Adversarial Robustness Toolbox](https://github.com/Trusted-AI/adversarial-robustness-toolbox)
- [AILuminate](https://mlcommons.org/ailuminate/) · [Moonshot](https://github.com/aiverify-foundation/moonshot) · [τ-bench](https://arxiv.org/abs/2406.12045) · [AgentDojo](https://arxiv.org/abs/2406.13352)
- [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) · [OWASP Top 10 for LLM Applications 2026](https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/)

**Evidence integrity and exchange formats**
- [in-toto Test Result predicate](https://github.com/in-toto/attestation/blob/main/spec/predicates/test-result.md)
- [Sigstore bundle](https://docs.sigstore.dev/about/bundle/)
- [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161)
- [OpenSSF Model Signing](https://openssf.org/blog/2025/06/25/an-introduction-to-the-openssf-model-signing-oms-specification/)
- [SLSA v1.2](https://slsa.dev/blog/2025/11/announce-slsa-v1.2)
- [CycloneDX 1.6 schema](https://raw.githubusercontent.com/CycloneDX/specification/master/schema/bom-1.6.schema.json)
- [Croissant](https://github.com/mlcommons/croissant)
- [C2PA 2.3 specification](https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf)
