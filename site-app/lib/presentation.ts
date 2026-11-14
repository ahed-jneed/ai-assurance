import type { Result } from "./domain/types";
/**
 * A count with its noun: "1 request", "2 requests", "1,200 criteria" (with
 * `many` for an irregular plural). The one pluraliser of the workspace (#216).
 */
export const count = (n: number, one: string, many = one + "s") =>
  n.toLocaleString() + " " + (n === 1 ? one : many);
/**
 * A finding's primary reference as the registers show it: "Article 10" for
 * an AI Act article, otherwise the citation as recorded, e.g. "ISO/IEC 42001
 * 8.4" on a management-system pack (#144).
 */
export const findingReference = (article: string) =>
  /^\d/.test(article) ? "Article " + article : article;
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
    maximum_tpr_fpr_gap: "Maximum TPR/FPR gap",
    maximumTprFprGap: "Maximum TPR/FPR gap",
  };
  // Sentence case (#227): "frozenBy" reads "Frozen by", not "Frozen By";
  // a run of capitals ("modelURL") stays as written.
  return (
    names[value] ??
    value
      .replace(
        /([a-z0-9])([A-Z])(?=[a-z])/g,
        (_, before: string, capital: string) =>
          before + " " + capital.toLowerCase(),
      )
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/\bsha256\b/gi, "SHA-256")
      .replace(/\b(?:id|tpr|fpr|rmse|mae)\b/g, (w) => w.toUpperCase())
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * Readable labels for the coded values the workspace's forms and registers
 * show (#227), where sentence case alone is not enough.
 */
const valueNames: Record<string, string> = {
  true: "Yes",
  false: "No",
  one_off: "One-off",
  follow_up: "Follow-up",
};

/**
 * A coded value as the page shows it: "one_off" reads "One-off",
 * "no_reassessment" "No reassessment", "true" "Yes". Every other value in
 * sentence case, as humanLabel writes it.
 */
export const valueLabel = (value: string) =>
  Object.hasOwn(valueNames, value) ? valueNames[value] : humanLabel(value);
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
