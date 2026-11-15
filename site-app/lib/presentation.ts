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
  // GenAI criterion kinds (genai-plan/0.1), as the GenAI results show them
  // (#240 item 4).
  genai_mean: "Mean score",
  genai_marking: "Marking check",
  genai_attack_success: "Attack success rate",
  genai_paired_difference: "Paired difference",
  genai_pass_k: "Pass at k",
};

/**
 * The GenAI run-metadata fields (lib/genai/summary.ts METADATA_FIELDS) as
 * the run checklist names them (#240 item 4), never their dotted paths.
 */
const genaiFieldNames: Record<string, string> = {
  harness: "Harness",
  "systemUnderTest.snapshot": "System snapshot",
  "systemUnderTest.family": "System model family",
  systemPrompt: "System prompt",
  decoding: "Decoding settings",
  tools: "Tools offered",
  dataset: "Dataset",
  epochs: "Epochs",
  dates: "Run dates",
  attackSet: "Attack set",
  "judges.model": "Judge model",
  "judges.family": "Judge model family",
  "judges.promptTemplate": "Judge prompt template",
  "judges.validation": "Judge validation",
};
/** A GenAI run-metadata field by its label; an unknown one in sentence case. */
export const genaiFieldLabel = (field: string) =>
  genaiFieldNames[field] ?? humanLabel(field.replaceAll(".", " "));

/**
 * The GenAI input formats (lib/genai/requests.ts GENAI_INPUT_FORMATS) by the
 * names of the tools that write them (#244 item 4), never their format ids.
 */
const genaiFormatNames: Record<string, string> = {
  inspect_eval: "Inspect log (.eval)",
  inspect_json: "Inspect log (JSON)",
  lm_eval_samples: "lm-evaluation-harness samples",
  promptfoo_results: "promptfoo results",
  garak_report: "garak report",
  pyrit_export: "PyRIT export",
  deepeval_test_run: "DeepEval test run",
  ragas_results: "Ragas results",
  judge_validation_jsonl: "Judge validation records",
  marking_check_jsonl: "Marking check records",
  c2pa_validator_report: "C2PA validator report",
  signed_detection_jsonl: "Signed detection records",
};
/** A GenAI input format by its tool's name; an unknown one in sentence case. */
export const genaiFormatLabel = (format: string) =>
  genaiFormatNames[format] ?? humanLabel(format);

/**
 * A GenAI result's overall outcome (lib/statistics.ts overallOutcome) as the
 * result card shows it (#244 item 4).
 */
const genaiOutcomeNames: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  inconclusive: "Inconclusive",
  not_applicable: "Not applicable",
};
/** A GenAI overall outcome by its label; an unknown one in sentence case. */
export const genaiOutcomeLabel = (outcome: string) =>
  genaiOutcomeNames[outcome] ?? humanLabel(outcome);

/**
 * A coded value as the page shows it: "one_off" reads "One-off",
 * "no_reassessment" "No reassessment", "true" "Yes". Every other value in
 * sentence case, as humanLabel writes it.
 */
export const valueLabel = (value: string) =>
  Object.hasOwn(valueNames, value) ? valueNames[value] : humanLabel(value);

/**
 * The fields whose string values are coded (an outcome, a method, a policy
 * source), which a record or a revision comparison shows by their label
 * (#234 item 6).
 */
export const codedFields: ReadonlySet<string> = new Set([
  "action",
  "applicability",
  "automationMode",
  "conclusion",
  "conclusionStatus",
  "decision",
  "kind",
  "method",
  "outcome",
  "source",
  "split",
  "state",
  "status",
]);
/**
 * Whether a value is a code: one word, or words joined by underscores or in
 * camel case, starting in lower case ("supported", "internal_policy").
 */
export const isCode = (value: string) =>
  /^[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*$/.test(value);
/**
 * A field's value as the page shows it: a boolean as Yes or No, and a coded
 * field's code by its label (valueLabel). Free text stays as written.
 */
export function fieldValue(key: string, value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  return codedFields.has(key) && isCode(text) ? valueLabel(text) : text;
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
