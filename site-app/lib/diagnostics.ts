import type { Run, Result, Metric } from "./domain";
import { assertSuite, fairnessSelected } from "./evaluation";
// Inclusive criteria tolerate floating-point arithmetic noise, never rounded UI values.
const tolerance = (a: number, b: number) =>
  1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
const atMost = (a: number, b: number) => a <= b + tolerance(a, b);
const atLeast = (a: number, b: number) => a >= b - tolerance(a, b);
const numericCell = (v: string) =>
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) &&
  Number.isFinite(Number(v));
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
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
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed CSV field");
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  if (rows.length < 2) throw Error("CSV needs a header and data rows");
  const header = rows.shift()!.map((x) => x.replace(/^\uFEFF/, "").trim());
  if (new Set(header).size !== header.length || header.some((x) => !x))
    throw Error("Column names must be unique and nonempty");
  if (rows.length > 10000)
    throw Error(
      "Interactive diagnostics accept at most 10,000 rows; use the Python worker for larger datasets",
    );
  if (header.length > 200)
    throw Error("Interactive diagnostics accept at most 200 columns");
  return rows.map((r, i) => {
    if (r.length !== header.length)
      throw Error("Column count mismatch at data row " + (i + 1));
    return Object.fromEntries(header.map((h, j) => [h, r[j].trim()]));
  });
}
export function inspectCSV(csv: string) {
  const data = parseCSV(csv);
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
  const data = parseCSV(csv),
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
      (labels.size !== 2 || !labels.has(c.positiveLabel))
    )
      throw Error(
        "Binary evaluation requires two class labels and a valid favourable label",
      );
  }
  if (fair && new Set(data.map((r) => r[c.groupColumn])).size > 50)
    throw Error("Interactive diagnostics support at most 50 groups");
  return data;
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
    outcome: Result["outcome"],
    metrics: Metric[],
    limitations: string[] = [],
  ): Result => ({ testId, label, article, outcome, metrics, limitations });
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
        data.length < minimumN
          ? "inconclusive"
          : atMost(rmse, c.maximumRmse ?? 1)
            ? "pass"
            : "fail",
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
      accuracy =
        data.filter((r) => r[c.labelColumn] === r[c.predictionColumn]).length /
        data.length,
      macro = classes.reduce((sum, g) => sum + (g.f1 ?? 0), 0) / classes.length,
      balanced = classes.every((g) => g.recall !== null)
        ? classes.reduce((sum, g) => sum + g.recall!, 0) / classes.length
        : null,
      enough =
        data.length >= minimumN &&
        classes.length >= 2 &&
        classes.every((g) => g.support >= minimumClass);
    return [
      result(
        "performance",
        "Multiclass classification performance",
        "15",
        !enough
          ? "inconclusive"
          : atLeast(accuracy, c.minimumAccuracy) &&
              atLeast(macro, c.minimumMacroF1 ?? 0.7)
            ? "pass"
            : "fail",
        [
          {
            name: "accuracy",
            value: accuracy,
            unit: "ratio",
            sampleSize: data.length,
          },
          {
            name: "macro_f1",
            value: macro,
            unit: "ratio",
            sampleSize: data.length,
            details: classes,
          },
          {
            name: "balanced_accuracy",
            value: balanced,
            unit: "ratio",
            sampleSize: data.length,
          },
        ],
        [
          ...limits,
          "Macro F1 averages all observed reference/prediction classes. Undeclared missing classes cannot be assessed.",
          ...(!enough
            ? [
                "Total or per-class reference support is below the protocol minimum.",
              ]
            : []),
        ],
      ),
    ];
  }
  const confusion = (rows: typeof data) => {
    let tp = 0,
      tn = 0,
      fp = 0,
      fn = 0;
    for (const r of rows) {
      const actual = r[c.labelColumn] === c.positiveLabel,
        predicted = r[c.predictionColumn] === c.positiveLabel;
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
  const total = confusion(data),
    accuracy = (total.tp + total.tn) / total.n,
    groupNames = fairnessSelected(run.suite)
      ? [...new Set(data.map((r) => r[c.groupColumn]))].sort()
      : [];
  const groups = groupNames.map((g) => ({
      group: g,
      ...confusion(data.filter((r) => r[c.groupColumn] === g)),
    })),
    enough =
      data.length >= minimumN &&
      groups.length > 1 &&
      groups.every((g) => g.n >= c.minimumGroupSize),
    rates = groups.map((g) => g.rate),
    gap = Math.max(...rates) - Math.min(...rates),
    ratio =
      Math.max(...rates) > 0 ? Math.min(...rates) / Math.max(...rates) : null,
    oddsReady =
      enough &&
      groups.every(
        (g) => g.tp + g.fn >= minimumClass && g.fp + g.tn >= minimumClass,
      ),
    odds = oddsReady
      ? Math.max(
          Math.max(...groups.map((g) => g.tpr!)) -
            Math.min(...groups.map((g) => g.tpr!)),
          Math.max(...groups.map((g) => g.fpr!)) -
            Math.min(...groups.map((g) => g.fpr!)),
        )
      : null;
  const metric = (
    name: string,
    value: number | null,
    details?: unknown,
  ): Metric => ({
    name,
    value,
    unit: "ratio",
    sampleSize: data.length,
    details,
  });
  const performanceReady =
    data.length >= minimumN &&
    total.tp + total.fn >= minimumClass &&
    total.tn + total.fp >= minimumClass;
  const definitions: Record<string, Result> = {
    performance: result(
      "performance",
      "Binary classification performance",
      "15",
      !performanceReady
        ? "inconclusive"
        : atLeast(accuracy, c.minimumAccuracy) &&
            atLeast(total.tpr!, c.minimumRecall ?? 0.7)
          ? "pass"
          : "fail",
      [
        metric("accuracy", accuracy, total),
        metric(
          "precision",
          total.tp + total.fp ? total.tp / (total.tp + total.fp) : null,
        ),
        metric("recall", total.tpr),
        metric(
          "f1",
          2 * total.tp + total.fp + total.fn
            ? (2 * total.tp) / (2 * total.tp + total.fp + total.fn)
            : null,
        ),
      ],
      [
        ...limits,
        ...(!performanceReady
          ? [
              "Total or positive/negative reference support is below the protocol minimum.",
            ]
          : []),
      ],
    ),
    demographic_parity: result(
      "demographic_parity",
      "Demographic parity",
      "10",
      !enough
        ? "inconclusive"
        : atMost(gap, c.maximumParityGap)
          ? "pass"
          : "fail",
      [metric("maximum_selection_rate_gap", gap, groups)],
      [
        "Group contrasts use max minus min rates; protected-data processing requires a separately reviewed basis.",
      ],
    ),
    disparate_impact: result(
      "disparate_impact",
      "Disparate impact",
      "10",
      !enough || ratio === null
        ? "inconclusive"
        : atLeast(ratio, c.minimumImpactRatio)
          ? "pass"
          : "fail",
      [metric("minimum_selection_rate_ratio", ratio, groups)],
      [
        "Internal policy threshold; no EU AI Act numerical safe harbour. Groups use minimum-to-maximum pairwise rate.",
      ],
    ),
    equalized_odds: result(
      "equalized_odds",
      "Equalized odds",
      "10",
      odds === null
        ? "inconclusive"
        : atMost(odds, c.maximumOddsGap ?? c.maximumParityGap)
          ? "pass"
          : "fail",
      [metric("maximum_tpr_fpr_gap", odds, groups)],
      [
        "Inconclusive unless positive and negative denominators meet minimum size in every group. No confidence intervals are estimated.",
      ],
    ),
  };
  return run.suite.map(
    (id) =>
      definitions[id] ??
      result(
        id,
        id.replaceAll("_", " "),
        "15",
        "inconclusive",
        [],
        [
          "Requires a trusted Python model adapter or reference dataset; capability not enabled in interactive runner.",
        ],
      ),
  );
}
