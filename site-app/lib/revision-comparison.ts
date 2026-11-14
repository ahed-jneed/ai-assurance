import { fieldValue, humanLabel } from "./presentation";
export type Difference = { label: string; before: string; after: string };
// Field names and coded values read as labels (#234 item 6): "Outcome:
// Supported", not "Outcome: supported".
const human = humanLabel;
export function compareFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {},
): Difference[] {
  const text = (v: unknown, key = ""): string =>
    v == null
      ? "Not recorded"
      : Array.isArray(v)
        ? v
            .map((x) =>
              typeof x === "object" && x
                ? Object.entries(x)
                    .map(([k, y]) => human(k) + ": " + fieldValue(k, y))
                    .join(" · ")
                : String(x),
            )
            .join("\n")
        : typeof v === "object"
          ? Object.entries(v)
              .map(([k, y]) => human(k) + ": " + text(y, k))
              .join("\n")
          : fieldValue(key, v) || "Not recorded";
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({
      label: labels[k] ?? human(k),
      before: text(before[k], k),
      after: text(after[k], k),
    }));
}
