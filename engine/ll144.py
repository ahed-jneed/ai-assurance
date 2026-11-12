"""NYC Local Law 144 bias audit computations (docs/design/audit-statistics.md section 10.2, issue #30).

Standard library only. The hosted runner mirrors this module in site-app/lib/ll144.ts, and both run the
golden cases of schemas/fixtures/ll144-golden.json (engine/tests/test_ll144.py, site-app/lib/ll144.test.ts).

The input is one record per assessed individual (or per identical individuals, with `count`): the sex and
race/ethnicity category as the individual reported it (None when unknown) and either the selection outcome
(`selected`, selection rates) or the tool's score (`score`, scoring rates). The output has one table per
dimension the rule requires: sex, race/ethnicity and the intersectional categories (sex x race/ethnicity).

- Scoring rates use the median of the full sample, every scored individual including those in an unknown
  category (6 RCNY 5-301(c)(1); specification Q4). An individual scores above the median only when the
  score is strictly greater.
- An individual whose category is unknown in a dimension is counted as unknown in that dimension's table
  (5-301(b)(5) and (c)(5)); an intersectional category needs both values.
- The auditor MAY exclude a category under 2% of the audit data from the impact ratios (5-301(d)); every
  exclusion needs a justification, and the excluded category keeps its count and rate.
- Rates carry Wilson intervals and impact ratios Katz-log or Koopman intervals. They are supplementary: the
  rule requires none, and the reference category is chosen from the data.
"""
from __future__ import annotations

import json
import math

from . import statistics as st

SPEC_VERSION = "1.0.0"
RATES = ("selection", "scoring")
DIMENSIONS = ("sex", "raceEthnicity", "intersectional")
MAX_RECORDS = 10_000_000
MAX_CATEGORIES = 100
INTERVAL_NOTE = "Supplementary; not required by the rule. The reference category is chosen from the data, so the impact-ratio intervals are conditional on that choice."


class Ll144Error(ValueError):
    """An LL144 input that the computation rejects."""


def _require(condition, message):
    if not condition:
        raise Ll144Error(message)


def category_label(values):
    """One value gives itself; several give the intersectional label, a compact JSON array (as engine/criteria.py)."""
    return values[0] if len(values) == 1 else json.dumps(values, ensure_ascii=False, separators=(",", ":"))


def _category(value, where):
    if value is None:
        return None
    _require(isinstance(value, str) and len(value) <= 200, where + " must be a category name of at most 200 characters or null")
    value = value.strip()
    return value or None


def _declared(inp, key):
    values = (inp.get("categories") or {}).get(key) or []
    _require(isinstance(values, list) and len(values) <= MAX_CATEGORIES, "categories." + key + " must list at most 100 names")
    _require(all(isinstance(v, str) and v.strip() == v and v for v in values) and len(set(values)) == len(values), "categories." + key + " must be unique, trimmed, non-empty names")
    return list(values)


