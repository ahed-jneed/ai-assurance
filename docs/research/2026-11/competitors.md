> **Research record: Competitive landscape.** Kept as written on 5 November 2026. Only this note was added and line endings were normalised to LF; everything below the rule is the original. The current plan is [ROADMAP.md](../../../ROADMAP.md) and the distilled direction is [docs/product/direction.md](../../product/direction.md); where they differ from this record, they win. See the [folder index](README.md) for how the research was done.
>
> - **Date:** status as of 5 November 2026; not updated since.
> - **Method:** desk research of vendor websites, press releases, analyst announcements and trade press, in the same planning session. The feature matrix in §5 is the authors' judgment from the §4 sources.
> - **Verification limits:** §7 lists what the search budget left unconfirmed. Gartner and Forrester placements come from vendor announcements, not the paywalled reports, and source [28] (Modulos) is written by a competitor. The "Our platform today" row was not checked against the code: the hosted runner already computes multiclass and regression performance, and only fairness is binary-only (synthesis §2.4, item 13).
> - **Links (checked 5 November 2026):** 71 distinct links: 61 returned a page, 8 refused automated requests, 2 returned 404 ([27] `holisticai.com/blog/holistic-ai-named-a-challenger-in-gartner-magic-quadrant` and [34] `benhamouglobalventures.com/fairly-ai-acquires-anch-ai/`). A page that loads was not re-read for the claim it supports.

---

# AI governance, assurance and audit software: competitive landscape (status 5 Nov 2026)

## 1. Bottom line

- **The category is built around the AI owner.** "AI governance platforms" now combine an AI inventory, risk assessment, control mapping and evidence with runtime control of AI agents. Gartner's first Magic Quadrant for AI Governance Platforms (16 Jun 2026, 13 vendors) names IBM, ServiceNow and Truyo as Leaders [1].
- **No vendor builds for the independent assessor.** Credo AI, Holistic AI, Trustible, Saidot and Monitaur all advertise "audit-ready" evidence and audit trails. None publicly offers the auditor's own workflow: client acceptance and independence, scoping and sampling, reviewed working papers, findings and issuing an opinion [2–6].
- **Large suites are absorbing the runtime layers.** Security vendors bought most guardrail and red-team startups in 2025–26. On 3 Nov 2026 CrowdStrike agreed to buy Fiddler and is selling agent observability as "compliance and audit evidence" [7].
- **Auditor demand is real but split across schemes:**
  - ISO/IEC 42001 certification
  - AIUC-1 audits of AI agents
  - SOC 2 reports with AI add-ons
  - EU AI Act work, now deferred
  - US bias and automated-decision (ADMT) rules

  The AICPA has no AI-specific SOC 2 criteria, so auditors are improvising [8].
- **Our auditor-side engagement system sits in real white space.** To hold it we need three things: support for several schemes, test results that stand up as audit evidence, and GenAI/agent testing. We should not drift into features built for the AI owner.

## 2. What drives demand (verified status)

