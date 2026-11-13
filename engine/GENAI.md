# GenAI evaluation evidence: `engine.genai`

`engine/genai/` implements the engine side of `docs/design/genai-evidence.md` (#31) for issue #32: it **ingests** the per-item records that evaluation tools already write, **recomputes** every statistic itself, and **binds** the result to the hashed source logs in a `genai-result/0.1` envelope that the workspace (#33) can import. It runs no harness and never executes, imports or deserializes code an ingested file names: task files, scorer names, `!function` hooks, JavaScript assertions and `file://` providers are strings. Parsers are pure functions over bytes.

The core is standard-library only. Inspect `.eval` logs are zip archives with zstd entries: reading them needs `compression.zstd` (Python 3.14 and later) or `zstandard==0.25.0`. On the supported Python 3.12 that is `zstandard`, which the compute image installs hash-locked from `requirements-image.txt` and `requirements-dev.txt` and `requirements-optional.txt` pin at the same version (`README.md`, section Packaging). Without either, a `.eval` input fails with `zstd_unavailable`.

## Command line

From the repository root:

```powershell
python -m engine.genai detect --input engine/tests/fixtures/genai/inspect/judged_qa_30.eval
python -m engine.genai ingest --manifest bundle.json --plan plan.json --input judged_qa_30.eval --input judge_large_200.jsonl --output result.json [--items-output items.jsonl]
python -m engine.genai verify --envelope result.json --manifest bundle.json --plan plan.json --input judged_qa_30.eval --input judge_large_200.jsonl
python -m engine.genai kappa --labels judge_large_200.jsonl [--level 0.95]
```

- Exit codes: `0` success; `2` input rejected, with `{"error": "<code>"}` on stderr and no output file; `3` `verify` found a different `computationSha256` or `itemsSha256`.
- Outputs are created once and never overwritten. The CLI prints hashes, codes and counts, never ingested text.
- `ingest` is deterministic: the same inputs, plan, manifest and engine version give byte-identical `computationJSON` and `itemsJSONL`; time appears only in `provenance`. `verify` is the re-performance check a reviewer can run.
- Inputs are matched to the manifest by SHA-256, never by name or path. Detection uses content; the detected format must equal the declared one.

`engine.genai.ingest.run_bundle(inputs, manifest, plan, provenance=...)` is the one entry point; the CLI and the future `genai_ingest` worker job (follow-up G5 below) call it.

## Inputs

**Bundle manifest** (`genai-bundle/0.1`, `schemas/genai-result.schema.json#/$defs/manifest`, design section 6.3): `origin` (`auditee_supplied` or `auditor_rerun`), `inputs[]` (`name`, `sha256`, `bytes`, `format`, `role`, optional `judgeRef` for label files and `runKey` for PyRIT, DeepEval and Ragas), and `declared` values for what logs do not record: `harness`, `systemUnderTest` (`model`, `snapshot`, `provider`, `family`), `systemPrompt`, `decoding`, `tools` (with permissions), `dataset`, `attackSet`, `judges[]` (`ref`, `model`, `snapshot`, `family`, `promptTemplateSha256`, `scores`, `pairwise`), `scorers[]` (an `unknown` score declared deterministic) and `dates.utcOffset` (garak's naive timestamps). Families come from the closed vocabulary of the item schema (`$defs/family`). A declaration never overrides an extracted value; a disagreement adds `declaration_conflict`, and a family that the model-name heuristic contradicts adds `family_declaration_conflict`.

**Plan** (`genai-plan/0.1`, `$defs/plan`, design section 8.1): frozen before ingestion and bound by `planSha256`. Floors can be raised, never lowered (`minimums` 30 / 10 / 10, `judgeValidation` 50 items and kappa lower bound 0.60, pairwise position consistency 0.80, different families required; `maxUnscoredFraction` and `maxErrorFraction` at most 0.05). Criteria kinds: `genai_mean`, `genai_attack_success` (`groupBy` technique, variant, technique_variant, category or none), `genai_pass_k`, `genai_paired_difference` and `genai_marking`.

## Formats

| Format | Tool output | Verified | Notes |
|---|---|---|---|
| `inspect_eval`, `inspect_json` | Inspect `.eval` (zip, zstd) or `--log-format json` | log version 2, inspect_ai 0.3.287 | Post-run edits (`log_updates`, score history, invalidations) are listed; `scorePolicy` chooses the original or the as-edited scores; scorer kind `model_graded` when the scorer span holds a judge model event |
| `lm_eval_samples` | `results_<date>.json` (role `results`) plus `samples_<task>_<date>.jsonl` (role `samples`) from `--log_samples` | 0.4.13 (0.4.x) | One run per task; rows of one document under several filters merge into one item; `doc_hash`, `prompt_hash`, `target_hash` and `task_hashes` are recomputed, and a mismatch caps the run at L1 |
| `promptfoo_results` | `promptfoo eval -o results.json` or `promptfoo export eval` | results version 3 (0.125.1, 0.118.0) | One run per provider id, label and prompt; `overall` takes the most restrictive kind of its assertions; red-team semantics from `testCase.metadata.pluginId` |
| `garak_report` | `<prefix>.report.jsonl` (role `log`) plus optional `<prefix>.hitlog.jsonl` (role `hitlog`) | 0.17.1 (0.17.x) | One item per attempt and generation; detectors are scores of that item; `eval` counts and hit-log rows reconcile exactly |
| `pyrit_export` | `pyrit-export/1` JSONL (recipe below) | PyRIT major version 1 (1.1.0) | Piece hashes are recomputed; every minor release must be re-verified (design Q5); switch to PyRIT's own `--output json` when it ships |
| `deepeval_test_run` | `test_run_<timestamp>.json` from `DEEPEVAL_RESULTS_FOLDER` | declared `harness.version` 4.3.x | The file records no version or model: declare them |
| `ragas_results` | `result.to_pandas().to_json(path, orient="records", lines=True)` | declared `harness.version` 0.4.x | CSV is rejected; LLM metric columns are `unknown` until a declared judge names them |
| `judge_validation_jsonl` | `genai-judge-validation/0.1` (design section 7.9) | - | Human-versus-judge labels; bound to a declared judge with `inputs[].judgeRef` |
| `marking_check_jsonl` | `genai-marking-check/0.1` (below) | - | Art. 50 marking checks (#59, A50-ED-30) |

Outside the verified versions the parse fails with `unsupported_format_version`, unless the plan sets `allowUnverifiedFormatVersion`; the run is then capped at L1. A later tool version inside a verified contract key adds `unverified_tool_version` without a cap.

**PyRIT export recipe** (client side, with PyRIT's own serialisers; the engine never opens PyRIT memory databases):

```python
from importlib.metadata import version
from pyrit.memory import CentralMemory
memory = CentralMemory.get_memory_instance()
for result in memory.get_attack_results():
    pieces = memory.get_message_pieces(conversation_id=result.conversation_id)
    scores = memory.get_prompt_scores(prompt_ids=[str(p.id) for p in pieces])
    line = {"schema": "pyrit-export/1", "pyritVersion": version("pyrit"),
            "attackResult": result.model_dump(mode="json"),
            "messagePieces": [p.model_dump(mode="json") for p in pieces],
            "scores": [s.model_dump(mode="json") for s in scores]}
```

**promptfoo red-team runs.** The committed fixture is red-team-shaped with deterministic graders. The `promptfoo:redteam:*` grader names are verified from source only; a genuine `promptfoo redteam run` fixture needs a promptfoo account (optional owner action, #57).

## Statistics

The interval decides, as in `docs/design/audit-statistics.md`. `engine/genai/recompute.py` reuses `engine/statistics.py` (statistics 1.0.0) for the Wilson interval, its closed-form decision p-value, the normal decision p-value, the member shape, Bonferroni and Benjamini-Hochberg and the run aggregation, and adds what GenAI evidence needs:

- epoch reduction per group (`mean`, `any`, `all`, `majority`; `any` by default for attack criteria) and statistics over groups, never raw epochs;
- the IID standard error and the clustered standard error CR1 (Miller 2024, eq. 4, as Inspect implements it);
- Wilson on n for binary unclustered outcomes, otherwise Wilson on the effective sample size `min(n, p(1-p)/SE^2)`, with the worst-case design effect `n^2 / sum m_c^2` when the variance is degenerate, so a clustered all-pass or all-fail sample never gets a zero-width interval;
- attack-success members per `groupBy`, intersection-union pass and Bonferroni fail within the criterion, a worst-member headline;
- pass^k and pass@k (tau-bench and Codex estimators);
- paired differences on identity triples (`groupKey`, `promptSha256`, `targetSha256`) with the paired standard error;
- Cohen's kappa with the Fleiss-Cohen-Everitt standard error, the four-way label-file binding and position consistency for pairwise judges;
- gates: sample, member and cluster minimums, unscored and error shares, incomplete runs, missing member keys, unsupported lm-evaluation-harness aggregations;
- reconciliation with the tools' own aggregates (`match`, `mismatch`, `not_comparable`, `information`).

A `model_graded` or `unknown` score that feeds a criterion adds a `flags[]` entry (`judge_not_validated` with its reasons, or `scorer_kind_declared`): the engine still decides, and the workspace gate (#33) blocks the conclusion. A judge counts as validated only when both families are declared and differ, the label file is bound to the judge and the run (model, snapshot, judge configuration, dataset), n is at least 50 and the kappa's 95% lower bound is at least 0.60, and, for pairwise judges, the Wilson lower bound of position consistency is at least 0.80.

## Evidence levels

The engine assigns `L2` when every item was parsed from hashed, identified inputs inside the verified versions, at least one item is scored and no tool hash mismatched; otherwise `L1` (`levelReasons` says why). L0 (aggregates typed in) and L3 (an authenticated worker recomputation of an auditor re-run with an attestation) are workspace levels; an envelope uploaded by a person counts as at most L1 there (design section 4.2).

## Art. 50 marking checks (#59: A50-ED-30, A50-ED-31, A50-ED-34)

`genai-marking-check/0.1` is one JSON object per line and per checked output: `checkId`, `outputSha256`, `modality` (`text`, `image`, `audio`, `video`, `multimodal`), `format`, `channel`, `stratum` (pre-registered keys), `transformation` (`{id, parameters}` or null), `metadata` (`standard`, `present`, `validationStatus` codes such as a C2PA validator's, `signer`, `signatureVerified` as claimed), `watermark` (`detectorId`, `detectorVersion`, `score`, `threshold`, `decision`: `marked`, `not_marked` or `inconclusive`), `groundTruth` (`marked`, `human_made`, `other_ai`) and `selfIdentification` (for interaction disclosure). The records travel in `computation.marking[]` (`$defs/markingCheck`).

`genai_marking` criteria recompute `marking_presence`, `detection_rate`, `false_positive_rate`, `detection_rate_after_transformation` (needs `transformation`) and `self_identification_rate` with Wilson intervals, optionally restricted to one stratum (`"stratum": "model=gen-a"`). Inconclusive detector decisions are excluded from detection and false-positive rates.

Marking evidence levels: L0 provider-declared figures (workspace); L1 a hashed provider test log that could not be recomputed; L2 per-item marking records recomputed here; L3 an auditor-run sampling and transformation battery with an attestation that pins detector versions and inputs (workspace). The engine never runs a provider's detector or a C2PA validator, and **does not yet verify signatures**: every record with a claimed signature verdict carries `marking_signature_unverified`, and `signatureVerifiedByEngine` is always false (follow-up below).

## Security and limits

- Bounded readers (`readers.py`): strict UTF-8 without BOM, duplicate keys rejected, `NaN`/`Infinity` decoded to a marker (never a float), `1e999` rejected, depth 64, 10,000 keys per object, 16 MiB strings and JSONL lines.
- Zip (`.eval`): the central directory decides sizes and CRC-32; unsafe names, encryption, unsupported methods, oversized entries, ratios above 500:1 for entries over 1 MiB, size and CRC mismatches are rejected; decompression streams with an output cap; nothing is extracted to disk; only allowlisted entries are read.
- Limits (`limits.py`): 50 MiB per input, 64 inputs and 200 MiB per bundle, 64 MiB per zip entry and 512 MiB per archive, 50,000 items, 50 scores per item, 4 MiB inline items, 8 MiB envelope, 10 MiB completion body.
- Secrets: only allowlisted configuration keys are copied; secret-like strings are replaced by `[redacted:<12 hex>]` (`secret_like_value_redacted`) and hashed inside keys. `config.env`, provider configuration, `response.raw` and error text are never copied.
- A parser crash on structure it did not expect becomes `invalid_json` (defence in depth); the fuzz tests run with `ingest.STRICT = True` so such crashes surface and get fixed instead.

The memory and CPU measurements that design section 11.3 asks for inside the compute image (Linux, Python 3.12, `DockerExecutor --memory 1g`) are part of the worker step G5 and are not recorded yet; the limits keep the design-time values measured on CPython 3.11 (Windows, tracemalloc).

## Error codes

Errors (`GenaiInputError.code`, `engine/genai/errors.py`): `input_too_large`, `bundle_too_large`, `line_too_long`, `too_many_items`, `too_many_scores`, `nesting_too_deep`, `invalid_utf8`, `invalid_json`, `duplicate_key`, `number_out_of_range`, `unknown_format`, `format_mismatch`, `unsupported_format`, `unsupported_format_version`, `zip_invalid`, `zip_entry_unsafe_name`, `zip_entry_too_large`, `zip_entry_size_mismatch`, `zip_ratio_exceeded`, `zip_method_unsupported`, `zip_encrypted`, `zip_crc_mismatch`, `zstd_unavailable`, `missing_required_entry`, `lm_eval_bundle_mismatch`, `duplicate_item_key`, `manifest_invalid`, `plan_invalid`, `input_hash_mismatch`, `evidence_too_large`. `run_bundle` reports the reader's code for an input the readers reject (an unsafe or duplicate zip entry, a duplicate key, `1e999`, deep nesting) rather than `unknown_format`, which is left for well-formed input that matches no format; only CLI `detect` never raises. Warnings are listed in `WARNING_CODES` and reported as `{code, count, examples}`.

## Where this implementation departs from the design text

- `computation.criteria[]` sits at the top level, with `runKeys` per criterion, because members of one criterion can come from several runs; `runs[]` carry metadata, status counts, post-run edits, reconciliation, item pins, levels, claim scope and warnings.
- No excerpts in engine 0.1.0: the plan accepts only `excerpts: "none"`, so raw text never leaves the hashed logs (design Q12).
- DeepEval and Ragas inputs need a declared `harness.version` inside the verified series (the strict reading of section 7.10).
- Unscored and error shares are computed over all item records of a run; a `genai_mean` criterion gates when any selected run has fewer scored groups than `minimums.sampleSize`.
- The kappa table lists rows (human) and columns (judge) in `labelSet` order.
- promptfoo is detected only with `results.version` 3, so another version is `unknown_format`, even with `allowUnverifiedFormatVersion`, where the section 7.10 table says `unsupported_format_version`: without the version, a promptfoo file cannot be told from other JSON documents with an `evalId`.
- A manifest binds at most one label file to each declared judge: a second `inputs[].judgeRef` with the same value is `manifest_invalid`, so manifest order can never decide which kappa counts.

## Tests

`python -m unittest discover -s engine/tests -v` (with `engine/requirements-dev.txt`; CI sets `GENAI_REQUIRE_ZSTD=1`) runs:

- `test_genai_parsers.py`: every fixture reproduces its records in `engine/tests/fixtures/genai/normalized-items.jsonl` byte for byte and its run metadata in `normalized-examples.json`; tool-hash cross-checks; detection.
- `test_genai_recompute.py`: every value of `expected.json` to 1e-6 through the full pipeline, the #33 acceptance scenario (small label file blocks, large one validates), worked examples.
- `test_genai_envelope.py`: envelopes validate against `schemas/genai-result.schema.json`, determinism, the size procedure, manifest and plan rejections, the CLI, marking checks, and the committed `schemas/fixtures/genai-result.example.json` (regenerate with `python -m engine.tests.test_genai_envelope --write-example`).
- `test_genai_security.py`: logs naming code run nothing (no import, network or subprocess, no tool package loaded), JSON and zip limits, a zstd bomb, secret redaction.
- `test_genai_fuzz.py`: a seeded mutation fuzzer over every format (`GENAI_FUZZ_ITERATIONS`, default 300; `GENAI_FUZZ_SEED`, default 31) and format confusion.
- `test_genai_properties.py`: statistical, key, permutation and family properties.

`node schemas/validate-genai-schema.mjs` validates both GenAI schemas with Ajv 2020 in strict mode, the 122 reference records, the 13 run-metadata blocks and the example envelope (including both hashes), and rejects malformed and tampered copies.

## Follow-ups

- **G5, worker job `genai_ingest`**: `validate_genai_request`, the `evidence` download, the branch in `Worker.execute` and `compute_job`, `verify_genai_result_bytes`, the codes in `COMPUTE_FAILURE_CODES` and `WORKER.md` (the hash-pinned `zstandard` is already in `engine/Dockerfile` through `requirements-image.txt`, #62; `engine/genai/` already ships in the compute image through `COPY . /app/engine`; `engine/.dockerignore` excludes only `tests/fixtures/genai`), the `genaiIngest` readiness entry and the capability gate, plus the section 11.3 measurements in the compute image.
- Signature verification of signed detection results (Code Sub-measure 2.1.2) and ingestion of C2PA validator reports as their own format (A50-ED-33).
- Excerpts (`failures`, `all`) as inert text, if the workspace needs them.
- An optional coverage-guided harness (`engine/tests/fuzz/genai_atheris.py`, design section 11.5).
