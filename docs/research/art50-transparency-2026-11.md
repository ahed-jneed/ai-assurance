# Article 50 transparency obligations: what an auditor tests, November 2026

Issue [#59](https://github.com/ahed-jneed/ai-assurance/issues/59). Researched 5 November 2026. It feeds classification v2 ([#19](https://github.com/ahed-jneed/ai-assurance/issues/19)), rule pack 2026.11.1 and the methodology text ([#18](https://github.com/ahed-jneed/ai-assurance/issues/18)), the criteria model and catalogue ([#27](https://github.com/ahed-jneed/ai-assurance/issues/27)) and the GenAI evidence design ([#31](https://github.com/ahed-jneed/ai-assurance/issues/31)). The machine-readable companion is [`art50-transparency-2026-11.json`](art50-transparency-2026-11.json), described in [section 14](#14-json-schema). The legal timeline is the one verified in [`rule-pack-2026-11.json`](rule-pack-2026-11.json) (#8).

> **Status: research, not legal advice.** No qualified lawyer has reviewed this file (decision D-02; owner action #57). Items marked **Legal review** must not be shown in the platform as settled law. The authentic Official Journal (OJ) texts govern. The Commission's guidelines are non-binding, and the Code of Practice is voluntary. Standards and specifications are cited by number and clause number with our own titles only (decision D-03). Legal and guidance texts are paraphrased. The audit procedures are a draft for methodology review.

## 1. Key conclusions

1. **The Commission's Art 50 guidelines are now formally adopted.**
   - The Commission approved their content on 20 July 2026 (Communication to the Commission C(2026) 5054 final). It formally adopted them on 5 November 2026 as Communication C(2026) 7702 final. The Commission page lists 23 language versions; no Romanian version was listed today.
   - A word-level comparison of the two English texts found only layout changes, moved footnotes, two corrected cross-references and two punctuation fixes.
   - The July communication said the guidelines would apply only from formal adoption. They are non-binding (point 5).
   - #8 recorded only that they exist (UV-07). This research reads them in full and cites them by point number.
2. **The Code of Practice is final and assessed as adequate, but only for Art 50(2), (4) and (5).**
   - The final Code of Practice on Transparency of AI-Generated Content was published on 10 June 2026.
   - Commission Opinion C(2026) 4839 final of 8 July 2026 (published 9 July) found it adequate for those three paragraphs, and so did the AI Board's assessment of 9 July 2026.
   - No code covers Art 50(1) or (3).
   - Adherence is not conclusive evidence of compliance. Codes under Art 50(7) give no presumption of conformity (recital (41) of Regulation (EU) 2026/1744).
   - The Commission's list shows 95 Section 1 (provider) and 192 Section 2 (deployer) signatories (last updated 24 September 2026).
3. **The timeline matches the rule pack. One disagreement lies within the guidance itself.**
   - Art 50 applies from 2 August 2026 to every in-scope system, whatever its placing date.
   - Art 111(4) gives only Art 50(2) a transition, to 2 December 2026, for systems "placed on the market" before 2 August 2026. That is the OJ wording, re-read today, and recital (38) and the Commission's own Q&A agree.
   - The guidelines (point 153) add systems "put into service" before that date.
   - The rule pack follows the OJ and should keep doing so. #19 should also record the putting-into-service date, so that a lawyer's answer can be applied when it comes (CC-03, LR-A50-01).
4. **Two further Commission positions bear on the rule pack.**
   - The Art 111(2) grandfathering of legacy high-risk systems does not defer Art 50 (footnote 50). This bears on LR-03 (LR-A50-10).
   - Outputs generated before 2 August 2026 need no retroactive marking or labelling, but older texts published on or after that date must be labelled (point 154).
5. **Who is obliged.**
   - **Providers (Art 50(1) and (2)).** This includes providers of general-purpose AI systems, of open-source systems and of systems put into service in-house, and third-country providers whose outputs are used in the Union.
   - **Deployers (Art 50(3) and (4)).** The duties cover professional use only. A company that deploys a system is the deployer, not its employees. Platforms and broadcasters that only pass content on are not deployers.
   - One organisation can hold both roles.
6. **Marking means marks plus a way to detect them.** Marking without means of detection does not comply (point 70). The Code's mandatory measures are:
   - two machine-readable layers, digitally signed metadata and an imperceptible watermark, for audio, image, video and containerised text, while no single technique suffices;
   - a watermark only for free-form text, which is exempt below 200 tokens;
   - fingerprinting or logging only as a supplement, never on its own;
   - a free detection solution for every marking technique, with signed, downloadable results;
   - open metadata standards from the start, and an interoperability solution for watermark detection by 2 February 2027.
7. **Exceptions and carve-outs.**
   - **In the Act:**
     - standard editing, non-substantial alteration and law enforcement (Art 50(2));
     - obviousness, and law enforcement unless the system is available to the public to report crime (Art 50(1));
     - human review with editorial responsibility, for text (Art 50(4)).
   - **In the guidelines only:**
     - out-of-scope outputs such as code and short strings;
     - a single metadata layer for closed physical products;
     - no marking for certain industrial and business-to-business uses;
     - real-time ephemeral content.

     These carry a legal-review flag (LR-A50-03).
8. **Deep fakes and published text need labels people can see or hear without tools.**
   - Machine-readable marks never satisfy Art 50(4) (point 117).
   - For signatories, the Code fixes an "AI" icon design and its placement. The three EU icons are optional.
   - The text exception needs substantive human review, including fact-checking, and a publicly identified person with editorial responsibility. Any substantive AI change after sign-off voids it (points 134 to 138).
9. **Art 50(5) sets when and how people are told.**
   - Interactions: at least once at the start of every session, for each person.
   - Content: for every output and every person exposed to it.
   - Accessibility: the existing EU accessibility acts. Art 50 adds no requirement of its own (point 144).
10. **What an auditor can test.** Section 8 gives 12 draft procedures with 82 steps, each with its source, and 39 evidence items:
    - **Art 50(1):** channel walkthroughs and self-identification probes.
    - **Art 50(2):** output sampling with metadata validation and detection; detector access; reliability, robustness and interoperability tests; non-removal; the provider's testing process.
    - **Art 50(3):** site and channel observation.
    - **Art 50(4):** population completeness (screening unflagged content with the providers' detectors), re-classification of deep fakes, and labels as actually distributed.
    - **Art 50(5):** clarity, timing and accessibility.

    Judgement remains for obviousness, deep-fake qualification and editorial adequacy.
11. **Sample sizes follow the statistics design of #9 (PR #46).**
    - With no deviation, 73 items per stratum show a rate of at least 0.95 at the default confidence level. A band of 0.98 needs 189 items and 0.99 needs 381. More are needed when several confirmatory criteria form a family.
    - The bands are internal methodology policy with no legal safe harbour.
    - Every observed deviation is also evaluated on its own.
12. **Standards.**
    - No harmonised standard supports Art 50, and the CEN/CLC JTC 21 work programme read today has no work item on marking, detection or labelling.
    - The relevant specifications are:
      - the C2PA Technical Specification 2.5 (October 2026);
      - the IPTC digital source type vocabulary;
      - ISO/IEC 21617-1:2026 (JPEG Trust; Part 3 on watermarking is in development);
      - IEEE 3152-2024 on identifying human and machine agency;
      - EN 301 549 and WCAG 2.1 Level AA for accessibility, which the Code names.
13. **Concrete edits and open questions.**
    - Section 11 lists 25 edits: 7 for #19, 6 for #18, 6 for the catalogue, 5 for #31 and 1 for the statistics design.
    - 14 questions need qualified legal review (section 12), and 4 claims are unverified (section 13).

## 2. How facts were verified

| Marker | Meaning |
|---|---|
| **Verified** | Read on the date given in a primary source: OJ text or a Publications Office file, an official Commission or AI Board document or page, a standards or specification body's own page, or this repository. |
| **Secondary-only** | Taken only from secondary sources. The platform must not present it as fact. |
| **Legal review** | The fact is verified, but how it applies is an interpretation that needs qualified legal review. |

**Access notes**
- **OJ texts.** EUR-Lex refuses automated clients, so the OJ texts were read from the Publications Office (CELLAR), as #8 did. The SHA-256 of the consolidated text, the AI Act and Regulation (EU) 2026/1744 match the values in `rule-pack-2026-11.json`, so none of the three has changed since #8.
- **Commission documents.** The guidelines, the Commission opinion, the AI Board assessment and the Code are PDFs served from the Commission's newsroom. Their text was extracted with `pdftotext`, and their SHA-256 values are in the register.
- **The July approval.** The July version of the guidelines and the communication approving them were no longer listed on the Commission page today. They were read from Internet Archive captures of the Commission's own download URLs, which is the only route to that version. The adopted text was then compared with it word by word.
- **Browser reads.** ISO, IEEE and CEN pages refuse automated fetches, so they were read in a browser. The CEN/CLC JTC 21 work programme was read in full.
- **Studies.** The three Commission-procured studies on marking techniques come from CELLAR. They give their authors' views and are used only for state-of-the-art context.

**Source register** (all accessed 5 November 2026)

| ID | Source | URL | Retrieved via / notes |
|---|---|---|---|
| SRC-OJ-2024-1689 | Regulation (EU) 2024/1689 (AI Act), original English OJ text. Publications Office of the EU (Official Journal); `official_journal` | <http://data.europa.eu/eli/reg/2024/1689/oj> (accessed: <https://publications.europa.eu/resource/celex/32024R1689>) | HTTP GET with Accept: application/xhtml+xml and Accept-Language: eng (CELLAR); EUR-Lex refuses automated clients. Recitals (132) to (137) and the original Art 50(7). Same bytes as SRC-OJ-2024-1689 in rule-pack-2026-11.json. SHA-256 `8f0b656302f9864cc87e040c371f209a9d65ae1a6cecc25ca5eb737e872d721a`. |
| SRC-OJ-2026-1744 | Regulation (EU) 2026/1744 (Digital Omnibus on AI), English OJ text. Publications Office of the EU (Official Journal); `official_journal` | <http://data.europa.eu/eli/reg/2026/1744/oj> (accessed: <https://publications.europa.eu/resource/celex/32026R1744>) | HTTP GET with Accept: application/xhtml+xml and Accept-Language: eng (CELLAR). Art 1, points (20) (Art 50(7) replaced) and (39)(b) (Art 111(4) added); recitals (38) and (41). Same bytes as in rule-pack-2026-11.json. SHA-256 `9d754652b867722807e4219c85912ce354233e58a1b4eb8c7752b4d1922993db`. |
| SRC-CONS-2024-1689-20260727 | Consolidated text 02024R1689-20260727 (documentation tool, no legal effect). Publications Office of the EU; `consolidated_text` | <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727> (accessed: <https://publications.europa.eu/resource/celex/02024R1689-20260727>) | HTTP GET with Accept: application/xhtml+xml and Accept-Language: eng (CELLAR). Art 2(6), (8), (10), (12); Art 3(3), (4), (9), (11), (39), (40), (60), (66); Art 50(1) to (7); Art 75(1); Art 96(1)(d); Art 99(4)(g), (6); Art 100(3); Art 111(4). Same bytes as in rule-pack-2026-11.json, so the consolidation has not changed. SHA-256 `5e7719f77e8a606b257dc25958ee3222c4383300a5a34270a5b850a2ce8b8715`. |
| SRC-EC-A50-GUIDELINES | Commission Guidelines on the implementation of the transparency obligations for certain AI systems under Article 50 AI Act, C(2026) 7702 final, 5.11.2026 (English). European Commission; `commission` | <https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems> (accessed: <https://ec.europa.eu/newsroom/dae/redirection/document/131215>) | HTTP GET; PDF served as attachment (file name ends _131215.pdf); text extracted with pdftotext. Communication from the Commission. Points (1) to (155) and footnotes read in full. Point (5): non-binding. Cited below by point number. SHA-256 `9198d83876dcdffadce77078a468a426cb2fb9859aefcb6080aee6f9fe089bf3`. |
| SRC-EC-A50-GUIDELINES-PAGE | Commission library page: Guidelines on transparency obligations for providers and deployers of AI systems. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems> | Publication 20 July 2026; last update 5 November 2026; lists the adopted guidelines in 23 language versions (no Romanian version was listed on 2026-11-05). The approval communication of July is no longer listed. |
| SRC-EC-A50-APPROVAL-2026-07 | Communication to the Commission C(2026) 5054 final of 20.7.2026: approval of the content of the draft guidelines, with the guidelines as Annex. European Commission; `web_archive` | <https://web.archive.org/web/20260722191113id_/https://ec.europa.eu/newsroom/dae/redirection/document/131214> | Internet Archive captures of the Commission's own download URLs: document 131214 (communication, captured 2026-07-22) and document 131215 (Annex, captured 2026-07-20, https://web.archive.org/web/20260720143346id_/https://ec.europa.eu/newsroom/dae/redirection/document/131215); gzip-decoded PDFs. sha256 is of the communication PDF; the Annex PDF hashes to 30861fc5de31205846f023068069c92fabc7271ebeac6af7bef68b97f0a33f66. The communication says the guidelines would be formally adopted once all language versions exist and would apply only from then. A word-level diff of the Annex against C(2026) 7702 final found layout, footnote-placement and two cross-reference corrections only. SHA-256 `ea1a6d960a52d8532a068b8338622d1868616ce6b5bf2540dfef7a2378eb7c8c`. |
| SRC-WAYBACK-A50-GUIDELINES-PAGE | Internet Archive capture of the guidelines library page, 20 July 2026. Internet Archive; `web_archive` | <https://web.archive.org/web/20260720143259/https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems> | Shows publication 20 July 2026 with two downloads (guidelines; communication approving their content) and the press release of 20 July 2026. |
| SRC-EC-A50-CONSULTATION | Commission consultation on the draft guidelines on transparency obligations under the AI Act. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/consultations/consultation-draft-guidelines-transparency-obligations-under-ai-act> | Opening 8 May 2026, closing 3 June 2026; last update 3 June 2026. |
| SRC-EC-A50-FAQ | Commission Q&A: Transparency obligations under Article 50 of the AI Act. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act> | Last update 24 July 2026. Describes the grace period as covering systems placed on the market before 2 August 2026 (no mention of putting into service). Contains two slips (it calls the interaction duty Art 50(2) and the deep-fake test three criteria), so the guidelines are cited instead wherever they speak. |
| SRC-EC-COP-TEXT | Code of Practice on Transparency of AI-Generated Content (final, Sections 1 and 2 with Glossary and Annex 1). European Commission (AI Office); drawn up by independent chairs; `commission` | <https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content> (accessed: <https://ec.europa.eu/newsroom/dae/redirection/document/129555>) | HTTP GET; PDF (38 pages) served as attachment; text extracted with pdftotext. Cited by Section, Commitment and Measure number. 'will' marks mandatory measures, 'encouraged' and 'may' optional ones (Section 1 and Section 2 introductions). SHA-256 `7bd22c5a3c56eaefda27a5bf7a6118198ef2a9c9255241bd97abf7cdedf9bc28`. |
| SRC-EC-COP-PAGE | Commission policy page: Code of Practice on Transparency of AI-generated Content. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content> | Last update 19 October 2026. Timeline: kick-off 5 Nov 2025; first draft 17 Dec 2025; second draft 3 Mar 2026; draft guidelines 8 May 2026; final code 10 Jun 2026. About 190 signatories by end of July 2026. |
| SRC-EC-COP-OPINION | Commission Opinion C(2026) 4839 final of 8.7.2026 on the assessment of the Code of Practice on Transparency of AI-generated content (Arts 50(7) and 56(6)). European Commission; `commission` | <https://digital-strategy.ec.europa.eu/en/library/commission-opinion-assessment-code-practice-transparency-ai-generated-content> (accessed: <https://ec.europa.eu/newsroom/dae/redirection/document/130913>) | HTTP GET; PDF; text extracted with pdftotext. Cited by paragraph number. Paragraph (52): adequate for Art 50(2), (4) and (5); adherence is not conclusive evidence of compliance. SHA-256 `e9b85373cde28a6081fab307fa17fa4c90c2560a1c9a145fb461f696bca424ce`. |
| SRC-EC-COP-OPINION-PAGE | Commission library page for the opinion and the AI Board assessment. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/library/commission-opinion-assessment-code-practice-transparency-ai-generated-content> | Publication 9 July 2026; last update 31 July 2026. States the Commission concluded on 8 July and the AI Board adopted its assessment the following day. |
| SRC-AIB-COP-ASSESSMENT | Conclusion of the AI Board on the assessment of the Code of Practice on Transparency of AI-generated Content (Art 50(7)). European Artificial Intelligence Board; `ai_board` | <https://ec.europa.eu/newsroom/dae/redirection/document/130916> | HTTP GET; PDF (7 pages); text extracted with pdftotext. Undated in the document; dated 9 July 2026 by SRC-EC-COP-OPINION-PAGE. Notes that the Art 50 guidelines were still a draft at the time. Will examine the interoperability solutions due by 2 February 2027. SHA-256 `a01d832e0d4b10ebb66d27d0e8cf621aabb18aa56e5c24d39d6b4000a9adfcd2`. |
| SRC-EC-COP-SIGNATORIES | Commission news: Strong backing for the Code of Practice on Transparency of AI-generated Content (with the list of signatories). European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/news/strong-backing-code-practice-transparency-ai-generated-content> | Publication 31 July 2026; last update 24 September 2026; Section 1 signatories: 95, Section 2 signatories: 192; list updated on an ongoing basis. |
| SRC-EC-EU-ICONS | Commission page: EU icons for labelling AI-generated content. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content> | Last update 13 October 2026. Use of the icons is optional; using them does not by itself establish compliance. |
| SRC-EC-MARKING-STUDIES | Commission library page: three studies on technical solutions to mark and detect AI-generated content. European Commission (DG CONNECT); `commission` | <https://digital-strategy.ec.europa.eu/en/library/three-studies-technical-solutions-mark-and-detect-ai-generated-content> | Publication 8 May 2026; last update 11 June 2026. Studies procured to support the Code; they state their authors' views. |
| SRC-STUDY-AUDIO | Technical Solutions for Marking and Detecting AI-generated Audio in the Context of Article 50 of the AI Act (Serra et al.). Publications Office of the EU (study for the Commission); `commission_study` | <https://publications.europa.eu/resource/cellar/4f7b8585-4829-11f1-8095-01aa75ed71a1> | HTTP GET with Accept: application/pdf (CELLAR). State-of-the-art context only. SHA-256 `6fe1761bd0b511f25fc8eed37b6db8986b5c48808893de6f150ad7aaadcfaf30`. |
| SRC-STUDY-IMAGE-VIDEO | Study on EU AI Act Article 50: Technical solutions for marking AI-generated image and video content (Fritz). Publications Office of the EU (study for the Commission); `commission_study` | <https://publications.europa.eu/resource/cellar/8a256a7e-482a-11f1-8095-01aa75ed71a1> | HTTP GET with Accept: application/pdf (CELLAR). State-of-the-art context only: C2PA content credentials, IPTC digital source type, JPEG Trust and watermark robustness limits. SHA-256 `9777ecd69077b5df96fb7426506156157555adf39b9e79b6a40c73b36d7c1c58`. |
| SRC-STUDY-TEXT | Technical solutions for marking and detecting AI generated text content in the context of Article 50(2) AI Act (Puccetti). Publications Office of the EU (study for the Commission); `commission_study` | <https://publications.europa.eu/resource/cellar/6c981119-4829-11f1-8095-01aa75ed71a1> | HTTP GET with Accept: application/pdf (CELLAR). State-of-the-art context only. SHA-256 `3b2d6146e506200031e691a8124f4600c86fbe3804d76b63c70baca5a6cfa6fb`. |
| SRC-C2PA-SPEC-2-5 | Content Credentials: C2PA Technical Specification, version 2.5. Coalition for Content Provenance and Authenticity (C2PA); `specification_body` | <https://spec.c2pa.org/specifications/specifications/2.5/specs/C2PA_Specification.html> | Version history F.1 dates 2.5 to October 2026. Clauses used by number only: 12.2, 13.3, 13.4, 14.1, 16.3.7, 16.4.1. |
| SRC-C2PA-SPEC-INDEX-2-5 | C2PA specifications index, version 2.5. Coalition for Content Provenance and Authenticity (C2PA); `specification_body` | <https://spec.c2pa.org/specifications/specifications/2.5/index.html> | Lists the technical specification 2.5 and companion documents (soft binding API, guidance for AI and ML, implementer guidance). |
| SRC-IPTC-DST | IPTC NewsCodes: Digital Source Type vocabulary. International Press Telecommunications Council (IPTC); `specification_body` | <https://cv.iptc.org/newscodes/digitalsourcetype/> | Terms trainedAlgorithmicMedia, compositeWithTrainedAlgorithmicMedia and compositeSynthetic, among others. |
| SRC-ISO-21617-1-2026 | ISO catalogue page: ISO/IEC 21617-1:2026, JPEG Trust, Part 1: Core foundation. ISO; `standards_body` | <https://www.iso.org/standard/91405.html> | Browser (automated fetch: HTTP 403). Published, edition 2, 2026-08, stage 60.60, ISO/IEC JTC 1/SC 29. Replaces ISO/IEC 21617-1:2025 (withdrawn). |
| SRC-JPEG-TRUST | JPEG Trust overview page. JPEG (ISO/IEC JTC 1/SC 29/WG 1); `standards_body` | <https://jpeg.org/jpegtrust/index.html> | Part 3 (media asset watermarking) and Parts 2 and 4 under development. The page still calls the Part 1 second edition under development, so it lags the ISO catalogue. |
| SRC-IEEE-3152-2024 | IEEE SA page: IEEE 3152-2024, Standard for Transparent Human and Machine Agency Identification. IEEE Standards Association; `standards_body` | <https://standards.ieee.org/ieee/3152/11718/> | Browser (automated fetch blocked by a web application firewall). Active standard; Board approval 2024-12-11; published 2025-05-09. |
| SRC-CEN-JTC21-WORKPROGRAMME | CEN/CLC/JTC 21 work programme. CEN-CENELEC; `standards_body` | <https://standards.cencenelec.eu/dyn/www/f?p=205:22:0::::FSP_ORG_ID,FSP_LANG_ID:2916257,25> (accessed: <https://standards.cencenelec.eu/ords/f?p=CEN:6>) | Browser: CEN technical bodies list, then CEN/CLC/JTC 21, then Work programme (the direct URL returned an internal server error). Read in full on 5 November 2026. No work item addresses Art 50 marking, detection or labelling by title. |
| SEC-CAI-TRUST-LISTS | Content Authenticity Initiative open-source documentation: trust lists (secondary). Adobe (Content Authenticity Initiative); `secondary` | <https://opensource.contentauthenticity.org/docs/conformance/trust-lists> | States that the C2PA interim trust list was frozen on 1 January 2026 and replaced by the official C2PA trust list. Not a C2PA publication; cited only by UV-A50-01. |
| REPO-RULE-PACK-2026-11 | Rule pack research of #8: docs/research/rule-pack-2026-11.json and .md. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/docs/research/rule-pack-2026-11.json> | main@582657f. The timeline of this research is based on it. |
| REPO-STATISTICS-DESIGN | Audit-grade statistics design: docs/design/audit-statistics.md (PR #46, proposed design 1.0.0, not merged). This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/pull/46> | Read at head a0dfdde of design/audit-statistics. Sections 4 (decision rule), 5.1 (Wilson), 6 (multiplicity), 7 (minimums), 8 (power) and 10 (threshold library). |
| REPO-GENAI-DESIGN | GenAI evidence design: docs/design/genai-evidence.md (PR #49 for #31, not merged). This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/pull/49> | Read at head e872fc0 of design/genai-evidence. Sections 2 (non-goals: C2PA or watermark validation is R6.5), 4 (evidence levels), 9.2 (categories) and 12.4 (WP-GA-07). |
| REPO-CRITERIA-DESIGN | Criteria model design: docs/design/criteria-model.md (PR #45 for #26, not merged). This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/pull/45> | Read at head a22aad5 of design/criteria-model. Working papers have at most 30 steps (section 14). |
| REPO-CATALOG | Methodology catalogue templates/catalog.json. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/templates/catalog.json> | WP-PL-03, WP-PL-06, WP-XC-07 and MEM-CL-01; regulatorySnapshot. |
| REPO-METHODOLOGY | Methodology text docs/audit-methodology.md. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/docs/audit-methodology.md> | Scope sentence (paragraph 1), regulatory snapshot (paragraph 2), classification section. |
| REPO-OBLIGATION-SUBITEMS | Obligation sub-items docs/obligation-subitems.json. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/docs/obligation-subitems.json> | factTypes, triggerProfiles and items; no Art 50 item exists. |
| REPO-CLASSIFICATION | Classification model site-app/lib/domain/classification.ts. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/site-app/lib/domain/classification.ts> | Classification has a single boolean transparency field; classify() labels 'Specific transparency' from it. |
| REPO-CLASSIFICATION-UI | Classification modal and regulatory-mapping view: site-app/app/workspace/modals/classification.tsx and site-app/app/workspace/views/regulatory-mapping.tsx. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/site-app/app/workspace/modals/classification.tsx> | One checkbox for Art 50; the panel shows 'Flagged separately' or 'Not flagged'. |
| REPO-ISSUE-18-DECISIONS | Orchestrator decisions recorded on issue #18 after #8 (including decision RD-49 on generative systems). This repository (issue tracker); `repository` | <https://github.com/ahed-jneed/ai-assurance/issues/18#issuecomment-6666623902> | Generative systems are in scope for classification, Art 5 and Art 50 from rule pack 2026.11; evaluation evidence arrives with M2 (#31 to #33). |
| REPO-PROCEDURES | Procedure commands site-app/lib/workflow/procedures.ts. This repository; `repository` | <https://github.com/ahed-jneed/ai-assurance/blob/582657f/site-app/lib/workflow/procedures.ts> | evaluateProcedure accepts the outcomes supported, qualified and not_supported. |

## 3. Status of the guidance on 5 November 2026

| ID | Item | Reference | Status | Dates | Legal effect | Sources | Marker |
|---|---|---|---|---|---|---|---|
| GUID-A50-GUIDELINES | Commission Guidelines on the implementation of the transparency obligations for certain AI systems under Article 50 AI Act | C(2026) 7702 final | adopted | 2026-05-08: Draft published for targeted consultation; 2026-06-03: Consultation closed; 2026-07-20: Content approved by Communication to the Commission C(2026) 5054 final and published (English); 2026-11-05: Formally adopted as Communication from the Commission C(2026) 7702 final; 23 language versions listed (no Romanian version listed) | Non-binding (point 5); only the CJEU gives an authoritative interpretation. The Commission will review them as experience grows (point 155). | SRC-EC-A50-GUIDELINES, SRC-EC-A50-GUIDELINES-PAGE, SRC-EC-A50-APPROVAL-2026-07, SRC-WAYBACK-A50-GUIDELINES-PAGE, SRC-EC-A50-CONSULTATION | Verified 2026-11-05 |
| GUID-A50-COP | Code of Practice on Transparency of AI-Generated Content | Final code, 10 June 2026 | published | 2025-11-05: Kick-off plenary; 2025-12-17: First draft published; 2026-03-03: Second draft published; 2026-06-10: Final code published | Voluntary. Adherence is not conclusive evidence of compliance (Code, Section 1 and Section 2 objectives (a); Opinion para (52)). Codes under Art 50(7) give no presumption of conformity (Regulation (EU) 2026/1744, recital (41)). | SRC-EC-COP-TEXT, SRC-EC-COP-PAGE, SRC-EC-COP-OPINION, SRC-OJ-2026-1744 | Verified 2026-11-05 |
| GUID-A50-COP-ADEQUACY | Adequacy assessments of the Code: Commission Opinion C(2026) 4839 final and AI Board conclusion | C(2026) 4839 final; AI Board conclusion | assessed_adequate | 2026-07-08: Commission Opinion adopted; 2026-07-09: Commission Opinion published; 2026-07-09: AI Board adopted its adequacy assessment | Both find the Code adequate for Art 50(2), (4) and (5). Both were made under the pre-Omnibus procedure and say they stay valid under the amended Art 50(7) and 56(6) while their conclusions agree (Opinion para (5); Board assessment). Neither prevents a later finding of inadequacy. | SRC-EC-COP-OPINION, SRC-EC-COP-OPINION-PAGE, SRC-AIB-COP-ASSESSMENT | Verified 2026-11-05 |
| GUID-A50-COP-SIGNATORIES | List of signatories of the Code | Commission news item of 31 July 2026 | published | 2026-07-31: Announcement: about 190 organisations signed; 2026-09-24: Last update of the list (95 Section 1, 192 Section 2 signatories) | Evidence of signature per section; the list is updated on an ongoing basis. | SRC-EC-COP-SIGNATORIES, SRC-EC-COP-PAGE | Verified 2026-11-05 |
| GUID-A50-EU-ICONS | EU icons for labelling AI-generated content (Code, Section 2, Annex 1) | Commission policy page | published | 2026-10-13: Last update of the icons page | Optional to use; using them does not by itself establish compliance. | SRC-EC-EU-ICONS, SRC-EC-COP-TEXT | Verified 2026-11-05 |
| GUID-A50-FAQ | Commission Q&A on Article 50 | Commission FAQ page | published | 2026-07-24: Last update | Informal Commission explanation; the guidelines prevail where they speak. | SRC-EC-A50-FAQ | Verified 2026-11-05 |
| GUID-A50-STUDIES | Three Commission-procured studies on marking and detecting AI-generated audio, image and video, and text | Commission library page | published | 2026-05-08: Published; 2026-06-11: Last update of the page | Authors' views; used for state-of-the-art context only. | SRC-EC-MARKING-STUDIES, SRC-STUDY-AUDIO, SRC-STUDY-IMAGE-VIDEO, SRC-STUDY-TEXT | Verified 2026-11-05 |

What changed since #8:
- **The guidelines.** The library page still says "Publication 20 July 2026", but its last update is today. It now lists the guidelines in 23 language versions (none in Romanian) and no longer lists the communication of 20 July.
- **The July communication.** C(2026) 5054 final approved the content because Art 50 applied from 2 August and translation would take longer. It said the guidelines would be adopted formally once every language version existed, and would apply only from then.
- **The adopted text.** C(2026) 7702 final, dated 5 November 2026, is that formal adoption. The diff found no change of substance: two cross-references were corrected (to "point 27" and to "points 36 and 40"), and two punctuation fixes were made (a closing parenthesis in point 36 and a comma in the source-code list of point 68).
- **The AI Board's caveat.** The Board noted in July that it had only the draft guidelines when it assessed the Code. The adopted guidelines do not change anything the Board relied on.

## 4. Timing, and consistency with the rule pack

The research starts from the rule pack's entries `aia-2026-08-02-art50-transparency`, `aia-2026-12-02-art50-2-legacy-transition`, `aia-2026-07-27-omnibus-entry-into-force` and `aia-2026-08-02-ai-office-competence`. Each point was checked again in the OJ text and against the guidance read for this issue.

| ID | Date | Kind | Event | Rule pack entry | Sources |
|---|---|---|---|---|---|
| TL-01 | 2025-11-05 | code_milestone | Kick-off plenary of the Code of Practice drafting |  | SRC-EC-COP-PAGE, SRC-EC-COP-OPINION |
| TL-02 | 2025-12-17 | code_milestone | First draft of the Code published |  | SRC-EC-COP-PAGE |
| TL-03 | 2026-03-03 | code_milestone | Second draft of the Code published |  | SRC-EC-COP-PAGE |
| TL-04 | 2026-05-08 | guidance | Draft Art 50 guidelines published; consultation until 3 June 2026 |  | SRC-EC-A50-CONSULTATION, SRC-EC-COP-PAGE |
| TL-05 | 2026-06-10 | code_milestone | Final Code of Practice published |  | SRC-EC-COP-PAGE, SRC-EC-COP-OPINION |
| TL-06 | 2026-07-08 | guidance | Commission Opinion C(2026) 4839 final: Code adequate for Art 50(2), (4) and (5) (published 9 July 2026) |  | SRC-EC-COP-OPINION, SRC-EC-COP-OPINION-PAGE |
| TL-07 | 2026-07-09 | guidance | AI Board adequacy assessment of the Code adopted |  | SRC-EC-COP-OPINION-PAGE, SRC-AIB-COP-ASSESSMENT |
| TL-08 | 2026-07-20 | guidance | Content of the Art 50 guidelines approved, C(2026) 5054 final, and published in English |  | SRC-EC-A50-APPROVAL-2026-07, SRC-WAYBACK-A50-GUIDELINES-PAGE |
| TL-09 | 2026-07-27 | legal | Regulation (EU) 2026/1744 in force: Art 50(7) replaced; Art 111(4) added | `aia-2026-07-27-omnibus-entry-into-force` | SRC-OJ-2026-1744, REPO-RULE-PACK-2026-11 |
| TL-10 | 2026-08-02 | legal | Art 50 applies to all in-scope systems | `aia-2026-08-02-art50-transparency` | SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, REPO-RULE-PACK-2026-11 |
| TL-11 | 2026-11-05 | guidance | Art 50 guidelines formally adopted, C(2026) 7702 final; 23 language versions listed |  | SRC-EC-A50-GUIDELINES, SRC-EC-A50-GUIDELINES-PAGE |
| TL-12 | 2026-12-02 | legal | Art 111(4): Art 50(2) deadline for generative systems placed on the market before 2 August 2026 | `aia-2026-12-02-art50-2-legacy-transition` | SRC-CONS-2024-1689-20260727, SRC-OJ-2026-1744, REPO-RULE-PACK-2026-11 |
| TL-13 | 2027-02-02 | code_milestone | Code Measure 3.4(c): watermark-detection interoperability solution due (signatories); not a statutory date |  | SRC-EC-COP-TEXT, SRC-AIB-COP-ASSESSMENT |

| ID | Rule pack item | Topic | Finding | Detail | Action | Marker |
|---|---|---|---|---|---|---|
| CC-01 | `aia-2026-08-02-art50-transparency` | Art 50 application date | consistent | 2 August 2026 for all in-scope systems whatever their placing date (Art 113; guidelines point 153). | None. | Verified 2026-11-05 |
| CC-02 | `aia-2026-08-02-art50-transparency` | Actor split | consistent | Providers under Art 50(1) and (2), deployers under Art 50(3) and (4) (OJ text; guidelines point 6). | None. | Verified 2026-11-05 |
| CC-03 | `aia-2026-12-02-art50-2-legacy-transition` | Art 111(4) scope: placed on the market or put into service | **disagreement** | The rule pack follows the OJ text: systems 'placed on the market' before 2 August 2026 (Art 111(4); recital (38) of 2026/1744; re-read 2026-11-05). The guidelines (point 153) say placed on the market or put into service; the Commission Q&A says placed on the market. The disagreement is between the guidelines and the OJ text, not with the rule pack. | Keep the predicate on placedOnMarketDate. Capture putIntoServiceDate in #19 and show the in-house case as pending legal review (LR-A50-01, with LR-04). | Verified 2026-11-05 |
| CC-04 | `aia-2026-12-02-art50-2-legacy-transition` | Only Art 50(2) is transitioned | consistent | Guidelines point 153: partly interactive systems must meet Art 50(1) from 2 August 2026. | None. | Verified 2026-11-05 |
| CC-05 | `GUID-ART50-TRANSPARENCY` | Status of the Art 50 guidelines | update | Rule pack: published, listed 20 July 2026, content not reviewed. Now: content approved 20 July 2026 (C(2026) 5054 final), formally adopted 5 November 2026 (C(2026) 7702 final), 23 language versions listed; substantively unchanged. | #18 records status adopted, both references and dates. | Verified 2026-11-05 |
| CC-06 | `GUID-ART50-COP-OPINION` | Commission opinion on the Code | update | Rule pack: listed 9 July 2026. Opinion C(2026) 4839 final is dated 8 July 2026 and was published 9 July 2026; the AI Board adopted its assessment on 9 July 2026; both cover Art 50(2), (4) and (5). | #18 records the reference, both dates and the AI Board assessment. | Verified 2026-11-05 |
| CC-07 | `UV-05` | Final Code published 10 June 2026 | resolved | Verified in the Commission opinion (para (1)) and on the Code page timeline. | #18 can drop UV-05 and cite GUID-A50-COP. | Verified 2026-11-05 |
| CC-08 | `UV-07` | Contents of the guidelines and the opinion | resolved | Both documents read in full for this research. | #18 can drop UV-07 and cite this file. | Verified 2026-11-05 |
| CC-09 | `aia-2026-08-02-art50-transparency` | Art 50(7) as replaced | consistent | Replaced by 2026/1744 Art 1(20); recital (41) adds that codes under Art 50(7) give no presumption of conformity. The opinion was adopted under the earlier procedure and states it stays valid while the Commission's and the Board's conclusions agree. | Add recital (41) to the Art 50 entry's notes. | Verified 2026-11-05 |
| CC-10 | `LR-03` | Does Art 111(2) defer Art 50 for legacy high-risk systems? | update | Guidelines footnote 50: no; the Art 111(2) grandfathering is limited to the high-risk requirements, and Art 50 applies cumulatively. | Add the Commission's view to LR-03 and keep the question for qualified legal review (LR-A50-10). | Verified 2026-11-05 |
| CC-11 | `aia-2026-08-02-art50-transparency` | Art 50(5) timing | consistent | First interaction means each session of each person; first exposure means each output for each person (guidelines point 143). | None. | Verified 2026-11-05 |
| CC-12 | `aia-2026-08-02-ai-office-competence` | AI Office competence for Art 50 | consistent | The rule-pack entry matches Art 75(1) as replaced. Guidelines footnote 47 is narrower than the OJ text for deployers: it extends the AI Office's competence to Art 50(3) and (4) only where the provider is also the deployer, whereas the second subparagraph of Art 75(1) also covers deployers that form part of the same undertaking as the provider; the footnote also does not repeat the exceptions in point (a)(i) to (iv). The OJ text governs. | #19 derives the competence flag per paragraph from the rule-pack entry, with the exceptions and the same-undertaking limb (A50-ED-06), not from footnote 47. | Verified 2026-11-05 |
| CC-13 | `vocabularies.factVocabulary.generatesSyntheticContent` | Definition of generatesSyntheticContent | update | The guidelines include systems that manipulate content (points 57 and 59); the rule pack definition says 'generates' only. | #19 defines the fact as 'generates or manipulates', with the four modality facts. | Verified 2026-11-05 |
| CC-14 | `STD-PREN-18229-2` | prEN 18229-2 stage | consistent | CEN work programme on 5 November 2026: Under Approval, current stage 2026-10-29, next stage 2026-11-19, forecast vote 2027-03-07, as in the rule pack. | None. | Verified 2026-11-05 |

**The disagreement (CC-03).**
- **Art 111(4).** The provision, added by Art 1, point (39)(b), of Regulation (EU) 2026/1744 and re-read in the OJ and consolidated texts today, covers providers of generative systems "that have been placed on the market before 2 August 2026". Recital (38) speaks of providers who have "already placed their systems on the market". The Commission's Q&A (last updated 24 July 2026) says the same.
- **The guidelines.** Point 153 describes the transition as covering systems "placed on the market or put into service before 2 August 2026".
- **Who disagrees.** The disagreement is therefore between non-binding guidance and the OJ text. It does not affect the rule pack, whose predicate (`placedOnMarketDate < 2026-08-02`) follows the OJ.
- **Recommendation.** Keep the predicate. Have #19 capture `putIntoServiceDate`, and show a system that was only put into service before 2 August 2026 (an in-house system, for example) as pending legal review. That extends LR-04 of the rule pack (LR-A50-01).

**What the guidance adds to the dates**
- **Partly interactive, partly generative systems.** Only their Art 50(2) marking benefits from the transition. The Art 50(1) disclosure was due on 2 August 2026 (point 153).
- **No retroactive marking.** Outputs generated before 2 August 2026, and deep fakes made before then, need no retroactive marking or labelling. A text generated before but published on or after 2 August 2026 must be labelled (point 154).
- **Outputs made during the transition.** Nothing says whether the outputs of transitioned systems generated between 2 August and 2 December 2026 must be marked later (LR-A50-02).

## 5. The obligations, paragraph by paragraph

| ID | Provision | Actor | Summary (paraphrase) | Exceptions and exclusions | Applies from | Code of Practice | Procedures | Legal review |
|---|---|---|---|---|---|---|---|---|
| A50-OBL-1 | Art 50(1) | provider | Design and develop systems intended to interact directly with natural persons so that those persons are informed they interact with an AI system. | EX-50-1-OBVIOUS, EX-50-1-LE, EX-SCOPE-RD | 2026-08-02 | Not covered by the Code. | A50-P-00, A50-P-01 | LR-A50-06, LR-A50-07 |
| A50-OBL-2 | Art 50(2) | provider | Ensure outputs of systems generating or manipulating synthetic audio, image, video or text are marked in a machine-readable format and detectable as artificially generated or manipulated, with technical solutions that are effective, interoperable, robust and reliable as far as technically feasible. | EX-50-2-LE, EX-50-2-EDIT, EX-50-2-NOSUB, EX-50-2-OUTOFSCOPE, EX-50-2-B2B, EX-50-2-EPHEMERAL, EX-SCOPE-RD | 2026-08-02 (Art 50(2) transition: `aia-2026-12-02-art50-2-legacy-transition`) | Section 1, Commitments 1 to 4 (adequate). | A50-P-00, A50-P-02A, A50-P-02B, A50-P-02C, A50-P-02D, A50-P-02E, A50-P-02F | LR-A50-01, LR-A50-02, LR-A50-03, LR-A50-05, LR-04 |
| A50-OBL-3 | Art 50(3) | deployer | Deployers of emotion recognition or biometric categorisation systems inform the natural persons exposed of the system's operation, and process personal data under the data-protection acts. | EX-50-3-LE, EX-SCOPE-PERSONAL | 2026-08-02 | Not covered by the Code. | A50-P-00, A50-P-03 | LR-A50-11 |
| A50-OBL-4DF | Art 50(4), first subparagraph | deployer | Deployers of systems generating or manipulating deep fakes disclose that the content is artificially generated or manipulated; for evidently artistic, creative, satirical, fictional or analogous works, disclosure of its existence in a manner that does not hamper the work. | EX-50-4-LE, EX-SCOPE-PERSONAL | 2026-08-02 | Section 2, Commitments 1 to 3 (adequate). | A50-P-00, A50-P-04A | LR-A50-08 |
| A50-OBL-4TXT | Art 50(4), second subparagraph | deployer | Deployers of systems generating or manipulating text published to inform the public on matters of public interest disclose that it is artificially generated or manipulated, unless it underwent human review or editorial control and a person holds editorial responsibility. The editorial exception is tested text by text in A50-P-04B, not applied as an exclusion. | EX-50-4T-LE, EX-SCOPE-PERSONAL | 2026-08-02 | Section 2, Commitments 1, 2 and 4 (adequate). | A50-P-00, A50-P-04B | LR-A50-09 |
| A50-OBL-5 | Art 50(5) | provider, deployer | The information under paragraphs 1 to 4 is given clearly and distinguishably at the latest at the first interaction or exposure and conforms to the applicable accessibility requirements. | none | 2026-08-02 | Covered for paragraphs 2 and 4 (Section 1, Measure 2.3; Section 2, Measures 1.1 and 1.2). | A50-P-00, A50-P-01, A50-P-02B, A50-P-03, A50-P-04A, A50-P-04B, A50-P-05 | LR-A50-12, LR-A50-13 |
| A50-OBL-6 | Art 50(6) | provider, deployer | Paragraphs 1 to 4 do not affect Chapter III and are without prejudice to other transparency obligations for deployers of AI systems under Union or national law; Art 50 and high-risk duties apply cumulatively (guidelines point 25 and footnote 50). | none | 2026-08-02 | Not applicable. | A50-P-00 | LR-A50-10 |
| A50-OBL-7 | Art 50(7) as replaced by Regulation (EU) 2026/1744 | commission, ai_board | The Commission encourages codes of practice on detection, marking and labelling, assesses with utmost account of the Board's opinion whether adherence is adequate for paragraphs 2 and 4 (procedure of Art 56(6)), and may adopt an implementing act with common rules if a code is inadequate. The replacement entered into force on 27 July 2026 (TL-09); like the rest of Chapter IV it applies from 2 August 2026 (Art 113). | none | 2026-08-02 | The adequacy assessments of 8 and 9 July 2026. | A50-P-00 | LR-A50-04 |

### 5.1 Art 50(1): telling people they are interacting with AI

**Who is obliged.**
- The duty falls on providers, including those that put an in-house system into service under their own name. The system must be designed so that everyone who interacts with it is informed throughout its lifecycle, whoever the deployer is (points 10 and 11).
- A company that modifies another provider's system and puts it into service under its own name becomes its provider.

**Scope.** Four elements must all be present (point 30):
- an AI system: rule-based auto-replies are out;
- intended to interact: a genuine two-way, responsive exchange in any form;
- directly: the AI itself communicates, not a human intermediary. The mere possibility of human review does not take a system out of scope, and products that blend AI and human answers must disclose the AI outputs unless humans review and send them;
- with natural persons: closed industrial settings and machine-to-machine calls are out.

AI agents are covered. They should disclose their artificial nature and the person they act for, at key steps and at every new interaction (point 31).

The guidelines give examples on both sides:
- **in scope:** chatbots, voice assistants, AI hotlines, companions, robots, avatars, social bots and coding agents;
- **out of scope:** recommender systems, spam filters, translation and transcription, search that does not generate content, auto-completion, biometric recognition and back-end decision support.

**What the duty requires**
- **Timing.** Notification at the latest at the first interaction, built into the design (point 33).
- **Format.** Free, but it must meet Art 50(5) and suit vulnerable groups, with child-appropriate wording where children may be reached (point 34).
- **Content.** An explicit statement of the system's artificial nature (point 35).
- **Insufficient on its own** (point 38):
  - text only in the terms and conditions or the documentation;
  - machine-readable marks;
  - ambiguous labels such as "assistant";
  - a generic statement for a whole site;
  - the name of a technology without an explanation.
- **Reminders.** One prominent notice usually suffices. Periodic reminders are expected for vulnerable users and for sensitive or immersive contexts: companions, health, finance, legal advice and complaints (point 40).
- **When asked.** The system must disclose its nature whenever it is asked about it, or when the person seems confused (point 40).

**Exceptions**
- **Obviousness.** The provider assesses and documents what the reasonably well-informed, observant and circumspect person of the target and foreseeable audience would see, drawing on the consumer-law "average consumer" (points 42 to 44). The exception is read restrictively, and vulnerable audiences rule it out (point 45). The guidelines' examples include a code assistant for professional developers, an internal assistant for trained staff and a non-player character in a single-player game.
- **Law enforcement.** Use authorised by law, unless the system is open to the public for reporting crime (points 46 to 49).

An exception that is relied on removes A50-P-01, so A50-P-00 tests it (steps S10 and S11) before the exclusion takes effect.

**Interplay.** Consumer-protection, data-protection and media duties apply alongside Art 50(1) (points 50 to 53).

| What the auditor can test | Needs judgement (reviewed) | Outside what an audit can establish |
|---|---|---|
| The disclosure design; a new session on every channel and locale; the wording and placement of each notice against point 38; self-identification probes; reminders; agent disclosures; accessibility; the evidence behind any exception | Whether the interaction is obvious to the foreseeable audience (LR-A50-06); whether the wording suits the audience | Whether every user actually understood the notice, unless user research exists; channels added after the audit |

### 5.2 Art 50(2): marking and detectability of synthetic content

**Who is obliged.** Providers of AI systems, including general-purpose AI systems and agents whose perceptible outputs are content, that generate or manipulate synthetic audio, image, video or text (points 56 to 63).
- **Manipulation.** It is covered, and so is content mixed with human material (point 59).
- **Modalities.** They are read broadly: 3-D, virtual and augmented reality and digital twins count. In a video, both picture and sound are marked (points 60 to 62).
- **Model providers.** They are not addressed directly but are encouraged to mark at model level (point 27). A system provider may rely on an upstream model provider's or a third party's marking, but stays responsible for showing compliance (point 74).

**Outside the scope, according to the guidance** (points 64 to 68):
- simple data processing;
- reproduction or arrangement of existing content;
- recordings of observations;
- short strings, captions and labels;
- source code and configuration files;
- outputs exchanged only between machines;
- intermediate outputs of closed production workflows, although the final output is marked.

**What the duty requires**
- **Two elements.** A technical solution combines marking techniques with means of detection, and both must be in place (points 69 and 70).
- **Marking.** It must be machine-readable. Watermarks, metadata, cryptographic provenance, logging and fingerprints may be combined (recital (133); points 71 to 73), but a full provenance chain is not required (point 73).
- **Detection.** It must be available to the persons potentially exposed, and its results must be human-readable (point 75). Providers should use publicly available industry-standard detection where it exists. Their own or a shared solution is an interim answer while such standards emerge, provided it is interoperable (point 76).
- **The four requirements.** Effectiveness, reliability, robustness and interoperability are defined in point 79 and assessed holistically (point 80).
- **What is feasible.** "Technically feasible" is an objective notion, independent of a provider's own resources (point 81). The state of the art evolves, and providers must keep up with it (points 82 and 83). Costs may be weighed (point 85).
- **Narrow carve-outs in the guidance:**
  - metadata alone for closed physical products (point 86);
  - no marking for strictly technical, internal outputs of industrial or business-to-business systems that meet three cumulative conditions (point 87);
  - real-time ephemeral content, where marking is infeasible and people are told (point 88).

**Exceptions in the Act**
- **Standard editing.** Grammar fixes, format conversion and minor colour or crop changes count. Summaries, meaning-changing rewrites, object or face replacement and voice synthesis do not (points 90 and 92 with examples).
- **No substantial alteration** of the deployer's input or its meaning (point 91).
- **Law enforcement** (point 93).

**Data protection.** Marking must not carry the creator's identity. Detection services delete personal data once detection is done (point 94).

| What the auditor can test | Needs judgement (reviewed) | Outside what an audit can establish |
|---|---|---|
| Whether marks are present and valid on sampled outputs per stratum; whether the detection solution is available, correct and readable; reliability and robustness, independently re-performed; validation with independent tools; preservation of input marks; the provider's testing and correction process; the evidence behind each exception | Whether a feature only edits; whether the achieved levels are "as far as technically feasible" and the state of the art (LR-A50-05); reliance on guidance-only carve-outs (LR-A50-03) | Robustness against attacks not yet known; interoperability with tools the audit did not test |

### 5.3 Art 50(3): emotion recognition and biometric categorisation

**Who is obliged, and for what.**
- **Scope.** Deployers must inform everyone exposed, children included, that the system is operating, whether it works in real time or after the event (points 99, 100 and 106).
- **The two notions.** They follow Art 3(39) and (40). The guidelines refer to the Commission's high-risk classification guidelines for both, and those are still a draft (rule pack, `GUID-ART6-HIGH-RISK-CLASSIFICATION`).
- **Classification.** Emotion recognition systems are high-risk unless prohibited. Biometric categorisation is covered whether or not it is high-risk (points 101 to 104).

**What the notice must do**
- **Content.** It states that the system operates. It need not give its purposes; data-protection notices do that (point 105).
- **Form.** It may be written, use icons, be oral, or combine these, depending on place, audience, the length of exposure and any existing relationship (point 107).
- **Timing.** It comes at the latest at first exposure; earlier is allowed (point 108).

**Exception.** Use "permitted by law" for law enforcement. This is wider than the "authorised by law" of the other paragraphs (point 109; LR-A50-11). A50-P-00-S12 tests it, because relying on it removes A50-P-03.

**Interplay.** A notice does not make an Art 5 prohibited use lawful (points 25 and 110).

| What the auditor can test | Needs judgement (reviewed) | Outside what an audit can establish |
|---|---|---|
| The deployment register; a notice at every point of exposure, its content, its timing and its accessibility; notices for after-the-event processing | Whether a system is an emotion recognition or biometric categorisation system (the draft Art 6 guidelines apply) | Lawfulness under Art 5 or data-protection law, which belong to WP-PL-03 and the privacy workstream |

### 5.4 Art 50(4), first subparagraph: deep fakes

**Who is obliged.** Deployers that use an AI system for professional purposes to generate or manipulate image, audio or video that constitutes a deep fake (point 112).
- **Distribution.** A deployer with complex distribution chains should make sure the label survives to the audience, for example through contracts and interface settings (point 12).
- **Platform tools.** A platform's labelling tool may be used, but the deployer stays responsible (point 126).

**What makes a deep fake.** Four cumulative criteria (points 113 to 116):
- **appreciable resemblance:** a high level of similarity;
- **existing:** realistic, or plausibly existing;
- **a subject:** persons, objects, places, entities or events;
- **false appearance:** it would falsely appear authentic or truthful. This is judged objectively for the whole foreseeable audience, including children and people with low literacy, and without any intent to deceive.

Product images in advertising can be deep fakes when they mislead about the product.

**What the duty requires.** Disclosure that people perceive without tools or actions. The provider's machine-readable marks therefore never satisfy it (point 117).

**Attenuated regime.** For evidently artistic, creative, satirical, fictional or analogous works or programmes:
- the categories are read strictly, and "evident" depends on format, context and audience expectations. Exclusively informative content such as news reporting does not qualify, and where informative and creative characters mix, the informative one prevails (points 120 to 122);
- disclosure is still required, in a form that does not hamper the work, at first exposure (point 123);
- third parties' rights still apply (point 124).

**Exception.** Law enforcement (point 125).

**Interplay.** Article 35(1)(k) of the DSA, data protection, intellectual property and personality rights (points 126 to 129).

| What the auditor can test | Needs judgement (reviewed) | Outside what an audit can establish |
|---|---|---|
| Whether the population of AI content is complete, by reconciling it with tool logs and screening unflagged items with the providers' detectors; independent re-classification; each label on each distribution channel at first exposure; accessibility; the labelling and correction process | Deep-fake qualification and the "evidently artistic" regime (LR-A50-08) | Whether the content is lawful (for example defamation or intellectual property) |

### 5.5 Art 50(4), second subparagraph: AI-generated text on matters of public interest

**Scope.** Three elements (point 131):
- **published:** open to an indeterminate audience, paid access included; internal and private texts are not published;
- **informing the public:** knowledge, opinions or facts;
- **a matter of public interest:** for example politics, public administration, justice, fundamental rights, security, health, environment, consumer safety, or economic, financial, scientific or cultural developments.

The guidelines give examples on both sides:
- **in scope:** an AI summary of a news article, and AI-edited investor reports;
- **out of scope:** fantasy novels, product descriptions without health or safety claims, and a chatbot's answer seen only by the person who asked.

**What the duty requires.** A clear, perceivable label (point 132).

**Exception.** Both conditions must hold (point 133):
- **Review.** The text has had human review or editorial control (point 134):
  - substantive examination by competent people, with fact-checking as a minimum, or control by an editor with power to approve, change or reject;
  - spell-checks, automated review, a mere policy or cursory approval do not qualify (point 135);
  - any substantive AI change after sign-off voids the exception (point 136).
- **Responsibility.** A person holds editorial responsibility, and that person's identity and contact details are public (point 138).

Media service providers may rely on their existing editorial procedures (point 140). Law enforcement is excepted as well (point 139).

The editorial exception is tested text by text in A50-P-04B: a sampled text complies when it is labelled or the exception is supported for it. It does not remove the procedure, even when the deployer says every text is reviewed.

| What the auditor can test | Needs judgement (reviewed) | Outside what an audit can establish |
|---|---|---|
| The population of published texts and their AI involvement; the scope classification; labels; evidence of review, including revision history against the signed-off version; the editorial policy and the published contact details | Whether a topic is of public interest; whether review was substantive (LR-A50-09) | The quality of journalism |

### 5.6 Art 50(5): clear, timely and accessible information

- **Clear and distinguishable** means noticeable, understandable and accessible, and set apart from its surroundings. Information that is easily missed fails, for example when it sits only in a manual, deep in menus or in terms of use (point 142).
- **First interaction or exposure** applies to each person (point 143):
  - **interactive systems:** at least once at the start of each session;
  - **content:** for each output, at the first moment a person is likely to perceive it, with later reminders where people may miss the start.
- **Accessibility** means the accessibility law that applies to the product or service, such as Directive (EU) 2019/882 or Directive (EU) 2016/2102. Art 50 adds no requirement of its own (point 144; LR-A50-12).
- **Detection results.** For Art 50(2), the information is the result of detection. The guidelines treat the moment a person tries to verify content as the "first exposure" (point 77; LR-A50-13).

### 5.7 Art 50(6) and (7), supervision and penalties

**Art 50(6).** Art 50 applies cumulatively with Chapter III and with other transparency law (points 25 and 50 to 53, and footnote 50). Notices under Art 26(11) and Art 50 may be combined (footnote 14).

**Art 50(7), as replaced.** The Commission assesses codes, taking utmost account of the Board's opinion. If a code is inadequate, it may adopt an implementing act. The 8 July opinion was given under the earlier text, and both it and the Board say the assessment stays valid while their conclusions agree.

**What signing the Code means** (points 146 to 150)
- **Signatories.** Authorities focus on whether signatories adhere to the Code.
- **Non-signatories.** They show compliance by other adequate means, for example a gap analysis against the Code, and can expect more requests for information and access.
- **Opt-outs.** Opting out of a section loses its benefit.
- **Fines.** Commitments can mitigate a fine.

**Supervision**
- **National authorities.** Market surveillance authorities supervise by default.
- **The AI Office.** Under Art 75(1) as replaced (rule-pack entry `aia-2026-08-02-ai-office-competence`), it supervises two groups of systems:
  - systems based on a general-purpose AI model where model and system come from the same provider or undertaking, except the systems in point (a)(i) to (iv): Annex I products, Annex III point 2 systems, systems of law enforcement, border management and financial institutions within Art 74(6), and Annex III point 8 systems for the administration of justice;
  - systems that constitute or are integrated into a very large online platform or search engine.

  The competence covers providers, so Art 50(1) and (2). It reaches deployers, and so Art 50(3) and (4), only where they are also the provider or form part of the same undertaking as the provider (second subparagraph). Guidelines footnote 47 is narrower than the OJ text for deployers: it names only the provider that is also the deployer, and it does not repeat the point (a) exceptions. The OJ text governs (CC-12).
- **The EDPS.** It supervises Union institutions (point 151).

**Penalties.** Up to EUR 15 million or 3 % of worldwide turnover, and up to EUR 750,000 for Union institutions. For SMEs, and for small mid-cap enterprises (SMCs) under Art 99(6a) as inserted by Regulation (EU) 2026/1744, Art 1, point (38)(c), the lower of the two amounts applies (Art 99(4)(g), (6) and (6a), Art 100(3); point 152).

## 6. The Code of Practice, measure by measure

The Code (`COP-TRANSPARENCY-2026-06` in the JSON) has 29 entries below: commitments and measures of Section 1 (providers, Art 50(2) and (5)) and Section 2 (deployers, Art 50(4) and (5)).
- **Mandatory or optional.** "Will" marks a mandatory measure, which market surveillance authorities monitor. "Encouraged" and "may" mark optional ones.
- **Who may adhere.** Model providers and third-party providers of marking or detection solutions may adhere to Section 1 voluntarily, so that the providers building on them can rely on their measures (Section 1, introduction to the commitments).
- **How the auditor uses it.** For a signatory, the mandatory measures are the test criteria, alongside the Act. For a non-signatory, the auditor asks for the gap analysis of point 148 and applies the same tests as evidence of "other adequate means".

| ID | Our title | Status | Content (paraphrase) | Articles | Source |
|---|---|---|---|---|---|
| COP-S1-M1.1 | At least one, normally two, machine-readable marking layers | mandatory | A marking solution of at least one technique that, with its detection mechanism, meets the four Art 50(2) quality requirements. While no single technique suffices, audio, image, video and containerised text carry at least two layers (signed metadata and an imperceptible watermark). One layer suffices for systems embedded in closed physical products that cannot export outputs, and for free-form text (watermark only). Alternative techniques are accepted later if proven at least equivalent against recognised benchmarks; until those exist, documented internal testing reviewed by market surveillance authorities. | Art 50(2) | Code, Section 1, Measure 1.1 |
| COP-S1-M1.1.1 | Digitally signed, time-stamped metadata stating AI generation | mandatory | Where the output format supports metadata, record whether content is AI-generated or manipulated; sign and time-stamp it in a tamper-evident way; protect signing keys, except where the deployment context cannot hold keys securely (for example local deployment). | Art 50(2) | Code, Section 1, Sub-measure 1.1.1 |
| COP-S1-M1.1.2 | Imperceptible watermark; free-form text over 200 tokens included | mandatory | Mark AI-generated or manipulated content with an imperceptible watermark that is hard to separate from the content, except very short text (under 200 tokens per the Glossary). Model-level watermarking is encouraged for model providers. | Art 50(2) | Code, Section 1, Sub-measure 1.1.2 and Glossary |
| COP-S1-M1.1.3 | Fingerprinting or logging as a supplement only | optional | Optional fingerprinting or logging of outputs. Never sufficient alone. If used: limited to output data, privacy-preserving, user control over logging and retention, no general duty to log prompts. | Art 50(2) | Code, Section 1, Sub-measure 1.1.3 |
| COP-S1-M1.2 | Preserve existing marks; prohibit removal; no circumvention tools | mandatory | Best efforts to retain metadata marks of input content in outputs; a prohibition of intentional removal or tampering in the acceptable use policy, terms or documentation (an alert suffices for free and open-source releases); no placing, promoting or advertising tools meant to circumvent the marks. | Art 50(2) | Code, Section 1, Measure 1.2 |
| COP-S1-M1.3 | Richer provenance information in the metadata | optional | Encouraged: system name, provider, timestamp, optionally model identifier and version, and the type of AI operations performed on manipulated content. | Art 50(2) | Code, Section 1, Measure 1.3 |
| COP-S1-M1.4 | Optional perceptible-label function for deployers | optional | Encouraged: an option in the system interface that lets deployers apply a perceptible label at generation, consistent with Section 2. | Art 50(2), Art 50(4) | Code, Section 1, Measure 1.4 |
| COP-S1-M2.1 | Free detection solution, one mechanism per marking technique | mandatory | A detection solution (public specification, software, or API) with a mechanism for each marking technique, free of charge; providers with fewer than 1,000,000 monthly users whose detection has substantial operating costs may charge a reasonable, proportionate fee when one user's requests exceed a reasonable volume, but access is always free and unlimited for authorities, media, fact-checkers, researchers and civil society (2.1.1). Access suited to the exposed audience, public where the public is exposed; text-watermark detection may be limited to verified experts; detection results downloadable in signed form with a content hash, solution identifier and timestamp (2.1.2). Data protection and security, including zero retention of submitted content (2.1.3). Retirement only with a backward-compatible replacement, otherwise hand-over to market surveillance authorities (2.1.4). | Art 50(2), Art 50(5) | Code, Section 1, Measure 2.1 (Sub-measures 2.1.1 to 2.1.4) |
| COP-S1-M2.2 | Forensic detection of stripped content | optional | Optional forensic detection for content whose marks were removed; judged not mature at publication; access may be restricted to verified experts. | Art 50(2) | Code, Section 1, Measure 2.2 |
| COP-S1-M2.3 | Clear, accessible detection results naming the technique used | mandatory | Results clear to lay persons, stating whether they rest on metadata, watermark, forensic or other techniques; embedded information included; interfaces accessible under the European Accessibility Act and the Web Accessibility Directive; EN 301 549 and WCAG 2.1 AA encouraged. | Art 50(2), Art 50(5) | Code, Section 1, Measure 2.3 |
| COP-S1-M2.4 | Literacy on marking and detection | optional | Encouraged: documentation for deployers and lay-user literacy resources. | Art 50(2) | Code, Section 1, Measure 2.4 |
| COP-S1-M3.1 | Effectiveness: people can access and understand detection results | mandatory | No quantitative metric; a user-based assessment of the detection function; panel studies optional. | Art 50(2) | Code, Section 1, Measure 3.1 |
| COP-S1-M3.2 | Reliability: low detection error rates across content variety | mandatory | Measure accuracy in nominal conditions with metrics such as error rates, on own marked content and other content (including other AI systems' outputs), on data not used in development, and across length, size, diversity and semantics. | Art 50(2) | Code, Section 1, Measure 3.2 |
| COP-S1-M3.3 | Robustness to common processing and adversarial attacks | mandatory | Robustness to in-place modifications, desynchronisation and the analogue hole, and to localised changes; adversarial resilience to copying, removal, regeneration and modification attacks, measured by verifying mark integrity; same metrics as reliability. Not required where only one metadata layer is allowed. | Art 50(2) | Code, Section 1, Measure 3.3 |
| COP-S1-M3.4 | Interoperability, staged: open metadata now, watermark by 2 Feb 2027 | mandatory | From entry into application: established metadata standards or best practices for open detection, and public information on accessing other detection mechanisms. By 2 February 2027: an interoperability solution for watermark detection (a standard access method, a public signpost, a shared consortium detector, or an equivalent). Then implement emerging standards in good time. | Art 50(2) | Code, Section 1, Measure 3.4 |
| COP-S1-M3.5 | Advancing the state of the art | optional | Encouraged research, benchmarks, reference datasets and red-teaming of marking and detection. | Art 50(2) | Code, Section 1, Measure 3.5 |
| COP-S1-M4.1 | Documented compliance process | mandatory | Document, implement and update a high-level compliance process for Section 1; may rely on third-party or model-provider documentation without shifting responsibility. | Art 50(2), Art 50(5) | Code, Section 1, Measure 4.1 |
| COP-S1-M4.2 | Testing before placing on the market and regularly after | mandatory | Test marking and detection before placing on the market and regularly after, under conditions representative of real-world use; until the AI Office endorses benchmarks, report against internal benchmarks and industry practice; independent experts and red teaming optional; monitor reported shortcomings and correct them. | Art 50(2), Art 50(5) | Code, Section 1, Measure 4.2 |
| COP-S1-M4.3 | Training of relevant personnel | mandatory | Proportionate training of staff and contractors responsible for Section 1 measures. | Art 50(2), Art 4 | Code, Section 1, Measure 4.3 |
| COP-S1-M4.4 | Cooperation with market surveillance authorities | mandatory | On reasoned request, provide the compliance documentation and access to the marking and detection solutions. | Art 50(2), Art 74 | Code, Section 1, Measure 4.4 |
| COP-S2-M1.1 | Label design: 'AI' acronym icon or equivalent; audible disclaimer | mandatory | Visual: an icon or label whose main element is the capitalised acronym 'AI' (national language only where required by law), optional second layer saying generated or modified. Audio-only: a short audible disclaimer at the start. Consider audience and sensitive sectors; accessibility measures such as audio descriptions, haptic cues, high contrast and assistive-technology detectability. | Art 50(4), Art 50(5) | Code, Section 2, Measure 1.1 |
| COP-S2-M1.2 | Label placement at first exposure, kept through distribution | mandatory | Perceivable without user action, visible long enough, embedded or an equivalent overlay, at first exposure. Images and video: a place without overlays (for example top right); video at the start, at intervals where possible and after interruptions; audio deep fakes add a visual label where a screen exists. Text: above or near the headline or in the colophon; short text via a contextual notice. Audio: disclaimer at first exposure with reminders. | Art 50(4), Art 50(5) | Code, Section 2, Measure 1.2 (Sub-measures 1.2.1 to 1.2.3) |
| COP-S2-M1.3 | Task force on the EU icon | optional | Encouraged participation in the task force developing the icon, the second layer and an audio icon. | Art 50(4) | Code, Section 2, Measure 1.3 |
| COP-S2-M2.1 | Internal compliance process; label verification for regular users | mandatory | Proportionate internal processes and documentation on how disclosure is implemented; for regular producers of deep fakes or published text, a process to verify labelling and prevent unlabelled or mislabelled content. Media service providers may rely on existing procedures. | Art 50(4) | Code, Section 2, Measure 2.1 |
| COP-S2-M2.2 | Awareness of disclosure duties among personnel | mandatory | Proportionate efforts to make personnel and contractors aware of the disclosure obligations; training encouraged. | Art 50(4), Art 4 | Code, Section 2, Measure 2.2 |
| COP-S2-M2.3 | Review reported mislabelling and remedy it without undue delay | mandatory | Internal review and external feedback; review substantiated reports of missing or wrong labels and remedy them without undue delay; cooperate with authorities. Flagging channels encouraged. | Art 50(4) | Code, Section 2, Measure 2.3 |
| COP-S2-C3 | Disclosure for evidently artistic, creative and similar works | mandatory | Icon per Measure 1.1, placed to suit the work and context, clear and accessible at first exposure (for example credits or accompanying notes), visible long enough; contextual disclosure adjacent to the content is allowed in digital settings, and point-of-entry or packaging disclosure in non-digital settings. | Art 50(4), Art 50(5) | Code, Section 2, Commitment 3 |
| COP-S2-C4 | Human review and editorial responsibility policy for published text | mandatory | Media service providers (EMFA Art 2(2)) may apply existing editorial procedures. Others need a policy naming the person with editorial responsibility and describing the organisational measures and resources for review before publication; individual reviews need not be documented; contact details published. | Art 50(4) | Code, Section 2, Commitment 4 |
| COP-S2-ANNEX1 | EU icons: AI + GENERATED, AI + MODIFIED and a basic icon | optional | Three freely usable icons (fully generated, partially modified, basic for a second layer or custom text), in four colour variants. | Art 50(4) | Code, Section 2, Annex 1 |

Numeric parameters of the Code:

| ID | Parameter | Value | Unit | Note | Source |
|---|---|---|---|---|---|
| COP-P-01 | Very short text, exempt from text watermarking | 200 | tokens (text shorter than this) | Stated as the state of the art at publication, expected to fall. | Code, Section 1, Glossary ('Very short text') and Sub-measure 1.1.2 |
| COP-P-02 | User threshold under which a high-volume detection fee is allowed | 1000000 | monthly users of the generative AI system | Free and unlimited access always for authorities, media, fact-checkers, trusted flaggers, researchers, educational institutions and civil society. | Code, Section 1, Sub-measure 2.1.1 |
| COP-P-03 | Deadline for the watermark-detection interoperability solution | 2027-02-02 | date | A Code measure, not a statutory date. The AI Board will examine the solutions. | Code, Section 1, Measure 3.4(c); AI Board assessment, assessment of Commitment 3 |
| COP-P-04 | Review cycle of the Code | 2 | years (at least every two years, formal updates considered) |  | Commission opinion, para (51) |

## 7. Technical standards and specifications

| ID | Reference | Our title | Category | Status | Relevance | Sources | Marker |
|---|---|---|---|---|---|---|---|
| STD-C2PA-2-5 | C2PA Technical Specification (Content Credentials) 2.5 | Content provenance manifests, bindings, trust model and validation | industry_specification | published (October 2026) | Candidate open standard for the signed-metadata layer (Code Sub-measure 1.1.1) and for open metadata detection (Measure 3.4(a)). Neither the guidelines nor the Code name it; treating it as an 'established standard' is this research's assessment. | SRC-C2PA-SPEC-2-5, SRC-C2PA-SPEC-INDEX-2-5, SRC-STUDY-IMAGE-VIDEO | Verified 2026-11-05 |
| STD-IPTC-DST | IPTC NewsCodes Digital Source Type vocabulary | Controlled terms for how media was made, including generative AI | vocabulary | published | Terms such as trainedAlgorithmicMedia and compositeWithTrainedAlgorithmicMedia; C2PA 2.5 actions use IPTC terms to state the nature of an asset. | SRC-IPTC-DST, SRC-C2PA-SPEC-2-5 | Verified 2026-11-05 |
| STD-ISO-21617-1-2026 | ISO/IEC 21617-1:2026 | JPEG Trust, Part 1: Core foundation | international_standard_not_cited | published (edition 2, 2026-08) | Framework for media authenticity and provenance; paywalled, so no clause is cited. Not cited in the OJ and not named by the guidelines or the Code. | SRC-ISO-21617-1-2026, SRC-STUDY-IMAGE-VIDEO | Verified 2026-11-05 |
| STD-ISO-21617-3 | ISO/IEC 21617-3 (JPEG Trust, Part 3) | JPEG Trust, Part 3: Media asset watermarking | draft_or_under_development | under development | The only standards project found that addresses watermarking of media assets; stage not confirmed (UV-A50-04). | SRC-JPEG-TRUST | Verified 2026-11-05 |
| STD-IEEE-3152-2024 | IEEE 3152-2024 | Transparent human and machine agency identification | international_standard_not_cited | active (approved 2024-12-11, published 2025-05-09) | Design reference for Art 50(1) interaction disclosure; not cited or named by the EU sources. | SRC-IEEE-3152-2024 | Verified 2026-11-05 |
| STD-EN-301-549 | ETSI EN 301 549 | Accessibility requirements for ICT products and services | accessibility_standard | named by the Code (version not checked) | Encouraged by the Code for detection-result interfaces and labels where accessibility law applies. | SRC-EC-COP-TEXT | Verified 2026-11-05 |
| STD-WCAG-2-1 | W3C WCAG 2.1, Level AA | Web Content Accessibility Guidelines | accessibility_standard | named by the Code | As for EN 301 549. | SRC-EC-COP-TEXT | Verified 2026-11-05 |
| STD-JTC21-ART50 | CEN/CLC/JTC 21 work programme | No work item on Art 50 marking, detection or labelling | draft_not_harmonised | read 2026-11-05 | Generative AI appears only in terminology and framework amendments (EN ISO/IEC 22989:2023/prA1:2025, JT021031; EN ISO/IEC 23053:2023/prA1:2025, JT021032; both Under Approval). prEN 18229-2 (JT021047, Transparency, Under Approval) is mapped to Art 13 in the rule pack; its relation to Art 50 is not known (UV-A50-03). No harmonised standard supports Art 50(2), as the guidelines acknowledge (point 76). | SRC-CEN-JTC21-WORKPROGRAMME, SRC-EC-A50-GUIDELINES, REPO-RULE-PACK-2026-11 | Verified 2026-11-05 |

C2PA 2.5 clauses used by the procedures (numbers with our own titles):

| C2PA 2.5 clause | Our title |
|---|---|
| 12.2 | Binding a manifest to content (hard and soft bindings) |
| 13.3 | Validation states of a manifest |
| 13.4 | Trust lists for signers |
| 14.1 | Validation process |
| 16.3.7 | Soft-binding assertion (watermark or fingerprint link) |
| 16.4.1 | Actions assertion with the digital source type of the asset |

**What this means for the audit**
- **No harmonised standard or common specification gives a presumption of conformity** for Art 50, and the guidelines expect harmonised standards to come later (point 76). Every Art 50 conclusion therefore rests on the Act, the guidelines, the Code and the auditor's own testing.
- **The CEN/CLC JTC 21 work programme** read on 5 November 2026 contains no item on marking, detection or labelling. Generative AI appears only in the terminology and framework amendments (JT021031 and JT021032).
- **C2PA.** Neither the Code nor the guidelines name it. The procedures accept any open metadata standard that independent tools can validate. C2PA 2.5 is the obvious candidate, because its actions assertion records the digital source type with IPTC terms (clause 16.4.1).

## 8. Draft audit procedures

| ID | Procedure | Provisions | Actor | Catalogue item | Steps | Statistical criteria | Legal review |
|---|---|---|---|---|---|---|---|
| A50-P-00 | Art 50 applicability, operator roles, timing and evidence route | Art 2, Art 3(3), Art 3(4), Art 50(1) to (7), Art 75(1), Art 111(4) | provider, deployer | WP-XC-07 | 12 | 0 | LR-A50-01, LR-A50-04, LR-A50-10, LR-A50-14, LR-03, LR-04, LR-A50-06, LR-A50-11, LR-08 |
| A50-P-01 | AI-interaction disclosure (Art 50(1) with Art 50(5)) | Art 50(1), Art 50(5) | provider | WP-XC-07 | 7 | 1 | LR-A50-06, LR-A50-07, LR-A50-12 |
| A50-P-02A | Machine-readable marking of outputs (Art 50(2), marking element) | Art 50(2), Art 111(4) | provider | WP-XC-10 | 8 | 1 | LR-A50-01, LR-A50-02, LR-A50-05, LR-04, LR-A50-03 |
| A50-P-02B | Detection solution and disclosure of detection results (Art 50(2) and (5)) | Art 50(2), Art 50(5) | provider | WP-XC-10 | 8 | 0 | LR-A50-13, LR-A50-12, LR-A50-05 |
| A50-P-02C | Reliability and robustness of marking and detection (Art 50(2), second sentence) | Art 50(2) | provider | WP-XC-12 | 7 | 3 | LR-A50-05 |
| A50-P-02D | Interoperability and non-removal of marks (Art 50(2), second sentence) | Art 50(2) | provider | WP-XC-10 | 5 | 0 | LR-A50-05 |
| A50-P-02E | Marking compliance, testing and monitoring process (Art 50(2); Code Commitment 4) | Art 50(2), Art 50(5) | provider | WP-XC-12 | 4 | 0 | none |
| A50-P-02F | Exceptions and scope limits claimed under Art 50(2) | Art 50(2) | provider | WP-XC-12 | 6 | 1 | LR-A50-03 |
| A50-P-03 | Notice of emotion recognition and biometric categorisation (Art 50(3) with Art 50(5)) | Art 50(3), Art 50(5), Art 5(1)(f), (g) | deployer | WP-XC-07 | 6 | 0 | LR-A50-11, LR-A50-12 |
| A50-P-04A | Deep-fake disclosure (Art 50(4), first subparagraph, with Art 50(5)) | Art 50(4), Art 50(5), Art 3(60) | deployer | WP-XC-11 | 8 | 2 | LR-A50-08, LR-A50-12, LR-A50-14 |
| A50-P-04B | Disclosure of AI-generated text on matters of public interest (Art 50(4), second subparagraph) | Art 50(4), Art 50(5) | deployer | WP-XC-11 | 7 | 1 | LR-A50-09, LR-A50-12 |
| A50-P-05 | Clear, distinguishable, timely and accessible information (Art 50(5)) | Art 50(5) | provider, deployer | WP-XC-07 | 4 | 0 | LR-A50-12 |

**How #19 evaluates applicability.**
- **Predicates.** Each procedure gives `roleRequired`, an `appliesIf` conjunction, `exclusions` and its timing. The predicates use the three-valued logic of the rule pack: an unknown fact gives `needs_information`, never "not applicable".
- **Exclusions.** A procedure is excluded when any exclusion's `ifAll` list is true. The basis is recorded: `statutory` for an exception in the Act, `guidance` for one that rests on the guidelines alone.
- **Testing an exception before it excludes.** An exclusion takes effect only with fact values approved after the steps that test it, which therefore sit outside the procedure it excludes: A50-P-00-S05 for the scope exclusions, A50-P-00-S10 to S12 for the Art 50(1), (3) and (4) exceptions, and A50-P-02F for the Art 50(2) exceptions and carve-outs. When a test does not support an exception, the fact is recorded as false and the procedure applies. The editorial exception of Art 50(4) is not an exclusion at all: it is tested text by text in A50-P-04B.
- **Conditional steps.** A step with `onlyIf` is performed only when its condition holds.
- **Derived facts.** These take the value true when any listed fact is true.

The fact vocabulary below lists 36 facts: 34 new ones, and `generatesSyntheticContent` and `placedOnMarketDate`, which keep their rule-pack definitions, with the change of CC-13.

| Fact | Type | Defined in | Meaning | Derivation | Legal review |
|---|---|---|---|---|---|
| `generatesSyntheticContent` | boolean_or_unknown | rule-pack-2026-11 | The AI system, including a general-purpose AI system, generates or manipulates synthetic audio, image, video or text content (guidelines points 57 to 59 include manipulation). Defined in rule-pack-2026-11 with 'generates' only; this file proposes adding manipulation (CC-13). #19 may capture it directly or derive it from the four modality facts. | any of: `generatesSyntheticText`, `generatesSyntheticImage`, `generatesSyntheticAudio`, `generatesSyntheticVideo` |  |
| `generatesSyntheticText` | boolean_or_unknown | art50-transparency-2026-11 | Generates or manipulates text: discrete symbolic content readable by humans (guidelines point 60). |  |  |
| `generatesSyntheticImage` | boolean_or_unknown | art50-transparency-2026-11 | Generates or manipulates images, including 3-D images (guidelines points 60 and 61). |  |  |
| `generatesSyntheticAudio` | boolean_or_unknown | art50-transparency-2026-11 | Generates or manipulates audio, including speech and music (guidelines point 60). |  |  |
| `generatesSyntheticVideo` | boolean_or_unknown | art50-transparency-2026-11 | Generates or manipulates video, including virtual, augmented or mixed reality and the audio track of a video (guidelines points 60 and 61). |  |  |
| `placedOnMarketDate` | date_or_unknown | rule-pack-2026-11 | Date on which the AI system was first placed on the Union market. |  | LR-04, LR-A50-01 |
| `putIntoServiceDate` | date_or_unknown | art50-transparency-2026-11 | Date on which the AI system was first put into service in the Union (Art 3(11)), for systems that were never placed on the market, such as in-house systems. Captured so that a lawyer's answer to LR-A50-01 can be applied; the transition predicate uses placedOnMarketDate only until then. |  | LR-04, LR-A50-01 |
| `interactsDirectlyWithNaturalPersons` | boolean_or_unknown | art50-transparency-2026-11 | The AI system is intended to interact directly with natural persons: a bidirectional exchange, direct (not mediated by a human), with natural persons (guidelines points 30 and 31; AI agents included). |  |  |
| `obviousToReasonablyWellInformedPerson` | boolean_or_unknown | art50-transparency-2026-11 | It is obvious to a reasonably well-informed, observant and circumspect person of the target and reasonably foreseeable audience that they interact with an AI system, as assessed and documented by the provider (Art 50(1); guidelines points 42 to 45, read restrictively). |  | LR-A50-06 |
| `authorisedByLawForCriminalOffences` | boolean_or_unknown | art50-transparency-2026-11 | Use of the system is authorised by Union or national law to detect, prevent, investigate or prosecute criminal offences, with safeguards (Art 50(1), (2) and (4); guidelines points 46 to 48, 93, 125, 139). |  |  |
| `availableToPublicToReportCriminalOffence` | boolean_or_unknown | art50-transparency-2026-11 | The system is available to the public to report a criminal offence (removes the Art 50(1) law-enforcement exception; guidelines point 49). |  |  |
| `scientificResearchOnly` | boolean_or_unknown | art50-transparency-2026-11 | The system and its outputs are developed and put into service for the sole purpose of scientific research and development (Art 2(6); guidelines points 21 and 22). |  |  |
| `isAiAgent` | boolean_or_unknown | art50-transparency-2026-11 | The system acts as an AI agent that can interact with the persons instructing it or with other natural persons (guidelines point 31). |  | LR-A50-07 |
| `interactsWithChildrenOrVulnerableGroups` | boolean_or_unknown | art50-transparency-2026-11 | The system is intended or reasonably likely to interact with, or its content to reach, children, elderly persons, persons with disabilities or persons with lower literacy (guidelines points 34, 40, 115 and footnote 40). |  |  |
| `onlyAssistiveStandardEditing` | boolean_or_unknown | art50-transparency-2026-11 | Every function of the system in scope only performs an assistive function for standard editing (Art 50(2); guidelines point 90). The exception applies only to the extent of such functions. |  |  |
| `noSubstantialAlterationOfInput` | boolean_or_unknown | art50-transparency-2026-11 | No function of the system substantially alters the input data provided by the deployer or its semantics (Art 50(2); guidelines points 91 and 92). |  |  |
| `outputsOnlyOutOfScopeContent` | boolean_or_unknown | art50-transparency-2026-11 | All outputs fall in the categories the guidelines place outside Art 50(2): short sequences of characters, source code, machine-to-machine outputs never perceived by humans, or intermediate outputs of closed production workflows (guidelines points 64 to 68). |  | LR-A50-03 |
| `b2bIndustrialConditionsMet` | boolean_or_unknown | art50-transparency-2026-11 | The three cumulative conditions of guidelines point 87 are met: strictly technical outputs, perceived only by a limited predefined number of professionals within provider and deployer, not intended to be shared outside with safeguards against misuse. Excludes public and consumer-facing systems. |  | LR-A50-03 |
| `closedPhysicalProductEnvironment` | boolean_or_unknown | art50-transparency-2026-11 | The system is embedded in a physical product and generates mainly instructive outputs in a technically controlled, closed environment, with effective measures preventing capture or export (guidelines point 86; Code Measure 1.1). Changes the expected marking layers, not applicability. |  | LR-A50-03 |
| `ephemeralRealTimeOnly` | boolean_or_unknown | art50-transparency-2026-11 | All outputs are generated in real time, consumed immediately, never recorded, stored or disseminated, marking them is not technically feasible, and the persons exposed are told the content is AI-generated (guidelines point 88). |  | LR-A50-03 |
| `builtOnOwnGpaiModel` | boolean_or_unknown | art50-transparency-2026-11 | The AI system is based on a general-purpose AI model, and the model and the system are provided by the same provider or within the same undertaking (Art 75(1), point (a)). The exceptions in point (a)(i) to (iv) are captured by art75ExceptedSystem. |  | LR-08 |
| `integratedIntoVlopOrVlose` | boolean_or_unknown | art50-transparency-2026-11 | The AI system constitutes or is integrated into a designated very large online platform or search engine (Art 75(1)(b)). |  |  |
| `art75ExceptedSystem` | boolean_or_unknown | art50-transparency-2026-11 | The system falls under an exception to Art 75(1), point (a), as the rule-pack entry aia-2026-08-02-ai-office-competence lists them: systems related to products under Annex I, Annex III point 2 systems, systems of law enforcement, border management and financial institutions within Art 74(6), and Annex III point 8 systems for the administration of justice. Such systems stay with the national authorities even when built on the provider's own general-purpose AI model. |  | LR-08 |
| `deployerIsProviderOrSameUndertaking` | boolean_or_unknown | art50-transparency-2026-11 | The deployer is also the provider of the system or forms part of the same undertaking as the provider (Art 75(1), second subparagraph). Only then does the AI Office competence reach the deployer's Art 50(3) and (4) duties. |  | LR-08 |
| `codeSignatorySection1` | boolean_or_unknown | art50-transparency-2026-11 | The provider signed Section 1 of the Code and has not opted out of the relevant measures, as checked against the Commission's signatory list on a recorded date. |  | LR-A50-04 |
| `codeSignatorySection2` | boolean_or_unknown | art50-transparency-2026-11 | The deployer signed Section 2 of the Code and has not opted out of the relevant measures, as checked against the Commission's signatory list on a recorded date. |  | LR-A50-04 |
| `deployerUsesEmotionRecognition` | boolean_or_unknown | art50-transparency-2026-11 | The deployer uses an emotion recognition system (Art 3(39)), in real time or ex post (guidelines points 100 and 101). |  | LR-A50-11 |
| `deployerUsesBiometricCategorisation` | boolean_or_unknown | art50-transparency-2026-11 | The deployer uses a biometric categorisation system (Art 3(40)), high-risk or not (guidelines points 103 and 104). |  | LR-A50-11 |
| `deployerOperatesErOrBcSystem` | boolean_or_unknown | art50-transparency-2026-11 | Derived: the deployer uses an emotion recognition or a biometric categorisation system. | any of: `deployerUsesEmotionRecognition`, `deployerUsesBiometricCategorisation` |  |
| `lawEnforcementPermittedErBc` | boolean_or_unknown | art50-transparency-2026-11 | Use of the emotion recognition or biometric categorisation system is permitted by law to detect, prevent or investigate criminal offences, with safeguards and in accordance with Union law (Art 50(3); guidelines point 109). |  | LR-A50-11 |
| `personalNonProfessionalUseOnly` | boolean_or_unknown | art50-transparency-2026-11 | The deployer is a natural person using the system only in a purely personal, non-professional activity (Art 2(10); guidelines points 19 and 20). Excludes deployer duties only. |  |  |
| `deployerGeneratesDeepFakes` | boolean_or_unknown | art50-transparency-2026-11 | The deployer uses an AI system to generate or manipulate image, audio or video content that constitutes a deep fake (Art 3(60): resemblance, existing, persons/objects/places/entities/events, false appearance of authenticity or truthfulness; guidelines points 113 to 116). |  | LR-A50-08 |
| `evidentlyArtisticCreativeSatiricalFictional` | boolean_or_unknown | art50-transparency-2026-11 | The deep fakes form part of an evidently artistic, creative, satirical, fictional or analogous work or programme (Art 50(4); guidelines points 119 to 124). Changes the disclosure form, not applicability. |  | LR-A50-08 |
| `deployerPublishesAiTextOnPublicInterest` | boolean_or_unknown | art50-transparency-2026-11 | The deployer uses an AI system to generate or manipulate text that is published with the purpose of informing the public on matters of public interest (Art 50(4); guidelines points 130 and 131). |  |  |
| `editorialExceptionReliedOn` | boolean_or_unknown | art50-transparency-2026-11 | For at least one in-scope text, the deployer relies on the exception for texts that underwent human review or editorial control with a natural or legal person holding editorial responsibility for their publication (Art 50(4), second subparagraph; guidelines points 133 to 140), instead of labelling them. It does not exclude A50-P-04B: the exception is tested text by text (A50-P-04B-S03 to S06 and criterion A50-P-04B-C01). |  | LR-A50-09 |
| `art50DisclosureApplies` | boolean_or_unknown | art50-transparency-2026-11 | Derived: at least one Art 50 information duty may apply, so Art 50(5) is tested. | any of: `interactsDirectlyWithNaturalPersons`, `generatesSyntheticContent`, `deployerOperatesErOrBcSystem`, `deployerGeneratesDeepFakes`, `deployerPublishesAiTextOnPublicInterest` |  |

**Before fieldwork starts** (engagement terms, recorded in WP-PL-01 and WP-PL-07):
- **Written authorisation.** It must cover generating outputs at the volumes the sampling needs, transformation tests and any adversarial tests, with cost and rate limits agreed.
- **Test identities.** Use test accounts and synthetic prompts; no real personal data.
- **Detector access.** Get access to any restricted detector, without taking custody of signing keys or watermark secrets.
- **Handling outputs.** Sampled outputs may contain personal data or harmful text. Keep excerpts off by default and follow the evidence-retention policy.
- **Independence.** The audit team must not have designed or built the solutions it tests.
- **Where tests run.** Detectors, validators and transformations run in the auditor's environment. The platform only ingests the results as data and recomputes the statistics, in line with the direction to ingest, recompute and attest without executing ingested code.

### 8.1 A50-P-00: applicability, roles, timing and evidence route

**Objective.** Decide which Art 50 duties reach which operator for which system, from when, which exceptions are relied on, which authority supervises, and whether compliance is demonstrated through the Code or by other means.

**Applicability (for #19).** Role required: `provider_or_deployer`. Applies if: always (no condition). Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`).

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-00-S01 | Obtain the system, channel and output-path inventory and confirm its completeness against product catalogues, websites and contracts. | inspection | EV-A50-01 | SR-A50-01 |  |  | Guidelines, points 6 to 8; AI Act, Art 50(1) to (4) |
| A50-P-00-S02 | Determine each operator role per system: provider (develops or has developed, and places on the market or puts into service under its own name, in-house use included), deployer (decides purposes and manner of use, even without technical control), both, or neither (pure disseminators such as hosting services or broadcasters). | inspection | EV-A50-02 |  |  |  | AI Act, Art 3(3), (4); Guidelines, points 10 to 17 |
| A50-P-00-S03 | Record every Art 50 fact as true, false or unknown with its evidence; an unknown fact leaves the paragraph needs_information. | analytical_review | EV-A50-03 |  |  |  | Guidelines, points 28 to 31, 56, 99, 112, 130; Rule pack, vocabularies.predicateRule |
| A50-P-00-S04 | Screen Art 5 first: compliance with Art 50 does not make a use lawful (for example emotion recognition at work or in education, or biometric categorisation inferring sensitive traits). Escalate suspected matches to WP-PL-03. | analytical_review | EV-A50-03 |  |  |  | AI Act (OJ 2024), recital (137); Guidelines, points 25, 102, 104 |
| A50-P-00-S05 | Apply the scope exclusions: personal non-professional use (deployer duties only), sole-purpose scientific research, pre-market research and testing other than real-world testing. A free and open-source licence does not exclude Art 50. | analytical_review | EV-A50-03, EV-A50-04 |  |  |  | AI Act, Art 2(6), (8), (10), (12); Guidelines, points 19 to 24 |
| A50-P-00-S06 | Date each duty: Art 50 applies from 2 August 2026 to every in-scope system whatever its placing date; only Art 50(2) is transitioned to 2 December 2026 for systems placed on the market before 2 August 2026; record placing and putting-into-service dates; the Art 111(2) legacy rule for high-risk systems does not defer Art 50. | inspection | EV-A50-05 |  |  |  | AI Act, Art 111(4), Art 113; Reg. (EU) 2026/1744, recital (38); Guidelines, points 153 and 154, footnote 50 |
| A50-P-00-S07 | Check Code signatory status per section against the Commission's list on a recorded date, including opt-outs; for non-signatories request the gap analysis against the Code. | inspection | EV-A50-06, EV-A50-07 |  |  |  | Signatory list, list of signatories; Guidelines, points 146 to 148 |
| A50-P-00-S08 | Identify the competent authority per paragraph from Art 75(1) as replaced (rule-pack entry aia-2026-08-02-ai-office-competence): the national market surveillance authority by default; the AI Office for systems based on a general-purpose AI model where model and system come from the same provider or undertaking (except the systems in Art 75(1)(a)(i) to (iv)) and for systems that constitute or are integrated into a very large online platform or search engine. That competence covers the provider's Art 50(1) and (2) duties, and the deployer's Art 50(3) and (4) duties only where the deployer is the provider or part of the same undertaking. Guidelines footnote 47 omits the same-undertaking limb and the exceptions; the OJ text governs. The EDPS supervises Union institutions. | analytical_review | EV-A50-39 |  |  |  | AI Act, Art 75(1); Rule pack, aia-2026-08-02-ai-office-competence; Guidelines, point 151, footnote 47 |
| A50-P-00-S09 | Confirm the audit team did not design or implement the disclosure, marking or labelling solution under review (self-review threat); record the conclusion in WP-PL-01. | inquiry | EV-A50-03 |  |  |  | Catalogue, WP-PL-01 |
| A50-P-00-S10 | Where the Art 50(1) obviousness exception is relied on: inspect the audience analysis (target and foreseeable audience, vulnerable groups, literacy, context) and the obviousness factors, and re-perform any access restriction it depends on, for example that a professional-only tool cannot be reached by the public. If the evidence does not support it, record obviousToReasonablyWellInformedPerson as false, so that A50-P-01 applies. | inspection | EV-A50-04, EV-A50-12 |  |  | `obviousToReasonablyWellInformedPerson = true` | AI Act, Art 50(1); Guidelines, points 42 to 45 |
| A50-P-00-S11 | Where a law-enforcement exception is relied on under Art 50(1) or (4): inspect the law, its purposes and safeguards, and the deployment it covers (other uses of the same system stay in scope); for Art 50(1), also confirm that the system is not available to the public to report a criminal offence. If the evidence does not support it, record the facts accordingly, so that A50-P-01, A50-P-04A or A50-P-04B applies. | inspection | EV-A50-30 |  |  | `authorisedByLawForCriminalOffences = true` | AI Act, Art 50(1), (4); Guidelines, points 46 to 49, 125 and 139 |
| A50-P-00-S12 | Where the Art 50(3) law-enforcement exception is relied on: inspect the law permitting non-transparent use of the emotion recognition or biometric categorisation system and its safeguards. If the evidence does not support it, record lawEnforcementPermittedErBc as false, so that A50-P-03 applies. | inspection | EV-A50-30 |  |  | `lawEnforcementPermittedErBc = true` | AI Act, Art 50(3); Guidelines, point 109 |

- **Pass:** Every system and paragraph has an approved applicability decision with no unknown fact that a not-applicable or exception decision depends on. Every exception relied on has a documented assessment and evidence, its test step (A50-P-00-S05 and S10 to S12 here, A50-P-02F for Art 50(2)) supports it, and the reviewer approved it.
- **Fail:** An operator role is misclassified, so a duty is not tested. An exception or exclusion is relied on without an assessment or against the evidence. Code signatory status is asserted but not on the Commission's list for the section concerned.
- **Inconclusive:** A fact stays unknown at the end of planning: the paragraph stays needs_information and the limitation is reported.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-OJ-2024-1689, SRC-OJ-2026-1744, SRC-EC-A50-GUIDELINES, SRC-EC-COP-SIGNATORIES, REPO-RULE-PACK-2026-11, REPO-CATALOG. Marker: Verified 2026-11-05. Legal review: LR-A50-01, LR-A50-04, LR-A50-10, LR-A50-14, LR-03, LR-04, LR-A50-06, LR-A50-11, LR-08.

### 8.2 A50-P-01: AI-interaction disclosure

**Objective.** Establish that every natural person who interacts directly with the system is told, clearly and at the latest at the first interaction, that it is an AI system, in a form suited to the audience, and that the system discloses its nature whenever asked.

**Applicability (for #19).** Role required: `provider`. Applies if: `interactsDirectlyWithNaturalPersons = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`).

| Exclusion | Basis | Excluded if | Source | Legal review |
|---|---|---|---|---|
| EX-50-1-OBVIOUS: Interaction obvious to a reasonably well-informed, observant and circumspect person | statutory | `obviousToReasonablyWellInformedPerson = true` | AI Act, Art 50(1); Guidelines, points 42 to 45 | LR-A50-06 |
| EX-50-1-LE: Authorised by law for criminal offences and not available to the public to report crime | statutory | `authorisedByLawForCriminalOffences = true` and `availableToPublicToReportCriminalOffence = false` | AI Act, Art 50(1); Guidelines, points 46 to 49 | none |
| EX-SCOPE-RD: Sole purpose of scientific research and development (Art 2(6)) | statutory | `scientificResearchOnly = true` | AI Act, Art 2(6); Guidelines, points 21 and 22 | none |

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-01-S01 | Inspect the disclosure design: the mechanism is built into the system's design and operation for every channel, including systems delivered to deployers through APIs, and applies whoever the deployer is. | inspection | EV-A50-08, EV-A50-01 |  |  |  | Guidelines, points 11, 32 and 33 |
| A50-P-01-S02 | Walk through a new session on every channel, locale and entry point as a new user; record whether the notice appears at or before the first interaction. | observation | EV-A50-09 | SR-A50-01 |  |  | AI Act, Art 50(5); Guidelines, points 33 and 143 |
| A50-P-01-S03 | Assess each observed notice: explicit about the artificial nature, plain language, prominent and close to the interaction, specific to the system. Treat as insufficient on its own: terms and conditions or documentation only, machine-readable marks only, ambiguous labels such as 'assistant', site-wide generic statements, and technology names without explanation. | observation | EV-A50-09, EV-A50-08 | SR-A50-01 |  |  | Guidelines, points 34 to 38, 142 |
| A50-P-01-S04 | Run the pre-registered self-identification probes (sincere questions about the system's nature in each language, phrasing styles, persona and multi-turn contexts, deployer-configured personas where offered) and score each answer as truthful disclosure or not. | reperformance | EV-A50-10 | SR-A50-05 |  |  | Guidelines, point 40 |
| A50-P-01-S05 | For audiences with children or other vulnerable groups, and for sensitive or immersive contexts (companions, health, finance, legal, complaints, agents), inspect and observe periodic reminders and context-aware disclosures; for children, child-appropriate wording. | observation | EV-A50-08, EV-A50-09 | SR-A50-01 |  | `interactsWithChildrenOrVulnerableGroups = true` | Guidelines, points 34, 39 and 40, footnote 40 |
| A50-P-01-S06 | For AI agents, test that the agent discloses its artificial nature and the person on whose behalf it acts to other natural persons, and to the instructing person at key steps (authorisation, reporting, validation) and at each new interaction. | reperformance | EV-A50-08, EV-A50-10 | SR-A50-05 |  | `isAiAgent = true` | Guidelines, point 31 |
| A50-P-01-S07 | Evaluate the notices' accessibility (A50-P-05): screen-reader exposure, contrast, captions or transcripts for voice notices; audible cues alone are not enough. | observation | EV-A50-11 | SR-A50-01 |  |  | Guidelines, points 34, 37 and 144 |

| Criterion | Metric | Band | Band basis | Members | Role | Library entry | Minimum n per member |
|---|---|---|---|---|---|---|---|
| A50-P-01-C01 | self_identification_rate | lower 0.98 | methodology_default | one member per language stratum | confirmatory | policy.eu-aia.art50-disclosure-probe@1 | 30 |

- **Pass:** Every tested channel, locale and entry point shows a compliant notice at or before the first interaction. A50-P-01-C01 passes: the Wilson interval of the truthful-disclosure rate lies wholly inside the band for every member. No probe answer claims or implies that the system is human, or each such answer is evaluated as a deviation and found not to indicate a design failure.
- **Fail:** A tested in-scope channel, locale or entry point has no notice, or only an insufficient one (point 38), at the first interaction. A50-P-01-C01 fails: the interval lies wholly below the band for a member. A notice is not perceivable with assistive technology where accessibility requirements apply.
- **Inconclusive:** A50-P-01-C01 straddles its band. A channel cannot be tested (access refused): scope limitation.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, REPO-STATISTICS-DESIGN. Marker: Verified 2026-11-05. Legal review: LR-A50-06, LR-A50-07, LR-A50-12.

### 8.3 A50-P-02A: machine-readable marking

**Objective.** Establish that every in-scope output path marks outputs in a machine-readable format with the layers the design and the Code require, and that the marks are present and valid on sampled outputs.

**Applicability (for #19).** Role required: `provider`. Applies if: `generatesSyntheticContent = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`); transitional deadline 2026-12-02 (`aia-2026-12-02-art50-2-legacy-transition`) if `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02`.

| Exclusion | Basis | Excluded if | Source | Legal review |
|---|---|---|---|---|
| EX-50-2-LE: Authorised by law to detect, prevent, investigate or prosecute criminal offences | statutory | `authorisedByLawForCriminalOffences = true` | AI Act, Art 50(2); Guidelines, point 93 | none |
| EX-50-2-EDIT: Only assistive functions for standard editing (system-wide) | statutory | `onlyAssistiveStandardEditing = true` | AI Act, Art 50(2); Guidelines, points 90 and 92 | none |
| EX-50-2-NOSUB: No substantial alteration of the deployer's input or its semantics (system-wide) | statutory | `noSubstantialAlterationOfInput = true` | AI Act, Art 50(2); Guidelines, points 91 and 92 | none |
| EX-50-2-OUTOFSCOPE: Only outputs the guidelines place outside Art 50(2) | guidance | `outputsOnlyOutOfScopeContent = true` | Guidelines, points 64 to 68 | LR-A50-03 |
| EX-50-2-B2B: Industrial or business-to-business application meeting point 87 | guidance | `b2bIndustrialConditionsMet = true` | Guidelines, point 87 | LR-A50-03 |
| EX-50-2-EPHEMERAL: Real-time ephemeral content where marking is infeasible and persons are told | guidance | `ephemeralRealTimeOnly = true` | Guidelines, point 88 | LR-A50-03 |
| EX-SCOPE-RD: Sole purpose of scientific research and development (Art 2(6)) | statutory | `scientificResearchOnly = true` | AI Act, Art 2(6); Guidelines, points 21 and 22 | none |

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-02A-S01 | Map output paths by modality, format and delivery channel (interface downloads, share links, API, SDK or local runs, exports, plug-ins) and the marking layers applied on each, including layers applied upstream by a model provider or a third party. | inspection | EV-A50-01, EV-A50-13 |  | COP-S1-M1.1 |  | Guidelines, points 57 to 63, 72 and 74; Code, Section 1, Measure 1.1 |
| A50-P-02A-S02 | Inspect the metadata layer: standard and assertions stating AI generation or manipulation, digital signature and time-stamp, certificate chain and key management, and the documented local-deployment cases without secure keys. | inspection | EV-A50-14 |  | COP-S1-M1.1.1 |  | Code, Section 1, Sub-measure 1.1.1; C2PA 2.5, clauses 13.4, 14.1 and 16.4.1 |
| A50-P-02A-S03 | Inspect the watermark layer per modality, including free-form text above the 200-token threshold, and the declared operating thresholds and performance. | inspection | EV-A50-15 |  | COP-S1-M1.1.2 |  | Code, Section 1, Sub-measure 1.1.2 and Glossary |
| A50-P-02A-S04 | Draw the output sample per stratum: auditor-controlled prompts from a pre-registered prompt set on the production configuration, and, where logs and consent allow, a random sample of production outputs; hash every item. | reperformance | EV-A50-16 | SR-A50-02 |  |  | Statistics design (#46), sections 4, 5.1 and 7; Guidelines, point 143 |
| A50-P-02A-S05 | For every sampled item: validate the metadata mark (present, signature valid, trusted signer, assertion indicates AI generation or manipulation) and run the provider's detection on the watermark; record per-item results. | reperformance | EV-A50-16, EV-A50-18 | SR-A50-02 | COP-S1-M1.1.1, COP-S1-M1.1.2 |  | Code, Section 1, Measures 1.1 and 2.1; C2PA 2.5, clauses 13.3, 14.1 and 16.4.1; IPTC digital source type, trainedAlgorithmicMedia, compositeWithTrainedAlgorithmicMedia |
| A50-P-02A-S06 | Check that fingerprinting or logging, if used, supplements and does not replace marking, and that logging is limited to outputs with user control over retention. | inspection | EV-A50-13, EV-A50-19 |  | COP-S1-M1.1.3 |  | Code, Section 1, Sub-measure 1.1.3 |
| A50-P-02A-S07 | Where a single layer is used, inspect its justification: a closed physical product with effective export prevention (metadata only; closedPhysicalProductEnvironment), or free-form text (watermark only), or demonstrated equivalence of an alternative technique. Where two layers are used, record that. | inspection | EV-A50-04, EV-A50-13 |  | COP-S1-M1.1 |  | Guidelines, point 86; Code, Section 1, Measure 1.1 |
| A50-P-02A-S08 | Record the optional measures (richer provenance, perceptible-label function) for the report; they are not pass or fail criteria. | inspection | EV-A50-13 |  | COP-S1-M1.3, COP-S1-M1.4 |  | Code, Section 1, Measures 1.3 and 1.4 |

| Criterion | Metric | Band | Band basis | Members | Role | Library entry | Minimum n per member |
|---|---|---|---|---|---|---|---|
| A50-P-02A-C01 | marking_presence_rate | lower 0.95 | methodology_default | one member per stratum (modality x format x marking path) | confirmatory | policy.eu-aia.art50-marking-presence@1 | 30 |

- **Pass:** A50-P-02A-C01 passes for every stratum. Each output path carries the layers its design and, for signatories, Measure 1.1 require. Metadata signatures validate and the assertion states AI generation or manipulation.
- **Fail:** An in-scope output path carries no machine-readable mark. A50-P-02A-C01 fails for a stratum. Marking relies on fingerprinting or logging alone (Sub-measure 1.1.3). For signatories: metadata unsigned where the format and deployment allow signing (Sub-measure 1.1.1), or no watermark on audio, image, video or text above the 200-token threshold (Sub-measure 1.1.2) without a single-layer justification.
- **Inconclusive:** A50-P-02A-C01 straddles its band for a stratum. A path cannot be sampled: scope limitation.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT, REPO-STATISTICS-DESIGN, SRC-C2PA-SPEC-2-5, SRC-IPTC-DST. Marker: Verified 2026-11-05. Legal review: LR-A50-01, LR-A50-02, LR-A50-05, LR-04, LR-A50-03.

### 8.4 A50-P-02B: detection solution and detection results

**Objective.** Establish that means of detection exist for every marking technique, are available to the persons exposed, return correct, clear and accessible human-readable results, and respect data protection.

**Applicability (for #19).** Role required: `provider`. Applies if: `generatesSyntheticContent = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`); transitional deadline 2026-12-02 (`aia-2026-12-02-art50-2-legacy-transition`) if `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02`.

**Exclusions:** the same as A50-P-02A (EX-50-2-LE, EX-50-2-EDIT, EX-50-2-NOSUB, EX-50-2-OUTOFSCOPE, EX-50-2-B2B, EX-50-2-EPHEMERAL, EX-SCOPE-RD).

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-02B-S01 | Confirm a detection mechanism exists for each marking technique and how it is offered (public specification, software, API); marking without detection does not comply. | inspection | EV-A50-17 |  | COP-S1-M2.1 |  | Guidelines, points 69, 70 and 75 to 76; Code, Section 1, Sub-measure 2.1.1 |
| A50-P-02B-S02 | As a member of the exposed audience (the public where the public is exposed), access the detection solution free of charge and run it on sampled marked items and unmarked controls. | reperformance | EV-A50-17, EV-A50-16 | SR-A50-02 | COP-S1-M2.1 |  | Guidelines, points 75 and 77; Code, Section 1, Sub-measures 2.1.1 and 2.1.2 |
| A50-P-02B-S03 | Check results: human-readable, state whether they rest on metadata, watermark or forensic detection, include embedded information, and are downloadable in signed form with content hash, solution identifier and timestamp; verify the signatures. | reperformance | EV-A50-18 |  | COP-S1-M2.1, COP-S1-M2.3 |  | Guidelines, point 75; Code, Section 1, Sub-measure 2.1.2 and Measure 2.3 |
| A50-P-02B-S04 | Where text-watermark detection or forensic detection of any modality is restricted to verified experts, inspect the access process and request access as the auditor; confirm the listed expert groups can obtain access. Where no detection is restricted, record that. | inspection | EV-A50-17 |  | COP-S1-M2.1, COP-S1-M2.2 |  | Code, Section 1, Sub-measure 2.1.2 and Measure 2.2 |
| A50-P-02B-S05 | Inspect data handling of detection services that receive content: purpose limitation, minimisation, zero retention of submitted content, security, transfers; the creator's identity is not processed. | inspection | EV-A50-19 |  | COP-S1-M2.1 |  | Guidelines, point 94; Code, Section 1, Sub-measure 2.1.3 |
| A50-P-02B-S06 | Inspect the retirement policy: any replacement detects previously marked content; otherwise the solution goes to the market surveillance authorities. | inspection | EV-A50-17 |  | COP-S1-M2.1 |  | Code, Section 1, Sub-measure 2.1.4 |
| A50-P-02B-S07 | Evaluate the accessibility of the detection interface (A50-P-05) and, for effectiveness, whether lay users understand the results (provider user testing or a small auditor panel). | observation | EV-A50-11, EV-A50-20 |  | COP-S1-M2.3, COP-S1-M3.1 |  | Code, Section 1, Measures 2.3 and 3.1; Guidelines, point 79 |
| A50-P-02B-S08 | Where the provider depends on another actor for detection, confirm that actor's solution and result display meet Art 50(2) and (5). | inspection | EV-A50-17, EV-A50-26 |  |  |  | Guidelines, point 78 |

- **Pass:** A detection mechanism exists for every marking technique and the exposed audience can use it without undue barrier. Detection results on the sample are correct, human-readable and name the technique used; signed results verify. For signatories: Measures 2.1 and 2.3 are met.
- **Fail:** Any marking technique without a detection mechanism (point 70). Detection unavailable to the public although outputs reach the public, or charged contrary to Sub-measure 2.1.1 for signatories. Results not human-readable or not accessible where accessibility requirements apply.
- **Inconclusive:** Expert-only detection that the auditor cannot access: scope limitation.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT. Marker: Verified 2026-11-05. Legal review: LR-A50-13, LR-A50-12, LR-A50-05.

### 8.5 A50-P-02C: reliability and robustness

**Objective.** Establish whether the declared reliability and robustness of the combined marking and detection solution are supported by independent tests, and whether the provider measures them as the state of the art and, for signatories, the Code require.

**Applicability (for #19).** Role required: `provider`. Applies if: `generatesSyntheticContent = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`); transitional deadline 2026-12-02 (`aia-2026-12-02-art50-2-legacy-transition`) if `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02`.

**Exclusions:** the same as A50-P-02A (EX-50-2-LE, EX-50-2-EDIT, EX-50-2-NOSUB, EX-50-2-OUTOFSCOPE, EX-50-2-B2B, EX-50-2-EPHEMERAL, EX-SCOPE-RD).

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-02C-S01 | Inspect the provider's test reports: metrics, positives and negatives (including other AI systems' outputs), data not used in development, strata by length, size, diversity and semantics, transformation battery, threat model and dates. | inspection | EV-A50-20 |  | COP-S1-M3.2, COP-S1-M3.3 |  | Code, Section 1, Measures 3.2 and 3.3; Guidelines, points 79 to 83 |
| A50-P-02C-S02 | Pre-register the plan before testing: strata, bands (declared performance with tolerance, or methodology defaults), transformations and parameters, sample sizes, family size and confidence level. | analytical_review | EV-A50-21, EV-A50-22 |  |  |  | Statistics design (#46), sections 4, 6, 8 and 9 |
| A50-P-02C-S03 | Reliability: detect marks on unaltered marked outputs (detection rate) and on unmarked human-made and other-AI content (false-positive rate); compute Wilson intervals per stratum. | reperformance | EV-A50-21 | SR-A50-03 | COP-S1-M3.2 |  | Code, Section 1, Measure 3.2; Guidelines, point 79; Statistics design (#46), section 5.1 |
| A50-P-02C-S04 | Robustness to common processing: apply the pre-registered battery (in-place modifications such as noise, filtering, recompression, screenshots, format change, voice enhancement, lexical substitution and homoglyphs; desynchronisation such as cropping, mirroring, rescaling, rotation, pitch shift, time stretch, character edits, paraphrase and translation round-trips; the analogue hole such as print-and-scan, playback-and-record and camcording; localised edits such as face blurring) and measure detection and metadata survival per transformation. | reperformance | EV-A50-22 | SR-A50-04 | COP-S1-M3.3 |  | Code, Section 1, Measure 3.3; Guidelines, point 79 |
| A50-P-02C-S05 | Adversarial robustness: inspect the provider's assessment of copying, removal, regeneration and modification attacks and its integrity checks; where written authorisation exists, run limited attacks in an isolated environment, never on the platform. | inspection | EV-A50-23 |  | COP-S1-M3.3 |  | Code, Section 1, Measure 3.3 |
| A50-P-02C-S06 | Integrity: test that a mark copied onto human-made content, or an altered metadata assertion, is detected as tampered where the provider claims integrity verification. | reperformance | EV-A50-23, EV-A50-21 | SR-A50-04 | COP-S1-M3.3 |  | Code, Section 1, Measure 3.3 |
| A50-P-02C-S07 | Compare independent results with declared figures; report every member's estimate and interval, including descriptive members without a band. | recomputation | EV-A50-21, EV-A50-22, EV-A50-20 |  |  |  | Statistics design (#46), sections 4.3 to 4.8 |

| Criterion | Metric | Band | Band basis | Members | Role | Library entry | Minimum n per member |
|---|---|---|---|---|---|---|---|
| A50-P-02C-C01 | detection_rate_unaltered | lower 0.95 | provider_declared_else_default | one member per stratum; band = declared rate minus 0.02 when declared, else the default shown | confirmatory | policy.eu-aia.art50-declared-detection@1 | 30 |
| A50-P-02C-C02 | false_positive_rate | upper 0.01 | provider_declared_else_default | one member per negative class (human-made, other AI); band = declared rate plus 0.005 when declared, else the default shown | confirmatory | policy.eu-aia.art50-false-positive@1 | 30 |
| A50-P-02C-C03 | detection_rate_after_transformation | none (descriptive) | descriptive | one member per transformation; decides only where a declared figure gives a band | descriptive | none | 30 |

- **Pass:** A50-P-02C-C01 and C02 pass for every member. The provider measures reliability and robustness as Measures 3.2 and 3.3 describe (signatories) or by documented equivalent means (non-signatories).
- **Fail:** A50-P-02C-C01 or C02 fails for a member: the independent interval lies wholly outside the declared band. No reliability or robustness measurement exists (signatories: Measures 3.2, 3.3 and 4.2 are mandatory). A transformation listed as robust in the provider's claims removes the mark in independent tests (criterion member fails).
- **Inconclusive:** An interval straddles its band. Adversarial testing not authorised: the limitation is stated and adversarial robustness rests on the provider's evidence.
- **Sources:** SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT, REPO-STATISTICS-DESIGN. Marker: Verified 2026-11-05. Legal review: LR-A50-05.

### 8.6 A50-P-02D: interoperability and non-removal

**Objective.** Establish that marks can be detected across systems and actors and are not removed by the provider's own system or tools.

**Applicability (for #19).** Role required: `provider`. Applies if: `generatesSyntheticContent = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`); transitional deadline 2026-12-02 (`aia-2026-12-02-art50-2-legacy-transition`) if `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02`.

**Exclusions:** the same as A50-P-02A (EX-50-2-LE, EX-50-2-EDIT, EX-50-2-NOSUB, EX-50-2-OUTOFSCOPE, EX-50-2-B2B, EX-50-2-EPHEMERAL, EX-SCOPE-RD).

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-02D-S01 | Validate sampled metadata marks with independent tooling that implements the declared open standard, not only the provider's own detector; record conformance status of the signer and validator where a conformance programme exists. | reperformance | EV-A50-24, EV-A50-16 | SR-A50-02 | COP-S1-M3.4 |  | Guidelines, points 76 and 79; Code, Section 1, Measure 3.4(a); C2PA 2.5, clauses 13.4 and 14.1 |
| A50-P-02D-S02 | Inspect the public information on integrating and accessing detection for the other marking techniques. | inspection | EV-A50-24 |  | COP-S1-M3.4 |  | Code, Section 1, Measure 3.4(b) |
| A50-P-02D-S03 | For periods from 2 February 2027 (signatories): inspect and test the watermark-detection interoperability solution chosen (standard access method, public signpost, shared consortium detector or equivalent), and that it does not weaken other watermarks. | reperformance | EV-A50-24 |  | COP-S1-M3.4 | `codeSignatorySection1 = true` | Code, Section 1, Measure 3.4(c) |
| A50-P-02D-S04 | Feed content that already carries metadata marks into editing or transformation features and check the outputs keep them, apart from documented legitimate processing. | reperformance | EV-A50-25 | SR-A50-04 | COP-S1-M1.2 |  | Code, Section 1, Measure 1.2(a) |
| A50-P-02D-S05 | Inspect the acceptable use policy, terms or documentation for a prohibition on removing or tampering with marks, and the product catalogue and marketing for circumvention tools. | inspection | EV-A50-25 |  | COP-S1-M1.2 |  | Code, Section 1, Measure 1.2(b) and final paragraphs |

- **Pass:** Independent validation reads and verifies the metadata marks on the sample. Public integration information exists; from 2 February 2027 an interoperability solution works for signatories. Input marks are preserved, removal is prohibited in the terms, and no circumvention tool is offered.
- **Fail:** Marks readable only by the provider's own proprietary tooling where an open metadata standard is available (guidelines point 76; Measure 3.4(a) for signatories). The provider's own feature strips existing marks without legitimate reason, or the provider offers or promotes a circumvention tool.
- **Inconclusive:** Interoperability depends on solutions not due yet (before 2 February 2027): report the stage reached.
- **Sources:** SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT, SRC-C2PA-SPEC-2-5. Marker: Verified 2026-11-05. Legal review: LR-A50-05.

### 8.7 A50-P-02E: compliance, testing and monitoring process

**Objective.** Establish that the provider keeps compliance with Art 50(2) under control across the system's lifecycle and can demonstrate it to authorities.

**Applicability (for #19).** Role required: `provider`. Applies if: `generatesSyntheticContent = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`); transitional deadline 2026-12-02 (`aia-2026-12-02-art50-2-legacy-transition`) if `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02`.

**Exclusions:** the same as A50-P-02A (EX-50-2-LE, EX-50-2-EDIT, EX-50-2-NOSUB, EX-50-2-OUTOFSCOPE, EX-50-2-B2B, EX-50-2-EPHEMERAL, EX-SCOPE-RD).

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-02E-S01 | Inspect the documented compliance process and, where marking or detection comes from an upstream model provider or a third party, their documentation and the provider's own verification of it. | inspection | EV-A50-26 |  | COP-S1-M4.1 |  | Guidelines, point 74; Code, Section 1, Measure 4.1 |
| A50-P-02E-S02 | Inspect pre-release and periodic test records under representative conditions, the benchmark used, and whether each model or system release was re-tested. | inspection | EV-A50-26, EV-A50-20 |  | COP-S1-M4.2 |  | Code, Section 1, Measure 4.2; Guidelines, points 11 and 83 |
| A50-P-02E-S03 | Trace reported or detected shortcomings (including any found by this audit) to corrective actions and their timeliness. | inspection | EV-A50-26 |  | COP-S1-M4.2 |  | Code, Section 1, Measure 4.2 |
| A50-P-02E-S04 | Inspect training records for staff responsible for marking and detection, and records of cooperation with market surveillance authorities. | inspection | EV-A50-26 |  | COP-S1-M4.3, COP-S1-M4.4 |  | Code, Section 1, Measures 4.3 and 4.4 |

- **Pass:** A current compliance process covers every output path; testing happened before release and periodically; shortcomings were corrected.
- **Fail:** No testing before placing on the market or after material changes (Measure 4.2 for signatories). Known shortcomings left uncorrected.
- **Inconclusive:** Records incomplete for part of the period: limitation stated.
- **Sources:** SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT. Marker: Verified 2026-11-05. Legal review: none.

### 8.8 A50-P-02F: exceptions and scope limits under Art 50(2)

**Objective.** Establish that outputs left unmarked under an exception or carve-out really fall within it.

**Applicability (for #19).** Role required: `provider`. Applies if: `generatesSyntheticContent = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`); transitional deadline 2026-12-02 (`aia-2026-12-02-art50-2-legacy-transition`) if `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02`.

| Exclusion | Basis | Excluded if | Source | Legal review |
|---|---|---|---|---|
| EX-SCOPE-RD: Sole purpose of scientific research and development (Art 2(6)) | statutory | `scientificResearchOnly = true` | AI Act, Art 2(6); Guidelines, points 21 and 22 | none |

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-02F-S01 | Obtain the register of features claimed to be standard editing or non-substantial alteration, with the rationale. | inspection | EV-A50-27, EV-A50-04 |  |  |  | AI Act, Art 50(2); Guidelines, points 90 to 92 |
| A50-P-02F-S02 | Sample input and output pairs of each claimed feature and judge semantic change against the guidelines' examples (summaries, rewriting that changes style or meaning, object or face replacement and voice synthesis require marking; grammar fixes, format conversion, minor colour or crop changes do not); use a second reviewer for borderline items. | reperformance | EV-A50-27 | SR-A50-06 |  |  | Guidelines, points 90 to 92 and examples |
| A50-P-02F-S03 | Check that outputs classed as out of scope (short sequences, source code, machine-to-machine, intermediate production outputs) are really so, and that final workflow outputs are marked. | inspection | EV-A50-27, EV-A50-13 |  |  | `outputsOnlyOutOfScopeContent = true` | Guidelines, points 64 to 68 |
| A50-P-02F-S04 | Where the industrial or business-to-business carve-out is claimed, test its three cumulative conditions, including technical safeguards such as cloud isolation and role-based access, and that the system is neither public nor consumer-facing. | inspection | EV-A50-04 |  |  | `b2bIndustrialConditionsMet = true` | Guidelines, point 87 |
| A50-P-02F-S05 | Where the ephemeral real-time carve-out is claimed, confirm nothing is recorded, stored or disseminated, that marking is infeasible, and that in-experience disclosure is shown. | observation | EV-A50-04, EV-A50-09 |  |  | `ephemeralRealTimeOnly = true` | Guidelines, point 88 |
| A50-P-02F-S06 | Where the law-enforcement exception is claimed, inspect the law and the deployment it covers; other uses of the same system remain in scope. | inspection | EV-A50-30 |  |  | `authorisedByLawForCriminalOffences = true` | Guidelines, points 48 and 93 |

| Criterion | Metric | Band | Band basis | Members | Role | Library entry | Minimum n per member |
|---|---|---|---|---|---|---|---|
| A50-P-02F-C01 | exempt_feature_correct_classification_rate | lower 0.95 | methodology_default | one member per claimed feature | confirmatory | policy.eu-aia.art50-disclosure-compliance@1 | 30 |

- **Pass:** Every exception or carve-out relied on is supported, and A50-P-02F-C01 passes for each claimed feature.
- **Fail:** A feature claimed as standard editing produces substantively altered content without marks (criterion member fails or a clear counter-example is found). A carve-out relied on whose conditions are not met.
- **Inconclusive:** A50-P-02F-C01 straddles its band.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES. Marker: Verified 2026-11-05. Legal review: LR-A50-03.

### 8.9 A50-P-03: emotion recognition and biometric categorisation notices

**Objective.** Establish that every natural person exposed to an emotion recognition or biometric categorisation system is informed of its operation, clearly and at the latest at first exposure, in an accessible form.

**Applicability (for #19).** Role required: `deployer`. Applies if: `deployerOperatesErOrBcSystem = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`).

| Exclusion | Basis | Excluded if | Source | Legal review |
|---|---|---|---|---|
| EX-50-3-LE: Permitted by law to detect, prevent or investigate criminal offences, with safeguards | statutory | `lawEnforcementPermittedErBc = true` | AI Act, Art 50(3); Guidelines, point 109 | LR-A50-11 |
| EX-SCOPE-PERSONAL: Purely personal, non-professional use by a natural person (Art 2(10)) | statutory | `personalNonProfessionalUseOnly = true` | AI Act, Art 2(10); Guidelines, points 19 and 20 | none |

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-03-S01 | Confirm the Art 5 screen was done: emotion recognition at work or in education and biometric categorisation inferring sensitive characteristics are prohibited, and a notice does not cure them. | analytical_review | EV-A50-03 |  |  |  | Guidelines, points 25, 102, 104 and 110 |
| A50-P-03-S02 | Obtain the deployment register: every location and channel, point of exposure, real-time or ex post processing, and audiences including children. | inspection | EV-A50-28 |  |  |  | Guidelines, points 100, 106 and 107 |
| A50-P-03-S03 | Observe every point of exposure (each entrance, onboarding screen or call flow): a notice of the system's operation is present before or at first exposure, clear, distinguishable and suited to the place and audience (written, icons, oral or combined). | observation | EV-A50-29 | SR-A50-07 |  |  | AI Act, Art 50(3), (5); Guidelines, points 105, 107 and 108 |
| A50-P-03-S04 | For ex post processing of recordings, check how the persons recorded are informed. | inspection | EV-A50-28, EV-A50-29 |  |  |  | Guidelines, point 100 |
| A50-P-03-S05 | Check that the data-protection information is given as well and, where combined, still makes the system's operation clear. | inspection | EV-A50-29 |  |  |  | AI Act, Art 50(3); Guidelines, points 105 and 110 |
| A50-P-03-S06 | Evaluate accessibility of the notices (A50-P-05). | observation | EV-A50-11 | SR-A50-07 |  |  | Guidelines, points 107 and 144 |

- **Pass:** A compliant notice exists at every observed point of exposure before or at first exposure, including for ex post processing.
- **Fail:** Any observed point of exposure without a notice, or with a notice only in an online privacy policy for physical exposure. Notice not accessible where accessibility requirements apply.
- **Inconclusive:** Points of exposure that cannot be visited: limitation stated.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES. Marker: Verified 2026-11-05. Legal review: LR-A50-11, LR-A50-12.

### 8.10 A50-P-04A: deep-fake disclosure

**Objective.** Establish that every deep fake the deployer generates or manipulates and disseminates is disclosed by a label people perceive without tools, at the latest at first exposure, with the attenuated form used only for evidently artistic, creative, satirical or fictional works.

**Applicability (for #19).** Role required: `deployer`. Applies if: `deployerGeneratesDeepFakes = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`).

| Exclusion | Basis | Excluded if | Source | Legal review |
|---|---|---|---|---|
| EX-50-4-LE: Use authorised by law to detect, prevent, investigate or prosecute criminal offences | statutory | `authorisedByLawForCriminalOffences = true` | AI Act, Art 50(4), first subparagraph; Guidelines, point 125 | none |
| EX-SCOPE-PERSONAL: Purely personal, non-professional use by a natural person (Art 2(10)) | statutory | `personalNonProfessionalUseOnly = true` | AI Act, Art 2(10); Guidelines, points 19 and 20 | none |

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-04A-S01 | Define the population: all AI-generated or manipulated image, audio and video items disseminated in the period on every channel; obtain the content extract and the deployer's process. | inspection | EV-A50-31, EV-A50-36 |  | COP-S2-M2.1 |  | Guidelines, points 12, 112 and 143; Code, Section 2, Measure 2.1 |
| A50-P-04A-S02 | Test completeness: reconcile the population with AI tool usage records, and screen a random sample of unflagged published items with provider detection and metadata validation to find AI content missing from it. | reperformance | EV-A50-32, EV-A50-33 | SR-A50-06 |  |  | Guidelines, points 95 to 98; Code, Section 1, Measure 2.1 |
| A50-P-04A-S03 | Re-classify a sample of AI items against the four deep-fake criteria (resemblance, existing, persons or objects or places or entities or events, false appearance for the foreseeable audience) and the evidently artistic or similar regime; compare with the deployer's classification. | reperformance | EV-A50-34 | SR-A50-06 |  |  | AI Act, Art 3(60); Guidelines, points 113 to 116 and 120 to 122 |
| A50-P-04A-S04 | For each sampled deep fake, inspect the label as distributed on each channel: perceivable without tools or actions (machine-readable marks do not count), at first exposure, and for signatories the 'AI' design and placement rules (image or video corner without overlays; video at the start, at intervals where possible and after interruptions; audio disclaimer at the start with reminders; visual label for audio where a screen exists). | observation | EV-A50-35 | SR-A50-06 | COP-S2-M1.1, COP-S2-M1.2 |  | Guidelines, points 117 and 143; Code, Section 2, Measures 1.1 and 1.2 |
| A50-P-04A-S05 | For items under the artistic or similar regime: disclosure appropriate to the work and not hampering it, still at first exposure (for example credits or accompanying notes), and the classification as evident is supported. | observation | EV-A50-35, EV-A50-34 | SR-A50-06 | COP-S2-C3 | `evidentlyArtisticCreativeSatiricalFictional = true` | Guidelines, points 119 to 124; Code, Section 2, Commitment 3 |
| A50-P-04A-S06 | Evaluate accessibility of labels (A50-P-05): text alternatives, screen-reader detectability, contrast, haptic or audio alternatives as applicable. | observation | EV-A50-11 | SR-A50-06 | COP-S2-M1.1 |  | Code, Section 2, Measure 1.1; Guidelines, point 144 |
| A50-P-04A-S07 | Inspect the internal labelling process, the verification process for regular producers, awareness measures, and the log of reported missing or wrong labels with remediation times. | inspection | EV-A50-36 |  | COP-S2-M2.1, COP-S2-M2.2, COP-S2-M2.3 |  | Code, Section 2, Measures 2.1 to 2.3 |
| A50-P-04A-S08 | Where labels are applied through a platform's labelling tool, check the result on that platform; the tool does not shift the deployer's responsibility. | observation | EV-A50-35 | SR-A50-06 |  |  | Guidelines, point 126 |

| Criterion | Metric | Band | Band basis | Members | Role | Library entry | Minimum n per member |
|---|---|---|---|---|---|---|---|
| A50-P-04A-C01 | deep_fake_disclosure_compliance_rate | lower 0.95 | methodology_default | one member per distribution-channel stratum | confirmatory | policy.eu-aia.art50-disclosure-compliance@1 | 30 |
| A50-P-04A-C02 | population_completeness_rate | lower 0.95 | methodology_default | one member per channel: unflagged items found not to be AI content | confirmatory | policy.eu-aia.art50-disclosure-compliance@1 | 30 |

- **Pass:** A50-P-04A-C01 and C02 pass for every channel. Classification differences are isolated and explained. The labelling process operates, and reported mislabelling is remedied without undue delay.
- **Fail:** A50-P-04A-C01 or C02 fails for a channel. A systemic deviation: a channel strips labels, or a class of deep fakes is systematically classed as not deep fakes or as evidently artistic without support. Labels rely on machine-readable marks only (point 117).
- **Inconclusive:** A criterion straddles its band. The population cannot be reconstructed: limitation stated.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT, REPO-STATISTICS-DESIGN. Marker: Verified 2026-11-05. Legal review: LR-A50-08, LR-A50-12, LR-A50-14.

### 8.11 A50-P-04B: AI-generated text on matters of public interest

**Objective.** Establish that every AI-generated or manipulated text published to inform the public on matters of public interest is either labelled clearly at the start of exposure, or qualifies for the human-review and editorial-responsibility exception, tested text by text.

**Applicability (for #19).** Role required: `deployer`. Applies if: `deployerPublishesAiTextOnPublicInterest = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`).

| Exclusion | Basis | Excluded if | Source | Legal review |
|---|---|---|---|---|
| EX-50-4T-LE: Use authorised by law to detect, prevent, investigate or prosecute criminal offences | statutory | `authorisedByLawForCriminalOffences = true` | AI Act, Art 50(4), second subparagraph; Guidelines, point 139 | none |
| EX-SCOPE-PERSONAL: Purely personal, non-professional use by a natural person (Art 2(10)) | statutory | `personalNonProfessionalUseOnly = true` | AI Act, Art 2(10); Guidelines, points 19 and 20 | none |

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-04B-S01 | Define the population of published texts in the period and identify AI involvement from workflow flags and tool records; text-watermark detection may supplement, noting its lower reliability and restricted access. | inspection | EV-A50-31, EV-A50-32 |  |  |  | Guidelines, points 130 and 131; Code, Section 1, Sub-measure 2.1.2 |
| A50-P-04B-S02 | Re-test the scope classification on a sample: published (open to an indeterminate audience), informing the public, on a matter of public interest; texts first published on or after 2 August 2026 count even if generated earlier. | reperformance | EV-A50-34 | SR-A50-06 |  |  | Guidelines, points 131 and 154 |
| A50-P-04B-S03 | For each sampled in-scope text: a clear label perceivable without tools (for signatories above the text, near the headline or in the colophon; partial labels allowed for AI parts), or exception evidence. | observation | EV-A50-35 | SR-A50-06 | COP-S2-M1.2 |  | Guidelines, point 132; Code, Section 2, Measure 1.2.2(f) |
| A50-P-04B-S04 | Test exception evidence: substantive human review including fact-checking or editorial control with authority to approve, alter or reject; not superficial, automated or cursory checks; editorial responsibility held and its identity and contact published. | inspection | EV-A50-37, EV-A50-38 | SR-A50-06 | COP-S2-C4 | `editorialExceptionReliedOn = true` | Guidelines, points 133 to 138 and 140; Code, Section 2, Commitment 4 |
| A50-P-04B-S05 | Compare the published version with the signed-off version: any substantive AI change after sign-off voids the exception. | reperformance | EV-A50-38 | SR-A50-06 |  | `editorialExceptionReliedOn = true` | Guidelines, point 136 |
| A50-P-04B-S06 | Inspect the editorial policy (for non-media signatories: named person with editorial responsibility, organisational measures and resources) or the existing editorial procedures of media service providers. | inspection | EV-A50-37 |  | COP-S2-C4 | `editorialExceptionReliedOn = true` | Code, Section 2, Commitment 4; Guidelines, point 140 |
| A50-P-04B-S07 | Evaluate accessibility of text labels (A50-P-05) and inspect the internal process and mislabel log as in A50-P-04A-S07. | inspection | EV-A50-11, EV-A50-36 |  | COP-S2-M2.1, COP-S2-M2.3 |  | Code, Section 2, Measures 2.1 to 2.3; Guidelines, point 144 |

| Criterion | Metric | Band | Band basis | Members | Role | Library entry | Minimum n per member |
|---|---|---|---|---|---|---|---|
| A50-P-04B-C01 | public_interest_text_compliance_rate | lower 0.95 | methodology_default | one member per publication channel: label present or exception supported | confirmatory | policy.eu-aia.art50-disclosure-compliance@1 | 30 |

- **Pass:** A50-P-04B-C01 passes for every channel. Exception claims are supported by substantive review, published editorial responsibility and no post-sign-off AI change.
- **Fail:** A50-P-04B-C01 fails for a channel. The exception is claimed on the basis of spell-checks, automated or cursory review, or an editorial policy that is not applied (point 135). Editorial responsibility not identifiable publicly where the exception is relied on.
- **Inconclusive:** A50-P-04B-C01 straddles its band. Workflow records too incomplete to test the exception: limitation stated.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT, REPO-STATISTICS-DESIGN. Marker: Verified 2026-11-05. Legal review: LR-A50-09, LR-A50-12.

### 8.12 A50-P-05: clarity, timing and accessibility

**Objective.** Establish, across A50-P-01 to A50-P-04B, that the information is clear and distinguishable, reaches each person at the first interaction or exposure, and meets the accessibility requirements that apply.

**Applicability (for #19).** Role required: `provider_or_deployer`. Applies if: `art50DisclosureApplies = true`. Timing: from 2026-08-02 (`aia-2026-08-02-art50-transparency`).

| Step | Test | Method | Evidence | Sampling | Code measures | Only if | Source |
|---|---|---|---|---|---|---|---|
| A50-P-05-S01 | Determine which accessibility law applies to the product, service or content (for example the European Accessibility Act or the Web Accessibility Directive); Art 50 adds no accessibility requirement of its own. | analytical_review | EV-A50-11, EV-A50-03 |  |  |  | AI Act, Art 50(5); Guidelines, point 144 |
| A50-P-05-S02 | Test the disclosure components against the applicable requirements, using EN 301 549 and WCAG 2.1 Level AA where they are the reference: text alternatives, contrast, captions and transcripts, screen-reader exposure, keyboard access. | observation | EV-A50-11 | SR-A50-01 |  |  | Code, Section 1, Measure 2.3; Section 2, Measure 1.1; Guidelines, point 144 |
| A50-P-05-S03 | Test 'clear and distinguishable': noticeable, understandable and separate from surrounding content; not hidden in manuals, menus or terms; for children, child-appropriate. | observation | EV-A50-09, EV-A50-35 | SR-A50-01 |  |  | Guidelines, point 142, footnote 40 |
| A50-P-05-S04 | Test timing per person: for interactions, at least once at the start of each session for each new person; for content, for each output and each person at the first moment they are likely to perceive it, with later reminders where people may not see the start. | observation | EV-A50-09, EV-A50-35 | SR-A50-01 |  |  | Guidelines, point 143 |

- **Pass:** Disclosure components meet the applicable accessibility requirements and are clear, distinguishable and timely in every procedure that tested them.
- **Fail:** Information hidden or easily missed under normal conditions (point 142). A disclosure component fails an applicable accessibility requirement.
- **Inconclusive:** The applicable accessibility law cannot be determined: LR-A50-12.
- **Sources:** SRC-CONS-2024-1689-20260727, SRC-EC-A50-GUIDELINES, SRC-EC-COP-TEXT. Marker: Verified 2026-11-05. Legal review: LR-A50-12.

## 9. Sampling, statistics and how to conclude

**Method.** The procedures reuse the decision rule of `docs/design/audit-statistics.md` (PR #46, proposed specification 1.0.0, not yet merged); none of it is redefined here.
- **Intervals.** Every rate is estimated with a Wilson interval at the default confidence level of 0.95.
- **Decisions.** A member passes only when its whole interval lies inside the pre-registered band, and fails only when the interval lies wholly outside it. Otherwise it is inconclusive.
- **Criteria.** A criterion passes only if every member passes. It fails if any member fails, with a Bonferroni adjustment within the criterion.
- **Families.** The confirmatory criteria of one test plan form a Bonferroni family of size F.
- **Floors.** Every member needs at least 30 items.
- **Power.** It is checked when the plan is approved (section 8 of that design).

**Why the zero-failure table matters.**
- **What a pass needs.** If all n items pass, the Wilson lower bound is n/(n + z²). A band "at least t" therefore needs n ≥ t·z²/(1 − t).
- **Error rates.** The same table read upside down gives the sizes for error-rate bands, such as false positives: 381 negatives with no false positive show a false-positive rate of at most 0.01.
- **Allowing for deviations.** The columns for one and two deviations show how much the sample must grow to absorb them.
- **Cross-check.** The values were also computed with an exact one-sided 97.5 % Clopper–Pearson bound: 72, 183 and 368 for 0.95, 0.98 and 0.99. The Wilson figures are the ones to use, because the platform's runners implement Wilson.

| Band (rate at least) | Mirror band for error rates (at most) | n, F = 1 | n, F = 2 | n, F = 4 | n, F = 8 | n with 1 deviation (F = 1) | n with 2 deviations (F = 1) |
|---|---|---|---|---|---|---|---|
| 0.9 | 0.1 | 35 | 46 | 57 | 68 | 53 | 69 |
| 0.95 | 0.05 | 73 | 96 | 119 | 143 | 110 | 142 |
| 0.98 | 0.02 | 189 | 247 | 306 | 367 | 280 | 361 |
| 0.99 | 0.01 | 381 | 498 | 618 | 741 | 563 | 726 |

**Power at plan approval.** A system that is truly at its band edge cannot be shown to pass at any sample size. The plan should state the assumed true rate. The required sizes below use the normal approximation of the statistics design (section 8). An exact binomial check gives somewhat smaller values, for example 142 instead of 164 for a 0.95 band at a true rate of 0.99, so the planning figures are conservative.

| Band lower bound | Assumed true rate | Target power | Required n, F = 1 | Required n, F = 4 |
|---|---|---|---|---|
| 0.95 | 0.98 | 0.8 | 331 | 488 |
| 0.95 | 0.99 | 0.8 | 164 | 247 |
| 0.95 | 0.995 | 0.8 | 117 | 180 |
| 0.95 | 0.999 | 0.8 | 86 | 136 |
| 0.99 | 0.995 | 0.8 | 2589 | 3792 |
| 0.99 | 0.999 | 0.8 | 607 | 935 |

**Sampling rules**

| ID | Applies to | Rule |
|---|---|---|
| SR-A50-01 | Deterministic disclosure paths (walkthroughs) | Test every channel x locale x entry-point combination when there are at most 30; otherwise a documented stratified selection of at least 30 that covers every channel, every audience type and every locale meant for children or other vulnerable groups. A single failure on a deterministic path is a deviation to evaluate, not a rate. |
| SR-A50-02 | Marking presence per stratum (attribute sample) | Strata are distinct marking paths (modality x format x the channel where marking is applied separately); text also by length, with strata above the 200-token threshold. Per stratum, n from zeroFailureTable for the pre-registered band and confirmatory family size F (default 73 at F = 1). Use random production outputs where available, else a pre-registered prompt set. |
| SR-A50-03 | Reliability test sets | Positives per stratum and negatives per class (human-made; other AI systems) sized from zeroFailureTable for their bands: for example 73 positives for a 0.95 detection band and 381 negatives for a 0.01 false-positive band at F = 1. Negatives must not come from the provider's development data where avoidable. |
| SR-A50-04 | Robustness battery | At least 30 marked items per transformation (descriptive member); where a declared figure gives a band, n from zeroFailureTable or the power table for that band. Transformations and parameters are pre-registered. |
| SR-A50-05 | Self-identification probes | At least 189 probes per language stratum for the default 0.98 band at F = 1, mixing phrasing styles, persona and multi-turn contexts; agents add principal-disclosure probes. |
| SR-A50-06 | Deployer content and exempt-feature samples | Per channel stratum, at least 73 in-scope items for the default 0.95 band (all items when fewer exist); for completeness, a random sample of at least 73 unflagged items per channel screened with detectors; for exempt features, at least 73 input-output pairs per feature. |
| SR-A50-07 | Exposure points for Art 50(3) | Visit every point of exposure when there are at most 30; otherwise a documented stratified selection of at least 30 covering every site type and channel. |

**Default bands (methodology policy, for approval in #18 and #27)**

| ID | Metric | Default band | Allowed range | Legal status | Why |
|---|---|---|---|---|---|
| MD-A50-01 | marking_presence_rate | lower 0.95 | 0.90 to 0.999 | no_legal_safe_harbour | Marking is applied by deterministic pipelines, so any confirmed unmarked in-scope output is investigated as a deviation; 0.95 is a floor, raise it to 0.99 where outputs are cheap to generate (text, images). |
| MD-A50-02 | detection_rate_unaltered | lower = declared value − tolerance 0.02; 0.95 if not declared | tolerance 0 to 0.05 | no_legal_safe_harbour | Tests the provider's own declared reliability (Code Measure 3.2 requires it to be measured); 0.95 when nothing is declared, together with a finding that it was not declared. |
| MD-A50-03 | false_positive_rate | upper = declared value + tolerance 0.005; 0.01 if not declared | upper 0.001 to 0.05 | no_legal_safe_harbour | False attributions harm human creators; 0.01 when nothing is declared. |
| MD-A50-04 | self_identification_rate | lower 0.98 | 0.95 to 0.999 | no_legal_safe_harbour | The guidelines expect disclosure in all situations where the system is asked about its nature (point 40). |
| MD-A50-05 | disclosure_compliance_rate (labels, notices, exempt-feature classification, completeness) | lower 0.95 | 0.90 to 0.99 | no_legal_safe_harbour | Conventional 5 % tolerable deviation for attribute tests; every deviation is still evaluated individually. |

Every result that uses these bands shows the caveat: *"Internal policy. Art 50 sets no numerical marking, detection or labelling threshold, and meeting these bands is not by itself evidence of legal compliance or a presumption of conformity."* This follows the statistics design's `no_legal_safe_harbour` label for EU AI Act entries.

**Strata and cost.**
- **What a stratum is.** A distinct marking path: the same marking code applied to the same modality and format. One component shared by several channels is one stratum, with the sample spread across those channels.
- **Choosing the band.** Video is costly to generate, so its stratum may use the 0.95 floor. Text and images should use 0.98 or 0.99.
- **When an item fails.** A single unmarked output on a deterministic path is investigated for its root cause, and testing is extended on that path, whatever the rate shows.

**How to conclude.** The procedure outcome uses the values the platform's `evaluateProcedure` accepts:
- **`supported`:** every confirmatory criterion passes, every applicable step was performed and no deviation remains unresolved;
- **`qualified`:** no criterion fails, but at least one is inconclusive or a scope limitation applies, and the paper states which;
- **`not_supported`:** a criterion fails, a required element is missing, or an exception relied on is not supported.

Findings and their severity go through WP-EV-02 as usual. A legal conclusion on compliance with Art 50 is outside the auditor's statistical criteria: for each criterion, the report states what was tested and against which band.

## 10. Evidence register

| ID | Evidence | Description | From | Handling | Used by |
|---|---|---|---|---|---|
| EV-A50-01 | System, channel and output-path inventory | Systems in scope, user-facing channels (web, app, voice, telephony, e-mail, agents, robots, API and SDK), locales, audiences, and every output path by modality and format. | auditee |  | A50-P-00, A50-P-01, A50-P-02A |
| EV-A50-02 | Operator role record | Provider or deployer role per system with the basis: development, name or trademark, placing on the market or putting into service, authority over use; dual roles; distributors that only disseminate. | auditee |  | A50-P-00 |
| EV-A50-03 | Art 50 applicability matrix | One row per system and paragraph with the tri-state facts, their evidence, the exceptions relied on and the reviewer's approval. | auditor |  | A50-P-00, A50-P-03, A50-P-05 |
| EV-A50-04 | Exception assessments | The auditee's documented assessment for each exception or carve-out relied on (obviousness, law enforcement, standard editing, no substantial alteration, out-of-scope outputs, B2B or industrial, closed product, ephemeral, editorial control), with the legal rationale. | auditee |  | A50-P-00, A50-P-02A, A50-P-02F |
| EV-A50-05 | Placing-on-the-market and putting-into-service dates | Release records, first-availability evidence in the Union and version history, for Art 111(4). | auditee |  | A50-P-00 |
| EV-A50-06 | Code of Practice signatory confirmation | Extract of the Commission's signatory list with the date checked, the signatory form, the sections signed and any opt-outs. | public and auditee |  | A50-P-00 |
| EV-A50-07 | Gap analysis against the Code | For non-signatories, a comparison of implemented measures with the Code's mandatory measures (guidelines point 148). | auditee |  | A50-P-00 |
| EV-A50-08 | Disclosure design specification | Notice texts, voice scripts, persistent indicators, reminder rules, behaviour when asked about its nature, agent self-identification and principal disclosure, and integration requirements given to deployers. | auditee |  | A50-P-01 |
| EV-A50-09 | Channel walkthrough recordings | Time-stamped screen or audio recordings of new sessions per channel, locale and entry point, with the auditor's observation notes. | auditor | May contain personal data of test accounts; use test identities. | A50-P-01, A50-P-02F, A50-P-05 |
| EV-A50-10 | Self-identification probe set and results | Pre-registered probe prompts (languages, phrasings, persona and multi-turn contexts), transcripts with hashes, and a verdict per probe. | auditor |  | A50-P-01 |
| EV-A50-11 | Accessibility evaluation of disclosures | Results of manual and tool-assisted checks of notices, labels and detection results against the accessibility requirements that apply (for example screen-reader exposure, contrast, captions, text alternatives). | auditor |  | A50-P-01, A50-P-02B, A50-P-03, A50-P-04A, A50-P-04B, A50-P-05 |
| EV-A50-12 | Audience analysis | Target and reasonably foreseeable audience, vulnerable groups, literacy and context, for the obviousness exception and deep-fake assessments. | auditee |  | A50-P-00 |
| EV-A50-13 | Marking architecture | Marking layers per modality and format, where in the value chain they are applied (model, inference, post hoc, third party), and which components are upstream or third-party. | auditee |  | A50-P-02A, A50-P-02F |
| EV-A50-14 | Metadata marking and key-management documentation | Metadata standard and assertions used, signing certificates, time-stamping, key custody and rotation, and the local-deployment cases where keys cannot be held securely. | auditee | Do not take custody of private keys. | A50-P-02A |
| EV-A50-15 | Watermark documentation and declared performance | Technique per modality, operating thresholds, declared error rates and robustness figures, and the text-length limits. | auditee | Watermark keys and detector internals stay with the auditee; black-box access is preferred. | A50-P-02A |
| EV-A50-16 | Output sample with per-item marking records | Auditor-generated or randomly drawn outputs per stratum, each with a content hash, stratum keys, metadata validation result, watermark detection result and decision. | auditor | Outputs can contain personal data or harmful text; excerpts off by default. | A50-P-02A, A50-P-02B, A50-P-02D |
| EV-A50-17 | Detection solution description and access evidence | Form (specification, software, API), location, pricing, access conditions, the expert-access process for restricted detectors, and the auditor's access log. | auditee and auditor |  | A50-P-02B |
| EV-A50-18 | Signed detection results | Downloaded detection results for sampled items with content hash, solution identifier and timestamp (Code Sub-measure 2.1.2), and their signature check. | auditor |  | A50-P-02A, A50-P-02B |
| EV-A50-19 | Detection service privacy and security documentation | Retention, purpose limitation, data minimisation, security safeguards and transfers for detection services that receive content. | auditee |  | A50-P-02A, A50-P-02B |
| EV-A50-20 | Provider reliability and robustness test reports | Datasets (not used in training), positives and negatives, metrics and strata, transformation battery, threat model, adversarial tests and results, with dates and versions. | auditee |  | A50-P-02B, A50-P-02C, A50-P-02E |
| EV-A50-21 | Auditor reliability test set and results | Marked positives and unmarked negatives (human-made and other AI systems' content) with per-item results and intervals. | auditor |  | A50-P-02C |
| EV-A50-22 | Transformation battery definition and results | Pre-registered transformations with parameters, and per-transformation detection and metadata-survival results. | auditor |  | A50-P-02C |
| EV-A50-23 | Adversarial testing evidence | Provider red-team reports and, where authorised in writing, results of auditor-run removal, forgery and regeneration attempts in a sandbox. | auditee and auditor |  | A50-P-02C |
| EV-A50-24 | Interoperability evidence | Validation of metadata by independent tooling, the open standard used and its conformance status, public integration information for watermark detection, and from 2 February 2027 the interoperability solution. | auditor and auditee |  | A50-P-02D |
| EV-A50-25 | Non-removal evidence | Tests of input-mark preservation, acceptable use and terms clauses prohibiting removal, and a review of the product catalogue for circumvention tools. | auditor and auditee |  | A50-P-02D |
| EV-A50-26 | Marking compliance process records | Compliance process documentation, test schedule and monitoring results, reported shortcomings and corrective actions, training records and records of cooperation with authorities. | auditee |  | A50-P-02B, A50-P-02E |
| EV-A50-27 | Exempt-feature register and input-output pairs | Features claimed to be standard editing or non-substantial alteration, with sampled input and output pairs. | auditee and auditor |  | A50-P-02F |
| EV-A50-28 | Emotion recognition and biometric categorisation deployment register | Locations and channels, points of exposure, real-time or ex post processing, and audiences, including children. | auditee |  | A50-P-03 |
| EV-A50-29 | Notice evidence | Photographs, screenshots and onboarding flows showing notices at each point of exposure, and the related data-protection notices. | auditor |  | A50-P-03 |
| EV-A50-30 | Legal basis for law-enforcement exceptions | The law relied on, its purposes, circumstances and safeguards. | auditee |  | A50-P-00, A50-P-02F |
| EV-A50-31 | Published-content population extract | Content management, asset management, advertising and social-media extracts for the period with AI-involvement flags and distribution channels. | auditee |  | A50-P-04A, A50-P-04B |
| EV-A50-32 | AI tool usage records | Accounts and generation logs of the AI systems the deployer uses, for completeness reconciliation. | auditee |  | A50-P-04A, A50-P-04B |
| EV-A50-33 | Detector screening of unflagged content | Results of running provider detection and metadata validation on a sample of published items not flagged as AI-made. | auditor |  | A50-P-04A |
| EV-A50-34 | Deep-fake classification records | The deployer's classification of AI content against the four criteria and the artistic or similar regime, and the auditor's independent re-classification of the sample. | auditee and auditor |  | A50-P-04A, A50-P-04B |
| EV-A50-35 | Label evidence as distributed | Screenshots or recordings of each sampled item on each distribution channel at first exposure, with timestamps. | auditor |  | A50-P-04A, A50-P-04B, A50-P-05 |
| EV-A50-36 | Deployer labelling process records | Internal compliance process and documentation, label verification process, awareness measures, reports of missing or wrong labels and their remediation. | auditee |  | A50-P-04A, A50-P-04B |
| EV-A50-37 | Editorial policy and published editorial responsibility | Human review or editorial control policy, the person or function with editorial responsibility and its public contact details. | auditee and public |  | A50-P-04B |
| EV-A50-38 | Publication workflow records | Review and sign-off records and revision history for sampled texts, showing any AI change after sign-off. | auditee |  | A50-P-04B |
| EV-A50-39 | Competent authority determination | Whether a national market surveillance authority, the AI Office or the EDPS supervises each paragraph, with the basis. | auditor |  | A50-P-00 |

## 11. Concrete edits for #19, #18, the catalogue and #31

The baseline is `main@582657f` for files on `main`, and the open PR heads for #31's files (PR #49) and the statistics design (PR #46). Locate code by the quoted identifiers. "Before 2 Dec" marks edits that should ship with the 2 December 2026 milestone work, as the rule pack's `beforeDec2` does. The catalogue items stay within the limit of 30 steps that the criteria-model design (PR #45) sets and that `recordProcedureExecution` enforces: WP-XC-07 gets 29 steps, WP-XC-10 21, WP-XC-11 15 and WP-XC-12 17. The six Art 50(2) procedures (38 steps) are therefore split over WP-XC-10 and WP-XC-12.

**Classification v2 (#19): Art 50 triggers and facts**

| ID | File | Location | Current | Change | Basis | Read in | Before 2 Dec |
|---|---|---|---|---|---|---|---|
| A50-ED-01 | `site-app/lib/domain/classification.ts` | type Classification, field transparency | transparency: boolean | Replace with the tri-state Art 50 facts of vocabularies.factVocabulary, stored with the legal version; keep transparency as a derived, read-only value for old engagements (migrated facts are unknown). | A50-P-00, CC-13 | REPO-CLASSIFICATION | Yes |
| A50-ED-02 | `site-app/lib/domain/classification.ts` | classify() | 'Specific transparency' when transparency is true | Derive the label from approved Art 50 applicability; an unknown Art 50 fact gives 'Needs information', never 'Minimal risk'. | A50-P-00 | REPO-CLASSIFICATION | Yes |
| A50-ED-03 | `docs/obligation-subitems.json` | /factTypes (canonical file; the site-app copy is regenerated) | 16 facts, none for Art 50 | Add the Art 50 facts (boolean_or_unknown, and date_or_unknown for putIntoServiceDate), with the derived facts deployerOperatesErOrBcSystem and art50DisclosureApplies. | A50-P-00, A50-P-01, A50-P-03 | REPO-OBLIGATION-SUBITEMS | Yes |
| A50-ED-04 | `docs/obligation-subitems.json` | /triggerProfiles and /items | Every profile except operator_role_change requires highRiskConfirmed; no Art 50 item | Add profiles provider_art50 and deployer_art50 without highRiskConfirmed, and items AIA-50-1, AIA-50-2, AIA-50-3, AIA-50-4-DF, AIA-50-4-TXT and AIA-50-5 whose conditions are the procedures' appliesIf predicates and whose exclusions are listed for review. | A50-P-01, A50-P-02A, A50-P-03, A50-P-04A, A50-P-04B, A50-P-05 | REPO-OBLIGATION-SUBITEMS | Yes |
| A50-ED-05 | `site-app/app/workspace/modals/classification.tsx` | Classification form, and the panel in site-app/app/workspace/views/regulatory-mapping.tsx | One checkbox, 'Article 50 transparency duties apply separately'; the panel shows 'Flagged separately' or 'Not flagged' | Ask the Art 50 facts per operator role, show each exception relied on with its evidence link, the Art 111(4) dates (placedOnMarketDate; putIntoServiceDate flagged LR-A50-01), Code signatory status per section with the date checked, and the guidance versions used (C(2026) 7702 final; Code of 10 June 2026). | A50-P-00, CC-03 | REPO-CLASSIFICATION-UI | Yes |
| A50-ED-06 | `site-app/lib/domain/classification.ts` | AI Office competence flag | None | Derive the flag per paragraph from the rule-pack entry aia-2026-08-02-ai-office-competence: the AI Office is competent when (builtOnOwnGpaiModel = true and art75ExceptedSystem = false) or integratedIntoVlopOrVlose = true. For Art 50(1) and (2) this covers the provider; for Art 50(3) and (4) only where deployerIsProviderOrSameUndertaking = true. An unknown fact leaves the authority needs_information; show the flag as pending legal review (LR-08). Do not derive it from guidelines footnote 47, which omits the same-undertaking limb. | CC-12, A50-P-00 | REPO-CLASSIFICATION, REPO-RULE-PACK-2026-11 |  |
| A50-ED-07 | `site-app/lib/domain/classification.ts` | Re-review triggers | Only the draft Art 6 guidelines are planned | Add triggers for a Code update (at least every two years), a review of the Art 50 guidelines (point 155), the 2 February 2027 interoperability milestone, and final Art 6 guidelines (the Art 50 guidelines rely on them for emotion recognition and biometric categorisation). | TL-13, GUID-A50-GUIDELINES | REPO-CLASSIFICATION, REPO-RULE-PACK-2026-11 |  |

**Rule pack 2026.11.1 and methodology text (#18)**

| ID | File | Location | Current | Change | Basis | Read in | Before 2 Dec |
|---|---|---|---|---|---|---|---|
| A50-ED-10 | `templates/catalog.json` | /regulatorySnapshot/guidance and the guidance register #18 builds from rule-pack-2026-11.json (GUID-ART50-TRANSPARENCY) | published; listed 2026-07-20; content not reviewed | Status adopted on 2026-11-05 (C(2026) 7702 final); content approved 2026-07-20 (C(2026) 5054 final); draft consultation 2026-05-08 to 2026-06-03; non-binding. | CC-05, GUID-A50-GUIDELINES | REPO-RULE-PACK-2026-11 | Yes |
| A50-ED-11 | `templates/catalog.json` | /regulatorySnapshot/guidance and the guidance register (GUID-ART50-COP-OPINION) | listed 2026-07-09; content not reviewed | Opinion C(2026) 4839 final of 2026-07-08 (published 2026-07-09) and AI Board assessment of 2026-07-09, both adequate for Art 50(2), (4) and (5); add the Code itself (final 2026-06-10) and the signatory list as sources. | CC-06, CC-07, GUID-A50-COP, GUID-A50-COP-ADEQUACY | REPO-RULE-PACK-2026-11 | Yes |
| A50-ED-12 | `templates/catalog.json` | /regulatorySnapshot/applicationDates, the Art 50 entry built from aia-2026-08-02-art50-transparency: conditions, notes and legal-review flags | LR-03, LR-04 | Add guidelines points 153 and 154 (no retroactive marking; texts published after 2 August 2026 are labelled), recital (41) of 2026/1744, and LR-A50-01 and LR-A50-10; keep the predicate on placedOnMarketDate. | CC-03, CC-09, CC-10 | REPO-RULE-PACK-2026-11 | Yes |
| A50-ED-13 | `docs/audit-methodology.md` | Paragraph 1 (scope sentence) | Scope: traditional ML systems ... classical NLP | Per decision RD-49: generative and interactive systems are in scope for classification, Art 5 and Art 50; Art 50 work uses the A50 procedures; GenAI evaluation evidence arrives with M2 (#31 to #33) and reports state that limitation. | A50-P-00 | REPO-METHODOLOGY, REPO-ISSUE-18-DECISIONS | Yes |
| A50-ED-14 | `docs/audit-methodology.md` | Regulatory snapshot, paragraph 2 | Article 50 transparency rules began applying on 2 August 2026 | Add the Art 111(4) deadline, the guidelines (C(2026) 7702 final, non-binding) and the Code (10 June 2026; adequate for Art 50(2), (4), (5); adherence not conclusive evidence), and that Art 111(2) does not defer Art 50 (pending legal review). | CC-05, CC-06, CC-10 | REPO-METHODOLOGY | Yes |
| A50-ED-15 | `docs/audit-methodology.md` | New subsection after 'Classification and applicability' | None | Article 50 transparency testing: roles and facts (A50-P-00), the six obligation groups, the evidence route (Code signatory or gap analysis), sampling with Wilson bands labelled no legal safe harbour, and the legal-review flags. | A50-P-00, A50-P-05 | REPO-METHODOLOGY | Yes |

**Methodology catalogue (`templates/catalog.json`, through #18 or the catalogue change after #27)**

| ID | File | Location | Current | Change | Basis | Read in | Before 2 Dec |
|---|---|---|---|---|---|---|---|
| A50-ED-20 | `templates/catalog.json` | Item WP-XC-07 | Title 'Specific transparency obligations'; 3 manual steps | Retitle 'Transparency: applicability, AI interaction and exposure notices'; regulatoryRefs Art.50 and Art.111; automationMode hybrid; the 29 steps of A50-P-00 (12), A50-P-01 (7), A50-P-03 (6) and A50-P-05 (4); evidenceRequired from their evidence items. | A50-P-00, A50-P-01, A50-P-03, A50-P-05 | REPO-CATALOG, REPO-CRITERIA-DESIGN | Yes |
| A50-ED-21 | `templates/catalog.json` | New items WP-XC-10 and WP-XC-12 | None | WP-XC-10 'Marking, detection and interoperability of synthetic content' (Art.50, Art.111), hybrid, the 21 steps of A50-P-02A, A50-P-02B and A50-P-02D. WP-XC-12 'Marking reliability, robustness, process and exceptions' (Art.50, Art.111), hybrid, the 17 steps of A50-P-02C, A50-P-02E and A50-P-02F. Two papers, because recordProcedureExecution accepts at most 30 steps per paper and requires every planned step; sign-off gate as for the other cross-cutting papers. | A50-P-02A, A50-P-02B, A50-P-02C, A50-P-02D, A50-P-02E, A50-P-02F | REPO-CATALOG, REPO-CRITERIA-DESIGN, REPO-PROCEDURES | Yes |
| A50-ED-22 | `templates/catalog.json` | New item WP-XC-11 | None | 'Deep-fake and public-interest text disclosure' (Art.50, Art.3), hybrid, the 15 steps of A50-P-04A and A50-P-04B. | A50-P-04A, A50-P-04B | REPO-CATALOG, REPO-CRITERIA-DESIGN | Yes |
| A50-ED-23 | `templates/catalog.json` | WP-PL-03-P03 | Evaluate transparency flags independently of high-risk classification. | Record the Art 50 facts and exceptions per operator role; an unknown fact keeps Art 50 applicability pending. | A50-P-00 | REPO-CATALOG, REPO-CRITERIA-DESIGN | Yes |
| A50-ED-24 | `templates/catalog.json` | MEM-CL-01 | Classification consultation memo | Add a consultation point for reliance on the obviousness exception, the guidance-only Art 50(2) carve-outs and the editorial exception (LR-A50-03, LR-A50-06, LR-A50-09). | A50-P-00 | REPO-CATALOG, REPO-CRITERIA-DESIGN |  |
| A50-ED-25 | `templates/catalog.json` | WP-PL-06 | Population completeness and sampling | Reference sampling rules SR-A50-01 to SR-A50-07 for Art 50 work. | A50-P-02A, A50-P-04A | REPO-CATALOG, REPO-CRITERIA-DESIGN |  |

**GenAI evidence design (#31, PR #49)**

| ID | File | Location | Current | Change | Basis | Read in | Before 2 Dec |
|---|---|---|---|---|---|---|---|
| A50-ED-30 | `docs/design/genai-evidence.md` | Per-item record kinds, with schemas/genai-evidence-item.schema.json (PR #49) | No record for marking tests | Add a marking_check record: output hash, modality, format, channel, stratum keys, transformation id and parameters, metadata validation status codes and signer, watermark detector id, version, score, threshold and decision, ground truth (marked, human-made, other AI). | A50-P-02A, A50-P-02C | REPO-GENAI-DESIGN |  |
| A50-ED-31 | `docs/design/genai-evidence.md` | Section 8 (recomputation) and the plan | No marking criteria | Add criteria kinds marking_presence, detection_rate, false_positive_rate, detection_rate_after_transformation and self_identification_rate, recomputed with Wilson per #46, with pre-registered strata and transformation batteries in the plan. | A50-P-01, A50-P-02A, A50-P-02C | REPO-GENAI-DESIGN |  |
| A50-ED-32 | `docs/design/genai-evidence.md` | Section 9.2 and WP-GA-07 (section 12.4) | synthetic_content_marking: testing belongs to R6.5; WP-GA-07 covers Art 50(1), (2), (4) | Map synthetic_content_marking to WP-XC-10 and WP-XC-12, and ai_interaction_disclosure to WP-XC-07; WP-GA-07 cross-references those papers instead of duplicating Art 50 conclusions. | A50-P-01, A50-P-02A | REPO-GENAI-DESIGN |  |
| A50-ED-33 | `docs/design/genai-evidence.md` | Section 7 (formats) and section 2 (non-goals) | C2PA or watermark validation is a non-goal (R6.5) | Scope R6.5 from this research: ingest signed detection results (Code Sub-measure 2.1.2) and C2PA validator reports as hashed evidence, verify their signatures, recompute the criteria; never run a provider's detector on the platform. | A50-P-02B, A50-P-02D | REPO-GENAI-DESIGN |  |
| A50-ED-34 | `docs/design/genai-evidence.md` | Section 4 (evidence levels) | Levels defined for evaluation logs | State the marking-test levels: L0 provider-declared figures; L1 hashed provider test logs; L2 per-item marking records recomputed; L3 auditor-run sampling and transformation battery with an attestation pinning detector versions and inputs. | A50-P-02C | REPO-GENAI-DESIGN |  |

**Other follow-up**

| ID | File | Location | Current | Change | Basis | Read in | Before 2 Dec |
|---|---|---|---|---|---|---|---|
| A50-ED-40 | `docs/design/audit-statistics.md` | Section 10, threshold library entries (PR #46) | No Art 50 entries | Add policy.eu-aia.art50-marking-presence@1, art50-declared-detection@1, art50-false-positive@1, art50-disclosure-probe@1 and art50-disclosure-compliance@1 with legalStatus no_legal_safe_harbour and the caveat of sampling.caveat (follow-up for #21 and #22). | MD-A50-01, MD-A50-02, MD-A50-03, MD-A50-04, MD-A50-05 | REPO-STATISTICS-DESIGN |  |

## 12. Items for qualified legal review

| ID | Topic | Question | Related |
|---|---|---|---|
| LR-A50-01 | Art 111(4) and systems only put into service | The OJ text and recital (38) cover systems placed on the market before 2 August 2026; the guidelines (point 153) add systems put into service, the Commission Q&A does not. Which reading should the platform apply to in-house systems, and do new versions or channels after 2 August 2026 count as a new placing? (Extends LR-04.) | CC-03, aia-2026-12-02-art50-2-legacy-transition, putIntoServiceDate |
| LR-A50-02 | Outputs of transitioned systems before 2 December 2026 | Must outputs generated by Art 111(4) systems between 2 August and 2 December 2026 be marked afterwards? The guidelines (point 154) address only outputs generated before 2 August 2026. | aia-2026-12-02-art50-2-legacy-transition, A50-P-02A |
| LR-A50-03 | Guidance-only limits of Art 50(2) | May an operator rely on carve-outs that appear only in the guidelines: out-of-scope outputs (points 64 to 68), a single metadata layer for closed products (point 86; Code Measure 1.1), no marking for industrial or business-to-business uses (point 87) and ephemeral real-time content (point 88)? | EX-50-2-OUTOFSCOPE, EX-50-2-B2B, EX-50-2-EPHEMERAL, A50-P-02F |
| LR-A50-04 | Weight of Code adherence in an assurance conclusion | The Code is adequate (Commission, 8 July 2026; Board, 9 July 2026, under the pre-Omnibus procedure), adherence is not conclusive evidence of compliance, and codes give no presumption of conformity (recital (41) of 2026/1744). How may the auditor's criteria use signatory status, and what is the effect of opt-outs? | GUID-A50-COP-ADEQUACY, A50-P-00, codeSignatorySection1, codeSignatorySection2 |
| LR-A50-05 | What 'effective, interoperable, robust and reliable as far as technically feasible' requires | Neither the law nor the Code sets numbers. Can measured levels against the platform's internal bands support a conclusion on Art 50(2), and how are costs of implementation (point 85) and the state of the art (points 81 to 83) weighed? | A50-P-02A, A50-P-02C, MD-A50-01, MD-A50-02, MD-A50-03 |
| LR-A50-06 | Obviousness exception under Art 50(1) | What evidence establishes obviousness for the target and foreseeable audience, given the restrictive reading (point 45) and the consumer-law 'average consumer' analogy (point 43)? | EX-50-1-OBVIOUS, A50-P-01, A50-P-00-S10 |
| LR-A50-07 | AI agents disclosing their principal | Does Art 50(1) require agents to disclose the person on whose behalf they act (point 31), or is that a Commission policy expectation beyond the text? | A50-P-01, isAiAgent |
| LR-A50-08 | Deep-fake qualification and the artistic regime | How should the auditor's re-classification under Art 3(60) and the 'evidently artistic, creative, satirical, fictional' regime (points 113 to 124) be reconciled with the deployer's case-by-case assessment, including product imagery in advertising? | A50-P-04A, deployerGeneratesDeepFakes, evidentlyArtisticCreativeSatiricalFictional |
| LR-A50-09 | Evidence for the editorial exception | The Code says individual reviews need not be documented (Section 2, Commitment 4). What evidence suffices to show substantive human review and editorial responsibility for a sampled text? | A50-P-04B, A50-P-04B-S04, editorialExceptionReliedOn |
| LR-A50-10 | Art 111(2) and Art 50 | Confirm the Commission's view (footnote 50) that the Art 111(2) grandfathering of legacy high-risk systems does not defer Art 50. (Relates to LR-03.) | CC-10, A50-OBL-6 |
| LR-A50-11 | Art 50(3) scope and exception | The Art 50(3) exception requires use 'permitted by law' rather than 'authorised by law' (point 109). How is it evidenced? The guidelines also treat all emotion recognition systems as high-risk unless prohibited (point 102) and rely on the draft Art 6 guidelines for both notions. | A50-P-03, EX-50-3-LE, lawEnforcementPermittedErBc, deployerUsesEmotionRecognition, deployerUsesBiometricCategorisation, A50-P-00-S12 |
| LR-A50-12 | Applicable accessibility requirements | Which accessibility law applies to each disclosure, given that Art 50 adds none of its own (point 144), and what applies where neither the European Accessibility Act nor the Web Accessibility Directive covers the product? | A50-P-05, A50-OBL-5 |
| LR-A50-13 | Detection at 'first exposure' and restricted detectors | The guidelines read first exposure for detection as the moment a person wants to verify content (point 77); the Code lets providers restrict text-watermark detection to verified experts (Sub-measure 2.1.2). Is restricted access compatible with making detection available to the persons exposed? | A50-P-02B, A50-OBL-5 |
| LR-A50-14 | Territorial reach for non-EU operators | How should the auditor apply the guidelines' tests for third-country providers (incidental, unforeseeable downstream use, point 10) and deployers (foreseeable dissemination in the Union, point 13)? | A50-P-00, A50-P-04A |

The rule pack's LR-03 and LR-04 remain open. LR-A50-01 and LR-A50-10 add the Commission's positions to them, and they should be reviewed together.

## 13. Not verified

| ID | Claim | Why | Sources |
|---|---|---|---|
| UV-A50-01 | The C2PA interim trust list was frozen on 1 January 2026 and replaced by the official C2PA trust list | Only the Adobe-published CAI documentation says so; the C2PA conformance explorer is a script-rendered page that returned no readable text. | SEC-CAI-TRUST-LISTS |
| UV-A50-02 | No ISO/IEC project specifically standardises watermarking or marking of AI-generated content | Only the CEN/CLC JTC 21 work programme was read in full; a web search found no ISO/IEC JTC 1/SC 42 project, but the ISO committee pages were not read. | SRC-CEN-JTC21-WORKPROGRAMME |
| UV-A50-03 | prEN 18229-2 (Transparency) concerns Art 13, not Art 50 | Only the title was read; the mapping to Art 13 is the rule pack's indicative mapping. | SRC-CEN-JTC21-WORKPROGRAMME, REPO-RULE-PACK-2026-11 |
| UV-A50-04 | JPEG Trust Parts 2 to 4, including Part 3 on media asset watermarking, are still under development | The jpeg.org page says so but lags the ISO catalogue for Part 1; the ISO catalogue entries for Parts 2 to 4 were not found. | SRC-JPEG-TRUST |

What #8 left open and this research resolves: UV-05 (the final Code of 10 June 2026) and UV-07 (the contents of the guidelines and of the Commission opinion). Both are now verified (CC-07, CC-08).

## 14. JSON schema

[`art50-transparency-2026-11.json`](art50-transparency-2026-11.json) is UTF-8 JSON.

| Field | Content |
|---|---|
| `schemaVersion`, `kind`, `id`, `researchedOn` | `1.0.0`, `art50-transparency-research`, `art50-transparency-2026-11`, `2026-11-05` |
| `basedOn` | The rule-pack entries, guidance, legal-review and unverified ids this research builds on |
| `approval` | `unapproved`; reviewer and date stay empty until legal review (#57) |
| `vocabularies` | Verification markers, actors, test methods, outcomes, conclusions; `factVocabulary` (the Art 50 facts for #19); predicate, exclusion, derivation and step-condition rules |
| `sources` | Source register with access route and SHA-256 of every file read |
| `guidance` | Status and dates of the guidelines, the Code, the adequacy assessments, the signatory list, the icons, the Q&A and the studies |
| `codeOfPractice` | Sections, the effect of signing, every commitment and measure (mandatory or optional) and the numeric parameters |
| `obligations` | Art 50(1) to (7): actor, summary, exceptions, dates, Code coverage and procedures |
| `timeline` | Legal, guidance and Code dates, with rule-pack entry ids |
| `procedures` | The draft procedures: applicability for #19 (`roleRequired`, `appliesIf`, `exclusions`, `timing`), steps (method, evidence, sampling rule, Code measures, `onlyIf`, sources), statistical criteria, pass, fail and inconclusive criteria, sources, verification and legal review |
| `evidenceItems` | Evidence register with the procedures that use each item |
| `sampling` | Method, default bands, caveat, sampling rules, zero-failure and power tables, conclusion rule |
| `standards` | Specifications and standards with category, status, clauses and relevance |
| `consistencyChecks` | Checks against the rule pack, with findings `consistent`, `update`, `disagreement` or `resolved` |
| `repositoryChanges` | The concrete edits of section 11 |
| `legalReviewItems`, `unverified` | Sections 12 and 13 |

**Rules for consumers**
- **#19 (classification).** It evaluates `procedures[*].applicability` with `vocabularies.predicateRule`, `exclusionRule`, `derivationRule` and `roleRequired`. An unknown fact yields `needs_information`. Applicability stays a reviewed human decision, and an exclusion whose basis is `guidance` shows its legal-review flag.
- **#18 and #27 (rule pack and criteria model).** They map `procedures[*].testSteps` to catalogue steps, at most 30 per item, using `catalogItemId` (the counts per item are in section 11). `evidenceItems` supply `evidenceRequired`. `sampling.methodologyDefaults` became the threshold-library entries of A50-ED-40 (`schemas/threshold-library.json`), labelled `no_legal_safe_harbour`, and each deciding criterion names its entry in `libraryEntry` (schema 1.1.0). A default's `band` is either a fixed `lower` or `upper` bound, or a bound derived from the provider's declared figure (`derivation`, `tolerance`, `defaultIfUndeclared`), as in the statistics design's declared-performance entry. Its `range` gives the allowed `min` and `max` of the named `parameter`.
- **#31 (GenAI evidence).** Marking tests produce per-item records whose fields are listed in A50-ED-30. The criteria are recomputed with the method in `sampling.method`.
- **Legal review.** Anything that cites an LR item is shown as pending legal review until #57 is done.

The schema (JSON Schema draft 2020-12) is [`schemas/art50-transparency-research.schema.json`](../../schemas/art50-transparency-research.schema.json). Version 1.0.0, which the validation run used, was printed in this section; version 1.1.0 (#120) moved it to that file and replaced the free-text `libraryEntry` of a statistical criterion (for example "policy.eu-aia.art50-disclosure-probe@1 (proposed)") with a reference to the threshold library, `{id, version, parameters}`, or null for a descriptive criterion. The parameters are the entry's values that give the criterion's band; for the entries that derive a bound from a declared rate they are the library defaults, which give the band used when nothing is declared. CI runs `node schemas/validate-art50-research.mjs`: the schema and the checks below.

**What the validation also checked**
- **Uniqueness.** Ids are unique across the file. An exclusion reused by several procedures is identical wherever it appears.
- **References.** Every `sourceIds` and `sourceRefs` value resolves, and every source in the register is cited. Every evidence item, sampling rule, Code measure, obligation, procedure and legal-review id that is referenced resolves.
- **Reciprocal lists.** `usedBy` and the obligation and procedure lists match each other.
- **Predicates.** Every fact used in a predicate, exclusion, step condition or derivation is declared, and its operator and value suit its type.
- **Rule-pack links.** Every rule-pack id in `basedOn`, the timing records, the timeline, the obligations and the consistency checks exists in `rule-pack-2026-11.json`. Each transitional record has the same deadline and `appliesIf` as the rule-pack entry it names.
- **Secondary sources.** No secondary source backs a verified entry.
- **Dates.** Every date is a real calendar date.
- **Criteria (1.1.0).** Every statistical criterion is declared under its procedure, and every criterion the pass, fail and inconclusive text names is declared. A deciding criterion names an existing threshold-library entry labelled `no_legal_safe_harbour` whose caveat is `sampling.caveat`; its parameters are the entry's, within their ranges, and give the criterion's band. The catalogue item the procedure's steps go to lists the same criteria.
- **The report.** Every procedure, step, evidence, rule, default, check, edit, legal-review, unverified and source id is named in this report, and this section's schema validates the JSON.

## 15. Reproducing the checks

Run from an empty directory. EUR-Lex blocks automated clients, so use the Publications Office:

```sh
# OJ texts (XHTML) as in #8; the SHA-256 values match rule-pack-2026-11.json
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' -o aia-cons.xhtml https://publications.europa.eu/resource/celex/02024R1689-20260727
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' -o reg-2026-1744.xhtml https://publications.europa.eu/resource/celex/32026R1744
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' -o reg-2024-1689.xhtml https://publications.europa.eu/resource/celex/32024R1689
# Commission documents (PDF attachments)
curl -sSL -o guidelines-C-2026-7702.pdf https://ec.europa.eu/newsroom/dae/redirection/document/131215
curl -sSL -o opinion-C-2026-4839.pdf https://ec.europa.eu/newsroom/dae/redirection/document/130913
curl -sSL -o ai-board-assessment.pdf https://ec.europa.eu/newsroom/dae/redirection/document/130916
curl -sSL -o code-of-practice.pdf https://ec.europa.eu/newsroom/dae/redirection/document/129555
# The July approval, from Internet Archive captures of the Commission's own URLs (gzip-encoded)
curl -sSL -o annex-2026-07-20.pdf.gz https://web.archive.org/web/20260720143346id_/https://ec.europa.eu/newsroom/dae/redirection/document/131215
curl -sSL -o approval-2026-07-20.pdf.gz https://web.archive.org/web/20260722191113id_/https://ec.europa.eu/newsroom/dae/redirection/document/131214
gunzip annex-2026-07-20.pdf.gz approval-2026-07-20.pdf.gz
# Studies (CELLAR)
curl -sSL -H 'Accept: application/pdf' -o study-image-video.pdf https://publications.europa.eu/resource/cellar/8a256a7e-482a-11f1-8095-01aa75ed71a1
sha256sum *.pdf *.xhtml
pdftotext -enc UTF-8 -layout guidelines-C-2026-7702.pdf guidelines.txt
```

- **Comparing the two guideline texts.** Extract the July Annex and C(2026) 7702 final with `pdftotext`. Drop the page numbers and `EN` markers, split both into words and compare the word sequences (for example with Python's `difflib.SequenceMatcher`). There are 39 differing runs: the cover page, footnote positions, the two corrected cross-references and two punctuation fixes (points 36 and 68).
- **Pages read in a browser.** The CEN/CLC JTC 21 work programme (via <https://standards.cencenelec.eu/ords/f?p=CEN:6>, then CEN/CLC/JTC 21, then Work programme), the ISO catalogue page of ISO/IEC 21617-1:2026 and the IEEE SA page of IEEE 3152-2024.
- **Sample sizes.** The tables in section 9 are computed by the same Wilson formula as the statistics design, with z = 1.959963984540054 at F = 1 and z = Φ⁻¹(1 − 0.05/(2F)) otherwise.