| Driver | Status | Implication |
|---|---|---|
| EU AI Omnibus, Reg. (EU) 2026/1744 | Published in the Official Journal 24 Jul 2026, in force 27 Jul 2026. Annex III high-risk deadline moves to 2 Dec 2027, Annex I to 2 Aug 2028, legacy public-sector systems to 2 Aug 2030. New Art. 5 bans and the end of the Art. 50(2) grace period both fall on 2 Dec 2026. Small mid-caps get SME-style relief [9–11] | AI Act work shifts to readiness, quality management systems (QMS), transparency and general-purpose AI (GPAI). Our methodology must record which version of the law it assessed against. |
| EN 18286:2026 (QMS for Art. 17) | First harmonised AI Act standard. Cited by Implementing Decision (EU) 2026/2274 on 14 Oct 2026 [12]. Reportedly designed to sit on top of ISO/IEC 42001, ISO 9001 or ISO 13485 [13] | First set of criteria that gives presumption of conformity. The other AI Act standards are still pending. |
| AI Act notified bodies | "A small number" listed by mid-2026, most still pending. We could not check the count in NANDO, the EU register of notified bodies [14] | Mandatory third-party assessment is mostly limited to Annex III biometrics and to existing sectoral notified bodies. |
| ISO/IEC 42006:2025 | Published Jul 2025 [15]. European Accreditation made it mandatory on 20 Nov 2025. BSI received the first UKAS accreditation on 15 Jan 2026. Schellman was the first body accredited by ANAB [16] | Accredited ISO 42001 certifiers are a growing, paying user base. |
| AIUC-1 (AI-agent standard) | Schellman became the first authorised auditor on 3 Feb 2026. AIUC runs the technical evaluations; the auditor collects evidence and reports. Adversarial testing is quarterly [17]. UiPath and Sierra are certified [18][19] | A working model that separates technical testing from the audit itself. |
| SOC 2 | The AICPA has no AI-specific criteria. Firms fit AI evidence in ad hoc, so two clean reports can rest on different controls [8]. The AICPA issued TQA 9561, a practice aid, on 11 Sep 2026 (per vendor commentary) [20] | A methodology gap that software can fill. |
| US | Colorado SB 26-189 (signed 14 May 2026) replaces SB 24-205 with ADMT transparency rules, effective 1 Jan 2027 [21]. The insurance regulators' body NAIC is piloting an AI Systems Evaluation Tool in 12 states [22] | Smaller but recurring audit-type work. |
| Governments building assurance markets | UK: third-party assurance roadmap (Sep 2025) and an AI Assurance Consortium (Jun 2026) [23][24]. Singapore: Global AI Assurance Sandbox (30 apps tested) and an AI Tester Accreditation Programme (announced 18 May, launched 14 Oct 2026) [25][26] | Both are professionalising exactly the people we sell to. |

## 3. Analyst view and consolidation

**Gartner Magic Quadrant, Jun 2026** [1]:
- **Leaders:** IBM, ServiceNow, Truyo
- **Challenger:** Holistic AI
- **Visionaries:** OneTrust, ModelOp, Airia, Credo AI, Monitaur
- **Niche Players:** SAP, Relyance AI, Cranium, Saidot

Holistic AI says it had the top score for the risk-and-compliance use case in Gartner's companion Critical Capabilities report [27]. Modulos and Trustible report honourable mentions [28].

**Forrester Wave, Q3 2025** (10 vendors): Credo AI and IBM are Leaders; Collibra and Monitaur are Strong Performers [29–32].

**Newer analyst categories:** Gartner's Market Guide for AI Evaluation and Observability Platforms (Feb 2026) and Forrester's Agentic Control Plane landscape (Q2 2026) show that runtime control now counts as governance [33].

**Main deals:**

| Date | Deal | Signal |
|---|---|---|
| Jul 2025 (closed) | Palo Alto Networks bought Protect AI (now part of Prisma AIRS) | Red-teaming and model scanning move into security suites [28] |
| Jun 2025 | Fairly AI bought anch.AI; the combined company is Asenion | Small vendors merging [34] |
| Aug–Nov 2025 | F5 bought CalypsoAI ($180m); CrowdStrike bought Pangea (about $260m); Check Point bought Lakera; SentinelOne bought Prompt Security; Zscaler bought SPLX | Guardrail startups absorbed by security vendors [35–37] |
| 22 Oct 2025 | AuditBoard bought FairNow; AuditBoard renamed itself Optro on 9 Mar 2026 | An internal-audit/GRC suite adds AI governance [38][39] |
| Dec 2025 | Veeam completed its purchase of Securiti ($1.725bn) | Data security merges with AI governance [40] |
| Mar–Apr 2026 | OpenAI bought Promptfoo; ServiceNow bought Traceloop and completed Veza and Armis ($7.75bn) | The leading open-source red-team tool is now owned by OpenAI; ServiceNow assembles monitoring and security [41–43] |
| Apr–May 2026 | Fiddler bought Lumeus (reported); Cranium bought Aiceberg | Observability and security converge [44][28] |
| 9 Sep 2026 | Harvey bought Guardrails AI | Open-source guardrails taken in-house by an app vendor [45] |
| 3 Nov 2026 | CrowdStrike agreed to buy Fiddler, to become "Falcon Observe"; closing expected in CrowdStrike's Q4 FY27 | Observability sold as audit evidence [7] |

