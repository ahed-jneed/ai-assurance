"""Human-versus-judge label files (`genai-judge-validation/0.1`, design section 7.9) and Cohen's kappa (section 8.7)."""
from __future__ import annotations

import math

from ... import statistics as core
from .. import hashing
from ..errors import require
from ..readers import load_jsonl

FORMAT = "judge_validation_jsonl"
SCHEMA = "genai-judge-validation/0.1"
MAX_LABEL = 100


def detect(first_row) -> bool:
    return isinstance(first_row, dict) and first_row.get("schemaVersion") == SCHEMA and first_row.get("kind") == "header"


def _text(value, nullable=True):
    return (nullable and value is None) or (isinstance(value, str) and 0 < len(value) <= 300)


def parse(spec, data):
    name = spec["name"]
    rows = load_jsonl(data, name)
    require(rows and detect(rows[0][1]), "format_mismatch", name)
    header = rows[0][1]
    judge = header.get("judge") if isinstance(header.get("judge"), dict) else None
    sampled = header.get("sampledFrom") if isinstance(header.get("sampledFrom"), dict) else None
    label_set = header.get("labelSet")
    require(judge is not None and sampled is not None, "invalid_json", f"{name}:1: header")
    require(isinstance(label_set, list) and len(set(label_set)) >= 2 and len(label_set) == len(set(label_set)) and all(isinstance(v, str) and 0 < len(v) <= MAX_LABEL for v in label_set), "invalid_json", f"{name}:1: labelSet")
    require(all(_text(judge.get(k)) for k in ("model", "snapshot")) and (judge.get("promptTemplateSha256") is None or (isinstance(judge.get("promptTemplateSha256"), str) and hashing.SHA256.match(judge["promptTemplateSha256"]))), "invalid_json", f"{name}:1: judge")
    dataset = sampled.get("dataset") if isinstance(sampled.get("dataset"), dict) else {}
    fp = sampled.get("datasetFingerprint")
    require(fp is None or (isinstance(fp, str) and hashing.SHA256.match(fp)), "invalid_json", f"{name}:1: datasetFingerprint")
    labels, keys, pairs = [], set(), {}
    for number, row in rows[1:]:
        require(row.get("schemaVersion") == SCHEMA and row.get("kind") == "label", "invalid_json", f"{name}:{number}")
        key = row.get("itemKey")
        require(isinstance(key, str) and 0 < len(key) <= 512 and key not in keys, "invalid_json", f"{name}:{number}: itemKey must be unique")
        keys.add(key)
        human, judged = row.get("humanLabel"), row.get("judgeLabel")
        pair_id, order = row.get("pairId"), row.get("order")
        if pair_id is not None:
            require(isinstance(pair_id, str) and order in ("AB", "BA") and judged in ("A", "B", "tie"), "invalid_json", f"{name}:{number}: pairwise row")
            require((pair_id, order) not in pairs, "invalid_json", f"{name}:{number}: duplicate pair order")
            pairs[(pair_id, order)] = judged
        require(human in label_set and judged in label_set, "invalid_json", f"{name}:{number}: labels must come from labelSet")
        labels.append((human, judged))
    return {
        "sha256": spec["sha256"],
        "judge": {"model": judge.get("model"), "snapshot": judge.get("snapshot"), "promptTemplateSha256": judge.get("promptTemplateSha256")},
        "sampledFrom": {"dataset": {"name": dataset.get("name") if _text(dataset.get("name")) else None, "version": dataset.get("version") if _text(dataset.get("version")) else None},
                        "datasetFingerprint": fp, "runKey": sampled.get("runKey") if _text(sampled.get("runKey")) else None},
        "labelSet": list(label_set),
        "labels": labels,
        "itemKeys": keys,
        "pairs": pairs,
    }


def kappa(labels, label_set, level=0.95):
    """Cohen's kappa with the Fleiss-Cohen-Everitt large-sample standard error."""
    n = len(labels)
    index = {v: i for i, v in enumerate(label_set)}
    k = len(label_set)
    table = [[0] * k for _ in range(k)]
    for human, judged in labels:
        table[index[human]][index[judged]] += 1
    out = {"n": n, "table": table, "kappa": None, "se": None, "lower": None, "upper": None, "observedAgreement": None, "chanceAgreement": None, "level": level, "reasons": []}
    if n == 0:
        out["reasons"].append("kappa_undefined")
        return out
    p = [[table[i][j] / n for j in range(k)] for i in range(k)]
    rows = [sum(p[i]) for i in range(k)]
    cols = [sum(p[i][j] for i in range(k)) for j in range(k)]
    po = sum(p[i][i] for i in range(k))
    pe = sum(rows[i] * cols[i] for i in range(k))
    out["observedAgreement"], out["chanceAgreement"] = po, pe
    if abs(1.0 - pe) <= 1e-15:
        out["reasons"].append("kappa_undefined")
        return out
    kap = (po - pe) / (1.0 - pe)
    a = math.fsum(p[i][i] * (1.0 - (rows[i] + cols[i]) * (1.0 - kap)) ** 2 for i in range(k))
    b = (1.0 - kap) ** 2 * math.fsum(p[i][j] * (cols[i] + rows[j]) ** 2 for i in range(k) for j in range(k) if i != j)
    c = (kap - pe * (1.0 - kap)) ** 2
    var = max((a + b - c) / ((1.0 - pe) ** 2 * n), 0.0)
    se = math.sqrt(var)
    z = core.zcrit(level)
    out.update({"kappa": kap, "se": se, "lower": kap - z * se, "upper": kap + z * se})
    return out


def position_consistency(pairs, level=0.95):
    ids = sorted({pid for pid, _ in pairs})
    complete = [pid for pid in ids if (pid, "AB") in pairs and (pid, "BA") in pairs]
    mirror = {"A": "B", "B": "A", "tie": "tie"}
    consistent = sum(1 for pid in complete if mirror[pairs[(pid, "AB")]] == pairs[(pid, "BA")])
    if not complete:
        return {"consistent": 0, "pairs": 0, "estimate": None, "lower": None}
    lower, _ = core.wilson(consistent, len(complete), core.zcrit(level))
    return {"consistent": consistent, "pairs": len(complete), "estimate": consistent / len(complete), "lower": lower}