def median(pairs):
    """The ordinary sample median of (score, count) pairs: the mean of the two middle values when n is even."""
    ordered = sorted(pairs)
    n = sum(count for _, count in ordered)

    def at(index):
        seen = 0
        for score, count in ordered:
            seen += count
            if index < seen:
                return score
        raise AssertionError("median index out of range")

    return at(n // 2) if n % 2 else (at(n // 2 - 1) + at(n // 2)) / 2.0


def validate(inp):
    """The records as (sex, race, outcome, count), with the rate kind, declared orders, exclusions and level."""
    _require(isinstance(inp, dict), "the LL144 input must be an object")
    unknown_fields = set(inp) - {"rate", "records", "categories", "exclusions", "confidenceLevel"}
    _require(not unknown_fields, "unknown LL144 input fields: " + ", ".join(sorted(unknown_fields)))
    rate = inp.get("rate")
    _require(rate in RATES, "rate must be selection or scoring")
    level = inp.get("confidenceLevel", 0.95)
    _require(isinstance(level, (int, float)) and not isinstance(level, bool) and 0.8 <= level <= 0.999, "confidenceLevel must be between 0.8 and 0.999")
    records = inp.get("records")
    _require(isinstance(records, list) and records, "records must list at least one individual")
    rows, total = [], 0
    for index, r in enumerate(records):
        where = f"records[{index}]"
        _require(isinstance(r, dict), where + " must be an object")
        allowed = {"sex", "raceEthnicity", "count", "selected" if rate == "selection" else "score"}
        _require(not set(r) - allowed, where + " has unknown fields: " + ", ".join(sorted(set(r) - allowed)))
        count = r.get("count", 1)
        _require(isinstance(count, int) and not isinstance(count, bool) and count >= 1, where + ".count must be a positive integer")
        if rate == "selection":
            outcome = r.get("selected")
            _require(isinstance(outcome, bool), where + ".selected must be true or false")
        else:
            outcome = r.get("score")
            _require(isinstance(outcome, (int, float)) and not isinstance(outcome, bool) and math.isfinite(outcome), where + ".score must be a finite number")
            outcome = float(outcome)
        rows.append((_category(r.get("sex"), where + ".sex"), _category(r.get("raceEthnicity"), where + ".raceEthnicity"), outcome, count))
        total += count
    _require(total <= MAX_RECORDS, "at most 10,000,000 individuals")
    declared = {"sex": _declared(inp, "sex"), "raceEthnicity": _declared(inp, "raceEthnicity")}
    exclusions = inp.get("exclusions") or []
    _require(isinstance(exclusions, list), "exclusions must be a list")
    seen = set()
    for index, x in enumerate(exclusions):
        where = f"exclusions[{index}]"
        _require(isinstance(x, dict) and set(x) == {"dimension", "category", "justification"}, where + " needs exactly dimension, category and justification")
        _require(x["dimension"] in DIMENSIONS, where + ".dimension must be sex, raceEthnicity or intersectional")
        _require(isinstance(x["category"], str) and x["category"], where + ".category must be a category name")
        _require(isinstance(x["justification"], str) and x["justification"].strip() and len(x["justification"]) <= 2000, where + ".justification must state why the category is excluded (at most 2,000 characters)")
        _require((x["dimension"], x["category"]) not in seen, where + " repeats an exclusion")
        seen.add((x["dimension"], x["category"]))
    return rate, rows, declared, exclusions, float(level)


def _order(declared, found):
    """Declared categories in their order (the rule's tables follow the EEO-1 order), then the others in code-point order."""
    return declared + sorted((v for v in found if v not in declared), key=st.code_point_key)


def ll144_audit(inp):
    """The LL144 tables for sex, race/ethnicity and intersectional categories (section 10.2)."""
    rate, rows, declared, exclusions, level = validate(inp)
    total = sum(count for *_, count in rows)
    threshold = median([(outcome, count) for _, _, outcome, count in rows]) if rate == "scoring" else None

    def hit(outcome):
        return outcome if rate == "selection" else outcome > threshold

    sexes = _order(declared["sex"], {s for s, _, _, _ in rows if s is not None})
    races = _order(declared["raceEthnicity"], {r for _, r, _, _ in rows if r is not None})
    pairs = [(s, r) for s in sexes for r in races]
    tables = []
    for dimension, names, key in (("sex", [[s] for s in sexes], lambda s, r: None if s is None else [s]), ("raceEthnicity", [[r] for r in races], lambda s, r: None if r is None else [r]), ("intersectional", [list(p) for p in pairs], lambda s, r: None if s is None or r is None else [s, r])):
        _require(len(names) <= MAX_CATEGORIES * (MAX_CATEGORIES if dimension == "intersectional" else 1), "too many categories")
        counts = {category_label(n): [0, 0] for n in names}
        unknown = 0
        for s, r, outcome, count in rows:
            parts = key(s, r)
            if parts is None:
                unknown += count
                continue
            cell = counts[category_label(parts)]
            cell[0] += count
            cell[1] += count if hit(outcome) else 0
        # Intersectional categories with no individuals and no declared parts are left out; declared ones stay.
        if dimension == "intersectional":
            names = [n for n in names if counts[category_label(n)][0] > 0 or (n[0] in declared["sex"] and n[1] in declared["raceEthnicity"])]
        mine = {x["category"]: x["justification"] for x in exclusions if x["dimension"] == dimension}
        labels = [category_label(n) for n in names]
        missing = set(mine) - set(labels)
        _require(not missing, "excluded " + dimension + " categories not in the data: " + ", ".join(sorted(missing, key=st.code_point_key)))
        try:
            table = st.evaluate_ll144({"rate": rate, "unknownCount": unknown, "excluded": sorted(mine), "categories": [{"name": label, "n": counts[label][0], "selected": counts[label][1]} for label in labels]}, level)
        except st.StatisticsError as error:
            raise Ll144Error(dimension + ": " + str(error)) from error
        notes = []
        if table["referenceCategory"] is None:
            notes.append("no_known_category")
        elif all(row["impactRatio"] is None for row in table["categories"]):
            notes.append("reference_rate_zero")
        for row, parts in zip(table["categories"], names):
            row["components"] = list(parts)
            row["exclusionJustification"] = mine.get(row["category"])
        tables.append({"dimension": dimension, **table, "notes": notes})
    return {"specificationVersion": SPEC_VERSION, "rate": rate, "confidenceLevel": level, "totalIndividuals": total, "medianScore": threshold, "intervalNote": INTERVAL_NOTE, "tables": tables}


# EEO-1 Component 1 categories in the order of the DCWP examples, as site-app/lib/ll144-audit.ts declares them.
EEO1_SEX = ["Male", "Female"]
EEO1_RACE_ETHNICITY = ["Hispanic or Latino", "White", "Black or African American", "Native Hawaiian or Pacific Islander", "Asian", "Native American or Alaska Native", "Two or More Races"]


def records_from_csv(text, *, rate, sex, race, outcome, selected=(), unknown=()):
    """The records of a CSV with one row per individual, mapped as the platform's LL144 audit maps a dataset.

    Blank cells and the `unknown` values (case-insensitive) are the unknown category. For selection rates a row
    is selected when its outcome cell is one of `selected`; for scoring rates the outcome cell is the score.
    """
    import csv
    import io

    _require(rate in RATES, "rate must be selection or scoring")
    _require(len({sex, race, outcome}) == 3, "mapped columns must be distinct")
    _require(rate == "scoring" or selected, "list the outcome values that mean selected")
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in (sex, race, outcome) if c not in (reader.fieldnames or [])]
    _require(not missing, "required column missing: " + ", ".join(missing))
    unknown_values = {v.lower() for v in unknown}
    chosen = set(selected)

    def category(value):
        value = (value or "").strip()
        return None if not value or value.lower() in unknown_values else value

    records = []
    for index, row in enumerate(reader):
        cell = (row.get(outcome) or "").strip()
        _require(cell, f"row {index + 2} has no {'outcome' if rate == 'selection' else 'score'}")
        record = {"sex": category(row.get(sex)), "raceEthnicity": category(row.get(race))}
        if rate == "selection":
            record["selected"] = cell in chosen
        else:
            try:
                score = float(cell)
            except ValueError:
                score = math.nan
            _require(math.isfinite(score), f"row {index + 2} score is not a number")
            record["score"] = score
        records.append(record)
    _require(records, "the dataset has no rows")
    return records


