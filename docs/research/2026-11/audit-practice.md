> **Research record: Independent AI audit and assurance in practice.** Kept as written on 5 November 2026. Only this note was added and line endings were normalised to LF; everything below the rule is the original. The current plan is [ROADMAP.md](../../../ROADMAP.md) and the distilled direction is [docs/product/direction.md](../../product/direction.md); where they differ from this record, they win. See the [folder index](README.md) for how the research was done.
>
> - **Date:** status as of 5 November 2026; not updated since.
> - **Method:** desk research of assurance standards, professional bodies, regulators, research papers and audit-tool vendors, in the same planning session; primary sources where possible, secondary ones flagged in the text.
> - **Verification limits:** as the brief's opening note says, the shared search budget ran out near the end, so some items are marked unverified or left out (for example the figures from the 2024 "Null Compliance" study of LL144).
> - **Links (checked 5 November 2026):** 72 distinct links: 68 returned a page, 3 refused automated requests, 1 returned 404 (the Eticas guide, `eticasfoundation.org/wp-content/uploads/2024/04/ETICAS-Adversarial-Algorithmic-Auditing-Guide-2023.pdf`). A page that loads was not re-read for the claim it supports.
> - **Local paths:** `C:\Users\Ahedj\Documents\dev\AI Assurance\` is the repository root at commit `74c6463`, so read those paths as repository-relative (for example `site-app/lib/diagnostics.ts`). Line numbers predate the Prettier reformat in [#1](https://github.com/ahed-jneed/ai-assurance/issues/1).

---

# Independent AI audit and assurance in practice (2025–2026): standards, methods, and what auditors need from software

*Research as of 5 Nov 2026. I used primary sources where I could and flag secondary ones. The shared web-search budget ran out near the end of the research. Because of that, some items are marked unverified or left out, for example the figures from the 2024 "Null Compliance" study of LL144 and vendors' sampling features.*

## 1. Key findings

1. **There is still no AI-specific assurance standard.** AI engagements run on general frameworks:
   - ISAE 3000 (Revised);
   - AICPA attestation standards (SOC 2 plus added criteria);
   - ISO/IEC 17021-1 plus ISO/IEC 42006 for ISO/IEC 42001 certification;
   - legal regimes: EU AI Act conformity assessment, NYC Local Law 144 and EU DSA audits.

   The IAASB's AI work is about firms' *use* of AI, through non-authoritative guidance. The AICPA has issued no AI Trust Services Criteria. What is missing is content: criteria, test methods and evidence expectations.
2. **The EU timetable has moved.** Regulation (EU) 2026/1744 pushes Annex III high-risk obligations to 2 Dec 2027 and Annex I obligations to 2 Aug 2028. EN 18286 (quality management system, QMS) became the first harmonised AI Act standard in October 2026. Most work in the near term is ISO 42001 certification, SOC 2 plus AI, LL144 bias audits, AI Act readiness and internal audit.
3. **Shallow, templated assurance is being penalised.** AICPA peer reviewers are targeting templated SOC 2 files, critics have faulted the DSA audits, and New York's Comptroller has faulted enforcement of LL144 audits. Software that shows tailoring, real technical testing and reviewer challenge is an asset. Checkbox automation is a liability.
4. **Testing is becoming recurring and focused on generative AI.** AIUC-1 runs quarterly agent tests inside CPA-led SOC 2 engagements. ISO surveillance audits are annual, and LL144 audits must be less than a year old.
5. **Existing audit platforms do not handle AI as the subject of the audit.** None of them combines testing of the AI system with assurance-grade documentation. AI-governance suites serve the audited organisation, not the independent auditor.

## 2. The standards and schemes auditors actually use

### 2.1 Assurance standards and quality management
- **ISAE 3000 (Revised)** covers:
  - attestation versus direct engagements, and limited versus reasonable assurance;
  - preconditions for accepting an engagement: appropriate subject matter, suitable criteria, access to evidence and a rational purpose;
  - qualified, adverse and disclaimer conclusions;
  - the practitioner's expert, which is how data scientists join an engagement team ([IAASB](https://www.iaasb.org/publications/international-standard-assurance-engagements-isae-3000-revised-assurance-engagements-other-audits-or)).
- **ISSA 5000** was issued in November 2024 and applies to periods beginning on or after 15 Dec 2026. It removes sustainability work from ISAE 3000 ([fact sheet](https://ifacweb.blob.core.windows.net/publicfiles/2025-01/IAASB-ISSA-5000-Sustainability-Assurance-Fact-Sheet.pdf), [FAQ](https://ifacweb.blob.core.windows.net/publicfiles/2025-08/IAASB-ISSA-5000-FAQ-Applicability-ISAE-3000-3410.pdf)). It does not cover AI. As the IAASB's newest standard written to be usable by any profession, it is a plausible template for future AI assurance (our inference).
- **IAASB work on AI tools.** Eight roundtables with more than 240 stakeholders in the second half of 2025 led to a December 2025 decision. The IAASB will issue non-authoritative guidance on applying ISQM 1 and ISA 220 to AI tools. The themes are judging whether a tool is fit for purpose, monitoring, documentation, review of tool output and tool certification ([Accounting Today](https://www.accountingtoday.com/news/iaasb-to-pursue-non-authoritative-guidance-for-ai), [IAASB](https://www.iaasb.org/publications/technology-quality-management-roundtables-outcomes-and-next-steps), [expert group](https://ifacweb.blob.core.windows.net/publicfiles/2026-05/Technology%20QM%20Expert%20%20Group%20-%20Terms%20of%20Reference.pdf)). In August 2026 the IAASB published exposure drafts of ISA 330, 500 and 520 that redefine audit evidence for a digital environment. Comments are due 15 Dec 2026 ([IAASB](https://www.iaasb.org/news-events/2026-08/iaasb-proposes-revisions-core-standards-enhance-risk-based-audit-framework-and-address-technological)).
- **ISQM 1 and ISQM 2.** ISQM 1 ¶32(f) covers a firm's technological resources, whether built or bought. That includes working-paper, analytics and independence-tracking applications ([IFAC](https://www.ifac.org/knowledge-gateway/supporting-international-standards/discussion/are-your-firm-and-its-engagements-partners-ready-isqm-1-iaasb-ifac-second-quality-management-webinar), [ICAEW](https://www.icaew.com/technical/audit-and-assurance/audit/quality-management-in-audit-firms/isqm-1-and-evaluating-resources-from-service-providers)). ISQM 2 sets who may act as engagement quality reviewer (EQR), including a two-year cooling-off period, and requires a final "stand-back" check ([ACCA](https://www.accaglobal.com/gb/en/student/exam-support-resources/professional-exams-study-resources/p7/technical-articles/isqm-2.html)).
- **AICPA and SOC 2.** Auditors map AI evidence (data lineage, inference logging, drift monitoring, AI sub-processors) onto the 2017 criteria. As a result, two clean reports can rest on different AI controls ([CSA, Aug 2026](https://labs.cloudsecurityalliance.org/research/csa-research-note-soc2-ai-controls-gap-20260830-csa-styled/)). I could not verify a reported 2027 proposal to add AI points of focus.
  - The SOC 2 Working Group warned about "fast and easy" compliance platforms and templated reports ([JoA](https://www.journalofaccountancy.com/issues/2026/feb/promises-of-fast-and-easy-threaten-soc-credibility/)).
  - Since 1 Jun 2026, peer reviewers who see elevated risk compare about five engagements for identical risk assessments, sample sizes and procedures ([JoA](https://www.journalofaccountancy.com/issues/2026/may/aicpa-guides-peer-reviewers-to-address-soc-2-risks/)).
  - The **AICPA–AIUC offering** (19 Oct 2026) combines a SOC 2 report and AIUC-1 certification in one CPA-led engagement. AIUC-1 has six principles: data and privacy, security, safety, reliability, accountability and society. It maps to MITRE ATLAS, ISO 42001 and the AI Act, tests live agent behaviour, requires quarterly retests and fully launches in early 2027 ([release](https://www.prnewswire.com/news-releases/auditors-meet-urgent-demand-for-ai-assurance-with-new-offering-from-aicpa-and-aiuc-302912598.html), [JoA](https://www.journalofaccountancy.com/news/2026/oct/aicpa-partners-on-new-offering-that-assures-ai-systems-and-agents/)).
  - Related schemes: CSA's STAR for AI, with a Level 1 self-assessment from October 2025 and a Level 2 built on ISO 42001 from November 2025 ([CSA](https://cloudsecurityalliance.org/press-releases/2025/10/23/cloud-security-alliance-launches-star-for-ai-establishing-the-global-framework-for-responsible-and-auditable-artificial-intelligence)), and the HITRUST AI Security Assessment from late 2024 ([HITRUST](https://hitrustalliance.net/press-releases/hitrust_launches_ai_security_assessment_and_certification)).

### 2.2 Professional bodies, credentials and schemes
- **IIA.** Its AI Auditing Framework was updated in September 2024. It covers governance, management and the internal audit function, now includes generative AI, and comes with a quick-start checklist ([IIA](https://www.theiia.org/en/content/tools/professional/2023/the-iias-updated-ai-auditing-framework)). Mandatory topical requirements exist for cybersecurity (February 2026) and third parties (September 2026), but none for AI. This rests on secondary sources ([Grant Thornton](https://www.grantthornton.co.uk/insights/embedding-the-iia-topical-requirement-on-cyber-security/), [UHY](https://www.uhy-us.com/insights/news/2026/may/from-principles-to-practice-the-next-phase-of-internal-audit-standards)).
- **ISACA.** The AAIA credential launched on 19 May 2025. Its domains are AI governance and risk, AI operations, and AI auditing tools and techniques. It was first open to CISA, CIA and CPA holders, and eligibility was widened in July 2025 ([ISACA](https://www.isaca.org/about-us/newsroom/press-releases/2025/isaca-launches-groundbreaking-advanced-in-ai-audit-aaia-certification), [Business Wire](https://www.businesswire.com/news/home/20250724102426/en/ISACA-Expands-Eligibility-of-First-ever-Advanced-AI-Audit-Certification)). Its AI Audit Toolkit is a control library plus a guide to testing whether controls are well designed and work in practice ([blog](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2024/a-toolkit-to-facilitate-ai-governance), [store](https://www.isaca.org/store/items/waicat)).
- **UK.**
  - FRC guidance (June 2025) and ICAEW guidance (July 2025) deal with auditors' own use of AI ([Kingsley Napley](https://www.kingsleynapley.co.uk/our-insights/articles/tech-driven-ethically-bound-new-frc-and-icaew-guidance-on-ai-use-in-the-accountancy-sector/)). I found no ICAEW methodology for assuring AI systems.
  - ACCA and EY (August 2025) distinguish governance, conformity and performance assessments ([ACCA](https://www.accaglobal.com/content/dam/gb/policy-and-insights/reports/2025/ai-assessments-enhancing-confidence.pdf)).
  - DSIT's roadmap (September 2025) calls the quality of the assurance market "currently unclear" and cites skills gaps and poor access to information. It plans a consortium to build a profession, a code of ethics, a skills framework and an £11m innovation fund, and it notes a UKAS pilot for ISO 42001 accreditation. It also lists what auditors need to see. That ranges from full "white box" access (data, parameters, change records) down to minimal access, ideally through privacy-preserving environments ([DSIT](https://www.gov.uk/government/publications/trusted-third-party-ai-assurance-roadmap/trusted-third-party-ai-assurance-roadmap)).
- **ForHumanity** runs certification schemes covering the EU AI Act, GDPR, the UK Children's Code, NYC automated hiring tools, the DSA and disability inclusion, among others. It trains FHCA auditors and publishes a manual for certification bodies. I could not confirm any regulator approval of its schemes ([ForHumanity](https://forhumanity.center/certifications/), [manual](https://forhumanity.center/web/wp-content/uploads/2023/08/ForHumanity-IAAIS-Audit-Manual-v1.5.pdf)).
- **Big Four.** The FT reported in June 2025 that all four firms were racing to build AI assurance services ([Consultancy.uk](https://www.consultancy.uk/news/40424/big-four-weighing-up-new-ai-audit-offerings)). PwC UK launched "Assurance for AI" in July 2025 ([Consultancy.uk](https://www.consultancy.uk/news/41075/pwc-to-provide-assurance-for-ai-systems-to-clients)). In September 2025 KPMG added risk and control reviews, statistical testing, model validation and attestation ([CPA Practice Advisor](https://www.cpapracticeadvisor.com/2025/09/25/kpmg-boosts-ai-trust-services-with-new-ai-assurance-offerings/169708/)).

### 2.3 Regulatory and certification audits
- **EU AI Act.**
  - Systems under Annex III points 2–8 use internal control (Annex VI). Biometric systems may use Annex VI only if harmonised standards or common specifications are fully applied; otherwise they need a notified body under Annex VII ([Art. 43](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-43)).
  - Under Annex VII, the notified body:
    - assesses the Article 17 QMS and the Annex IV technical documentation;
    - may run its own tests;
    - gets full access to training, validation and test data, possibly remotely or through an API;
    - on a reasoned request, gets access to trained models and their parameters;
    - carries out ongoing surveillance ([Annex VII](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-7)).
  - Certificates for Annex III systems last at most four years (Article 44(2)).
  - Regulation 2026/1744 (Official Journal, 24 Jul 2026) also requires notified bodies to accept simplified documentation from SMEs and small mid-caps ([Law & Technology](https://lawandtechnology.eu/en/digital-omnibus-on-ai-official-journal-regulation-2026-1744/), [Orrick](https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes)).
  - EN 18286 was published in July 2026 and cited in the Official Journal on 14 Oct 2026. Draft standards on risk management, logging and cybersecurity reportedly failed their public enquiry vote; this is unconfirmed ([CEN-CENELEC](https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-07-30-ai-quality-management/), [JTC 21](https://jtc21.eu/), [tracker](https://kla.digital/blog/jtc-21-standards-tracker)).
  - I could not verify that any notified body has been designated under the AI Act. Check the EU's NANDO register before relying on this.
- **ISO/IEC 42001.** Accredited certification bodies follow ISO/IEC 17021-1 plus ISO/IEC 42006:2025 ([ISO](https://www.iso.org/standard/42006)).
  - Stage 1 takes about 1–2 days. It reviews scope, policies, risk and impact assessment methods (ISO/IEC 42005) and the Statement of Applicability.
  - Stage 2 takes about 3–9+ days, usually 4–12 weeks later. It tests how the Clause 8 and Annex A controls actually operate and records nonconformities and opportunities for improvement.
  - The certificate lasts three years, with annual surveillance audits at roughly a third of the initial effort ([CSA/Schellman](https://cloudsecurityalliance.org/articles/what-to-expect-in-the-iso-42001-certification-process)).
- **NYC Local Law 144.** Since 5 Jul 2023, employers using automated hiring tools need a bias audit less than a year old by an independent auditor, a public summary of it, and notices to candidates ([DCWP](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page)).
  - Auditors compute selection or scoring rates and impact ratios by sex, race/ethnicity and intersectional categories. Categories under 2% of the data may be excluded. Test data is allowed when historical data is insufficient. Auditors connected to the tool, the employer or the vendor do not count as independent ([Hodgson Russ](https://www.hodgsonruss.com/newsroom/publications/New-York-City-Issues-Final-Rules-for-Automated-Employment-Decision-Tools-Law-Postpones-Enforcement-Again), [SCC Online](https://www.scconline.com/blog/post/2023/04/25/nyc-adopts-final-regulations-on-use-of-ai-in-hiring-and-promotion/)).
  - On 2 Dec 2025 the State Comptroller called the city's enforcement "ineffective". The city agency (DCWP) found 1 issue in 32 published audits, while the Comptroller found at least 17 potential issues in the same audits. In test calls, 75% of complaints made through the city's 311 line were routed to the wrong place ([OSC](https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools), [DLA Piper](https://www.dlapiper.com/en-au/insights/publications/2026/01/critical-audit-of-nyc-ai-hiring-law-signals-increased-risk-for-employers)).
- **EU DSA audits** are the closest precedent for mandatory reasonable-assurance audits of algorithmic systems.
  - The rules require an audit-risk analysis, a stated methodology and an opinion for each obligation: "positive", "positive with comments" or "negative" ([Delegated Reg. 2024/436](https://eur-lex.europa.eu/eli/reg_del/2024/436/oj/eng), [Verfassungsblog](https://verfassungsblog.de/dsa-auditors-content-moderation-platform-regulation/)).
  - In the 2025 cycle, 19 of the 21 published overall conclusions were negative ([Compact](https://www.compact.nl/articles/navigating-the-next-phase-of-the-digital-services-act-audits-codes-of-conduct-guidelines-and-enforcement-actions/)).
  - Criticism of the first round ([DSA Observatory](https://dsa-observatory.eu/2025/06/11/shortcomings-of-the-first-dsa-audits-and-how-to-do-better/)):
    - obligations under regulatory investigation were left out of scope;
    - the platforms' own definitions were used as audit criteria;
    - there was little empirical testing;
    - reports disclaimed any opinion on the algorithmic systems themselves.

### 2.4 Algorithmic-audit methodologies
- **SMACTR** (Raji et al., FAT* 2020) has five stages: Scoping, Mapping, Artifact collection, Testing and Reflection. The documents produced at each stage together form the audit report ([arXiv](https://arxiv.org/abs/2001.00973)).
- **"Who Audits the Auditors?"** (FAccT 2022) catalogued 189 organisations and surveyed 152 practitioners. It recommends audits against defined standards, disclosure of findings, involvement of affected stakeholders and accreditation of auditors ([arXiv](https://arxiv.org/abs/2310.02521)).
- **Ada Lovelace Institute.** Its 2020 report separates bias audits from regulatory inspection ([2020](https://www.adalovelaceinstitute.org/?p=1684)). Its 2021 report describes code audits, user surveys, scraping, API audits, sock-puppet audits and crowd-sourced audits, combined with interviews and document review ([2021](https://www.adalovelaceinstitute.org/wp-content/uploads/2021/12/ADA_Technical-methods-regulatory-inspection_report.pdf)).
- **Eticas** carries out adversarial audits that look at both social and technical factors and involve affected communities ([guide](https://eticasfoundation.org/wp-content/uploads/2024/04/ETICAS-Adversarial-Algorithmic-Auditing-Guide-2023.pdf)).
- **Six national audit offices** (Brazil, Finland, Germany, the Netherlands, Norway, UK) published *Auditing AI Systems* on 19 Dec 2025. It is a risk-based catalogue covering:
  - governance;
  - data, including LLMs and retrieval-augmented generation;
  - model development;
  - evaluation before deployment;
  - deployment and change management;
  - systems in production.

  It comes with an Excel helper tool ([site](https://www.auditingalgorithms.net/)).

## 3. The engagement lifecycle and what it means for software

| Phase | Practice in AI engagements | Software implication |
|---|---|---|
| Acceptance & independence | ISAE 3000 preconditions. Independence under IESBA Code Part 4B, with LL144's extra exclusions. A self-review threat if the firm helped build or govern the system. Competence: data scientists, AAIA/FHCA holders, ISO lead auditors | Acceptance memo, per-person declarations, check for conflicts with non-assurance services, competence matrix, gate before fieldwork starts |
| Planning & scoping | System boundary ("target of evaluation"), criteria, period, assurance level, materiality, how much access the auditor gets (white-box or black-box) | Criteria library and crosswalks; information-access plan; budget |
| Risk assessment | AI risk and impact assessment, AI Act classification, audit-risk analysis | Engagement-specific risks that decide which procedures apply; evidence of tailoring |
| Control testing | Whether controls over data governance, change management, human oversight, monitoring and logging are well designed and work over the period | Test templates, attribute sampling, deviation tracking, period coverage |
| Technical testing | Performance, fairness, robustness, explainability; black-box and adversarial testing, including of generative AI agents; re-performing the client's tests | Reproducible runs (data hashes, versions, seeds); who ran the test, auditor or client; remote execution |
| Sampling & evidence | Control samples; whether test data is adequate; reliability of information the client produced | Sample-size calculators with documented parameters; seeded selection; reliability assessment per item |
| Findings | Graded deficiencies or nonconformities, root cause, management responses, retest | Findings linked to criteria; response workflow |
| Review & quality | Review notes, sign-offs, EQR (ISQM 2), monitoring (ISQM 1), peer review | Review notes as their own records, EQR gating, quality dashboard, file lock |
| Reporting | Limited assurance ("nothing has come to our attention") or reasonable assurance ("in our opinion"); unmodified, qualified, adverse or disclaimer; SOC 2 Type 1/2; ISO certification decision; LL144 summary; DSA ratings | Report builder per engagement type, with mandatory elements and roll-up by criterion |
| Follow-up | ISO surveillance; quarterly AIUC-1 retests; annual LL144 audit; AI Act post-market monitoring; re-assessment after substantial modification | Roll-forward engagements, baselines, schedules |

## 4. What auditors value, and how existing tools deliver it

| Capability | What existing tools offer (2025–2026) |
|---|---|
| Methodology & working papers | **Caseware Cloud:** methodology templates updated automatically, 1,500+ predefined risks, "intelligent file building", carry-forward and remote review ([Caseware](https://insights.caseware.com/caseware-cloud-audit-software)). **TeamMate+:** risk-based planning, electronic working papers with an audit trail, issue tracking, resource scheduling and board-ready reports ([ERP Research](https://erpresearch.com/erp-add-ons/audit-management/teammate-plus)). **Inflo:** cloud audit with a methodology and a quality-management module ([Inflo](https://inflo.com/)) |
| Evidence linking & custody | **DataSnipper:** works inside Excel; "snips" and cross-references tie figures to source documents; 500k+ users including all Big Four ([DataSnipper](https://www.datasnipper.com/resources/year-of-record-growth-market-expansion-and-product-innovation-for-datasnipper)). **Workiva:** its Tie-Out Agent leaves a trail "for review and examination" (July 2026) ([IT Brief](https://itbrief.co.uk/story/workiva-launches-ai-agents-for-reporting-compliance)) |
| Client requests (PBC) | **Inflo Collaborate:** status dashboard and permissions per request. **DataSnipper UpLink:** reminders, expiring upload links, AI pre-checking of uploads ([DataSnipper, vendor-written](https://www.datasnipper.com/resources/best-pbc-software-tools-audit)). **Caseware:** request tracking with automatic filing to the engagement |
| Analytics | **MindBridge:** scores 100% of journal entries with statistical models, rules and unsupervised machine learning, with explanations ([MindBridge](https://www.mindbridge.ai/)). **Inflo:** analyses "100% of transactions" |
| Generative AI assistance | TeamMate+ AI Editor, June 2025 ([Wolters Kluwer](https://www.wolterskluwer.com/en/news/wolters-kluwer-transforms-audit-documentation-launch-teammate-ai-editor)); Caseware AiDA ([Caseware](https://prd-webflow.caseware.com/news/caseware-cloud-audit-next-gen-solution-singapore-audit-professionals)); DataSnipper agents built with Microsoft ([DataSnipper](https://www.datasnipper.com/resources/datasnipper-and-microsoft-join-forces-to-bring-ai-agents-to-audit-finance)); Workiva agents through an MCP gateway; Optro (AuditBoard, renamed in March 2026) agents marketed with "full audit trails" ([rebrand](https://optro.ai/blog/meet-optro-auditboard-unveils-new-identity-as-ai-transforms-grc), [Optro](https://optro.ai/)) |
| AI governance (client-side tools) | Optro AI governance, April 2025: register of AI use cases, risk assessment, links to controls and vendors, NIST AI RMF ([Help Net](https://www.helpnetsecurity.com/2025/04/28/auditboard-ai-governance-solution/)). Agreement to acquire FairNow, October 2025 ([Help Net](https://www.helpnetsecurity.com/?p=345999)) |

Review notes, sign-offs and time capture are long-standing features of audit-management suites such as TeamMate+, but the public pages I could reach did not document them. **Takeaways:**
- Existing tools use AI for drafting, document extraction and transaction analytics. None produces model-test evidence.
- AI-governance suites are tools for the client's own first- and second-line teams, not for an independent auditor.
- Independence and acceptance checks usually sit in separate firm systems, even though ISQM 1 counts them as technological resources.
- Adoption is early: about a quarter of auditors used AI in a Wolters Kluwer/IIA Foundation survey ([CPA Practice Advisor](https://www.cpapracticeadvisor.com/2025/06/02/wolters-kluwer-launches-teammate-ai-editor/162072/)).

## 5. Implications for our platform

**P0: positioning and correctness**
1. **Position the platform as the independent auditor's system of record for AI assurance.** It should import data from clients' AI-governance tools rather than compete with them. *Why:* existing audit tools cannot test AI systems, governance vendors serve the client, and independence is what auditors sell.
2. **Turn the fixed 33-paper methodology into one pack per engagement type, while keeping the AI Act depth.** Packs:
   - ISAE 3000, limited and reasonable assurance;
   - SOC 2 plus AI, in the style of AIUC-1;
   - ISO 42001 Stage 1, Stage 2 and surveillance, for certification bodies;
   - LL144 bias audits;
   - AI Act readiness and Annex VI assurance;
   - Annex VII-style documentation assessment, for future notified bodies.

   Add a crosswalk across AI Act articles, EN 18286, ISO 42001 Annex A, NIST AI RMF and CSA's AI Controls Matrix, citing paywalled standards by clause number only. *Why:* high-risk deadlines moved to 2027 and 2028, and today's engagements use other criteria.
3. **Fix the reporting model.** The `reportOpinions` list on line 9 of `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\audit-gates.tsx` has no unmodified ("clean") conclusion and does not distinguish limited from reasonable assurance. Add:
   - the assurance level, and whether the engagement is attestation or direct;
   - the report elements ISAE 3000 requires;
   - logic that separates an adverse conclusion from a disclaimer;
   - roll-up of results by criterion;
   - ISO nonconformity grading, DSA-style ratings and an LL144 summary generator.

   *Why:* without these the platform cannot produce a report that complies with the standards.
4. **Add an acceptance and independence gate.** Replace the free-text "Competence and independence" field in `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\audit-program.tsx` with:
   - a preconditions checklist;
   - a declaration from each team member, including the LL144 tests;
   - a check for conflicts with non-assurance services;
   - a competence matrix;
   - EQR appointment that enforces ISQM 2 eligibility.

   Block the report from being issued until any required EQR is complete.
5. **Guard against templated files.** Make an engagement-specific risk assessment decide which papers apply. Require a written rationale for every sample size. Add a "tailoring report" that compares the engagement with the template and with the prior year. *Why:* this is exactly what AICPA peer reviewers now look for.

**P1: depth of fieldwork**
6. **Sampling and LL144 statistics.** Extend the existing seeded selector in `C:\Users\Ahedj\Documents\dev\AI Assurance\site-app\app\assurance-workbench.tsx` with:
   - calculators for attribute sample sizes and evaluation of deviations;
   - LL144 selection and scoring rates, including intersectional categories;
   - the 2% exclusion rule and counts of individuals in the "unknown" category;
   - confidence intervals and warnings when a group is too small.
7. **Broaden technical testing.** Add:
   - multiclass, regression and ranking metrics, robustness and drift;
   - evaluation of generative AI and agents (hallucination, data leakage, prompt injection) through the external worker.

   Record what is needed to reproduce each run, and label whether the auditor ran a test or the client supplied the result. Let workers run inside the client's environment and return only signed results. *Why:* AIUC-1, the remote data access allowed under Annex VII and DSIT's privacy-preserving access all point this way, and shallow testing was the DSA audits' main failure.
8. **Make review notes records of their own.** They should be threaded, open or cleared, and anchored to paper sections and evidence, and all must be cleared before sign-off. Add tick-mark cross-references from paper text to the evidence.
9. **Upgrade client request lists.** Generate them from each engagement pack and add due dates, reminders, a status dashboard, per-request permissions, automatic filing to papers and a reliability assessment for each item.

**P2: recurring work, operations and trust**
10. **Roll-forward engagements.** Carry papers forward, schedule retests against baselines, trigger re-work after a substantial modification and track whether findings recur.
11. **Support firm quality management under ISQM 1.** Add monitoring and remediation records. Publish a validation dossier for our diagnostics engine (version-pinned tests, known limitations) so firms can show it is fit for purpose, which is the IAASB roundtables' central ask.
12. **Govern the assistant.** Keep its output as a draft outside the evidence record until a person accepts it, and log the prompts, sources and model version.
13. **Track time and budget** per paper and phase, planned against actual.
14. **Harden the platform where buyers will expect it:**
    - SSO, MFA and SCIM;
    - malware scanning of uploads;
    - RFC 3161 trusted timestamps;
    - retention and legal hold;
    - assembling and locking the file after the report date (ISA 230 practice is ordinarily within 60 days);
    - our own SOC 2 and ISO 27001 (Caseware advertises both).
15. **Go-to-market order:** LL144 and ISO 42001 first, then SOC 2 plus AI firms ahead of AIUC-1's 2027 launch, then notified bodies once they are designated.

## Sources
**Standards and quality management:** [ISAE 3000](https://www.iaasb.org/publications/international-standard-assurance-engagements-isae-3000-revised-assurance-engagements-other-audits-or) · [ISSA 5000 fact sheet](https://ifacweb.blob.core.windows.net/publicfiles/2025-01/IAASB-ISSA-5000-Sustainability-Assurance-Fact-Sheet.pdf) · [ISSA 5000 FAQ](https://ifacweb.blob.core.windows.net/publicfiles/2025-08/IAASB-ISSA-5000-FAQ-Applicability-ISAE-3000-3410.pdf) · [IAASB roundtables](https://www.iaasb.org/publications/technology-quality-management-roundtables-outcomes-and-next-steps) · [Accounting Today](https://www.accountingtoday.com/news/iaasb-to-pursue-non-authoritative-guidance-for-ai) · [Tech QM expert group](https://ifacweb.blob.core.windows.net/publicfiles/2026-05/Technology%20QM%20Expert%20%20Group%20-%20Terms%20of%20Reference.pdf) · [ISA 500 exposure drafts](https://www.iaasb.org/news-events/2026-08/iaasb-proposes-revisions-core-standards-enhance-risk-based-audit-framework-and-address-technological) · [IFAC ISQM 1](https://www.ifac.org/knowledge-gateway/supporting-international-standards/discussion/are-your-firm-and-its-engagements-partners-ready-isqm-1-iaasb-ifac-second-quality-management-webinar) · [ICAEW ISQM 1](https://www.icaew.com/technical/audit-and-assurance/audit/quality-management-in-audit-firms/isqm-1-and-evaluating-resources-from-service-providers) · [ACCA ISQM 2](https://www.accaglobal.com/gb/en/student/exam-support-resources/professional-exams-study-resources/p7/technical-articles/isqm-2.html)

**AICPA and AI schemes:** [CSA SOC 2 AI gap](https://labs.cloudsecurityalliance.org/research/csa-research-note-soc2-ai-controls-gap-20260830-csa-styled/) · [JoA Feb 2026](https://www.journalofaccountancy.com/issues/2026/feb/promises-of-fast-and-easy-threaten-soc-credibility/) · [JoA May 2026](https://www.journalofaccountancy.com/issues/2026/may/aicpa-guides-peer-reviewers-to-address-soc-2-risks/) · [AICPA–AIUC release](https://www.prnewswire.com/news-releases/auditors-meet-urgent-demand-for-ai-assurance-with-new-offering-from-aicpa-and-aiuc-302912598.html) · [JoA Oct 2026](https://www.journalofaccountancy.com/news/2026/oct/aicpa-partners-on-new-offering-that-assures-ai-systems-and-agents/) · [CSA STAR for AI](https://cloudsecurityalliance.org/press-releases/2025/10/23/cloud-security-alliance-launches-star-for-ai-establishing-the-global-framework-for-responsible-and-auditable-artificial-intelligence) · [HITRUST](https://hitrustalliance.net/press-releases/hitrust_launches_ai_security_assessment_and_certification)

**Professional bodies:** [IIA framework](https://www.theiia.org/en/content/tools/professional/2023/the-iias-updated-ai-auditing-framework) · [Grant Thornton](https://www.grantthornton.co.uk/insights/embedding-the-iia-topical-requirement-on-cyber-security/) · [UHY](https://www.uhy-us.com/insights/news/2026/may/from-principles-to-practice-the-next-phase-of-internal-audit-standards) · [ISACA AAIA](https://www.isaca.org/about-us/newsroom/press-releases/2025/isaca-launches-groundbreaking-advanced-in-ai-audit-aaia-certification) · [AAIA eligibility](https://www.businesswire.com/news/home/20250724102426/en/ISACA-Expands-Eligibility-of-First-ever-Advanced-AI-Audit-Certification) · [ISACA toolkit](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2024/a-toolkit-to-facilitate-ai-governance) · [toolkit store page](https://www.isaca.org/store/items/waicat) · [FRC/ICAEW](https://www.kingsleynapley.co.uk/our-insights/articles/tech-driven-ethically-bound-new-frc-and-icaew-guidance-on-ai-use-in-the-accountancy-sector/) · [ACCA/EY](https://www.accaglobal.com/content/dam/gb/policy-and-insights/reports/2025/ai-assessments-enhancing-confidence.pdf) · [DSIT roadmap](https://www.gov.uk/government/publications/trusted-third-party-ai-assurance-roadmap/trusted-third-party-ai-assurance-roadmap) · [ForHumanity](https://forhumanity.center/certifications/) · [ForHumanity manual](https://forhumanity.center/web/wp-content/uploads/2023/08/ForHumanity-IAAIS-Audit-Manual-v1.5.pdf) · [Big Four](https://www.consultancy.uk/news/40424/big-four-weighing-up-new-ai-audit-offerings) · [PwC](https://www.consultancy.uk/news/41075/pwc-to-provide-assurance-for-ai-systems-to-clients) · [KPMG](https://www.cpapracticeadvisor.com/2025/09/25/kpmg-boosts-ai-trust-services-with-new-ai-assurance-offerings/169708/)

**Regulation and certification:** [AI Act Art. 43](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-43) · [AI Act Annex VII](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-7) · [Omnibus publication](https://lawandtechnology.eu/en/digital-omnibus-on-ai-official-journal-regulation-2026-1744/) · [Orrick](https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes) · [Sidley](https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/) · [CEN-CENELEC](https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-07-30-ai-quality-management/) · [JTC 21](https://jtc21.eu/) · [JTC 21 tracker](https://kla.digital/blog/jtc-21-standards-tracker) · [ISO/IEC 42006](https://www.iso.org/standard/42006) · [ISO 42001 process](https://cloudsecurityalliance.org/articles/what-to-expect-in-the-iso-42001-certification-process) · [DCWP](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page) · [Hodgson Russ](https://www.hodgsonruss.com/newsroom/publications/New-York-City-Issues-Final-Rules-for-Automated-Employment-Decision-Tools-Law-Postpones-Enforcement-Again) · [SCC Online](https://www.scconline.com/blog/post/2023/04/25/nyc-adopts-final-regulations-on-use-of-ai-in-hiring-and-promotion/) · [NY Comptroller](https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools) · [DLA Piper](https://www.dlapiper.com/en-au/insights/publications/2026/01/critical-audit-of-nyc-ai-hiring-law-signals-increased-risk-for-employers) · [DSA Delegated Regulation](https://eur-lex.europa.eu/eli/reg_del/2024/436/oj/eng) · [Verfassungsblog](https://verfassungsblog.de/dsa-auditors-content-moderation-platform-regulation/) · [Compact](https://www.compact.nl/articles/navigating-the-next-phase-of-the-digital-services-act-audits-codes-of-conduct-guidelines-and-enforcement-actions/) · [DSA Observatory](https://dsa-observatory.eu/2025/06/11/shortcomings-of-the-first-dsa-audits-and-how-to-do-better/)

**Methodologies:** [Raji et al.](https://arxiv.org/abs/2001.00973) · [Who Audits the Auditors](https://arxiv.org/abs/2310.02521) · [Ada Lovelace 2020](https://www.adalovelaceinstitute.org/?p=1684) · [Ada Lovelace 2021](https://www.adalovelaceinstitute.org/wp-content/uploads/2021/12/ADA_Technical-methods-regulatory-inspection_report.pdf) · [Eticas](https://eticasfoundation.org/wp-content/uploads/2024/04/ETICAS-Adversarial-Algorithmic-Auditing-Guide-2023.pdf) · [Audit offices' AI guide](https://www.auditingalgorithms.net/)

**Tools:** [Caseware Cloud](https://insights.caseware.com/caseware-cloud-audit-software) · [Caseware AiDA](https://prd-webflow.caseware.com/news/caseware-cloud-audit-next-gen-solution-singapore-audit-professionals) · [TeamMate+](https://erpresearch.com/erp-add-ons/audit-management/teammate-plus) · [TeamMate+ AI Editor](https://www.wolterskluwer.com/en/news/wolters-kluwer-transforms-audit-documentation-launch-teammate-ai-editor) · [Wolters Kluwer/IIA survey](https://www.cpapracticeadvisor.com/2025/06/02/wolters-kluwer-launches-teammate-ai-editor/162072/) · [Inflo](https://inflo.com/) · [DataSnipper](https://www.datasnipper.com/resources/year-of-record-growth-market-expansion-and-product-innovation-for-datasnipper) · [DataSnipper on PBC tools](https://www.datasnipper.com/resources/best-pbc-software-tools-audit) · [DataSnipper and Microsoft](https://www.datasnipper.com/resources/datasnipper-and-microsoft-join-forces-to-bring-ai-agents-to-audit-finance) · [Workiva](https://itbrief.co.uk/story/workiva-launches-ai-agents-for-reporting-compliance) · [MindBridge](https://www.mindbridge.ai/) · [Optro rebrand](https://optro.ai/blog/meet-optro-auditboard-unveils-new-identity-as-ai-transforms-grc) · [Optro](https://optro.ai/) · [AuditBoard AI governance](https://www.helpnetsecurity.com/2025/04/28/auditboard-ai-governance-solution/) · [FairNow acquisition](https://www.helpnetsecurity.com/?p=345999)
