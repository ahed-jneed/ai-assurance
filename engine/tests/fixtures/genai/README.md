# GenAI evidence fixtures

Small real outputs of the evaluation tools that `docs/design/genai-evidence.md` (issue #31) supports. Issue #32 uses them for parser, recomputation and fuzz tests. Every file was produced on 2026-11-05 by running the tool itself in a throwaway virtualenv or npm prefix outside this repository, with no network access to any model provider and no API keys. Models are the tools' own offline test doubles (Inspect `mockllm`, lm-evaluation-harness `dummy`, promptfoo `echo` or a local stub, garak `test.Repeat`) or deterministic stubs written for this purpose (`generate/`). The fixtures are therefore format samples, not evidence about any real model.

Each tool output is under 100 KB; the reference file `normalized-items.jsonl` is about 190 KB. The `.gitattributes` in this directory switches off line-ending conversion, because `expected.json`, `normalized-examples.json` and `normalized-items.jsonl` pin the SHA-256 of these exact bytes. `engine/.dockerignore` keeps this directory out of the worker image's build context, so none of these files ship in the image.

## Files

| File | Tool and version (tool licence) | How it was produced | What it exercises |
|---|---|---|---|
| `inspect/tiny_qa.eval` | Inspect AI 0.3.287, log version 2 (MIT) | `generate/inspect_tiny.py`: 4 samples x 2 epochs, `match()` plus `model_graded_qa()` with a mock judge, `mockllm/model` as the system under test | `.eval` zip with zstd entries (method 93), `header.json`, `samples/*.json`, `reductions.json`, `summaries.json`, `_journal/`; epochs; a model-graded score and the judge's model events (`origin: "scorer"`); cluster key `passage_id` |
| `inspect/tiny_qa.edited.eval` | Inspect AI 0.3.287 | Same run after `edit_score()` (q4 epoch 1: I to C, with `ProvenanceData`), `edit_eval_log()` (`TagsEdit`, `MetadataEdit`) and `invalidate_samples()` (q3 epoch 2), then `write_eval_log()` | Post-run edits: `log_updates`, `Score.history`, `score_edit` events, `invalidation`, `invalidated: true`; header metrics recomputed by Inspect after the edit (0.625) |
| `inspect/canary_injection.json` | Inspect AI 0.3.287 | `generate/inspect_canary.py`, written with `log_format="json"` | The plain JSON log format; an attack-style task where score `C` means the canary leaked; per-sample `technique` metadata |
| `inspect/tiny_agent.eval` | Inspect AI 0.3.287 | `generate/inspect_agent.py`: one `add` tool, 3 tasks x 4 epochs, scripted success pattern 4/4, 2/4, 0/4 | Tool definitions in model events, tool events, pass^k and pass@k |
| `inspect/judged_qa_30.eval` | Inspect AI 0.3.287 | `generate/inspect_judged30.py`: 30 samples, `model_graded_qa()` primary scorer with a mock judge, 27/30 correct | Sized for the #33 readiness-gate end-to-end test: n = 30 meets the minimum-sample floor of `docs/design/audit-statistics.md` |
| `lm_eval/results_2026-11-05T16-54-06.848117.json` | lm-evaluation-harness 0.4.13 (MIT) | From `generate/lm_eval/`: `lm-eval run --model dummy --tasks tiny_mc,tiny_gen --include_path . --output_path out --log_samples`, with the task YAML files and local JSONL datasets there | Aggregate results, `configs`, `versions`, `n-samples`, `task_hashes`, `config.random_seed`, epoch `date` |
| `lm_eval/samples_tiny_mc_2026-11-05T16-54-06.848117.jsonl` | lm-evaluation-harness 0.4.13 | Same run | `multiple_choice` samples: `doc_id`, `doc`, `arguments`, stringified `resps`, `doc_hash`, `prompt_hash`, `target_hash`, per-metric values; cluster field `doc.passage` |
| `lm_eval/samples_tiny_gen_2026-11-05T16-54-06.848117.jsonl` | lm-evaluation-harness 0.4.13 | Same run | `generate_until` with `repeats: 2` and a named filter (`strip`) |
| `promptfoo/echo_repeat.results.json` | promptfoo 0.125.1, results version 3 (MIT) | `promptfoo eval -c generate/promptfoo/echo_repeat.promptfooconfig.yaml -o results.json --repeat 2 --no-cache` with the built-in `echo` provider | Results v3: `results.results[]`, `repeatGroupId`, `repeatIndex`, `failureReason`, `gradingResult.componentResults`, `results.repeatStability` (promptfoo's own Wilson intervals), `metadata.promptfooVersion` |
| `promptfoo/redteam_shaped.results.json` | promptfoo 0.125.1 | `promptfoo eval -c generate/promptfoo/redteam_shaped.promptfooconfig.yaml` with a local deterministic target (`generate/promptfoo/target.js`) | Red-team-shaped metadata (`pluginId`, `strategyId`, `severity`, `harmCategory`, `goal`, the keys `promptfoo redteam generate` writes; see the design document), a chat-format prompt with a system message, and one provider error (`failureReason: 2`). Grading uses deterministic assertions, not the `promptfoo:redteam:*` model graders, because `promptfoo redteam` requires promptfoo cloud email verification, which was not done |
| `garak/tiny.report.jsonl` | garak 0.17.1 (Apache-2.0) | `python -m garak --target_type test.Repeat --spec probes.lmrc.Anthropomorphisation,probes.goodside.WhoIsRiley --generations 2 --seed 1234 --report_prefix tiny` | Entry types `start_run setup`, `init`, `plugin_cache`, `attempt` (status 1 then 2), `eval`, `probe_summary`, `completion`, `digest`; detector scores per generation; probe tags such as `owasp:llm09` (OWASP 2023 numbering) |
| `garak/tiny.hitlog.jsonl` | garak 0.17.1 | Same run | One row per hit (attempt and generation) |
| `pyrit/attacks.pyrit-export.jsonl` | PyRIT 1.1.0 (MIT) | `generate/pyrit_tiny.py`: `PromptSendingAttack` with and without `Base64Converter`, `SubStringScorer`, a local deterministic target; exported with PyRIT's own pydantic `model_dump(mode="json")` | The `pyrit-export/1` contract defined in the design document (PyRIT 1.1.0 has no file exporter): `AttackResult`, `MessagePiece` (with `original_value_sha256`, `converted_value_sha256`), `Score` |
| `deepeval/test_run_20261105_170925.json` | DeepEval 4.3.3 (Apache-2.0) | `generate/deepeval_tiny.py` with `DEEPEVAL_RESULTS_FOLDER`: `ExactMatchMetric`, `PatternMatchMetric` and `FaithfulnessMetric` judged by a deterministic stub model | `testCases[].metricsData[]` with `evaluationModel` and `verboseLogs`; the file records no DeepEval version and no system-under-test identity |
| `ragas/results.jsonl` | Ragas 0.4.3 (Apache-2.0) | `generate/ragas_tiny.py`: `evaluate()` with non-LLM metrics, exported with `result.to_pandas().to_json(orient="records", lines=True)` | Per-row metric columns; no run metadata at all |
| `judge_validation/judge_small_60.jsonl` | none (synthetic) | `generate/make_judge_validation.py` | The `genai-judge-validation/0.1` format: a header line binding the labels to J1 of `inspect/judged_qa_30.eval` (judge model and snapshot, judge configuration hash, dataset fingerprint), then 60 label lines; kappa 0.6739 with a 95% lower bound of 0.4786, so the judge is **not** validated under the default rule |
| `judge_validation/judge_large_200.jsonl` | none (synthetic) | Same script | The same header, then 200 label lines; kappa 0.8225 with a 95% lower bound of 0.7419, so the judge **is** validated under the default rule |

| `marking/c2pa_reports.jsonl` | none (synthetic, #128) | `generate/make_marking_sources.py` | The `genai-c2pa-report/0.1` format: 80 sampled outputs, each with a `report` shaped like the manifest store report of the C2PA reference implementation (`active_manifest`, `manifests`, `validation_results`, `validation_state`). Written by the script, not by running a validator: 40 marked images (3 with a failure code, 2 without an AI digital source type, 4 signed by an untrusted credential), 10 re-encoded copies without a manifest, 30 human-made controls |
| `marking/signed_detections.jsonl` | none (synthetic, #128) | Same script | The `genai-signed-detection/0.1` format: 100 detection results in DSSE envelopes, each signed with Ed25519 by a **TEST-ONLY** key whose seed is a public phrase in the script (never trust it outside tests); 40 marked, 30 cropped and 30 human-made outputs, one inconclusive control |
| `marking/detection-key.json` | none (#128) | Same script | The test key's public key as a plan pins it (`plan.detectionKeys[]`) |

Reference values:

- `expected.json` holds the design-time values that the engine must reproduce: counts, estimates, standard errors (IID and clustered), Wilson intervals (including the degenerate clustered case), attack-success members per `groupBy`, pass^k, paired differences, kappa and the label-file binding. Wilson, kappa, paired-difference and normal-quantile values were cross-checked against statsmodels 0.15.0 and scipy 1.17.1, and the values added after review against statsmodels 0.14.0.
- `normalized-items.jsonl` holds every per-item record (122) that the design's mapping rules produce from the fixtures: canonical JSON, one record per line, sorted by bundle and then `itemKey`. Every key in it follows the derivations of design section 6.2.
- `normalized-examples.json` holds, for each bundle, the reference plan used (cluster, technique, task-type and primary-score keys), and for each run its run metadata, status counts and first record. All 122 records and all 13 run-metadata blocks validate against `schemas/genai-evidence-item.schema.json` with `jsonschema` (Draft 2020-12) and with Ajv 2020 in strict mode.

These files come from throwaway scripts that apply the design text, not from engine code. #32 must re-derive them independently and resolve any disagreement rather than copying the values.

## Modifications after generation

- `promptfoo/*.json`: the absolute scratch-directory path in `config.basePath` and in one provider-error stack trace was replaced with `<redacted>`. No other byte changed, and each file still parses as JSON.
- `garak/tiny.report.jsonl`: the same replacement in `_config.config_files`, `transient.report_filename` and the digest's copy of the setup entry.
- The Inspect, lm-evaluation-harness, PyRIT, DeepEval and Ragas files are byte-for-byte as written by the tools. The Inspect scripts were run from the directory that contains them, so `eval.task_file` is a bare file name.

All files were scanned for user names, home-directory paths, API-key patterns and non-finite JSON tokens before commit; none remain.

## Regenerating

Use throwaway environments outside the repository, never `engine/` or `site-app/` dependencies:

```text
python -m venv <tmp>/inspect && <tmp>/inspect/bin/pip install inspect_ai==0.3.287
cd engine/tests/fixtures/genai/generate && <tmp>/inspect/bin/python -I inspect_tiny.py <out>
python -m venv <tmp>/lmeval && <tmp>/lmeval/bin/pip install lm_eval==0.4.13
npm install --prefix <tmp>/pf promptfoo@0.125.1
python -m venv <tmp>/garak && <tmp>/garak/bin/pip install garak==0.17.1
python -m venv <tmp>/pyrit && <tmp>/pyrit/bin/pip install pyrit==1.1.0
python -m venv <tmp>/deepeval && <tmp>/deepeval/bin/pip install deepeval==4.3.3
python -m venv <tmp>/ragas && <tmp>/ragas/bin/pip install ragas==0.4.3 rapidfuzz "langchain-community==0.3.31"
```

Observed while generating (5 November 2026):

- promptfoo 0.125.1 requires Node.js 22.22 or later. The host had 22.21.1, so `dist/src/main.js` was run directly, bypassing only the version gate in `entrypoint.js`.
- Ragas 0.4.3 fails to import with langchain-community 0.4.2 (`langchain_community.chat_models.vertexai` no longer exists). Pinning langchain-community 0.3.31 fixes it. Its string-similarity metric also needs `rapidfuzz`.
- garak 0.17.1 deprecates `--probes` in favour of `--spec probes.<module>.<Class>`.
- Regenerated logs differ in identifiers, timestamps and therefore hashes, so `expected.json`, `normalized-examples.json` and `normalized-items.jsonl` must be regenerated with them. The judge-validation headers carry the judge configuration hash and dataset fingerprint of `inspect/judged_qa_30.eval`, so they must be updated when that log is regenerated.