def main(argv=None):
    """`python -m engine.ll144`: compute the LL144 tables in the client's environment, from a CSV or an input JSON."""
    import argparse
    import sys

    parser = argparse.ArgumentParser(prog="python -m engine.ll144", description="NYC Local Law 144 bias audit tables (6 RCNY 5-301), as JSON.")
    parser.add_argument("source", help="a CSV with one row per assessed individual, or with --json an LL144 input document")
    parser.add_argument("--json", action="store_true", help="the source is an LL144 input document (rate, records, categories, exclusions)")
    parser.add_argument("--rate", choices=RATES)
    parser.add_argument("--sex", help="the sex column")
    parser.add_argument("--race", help="the race/ethnicity column")
    parser.add_argument("--outcome", help="the outcome column (selection) or score column (scoring)")
    parser.add_argument("--selected", action="append", default=[], help="an outcome value that means selected (repeatable)")
    parser.add_argument("--unknown", action="append", default=[], help="a cell value that means the category is unknown (repeatable)")
    parser.add_argument("--exclusions", help="a JSON file listing {dimension, category, justification} exclusions")
    parser.add_argument("-o", "--output", help="write the result here instead of standard output")
    args = parser.parse_args(argv)
    if not args.json and not (args.rate and args.sex and args.race and args.outcome):
        parser.error("a CSV source needs --rate, --sex, --race and --outcome")
    try:
        with open(args.source, encoding="utf-8-sig") as handle:
            text = handle.read()
        if args.json:
            inp = json.loads(text)
        else:
            inp = {
                "rate": args.rate,
                "records": records_from_csv(text, rate=args.rate, sex=args.sex, race=args.race, outcome=args.outcome, selected=args.selected, unknown=args.unknown),
                "categories": {"sex": EEO1_SEX, "raceEthnicity": EEO1_RACE_ETHNICITY},
            }
            if args.exclusions:
                with open(args.exclusions, encoding="utf-8") as handle:
                    inp["exclusions"] = json.load(handle)
        result = ll144_audit(inp)
    except (OSError, ValueError) as error:
        print("ll144: " + str(error), file=sys.stderr)
        return 2
    out = json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(out)
    else:
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
