// Readable labels for the frozen plans and declared bundles the GenAI tab's
// "Queue ingest" dialog offers (#211), as #202 did for prediction lineage:
// what the record is and when it was made, never its raw record id. The
// assurance workbench names a GenAI ingest job by its plan's label (#221).
import { count } from "@/lib/presentation";
import type { GenaiView } from "@/lib/read-models/genai-view";

type Procedure = { id: string; templateId: string; title: string };

/** How a label states its time: the viewer's local time, to the minute. */
export const stampFormat: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * When a record was made, to the minute, so that two records of one day
 * differ: in the viewer's local time and format, like the other times of
 * the workspace (#227), never UTC without a zone. Empty when unknown.
 */
export function stamp(at: string | null | undefined) {
  const time = at ? new Date(at) : null;
  return time && !Number.isNaN(time.getTime())
    ? time.toLocaleString(undefined, stampFormat)
    : "";
}

/**
 * Names that tell records apart, as distinctOptions does for options: a
 * name that records of different keys share ends in a short suffix of each
 * key ("· aaaaaa"); records of one key share their name.
 */
export function distinctNames<T>(
  records: T[],
  name: (record: T) => string,
  key: (record: T) => string | null | undefined,
): string[] {
  const names = records.map(name),
    keys = new Map<string, Set<string>>();
  records.forEach((r, i) => {
    const k = key(r);
    if (!k) return;
    keys.set(names[i], (keys.get(names[i]) ?? new Set()).add(k));
  });
  return records.map((r, i) => {
    const k = key(r);
    return k && (keys.get(names[i])?.size ?? 0) > 1
      ? names[i] + " · " + k.slice(-6)
      : names[i];
  });
}

/** "WP-GA-01 Accuracy of answers · 2 criteria · 2026-11-03 09:15". */
export function planOptionLabel(
  p: Pick<GenaiView["plans"][number], "procedureId" | "plan" | "createdAt">,
  procedures: Procedure[],
) {
  const criteria = (p.plan as { criteria?: unknown } | null)?.criteria;
  return planLabel(
    p.procedureId,
    Array.isArray(criteria) ? criteria.length : undefined,
    p.createdAt,
    procedures,
  );
}

/**
 * A plan's label from its parts: the procedure it was frozen for, how many
 * criteria it states and when it was frozen. Each part is left out when
 * unknown; without a known procedure it reads "GenAI plan".
 */
export function planLabel(
  procedureId: string | null | undefined,
  criteria: number | null | undefined,
  createdAt: string | null | undefined,
  procedures: Procedure[],
) {
  const procedure = procedures.find((q) => q.id === procedureId);
  return [
    procedure ? procedure.templateId + " " + procedure.title : "GenAI plan",
    typeof criteria === "number"
      ? count(criteria, "criterion", "criteria")
      : "",
    stamp(createdAt ?? ""),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "judged_qa_30.eval, judge_large_200.jsonl · 2026-11-03 09:15"; with more
 * than two inputs, the first two names and how many more.
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
  return [inputs, stamp(b.createdAt)].filter(Boolean).join(" · ");
}

/**
 * Options whose labels tell them apart: a label that two records still
 * share (the same procedure, criteria or inputs in the same minute) ends in
 * a short suffix of each record's id; every other label stays as it is.
 */
export function distinctOptions<T extends { id: string }>(
  records: T[],
  label: (record: T) => string,
): { value: string; label: string }[] {
  const labels = distinctNames(records, label, (r) => r.id);
  return records.map((r, i) => ({ value: r.id, label: labels[i] }));
}
