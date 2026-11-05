import type { Run, Result, Metric } from "./domain";
import {
  assertSuite,
  fairnessSelected,
  performancePositiveLabel,
} from "./evaluation";
import {
  decideBinaryPerformance,
  decideEqualizedOdds,
  decideImpact,
  decideMulticlassPerformance,
  decideParity,
  decideRegression,
  type Decision,
  type GroupSupport,
} from "./diagnostic-decisions";
const numericCell = (v: string) =>
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) &&
  Number.isFinite(Number(v));
/**
 * Parses a CSV with a header row. A record whose cells are all empty is a
 * row with every value missing: `blankRows: "reject"` refuses it (line
 * breaks that end the file are not rows), the default `"skip"` drops it as
 * audit sampling has. Evaluations reject blank rows.
 */
export function parseCSV(
  text: string,
  { blankRows = "skip" }: { blankRows?: "skip" | "reject" } = {},
): Record<string, string>[] {
  let records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (closedQuote && c !== "," && c !== "\n" && c !== "\r")
      throw Error("Unexpected character after quoted CSV field");
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length > 0) throw Error("Invalid CSV quoting");
      else {
        closedQuote = quoted;
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
      closedQuote = false;
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      closedQuote = false;
      records.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed CSV field");
  row.push(cell);
  records.push(row);
  const empty = (r: string[]) => r.every((x) => x === "");
  if (blankRows === "skip") records = records.filter((r) => !empty(r));
  else {
    while (
      records.length &&
      records.at(-1)!.length === 1 &&
      !records.at(-1)![0]
    )
      records.pop();
    const blank = records.findIndex(empty);
    if (blank === 0) throw Error("The CSV must start with its header row");
    if (blank > 0)
      throw Error(
        "Blank data row " +
          blank +
          ": remove empty rows; missing values are not silently dropped",
      );
  }
  if (records.length < 2) throw Error("CSV needs a header and data rows");
  const header = records.shift()!.map((x) => x.replace(/^﻿/, "").trim());
  if (new Set(header).size !== header.length || header.some((x) => !x))
    throw Error("Column names must be unique and nonempty");
  if (records.length > 10000)
    throw Error(
      "Interactive diagnostics accept at most 10,000 rows; use the Python worker for larger datasets",
    );
  if (header.length > 200)
    throw Error("Interactive diagnostics accept at most 200 columns");
  return records.map((r, i) => {
    if (r.length !== header.length)
      throw Error("Column count mismatch at data row " + (i + 1));
    return Object.fromEntries(header.map((h, j) => [h, r[j].trim()]));
  });
}
export function inspectCSV(csv: string) {
  const data = parseCSV(csv, { blankRows: "reject" });
  return {
    rowCount: data.length,
    columns: Object.keys(data[0]).map((name) => {
      const values = data.map((r) => r[name]),
        present = values.filter(Boolean),
        unique = new Set(present);
      return {
        name,
        missing: values.length - present.length,
        uniqueCount: unique.size,
        type:
          present.length && present.every(numericCell)
            ? "numeric"
            : "categorical",
      };
    }),
  };
}
export function validateEvaluation(run: Run, csv: string) {
  const data = parseCSV(csv, { blankRows: "reject" }),
    c = run.config,
    task = run.task ?? "Binary classification",
    fair = fairnessSelected(run.suite);
  assertSuite(task, run.suite);
  const cols = [
    c.labelColumn,
    c.predictionColumn,
    ...(fair ? [c.groupColumn] : []),
  ];
  if (new Set(cols).size !== cols.length)
    throw Error(
      "Target, prediction and protected-group columns must be distinct",
    );
  for (const col of cols)
    if (!col || !(col in data[0]))
      throw Error("Required column missing: " + (col || "protected group"));
  if (data.some((r) => cols.some((col) => !r[col])))
    throw Error(
      "Mapped columns must be present in every row; missing values are not silently dropped",
    );
  if (task === "Regression") {
    if (
      data.some((r) =>
        [c.labelColumn, c.predictionColumn].some(
          (col) => !numericCell(r[col]) || Math.abs(Number(r[col])) > 1e100,
        ),
      )
    )
      throw Error(
        "Regression targets and predictions must be finite decimal numbers with absolute value at most 1e100",
      );
  } else {
    const labels = new Set(
      data.flatMap((r) => [r[c.labelColumn], r[c.predictionColumn]]),
    );
    if (labels.size > 50)
      throw Error("Interactive classification supports at most 50 classes");
    if (
      task === "Binary classification" &&
      (labels.size !== 2 ||
        !labels.has(c.positiveLabel) ||
        !labels.has(performancePositiveLabel(c)))
    )
      throw Error(
        "Binary evaluation requires two class labels, including the favourable label and the performance positive class",
      );
  }
  if (fair && new Set(data.map((r) => r[c.groupColumn])).size > 50)
    throw Error("Interactive diagnostics support at most 50 groups");
  return data;
}
/** Labels the prediction column uses that the reference column never does. */
function unexpectedPredictions(
  data: Record<string, string>[],
  label: string,
  prediction: string,
) {
  const reference = new Set(data.map((r) => r[label])),
    counts = new Map<string, number>();
  for (const r of data)
    if (!reference.has(r[prediction]))
      counts.set(r[prediction], (counts.get(r[prediction]) ?? 0) + 1);
  return counts.size
    ? [
        "Predicted labels absent from the reference column: " +
          [...counts]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([value, n]) => `'${value}' (${n} rows)`)
            .join(", ") +
          ". They count as errors.",
      ]
    : [];
}
export function evaluate(run: Run, csv: string): Result[] {
  const data = validateEvaluation(run, csv),
    c = run.config,
    task = run.task ?? "Binary classification",
    minimumN = c.minimumSampleSize ?? 20,
    minimumClass = c.minimumClassCount ?? 5;
  const result = (
    testId: string,
    label: string,
    article: string,
    decision: Decision,
    metrics: Metric[],
    limitations: string[] = [],
  ): Result => ({
    testId,
    label,
    article,
    outcome: decision.outcome,
    metrics,
    limitations: [...limitations, ...decision.reasons],
  });
  const ratio = (
    name: string,
    value: number | null,
    details?: unknown,
  ): Metric => ({
    name,
    value,
    unit: "ratio",
    sampleSize: data.length,
    ...(details === undefined ? {} : { details }),
  });
  const limits = [
    "Saved-prediction evaluation; no independent model inference, cross-validation or holdout verification. Criteria are internal acceptance rules, not EU AI Act safe harbours. No confidence intervals are estimated.",
  ];
  if (task === "Regression") {
    const actual = data.map((r) => Number(r[c.labelColumn])),
      predicted = data.map((r) => Number(r[c.predictionColumn])),
      mean = actual.reduce((a, b) => a + b, 0) / data.length,
      sse = actual.reduce((sum, y, i) => sum + (y - predicted[i]) ** 2, 0),
      sst = actual.reduce((sum, y) => sum + (y - mean) ** 2, 0),
      mae =
        actual.reduce((sum, y, i) => sum + Math.abs(y - predicted[i]), 0) /
        data.length,
      rmse = Math.sqrt(sse / data.length),
      rawR2 = sst > 0 ? 1 - sse / sst : null,
      r2 = rawR2 !== null && Number.isFinite(rawR2) ? rawR2 : null;
    return [
      result(
        "regression",
        "Regression performance",
        "15",
        decideRegression(
          { n: data.length, rmse },
          { minimumSampleSize: minimumN, maximumRmse: c.maximumRmse ?? 1 },
        ),
        [
          {
            name: "mae",
            value: mae,
            unit: "target units",
            sampleSize: data.length,
          },
          {
            name: "rmse",
            value: rmse,
            unit: "target units",
            sampleSize: data.length,
          },
          { name: "r2", value: r2, unit: "score", sampleSize: data.length },
        ],
        [
          ...limits,
          ...(r2 === null
            ? [
                rawR2 === null
                  ? "R² is undefined for a constant or numerically indistinguishable reference target."
                  : "R² exceeds the finite numeric range and is not estimable; MAE/RMSE retain their separate criterion.",
              ]
            : []),
        ],
      ),
    ];
  }
  const unexpected = unexpectedPredictions(
    data,
    c.labelColumn,
    c.predictionColumn,
  );
  if (task === "Multiclass classification") {
    const names = [
        ...new Set(
          data.flatMap((r) => [r[c.labelColumn], r[c.predictionColumn]]),
        ),
      ].sort(),
      classes = names.map((label) => {
        const support = data.filter((r) => r[c.labelColumn] === label).length,
          predicted = data.filter(
            (r) => r[c.predictionColumn] === label,
          ).length,
          tp = data.filter(
            (r) =>
              r[c.labelColumn] === label && r[c.predictionColumn] === label,
          ).length;
        return {
          label,
          support,
          predicted,
          tp,
          recall: support ? tp / support : null,
          precision: predicted ? tp / predicted : null,
          f1: support + predicted ? (2 * tp) / (support + predicted) : null,
        };
      }),
      reference = classes.filter((g) => g.support > 0),
      correct = data.filter(
        (r) => r[c.labelColumn] === r[c.predictionColumn],
      ).length,
      macro = classes.reduce((sum, g) => sum + (g.f1 ?? 0), 0) / classes.length;
    return [
      result(
        "performance",
        "Multiclass classification performance",
        "15",
        decideMulticlassPerformance(
          { classes: reference, correct, macroF1: macro },
          {
            minimumSampleSize: minimumN,
            minimumClassCount: minimumClass,
            minimumAccuracy: c.minimumAccuracy,
            minimumMacroF1: c.minimumMacroF1 ?? 0.7,
          },
        ),
        [
          ratio("accuracy", correct / data.length),
          ratio("macro_f1", macro, classes),
          ratio(
            "balanced_accuracy",
            reference.reduce((sum, g) => sum + g.tp / g.support, 0) /
              reference.length,
          ),
          ratio(
            "majority_baseline_accuracy",
            Math.max(...reference.map((g) => g.support)) / data.length,
          ),
        ],
        [
          ...limits,
          "Macro F1 averages all observed reference/prediction classes; balanced accuracy averages recall over the reference classes. Undeclared missing classes cannot be assessed.",
          "The majority-class baseline is the accuracy of always predicting the most frequent reference class.",
          ...unexpected,
        ],
      ),
    ];
  }
  // Binary: performance is measured on its own positive class; fairness
  // tests count the favourable outcome.
  const confusion = (rows: typeof data, positive: string) => {
    let tp = 0,
      tn = 0,
      fp = 0,
      fn = 0;
    for (const r of rows) {
      const actual = r[c.labelColumn] === positive,
        predicted = r[c.predictionColumn] === positive;
      if (actual && predicted) tp++;
      else if (actual) fn++;
      else if (predicted) fp++;
      else tn++;
    }
    return {
      tp,
      tn,
      fp,
      fn,
      n: rows.length,
      rate: (tp + fp) / rows.length,
      tpr: tp + fn ? tp / (tp + fn) : null,
      fpr: fp + tn ? fp / (fp + tn) : null,
    };
  };
  const performance = () => {
    const positive = performancePositiveLabel(c),
      negative = [
        ...new Set(
          data.flatMap((r) => [r[c.labelColumn], r[c.predictionColumn]]),
        ),
      ].find((label) => label !== positive)!,
      t = confusion(data, positive),
      positives = t.tp + t.fn,
      negatives = t.tn + t.fp,
      ratioOf = (a: number, b: number) => (b ? a / b : null),
      recall = t.tpr,
      specificity = ratioOf(t.tn, negatives),
      classes = [
        {
          label: positive,
          support: positives,
          predicted: t.tp + t.fp,
          tp: t.tp,
          recall,
          precision: ratioOf(t.tp, t.tp + t.fp),
          f1: ratioOf(2 * t.tp, 2 * t.tp + t.fp + t.fn),
        },
        {
          label: negative,
          support: negatives,
          predicted: t.tn + t.fn,
          tp: t.tn,
          recall: specificity,
          precision: ratioOf(t.tn, t.tn + t.fn),
          f1: ratioOf(2 * t.tn, 2 * t.tn + t.fn + t.fp),
        },
      ];
    return result(
      "performance",
      "Binary classification performance",
      "15",
      decideBinaryPerformance(
        { positiveLabel: positive, negativeLabel: negative, ...t },
        {
          minimumSampleSize: minimumN,
          minimumClassCount: minimumClass,
          minimumAccuracy: c.minimumAccuracy,
          minimumRecall: c.minimumRecall ?? 0.7,
        },
      ),
      [
        ratio("accuracy", (t.tp + t.tn) / t.n, t),
        ratio("precision", classes[0].precision),
        ratio("recall", recall),
        ratio("f1", classes[0].f1),
        ratio("specificity", specificity),
        ratio(
          "balanced_accuracy",
          recall !== null && specificity !== null
            ? (recall + specificity) / 2
            : null,
          classes,
        ),
        ratio("prevalence", positives / t.n),
        ratio(
          "majority_baseline_accuracy",
          Math.max(positives, negatives) / t.n,
        ),
      ],
      [
        ...limits,
        `Recall (sensitivity), precision and F1 refer to the performance positive class '${positive}'; specificity is the recall of '${negative}'. Prevalence is the share of '${positive}' in the reference column; the majority-class baseline is the accuracy of always predicting the more frequent reference class.`,
        ...(positive !== c.positiveLabel
          ? [
              `Fairness tests count the favourable outcome '${c.positiveLabel}', not the performance positive class.`,
            ]
          : []),
        ...unexpected,
      ],
    );
  };
  const groups = fairnessSelected(run.suite)
      ? [...new Set(data.map((r) => r[c.groupColumn]))].sort().map((g) => ({
          group: g,
          ...confusion(
            data.filter((r) => r[c.groupColumn] === g),
            c.positiveLabel,
          ),
        }))
      : [],
    support: GroupSupport[] = groups.map((g) => ({
      group: g.group,
      n: g.n,
      favourable: g.tp + g.fn,
      unfavourable: g.fp + g.tn,
    })),
    groupCriteria = {
      minimumSampleSize: minimumN,
      minimumGroupSize: c.minimumGroupSize,
    },
    rates = groups.map((g) => g.rate),
    spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const fairness = (testId: string) => {
    if (testId === "demographic_parity")
      return result(
        testId,
        "Demographic parity",
        "10",
        decideParity(spread(rates), support, {
          ...groupCriteria,
          maximumParityGap: c.maximumParityGap,
        }),
        [ratio("maximum_selection_rate_gap", spread(rates), groups)],
        [
          "Group contrasts use max minus min rates; protected-data processing requires a separately reviewed basis.",
        ],
      );
    if (testId === "disparate_impact") {
      const highest = Math.max(...rates),
        impact = highest > 0 ? Math.min(...rates) / highest : null;
      return result(
        testId,
        "Disparate impact",
        "10",
        decideImpact(impact, support, {
          ...groupCriteria,
          minimumImpactRatio: c.minimumImpactRatio,
        }),
        [ratio("minimum_selection_rate_ratio", impact, groups)],
        [
          "Internal policy threshold; no EU AI Act numerical safe harbour. Groups use minimum-to-maximum pairwise rate.",
        ],
      );
    }
    const odds = groups.every(
        (g) => g.tp + g.fn >= minimumClass && g.fp + g.tn >= minimumClass,
      )
        ? Math.max(
            spread(groups.map((g) => g.tpr!)),
            spread(groups.map((g) => g.fpr!)),
          )
        : null,
      decision = decideEqualizedOdds(odds, support, {
        ...groupCriteria,
        minimumClassCount: minimumClass,
        maximumOddsGap: c.maximumOddsGap ?? c.maximumParityGap,
      });
    return result(
      testId,
      "Equalized odds",
      "10",
      decision,
      [
        ratio(
          "maximum_tpr_fpr_gap",
          decision.outcome === "inconclusive" ? null : odds,
          groups,
        ),
      ],
      [
        "Inconclusive unless positive and negative denominators meet minimum size in every group. No confidence intervals are estimated.",
      ],
    );
  };
  return run.suite.map((id) =>
    id === "performance"
      ? performance()
      : ["demographic_parity", "disparate_impact", "equalized_odds"].includes(
            id,
          )
        ? fairness(id)
        : result(
            id,
            id.replaceAll("_", " "),
            "15",
            {
              outcome: "inconclusive",
              reasons: [
                "Requires a trusted Python model adapter or reference dataset; capability not enabled in interactive runner.",
              ],
            },
            [],
          ),
  );
}
