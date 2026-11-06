// The workspace location: which view is open with which filters, kept in
// step with the address bar in both directions. State → URL is the sync
// effect in useUrlSync; URL → state is applyWorkspaceLink, used for the
// first load and for back/forward.
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/domain";
import { defaultTerms, type ReportTerms } from "@/lib/domain/report-model";
import { readEvidenceQuery } from "@/lib/evidence-presentation";
import type { PaperTarget } from "@/lib/paper-workflow";
import {
  normalizePaperQuery,
  paperSavedFilter,
  readPaperQuery,
  type PaperQuery,
} from "@/lib/paper-presentation";
import {
  defaultInboxQuery,
  normalizeInboxQuery,
  readInboxQuery,
} from "@/lib/work-inbox";
import {
  defaultWorkbenchQuery,
  readWorkbenchQuery,
} from "@/lib/workbench-presentation";
import {
  authorizedLink,
  readWorkspaceLink,
  type WorkspaceLink,
} from "@/lib/workspace-links";
import { permittedAuditView } from "@/lib/workspace-preferences";
import type { WorkspaceData } from "../workspace-types";
import type { Guarded } from "./navigation-guards";
import { findRecord, recordTitle } from "./records";
import type { WorkspaceLoad } from "./types";
import type { PaperEditorState } from "./use-paper-editor";
import type { RecordSheetState } from "./use-record-sheet";
import {
  historyMethod,
  viewSearchTerm,
  workspaceParams,
} from "./workspace-url";

/** Search, view filter, facet and sort shared by the register views. */
export type Register = {
  search: string;
  filter: string;
  facet: string;
  sort: string;
  /** The same values as a register-views query. */
  query: { view: string; facet: string; search: string; sort: string };
  setSearch: (search: string) => void;
  setFilter: (filter: string) => void;
  setFacet: (facet: string) => void;
  setSort: (sort: string) => void;
  clear: () => void;
};

