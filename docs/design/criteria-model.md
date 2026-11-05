# Design: multi-framework criteria model with typed crosswalks

| | |
|---|---|
| Issue | #26 (design). Phase 1 is implemented by #27. |
| Status | Draft for review, 5 November 2026 |
| Deliverables | This document; `schemas/criteria-pack.schema.json` (draft); `schemas/fixtures/criteria-pack.eu-ai-act-amended.sample.json` (the EU AI Act pack in the new shape, three sample requirements) |
| Coordinates with | #3 (methodology sync), #8 and #18 (rule pack 2026.11.1), #19 (classification facts), #20 (report model v2), #28, #29, #30 (next packs) |

## 1. Summary

The audit criteria stop being one fixed catalogue and become versioned data. The key decisions:

1. **Three kinds of criteria document plus an index.** They live under `templates/criteria/`:
   - a *framework* document holds one data version of one edition of an external source (a law, standard, framework or scheme) as a tree of requirements;
   - a *pack* document is one release of an engagement pack: the criteria it selects and the audit programme (control objectives, working papers, memos) that tests them;
   - a *crosswalk* document holds typed relationships between two framework editions;
   - `index.json` lists every document with its digest and lifecycle status.

   One JSON Schema (`schemas/criteria-pack.schema.json`) validates all five document types (the four above plus the bundle used for fixtures and loading).
