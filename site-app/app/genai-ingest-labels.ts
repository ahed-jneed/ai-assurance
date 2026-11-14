// Readable labels for the frozen plans and declared bundles the GenAI tab's
// "Queue ingest" dialog offers (#211), as #202 did for prediction lineage:
// what the record is and when it was made, never its raw record id.
import { count } from "@/lib/presentation";
import type { GenaiView } from "@/lib/read-models/genai-view";

type Procedure = { id: string; templateId: string; title: string };

const day = (at: string) => String(at ?? "").slice(0, 10);

/** "WP-GA-01 Accuracy of answers · 2 criteria · 2026-11-03". */
export function planOptionLabel(
  p: Pick<GenaiView["plans"][number], "procedureId" | "plan" | "createdAt">,
  procedures: Procedure[],
) {
  const procedure = procedures.find((q) => q.id === p.procedureId),
    criteria = (p.plan as { criteria?: unknown } | null)?.criteria;
  return [
    procedure ? procedure.templateId + " " + procedure.title : "GenAI plan",
    Array.isArray(criteria)
      ? count(criteria.length, "criterion", "criteria")
      : "",
    day(p.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "judged_qa_30.eval, judge_large_200.jsonl · 2026-11-03"; with more than two
 * inputs, the first two names and how many more.
 */
export function bundleOptionLabel(
  b: Pick<
    GenaiView["bundles"][number],
    "inputs" | "inputArtifactIds" | "createdAt"
  >,
) {
  const names = (Array.isArray(b.inputs) ? (b.inputs as unknown[]) : [])
    .map((i) =>
      i && typeof (i as { name?: unknown }).name === "string"
        ? (i as { name: string }).name
        : "",
    )
    .filter(Boolean);
  const total = Math.max(names.length, b.inputArtifactIds.length),
    shown = names.slice(0, 2),
    rest = total - shown.length;
  const inputs = !shown.length
    ? count(total, "input")
    : shown.join(", ") + (rest > 0 ? " and " + count(rest, "more input") : "");
  return [inputs, day(b.createdAt)].filter(Boolean).join(" · ");
}
