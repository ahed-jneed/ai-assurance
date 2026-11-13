"""GenAI evaluation evidence: ingest, recompute, attest (docs/design/genai-evidence.md).

The package reads the per-item records that evaluation tools already write
(Inspect, lm-evaluation-harness, promptfoo, garak, PyRIT, DeepEval, Ragas),
recomputes every statistic itself and binds the result to the hashed source
logs. Parsers are pure functions over bytes: they never execute, import or
deserialize code that an ingested file names. Standard library only, except
the optional `zstandard` back-end for Inspect `.eval` archives below
Python 3.14 and `cryptography` for the Ed25519 signatures of signed detection
results (both installed in the compute image).
"""

# 0.2.0 (#128): inert excerpts when the plan enables them, C2PA validator reports, and signed detection
# results verified against keys pinned in the plan.
GENAI_VERSION = "0.2.0"