## 4. Vendor profiles

All vendors below sell to the AI owner. None targets auditors or regulators as primary buyers.

| Vendor | Buyer | Core capabilities and integrations | 2025–26 notes | Pricing |
|---|---|---|---|---|
| Credo AI | Enterprise AI-governance leads | Registry with shadow-AI discovery; risk library; policy packs for EU AI Act, NIST AI RMF, ISO 42001 and SOC 2; evidence generation; vendor registry; runtime trace evaluation. Integrates with AWS/Azure/GCP, Databricks, Snowflake, Azure AI Foundry, LangChain, ServiceNow, Archer, OneTrust, MLflow, Jira [2] | Forrester Leader, Gartner Visionary. Agent Governor research preview (Jul 2026). AIUC-1 content added Sep 2026 (per a competitor) [28] | Not public |
| Holistic AI | Enterprise security, legal, board | Discovery; 40+ tests for bias, hallucination, privacy and robustness; red-teaming; drift monitoring; controls for EU AI Act, NIST and ISO 42001; "Guardian Agents" that can block agent actions. Integrates with AWS, Azure, GitHub, Databricks [3] | Gartner Challenger; grew out of bias auditing [28] | Not public |
| OneTrust | Privacy, GRC, legal | Intake; inventory; EU AI Act classification; assessments; reuses OneTrust's third-party risk and data-mapping modules. Real-time monitoring and enforcement added Mar 2026 [46] | Gartner Visionary | Not public |
| Trustible | Governance professionals and General Counsel in regulated sectors, incl. defense | Intake; risk and impact assessment; incident monitoring; readiness scores across frameworks; vendor evaluation (parses contracts against ISO 42001 controls); board reports [4] | $4.6m seed round (2025) [47] | Not public |
| Saidot | EU enterprises and government, from first line to internal audit | Knowledge-graph library (260+ risks, 620+ controls, 110+ policies); agent catalogue; evidence reuse; transparency reports; MCP servers. Integrates with Microsoft Foundry, Azure, Bedrock, Jira [5] | Gartner Niche Player | Not public |
| Monitaur | Insurance and financial services | Inventory including third-party AI; policies and controls; validation; drift, bias and stress tests; monitoring [6] | Gartner Visionary; Forrester Customer Favorite [28]; Tokio Marine North America [48] | Not public |
| ModelOp | Large estates of models and agents | Inventory; agent registry; workflow automation; compliance reporting; 50+ integrations [28] | Gartner Visionary [49] | Not public |
| Truyo | Privacy-operations teams | AI inventory built from scans; risk tiers; covers 35+ laws [28] | Gartner Leader. Warranty of up to $1m, underwritten by Cysurance (Jul 2026) [50] | Not public |
| IBM watsonx.governance | Risk and data executives in large enterprises | Lifecycle governance; inventory; evaluations and monitoring; risk and compliance on OpenPages. Guardium AI Security adds discovery, red-teaming and 12 frameworks [51][52] | Gartner Leader, positioned highest per OneTrust's description of the chart [1] | **Public:** Risk & Compliance $3,500/mo (Basic) or $6,450/mo (Advanced); AWS from $42,000 (5 use cases, 12k evaluations); model management from $0.64/unit [51] |
| ServiceNow AI Control Tower | IT and IT-risk teams already on ServiceNow | Discover (30 new connectors); Observe (Traceloop); Govern (5 risk frameworks aligned to NIST and the EU AI Act); Secure (Veza, can shut down rogue agents); Measure; gateway for MCP traffic. General availability expected Aug 2026 [53] | Gartner Leader | Not public |
| Collibra | Chief data officers, data governance | AI use cases linked to data lineage; AI Command Center (6 May 2026) with Giskard tests in CI/CD [54] | Forrester Strong Performer | Not public |
| Securiti (now Veeam) | Data security, privacy | Data and AI discovery; firewalls on LLM prompts, responses and retrieval; AI governance for EU AI Act and NIST AI RMF; 1,000+ integrations [55] | Owned by Veeam [40] | Not public |
| ValidMind | Model-risk teams at banks and insurers | Inventory; automated validation and documentation; open-source test library; monitoring; policy-as-code for agents. Cites the EU AI Act, PRA SS1/23 and OSFI E-23 [56] | $8.1m seed round (2024) [57] | Not public |
| Asenion | Regulated enterprises | AI GRC with testing agents for fairness, privacy and security; red-teaming; reporting [34][58] | Formed Jun 2025 | Listed on AWS Marketplace |
| Arthur | AI engineers | Agent discovery and governance; open-source Evals Engine; persistent audit logs (May 2026) [59][61] | — | **Public:** Free; $60/mo; Enterprise [60] |
| Fiddler | AI engineers; compliance teams in regulated sectors and government | Continuous evaluations; agent observability; guardrails running on its own small models; ML monitoring. SaaS, VPC, on-premises or AWS GovCloud [33] | $30m Series C (reported); Lumeus purchase; CrowdStrike deal [7][44] | **Public:** Free; $0.002 per trace; Enterprise [33] |
| Arize | AI engineers | LLM and agent tracing, evaluations, experiments; open-source Phoenix; hosting in US, EU or Canada [62] | — | **Public:** Free; $50/mo; Enterprise [62] |
| Cisco AI Defense | CISO | AI bill of materials (AI BOM); MCP server catalog; multi-turn automated red-teaming (from the Robust Intelligence acquisition); runtime agent guardrails; mapped to NIST, OWASP and MITRE, with no EU AI Act mapping mentioned [63][28] | Free Explorer Edition and open-source DefenseClaw (Mar 2026) [64] | Not public |

