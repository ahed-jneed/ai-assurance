"use client";
// The main content of the workspace: the open view. The view and every
// panel beside it are memoised (#63, F-48): the shell passes stable props
// (stable-shape.ts) and the handlers below keep their identity, so typing in
// one view, a paper or a form re-renders only what reads the change.
import { memo, Suspense } from "react";
import { Building2 } from "lucide-react";
import type { Role } from "@/lib/domain";
import { canSeeAccessLog, decisionState } from "@/lib/permissions";
import { reportTermsFor, type ReportTerms } from "@/lib/domain/report-model";
import type { PaperRegisterRow } from "@/lib/paper-presentation";
import { normalizeWorkbenchQuery } from "@/lib/workbench-presentation";
import {
  Ll144Panel as Ll144PanelView,
  ll144PanelAccess,
} from "../../ll144-panel";
import { WorkingPaperRegister as PaperRegisterView } from "../../paper-register";
import { packFeatures, type WorkspaceData } from "../../workspace-types";
import { useAttest } from "../attestation-dialog";
import type { LabIntentState } from "../lab-intent";
import { classificationDefaults } from "../modals/classification";
import {
  newFindingDefaults,
  procedureFindingDefaults,
} from "../modals/finding";
import { uploadDefaults } from "../modals/upload";
import { isManagementView } from "../modules";
import type { EditingReporter, EditingSource } from "../navigation-guards";
import {
  AccessLog,
  AssuranceWorkbench,
  AuditProgram,
  ManagementViews,
  ReportWorkspace,
  TestingLab,
  WorkInbox,
  panelFallback,
} from "../panels";
import { reportTitle } from "../records";
import { useStableShape } from "../stable-shape";
import type {
  OpenModal,
  ViewDetail,
  WorkspaceAct,
  WorkspaceLoad,
} from "../types";
import type { UrlState } from "../use-url-state";
import {
  copyWorkspaceLink,
  type WorkspaceNavigation,
} from "../use-workspace-navigation";
import { Empty } from "../workspace-ui";
import { EvidenceVault as EvidenceVaultView } from "./evidence-vault";
import { Findings as FindingsView } from "./findings";
import {
  Nonconformities as NonconformitiesView,
  ProgrammePhases as ProgrammePhasesView,
  StatementOfApplicability as SoaView,
} from "./management-system";
import { Methodology as MethodologyView } from "./methodology";
import { Overview as OverviewView } from "./overview";
import { PageHead as PageHeadView } from "./page-head";
import { RegulatoryMapping as RegulatoryMappingView } from "./regulatory-mapping";

const Ll144Panel = memo(Ll144PanelView),
  WorkingPaperRegister = memo(PaperRegisterView),
  EvidenceVault = memo(EvidenceVaultView),
  Findings = memo(FindingsView),
  Nonconformities = memo(NonconformitiesView),
  ProgrammePhases = memo(ProgrammePhasesView),
  StatementOfApplicability = memo(SoaView),
  Methodology = memo(MethodologyView),
  Overview = memo(OverviewView),
  PageHead = memo(PageHeadView),
  RegulatoryMapping = memo(RegulatoryMappingView);

export type Access = {
  role: Role;
  writer: boolean;
  reviewer: boolean;
  lead: boolean;
  /** A client role (viewer or contributor). */
  viewer: boolean;
};

