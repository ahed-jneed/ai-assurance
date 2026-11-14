// Workspace commands that change what is open: views, engagements, the
// practice, papers and records. Each change goes through `guarded` (see
// navigation-guards.ts) so it cannot drop unsaved work.
import { useRef } from "react";
import { can, fallbackRole } from "@/lib/permissions";
import { toast } from "sonner";
import { isAttestedOp } from "@/lib/attestation";
import { type AuditGate, type EvidenceRequest, type Paper } from "@/lib/domain";
import { normalizeEvidenceQuery } from "@/lib/evidence-presentation";
import {
  paperProcedureSection,
  readPaperSavedFilter,
} from "@/lib/paper-presentation";
import type { PaperTarget } from "@/lib/paper-workflow";
import { defaultInboxQuery } from "@/lib/work-inbox";
import type { WorkItem } from "@/lib/work-items";
import { defaultWorkbenchQuery } from "@/lib/workbench-presentation";
import type { SearchItem } from "@/lib/workspace-search";
import { auditViews, permittedAuditView } from "@/lib/workspace-preferences";
import type { Attest } from "./attestation-dialog";
import type { LabIntentState } from "./lab-intent";
import { requestFormDefaults } from "./modals/evidence-request";
import { remediationDefaults } from "./modals/finding-edit";
import type { ModalFollowUps } from "./modals/types";
import type { Guarded } from "./navigation-guards";
import { findRecord, isSheetRecordKind } from "./records";
import type { NavigateOptions, NavigationResult } from "./types";
import type { ModalState } from "./use-modal-state";
import { editableDraft, type PaperEditorState } from "./use-paper-editor";
import type { RecordSheetState } from "./use-record-sheet";
import type { UrlState } from "./use-url-state";
import type { WorkspaceDataState } from "./use-workspace-data";

type ViewMemory = {
  search: string;
  filter: string;
  facet: string;
  sort: string;
};
const isAuditView = (view: string) =>
  auditViews.includes(view as (typeof auditViews)[number]);

export async function copyWorkspaceLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied. Recipients need existing access.");
  } catch {
    toast.error("Link could not be copied. Use the address bar.");
  }
}

