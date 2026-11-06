import type { Run } from "./domain";
import { assertSuite, fairnessSelected } from "./evaluation";
import {
  evaluateHostedPlan,
  resolvePlan,
  type HostedEvaluation,
  type Rows,
} from "./hosted-statistics";
import type { Plan } from "./statistics";
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
/**
 * Validates a frozen run's rows against its column mappings and declared
 * labels. A binary profile that declares both labels (positiveLabel and
 * negativeLabel, schemaVersion 1.1) evaluates data in which only one of them
 * occurs; the statistics gates then decide (section 12). A legacy profile
 * keeps the check that both labels occur.
 */
export function validateEvaluation(
  run: Pick<Run, "config" | "task" | "suite">,
  csv: string,
): Rows {
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
    // Only the performance test measures its own positive class.
    const positive = run.suite.includes("performance")
      ? c.performancePositiveLabel || c.positiveLabel
      : c.positiveLabel;
    if (task === "Binary classification" && c.negativeLabel) {
      const declared = new Set([c.positiveLabel, c.negativeLabel]);
      const other = [...labels].filter((label) => !declared.has(label));
      if (other.length)
        throw Error(
          `Binary evaluation declares the labels '${c.positiveLabel}' and '${c.negativeLabel}'; the data also uses ` +
            other
              .slice(0, 5)
              .map((label) => `'${label}'`)
              .join(", "),
        );
    } else if (
      task === "Binary classification" &&
      (labels.size !== 2 ||
        !labels.has(c.positiveLabel) ||
        !labels.has(positive))
    )
      throw Error(
        `Binary evaluation requires two class labels, including the favourable label '${c.positiveLabel}'` +
          (positive !== c.positiveLabel
            ? ` and the performance positive class '${positive}'`
            : ""),
      );
  }
  if (fair && new Set(data.map((r) => r[c.groupColumn])).size > 50)
    throw Error("Interactive diagnostics support at most 50 groups");
  return data;
}
/**
 * The plan that decides a run: the plan frozen into its manifest, else the
 * profile's stored plan, else the section 9.3 derivation from its legacy
 * configuration (a multiclass baseline takes k from the rows).
 */
export function runPlan(
  run: Pick<Run, "config" | "task" | "suite" | "manifest">,
  rows: Rows,
): Plan {
  return resolvePlan(
    run.task ?? "Binary classification",
    run.suite,
    run.config,
    run.manifest?.statistics ?? run.manifest?.profile?.statistics,
    rows,
  );
}
/**
 * Evaluates a frozen run under statistics 1.0.0: one result per criterion
 * of its plan, each deciding by its interval against the pre-registered
 * band, with n and an interval for every metric.
 */
export function evaluate(
  run: Pick<Run, "config" | "task" | "suite" | "manifest">,
  csv: string,
): HostedEvaluation {
  const rows = validateEvaluation(run, csv);
  return evaluateHostedPlan(
    runPlan(run, rows),
    rows,
    run.config,
    run.task ?? "Binary classification",
  );
}
