// Pure serialisation of the workspace location (view, open record, section
// and filters) into the query string, and the history entry to write for it.
// The inverse, applying a link to the workspace, is applyWorkspaceLink in
// use-url-state.ts.
import type { Engagement, Role } from "@/lib/domain/types";
import { evidenceQueryParams } from "@/lib/evidence-presentation";
import type { PaperTarget } from "@/lib/paper-workflow";
import { paperQueryParams } from "@/lib/paper-presentation";
import { inboxQueryParams, type InboxQuery } from "@/lib/work-inbox";
import {
  workbenchQueryParams,
  type WorkbenchQuery,
} from "@/lib/workbench-presentation";
import { linkQuery } from "@/lib/workspace-links";
import { programSections } from "../audit-program/program-sections";
import { recordKind } from "./records";

export type WorkspaceLocation = {
  tenantId: string;
  engagement: Engagement | null | undefined;
  role: Role;
  view: string;
  paperId: string | null;
  paperTarget: PaperTarget | undefined;
  /** The record open in the record sheet, if any. */
  record: unknown;
  procedureContext: string | undefined;
  procedureSection: string | undefined;
  reportSection: string;
  evidenceTab: string;
  /** The evidence tab actually shown (client roles only see files). */
  displayedEvidenceTab: string;
  requestFilter: string;
  inboxQuery: InboxQuery;
  workbenchQuery: WorkbenchQuery;
  search: string;
  filter: string;
  facet: string;
  sort: string;
  paperStatus: string;
};

/** Query parameters for a workspace location, plus the record it links to. */
export function workspaceParams(location: WorkspaceLocation) {
  const {
    view,
    paperId,
    procedureContext,
    evidenceTab,
    requestFilter,
    search,
    filter,
    facet,
    sort,
    paperStatus,
  } = location;
  const audit = location.engagement,
    v = location.record as Record<string, unknown> | undefined;
  const kind = paperId
    ? "paper"
    : v && "id" in v
      ? recordKind(v)
      : view === "Audit program" && procedureContext
        ? "procedure"
        : "";
  const recordId =
    paperId ??
    (kind === "procedure"
      ? procedureContext
      : kind
        ? String(v?.id ?? "")
        : "") ??
    "";
  const query = linkQuery({
    tenantId: location.tenantId,
    engagementId: audit?.id ?? "",
    module: view,
    kind,
    recordId,
    section:
      kind === "paper"
        ? (location.paperTarget ?? "objective")
        : view === "Reports & sign-off"
          ? location.reportSection
          : view === "Evidence vault"
            ? location.displayedEvidenceTab
            : view === "Assurance workbench"
              ? location.workbenchQuery.section
              : kind === "procedure"
                ? (location.procedureSection ?? "")
                : view === "Audit program" &&
                    !kind &&
                    programSections.includes(location.procedureSection ?? "")
                  ? (location.procedureSection as string)
                  : "",
  });
  const params = new URLSearchParams(query);
  if (view === "My work")
    for (const [key, value] of inboxQueryParams(location.inboxQuery))
      params.set(key, value);
  if (view === "Evidence vault")
    for (const [key, value] of evidenceQueryParams(
      {
        tab: evidenceTab === "requests" ? "requests" : "files",
        filter: evidenceTab === "requests" ? requestFilter : filter,
        search,
        facet,
        sort,
      },
      location.role,
    ))
      params.set(key, value);
  if (view === "Assurance workbench") {
    for (const [key, value] of workbenchQueryParams(location.workbenchQuery))
      params.set(key, value);
    if (
      procedureContext &&
      audit?.workflow?.procedures.some((p) => p.id === procedureContext)
    )
      params.set("procedure", procedureContext);
  }
  if (view === "Working papers")
    for (const [key, value] of paperQueryParams({
      view: filter,
      status: paperStatus,
      facet,
      search,
      sort,
    }))
      params.set(key, value);
  return { params, kind, recordId };
}

/** The search term a view writes to `q`. */
export function viewSearchTerm(
  location: Pick<
    WorkspaceLocation,
    "view" | "inboxQuery" | "workbenchQuery" | "search"
  >,
) {
  return location.view === "My work"
    ? location.inboxQuery.search
    : location.view === "Assurance workbench"
      ? location.workbenchQuery.search
      : location.search;
}

const searchableViews = [
  "My work",
  "Evidence vault",
  "Assurance workbench",
  "Working papers",
];

/**
 * Whether a location change replaces the current history entry or pushes a
 * new one. Typing a search (in the same view of the same practice and
 * engagement), switching sections of the same open paper, the first section
 * a view states for itself (the audit program's open tab, once it mounts,
 * #227), restoring a link from back/forward and the first write replace;
 * every other change is a new entry.
 */
export function historyMethod({
  previousUrl,
  params,
  view,
  kind,
  recordId,
  searchTerm,
  restoring,
}: {
  previousUrl: string;
  params: URLSearchParams;
  view: string;
  kind: string;
  recordId: string;
  searchTerm: string;
  restoring: boolean;
}): "replaceState" | "pushState" {
  const previousParams = new URLSearchParams(previousUrl.split("?")[1] ?? ""),
    sameScope = ["practice", "engagement", "view"].every(
      (name) => previousParams.get(name) === params.get(name),
    ),
    searchChanged =
      searchableViews.includes(view) &&
      sameScope &&
      (previousParams.get("q") ?? "") !== searchTerm;
  const paperSectionChanged =
    kind === "paper" &&
    previousParams.get("kind") === "paper" &&
    previousParams.get("record") === recordId &&
    previousParams.get("view") === view &&
    previousParams.get("section") !== params.get("section");
  const sectionStated =
    !kind &&
    !previousParams.get("kind") &&
    sameScope &&
    !previousParams.get("section") &&
    !!params.get("section") &&
    [...params].every(
      ([name, value]) =>
        name === "section" || previousParams.get(name) === value,
    );
  return !previousUrl ||
    restoring ||
    searchChanged ||
    paperSectionChanged ||
    sectionStated
    ? "replaceState"
    : "pushState";
}
