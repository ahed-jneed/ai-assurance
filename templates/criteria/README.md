# Criteria documents

The audit criteria as versioned data (design: `docs/design/criteria-model.md`, phase 1 in #27, phase 2 in #61). Schema: `schemas/criteria-pack.schema.json`. Validator: `schemas/validate-criteria.mjs`.

```text
index.json                                          the only mutable file: digests, status, approvals, defaults, legacy pin
frameworks/<framework-id>/<edition>/<version>.json  one data version of one edition of a law, standard or framework
packs/<pack-id>/<version>.json                      one release of an engagement pack (criteria sets, objectives, items)
crosswalks/<crosswalk-id>/<version>.json            typed relationships between two framework editions
tools/convert-catalog.mjs                           converts templates/catalog.json and docs/obligation-subitems.json into pack #1
```

## What is here

- **Pack #1, `eu-ai-act-amended` 2026.11.2 and 2026.11.3**, and their framework `eu-ai-act` edition `02024R1689-20260727` data version 2026.11.2, converted from methodology 2026.11.2 (rule pack 2026.11.2). 2026.11.3 (#61) is 2026.11.2 plus the Annex IV evidence map (`annexIvMap`) and is the default pack; it pins the same framework data version and has the same programme. All three are released by the methodology owner with the framework's qualified legal review **pending** (decision Q4, option b; D-02). The UI, coverage view and report snapshots say so until a `legal_reviewer` approval is appended to the framework entry (#57).
- `index.legacy` maps engagements stored before criteria pins existed: engagements without the #18 rule-pack stamp and those stamped `2026.11.1` or `2026.11.2` all resolve to pack #1 2026.11.2, because the build before #27 served the 2026.11.2 catalogue to every engagement. Once on `main` this block is frozen; stamps may only be added (rule 13).

## Rules

1. **Released documents never change.** Any change, a typo included, is a new version. The index records the RFC 8785 (JCS) SHA-256 of each released document and CI rejects a change.
2. **The catalogue stays canonical for editing; the obligation file and the Annex IV map are generated.** `templates/catalog.json` must project exactly from the default pack; the validator fails on drift. Since phase 2, `docs/obligation-subitems.json` (the obligation subitems of the default pack's AI Act framework) and `templates/annex-iv-map.json` (the default pack's `annexIvMap`) are written by `npm run sync` in `site-app/`; a hand edit fails `check:sync` and the validator. Change them in a new framework data version or pack version. A pack released before phase 2 with `annexIvIndex` and no map of its own (2026.11.2) is served the map of the current version of its pack id (rule 8). To change the methodology: raise `methodologyVersion` in the catalogue, run `node templates/criteria/tools/convert-catalog.mjs --write`, add the two new entries to `index.json` (as `draft`, then `released` with approvals), point `defaults.pack` at the new version and run `node schemas/validate-criteria.mjs --stamp`, then `npm run sync` in `site-app/`.
3. **Approvals (Q4).** Every released document needs a `methodology_owner` approval. A legislation framework also records `legalReview` (`pending` or `completed`); its `legal_reviewer` approval is appended when the review is done. A crosswalk with a `legalEffect` entry needs both approvals, from two different people, before release.
4. **Licences.** A framework with an unconfirmed licence cannot be released. ISO and CEN-CENELEC standards are `paraphrased_titles`: clause numbers and our own titles of at most 80 characters, never their text (D-03).

## Adding a pack as data alone

Follow section 12 of the design; `schemas/fixtures/criteria-pack.en18286-iso42001.sample.json` holds its worked example as drafts. Add the documents, list them in `index.json` as `draft`, run `node schemas/validate-criteria.mjs`, then `npm run sync` and `npm test` in `site-app/`. Drafts never reach the production bundle (set `CRITERIA_INCLUDE_DRAFTS=1` for local development). Release them only after review, with their approvals, and `--stamp` the digests.

## Checks

```powershell
node schemas/validate-criteria.mjs                        # schema, integrity rules 1-12, methodology drift
node schemas/validate-criteria.mjs --base origin/main     # also rule 13, the index history
node schemas/validate-criteria.mjs --legacy-check rows.json   # the pre-deploy check of design section 11.4
```
