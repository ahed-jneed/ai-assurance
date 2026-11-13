"""Writes and checks schemas/fixtures/ll144-golden.json, the NYC Local Law 144 golden cases (issue #30).

The expected values are computed here independently of both runners: counts, rates, shares and impact
ratios by plain arithmetic on the records (each case also states its hand computation), Wilson and
Katz-log intervals from their closed forms, and Koopman score intervals with statsmodels
(confint_proportions_2indep, method "score", compare "ratio", no correction), whose lower limit at a
zero numerator is 0 by the specification (section 5.6). LL-04 takes its expected race/ethnicity rows from
GC-32 of schemas/fixtures/statistics-golden.json, the DCWP worked example that fixture reproduces.

  python docs/design/ll144-golden-verify.py --write   # regenerate the fixture
  python docs/design/ll144-golden-verify.py --check   # recompute and compare with the committed fixture

--check needs scipy and statsmodels: install them in a throwaway virtualenv outside the repository
(never as project dependencies). The runners never import this file.
"""
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "schemas" / "fixtures" / "ll144-golden.json"
STATISTICS = ROOT / "schemas" / "fixtures" / "statistics-golden.json"
NOTE = "Supplementary; not required by the rule. The reference category is chosen from the data, so the impact-ratio intervals are conditional on that choice."
EEO1_RACE = ["Hispanic or Latino", "White", "Black or African American", "Native Hawaiian or Pacific Islander", "Asian", "Native American or Alaska Native", "Two or More Races"]


def rec(sex, race, outcome, count, rate):
    r = {"sex": sex, "raceEthnicity": race, ("selected" if rate == "selection" else "score"): outcome}
    if count != 1:
        r["count"] = count
    return r


def selection_records(cells):
    """cells: (sex, race, selected, n) -> records with count, selected first."""
    out = []
    for sex, race, selected, n in cells:
        if selected:
            out.append(rec(sex, race, True, selected, "selection"))
        if n - selected:
            out.append(rec(sex, race, False, n - selected, "selection"))
    return out


def gc32_records():
    gc32 = next(c for c in json.loads(STATISTICS.read_text(encoding="utf-8"))["cases"] if c["id"] == "GC-32")
    cells = [(None, c["name"], c["selected"], c["n"]) for c in gc32["input"]["categories"]]
    return selection_records(cells) + [rec(None, None, False, gc32["input"]["unknownCount"], "selection")], gc32


