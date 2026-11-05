"""Write the two synthetic judge-validation fixtures (human vs judge labels) with fixed confusion tables.

Each file starts with the genai-judge-validation/0.1 header line that binds the labels to one judge
configuration and to the task they were sampled from (docs/design/genai-evidence.md, section 7.9).
The binding values are those the design's recipes give for J1 of inspect/judged_qa_30.eval
(see normalized-examples.json): the judge configuration hash of its model_graded_qa scorer and the
run's dataset fingerprint. The snapshot is the one the section 6.3 example manifest declares.
"""
import json
import random
import sys
from pathlib import Path

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

HEADER = {
    "schemaVersion": "genai-judge-validation/0.1",
    "kind": "header",
    "judge": {
        "model": "mockllm/judge",
        "snapshot": "judge-2026-11-05",
        "promptTemplateSha256": "9c26c9772a48132d37be78270e27f56485690d1f6558a11982fcfe75a4e74014",
    },
    "sampledFrom": {
        "dataset": {"name": "judged_qa_30", "version": "1.0.0"},
        "datasetFingerprint": "0b2e5a18b3b4de0d46f4f51d9badfe9597592b910c7d62490fec6e443ff99f2f",
        "runKey": None,
    },
    "labelSet": ["fail", "pass"],
}


def build(name, table, prefix):
    cells = [("pass", "pass", table[0][0]), ("pass", "fail", table[0][1]), ("fail", "pass", table[1][0]), ("fail", "fail", table[1][1])]
    rows = [(h, j) for h, j, c in cells for _ in range(c)]
    random.Random(31).shuffle(rows)
    with open(out / name, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(HEADER, separators=(",", ":")) + "\n")
        for i, (h, j) in enumerate(rows, 1):
            handle.write(json.dumps({"schemaVersion": "genai-judge-validation/0.1", "kind": "label", "itemKey": f"{prefix}-{i:03d}", "humanLabel": h, "judgeLabel": j, "raterId": "rater-a" if i % 2 else "rater-b"}, separators=(",", ":")) + "\n")
    print(name, len(rows))


build("judge_small_60.jsonl", [[34, 4], [5, 17]], "jv60")
build("judge_large_200.jsonl", [[112, 8], [9, 71]], "jv200")
