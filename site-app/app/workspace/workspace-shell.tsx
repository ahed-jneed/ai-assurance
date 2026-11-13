"use client";
// The audit workspace: composes the data, location, editor and guard hooks
// and lays out the sidebar, top bar, open view, dialogs and record sheet.
import {
  useEffect,
  useLayoutEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { canWrite } from "@/lib/domain";
import { selectPaperRegister } from "@/lib/paper-presentation";
import {
  AccountMenu,
  DevPersonaSignIn,
  SIGN_IN_LABEL,
  signInHere,
} from "../account-menu";
import { EngagementSwitcher } from "../engagement-switcher";
import { MemberOnboarding } from "../member-onboarding";
import { WorkspaceNavigation } from "../workspace-navigation";
import { WorkspaceSearch } from "../workspace-search";
import { useLabIntent } from "./lab-intent";
import { ModalHost } from "./modal-host";
import { useModelContextTools } from "./model-context-tools";
import {
  navigationGuard,
  useEditingRegistry,
  useLeaveGuard,
} from "./navigation-guards";
import { PaperEditorHost } from "./paper-editor-host";
import { usePanelPrefetch, workspaceFallback } from "./panels";
import { RecordSheet } from "./record-sheet";
import { nameResolver } from "./records";
import { useModalState } from "./use-modal-state";
import { usePaperEditor } from "./use-paper-editor";
import { useRecordSheet } from "./use-record-sheet";
import { useUrlState, useUrlSync } from "./use-url-state";
import {
  useResumePreference,
  useWorkspaceBootstrap,
  useWorkspaceData,
} from "./use-workspace-data";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { WorkspaceViews } from "./views/workspace-views";
import { WorkspaceTopbar } from "./workspace-topbar";

/** Ctrl/Cmd+K toggles workspace search unless it is disabled. */
function useSearchShortcut(
  disabled: boolean,
  setSearchOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !disabled
      ) {
        event.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [disabled, setSearchOpen]);
}

function SignedOut() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <ShieldCheck size={40} />
        <p className="eyebrow">AI ASSURANCE</p>
        <h1>Your audit workspace</h1>
        <p className="body-copy">
          Sign in to access your practice, client engagements and controlled
          audit evidence.
        </p>
        <a href={signInHere()} target="_top" className="signin-button">
          {SIGN_IN_LABEL}
        </a>
        <DevPersonaSignIn />
        <p className="subtle">
          Access is determined by your practice membership.
        </p>
      </div>
    </div>
  );
}

