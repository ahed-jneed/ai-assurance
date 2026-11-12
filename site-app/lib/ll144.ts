// NYC Local Law 144 bias audit computations (docs/design/audit-statistics.md
// section 10.2, issue #30). This mirrors engine/ll144.py exactly; both runners
// run the golden cases of schemas/fixtures/ll144-golden.json. The records are
// one per assessed individual (or per identical individuals, with `count`):
// the sex and race/ethnicity the individual reported (null when unknown) and
// the selection outcome or the tool's score. The output has one table per
// dimension the rule requires: sex, race/ethnicity and intersectional.
//
// - Scoring rates use the median of the full sample, every scored individual
//   including those in an unknown category (6 RCNY 5-301(c)(1); Q4).
// - An individual unknown in a dimension counts as unknown in that table
//   (5-301(b)(5), (c)(5)); an intersectional category needs both values.
// - The auditor MAY exclude a category under 2% of the audit data from the
//   impact ratios (5-301(d)), with a justification; it keeps its count and rate.
// - Intervals are supplementary: the rule requires none.
import {
  codePointCompare,
  evaluateLl144,
  StatisticsError,
  type Ll144Row,
} from "./statistics";

export const LL144_SPEC_VERSION = "1.0.0";
export const ll144Rates = ["selection", "scoring"] as const;
export const ll144Dimensions = [
  "sex",
  "raceEthnicity",
  "intersectional",
] as const;
export type Ll144Rate = (typeof ll144Rates)[number];
export type Ll144Dimension = (typeof ll144Dimensions)[number];
export const LL144_INTERVAL_NOTE =
  "Supplementary; not required by the rule. The reference category is chosen from the data, so the impact-ratio intervals are conditional on that choice.";
const MAX_RECORDS = 10_000_000;
const MAX_CATEGORIES = 100;

export class Ll144Error extends Error {}
function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Ll144Error(message);
}

export type Ll144Record = {
  sex?: string | null;
  raceEthnicity?: string | null;
  count?: number;
  selected?: boolean;
  score?: number;
};
export type Ll144Exclusion = {
  dimension: Ll144Dimension;
  category: string;
  justification: string;
};
export type Ll144Input = {
  rate: Ll144Rate;
  records: Ll144Record[];
  categories?: { sex?: string[]; raceEthnicity?: string[] };
  exclusions?: Ll144Exclusion[];
  confidenceLevel?: number;
};
export type Ll144Category = Ll144Row & {
  components: string[];
  exclusionJustification: string | null;
};
export type Ll144Table = {
  dimension: Ll144Dimension;
  referenceCategory: string | null;
  totalIndividuals: number;
  totalAssessedKnown: number;
  unknownCategoryCount: number;
  categories: Ll144Category[];
  notes: string[];
};
export type Ll144Result = {
  specificationVersion: string;
  rate: Ll144Rate;
  confidenceLevel: number;
  totalIndividuals: number;
  medianScore: number | null;
  intervalNote: string;
  tables: Ll144Table[];
};

/** One value gives itself; several give the intersectional label, a compact JSON array (as engine/criteria.py). */
export const categoryLabel = (values: string[]) =>
  values.length === 1 ? values[0] : JSON.stringify(values);

function category(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  need(
    typeof value === "string" && value.length <= 200,
    where + " must be a category name of at most 200 characters or null",
  );
  // Python's str.strip() and JavaScript's trim() agree on the whitespace
  // a CSV cell holds in practice (spaces, tabs, line breaks).
  return value.trim() || null;
}
function declared(inp: Ll144Input, key: "sex" | "raceEthnicity") {
  const values = inp.categories?.[key] ?? [];
  need(
    Array.isArray(values) && values.length <= MAX_CATEGORIES,
    "categories." + key + " must list at most 100 names",
  );
  need(
    values.every((v) => typeof v === "string" && v && v.trim() === v) &&
      new Set(values).size === values.length,
    "categories." + key + " must be unique, trimmed, non-empty names",
  );
  return [...values];
}
const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The ordinary sample median of [score, count] pairs: the mean of the two middle values when n is even. */
export function median(pairs: [number, number][]) {
  const ordered = [...pairs].sort((a, b) => a[0] - b[0]);
  const n = ordered.reduce((t, [, c]) => t + c, 0);
  const at = (index: number) => {
    let seen = 0;
    for (const [score, count] of ordered) {
      seen += count;
      if (index < seen) return score;
    }
    throw Error("median index out of range");
  };
  return n % 2 ? at(Math.floor(n / 2)) : (at(n / 2 - 1) + at(n / 2)) / 2.0;
}

