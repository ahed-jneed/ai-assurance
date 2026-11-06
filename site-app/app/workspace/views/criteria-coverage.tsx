"use client";
// The criteria coverage heatmap, cell drawer and overview summary
// (docs/design/criteria-model.md sections 15.2 to 15.4), from
// GET /api/coverage. Coverage is reviewed evidence per requirement: it never
// shows partial coverage as full, and papers signed are progress, not coverage.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CellState, StateCounts } from "@/lib/criteria/coverage";
import type {
  CellView,
  CoverageResponse,
  ViewInfo,
} from "@/lib/criteria/views";

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
const order: CellState[] = [
  "full",
  "partial",
  "exception",
  "open",
  "parent_only",
  "unmapped",
  "excluded",
  "not_applicable",
];
/** "Covered (readiness)": a readiness result is never shown as applicable law. */
export const cellLabel = (c: { state: CellState; readiness: boolean }) =>
  stateLabels[c.state] +
  (c.readiness && (c.state === "full" || c.state === "partial")
    ? " (readiness)"
    : "");

async function fetchCoverage<T>(
  tenantId: string,
  engagementId: string,
  framework?: string,
): Promise<T> {
  const response = await fetch(
    "/api/coverage?" +
      new URLSearchParams({
        tenantId,
        engagementId,
        ...(framework ? { framework } : {}),
      }),
    { headers: { accept: "application/json" } },
  );
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? "Coverage could not be loaded");
  return body as T;
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
  const [framework, setFramework] = useState<string | null>(null);
  const [filter, setFilter] = useState<CellState | "all">("all");
  const [open, setOpen] = useState<CellView | null>(null);
  const result = useCoverage(tenantId, engagementId, version, framework);
  const grid = useRef<HTMLDivElement>(null);
  const view = "loading" in result ? undefined : result.view;
  const rows = useMemo(() => {
    if (!view) return [];
    const roots = view.cells.filter((c) => !c.parent);
    return roots.map((root) => ({
      root,
      group: view.groups.find((g) => g.id === root.id),
      tiles: (root.type === "group"
        ? descendants(view.cells, root.id)
        : [root]
      ).filter(
        (c) =>
          c.type === "requirement" && (filter === "all" || c.state === filter),
      ),
    }));
  }, [view, filter]);
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
        <label className="coverage-filter">
          Show
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as CellState | "all")
            }
          >
            <option value="all">All states</option>
            {order.map((s) => (
              <option key={s} value={s}>
                {stateLabels[s]}
              </option>
            ))}
          </select>
        </label>
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
                    aria-label={c.ref + ", " + cellLabel(c).toLowerCase()}
                    title={(c.title ?? "") + ": " + cellLabel(c)}
                    onKeyDown={move}
                    onClick={() => setOpen(c)}
                  >
                    <span className="coverage-ref">{c.ref}</span>
                    <span>{tileText(c)}</span>
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
    <div className="coverage-drawer-body">
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
      {c.applicability?.map((a) => (
        <p key={a.from + a.condition} className="subtle">
          From {a.from}: {a.condition}
        </p>
      ))}
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
