> **Research record: Regulatory and standards landscape.** Kept as written on 5 November 2026. Only this note was added and line endings were normalised to LF; everything below the rule is the original. The current plan is [ROADMAP.md](../../../ROADMAP.md) and the distilled direction is [docs/product/direction.md](../../product/direction.md); where they differ from this record, they win. See the [folder index](README.md) for how the research was done.
>
> - **Date:** status as of 5 November 2026; not updated since.
> - **Method:** desk research of EU, US and other official sources, law-firm analyses and standards trackers, in the same planning session.
> - **Verification limits:** the closing "Not verified" list names what the search budget left unchecked. JTC 21 statuses come from trackers, not official CEN pages, and EUR-Lex returned empty pages to automated fetching. The last column of §10 uses only the feature list the authors were given, not the code. [#8](https://github.com/ahed-jneed/ai-assurance/issues/8) verifies the dates and citations against primary sources; until then treat them as research, not as law.
> - **Links (checked 5 November 2026):** 49 distinct links: 45 returned a page, 4 refused automated requests, none returned 404. A page that loads was not re-read for the claim it supports.

---

# Regulatory and standards landscape for AI assurance, as of 5 November 2026

## 1. Bottom line

- **Regulation (EU) 2026/1744 exists.** It is the "Digital Omnibus on AI". It was signed on 8 Jul 2026, published in OJ L on 24 Jul 2026 and has applied since 27 Jul 2026 [1][3][4].
  - It moves the Annex III high-risk obligations to **2 Dec 2027** and the Annex I (product-embedded) obligations to **2 Aug 2028**.
  - It leaves the **2 Aug 2026** general application date in place. Article 50 transparency, GPAI enforcement, market surveillance and the EU database therefore apply now [2][3].
- **Only one harmonised standard has been cited in the OJ: EN 18286:2026 (AI quality management system).** The citation came in October 2026. Most other CEN-CENELEC JTC 21 drafts failed their public enquiry or have not reached it yet [13][15][16].
- **US obligations have shifted from risk-management programmes to notice, explanation and human review.**
  - Colorado repealed and re-enacted its AI Act as SB 26-189, with duties from 1 Jan 2027 [27][28].
  - Federal policy works against state AI laws [24][25].
  - The US obligations an auditor can actually test are: NYC LL144 bias audits, the CCPA rules on automated decision-making technology (ADMT), Texas TRAIGA, California SB 53 and Illinois HB 3773.
- **US bank model-risk guidance has been replaced.** SR 26-2 (17 Apr 2026) supersedes SR 11-7 and explicitly excludes generative and agentic AI [36].
- **For us:**
  - Anchor the control mapping on the AI Act as amended, EN 18286 / ISO/IEC 42001 and NIST AI RMF.
  - Sell LL144-grade bias audits, Article 50 reviews and GPAI reviews now.
  - Build GenAI evaluation and monitoring next.

## 2. EU AI Act after Regulation (EU) 2026/1744

**Legislative path:**
- Commission proposal: 19 Nov 2025.
- Political agreement: 7 May 2026 (overnight 6–7 May).
- Parliament adoption: June 2026.
- Council final approval: 29 Jun 2026 [2][6][7].

**Key dates after the amendment** [2][3][4][5]:

| Obligation | Applies from |
|---|---|
| Art 5 prohibitions; Art 4 AI literacy | 2 Feb 2025 |
| GPAI obligations (Arts 53–55), governance, penalties | 2 Aug 2025 |
| Commission GPAI enforcement and fines (Art 101) | 2 Aug 2026 |
| GPAI models placed on the market before 2 Aug 2025 | must comply by 2 Aug 2027 |
| General application: Art 50 transparency, EU database, market surveillance (rewritten Art 75, new Arts 75a–75d) | **2 Aug 2026** |
| Art 50(2) machine-readable marking, for generative systems on the market before 2 Aug 2026 | 2 Dec 2026 |
| New Art 5 bans: generating non-consensual intimate imagery or CSAM | 2 Dec 2026 |
| Annex III high-risk (Ch. III §§1–3), including the Art 27 fundamental-rights impact assessment (FRIA) | **2 Dec 2027** |
| Annex I product-embedded high-risk | **2 Aug 2028** |
| Legacy high-risk systems used by public authorities | 2 Aug 2030 |
| Deadline for national regulatory sandboxes | 2 Aug 2027 |

**Other changes** [3][4][5][6]:
- **AI literacy (Art 4)** is softened. The duty to "ensure a sufficient level" becomes a duty to take measures that support literacy.
- **Bias-detection data.** The legal basis for processing special-category data to detect bias now covers all AI systems and GPAI models, not only high-risk ones. It is subject to strict necessity, safeguards and documentation.
- **Smaller companies.** The Act now defines SMEs and small mid-caps (SMCs). Both get simplified technical documentation, a proportionate QMS and lower fine caps.
- **Product-embedded AI:**
  - The Machinery Regulation moves to Annex I Section B.
  - By 2 Aug 2027 the Commission may disapply AI Act requirements where sector law already provides equivalent protection.
  - The "safety component" notion is narrowed.
- **Registration.** The proposed exemption from registration for Art 6(3) "not high-risk" systems was **not** adopted. The information required under Annex VIII is trimmed.
- **AI Office.** From 2 Aug 2026 it has exclusive competence over AI systems built on a provider's own GPAI model and over systems integrated into very large online platforms or search engines. It gains powers of inspection, commitments, fines and periodic penalties of up to 5% of average daily turnover. National authorities keep competence for finance, law enforcement and borders.

**Guidance:**
- The Art 6 classification guidelines are **still in draft**. The draft was published 19 May 2026, consultation was extended to 23 Jul, and a final version is targeted for end-2026. The statutory deadline of 2 Feb 2026 was missed [8].
- The transparency guidelines (20 Jul 2026) are published [2].
- The final Code of Practice on marking and labelling AI-generated content is published (10 Jun 2026) [2][10]:
  - Providers: at least two machine-readable marking layers where necessary, plus detection mechanisms.
  - Deployers: labels for deepfakes and for AI-generated text on matters of public interest.

## 3. General-purpose AI (GPAI)

- **Code of Practice.** Published 10 Jul 2025 and found adequate by the Commission and the AI Board. It has three chapters [9]:
  - Transparency, including a Model Documentation Form.
  - Copyright.
  - Safety & Security, for systemic-risk models only.
- **Signatories** include Amazon, Anthropic, Google, IBM, Microsoft, Mistral AI and OpenAI. xAI signed only the Safety & Security chapter. Meta is not on the list [9].
- **Enforcement.** Since 2 Aug 2026 the Commission can request documentation, evaluate models, order mitigations and fine providers [3].
- **Why it matters for audits:** downstream providers need evidence of their upstream model's documentation, including the Model Documentation Form, the training-content summary and the copyright policy.

## 4. Harmonised standards and notified bodies

In Oct 2025 CEN-CENELEC adopted emergency measures [11]:
- A draft can be published without a separate formal vote if its enquiry result is positive.
- The target is availability by Q4 2026.

Standardisation request M/613 expires on 28 Feb 2027 [16].

| Deliverable | AI Act article | Status (mid-Oct 2026) |
|---|---|---|
| **EN 18286:2026** QMS | 17(1), 11(1) first sentence | Published Jul 2026; cited by Implementing Decision (EU) 2026/2274, OJ **14 Oct 2026** [13][14][15] (Commission page says 19 Oct [2]) |
| prEN 18228 risk management | 9 | Enquiry closed 30 Jul, reportedly rejected; comment resolution early Nov, then formal vote [15][16] |
| prEN 18229-1 logging | 12 | Failed weighted enquiry vote (443 comments); in resolution [15][16] |
| prEN 18229-2 transparency | 13 | Commission pre-enquiry review [15] |
| prEN 18229-3 human oversight | 14 | Enquiry closed 22 Oct; result not yet reported [15] |
| prEN 18229-4/-5 accuracy, robustness | 15 | Drafting [15] |
| prEN 18282 cybersecurity | 15 | Enquiry rejected; scope revised [15][16] |
| prEN 18283 bias; prEN 18284 datasets | 10 | Commission pre-enquiry; enquiry targeted for autumn 2026 [15][16] |
| prEN 18285 conformity assessment | 43, Annex VII | Mature draft sent to the Commission [15][16] |

**What EN 18286 does and does not give:**
- It is designed to sit on top of ISO/IEC 42001, ISO 9001 or ISO 13485 [13].
- Its presumption of conformity covers only the clauses it addresses.
- An ISO/IEC 42001 certificate alone gives **no** presumption of conformity [13].

**Timing.** Expect most technical standards in 2027, close to the Annex III date. Until then, auditors will test against the Articles directly and treat the drafts as "state of the art".

**Notified bodies.** Third-party assessment is needed mainly for:
- Annex III point 1 (biometrics) where harmonised standards are not fully applied.
- Annex I products, through their sectoral notified bodies (for example under MDR/IVDR).

I could not verify any AI Act notified body designated in NANDO.

## 5. ISO/IEC standards

- **ISO/IEC 42001:2023 (AI management system).** The certifiable baseline.
- **ISO/IEC 42006:2025 (Jul 2025).** Requirements for certification bodies that audit 42001, on top of ISO/IEC 17021-1 [18]. The EN adoption enquiry ran to 29 Oct 2026 [16].
- **ISO/IEC 42005:2025 (May 2025).** Guidance on AI system impact assessment [19]. A natural backbone for the Art 27 FRIA and for US-style assessments.
- **Other published standards:**
  - ISO/IEC 23894:2023 (AI risk management).
  - ISO/IEC 25059:2023 (AI quality model), which JTC 21 is adopting as an EN.
  - ISO/IEC 5259-1 to -5 (2024–25, data quality for machine learning) [20].
- **In the pipeline** [16]:
  - ISO/IEC 42007 (conformity-assessment schemes, at DIS).
  - ISO/IEC 24970 (logging).
  - DIS 4213 (performance measurement).
  - An amendment to ISO/IEC 22989 on agentic AI.
  - IEEE 7003-2024 (algorithmic bias), proposed for adoption.

## 6. NIST and US federal policy

**NIST:**
- AI RMF 1.0 and the Generative AI Profile (NIST AI 600-1, Jul 2024) are still the current versions [21].
- The Jul 2025 AI Action Plan directs NIST to revise the RMF [23]. Trackers reported no revised version as of Jul 2026; I have not checked since.
- Other NIST work [21][22]:
  - A concept note for a critical-infrastructure profile (7 Apr 2026).
  - A preliminary draft Cyber AI Profile (IR 8596, Dec 2025).
  - SP 800-53 control overlays for AI systems (the COSAiS project), still in development.

**Federal action against state laws:**
- Executive Order 14365 (Dec 2025) set up a DOJ AI Litigation Task Force. It told Commerce to list "onerous" state laws by 11 Mar 2026 [24]. I found no evidence that the list was published.
- DOJ joined xAI's lawsuit against Colorado on 24 Apr 2026 [25]. A federal court stayed enforcement of the original Colorado Act on 27 Apr [26].
- I found no federal preemption statute. I could not verify this after mid-2026.

## 7. US state and local laws

| Law | Status | What an auditor would examine |
|---|---|---|
| **Colorado SB 26-189** (repeals and re-enacts SB 24-205) | Signed 14 May 2026; duties from 1 Jan 2027; Attorney General rules due 1 Jan 2027; AG-only enforcement; 60-day cure period until 2030 [27] | **Developers:** documentation to deployers (intended uses, training-data categories, limitations, instructions for human review); notices of material updates. **Deployers:** notice at the point of interaction; explanation within 30 days of an adverse decision; data access and correction; meaningful human review. **Both:** 3-year records. The risk-management programme and annual impact assessments were dropped [28]. |
| **NYC LL144** | Enforced since 5 Jul 2023. The State Comptroller (2 Dec 2025) found enforcement ineffective, and the city agency (DCWP) agreed to most recommendations [30]. | Annual **independent** bias audit [29]: selection or scoring rates and impact ratios by sex, race/ethnicity and intersectional categories; categories under 2% may be excluded; counts of unknown-category individuals; historical data (test data only if insufficient); no inferred demographics; public summary; candidate notices. |
| **CCPA ADMT regulations** | Finalised 24 Jul 2025. ADMT compliance by 1 Jan 2027; risk assessments by 31 Dec 2027; cybersecurity-audit certifications due 1 Apr 2028, 2029 or 2030 depending on revenue [31] | Pre-use notices, opt-out, access requests, risk assessments, audit records |
| **California SB 53** | In force 1 Jan 2026 [32] | Published frontier AI framework, transparency reports, reports of critical safety incidents, whistleblower channel |
| **Texas TRAIGA** | In force 1 Jan 2026; AG-only enforcement; 60-day cure period [33] | Screening for prohibited intents; a defense tied to compliance with NIST AI RMF, the GenAI Profile or a similar framework (sources differ on the exact wording) |
| **Illinois HB 3773** | In force 1 Jan 2026. The state human-rights agency (IDHR) proposed notice rules on 15 May 2026 and withdrew them on 2 Jun [34] | Employment notices; evidence of discrimination testing |
| New York RAISE Act | Effective 1 Jan 2027 (secondary source only) [35] | Frontier safety protocols; 72-hour incident reporting |

## 8. Other jurisdictions

- **UK.** There is no AI bill; regulators lead.
  - The Data (Use and Access) Act replaced UK GDPR Art 22 with Arts 22A–22D from 5 Feb 2026. The ICO's guidance on automated decision-making is still in draft [41].
  - DSIT's *Trusted third-party AI assurance roadmap* (3 Sep 2025) covers professionalisation, skills and an innovation fund. UKAS is running accreditation work [40]. This is the most direct government signal for our market.
- **South Korea.** The AI Basic Act and its Enforcement Decree have applied since 22 Jan 2026 [42]:
  - High-impact AI: explanation, user-protection plan, human oversight and documentation.
  - Generative AI output must be labelled.
  - Foreign companies above set thresholds must appoint a local representative.
  - Fines are capped at KRW 30m, with a grace period of at least one year before they are imposed.
- **Canada.** No federal AI statute; AIDA lapsed. Bill C-36 (privacy reform) was tabled 15 Jun 2026 and is pending [43].
- **China.** The labelling Measures for AI-generated content and the mandatory standard GB 45438-2025 have applied since 1 Sep 2025. Content needs both explicit labels and implicit metadata labels, and platforms must detect and reinforce labels [44].

## 9. Sector rules

- **Banking:**
  - **US:** SR 26-2 (Fed/OCC/FDIC) supersedes SR 11-7 and SR 21-8. It is risk-based and aimed mainly at banks with over $30bn in assets. Footnote 3 puts generative and agentic AI out of scope [36].
  - **UK:** PRA SS1/23 has applied since 17 May 2024 and was amended in Apr 2026. AI is covered within general model risk [37].
  - **EU:** AI used for creditworthiness and for life/health insurance pricing falls under Annex III, so 2 Dec 2027.
- **Medical devices:**
  - **EU:** the MDCG 2025-6 / AIB 2025-1 FAQ says AI devices of class IIa and above are high-risk, with a single integrated conformity assessment by the notified body [38]. The Annex I date is now 2 Aug 2028.
  - **US (FDA):** the predetermined change control plan (PCCP) guidance is final, current version Aug 2025. The lifecycle guidance for AI-enabled device software is still a draft from Jan 2025 [39].
- **Cross-cutting EU law:**
  - Cyber Resilience Act: reporting obligations from 11 Sep 2026; main obligations from 11 Dec 2027 [45].
  - New Product Liability Directive: covers software and AI, for products placed on the market from 9 Dec 2026 [46].

## 10. Obligations and the evidence an auditor needs

The last column uses only the feature list we were given; "papers" means working-paper coverage only.

| Obligation | Evidence an auditor needs | Our platform today |
|---|---|---|
| AI Act Art 9 risk management (prEN 18228, ISO/IEC 23894) | Risk register including fundamental-rights risks; risk acceptance; test metrics and thresholds set in advance | Papers |
| Art 10 data governance (prEN 18283/18284, ISO/IEC 5259) | Datasheets, data lineage, representativeness and bias examination, record of necessity for special-category data and proof of deletion | Partial (bias lab) |
| Art 11 and Annex IV technical documentation | Versioned dossier; simplified form for SMEs/SMCs | Have |
| Art 12 logging, Art 19 and 26(6) log retention | Logging specification, sample logs, retention of at least 6 months, integrity controls | Papers |
| Arts 13–14 transparency and human oversight | Instructions for use, performance per group, oversight design, override and stop tests, operator training records | Papers |
| Art 15 accuracy, robustness, cybersecurity | Declared metrics, robustness and adversarial test reports, vulnerability handling | Classifier metrics only |
| Art 17 QMS (EN 18286) | QMS manual, change control, post-market monitoring, incident procedures, internal audits, management review | Partial |
| Arts 43/47/49 conformity assessment, declaration, registration | Annex VI internal-control file or notified-body certificate, EU declaration of conformity, EU database entry, Art 6(3) derogation rationale | Partial |
| Arts 72–73 post-market monitoring and serious incidents | Monitoring plan, drift and performance KPIs, incident log meeting the 15-, 10- and 2-day reporting deadlines | **Gap** |
| Arts 26–27 deployer duties and FRIA | Use according to instructions, oversight assignments, worker notices, FRIA (ISO/IEC 42005-style) and notification to the authority | **Gap** |
| Art 50 transparency | Disclosure UX, tests of multi-layer marking and detection, deepfake labels | **Gap** |
| GPAI Arts 53/55 | Model Documentation Form, training-content summary, copyright policy, systemic-risk evaluations | **Gap** |
| ISO/IEC 42001 | AI management system scope, AI policy, statement of applicability against Annex A, risk and impact assessments, internal audit | Partial |
| NIST AI RMF and AI 600-1 | Outcomes under Govern, Map, Measure and Manage; GenAI risk actions | **Gap** (no crosswalk) |
| NYC LL144 | Impact ratios (including intersectional), data source, unknown-category counts, independence statement, published summary | Partial (impact ratio exists) |
| Colorado SB 26-189, CCPA ADMT, Illinois HB 3773 | Developer documentation, notices, adverse-decision explanations, human-review and correction logs, risk assessments, retention for 3–5 years | **Gap** |
| SR 26-2, SS1/23 | Model inventory and materiality tiering, independent validation, ongoing monitoring, oversight of vendor models | **Gap** |
| MDR/IVDR plus AI Act; FDA PCCP | Integrated technical documentation, PCCP modification protocol and impact assessment, real-world monitoring | **Gap** |

## 11. Which frameworks to map controls to first

1. **EU AI Act as amended by 2026/1744**, with dates versioned in the content.
2. **EN 18286:2026 together with ISO/IEC 42001**, plus 42005 and 23894. EN 18286 is the only route to a presumption of conformity. ISO/IEC 42001 is the main certification market. Both use the same management-system structure.
3. **NIST AI RMF 1.0 and AI 600-1.** The common language for US clients, and referenced in Texas's statutory defense.
4. **NYC LL144, then Colorado SB 26-189, CCPA ADMT and Illinois.** These are enforceable now or from 2027 and produce concrete audit artefacts.
5. **Later:** the JTC 21 drafts as they are cited, then SR 26-2 / SS1/23, MDR/FDA, Korea and China labelling.

## Implications for our platform

**P0 (now)**
1. **Versioned regulatory content and timeline engine.** Re-baseline the content to 2026/1744 and stamp every classification and report snapshot with the version of the law and standards it used. Add an obligations-by-date view for each engagement.
   - *Why:* dates moved 16–24 months and will move again. Our immutable snapshots need a recorded legal basis to stay defensible.
2. **Classification update.** Add:
   - The new Art 5 bans.
   - The narrower safety-component test and Machinery in Annex I Section B.
   - Art 6(3) derogation rationale plus registration evidence.
   - An AI Office competence flag for systems built on the provider's own GPAI model.
   - Art 50 provider and deployer triggers.
3. **Control library with crosswalks.** Normalise the 33 working papers into control objectives. Map each objective to AI Act articles, EN 18286 clauses, ISO/IEC 42001 Annex A and NIST AI RMF subcategories / AI 600-1 actions. Show a coverage heatmap.
   - *Why:* clients ask "what does this give me under X?", and EN 18286 is the only presumption route.
4. **LL144-grade bias audit product, built from the existing testing lab.** Add:
   - Scoring rates for continuous outputs.
   - Intersectional categories and the 2% exclusion rule.
   - Unknown-category counts.
   - Data-source attestation and a check that demographics are not inferred.
   - An auditor-independence declaration.
   - A publishable summary through the client portal.
   - *Why:* this is the clearest legally mandated independent AI audit that exists today. The same evidence feeds AI Act Art 10, Illinois and Colorado.

**P1 (next quarter)**
5. **EN 18286 QMS audit programme**, plus an ISO/IEC 42001 audit mode that follows 42006 for clients who are certification bodies.
6. **Deployer pack:**
   - An Art 27 FRIA template built on ISO/IEC 42005.
   - Evidence workflows for ADMT notices, adverse-decision explanations and human review (Colorado, CCPA).
   - A Korea high-impact AI checklist.
7. **Article 50 and labelling tests in the Python engine:** presence and robustness of metadata and watermarks, evidence of detection mechanisms, deepfake-label checks, and the GB 45438 implicit-label check.
   - *Why:* Art 50 is one of the few EU obligations that applies in 2026.
8. **GenAI evaluation through the external worker protocol:**
   - A test harness mapped to the AI 600-1 risk areas.
   - Review of GPAI documentation (Model Documentation Form, training-content summary, copyright policy).
   - Review of SB 53 frontier frameworks.
   - *Why:* this is our largest functional gap, and SR 26-2 leaves GenAI governance to bespoke frameworks.
9. **Post-market monitoring and incident module:**
   - Monitoring plans and drift KPIs.
   - Incident timers for the AI Act's 15-, 10- and 2-day deadlines.
   - Cyber Resilience Act reporting (11 Sep 2026), SB 53 and RAISE Act timers.

**P2**
10. **Model-risk pack for SR 26-2 / SS1/23**: inventory, tiering, validation papers, vendor-model oversight. Position GenAI governance as its complement.
11. **Medical-device overlay**: integrated MDR/IVDR plus AI Act technical documentation per MDCG 2025-6, and FDA PCCP review papers.
12. **Standards watch**: ship checklists for the current drafts, labelled "not harmonised, state of the art" (prEN 18228, 18229-1/-3, 18283, 18284). Swap them for the final versions when they are cited.
13. **Evidence integrity and positioning:**
    - Add qualified RFC 3161 timestamps on evidence hashes and dossiers, malware scanning, and SSO/MFA.
    - *Why:* clients need to rely on the audit file, and the new Product Liability Directive (Dec 2026) makes it more likely to be disclosed in litigation.
    - Positioning: an independent-assurance workspace for auditors, LL144 auditors and certification bodies, not a provider-side GRC tool. This fits the UK government's push to professionalise AI assurance.

**Not verified.** The search budget ran out before I could check:
- Council of Europe AI Convention ratifications.
- A reported China Cybersecurity Law AI amendment effective 1 Jan 2026.
- Canadian federal and provincial rules on automated decisions.
- California SB 942 / AB 853 dates.
- Whether the Commerce "onerous laws" list has been published.
- AI Act templates for post-market monitoring and serious incidents.
- Any designated AI Act notified bodies.
- Any NIST RMF revision after Jul 2026.
- The result of the prEN 18229-3 enquiry.

The JTC 21 statuses come from trackers based on committee communications [15][16], not official CEN pages.

## Sources
1. EUR-Lex, Reg. (EU) 2026/1744 – https://eur-lex.europa.eu/eli/reg/2026/1744/oj
2. European Commission, AI Act page – https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
3. NicFab, analysis of 2026/1744 – https://www.nicfab.eu/en/posts/ai-act-2-august-2026/
4. Legal500, Omnibus enters into force – https://www.legal500.com/intelligence/european-union/technology/eu-digital-omnibus-on-ai-enters-into-force
5. Mishcon de Reya, AI Omnibus agreement – https://www.mishcon.com/news/eu-ai-act-simplified-unpacking-the-ai-omnibus-agreement-of-may-2026
6. Gibson Dunn, Omnibus agreement – https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
7. Council of the EU, AI timeline – https://www.consilium.europa.eu/en/policies/artificial-intelligence-act/timeline-artificial-intelligence/
8. Commission, draft high-risk guidelines – https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems ; Gowling WLG – https://gowlingwlg.com/insights-resources/articles/2026/eu-ai-act-commission-publishes-draft-guidelines-on-identifying-high-risk-ai-systems-under-article-6
9. Commission, GPAI Code of Practice – https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai
10. Jones Day, marking and labelling Code – https://www.jonesday.com/en/insights/2026/06/european-commission-publishes-final-code-of-practice-on-marking-and-labelling-aigenerated-content
11. CEN-CENELEC, acceleration (Oct 2025) – https://www.cencenelec.eu/news-events/news/2025/brief-news/2025-10-23/
12. CEN-CENELEC, AI standards update (May 2026) – https://www.cencenelec.eu/news-events/news/2026/newsletter/ots-73-etuc/
13. Orrick, first harmonised standard – https://www.orrick.com/en/Insights/2026/10/First-Harmonised-Technical-Standard-Published-Under-the-EU-AI-Act
14. EUR-Lex, Implementing Decision (EU) 2026/2274 – https://eur-lex.europa.eu/eli/dec_impl/2026/2274/oj
15. KLA Digital, JTC 21 tracker (15 Oct 2026) – https://kla.digital/blog/jtc-21-standards-tracker
16. AI Standardisation Watch, Sept 2026 – https://krogrules.com/news/edition-16-september-2026
17. Modulos, harmonised standards – https://docs.modulos.ai/frameworks/eu-ai-act/harmonized-standards
18. ISO, ISO/IEC 42006:2025 – https://www.iso.org/standard/44546.html
19. EVS, ISO/IEC 42005:2025 – https://www.evs.ee/en/iso-iec-42005-2025
20. ISO, ISO/IEC 5259-1 – https://www.iso.org/standard/81088.html
21. NIST, AI RMF – https://www.nist.gov/itl/ai-risk-management-framework
22. NIST COSAiS – https://csrc.nist.gov/projects/cosais ; Cyber AI Profile – https://natlawreview.com/article/nist-issues-preliminary-draft-cyber-ai-profile-framework-poised-alter-security
23. White House, AI Action Plan – https://www.whitehouse.gov/wp-content/uploads/2025/07/Americas-AI-Action-Plan.pdf
24. Mondaq, Commerce report on state laws – https://www.mondaq.com/unitedstates/new-technology/1757200/department-of-commerce-report-on-state-artificial-intelligence-laws-expected-by-march-11-2026
25. Axios, DOJ joins xAI challenge – https://www.axios.com/2026/04/24/justice-department-joins-xai-challenge-colorado-ai-law
26. Privacy World, Colorado stay – https://www.privacyworld.blog/2026/05/the-colorado-ai-act-hits-a-wall-litigation-legislative-uncertainty-and-an-enforcement-standstill/
27. Colorado General Assembly, SB26-189 – https://leg.colorado.gov/bills/sb26-189
28. Epstein Becker Green, SB 26-189 – https://www.ebglaw.com/workforce-bulletin/inside-colorados-senate-bill-26-189-impacts-and-implications-for-employers
29. NYC DCWP, AEDT FAQ – https://www.nyc.gov/site/dca/businesses/faq-automated-employment-decision-tools.page
30. NY State Comptroller, LL144 audit – https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools
31. Hunton, CCPA ADMT regulations – https://www.hunton.com/privacy-and-information-security-law/cppa-finalizes-ccpa-regulations-on-automated-decision-making-technology-risk-assessments-and-cybersecurity-audits
32. FPF, SB 53 – https://fpf.org/blog/californias-sb-53-the-first-frontier-ai-law-explained/
33. Baker Botts, TRAIGA – https://www.bakerbotts.com/thought-leadership/publications/2025/july/texas-enacts-responsible-ai-governance-act-what-companies-need-to-know
34. Seyfarth, IDHR rules withdrawn – https://www.seyfarth.com/news-insights/illinois-department-of-human-rights-temporarily-withdraws-proposed-rules-on-use-of-artificial-intelligence-in-employment.html
35. AI Laws by State, preemption tracker – https://www.ailawsbystate.com/blog/federal-ai-preemption-doj-task-force-state-law-fight-2026
36. Federal Reserve, SR 26-2 and attachment – https://www.federalreserve.gov/supervisionreg/srletters/sr2602.htm
37. PRA, SS1/23 – https://www.bankofengland.co.uk/prudential-regulation/publication/2023/may/model-risk-management-principles-for-banks-ss
38. OpenRegulatory, MDCG 2025-6 – https://openregulatory.com/mdcg/mdcg-2025-6
39. FDA, digital health guidances – https://www.fda.gov/medical-devices/digital-health-center-excellence/guidances-digital-health-content
40. GOV.UK, AI assurance roadmap – https://www.gov.uk/government/publications/trusted-third-party-ai-assurance-roadmap
41. Kennedys, DUAA 2026 – https://www.kennedyslaw.com/en/thought-leadership/article/2026/the-data-use-and-access-act-2025-commencement-dates-and-planned-guidance-for-2026 ; ICO – https://ico.org.uk/for-organisations/adm/
42. Cooley, Korea AI Basic Act – https://www.cooley.com/news/insight/2026/2026-01-27-south-koreas-ai-basic-act-overview-and-key-takeaways
43. Gowling WLG, Bill C-36 – https://gowlingwlg.com/insights-resources/articles/2026/ottawa-tables-long-awaited-federal-privacy-reform-legislation
44. Covington, China labelling – https://www.insideprivacy.com/international/china/china-releases-new-labeling-requirements-for-ai-generated-content/
45. Commission, Cyber Resilience Act – https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act
46. Commission, Product Liability Directive – https://single-market-economy.ec.europa.eu/single-market/goods/free-movement-sectors/liability-defective-products_en