type Row = [string | null, string | null, boolean | number, number];
export function validateLl144(inp: Ll144Input) {
  need(
    inp && typeof inp === "object" && !Array.isArray(inp),
    "the LL144 input must be an object",
  );
  const unknownFields = Object.keys(inp)
    .filter(
      (k) =>
        ![
          "rate",
          "records",
          "categories",
          "exclusions",
          "confidenceLevel",
        ].includes(k),
    )
    .sort(codePointCompare);
  need(
    !unknownFields.length,
    "unknown LL144 input fields: " + unknownFields.join(", "),
  );
  const rate = inp.rate;
  need(ll144Rates.includes(rate), "rate must be selection or scoring");
  const level = inp.confidenceLevel ?? 0.95;
  need(
    isNumber(level) && level >= 0.8 && level <= 0.999,
    "confidenceLevel must be between 0.8 and 0.999",
  );
  const records = inp.records;
  need(
    Array.isArray(records) && records.length > 0,
    "records must list at least one individual",
  );
  const rows: Row[] = [];
  let total = 0;
  records.forEach((r, index) => {
    const where = `records[${index}]`;
    need(
      r && typeof r === "object" && !Array.isArray(r),
      where + " must be an object",
    );
    const allowed = [
      "sex",
      "raceEthnicity",
      "count",
      rate === "selection" ? "selected" : "score",
    ];
    const extra = Object.keys(r)
      .filter((k) => !allowed.includes(k))
      .sort(codePointCompare);
    need(!extra.length, where + " has unknown fields: " + extra.join(", "));
    const count = r.count ?? 1;
    need(
      Number.isSafeInteger(count) && count >= 1,
      where + ".count must be a positive integer",
    );
    let outcome: boolean | number;
    if (rate === "selection") {
      need(
        typeof r.selected === "boolean",
        where + ".selected must be true or false",
      );
      outcome = r.selected;
    } else {
      need(isNumber(r.score), where + ".score must be a finite number");
      outcome = r.score;
    }
    rows.push([
      category(r.sex, where + ".sex"),
      category(r.raceEthnicity, where + ".raceEthnicity"),
      outcome,
      count,
    ]);
    total += count;
  });
  need(total <= MAX_RECORDS, "at most 10,000,000 individuals");
  const order = {
    sex: declared(inp, "sex"),
    raceEthnicity: declared(inp, "raceEthnicity"),
  };
  const exclusions = inp.exclusions ?? [];
  need(Array.isArray(exclusions), "exclusions must be a list");
  const seen = new Set<string>();
  exclusions.forEach((x, index) => {
    const where = `exclusions[${index}]`;
    need(
      x &&
        typeof x === "object" &&
        Object.keys(x).sort().join() === "category,dimension,justification",
      where + " needs exactly dimension, category and justification",
    );
    need(
      ll144Dimensions.includes(x.dimension),
      where + ".dimension must be sex, raceEthnicity or intersectional",
    );
    need(
      typeof x.category === "string" && x.category,
      where + ".category must be a category name",
    );
    need(
      typeof x.justification === "string" &&
        x.justification.trim() &&
        x.justification.length <= 2000,
      where +
        ".justification must state why the category is excluded (at most 2,000 characters)",
    );
    const key = JSON.stringify([x.dimension, x.category]);
    need(!seen.has(key), where + " repeats an exclusion");
    seen.add(key);
  });
  return { rate, rows, order, exclusions, level };
}

/** Declared categories in their order (the rule's tables follow the EEO-1 order), then the others in code-point order. */
function ordered(declaredNames: string[], found: Set<string>) {
  return [
    ...declaredNames,
    ...[...found]
      .filter((v) => !declaredNames.includes(v))
      .sort(codePointCompare),
  ];
}