**Tools on the auditor side:**
- **Optro (formerly AuditBoard)** is folding FairNow's AI registry and risk assessments into its GRC suite [38][39].
- **Fieldguide** automates SOC, ISO and HITRUST engagements for firms such as Baker Tilly. Its own agents are ISO 42001 and AIUC-1 certified, but it has no methodology for testing AI systems [65–67].
- **Vanta** packages EU AI Act and ISO 42001 frameworks [68].
- **QuantPi** became TÜV SÜD's first "CARAT" partner lab (Oct 2026). It says a notified body recognises its test evidence, which comes with statistical confidence bounds [69].
- **Validaitor** markets AI testing to testing, inspection and certification (TIC) firms [70].
- **PwC** launched "Assurance for AI" on 22 Jul 2025 [71].

## 5. Feature matrix

● = native or strong; ◐ = partial, or via a module or partner; ○ = not evident in public materials. The ratings are our judgment from the §4 sources.

| | Inventory | Risk | EU AI Act / ISO 42001 / NIST mapping | Evidence | Testing of predictive models | LLM red-team / guardrails | Monitoring | Reporting / attestation | Vendor AI risk | Workflow for independent auditors |
|---|---|---|---|---|---|---|---|---|---|---|
| Credo AI | ● | ● | ● | ● | ◐ | ◐ | ● | ◐ | ● | ○ |
| Holistic AI | ● | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ○ |
| IBM | ● | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ○ |
| OneTrust | ● | ● | ● | ● | ○ | ◐ | ◐ | ◐ | ● | ○ |
| ServiceNow | ● | ● | ◐ | ◐ | ○ | ◐ | ● | ◐ | ◐ | ○ |
| Monitaur | ● | ● | ◐ | ● | ● | ○ | ● | ◐ | ● | ○ |
| ModelOp | ● | ● | ◐ | ● | ◐ | ○ | ● | ● | ◐ | ○ |
| Trustible | ● | ● | ● | ● | ○ | ○ | ◐ | ● | ● | ○ |
| Saidot | ● | ● | ● | ● | ○ | ○ | ◐ | ● | ◐ | ○ |
| Optro + FairNow | ● | ● | ◐ | ● | ○ | ○ | ○ | ● | ◐ | ◐ internal audit only |
| ValidMind | ● | ● | ◐ | ● | ● | ◐ | ● | ● | ◐ | ◐ internal validation only |
| Asenion | ● | ● | ● | ● | ● | ● | ◐ | ● | ○ | ○ |
| Collibra | ● | ● | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ○ |
| Securiti | ● | ● | ● | ◐ | ○ | ● | ◐ | ◐ | ◐ | ○ |
| Arthur / Fiddler / Arize | ◐ | ○ | ○ | ◐ | ● | ◐–● | ● | ○–◐ | ○ | ○ |
| Cisco AI Defense | ● | ◐ | ◐ | ○ | ◐ | ● | ● | ◐ | ◐ | ○ |
| Fieldguide | ○ | ○ | ◐ | ● | ○ | ○ | ○ | ● | ○ | ● generic, not AI-specific |
| **Our platform today** | ◐ | ● | ◐ AI Act only | ● | ◐ binary classifiers only | ○ | ○ | ● | ○ | ● |

