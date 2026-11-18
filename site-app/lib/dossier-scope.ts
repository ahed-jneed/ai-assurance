// Scoped dossier exports (#83). A large audit file can be exported in parts:
// the pinned assurance records of chosen procedures, of chosen record types or
// created within a period, with or without the evidence bytes. Manifest 1.2
// signs the scope and how many of the report's pinned records it includes;
// report.json still lists every pin, so the omitted records stay identifiable.
import { z } from "./zod";
import { ApiError } from "./http";

/** The verifier's bound on files per dossier (engine/assurance.py MAX_FILES). */
export const maxDossierFiles = 500;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Period dates are calendar dates (YYYY-MM-DD)")
  .refine((d) => {
    const t = Date.parse(d + "T00:00:00.000Z");
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "Period dates must be real calendar dates");
const label = z.string().trim().min(1).max(200);

/** A scope as an audit lead requests it. */
export const dossierScopeRequest = z
  .object({
    procedureIds: z.array(label).min(1).max(100).optional(),
    recordKinds: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/, "Unknown record type"))
      .min(1)
      .max(100)
      .optional(),
    period: z
      .object({ from: day, to: day })
      .strict()
      .refine((p) => p.from <= p.to, "The period must not end before it starts")
      .optional(),
    evidence: z.enum(["included", "withheld"]).default("included"),
  })
  .strict()
  .refine(
    (s) =>
      s.procedureIds || s.recordKinds || s.period || s.evidence === "withheld",
    "A scope selects procedures, record types, a period or withholds evidence; omit it for the full dossier",
  );
export type DossierScopeRequest = z.infer<typeof dossierScopeRequest>;

/** What defines a scope: the part of manifest 1.2's `scope` the seal is keyed on. */
export type DossierScopeDefinition = {
  procedureIds: string[] | null;
  recordKinds: string[] | null;
  /** UTC calendar dates of record creation, both inclusive. */
  period: { from: string; to: string } | null;
  evidence: "included" | "withheld";
};
/** Manifest 1.2's signed `scope`: the definition and the records it includes. */
export type DossierScope = DossierScopeDefinition & {
  pinnedRecords: number;
  includedRecords: number;
};

const sortedUnique = (values?: string[]) =>
  values ? [...new Set(values)].sort() : null;

/** The canonical definition of a requested scope: sorted, deduplicated lists. */
export function scopeDefinition(
  request: DossierScopeRequest,
  procedures: readonly string[],
): DossierScopeDefinition {
  const unknown = (request.procedureIds ?? []).filter(
    (id) => !procedures.includes(id),
  );
  if (unknown.length)
    throw new ApiError(
      400,
      "Unknown procedure for this engagement: " + unknown.join(", "),
    );
  return {
    procedureIds: sortedUnique(request.procedureIds),
    recordKinds: sortedUnique(request.recordKinds),
    period: request.period
      ? { from: request.period.from, to: request.period.to }
      : null,
    evidence: request.evidence,
  };
}

/** What a scope can select a pinned record by: its row, not its body. */
export type PinnedRecordFacts = {
  kind: string;
  createdAt: string;
  procedureId: string | null;
};

/** Whether a pinned record falls within the scope. */
export function inScope(
  scope: DossierScopeDefinition,
  facts: PinnedRecordFacts,
) {
  if (scope.recordKinds && !scope.recordKinds.includes(facts.kind))
    return false;
  if (
    scope.procedureIds &&
    !(facts.procedureId && scope.procedureIds.includes(facts.procedureId))
  )
    return false;
  if (scope.period) {
    const created = facts.createdAt.slice(0, 10);
    if (created < scope.period.from || created > scope.period.to) return false;
  }
  return true;
}

/** A one-line statement of the scope for report.html and the workspace. */
export function describeScope(scope: DossierScope) {
  const parts = [
    scope.procedureIds
      ? "procedures " + scope.procedureIds.join(", ")
      : "all procedures",
    scope.recordKinds
      ? "record types " + scope.recordKinds.join(", ")
      : "all record types",
    scope.period
      ? "created " + scope.period.from + " to " + scope.period.to + " (UTC)"
      : "any date",
    scope.evidence === "withheld"
      ? "evidence bytes withheld"
      : "evidence bytes included",
  ];
  return (
    "Scoped export: " +
    parts.join("; ") +
    ". Includes " +
    scope.includedRecords +
    " of " +
    scope.pinnedRecords +
    " pinned assurance records; report.json lists them all."
  );
}