export default function Workspace() {
  const workspace = useWorkspaceData();
  const { data, busy, loading, bootstrapping, connect } = workspace;
  const e = data?.engagement,
    role = data?.identity.role ?? "Client Viewer",
    writer = canWrite(role),
    reviewer = ["Reviewer", "Lead Auditor"].includes(role),
    lead = role === "Lead Auditor",
    viewer = ["Client Viewer", "Client Contributor"].includes(role);
  const editing = useEditingRegistry();
  const url = useUrlState(data);
  const modal = useModalState();
  const sheet = useRecordSheet();
  const paper = usePaperEditor(e);
  const lab = useLabIntent(url.view);
  const [switchOpen, setSwitchOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [sidebarWidth, setSidebarWidth] = useState(272),
    [onboarding, setOnboarding] = useState(false);
  // load() and act() call these before storing a response, so the updates
  // render together with the new data.
  useLayoutEffect(() => {
    connect({
      onClientAudience: (nextRole) => {
        url.resetForClientAudience(nextRole);
        sheet.setDetail(null);
        paper.clearPaper();
        modal.setModal("");
        editing.clear();
        paper.setHasPendingComment(false);
      },
      onRestoreView: url.setView,
      onPaperSaved: paper.acceptSavedRevision,
    });
  });
  const displayedEvidenceTab = viewer ? "files" : url.evidenceTab;
  const guarded = navigationGuard({
    busy,
    loading,
    bootstrapping,
    modal: modal.modal,
    isModalSubmitting: modal.isSubmitting,
    editorOpen: editing.editorOpen,
    view: url.view,
    isDirty: paper.isNavigationDirty,
    confirmDiscard: paper.confirmDiscard,
  });
  const nav = useWorkspaceNavigation({
    workspace,
    url,
    paper,
    sheet,
    modal,
    lab,
    guarded,
    setSwitchOpen,
    setSearchOpen,
  });
  const applyWorkspaceLink = useUrlSync({
    url,
    data,
    role,
    displayedEvidenceTab,
    paper,
    sheet,
    busy,
    loading,
    bootstrapping,
    modal: modal.modal,
    editorOpen: editing.editorOpen,
    guarded,
    load: workspace.load,
    getData: workspace.getData,
    setError: workspace.setError,
  });
  useWorkspaceBootstrap(workspace, applyWorkspaceLink, url.setView);
  useResumePreference(data, url.view, loading, bootstrapping);
  useModelContextTools(workspace.getData, nav.navigate);
  usePanelPrefetch(bootstrapping);
  const searchDisabled =
    !data ||
    busy ||
    loading ||
    bootstrapping ||
    switchOpen ||
    !!modal.modal ||
    !!sheet.detail ||
    editing.editorOpen;
  useSearchShortcut(searchDisabled, setSearchOpen);
  useLeaveGuard(
    paper.navigationDirty || editing.editorOpen || modal.modalDirty,
  );
  const resolveName = nameResolver(data);
  const paperRows = e
    ? selectPaperRegister(
        e,
        role,
        data?.identity.id ?? "",
        url.paperQuery,
        resolveName,
      ).rows
    : [];
  if (workspace.signedOut) return <SignedOut />;
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": sidebarWidth + "px",
          "--sidebar-width-icon": "4rem",
        } as React.CSSProperties
      }
    >
      <a href="#audit-main-content" className="audit-skip-link">
        Skip to audit content
      </a>
      <Toaster richColors />
      <WorkspaceNavigation
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        data={data}
        view={url.view}
        navigationDisabled={
          !data || busy || loading || bootstrapping || switchOpen
        }
        onSearch={() => setSearchOpen(true)}
        searchDisabled={searchDisabled}
        onNavigate={nav.navigate}
        onSwitch={nav.switchEngagement}
        onPractice={nav.changePractice}
        account={<AccountMenu data={data} />}
      />
      <SidebarInset>
        <WorkspaceTopbar
          data={data}
          view={url.view}
          clientId={url.clientId}
          role={role}
          searchDisabled={searchDisabled}
          onSearch={() => setSearchOpen(true)}
          onNavigate={nav.navigate}
          onClient={nav.openClient}
        />
        <main id="audit-main-content" tabIndex={-1} className="audit-main">
          {workspace.error && (
            <div className="error-banner" role="alert">
              {workspace.error}
              <Button variant="ghost" size="sm" onClick={workspace.retry}>
                <RefreshCw size={14} /> Retry
              </Button>
            </div>
          )}
          {loading || bootstrapping
            ? workspaceFallback
            : data && (
                <WorkspaceViews
                  data={data}
                  url={url}
                  nav={nav}
                  access={{ role, writer, reviewer, lead, viewer }}
                  busy={busy}
                  act={workspace.act}
                  safeAct={workspace.safeAct}
                  load={workspace.load}
                  displayedEvidenceTab={displayedEvidenceTab}
                  paperRows={paperRows}
                  reporters={editing.reporters}
                  resolve={resolveName}
                  lab={lab}
                  onModal={modal.open}
                  onDetail={sheet.viewDetail}
                  onOnboard={() => setOnboarding(true)}
                />
              )}
        </main>
      </SidebarInset>
      {data && (
        <MemberOnboarding
          open={onboarding}
          onClose={() => setOnboarding(false)}
          data={data}
          busy={busy}
          manage={workspace.manage}
          act={workspace.act}
          onEditing={editing.reporters["member-onboarding"]}
        />
      )}
      <PaperEditorHost
        paper={paper}
        sequence={
          url.view === "Working papers"
            ? paperRows.map((r) => r.paper)
            : (e?.papers ?? [])
        }
        engagement={e}
        data={data}
        role={role}
        busy={busy}
        error={workspace.error}
        paperTarget={url.paperTarget}
        setPaperTarget={url.setPaperTarget}
        act={workspace.act}
        resolve={resolveName}
        onOpenPaper={nav.openPaper}
        onOpenRecord={nav.openRecordInstead}
        onVault={nav.openVaultFiles}
        onRequest={nav.requestForPaper}
        onClose={nav.closePaper}
        onAction={nav.paperAction}
        onProcedure={nav.openPaperProcedure}
        onDetail={sheet.viewDetail}
      />
      <ModalHost
        state={modal}
        data={data}
        engagement={e}
        role={role}
        lead={lead}
        busy={busy}
        setBusy={workspace.setBusy}
        setError={workspace.setError}
        act={workspace.act}
        manage={workspace.manage}
        load={workspace.load}
        followUps={nav.modalFollowUps}
      />
      <RecordSheet
        sheet={sheet}
        editorOpen={editing.editorOpen}
        data={data}
        engagement={e}
        role={role}
        viewer={viewer}
        busy={busy}
        resolve={resolveName}
        act={workspace.act}
        safeAct={workspace.safeAct}
        load={workspace.load}
        reporters={editing.reporters}
        onPaper={nav.openPaper}
        onModal={modal.open}
        onRequestForm={nav.requestForm}
        onRemediate={nav.remediateFinding}
      />
      {data && (
        <EngagementSwitcher
          data={data}
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          onSelect={nav.openEngagement}
        />
      )}
      {data && (
        <WorkspaceSearch
          data={data}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={nav.searchSelect}
        />
      )}
    </SidebarProvider>
  );
}
