# ML registration and testing enhancement

Design and delivery scope: 7 October 2026. This document describes the registration, reusable evaluation and traceability increment. It is an implementation contract and acceptance specification, not an execution log or a declaration of regulatory compliance. Capability claims in a released build must agree with its enabled routes and verified tests.

## 1. Analysis and design decisions

The original hosted testing flow records a small model inventory entry and evaluates a CSV of saved binary predictions. That is useful audit evidence, but it leaves four questions difficult to answer: which model version the predictions describe, what evaluation population and split were declared, why the acceptance criteria were chosen, and which exact registration and protocol a historical result used.

This increment makes those relationships explicit through append-only model versions, readable model cards, reusable immutable evaluation profiles, preflight validation and frozen run input manifests. The hosted runner evaluates saved predictions for binary classification, multiclass classification and regression. Classical NLP remains an inventory/card task; selecting it does not enable an NLP evaluator.

Hugging Face provides a useful documentation pattern: a readable model card with structured metadata for model description, intended use, limitations, training and evaluation, and a dataset card for data context and potential biases. The platform adapts this pattern to private client evidence and independent audit review. [Hugging Face model cards](https://huggingface.co/docs/hub/model-cards), [Hugging Face dataset cards](https://huggingface.co/docs/hub/datasets-cards).

Four distinctions govern the design:

- **Task, algorithm and artifact format are separate.** A regression task can use a tree model, a linear model or another algorithm. Framework and algorithm are freeform descriptive fields; choosing them does not establish runtime support.
- **A registered version and a runnable artifact are separate.** Model binaries remain quarantined in the hosted application. The application does not deserialize or execute them merely because a card exists.
- **A declaration and verified evidence are separate.** Dataset split, prediction provenance, independence and criterion rationale are captured declarations for an auditor to corroborate. Parsing or evaluating a CSV does not prove those assertions.
- **A diagnostic outcome and an audit conclusion are separate.** Test outcomes describe a measured result relative to an internal criterion. An independent reviewer and signing Lead Auditor assess the paper's evidence and conclusion under the existing workflow.

## 2. Scope and capability boundary

| Capability | Scope for this increment |
|---|---|
| Model inventory | Append-only versions/cards; frozen source-artifact SHA-256; task, algorithm/framework and intended-use context |
| Tasks | Binary classification, multiclass classification and regression saved-prediction evaluation; classical NLP metadata only |
| Optional Hugging Face reference | Repository ID, full commit and filename metadata; no remote fetch, download, code loading or token handling |
| Evaluation profiles | Reusable immutable versioned records stored in the engagement aggregate JSON |
| Dataset preflight | Read and verify accepted artifact bytes; parse CSV; expose a column profile and validate selected mappings before queueing |
| Hosted procedures | Existing binary performance/fairness; multiclass accuracy, macro F1, balanced accuracy and class support; regression MAE, RMSE and R-squared |
| Run provenance | Strict registered prediction-artifact/dataset identity; frozen model, evaluation profile, dataset manifest and input hashes |
| Paper/report compilation | Diagnostic draft papers retain run/evidence links; reports capture models as well as runs and paper revisions |
| External Python execution | Separately run trusted model adapters and supported diagnostics, subject to format, runtime and explicit trust gates |
| External result import | Signed result ingestion into the hosted engagement is future work |
| Training reproduction and advanced procedures | Cross-validation, SHAP, LIME and broader adversarial testing are future work; no success outcome for unavailable capabilities |

The hosted CSV limits, concurrency quotas and parser bounds remain enforced by the actual API and runner. The guided interface should show those limits before submission. Unsupported tasks and procedures should have an explanation and a usable next step rather than an execution button that appears to work.

## 3. Append-only model versions and cards

Each registered version has its own record identity. Creating a new version/card preserves previous registrations; it never rewrites the metadata used by an earlier run. A card revision that changes evaluation semantics creates a new registered version. Human-readable version labels help navigation, but stable record IDs and hashes determine provenance.

Capture these groups of properties:

| Group | Card content |
|---|---|
| Identity | Name, version label, task, format, freeform algorithm and framework, registration actor/time |
| Intended use | Purpose, decision or output supported, intended users/population, out-of-scope uses and known limitations |
| Source | Engagement artifact ID, artifact name/category and immutable uploaded-byte SHA-256 |
| Prediction semantics | Target/prediction interpretation, class labels and favourable outcome where applicable; regression target meaning and units |
| Training context | Training/validation references and declared preprocessing context where supplied; gaps remain visible |
| External reference | Optional Hugging Face repository, full commit and file metadata; descriptive reference only |

For a Prediction file registration, the source is accepted CSV evidence. The registered artifact hash binds the card to that exact source. At run creation, the evaluation dataset must be the same artifact ID as the model's registered prediction source; another CSV requires a new registration. This prevents silently evaluating an unrelated file under an existing model name.

That equality is a lineage control, not proof that the named model generated the predictions. The prediction-provenance declaration should identify the producing model/version, process and date, and reference corroborating evidence where available. Missing corroboration remains an audit limitation.

A Hugging Face reference does not grant trust, executable status, license approval or regulatory approval. Use an explicit full commit rather than a mutable branch label for the optional reference. The platform records the supplied metadata without fetching the repository. Locally uploaded evidence remains the consumed source of truth; the commit reference and uploaded-byte hash have different meanings.

## 4. Reusable immutable evaluation profiles

An EvaluationProfile defines what is to be tested and why. Profiles are reusable within the selected engagement, versioned and immutable after saving. Editing a saved profile creates a new version; it does not change queued, completed or reported runs. The current storage implementation uses the engagement JSON aggregate, with the same tenant/engagement authorization and optimistic concurrency as its other records. A future normalized store can preserve these identities and semantics.

An evaluation profile contains:

- Name/version and task; selected eligible test IDs.
- Explicit target and prediction column mappings; group and favourable-label mappings only where selected procedures require them.
- Minimum evaluation sample size, group size and class denominator/support rules where applicable.
- Task-appropriate internal acceptance criteria: performance minimums or error/disparity maximums, with their rationale.
- Dataset split declaration: training, validation, locked test, production/reference or other stated role.
- Prediction and dataset provenance declarations, intended evaluation population/time context and independence limitations.
- Criterion rationale, scope and known limitations; recorded creator/time and profile identity.

The profile's declared dataset role is not an automatic leakage test. The auditor must examine supporting lineage, training records, related observations and any repeated tuning to the holdout. An existing-model holdout evaluation and training-reproduction cross-validation are different procedures.

The profile is task-aware. Binary demographic parity/disparate impact need group information and a favourable prediction outcome; equalized odds additionally needs true class denominators. Multiclass performance needs explicit label/prediction semantics and class support. Regression needs finite numerical target/prediction values and interpretable target units. A performance-only plan should not demand a protected attribute merely to complete a form.

Predefined starting criteria are illustrative internal policies. Their presence does not imply legal approval. Capture why each threshold is appropriate to the use, harm, data and audit objective before running; changing criteria later creates another immutable profile and run.

Every new hosted run uses a saved profile, so its checks cannot be bypassed: an explicit suite and configuration would skip, for example, the reviewed data-handling basis that fairness tests require. Explicit configurations remain only to retry a frozen legacy run that was queued with one.

## 5. Dataset preflight and queueing

The server preflight is authoritative; browser field validation is assistance. For an accepted Prediction file source, preflight:

1. Confirms tenant/engagement membership, evidence acceptance, source/dataset identity, artifact type and configured size limits.
2. Reads the object from the evidence bucket and verifies the bytes against the registered/uploaded SHA-256. Storage metadata alone is insufficient.
3. Parses CSV with existing bounds and rejects malformed or duplicate headers, invalid row structure, blank rows and incompatible values. A row whose cells are all empty is a record with every value missing, so it is refused rather than dropped; line breaks that end the file are not rows.
4. Produces a parsed column profile: headers, row count, missingness and task-relevant label, class/group or numeric support information.
5. Validates every selected test's required mappings and task compatibility. Ambiguous labels, absent columns, non-finite regression values and unmet structural requirements have actionable messages.
6. Presents the registered source, profile version, declared split/provenance and limitations for confirmation before creating the run.

Column inspection does not need to render raw personal rows. Group or class summaries can themselves be sensitive; keep their visibility and handling tied to the engagement's approved evidence practices. A synthetic/anonymized/reviewed handling declaration does not independently establish a lawful processing basis.

Repeat integrity verification immediately before execution. If stored bytes changed, fail the run visibly; do not recompute a new input hash and accept the substituted file. Structural input failures and integrity failures are distinct from a metric being outside its internal criterion.

## 6. Hosted metric semantics

### Binary classification

Performance is measured on its own positive class, the class the protocol's minimum recall applies to. It defaults to the favourable label and is frozen with a protocol that includes the performance test; a protocol without one freezes no performance positive class, and its runs do not require one among the labels. Demographic parity, disparate impact and equalized odds keep counting the favourable outcome. Results report accuracy; precision, recall (sensitivity) and F1 of the positive class; specificity, the recall of the other class; balanced accuracy with each class's support and recall; the positive class's prevalence; and the majority-class baseline, the accuracy of always predicting the more frequent reference class.

The criterion (test definitions `traditional-ml-2.1.0`) is inconclusive below the total or per-class support minimum. It fails when balanced accuracy does not exceed 50%, which a constant prediction of either class never does at any class balance, and when accuracy or recall misses its threshold. It is inconclusive when accuracy meets its threshold but does not exceed the majority-class baseline: at that class balance the accuracy criterion cannot show that the model performs. Otherwise it passes. The rules compare point estimates; they sit in `site-app/lib/diagnostic-decisions.ts` so interval-based rules can replace them.

Preserve actual support and undefined-denominator limitations. An inconclusive fairness result names its cause: too few rows, fewer than two groups, groups below the minimum size, groups without both outcomes (equalized odds) or no favourable prediction at all (disparate impact). Group fairness is a diagnostic signal, not a legal finding by itself. A policy ratio such as 0.8 is not a statutory EU AI Act compliance threshold.

### Multiclass classification

Compute actual classification metrics from the saved labels and predictions: overall accuracy, macro F1, balanced accuracy, the majority-class baseline and per-class support. Make the evaluated class set explicit and show unsupported or absent class denominators. Macro metrics give each class equal influence; they should not hide rare-class support or be represented as a guarantee of use-case suitability. Apply the profile's minimum sample/class support criteria to the reference classes and report inconclusive outcomes where a meaningful assessment cannot be supported. A predicted label absent from the reference column is flagged and counts as an error; it does not make a failing result inconclusive. The binary rules apply with balanced accuracy, averaged over the reference classes, compared against the 1/k of a constant prediction.

### Regression

Compute MAE and RMSE in the target's units, and R-squared as a dimensionless measure. Validate finite values and retain actual evaluated sample counts. Constant-target data makes ordinary R-squared undefined; do not manufacture a successful score. An undefined metric should be presented with its reason, and its effect on the procedure outcome should follow the declared policy. R-squared can be negative; do not clamp it to zero or treat it as a probability.

For every task, distinguish execution state from result outcome. A successfully executed job may produce an outside-criterion or inconclusive result. Failed/cancelled execution cannot become a pass, and an unavailable selected procedure cannot silently disappear from the result set. A run fails when any result fails and passes only when every result passes; no results, or an unrecognised outcome, make it inconclusive, never a pass.

## 7. Frozen traceability from run to report

At queueing, freeze the model/card, evaluation profile and dataset input manifest into the run. Record hashes for the consumed dataset bytes, source artifact, captured model metadata/card and captured evaluation profile, with their meanings clearly labelled. A model-metadata hash is not a model-binary hash.

The input manifest identifies the engagement, source artifact/name/type/byte hash, model version identity, profile identity/version, task, mappings, tests and declared dataset split/provenance. Execution records the runner/policy version and the actual inputs consumed. The record remains explainable after a newer model/card/profile is created.

The audit chain is:

```text
Registered model/card version + accepted source artifact + evaluation profile version
  -> frozen run input manifest and verified consumed bytes
  -> diagnostic results and limitations
  -> draft working paper with evidence IDs and run IDs
  -> independently reviewed and signed paper revision
  -> frozen report containing model/run snapshots and captured paper revisions
```

Generated papers are diagnostic drafts. Keep objective, procedure, result, limitations and evidence references distinct from the human evaluation/conclusion. Preserve draft provenance when an auditor adds analysis. A later evaluation creates another run; it must not overwrite an earlier result or an edited/signed paper.

Report assembly captures models alongside runs, evidence, findings and paper revisions. Historical detail views use those snapshots, not current inventory labels. Client releases continue to use an explicit permitted projection; adding internal model cards or protocols to a full snapshot does not authorize releasing them to Client Viewers.

Existing review independence remains in force: authors/contributors cannot approve their own review; signing requires the qualifying independent review of the current revision and a different signing Lead. New registration/profile conveniences must not bypass those gates.

## 8. External Python capabilities and future integration

The external Python engine is a separately executed path, not a hidden capability of the hosted browser runner. Its existing saved-prediction procedures and reference/current numeric drift can be run locally using its documented configuration.

Trusted native inference adapters exist for ONNX, PMML, native XGBoost JSON and native LightGBM text, subject to explicit trust, file/format/schema validation and the required optional runtimes. PMML additionally requires the separately provisioned Java/runtime path. Pickle/joblib loading is prohibited by the existing optional-adapter implementation; a Scikit-learn inventory label does not enable arbitrary Python deserialization. Ordered numeric features, output-label semantics and supported shapes remain required. Missing runtime or adapter support is an unavailable capability, not a completed test.

The existing external model-diagnostics code supports held-out numeric permutation importance and a constrained one-feature perturbation procedure with a declared approved protocol. These remain separate from browser saved-prediction testing. Permutation importance is exploratory relevance evidence, and constrained perturbations are local sensitivity evidence; neither is an explanation of causality or a cybersecurity certification. An explicit trust flag and subprocess are not proof of a production isolation boundary.

Not implemented by this increment:

- Hosted worker dispatch for native model inference or automatic retrieval from Hugging Face.
- Signed external-result ingestion, authenticated callbacks and validation of result signatures into the engagement.
- Reproducible training/cross-validation, SHAP, LIME, broad adversarial testing or general classical NLP evaluation.
- Proof of dataset representativeness, inference lineage, holdout independence or Art. 9-15 compliance from automated metrics alone.

Future signed-result ingestion must validate tenant/engagement, frozen model/dataset/profile identities, actual input/output hashes, runner identity and capability, attempt/cancellation state, result schema and signature before attaching anything to a paper. Duplicate ingestion must be idempotent, and corrections must create a superseding result rather than editing a previously captured result.

## 9. Guided user experience

Keep Testing lab focused on Models, Evaluation profiles and Runs, with compact lists and contextual creation actions. A model/card page provides purpose and limitations first, then source, versions, evaluations and audit links. Detailed technical and external-reference properties can be expanded when needed.

The run flow is: choose the registered version -> choose an existing immutable profile or create a new version -> inspect the source's parsed column profile and validate mappings -> review the frozen plan -> run -> inspect results and open generated papers. Explain the next resolvable requirement beside a blocked action. Do not ask users to configure tests unsupported by their task or available runner.

Use readable result sections for measurements, support, policy criteria and limitations. Prefer “Within internal criterion”, “Outside internal criterion” and “Inconclusive” to any badge suggesting legal compliance. Keep raw JSON as an optional export, and make the frozen model/profile/source links accessible from the result and its captured report.

## 10. Acceptance evidence for the increment

Before describing the increment as available, verify these behaviors with meaningful fixtures and server/API checks:

- New model/profile versions preserve older records; their hashes and snapshots remain unchanged in completed runs and reports.
- An unrelated prediction CSV is rejected, even when accepted and in the same engagement; an altered stored source fails before computation.
- Missing/duplicate columns, invalid labels, unsupported task/test combinations, non-finite numeric values and ambiguous mappings fail with a useful reason.
- Binary procedures preserve their existing calculations; multiclass analytic fixtures verify macro/class support calculations; regression fixtures verify MAE/RMSE and undefined/negative R-squared behavior.
- Insufficient support, failed/cancelled work and unavailable capabilities never become successful diagnostic outcomes.
- A generated paper resolves to its exact run, model/card/profile and evidence; a later registration does not alter captured report content.
- Client projections and exports preserve existing object-level authorization and omit unreleased internal cards/protocols.
- Optional HF metadata remains metadata only; native model execution remains gated and external; no unavailable advanced procedure is represented as implemented.

Retain actual release test results separately. This specification establishes what those tests must substantiate.
