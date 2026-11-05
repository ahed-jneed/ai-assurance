import type { Result } from "./domain";
export function humanLabel(value: string) {
  const names: Record<string, string> = {
    id: "Reference",
    userId: "Person",
    authorId: "Prepared by",
    createdBy: "Created by",
    articleRefs: "Requirements",
    regulatoryRefs: "Regulatory references",
    evidenceIds: "Linked evidence",
    runIds: "Diagnostic runs",
    candidateEvidenceIds: "Candidate evidence",
    paperIds: "Working papers",
    signOffGate: "Completion requirement",
    sampleSize: "Rows",
    minimumGroupSize: "Minimum group size",
    maximumParityGap: "Maximum parity gap",
    minimumImpactRatio: "Minimum impact ratio",
    minimumAccuracy: "Minimum accuracy",
  };
  return (
    names[value] ??
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/\bsha256\b/gi, "SHA-256")
      .replace(/^./, (c) => c.toUpperCase())
  );
}
export function diagnosticNarrative(results: Result[]) {
  return results
    .map((result) =>
      [
        result.label + " — " + humanLabel(result.outcome),
        "Article " + result.article,
        ...result.metrics.map(
          (metric) =>
            humanLabel(metric.name) +
            ": " +
            (metric.value === null
              ? "Not estimable"
              : metric.value.toFixed(4)) +
            " (n = " +
            metric.sampleSize +
            ")",
        ),
        ...result.limitations.map((text) => "Limitation: " + text),
      ].join("\n"),
    )
    .join("\n\n");
}
export function readableResults(text: string) {
  try {
    const value = JSON.parse(text);
    if (
      Array.isArray(value) &&
      value.every(
        (r) =>
          r &&
          typeof r.label === "string" &&
          Array.isArray(r.metrics) &&
          Array.isArray(r.limitations),
      )
    )
      return diagnosticNarrative(value as Result[]);
  } catch {}
  return text;
}
