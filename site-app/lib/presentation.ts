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
    maximumRmse: "Maximum RMSE",
    mae: "MAE",
    rmse: "RMSE",
    r2: "R²",
    baseline_rmse: "Baseline RMSE (predicting the mean)",
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
const PAIRWISE_SHOWN = 6;
/** The metrics a narrative lists: all of them, except that a long list of pairwise comparisons keeps the deciding one and the first few. */
function narrativeMetrics(result: Result) {
  const pairwise = result.metrics.filter(
    (m) => (m.details as { subject?: string | null })?.subject,
  );
  if (pairwise.length <= PAIRWISE_SHOWN)
    return { shown: result.metrics, more: 0 };
  const kept = new Set([
    ...pairwise.slice(0, PAIRWISE_SHOWN),
    ...pairwise.filter((m) => m.name === result.decision?.decidingMemberId),
  ]);
  const shown = result.metrics.filter(
    (m) => !pairwise.includes(m) || kept.has(m),
  );
  return { shown, more: result.metrics.length - shown.length };
}
export function diagnosticNarrative(results: Result[]) {
  return results
    .map((result) => {
      const d = result.decision;
      const { shown, more } = narrativeMetrics(result);
      return [
        result.label + " — " + humanLabel(result.outcome),
        "Article " + result.article,
        ...(d
          ? [
              `Decision (statistics ${d.statisticsVersion}, ${d.role}): ${d.direction} at p = ${d.pValue.toPrecision(3)}, adjusted p = ${(d.adjustedPValue ?? 1).toPrecision(3)} (${humanLabel(d.adjustment ?? "")} over ${d.familySize}); ${Math.round(d.confidenceLevel * 100)}% intervals decide against the pre-registered band.`,
            ]
          : []),
        ...shown.map(
          (metric) =>
            humanLabel(metric.name) +
            ": " +
            (metric.value === null
              ? "Not estimable"
              : metric.value.toFixed(4)) +
            (metric.confidenceInterval
              ? ` [${metric.confidenceInterval.lower.toFixed(4)}, ${metric.confidenceInterval.upper.toFixed(4)}]`
              : "") +
            " (n = " +
            (metric.denominator ?? metric.sampleSize) +
            ")",
        ),
        ...(more
          ? [`${more} further pairwise comparisons are in the run record.`]
          : []),
        ...result.limitations.map((text) => "Limitation: " + text),
      ].join("\n");
    })
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
