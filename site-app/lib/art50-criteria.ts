// The statistical criteria of the Art 50 research procedures (A50-P-01-C01
// and the others, #120) as data: lib/art50-criteria.json is extracted from
// docs/research/art50-transparency-2026-11.json by `npm run sync`, and each
// deciding criterion names its threshold-library entry (A50-ED-40,
// schemas/threshold-library.json) with the parameters that give its band.
// The entries are internal policy labelled no_legal_safe_harbour; their kind
// is attribute_sampling, which no runner decides before the GenAI evaluation
// evidence of M2 (D-01), so the Site shows them as the plan's criteria.
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
