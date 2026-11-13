// The statistical criteria of the Art 50 research procedures (A50-P-01-C01
// and the others, #120) as data: lib/art50-criteria.json is extracted from
// docs/research/art50-transparency-2026-11.json by `npm run sync`, and each
// deciding criterion names its threshold-library entry (A50-ED-40,
// schemas/threshold-library.json) with the parameters that give its band.
// The entries are internal policy labelled no_legal_safe_harbour; their kind
// is attribute_sampling, which the tabular runners do not decide, so the Site
// shows them as the plan's criteria. Since the GenAI engine (#32) decides
// marking and self-identification rates (genai_marking), the criteria on
// those metrics can be pre-registered in a GenAI plan for the auditor to
// review and freeze (#152); the others stay attribute sampling recorded by
// the auditor.
import data from "./art50-criteria.json";
import library from "./threshold-library.json";

export type Art50Band = { lower: number } | { upper: number };
export type Art50Criterion = {
  id: string;
  metric: string;
  band: Art50Band | null;
  bandBasis:
    | "methodology_default"
    | "provider_declared"
    | "provider_declared_else_default"
    | "descriptive";
  members: string;
  role: "confirmatory" | "exploratory" | "descriptive";
  minimumN: number;
  libraryEntry: {
    id: string;
    version: number;
    parameters: Record<string, number>;
  } | null;
};
type LibraryEntry = {
  id: string;
  version: number;
  band?: string;
  legalStatus: string;
  caveat: string;
  statusNotes: { asOf: string; text: string; source: string }[];
};
/** A criterion with its research procedure and the library entry it uses. */
export type ResolvedArt50Criterion = Art50Criterion & {
  procedureId: string;
  entry: LibraryEntry | null;
};

const procedures = data.procedures as unknown as {
  id: string;
  catalogItemId: string;
  criteria: Art50Criterion[];
}[];
const entries = library.entries as unknown as LibraryEntry[];

/** The research file the criteria come from, and its shared caveat. */
export const art50CriteriaSource = {
  source: data.source,
  method: data.method,
  caveat: data.caveat,
};

/** The statistical criteria of the given research procedures, in order. */
export function art50Criteria(
  procedureIds: readonly string[],
): ResolvedArt50Criterion[] {
  return procedureIds.flatMap(
    (procedureId) =>
      procedures
        .find((p) => p.id === procedureId)
        ?.criteria.map((c) => ({
          ...c,
          procedureId,
          entry: c.libraryEntry
            ? (entries.find(
                (e) =>
                  e.id === c.libraryEntry!.id &&
                  e.version === c.libraryEntry!.version,
              ) ?? null)
            : null,
        })) ?? [],
  );
}

/** The band in words, with how a declared rate moves it. */
export function art50BandText(c: Art50Criterion): string {
  if (!c.band) return "Descriptive: no band";
  const [bound, value] = Object.entries(c.band)[0] as [string, number];
  const p = c.libraryEntry?.parameters ?? {};
  if (typeof p.tolerance === "number" && c.bandBasis !== "methodology_default")
    return (
      bound +
      " bound " +
      value +
      " when no rate is declared; otherwise the declared rate " +
      (bound === "lower" ? "minus " : "plus ") +
      p.tolerance
    );
  return bound + " bound " + value;
}

/** The library reference as `id@version`. */
export const libraryRef = (c: Art50Criterion) =>
  c.libraryEntry ? c.libraryEntry.id + "@" + c.libraryEntry.version : "none";

/**
 * The genai_marking metric that decides an Art 50 criterion's metric, from
 * the marking metrics of genai-plan/0.1 (engine/genai/plan.py MARKING_METRICS).
 */
export const ART50_GENAI_METRICS: Readonly<Record<string, string>> = {
  self_identification_rate: "self_identification_rate",
  marking_presence_rate: "marking_presence",
  detection_rate_unaltered: "detection_rate",
  false_positive_rate: "false_positive_rate",
};

export type Art50GenaiCriterion = {
  id: string;
  kind: "genai_marking";
  role: "confirmatory" | "exploratory";
  metric: string;
  band: Art50Band;
};
export type Art50GenaiPlan = {
  plan: {
    schemaVersion: "genai-plan/0.1";
    minimums: { memberSize: number };
    criteria: Art50GenaiCriterion[];
  };
  /** The criteria the plan pre-registers, as the research states them. */
  preRegistered: ResolvedArt50Criterion[];
  /** Criteria GenAI evidence does not decide: descriptive or attribute sampling. */
  notDecided: ResolvedArt50Criterion[];
};

/**
 * The Art 50 criteria of a catalogue paper that GenAI marking evidence
 * decides, as a genai-plan/0.1 the auditor reviews, edits and freezes for the
 * paper's procedure (#152); null when the paper has none. A declared-rate
 * criterion carries the band used when the provider declares no rate.
 */
export function art50GenaiPlan(templateId: string): Art50GenaiPlan | null {
  const criteria = art50Criteria(
    procedures.filter((p) => p.catalogItemId === templateId).map((p) => p.id),
  );
  const decided = (c: ResolvedArt50Criterion) =>
    !!c.band &&
    c.role !== "descriptive" &&
    Object.hasOwn(ART50_GENAI_METRICS, c.metric);
  const preRegistered = criteria.filter(decided);
  if (!preRegistered.length) return null;
  return {
    plan: {
      schemaVersion: "genai-plan/0.1",
      // The research's floor of evaluated items per member (minimumN).
      minimums: {
        memberSize: Math.max(...preRegistered.map((c) => c.minimumN)),
      },
      criteria: preRegistered.map((c) => ({
        id: c.id,
        kind: "genai_marking",
        role: c.role === "exploratory" ? "exploratory" : "confirmatory",
        metric: ART50_GENAI_METRICS[c.metric],
        band: c.band!,
      })),
    },
    preRegistered,
    notDecided: criteria.filter((c) => !decided(c)),
  };
}