/** The LL144 tables for sex, race/ethnicity and intersectional categories (section 10.2). */
export function ll144Audit(inp: Ll144Input): Ll144Result {
  const { rate, rows, order, exclusions, level } = validateLl144(inp);
  const total = rows.reduce((t, r) => t + r[3], 0);
  const threshold =
    rate === "scoring" ? median(rows.map((r) => [r[2] as number, r[3]])) : null;
  const hit = (outcome: boolean | number) =>
    rate === "selection"
      ? (outcome as boolean)
      : (outcome as number) > threshold!;
  const sexes = ordered(
    order.sex,
    new Set(rows.map((r) => r[0]).filter((v): v is string => v !== null)),
  );
  const races = ordered(
    order.raceEthnicity,
    new Set(rows.map((r) => r[1]).filter((v): v is string => v !== null)),
  );
  const pairs = sexes.flatMap((s) => races.map((r) => [s, r]));
  const specs: [
    Ll144Dimension,
    string[][],
    (s: string | null, r: string | null) => string[] | null,
  ][] = [
    ["sex", sexes.map((s) => [s]), (s) => (s === null ? null : [s])],
    [
      "raceEthnicity",
      races.map((r) => [r]),
      (_, r) => (r === null ? null : [r]),
    ],
    [
      "intersectional",
      pairs,
      (s, r) => (s === null || r === null ? null : [s, r]),
    ],
  ];
  const tables = specs.map(([dimension, all, key]): Ll144Table => {
    need(
      all.length <=
        MAX_CATEGORIES * (dimension === "intersectional" ? MAX_CATEGORIES : 1),
      "too many categories",
    );
    const counts = new Map(all.map((n) => [categoryLabel(n), [0, 0]]));
    let unknown = 0;
    for (const [s, r, outcome, count] of rows) {
      const parts = key(s, r);
      if (parts === null) {
        unknown += count;
        continue;
      }
      const cell = counts.get(categoryLabel(parts))!;
      cell[0] += count;
      cell[1] += hit(outcome) ? count : 0;
    }
    // Intersectional categories with no individuals and no declared parts are left out; declared ones stay.
    const names =
      dimension === "intersectional"
        ? all.filter(
            (n) =>
              counts.get(categoryLabel(n))![0] > 0 ||
              (order.sex.includes(n[0]) && order.raceEthnicity.includes(n[1])),
          )
        : all;
    const mine = new Map(
      exclusions
        .filter((x) => x.dimension === dimension)
        .map((x) => [x.category, x.justification]),
    );
    const labels = names.map(categoryLabel);
    const missing = [...mine.keys()]
      .filter((c) => !labels.includes(c))
      .sort(codePointCompare);
    need(
      !missing.length,
      "excluded " +
        dimension +
        " categories not in the data: " +
        missing.join(", "),
    );
    let table;
    try {
      table = evaluateLl144(
        {
          rate,
          unknownCount: unknown,
          excluded: [...mine.keys()],
          categories: labels.map((label) => ({
            name: label,
            n: counts.get(label)![0],
            selected: counts.get(label)![1],
          })),
        },
        level,
      );
    } catch (error) {
      if (error instanceof StatisticsError)
        throw new Ll144Error(dimension + ": " + error.message);
      throw error;
    }
    const notes: string[] = [];
    if (table.referenceCategory === null) notes.push("no_known_category");
    else if (table.categories.every((row) => row.impactRatio === null))
      notes.push("reference_rate_zero");
    return {
      dimension,
      ...table,
      categories: table.categories.map((row, i) => ({
        ...row,
        components: [...names[i]],
        exclusionJustification: mine.get(row.category) ?? null,
      })),
      notes,
    };
  });
  return {
    specificationVersion: LL144_SPEC_VERSION,
    rate,
    confidenceLevel: level,
    totalIndividuals: total,
    medianScore: threshold,
    intervalNote: LL144_INTERVAL_NOTE,
    tables,
  };
}
