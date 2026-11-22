// Audit statistics: NYC LL144 impact-ratio reporting (section 10.2).
// Part of lib/statistics.ts (#272), which re-exports the public names.

import { require_, get } from "./core";
import { zcrit, sum } from "./numerics";
import { wilson, katz, koopman, ratioMethod } from "./intervals";
import { type CriterionInterval } from "./members";

// ------------------------------------------------------------ NYC LL144 reporting (section 10.2)
export const LL144_RATE_KEYS = {
  selection: ["selected", "selectionRate", "selectionRateInterval"],
  scoring: ["scoredAboveMedian", "scoringRate", "scoringRateInterval"],
} as const;
export type Ll144Row = {
  category: string;
  n: number;
  shareOfData: number;
  shareOfKnown: number;
  eligibleForTwoPercentExclusion: boolean;
  excluded: boolean;
  impactRatio: number | null;
  impactRatioInterval: CriterionInterval | null;
} & Record<string, unknown>;
/**
 * One LL144 table (sex, race/ethnicity or intersectional categories) from
 * per-category counts, as engine/statistics.py evaluate_ll144. `selected`
 * counts the individuals selected (selection rates) or scoring above the
 * full-sample median (scoring rates). A category with no individuals has no
 * rate; when the reference category's rate is zero every impact ratio is
 * undefined (null).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the input is untyped JSON (golden cases and API bodies), as in the Python core.
export function evaluateLl144(inp: any, level = 0.95) {
  const [countKey, rateKey, intervalKey] =
    LL144_RATE_KEYS[get(inp, "rate", "selection") as "selection" | "scoring"];
  const z = zcrit(level);
  const cats: { name: string; n: number; selected: number }[] = inp.categories;
  const known = sum(cats.map((c) => c.n));
  const unknown = get(inp, "unknownCount", 0);
  // "The data being used for the bias audit" includes the unknown category (section 10.2).
  const total = known + unknown;
  require_(total > 0, "an LL144 table needs at least one individual");
  const excluded = new Set<string>(get(inp, "excluded", []));
  const rows: Ll144Row[] = cats.map((c) => {
    const share = c.n / total;
    require_(
      !excluded.has(c.name) || share < 0.02,
      "2% exclusion only allowed below 2% of the data",
    );
    let rate: number | null = null,
      interval: CriterionInterval | null = null;
    if (c.n > 0) {
      const [lo, hi] = wilson(c.selected, c.n, z);
      rate = c.selected / c.n;
      interval = { lower: lo, upper: hi, level, method: "wilson" };
    }
    return {
      category: c.name,
      n: c.n,
      [countKey]: c.selected,
      [rateKey]: rate,
      [intervalKey]: interval,
      shareOfData: share,
      shareOfKnown: known ? c.n / known : 0,
      eligibleForTwoPercentExclusion: share < 0.02,
      excluded: excluded.has(c.name),
      impactRatio: null,
      impactRatioInterval: null,
    };
  });
  const included = rows.filter((r) => !r.excluded && r.n > 0);
  const rateOf = (r: Ll144Row) => r[rateKey] as number;
  // The first maximum in input order.
  const ref = included.length
    ? included.reduce((best, r) => (rateOf(r) > rateOf(best) ? r : best))
    : null;
  if (ref && (ref[countKey] as number) > 0)
    for (const r of included) {
      if (r === ref) {
        r.impactRatio = 1.0;
        continue;
      }
      const xs = r[countKey] as number,
        ns = r.n,
        xc = ref[countKey] as number,
        nc = ref.n;
      const method = ratioMethod(xs, ns, xc, nc)!;
      const [lo, hi] =
        method === "katz_log"
          ? katz(xs, ns, xc, nc, z)
          : koopman(xs, ns, xc, nc, z);
      r.impactRatio = xs / ns / (xc / nc);
      r.impactRatioInterval = { lower: lo, upper: hi, level, method };
    }
  return {
    referenceCategory: ref ? ref.category : null,
    totalIndividuals: total,
    totalAssessedKnown: known,
    unknownCategoryCount: unknown,
    categories: rows,
  };
}
