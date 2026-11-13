"use client";
// The audit workspace: composes the data, location, editor and guard hooks
// and lays out the sidebar, top bar, open view, dialogs and record sheet.
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { EngagementSwitcher as EngagementSwitcherView } from "../engagement-switcher";
import { MemberOnboarding as MemberOnboardingView } from "../member-onboarding";
import { WorkspaceNavigation as WorkspaceNavigationView } from "../workspace-navigation";
import { WorkspaceSearch as WorkspaceSearchView } from "../workspace-search";
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
import { useStableShape } from "./stable-shape";
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
import { WorkspaceTopbar as WorkspaceTopbarView } from "./workspace-topbar";

// The panels around the open view re-render only when their own props
// change (#63), not on each keystroke in a paper, a form or the view.
const EngagementSwitcher = memo(EngagementSwitcherView),
  MemberOnboarding = memo(MemberOnboardingView),
  WorkspaceNavigation = memo(WorkspaceNavigationView),
  WorkspaceSearch = memo(WorkspaceSearchView),
  WorkspaceTopbar = memo(WorkspaceTopbarView);

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
    [onboarding, setOnboarding] = useState(false),
    // Each opening of the onboarding wizard mounts it afresh, so it starts
    // from step one with empty fields.
    [onboardingRun, setOnboardingRun] = useState(0);
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
    loading,
    bootstrapping,
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
  // The views are memoised (#63): they receive these with the same identity
  // until their values change, so typing in a paper, a form or another view
  // does not re-render them.
  const resolveName = useMemo(() => nameResolver(data), [data]);
  const paperQuery = useStableShape(url.paperQuery);
  const paperRows = useMemo(
    () =>
      e
        ? selectPaperRegister(
            e,
            role,
            data?.identity.id ?? "",
            paperQuery,
            resolveName,
          ).rows
        : [],
    [e, role, data?.identity.id, paperQuery, resolveName],
  );
  const viewUrl = useStableShape(url),
    viewNav = useStableShape(nav),
    // By identity: the lab consumes an intent by comparing it with the pending one.
    viewLab = useMemo(
      () => ({ intent: lab.intent, consume: lab.consume }),
      [lab.intent, lab.consume],
    ),
    handlers = useStableShape({
      openModal: modal.open,
      viewDetail: sheet.viewDetail,
      onboard: () => {
        setOnboardingRun((n) => n + 1);
        setOnboarding(true);
      },
    }),
    access = useMemo(
      () => ({ role, writer, reviewer, lead, viewer }),
      [role, writer, reviewer, lead, viewer],
    );
  const openSearch = useCallback(() => setSearchOpen(true), []),
    closeOnboarding = useCallback(() => setOnboarding(false), []),
    account = useMemo(() => <AccountMenu data={data} />, [data]);
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
        onSearch={openSearch}
        searchDisabled={searchDisabled}
        onNavigate={viewNav.navigate}
        onSwitch={viewNav.switchEngagement}
        onPractice={viewNav.changePractice}
        account={account}
      />
      <SidebarInset>
        <WorkspaceTopbar
          data={data}
          view={url.view}
          clientId={url.clientId}
          role={role}
          searchDisabled={searchDisabled}
          onSearch={openSearch}
          onNavigate={viewNav.navigate}
          onClient={viewNav.openClient}
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
                  url={viewUrl}
                  nav={viewNav}
                  access={access}
                  busy={busy}
                  act={workspace.act}
                  safeAct={workspace.safeAct}
                  load={workspace.load}
                  displayedEvidenceTab={displayedEvidenceTab}
                  paperRows={paperRows}
                  reporters={editing.reporters}
                  resolve={resolveName}
                  lab={viewLab}
                  onModal={handlers.openModal}
                  onDetail={handlers.viewDetail}
                  onOnboard={handlers.onboard}
                />
              )}
        </main>
      </SidebarInset>
      {data && (
        <MemberOnboarding
          key={onboardingRun}
          open={onboarding}
          onClose={closeOnboarding}
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
          onSelect={viewNav.openEngagement}
        />
      )}
      {data && (
        <WorkspaceSearch
          data={data}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={viewNav.searchSelect}
        />
      )}
    </SidebarProvider>
  );
}
