// The coverage heatmap's filters and its CSV export
// (docs/design/criteria-model.md section 15.2): by state, actor and
// applicability date. Pure and types-only on the views module, so the client
// heatmap and the internal-only CSV route share one definition.
import type { CellState } from "./coverage";
import type { CellView, CoverageResponse } from "./views";

/** "all", or a state / actor / ISO date; "none" picks requirements without one. */
export type CoverageFilters = { state: string; actor: string; date: string };
export const defaultCoverageFilters: CoverageFilters = {
  state: "all",
  actor: "all",
  date: "all",
};
export const NONE = "none";

export const coverageStates: CellState[] = [
  "full",
  "partial",
  "exception",
  "open",
  "parent_only",
  "unmapped",
  "excluded",
  "not_applicable",
];
export const stateLabels: Record<CellState, string> = {
  full: "Covered",
  partial: "Partly covered",
  exception: "Exception in a related source",
  open: "Open",
  parent_only: "Mapped at a higher level only",
  unmapped: "Not mapped",
  excluded: "Excluded from scope",
  not_applicable: "Not applicable",
};
/** "Covered (readiness)": a readiness result is never shown as applicable law. */
export const cellLabel = (c: { state: CellState; readiness: boolean }) =>
  stateLabels[c.state] +
  (c.readiness && (c.state === "full" || c.state === "partial")
    ? " (readiness)"
    : "");

/** The dates a cell carries: reviewed rows of the framework data and derived ones. */
export const cellDates = (c: CellView) => [
  ...new Set([
    ...(c.applicability ?? []).map((a) => a.from),
    ...(c.derivedApplicability ?? []).map((a) => a.from),
  ]),
];

const requirements = (view: Pick<CoverageResponse, "cells">) =>
  view.cells.filter((c) => c.type === "requirement");

/** The actor and date choices a view offers, sorted, and whether "none" applies. */
export function filterOptions(view: Pick<CoverageResponse, "cells">) {
  const cells = requirements(view);
  return {
    actors: [...new Set(cells.flatMap((c) => c.actors ?? []))].sort(),
    actorsMissing: cells.some((c) => !c.actors?.length),
    dates: [...new Set(cells.flatMap(cellDates))].sort(),
    datesMissing: cells.some((c) => !cellDates(c).length),
    /** Whether any date comes from the rule pack's unreviewed derivation. */
    derived: cells.some((c) => !!c.derivedApplicability?.length),
  };
}

/**
 * The filters a view can apply: a saved actor or date the view does not
 * offer (another pack, another rule pack) falls back to "all".
 */
export function effectiveFilters(
  view: Pick<CoverageResponse, "cells">,
  f: Partial<CoverageFilters> | undefined,
): CoverageFilters {
  const o = filterOptions(view);
  const state =
    f?.state && coverageStates.includes(f.state as CellState) ? f.state : "all";
  const actor =
    f?.actor &&
    (o.actors.includes(f.actor) || (f.actor === NONE && o.actorsMissing))
      ? f.actor
      : "all";
  const date =
    f?.date && (o.dates.includes(f.date) || (f.date === NONE && o.datesMissing))
      ? f.date
      : "all";
  return { state, actor, date };
}

/** Whether a requirement passes the filters. */
export function matches(c: CellView, f: CoverageFilters) {
  if (f.state !== "all" && c.state !== f.state) return false;
  if (f.actor !== "all") {
    const actors = c.actors ?? [];
    if (f.actor === NONE ? actors.length > 0 : !actors.includes(f.actor))
      return false;
  }
  if (f.date !== "all") {
    const dates = cellDates(c);
    if (f.date === NONE ? dates.length > 0 : !dates.includes(f.date))
      return false;
  }
  return true;
}
export const isFiltered = (f: CoverageFilters) =>
  f.state !== "all" || f.actor !== "all" || f.date !== "all";

/** A spreadsheet cell: quoted, and a leading formula character neutralised. */
export function csvCell(value: string | number | boolean | null | undefined) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const csvColumns = [
  "view",
  "framework_data_version",
  "pack",
  "pack_version",
  "legal_review_pending",
  "requirement_id",
  "ref",
  "title",
  "group",
  "state",
  "readiness",
  "qualified",
  "capped",
  "actors",
  "applicability_reviewed",
  "applicability_derived_not_reviewed",
  "sources",
] as const;

/**
 * The CSV export of a view: one line per requirement that passes the
 * filters, in heatmap order. Derived dates have their own column and say
 * they are not reviewed; states are the heatmap's words, never "compliant".
 */
export function coverageCsv(
  view: CoverageResponse,
  filters: CoverageFilters = defaultCoverageFilters,
) {
  const byId = new Map(view.cells.map((c) => [c.id, c]));
  const root = (c: CellView): CellView => {
    let n = c;
    while (n.parent && byId.get(n.parent)) n = byId.get(n.parent)!;
    return n;
  };
  const lines = [csvColumns.join(",")];
  for (const c of requirements(view)) {
    if (!matches(c, filters)) continue;
    const group = root(c);
    lines.push(
      [
        view.view.shortTitle + " (" + view.view.kind + ")",
        view.versions.framework,
        view.pack.id,
        view.pack.version,
        view.legalReviewPending ? "yes" : "no",
        c.id,
        c.ref,
        c.title ?? "",
        group === c ? "" : group.ref,
        cellLabel(c),
        c.readiness ? "yes" : "no",
        c.qualified ? "yes" : "no",
        c.capped ? "yes" : "no",
        (c.actors ?? []).join("; "),
        (c.applicability ?? [])
          .map((a) => a.from + " " + a.condition)
          .join("; "),
        (c.derivedApplicability ?? [])
          .map(
            (a) =>
              `${a.from} ${a.derived.entryId} (${a.derived.provision}${
                a.inheritedFrom ? ", inherited from " + a.inheritedFrom : ""
              }; derived, not reviewed)`,
          )
          .join("; "),
        [
          ...new Set(
            c.contributions.map(
              (x) =>
                (x.source?.templateId ? x.source.templateId + " " : "") +
                (x.source?.label ?? x.sourceId),
            ),
          ),
        ].join("; "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
