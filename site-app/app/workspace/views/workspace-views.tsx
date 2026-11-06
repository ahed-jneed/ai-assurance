"use client";
// The main content of the workspace: the open view.
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import type { Role } from "@/lib/domain";
import type { PaperRegisterRow } from "@/lib/paper-presentation";
import { normalizeWorkbenchQuery } from "@/lib/workbench-presentation";
import { WorkingPaperRegister } from "../../paper-register";
import { packFeatures, type WorkspaceData } from "../../workspace-types";
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
  AssuranceWorkbench,
  AuditProgram,
  ManagementViews,
  ReportWorkspace,
  TestingLab,
  WorkInbox,
  panelFallback,
} from "../panels";
import { reportTitle } from "../records";
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
import { EvidenceVault } from "./evidence-vault";
import { Findings } from "./findings";
import { Methodology } from "./methodology";
import { Overview } from "./overview";
import { PageHead } from "./page-head";
import { RegulatoryMapping } from "./regulatory-mapping";

export type Access = {
  role: Role;
  writer: boolean;
  reviewer: boolean;
  lead: boolean;
  /** A client role (viewer or contributor). */
  viewer: boolean;
};

export function WorkspaceViews({
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
  const { view } = url;
  const { role, writer, reviewer, lead, viewer } = access;
  const e = data.engagement;
  const copyLink = () => void copyWorkspaceLink();
  if (view === "My work" && !viewer)
    return (
      <Suspense fallback={panelFallback}>
        <WorkInbox
          data={data}
          onOpen={nav.openWork}
          query={url.inboxQuery}
          onQueryChange={url.setInboxQuery}
          onCopyLink={copyLink}
        />
      </Suspense>
    );
  if (isManagementView(view))
    return (
      <Suspense fallback={panelFallback}>
        <ManagementViews
          onBack={() => nav.navigate("Clients")}
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
  if (!e)
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
  const reload = () => load(data.tenantId, e.id);
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
        savedView={{
          module: view,
          search: url.search,
          filter: url.savedFilter,
          facet: url.facet,
          sort: url.sort,
        }}
        onSavedView={(v) =>
          nav.navigate(
            v.module,
            { search: v.search, filter: v.filter, facet: v.facet },
            () => url.setSort(v.sort),
          )
        }
        onCopyLink={copyLink}
        onSettings={() => onModal("rename")}
        onNavigate={nav.navigate}
        action={
          view === "Regulatory mapping" &&
          packFeatures(data).aiActClassification
            ? {
                label: "Assess classification",
                onClick: () => {
                  const form = classificationDefaults(e);
                  onModal("classification", form.choices, form.checks);
                },
              }
            : undefined
        }
        procedureContext={url.procedureContext}
        onClearProcedure={() => url.setProcedureContext(undefined)}
      />
      {view === "Audit program" && !viewer && (
        <Suspense fallback={panelFallback}>
          <AuditProgram
            onLocation={(id, section) => {
              url.setProcedureContext(id);
              url.setProcedureSection(section);
            }}
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
            onFinding={(p) => onModal("finding", procedureFindingDefaults(p))}
            onFollowup={(id) => nav.openEngagement(id)}
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
          onReload={reload}
          onNavigate={nav.navigate}
          onWork={nav.openWork}
          onPaper={nav.openPaper}
          onGate={nav.openGate}
          onRequests={nav.openRequests}
          onAdvance={(stage) => safeAct("setStage", { stage })}
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
          onNew={writer ? () => onModal("paper") : undefined}
        />
      )}
      {view === "Evidence vault" && (
        <EvidenceVault
          data={data}
          engagement={e}
          role={role}
          viewer={viewer}
          writer={writer}
          busy={busy}
          url={url}
          displayedEvidenceTab={displayedEvidenceTab}
          resolve={resolve}
          act={act}
          onEditing={{
            clientPortal: reporters["client-portal"],
            requestAccess: reporters["request-access"],
          }}
          onReload={reload}
          onOpenArtifact={(a) => onDetail(a.name, a)}
          onOpenRequest={(r) => onDetail(r.subject, r)}
          onUpload={() => onModal("upload", uploadDefaults())}
          onNewRequest={() => nav.requestForm("request")}
        />
      )}
      {view === "Assurance workbench" && !viewer && (
        <Suspense fallback={panelFallback}>
          <AssuranceWorkbench
            location={url.workbenchQuery}
            onLocation={(q) =>
              url.setWorkbenchQuery(normalizeWorkbenchQuery(q))
            }
            onEvidence={(id) => {
              const artifact = e.artifacts.find((a) => a.id === id);
              if (artifact) nav.viewRecord(artifact.name, artifact);
            }}
            initialProcedure={url.procedureContext}
            onHosted={nav.handOffToLab}
            key={data.tenantId + ":" + e.id}
            data={data}
            onRefresh={reload}
            onPaper={(id) => {
              const p = e.papers.find((p) => p.id === id);
              if (p) nav.openPaper(p);
            }}
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
            onRefresh={reload}
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
            onEvidence={() => nav.navigate("Evidence vault")}
          />
        </Suspense>
      )}
      {view === "Findings" && (
        <Findings
          engagement={e}
          register={url.register}
          role={role}
          userId={data.identity.id}
          writer={writer}
          busy={busy}
          onOpen={(f) => onDetail(f.title, f)}
          onRemediate={nav.remediateFinding}
          onNew={() => onModal("finding", newFindingDefaults())}
        />
      )}
      {view === "Regulatory mapping" && (
        <RegulatoryMapping
          features={packFeatures(data)}
          engagement={e}
          catalog={data.catalog}
          reviewer={reviewer}
          busy={busy}
          onApprove={() => safeAct("approveClassification", {})}
        />
      )}
      {view === "Reports & sign-off" && (
        <Suspense fallback={panelFallback}>
          <ReportWorkspace
            key={e.id}
            features={packFeatures(data)}
            engagement={e}
            tenantId={data.tenantId}
            role={role}
            userId={data.identity.id}
            people={data.people}
            busy={busy}
            terms={url.reportTerms}
            onTerms={url.setReportTerms}
            onAudience={(paperId, audience) =>
              safeAct("setPaperAudience", { paperId, audience })
            }
            onGate={nav.openGate}
            onCreate={(kind) =>
              onModal("report", {
                kind,
                engagementType: url.reportTerms.engagementType,
                assuranceLevel: url.reportTerms.assuranceLevel ?? "",
                conclusion: url.reportTerms.conclusion,
                addressee: e.workflow?.brief?.audience ?? "",
              })
            }
            onOpen={(r) => onDetail(reportTitle(r), r)}
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
          resolve={resolve}
          onDetail={onDetail}
          onUseTemplate={nav.createPaperFromTemplate}
        />
      )}
    </>
  );
}
