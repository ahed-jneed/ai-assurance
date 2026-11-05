# Design: multi-framework criteria model with typed crosswalks

| | |
|---|---|
| Issue | #26 (design). Phase 1 is implemented by #27. |
| Status | Draft for review, 5 November 2026; revised the same day after the independent review on PR #45 |
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
3. **The existing catalogue becomes pack #1, "EU AI Act (amended)", without loss.** A deterministic converter produces the pack and its framework from `templates/catalog.json` and `docs/obligation-subitems.json`. Tests prove that the pack projects back to the catalogue and the framework back to the whole obligation file exactly. Existing engagements have no pin. At read time they resolve to the pack #1 version whose content the build before #27 served them, which depends on what #18 does (section 11.4), and nothing is written to them.
4. **AI-Act-only behaviour becomes pack data.** The AI Act risk classification and its gates, obligation-subitem assessments, the Annex IV index and the report snapshot's regulatory source and limitations follow the pinned pack's `features` and `reporting` (section 7.1). An EN 18286 + ISO/IEC 42001 engagement therefore needs no AI Act classification to reach Fieldwork.
5. **One relationship vocabulary everywhere.** Control objectives link to requirements, and crosswalks link requirements across frameworks, with the NIST IR 8477 set theory relationships (`equal`, `subset_of`, `superset_of`, `intersects_with`, `no_relationship`) and a rationale (`syntactic`, `semantic`, `functional`). Coverage is therefore one algorithm.
6. **Coverage never shows partial as full.**
   - A requirement is *covered* only through a chain of full-strength links (`equal` or `superset_of`) in released documents, from a reviewed, signed and *supported* conclusion.
   - Nothing contrary may be related to it: no exception, no qualified conclusion, no open work and no unresolved finding on any related source.
   - Readiness conclusions give "Covered (readiness)", never an applicable-law "Covered".
   - Partial contributions never add up to full. Crosswalks are not transitive. Exceptions, qualifications and open work propagate conservatively. Links migrated from the catalogue claim partial overlap only.
   - Section 9 defines the eight cell states, the algorithm and a 49-case truth table. A reference prototype passed all 49 cases and 30,000 randomised weakening checks.