CASES = [
    {"id": "LL-01", "title": "Selection rates for sex, race/ethnicity and intersectional categories, with unknowns in each dimension",
     "input": {"rate": "selection", "records": selection_records([("Female", "Asian", 6, 10), ("Female", "Black or African American", 3, 10), ("Male", "Asian", 8, 10), ("Male", "Black or African American", 4, 10), (None, "Asian", 2, 5), ("Female", None, 1, 5)]), "categories": {"sex": ["Male", "Female"], "raceEthnicity": ["Black or African American", "Asian"]}},
     "handComputation": "50 individuals. Sex: Male 12/20 = 0.6 (reference), Female (6+3+1)/25 = 0.4, ratio 0.4/0.6 = 0.6667; 5 unknown (no sex). Race/ethnicity: Asian (6+8+2)/25 = 0.64 (reference), Black or African American (3+4)/20 = 0.35, ratio 0.35/0.64 = 0.546875; 5 unknown. Intersectional: Male/Asian 0.8 (reference); Male/Black 0.4 -> 0.5; Female/Asian 0.6 -> 0.75; Female/Black 0.3 -> 0.375; 10 unknown (either value missing)."},
    {"id": "LL-02", "title": "Scoring rates: the median is taken over the full sample, including the unknown category (5-301(c)(1), Q4)",
     "input": {"rate": "scoring", "records": [rec("Female", "Asian", s, 1, "scoring") for s in (1, 2, 3)] + [rec("Female", "White", 5, 2, "scoring"), rec("Male", "Asian", 4, 1, "scoring"), rec("Male", "Asian", 6, 1, "scoring"), rec("Male", "White", 7, 1, "scoring"), rec(None, None, 5, 1, "scoring"), rec(None, None, 8, 1, "scoring")]},
     "handComputation": "Scores 1,2,3,4,5,5,5,6,7,8 (10 individuals, two of unknown sex and race): median (5+5)/2 = 5; only scores strictly above 5 count (6, 7, 8). Sex: Male 2/3 (reference), Female 0/5 -> ratio 0; 2 unknown. Race/ethnicity: White 1/3 (reference), Asian 1/5 -> 0.2/0.3333 = 0.6; 2 unknown. Intersectional: Male/White 1/1 (reference), Male/Asian 1/2 -> 0.5, Female/Asian 0/3 -> 0, Female/White 0/2 -> 0. Leaving the unknowns out would give the median 4.5 and different rates (Asian 1/5 vs White 3/3 for the scores 5, 5, 7)."},
    {"id": "LL-03", "title": "2% exclusion: a category under 2% of the data, a declared category with no individuals, and no sex data",
     "input": {"rate": "selection", "records": selection_records([(None, "Asian", 15, 30), (None, "White", 10, 25), (None, "Two or More Races", 1, 1), (None, None, 2, 4)]), "categories": {"raceEthnicity": ["White", "Asian", "Two or More Races", "Native American or Alaska Native"]}, "exclusions": [{"dimension": "raceEthnicity", "category": "Two or More Races", "justification": "1 of 60 individuals (1.67% of the audit data, under 2%); a single selection would otherwise set the reference rate."}]},
     "handComputation": "60 individuals, 4 of unknown race/ethnicity, none with a sex. Two or More Races is 1/60 = 1.67% of the data (1/56 = 1.79% of the known categories), so it may be excluded: it keeps n = 1 and rate 1.0 but gets no impact ratio. Reference Asian 15/30 = 0.5; White 10/25 = 0.4 -> 0.8. Native American or Alaska Native is declared with no individuals: n 0, no rate. The sex and intersectional tables have no known category: all 60 are unknown."},
    {"id": "LL-04", "title": "DCWP worked example (race/ethnicity) reproduced from records, as GC-32",
     "input": None,
     "handComputation": "The DCWP example of the rule: 2,834 individuals, 250 of unknown race/ethnicity, reference White 412/797. The race/ethnicity table equals GC-32 of the statistics fixture; no sex data, so the sex and intersectional tables are all unknown."},
    {"id": "LL-05", "title": "Nobody selected: every impact ratio is undefined",
     "input": {"rate": "selection", "records": selection_records([("Female", "Asian", 0, 12), ("Male", "Asian", 0, 9)])},
     "handComputation": "21 individuals, none selected: every rate is 0, the reference rate is 0, so no impact ratio is defined (note reference_rate_zero)."},
]
ERROR_CASES = [
    {"id": "LL-E1", "title": "A category of 2% or more cannot be excluded", "input": {"rate": "selection", "records": selection_records([(None, "Asian", 15, 30), (None, "White", 10, 25)]), "exclusions": [{"dimension": "raceEthnicity", "category": "White", "justification": "x"}]}, "error": "2% exclusion only allowed below 2% of the data"},
    {"id": "LL-E2", "title": "A scoring record needs a score", "input": {"rate": "scoring", "records": [{"sex": "Female", "raceEthnicity": "Asian", "selected": True}]}, "error": "unknown fields"},
    {"id": "LL-E3", "title": "An exclusion needs a justification", "input": {"rate": "selection", "records": selection_records([(None, "Asian", 1, 1), (None, "White", 10, 99)]), "exclusions": [{"dimension": "raceEthnicity", "category": "Asian", "justification": " "}]}, "error": "justification"},
    {"id": "LL-E4", "title": "An excluded category must occur in the data", "input": {"rate": "selection", "records": selection_records([(None, "Asian", 1, 10)]), "exclusions": [{"dimension": "sex", "category": "Female", "justification": "x"}]}, "error": "not in the data"},
]


