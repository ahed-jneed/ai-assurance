# Criteria documents

The audit criteria as versioned data (design: `docs/design/criteria-model.md`, phase 1 in #27). Schema: `schemas/criteria-pack.schema.json`. Validator: `schemas/validate-criteria.mjs`.

```text
index.json                                          the only mutable file: digests, status, approvals, defaults, legacy pin
frameworks/<framework-id>/<edition>/<version>.json  one data version of one edition of a law, standard or framework
packs/<pack-id>/<version>.json                      one release of an engagement pack (criteria sets, objectives, items)
crosswalks/<crosswalk-id>/<version>.json            typed relationships between two framework editions
tools/convert-catalog.mjs                           converts templates/catalog.json and docs/obligation-subitems.json into pack #1
```

## What is here

- **Pack #1, `eu-ai-act-amended` 2026.11.2**, and its framework `eu-ai-act` edition `02024R1689-20260727` data version 2026.11.2, converted from methodology 2026.11.2 (rule pack 2026.11.2). Both are released by the methodology owner with the framework's qualified legal review **pending** (decision Q4, option b; D-02). The UI, coverage view and report snapshots say so until a `legal_reviewer` approval is appended to the framework entry (#57).
- **Pack #2, `en18286-iso42001` 2026.11.1 (#28), as drafts**: the frameworks `iso-iec-42001` edition `2023` (clauses 4 to 10 and the 38 Annex A controls) and `en-18286` edition `2026` (six clauses), the pack (Stage 1 and Stage 2 papers, a nonconformity memo and a recommendation memo, with the features `statementOfApplicability`, `nonconformityGrading` and `certificationRecommendation` and `soaControls: iso-iec-42001:A`), and the crosswalks `iso-iec-42001-to-eu-ai-act` and `en-18286-to-eu-ai-act` (the second with two presumption-of-conformity legal effects). They stay drafts, so no production build offers the pack, until the owner actions of #57 below are done. Every link is `intersects_with` towards the AI Act, so an ISO/IEC 42001 result never becomes a full AI Act result.
- `index.legacy` maps engagements stored before criteria pins existed: engagements without the #18 rule-pack stamp and those stamped `2026.11.1` or `2026.11.2` all resolve to pack #1 2026.11.2, because the build before #27 served the 2026.11.2 catalogue to every engagement. Once on `main` this block is frozen; stamps may only be added (rule 13).

## Rules

1. **Released documents never change.** Any change, a typo included, is a new version. The index records the RFC 8785 (JCS) SHA-256 of each released document and CI rejects a change.
2. **Phase 1 keeps the methodology files canonical for editing.** `templates/catalog.json` and `docs/obligation-subitems.json` must project exactly from the default pack and its AI Act framework; the validator fails on drift. To change the methodology: raise `methodologyVersion` in the catalogue, run `node templates/criteria/tools/convert-catalog.mjs --write`, add the two new entries to `index.json` (as `draft`, then `released` with approvals), point `defaults.pack` at the new version and run `node schemas/validate-criteria.mjs --stamp`, then `npm run sync` in `site-app/`.
3. **Approvals (Q4).** Every released document needs a `methodology_owner` approval. A legislation framework also records `legalReview` (`pending` or `completed`); its `legal_reviewer` approval is appended when the review is done. A crosswalk with a `legalEffect` entry needs both approvals, from two different people, before release.
4. **Licences.** A framework with an unconfirmed licence cannot be released. ISO and CEN-CENELEC standards are `paraphrased_titles`: clause numbers and our own titles of at most 80 characters, never their text (D-03).

## Adding a pack as data alone

Follow section 12 of the design; `schemas/fixtures/criteria-pack.en18286-iso42001.sample.json` holds its worked example as drafts. Add the documents, list them in `index.json` as `draft`, run `node schemas/validate-criteria.mjs`, then `npm run sync` and `npm test` in `site-app/`. Drafts never reach the production bundle (set `CRITERIA_INCLUDE_DRAFTS=1` for local development). Release them only after review, with their approvals, and `--stamp` the digests.

## Releasing pack #2 (owner actions, #57)

The validator refuses a release before these are done (rules 10 and 12b). The data is written so that each step changes data only:

1. **Q1, licences.** Counsel confirms that clause numbers plus our own titles of at most 80 characters, with no text, tables or figures, are acceptable for ISO/IEC 42001 and EN 18286 in a commercial product (the titles are our own descriptive wording, but a short generic one such as "Leadership and roles" may still coincide with a heading of the standard, so counsel reviews the whole title list), and that stating the scope of a presumption of conformity in our own words is acceptable. Then set `licence.status` to `confirmed` in both frameworks.
2. **ISO/IEC 42001 numbers.** With a licensed copy of edition 1 (2023), confirm every clause and Annex A control number in `frameworks/iso-iec-42001/2023/2026.11.1.json` (only 6.1.2, 6.1.4 and 8.2 were checked, against the publisher's table of contents), that no title reproduces the standard's own wording, and whether each clause group lists all its subclauses (then set `exhaustive: true` on it). Mark the checked nodes `verified` with a `checkedAt` date.
3. **Q8, EN 18286.** With the purchased standard, confirm its clause structure (the six clauses come from a secondary source and are marked `secondary_only`) and the exact Annex ZA scope. Correct the two legal effects of `crosswalks/en-18286-to-eu-ai-act` (Art. 17(1); the first sentence of Art. 11(1)) or remove the second, then a qualified legal reviewer sets their `provenance.legalReview` to `completed`.
4. **Links.** The pack's `superset_of` links to ISO/IEC 42001 claim that the steps test every element of a clause; a methodology reviewer confirms each against the licensed copy or weakens it to `intersects_with`.
5. **Release.** Mark the five entries `released` with `releasedAt` and a `methodology_owner` approval each, and a second, `legal_reviewer` approval from a different person on `en-18286-to-eu-ai-act`; run `node schemas/validate-criteria.mjs --stamp`, then `npm run sync` in `site-app/`. The drafts may change freely until then; after release any change is a new version.

To use the drafts locally, run `CRITERIA_INCLUDE_DRAFTS=1 npm run sync` in `site-app/` and start the dev server. That bundle gives each draft its digest so that an engagement can be pinned to it; the pack card, the header badge and the coverage clamp say it is a draft. Never commit that bundle: `npm run check:sync` fails on it.

## Checks

```powershell
node schemas/validate-criteria.mjs                        # schema, integrity rules 1-12, methodology drift
node schemas/validate-criteria.mjs --base origin/main     # also rule 13, the index history
node schemas/validate-criteria.mjs --legacy-check rows.json   # the pre-deploy check of design section 11.4
```
