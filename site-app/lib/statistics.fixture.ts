// Shared by the golden test suites: the fixture of
// docs/design/audit-statistics.md section 13 and its comparison rules
// (numbers within the fixture's tolerances, p-values within its absolute
// plus relative tolerance, reasons as sets, normalizedPlan exactly).
import { readFileSync } from "node:fs";

export type Json =
  null | boolean | number | string | Json[] | { [k: string]: Json };
export const GOLDEN = JSON.parse(
  readFileSync(
    new URL("../../schemas/fixtures/statistics-golden.json", import.meta.url),
    "utf8",
  ),
);
export const TOLERANCES = GOLDEN.tolerances;

/** Drops the private helpers the core attaches to members (keys starting with an underscore) and undefined fields. */
export function publicView(value: unknown): Json {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      key.startsWith("_") || typeof item === "function" ? undefined : item,
    ),
  );
}

function close(actual: Json, expected: Json, key: string) {
  if (typeof actual !== "number" || typeof expected !== "number")
    return actual === expected;
  const lower = key.toLowerCase();
  if (
    lower.includes("pvalue") ||
    lower.includes("fisher") ||
    lower.includes("chanceexactp")
  )
    return (
      Math.abs(actual - expected) <=
      TOLERANCES.pValueAbsolute + TOLERANCES.pValueRelative * Math.abs(expected)
    );
  return Math.abs(actual - expected) <= TOLERANCES.estimate;
}

/** Paths where actual differs from expected; inside normalizedPlan every value must match exactly. */
export function differences(
  actual: Json,
  expected: Json,
  path = "",
  out: string[] = [],
  exact = false,
): string[] {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    if (
      actual === null ||
      typeof actual !== "object" ||
      Array.isArray(actual)
    ) {
      out.push(`${path}: expected an object`);
      return out;
    }
    const a = Object.keys(actual).sort().join(),
      e = Object.keys(expected).sort().join();
    if (a !== e) {
      out.push(`${path}: keys differ (${a} vs ${e})`);
      return out;
    }
    for (const key of Object.keys(expected)) {
      if (key === "reasons") {
        const left = new Set(actual[key] as string[]),
          right = new Set(expected[key] as string[]);
        if (left.size !== right.size || [...left].some((r) => !right.has(r)))
          out.push(`${path}.${key}: ${[...left]} != ${[...right]}`);
      } else
        differences(
          actual[key],
          expected[key],
          `${path}.${key}`,
          out,
          exact || key === "normalizedPlan",
        );
    }
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      out.push(`${path}: list length differs`);
    else
      expected.forEach((item, i) =>
        differences(actual[i], item, `${path}[${i}]`, out, exact),
      );
  } else if (exact) {
    if (actual !== expected)
      out.push(
        `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)} (exact)`,
      );
  } else if (!close(actual, expected, path))
    out.push(
      `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
    );
  return out;
}
