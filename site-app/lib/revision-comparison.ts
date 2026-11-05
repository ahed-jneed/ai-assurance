export type Difference = { label: string; before: string; after: string };
const human = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export function compareFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {},
): Difference[] {
  const text = (v: unknown): string =>
    v == null
      ? "Not recorded"
      : Array.isArray(v)
        ? v
            .map((x) =>
              typeof x === "object" && x
                ? Object.entries(x)
                    .map(([k, y]) => human(k) + ": " + String(y))
                    .join(" · ")
                : String(x),
            )
            .join("\n")
        : typeof v === "object"
          ? Object.entries(v)
              .map(([k, y]) => human(k) + ": " + text(y))
              .join("\n")
          : String(v) || "Not recorded";
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({
      label: labels[k] ?? human(k),
      before: text(before[k]),
      after: text(after[k]),
    }));
}
