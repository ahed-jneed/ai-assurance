# EU AI Act rule pack research, November 2026

Issue [#8](https://github.com/ahed-jneed/ai-assurance/issues/8). Researched 5 November 2026 for rule pack revision 2026.11.1 ([#18](https://github.com/ahed-jneed/ai-assurance/issues/18)). Machine-readable companion: [`rule-pack-2026-11.json`](rule-pack-2026-11.json), described in [section 12](#12-json-schema).

> **Status: research, not legal advice.** No qualified lawyer has reviewed this file. Items marked **Legal review** must not be shown in the platform as settled law. The authentic Official Journal (OJ) texts govern; the consolidated text is a documentation tool with no legal effect.

## 1. Key conclusions

1. **The amending act is verified.** Regulation (EU) 2026/1744 (Digital Omnibus on AI) was adopted on 8 July 2026, published in OJ L, 2026/1744, on 24 July 2026 and entered into force on 27 July 2026. It amends Regulation (EU) 2024/1689 and also Regulations (EU) 2018/1139 and (EU) 2023/1230. ELI: `http://data.europa.eu/eli/reg/2026/1744/oj`.
2. **`02024R1689-20260727` is still the current consolidated version.** The Publications Office index on 5 November 2026 shows no later amending act, and the only corrigendum to 2026/1744 (29 September 2026) is German-language. The repository's pinned legal version stays correct.
3. **Both 2 December 2026 milestones are verified in the OJ text.** From that date:
   - the new prohibitions in Art 5(1), first subparagraph, points (ba) and (bb), and Art 5(1a) and (1b) apply (non-consensual intimate imagery; child sexual abuse material);
   - under Art 111(4), providers of generative systems placed on the market before 2 August 2026 must comply with Art 50(2).

   The repository holds neither.
4. **The repository's existing dates are correct but incomplete.** It holds three dates, all verified: 2 December 2027 (Annex III), 2 August 2028 (Annex I) and 2 August 2026 (Art 50). It lacks:
   - 2 February 2025 and 2 August 2025;
   - the 27 July 2026 entry into force;
   - 2 December 2026, 2 August 2027, 2 August 2030 and 31 December 2030;
   - the amended legacy rule. Art 111(2) now ties the cut-off for legacy high-risk systems to the Chapter III application date instead of the fixed date of 2 August 2026.
5. **EN 18286:2026 is the only harmonised AI Act standard cited in the OJ.**
   - **Citation (verified).** Commission Implementing Decision (EU) 2026/2274 of 12 October 2026, OJ L of 14 October 2026, in force that day. The Commission's news item is dated 19 October 2026, which explains the "19 Oct" in earlier research.
   - **Clause scope (secondary-only).** The claim that the presumption covers Art 17(1) and the first sentence of Art 11(1) comes from the standard's Annex ZA, as reported by four secondary sources. Annex ZA is paywalled and was not read.
   - **Legal question (LR-01).** Art 40(1), which is unchanged, grants the presumption for Chapter III Section 2 requirements and Chapter V obligations, but Art 17 sits in Section 3. Regulation (EU) 2026/1744, Art 1(17), added a fourth subparagraph to Art 40(2): the Commission must request standardisation deliverables that facilitate "joint compliance and presumption of conformity" with the requirements or obligations of Chapter III Sections 2 **and 3** and of the Annex I legislation (recital (21)). That indicates the legislature contemplates standards supporting a presumption for Section 3 obligations, at least where Annex I legislation also applies. But the subparagraph governs standardisation requests and does not amend Art 40(1), so it does not settle the question.
6. **No ISO/IEC standard gives a presumption of conformity.**
   - ISO/IEC 42001, 42005, 42006 and 23894 are published ISO standards. None is cited in the OJ.
   - ISO/IEC 42001 and 23894 have been adopted as ENs. ISO/IEC 42006 is a draft EN (prEN). ISO/IEC 42005 is not in JTC 21's published list or work programme.
   - Every CEN-CENELEC JTC 21 draft listed in the issue is still a draft. Their stages come from CEN's own work programme, read on 5 November 2026.
7. **The Art 6 classification guidelines are still a draft.**
   - The statutory deadline was 2 February 2026.
   - The draft was published on 19 May 2026. The Commission's news item gave 23 June 2026 as the consultation deadline and the Service Desk gives 23 July 2026. That suggests an extension, but no official page says so.
   - No adopted version was found on 5 November 2026, and the Commission has announced no adoption date.
8. **The conditions of Art 4a are verified.**
   - Paragraph 1 covers providers of high-risk systems, subject to six cumulative conditions.
   - Paragraph 2 extends the same safeguards to other AI systems and models, and to deployers of high-risk systems, and creates no obligation to test for bias.
9. **The diff for #18 has 46 entries** ([section 9](#9-diff-against-the-repository-changes-18-must-make)).
   - 36 are changes. Of these, 16 should ship before 2 December 2026 (`beforeDec2: true` in the JSON).
   - 10 confirm that a current statement is correct; 6 of those suggest a small addition.
10. **Ten questions need qualified legal review** ([section 10](#10-items-for-qualified-legal-review)). The most consequential:
    - the operative date of high-risk-linked duties that the text places on the 2 August 2026 general date (LR-02);
    - the scope of the Art 111(2) and Art 111(4) transitions (LR-03, LR-04);
    - the EN 18286 presumption (LR-01).

## 2. How facts were verified

| Marker | Meaning |
|---|---|
| **Verified** | Read in a primary source on the date given: OJ text or Publications Office metadata, an official Commission page, a CEN-CENELEC page or an ISO catalogue page. |
| **Secondary-only** | Taken only from law-firm, vendor, tracker or newsletter sources. The platform must not present it as fact. |
| **Legal review** | The fact is verified, but how it applies is an interpretation that needs qualified legal review. |

**Access notes**
- **EUR-Lex.** Every EUR-Lex form returned HTTP 202 with an empty body and the header `x-amzn-waf-action: challenge` to automated requests on 5 November 2026. This applied to the ELI form (`/eli/reg/2026/1744/oj`), the CELEX form and the OJ form. No attempt was made to get past the challenge.
- **Publications Office instead.** The same OJ documents were read from the Publications Office repository (CELLAR), which serves the OJ files behind EUR-Lex:
  - `https://publications.europa.eu/resource/celex/{CELEX}` with `Accept: application/xhtml+xml` and `Accept-Language: eng` returns the text;
  - `Accept: application/xml;notice=branch` returns the metadata.
  - The SHA-256 of every file read is recorded in the JSON.
- **SPARQL checks.** The Publications Office SPARQL endpoint was used to look for later consolidations, corrigenda, amending acts and other implementing decisions on harmonised standards.
- **CEN and ISO.** CEN's JTC 21 pages and ISO's catalogue pages refuse automated fetches, so they were read in a browser.

**Source register** (all accessed 5 November 2026)

| ID | Source | URL | Accessed via / notes |
|---|---|---|---|
| SRC-OJ-2026-1744 | Regulation (EU) 2026/1744, OJ text (EN) | <http://data.europa.eu/eli/reg/2026/1744/oj> | <https://publications.europa.eu/resource/celex/32026R1744> (CELLAR `b459c07f-86fb-11f1-bf5e-01aa75ed71a1`) |
| SRC-CELLAR-NOTICE-2026-1744 | Publications Office notice for 32026R1744 | <https://publications.europa.eu/resource/celex/32026R1744> | `notice=branch`: dates, ELI, consolidated versions |
| SRC-OJ-2024-1689 | Regulation (EU) 2024/1689, original OJ text | <http://data.europa.eu/eli/reg/2024/1689/oj> | <https://publications.europa.eu/resource/celex/32024R1689> |
| SRC-CONS-2024-1689-20260727 | Consolidated text 02024R1689-20260727 | <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727> | <https://publications.europa.eu/resource/celex/02024R1689-20260727> |
| SRC-CELLAR-SPARQL | Publications Office SPARQL endpoint | <https://publications.europa.eu/webapi/rdf/sparql> | Queries listed in [section 13](#13-reproducing-the-checks) |
| SRC-OJ-DEC-2026-2274 | Implementing Decision (EU) 2026/2274, OJ text and notice | <http://data.europa.eu/eli/dec_impl/2026/2274/oj> | <https://publications.europa.eu/resource/celex/32026D2274> |
| SRC-AISD-TIMELINE | Commission AI Act Service Desk, implementation timeline | <https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act> | No last-updated date shown |
| SRC-EC-AI-ACT-PAGE | Commission AI Act policy page | <https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai> | Last update 19 Oct 2026 |
| SRC-EC-NEWS-EN18286 | Commission: first harmonised standard published in the OJ | <https://digital-strategy.ec.europa.eu/en/library/first-harmonised-standard-supporting-ai-act-published-official-journal> | Published 19 Oct 2026, updated 21 Oct 2026 |
| SRC-EC-STANDARDISATION | Commission: standardisation of the AI Act | <https://digital-strategy.ec.europa.eu/en/policies/ai-act-standardisation> | Last update 19 Oct 2026 |
| SRC-EC-DRAFT-HR-GUIDELINES | Commission: draft Art 6 guidelines | <https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems> | 19 May 2026; last update 23 Jul 2026 |
| SRC-EC-NEWS-HR-CONSULTATION | Commission news: consultation on the draft | <https://digital-strategy.ec.europa.eu/en/news/commission-seeks-feedback-draft-guidelines-classification-high-risk-artificial-intelligence-systems> | 19 May 2026; deadline 23 Jun 2026 |
| SRC-AISD-HR-GUIDELINES | Service Desk: high-risk guidelines | <https://ai-act-service-desk.ec.europa.eu/en/guidelines-classification-high-risk-ai-systems> | Draft; consultation closes 23 Jul 2026 |
| SRC-CEN-JTC21-WORKPROGRAMME | CEN/CLC/JTC 21 work programme | <https://standards.cencenelec.eu/dyn/www/f?p=205:22:0::::FSP_ORG_ID,FSP_LANG_ID:2916257,25> | Browser, via <https://standards.cencenelec.eu/ords/f?p=CEN:6>, then CEN/CLC/JTC 21 > Work programme |
| SRC-CEN-JTC21-PUBLISHED | CEN/CLC/JTC 21 published standards | <https://standards.cencenelec.eu/dyn/www/f?p=205:32:0::::FSP_ORG_ID,FSP_LANG_ID:2916257,25> | Browser, Published Standards tab |
| SRC-CEN-NEWS-EN18286-OJEU | CEN-CENELEC news, 15 Oct 2026 | <https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/> | |
| SRC-CEN-NEWS-EN18286-PUBLISHED | CEN-CENELEC news, 31 Jul 2026 | <https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-07-30-ai-quality-management/> | |
| SRC-ISO-42001 / 42005 / 42006 / 23894 | ISO catalogue pages | <https://www.iso.org/standard/81230.html>, <https://www.iso.org/standard/44545.html>, <https://www.iso.org/standard/44546.html>, <https://www.iso.org/standard/77304.html> | Browser (automated fetch: HTTP 403) |
| SEC-INTERTEK-EN18286 | Intertek blog, 29 Sep 2026 (secondary) | <https://www.intertek.com/blog/2026/10-01-en-18286-first-eu-ai-act-standards-puzzle-piece-is-on-the-table/> | Annex ZA scope |
| SEC-MODULOS-ANNEX-ZA | Modulos docs, 19 Oct 2026 (secondary; a competitor) | <https://docs.modulos.ai/frameworks/eu-ai-act/harmonized-standards/en-18286/annex-za-and-presumption> | Restates Table ZA.1 |
| SEC-SWISSGRC-EN18286 | Swiss GRC blog, 26 Oct 2026 (secondary) | <https://swissgrc.com/en/harmonised-standard-ai-act-evidence/> | Annex ZA scope |
| SEC-ORRICK-EN18286 | Orrick, 27 Oct 2026 (secondary) | <https://www.orrick.com/en/Insights/2026/10/First-Harmonised-Technical-Standard-Published-Under-the-EU-AI-Act> | "Articles 11(1) and 17(1)" |
| SEC-KLA-JTC21 | KLA tracker, status 15 Oct 2026 (secondary) | <https://kla.digital/blog/jtc-21-standards-tracker> | Enquiry outcomes, from AI Standardisation Watch ed. 16 |
| SEC-REGULATIONSAI-ART6 | Regulations.ai tracker entry, as of 7 Sep 2026 (secondary) | <https://regulations.ai/regulations/RAI-EU-NA-CLASSIF-2026> | Expects the final Art 6 guidelines by end-2026, with no source for that date; its footer says it was generated with AI tools. Cited only by UV-03 |

## 3. The amending act and the consolidated text

| Fact | Value | Source | Status |
|---|---|---|---|
| Act | Regulation (EU) 2026/1744 of the European Parliament and of the Council of 8 July 2026 amending Regulations (EU) 2024/1689, (EU) 2018/1139 and (EU) 2023/1230 as regards the simplification of the implementation of harmonised rules on artificial intelligence (Digital Omnibus on AI) | [OJ][oj1744] | Verified 2026-11-05 |
| OJ reference | OJ L, 2026/1744, 24.7.2026 (CELEX 32026R1744) | [OJ][oj1744], [notice][cellar1744] | Verified 2026-11-05 |
| ELI | `http://data.europa.eu/eli/reg/2026/1744/oj` | [notice][cellar1744] | Verified 2026-11-05 |
| Entry into force | 27 July 2026: the third day after publication (Art 4) | [OJ][oj1744], [notice][cellar1744] | Verified 2026-11-05 |
| Legislative history | European Parliament position 16 June 2026; Council decision 29 June 2026 (OJ footnote 4) | [OJ][oj1744] | Verified 2026-11-05 |
| Corrigendum | 32026R1744R(01) of 29 September 2026, German only; no effect on the English text | [SPARQL][sparql] | Verified 2026-11-05 |
| Consolidated version | `02024R1689-20260727`, consolidated as of 27 July 2026; marked as having no legal effect | [Consolidated][cons], [notice][cellar1744] | Verified 2026-11-05 |
| Later consolidations | None; only 02024R1689-20240712 and 02024R1689-20260727 exist | [SPARQL][sparql] | Verified 2026-11-05 |
| Other amending acts | None; 32026R1744 is the only act amending 32024R1689 | [SPARQL][sparql] | Verified 2026-11-05 |
| AI Act corrigenda | 32024R1689R(01) to R(04), none in English | [SPARQL][sparql] | Verified 2026-11-05 |

## 4. Application dates by provision

Art 113 sets the dates:
- its second paragraph sets the general date (2 August 2026);
- its third paragraph sets the exceptions, points (a) to (d), of which 2026/1744 replaced (a) and (c) and added (d);
- Art 111 sets the transitional rules for systems and models already on the market.

Each row below is one entry in `applicationDates` (operator duties) or `authorityDeadlines` (Commission, Member State and notified-body deadlines) in the JSON. Every row was verified on 5 November 2026 against the OJ text, unless marked otherwise.

| Date | What applies | JSON ids |
|---|---|---|
| 2 Feb 2025 | Chapters I and II: original Art 5 prohibitions; Art 4 AI literacy | `aia-2025-02-02-prohibitions`, `aia-2025-02-02-ai-literacy` |
| 2 Aug 2025 | GPAI obligations (Chapter V); notified bodies; governance; penalties except Art 101; Art 78 | `aia-2025-08-02-gpai-obligations`, `aia-2025-08-02-governance-penalties-notified-bodies` |
| 27 Jul 2026 | Entry into force of 2026/1744 (amended Art 3 and Art 4, new Art 4a); Arts 102 to 110 | `aia-2026-07-27-omnibus-entry-into-force`, `aia-2026-07-27-art4a-bias-data` |
| 2 Aug 2026 | General application: Art 50, Art 101, AI Office competence, and provisions linked to high-risk duties | `aia-2026-08-02-*` (5 entries) |
| **2 Dec 2026** | **Art 5(1)(ba)/(bb) and 5(1a)/(1b); Art 111(4) deadline for Art 50(2)** | `aia-2026-12-02-art5-new-prohibitions`, `aia-2026-12-02-art50-2-legacy-transition` |
| 2 Aug 2027 | Art 111(3) legacy GPAI models. Also, as authority deadlines: Art 57(1) national sandboxes and Art 2(13) delegated acts | `aia-2027-08-02-gpai-legacy-models` |
| 2 Dec 2027 | Chapter III Sections 1 to 3 for Annex III systems | `aia-2027-12-02-high-risk-annex-iii` |
| 2 Aug 2028 | Chapter III Sections 1 to 3 for Annex I systems | `aia-2028-08-02-high-risk-annex-i` |
| 2 Aug 2030 | Art 111(2), second sentence: legacy high-risk systems intended for use by public authorities, one entry per route | `aia-2030-08-02-public-authority-legacy-annex-iii`, `aia-2030-08-02-public-authority-legacy-annex-i` |
| 31 Dec 2030 | Art 111(1): Annex X large-scale IT systems | `aia-2030-12-31-annex-x-large-scale-it` |

### 2 February 2025

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Art 5(1), first subparagraph, points (a) to (h), excluding (ba)/(bb); Art 5(2) to (8) | Operators: providers placing on the market or putting into service; deployers using | The eight original prohibited practices (list in [section 5](#5-exact-references-art-5-art-111-and-art-113)) | None. The Art 111 carve-outs are without prejudice to Art 5 | Art 113, third paragraph, point (a), as replaced by 2026/1744 Art 1(40)(a); date unchanged | [OJ 2026/1744][oj1744], [Consolidated][cons], [AISD][aisd] | Verified 2026-11-05 |
| Art 4 (AI literacy) | Providers, deployers | Replaced text in force from 27 Jul 2026: take measures to support the AI literacy of staff and others acting on their behalf, in context; no duty to guarantee any individual's level. The original text required measures to ensure a sufficient level | n/a | Art 113(3)(a); Art 4 replaced by 2026/1744 Art 1(5) | [OJ 2026/1744][oj1744], [OJ 2024/1689][oj1689] | Verified 2026-11-05; **Legal review** LR-07 (effective date of the replaced text) |

### 2 August 2025

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Chapter V, Arts 51 to 56 (Art 53(1)(a) to (d), Art 54, Art 55) | GPAI model providers; authorised representatives | Technical documentation (Annex XI); information for downstream providers (Annex XII); copyright policy; public training-content summary; EU representative for non-EU providers; systemic-risk duties | Art 111(3): models placed on the market before 2 Aug 2025 must comply by **2 Aug 2027** | Art 113, third paragraph, point (b) (unchanged) | [Consolidated][cons], [AISD][aisd] | Verified 2026-11-05 |
| Chapter III Section 4 (Arts 28 to 39); Chapter VII (Arts 64 to 70); Chapter XII (Arts 99, 100); Art 78 | Member States, notified bodies, Commission | Notified bodies, governance, national penalties, confidentiality. Art 101 is excepted (applies from 2 Aug 2026). 2026/1744 added Art 28(8)-(9) and Art 99(6a) (for SMCs, the lower of the two fine caps applies) from 27 Jul 2026 | n/a | Art 113(3)(b) | [Consolidated][cons], [OJ 2026/1744][oj1744] | Verified 2026-11-05 |

### 27 July 2026

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Regulation (EU) 2026/1744 as a whole; AI Act Arts 102 to 110 | All | Entry into force. Amended text in chapters that already applied takes effect now: Art 3(14), (14a) and (14b); Art 4; Art 4a. Arts 102 to 110 (amendments to other Union acts) apply from this date | n/a | 2026/1744 Art 4; Art 113, third paragraph, point (d), added by Art 1(40)(c) | [OJ 2026/1744][oj1744], [notice][cellar1744] | Verified 2026-11-05; **Legal review** LR-07 |
| Art 4a; Art 10(1) and (6) as replaced; Art 10(5) deleted | Providers, deployers | Legal basis for special-category data in bias detection ([section 6](#6-article-4a-special-category-data-for-bias-detection)) | Art 10 duties served by Art 4a(1) apply from the Chapter III dates | Art 113(3)(a) with 2026/1744 Art 1(6) and (9); recital (9) | [OJ 2026/1744][oj1744] | Verified 2026-11-05; **Legal review** LR-06, LR-07 |

### 2 August 2026 (general date)

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Every provision not covered by Art 113(3)(a) to (d), notably Chapter III Section 5, Chapters IV, VI, VIII, IX, X and XI, Art 101 and Art 6(5) | Operators, authorities | Default date, unchanged by 2026/1744 | See the rows below | Art 113, second paragraph | [Consolidated][cons], [AISD][aisd] | Verified 2026-11-05; **Legal review** LR-02 |
| Art 50(1) to (6) | Providers (50(1), 50(2)); deployers (50(3), 50(4)) | Providers: tell people they are interacting with an AI system (50(1)); mark synthetic audio, image, video or text in a machine-readable, detectable way (50(2)). Deployers: inform people exposed to emotion recognition or biometric categorisation (50(3)); disclose deep fakes and AI-generated public-interest text (50(4)). Inform at the latest at first interaction or exposure (50(5)). Applies alongside Chapter III (50(6)) | **Art 111(4):** generative systems placed on the market before 2 Aug 2026 must comply with Art 50(2) by **2 Dec 2026**; only 50(2) is transitioned | Art 113, second paragraph; Art 50(7) replaced by 2026/1744 Art 1(20) | [Consolidated][cons], [OJ 2026/1744][oj1744], [AISD][aisd] | Verified 2026-11-05; **Legal review** LR-03, LR-04 |
| Art 101; Chapter IX Section 5 (Arts 88 to 94) | GPAI model providers; Commission | The Commission can enforce Chapter V, including fines | n/a | Art 113, second paragraph; point (b) exception | [Consolidated][cons], [AISD][aisd] | Verified 2026-11-05 |
| Art 75(1) as replaced; Art 75(1a) to (1e), (2a); Arts 75a to 75d | Providers; deployers only if part of the provider's undertaking; AI Office | Exclusive AI Office competence for (a) AI systems built on the provider's or its group's own GPAI model and (b) systems that are or are integrated into designated very large online platforms or search engines. Point (a) excludes Annex I products, Annex III point 2, Art 74(6) entities and Annex III point 8 (justice). Serious incidents go to the AI Office (75(1a)) | n/a | Art 113, second paragraph (Chapter IX); 2026/1744 Art 1(31), (32) | [OJ 2026/1744][oj1744], [Consolidated][cons] | Verified 2026-11-05; **Legal review** LR-08 |
| Chapter III Section 5 (Arts 40 to 49), Art 71, Art 72, Art 73 | Providers, deployers | Standards, conformity assessment, declaration, CE marking, registration, EU database, post-market monitoring, serious incidents. On the text these apply from 2 Aug 2026, but the duties that trigger them (Art 16, Art 6(4), Art 26) apply only from 2 Dec 2027 or 2 Aug 2028 | Do not compute readiness from 2 Aug 2026 alone | Art 113, second paragraph, read with point (c) | [Consolidated][cons] | Verified 2026-11-05; **Legal review** LR-02 |

### 2 December 2026

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Art 5(1), first subparagraph, points (ba) and (bb); Art 5(1a); Art 5(1b) | Providers (placing on the market, putting into service); deployers (use) | Prohibits AI systems that (ba) generate or manipulate realistic images, video, audio or similar material of an identifiable person's intimate parts, or of an identifiable person in sexually explicit activity, without that person's freely given, specific, informed, unambiguous and explicit consent; or (bb) generate or manipulate child sexual abuse material or performance (Directive 2011/93/EU, Art 2(c) and (e)), unless a "without right" defence applies under national law. Conditions in [section 5](#5-exact-references-art-5-art-111-and-art-113) | None (the Art 111 carve-outs are without prejudice to Art 5) | Art 113(3)(a) as replaced by 2026/1744 Art 1(40)(a); points inserted by Art 1(7)(a), paragraphs by Art 1(7)(b); recitals (10) to (14) | [OJ 2026/1744][oj1744], [Consolidated][cons], [AISD][aisd] | Verified 2026-11-05; **Legal review** LR-05 |
| Art 111(4) with Art 50(2) | Providers of AI systems, including GPAI systems, that generate synthetic audio, image, video or text | Systems placed on the market before 2 Aug 2026 must take the necessary steps to comply with Art 50(2) by 2 Dec 2026. Recital (38) calls this a four-month transitional period. Systems placed on the market on or after 2 Aug 2026 are already covered | Selection: `generatesSyntheticContent = true` and `placedOnMarketDate < 2026-08-02` | Art 111(4), added by 2026/1744 Art 1(39)(b) | [OJ 2026/1744][oj1744], [Consolidated][cons], [AISD][aisd] | Verified 2026-11-05; **Legal review** LR-04 |

### 2 August 2027

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Art 111(3) | GPAI model providers | Models placed on the market before 2 Aug 2025 must comply by this date | Selection: `gpaiModelPlacedOnMarketDate < 2025-08-02` | Art 111(3), unchanged | [Consolidated][cons], [OJ 2024/1689][oj1689] | Verified 2026-11-05 |
| Art 57(1) (authority deadline) | Member States | At least one national AI regulatory sandbox operational. The previous deadline was 2 Aug 2026 | n/a | Art 57(1) as replaced by 2026/1744 Art 1(22)(a) | [OJ 2026/1744][oj1744], [AISD][aisd] | Verified 2026-11-05 |
| Art 2(13) (authority deadline) | Commission | Delegated acts specifying when Annex I Section A legislation can limit Art 9 to 15 and 17 to 25 requirements | n/a | Art 2(13), added by 2026/1744 Art 1(3) | [OJ 2026/1744][oj1744] | Verified 2026-11-05 |

Related authority deadlines in the JSON:
- Art 96(1)(g) guidelines, by 1 Aug 2027;
- Art 72(3) template for the post-market monitoring plan, by 2 Sep 2027;
- Art 43(3): Annex I Section A notified bodies apply for designation, by 28 Jan 2028.

All three are verified.

### 2 December 2027

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Chapter III Sections 1 to 3 (Arts 6 to 27, except Art 6(5)) for Art 6(2)/Annex III systems | Providers, deployers, importers, distributors, authorised representatives | Classification rules; requirements of Arts 8 to 15; obligations of Arts 16 to 27, including deployer duties (Art 26) and the fundamental rights impact assessment (Art 27). Previously 2 Aug 2026 | **Art 111(2) (replaced), cut-off 2 Dec 2027:** <br>• Systems first placed on the market or put into service before 2 Dec 2027 are covered only if they undergo significant design changes from that date. The first unit of the type and model sets the date (recital (39) of 2026/1744). <br>• Of those, systems intended for use by public authorities must comply by 2 Aug 2030 (`aia-2030-08-02-public-authority-legacy-annex-iii`). <br>• Art 111(2) leaves out the Art 111(1) systems: Annex X components placed before 2 Aug 2027, which must comply by 31 Dec 2030. <br>• The Art 5 prohibitions are unaffected | Art 113(3)(c)(i) as replaced by 2026/1744 Art 1(40)(b) | [OJ 2026/1744][oj1744], [Consolidated][cons], [OJ 2024/1689][oj1689], [AISD][aisd] | Verified 2026-11-05; **Legal review** LR-02, LR-03, LR-09 |

### 2 August 2028

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Chapter III Sections 1 to 3 for Art 6(1)/Annex I systems; Art 6(1a) to (1c); Art 2(2) as replaced; Annex I | Providers, product manufacturers, deployers, importers, distributors, authorised representatives | Chapter III Sections 1 to 3 apply to Annex I systems. Previously 2 Aug 2027. Changes made by 2026/1744: <br>• Annex I Section B products: only Art 6(1), Art 60a and Arts 102 to 112 apply; Arts 57 to 59 only where the requirements have been integrated into sector law. <br>• Annex I: Section A point 1 (Machinery Directive 2006/42/EC) deleted; Regulation (EU) 2023/1230 added as Section B point 21. <br>• Art 6(1a) to (1c) narrow the meaning of "safety component" | **Art 111(2) (replaced), cut-off 2 Aug 2028:** <br>• Systems first placed on the market or put into service before 2 Aug 2028 are covered only if they undergo significant design changes from that date (recital (39) of 2026/1744). <br>• Of those, systems intended for use by public authorities must comply by 2 Aug 2030 (`aia-2030-08-02-public-authority-legacy-annex-i`). <br>• Art 111(2) leaves out the Art 111(1) systems (31 Dec 2030). <br>**Also:** <br>• Art 2(13) limitations, specified by delegated acts due by 2 Aug 2027. <br>• Art 43(3): Annex I Section A notified bodies apply for designation by 28 Jan 2028 | Art 113(3)(c)(ii) as replaced; 2026/1744 Art 1(2)(a), (8), (40)(b), (41) | [OJ 2026/1744][oj1744], [Consolidated][cons], [OJ 2024/1689][oj1689], [AISD][aisd] | Verified 2026-11-05; **Legal review** LR-03, LR-09, LR-10 |

### 2 August 2030 and 31 December 2030

| Provision | Actor | Obligation | Transitional conditions | Basis | Source | Status |
|---|---|---|---|---|---|---|
| Art 111(2), second sentence, Annex III route (`aia-2030-08-02-public-authority-legacy-annex-iii`) | Providers and deployers of legacy high-risk systems intended for use by public authorities | Must comply by 2 Aug 2030, whether or not the design changes; a significant design change from the cut-off brings the obligations forward. A system first placed on the market or put into service on or after the cut-off is not a legacy system: the Regulation applies to it from that point | Selection: `highRiskRoute = annex_iii`, `firstPlacedOnMarketOrPutIntoServiceDate < 2027-12-02` and `intendedForUseByPublicAuthorities = true`, except Art 111(1) systems | Art 111(2) as replaced by 2026/1744 Art 1(39)(a), with Art 113(3)(c)(i); date unchanged | [OJ 2026/1744][oj1744], [Consolidated][cons], [OJ 2024/1689][oj1689] | Verified 2026-11-05; **Legal review** LR-03 |
| Art 111(2), second sentence, Annex I route (`aia-2030-08-02-public-authority-legacy-annex-i`) | As above | As above | Selection: `highRiskRoute` in Annex I Section A or B, `firstPlacedOnMarketOrPutIntoServiceDate < 2028-08-02` and `intendedForUseByPublicAuthorities = true`, except Art 111(1) systems | Art 111(2) as replaced by 2026/1744 Art 1(39)(a), with Art 113(3)(c)(ii); date unchanged | [OJ 2026/1744][oj1744], [Consolidated][cons], [OJ 2024/1689][oj1689] | Verified 2026-11-05; **Legal review** LR-03, LR-10 |
| Art 111(1) | Providers, deployers | Components of the Annex X large-scale IT systems placed on the market or put into service before 2 Aug 2027 must comply by **31 Dec 2030** | Selection: `annexXLargeScaleItComponent = true` and `firstPlacedOnMarketOrPutIntoServiceDate < 2027-08-02`. Measuring that date by the first unit of the type and model, as recital (39) of 2026/1744 does for Art 111(2), is an assumption | Art 111(1), unchanged | [Consolidated][cons], [OJ 2024/1689][oj1689], [OJ 2026/1744][oj1744] | Verified 2026-11-05; **Legal review** LR-03 |

**How the Art 111 rules are encoded.**
- **Cut-off by route.** Art 111(2) uses "the date of application of Chapter III referred to in Article 113". Each Chapter III entry and each 2 Aug 2030 entry therefore tests the cut-off for its own route. A public-authority system first placed on the market in 2028 under Annex III is not selected for the 2030 deadline, because the Regulation applies to it from placing.
- **Art 111(1) systems.** Art 111(2) covers high-risk systems "other than the systems referred to in paragraph 1", that is, Annex X components placed on the market or put into service before 2 August 2027. The Art 111(2) records and the 2030 entries leave these out through `exceptIf`. An Annex X component first placed between 2 August 2027 and the cut-off is not an Art 111(1) system, so Art 111(2) still reaches it. The Art 111(1) entry and these `exceptIf` lists measure the 2 August 2027 date with the same first-unit fact. Recital (39) of 2026/1744 states the first-unit rule only for Art 111(2), so this reuse is an assumption that LR-03 asks a lawyer to confirm.
- **The 2030 sentence.** Recital (177) of Regulation (EU) 2024/1689 gives the Annex X systems and the public-authority systems their deadlines "respectively". The data therefore applies the exclusion to the 2 August 2030 sentence as well; LR-03 asks a lawyer to confirm this.
- **Cross-references.** Every transitional record that restates a standalone entry carries that entry's `entryId`, with the same deadline and predicates. The Annex III and Annex I entries carry the same three Art 111 records.

The Commission's timeline ([AISD][aisd]) has entries for 1 August 2024, 2 February 2025, 2 August 2025, 2 August 2026, 2 December 2026, 2 August 2027 (national sandboxes, not Art 111(3)), 2 December 2027 and 2 August 2028. It has none for 27 July 2026, 2 August 2030 or 31 December 2030. Those dates come from Art 4 of Regulation (EU) 2026/1744 and from Art 111.

## 5. Exact references: Art 5, Art 111 and Art 113

| Provision | Change | Amending provision (Regulation (EU) 2026/1744) | Effect | Status |
|---|---|---|---|---|
| Art 5(1), first subparagraph, points (ba) and (bb) | Inserted | Art 1, point (7)(a) | New prohibitions from 2 Dec 2026 | Verified 2026-11-05 ([OJ][oj1744]) |
| Art 5(1a), points (a)(i), (a)(ii) and (b); Art 5(1b) | Inserted | Art 1, point (7)(b) | Scope conditions for (ba)/(bb) | Verified 2026-11-05 ([OJ][oj1744]) |
| Art 111(2) | Replaced | Art 1, point (39)(a) | Legacy cut-off moves from the fixed 2 Aug 2026 to "the date of application of Chapter III referred to in Article 113"; 2 Aug 2030 public-authority deadline kept | Verified 2026-11-05 ([OJ][oj1744], [OJ 2024/1689][oj1689]) |
| Art 111(4) | Added | Art 1, point (39)(b) | Art 50(2) transition to 2 Dec 2026 | Verified 2026-11-05 ([OJ][oj1744]) |
| Art 113, third paragraph, point (a) | Replaced | Art 1, point (40)(a) | Chapters I and II from 2 Feb 2025, except Art 5(1)(ba), (bb), (1a), (1b) from 2 Dec 2026 | Verified 2026-11-05 ([OJ][oj1744]) |
| Art 113, third paragraph, point (c) | Replaced | Art 1, point (40)(b) | Chapter III Sections 1 to 3 except Art 6(5): (i) 2 Dec 2027 Annex III; (ii) 2 Aug 2028 Annex I. Before the amendment: Art 6(1) duties from 2 Aug 2027 and the rest of Chapter III, other than Section 4, from 2 Aug 2026 | Verified 2026-11-05 ([OJ][oj1744], [OJ 2024/1689][oj1689]) |
| Art 113, third paragraph, point (d) | Added | Art 1, point (40)(c) | Arts 102 to 110 from 27 Jul 2026 | Verified 2026-11-05 ([OJ][oj1744]) |
| Art 113, second paragraph; third paragraph, point (b) | Unchanged | none | 2 Aug 2026 general date; 2 Aug 2025 for Chapter III Section 4, Chapter V, Chapter VII, Chapter XII and Art 78, except Art 101 | Verified 2026-11-05 ([Consolidated][cons]) |
| Art 6(4); Annex VIII Section B | Art 6(4) unchanged; Section B points 7 and 9 deleted | Art 1, point (42) | Art 6(3) derogations are still documented and registered under Art 49(2), with less information | Verified 2026-11-05 ([OJ][oj1744], [Consolidated][cons]) |
| Art 40(2), fourth subparagraph | Added | Art 1, point (17) | The Commission must request standardisation deliverables that facilitate joint compliance and presumption of conformity with the requirements or obligations of Chapter III Sections 2 and 3 and of the Annex I legislation (recital (21)). Art 40(1) is unchanged (LR-01) | Verified 2026-11-05 ([OJ][oj1744], [Consolidated][cons]) |

**Conditions of the new prohibitions** (Art 5(1a) and (1b); paraphrased, so the authentic text governs):
- **Providers (Art 5(1a)(a)).** Placing on the market or putting into service is prohibited only where:
  - (i) generating or manipulating such material is the system's intended purpose; or
  - (ii) the system's design, training, architecture, capabilities or user-facing functions make that output a reasonably foreseeable and reproducible outcome without significant technical modification, **and** the system lacks reasonable and adequate technical safety measures and other safeguards to reliably prevent it (allowing for reasonably foreseeable misuse) and to correct observed or reported misuse.
- **Deployers (Art 5(1a)(b)).** Use is prohibited only where the deployer uses the system for the purpose of generating or manipulating such material.
- **Point (ba) only (Art 5(1b)).** Manipulation that neither increases the exposure of depicted intimate parts nor changes the nature of depicted sexual activity is not "manipulation".
- **Recital (12)** gives examples of safeguards (for example refusal training, output controls, content filtering, abuse detection) and says accidental generation, and use for lawful purposes, are outside the deployer prohibition.

**Art 5(1) practices with their dates** (for the enumerated screen in [#19](https://github.com/ahed-jneed/ai-assurance/issues/19); `prohibitedPractices` in the JSON). The Commission calls (ba)/(bb) "prohibition 9" ([EC][ecpage]).

| Point | Practice (short label) | Applies from |
|---|---|---|
| (a) | Subliminal, manipulative or deceptive techniques causing significant harm | 2 Feb 2025 |
| (b) | Exploiting vulnerabilities due to age, disability or social or economic situation | 2 Feb 2025 |
| (ba) | Non-consensual realistic intimate or sexually explicit material of an identifiable person | **2 Dec 2026** |
| (bb) | Child sexual abuse material, unless a national "without right" defence applies | **2 Dec 2026** |
| (c) | Social scoring | 2 Feb 2025 |
| (d) | Crime prediction based solely on profiling or personality traits | 2 Feb 2025 |
| (e) | Untargeted scraping to build facial recognition databases | 2 Feb 2025 |
| (f) | Emotion inference at work or in education (except medical or safety reasons) | 2 Feb 2025 |
| (g) | Biometric categorisation inferring sensitive characteristics | 2 Feb 2025 |
| (h) | Real-time remote biometric identification in public spaces for law enforcement, except listed objectives | 2 Feb 2025 |

Source for the table: [Consolidated][cons], [OJ 2026/1744][oj1744], and [OJ 2024/1689][oj1689] for the unchanged points. Status: Verified 2026-11-05. In the JSON, each point carries its own `sourceIds`, `verification` and the `entryId` of the entry that dates it.

## 6. Article 4a: special-category data for bias detection

Art 4a was inserted by 2026/1744 Art 1(6) and has been in force since 27 July 2026. It replaces Art 10(5), deleted by Art 1(9)(b). The summary below is a structured paraphrase of the OJ text; the authentic text governs. Status: Verified 2026-11-05 ([OJ][oj1744]); **Legal review** LR-06.

**Paragraph 1: providers of high-risk AI systems.**
- **When it applies.** Exceptionally, to the extent strictly necessary for bias detection and correction under Art 10(2)(f) and (g).
- **Other law.** It applies on top of the GDPR, the EUDPR and the Law Enforcement Directive, with appropriate safeguards for fundamental rights.
- **Conditions.** All of the following must be met:
  - (a) Bias detection and correction cannot be done effectively with other data, including synthetic or anonymised data.
  - (b) There are technical limits on re-use, and state-of-the-art security and privacy-preserving measures, including pseudonymisation.
  - (c) The data are secured and protected, with strict controls and documentation of access, so that only authorised persons with confidentiality obligations have access.
  - (d) The data are not transmitted, transferred or otherwise accessed by other parties.
  - (e) The data are deleted once the bias is corrected or the retention period ends, whichever comes first.
  - (f) The records of processing activities state why the processing was strictly necessary and why other data could not achieve the objective.

**Paragraph 2: providers and deployers of other AI systems and models, and deployers of high-risk AI systems.**
- **When it applies.** Exceptionally, where strictly necessary for bias detection and correction in view of possible biases likely to affect health and safety, harm fundamental rights or lead to prohibited discrimination. This is especially relevant where outputs influence future inputs.
- **Conditions.** All of the paragraph 1 conditions and safeguards apply.
- **No duty.** The paragraph creates no obligation to carry out bias detection.

**Related provisions**
- Art 10(1) as replaced: data sets of data-trained high-risk systems must meet Art 10(2) to (4) **and Art 4a(1)**.
- Art 10(6) as replaced: systems without model training: only testing data sets.
- Art 2(7) as replaced: data protection law is unaffected, without prejudice to Arts 4a and 59.
- Recital (9) explains the extension and says the legal basis should apply from the date of entry into application, so that providers can prepare before the Art 10 duties apply.

**Implication for this platform (Legal review LR-06).** Condition (d) bars access by "other parties". On its face, Art 4a cannot by itself authorise a client to upload special-category data to an external auditor's platform. This matches the existing methodology's preference for client-side computation that returns approved aggregates.

## 7. Article 6 classification guidelines and other guidance

| Item | Status | Dates | Source | Marker |
|---|---|---|---|---|
| Art 6(5) guidelines on high-risk classification | **Draft** | Statutory deadline 2 Feb 2026 (missed); draft published 19 May 2026; consultation deadline 23 Jun 2026 in the news item and 23 Jul 2026 on the Service Desk (an extension is inferred; no official page says so); page last updated 23 Jul 2026; no adopted version found on 5 Nov 2026 | [Draft][hrdraft], [news][hrnews], [Service Desk][hraisd], [Consolidated][cons] | Verified 2026-11-05 |
| Expected final adoption | **Not announced** | No Commission page checked gives a date. One third-party tracker ([regulations.ai][regai], as of 7 Sep 2026) expects end-2026, but it cites no source for that date and its footer says it was generated with AI tools. Recorded as UV-03 and not used in the data | [Draft][hrdraft], [Service Desk][hraisd] | Verified 2026-11-05 (no date announced); the tracker's date is secondary-only |
| Guidelines on transparency obligations (Art 50) | Published | Listed 20 Jul 2026; content not reviewed | [EC page][ecpage] ([document](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems)) | Verified 2026-11-05 (listing) |
| Commission opinion on the Code of Practice on Transparency of AI-generated Content | Published | Listed 9 Jul 2026; content not reviewed. Under Art 50(7) as replaced, the Commission assesses whether codes are adequate for Art 50(2) and (4) | [EC page][ecpage] ([document](https://digital-strategy.ec.europa.eu/en/library/commission-opinion-assessment-code-practice-transparency-ai-generated-content)) | Verified 2026-11-05 (listing) |
| Guidelines on prohibited AI practices | Published for prohibitions 1 to 8 | No guidance specific to (ba)/(bb) found | [EC page][ecpage] | Verified 2026-11-05 |

**Platform use.** Classification rationales should cite the Art 6 guidelines as a draft and create a re-review task when the final version is adopted ([#19](https://github.com/ahed-jneed/ai-assurance/issues/19)).

## 8. Standards register

### 8.1 EN 18286:2026

| Fact | Value | Source | Marker |
|---|---|---|---|
| Title | Artificial intelligence: Quality management system for EU AI Act regulatory purposes | [Decision][dec2274], [CEN list][cenpub] | Verified 2026-11-05 |
| Body | CEN and CENELEC, CEN/CLC/JTC 21 (work item JT021039) | [CEN list][cenpub] | Verified 2026-11-05 |
| CEN publication | 22 July 2026 | [CEN list][cenpub], [CEN news][cennews07] | Verified 2026-11-05 |
| OJ citation | Commission Implementing Decision (EU) 2026/2274 of 12 October 2026 on the harmonised standards for high-risk AI systems drafted in support of Regulation (EU) 2024/1689; OJ L, 2026/2274, 14.10.2026; in force 14 Oct 2026; ELI `http://data.europa.eu/eli/dec_impl/2026/2274/oj` | [Decision][dec2274] | Verified 2026-11-05 |
| Restrictions in the Decision | None: the Annex lists only the reference and title | [Decision][dec2274] | Verified 2026-11-05 |
| Standardisation request | Implementing Decision C(2025) 3871 of 23 June 2025, Annex I point 9 (QMS including post-market monitoring) | [Decision][dec2274] | Verified 2026-11-05 |
| Only cited AI Act standard | Yes. SPARQL found no other implementing decision on harmonised standards for 2024/1689 | [SPARQL][sparql] | Verified 2026-11-05 |
| Statutory basis of the presumption | **Art 40(1), unchanged:** conformity with a cited harmonised standard gives a presumption for Chapter III **Section 2** requirements (Arts 8 to 15), or Chapter V obligations, to the extent the standard covers them. Art 17 is in **Section 3**. <br>**Art 40(2), fourth subparagraph**, added by 2026/1744 Art 1(17): the Commission must request deliverables that facilitate joint compliance and presumption of conformity with the requirements or obligations of Chapter III Sections 2 and 3 and of the Annex I legislation (recital (21)). It governs standardisation requests and does not amend Art 40(1); EN 18286 was requested earlier, under C(2025) 3871. <br>**The Decision:** its recital (1) summarises Art 40 as a presumption for the requirements the standards cover, without the Section 2 limit. The presumption runs from OJ publication (recital (6)); Art 17 itself applies from 2 Dec 2027 or 2 Aug 2028 | [Consolidated][cons], [OJ 2026/1744][oj1744], [Decision][dec2274] | Verified 2026-11-05; **Legal review** LR-01 |
| Official description | Commission: a presumption of conformity with the Art 17 requirements the standard covers; the only AI QMS standard with a presumption; designed to layer on ISO/IEC 42001, ISO 9001 or ISO 13485. CEN-CENELEC: a presumption of conformity with the corresponding AI Act provisions | [EC news][ecnews18286], [CEN news][cennews10] | Verified 2026-11-05 |
| Clause scope (Annex ZA, Table ZA.1) | Art 17(1) (first sentence, the documentation sentence and points (a) to (m)) and the first sentence of Art 11(1). Art 17(2), (3) and (4) are not covered. Orrick says "Articles 11(1) and 17(1)" without the first-sentence qualifier | [Intertek][intertek], [Modulos][modulos], [Swiss GRC][swissgrc], [Orrick][orrick] | **Secondary-only**: Annex ZA (paywalled) not read |

### 8.2 ISO/IEC standards (no presumption of conformity)

| Standard | ISO status | EN adoption (CEN) | OJ citation | Source | Marker |
|---|---|---|---|---|---|
| ISO/IEC 42001:2023, AI management system | Published 2023-12, ed. 1, stage 60.60 | EN ISO/IEC 42001:2026, published 18 Mar 2026 | None. A certificate gives no presumption; EN 18286 is designed to sit on top of it | [ISO][iso42001], [CEN list][cenpub], [Decision][dec2274] | Verified 2026-11-05 |
| ISO/IEC 42005:2025, AI system impact assessment | Published 2025-05, ed. 1, stage 60.60 | None in the JTC 21 lists | None | [ISO][iso42005], [CEN list][cenpub] | Verified 2026-11-05 |
| ISO/IEC 42006:2025, requirements for AIMS certification bodies | Published 2025-07, ed. 1, stage 60.60 | prEN ISO/IEC 42006 (JT021057), Under Approval; current stage 29 Oct 2026; forecast vote 31 Dec 2026 | None | [ISO][iso42006], [CEN work programme][cenwp] | Verified 2026-11-05 |
| ISO/IEC 23894:2023, guidance on AI risk management | Published 2023-02, ed. 1, stage 60.60 | EN ISO/IEC 23894:2024, published 21 Feb 2024 | None | [ISO][iso23894], [CEN list][cenpub] | Verified 2026-11-05 |

Cite ISO/IEC and EN content by clause number only: these standards are paywalled.

### 8.3 CEN-CENELEC JTC 21 drafts (not harmonised; state of the art only)

- **Stages and dates (verified).** Read from CEN's work programme ([CEN work programme][cenwp]) on 5 November 2026.
- **Status labels.** "Under Drafting", "Under Enquiry" and "Under Approval" are CEN's own labels, reproduced as its work programme shows them. This report does not interpret which stages each label covers. For example, CEN shows prEN 18229-2 "Under Approval" from 29 October 2026, while the tracker placed it in Commission pre-enquiry assessment on 15 October.
- **Enquiry outcomes (secondary-only).** CEN does not publish them. The "reported" column comes from a vendor tracker ([KLA][kla]) that cites AI Standardisation Watch ed. 16.
- **AI Act article mapping (indicative).** Taken from the titles and the standardisation request areas.

| Draft | Title | AI Act (indicative) | CEN status | Initial / current stage / next stage / forecast vote | Reported (secondary-only) |
|---|---|---|---|---|---|
| prEN 18228 (JT021024) | AI Risk Management | Art 9 | Under Approval | 2024-03-20 / 2026-07-30 / 2026-09-30 / 2026-09-30 (forecast date has passed) | Enquiry closed 30 Jul 2026, reportedly rejected; comment resolution early Nov, then formal vote |
| prEN 18229-1 (JT021008) | Trustworthiness framework, Part 1: Logging | Art 12 | Under Approval | 2024-03-20 / 2026-08-20 / 2026-11-30 / 2026-11-30 | Enquiry closed 20 Aug 2026 with 443 comments; reportedly failed the weighted vote |
| prEN 18229-2 (JT021047) | Part 2: Transparency | Art 13 | Under Approval | 2025-05-15 / 2026-10-29 / 2026-11-19 / 2027-03-07 | As of 15 Oct: in Commission pre-enquiry assessment |
| prEN 18229-3 (JT021056) | Part 3: Human oversight | Art 14 | Under Approval | 2026-03-11 / 2026-10-22 / 2027-07-01 / 2027-07-01 | Enquiry closed 22 Oct 2026; no result reported |
| prEN 18229-4 (JT021058) | Part 4: Accuracy | Art 15 | Under Drafting | 2026-06-24 / 2026-06-24 / none / 2027-07-21 | none |
| prEN 18229-5 (JT021059) | Part 5: Robustness | Art 15 | Under Drafting | 2026-06-24 / 2026-06-24 / none / 2027-07-21 | none |
| prEN 18282 (JT021029) | Cybersecurity specifications for AI systems | Art 15 | Under Approval | 2024-10-02 / 2026-07-30 / 2026-07-15 / 2026-07-15 (earlier than the current stage; stale) | Enquiry reportedly rejected; revised scope balloted to 16 Sep 2026 |
| prEN 18283 (JT021036) | Managing bias in AI systems | Art 10 | Under Enquiry | 2024-08-21 / 2026-10-01 / 2026-12-24 / 2027-03-03 | none |
| prEN 18284 (JT021037) | Quality and governance of datasets in AI | Art 10 | Under Drafting | 2024-09-05 / 2024-09-05 / none / 2027-03-18 | As of 15 Oct: Commission pre-enquiry review |
| prEN 18285 (JT021038) | AI conformity assessment framework | Art 43, Annexes VI, VII | Under Drafting | 2024-10-16 / 2024-10-16 / 2025-02-12 / 2026-07-29 (both dates have passed) | As of 15 Oct: mature draft going to Commission review |

Separately, new Art 42(3), added by 2026/1744 Art 1(18), deems high-risk systems that meet the Cyber Resilience Act conditions (Regulation (EU) 2024/2847, Art 12(1)) to comply with the Art 15 cybersecurity requirements. Verified 2026-11-05 ([OJ][oj1744]).

## 9. Diff against the repository: changes #18 must make

The baseline is `main@68ec79a`; locate code by the quoted identifiers, not by line numbers. Since the previous baseline, `b15f037`, `main` has split `site-app/lib/store.ts` (3629d91), `site-app/lib/domain.ts` (32ca048) and `site-app/app/workspace.tsx` (cb94d84) into modules, so RD-70, RD-71 and the `annexRoute` mapping under RD-27 name the files that now hold the code. The four sources named in #8 and every quoted "current" value are unchanged since `b15f037`, and the four sources are unchanged since `74c6463`; the only `README.md` changes are outside the legal snapshot. "Before 2 Dec" marks changes that should ship before the 2 December 2026 milestones. Basis ids refer to the JSON. The machine-readable list is `repositoryDiff`.

**`templates/catalog.json`**

| ID | Location | Current | Finding | Change | Before 2 Dec |
|---|---|---|---|---|---|
| RD-01 | `/methodologyVersion` | `2026.10.1` | Stale | Bump to 2026.11.1 | |
| RD-02 | `/regulatorySnapshot/researchedAsOf` | `2026-10-05` | Stale | 2026-11-05; carry `verifiedOn` per date | Yes |
| RD-03 | `/regulatorySnapshot/celex`, `consolidatedAsOf` | `02024R1689-20260727`, `2026-07-27` | Correct | No change | |
| RD-04 | `/regulatorySnapshot/amendingRegulation` | `(EU) 2026/1744` | Incomplete | Add the OJ reference, adoption and entry-into-force dates, the ELI and the two other regulations it amends | |
| RD-05 | `/regulatorySnapshot/authenticAmendmentUrl` | EUR-Lex `OJ:L_202601744` | Incomplete | Add the ELI as canonical; use CELLAR for automated checks | |
| RD-06 | `/regulatorySnapshot/officialTextUrl` | Consolidated-text URL | Imprecise | Label it as the consolidated text with no legal effect | |
| RD-07 | `/regulatorySnapshot/applicationDates` | 3 entries | Incomplete | Replace with the 19 `applicationDates` entries, adding source, `verifiedOn`, legal-review flags and approval metadata. List a transitional record that has an `entryId` once, under the entry it names | Yes |
| RD-08 | `applicationDates[2]` (Art 50) | "transitions assessed separately" | Incomplete | Name the Art 111(4) deadline of 2 Dec 2026 | Yes |
| RD-09 | `applicationDates[0..1]` (Chapter III) | 2027-12-02, 2028-08-02 | Correct | Keep; add the Art 113(3)(c) basis and the Art 111(2) rule | |
| RD-10 | `/regulatorySnapshot/guidance` | Readiness labels, Art 10(5) deleted, Art 4a | Incomplete | Add the Art 5(1)(ba)/(bb) screen and Art 4a(1) versus 4a(2) | Yes |
| RD-11 | new: standards register | absent | Missing | Add from `standards` (EN 18286 cited, ISO/IEC not cited, drafts labelled not harmonised) | |
| RD-12 | items WP-XC-01, WP-XC-06 | Generic standards wording | Incomplete | Point both papers at the register; state that an ISO/IEC 42001 certificate gives no presumption | |
| RD-13 | items WP-PL-03 P01, MEM-CL-01 | "Screen prohibited practices against current legal text" | Incomplete | Link to `prohibitedPractices` with dates (with #19) | Yes |
| RD-14 | item WP-XC-07 P01 | "...applicability and transitions" | Incomplete | Name Art 111(4) and the actor split in Art 50(1) to (4) | Yes |
| RD-15 | item WP-XC-09 (Art 4) | Literacy measures in context | Correct | No change needed | |

**`docs/obligation-subitems.json`**

| ID | Location | Current | Finding | Change | Before 2 Dec |
|---|---|---|---|---|---|
| RD-20 | `/catalogVersion` | `2026.10.07-proposed` | Stale | New version for 2026.11.1 | |
| RD-21 | `/source/researchedAsOf` | `2026-10-07` | Stale | 2026-11-05 | |
| RD-22 | `/source/version`, `items[*].version` | `02024R1689-20260727` | Correct | No change | |
| RD-23 | `/source/url`, `/source/authenticAmendment` | EUR-Lex URLs | Incomplete | Add the ELI and CELLAR access URLs | |
| RD-24 | `/applicationContext/legalSource` | "Article 113(c), version ..." | Imprecise | "Article 113, third paragraph, point (c)(i) and (ii), as replaced by Regulation (EU) 2026/1744, Art 1, point (40)(b)" | |
| RD-25 | `/applicationContext` dates and `covers` | 2027-12-02, 2028-08-02, Sections 1 to 3 except 6(5) | Correct | No change | |
| RD-26 | `/applicationContext/approvalRule` | "Assess Articles 2 and 111..." | Incomplete | Spell out Art 111: the route-specific cut-off set by the first unit of the type and model, the significant design change trigger, 2 Aug 2030 for legacy systems only, 31 Dec 2030 for Annex X systems (outside Art 111(2)), and that Art 5 is unaffected | |
| RD-27 | `/factTypes` | 15 `boolean_or_unknown` facts and 1 array (`operatorRoles`); no dates | Missing | Declare all 8 facts the date predicates use (table below). 2 of them select the 2 Dec 2026 Art 111(4) entry | Yes |
| RD-28 | `/decisionPolicy/dataScope` | Art 10(6) and Art 4a(1); Art 10(5) deleted | Correct | Keep; add Art 4a(2) and its "no obligation" sentence | |
| RD-29 | item AIA-11-1 `reviewNote` | SME/SMC simplified form | Correct | Optional: the Commission form is mandatory for simplified submissions and notified bodies must accept it | |
| RD-30 | items AIA-AIV-8 (Art 47), AIA-AIV-9 (Art 72) | Annex IV points 8, 9 | Needs legal review | Flag the general-date versus Chapter III-date question (LR-02) | |

**Facts used by the date predicates** (RD-27; `vocabularies.factVocabulary` in the JSON). None of them exists today in `/factTypes` or in the classification model (`Classification` in `site-app/lib/domain/classification.ts`, re-exported from `site-app/lib/domain.ts`), whose only route field is the free-text `annexRoute`.

| Fact | Type | Used by | Value comes from | Needed before 2 Dec |
|---|---|---|---|---|
| `generatesSyntheticContent` | Boolean or unknown | Art 111(4): `aia-2026-12-02-art50-2-legacy-transition` and its record in the Art 50 entry | #19, as its Art 50(2) provider trigger | Yes |
| `placedOnMarketDate` | Date or unknown | Art 111(4) | Not in #19's scope | Yes |
| `highRiskRoute` | `annex_iii`, `annex_i_section_a`, `annex_i_section_b`, `not_high_risk` or unknown | Art 111(2) records; 2 Aug 2030 entries | #19, which derives high-risk from the route; maps from `annexRoute` (below) | No |
| `firstPlacedOnMarketOrPutIntoServiceDate` | Date or unknown: when the first unit of the type and model was lawfully placed on the market or put into service (recital (39)) | Art 111(2); Art 111(1) by assumption (LR-03) | Not in #19's scope | No |
| `significantDesignChangeOnOrAfterChapterIIIDate` | Boolean or unknown | Art 111(2), `obligationsApplyOnlyIf` | Not in #19's scope | No |
| `intendedForUseByPublicAuthorities` | Boolean or unknown | 2 Aug 2030 entries | Not in #19's scope | No |
| `annexXLargeScaleItComponent` | Boolean or unknown | Art 111(1) entry; `exceptIf` of the Art 111(2) records | Not in #19's scope | No |
| `gpaiModelPlacedOnMarketDate` | Date or unknown | Art 111(3) | Not in #19's scope; #19's GPAI model-provider role decides whether to ask it | No |

- **Mapping `annexRoute` to `highRiskRoute`.** The seven values that the classification form (`site-app/app/workspace/modals/classification.tsx`) offers map as follows:
  - "Annex III — sensitive use case" to `annex_iii`;
  - "Annex I Section A — regulated product" to `annex_i_section_a`;
  - "Annex I Section B — sector-specific review" to `annex_i_section_b`;
  - "Article 50 only" and "Outside high-risk scope" to `not_high_risk`;
  - "Unassessed" to unknown, and "Article 6(3) exception assessment" to unknown until the derogation is decided;
  - any other stored value to unknown: `annexRoute` is free text, and the `classify` command (`site-app/lib/commands/classification.ts`) accepts any short string.
- **Consistency.** #19 rejects contradictions between the route and the flags, which keeps `highRiskRoute` consistent with the existing `highRiskConfirmed` and `annexISectionAProduct` facts.
- **Timing.** #19 depends on #18 and may land after 2 December 2026. Until both Art 111(4) facts are captured, that entry yields `needs_information` for every engagement, unless #18 captures the two facts itself.

**`docs/audit-methodology.md`**

| ID | Location | Current | Finding | Change | Before 2 Dec |
|---|---|---|---|---|---|
| RD-40 | First paragraph | Version 2026.10.1; research date 5 Oct 2026 | Stale | 2026.11.1; 5 Nov 2026 | Yes |
| RD-41 | Regulatory snapshot, paragraph 1 | Names 2026/1744 and the 27 Jul 2026 consolidated text | Incomplete | Add the OJ reference, ELI, adoption date, entry into force and the two other regulations it amends | |
| RD-42 | Regulatory snapshot, paragraph 2 | 2 Dec 2027 and 2 Aug 2028; "Earlier prohibitions and general provisions have their own dates" | Incomplete | List every date with its Art 113 or Art 111 basis ([section 4](#4-application-dates-by-provision)) | Yes |
| RD-43 | Regulatory snapshot, paragraph 2 | "Article 50 transparency rules began applying on 2 August 2026" | Incomplete | Correct; add Art 111(4) (2 Dec 2026) | Yes |
| RD-44 | Regulatory snapshot, paragraphs 3, 4 | Art 10(5) gone; Art 4a other-party restriction; Annex I A/B; Art 2(13) | Correct | Keep; add Art 4a(2) and the 2 Aug 2027 deadline for Art 2(13) delegated acts | |
| RD-45 | Regulatory snapshot, paragraph 5 | Store standards and guidance separately | Incomplete | Reference the standards and guidance registers | |
| RD-46 | Classification and applicability | "Screen prohibited practices before high-risk routing" | Incomplete | Enumerate Art 5(1) with dates and the (1a)/(1b) conditions; add Art 6(1a) to (1c); Art 6(3) registration with the shorter Annex VIII Section B | Yes |
| RD-47 | Classification, Art 6 link | `...article-6?trk=article-ssr-frontend-pulse_little-text-block` | Incorrect | Remove the LinkedIn tracking parameter | |
| RD-48 | Classification | No mention of the Art 6 guidelines | Missing | Cite the draft status and add a re-review trigger | |
| RD-49 | Scope sentence | "traditional ML ... classical NLP" | Needs decision | The 2 Dec 2026 milestones concern generative systems; #18 should say how such engagements are routed (#31 to #33). Not changed here | Yes |

**`README.md`, "Current legal snapshot"**

| ID | Location | Current | Finding | Change | Before 2 Dec |
|---|---|---|---|---|---|
| RD-60 | Sentence 1 | "Rule-pack version: `02024R1689-20260727`, researched 5 October 2026" | Stale | Separate the legal-text version (`02024R1689-20260727`), the rule-pack revision (2026.11.1) and the research date (5 Nov 2026) | Yes |
| RD-61 | Sentence 2 | Chapter III dates | Correct | Keep; mention the Art 111(2) legacy rule | |
| RD-62 | Missing | No 2 Dec 2026 milestones | Missing | Add the Art 5(1)(ba)/(bb) prohibitions and the Art 111(4) deadline | Yes |
| RD-63 | Missing | No standards statement | Missing | EN 18286:2026 is the only cited standard (Decision (EU) 2026/2274, OJ L 14.10.2026); ISO/IEC 42001 gives no presumption | |
| RD-64 | Art 4a sentence and link | Article 4a review; `OJ:L_202601744` link | Correct | Keep; add the ELI | |

**Other locations with the same snapshot** (not named in #8, but in #18 scope)

| ID | Location | Finding | Change | Before 2 Dec |
|---|---|---|---|---|
| RD-70 | `site-app/lib/factories.ts`, `freshEngagement`, default classification (`version: "02024R1689-20260727"`, `asOf: "2026-10-05"`); `site-app/lib/store.ts` only re-exports `freshEngagement`. The same literals also appear in the test fixtures `site-app/lib/domain.test.ts` and `site-app/lib/workflow/test-fixtures.ts` | Stale | Read from the catalog | Yes |
| RD-71 | `site-app/app/workspace/views/regulatory-mapping.tsx`, "Applicable dates and legal sources" panel | Stale | Render from the catalog; add the 2 Dec 2026 milestones | Yes |
| RD-72 | `templates/annex-iv-map.json`, source block (`researchedAsOf` 2026-10-05) | Stale | Update with the snapshot | |
| RD-73 | Generated copies. Byte-identical to the canonical files on `main@68ec79a`, as on `b15f037`: `site-app/lib/{catalog,obligation-subitems,annex-iv-map}.json`, `site-app/reference/docs/{audit-methodology.md,obligation-subitems.json}` and `site-app/reference/templates/{catalog.json,annex-iv-map.json,README.md}`. Not byte-identical: `site-app/reference/README.md` differs from `README.md` outside the legal section; its "Current legal snapshot" section matches | Stale after #18 | Regenerate the byte-identical copies through the sync check. Apply RD-60 to RD-64 to the legal section of `site-app/reference/README.md`, unless the sync check regenerates the whole file | |
| RD-74 | `templates/README.md`, last paragraph: "The legal snapshot is 27 July 2026, researched on 5 October 2026" | Stale | Keep the 27 July 2026 snapshot, which is still the latest consolidation. Update the research date and name rule pack 2026.11.1, or point to the catalog's `regulatorySnapshot` instead of restating it. Change it together with RD-60 | |

## 10. Items for qualified legal review

| ID | Topic | Question |
|---|---|---|
| LR-01 | EN 18286 presumption | Art 40(1), unchanged, covers Chapter III Section 2 requirements and Chapter V obligations, but Art 17 is in Section 3. The new fourth subparagraph of Art 40(2) (2026/1744 Art 1(17); recital (21)) has the Commission request deliverables for "presumption of conformity" with Sections 2 and 3, but it governs standardisation requests and does not amend Art 40(1). Recital (1) of Decision 2026/2274 summarises Art 40 without the Section 2 limit. Confirm the legal basis and scope of the presumption the Commission describes, and check Annex ZA in a licensed copy. |
| LR-02 | High-risk-linked provisions on the general date | Chapter III Section 5, Art 71, Art 72 and Art 73 apply from 2 Aug 2026 on the text, but their triggers (Art 16, 6(4), 26) apply from 2 Dec 2027 or 2 Aug 2028. Confirm the operative date for each duty. |
| LR-03 | Art 111(1) and (2) legacy systems | Which Chapter III date is the cut-off (assumed: the route-specific point (c) date, set by the first unit of the type and model under recital (39) of 2026/1744)? Is the 2 Aug 2027 date in Art 111(1) also set by the first unit (assumed yes: the 31 Dec 2030 entry and the `exceptIf` lists use the same fact, although recital (39) states the rule only for Art 111(2))? What is a "significant change in design" (recital (177) of 2024/1689 treats it as equivalent in substance to a substantial modification)? Does the 2 Aug 2030 sentence, like the first, leave out the Art 111(1) systems (assumed yes, from recital (177))? Does "this Regulation shall apply ... only if" also suspend non-Chapter III duties, such as Art 50, for legacy high-risk systems? |
| LR-04 | Art 111(4) scope | How should systems that were only put into service before 2 Aug 2026 be treated? Do new versions or channels after that date count as a new placing on the market? |
| LR-05 | Art 5(1)(ba)/(bb) evidence | What evidence standard applies to "reasonably foreseeable and reproducible outcome" and "reasonable and adequate safeguards", including for open-source and API releases? How is the consent condition in point (ba) evidenced? |
| LR-06 | Art 4a timing and auditors | Confirm application from 27 Jul 2026 (recital (9)). Is an external auditor or audit platform an "other party" under Art 4a(1)(d)? |
| LR-07 | Amendments to chapters already in application | Confirm that the replaced Art 4, the amended Art 3 definitions and Art 4a take effect on 27 Jul 2026. |
| LR-08 | AI Office competence | Confirm that the replaced Art 75(1) and Arts 75a to 75d operate from 2 Aug 2026, and how the exceptions in Art 75(1)(a)(i) to (iv) apply. |
| LR-09 | Art 6(1a) to (1c) timing | These sit in Chapter III Section 1, so they apply from the point (c) dates. Should readiness classification apply them now? |
| LR-10 | Annex I Section B and machinery | What are the consequences of moving Regulation (EU) 2023/1230 to Section B (point 21) and of Art 2(2), including the amendments 2026/1744 makes to the Machinery Regulation? What do the Art 111(2) legacy rule and the 2 Aug 2030 deadline require of Section B systems? |

## 11. Not verified

| ID | Claim | Why |
|---|---|---|
| UV-01 | Clause scope of EN 18286 Annex ZA | Paywalled; four secondary sources agree in substance |
| UV-02 | JTC 21 enquiry outcomes | CEN does not publish them; reported by a newsletter via a vendor tracker |
| UV-03 | Final Art 6 guidelines by end-2026 | The only source is a third-party tracker ([regulations.ai][regai], as of 7 Sep 2026). It cites no source for the date and says it was generated with AI tools. The Commission gives no date, so the data records none |
| UV-04 | "M/613 expires 28 Feb 2027" (earlier research) | Not verified and not needed. The request in force is C(2025) 3871 (verified) |
| UV-05 | Final marking and labelling Code of Practice on 10 Jun 2026 (earlier research) | Not fetched; only the Commission opinion of 9 Jul 2026 is verified, and only as a listing |
| UV-06 | EUR-Lex pages | WAF challenge; the same documents were read via CELLAR, but the EUR-Lex URLs in the repository were not machine-checked |
| UV-07 | Contents of the Art 50 guidelines and the Commission opinion | Listings verified; documents not read |

Conflicts in the earlier research, now resolved:
- **EN 18286 date.** The OJ date is 14 Oct 2026. The 19 Oct 2026 date is the Commission's news item.
- **Scope of the amending act.** Besides 2024/1689, it also amends Regulation (EU) 2018/1139 and Regulation (EU) 2023/1230 (machinery). The earlier research did not record either.

## 12. JSON schema

[`rule-pack-2026-11.json`](rule-pack-2026-11.json) is UTF-8 JSON. Its top-level fields are:

| Field | Content |
|---|---|
| `schemaVersion`, `kind`, `id`, `researchedOn` | `1.0.0`, `rule-pack-research`, `rule-pack-2026-11`, `2026-11-05` |
| `approval` | `status` (`unapproved`), `reviewer`, `approvedAt`. Every entry is unapproved until #18 records a review |
| `vocabularies` | Meaning of `verificationStatus`, `dateType` and `actor` values; `factVocabulary` (facts used in predicates); `predicateOperators`; `predicateRule`; `crossReferenceRule` |
| `legalText` | `baseAct`, `amendingActs` (with corrigenda), `consolidatedVersion`, `otherChecks` |
| `sources` | Source register: `id`, `title`, `publisher`, `kind`, `canonicalUrl` and/or `accessUrl`, `retrievedVia`, `sha256`, `retrievedOn`, `notes` |
| `applicationDates` | Operator-facing entries: `id`, `date`, `dateType`, `provisions`, `scope`, `actors`, `summary`, `conditions`, `appliesIf`, `exceptIf`, `transitional[]` (`reference`, `rule`, `deadline`, `entryId`, `appliesIf`, `exceptIf`, `obligationsApplyOnlyIf`), `legalBasis` (`reference`, `amendedBy`, `previousValue`), `notes`, `sourceIds`, `verification`, `legalReview` (`required`, `itemIds`) |
| `authorityDeadlines` | Commission, Member State and notified-body deadlines |
| `prohibitedPractices` | Each Art 5(1) point with `appliesFrom`, `conditions`, `entryId` (the entry that dates it), `sourceIds` and `verification` |
| `provisionReferences` | Exact amended references and the 2026/1744 points that amend them, each with `sourceIds` and `verification` |
| `specialCategoryData` | Art 4a paragraphs 1 and 2 with every condition |
| `standards` | Register entries with `category` (`harmonised_standard_cited`, `international_standard_not_cited`, `draft_not_harmonised`), CEN stage data and `reportedOutcome` (secondary-only) |
| `guidance` | Art 6 guidelines and Art 50 guidance status |
| `repositoryDiff` | `id`, `file`, `location`, `current`, `finding`, `change`, `basis` (JSON ids), `beforeDec2` |
| `legalReviewItems`, `unverified` | The lists in sections 10 and 11; an `unverified` entry cites its source in `sourceIds` where one exists |

**Rules for #18**
- **Dates.** An entry's `date` maps to `effectiveFrom`. `effectiveTo` stays open until a later rule pack supersedes the entry.
- **Approval.** `reviewer` and `approvedAt` belong in #18's rule records after legal review. This file deliberately leaves them empty.
- **Predicates.**
  - `appliesIf` selects candidate entries and transitional records.
  - `exceptIf` removes candidates. The Art 111(2) records and the 2 Aug 2030 entries use it to leave out the Art 111(1) systems.
  - `obligationsApplyOnlyIf` states the Art 111(2) condition under which the obligations reach a legacy system.
  - Each list is a conjunction evaluated in three-valued logic: false if any predicate is false, true if all are true, otherwise unknown. A candidate needs `appliesIf` true (an absent list counts as true) and `exceptIf` false (an absent list counts as false).
  - An unknown result yields `needs_information`. Predicates never approve applicability.
- **Cross-references.** A transitional record with `entryId` restates the standalone entry it names, with the same deadline and predicates. List the rule once, under that entry, so the "Obligations by date" view does not show it twice; show the record as a link. In `prohibitedPractices`, `entryId` names the entry that dates the point; that entry carries the point's legal-review flags.
- **Secondary-only content.** Fields marked `secondary_only` (EN 18286 clause scope, JTC 21 enquiry outcomes) and the `unverified` list must be shown as unverified.

The schema below (JSON Schema draft 2020-12) is the one the validation run used. It is read straight from this section.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "rule-pack-research/1.0.0",
  "type": "object",
  "required": ["schemaVersion", "kind", "id", "researchedOn", "approval", "vocabularies", "legalText", "sources", "applicationDates", "authorityDeadlines", "prohibitedPractices", "provisionReferences", "specialCategoryData", "standards", "guidance", "repositoryDiff", "legalReviewItems", "unverified"],
  "properties": {
    "schemaVersion": {"const": "1.0.0"},
    "kind": {"const": "rule-pack-research"},
    "researchedOn": {"$ref": "#/$defs/date"},
    "approval": {"type": "object", "required": ["status", "reviewer", "approvedAt"], "properties": {"status": {"enum": ["unapproved", "approved"]}}},
    "sources": {"type": "array", "items": {"$ref": "#/$defs/source"}},
    "applicationDates": {"type": "array", "items": {"$ref": "#/$defs/applicationDate"}},
    "authorityDeadlines": {"type": "array", "items": {"type": "object", "required": ["id", "date", "provision", "actor", "summary", "sourceIds", "verification"], "properties": {"date": {"$ref": "#/$defs/date"}, "actor": {"$ref": "#/$defs/actor"}, "verification": {"$ref": "#/$defs/verification"}}}},
    "prohibitedPractices": {"type": "array", "items": {"type": "object", "required": ["point", "label", "appliesFrom", "entryId", "sourceIds", "verification"], "properties": {"appliesFrom": {"$ref": "#/$defs/date"}, "entryId": {"type": "string"}, "sourceIds": {"$ref": "#/$defs/sourceIds"}, "verification": {"$ref": "#/$defs/verification"}}}},
    "provisionReferences": {"type": "array", "items": {"type": "object", "required": ["provision", "change", "amendingProvision", "sourceIds", "verification"], "properties": {"sourceIds": {"$ref": "#/$defs/sourceIds"}, "verification": {"$ref": "#/$defs/verification"}}}},
    "standards": {"type": "array", "items": {"type": "object", "required": ["id", "reference", "title", "category", "sourceIds", "verification"], "properties": {"category": {"enum": ["harmonised_standard_cited", "international_standard_not_cited", "draft_not_harmonised"]}, "verification": {"$ref": "#/$defs/verification"}}}},
    "guidance": {"type": "array", "items": {"type": "object", "required": ["id", "title", "status", "sourceIds", "verification"]}},
    "repositoryDiff": {"type": "array", "items": {"type": "object", "required": ["id", "file", "location", "current", "finding", "change", "basis", "beforeDec2"], "properties": {"finding": {"enum": ["correct", "incomplete", "stale", "imprecise", "incorrect", "missing", "needs_legal_review", "needs_decision"]}, "beforeDec2": {"type": "boolean"}}}},
    "legalReviewItems": {"type": "array", "items": {"type": "object", "required": ["id", "topic", "question", "relatedIds"]}},
    "unverified": {"type": "array", "items": {"type": "object", "required": ["id", "claim", "status", "reason"], "properties": {"status": {"const": "secondary_only"}, "sourceIds": {"$ref": "#/$defs/sourceIds"}}}}
  },
  "$defs": {
    "date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
    "sourceIds": {"type": "array", "minItems": 1, "items": {"type": "string"}},
    "predicates": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/predicate"}},
    "actor": {"enum": ["operator", "provider", "deployer", "importer", "distributor", "authorised_representative", "product_manufacturer", "gpai_model_provider", "notified_body", "member_state", "commission", "ai_office"]},
    "verification": {"type": "object", "required": ["status", "verifiedOn"], "properties": {"status": {"enum": ["verified", "secondary_only"]}, "verifiedOn": {"$ref": "#/$defs/date"}}},
    "predicate": {"type": "object", "required": ["fact", "op", "value"], "properties": {"op": {"enum": ["eq", "in", "before", "onOrAfter"]}}},
    "source": {"type": "object", "required": ["id", "title", "publisher", "kind", "retrievedOn"], "anyOf": [{"required": ["accessUrl"]}, {"required": ["canonicalUrl"]}], "properties": {"kind": {"enum": ["official_journal", "publications_office_metadata", "consolidated_text", "commission", "standards_body", "secondary"]}, "retrievedOn": {"$ref": "#/$defs/date"}}},
    "applicationDate": {
      "type": "object",
      "required": ["id", "date", "dateType", "provisions", "actors", "summary", "legalBasis", "sourceIds", "verification", "legalReview"],
      "properties": {
        "date": {"$ref": "#/$defs/date"},
        "dateType": {"enum": ["entry_into_force", "applies_from", "compliance_deadline"]},
        "provisions": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "actors": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/actor"}},
        "legalBasis": {"type": "object", "required": ["reference", "amendedBy"]},
        "appliesIf": {"$ref": "#/$defs/predicates"},
        "exceptIf": {"$ref": "#/$defs/predicates"},
        "transitional": {"type": "array", "items": {"type": "object", "required": ["reference", "rule"], "properties": {"deadline": {"$ref": "#/$defs/date"}, "entryId": {"type": "string"}, "appliesIf": {"$ref": "#/$defs/predicates"}, "exceptIf": {"$ref": "#/$defs/predicates"}, "obligationsApplyOnlyIf": {"$ref": "#/$defs/predicates"}}}},
        "sourceIds": {"$ref": "#/$defs/sourceIds"},
        "verification": {"$ref": "#/$defs/verification"},
        "legalReview": {"type": "object", "required": ["required", "itemIds"], "properties": {"required": {"type": "boolean"}, "itemIds": {"type": "array", "items": {"type": "string"}}}}
      }
    }
  }
}
```

**What the validation also checked**
- Ids are unique.
- Every `sourceIds`, `legalReview.itemIds`, `basis`, `relatedIds` and `entryId` value resolves, and every source in the register is cited.
- Every date is a real calendar date.
- Every predicate fact is declared in `factVocabulary`, and every predicate's operator and value suit the fact's type.
- No secondary source backs a field that is not marked `secondary_only`.
- Every transitional record with a deadline has an `entryId`. Its deadline, `appliesIf` and `exceptIf` match the entry it names, and each practice's `appliesFrom` matches its entry's date.
- The two Chapter III entries carry the same Art 111 records. Each Art 111(2) record tests the route, the cut-off for that route and the Art 111(1) exclusion.
- The RD, LR and UV tables and the source register in this report match the JSON, and every `applicationDates` id is named in the report.

## 13. Reproducing the checks

Run from an empty directory. EUR-Lex blocks automated clients, so use the Publications Office:

```sh
# OJ text (XHTML) and metadata notice for Regulation (EU) 2026/1744
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' -o reg-2026-1744.xhtml https://publications.europa.eu/resource/celex/32026R1744
curl -sSL -H 'Accept: application/xml;notice=branch' -H 'Accept-Language: eng' -o reg-2026-1744.notice.xml https://publications.europa.eu/resource/celex/32026R1744
# Same for the decision citing EN 18286 and for the consolidated AI Act
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' -o dec-2026-2274.xhtml https://publications.europa.eu/resource/celex/32026D2274
curl -sSL -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' -o aia-cons.xhtml https://publications.europa.eu/resource/celex/02024R1689-20260727
```

SPARQL queries used, run at `https://publications.europa.eu/webapi/rdf/sparql` with prefix `cdm: <http://publications.europa.eu/ontology/cdm#>`:

```sparql
# Consolidated versions and corrigenda
SELECT DISTINCT ?celex WHERE { ?w cdm:resource_legal_id_celex ?celex .
  FILTER(STRSTARTS(STR(?celex), "02024R1689") || STRSTARTS(STR(?celex), "32024R1689R") || STRSTARTS(STR(?celex), "32026R1744R")) }
# Acts amending the AI Act
SELECT DISTINCT ?celex WHERE { ?aia cdm:resource_legal_id_celex "32024R1689"^^<http://www.w3.org/2001/XMLSchema#string> .
  ?w cdm:resource_legal_amends_resource_legal ?aia . ?w cdm:resource_legal_id_celex ?celex }
# Implementing decisions on harmonised standards for the AI Act
SELECT DISTINCT ?celex ?date WHERE { ?w cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?date .
  FILTER(?date >= "2025-06-01"^^<http://www.w3.org/2001/XMLSchema#date>)
  ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ; cdm:expression_title ?t .
  FILTER(CONTAINS(LCASE(STR(?t)), "harmonised standard") && CONTAINS(STR(?t), "2024/1689")) }
```

[oj1744]: http://data.europa.eu/eli/reg/2026/1744/oj
[cellar1744]: https://publications.europa.eu/resource/celex/32026R1744
[oj1689]: http://data.europa.eu/eli/reg/2024/1689/oj
[cons]: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727
[sparql]: https://publications.europa.eu/webapi/rdf/sparql
[dec2274]: http://data.europa.eu/eli/dec_impl/2026/2274/oj
[aisd]: https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act
[ecpage]: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
[ecnews18286]: https://digital-strategy.ec.europa.eu/en/library/first-harmonised-standard-supporting-ai-act-published-official-journal
[hrdraft]: https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems
[hrnews]: https://digital-strategy.ec.europa.eu/en/news/commission-seeks-feedback-draft-guidelines-classification-high-risk-artificial-intelligence-systems
[hraisd]: https://ai-act-service-desk.ec.europa.eu/en/guidelines-classification-high-risk-ai-systems
[cenwp]: https://standards.cencenelec.eu/dyn/www/f?p=205:22:0::::FSP_ORG_ID,FSP_LANG_ID:2916257,25
[cenpub]: https://standards.cencenelec.eu/dyn/www/f?p=205:32:0::::FSP_ORG_ID,FSP_LANG_ID:2916257,25
[cennews10]: https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/
[cennews07]: https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-07-30-ai-quality-management/
[iso42001]: https://www.iso.org/standard/81230.html
[iso42005]: https://www.iso.org/standard/44545.html
[iso42006]: https://www.iso.org/standard/44546.html
[iso23894]: https://www.iso.org/standard/77304.html
[intertek]: https://www.intertek.com/blog/2026/10-01-en-18286-first-eu-ai-act-standards-puzzle-piece-is-on-the-table/
[modulos]: https://docs.modulos.ai/frameworks/eu-ai-act/harmonized-standards/en-18286/annex-za-and-presumption
[swissgrc]: https://swissgrc.com/en/harmonised-standard-ai-act-evidence/
[orrick]: https://www.orrick.com/en/Insights/2026/10/First-Harmonised-Technical-Standard-Published-Under-the-EU-AI-Act
[kla]: https://kla.digital/blog/jtc-21-standards-tracker
[regai]: https://regulations.ai/regulations/RAI-EU-NA-CLASSIF-2026
