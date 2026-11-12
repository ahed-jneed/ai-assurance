# Evaluation run contracts

`test-run.schema.json` uses JSON Schema Draft 2020-12. It accepts these explicit contracts:

- **1.0:** Frozen external Python reports and legacy hosted evaluations, validated with their original rules. Runner version and report contract version are separate.
- **1.1:** Hosted saved-prediction evaluations. These require a frozen model card, dataset metadata, normalized configuration, protocol when selected, test-definition version and SHA-256 input bindings. Queued, running, succeeded, failed and cancelled states have distinct rules.
- **1.3:** Engine reports under statistics 1.0.0 (`docs/design/audit-statistics.md`, runner 1.3.0). Every performance, calibration and group criterion of the recorded plan is one result with a `decision` and the shared metric shape (headline, members, descriptive entries); the plan is `configuration.statistics` and its RFC 8785 SHA-256 is `provenance.statisticsPlanSha256`. Drift, unavailable capabilities and model-backed procedures keep the 1.0 result shape without a decision. `statistics-plan.schema.json` is the live plan contract, embedded as `$defs.statisticsPlan`.
- **1.4:** Hosted saved-prediction runs under statistics 1.0.0 (runner interactive-predictions 3.0.0): one result per criterion of the plan frozen in `manifest.statistics` (a schemaVersion 1.1 protocol's stored plan, or the derivation of a 1.0 protocol), each with its `decision` and the shared metric shape; the plan hash is `provenance.inputHashes.statisticsPlan` and failing exploratory criteria are `reviewFlags`. `fixtures/hosted-runs.v1.4.json` holds runs the real queue and evaluation path produce (`site-app/lib/hosted-runs-fixture.test.ts` keeps it current), including an explicit plan whose criterion ids differ from the suite names. `fixtures/hosted-api-runs.v1.4.json` holds the card-pinned runs (a cancelled run, its retry and a succeeded run) that the Site integration harness made through the real API, captured with `node schemas/capture-api-fixtures.mjs` and frozen like `fixtures/hosted-runs.v1.1.json`.
- **1.5:** Compiled external audit runs under statistics 1.0.0: results keyed by criterion id, each with the engine decision the worker copied, the plan in `manifest.statistics` and its hash in `provenance.inputHashes.statisticsPlan`, and `reviewFlags`. The run outcome aggregates confirmatory criteria only. `fixtures/external-runs.v1.5.json` comes from actual worker computations; one fixture uses an explicit plan (engineConfig 1.4). The platform compiles worker results that carry copied decisions into 1.5 (`importJob`, #22 H4); a 1.2 result carries no decision. `fixtures/performance-rules-golden.json` holds binary performance cases (#65) that the hosted runner (`site-app/lib/performance-rules-golden.test.ts`) and the worker path (`engine/tests/test_performance_rules.py`) must decide alike, with the same metrics.
- **1.2:** Completed authenticated external attempts compiled by the platform. These require an external job ID, approved procedure revisions, non-null frozen protocol, original request/result digest pins, system/model/dataset declarations, and the complete worker metrics including counts, confidence intervals, thresholds and slices. The original envelope and engine report remain unchanged.

The contracts describe different execution boundaries. Hosted `engineConfig` 1.1 (a derived plan) and 1.4 (an explicit plan) are translated by the independent Python worker into engine configuration 1.3, and the worker copies the engine's decisions into `hostedResults`. Its transport request and exact result envelope each use schema 1.0. The application separately compiles a 1.5 run (1.2 for results without decisions) from accepted bytes and frozen declarations. The worker is supplied as source and needs separate enrollment/deployment; schema validity alone establishes neither origin nor independent inference. A client-local/provided-prediction run can reference registered native model metadata while still evaluating supplied predictions.

## Validate

From the workspace root, with the existing Site dependencies:

```powershell
node schemas/validate-run-schema.mjs
```

Validate fresh API outputs after the Site harnesses (`npm run check:fixtures` in `site-app/` runs this and the procedure check below; CI runs it after the harnesses):

```powershell
node schemas/validate-run-schema.mjs --fixtures site-app/.sites-runtime/run-schema-fixtures.json --external-run tmp/assurance-worker-fixture/hosted-external-run.json
```

The validator checks the schema itself, legacy compatibility, current Python reports, all hosted execution states, and external 1.2 projections produced from actual binary/fairness/multiclass/regression computations. It verifies exact request/result string hashes, frozen bindings, rich metrics and malformed-record/tamper rejection. The committed fixtures contain fictional local test data and dummy declarations; they do not test production service authentication or native runtimes. `--ajv-package` can point to an alternative package.json whose dependencies include `ajv` and `ajv-formats`. `--external-fixtures` optionally selects another fixture file containing `{fixture,requestJSON,resultJSON,run}` entries. `--external-run` validates one platform-compiled 1.2 run, including its dataset-card pin when present.

A fairness protocol frozen in a 1.1 or 1.2 run may carry `specialCategory`: whether its group column holds special-category data, its route (`client_side` or `hosted`) and a copy of the client's recorded Art 4a or GDPR Art 9(2) basis. A hosted run on such data also records `manifest.specialCategoryAcknowledgement`; a retry carries the source run's acknowledgement over unchanged and adds `inheritedFrom`, the source run ID. Both are optional, since earlier runs have neither; the application enforces the basis and the acknowledgement (#60).

An external 1.2 or 1.5 run on a client-held dataset pin (#102) records `manifest.dataset.custody: "client"`: the client's own worker read the file in the client's environment by its SHA-256 and returned only aggregates, and the platform never held its bytes (`engine/WORKER.md`, Client-held datasets). Such a run withholds groups and calibration bins below the minimum group size: their slice keeps only the label, with `n` null and `"withheld": true`, the comparisons involving them carry no estimate, counts or interval, and `decision.suppressedGroups[].n` is null, which the schema admits for that reason. The rows of withheld groups are left out of every result, so no total includes them, and a group comparison's `decision.coverage` is null. Its `executionMode` is `client_local`. The application enforces that such a pin is queued only in that mode and that the result states the same custody.

Hosted 1.1 and 1.4 and external 1.2 and 1.5 runs may pin the frozen dataset governance card as `manifest.dataset.cardPin` (record ID, SHA-256 and card body). The card body is the registered card of `dataset-card.schema.json`, embedded as `$defs/datasetCard`. The validator also checks that the pin's SHA-256 is that of the card text as the records API stores it, that the card describes the evaluated bytes and that its period runs forwards; the application checks that the card version matches the accepted dataset bytes and the engagement. The binary fixture of `fixtures/external-runs.v1.5.json` pins the API's card, re-issued for its own bytes.

A schema's `$id` versions the schema document, not the run contracts it accepts: `urn:ai-assurance:test-run:2.0` (#51) accepts only well-formed dataset cards in a pin, where 1.2 accepted any object.

In the current external projection, `manifest.dataset.rowCount` is the maximum reported metric sample size, with zero permitted for missing evidence; this must not be interpreted as a source-population census. One supplementary paper compiles the attempt, even when results map to multiple articles. Cross-field validation aggregates fail, then inconclusive, then pass, then not_applicable; no missing or inapplicable evidence defaults to pass.

Portable JSON Schema cannot establish hash integrity, equality between fields, temporal ordering, authorization or evidence custody. The companion validator recomputes fixture hashes and checks cross-field bindings. The hosted application independently verifies input bytes and frozen configuration before execution; the server remains responsible for tenant access and review workflows.

`test-run.schema.json` is fully generated by `.build-run-schema.py` from committed sources and never read back: `test-run.base.json` holds the hand-maintained legacy 1.0 run body and the shared definitions the scripts do not build (`id`, `sha256`, `window`, `artifact`, `metric`, `result` and the threshold and production definitions; its `null` members are placeholders the generator fills), the generator builds the legacy and hosted 1.1 definitions, and it invokes the callable/idempotent `.statistics-schema.py` (engine report 1.3, hosted run 1.4, external run 1.5 and the plan embedded from `statistics-plan.schema.json`) and `.extend-assurance-schema.py` for 1.2. Edit `test-run.base.json`, `statistics-plan.schema.json` or the generator scripts, never the generated `test-run.schema.json`. From the extracted runtime or workspace root:

```powershell
python schemas/.build-run-schema.py
python schemas/generate-external-fixtures.py   # writes fixtures/external-runs.v1.5.json; v1.2 stays frozen
node schemas/validate-run-schema.mjs --ajv-package path/to/package.json
```

`python schemas/.build-run-schema.py --check` fails without writing when the committed schema differs from the generator output; `npm run check:sync` in `site-app/` runs it. The generators write LF line endings on every platform. The fixture generator runs only synthetic local engine computations; reports get new execution timestamps, so CI validates a fresh set written with `--output` to a temporary file rather than comparing bytes. The committed external fixtures were generated with CPython 3.12.14, the validated runtime recorded in their provenance. Regeneration never establishes a valid production custody chain. See `engine/RUNTIME_PACKAGE.md` for the source archive manifest and reproduction workflow.

Hosted 1.1 runs may bind an approved audit procedure through `procedureBinding`: procedure ID/revision, the procedure's `planHash` (runs queued since #69; absent on earlier runs and on external job runs) and brief/program revisions. A binding requires its own SHA-256 `auditBinding` pin. Execution verifies that pin, and procedure compilation accepts only succeeded runs matching the approved model, dataset and protocol, the procedure's current plan (its plan hash when the binding records one, otherwise its plan revision) and the current brief revision; the program revision is recorded but not compared, so another procedure's change does not invalidate the run. `retryOf` links a newly queued run to its preserved failed/cancelled predecessor; a retry revalidates input integrity and, by the same rule, rejects a changed procedure plan or audit scope while accepting another procedure's change once the program is approved again. External jobs follow the same rule: a job keeps running while its procedure's plan revision and the brief revision are unchanged. Neither field upgrades saved predictions to independent model inference.

`procedure-execution.schema.json` covers the actual work performed, explicit step dispositions, scope revisions, the plan hash it binds (optional for records made before plan hashes), evidence/run references and optional human assessment. Validate it and a fresh API execution with:

```powershell
node schemas/validate-procedure-schema.mjs site-app/.sites-runtime/execution-schema-fixture.json
```

The execution schema checks record shape; accepted evidence, authorized actors, matching approved inputs and independent review remain server-enforced. Without a path argument it validates the committed `fixtures/procedure-execution.json`, which is how CI runs it.

## Working papers

`working-paper.schema.json` (`urn:ai-assurance:working-paper:2.1`) is the single working-paper contract. `paperRevision` describes a revision of a `templates/catalog.json` working paper or memo; its status gates require procedures and a non-blank evaluation rationale once submitted, approvals and an auditor conclusion once reviewed, and two approvals plus a content digest once sealed. `templates/working-paper.blank.json` is its draft specimen. `generatedDraft` describes the drafts that `engine/diagnostics.py` derives from diagnostic results: they always require review and carry no sign-offs.

**What the application exports.** Papers leave the application as `paperRevision` documents of `schemaVersion` 1.1.0 (`site-app/lib/papers/`). Report capture projects every captured paper into `snapshot.workingPapers`; an internal dossier files each document as `papers/<id>-r<revision>.json`, and the internal report package (contract 1.2) lists them as `workingPapers`. The package proof (1.1) names each document with the SHA-256 of those same bytes. Client dossiers and packages keep each paper's conclusion only, since a contract document names the preparer and approvers, and packages captured before the contract keep their captured papers. Revision 1.1.0 requires `kind` and `narrative`, and maps the app's record as follows:

| App record | Document |
|---|---|
| `kind`, `templateId`, `title`, `stage`, `revision`, `audience` | `kind`, `catalogId`, `title`, `stage`, `revision`, `audience` |
| `status` draft, in_review, reviewed, signed; a superseded paper | `status` draft, submitted, reviewed, sealed; superseded |
| `body` sections and `conclusionStatus` | `narrative`, unchanged; `evaluation.rationale` is the conclusion and `auditorConclusion` its status (not_supported is deficiency) |
| reviews and signatures | `approvals` (reviewer, lead_auditor), bound to the revision's content digest, the SHA-256 that signPaper signs |
| linked evidence and runs | `evidence` (artifact hash and status) and `runReferences` (manifest digest; the hosted runner records no environment digest, so it is null) |
| review comments and responses | `reviewComments`, each on the revision it was raised on |

Evidence counts as sufficient once a paper is submitted, since submission asserts it; a non-empty limitations section makes it `limited`. A paper whose linked evidence or run the engagement no longer holds names it in `evaluation.limitations` instead of inventing a reference. `site-app/lib/papers/revision.test.ts` projects every catalog item in each state and validates the documents with this validator; `paperFromRevision` reads a document back, and the round-trip test checks that it returns the paper's fields.

**Memos.** Memos use the same eight narrative sections as working papers, because that is how the application records them; the memo templates' headings map onto them (background to objective and scope, the issue to criteria, analysis and alternatives to procedures, sampling and results, recommendation and management position to the conclusion). Splitting the text into the six memo headings would invent a division the auditor never made. What a memo adds is the structured record it decides on, in `records` (not allowed on working papers): the acceptance or continuance record and the independence and competence declarations for MEM-AC-01 (#23), and for MEM-SO-01 the engagement quality reviewer's sign-offs of the package (#24) and the release completion. MEM-SO-01 is recorded at release rather than prepared as a paper, so once a final package is released its exports add the memo as a sealed document composed from the release record (`contentOrigin` hybrid): the independent approval, the quality reviewer's sign-off and the release, each bound to the internal package hash, with both package hashes as its evidence.

```powershell
node schemas/validate-working-paper-schema.mjs
node schemas/validate-working-paper-schema.mjs --documents path/to/papers.json   # an array, or { documents }
```

The validator checks the engine example drafts, the blank template, 1.0.0 revisions, the status gates and memo records, and with `--documents` the documents an export wrote. The extracted runtime package has no `templates/` folder, so there it checks the engine drafts only.

## Dataset card

`dataset-card.schema.json` (`urn:ai-assurance:dataset-card:1.0`) is the dataset governance card. `$defs/declaredCard` is what an auditor declares in registerDataset; `$defs/registeredCard`, the schema's root, is the stored body a run pins, with the SHA-256, name and size of the accepted bytes and a baseline's pin. It is the language-neutral form of the zod schemas `datasetCardFields` and `registeredDatasetCardSchema` in `site-app/lib/dataset-card.ts`, and `site-app/lib/dataset-card-contract.test.ts` fails when the two disagree on a field, a constraint or a sample card. Text is stored trimmed. JSON Schema cannot compare dates, so the application and the validators check the period order.

```powershell
node schemas/validate-dataset-card-schema.mjs [--cards path/to/cards.json]
```

The validator checks the schema in Ajv strict mode, the card the API pinned in `fixtures/hosted-api-runs.v1.4.json`, a card stored before regression baselines, a card with a baseline, and that malformed cards are rejected.

## GenAI evaluation evidence

`genai-evidence-item.schema.json` is the per-item record (`genai-evidence-item/0.1`) and the required run metadata (`$defs/runMetadata`) of `docs/design/genai-evidence.md`. `genai-result.schema.json` is the `genai-result/0.1` envelope that `python -m engine.genai ingest` writes (see `engine/GENAI.md`), its computation (`$defs/computation`), the Art. 50 marking-check record (`$defs/markingCheck`) and the input contracts `genai-plan/0.1` (`$defs/plan`) and `genai-bundle/0.1` (`$defs/manifest`, whose families reference the item schema's `$defs/family`). Hashed parts of the envelope are exact strings: verify SHA-256 over the UTF-8 bytes of `computationJSON` and `itemsJSONL` before parsing them, and never re-serialise. `fixtures/genai-result.example.json` is the envelope of the #33 acceptance scenario (`inspect/judged_qa_30.eval` with a validated judge); `engine/tests/test_genai_envelope.py` keeps it equal to a fresh computation.

```powershell
node schemas/validate-genai-schema.mjs                     # schemas, reference records, example envelope, rejections
node schemas/validate-genai-schema.mjs path/to/result.json # another envelope
```

The validator compiles both schemas with Ajv 2020 in strict mode, validates the 122 reference records and 13 run-metadata blocks of `engine/tests/fixtures/genai/`, recomputes both envelope hashes, validates the computation and every item line, and proves that malformed and tampered envelopes, items, manifests and plans are rejected. CI runs it in the `engine` job. Schema validity establishes neither the origin of the inputs nor the correctness of a tool's scoring.

## Rule pack

`rule-pack.schema.json` (Draft 2020-12) defines the EU AI Act rule pack, the `regulatorySnapshot` of `templates/catalog.json`: per-provision application dates with sources, verification date, legal-review flags, approval metadata and change history; authority deadlines; the dated Article 5 practices; the Article 4a conditions for special-category data in bias detection and the provisions Regulation (EU) 2026/1744 changed; the standards and guidance registers; the legal-review items, unverified claims and the source register. From the workspace root:

```powershell
node schemas/validate-rule-pack.mjs
```

Beyond the schema, the validator checks unique ids; that every source, legal-review item and cross-reference resolves and every source is cited; real calendar dates; typed predicates over the facts declared in `docs/obligation-subitems.json`; the approval rules (an entry or the pack is approved only with a reviewer and an approval time, never while a legal-review item it depends on is pending); that secondary sources back only content marked `secondary_only`; the version and research date the catalog, the obligation file and the Annex IV map share; that a clause scope never both covers and excludes a clause; and agreement with the verified research file the pack names, including each entry's summary, scope, conditions and notes (a summary may differ only where `summaryPointers` replaces a pointer to a research data key with one to content the Site shows), the Article 4a conditions, the provision references and each legal-review item's related ids. A later revision listed under `research.revisions` (rule pack 2026.11.2: the Article 50 research) is checked against its own research file: every edit that research addresses to the rule pack is applied, an amendment of a base entry only extends it (notes and questions appended to, sources and legal-review items added), a guidance entry with `researchRef` matches the research entry it reproduces, added legal-review items and sources match the research, and an unverified claim is dropped only when the research resolves it. It then proves that a set of single mutations is each rejected. CI runs it in the `engine` job, and the Site unit tests run the same checks on the copies in `site-app/lib/`.

Hosted 1.1 and external 1.2 runs may also carry `rulePack` and `methodologyVersion`: the rule pack and methodology version the run was made under. Both are optional because earlier runs lack them.

## Criteria packs

`criteria-pack.schema.json` (Draft 2020-12) validates the five criteria document types of `docs/design/criteria-model.md`: frameworks, engagement packs, crosswalks, the index and bundles. The documents live in `templates/criteria/` (see its README). `validate-criteria.mjs` adds what JSON Schema cannot express: the integrity rules 1 to 12 of design section 14.2 (trees, persistent ids, criteria sets and links, items and roles, features, crosswalk endpoints, legal effects, the index structure, digests, licences and the approvals of Q4), the methodology-drift check (the default pack must project to `templates/catalog.json` and its AI Act framework to `docs/obligation-subitems.json`) and, with `--base <commit>`, rule 13, the index history, failing closed on a base that is not present. CI runs it in the `engine` job against the pull request's base or the previous tip of `main`.

```powershell
node schemas/validate-criteria.mjs                            # schema, rules 1-12 and drift
node schemas/validate-criteria.mjs --base origin/main         # also rule 13
node schemas/validate-criteria.mjs --stamp                    # fill in the JCS digests of released entries
node schemas/validate-criteria.mjs --legacy-check rows.json   # the pre-deploy check of design section 11.4
```

`fixtures/criteria-pack.eu-ai-act-amended.sample.json` is the design's sample of pack #1; `fixtures/criteria-pack.en18286-iso42001.sample.json` holds the section 12 pack as drafts, which the Site tests load to prove that a new pack works from data alone. `npm run sync` writes the generated bundle `site-app/lib/criteria/bundle.generated.json` from the released documents.

## Threshold library

`threshold-library.json` is the threshold library of statistics 1.0.0 (`docs/design/audit-statistics.md` section 10): versioned acceptance rules with their legal status, timeless caveat and dated status notes. `site-app/lib/threshold-library.json` is its generated copy (`npm run sync`), and `engine/tests/test_threshold_library.py` keeps `engine/statistics.py` LIBRARY equal to its decidable entries.