export const WorkspaceViews = memo(function WorkspaceViews({
  data,
  url,
  nav,
  access,
  busy,
  act,
  safeAct,
  load,
  displayedEvidenceTab,
  paperRows,
  reporters,
  resolve,
  lab,
  onModal,
  onDetail,
  onOnboard,
}: {
  data: WorkspaceData;
  url: UrlState;
  nav: WorkspaceNavigation;
  access: Access;
  busy: boolean;
  act: WorkspaceAct;
  safeAct: (op: string, values: Record<string, unknown>) => void;
  load: WorkspaceLoad;
  displayedEvidenceTab: string;
  paperRows: PaperRegisterRow[];
  reporters: Record<EditingSource, EditingReporter>;
  resolve: (id: string) => string;
  /** Work handed to the Testing lab (lab-intent.ts). */
  lab: Pick<LabIntentState, "intent" | "consume">;
  onModal: OpenModal;
  onDetail: ViewDetail;
  onOnboard: () => void;
}) {
  const attest = useAttest();
  const { view } = url;
  const { role, writer, reviewer, lead, viewer } = access;
  const e = data.engagement;
  const features = packFeatures(data);
  const reportTerms = e
    ? reportTermsFor(
        url.reportTerms,
        e.id,
        features.certificationRecommendation,
      )
    : undefined;
  // Everything the views receive that is built here, with the same identity
  // while its values are unchanged.
  const on = useStableShape({
    copyLink: () => void copyWorkspaceLink(),
    backToClients: () => nav.navigate("Clients"),
    reload: () => (e ? load(data.tenantId, e.id) : Promise.resolve(null)),
    features,
    reportTerms,
    savedView: {
      module: view,
      search: url.search,
      filter: url.savedFilter,
      facet: url.facet,
      sort: url.sort,
    },
    openSavedView: (v: {
      module: string;
      search: string;
      filter: string;
      facet: string;
      sort: string;
    }) =>
      nav.navigate(
        v.module,
        { search: v.search, filter: v.filter, facet: v.facet },
        () => url.setSort(v.sort),
      ),
    settings: () => onModal("rename"),
    headAction:
      e && view === "Regulatory mapping" && features.aiActClassification
        ? {
            label: "Assess classification",
            onClick: () => {
              const form = classificationDefaults(e);
              onModal("classification", form.choices, form.checks);
            },
          }
        : undefined,
    clearProcedure: () => url.setProcedureContext(undefined),
    programLocation: (id: string | undefined, section: string) => {
      url.setProcedureContext(id);
      url.setProcedureSection(section);
    },
    procedureFinding: (p: Parameters<typeof procedureFindingDefaults>[0]) =>
      onModal("finding", procedureFindingDefaults(p)),
    followup: (id: string) => nav.openEngagement(id),
    advance: (stage: string) => attest("setStage", { stage }),
    newPaper: writer ? () => onModal("paper") : undefined,
    vaultEditing: {
      clientPortal: reporters["client-portal"],
      requestAccess: reporters["request-access"],
    },
    openArtifact: (a: { name: string }) => onDetail(a.name, a),
    openRequest: (r: { subject: string }) => onDetail(r.subject, r),
    upload: () => onModal("upload", uploadDefaults()),
    newRequest: () => nav.requestForm("request"),
    workbenchLocation: (q: Parameters<typeof normalizeWorkbenchQuery>[0]) =>
      url.setWorkbenchQuery(normalizeWorkbenchQuery(q)),
    workbenchEvidence: (id: string) => {
      const artifact = e?.artifacts.find((a) => a.id === id);
      if (artifact) nav.viewRecord(artifact.name, artifact);
    },
    workbenchPaper: (id: string) => {
      const p = e?.papers.find((p) => p.id === id);
      if (p) nav.openPaper(p);
    },
    labEvidence: () => nav.navigate("Evidence vault"),
    openFinding: (f: { title: string }) => onDetail(f.title, f),
    newFinding: () => onModal("finding", newFindingDefaults()),
    coverage:
      e && !viewer
        ? { tenantId: data.tenantId, engagementId: e.id, version: e.version }
        : undefined,
    approveClassification: () => attest("approveClassification", {}),
    classificationApproval: e
      ? decisionState(role, data.identity.id, {
          action: "approveClassification",
          engagement: e,
        })
      : undefined,
    reportTermsChange: (terms: ReportTerms) =>
      e && url.setReportTerms({ engagementId: e.id, terms }),
    paperAudience: (paperId: string, audience: "internal" | "client") =>
      safeAct("setPaperAudience", { paperId, audience }),
    createReport: (kind: "draft" | "final") =>
      e &&
      reportTerms &&
      onModal("report", {
        kind,
        engagementType: reportTerms.engagementType,
        assuranceLevel: reportTerms.assuranceLevel ?? "",
        conclusion: reportTerms.conclusion,
        addressee: e.workflow?.brief?.audience ?? "",
      }),
    openReport: (r: Parameters<typeof reportTitle>[0]) =>
      onDetail(reportTitle(r), r),
  });
  if (view === "My work" && !viewer)
    return (
      <Suspense fallback={panelFallback}>
        <WorkInbox
          data={data}
          onOpen={nav.openWork}
          query={url.inboxQuery}
          onQueryChange={url.setInboxQuery}
          onCopyLink={on.copyLink}
        />
      </Suspense>
    );
  // The practice's Access log (#181), for Lead Auditors and practice
  // administrators.
  if (view === "Access log")
    return canSeeAccessLog(data.identity) ? (
      <Suspense fallback={panelFallback}>
        <AccessLog data={data} />
      </Suspense>
    ) : (
      <Empty
        icon={Building2}
        title="The Access log is not available to you"
        text="Lead Auditors and practice administrators see the practice's Access log."
      />
    );
  // The practice directories are not part of the client portal (#36).
  if (isManagementView(view) && !viewer)
    return (
      <Suspense fallback={panelFallback}>
        <ManagementViews
          onBack={on.backToClients}
          view={view}
          data={data}
          clientId={url.clientId}
          setClientId={url.setClientId}
          onEngagement={nav.openEngagement}
          open={onModal}
          onOnboard={onOnboard}
          busy={busy}
          search={url.search}
          setSearch={url.setSearch}
        />
      </Suspense>
    );
  if (!e || !on.reportTerms)
    return data.engagementError ? (
      <Empty
        icon={Building2}
        title="This engagement cannot be opened"
        text="Choose another engagement from the directory. The banner above says what is wrong with this one."
      />
    ) : (
      <Empty
        icon={Building2}
        title="No engagement is assigned"
        text="Ask your Lead Auditor to assign client access."
      />
    );
  const ll144 = ll144PanelAccess(on.features.ll144BiasAudit, e);
  return (
    <>
      <PageHead
        view={view}
        criteria={data.criteria}
        engagement={e}
        tenantId={data.tenantId}
        viewer={viewer}
        lead={lead}
        writer={writer}
        busy={busy}
        savedView={on.savedView}
        onSavedView={on.openSavedView}
        onCopyLink={on.copyLink}
        onSettings={on.settings}
        onNavigate={nav.navigate}
        action={on.headAction}
        procedureContext={url.procedureContext}
        onClearProcedure={on.clearProcedure}
      />
      {view === "Audit program" && !viewer && (
        <Suspense fallback={panelFallback}>
          <AuditProgram
            onLocation={on.programLocation}
            key={e.id}
            data={data}
            busy={busy}
            act={act}
            onPaper={nav.openPaper}
            onRequest={nav.requestForPaper}
            onNavigate={nav.navigate}
            onEditing={reporters["audit-program"]}
            initialProcedure={url.procedureContext}
            initialSection={url.procedureSection}
            onRecord={onDetail}
            onContext={url.setProcedureContext}
            onFinding={on.procedureFinding}
            onFollowup={on.followup}
            onQueuedRun={nav.showQueuedRun}
          />
        </Suspense>
      )}
      {view === "Overview" && (
        <Overview
          data={data}
          engagement={e}
          role={role}
          viewer={viewer}
          busy={busy}
          onEditing={reporters["client-portal"]}
          onReload={on.reload}
          onNavigate={nav.navigate}
          onWork={nav.openWork}
          onPaper={nav.openPaper}
          onGate={nav.openGate}
          onRequests={nav.openRequests}
          onAdvance={on.advance}
        />
      )}
      {view === "Working papers" && (
        <WorkingPaperRegister
          engagement={e}
          rows={paperRows}
          role={role}
          query={url.paperQuery}
          onQuery={url.patchRegister}
          onReset={url.clearRegister}
          onOpen={nav.openPaper}
          onProcedure={nav.openPaperProcedure}
          resolve={resolve}
          busy={busy}
          onNew={on.newPaper}
        />
      )}
      {view === "Evidence vault" && (
        <EvidenceVault
          data={data}
          engagement={e}
          role={role}
          writer={writer}
          busy={busy}
          url={url}
          displayedEvidenceTab={displayedEvidenceTab}
          resolve={resolve}
          act={act}
          onEditing={on.vaultEditing}
          onReload={on.reload}
          onOpenArtifact={on.openArtifact}
          onOpenRequest={on.openRequest}
          onUpload={on.upload}
          onNewRequest={on.newRequest}
        />
      )}
      {view === "Assurance workbench" && !viewer && (
        <Suspense fallback={panelFallback}>
          <AssuranceWorkbench
            location={url.workbenchQuery}
            onLocation={on.workbenchLocation}
            onEvidence={on.workbenchEvidence}
            initialProcedure={url.procedureContext}
            onHosted={nav.handOffToLab}
            key={data.tenantId + ":" + e.id}
            data={data}
            onRefresh={on.reload}
            onPaper={on.workbenchPaper}
            onNavigate={nav.navigate}
            onEditing={reporters["assurance-workbench"]}
          />
        </Suspense>
      )}
      {view === "Testing lab" && (
        <Suspense fallback={panelFallback}>
          <TestingLab
            intent={lab.intent}
            onIntentUsed={lab.consume}
            onRefresh={on.reload}
            key={data.tenantId + ":" + e.id}
            engagement={e}
            tenantId={data.tenantId}
            role={role}
            busy={busy}
            view={url.labView}
            onView={url.setLabView}
            onEditorOpen={reporters["testing-lab"]}
            onDatasetEditing={reporters["dataset-registry"]}
            onBasisEditing={reporters["special-category-basis"]}
            act={act}
            onPaper={nav.openPaper}
            resolve={resolve}
            onEvidence={on.labEvidence}
          />
          {!viewer && ll144.shown && (
            <Ll144Panel
              key={"ll144:" + data.tenantId + ":" + e.id}
              engagement={e}
              tenantId={data.tenantId}
              writer={writer && ll144.compute}
              reviewer={reviewer || lead}
              userId={data.identity.id}
              busy={busy}
              act={act}
              onEditing={reporters["ll144-audit"]}
            />
          )}
        </Suspense>
      )}
      {view === "Findings" && !viewer && on.features.nonconformityGrading && (
        <Nonconformities
          engagement={e}
          writer={writer}
          reviewer={reviewer}
          userId={data.identity.id}
          busy={busy}
          act={safeAct}
        />
      )}
      {view === "Findings" && (
        <Findings
          engagement={e}
          register={url.register}
          role={role}
          userId={data.identity.id}
          writer={writer}
          busy={busy}
          onOpen={on.openFinding}
          onRemediate={nav.remediateFinding}
          onNew={on.newFinding}
        />
      )}
      {view === "Regulatory mapping" && (
        <RegulatoryMapping
          features={on.features}
          coverage={on.coverage}
          engagement={e}
          catalog={data.catalog}
          approval={on.classificationApproval!}
          busy={busy}
          onApprove={on.approveClassification}
        />
      )}
      {view === "Regulatory mapping" &&
        !viewer &&
        data.criteria?.managementSystem && (
          <>
            <ProgrammePhases
              engagement={e}
              view={data.criteria.managementSystem}
            />
            <StatementOfApplicability
              engagement={e}
              view={data.criteria.managementSystem}
              writer={writer}
              reviewer={reviewer}
              userId={data.identity.id}
              busy={busy}
              act={safeAct}
            />
          </>
        )}
      {view === "Reports & sign-off" && (
        <Suspense fallback={panelFallback}>
          <ReportWorkspace
            key={e.id}
            features={on.features}
            engagement={e}
            tenantId={data.tenantId}
            role={role}
            userId={data.identity.id}
            people={data.people}
            busy={busy}
            terms={on.reportTerms}
            onTerms={on.reportTermsChange}
            onAudience={on.paperAudience}
            onGate={nav.openGate}
            onCreate={on.createReport}
            onOpen={on.openReport}
            onAct={safeAct}
            section={url.reportSection}
            onSection={url.setReportSection}
            query={url.registerQuery}
            onQuery={url.patchRegister}
            onReset={url.clearRegister}
          />
        </Suspense>
      )}
      {view === "Methodology" && (
        <Methodology
          data={data}
          register={url.register}
          writer={writer}
          busy={busy}
          onDetail={onDetail}
          onUseTemplate={nav.createPaperFromTemplate}
        />
      )}
    </>
  );
});