## 6. White space: tools for independent auditors and conformity assessment bodies

**What exists today:**
- **Owner-side platforms** export evidence for auditors. None models auditor independence, sampling, review and sign-off, or issuing an opinion [2][4–6].
- **General engagement tools** (Optro, Fieldguide, Vanta) run SOC and ISO audits but have no AI methodology or technical testing [38][65][68].
- **Technical testing is being accredited separately:** TÜV SÜD partner labs, Singapore's tester accreditation programme, and AIUC-1's split between AIUC's evaluation and the auditor's evidence work [17][26][69].
- **Standard-setters have not defined AI criteria**, so audit firms make up their own [8].

**What nobody serves yet:**
1. **One engagement system across schemes:** ISO/IEC 42001 certification (run under the ISO/IEC 17021-1 and 42006 rules), EN 18286, AI Act internal control and notified-body assessment (Annex VI/VII), AIUC-1, ISAE 3000 or SOC 2 add-ons, and bias audits.
2. **Tests a reviewer or notified body can re-run,** with statistical confidence bounds.
3. **Chain of custody** for evidence pulled from the client's own governance and observability tools.
4. **GenAI and agent test plans built for auditors:** fixed scope, sampling, reproducibility and mapping to criteria.
5. **Tools for running a practice or certification body:** auditor competence records, certificate registers, surveillance cycles and quality review.
6. **Outputs that insurers, procurement teams and regulators can verify.** Truyo's warranty and AIUC-1 show assurance becoming something that can be insured [17][50].

## 7. Confidence and gaps

The web-search budget ran out before these could be confirmed:
- ValidMind's "SR 26-2" reference.
- Profiles of Warden AI and BABL AI.
- A single-source claim that Thoma Bravo bought OneTrust, which I left out.
- Credo AI's feature dates and the date of Fiddler's Lumeus purchase.
- Details of Vanta's auditor portal.
- FairNow's bias audits using synthetic data, which only a competitor claims.
- The exact number of notified bodies designated under the AI Act.

Gartner and Forrester placements come from vendor announcements, not the paywalled reports. Modulos, which wrote the buyer's guide cited as [28], is itself a competitor.

## 8. Implications for our platform