# ---------------------------------------------------------------- independent arithmetic
def zcrit(level):
    from scipy.stats import norm
    return float(norm.ppf(1 - (1 - level) / 2))


def wilson(x, n, z):
    p = x / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z / (1 + z * z / n) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (0.0 if x == 0 else max(0.0, centre - half)), (1.0 if x == n else min(1.0, centre + half))


def ratio_interval(xs, ns, xc, nc, z, level):
    if xs >= 1 and not (xs == ns and xc == nc):
        r = (xs / ns) / (xc / nc)
        se = math.sqrt(1 / xs - 1 / ns + 1 / xc - 1 / nc)
        return {"lower": r * math.exp(-z * se), "upper": r * math.exp(z * se), "level": level, "method": "katz_log"}
    from statsmodels.stats.proportion import confint_proportions_2indep
    lo, hi = confint_proportions_2indep(xs, ns, xc, nc, method="score", compare="ratio", correction=False, alpha=1 - level)
    return {"lower": 0.0 if xs == 0 else float(lo), "upper": float(hi), "level": level, "method": "koopman_score"}


def label(parts):
    return parts[0] if len(parts) == 1 else json.dumps(parts, ensure_ascii=False, separators=(",", ":"))


def expand(records, rate):
    out = []
    for r in records:
        out += [(r["sex"], r["raceEthnicity"], r["selected" if rate == "selection" else "score"])] * r.get("count", 1)
    return out


def table(people, dimension, names, rate, cutoff, excluded, level):
    z = zcrit(level)
    def parts(p):
        s, r, _ = p
        if dimension == "sex":
            return None if s is None else [s]
        if dimension == "raceEthnicity":
            return None if r is None else [r]
        return None if s is None or r is None else [s, r]
    hit = (lambda o: o) if rate == "selection" else (lambda o: o > cutoff)
    unknown = sum(1 for p in people if parts(p) is None)
    total = len(people)
    known = total - unknown
    rows = []
    keys = ("selected", "selectionRate", "selectionRateInterval") if rate == "selection" else ("scoredAboveMedian", "scoringRate", "scoringRateInterval")
    for n_parts in names:
        members = [p for p in people if parts(p) == n_parts]
        n, x = len(members), sum(1 for p in members if hit(p[2]))
        lo_hi = wilson(x, n, z) if n else None
        rows.append({"category": label(n_parts), "n": n, keys[0]: x, keys[1]: x / n if n else None, keys[2]: {"lower": lo_hi[0], "upper": lo_hi[1], "level": level, "method": "wilson"} if n else None, "shareOfData": n / total, "shareOfKnown": n / known if known else 0.0, "eligibleForTwoPercentExclusion": n / total < 0.02, "excluded": label(n_parts) in excluded, "impactRatio": None, "impactRatioInterval": None, "components": list(n_parts), "exclusionJustification": excluded.get(label(n_parts))})
    included = [r for r in rows if not r["excluded"] and r["n"]]
    ref = None
    for r in included:
        if ref is None or r[keys[1]] > ref[keys[1]]:
            ref = r
    notes = []
    if ref is None:
        notes.append("no_known_category")
    elif ref[keys[0]] == 0:
        notes.append("reference_rate_zero")
    else:
        for r in included:
            if r is ref:
                r["impactRatio"] = 1.0
            else:
                r["impactRatio"] = (r[keys[0]] / r["n"]) / (ref[keys[0]] / ref["n"])
                r["impactRatioInterval"] = ratio_interval(r[keys[0]], r["n"], ref[keys[0]], ref["n"], z, level)
    return {"dimension": dimension, "referenceCategory": ref["category"] if ref else None, "totalIndividuals": total, "totalAssessedKnown": known, "unknownCategoryCount": unknown, "categories": rows, "notes": notes}


def ordered(declared, found):
    return declared + sorted((v for v in found if v not in declared), key=lambda s: [ord(c) for c in s])


