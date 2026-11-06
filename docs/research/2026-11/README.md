# Research record, November 2026

The research behind the [roadmap](../../../ROADMAP.md) and the [product direction](../../product/direction.md): five research briefs and the synthesis that combined them, all dated 5 November 2026. The files are kept as written. Each one starts with a note on its date, method and verification limits; that note, and LF line endings, are the only changes.

| File | Covers | Links checked on 5 Nov 2026 |
|---|---|---|
| [synthesis.md](synthesis.md) | The product-direction brief: positioning, regulatory reality check, capability gaps, roadmap themes, evaluation and UX principles | 154: 146 load, 8 refused, 0 broken |
| [competitors.md](competitors.md) | AI-governance, assurance and audit software vendors, analyst views, deals | 71: 61 load, 8 refused, 2 broken |
| [regulation-standards.md](regulation-standards.md) | The EU AI Act after Regulation (EU) 2026/1744, harmonised and ISO/IEC standards, US and other jurisdictions | 49: 45 load, 4 refused, 0 broken |
| [audit-practice.md](audit-practice.md) | Assurance standards and schemes, the engagement lifecycle, and what auditors need from software | 72: 68 load, 3 refused, 1 broken |
| [evaluation-tooling.md](evaluation-tooling.md) | Fairness and performance statistics, robustness, GenAI evaluation, open-source tools, evidence integrity | 70: 68 load, 2 refused, 0 broken |
| [grc-ux.md](grc-ux.md) | UX patterns that users praise and punish in GRC, audit-management and AI-governance tools | 79: 60 load, 16 refused, 3 broken |

## How the research was done

- Desk research on 5 November 2026, run in the AI-assisted (Claude Code) planning session that produced the roadmap issues: web searches plus direct fetches of public pages. No interviews were held, and paywalled analyst reports were not read.
- The synthesis also read the repository at commit `74c6463`. The parts of that codebase review that stay useful are in [docs/engineering/codebase-map.md](../../engineering/codebase-map.md).
- None of this is legal advice. Statements of law are verified against primary sources in [#8](https://github.com/ahed-jneed/ai-assurance/issues/8) and labelled for qualified legal review in [#18](https://github.com/ahed-jneed/ai-assurance/issues/18) before the platform presents them as fact.

## Limits that apply to all six files

- The session's shared web-search budget ran out before every claim could be checked. Each brief says what it could not verify.
- EUR-Lex returned empty pages to automated fetching. EU legal text was read through the Commission's AI Act Service Desk and secondary analyses.
- Gartner and Forrester placements come from vendor announcements. Some comparison pages and all survey figures are vendor-written or vendor-sponsored; the briefs label them.
- In the link counts, "load" means the URL returned a page; the page was not re-read for the claim it supports. "Refused" means the site turned away automated requests (HTTP 403 or 429, TLS or connection errors), so the link could not be judged. "Broken" means HTTP 404; each file's note names its broken links.

The key facts that the [product direction](../../product/direction.md) relies on were re-checked against their sources on 5 November 2026. Its "Sources and verification" table records which were verified from a primary source and which remain secondary-only.