7. **Licensing is data.** Each framework declares its text policy (`full_text`, `paraphrased_titles` or `identifiers_only`) and whether that position is confirmed. The schema forbids stored text and long titles for ISO and CEN-CENELEC standards, and the validator blocks release while a licence is unconfirmed. AIUC-1 stays out until AIUC grants a licence.
8. **Loading follows #3.** The canonical documents are copied into `site-app` at build time by the #3 sync script, as one generated bundle checked in CI. A server-only loader serves projections to the client.
9. **Six phases.** Phase 1 is one pull request (#27): data model, validation, loader, the pack #1 migration, the pack features, pack selection and the coverage view. Phases 2 to 6 are listed in section 17.

## 2. Context: what exists today

| Asset | Content | Consumers |
|---|---|---|
| `templates/catalog.json` (copied to `site-app/lib/catalog.json`) | Methodology 2026.10.1: 45 items (33 working papers, 12 memos), 168 procedure steps, 38 distinct `regulatoryRefs` strings such as `Art.9` and `Annex IV`, a `regulatorySnapshot` with three coarse application dates, and `defaults` | `templatePaper` and `freshEngagement` (`lib/store.ts`, `lib/factories.ts` after #4); `seedWorkflow` (`lib/workflow-seed.ts`); `GET /api/workspace`, which returns the whole catalogue to internal roles; the Methodology view, the paper modal and `lib/workspace-search.ts` in the client |
| `templates/annex-iv-map.json` | Nine Annex IV sections, each with the catalogue `paperIds` that feed it | `createReport` in `app/api/workspace/route.ts` compiles an Annex IV index into every report snapshot |
| `docs/obligation-subitems.json` | 68 selective obligation prompts (Arts 9–15, 23–26, Annex IV) with actor, trigger profile and evidence categories; 8 trigger profiles; 16 fact types | The `obligation` assurance records in `app/api/assurance/route.ts` and the assurance workbench |
| Hard-coded criteria in code | `articleNames` (Arts 9–15) and an article regex in the "Article-to-evidence mapping" panel, which shows signed papers per article as a percentage; template ids `MEM-EX-01`, `WP-A10-02` and `WP-A15-01` in the workspace and assurance routes; legal snapshot strings in `lib/store.ts` and `app/workspace.tsx` (#18 removes these) | |
| AI Act behaviour that applies to every engagement | `freshEngagement` creates an AI Act `classification` (version `02024R1689-20260727`). `completionGates` blocks every report until it is approved, and `stageGates` blocks the move from Planning to Fieldwork on it. `createReport` writes a fixed `regulatorySource` (the AI Act ELI) and a limitations sentence about notified bodies, and always compiles the Annex IV index. `assurance-workbench.tsx` and the assurance route import `obligation-subitems.json` directly | Section 7.1 makes each of them pack data |

How engagements use the catalogue today, which constrains the design:

- An engagement is one JSON aggregate in D1 (`engagements.body`, at most 1.5 MB). Every save also writes a full copy to `engagement_snapshots` and a hash-chained `audit_events` row. Large immutable parts go to R2 through `lib/engagement-storage.ts`. The roadmap decision on persistence (D2 of the codebase review of 5 November 2026) is to stay on this model.
- `seedWorkflow` *copies* each working paper's title, objective, steps, evidence list and references into a workflow `Procedure` (`PROC-<templateId>`). `templatePaper` copies the title, `articleRefs`, guidance and criteria text into a `Paper`. Seeded records are therefore decoupled from later catalogue edits.
- But `templatePaper(templateId)` is resolved against the *current* catalogue whenever a paper is created later: `ensureProcedurePaper`, `submitProcedure`, `createPaper`, the limitation memo of an evidence request, and the diagnostic and external-run papers. The catalogue content each existing engagement is served (that of `main@74c6463`, or after #18 possibly 2026.11.1) must therefore stay resolvable for that engagement for as long as it exists.

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
| Requirement reference | `<framework-id>:<requirement-id>`. The edition comes from the containing criteria set or crosswalk. A pack has at most one criteria set per framework id (rule 4 of section 14.2), so a reference resolves to exactly one node | `eu-ai-act:AIA-9-1` |
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
- **`compat.obligations`:** only on frameworks converted from the obligation catalogue. It keeps the file's other top-level fields verbatim (`schemaVersion`, `catalogVersion`, `status`, `scope`, `source`, `applicationContext`, `decisionPolicy`, `triggerType`, `evidenceCategories`) and `order`, the item codes in file order. The codes in `order` are the obligation subitems that an obligation assessment may cite. Per-item fields without a framework equivalent (`legalSource`, `version`, `dependencies`, `specificDocumentRequired`, `categoryMatchIsInsufficient`) go under the node's `extensions`.
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
- **`features`:** AI Act behaviour that applies only when the pack switches it on (section 7.1): `annexIvIndex` (the Annex IV index in report snapshots), `aiActClassification` (the risk classification, its commands and its gates) and `obligationAssessments` (obligation-subitem assessments). Absent means off.
- **`reporting`:** the report snapshot's `limitations` text and, for packs whose criteria are legislation, its `regulatorySource`. Required for audit programmes. For pack #1 both are today's constants from `createReport`.
- **`defaults`:** the catalogue's methodology defaults.
- **`compat.catalog`:** only on packs converted from the catalogue. It holds `schemaVersion` and the verbatim `regulatorySnapshot`, so that the legacy projection (section 11.3) is exact.
- **`crosswalks`:** only on crosswalk-only packs. Such a pack offers a framework that no audit programme uses as criteria, for example NIST AI RMF (#29), as a coverage view (section 9.6). It contributes no sources and no links, and it cannot be selected at engagement creation. `crosswalks` lists the crosswalk versions released with the pack. It does not pin the view: the view always uses the current version of each crosswalk.

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
   - The current version of a pack or crosswalk is its highest released, non-withdrawn version.
   - Withdrawal means the methodology owner no longer stands behind the document; a newer version alone does not withdraw an older one. It blocks new pins.
   - Engagements pinned to a withdrawn pack, or to a pack whose framework data version was withdrawn, keep working: their templates resolve and their recorded work does not change. Their coverage is capped at "Partly covered" by the clamp of section 9.2, and the view and the drawer show the withdrawal date and reason. The remedy is a reviewed move to another pack version (M2, phase 3).
   - A withdrawn crosswalk version is never used, because views use only current versions (section 9.6).
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
| Obligation assurance records | Their `code` is an AI Act requirement id, so they are direct requirement-level assessments in coverage (section 9.1). Only with `features.obligationAssessments` (section 7.1) | `AIA-9-1` and the other 67 codes resolve unchanged |
| Findings | Phase 1: an unresolved finding linked to a procedure or paper makes that source `open` in coverage (section 9.1). `Finding.article` stays free text and is never parsed. Phase 2: optional `criteriaRefs` (requirement references), defaulted from the item of `support.procedureId`, so #20 can roll results up by criterion | Unchanged data |
| Tailoring (phase 6) | Engagement-level link overrides with rationale and Lead approval | n/a |

`Result.article` from the diagnostics engine stays as it is; `roles.diagnosticPaperByResultArticle` maps it to a template.

**`Finding.article` and `criteriaRefs`.** `article` is a required free-text field ("Art. 10(2)(f)", or anything the auditor types), shown in the registers and reports. Coverage never infers a requirement from it, because free text cannot be resolved reliably. In phase 2 the finding form fills `article` from the display refs of the selected `criteriaRefs`, so the two agree for new findings; existing findings keep their text and get no `criteriaRefs`. Coverage then places an unresolved finding that has `criteriaRefs` but no procedure or paper link directly on those requirements, as an `open` contribution.

### 7.1 AI Act behaviour that becomes pack data

On `main`, the behaviour below applies to every engagement whatever its criteria. Each item becomes a pack feature or pack data; pack #1 switches every feature on, so AI Act engagements behave as today.

| Behaviour on `main` | Rule with the criteria model | Pack #1 | Phase |
|---|---|---|---|
| `freshEngagement` writes an AI Act `classification` with `version: "02024R1689-20260727"` and `asOf: "2026-10-05"` | Still written for every engagement, so that every build, older ones included, can read every aggregate. `version` and `asOf` come from the pinned AI Act framework (`edition`, `researchedAsOf`), and are empty for a pack without an AI Act criteria set. Without `features.aiActClassification` the object is inert: no gate, panel, card or snapshot reads it | Identical | 1 |
| `completionGates` adds the classification-approval gate and, for a readiness opinion, the prohibited-practice gate; `stageGates` blocks Planning → Fieldwork until the classification is approved, and the moves to Reporting and Sign-off through `completionGates` | Only with `features.aiActClassification` | `true`, identical | 1 |
| `classify` and `approveClassification` commands; the classification panel of the Regulatory mapping view, the "Assess classification" card of the engagement overview and the gate labels | Without the feature, the commands answer 409 "This criteria pack has no AI Act classification", and the panel and card are hidden | Unchanged | 1 |
| Report and client snapshots carry `engagement.classification`, and `releaseReport` compares it with the engagement | Carried and compared only with the feature | Identical | 1 |
| `obligationDecision` and `reviewObligation` in the assurance route; the obligation panel and form of `assurance-workbench.tsx` | Without `features.obligationAssessments`, the commands answer 409 "This criteria pack has no AI Act obligation assessments" and the panel is hidden. Phase 1 keeps validating `code` against the build's `obligation-subitems.json` and writing its `source.url` and `catalogVersion`, so M0 holds (section 11.4); coverage counts a record whose code the pinned framework lacks as unusable (section 9.1). Phase 2 validates against the obligation subitems of the pinned framework (`compat.obligations.order`), writes that framework's values and serves the workbench its options from the API | `true`, identical | 1 (gating), 2 (source) |
| `createReport` writes `regulatorySource: "https://eur-lex.europa.eu/eli/reg/2024/1689"` and the notified-body `limitations` sentence | Taken from `pack.reporting`; without `regulatorySource` the snapshot has no such field (no renderer reads it) | Today's two values, written by the converter | 1 |
| `createReport` always compiles the Annex IV index | `features.annexIvIndex` (row above) | `true` | 1 |

The converter writes all of this into pack #1 2026.10.1 and its framework in phase 1, including what only phase 2 reads, such as the obligation catalogue in `compat.obligations`. Released documents are immutable, so data missing from them could only come back as a new version.

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

Each source has a *state* (`supported`, `qualified`, `not_supported`, `open`, `excluded`, `not_applicable`) and a `readiness` flag. `readiness` is true when the conclusion was reached before the provision applies; such a result is never shown as an applicable-law result.

- **Structured engagements (with `workflow`), one source per procedure:**
  - `not_applicable` when its applicability is `not_applicable`, selected or not;
  - `excluded` when it is otherwise not selected;
  - concluded when it is `reviewed`, its execution is current (`currentExecution`), it has a review and its paper is signed at `paperRevision`. The state is then the assessment outcome: `supported`, `qualified` or `not_supported`;
  - `open` otherwise, including applicability `pending`.

  `readiness` is true when applicability is `readiness`. When the program is not approved, the proposed scope is used and the view shows a banner.
- **Engagements without a workflow, one source per paper that is required or records a not-applicable conclusion** (the set `completionGates` checks today):
  - signed with a conclusion status of `supported`, `qualified` or `not_supported`: that state;
  - signed `not_applicable`: `not_applicable`;
  - anything else: `open`.

  Supplementary papers (`required: false` and not N/A) are not sources. A paper records no applicability, so `readiness` is true for every paper source: the view can then understate, never overstate. It shows the banner "This engagement records no applicability per paper, so its results are shown as readiness (R)".
- **Direct requirement assessments, one source per current (not superseded) obligation record**, only when the pinned pack has `features.obligationAssessments`:
  - `open` without a confirmed review, with `needs_information`, or with outcome `unassessed`;
  - `not_applicable` when confirmed not applicable;
  - otherwise the outcome mapped `supported` → `supported`, `qualified` → `qualified`, `unsupported` → `not_supported`.

  `readiness` is true when the record's applicability is `readiness`. Arts 9 to 15 apply from 2 December 2027 or 2 August 2028 (section 19), so today most such records are readiness assessments. The record links its code with relationship `equal`. A record whose code is not an obligation subitem of the pinned framework (`compat.obligations.order`) cannot be placed: it is counted as unusable and listed in the view's notes, never dropped silently. In phase 1 this happens only when the build's obligation file has codes that the pinned data version lacks (section 7.1).
- **Unresolved findings.** An in-scope source (not `excluded` or `not_applicable`) with a linked finding whose status is not `closed` counts as `open`, whatever its conclusion, unless it is already `not_supported`: the matter is not concluded while a deficiency found by that work is being remediated or retested. A finding is linked to a procedure source when `support.procedureId` is that procedure or `support.paperIds` contains its paper, and to a paper source when `support.paperIds` contains that paper. The drawer names the finding and its severity. Findings with no such link are not placed in phase 1; the view's notes count the unresolved ones.
- **Memos** are decision records and never sources.

### 9.2 Link strength

- `equal` and `superset_of` are **full**; `subset_of` and `intersects_with` are **partial**; `no_relationship` contributes nothing. Links with rationale `syntactic` never contribute (section 8).
- Two clamps reduce full to partial:
  - links with `origin: migrated` (the schema already forces them to `intersects_with`);
  - every link whose chain contains a document that is `draft` or `withdrawn` in the index: the pack or crosswalk that holds the link, and the framework data version it targets. Obligation records are clamped when their framework data version is not released. So draft data never shows "Covered", and neither does data its owner has withdrawn (section 6.6); the view says which document caused the clamp.
- When one source reaches the same requirement through the same objective more than once (one link per rationale), the weakest strength wins.

### 9.3 Placement and propagation

A contribution is placed on the node its link targets.

- **On a `requirement` node** it is direct.
- **On a `group` node** it is recorded at group level, and it reaches every descendant (requirements and nested groups) as a contribution when:
  - its strength is **full**: `o ⊇ group ⊇ child`, so the claim holds for the child; or
  - its state **blocks** coverage (`not_supported` or `open`), whatever the strength, because a deficiency or open work related to the group may concern any child.
- A **qualified** contribution of partial strength on a group reaches every descendant as a **cap**. Its "except for" part may concern any child, so a capped descendant cannot be `full`. A cap is not evidence: a descendant whose only inheritance is a cap is still `parent_only`. (A full-strength qualified contribution reaches the descendants as a contribution by the first rule.)
- A partial, supported contribution on a group makes no claim about any one child. Descendants that have no contribution of their own become `parent_only`.

The blocking rule came out of the prototype's property test. Without it, weakening a link from `superset_of` to `subset_of` stopped a deficiency from reaching the children, so they could show "covered": a weaker claim produced a stronger display. The cap follows the same reasoning for qualified conclusions: without it, the same weakening would lift a qualification off the children.

### 9.4 Cell state

```text
cellState(C, K, parentOnly):         C = contributions placed on one node; K = caps it inherits
  if C is empty:                     return parentOnly ? parent_only : unmapped
  S = C without excluded and not_applicable contributions
  if S is empty:                     return any not_applicable in C ? not_applicable : excluded
  if any c in S is not_supported:    return exception
  if any c in S is open:             return open
  F = the full-strength, supported contributions in S
  if F is not empty, K is empty and no c in S is qualified:
                                     return full,    readiness = every c in F is readiness
  otherwise:                         return partial, readiness = every c in S is readiness
```

| State | Label | Meaning |
|---|---|---|
| `full` | Covered, or Covered (readiness) | A full-strength chain from a supported, reviewed conclusion, with no related exception, qualification, open work or unresolved finding |
| `partial` | Partly covered, or Partly covered (readiness) | Related concluded work, but only partial links, or a related conclusion is qualified |
| `exception` | Exception in a related source | A related source concluded "not supported". The requirement itself may or may not be deficient; the drawer shows which source |
| `open` | Open | Related work is in scope and not yet concluded, or has an unresolved finding |
| `parent_only` | Mapped at a higher level only | A parent has a partial mapping; nothing is claimed for this requirement |
| `unmapped` | Not mapped | No link. Not a gap and not a pass |
| `excluded` | Excluded from scope | Every related source is outside the agreed scope |
| `not_applicable` | Not applicable | Every related in-scope source was approved not applicable |

**Readiness.** Readiness results are never displayed as applicable-law results, and a readiness result always carries "(R)":

- **`full`.** The flag is computed over F only, the contributions that are full on their own. "Covered" therefore always rests on at least one applicable-law conclusion that is full on its own. A partial applicable-law link next to a full readiness one gives "Covered (readiness)" (case 35), because the applicable-law evidence covers only part of the requirement.
- **`partial`.** The flag is set when every contributing conclusion is readiness; one applicable-law contribution makes the partial claim an applicable-law one.

**Qualified conclusions.** A qualified ("except for") conclusion related to a requirement through any relationship caps the cell at `partial`, even next to a full supported link (cases 39 and 40). The exception may concern the requirement, the same reasoning that sends blocking states to every child of a group. Capping only full-strength qualified sources would break invariant 3: weakening such a link from `superset_of` to `intersects_with` would turn the cell from partial into "Covered". The product's gates already treat a qualified conclusion as not supporting a readiness opinion (`completionGates`, `assuranceGates`).

### 9.5 Groups

A group row shows:

- counts by state over its requirement descendants;
- its group-level contributions, summarised with the same cell function (the group-level summary);
- a roll-up state, which can only be `full`, and only when `exhaustive` is true and every descendant is `full` or `not_applicable` with at least one `full`. The roll-up is readiness when any of those `full` descendants is.

Otherwise there is no single group colour, only the counts. A selective child list proves nothing about the parts of the group it does not list. A full-strength link on the group itself is different: it claims the whole group, which is why its summary can be `full` and why it reaches every child (invariant 5).

### 9.6 Crosswalk view

**Views offered.** For an engagement whose pinned pack has criteria editions A1…An:

- one *criteria view* per criteria set of the pack, primary sets first, at the pinned data version. Only the pack's own links and the engagement's obligation records contribute, so which links count depends on the pin alone;
- one *crosswalk view* per framework edition T that:
  - is not a criteria edition of the pinned pack;
  - is the criteria of some current pack, an audit programme or a crosswalk-only pack (the methodology owner's choice of which frameworks are worth offering); and
  - is connected to some Ai by at least one current crosswalk, in either direction.

**Versions used by a crosswalk view.**

- **T** is read at the latest released, non-withdrawn data version of its edition. Rule 3 of section 14.2 keeps every earlier requirement id in later data versions, so entries written against an earlier data version still resolve.
- **Crosswalks** are read at the current version of each crosswalk id between some Ai and T. That version wins, also over the version a crosswalk-only pack lists, which only records what was released together.
- **The A side** is the engagement's criteria views at their pinned data versions. An entry whose A endpoint is missing from the pinned data version is skipped and counted (section 6.4).
- The view header names T's data version and each crosswalk version used; issued report snapshots stamp them (phase 2). A live crosswalk view therefore follows a new crosswalk release on the next read. That is intended: a crosswalk view interprets the evidence, and only the criteria views are the engagement's stated criteria.
- A crosswalk view never says that T applies to the client: it shows how evidence on the engagement's criteria relates to T. Its banner says so, and tiles of requirements with `applicability` rows show their dates.

**Steps.** To show T:

1. **Select crosswalks** as above. Keep entries whose rationale is `semantic` or `functional`. Orient each entry Ai → T, inverting single-source entries authored T → Ai and dropping multi-source ones in that direction.
2. **Weakest wins.** For each (sources, target) pair, keep the weakest strength.
3. **Source endpoint states.** For each A-side source, use its cell state in the criteria view, and treat `unmapped` and `parent_only` as no evidence. An endpoint carries the cell's readiness flag, and a `qualified` mark when it is `partial` because of a qualified contribution or a cap. For a group endpoint G, take G's group-level summary and the cells of its requirement descendants:
   - `exception` if any of them is an exception;
   - otherwise `open` if any is open;
   - otherwise `full` if every requirement descendant is `full` or `not_applicable`, with at least one `full`, and either G is `exhaustive` (the roll-up) or G's group-level summary is `full` (a full link on G itself, invariant 5). It is readiness unless the summary is an applicable-law `full` or, for an exhaustive G, every `full` descendant is applicable-law;
   - otherwise `partial` if any is covered or partly covered: readiness when all of those are, `qualified` when any of them is;
   - otherwise `not_applicable`, `excluded` or no evidence, in that order.
4. **Compose one contribution per entry:**
   - `not_supported` if any source endpoint is an exception;
   - otherwise `open` if any is open;
   - otherwise, if no source endpoint has evidence: nothing when every endpoint has no evidence at all, else `not_applicable` when any is not applicable, else `excluded`;
   - otherwise `qualified` if any endpoint is marked `qualified`, else `supported`.

   The strength is full only when the relationship is full-strength **and every source endpoint is `full`**; otherwise partial. The contribution is readiness when any source endpoint used is readiness-only (case 47).
5. **Place and evaluate** the contributions on T with sections 9.3 to 9.5.
6. **Report the remainder:** the number of unusable entries (syntactic, non-invertible, unresolved) appears in the view.

### 9.7 Invariants (tested)

1. A cell is `full` only through a chain of full-strength, released links from a supported, reviewed conclusion, and applicable-law `full` (without "(R)") only when that chain starts from an applicable-law conclusion.
2. Partial contributions never combine into `full`, through several objectives, several crosswalk entries or several rationales.
3. A weakening never turns a cell, a group endpoint or a roll-up into `full`, nor into applicable-law `full`, so it never increases either count. A weakening is: replacing a relationship with one of lower strength that still relates the two (for example `superset_of` to `intersects_with`); a clamp (migrated, draft, withdrawn); a supported conclusion becoming qualified; a conclusion becoming not supported or open; a new unresolved finding; or an applicable-law conclusion becoming readiness. This is property-tested. Removing a relation (`no_relationship`, or a syntactic-only entry) is not a weakening: it can legitimately remove an exception, because the reviewer has decided that the source is unrelated.
4. No transitivity across crosswalks.
5. A group is `full` only through an exhaustive roll-up or a full link on the group itself, as a crosswalk endpoint too (cases 31 and 48).
6. `unmapped` is never counted as an exception or as covered.
7. Legal effects (presumption of conformity) are badges and never change a state.
8. Summaries are counts by state with the denominator, with readiness results counted separately and never added to applicable-law counts. If a percentage is shown, it is "fully covered: n of N"; partial is never added to it.

### 9.8 Golden truth table

These are the phase 1 Vitest cases. A scratch reference implementation of sections 9.1 to 9.6 passed all 49. It also passed 30,000 randomised weakenings of invariant 3 (three seeds of 10,000 scenarios, 1,023,133 cell, endpoint and roll-up checks), over random trees with nested and exhaustive groups, random sources, links and crosswalk entries in both directions. Cases 1 to 34 are those of the first draft; 35 to 49 were added after the review. Under the first draft's rules, 35, 39 to 41, 43 and 46 to 49 fail. The property test also showed that the cap of section 9.3 is needed: without it, clamping a qualified group link lifts the qualification off the children. "Readiness source" means a conclusion with applicability `readiness`; every other source is applicable-law.

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
| 12 | obligation record confirmed supported, applicability `applicable` | full |
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
| 35 | `equal` link from a supported readiness source, plus `intersects_with` from a supported applicable-law source | full (readiness) |
| 36 | `equal` link from a supported readiness source, plus `superset_of` from a supported applicable-law source | full |
| 37 | obligation record confirmed supported, applicability `readiness` | full (readiness) |
| 38 | engagement without a workflow: signed supported paper, full link | full (readiness), with the "no applicability per paper" banner |
| 39 | `equal` link supported, plus `superset_of` link whose source is qualified | partial |
| 40 | `equal` link supported, plus `intersects_with` link whose source is qualified | partial |
| 41 | `intersects_with` group link whose source is qualified; the child has its own full supported link | child partial (cap) |
| 42 | `intersects_with` group link whose source is qualified; the child has no link of its own | child parent_only (a cap is not evidence) |
| 43 | full link supported, the source has an unresolved linked finding | open |
| 44 | as 43, with the finding closed | full |
| 45 | `superset_of` link in a withdrawn pack | partial (clamped), with the withdrawal banner |
| 46 | crosswalk A→T `superset_of`, A cell full (readiness) | T full (readiness) |
| 47 | joint sources `superset_of`, every source full, one of them readiness | T full (readiness) |
| 48 | non-exhaustive A group with its own `superset_of` link from a supported source, used as a source with `equal` | T full |
| 49 | A cell partial because of a related qualified source, crosswalk `superset_of` to T, plus another full A→T entry for the same T requirement | T partial (the qualification travels) |

### 9.9 What pack #1 shows on day one

Migrated links are partial and point at article nodes, because the catalogue only says which article a paper relates to. In an AI Act engagement:

- the 26 article-level leaves can reach at most "Partly covered";
- the 68 obligation subitems show "Mapped at a higher level only", unless an obligation record assesses them directly. Most such records are readiness assessments today, because Arts 9 to 15 apply from 2 December 2027 or 2 August 2028, so they show "Covered (readiness)" at best.

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
  - `GET /api/workspace` adds `criteria` (pin, origin, pack title and kind, `features`, frameworks with short titles, and a `withdrawn` flag). It adds `selectablePacks` for practice administrators. The client shows or hides the classification and obligation panels from `features`.
  - Its `catalog` field becomes `legacyCatalog(pinned pack)`, or the default pack's projection when no engagement is selected. The client type `WorkspaceData.catalog` and every client use of it stay unchanged. For a pack without `compat.catalog`, `legacyCatalog` returns `schemaVersion: "1.0.0"` and `regulatorySnapshot: {}`, which the type already allows; the client hides the regulatory-basis panel when the snapshot is empty.
  - New `GET /api/coverage?tenantId&engagementId` returns the views offered (section 9.6). With `&framework=<id>@<edition>` it returns `{pin, framework, versions, programApproved, summary, groups, cells, crosswalks, unusableEntries, notes}`. Each cell lists its contributions with the evidence chain (source id, template, paper id and revision, reviewer, conclusion, applicability, linked findings) and the link path (objective, relationship, rationale, inherited-from group or cap, crosswalk entry). `notes` counts unusable obligation records and unplaced unresolved findings.
  - The coverage endpoint is computed on demand from one aggregate (findings included), the pinned documents and at most 1,000 assurance records, all of which the route already loads for gates. Internal roles with engagement access may call it. Client roles get 403 in phase 1.
- **Commands.**
  - `createEngagement` accepts optional `packId` and `packVersion`. The version must be released, selectable, not withdrawn and backed by confirmed licences; otherwise it answers 400 "Choose a released criteria pack".
  - The management event details record the pack.
- **Report snapshots** gain `criteria: {packId, packVersion, packSha256}` (phase 1), and `releaseReport` adds the pin to the source records it compares with the capture, so that a pin moved between capture and release (M2), even one that changes only links, forces a new capture. Phase 2 adds framework and crosswalk stamps and, with #20, coverage by criterion.

## 11. Migration of the existing catalogue (pack #1)

### 11.1 Inputs

The conversion reads the files as committed at `main@74c6463`. Digests are of the LF blobs (`git show 74c6463:<path> | sha256sum`):

| File | Role | sha256 |
|---|---|---|
| `templates/catalog.json` | programme, regulatory snapshot, defaults | `10a75f63d82e9cee1dc5ed13d15d2a20208cc67c8986a076a77c40fbfdc0857e` |
| `docs/obligation-subitems.json` | subitem requirements, trigger profiles, fact types | `ab3a4de0c874451785351f17e1cf9a188621455a70df375bd202b90d585ef08d` |
| `templates/annex-iv-map.json` | stays a separate file in phase 1; its `paperIds` must exist in pack #1 | `a814641f56834ce0298d022676c1001fd6b335d3578c6d2e6c8d5d16147d1623` |

#27 depends on #18 (rule pack 2026.11.1), so the converter runs twice: on these files, giving pack #1 and framework data version 2026.10.1, and on the files as #18 merges them, giving 2026.11.1. Both versions are released together and kept. The 2026.11.1 run also maps #18's per-provision dates to `applicability` rows; #27 fixes that rule once #18's format is known.

### 11.2 Converter rules

`templates/criteria/tools/convert-catalog.mjs` is deterministic. A scratch prototype of these rules converted the whole catalogue and obligation file at `74c6463`. The result validates against the draft schema, and the sample fixture is its restriction to three items.

1. **Framework document.**
   - Identity: `id: eu-ai-act`, `edition: regulatorySnapshot.celex`, `version: methodologyVersion`.
   - Fixed values: the title shown in the fixture, `shortTitle` "EU AI Act (amended)", `kind: legislation`, publisher "European Union", `jurisdiction: EU`, `status: in_force`.
   - Copied from the snapshot: `consolidatedAsOf`, `researchedAsOf`, `amendingActs: [amendingRegulation]`, and sources from its four URLs plus the obligation file's `source.url` (role `consolidated_html`).
   - Licence: as in section 13. `applicationSummary` and `guidance` are copied verbatim.
   - `triggerProfiles` and `factTypes` are copied verbatim from the obligation file. The sample keeps only those its requirements use.
   - `compat.obligations` gets every other top-level field of the obligation file verbatim (`schemaVersion`, `catalogVersion`, `status`, `scope`, `source`, `applicationContext`, `decisionPolicy`, `triggerType`, `evidenceCategories`), and `order`: the 68 codes in file order. The order is needed because the file lists the Annex IV items before those of Arts 23 to 26, while the tree puts articles first and annexes last.
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
   - `legalSource`, `version`, `dependencies`, `specificDocumentRequired` and `categoryMatchIsInsufficient` go under `extensions`, so that no item field is lost. The assurance route writes `version` into every obligation record as `sourceVersion`.
   - `parent`: the article given by the leading number of `article`, or `AIA-ANNEX-IV`.
   - Provenance: the obligation source URL, `verification: unverified` and `legalReview: required`, because the obligation file is `proposed_for_methodology_review`.
4. **Pack document.**
   - Identity: `id: eu-ai-act-amended`, `version` and `methodologyVersion` set to the catalogue's methodology version, `title` "EU AI Act (amended)", `kind: audit_programme`.
   - One primary criteria set pointing at the framework above. `defaults` verbatim; `compat.catalog` holds `schemaVersion` and `regulatorySnapshot` verbatim.
   - `roles: {limitationMemo: "MEM-EX-01", diagnosticPaperByResultArticle: {"10": "WP-A10-02", "*": "WP-A15-01"}, externalExecutionPaper: "WP-A15-01"}`, `features: {annexIvIndex: true, aiActClassification: true, obligationAssessments: true}` and `reporting: {regulatorySource: "https://eur-lex.europa.eu/eli/reg/2024/1689", limitations: "Diagnostic and assurance conclusions do not constitute a notified-body conformity assessment or legal certification."}`. These mirror today's route code (section 7.1).
5. **Control objectives.**
   - One per working paper, in catalogue order: `CO-<item id>`, with `statement` set to the item's `objective`.
   - One link per catalogue ref to its article node: `intersects_with`, `semantic`, `origin: migrated`, with the fixed justification shown in the fixture.
   - Working papers without refs (for example WP-PL-01) get an objective with no links. It does not affect coverage.
6. **Items.** Every catalogue item verbatim and in order, plus `objectiveIds`: `[CO-<id>]` for working papers, `[]` for memos.
7. **Output.** Two-space indented JSON, keys in the order above, LF line endings. The index entries are added by hand after review.

### 11.3 Lossless guarantee

Golden tests for #27:

- **Catalogue projection.** `legacyCatalog(pack)` returns `{schemaVersion: compat.catalog.schemaVersion, methodologyVersion, regulatorySnapshot: compat.catalog.regulatorySnapshot, defaults, items}` with `objectiveIds`, `phase` and `derivedFrom` removed from each item. For pack #1 version 2026.10.1 it must deep-equal the parsed catalogue at `74c6463`. Commit that file as `schemas/fixtures/catalog-2026.10.1.json` and assert its LF sha256, because #18 changes `templates/catalog.json`. Version 2026.11.1 is checked the same way against #18's catalogue, committed as `catalog-2026.11.1.json`. The prototype passed this check for the whole catalogue: item order, every field and key order.
- **Obligation projection.** `obligationCatalog(framework)` returns the fields of `compat.obligations` (without `order`), `triggerProfiles`, `factTypes` and `items`: one item per code in `order`, projected from its node (`code`, `article` from `ref`, `title`, `actor`, `trigger`, `evidenceCategories`, `reviewNote` and the `extensions`). For data version 2026.10.1 it must deep-equal the whole obligation file at `74c6463`, item order included, and 2026.11.1 the file #18 merges. The prototype passed this check on the whole file, key order included. Phase 2 generates `obligation-subitems.json` from the framework and makes the framework canonical.
- **Seeding and paper templates, per legacy class.** The fixtures are captured from the build just before the #27 refactor, which includes #18. They are captured once per legacy class: engagements without #18's stamp, and each stamp value #18 writes. For each class, with a fixed user id and time:
  - the new `seedWorkflow(pack, …)`, for the pack version that `legacyPin` gives that class, deep-equals the captured `seedWorkflow` output;
  - for every item id, the new `templatePaper` deep-equals the captured one, with `id` and `now` stubbed.

  A class whose captured output matches no pack #1 version blocks the deploy (section 11.4).

### 11.4 Open engagements: explicit and reversible

| Step | When | What happens to an open engagement | How to reverse it |
|---|---|---|---|
| M0. Read-time legacy pin | Phase 1 deploy | Nothing is written. `pinOf(e) = e.criteria?.pin ?? legacyPin(e)`. `legacyPin` reads #18's engagement stamp and maps its value through `index.legacy.stamps`; an engagement without the stamp gets `fallbackVersion`. Both are index data that #27 sets, once #18 has merged, to the pack #1 version whose content the build before #27 serves that class (below). All behaviour is unchanged because each class resolves to a pack version that projects to exactly the catalogue it was served (section 11.3) | Redeploy the previous build. No data changed |
| M1. Explicit legacy pin | Phase 2, run by a practice administrator per engagement or per tenant | A `pinCriteria` command writes `criteria` with `origin: legacy` and the same resolved pin, through the normal compare-and-swap save. That adds an audit event, a snapshot row and a version bump. Behaviour is identical; the pin becomes visible in the stored aggregate | `unpinCriteria`, allowed while `origin` is `legacy` and `history` is empty, removes the field and records an event. Snapshot rows are append-only and stay |
| M2. Move to a newer pack version | Phase 3, Lead Auditor, per engagement | `repinCriteria` shows a diff (items, steps, objectives and links added, removed or changed). Before writing anything it checks the revision limit of every procedure it would change (`recordHistory` answers 413 at 30 entries); if one is at the limit it answers 413, names it, and nothing changes, and the remedy is today's: a follow-up engagement. On confirmation it records the old pin in `history`. Each procedure whose template content changed (title, objective, steps, evidence, references) gets a history entry and the new content as a new revision, so the existing rules require a new execution and review. Link-only changes touch no procedure, because links are derived from the pin. An approved program returns to draft through the existing `programDraft` path if any selected procedure changed. New items are added unselected. Issued reports never change | `revertCriteriaPin` restores the previous pin, while no procedure has been executed or reviewed under the new pin. For each changed procedure it restores the plan, execution, review and paper reference from its history entry. A history entry does not store the template content, so revert re-derives it from the item of the previous pin. That is exact, because template content cannot be edited per engagement: the plan commands change plan fields only. After that, roll back by moving forward to another pin; history is kept |

**Setting the legacy rule (M0).** The build just before #27 includes #18, and what it serves to engagements created before #18 decides the rule. #27 finds out by reading #18's code and by capturing the fixtures of section 11.3 for each class (Q5):

- If the #18 build serves the 2026.11.1 catalogue to every engagement whenever `templatePaper` runs (later papers, limitation memos, run papers), `fallbackVersion` is 2026.11.1, like the stamp values. A fixed 2026.10.1 fallback would silently move those engagements back to 2026.10.1 content at the #27 deploy.
- If it keeps serving 2026.10.1 content to engagements without a stamp, `fallbackVersion` is 2026.10.1.
- If no pack #1 version reproduces what a class is served, #27 adds one for that class rather than accept a change. The obligation file is not part of this, because phase 1 keeps validating obligation codes against the build's file (section 7.1).
- Either way, procedures and papers that already exist keep the content they copied when they were created. The pin decides only what is created from then on, and which links coverage reads.

The keys of `stamps` are the raw values #18 writes. The #8 research found that `02024R1689-20260727` is still the current consolidated text (section 19). So 2026.10.1 and 2026.11.1 engagements carry the same CELEX edition, and a stamp holding only that edition cannot tell them apart; `classification.version` already holds it on every engagement. The stamp #27 keys on must therefore be #18's rule-pack or methodology version. The schema accepts any edition-style token as a key (`2026.11.1` and `02024R1689-20260727` both pass), so whatever #18 writes can be mapped without a schema change. If #18 stamps `2026.11.1` and serves 2026.11.1 content to every engagement, the rule is:

```text
"legacy": { "packId": "eu-ai-act-amended", "fallbackVersion": "2026.11.1", "stamps": { "2026.11.1": "2026.11.1" } }
```

**Rollback window for the code.**
- Older builds ignore the `criteria` field: it survives their saves because the body is parsed and written back whole. They also keep finding `classification` on every engagement, because phase 1 still writes it (section 7.1).
- A rollback is therefore safe for every engagement that pins `eu-ai-act-amended`.
- Once an engagement pins a different pack, an older build answers 400 "Unknown methodology template" for that engagement's template commands, without corrupting its data. Redeploying the newer build restores it. So non-AI-Act packs are offered for selection only after phase 1 has run stable in production, and only through the `selectable` flag in the index.

**Pre-deploy check.**
- The operator runs these read-only queries (`wrangler d1 execute <database> --remote --json --command "<sql>"`). `$.<stamp>` stands for the JSON path of #18's stamp, which #27 fills in.
- `node schemas/validate-criteria.mjs --legacy-check <query output>` resolves each row's stamp through `index.legacy` and checks that every template id is an item of the pack #1 version that the row resolves to, not merely of 2026.10.1. The phase 1 PR attaches the result from staging.
- The deploy proceeds only if every id is known. An unknown id would mean data that the resolved pack version cannot explain.

```sql
SELECT COUNT(*) AS engagements, SUM(json_type(body, '$.criteria') IS NOT NULL) AS pinned FROM engagements;
SELECT json_extract(e.body, '$.<stamp>') AS stamp, json_extract(p.value, '$.templateId') AS template,
       COUNT(DISTINCT e.tenant_id || '/' || e.id) AS engagements
  FROM engagements e, json_each(e.body, '$.papers') AS p GROUP BY stamp, template;
SELECT json_extract(e.body, '$.<stamp>') AS stamp, json_extract(p.value, '$.templateId') AS template,
       COUNT(DISTINCT e.tenant_id || '/' || e.id) AS engagements
  FROM engagements e, json_each(e.body, '$.workflow.procedures') AS p GROUP BY stamp, template;
```

## 12. Adding a new pack as data alone

Worked example: the EN 18286 + ISO/IEC 42001 programme of #28, cut down to one working paper. A scratch harness checked each step:

- the six JSON blocks below validate against the draft schema;
- together with the sample AI Act documents, they pass a prototype of integrity rules 1, 2, 4 to 11, 12a and 12b of section 14.2. Rule 12b runs on the two released AI Act entries, whose digests it checks, and on `defaults` and `legacy`; rule 11 compares `MEM-EX-01` with the full pack #1 conversion; rule 10 finds the draft legal effect allowed. Rules 3 and 13 compare several data versions or the previous index, so a single set of documents cannot exercise them;
- the coverage engine gives the results in the table at the end of this section.

The EN 18286 clause numbers and topics come from a secondary source and are marked so. The three ISO/IEC 42001 subclause numbers were checked against the table of contents in the publisher's preview. Both must be confirmed against licensed copies before #28 releases anything.

**Steps.** No TypeScript, route or UI change is needed for any of them. That includes the AI Act behaviour of section 7.1: this pack switches none of those features on, so its engagements have no AI Act classification or classification gate and no obligation assessments, and their reports take the limitations text from `reporting`.

1. Add `templates/criteria/frameworks/en-18286/2026/2027.1.0.json` and `frameworks/iso-iec-42001/2023/2027.1.0.json`.
2. Add `templates/criteria/packs/en18286-iso42001/2027.1.0.json`. Copy shared items (here `MEM-EX-01`) with `derivedFrom`, so that CI reports when the upstream item changes.
3. Add `crosswalks/iso-iec-42001-to-eu-ai-act/2027.1.0.json` and `crosswalks/en-18286-to-eu-ai-act/2027.1.0.json`.
4. Add the five entries to `templates/criteria/index.json` as `draft`.
5. Run `node schemas/validate-criteria.mjs`, then the #3 sync script (`npm run sync`, which runs `site-app/scripts/sync-generated.mjs` in PR #42), then `npm test`. Drafts are excluded from the production bundle; tests load them through an injected registry.
6. Review in the pull request. After counsel confirms the licence policy (Q1), set `licence.status` to `confirmed`, and once the Annex ZA scope is confirmed (Q8), record the completed legal review of the crosswalk's legal effect, which rule 10 requires before release. The documents are still drafts, so both changes are allowed.
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
    "source": "https://www.vde-verlag.de/iec-normen/preview-pdf/info_isoiec42001%7Bed1.0%7Den.pdf",
    "sourceKind": "standard_text",
    "verification": "verified",
    "checkedAt": "2026-11-05",
    "legalReview": "not_required",
    "note": "Clause number checked against the table of contents in the publisher's preview of edition 1.0 (IEC webstore file, hosted by VDE Verlag). Titles are our own."
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
  "reporting": {
    "limitations": "Assurance conclusions do not constitute ISO/IEC 42001 certification by an accredited certification body, a conformity assessment under Regulation (EU) 2024/1689, or legal advice."
  },
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
      "sha256": "2decbb4a6c55cb4a0e830e77670c01f63728adab8b88e15f239dcd985e996f46",
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
      "sha256": "fd88e15ff804f756949ebcd4f48b93c720f7d5b3abf09aa9035d03e2ed10a8dc",
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
  "legacy": { "packId": "eu-ai-act-amended", "fallbackVersion": "2026.10.1", "stamps": {} }
}
```

In this example only pack #1 2026.10.1 exists, so `legacy` points at it and has no stamps. #27 sets the real values once #18 has merged (section 11.4).

Coverage once the documents are released and the engagement's `AIMS-S2-01` procedure is reviewed, signed and supported, with applicability `applicable`:

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

The same data while still a draft shows 6.1.2 and 8.2 as "Partly covered", because of the clamp in section 9.2. If the reviewer concludes "not supported", every mapped cell, including Art. 9(1) and Art. 17 in the AI Act view, shows "Exception in a related source". With applicability `readiness`, every state above that is covered or partly covered carries "(readiness)". The harness asserted all four outcomes. The AI Act view is offered because the AI Act edition is the criteria of a current pack (pack #1), and it reads the AI Act at its latest released data version (section 9.6).

Pack-specific features that #28 also wants are *features*, not criteria, and need code: the Statement of Applicability, nonconformity grading and the certification recommendation. The criteria model makes them possible but does not supply them. The AI-Act-only behaviour of section 7.1 is the opposite case: it exists as code today and becomes a pack feature, which this pack leaves off.

## 13. Licensing constraints

| Source | Position | Text policy | Status |
|---|---|---|---|
| EU AI Act and other EU legislation | Reuse of EUR-Lex content is authorised provided the source is acknowledged, under Commission Decision 2011/833/EU ([Decision](https://eur-lex.europa.eu/eli/dec/2011/833/oj)). Consolidated texts are research aids; the Official Journal is authentic. The wording was confirmed through mirrors of the EUR-Lex notice, because the live legal notice page returned empty to automated fetching | `full_text`, with attribution | confirmed (re-check the live notice before #27 releases) |
| EN 18286:2026 and other CEN-CENELEC standards | Copyright of CEN-CENELEC and the national members; sold through national standards bodies | `paraphrased_titles`: clause numbers and our own titles of at most 80 characters. No text, tables, figures or Annex ZA table rows. State facts about the standard (scope of the presumption) with sources | unconfirmed until counsel signs off (Q1) |
| ISO/IEC 42001, 42005, 42006, 23894 | ISO and IEC copyright, sold through ISO and national bodies ([ISO/IEC 42001](https://www.iso.org/standard/42001)) | `paraphrased_titles` | unconfirmed until counsel signs off (Q1) |
| NIST AI RMF 1.0, NIST AI 600-1 | NIST: except material marked as copyrighted, information on NIST sites is public information and may be distributed or copied; credit is requested ([NIST](https://www.nist.gov/oism/copyrights)) | `full_text`, with attribution | confirmed for NIST-authored content; check third-party crosswalks on the AIRC separately |
| NYC Local Law 144 and the DCWP rules | Enacted local law and agency rules, assumed free to reproduce. Not checked for this design: no source was read for the reuse terms of the official publications | `full_text` (proposed) | unverified: `unconfirmed` in the data, which blocks release, until someone checks the terms before #30 releases |
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
- audit programmes having a primary criteria set and `reporting` with a `limitations` text;
- the known `features` only, as booleans; `compat.obligations` with a non-empty `order`;
- index entries: release metadata and digests on released entries, withdrawal reasons, and `edition` and `selectable` only where they belong; `legacy.stamps` keys in the edition pattern and values that are data versions.

The draft was checked against the sample fixture, the requirement fragment of section 5.1, 24 rejected document mutations and 10 rejected index mutations. Among them: a migrated `superset_of` link, text or an 81-character title under `paraphrased_titles`, an audit programme without `reporting`, an unknown feature, `compat.obligations` without `order`, and the first draft's `methodologyVersions` map.

### 14.2 Integrity rules

JSON Schema cannot check these; `schemas/validate-criteria.mjs` must. Each needs a failing fixture.

1. Requirement ids are unique per document; aliases are unique per document.
2. `parent` points at a `group` of the same document; there are no cycles; every group has at least one child.
3. Every id released in an earlier data version of an edition exists in every later released data version; `replacedBy` targets exist.
4. A pack has at most one criteria set per framework id, so that `<framework-id>:<requirement-id>` resolves to one node; the schema cannot check this, because two sets with different editions are different array items. Each criteria set resolves to an indexed framework document with that id, edition and data version; `include` ids exist.
5. Objective links resolve in the pack's criteria sets; no link targets an `informative` node; one objective links a requirement at most once per rationale.
6. Item ids and step ids are unique within a pack; every `objectiveIds` entry exists; every objective is used by at least one item; `phase` exists in `phases`.
7. Every `regulatoryRefs` string of an item resolves through `aliases` in a primary framework.
8. `roles` reference items of the pack; `features.annexIvIndex` requires every `paperIds` entry of `templates/annex-iv-map.json` to be an item; `features.aiActClassification` and `features.obligationAssessments` require a criteria set of framework `eu-ai-act`, and `obligationAssessments` requires that framework to carry `compat.obligations` whose `order` lists requirement nodes of it.
9. Crosswalk endpoints are in the right frameworks and exist in the latest released data version of each edition; for a draft crosswalk, in the latest data version, draft or released. A crosswalk-only pack's `crosswalks` exist and connect one of its criteria editions.
10. An entry with `legalEffect` has `legalReview: completed` before release.
11. A `derivedFrom` item equals its upstream item (ignoring `objectiveIds`, `phase` and `derivedFrom`); otherwise the validator prints an "upstream changed" report. This is a warning, not a failure.
12. Index.
    - **12a. Structure, for every entry, drafts included:** every listed path exists and every file under `templates/criteria/{frameworks,packs,crosswalks}` is listed; ids, editions and versions match the file content and its path; versions increase per id (and edition); `selectable` appears only on audit programmes.
    - **12b. Release, for released and withdrawn entries:** the digest equals the JCS digest of the file; a released framework has a confirmed licence (section 13); a released document references only released or withdrawn documents, never a draft, so the frameworks of a released pack all have confirmed licences and a released crosswalk-only pack lists only released crosswalk versions; `defaults.pack` points at a released, non-withdrawn, selectable audit programme; `legacy.fallbackVersion` and every `legacy.stamps` value point at released or withdrawn versions of `legacy.packId`. Withdrawn versions are allowed there because the rule must keep reproducing what existing engagements were served.
13. Released entries are never removed and their digests never change. CI compares the index with the index at a named base, read with `git show <base>:templates/criteria/index.json`:
    - **pull request:** the base is the first parent of the merge commit that `actions/checkout` checks out for the event (`refs/pull/<n>/merge`), that is, the base branch tip. The step needs `fetch-depth: 2`, because the default depth of 1 has no parent;
    - **push to `main`:** the base is `github.event.before`, the tip before the push, fetched with `git fetch --depth=1 origin <sha>`. `HEAD~1` would miss the earlier commits of a push that carries several. For a new branch, where `before` is all zeros, the check is skipped.

    Only the base index is needed: rule 12b already checks the current files against the current digests.

### 14.3 Build-time copy into `site-app`

This follows #3. Its sync script, `site-app/scripts/sync-generated.mjs` in PR #42, copies the methodology files when run as `npm run sync`; `npm run check:sync` runs it with `--check`, which fails on drift and writes nothing, and is part of `npm run check` and CI. If #42 changes before it merges, the name changes here; the design needs only "the #3 sync script".

- **Extended sync step.** It validates all criteria documents (14.1, 14.2) and writes one file, `site-app/lib/criteria/bundle.generated.json`: a `bundle` document with `purpose: generated`, the index, and every released or withdrawn document in index order.
  - The bundle is serialised in JCS order, so `--check` can regenerate it in memory and compare it byte for byte.
  - Drafts are left out unless `CRITERIA_INCLUDE_DRAFTS=1` is set for local development.
- **Formatting.** Add `lib/criteria/*.json` to `site-app/.prettierignore`. The existing `lib/*.json` pattern, which #42 keeps, does not match the subfolder.
- **CI.**
  - The `engine` job runs `node schemas/validate-criteria.mjs` next to the existing validators, with `fetch-depth: 2` for rule 13.
  - The `web` job runs `check:sync` through `npm run check`.
- **Size.** The prototype conversion of pack #1 is about 145 KB of compact JSON per version: 69 KB for the framework (106 requirement nodes and `compat.obligations`, with placeholder headings for the articles outside the sample) and 75 KB for the pack (45 items, 33 objectives). JSON compresses well. If the bundle passes 1 MB, switch to one JSON import per document behind the same loader API.

### 14.4 Loader API (`site-app/lib/criteria/`)

```ts
registry(bundle = generated): Registry          // memoised; documents deep-frozen; indexes in Maps
selectablePacks(r): PackSummary[]               // released, selectable, not withdrawn, licences confirmed
defaultPin(r, packId?): CriteriaPin
legacyPin(r, e: Engagement): CriteriaPin        // section 11.4, M0: #18's stamp through index.legacy
pinOf(r, e: Engagement): CriteriaPin            // e.criteria?.pin ?? legacyPin(r, e)
resolve(r, pin): { pack: PackDocument; frameworks: FrameworkDocument[] }   // pin digest must equal the index digest, else 500
item(pack, templateId): Item | undefined
features(pack): { annexIvIndex: boolean; aiActClassification: boolean; obligationAssessments: boolean }   // absent = false
legacyCatalog(pack): Catalog                    // section 11.3; regulatorySnapshot {} without compat.catalog
obligationCatalog(framework): ObligationCatalog // section 11.3; from compat.obligations and the nodes
criteriaFor(r, pin, templateId): RequirementLink[]
views(r, pin): View[]                           // section 9.6: criteria views, then crosswalk views
crosswalksFor(r, pin, target: { framework: string; edition: string }): CrosswalkDocument[]   // current versions
coverageSources(e: Engagement, obligationRecords: AssuranceRecord[], pinned: FrameworkDocument[]): { sources: Source[]; unusable: AssuranceRecord[] }   // findings from e
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

It replaces the "Article-to-evidence mapping" panel of the Regulatory mapping view and keeps the classification panel (on packs with `features.aiActClassification`) and the regulatory-basis panel. It is a lazily loaded component (`app/criteria-coverage.tsx`), following the code splitting of #1.

```text
Criteria coverage   EU AI Act (amended) 2026.10.1 (pinned)   Program approved r3
View: [ EU AI Act (criteria) ] [ ISO/IEC 42001:2023 (crosswalk) ]

94 requirements:  Covered 0 | Partly covered 14 (R 9) | Exception 1 | Open 18 | Higher level only 57
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
- **Summary.** Counts with the denominator, never a merged percentage. Readiness results are counted apart ("Partly covered 14, of which readiness 9"). Exports to CSV and to the report snapshot (phase 2).
- **Banners.** The view states each condition that limits it: program not approved (proposed scope used); no applicability recorded per paper (results shown as readiness); pack or framework version withdrawn (coverage capped, with the reason); crosswalk view (the framework's applicability was not assessed, with the versions used); unusable obligation records and unplaced unresolved findings (counts).

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
  1. every committed criteria document and fixture validates; negative mutations as in `schemas/validate-procedure-schema.mjs`, starting from the 34 mutations used for this design;
  2. each integrity rule of 14.2 against a failing fixture, including two criteria sets for one framework id, an AI Act feature without an AI Act criteria set, a selectable crosswalk-only pack, a released framework with an unconfirmed licence and a `legacy` rule pointing at a draft; rule 13 against a base index with a released entry removed and one with a changed digest;
  3. the JCS digest, including line-ending and whitespace invariance, and index digests;
  4. the pack #1 golden tests of 11.3: both projections, for 2026.10.1 and 2026.11.1 (the obligation one over the whole file), and seeding and paper templates once per legacy class against the fixtures captured from the build before #27;
  5. `pinOf` and `legacyPin` for each legacy class: no stamp, and every stamp value #18 writes;
  6. the 49 truth-table cases of 9.8, crosswalk inversion and orientation, the views offered and the versions they use, and the unusable counts (crosswalk entries, obligation records whose code the pinned framework lacks);
  7. the monotonicity properties of invariant 3, with a seeded generator (no new dependency);
  8. "a new pack as data alone": the section 12 documents loaded through an injected registry, then `freshEngagement` → `seedWorkflow` → `templatePaper` → coverage → `createReport`, with no code change. It also asserts that the pack's engagements get no classification gate from `completionGates` or from `stageGates` for Planning → Fieldwork while the classification is provisional, that `classify` and `obligationDecision` answer 409, and that the snapshot has the pack's `limitations`, no `regulatorySource` and no `annexIV`. The same calls on pack #1 keep today's gates.
- **Integration harness** (`scripts/integration-check.mjs`, picked up by `run-checks.mjs`):
  - write an engagement body without `criteria` straight into the local D1, as a pre-deploy engagement, and run the existing workflow and report flow; outputs must be unchanged;
  - create an engagement with `packId` and check the pin in `GET /api/workspace`;
  - review one procedure and check its cells from `GET /api/coverage`;
  - a Client Viewer gets 403 from the coverage endpoint.
- **CI.** `validate-criteria.mjs` in the `engine` job, with the rule 13 base of section 14.2; `check:sync` inside `npm run check`.
- **Manual (until #34).** Dialog and heatmap at 375 px and desktop width, keyboard only, and with a screen reader.

## 17. Phased implementation plan

| Phase | Issue | Size | Scope | Done when |
|---|---|---|---|---|
| 1 | #27 | L, one PR | The data model: final schema, `validate-criteria.mjs` and its CI step. Converter plus pack #1 2026.10.1 and 2026.11.1 with the golden fixtures, captured per legacy class from the build before #27. Index, with the legacy rule set from #18. Sync extension, bundle and loader. Pin resolution with M0. Refactor of `templatePaper`, `freshEngagement`, `seedWorkflow`, `makePaper`, the limitation memo, run papers and the GET projection onto the pinned pack. The pack features and `reporting` of section 7.1: classification gates, commands and panels; obligation commands and panel; Annex IV index; report texts. `createEngagement` with `packId`, follow-up inheritance and the dialog. Coverage engine with findings and obligation records, crosswalk views, withdrawal clamp and banner, `GET /api/coverage` and the heatmap | The golden tests pass for every legacy class; the existing harnesses pass unchanged; the section 12 pack works from data alone in a test, without AI Act gates; the 49 cases pass |
| 2 | new | M | M1 explicit pin commands. Report and dossier stamps for frameworks and crosswalks. `obligation-subitems.json` and `annex-iv-map.json` generated from the AI Act framework and pack, with projection tests. Obligation codes validated against the pinned framework, and the workbench's obligation options served by the API. Findings `criteriaRefs` for #20, with coverage placing unlinked findings through them | Obligation and Annex IV projections are lossless; snapshots carry every stamp |
| 3 | new | M | M2 repin with diff, impact review and revert (revision-limit check up front; template content re-derived on revert). Reviewed links for pack #1 (the 33 papers against the 68 subitems; methodology data only) as pack #1 2026.12.x or later | A repin and its revert are tested; pack #1 shows precise coverage |
| 4 | #28 | L | The EN 18286 + ISO/IEC 42001 pack as data, following section 12, plus its features: Statement of Applicability, nonconformity grading, certification recommendation | Q1 resolved; the #28 criteria pass |
| 5 | #29, #30 | S, M | NIST AI RMF 1.0 and AI 600-1 frameworks and crosswalks as a crosswalk-only pack (data and tests only). The NYC LL144 pack (data plus the computations of #30) | The packs validate; crosswalk targets exist; coverage cases pass |
| 6 | new | M | OSCAL catalog and mapping-collection export. Tenant default pack. Engagement-level link tailoring with approval. AIUC-1 after Q2. Tenant-authored packs, which would need a D1 table of immutable documents with the same schema and digests | Each item tested on its own |

Commit order for phase 1:

1. schema and validator;
2. converter and pack #1 data;
3. sync, bundle and loader;
4. pin and consumer refactor, with the equivalence tests;
5. pack features and `reporting` (section 7.1), with the pack #1 behaviour unchanged;
6. pack selection;
7. coverage engine and view.

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
- **Q5. Coordination with #18 (blocks #27's legacy rule).** #27 answers these from #18's merged code and records the answers as index data and golden fixtures (section 11.4):
  - the name and values of #18's engagement-level stamp. It must hold a rule-pack or methodology version, because a CELEX edition alone cannot tell 2026.10.1 engagements from 2026.11.1 ones;
  - which content the #18 build serves to engagements created before #18 (no stamp) whenever `templatePaper` runs, which sets `legacy.fallbackVersion`, and to each stamp value, which sets `legacy.stamps`;
  - whether #18 or #27 converts methodology 2026.11.1 into pack #1 2026.11.1. Proposed: #27, since #18 merges first and does not know the criteria model.
- **Q6. Obligation records.** Should they count as direct coverage sources from phase 1? Proposed: yes, on packs with `features.obligationAssessments`, with readiness taken from the record's applicability.
- **Q7. Client-visible coverage.** Should clients see coverage in released reports, and which crosswalk views? Decide with #20 in phase 2.
- **Q8. EN 18286 facts.** The clause structure and the exact Annex ZA scope (Art. 17(1) and the first sentence of Art. 11(1), per secondary sources) must be confirmed against the purchased standard and Implementing Decision (EU) 2026/2274 before #28 encodes them.

**Risks:**

- **Phase 1 is large.** Mitigation: the commit order above, and moving M1, M2 and the obligation folding out of it.
- **Users may read "Partly covered" on day one as a regression** against the old 100% article bars. Mitigation: show papers signed (progress) and criteria coverage as separate measures, as the methodology already requires, and explain the migration note in the drawer.
- **Obligation data drifts from the framework until phase 2.** Mitigation: the projection test in 11.3, and records with codes the pinned framework lacks are counted, not dropped (section 9.1).
- **Withdrawing pack #1 would cap the coverage of every legacy engagement.** That is intended (section 6.6), but it makes a withdrawal of pack #1 a decision for the methodology owner with a repin plan, not a routine correction; a mistake in a released version is normally fixed by releasing a newer one.
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
- ISO/IEC 42001:2023: [iso.org/standard/42001](https://www.iso.org/standard/42001). Edition 1, published 18 December 2023, JTC 1/SC 42 (search result; the page returned 403 to fetching). The top-level clauses were read from the DIN table of contents for DIN EN ISO/IEC 42001.
- ISO/IEC 42001:2023 edition 1.0, publisher's preview (IEC webstore file hosted by VDE Verlag): [vde-verlag.de](https://www.vde-verlag.de/iec-normen/preview-pdf/info_isoiec42001%7Bed1.0%7Den.pdf). Its table of contents lists 6.1.2 "AI risk assessment", 6.1.4 "AI system impact assessment" and 8.2 "AI risk assessment" (with 6.1.3 and 8.3 "AI risk treatment" and 8.4 "AI system impact assessment"). Checked on 5 November 2026 by decoding the PDF's text; the clause text itself was not read.

**Licensing**
- AIUC-1: [aiuc-1.com](https://www.aiuc-1.com/) (quarterly releases, one-year version lock), [standard.aiuc-1.com](https://standard.aiuc-1.com/) ("all rights reserved"), [AIUC terms of service](https://aiuc.com/legal/terms).
- NIST copyright and use: [nist.gov/oism/copyrights](https://www.nist.gov/oism/copyrights).
- CSA AICM licensing FAQ: [cloudsecurityalliance.org](https://cloudsecurityalliance.org/artifacts/ccm-aicm-licensing-faq). Search result only; not read.
- NIST AI Resource Center crosswalks: [airc.nist.gov](https://airc.nist.gov/airmf-resources/crosswalks/). Search result only; not read.

**Repository** (`main@74c6463`, with Prettier-formatted `site-app` code from #1; the review revision re-read the code at `main@b15f037`)
- `templates/catalog.json`, `templates/annex-iv-map.json`, `docs/obligation-subitems.json`, `docs/audit-methodology.md`;
- `site-app/lib/domain.ts` (`completionGates`, `stageGates`, `Finding`), `site-app/lib/workflow-types.ts`, `site-app/lib/workflow-state.ts`, `site-app/lib/workflow-seed.ts`, `site-app/lib/workflow-service.ts` (`recordHistory`, `linkFindingSupport`, the plan fields);
- `site-app/lib/store.ts` (`freshEngagement`, `templatePaper`), `site-app/lib/engagement-storage.ts`, `site-app/db/schema.ts`;
- `site-app/app/api/workspace/route.ts` (`createReport`, `releaseReport`, `createFinding`, `classify`), `site-app/app/api/management/route.ts`, `site-app/app/api/assurance/route.ts` (`obligationDecision`), `site-app/lib/assurance-store.ts` (`assuranceGates`), `site-app/app/workspace.tsx`, `site-app/app/assurance-workbench.tsx`, `site-app/app/engagement-overview.tsx`, `site-app/app/workspace-types.ts`;
- `.github/workflows/ci.yml` (`actions/checkout@v7` at the default depth, for rule 13).
- Internal planning documents of 5 November 2026 (not in the repository; #7 records them): the product direction brief, sections 1.5 and 2.3 and Theme 4 (R4.1 to R4.7); the codebase review, decisions D2 (stay on D1) and D5 (qualified legal review of legal content) and findings F-50 and F-51.

**Related pull requests** (open on 5 November 2026)
- PR #42 (issue #3): `site-app/scripts/sync-generated.mjs`, `npm run sync` and `npm run check:sync`; keeps `lib/*.json` in `.prettierignore`.
- PR #43 (issue #8), `docs/research/rule-pack-2026-11.md`: `02024R1689-20260727` is still the current consolidated version (Publications Office index and SPARQL checks of 5 November 2026), and item RD-70 recommends reading the default classification version from the catalogue.