**Positioning:** "The independent assessor's workspace for AI." One engagement runs from client acceptance to signed opinion across the EU AI Act, EN 18286, ISO/IEC 42001 and AIUC-1.
- **Partner, don't compete.** We accept evidence from whatever governance platform the client already runs (Credo AI, IBM, OneTrust, ServiceNow, Saidot) and integrate with those vendors rather than fight them.
- **Lead with what is live now.** After the Omnibus delays, ISO 42001, AIUC-1 and EN 18286 are better hooks than AI Act deadlines.
- **Price per practitioner or per engagement.** Owner platforms run from about $50k to several hundred thousand dollars a year [28], and IBM starts at $3,500/month [51]. Mid-tier audit firms and certification bodies need something lighter.

**P0 (do now)**
1. **Update for the AI Omnibus and stamp legal versions.** Update the dates, Art. 5 additions, Art. 50(2) grace period, small mid-cap rules and registration content. Stamp every working paper and report snapshot with the version of the law and standards it assessed. *Why:* Reg. 2026/1744 changed the core dates [9], and an audit tool built on outdated law is unusable.
2. **Make the methodology data-driven and multi-scheme.** Replace the fixed 33 papers with a model of frameworks, requirements and cross-mappings. Ship three audit programmes:
   - an EN 18286 QMS audit;
   - an ISO/IEC 42001 certification audit, covering Stage 1/2, surveillance and nonconformity grading;
   - an AIUC-1 evidence programme.

   *Why:* EN 18286 is the only harmonised AI Act standard [12], and accredited ISO 42001 certifiers and AIUC-1 auditors already exist [16][17]. Competitors already sell large cross-mappings: Saidot covers 110+ policies and Modulos 26 frameworks [5][28].
3. **Add an engagement-quality layer.** This covers:
   - independence and conflict declarations;
   - client acceptance and continuance;
   - engagement letter and scope;
   - sampling plans;
   - an engagement-quality review gate before the report snapshot.

   *Why:* this is the clearest gap versus owner tools, and it is what auditors currently improvise [8].
4. **Make the testing lab produce audit-grade evidence.** Add bootstrap confidence intervals, warnings when samples are too small, intersectional groups, and multiclass and regression models. Package each run as a hashed "re-performance pack" (data, configuration and engine version) that a reviewer can re-run. *Why:* certification bodies and notified bodies accept test results only if they are statistically valid [69].

**P1 (next)**

5. **GenAI and agent testing through our external worker protocol.** Build adapters for open-source test harnesses covering the risk categories in Singapore's IMDA testing Starter Kit: hallucination, bias, undesirable content, data leakage and adversarial prompts. Map results into working papers and support quarterly re-tests. *Why:* AIUC-1 requires recurring adversarial testing [17]. Stay vendor-neutral, since OpenAI now owns Promptfoo [41].
6. **Evidence connectors.** Import exports from governance platforms and OpenTelemetry traces, hash them on arrival, and let clients answer evidence requests via API. Consider NIST's OSCAL format for control catalogues and assessment results. *Why:* clients already own these tools, and vendors now market observability data as audit evidence [7].
7. **Security baseline that audit firms expect.**
   - Single sign-on (OIDC/SAML), MFA and automated user provisioning (SCIM).
   - Malware scanning on uploads.
   - Trusted third-party timestamps (RFC 3161) on snapshots and dossiers.
   - Data hosting in the EU.
   - A roadmap to SOC 2, ISO 27001 and ISO 42001 for the platform itself.

   *Why:* Fieldguide wins audit firms on exactly these credentials [65][66].
8. **Report library.** Templates for ISAE 3000 limited and reasonable assurance, an ISO 42001 audit report, an AIUC-1 evidence report and bias-audit summaries. Add a public page where anyone can check a signed report's hash. *Why:* buyers and insurers increasingly use these reports in procurement and underwriting [17][50].

**P2 (later)**