export function useUrlState(data: WorkspaceData | null) {
  const [view, setView] = useState("Overview"),
    [clientId, setClientId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [facet, setFacet] = useState("all"),
    [sort, setSort] = useState("program"),
    [paperStatus, setPaperStatus] = useState("all");
  const [evidenceTab, setEvidenceTab] = useState("files"),
    [requestFilter, setRequestFilter] = useState("all");
  const [inboxQuery, setInboxQuery] = useState(defaultInboxQuery),
    [workbenchQuery, setWorkbenchQuery] = useState(defaultWorkbenchQuery);
  const [reportTerms, setReportTerms] = useState<ReportTerms>(defaultTerms),
    [reportSection, setReportSection] = useState("packages");
  const [procedureContext, setProcedureContext] = useState<
      string | undefined
    >(),
    [procedureSection, setProcedureSection] = useState<string | undefined>();
  const [paperTarget, setPaperTarget] = useState<PaperTarget | undefined>(
    undefined,
  );
  const [labView, setLabView] = useState("models");
  useEffect(() => {
    if (data)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-normalises the inbox query after the account or the engagement list changes
      setInboxQuery((q) =>
        normalizeInboxQuery(
          q,
          data.identity.role === "Lead Auditor",
          data.engagements.map((e) => e.id),
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on the listed fields of data, not on its identity, which changes on every refresh
  }, [
    data?.tenantId,
    data?.identity.id,
    data?.identity.role,
    data?.engagements,
  ]);
  const registerQuery = { view: filter, facet, search, sort };
  /** The filter this view keeps in view memory and saved views. */
  const savedFilter =
    view === "Working papers"
      ? paperSavedFilter({ ...registerQuery, status: paperStatus })
      : view === "Evidence vault" && evidenceTab === "requests"
        ? "requests:" + requestFilter
        : filter;
  const paperQuery = normalizePaperQuery({
    ...registerQuery,
    status: paperStatus,
  });
  function clearRegister() {
    setSearch("");
    setFilter("all");
    setFacet("all");
    if (view === "Working papers") {
      setPaperStatus("all");
      setSort("program");
    }
  }
  /** Applies a query change made in a register view. */
  function patchRegister(patch: Partial<PaperQuery>) {
    if (patch.view !== undefined) setFilter(patch.view);
    if (patch.status !== undefined) setPaperStatus(patch.status);
    if (patch.facet !== undefined) setFacet(patch.facet);
    if (patch.search !== undefined) setSearch(patch.search);
    if (patch.sort !== undefined) setSort(patch.sort);
  }
  const register: Register = {
    search,
    filter,
    facet,
    sort,
    query: registerQuery,
    setSearch,
    setFilter,
    setFacet,
    setSort,
    clear: clearRegister,
  };
  /** Resets what a client role may not keep after a staff role. */
  function resetForClientAudience(role: Role) {
    setEvidenceTab("files");
    setRequestFilter("all");
    setFilter("all");
    setFacet("all");
    setSearch("");
    setSort("newest");
    setView((v) => permittedAuditView(v, role));
  }
  return {
    view,
    setView,
    clientId,
    setClientId,
    search,
    setSearch,
    filter,
    setFilter,
    facet,
    setFacet,
    sort,
    setSort,
    paperStatus,
    setPaperStatus,
    evidenceTab,
    setEvidenceTab,
    requestFilter,
    setRequestFilter,
    inboxQuery,
    setInboxQuery,
    workbenchQuery,
    setWorkbenchQuery,
    reportTerms,
    setReportTerms,
    reportSection,
    setReportSection,
    procedureContext,
    setProcedureContext,
    procedureSection,
    setProcedureSection,
    paperTarget,
    setPaperTarget,
    labView,
    setLabView,
    registerQuery,
    paperQuery,
    savedFilter,
    register,
    clearRegister,
    patchRegister,
    resetForClientAudience,
  };
}
export type UrlState = ReturnType<typeof useUrlState>;

/**
 * Writes the location to the address bar as it changes, applies links
 * (applyWorkspaceLink, returned for the first load) and restores the
 * location on back/forward through the navigation guard.
 */
export function useUrlSync({
  url,
  data,
  role,
  displayedEvidenceTab,
  paper,
  sheet,
  busy,
  loading,
  bootstrapping,
  modal,
  editorOpen,
  guarded,
  load,
  getData,
  setError,
}: {
  url: UrlState;
  data: WorkspaceData | null;
  role: Role;
  displayedEvidenceTab: string;
  paper: PaperEditorState;
  sheet: RecordSheetState;
  busy: boolean;
  loading: boolean;
  bootstrapping: boolean;
  modal: string;
  editorOpen: boolean;
  guarded: Guarded;
  load: WorkspaceLoad;
  getData: () => WorkspaceData | null;
  setError: (error: string) => void;
}) {
  const linkRestoring = useRef(false),
    lastLink = useRef("");
  function applyWorkspaceLink(current: WorkspaceData, link: WorkspaceLink) {
    if (!authorizedLink(link, current.identity.role, !!current.engagement)) {
      setError("This page is outside your current access.");
      return;
    }
    paper.clearPaper();
    sheet.setDetail(null);
    url.setProcedureContext(undefined);
    url.setView(link.module);
    url.setProcedureSection(link.section);
    url.setPaperTarget(
      link.kind === "paper"
        ? readPaperQuery(window.location.search).target
        : undefined,
    );
    if (link.module === "Working papers") {
      const q = readPaperQuery(window.location.search);
      url.setFilter(q.view);
      url.setPaperStatus(q.status);
      url.setFacet(q.facet);
      url.setSearch(q.search);
      url.setSort(q.sort);
    }
    url.setReportSection(
      ["completion", "quality"].includes(link.section ?? "")
        ? (link.section as string)
        : "packages",
    );
    if (link.module === "My work")
      url.setInboxQuery(
        readInboxQuery(
          window.location.search,
          current.identity.role === "Lead Auditor",
        ),
      );
    if (link.module === "Evidence vault") {
      const q = readEvidenceQuery(
        window.location.search,
        current.identity.role,
      );
      url.setEvidenceTab(q.tab);
      url.setRequestFilter(q.tab === "requests" ? q.filter : "all");
      url.setFilter(q.tab === "files" ? q.filter : "all");
      url.setSearch(q.search);
      url.setFacet(q.facet);
      url.setSort(q.sort);
    }
    paper.setHasPendingComment(false);
    const audit = current.engagement;
    if (link.module === "Assurance workbench") {
      url.setWorkbenchQuery(readWorkbenchQuery(window.location.search));
      const procedure = new URLSearchParams(window.location.search).get(
        "procedure",
      );
      if (
        procedure &&
        audit?.workflow?.procedures.some((p) => p.id === procedure)
      )
        url.setProcedureContext(procedure);
    }
    if (!link.recordId) return;
    if (!audit) {
      setError("No engagement is available for this record.");
      return;
    }
    if (link.kind === "procedure") {
      if (audit.workflow?.procedures.some((p) => p.id === link.recordId)) {
        url.setProcedureContext(link.recordId);
        url.setView("Audit program");
      } else setError("This procedure is unavailable.");
      return;
    }
    if (link.kind === "paper") {
      const p = audit.papers.find((p) => p.id === link.recordId);
      if (!p) {
        setError("This paper is unavailable.");
        return;
      }
      paper.showPaper(p, structuredClone(p));
      return;
    }
    const record = findRecord(audit, link.kind, link.recordId);
    if (record) sheet.viewDetail(recordTitle(record), record);
    else setError("This record is unavailable under your current access.");
    if (
      link.kind === "request" &&
      !["Client Viewer", "Client Contributor"].includes(current.identity.role)
    )
      url.setEvidenceTab("requests");
  }
  const {
    view,
    paperTarget,
    paperStatus,
    procedureContext,
    procedureSection,
    reportSection,
    inboxQuery,
    workbenchQuery,
    evidenceTab,
    requestFilter,
    search,
    filter,
    facet,
    sort,
  } = url;
  const paperId = paper.paperId,
    detail = sheet.detail;
  useEffect(() => {
    if (!data || bootstrapping || loading) return;
    const { params, kind, recordId } = workspaceParams({
      tenantId: data.tenantId,
      engagement: data.engagement,
      role,
      view,
      paperId,
      paperTarget,
      record: detail?.value,
      procedureContext,
      procedureSection,
      reportSection,
      evidenceTab,
      displayedEvidenceTab,
      requestFilter,
      inboxQuery,
      workbenchQuery,
      search,
      filter,
      facet,
      sort,
      paperStatus,
    });
    const href = window.location.pathname + "?" + params.toString();
    if (lastLink.current === href) return;
    const restoring = linkRestoring.current;
    linkRestoring.current = false;
    const method = historyMethod({
      previousUrl: lastLink.current,
      params,
      view,
      kind,
      recordId,
      searchTerm: viewSearchTerm({ view, inboxQuery, workbenchQuery, search }),
      restoring,
    });
    if (method === "replaceState") window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    lastLink.current = href;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncs the URL from the listed fields of data, not from its identity, which changes on every refresh
  }, [
    data?.tenantId,
    data?.engagement?.id,
    view,
    paperId,
    paperTarget,
    paperStatus,
    detail,
    procedureContext,
    procedureSection,
    reportSection,
    inboxQuery,
    workbenchQuery,
    evidenceTab,
    requestFilter,
    search,
    filter,
    facet,
    sort,
    role,
    displayedEvidenceTab,
    bootstrapping,
    loading,
  ]);
  useEffect(() => {
    const pop = () => {
      const link = readWorkspaceLink(window.location.search),
        current = getData();
      if (!link || !current) return;
      const previous = lastLink.current;
      const result = guarded(() => {
        void (async () => {
          linkRestoring.current = true;
          const target =
            current.tenantId === link.tenantId &&
            current.engagement?.id === link.engagementId
              ? current
              : await load(link.tenantId, link.engagementId || undefined);
          if (target) applyWorkspaceLink(target, link);
        })();
      });
      if (result !== "opened") window.history.replaceState(null, "", previous);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-registers when the guarding state changes; applyWorkspaceLink and guarded are plain functions recreated on every render
  }, [busy, loading, bootstrapping, modal, editorOpen, load, getData]);
  return applyWorkspaceLink;
}