def expected(inp):
    rate, level = inp["rate"], inp.get("confidenceLevel", 0.95)
    people = expand(inp["records"], rate)
    cutoff = None
    if rate == "scoring":
        scores = sorted(p[2] for p in people)
        n = len(scores)
        cutoff = float(scores[n // 2]) if n % 2 else (scores[n // 2 - 1] + scores[n // 2]) / 2.0
    declared = inp.get("categories", {})
    sexes = ordered(declared.get("sex", []), {p[0] for p in people if p[0] is not None})
    races = ordered(declared.get("raceEthnicity", []), {p[1] for p in people if p[1] is not None})
    inter = [[s, r] for s in sexes for r in races if any(p[0] == s and p[1] == r for p in people) or (s in declared.get("sex", []) and r in declared.get("raceEthnicity", []))]
    ex = {d: {x["category"]: x["justification"] for x in inp.get("exclusions", []) if x["dimension"] == d} for d in ("sex", "raceEthnicity", "intersectional")}
    return {"specificationVersion": "1.0.0", "rate": rate, "confidenceLevel": level, "totalIndividuals": len(people), "medianScore": cutoff, "intervalNote": NOTE,
            "tables": [table(people, "sex", [[s] for s in sexes], rate, cutoff, ex["sex"], level), table(people, "raceEthnicity", [[r] for r in races], rate, cutoff, ex["raceEthnicity"], level), table(people, "intersectional", inter, rate, cutoff, ex["intersectional"], level)]}


def build():
    cases = []
    for case in CASES:
        case = dict(case)
        if case["id"] == "LL-04":
            records, gc32 = gc32_records()
            case["input"] = {"rate": "selection", "records": records, "categories": {"raceEthnicity": EEO1_RACE}}
            out = expected(case["input"])
            race = out["tables"][1]
            # The DCWP rows, as GC-32 reproduces them, plus the two keys the audit adds per row.
            race["categories"] = [{**row, "components": [row["category"]], "exclusionJustification": None} for row in gc32["expected"]["categories"]]
            case["expected"] = out
        else:
            case["expected"] = expected(case["input"])
        cases.append(case)
    return {"documentType": "ll144-golden", "schemaVersion": "1.0.0", "specificationVersion": "1.0.0",
            "howToUse": "Each case runs ll144_audit (engine/ll144.py) and ll144Audit (site-app/lib/ll144.ts) on its input. Numbers match within tolerances.number, every other value exactly. An error case must be rejected with a message containing its error text.",
            "tolerances": {"number": 1e-9, "interval": 1e-6}, "cases": cases, "errorCases": ERROR_CASES}


def differences(actual, expected_, path="", out=None, key=""):
    out = [] if out is None else out
    if isinstance(expected_, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected_):
            out.append(path + ": keys differ")
            return out
        for k in expected_:
            differences(actual[k], expected_[k], path + "." + k, out, k)
    elif isinstance(expected_, list):
        if not isinstance(actual, list) or len(actual) != len(expected_):
            out.append(path + ": length differs")
        else:
            for i, (a, e) in enumerate(zip(actual, expected_)):
                differences(a, e, f"{path}[{i}]", out, key)
    elif isinstance(expected_, (int, float)) and not isinstance(expected_, bool) and isinstance(actual, (int, float)) and not isinstance(actual, bool):
        tolerance = 1e-6 if key in ("lower", "upper") else 1e-9
        if abs(actual - expected_) > tolerance:
            out.append(f"{path}: {actual} != {expected_}")
    elif actual != expected_:
        out.append(f"{path}: {actual!r} != {expected_!r}")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    fresh = build()
    if args.write:
        FIXTURE.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print("wrote", FIXTURE.relative_to(ROOT))
    if args.check:
        committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
        problems = differences(committed, fresh)
        if problems:
            print("\n".join(problems[:50]))
            sys.exit(1)
        print(f"{len(fresh['cases'])} cases and {len(fresh['errorCases'])} error cases match an independent recomputation")


if __name__ == "__main__":
    main()
