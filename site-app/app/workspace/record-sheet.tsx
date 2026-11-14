"use client";
// The side sheet that shows the open record: evidence, an evidence request,
// or any other record (findings, reports, runs, templates, audit events),
// with report package administration and a JSON export.
import { Suspense } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type {
  Artifact,
  Engagement,
  EvidenceRequest,
  Finding,
  Paper,
  Report,
  Role,
} from "@/lib/domain/types";
import { EvidenceDetails } from "../evidence-details";
import { PackageIntegrity } from "../package-integrity";
import { RecordDetails } from "../record-details";
import type { WorkspaceData } from "../workspace-types";
import type { EditingSource, EditingReporter } from "./navigation-guards";
import {
  EvidenceRequestDetails,
  FindingAssurance,
  ReportRelease,
  panelFallback,
} from "./panels";
import { useAttest } from "./attestation-dialog";
import { liveRecord } from "./records";
import type { OpenModal, WorkspaceAct, WorkspaceLoad } from "./types";
import type { RecordSheetState } from "./use-record-sheet";
import { download } from "./workspace-ui";

export function RecordSheet({
  sheet,
  editorOpen,
  data,
  engagement: e,
  role,
  viewer,
  busy,
  resolve,
  act,
  load,
  reporters,
  onPaper,
  onModal,
  onRequestForm,
  onRemediate,
}: {
  sheet: RecordSheetState;
  /** While an editor is open the sheet ignores requests to close. */
  editorOpen: boolean;
  data: WorkspaceData | null;
  engagement: Engagement | null | undefined;
  role: Role;
  viewer: boolean;
  busy: boolean;
  resolve: (id: string) => string;
  act: WorkspaceAct;
  load: WorkspaceLoad;
  reporters: Record<EditingSource, EditingReporter>;
  onPaper: (paper: Paper) => void;
  onModal: OpenModal;
  onRequestForm: (form: string, request?: EvidenceRequest) => void;
  onRemediate: (findingId: string) => void;
}) {
  const { detail, setDetail, detailExpanded, setDetailExpanded, viewDetail } =
    sheet;
  const liveDetail = liveRecord(detail?.value, e);
  const attest = useAttest();
  const openPaper = (p: Paper) => {
    setDetail(null);
    onPaper(p);
  };
  return (
    <Sheet
      open={!!detail}
      onOpenChange={(o) => {
        if (!o && !editorOpen) setDetail(null);
      }}
    >
      {!!detail && (
        <SheetContent
          side="right"
          className={"record-sheet " + (detailExpanded ? "expanded" : "")}
        >
          <div className="peek-bar">
            <span>Record</span>
            <Button
              className="sheet-expand-control"
              variant="ghost"
              size="sm"
              onClick={() => setDetailExpanded((v) => !v)}
            >
              {detailExpanded ? "Side peek" : "Expand"}
            </Button>
          </div>
          <div className="sheet-scroll">
            <div className="document-page">
              <SheetTitle className="document-title">
                {detail?.title}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Record details
              </SheetDescription>{" "}
              {e &&
              data &&
              detail?.value &&
              typeof detail.value === "object" &&
              "category" in detail.value &&
              "sha256" in detail.value ? (
                <EvidenceDetails
                  artifact={liveDetail as Artifact}
                  engagement={e}
                  tenantId={data.tenantId}
                  role={role}
                  busy={busy}
                  resolve={resolve}
                  onAccept={() =>
                    attest("acceptEvidence", {
                      artifactId: (detail.value as Artifact).id,
                    })
                  }
                  onPaper={openPaper}
                  onModel={(m) => viewDetail(m.name, m)}
                  onRun={(r) => viewDetail("Diagnostic run", r)}
                  onFinding={(f) => viewDetail(f.title, f)}
                  onRequest={(r) => viewDetail(r.subject, r)}
                  onLink={() =>
                    onModal("linkEvidence", {
                      artifactId: (detail.value as Artifact).id,
                    })
                  }
                />
              ) : e &&
                liveDetail &&
                typeof liveDetail === "object" &&
                "responsibleParty" in liveDetail ? (
                <Suspense fallback={panelFallback}>
                  <EvidenceRequestDetails
                    key={
                      data?.tenantId +
                      ":" +
                      e.id +
                      ":" +
                      (liveDetail as EvidenceRequest).id
                    }
                    request={liveDetail as EvidenceRequest}
                    engagement={e}
                    role={role}
                    busy={busy}
                    resolve={resolve}
                    onForm={onRequestForm}
                    onPaper={openPaper}
                    onArtifact={(id) => {
                      const artifact = e.artifacts.find((a) => a.id === id);
                      if (artifact) viewDetail(artifact.name, artifact);
                    }}
                  />
                </Suspense>
              ) : (
                <RecordDetails
                  findingReview={
                    !viewer &&
                    e &&
                    !!liveDetail &&
                    typeof liveDetail === "object" &&
                    "riskScore" in liveDetail ? (
                      <Suspense fallback={null}>
                        <FindingAssurance
                          finding={liveDetail as Finding}
                          engagement={e}
                          role={role}
                          userId={data?.identity.id ?? ""}
                          busy={busy}
                          act={act}
                          onEditing={reporters["finding-assurance"]}
                        />
                      </Suspense>
                    ) : undefined
                  }
                  value={liveDetail}
                  engagement={e}
                  role={role}
                  userId={data?.identity.id ?? ""}
                  busy={busy}
                  onRemediate={onRemediate}
                  onRetest={(id) => {
                    const f = e?.findings.find((f) => f.id === id);
                    if (f) viewDetail(f.title, f);
                  }}
                  onPaper={openPaper}
                  resolve={resolve}
                />
              )}
              <div className="report-package-administration">
                {e &&
                  data &&
                  !!liveDetail &&
                  typeof liveDetail === "object" &&
                  "snapshot" in liveDetail && (
                    <PackageIntegrity
                      tenantId={data.tenantId}
                      engagement={e}
                      report={liveDetail as Report}
                      role={role}
                      onRefresh={() => load(data.tenantId, e.id)}
                    />
                  )}
                {!viewer &&
                  !!liveDetail &&
                  typeof liveDetail === "object" &&
                  "clientSnapshot" in liveDetail && (
                    <Suspense fallback={null}>
                      <ReportRelease
                        reports={e?.reports ?? []}
                        report={liveDetail as Report}
                        role={role}
                        userId={data?.identity.id ?? ""}
                        busy={busy}
                        act={act}
                        onEditing={reporters["report-release"]}
                      />
                    </Suspense>
                  )}
              </div>
              <details className="provenance">
                <summary>Export record</summary>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    download(
                      "audit-record.json",
                      detail?.value &&
                        typeof detail.value === "object" &&
                        "category" in detail.value &&
                        "id" in detail.value
                        ? (e?.artifacts.find(
                            (a) => a.id === (detail.value as { id: string }).id,
                          ) ?? detail.value)
                        : liveDetail,
                    )
                  }
                >
                  <Download size={14} /> Export JSON
                </Button>
              </details>
            </div>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