9. **Continuous assurance.** Scheduled re-tests, papers that reopen automatically when monitoring flags a change, and reports showing what changed. *Why:* ServiceNow markets "replacing periodic audits" [53].
10. **Practice and certification-body operations.** Auditor competence records mapped to ISO/IEC 42006 and the UK skills framework, a certificate register, a surveillance calendar, analytics across clients, and a read-only view for regulators. *Why:* the UK and Singapore professionalisation programmes [24][26] and the NAIC pilot [22].
11. **Go-to-market.** Target ISO 42001 certifiers, AIUC-1 auditors, mid-tier audit firms and testing labs. The Big Four are building their own offerings [71]. Pursue import integrations and joint marketing with owner-side platforms.

**Do not build:** AI discovery, runtime guardrails, LLM firewalls, MCP gateways or observability. These areas are being absorbed by Cisco, Palo Alto, CrowdStrike and ServiceNow [7][35][53][63].

## Sources
1. https://onetrust.com/resources/gartner-magic-quadrant-for-ai-governance-platforms-2026-report/
2. https://www.credo.ai/product
3. https://www.holisticai.com/
4. https://trustible.ai/
5. https://www.saidot.ai/
6. https://www.monitaur.ai/
7. https://www.crowdstrike.com/en-us/press-releases/crowdstrike-to-acquire-fiddler-to-deliver-agent-observability/
8. https://labs.cloudsecurityalliance.org/research/csa-research-note-soc2-ai-controls-gap-20260830-csa-styled/
9. https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes
10. https://www.addleshawgoddard.com/en/insights/insights-briefings/2026/technology/eu-ai-act-ai-omnibus-formally-adopted/
11. https://ai-resources.eu/atti-normativi/ue/digital-omnibus-ai/
12. https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/
13. https://digital.nemko.com/news/en-18286-eu-ai-act-cites-new-harmonized-qms-standard
14. https://www.deepinspect.ai/blog/eu-ai-act-conformity-assessment-bodies-list
15. https://www.iso.org/standard/42006
16. https://brightdefense.com/news/iso-42006-raises-the-bar-for-iso-42001-certifiers
17. https://www.schellman.com/blog/news/schellman-becomes-the-first-accredited-auditor-for-aiuc-1
18. https://www.uipath.com/newsroom/uipath-achieves-aiuc-1-certification
19. https://www.unite.ai/sierra-earns-aiuc-1-certification-after-independent-audit/
20. https://www.arthur.ai/column/soc-2-ai-agents-aicpa-tqa-9561
21. https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/
22. https://mail.monitaur.ai/monitaur-ai-governance-news-april-2026
23. https://www.icaew.com/insights/viewpoints-on-the-news/2025/sep-2025/trusted-ai-assurance-roadmap-outlines-three-quality-assurance-models
24. https://www.techuk.org/insights/news/dsit-s-ai-assurance-roadmap-takes-its-next-step-techuk-to-lead-the-industry-advisory-group-of-ai-assurance-consortium
25. https://aiverifyfoundation.sg/ai-assurance/
26. https://aiverifyfoundation.sg/news/
27. https://www.holisticai.com/blog/holistic-ai-named-a-challenger-in-gartner-magic-quadrant
28. https://www.modulos.ai/best-ai-governance-platforms/ (competitor-authored, Oct 2026)
29. https://www.forrester.com/report/the-forrester-wave-tm-ai-governance-solutions-q3-2025/RES184849
30. https://www.businesswire.com/news/home/20250825500906/en/Credo-AI-Named-a-Leader-in-2025-AI-Governance-Solutions-Report
31. https://www.ibm.com/forms/mkt-53939
32. https://www.collibra.com/resources/collibra-strong-performer-forrester-wave-ai-governance-platforms-q3-2025
33. https://www.fiddler.ai/
34. https://benhamouglobalventures.com/fairly-ai-acquires-anch-ai/
35. https://www.infosecurity-magazine.com/news-features/cybersecurity-ma-crowdstrike
36. https://siliconangle.com/2025/09/16/crowdstrike-check-point-extend-ai-security-capabilities-new-acquisitions/
37. https://dev.to/luckypipewrench/the-ai-agent-security-acquisition-wave-what-it-means-for-buyers-1e73 (secondary)
38. https://www.cpapracticeadvisor.com/2025/10/22/auditboard-acquires-ai-governance-platform-fairnow/171508/
39. https://optro.ai/blog/meet-optro-auditboard-unveils-new-identity-as-ai-transforms-grc
40. https://securitybrief.co.uk/story/veeam-completes-usd-1-725b-ai-security-takeover
41. https://promptfoo.dev/blog/promptfoo-joining-openai
42. https://theregister.com/2026/05/05/servicenow_clears_agents_for_landing/
43. https://securitybrief.co.uk/story/servicenow-completes-usd-7-75-billion-armis-acquisition
44. https://www.pulse.bot/ma/news/fiddler-ai-acquires-lumeusai-to-boost-ai-security-and-governance-37511936-c7d3-4bf3-8a85-1f289aa18fc2/
45. https://www.harvey.ai/blog/guardrails-ai-joins-harvey
46. https://idm.net.au/node/15507
47. https://www.arlingtoneconomicdevelopment.com/News-Resources/Blog/Arlington-Startup-Trustible-Raises-4.6-Million-to-Lead-in-AI-Governance
48. https://beinsure.com/news/tokio-marine-selects-monitaur-for-ai-governance/
49. https://www.modelop.com/authors/dave-trier
50. https://truyo.com/news/truyo-introduces-truyo-trust-offering-up-to-1-million-in-protection-for-qualified-ai-governance-customers/
51. https://www.ibm.com/products/watsonx-governance/pricing
52. https://uk.newsroom.ibm.com/IBM-introduces-industry-first-software-to-unify-agentic-governance-and-security
53. https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-expands-AI-Control-Tower-to-discover-observe-govern-secure-and-measure-AI-deployed-across-any-system-in-the-enterprise/default.aspx
54. https://www.collibra.com/company/newsroom/press-releases/collibra-launches-ai-command-center-to-scale-agentic-ai
55. https://securiti.ai/ai-governance/
56. https://validmind.com/
57. https://venturebeat.com/ai/ai-risk-management-startup-validmind-raises-8-1m-to-help-banks-comply-with-regulations
58. https://aws.amazon.com/marketplace/pp/prodview-gade7kxgpbtb6
59. https://arthur.ai/blog/2025-recap
60. https://www.arthur.ai/pricing
61. https://docs.arthur.ai/changelog?page=1
62. https://arize.com/pricing/
63. https://investor.cisco.com/news/news-details/2026/Cisco-Redefines-Security-for-the-Agentic-Era-with-AI-Defense-Expansion-and-AI-Aware-SASE/default.aspx
64. https://investor.cisco.com/news/news-details/2026/Cisco-Reimagines-Security-for-the-Agentic-Workforce/default.aspx
65. https://www.globenewswire.com/news-release/2026/05/06/3288862/0/en/Fieldguide-Becomes-First-AI-Platform-for-Audit-and-Advisory-to-Achieve-AIUC-1-Certification.html
66. https://www.globenewswire.com/news-release/2025/09/24/3155523/0/en/Fieldguide-Among-World-s-First-with-ISO-42001-Certification-Setting-the-Bar-for-Responsible-AI-in-Audit-Advisory.html
67. https://www.streetinsider.com/Business+Wire/Baker+Tilly+Advances+AI-Enabled+Assurance+and+Advisory+Delivery+with+Fieldguide/26555043.html
68. https://www.vanta.com/products/eu-ai-act
69. https://www.tuvsud.com/ko-kr/press-and-media/2026/october/tuv-sud-and-quantpi-are-joining-forces---to-ensure-ai-safety
70. https://www.validaitor.com/tic-partnership
71. https://www.pwc.co.uk/press-room/press-releases/corporate-news/pwc-uk-to-provide-assurance-for-ai-systems-.html
