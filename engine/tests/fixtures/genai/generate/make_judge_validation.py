"""Write the two synthetic judge-validation fixtures (human vs judge labels) with fixed confusion tables."""
import json
import random
import sys
from pathlib import Path

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def build(name, table, prefix):
    cells = [("pass", "pass", table[0][0]), ("pass", "fail", table[0][1]), ("fail", "pass", table[1][0]), ("fail", "fail", table[1][1])]
    rows = [(h, j) for h, j, c in cells for _ in range(c)]
    random.Random(31).shuffle(rows)
    with open(out / name, "w", encoding="utf-8", newline="\n") as handle:
        for i, (h, j) in enumerate(rows, 1):
            handle.write(json.dumps({"schemaVersion": "genai-judge-validation/0.1", "itemKey": f"{prefix}-{i:03d}", "humanLabel": h, "judgeLabel": j, "raterId": "rater-a" if i % 2 else "rater-b"}, separators=(",", ":")) + "\n")
    print(name, len(rows))


build("judge_small_60.jsonl", [[34, 4], [5, 17]], "jv60")
build("judge_large_200.jsonl", [[112, 8], [9, 71]], "jv200")
