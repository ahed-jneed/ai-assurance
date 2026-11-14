"use client";
// The criteria coverage heatmap, cell drawer and overview summary
// (docs/design/criteria-model.md sections 15.2 to 15.4), from
// GET /api/coverage. Coverage is reviewed evidence per requirement: it never
// shows partial coverage as full, and papers signed are progress, not coverage.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CellState, StateCounts } from "@/lib/criteria/coverage";
import {
  cellLabel,
  coverageStates as order,
  defaultCoverageFilters,
  effectiveFilters,
  filterOptions,
  isFiltered,
  matches,
  NONE,
  stateLabels,
  type CoverageFilters,
} from "@/lib/criteria/coverage-filters";
import type {
  CellView,
  CoverageResponse,
  ViewInfo,
} from "@/lib/criteria/views";
import { usePersonalPreferences } from "../../business-workspace";

export { cellLabel, stateLabels };
const shortLabels: Record<CellState, string> = {
  full: "Covered",
  partial: "Partly",
  exception: "Exception",
  open: "Open",
  parent_only: "Higher level",
  unmapped: "Not mapped",
  excluded: "Excluded",
  not_applicable: "N/A",
};
/** "2 Dec 2027" for an ISO date, without a time zone shift. */
const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

async function fetchCoverage<T>(
  tenantId: string,
  engagementId: string,
  framework?: string,
): Promise<T> {
  return fetchJson<T>(
    "/api/coverage?" +
      new URLSearchParams({
        tenantId,
        engagementId,
        ...(framework ? { framework } : {}),
      }),
    { headers: { accept: "application/json" } },
  );
}
/** One coverage view, refetched when the engagement changes (its version). */
function useCoverage(
  tenantId: string,
  engagementId: string,
  version: number,
  framework: string | null,
) {
  const [state, setState] = useState<{
    key: string;
    views?: ViewInfo[];
    view?: CoverageResponse;
    error?: string;
  }>({ key: "" });
  const key = [tenantId, engagementId, version, framework].join("|");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { views } = await fetchCoverage<{ views: ViewInfo[] }>(
          tenantId,
          engagementId,
        );
        const chosen =
          views.find((v) => v.key === framework)?.key ?? views[0]?.key;
        const view = chosen
          ? await fetchCoverage<CoverageResponse>(
              tenantId,
              engagementId,
              chosen,
            )
          : undefined;
        if (live) setState({ key, views, view });
      } catch (error) {
        if (live)
          setState({
            key,
            error: error instanceof Error ? error.message : String(error),
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [key, tenantId, engagementId, framework]);
  return state.key === key ? state : { key, loading: true as const };
}

/** "94 requirements: Covered 0 | Partly covered 14 (of which readiness 9) | ..." */
function SummaryLine({ summary }: { summary: StateCounts }) {
  return (
    <p className="coverage-summary">
      <b>{summary.total} requirements:</b>{" "}
      {order.map((s, i) => (
        <span key={s}>
          {i > 0 && " | "}
          {stateLabels[s]} {summary[s]}
          {(s === "full" || s === "partial") && summary.readiness[s] > 0
            ? ` (of which readiness ${summary.readiness[s]})`
            : ""}
        </span>
      ))}
    </p>
  );
}

/**
 * The Overview's coverage summary, replacing the former Article coverage
 * bars: the counts by state of each criteria view, with a link to the heatmap.
 */
export function CoverageSummary({
  tenantId,
  engagementId,
  version,
  onOpen,
}: {
  tenantId: string;
  engagementId: string;
  version: number;
  onOpen: () => void;
}) {
  const result = useCoverage(tenantId, engagementId, version, null);
  return (
    <details className="engagement-details" open>
      <summary>Criteria coverage</summary>
      <div className="content-pad">
        {"loading" in result ? (
          <p className="subtle">Loading coverage…</p>
        ) : result.error ? (
          <p className="subtle">{result.error}</p>
        ) : result.view ? (
          <>
            <p className="subtle">
              {result.view.view.shortTitle} (criteria) · fully covered:{" "}
              {result.view.summary.full} of {result.view.summary.total}
            </p>
            <SummaryLine summary={result.view.summary} />
            {result.view.migrated && (
              <p className="subtle">
                This summary replaces the former Article coverage bars, which
                counted signed papers. Paper sign-off and procedure review above
                are progress, not coverage.
              </p>
            )}
            <button type="button" className="source-link" onClick={onOpen}>
              Open the coverage heatmap
            </button>
          </>
        ) : (
          <p className="subtle">This engagement offers no coverage view.</p>
        )}
      </div>
    </details>
  );
}

const descendants = (cells: CellView[], id: string): CellView[] =>
  cells
    .filter((c) => c.parent === id)
    .flatMap((c) => [c, ...descendants(cells, c.id)]);
function tileText(c: CellView) {
  return (
    shortLabels[c.state] +
    (c.readiness && (c.state === "full" || c.state === "partial") ? " (R)" : "")
  );
}

const sameFilters = (a?: CoverageFilters, b?: CoverageFilters) =>
  !!a && !!b && a.state === b.state && a.actor === b.actor && a.date === b.date;
/**
 * The heatmap's filters, kept per user in the workspace preferences (section
 * 15.2). A change applies at once and is saved in the background; a failed
 * save reloads the preferences and tries once more, then says so.
 */
function useCoverageFilters(
  tenantId: string,
  view: Pick<CoverageResponse, "cells"> | undefined,
) {
  const pref = usePersonalPreferences(tenantId);
  const [local, setLocal] = useState<CoverageFilters | null>(null);
  const [saveError, setSaveError] = useState("");
  const saving = useRef(false);
  const attempts = useRef(new WeakMap<CoverageFilters, number>());
  const { ready, value, save, load } = pref;
  useEffect(() => {
    if (!local || !ready || saving.current) return;
    if (sameFilters(value.coverage, local)) return;
    const tried = attempts.current.get(local) ?? 0;
    if (tried >= 2) return;
    attempts.current.set(local, tried + 1);
    saving.current = true;
    save({ ...value, coverage: local })
      .then(() => setSaveError(""))
      .catch(() => {
        setSaveError(
          tried
            ? "Your filters apply here but could not be saved."
            : "Saving your filters…",
        );
        void load();
      })
      .finally(() => {
        saving.current = false;
      });
  }, [local, ready, value, save, load]);
  const stored = local ?? value.coverage;
  const filters = view
    ? effectiveFilters(view, stored)
    : { ...defaultCoverageFilters, ...stored };
  return {
    filters,
    saveError,
    change: (next: Partial<CoverageFilters>) =>
      setLocal({ ...filters, ...next }),
  };
}

/** The heatmap of section 15.2: rows by group, one tile per requirement. */
export default function CriteriaCoverage({
  tenantId,
  engagementId,
  version,
}: {
  tenantId: string;
  engagementId: string;
  version: number;
}) {
  const ids = useId();
  const [framework, setFramework] = useState<string | null>(null);
  const [open, setOpen] = useState<CellView | null>(null);
  const result = useCoverage(tenantId, engagementId, version, framework);
  const grid = useRef<HTMLDivElement>(null);
  const view = "loading" in result ? undefined : result.view;
  const { filters, change, saveError } = useCoverageFilters(tenantId, view);
  const options = useMemo(() => (view ? filterOptions(view) : null), [view]);
  const rows = useMemo(() => {
    if (!view) return [];
    const roots = view.cells.filter((c) => !c.parent);
    return roots
      .map((root) => ({
        root,
        group: view.groups.find((g) => g.id === root.id),
        tiles: (root.type === "group"
          ? descendants(view.cells, root.id)
          : [root]
        ).filter((c) => c.type === "requirement" && matches(c, filters)),
      }))
      .filter((r) => !isFiltered(filters) || r.tiles.length > 0);
  }, [view, filters]);
  if ("loading" in result)
    return <p className="subtle content-pad">Loading coverage…</p>;
  if (result.error) return <p className="subtle content-pad">{result.error}</p>;
  if (!view)
    return (
      <p className="subtle content-pad">
        This engagement offers no coverage view.
      </p>
    );
  /** Arrow keys move between tiles; Enter opens the drawer. */
  const move = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const tiles = [
      ...(grid.current?.querySelectorAll<HTMLButtonElement>(".coverage-tile") ??
        []),
    ];
    tiles[tiles.indexOf(event.currentTarget) + step]?.focus();
  };
  return (
    <section className="panel criteria-coverage">
      <div className="panel-head">
        <h2>Criteria coverage</h2>
        <span className="subtle">
          {view.pack.title} {view.pack.version} (pinned)
          {view.programApproved ? " · program approved" : ""}
        </span>
      </div>
      <div className="content-pad">
        {result.views && result.views.length > 1 && (
          <div className="coverage-views" role="group" aria-label="View">
            {result.views.map((v) => (
              <button
                type="button"
                key={v.key}
                aria-pressed={v.key === view.view.key}
                onClick={() => setFramework(v.key)}
              >
                {v.shortTitle} ({v.kind})
              </button>
            ))}
          </div>
        )}
        <SummaryLine summary={view.summary} />
        {view.banners.map((b) => (
          <p key={b.id} className={"coverage-banner coverage-banner-" + b.id}>
            {b.text}
          </p>
        ))}
        <div
          className="coverage-filters"
          role="group"
          aria-label="Filter requirements"
        >
          <span className="coverage-filter">
            <label htmlFor={ids + "-state"}>State</label>
            <select
              id={ids + "-state"}
              value={filters.state}
              onChange={(event) => change({ state: event.target.value })}
            >
              <option value="all">All states</option>
              {order.map((s) => (
                <option key={s} value={s}>
                  {stateLabels[s]}
                </option>
              ))}
            </select>
          </span>
          <span className="coverage-filter">
            <label htmlFor={ids + "-actor"}>Actor</label>
            <select
              id={ids + "-actor"}
              value={filters.actor}
              onChange={(event) => change({ actor: event.target.value })}
            >
              <option value="all">All actors</option>
              {options?.actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              {options?.actorsMissing && (
                <option value={NONE}>No actor recorded</option>
              )}
            </select>
          </span>
          <span className="coverage-filter">
            <label htmlFor={ids + "-date"}>Applicability date</label>
            <select
              id={ids + "-date"}
              value={filters.date}
              onChange={(event) => change({ date: event.target.value })}
            >
              <option value="all">All dates</option>
              {options?.dates.map((d) => (
                <option key={d} value={d}>
                  From {dayLabel(d)}
                </option>
              ))}
              {options?.datesMissing && (
                <option value={NONE}>No date recorded</option>
              )}
            </select>
          </span>
          <a
            className="source-link coverage-export"
            href={
              "/api/coverage?" +
              new URLSearchParams({
                tenantId,
                engagementId,
                framework: view.view.key,
                format: "csv",
                ...(filters.state !== "all" ? { state: filters.state } : {}),
                ...(filters.actor !== "all" ? { actor: filters.actor } : {}),
                ...(filters.date !== "all" ? { date: filters.date } : {}),
              })
            }
            download
          >
            {isFiltered(filters) ? "Export filtered CSV" : "Export CSV"}
          </a>
        </div>
        <p className="subtle coverage-filter-status" role="status">
          {isFiltered(filters)
            ? `Showing ${rows.reduce((n, r) => n + r.tiles.length, 0)} of ${view.summary.total} requirements.`
            : `Showing all ${view.summary.total} requirements.`}{" "}
          {options?.derived
            ? "Dates derived from the rule pack are not reviewed."
            : ""}
          {saveError ? " " + saveError : ""}
        </p>
        <p className="coverage-legend" aria-hidden="true">
          {order.map((s) => (
            <span key={s} className={"coverage-tile state-" + s}>
              {shortLabels[s]}
            </span>
          ))}
          <span>(R) readiness</span>
        </p>
        <div ref={grid} className="coverage-rows">
          {rows.map(({ root, group, tiles }) => (
            <div className="coverage-row" key={root.id}>
              <div className="coverage-row-head">
                <b>
                  {root.ref} {root.title}
                </b>
                {group && (
                  <small className="subtle">
                    {group.rollup
                      ? "Roll-up: " +
                        cellLabel({
                          state: "full",
                          readiness: group.rollup.readiness,
                        }) +
                        " · "
                      : ""}
                    {group.summary.state !== "unmapped" &&
                    group.summary.state !== "parent_only"
                      ? "Group links: " + cellLabel(group.summary) + " · "
                      : ""}
                    {order
                      .filter((s) => group.counts[s])
                      .map((s) => stateLabels[s] + " " + group.counts[s])
                      .join(", ")}
                  </small>
                )}
              </div>
              <div className="coverage-tiles">
                {tiles.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={
                      "coverage-tile state-" +
                      c.state +
                      (c.readiness ? " readiness" : "")
                    }
                    title={(c.title ?? "") + ": " + cellLabel(c)}
                    onKeyDown={move}
                    onClick={() => setOpen(c)}
                  >
                    {/* Accessible name "Art. 9(1), mapped at a higher level
                        only" (section 15.4) from the content, so the visible
                        reference starts the name (WCAG 2.5.3). */}
                    <span className="coverage-ref">
                      {c.ref}
                      <span className="sr-only">
                        , {cellLabel(c).toLowerCase()}
                      </span>
                    </span>
                    <span aria-hidden="true">{tileText(c)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="coverage-drawer">
          {open && <CellDrawer cell={open} view={view} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/** Why a cell is not "Covered", in the drawer's words. */
function whyNot(c: CellView) {
  if (c.state === "full") return null;
  if (c.state === "partial")
    return c.qualified
      ? 'Why not "Covered": a related conclusion is qualified, or a qualification reaches this requirement from its group.'
      : 'Why not "Covered": the links are partial (intersects_with or subset_of, or migrated, or a draft or withdrawn document).';
  if (c.state === "parent_only")
    return "A parent group is linked with a partial relationship; nothing is claimed for this requirement.";
  if (c.state === "unmapped") return "No link. Not a gap and not a pass.";
  return null;
}

function CellDrawer({
  cell: c,
  view,
}: {
  cell: CellView;
  view: CoverageResponse;
}) {
  const why = whyNot(c);
  return (
    // The body scrolls, so it takes focus for keyboard scrolling (WCAG 2.1.1).
    <div
      className="coverage-drawer-body"
      role="region"
      aria-label={c.ref + " details"}
      tabIndex={0}
    >
      <SheetTitle>
        {c.ref} {c.title}
      </SheetTitle>
      <SheetDescription>{cellLabel(c)}</SheetDescription>
      {why && <p>{why}</p>}
      <h3>Evidence chain</h3>
      {c.contributions.length ? (
        <ul>
          {c.contributions.map((x, i) => (
            <li key={i}>
              <b>
                {x.source?.templateId ? x.source.templateId + " " : ""}
                {x.source?.label ?? x.sourceId}
              </b>
              {x.source?.evidence && (
                <small className="block">
                  {[
                    x.source.evidence.paperId &&
                      "paper " +
                        x.source.evidence.paperId +
                        (x.source.evidence.paperRevision
                          ? " revision " + x.source.evidence.paperRevision
                          : ""),
                    x.source.evidence.reviewer &&
                      "reviewed by " + x.source.evidence.reviewer,
                    x.source.evidence.conclusion &&
                      "conclusion: " + x.source.evidence.conclusion,
                    x.source.evidence.applicability &&
                      "applicability: " + x.source.evidence.applicability,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                </small>
              )}
              <small className="block">
                {x.path.objectiveId ?? x.path.via} --{x.path.relationship} (
                {x.path.rationale}
                {x.path.origin ? ", " + x.path.origin : ""})--&gt; {c.ref}
                {x.path.inheritedFrom
                  ? " · inherited from " + x.path.inheritedFrom
                  : ""}
                {x.path.crosswalk
                  ? " · crosswalk " +
                    x.path.crosswalk.id +
                    " " +
                    x.path.crosswalk.version +
                    (x.path.crosswalk.entryId
                      ? " " + x.path.crosswalk.entryId
                      : "")
                  : ""}
                {" · "}
                {x.strength} strength, source {x.state.replace("_", " ")}
                {x.path.clamps?.length
                  ? " · counts as partial: " + x.path.clamps.join(", ")
                  : ""}
              </small>
              {x.source?.evidence?.findings?.map((f) => (
                <small className="block" key={f.id}>
                  Unresolved finding {f.id} ({f.severity}): {f.title}
                </small>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtle">No conclusion relates to this requirement.</p>
      )}
      {c.caps.length > 0 && (
        <p className="subtle">
          Capped by a qualified conclusion on{" "}
          {c.caps.map((k) => k.inheritedFrom ?? k.sourceId).join(", ")}.
        </p>
      )}
      {c.legalEffects?.map((le) => (
        <p key={le.crosswalk + le.entryId} className="subtle">
          Presumption basis: {le.basis} {le.conditions}{" "}
          {le.verification === "verified"
            ? ""
            : "Secondary source, legal review required. "}
          Not an audit conclusion.
        </p>
      ))}
      {c.actors?.length ? (
        <p className="subtle">Actors: {c.actors.join(", ")}</p>
      ) : null}
      {c.applicability?.map((a) => (
        <p key={a.from + a.condition} className="subtle">
          From {a.from}: {a.condition}
        </p>
      ))}
      {c.derivedApplicability?.length ? (
        <>
          <h3>Applicability dates (derived, not reviewed)</h3>
          <ul className="coverage-derived">
            {c.derivedApplicability.map((a) => (
              <li key={a.derived.entryId}>
                From {dayLabel(a.from)}: {a.condition}
                <small className="block">
                  Rule pack {a.derived.rulePackVersion} entry{" "}
                  {a.derived.entryId}, provision {a.derived.provision}
                  {a.legalRef ? " (" + a.legalRef + ")" : ""}
                  {a.inheritedFrom
                    ? " · inherited from " + a.inheritedFrom
                    : ""}
                </small>
              </li>
            ))}
          </ul>
          <p className="subtle">
            These dates come from the rule pack. Their mapping to this
            requirement is automatic and has not been reviewed: they inform
            review only, do not decide whether the requirement applies and do
            not change its state.
          </p>
        </>
      ) : null}
      {view.legalReviewPending && (
        <p>
          {view.view.shortTitle} data {view.versions.framework}: legal review
          pending.
        </p>
      )}
      {view.migrated && (
        <p className="subtle">
          {view.banners.find((b) => b.id === "migration")?.text}
        </p>
      )}
    </div>
  );
}