export function useWorkspaceNavigation({
  workspace,
  url,
  paper,
  sheet,
  modal,
  lab,
  guarded,
  attest,
  setSwitchOpen,
  setSearchOpen,
}: {
  workspace: WorkspaceDataState;
  url: UrlState;
  paper: PaperEditorState;
  sheet: RecordSheetState;
  modal: ModalState;
  lab: LabIntentState;
  guarded: Guarded;
  /** Opens the attestation dialog for a sign-off or approval. */
  attest: Attest;
  setSwitchOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
}) {
  /** Search and filters each view had when it was left. */
  const viewMemory = useRef<Record<string, ViewMemory>>({});
  const { data, load, act } = workspace;
  const e = data?.engagement,
    role = data?.identity.role ?? fallbackRole,
    writer = can(role, "updateFinding");
  const { view, setView, setSearch, setFilter, setFacet, setSort } = url;

  function openPaper(p: Paper, target?: PaperTarget) {
    guarded(() => {
      url.setPaperTarget(target);
      workspace.setError("");
      if (view === "Audit program") url.setProcedureContext(undefined);
      paper.showPaper(p, editableDraft(p));
    });
  }
  function closePaper() {
    guarded(() => {
      paper.clearPaper();
      paper.setPaperConflict(false);
      paper.forgetSavedPaper();
    });
  }
  /** Shows a record in the record sheet. */
  function viewRecord(title: string, value: unknown) {
    guarded(() => sheet.viewDetail(title, value));
  }
  /** Leaves the open paper to show a record in the record sheet. */
  function openRecordInstead(title: string, value: unknown) {
    guarded(() => {
      paper.clearPaper();
      paper.setHasPendingComment(false);
      sheet.viewDetail(title, value);
    });
  }
  function openPaperProcedure(id: string) {
    guarded(() => {
      paper.clearPaper();
      url.setProcedureContext(id);
      const source = e?.workflow?.procedures.find((p) => p.id === id);
      url.setProcedureSection(
        e && source ? paperProcedureSection(e, source) : "plan",
      );
      setView("Audit program");
      paper.setHasPendingComment(false);
    });
  }
  /** Paper editor actions; a review of a compiled paper opens its procedure. */
  function paperAction(op: string, values: Record<string, unknown>) {
    const p = e?.workflow?.procedures.find((p) => p.paperId === values.paperId);
    if (op === "reviewPaper" && p) {
      openPaperProcedure(p.id);
      return;
    }
    if (isAttestedOp(op)) {
      attest(op, values);
      return;
    }
    void act(op, values).catch(() => {});
  }
  function navigate(
    label: string,
    options: NavigateOptions = {},
    afterOpen?: () => void,
  ) {
    return guarded(() => {
      viewMemory.current[view] = {
        search: url.search,
        filter: url.savedFilter,
        facet: url.facet,
        sort: url.sort,
      };
      const memory = viewMemory.current[label];
      setView(label);
      if (label === "Evidence vault") {
        const selectedFilter = options.filter ?? memory?.filter ?? "all",
          q = normalizeEvidenceQuery(
            {
              tab: selectedFilter.startsWith("requests:")
                ? "requests"
                : "files",
              filter: selectedFilter.replace(/^requests:/, ""),
              search: options.search ?? memory?.search ?? "",
              facet: options.facet ?? memory?.facet ?? "all",
              sort: memory?.sort,
            },
            role,
          );
        url.setEvidenceTab(q.tab);
        url.setRequestFilter(q.tab === "requests" ? q.filter : "all");
      }
      if (label === "Assurance workbench" && url.procedureContext)
        url.setWorkbenchQuery({
          ...defaultWorkbenchQuery,
          section: "execution",
        });
      if (label === "Testing lab")
        url.setLabView(e?.runs.length ? "runs" : "models");
      setSearch(options.search ?? memory?.search ?? "");
      setFilter(
        label === "Evidence vault" &&
          (options.filter ?? memory?.filter ?? "").startsWith("requests:")
          ? "all"
          : (options.filter ?? memory?.filter ?? "all"),
      );
      setFacet(options.facet ?? memory?.facet ?? "all");
      setSort(
        memory?.sort ??
          (label === "Findings"
            ? "risk"
            : label === "Evidence vault"
              ? "newest"
              : "program"),
      );
      if (label === "Working papers") {
        const q = readPaperSavedFilter(
          options.filter ?? memory?.filter ?? "all",
        );
        setFilter(q.view);
        url.setPaperStatus(q.status);
      }
      if (label === "Clients") url.setClientId(null);
      paper.clearPaper();
      sheet.setDetail(null);
      paper.setPaperConflict(false);
      paper.setHasPendingComment(false);
      afterOpen?.();
    });
  }
  function openVaultFiles() {
    if (navigate("Evidence vault") === "opened") url.setEvidenceTab("files");
  }
  function openRequests() {
    if (
      navigate("Evidence vault", {
        search: "",
        filter: "all",
        facet: "all",
      }) === "opened"
    ) {
      url.setEvidenceTab("requests");
      url.setRequestFilter("open");
    }
  }
  function requestForm(form: string, r?: EvidenceRequest, p?: Paper) {
    const { choices, checks } = requestFormDefaults(e, r, p);
    modal.open(form, choices, checks);
  }
  function requestForPaper(p: Paper) {
    guarded(() => {
      paper.clearPaper();
      paper.setHasPendingComment(false);
      setView("Evidence vault");
      url.setEvidenceTab("requests");
      setSearch("");
      requestForm("request", undefined, p);
    });
  }
  function remediateFinding(id: string) {
    const current = e?.findings.find((f) => f.id === id);
    if (!writer || !current || current.status === "closed") return;
    modal.setFinding(current);
    const { choices, checks } = remediationDefaults(current);
    modal.open("findingEdit", choices, checks);
  }
  function openGate(gate: AuditGate, target?: PaperTarget) {
    if (["paper", "conclusion"].includes(gate.kind)) {
      const found = e?.papers.find((p) => p.id === gate.recordId);
      if (found) openPaper(found, target);
    } else if (gate.kind === "request") {
      const request = e?.evidenceRequests?.find((r) => r.id === gate.recordId);
      if (request) viewRecord(request.subject, request);
    } else if (gate.kind === "workflow") {
      url.setProcedureContext(gate.recordId);
      navigate("Audit program");
    } else if (gate.kind === "acceptance") {
      url.setProcedureContext(undefined);
      url.setProcedureSection("acceptance");
      navigate("Audit program");
    } else if (gate.kind === "classification")
      navigate("Regulatory mapping", {
        search: "",
        filter: "all",
        facet: "all",
      });
    else if (gate.kind === "stage") navigate("Overview");
    // The checklist's report elements come from the brief and program.
    else if (gate.kind === "report") navigate("Audit program");
    else if (gate.kind === "run") showRun(gate.recordId ?? "");
    else if (gate.kind === "quality_review") {
      url.setReportSection("quality");
      navigate("Reports & sign-off");
    } else if (gate.kind === "management_system")
      navigate("Regulatory mapping");
    // The LL144 audits are approved in the Testing lab's LL144 panel.
    else if (gate.kind === "ll144") navigate("Testing lab");
    else if (gate.kind === "finding") {
      const record = e?.findings.find((f) => f.id === gate.recordId);
      if (record) viewRecord(record.title, record);
    }
  }
  function openWork(item: WorkItem) {
    guarded(() => {
      void (async () => {
        const current = workspace.getData();
        const loaded =
          item.engagementId === current?.engagement?.id
            ? current
            : await load(current?.tenantId, item.engagementId);
        const audit = loaded?.engagement;
        if (!audit) return;
        setView(item.module);
        setSearch("");
        setFilter("all");
        url.setPaperStatus("all");
        setFacet("all");
        setSort("program");
        url.setPaperTarget(undefined);
        url.setProcedureContext(undefined);
        paper.setHasPendingComment(false);
        paper.clearPaper();
        sheet.setDetail(null);
        if (
          [
            "procedure",
            "scope",
            "program",
            "monitoring",
            "acceptance",
          ].includes(item.kind)
        ) {
          url.setProcedureContext(
            item.kind === "procedure" ? item.recordId : undefined,
          );
          url.setProcedureSection(
            item.section ??
              (item.kind === "scope"
                ? "brief"
                : item.kind === "monitoring"
                  ? "followup"
                  : "program"),
          );
        } else if (item.kind === "paper") {
          const p = audit.papers.find((p) => p.id === item.recordId);
          if (p) paper.showPaper(p, structuredClone(p));
        } else if (item.section === "quality") {
          url.setReportSection("quality");
        } else {
          const record = findRecord(audit, item.kind, item.recordId);
          if (record) sheet.viewDetail(item.title, record);
          if (item.kind === "request") url.setEvidenceTab("requests");
        }
      })();
    });
  }
  function openClient(id: string) {
    guarded(() => {
      paper.clearPaper();
      sheet.setDetail(null);
      paper.setHasPendingComment(false);
      url.setClientId(id);
      setView("Clients");
      setSearch("");
    });
  }
  function switchEngagement(): NavigationResult {
    if (workspace.busy || workspace.loading || workspace.bootstrapping)
      return "busy";
    setSwitchOpen(true);
    return "opened";
  }
  function openEngagement(id: string) {
    const current = workspace.getData();
    if (!current?.engagements.some((g) => g.id === id)) return;
    if (current.engagement?.id === id) {
      setSwitchOpen(false);
      if (!isAuditView(view)) navigate("Overview");
      return;
    }
    guarded(() => {
      workspace.requestRestore(null);
      lab.clear();
      paper.clearPaper();
      sheet.setDetail(null);
      paper.setHasPendingComment(false);
      setView(
        isAuditView(view)
          ? permittedAuditView(view, current.identity.role)
          : "Overview",
      );
      setSearch("");
      setFilter("all");
      url.setEvidenceTab("files");
      url.setRequestFilter("all");
      url.setWorkbenchQuery({ ...defaultWorkbenchQuery });
      url.setProcedureContext(undefined);
      setFacet("all");
      setSort(
        view === "Findings"
          ? "risk"
          : view === "Evidence vault"
            ? "newest"
            : "program",
      );
      url.setPaperStatus("all");
      workspace.setLoading(true);
      setSwitchOpen(false);
      setSearchOpen(false);
      paper.forgetSavedPaper();
      viewMemory.current = {};
      void load(current.tenantId, id);
    });
  }
  function changePractice(id: string) {
    return guarded(() => {
      workspace.requestRestore(null);
      lab.clear();
      paper.clearPaper();
      url.setClientId(null);
      setView("Overview");
      url.setWorkbenchQuery({ ...defaultWorkbenchQuery });
      url.setProcedureContext(undefined);
      url.setInboxQuery({ ...defaultInboxQuery });
      setSearch("");
      url.setEvidenceTab("files");
      url.setRequestFilter("all");
      setFilter("all");
      setFacet("all");
      setSort("program");
      url.setPaperStatus("all");
      sheet.setDetail(null);
      paper.setHasPendingComment(false);
      setSearchOpen(false);
      paper.forgetSavedPaper();
      viewMemory.current = {};
      workspace.setLoading(true);
      void load(id);
    });
  }
  function searchSelect(item: SearchItem) {
    const current = workspace.getData();
    if (!current) return;
    if (item.kind === "page") {
      navigate(item.id);
      return;
    }
    if (item.kind === "client") {
      if (current.clients.some((c) => c.id === item.id)) openClient(item.id);
      return;
    }
    if (item.kind === "engagement") {
      if (current.engagements.some((e) => e.id === item.id))
        openEngagement(item.id);
      return;
    }
    const audit = current.engagement;
    if (!audit) return;
    if (item.kind === "paper") {
      const found = audit.papers.find((p) => p.id === item.id);
      if (found) openPaper(found);
      return;
    }
    if (item.kind === "procedure") {
      navigate("Audit program", {}, () => {
        url.setProcedureContext(item.id);
        url.setProcedureSection("plan");
      });
      return;
    }
    const record = isSheetRecordKind(item.kind)
      ? findRecord(audit, item.kind, item.id)
      : current.catalog?.items.find((t) => t.id === item.id);
    if (record) openRecordInstead(item.label, record);
  }
  /** The Assurance workbench hands a hosted evaluation to the Testing lab. */
  function handOffToLab(procedureId: string, datasetCardRecordId: string) {
    if (!e) return;
    const engagementId = e.id;
    navigate("Testing lab", {}, () => {
      url.setProcedureContext(procedureId);
      lab.request({
        kind: "evaluate",
        engagementId,
        procedureId,
        datasetCardRecordId,
      });
    });
  }
  /** Opens the Testing lab on a run, such as a queued run blocking issue. */
  function showRun(runId: string, procedureId?: string) {
    if (!e) return;
    const engagementId = e.id;
    navigate("Testing lab", {}, () => {
      if (procedureId) url.setProcedureContext(procedureId);
      url.setLabView("runs");
      lab.request({ kind: "showRun", engagementId, runId });
    });
  }
  /** The audit program queued a planned evaluation: show it, not a setup. */
  function showQueuedRun(procedureId: string, runId: string) {
    showRun(runId, procedureId);
  }
  function createPaperFromTemplate(templateId: string) {
    void act("createPaper", { templateId })
      .then((result) => {
        const created = result.engagement.papers.find(
          (p) => p.id === result.details?.paperId,
        );
        if (created) {
          navigate(
            "Working papers",
            { search: "", filter: "all", facet: "all" },
            () => setSort("program"),
          );
          openPaper(created);
        }
      })
      .catch(() => {});
  }
  const modalFollowUps: ModalFollowUps = {
    showCreatedPaper(created) {
      setView("Working papers");
      setSearch("");
      setFilter("all");
      url.setPaperStatus("all");
      setFacet("all");
      setSort("program");
      openPaper(created);
    },
    openPaperWithEvidence(target, draft) {
      url.setPaperTarget("evidence");
      if (
        navigate("Working papers", {
          search: "",
          filter: "all",
          facet: "all",
        }) !== "opened"
      )
        return false;
      sheet.setDetail(null);
      paper.showPaper(target, draft);
      setView("Working papers");
      return true;
    },
    showClient(clientId) {
      url.setClientId(clientId);
      setView("Clients");
      setSearch("");
    },
    showEngagementOverview() {
      setView("Overview");
      setSearch("");
    },
  };
  return {
    navigate,
    openPaper,
    closePaper,
    viewRecord,
    openRecordInstead,
    openPaperProcedure,
    paperAction,
    openVaultFiles,
    openRequests,
    requestForm,
    requestForPaper,
    remediateFinding,
    openGate,
    openWork,
    openClient,
    switchEngagement,
    openEngagement,
    changePractice,
    searchSelect,
    handOffToLab,
    showQueuedRun,
    createPaperFromTemplate,
    modalFollowUps,
  };
}
export type WorkspaceNavigation = ReturnType<typeof useWorkspaceNavigation>;