2. **Released documents never change.** The index records a SHA-256 over the RFC 8785 canonical form of each released document, and CI rejects any change to it. An engagement stores only a pin: pack id, version and digest, about 300 bytes inside the existing D1 aggregate. No D1 migration and no new table.
3. **The existing catalogue becomes pack #1, "EU AI Act (amended)", without loss.** A deterministic converter produces the pack and its framework from `templates/catalog.json` and `docs/obligation-subitems.json`. A test proves that the pack projects back to the catalogue exactly. Existing engagements have no pin; they resolve to pack #1 version 2026.10.1 at read time, and nothing is written to them.
4. **One relationship vocabulary everywhere.** Control objectives link to requirements, and crosswalks link requirements across frameworks, with the NIST IR 8477 set theory relationships (`equal`, `subset_of`, `superset_of`, `intersects_with`, `no_relationship`) and a rationale (`syntactic`, `semantic`, `functional`). Coverage is therefore one algorithm.
5. **Coverage never shows partial as full.** A requirement is *covered* only through a chain of full-strength links (`equal` or `superset_of`) from a reviewed, signed and *supported* (not qualified) conclusion, with no exception or open work on any related source. Partial contributions never add up to full. Crosswalks are not transitive. Exceptions and open work propagate conservatively. Links migrated from the catalogue claim partial overlap only. Section 9 defines the eight cell states, the algorithm and a 34-case truth table, which a reference prototype passed together with 7,720 randomised monotonicity checks.
6. **Licensing is data.** Each framework declares its text policy (`full_text`, `paraphrased_titles` or `identifiers_only`) and whether that position is confirmed. The schema forbids stored text and long titles for ISO and CEN-CENELEC standards, and the validator blocks release while a licence is unconfirmed. AIUC-1 stays out until AIUC grants a licence.
7. **Loading follows #3.** The canonical documents are copied into `site-app` at build time by the methodology sync script, as one generated bundle with a `--check` mode in CI. A server-only loader serves projections to the client.
8. **Six phases.** Phase 1 is one pull request (#27): data model, validation, loader, the pack #1 migration, pack selection and the coverage view. Phases 2 to 6 are listed in section 17.

## 2. Context: what exists today

| Asset | Content | Consumers |
|---|---|---|
| `templates/catalog.json` (copied to `site-app/lib/catalog.json`) | Methodology 2026.10.1: 45 items (33 working papers, 12 memos), 168 procedure steps, 38 distinct `regulatoryRefs` strings such as `Art.9` and `Annex IV`, a `regulatorySnapshot` with three coarse application dates, and `defaults` | `templatePaper` and `freshEngagement` (`lib/store.ts`, `lib/factories.ts` after #4); `seedWorkflow` (`lib/workflow-seed.ts`); `GET /api/workspace`, which returns the whole catalogue to internal roles; the Methodology view, the paper modal and `lib/workspace-search.ts` in the client |
| `templates/annex-iv-map.json` | Nine Annex IV sections, each with the catalogue `paperIds` that feed it | `createReport` in `app/api/workspace/route.ts` compiles an Annex IV index into every report snapshot |
| `docs/obligation-subitems.json` | 68 selective obligation prompts (Arts 9–15, 23–26, Annex IV) with actor, trigger profile and evidence categories; 8 trigger profiles; 16 fact types | The `obligation` assurance records in `app/api/assurance/route.ts` and the assurance workbench |
| Hard-coded criteria in code | `articleNames` (Arts 9–15) and an article regex in the "Article-to-evidence mapping" panel, which shows signed papers per article as a percentage; template ids `MEM-EX-01`, `WP-A10-02` and `WP-A15-01` in the workspace and assurance routes; legal snapshot strings in `lib/store.ts` and `app/workspace.tsx` (#18 removes these) | |

How engagements use the catalogue today, which constrains the design:

- An engagement is one JSON aggregate in D1 (`engagements.body`, at most 1.5 MB). Every save also writes a full copy to `engagement_snapshots` and a hash-chained `audit_events` row. Large immutable parts go to R2 through `lib/engagement-storage.ts`. The roadmap decision on persistence (D2 of the codebase review of 5 November 2026) is to stay on this model.
- `seedWorkflow` *copies* each working paper's title, objective, steps, evidence list and references into a workflow `Procedure` (`PROC-<templateId>`). `templatePaper` copies the title, `articleRefs`, guidance and criteria text into a `Paper`. Seeded records are therefore decoupled from later catalogue edits.
- But `templatePaper(templateId)` is resolved against the *current* catalogue whenever a paper is created later: `ensureProcedurePaper`, `submitProcedure`, `createPaper`, the limitation memo of an evidence request, and the diagnostic and external-run papers. The catalogue content of `main@74c6463` must therefore stay resolvable for every existing engagement for as long as that engagement exists.

## 3. Concepts

| Term | Meaning | Today's equivalent |
|---|---|---|
| Framework | An external criteria source: legislation, a harmonised or international standard, a framework, a profile, a certification scheme or a local law. Identified by a slug such as `eu-ai-act` | The AI Act, implicit everywhere |
| Edition | The external source's own version: the consolidated CELEX version `02024R1689-20260727`, `2023` for ISO/IEC 42001, `1.0` for the NIST AI RMF, `Q4-2026` for a quarterly AIUC-1 release | `regulatorySnapshot.celex` |
| Data version | Our release of the data about one edition, in the methodology format `YEAR.MONTH.SEQUENCE`. New dates, verification marks or requirements make a new data version of the same edition | `methodologyVersion` |
| Requirement | A node of a framework edition: `group` (a heading, not assessed), `requirement` (assessable) or `informative` (guidance, never a coverage target). Its id is opaque and stable | An obligation subitem; an article cited in `regulatoryRefs` |
| Control objective | A methodology statement of what the audit tests, with typed links to requirements | A catalogue item's `objective` string |
| Item | A working-paper or memo template with ordered steps. It tests one or more control objectives | A catalogue item; a workflow `Procedure` and `Paper` carry its id as `templateId` |
| Step | One instruction of an item | Catalogue `procedures[]`; workflow `Procedure.instructions[]` |
| Pack | One release of an engagement pack: criteria sets (framework edition and data version, role, optional scope), control objectives, items, template roles and features | The whole catalogue |
| Crosswalk | Typed relationships between the requirements of two framework editions | None |
| Pin | The pack id, version and digest that one engagement uses | Implicit: the catalogue in the build |
| Coverage | A derived view: for each requirement, a state computed from conclusions and links. Never stored except inside an issued report snapshot | The "Article-to-evidence mapping" percentage |

```text
templates/criteria/index.json  --lists, with digest and status-->  framework, pack and crosswalk documents

pack --criteria set--> framework@edition#data-version          (role: primary | supporting)
pack: item --tests--> control objective --typed link--> requirement
crosswalk: requirement of framework A --typed link--> requirement of framework B
requirement --parent--> group requirement                      (structure, NIST IR 8477 "structural")

engagement --pin--> pack@version (sha256)
engagement Procedure / Paper --templateId--> item of the pinned pack
obligation assurance record --code--> requirement of the AI Act framework
```

## 4. Files, identifiers and references

```text
templates/criteria/
  README.md                                           how to add or change criteria (phase 1)
  index.json                                          the only mutable file: digests, status, defaults, legacy pin
  frameworks/<framework-id>/<edition>/<version>.json  e.g. frameworks/eu-ai-act/02024R1689-20260727/2026.10.1.json
  packs/<pack-id>/<version>.json                      e.g. packs/eu-ai-act-amended/2026.10.1.json
  crosswalks/<crosswalk-id>/<version>.json            e.g. crosswalks/en-18286-to-eu-ai-act/2027.1.0.json
  tools/convert-catalog.mjs                           the one-off migration converter (section 11)
schemas/criteria-pack.schema.json                     the schema (draft in this PR)
schemas/validate-criteria.mjs                         schema plus integrity validator, CLI and module (phase 1)
schemas/fixtures/criteria-pack.*.json                 bundles used by tests
site-app/lib/criteria/bundle.generated.json           generated by the sync script; never edited, never formatted
site-app/lib/criteria/{registry,pin,projection,coverage}.ts   loader and engine (phase 1)
```

Pack data goes here, not in `templates/packs/`: issue #28 should add its pack, frameworks and crosswalks under `templates/criteria/`.

| Identifier | Rule | Examples |
|---|---|---|
| Framework, pack and crosswalk id | Lower-case kebab slug, at most 64 characters. A crosswalk id is `<source>-to-<target>` | `eu-ai-act`, `iso-iec-42001`, `en18286-iso42001`, `en-18286-to-eu-ai-act` |
| Edition | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` | `02024R1689-20260727`, `2023`, `1.0`, `Q4-2026` |
| Data version, pack version, crosswalk version | `YEAR.MONTH.SEQUENCE`, compared numerically part by part | `2026.10.1`, `2027.1.0` |
| Requirement id | Opaque, unique within the edition, no spaces or colons. Once released it never changes meaning | `AIA-9-1` (obligation code), `AIA-ART-17`, `6.1.2`, `GV-1.1` |
| Requirement reference | `<framework-id>:<requirement-id>`. The edition comes from the containing criteria set or crosswalk | `eu-ai-act:AIA-9-1` |
| Item and step ids | Catalogue style, unchanged for pack #1 | `WP-A09-01`, `WP-A09-01-P01`, `MEM-EX-01` |
| Control objective id | `CO-` plus an upper-case suffix. Migrated objectives are `CO-<item id>` | `CO-WP-A09-01`, `CO-AIMS-RISK-01` |

The display citation of a requirement (`ref`) is separate from its id: `Art. 9(1)` for `AIA-9-1`, `GOVERN 1.1` for `GV-1.1`. Arrays are ordered and the order is meaningful: pack items appear in programme order, which for pack #1 is catalogue order and therefore seed order.

## 5. Document shapes

The schema is authoritative; this section explains the parts that need judgment. The fixture `schemas/fixtures/criteria-pack.eu-ai-act-amended.sample.json` shows pack #1 in the new shape for three sample requirements (Art. 9 with 9(1), Art. 17 and Art. 50, plus Art. 16 because WP-XC-01 cites it), and section 12 shows a complete new pack.

### 5.1 Framework document

- **Identity:** `id`, `edition`, `version`, `title`, `shortTitle`, `kind`, `publisher`, `jurisdiction` and an optional `status` (`in_force`, `published`, `cited_in_oj`, `draft`, `withdrawn`, `superseded`).
- **Sources:** URLs with roles (`official_text`, `authentic_text`, `authentic_amendment`, `consolidated_html`, `explorer`, `timeline`, `publisher_page`, `catalogue_entry`, `secondary`).
- **`licence`:** holder, `textPolicy`, `status` and basis (section 13).
- **`requirements`:** the tree. Each node has `id`, `ref`, `type` and optionally `title`, `parent`, `exhaustive` (groups only), `aliases`, `actors`, `trigger`, `applicability`, `evidenceCategories`, `text` (full-text sources only), `reviewNote`, `deprecated`, `replacedBy`, `provenance` and `extensions`.
- **Provenance per fact:** `source`, `sourceKind`, `verification` (`verified`, `secondary_only`, `unverified`, following #8), `checkedAt` (required when verified), `legalReview` (`required`, `completed`, `not_required`) and a note. `defaultProvenance` applies to requirements that omit their own.
- **AI Act specifics, kept as data:** `triggerProfiles` and `factTypes` (from the obligation catalogue, and later from #19's tri-state facts), `applicationSummary` (the catalogue's three coarse dates, verbatim) and `guidance`.
- **`exhaustive`:** on a group, `true` means the listed children together cover the whole group. Only then can a group roll up to "covered". The AI Act obligation catalogue is explicitly selective, so every AI Act group in pack #1 is `exhaustive: false`.

Requirement-level application dates use `applicability` rows: `{from, until, condition, legalRef, provenance}`. They inform review and never approve applicability automatically. Data version 2026.10.1 has none (the catalogue had only three coarse dates); #18's verified data is expected to fill them in 2026.11.1. Example of the row shape for Art. 50. Both dates were checked on 5 November 2026 against the Commission AI Act Service Desk: the timeline for 2 August 2026, and Art. 111 for 2 December 2026. The Service Desk reproduces the consolidated text. Neither the authentic Official Journal text nor Art. 113 itself was fetched:

```json
{
  "id": "AIA-ART-50",
  "ref": "Art. 50",
  "title": "Transparency obligations for providers and deployers of certain AI systems",
  "type": "requirement",
  "aliases": ["Art.50"],
  "applicability": [
    {
      "from": "2026-08-02",
      "until": null,
      "condition": "General application of Art. 50.",
      "legalRef": "Art. 113",
      "provenance": {
        "source": "https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act",
        "sourceKind": "official_guidance",
        "verification": "verified",
        "checkedAt": "2026-11-05",
        "legalReview": "required"
      }
    },
    {
      "from": "2026-12-02",
      "until": null,
      "condition": "Art. 50(2) marking for providers of AI systems, including general-purpose AI systems, that generate synthetic content and were placed on the market before 2 August 2026.",
      "legalRef": "Art. 111(4)",
      "provenance": {
        "source": "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-111",
        "sourceKind": "official_consolidation",
        "verification": "verified",
        "checkedAt": "2026-11-05",
        "legalReview": "required",
        "note": "Art. 111(4) is marked NEW (Digital Omnibus) on the Service Desk."
      }
    }
  ]
}
```

### 5.2 Pack document

- **Identity:** `id`, `version`, `title`, `summary`, `kind` (`audit_programme` or `crosswalk_only`), `methodologyVersion`, optional `supersedes` and `engagementTypes` (the vocabulary of #20).
- **`criteria`:** one or more criteria sets `{framework, edition, version, role, include?}`. `role` is `primary` (the engagement's stated criteria) or `supporting` (for example ISO/IEC 42005 supporting a 42001 programme). `include` limits the set to listed requirement or group ids; when it is absent the whole edition is in scope. An audit programme needs at least one primary set.
- **`controlObjectives`:** `{id, statement, addresses[]}`. Each link is `{requirement, relationship, rationale, justification, origin}`, where `origin` is `authored` or `migrated`. The schema forces a migrated link to be `intersects_with`.
- **`items`:** the catalogue item fields, unchanged (`id`, `title`, `kind`, `stage`, `folder`, `templatePath`, `regulatoryRefs`, `automationMode`, `objective`, `procedures`, `evidenceRequired`, `signOffGate`), plus `objectiveIds` (at least one for a working paper; memos may have none), an optional `phase` and `derivedFrom`.
- **`phases`:** optional programme phases such as ISO/IEC 17021-1 Stage 1 and Stage 2, shown next to the fixed lifecycle stages (#28).
- **`roles`:** the templates that platform features instantiate, replacing the ids hard-coded in the routes: `limitationMemo`, `diagnosticPaperByResultArticle` (keyed by `Result.article`, with `*` as fallback) and `externalExecutionPaper`.
- **`features`:** `annexIvIndex` switches on the Annex IV compilation in report snapshots.
- **`defaults`:** the catalogue's methodology defaults.
- **`compat.catalog`:** only on packs converted from the catalogue. It holds `schemaVersion` and the verbatim `regulatorySnapshot`, so that the legacy projection (section 11.3) is exact.
- **`crosswalks`:** only on crosswalk-only packs. They bundle frameworks and crosswalks for the coverage view, for example NIST AI RMF (#29), and cannot be selected at engagement creation.

### 5.3 Crosswalk document

`{id, version, title, source: {framework, edition}, target: {framework, edition}, useCase, method, entries[]}`.

- **`source` and `target`:** source is the NIST IR 8477 *focal* document and target the *reference* document.
- **`useCase`:** NIST IR 8477 (section 3) asks for the use case to be documented before mapping. It records the intended users, purpose, concept types on each side and assumptions, and optionally `exhaustive`: whether every source requirement was examined or, as NIST recommends, only the strongest direct relationships were recorded. Direction is implicit in `source` and `target`.
- **`method`:** `human`, `automation` or `hybrid`, as in OSCAL.
- **Entry:** `{id?, sources[], target, relationship, rationale, justification, confidence?, qualifiers?, legalEffect?}`. An entry reads "the sources, jointly, *relationship* the target". `qualifiers` record gaps and conditions in the OSCAL shape (subject, predicate, category, description). `legalEffect` records a legal consequence, such as the presumption of conformity a harmonised standard's Annex ZA gives for listed provisions. It is informational and never changes coverage strength.

### 5.4 Index and bundle

The index lists each document with `documentType`, `id`, `edition` (frameworks only), `version`, `path`, `status` (`draft`, `released` or `withdrawn`), `sha256`, `approvedBy`, `approvedAt`, `releasedAt`, the withdrawal fields and `selectable` (packs only). It also holds `defaults.pack` and the `legacy` pin rule (section 11.4). A bundle is several documents in one file. It serves as the fixture format and as the generated loader artefact.

## 6. Versioning and immutability

1. **Content of a released document never changes.** Any change, including a typo fix, is a new version. Drafts may change freely.
2. **Framework identity is `(id, edition, version)`.**
   - A new *edition* means the external source changed: a new consolidated CELEX version, a new ISO edition, a new AIUC-1 quarterly release.
   - A new *data version* means our data changed: dates, verification marks, titles or added requirements.
3. **Requirement ids are permanent within an edition.**
   - A released id never changes meaning.
   - To split or retire a requirement, mark it `deprecated` (optionally with `replacedBy`) and keep it in every later data version of that edition, so that old pins, obligation records and findings still resolve.
   - The validator checks that every id released in an earlier data version of an edition exists in every later one.
4. **Pack versions** increase strictly within a pack id and pin exact framework data versions. **Crosswalk versions** pin framework editions but not data versions, because they describe the external content.
   - When a crosswalk endpoint is missing from the data version an engagement has pinned, for example a requirement added later, the engine skips that entry and reports how many entries it skipped.
5. **Digest.** `sha256` is the SHA-256 of the RFC 8785 (JCS) canonical serialisation of the parsed document (sorted keys, no whitespace, ECMAScript number and string forms).
   - Raw bytes are not used because checkouts differ in line endings. A Windows checkout made before `.gitattributes` existed keeps CRLF: in the worktree used for this design, `templates/catalog.json` hashed `a8ca2ffa…` on disk, while the committed LF blob hashes `10a75f63…`. JCS gives the same digest for both, and the prototype checked that.
   - Loaded documents are deep-frozen and indexes live in separate maps. The prototype showed why: attaching an index to a document silently changed its digest.
6. **Lifecycle.** `draft` → `released` (needs `sha256`, `approvedBy`, `approvedAt`, `releasedAt`) → optionally `withdrawn` (needs `withdrawnAt` and `withdrawalReason`). Entries are never deleted.
   - The current version of a pack is its highest released, non-withdrawn version.
   - Withdrawal blocks new pins only. Pinned engagements keep working and show a banner.
7. **Pins.**
   - A new engagement pins `index.defaults.pack`, or the current version of the pack id the user chose.
   - The pin never moves by itself. Moving it is an explicit, reviewed command (phase 3).
   - Issued report snapshots stamp the pack and framework versions and digests (phase 1 adds the pack stamp; phase 2 the frameworks and crosswalks), so a rule-pack change never alters an issued statement. This extends the version stamps of #18.
8. **Quarterly schemes fit the same model.** AIUC-1 publishes quarterly releases, and a certified organisation locks a version for one year ([AIUC-1](https://www.aiuc-1.com/)). That is one edition per quarter, pinned by the engagement.

## 7. How papers and procedures reference criteria

Phase 1 adds no field to `Paper` or `Procedure`. References are derived from the pin and the `templateId` they already carry:

```text
criteriaFor(engagement, templateId) =
  item = pinnedPack.items[templateId]
  for objectiveId in item.objectiveIds, for link in objectives[objectiveId].addresses:
    yield { requirement: link.requirement, relationship, rationale, objectiveId }
```

Because pinned pack versions are immutable, the derivation is deterministic and identical for every reader.

| Behaviour | Rule | Pack #1 result |
|---|---|---|
| `templatePaper(pack, templateId, userId)` | Looks the item up in the *pinned* pack; an unknown id keeps today's 400 "Unknown methodology template" | Identical |
| `Paper.articleRefs`, `body.criteria`, `Procedure.candidateRefs`, `Procedure.criterion` | `displayRefs(item)` = `item.regulatoryRefs` when not empty, otherwise the linked requirements rendered as `<framework shortTitle> <ref>` | Identical: every pack #1 item has its catalogue refs |
| `Procedure.sourceVersion` in `seedWorkflow` | Primary criteria editions joined with `; ` when the item has references, otherwise `pack.methodologyVersion` | `02024R1689-20260727` or `2026.10.1`, identical |
| Limitation memo, diagnostic-run paper, external-execution paper | Read `pack.roles`. When the role is missing, the command fails with 409 "This criteria pack defines no template for <role>" | `MEM-EX-01`; `{"10": "WP-A10-02", "*": "WP-A15-01"}`; `WP-A15-01` (the ids in the routes today) |
| Annex IV index in `createReport` | Compiled only when `pack.features.annexIvIndex` is true; otherwise the snapshot has no `annexIV` field | Identical (`true`) |
| Obligation assurance records | Their `code` is an AI Act requirement id, so they are direct requirement-level assessments in coverage (section 9.1) | `AIA-9-1` and the other 67 codes resolve unchanged |
| Findings (phase 2) | Optional `criteriaRefs`, defaulted from the item of `support.procedureId`, so #20 can roll results up by criterion | n/a |
| Tailoring (phase 6) | Engagement-level link overrides with rationale and Lead approval | n/a |

`Result.article` from the diagnostics engine stays as it is; `roles.diagnosticPaperByResultArticle` maps it to a template.

## 8. Crosswalks

**Style.** NIST IR 8477 defines four mapping styles: concept crosswalks, supportive relationships, set theory relationships and structural relationships ([NIST IR 8477](https://doi.org/10.6028/NIST.IR.8477)). This design uses:

- **set theory relationships** for every link that can affect coverage;
- **structural relationships** as the `parent` tree.

It does not use the other two:

- Untyped concept crosswalks are not accepted. Importing one, such as the crosswalk documents on the NIST AI Resource Center ([AIRC](https://airc.nist.gov/airmf-resources/crosswalks/)), means a subject-matter expert assigns a relationship and a rationale to every pair.
- Supportive relationships (supports, is supported by, with the properties integral to, precedes and example of) are out of scope for version 1. NIST IR 8477 (section 4.6, Table 7) gives a conversion: subset of becomes supports (integral to), equal becomes equivalent, superset of becomes is supported by (integral to), and intersects with has no counterpart.

**Relationships.** All are read as "source *relationship* target". The definitions below paraphrase NIST IR 8477 section 4.3.

| Relationship | Meaning | Strength for coverage | Inverse |
|---|---|---|---|
| `equal` | The two are the same, though not necessarily worded identically | full | `equal` |
| `superset_of` | The source contains everything the target does, and more | full | `subset_of` |
| `subset_of` | The target contains everything the source does, and more | partial | `superset_of` |
| `intersects_with` | They overlap, and each has content the other lacks | partial | `intersects_with` |
| `no_relationship` | Reviewed and unrelated | none | `no_relationship` |

**Rationale.** NIST IR 8477 requires a rationale with every relationship:

- `syntactic`: compares the wording, word for word;
- `semantic`: compares the meaning;
- `functional`: compares the results of executing the two concepts.

The same pair can be mapped once per rationale, with different relationships; NIST's own example is a pair that only intersects syntactically but is equal semantically. Coverage concerns obligations being met, so it uses `semantic` and `functional` entries only. When several usable entries relate the same sources to the same target, the weakest strength wins. `syntactic` entries are shown in the detail drawer but never contribute.

**Direction and inversion.**
- A crosswalk is authored once, in one direction, and the engine walks from the side that has evidence to the side being viewed.
- A single-source entry is inverted with the table above; set relations invert exactly.
- An entry with several sources states joint coverage ("clauses X and Y jointly superset_of requirement Z"). It gives full strength only when every source is covered. It cannot be inverted, because "target ⊆ s1 ∪ s2" says nothing about s1 alone, so it is ignored in the reverse direction and counted as unusable.

**Other rules.**
- **No transitivity.** Coverage uses only crosswalks directly between one of the pack's criteria frameworks and the framework being viewed. A→B and B→T never imply A→T. Each mapping reflects its own use case and assumptions, and NIST IR 8477 (section 4.2) warns against assuming that the way A relates to B carries over to how B relates to C.
- **Nothing is inferred from what is not mapped.** The OSCAL mapping model states the same ([OSCAL mapping model](https://pages.nist.gov/OSCAL-Reference/models/v1.2.1/mapping/json-reference/)). "Not mapped" is displayed as such, never as a gap or a pass.
- **Approval.** A crosswalk is released through the index like any document. An entry with `legalEffect` also needs `legalReview: completed` on its provenance before release.
- **OSCAL compatibility.** The enums map one to one onto the OSCAL Control Mapping Model (v1.2.x) for a later export (phase 6):

| This model | OSCAL mapping-collection |
|---|---|
| `equal`, `subset_of`, `superset_of`, `intersects_with`, `no_relationship` | `relationship`: `equal-to`, `subset-of`, `superset-of`, `intersects-with`, `no-relationship` (OSCAL's additional `equivalent-to` is not used) |
| `rationale` | `matching-rationale` (`syntactic`, `semantic`, `functional`) |
| `method` | `provenance.method` |
| entry `sources[]`, `target` | map `sources[]` and `targets[]` with `type: control` |
| `qualifiers` | `qualifiers` (subject, predicate, category, description) |
| `confidence` | `confidence-score.category` |
| index status | `provenance.status`: `draft` → `draft`, `released` → `complete`, `withdrawn` → `deprecated` |

## 9. Coverage semantics

Coverage answers one question per requirement: does reviewed audit work give evidence that the requirement is met, fully or only in part? It is a derived view, recomputed on every read and frozen only inside issued report snapshots.

### 9.1 Sources and their states

Each source has a *state* (`supported`, `qualified`, `not_supported`, `open`, `excluded`, `not_applicable`) and a `readiness` flag.

- **Structured engagements (with `workflow`), one source per procedure:**
  - `not_applicable` when its applicability is `not_applicable`, selected or not;
  - `excluded` when it is otherwise not selected;
  - concluded when it is `reviewed`, its execution is current (`currentExecution`), it has a review and its paper is signed at `paperRevision`. The state is then the assessment outcome: `supported`, `qualified` or `not_supported`. `readiness` is true when applicability is `readiness`;
  - `open` otherwise, including applicability `pending`.

  When the program is not approved, the proposed scope is used and the view shows a banner.
- **Engagements without a workflow, one source per paper that is required or records a not-applicable conclusion** (the set `completionGates` checks today):
  - signed with a conclusion status of `supported`, `qualified` or `not_supported`: that state;
  - signed `not_applicable`: `not_applicable`;
  - anything else: `open`.

  Supplementary papers (`required: false` and not N/A) are not sources.
- **Direct requirement assessments, one source per current (not superseded) obligation record:**
  - `open` without a confirmed review, with `needs_information`, or with outcome `unassessed`;
  - `not_applicable` when confirmed not applicable;
  - otherwise the outcome mapped `supported` → `supported`, `qualified` → `qualified`, `unsupported` → `not_supported`.

  The record links its code with relationship `equal`.
- **Memos** are decision records and never sources.

### 9.2 Link strength

- `equal` and `superset_of` are **full**; `subset_of` and `intersects_with` are **partial**; `no_relationship` contributes nothing.
- Two clamps reduce full to partial:
  - links with `origin: migrated` (the schema already forces them to `intersects_with`);
  - every link in a document whose index status is not `released`, so draft data can never show "covered".
- When one source reaches the same requirement through the same objective more than once (one link per rationale), the weakest strength wins.

### 9.3 Placement and propagation

A contribution is placed on the node its link targets.

- **On a `requirement` node** it is direct.
- **On a `group` node** it is recorded at group level, and it reaches every requirement descendant when:
  - its strength is **full**: `o ⊇ group ⊇ child`, so the claim holds for the child; or
  - its state **blocks** coverage (`not_supported` or `open`), whatever the strength, because a deficiency or open work related to the group may concern any child.
- A partial, non-blocking contribution on a group makes no claim about any one child. Descendants that have no contribution of their own become `parent_only`.

The blocking rule came out of the prototype's property test. Without it, weakening a link from `superset_of` to `subset_of` stopped a deficiency from reaching the children, so they could show "covered": a weaker claim produced a stronger display.

### 9.4 Cell state

```text
cellState(C, parentOnly):            C = contributions placed on one requirement node
  if C is empty:                     return parentOnly ? parent_only : unmapped
  S = C without excluded and not_applicable contributions
  if S is empty:                     return any not_applicable in C ? not_applicable : excluded
  if any c in S is not_supported:    return exception
  if any c in S is open:             return open
  if any c in S is full and supported (not qualified):  return full,    readiness = all c in S readiness
  otherwise:                         return partial, readiness = all c in S readiness
```

| State | Label | Meaning |
|---|---|---|
| `full` | Covered | A full-strength chain from a supported, reviewed conclusion, with no related exception or open work |
| `partial` | Partly covered | Related concluded work, but only partial links or qualified conclusions |
| `exception` | Exception in a related source | A related source concluded "not supported". The requirement itself may or may not be deficient; the drawer shows which source |
| `open` | Open | Related work is in scope and not yet concluded |
| `parent_only` | Mapped at a higher level only | A parent has a partial mapping; nothing is claimed for this requirement |
| `unmapped` | Not mapped | No link. Not a gap and not a pass |
| `excluded` | Excluded from scope | Every related source is outside the agreed scope |
| `not_applicable` | Not applicable | Every related in-scope source was approved not applicable |

`readiness` adds "(readiness)" to `full` and `partial` when every contributing conclusion was assessed as readiness. Readiness results are never displayed as applicable-law results.

### 9.5 Groups

A group row shows:

- counts by state over its requirement descendants;
- its group-level contributions, summarised with the same cell function;
- a roll-up state, which can only be `full`, and only when `exhaustive` is true and every descendant is `full` or `not_applicable` with at least one `full`.

Otherwise there is no single group colour, only the counts. A selective child list proves nothing about the parts of the group it does not list.

### 9.6 Crosswalk view

To show framework T for an engagement whose pack has criteria frameworks A1…An:

1. **Select crosswalks.** Take the current released version of each crosswalk between some Ai and T, in either direction. Keep entries whose rationale is `semantic` or `functional`. Orient each entry Ai → T, inverting single-source entries authored T → Ai and dropping multi-source ones in that direction.
2. **Weakest wins.** For each (sources, target) pair, keep the weakest strength.
3. **Source endpoint states.** For each A-side source, use its primary cell state, and treat `unmapped` and `parent_only` as no evidence. For a group endpoint:
   - `full` if its roll-up is full;
   - otherwise `exception` if any descendant or group-level contribution is an exception;
   - otherwise `open` if any is open;
   - otherwise `partial` if any is covered or partly covered.
4. **Compose one contribution per entry:**
   - `not_supported` if any source endpoint is an exception;
   - otherwise `open` if any is open;
   - otherwise nothing, or excluded or not applicable, if no source has evidence;
   - otherwise `supported`. The strength is full only when the relationship is full-strength **and every source endpoint is `full`**; otherwise partial.
5. **Place and evaluate** the contributions on T with sections 9.3 to 9.5.
6. **Report the remainder:** the number of unusable entries (syntactic, non-invertible, unresolved) appears in the view.

### 9.7 Invariants (tested)

1. A cell is `full` only through a chain of full-strength, released links from a supported, reviewed conclusion.
2. Partial contributions never combine into `full`, through several objectives, several crosswalk entries or several rationales.
3. Making a link weaker, a conclusion qualified, or a source deficient never increases the number of `full` cells. This is property-tested.
4. No transitivity across crosswalks.
5. A group is `full` only through an exhaustive roll-up or a full link on the group itself.
6. `unmapped` is never counted as an exception or as covered.
7. Legal effects (presumption of conformity) are badges and never change a state.
8. Summaries are counts by state with the denominator. If a percentage is shown, it is "fully covered: n of N"; partial is never added to it.

### 9.8 Golden truth table

These are the phase 1 Vitest cases. A scratch reference implementation passed all 34, and 7,720 randomised checks of invariant 3, before this design was finalised.

| # | Situation | Result |
|---|---|---|
| 1 | `superset_of` link, source supported | full |
| 2 | `equal` link, readiness source supported | full (readiness) |
| 3 | `superset_of` link, source qualified | partial |
| 4 | `intersects_with` link, source supported | partial |
| 5 | full link supported, plus a partial link whose source is not supported | exception |
| 6 | full link supported, plus a partial link whose source is still open | open |
| 7 | only source excluded from scope | excluded |
| 8 | one source excluded, one not applicable | not_applicable |
| 9 | no link | unmapped |
| 10 | partial link on a group, source supported | children parent_only |
| 11 | `superset_of` link on a group, source supported | every child full |
| 12 | obligation record confirmed supported | full |
| 13 | obligation record needing information | open |
| 14 | migrated link, source supported | partial |
| 15 | `superset_of` link in a draft pack | partial (clamped) |
| 16 | same objective links twice (semantic `equal`, functional `intersects_with`) | partial (weakest wins) |
| 17 | exhaustive group, every child full | roll-up full |
| 18 | non-exhaustive group, every listed child full | no roll-up |
| 19 | crosswalk A→T `superset_of`, A cell full | T full |
| 20 | crosswalk A→T `superset_of`, A cell partial | T partial |
| 21 | crosswalk A→T `subset_of`, A cell full | T partial |
| 22 | authored T→A "T1 `subset_of` R5", used inverted, R5 full | T full |
| 23 | joint sources `superset_of`, every source full | T full |
| 24 | joint sources `superset_of`, one source partial | T partial |
| 25 | authored T-side entry with two sources, viewed from A | T unmapped (not invertible) |
| 26 | syntactic-only entry | T unmapped |
| 27 | A-side exception through any relationship | T exception |
| 28 | crosswalk to a T group with `superset_of`, A full | T children full |
| 29 | crosswalk to a T group with `intersects_with`, A full | T children parent_only |
| 30 | A→B and B→T exist, no A→T | T unmapped (no transitivity) |
| 31 | exhaustive A group fully covered used as a crosswalk source | T full |
| 32 | non-exhaustive A group, all listed children full, used as a source | T partial |
| 33 | partial group link whose source is not supported, child also has its own full link | child exception |
| 34 | partial group link whose source is still open | children open |

### 9.9 What pack #1 shows on day one

Migrated links are partial and point at article nodes, because the catalogue only says which article a paper relates to. In an AI Act engagement:

- the 26 article-level leaves can reach at most "Partly covered";
- the 68 obligation subitems show "Mapped at a higher level only", unless an obligation record assesses them directly.

This is deliberately conservative: the data does not support more. Replacing migrated links with reviewed ones is a methodology task that changes only data, planned in phase 3, after which precise "Covered" results appear.

## 10. Persistence on D1

```ts
// lib/domain types (lib/domain/types.ts after #6). The only stored addition.
export type CriteriaPin = { packId: string; packVersion: string; packSha256: string };
export type EngagementCriteria = {
  pin: CriteriaPin;
  pinnedAt: string; // ISO timestamp
  pinnedBy: string; // user id
  origin: 'created' | 'legacy' | 'repinned';
  history: { pin: CriteriaPin; at: string; actor: string; origin: 'created' | 'legacy' | 'repinned'; reason: string }[]; // at most 20 entries, then 413
};
// Engagement gains: criteria?: EngagementCriteria
```

- **Size.** The pin is about 300 bytes in `engagements.body` and in each snapshot row. Packs, frameworks and crosswalks ship with the build, are not tenant data and are never written to D1 or R2.
- **No schema change.** Phase 1 needs no Drizzle migration and changes nothing in R2.
- **Writes.**
  - Phase 1 writes `criteria` only when an engagement is created: `createEngagement`, `openFollowup`, and the auto-provisioned `ENG-default`.
  - A follow-up engagement inherits the predecessor's pack id and takes that pack's current version. If every version of that pack is withdrawn, it answers 409 "Choose a criteria pack for the follow-up engagement".
- **Read models.**
  - `GET /api/workspace` adds `criteria` (pin, origin, pack title and kind, frameworks with short titles, and a `withdrawn` flag). It adds `selectablePacks` for practice administrators.
  - Its `catalog` field becomes `legacyCatalog(pinned pack)`, or the default pack's projection when no engagement is selected. The client type `WorkspaceData.catalog` and every client use of it stay unchanged.
  - New `GET /api/coverage?tenantId&engagementId&framework=<id>@<edition>` returns `{pin, framework, programApproved, summary, groups, cells, crosswalks, unusableEntries, notes}`. Each cell lists its contributions with the evidence chain (source id, template, paper id and revision, reviewer, conclusion) and the link path (objective, relationship, rationale, inherited-from group, crosswalk entry).
  - The coverage endpoint is computed on demand from one aggregate, the pinned documents and at most 1,000 assurance records, all of which the route already loads for gates. Internal roles with engagement access may call it. Client roles get 403 in phase 1.
- **Commands.**
  - `createEngagement` accepts optional `packId` and `packVersion`. The version must be released, selectable, not withdrawn and backed by confirmed licences; otherwise it answers 400 "Choose a released criteria pack".
  - The management event details record the pack.
- **Report snapshots** gain `criteria: {packId, packVersion, packSha256}` (phase 1). Phase 2 adds framework and crosswalk stamps and, with #20, coverage by criterion.

## 11. Migration of the existing catalogue (pack #1)

### 11.1 Inputs

The conversion reads the files as committed at `main@74c6463`. Digests are of the LF blobs (`git show 74c6463:<path> | sha256sum`):

| File | Role | sha256 |
|---|---|---|
| `templates/catalog.json` | programme, regulatory snapshot, defaults | `10a75f63d82e9cee1dc5ed13d15d2a20208cc67c8986a076a77c40fbfdc0857e` |
| `docs/obligation-subitems.json` | subitem requirements, trigger profiles, fact types | `ab3a4de0c874451785351f17e1cf9a188621455a70df375bd202b90d585ef08d` |
| `templates/annex-iv-map.json` | stays a separate file in phase 1; its `paperIds` must exist in pack #1 | `a814641f56834ce0298d022676c1001fd6b335d3578c6d2e6c8d5d16147d1623` |

If #18 has already released methodology 2026.11.1, the converter also runs on #18's files and produces pack #1 version 2026.11.1. Both versions are kept.

### 11.2 Converter rules

`templates/criteria/tools/convert-catalog.mjs` is deterministic. The scratch prototype that produced the sample fixture implements these rules.

1. **Framework document.**
   - Identity: `id: eu-ai-act`, `edition: regulatorySnapshot.celex`, `version: methodologyVersion`.
   - Fixed values: the title and `shortTitle` "EU AI Act (amended)", `kind: legislation`, publisher "European Union", `jurisdiction: EU`, `status: in_force`.
   - Copied from the snapshot: `consolidatedAsOf`, `researchedAsOf`, `amendingActs: [amendingRegulation]`, and sources from its four URLs plus the obligation file's `source.url` (role `consolidated_html`).
   - Licence: as in section 13. `applicationSummary` and `guidance` are copied verbatim.
   - `triggerProfiles` and `factTypes` are copied verbatim from the obligation file. The sample keeps only those its requirements use.
2. **Article nodes**, one per distinct catalogue `regulatoryRefs` string (38).
   - Id: `AIA-ART-<number><suffix in upper case>` for `Art.N[a]` (so `Art.4a` becomes `AIA-ART-4A`), and `AIA-ANNEX-<roman>` for `Annex X`.
   - `ref`: `Art. N` or `Annex X`. `aliases`: the catalogue string verbatim.
   - `title`: the official article heading, from a curated table that #27 checks against the Commission AI Act Service Desk and records with `verification: verified` and the check date. The sample's four headings were checked on 5 November 2026.
   - `type`: `group` with `exhaustive: false` when the obligation file has children for the article (Arts 9–15, 23–26 and Annex IV: 12 groups), otherwise `requirement` (26 leaves).
   - Order: articles numerically, then annexes.
3. **Obligation nodes**, one per obligation item (68), in file order after their parent.
   - `id: code`.
   - `ref`: `Art. ` plus `article`, unless `article` starts with `Annex`.
   - `title`, `actors` (from `actor`), `trigger`, `evidenceCategories` and `reviewNote` are copied.
   - `dependencies`, `specificDocumentRequired` and `categoryMatchIsInsufficient` go under `extensions`.
   - `parent`: the article given by the leading number of `article`, or `AIA-ANNEX-IV`.
   - Provenance: the obligation source URL, `verification: unverified` and `legalReview: required`, because the obligation file is `proposed_for_methodology_review`.
4. **Pack document.**
   - Identity: `id: eu-ai-act-amended`, `version` and `methodologyVersion` set to the catalogue's methodology version, `title` "EU AI Act (amended)", `kind: audit_programme`.
   - One primary criteria set pointing at the framework above. `defaults` verbatim; `compat.catalog` holds `schemaVersion` and `regulatorySnapshot` verbatim.
   - `roles: {limitationMemo: "MEM-EX-01", diagnosticPaperByResultArticle: {"10": "WP-A10-02", "*": "WP-A15-01"}, externalExecutionPaper: "WP-A15-01"}` and `features: {annexIvIndex: true}`. These mirror today's route code.
5. **Control objectives.**
   - One per working paper, in catalogue order: `CO-<item id>`, with `statement` set to the item's `objective`.
   - One link per catalogue ref to its article node: `intersects_with`, `semantic`, `origin: migrated`, with the fixed justification shown in the fixture.
   - Working papers without refs (for example WP-PL-01) get an objective with no links. It does not affect coverage.
6. **Items.** Every catalogue item verbatim and in order, plus `objectiveIds`: `[CO-<id>]` for working papers, `[]` for memos.
7. **Output.** Two-space indented JSON, keys in the order above, LF line endings. The index entries are added by hand after review.

### 11.3 Lossless guarantee

Golden tests for #27:

- **Projection.** `legacyCatalog(pack)` returns `{schemaVersion: compat.catalog.schemaVersion, methodologyVersion, regulatorySnapshot: compat.catalog.regulatorySnapshot, defaults, items}` with `objectiveIds`, `phase` and `derivedFrom` removed from each item. For pack #1 version 2026.10.1 it must deep-equal the parsed catalogue at `74c6463`. Commit that file as `schemas/fixtures/catalog-2026.10.1.json` and assert its LF sha256, because #18 will change `templates/catalog.json`. The prototype passed this check for the sample: item order, every field, and the key set of every item.
- **Seeding.** With a fixed user id and time, the new `seedWorkflow(pack, …)` output deep-equals the output of today's `seedWorkflow`, captured as a fixture before the refactor.
- **Paper templates.** For all 45 ids, the new `templatePaper` deep-equals today's, with `id` and `now` stubbed.
- **Obligations.** Every obligation item equals the projection of its requirement node (code, article, title, actor, trigger, evidence categories, extensions). Phase 2 generates `obligation-subitems.json` from the framework and makes the framework canonical.

### 11.4 Open engagements: explicit and reversible

| Step | When | What happens to an open engagement | How to reverse it |
|---|---|---|---|
| M0. Read-time legacy pin | Phase 1 deploy | Nothing is written. `pinOf(e) = e.criteria?.pin ?? legacyPin(e)`. `legacyPin` maps #18's engagement stamp (use the field #18 actually introduces) through `index.legacy.methodologyVersions`; an engagement without a stamp gets `fallbackVersion` 2026.10.1. All behaviour is unchanged because the pinned pack projects to the exact catalogue (section 11.3) | Redeploy the previous build. No data changed |
| M1. Explicit legacy pin | Phase 2, run by a practice administrator per engagement or per tenant | A `pinCriteria` command writes `criteria` with `origin: legacy` and the same resolved pin, through the normal compare-and-swap save. That adds an audit event, a snapshot row and a version bump. Behaviour is identical; the pin becomes visible in the stored aggregate | `unpinCriteria`, allowed while `origin` is `legacy` and `history` is empty, removes the field and records an event. Snapshot rows are append-only and stay |
| M2. Move to a newer pack version | Phase 3, Lead Auditor, per engagement | `repinCriteria` shows a diff (items, steps, objectives and links added, removed or changed). On confirmation it records the old pin in `history`. Each procedure whose template content changed (title, objective, steps, evidence) gets a history entry and the new content as a new revision, so the existing rules require a new execution and review. Link-only changes touch no procedure, because links are derived from the pin. An approved program returns to draft through the existing `programDraft` path if any selected procedure changed. New items are added unselected. Issued reports never change | `revertCriteriaPin` restores the previous pin, and the procedure revisions from history, while no procedure has been executed or reviewed under the new pin. After that, roll back by moving forward to another pin; history is kept |

**Rollback window for the code.**
- Older builds ignore the `criteria` field: it survives their saves because the body is parsed and written back whole.
- A rollback is therefore safe for every engagement that pins `eu-ai-act-amended`.
- Once an engagement pins a different pack, an older build answers 400 "Unknown methodology template" for that engagement's template commands, without corrupting its data. Redeploying the newer build restores it. So non-AI-Act packs are offered for selection only after phase 1 has run stable in production, and only through the `selectable` flag in the index.

**Pre-deploy check.**
- The operator runs these read-only queries (`wrangler d1 execute <database> --remote --command "<sql>"`) and compares the template ids with pack #1's item ids. The phase 1 PR attaches the expected result from staging.
- The deploy proceeds only if every id is known. An unknown id would mean data the catalogue cannot explain.

```sql
SELECT COUNT(*) AS engagements, SUM(json_type(body, '$.criteria') IS NOT NULL) AS pinned FROM engagements;
SELECT DISTINCT json_extract(p.value, '$.templateId') AS template FROM engagements, json_each(engagements.body, '$.papers') AS p;
SELECT DISTINCT json_extract(p.value, '$.templateId') AS template FROM engagements, json_each(engagements.body, '$.workflow.procedures') AS p;
```

## 12. Adding a new pack as data alone

Worked example: the EN 18286 + ISO/IEC 42001 programme of #28, cut down to one working paper. A scratch harness checked each step:

- the six JSON blocks below validate against the draft schema;
- together with the sample AI Act framework, they pass a prototype of integrity rules 1, 2, 4 to 7, 9 and 11 of section 14.2 and the roles part of rule 8 (rules 3, 10, 12 and 13 concern several versions or the release step and do not apply to drafts);
- the coverage engine gives the results in the table at the end of this section.

Clause numbers and topics come from secondary sources and are marked so; they must be confirmed against licensed copies before #28 releases anything.

**Steps.** No TypeScript, route or UI change is needed for any of them.

1. Add `templates/criteria/frameworks/en-18286/2026/2027.1.0.json` and `frameworks/iso-iec-42001/2023/2027.1.0.json`.
2. Add `templates/criteria/packs/en18286-iso42001/2027.1.0.json`. Copy shared items (here `MEM-EX-01`) with `derivedFrom`, so that CI reports when the upstream item changes.
3. Add `crosswalks/iso-iec-42001-to-eu-ai-act/2027.1.0.json` and `crosswalks/en-18286-to-eu-ai-act/2027.1.0.json`.
4. Add the five entries to `templates/criteria/index.json` as `draft`.
5. Run `node schemas/validate-criteria.mjs`, then the methodology sync script from #3 (`site-app/scripts/sync-methodology.mjs`), then `npm test`. Drafts are excluded from the production bundle; tests load them through an injected registry.
6. Review in the pull request. After counsel confirms the licence policy (Q1), set `licence.status` to `confirmed` (the documents are still drafts, so this is allowed).
7. Mark the entries `released` with approver and dates. `node schemas/validate-criteria.mjs --stamp` fills in their JCS digests, CI enforces the digests from then on, the bundle includes the documents, and the pack appears in the new-engagement dialog.

Framework, EN 18286:

```json
{
  "documentType": "framework",
  "schemaVersion": "1.0.0",
  "id": "en-18286",
  "edition": "2026",
  "version": "2027.1.0",
  "title": "EN 18286:2026 Artificial intelligence - Quality management system for EU AI Act regulatory purposes",
  "shortTitle": "EN 18286:2026",
  "kind": "harmonised_standard",
  "publisher": "CEN-CENELEC",
  "jurisdiction": "EU",
  "status": "cited_in_oj",
  "sources": [
    {
      "role": "publisher_page",
      "url": "https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/"
    },
    {
      "role": "authentic_text",
      "url": "https://eur-lex.europa.eu/eli/dec_impl/2026/2274/oj",
      "title": "Commission Implementing Decision (EU) 2026/2274 (publication of the reference)"
    }
  ],
  "licence": {
    "holder": "CEN-CENELEC and the national standards bodies",
    "textPolicy": "paraphrased_titles",
    "status": "unconfirmed",
    "basis": "Clause numbers and our own short titles of at most 80 characters only; no text, tables or figures of the standard. Release waits for counsel to confirm this policy (open question Q1)."
  },
  "defaultProvenance": {
    "source": "https://docs.modulos.ai/frameworks/eu-ai-act/harmonized-standards/en-18286",
    "sourceKind": "secondary",
    "verification": "secondary_only",
    "legalReview": "required",
    "note": "Clause number and topic from a competitor-authored summary; confirm against the licensed standard."
  },
  "requirements": [
    { "id": "4", "ref": "4", "title": "QMS, its context and scope", "type": "requirement" },
    { "id": "5", "ref": "5", "title": "Leadership and roles", "type": "requirement" },
    { "id": "6", "ref": "6", "title": "Planning", "type": "requirement" },
    { "id": "8", "ref": "8", "title": "AI system realisation across the life cycle", "type": "requirement" },
    { "id": "9", "ref": "9", "title": "Market, supply chain and monitoring", "type": "requirement" },
    { "id": "10", "ref": "10", "title": "Management review and planned changes", "type": "requirement" }
  ]
}
```

Framework, ISO/IEC 42001 (extract: two clauses of the planning and operation chapters):

```json
{
  "documentType": "framework",
  "schemaVersion": "1.0.0",
  "id": "iso-iec-42001",
  "edition": "2023",
  "version": "2027.1.0",
  "title": "ISO/IEC 42001:2023 Information technology - Artificial intelligence - Management system",
  "shortTitle": "ISO/IEC 42001:2023",
  "kind": "international_standard",
  "publisher": "ISO/IEC JTC 1/SC 42",
  "jurisdiction": "international",
  "status": "published",
  "editionDate": "2023-12-18",
  "sources": [{ "role": "catalogue_entry", "url": "https://www.iso.org/standard/42001" }],
  "licence": {
    "holder": "ISO and IEC",
    "textPolicy": "paraphrased_titles",
    "status": "unconfirmed",
    "basis": "Clause numbers and our own short titles of at most 80 characters only; no text, tables or figures of the standard. Release waits for counsel to confirm this policy (open question Q1)."
  },
  "defaultProvenance": {
    "source": "https://www.iso.org/standard/42001",
    "sourceKind": "secondary",
    "verification": "secondary_only",
    "note": "Clause number from the published table of contents; confirm against the licensed standard."
  },
  "requirements": [
    { "id": "6", "ref": "6", "title": "Planning", "type": "group", "exhaustive": false },
    { "id": "6.1.2", "ref": "6.1.2", "title": "AI risk assessment (planning)", "type": "requirement", "parent": "6" },
    { "id": "6.1.4", "ref": "6.1.4", "title": "AI system impact assessment (planning)", "type": "requirement", "parent": "6" },
    { "id": "8", "ref": "8", "title": "Operation", "type": "group", "exhaustive": false },
    { "id": "8.2", "ref": "8.2", "title": "AI risk assessment (operation)", "type": "requirement", "parent": "8" }
  ]
}
```

Pack (one working paper, one shared memo):

```json
{
  "documentType": "pack",
  "schemaVersion": "1.0.0",
  "id": "en18286-iso42001",
  "version": "2027.1.0",
  "title": "EN 18286 + ISO/IEC 42001 management system",
  "summary": "One management-system programme with two sets of criteria: EN 18286:2026 for AI Act QMS readiness and ISO/IEC 42001:2023 for certification-style assessment.",
  "kind": "audit_programme",
  "methodologyVersion": "2027.1.0",
  "engagementTypes": ["readiness_assessment", "attestation", "certification_audit"],
  "criteria": [
    { "framework": "en-18286", "edition": "2026", "version": "2027.1.0", "role": "primary" },
    { "framework": "iso-iec-42001", "edition": "2023", "version": "2027.1.0", "role": "primary" }
  ],
  "phases": [{ "id": "stage-1", "title": "Stage 1" }, { "id": "stage-2", "title": "Stage 2" }],
  "defaults": {
    "initialStatus": "draft",
    "applicability": "pending",
    "auditorConclusion": "not_assessed",
    "diagnosticState": "pending",
    "numericalThreshold": null,
    "conclusionOwner": "human_auditor",
    "approvalBindsTo": "revision_and_content_digest",
    "independentReview": true,
    "coverageRule": "Unknown, not_run, inconclusive and error do not count as pass.",
    "statement": "Diagnostics support an audit assessment and do not constitute legal compliance or a conformity certificate."
  },
  "roles": { "limitationMemo": "MEM-EX-01" },
  "controlObjectives": [
    {
      "id": "CO-AIMS-RISK-01",
      "statement": "Assess whether the AI risk assessment process is defined and is performed at planned intervals and after significant changes.",
      "addresses": [
        {
          "requirement": "iso-iec-42001:6.1.2",
          "relationship": "superset_of",
          "rationale": "functional",
          "justification": "Steps P01 and P02 test every requirement of clause 6.1.2 as listed in the licensed copy; the objective adds sampling of individual AI systems.",
          "origin": "authored"
        },
        {
          "requirement": "iso-iec-42001:8.2",
          "relationship": "superset_of",
          "rationale": "functional",
          "justification": "Steps P02 and P03 test performance of assessments at planned intervals and after significant change, which is all of clause 8.2.",
          "origin": "authored"
        },
        {
          "requirement": "en-18286:6",
          "relationship": "intersects_with",
          "rationale": "semantic",
          "justification": "EN 18286 planning also covers quality objectives and change planning that this objective does not test.",
          "origin": "authored"
        }
      ]
    }
  ],
  "items": [
    {
      "id": "AIMS-S2-01",
      "title": "AI risk assessment: design and operation",
      "kind": "working_paper",
      "stage": "Fieldwork",
      "folder": "03 Fieldwork / Stage 2",
      "templatePath": "templates/article-fieldwork.md",
      "regulatoryRefs": [],
      "automationMode": "manual",
      "objective": "Assess whether the AI risk assessment process is defined and is performed at planned intervals and after significant changes.",
      "procedures": [
        { "id": "AIMS-S2-01-P01", "text": "Inspect the documented risk assessment process, its criteria and the approved risk acceptance levels." },
        { "id": "AIMS-S2-01-P02", "text": "Trace a sample of AI systems through risk identification, analysis, evaluation and treatment." },
        { "id": "AIMS-S2-01-P03", "text": "Verify that assessments were repeated at planned intervals and after significant changes." },
        { "id": "AIMS-S2-01-P04", "text": "Reconcile assessment results with the risk treatment plan and the impact assessment." }
      ],
      "evidenceRequired": ["Risk assessment procedure", "Risk register extract", "Sampled assessment records", "Change log", "Management approvals"],
      "signOffGate": "Independent reviewer clears blocking notes and approves the exact revision; lead approval where material.",
      "objectiveIds": ["CO-AIMS-RISK-01"],
      "phase": "stage-2"
    },
    {
      "id": "MEM-EX-01",
      "title": "Exception, limitation and disagreement memo",
      "kind": "memo",
      "stage": "Evidence Evaluation",
      "folder": "04 Evaluation",
      "templatePath": "templates/memo-decision.md",
      "regulatoryRefs": [],
      "automationMode": "manual",
      "objective": "Evaluate unresolved exceptions and their effect on conclusion.",
      "procedures": [
        { "id": "MEM-EX-01-P01", "text": "Describe criterion, missing/conflicting evidence and efforts to obtain it." },
        { "id": "MEM-EX-01-P02", "text": "Assess alternatives, severity and potential pervasive effects." },
        { "id": "MEM-EX-01-P03", "text": "Document management position and required report disclosure." }
      ],
      "evidenceRequired": ["Exception register", "Evidence requests", "Management correspondence", "Follow-up papers"],
      "signOffGate": "Independent reviewer clears blocking notes and approves the exact revision; lead approval where material.",
      "objectiveIds": [],
      "derivedFrom": { "packId": "eu-ai-act-amended", "version": "2026.10.1", "itemId": "MEM-EX-01" }
    }
  ]
}
```

Crosswalk, ISO/IEC 42001 to the AI Act:

```json
{
  "documentType": "crosswalk",
  "schemaVersion": "1.0.0",
  "id": "iso-iec-42001-to-eu-ai-act",
  "version": "2027.1.0",
  "title": "ISO/IEC 42001:2023 to the EU AI Act (amended)",
  "source": { "framework": "iso-iec-42001", "edition": "2023" },
  "target": { "framework": "eu-ai-act", "edition": "02024R1689-20260727" },
  "useCase": {
    "intendedUsers": "Lead auditors and reviewers on engagements that use either framework as criteria.",
    "purpose": "Show where ISO/IEC 42001 audit evidence also bears on AI Act obligations, and where it does not.",
    "conceptTypes": { "source": "Management-system requirements (clauses)", "target": "Legal obligations (articles and paragraphs)" },
    "assumptions": "Relationships compare what each requirement demands, not how an organisation implements it. No inference may be drawn from requirements that are not mapped."
  },
  "method": "human",
  "entries": [
    {
      "id": "X1",
      "sources": ["6.1.2"],
      "target": "AIA-9-1",
      "relationship": "intersects_with",
      "rationale": "semantic",
      "confidence": "medium",
      "justification": "Both require an established risk process. ISO/IEC 42001 targets risks to the organisation's AI objectives; Art. 9(1) requires a lifecycle risk-management system for one high-risk system. Neither contains the other."
    },
    {
      "id": "X2",
      "sources": ["8.2"],
      "target": "AIA-9-1",
      "relationship": "intersects_with",
      "rationale": "semantic",
      "confidence": "medium",
      "justification": "Performing assessments at planned intervals supports the 'maintained' element of Art. 9(1) but does not establish the system-level risk-management system."
    }
  ]
}
```

Crosswalk, EN 18286 to the AI Act, recording the presumption of conformity as a legal effect without letting it raise coverage:

```json
{
  "documentType": "crosswalk",
  "schemaVersion": "1.0.0",
  "id": "en-18286-to-eu-ai-act",
  "version": "2027.1.0",
  "title": "EN 18286:2026 to the EU AI Act (amended)",
  "source": { "framework": "en-18286", "edition": "2026" },
  "target": { "framework": "eu-ai-act", "edition": "02024R1689-20260727" },
  "useCase": {
    "intendedUsers": "Lead auditors and reviewers on engagements that use either framework as criteria.",
    "purpose": "Record which AI Act provisions the harmonised QMS standard relates to, including the scope of its presumption of conformity.",
    "conceptTypes": { "source": "Management-system requirements (clauses)", "target": "Legal obligations (articles and paragraphs)" },
    "assumptions": "Relationships compare what each requirement demands, not how an organisation implements it. No inference may be drawn from requirements that are not mapped."
  },
  "method": "human",
  "entries": [
    {
      "id": "X1",
      "sources": ["4", "5", "6", "8", "9", "10"],
      "target": "AIA-ART-17",
      "relationship": "intersects_with",
      "rationale": "functional",
      "confidence": "low",
      "justification": "Annex ZA relates these clauses to Art. 17(1); Art. 17(2) to (4) are outside it, and the clauses also cover topics beyond Art. 17. At article level the two only overlap.",
      "legalEffect": {
        "kind": "presumption_of_conformity",
        "basis": "EN 18286:2026 Annex ZA (Table ZA.1); reference published by Commission Implementing Decision (EU) 2026/2274.",
        "conditions": "Only for the Art. 17(1) rows and conditions of Table ZA.1, and only while the reference stays published in the Official Journal. A presumption follows from conformity with the standard; it is not an audit conclusion.",
        "provenance": {
          "source": "https://docs.modulos.ai/frameworks/eu-ai-act/harmonized-standards/en-18286",
          "sourceKind": "secondary",
          "verification": "secondary_only",
          "legalReview": "required",
          "note": "Competitor-authored summary; confirm against Annex ZA of the licensed standard and the Implementing Decision."
        }
      }
    }
  ]
}
```

Index after the change. The two released entries carry the real JCS digests of the sample fixture's documents; the approver is an example value:

```json
{
  "documentType": "index",
  "schemaVersion": "1.0.0",
  "documents": [
    {
      "documentType": "framework",
      "id": "eu-ai-act",
      "edition": "02024R1689-20260727",
      "version": "2026.10.1",
      "path": "frameworks/eu-ai-act/02024R1689-20260727/2026.10.1.json",
      "sha256": "04bf650d7a60c5df759d1fd31a315a1aebe93ea62cb62f00d4562719eacc6631",
      "status": "released",
      "approvedBy": "Methodology owner (example)",
      "approvedAt": "2026-12-01",
      "releasedAt": "2026-12-01"
    },
    {
      "documentType": "pack",
      "id": "eu-ai-act-amended",
      "version": "2026.10.1",
      "path": "packs/eu-ai-act-amended/2026.10.1.json",
      "sha256": "93792c0f7c0bb40f62514536154f90c017d1df59939d7d9bdb973ff231f8e9c9",
      "status": "released",
      "approvedBy": "Methodology owner (example)",
      "approvedAt": "2026-12-01",
      "releasedAt": "2026-12-01",
      "selectable": true
    },
    { "documentType": "framework", "id": "en-18286", "edition": "2026", "version": "2027.1.0", "path": "frameworks/en-18286/2026/2027.1.0.json", "status": "draft" },
    { "documentType": "framework", "id": "iso-iec-42001", "edition": "2023", "version": "2027.1.0", "path": "frameworks/iso-iec-42001/2023/2027.1.0.json", "status": "draft" },
    { "documentType": "pack", "id": "en18286-iso42001", "version": "2027.1.0", "path": "packs/en18286-iso42001/2027.1.0.json", "status": "draft", "selectable": true },
    { "documentType": "crosswalk", "id": "iso-iec-42001-to-eu-ai-act", "version": "2027.1.0", "path": "crosswalks/iso-iec-42001-to-eu-ai-act/2027.1.0.json", "status": "draft" },
    { "documentType": "crosswalk", "id": "en-18286-to-eu-ai-act", "version": "2027.1.0", "path": "crosswalks/en-18286-to-eu-ai-act/2027.1.0.json", "status": "draft" }
  ],
  "defaults": { "pack": { "id": "eu-ai-act-amended", "version": "2026.10.1" } },
  "legacy": { "packId": "eu-ai-act-amended", "fallbackVersion": "2026.10.1", "methodologyVersions": { "2026.10.1": "2026.10.1" } }
}
```

Coverage once the documents are released and the engagement's `AIMS-S2-01` procedure is reviewed, signed and supported:

| View | Requirement | State | Why |
|---|---|---|---|
| ISO/IEC 42001 (criteria) | 6.1.2 AI risk assessment (planning) | Covered | `superset_of` from a supported conclusion |
| ISO/IEC 42001 (criteria) | 8.2 AI risk assessment (operation) | Covered | as above |
| ISO/IEC 42001 (criteria) | 6.1.4 AI system impact assessment (planning) | Not mapped | no objective addresses it |
| EN 18286 (criteria) | 6 Planning | Partly covered | `intersects_with` |
| EN 18286 (criteria) | 4 QMS, its context and scope | Not mapped | |
| EU AI Act (crosswalk) | Art. 9(1) | Partly covered | only `intersects_with` entries; a full ISO result cannot become a full AI Act result |
| EU AI Act (crosswalk) | Art. 17 | Partly covered, with a "presumption basis: EN 18286 Annex ZA, Art. 17(1) only (secondary source)" badge | the legal effect never raises the state |
| EU AI Act (crosswalk) | Art. 16, Art. 50 | Not mapped | |

The same data while still a draft shows 6.1.2 and 8.2 as "Partly covered", because of the clamp in section 9.2. If the reviewer concludes "not supported", every mapped cell, including Art. 9(1) and Art. 17 in the AI Act view, shows "Exception in a related source". The harness asserted all three outcomes.

Pack-specific features that #28 also wants are *features*, not criteria, and need code: the Statement of Applicability, nonconformity grading and the certification recommendation. The criteria model makes them possible but does not supply them.

## 13. Licensing constraints

| Source | Position | Text policy | Status |
|---|---|---|---|
| EU AI Act and other EU legislation | Reuse of EUR-Lex content is authorised provided the source is acknowledged, under Commission Decision 2011/833/EU ([Decision](https://eur-lex.europa.eu/eli/dec/2011/833/oj)). Consolidated texts are research aids; the Official Journal is authentic. The wording was confirmed through mirrors of the EUR-Lex notice, because the live legal notice page returned empty to automated fetching | `full_text`, with attribution | confirmed (re-check the live notice before #27 releases) |
| EN 18286:2026 and other CEN-CENELEC standards | Copyright of CEN-CENELEC and the national members; sold through national standards bodies | `paraphrased_titles`: clause numbers and our own titles of at most 80 characters. No text, tables, figures or Annex ZA table rows. State facts about the standard (scope of the presumption) with sources | unconfirmed until counsel signs off (Q1) |
| ISO/IEC 42001, 42005, 42006, 23894 | ISO and IEC copyright, sold through ISO and national bodies ([ISO/IEC 42001](https://www.iso.org/standard/42001)) | `paraphrased_titles` | unconfirmed until counsel signs off (Q1) |
| NIST AI RMF 1.0, NIST AI 600-1 | NIST: except material marked as copyrighted, information on NIST sites is public information and may be distributed or copied; credit is requested ([NIST](https://www.nist.gov/oism/copyrights)) | `full_text`, with attribution | confirmed for NIST-authored content; check third-party crosswalks on the AIRC separately |
| NYC Local Law 144 and the DCWP rules | Public law | `full_text` | confirmed |
| AIUC-1 | The standard site's footer reads "© AIUC — ALL RIGHTS RESERVED" ([standard](https://standard.aiuc-1.com/)). The AIUC terms of service (last updated 15 July 2025) grant only personal, non-commercial use of the site and prohibit copying, redistribution and derivative works of site content ([terms](https://aiuc.com/legal/terms)). The terms do not mention the standard specifically | `identifiers_only` at most | unconfirmed: do not ship any AIUC-1 framework or crosswalk until AIUC grants written permission (Q2) |
| CSA AI Controls Matrix (route for SOC 2 + AI and AIUC-1 mapping) | Free to download; CSA publishes a licensing FAQ that distinguishes internal reference from licensed use ([CSA FAQ](https://cloudsecurityalliance.org/artifacts/ccm-aicm-licensing-faq)). Terms not read for this design | to decide | unconfirmed (Q3) |

**Enforcement.**
- **Schema.** `paraphrased_titles` requires titles of at most 80 characters and forbids `text`. `identifiers_only` forbids titles. Only `full_text` allows `text`. The fixture tests reject each violation.
- **Validator.** A framework whose licence is `unconfirmed` cannot be `released`. No document may contain text of a `paraphrased_titles` source in any field, including justifications. The validator cannot detect this, so the release approval records that a reviewer checked it.
- **UI.** The pack card and the requirement drawer show the attribution or the "clause numbers only, use your licensed copy" note.

## 14. Validation and loading

### 14.1 JSON Schema

`schemas/criteria-pack.schema.json` (Draft 2020-12, compiled with Ajv 2020 like the existing validators) checks:

- the shape of each document type, its identifiers, patterns and enumerations;
- `https` sources;
- provenance completeness (a verified fact needs a check date);
- the licence text policy;
- migrated links being `intersects_with`;
- working papers having objectives, steps (at most 30, the limit of `recordProcedureExecution`) and evidence;
- audit programmes having a primary criteria set;
- index entries: release metadata and digests on released entries, withdrawal reasons, and `edition` and `selectable` only where they belong.

The draft was checked against the sample fixture, 16 rejected document mutations and 7 rejected index mutations.

### 14.2 Integrity rules

JSON Schema cannot check these; `schemas/validate-criteria.mjs` must. Each needs a failing fixture.

1. Requirement ids are unique per document; aliases are unique per document.
2. `parent` points at a `group` of the same document; there are no cycles; every group has at least one child.
3. Every id released in an earlier data version of an edition exists in every later released data version; `replacedBy` targets exist.
4. Each pack criteria set resolves to an indexed framework document with that id, edition and data version; `include` ids exist.
5. Objective links resolve in the pack's criteria sets; no link targets an `informative` node; one objective links a requirement at most once per rationale.
6. Item ids and step ids are unique within a pack; every `objectiveIds` entry exists; every objective is used by at least one item; `phase` exists in `phases`.
7. Every `regulatoryRefs` string of an item resolves through `aliases` in a primary framework.
8. `roles` reference items of the pack; `features.annexIvIndex` requires every `paperIds` entry of `templates/annex-iv-map.json` to be an item.
9. Crosswalk endpoints exist in the latest released data version of each edition; `sources` and `target` are in the right frameworks.
10. An entry with `legalEffect` has `legalReview: completed` before release.
11. A `derivedFrom` item equals its upstream item (ignoring `objectiveIds`, `phase` and `derivedFrom`); otherwise the validator prints an "upstream changed" report. This is a warning, not a failure.
12. Index: every listed path exists and every file under `templates/criteria/{frameworks,packs,crosswalks}` is listed; ids and versions match the file content and path; versions increase; `defaults.pack` and `legacy` point at released packs; every released or withdrawn digest equals the JCS digest of the file; released documents reference only released documents; `selectable` packs are audit programmes whose framework licences are confirmed.
13. Released entries are never removed and their digests never change. CI checks this against the index on `main`.

### 14.3 Build-time copy into `site-app`

This follows #3, whose sync script (`site-app/scripts/sync-methodology.mjs`) copies the methodology files and has a `--check` mode wired into `npm run check` and CI.

- **Extended sync step.** It validates all criteria documents (14.1, 14.2) and writes one file, `site-app/lib/criteria/bundle.generated.json`: a `bundle` document with `purpose: generated`, the index, and every released or withdrawn document in index order.
  - The bundle is serialised in JCS order, so `--check` can regenerate it in memory and compare it byte for byte.
  - Drafts are left out unless `CRITERIA_INCLUDE_DRAFTS=1` is set for local development.
- **Formatting.** Add `lib/criteria/*.json` to `site-app/.prettierignore`. The existing `lib/*.json` pattern does not match the subfolder.
- **CI.**
  - The `engine` job runs `node schemas/validate-criteria.mjs` next to the existing validators.
  - The `web` job runs the sync `--check` through `npm run check`.
- **Size.** Pack #1 is about 130 KB uncompressed per version (the catalogue is 62 KB, plus about 100 requirement nodes and 33 objectives), and JSON compresses well. If the bundle passes 1 MB, switch to one JSON import per document behind the same loader API.

### 14.4 Loader API (`site-app/lib/criteria/`)

```ts
registry(bundle = generated): Registry          // memoised; documents deep-frozen; indexes in Maps
selectablePacks(r): PackSummary[]               // released, selectable, not withdrawn, licences confirmed
defaultPin(r, packId?): CriteriaPin
legacyPin(r, e: Engagement): CriteriaPin        // section 11.4, M0
pinOf(r, e: Engagement): CriteriaPin            // e.criteria?.pin ?? legacyPin(r, e)
resolve(r, pin): { pack: PackDocument; frameworks: FrameworkDocument[] }   // pin digest must equal the index digest, else 500
item(pack, templateId): Item | undefined
legacyCatalog(pack): Catalog                    // section 11.3
criteriaFor(r, pin, templateId): RequirementLink[]
crosswalksFor(r, pin, target: { framework: string; edition: string }): CrosswalkDocument[]
coverageSources(e: Engagement, obligationRecords: AssuranceRecord[]): Source[]
primaryCoverage(args): Coverage; crosswalkCoverage(args): Coverage   // pure functions, section 9
```

- **Runtime trust.** The runtime trusts the bundle that CI checked. It compares the pin's digest string with the index and does not re-hash.
- **Tests.** They call `registry(fixtureBundle)` to inject test packs.
- **Server only.** `registry.ts` must not be imported by client components. An ESLint `no-restricted-imports` rule for `app/**/*.tsx` enforces this, and the client receives the projections from the API.

## 15. UI sketches

### 15.1 Pack selection at engagement creation

The existing "New engagement" dialog (`modal === 'engagement'`) gains a required choice, which defaults to `index.defaults.pack`:

```text
+- New engagement -------------------------------------------------------------+
| Client             [ Example client                                    v ]   |
| Engagement title   [ AI Act readiness - credit scoring 2027                ] |
|                                                                              |
| Criteria pack                                                                |
|  (o) EU AI Act (amended)                                2026.11.1  Default   |
|      Regulation (EU) 2024/1689 as amended, CELEX 02024R1689-20260727         |
|      33 working papers, 12 memos. High-risk work is labelled readiness       |
|      before the provision applies.                                           |
|  ( ) EN 18286 + ISO/IEC 42001 management system         2027.1.0             |
|      EN 18286:2026 + ISO/IEC 42001:2023. Stage 1 and Stage 2.                |
|      Crosswalks to: EU AI Act (amended).                                     |
|      Clause numbers only: the team needs licensed copies of the standards.   |
|                                                                              |
| The pack is pinned to this engagement. New pack versions never change it;    |
| a Lead Auditor can move it to a newer version with an impact review.         |
|                                                  [ Cancel ] [ Create engagement ] |
+------------------------------------------------------------------------------+
```

- The cards come from `selectablePacks`. With a single selectable pack, the choice shows as read-only text.
- The engagement header and the Methodology view show a badge such as "EU AI Act (amended) 2026.10.1", with a tooltip giving the framework editions and the pin digest prefix.

### 15.2 Coverage heatmap

It replaces the "Article-to-evidence mapping" panel of the Regulatory mapping view and keeps the classification and regulatory-basis panels. It is a lazily loaded component (`app/criteria-coverage.tsx`), following the code splitting of #1.

```text
Criteria coverage   EU AI Act (amended) 2026.10.1 (pinned)   Program approved r3
View: [ EU AI Act (criteria) ] [ ISO/IEC 42001:2023 (crosswalk) ]

94 requirements:  Covered 0 | Partly covered 14 | Exception 1 | Open 18 | Higher level only 57
                  Not mapped 0 | Excluded 3 | Not applicable 1        (illustrative day-one counts)

Legend: [##] Covered  [//] Partly covered  [XX] Exception  [..] Open  [^^] Higher level only
        [  ] Not mapped  [--] Excluded  [na] Not applicable  (R) readiness

Art. 9   Risk management system      article-level links from 7 papers: partly (unreviewed migration)
         9(1) [^^]  9(2)(a) [^^]  9(2)(b) [^^]  9(2)(c) [^^]  9(2)(d) [^^]  9(4)-(5) [^^]  ...
Art. 10  Data and data governance    article-level links: open (WP-A10-01, WP-A10-02)
         10(2)(a) [..]  10(2)(b) [..]  10(2)(c) [..]  ...    all 11 subitems inherit "Open"
Art. 16  Obligations of providers    [//] Partly covered (R)
Art. 17  Quality management system   [//] Partly covered (R)
Art. 50  Transparency obligations    [XX] Exception in a related source: WP-XC-07
```

- **Rows.** Each row is a group, with its counts. Each tile is one requirement.
- **Filters.** By state, actor and applicability date (once #18's dates exist). Filters persist per user through the existing workspace preferences.
- **Summary.** Counts with the denominator, never a merged percentage. Exports to CSV and to the report snapshot (phase 2).

### 15.3 Cell drawer

```text
+- Art. 17 Quality management system ------------------------------------ [x] -+
| Partly covered (readiness)                                                    |
| Why not "Covered": the only link is intersects_with, which is partial.         |
|                                                                               |
| Evidence chain                                                                |
|   PROC-WP-XC-01 Quality management and governance                             |
|     paper WP-3f2a revision 4, signed; reviewed by <reviewer> on <date>        |
|     conclusion: supported; applicability: readiness                           |
|     CO-WP-XC-01 --intersects_with (semantic, migrated)--> Art. 17             |
| Crosswalks                                                                    |
|   en-18286-to-eu-ai-act 2027.1.0 X1: intersects_with (functional)             |
|   Presumption basis: EN 18286 Annex ZA, Art. 17(1) only. Secondary source,    |
|   legal review required. Not an audit conclusion.                             |
| Source: Art. 17, consolidated text of 27 July 2026 (link)                     |
+-------------------------------------------------------------------------------+
```

### 15.4 Honesty and accessibility rules

- States are told apart by pattern and text label, not colour alone. Every tile has an accessible name such as "Art. 9(1), mapped at a higher level only".
- The grid can be navigated with arrow keys and Enter opens the drawer. Tiles keep a 24 px minimum target.
- No tile ever says "compliant", "certified" or "conformant". The legal-effect badge always says "basis" and "not an audit conclusion".
- "Not mapped" is neutral grey, never red. Exceptions link to the source paper. A readiness result always carries "(R)".

## 16. Test strategy

- **Vitest, `site-app/lib/criteria/*.test.ts`:**
  1. every committed criteria document and fixture validates; negative mutations as in `schemas/validate-procedure-schema.mjs`, starting from the 23 mutations used for this design;
  2. each integrity rule of 14.2 against a failing fixture;
  3. the JCS digest, including line-ending and whitespace invariance, and index digests;
  4. the pack #1 golden tests of 11.3 (projection, seeding, paper templates, obligations);
  5. `pinOf` and `legacyPin`, with and without #18's stamp;
  6. the 34 truth-table cases of 9.8, crosswalk inversion and orientation, and unusable-entry counts;
  7. the monotonicity properties of invariant 3, with a seeded generator (no new dependency);
  8. "a new pack as data alone": the section 12 documents loaded through an injected registry, then `freshEngagement` → `seedWorkflow` → `templatePaper` → coverage, with no code change.
- **Integration harness** (`scripts/integration-check.mjs`, picked up by `run-checks.mjs`):
  - write an engagement body without `criteria` straight into the local D1, as a pre-deploy engagement, and run the existing workflow and report flow; outputs must be unchanged;
  - create an engagement with `packId` and check the pin in `GET /api/workspace`;
  - review one procedure and check its cells from `GET /api/coverage`;
  - a Client Viewer gets 403 from the coverage endpoint.
- **CI.** `validate-criteria.mjs` in the `engine` job; `sync-methodology --check` inside `npm run check`.
- **Manual (until #34).** Dialog and heatmap at 375 px and desktop width, keyboard only, and with a screen reader.

## 17. Phased implementation plan

| Phase | Issue | Size | Scope | Done when |
|---|---|---|---|---|
| 1 | #27 | L, one PR | The data model: final schema, `validate-criteria.mjs` and its CI step. Converter plus pack #1 (2026.10.1, and 2026.11.1 if #18 has released it) with the golden fixture. Index. Sync extension, bundle and loader. Pin resolution with M0. Refactor of `templatePaper`, `freshEngagement`, `seedWorkflow`, `makePaper`, the limitation memo, run papers, the Annex IV flag and the GET projection onto the pinned pack. `createEngagement` with `packId`, follow-up inheritance and the dialog. Coverage engine, crosswalk support, `GET /api/coverage` and the heatmap | The golden tests pass; the existing harnesses pass unchanged; the section 12 pack works from data alone in a test; the 34 cases pass |
| 2 | new | M | M1 explicit pin commands. Report and dossier stamps for frameworks and crosswalks. `obligation-subitems.json` and `annex-iv-map.json` generated from the AI Act framework and pack, with projection tests. `regulatorySource` taken from the framework. Findings `criteriaRefs` for #20 | Obligation and Annex IV projections are lossless; snapshots carry every stamp |
| 3 | new | M | M2 repin with diff, impact review and revert. Withdrawal banner. Reviewed links for pack #1 (the 33 papers against the 68 subitems; methodology data only) as pack #1 2026.12.x or later | A repin and its revert are tested; pack #1 shows precise coverage |
| 4 | #28 | L | The EN 18286 + ISO/IEC 42001 pack as data, following section 12, plus its features: Statement of Applicability, nonconformity grading, certification recommendation | Q1 resolved; the #28 criteria pass |
| 5 | #29, #30 | S, M | NIST AI RMF 1.0 and AI 600-1 frameworks and crosswalks as a crosswalk-only pack (data and tests only). The NYC LL144 pack (data plus the computations of #30) | The packs validate; crosswalk targets exist; coverage cases pass |
| 6 | new | M | OSCAL catalog and mapping-collection export. Tenant default pack. Engagement-level link tailoring with approval. AIUC-1 after Q2. Tenant-authored packs, which would need a D1 table of immutable documents with the same schema and digests | Each item tested on its own |

Commit order for phase 1:

1. schema and validator;
2. converter and pack #1 data;
3. sync, bundle and loader;
4. pin and consumer refactor, with the equivalence tests;
5. pack selection;
6. coverage engine and view.

The refactor commit uses the module layout of #4 and #6 (`lib/factories.ts`, `lib/commands/*`, `lib/domain/*`), which merge before #27.

## 18. Open questions and risks

**Open questions** (each blocks the item named):

- **Q1. Standards licensing (blocks the #28 release).** Counsel to confirm that clause numbers plus our own titles of at most 80 characters, with no text, tables or figures, is acceptable for ISO/IEC and CEN-CENELEC standards in a commercial product. Also: whether stating the scope of a presumption of conformity in our own words is acceptable.
- **Q2. AIUC-1 (blocks R4.6).** Written permission from AIUC for identifiers, titles and AIUC's published crosswalks, and how quarterly releases may be redistributed.
- **Q3. CSA AI Controls Matrix (blocks the SOC 2 + AI mapping route).** The licence terms for commercial use.
- **Q4. Approvers.** Who may approve a release in the index:
  - framework documents for legislation need qualified legal review (decision D5 of the codebase review);
  - packs and crosswalks need the methodology owner;
  - two people for `legalEffect` entries?
- **Q5. Coordination with #18.** The name of #18's engagement-level rule-pack stamp, and whether #18 or #27 converts methodology 2026.11.1 into pack #1 2026.11.1.
- **Q6. Obligation records.** Should they count as direct coverage sources from phase 1? Proposed: yes.
- **Q7. Client-visible coverage.** Should clients see coverage in released reports, and which crosswalk views? Decide with #20 in phase 2.
- **Q8. EN 18286 facts.** The clause structure and the exact Annex ZA scope (Art. 17(1) and the first sentence of Art. 11(1), per secondary sources) must be confirmed against the purchased standard and Implementing Decision (EU) 2026/2274 before #28 encodes them.

**Risks:**

- **Phase 1 is large.** Mitigation: the commit order above, and moving M1, M2 and the obligation folding out of it.
- **Users may read "Partly covered" on day one as a regression** against the old 100% article bars. Mitigation: show papers signed (progress) and criteria coverage as separate measures, as the methodology already requires, and explain the migration note in the drawer.
- **Obligation data drifts from the framework until phase 2.** Mitigation: the consistency test in 11.3.
- **The bundle grows with every version.** Mitigation: the threshold in 14.3.

## 19. Sources

Checked on 5 November 2026 unless stated otherwise.

**Mapping and data standards**
- NIST IR 8477, *Mapping Relationships Between Documentary Standards, Regulations, Frameworks, and Guidelines*, Scarfone, Souppaya and Fagan, February 2024: [doi.org/10.6028/NIST.IR.8477](https://doi.org/10.6028/NIST.IR.8477) ([PDF](https://nvlpubs.nist.gov/nistpubs/ir/2024/NIST.IR.8477.pdf)). Text extracted from the PDF and read for sections 3 (use cases), 4.1 to 4.6 (the four styles, custom styles and Table 7) and 5 (mapping practice).
- OSCAL Control Mapping Model v1.2.1, JSON reference: [pages.nist.gov](https://pages.nist.gov/OSCAL-Reference/models/v1.2.1/mapping/json-reference/). Relationship, matching-rationale, provenance, qualifier and coverage fields.
- RFC 8785, JSON Canonicalization Scheme (JCS): [rfc-editor.org/rfc/rfc8785](https://www.rfc-editor.org/rfc/rfc8785).
- JSON Schema Draft 2020-12: [json-schema.org](https://json-schema.org/draft/2020-12). Not fetched; the repository's validators already use it.

**EU AI Act** (Commission AI Act Service Desk, which shows the EUR-Lex consolidated text of 27 July 2026)
- Implementation timeline: [ai-act-service-desk.ec.europa.eu](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act). Art. 50 from 2 August 2026; the 2 December 2026 Art. 50(2) transition; Annex III on 2 December 2027; Annex I on 2 August 2028.
- Articles [9 (navigation)](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-9), [16](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-16), [17](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-17), [50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) and [111](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-111): the headings in the sample, and Art. 111(4) (marked NEW).
- Commission Decision 2011/833/EU on the reuse of Commission documents: [eur-lex.europa.eu](https://eur-lex.europa.eu/eli/dec/2011/833/oj). The reuse wording was confirmed through mirrors, not the live legal notice.

**Standards**
- CEN-CENELEC, EN 18286:2026 published in the OJEU (15 October 2026): [cencenelec.eu](https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-10-15-en-18286-2026-published-in-ojeu/). Title, Implementing Decision (EU) 2026/2274, presumption for the corresponding Art. 17 provisions.
- Modulos, EN 18286 page (competitor-authored, secondary, last updated 19 October 2026): [docs.modulos.ai](https://docs.modulos.ai/frameworks/eu-ai-act/harmonized-standards/en-18286). Clause topics and the Annex ZA scope; unverified against the standard.
- ISO/IEC 42001:2023: [iso.org/standard/42001](https://www.iso.org/standard/42001). Edition 1, published 18 December 2023, JTC 1/SC 42 (search result; the page returned 403 to fetching). The top-level clauses were read from the DIN table of contents for DIN EN ISO/IEC 42001; subclauses 6.1.2, 6.1.4 and 8.2 are from secondary summaries.

**Licensing**
- AIUC-1: [aiuc-1.com](https://www.aiuc-1.com/) (quarterly releases, one-year version lock), [standard.aiuc-1.com](https://standard.aiuc-1.com/) ("all rights reserved"), [AIUC terms of service](https://aiuc.com/legal/terms).
- NIST copyright and use: [nist.gov/oism/copyrights](https://www.nist.gov/oism/copyrights).
- CSA AICM licensing FAQ: [cloudsecurityalliance.org](https://cloudsecurityalliance.org/artifacts/ccm-aicm-licensing-faq). Search result only; not read.
- NIST AI Resource Center crosswalks: [airc.nist.gov](https://airc.nist.gov/airmf-resources/crosswalks/). Search result only; not read.

**Repository** (`main@74c6463`, with Prettier-formatted `site-app` code from #1)
- `templates/catalog.json`, `templates/annex-iv-map.json`, `docs/obligation-subitems.json`, `docs/audit-methodology.md`;
- `site-app/lib/domain.ts`, `site-app/lib/workflow-types.ts`, `site-app/lib/workflow-state.ts`, `site-app/lib/workflow-seed.ts`, `site-app/lib/workflow-service.ts`;
- `site-app/lib/store.ts`, `site-app/lib/engagement-storage.ts`, `site-app/db/schema.ts`;
- `site-app/app/api/workspace/route.ts`, `site-app/app/api/management/route.ts`, `site-app/app/api/assurance/route.ts`, `site-app/lib/assurance-store.ts`, `site-app/app/workspace.tsx`.
- Internal planning documents of 5 November 2026 (not in the repository; #7 records them): the product direction brief, sections 1.5 and 2.3 and Theme 4 (R4.1 to R4.7); the codebase review, decisions D2 (stay on D1) and D5 (qualified legal review of legal content) and findings F-50 and F-51.
