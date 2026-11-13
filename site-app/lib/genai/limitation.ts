// The report's generative-AI limitation (D-01, #80): pack #1 states on every
// report that the platform's diagnostics do not evaluate generative AI
// outputs. The sentence now follows the facts: it is dropped when the
// classified system is neither generative nor built on a general-purpose AI
// model, and when signed GenAI evidence without blockers supports a
// conclusion of the engagement (#33). An unknown fact keeps it. The released
// pack text never changes; issued snapshots keep the text they were issued
// with. Pure.
import { classificationFactValues } from "../domain/classification";
import { paperCurrent } from "../domain/gates";
import type { Engagement } from "../domain/types";
import { any, factTruth, type Truth } from "../predicates";

/** The sentence of pack #1's reporting limitations this rule governs. */
export const GENAI_LIMITATION =
  "The platform's diagnostics evaluate traditional ML systems; they do not yet evaluate generative AI outputs, so conclusions on generative systems rest on the auditor's own procedures and evidence.";

/** Facts that make a system generative or GPAI-based (lib/domain/classification.ts). */
export const GENERATIVE_FACTS = [
  "generatesSyntheticContent",
  "generatesSyntheticText",
  "generatesSyntheticImage",
  "generatesSyntheticAudio",
  "generatesSyntheticVideo",
  "gpaiModelProvider",
  "gpaiDownstreamProvider",
  "builtOnOwnGpaiModel",
] as const;

/** Whether the classified system is generative or GPAI-based, three-valued. */
export function generativeSystem(e: Pick<Engagement, "classification">): Truth {
  if (!e.classification) return "unknown";
  const facts = classificationFactValues(e.classification);
  return any(GENERATIVE_FACTS.map((f) => factTruth(facts, f)));
}

/**
 * The papers whose GenAI evidence may cover the engagement: current, signed,
 * concluding supported or qualified, with evidence. Whether their linked
 * results are free of blockers is the caller's lookup.
 */
export function genaiCoverageCandidates(e: Engagement) {
  return e.papers.filter(
    (p) =>
      p.status === "signed" &&
      paperCurrent(p) &&
      ["supported", "qualified"].includes(p.body.conclusionStatus) &&
      p.evidenceIds.length > 0,
  );
}

/** The pack's limitations text with the generative-AI sentence where it applies. */
export function reportLimitationText(
  packText: string,
  facts: { generative: Truth; genaiCovered: boolean },
) {
  if (!packText.includes(GENAI_LIMITATION)) return packText;
  if (facts.generative !== false && !facts.genaiCovered) return packText;
  return packText
    .replace(GENAI_LIMITATION, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
