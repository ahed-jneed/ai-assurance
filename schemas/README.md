# Evaluation run contracts

`test-run.schema.json` uses JSON Schema Draft 2020-12. It accepts three explicit contracts:

- **1.0:** Existing external Python reports and legacy hosted evaluations. The external runner is currently 1.2.0; runner version and report contract version are separate.
- **1.1:** Hosted saved-prediction evaluations. These require a frozen model card, dataset metadata, normalized configuration, protocol when selected, test-definition version and SHA-256 input bindings. Queued, running, succeeded, failed and cancelled states have distinct rules.
- **1.2:** Completed authenticated external attempts compiled by the platform. These require an external job ID, approved procedure revisions, non-null frozen protocol, original request/result digest pins, system/model/dataset declarations, and the complete worker metrics including counts, confidence intervals, thresholds and slices. The original envelope and engine report remain unchanged.

The contracts describe different execution boundaries. Hosted `engineConfig` 1.1 is explicitly translated by the independent Python worker into engine report contract 1.0. Its transport request and exact result envelope each use schema 1.0. The application separately compiles a 1.2 run from accepted bytes and frozen declarations. The worker is supplied as source and needs separate enrollment/deployment; schema validity alone establishes neither origin nor independent inference. A client-local/provided-prediction run can reference registered native model metadata while still evaluating supplied predictions.

## Validate

From the workspace root, with the existing Site dependencies:

```powershell
node schemas/validate-run-schema.mjs
```

Validate fresh synthetic Worker outputs after the Site integration check:

```powershell
node schemas/validate-run-schema.mjs --fixtures site-app/.sites-runtime/run-schema-fixtures.json
```

The validator checks the schema itself, legacy compatibility, current Python reports, all hosted execution states, and external 1.2 projections produced from actual binary/fairness/multiclass/regression computations. It verifies exact request/result string hashes, frozen bindings, rich metrics and malformed-record/tamper rejection. The committed fixtures contain fictional local test data and dummy declarations; they do not test production service authentication or native runtimes. `--ajv-package` can point to an alternative package.json whose dependencies include `ajv` and `ajv-formats`. `--external-fixtures` optionally selects another fixture file containing `{fixture,requestJSON,resultJSON,run}` entries.

In the current external projection, `manifest.dataset.rowCount` is the maximum reported metric sample size, with zero permitted for missing evidence; this must not be interpreted as a source-population census. One supplementary paper compiles the attempt, even when results map to multiple articles. Cross-field validation aggregates fail, then inconclusive, then pass, then not_applicable; no missing or inapplicable evidence defaults to pass.

Portable JSON Schema cannot establish hash integrity, equality between fields, temporal ordering, authorization or evidence custody. The companion validator recomputes fixture hashes and checks cross-field bindings. The hosted application independently verifies input bytes and frozen configuration before execution; the server remains responsible for tenant access and review workflows.

The schema generator is `.build-run-schema.py`, which invokes the callable/idempotent `.extend-assurance-schema.py` to preserve 1.2 on every regeneration. From the extracted runtime or workspace root:

```powershell
python schemas/.build-run-schema.py
python schemas/generate-external-fixtures.py
node schemas/validate-run-schema.mjs --ajv-package path/to/package.json
```

The fixture generator runs only synthetic local engine computations; reports get new execution timestamps. Regeneration never establishes a valid production custody chain. See `engine/RUNTIME_PACKAGE.md` for the source archive manifest and reproduction workflow.

Hosted 1.1 runs may bind an approved audit procedure through `procedureBinding`: procedure ID/revision and brief/program revisions. A binding requires its own SHA-256 `auditBinding` pin. Execution verifies that pin, and procedure compilation accepts only succeeded runs matching the approved model, dataset and protocol, the procedure's current plan revision and the current brief revision; the program revision is recorded but not compared, so another procedure's change does not invalidate the run. `retryOf` links a newly queued run to its preserved failed/cancelled predecessor; a retry revalidates input integrity and rejects changed audit scope. Neither field upgrades saved predictions to independent model inference.

`procedure-execution.schema.json` covers the actual work performed, explicit step dispositions, scope revisions, the plan hash it binds (optional for records made before plan hashes), evidence/run references and optional human assessment. Validate it and a fresh API execution with:

```powershell
node schemas/validate-procedure-schema.mjs site-app/.sites-runtime/execution-schema-fixture.json
```

The execution schema checks record shape; accepted evidence, authorized actors, matching approved inputs and independent review remain server-enforced.
