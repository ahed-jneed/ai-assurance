"use client";
import { lazy, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
// View-specific panels are code-split out of the initial bundle. They are
// prefetched once the workspace has bootstrapped (see usePanelPrefetch), so
// opening a view normally does not wait for the network.
const panelModules = [
  () => import("../work-inbox"),
  () => import("../management-views"),
  () => import("../audit-program"),
  () => import("../client-portal"),
  () => import("../evidence-requests"),
  () => import("../assurance-workbench"),
  () => import("../testing-lab"),
  () => import("../report-workspace"),
] as const;
const [
  loadWorkInbox,
  loadManagementViews,
  loadAuditProgram,
  loadClientPortal,
  loadEvidenceRequests,
  loadAssuranceWorkbench,
  loadTestingLab,
  loadReportWorkspace,
] = panelModules;
export const WorkInbox = lazy(() =>
  loadWorkInbox().then((m) => ({ default: m.WorkInbox })),
);
export const ManagementViews = lazy(() =>
  loadManagementViews().then((m) => ({ default: m.ManagementViews })),
);
export const AuditProgram = lazy(() =>
  loadAuditProgram().then((m) => ({ default: m.AuditProgram })),
);
export const ReportRelease = lazy(() =>
  loadAuditProgram().then((m) => ({ default: m.ReportRelease })),
);
export const FindingAssurance = lazy(() =>
  loadAuditProgram().then((m) => ({ default: m.FindingAssurance })),
);
export const ClientPortal = lazy(() =>
  loadClientPortal().then((m) => ({ default: m.ClientPortal })),
);
export const RequestAccess = lazy(() =>
  loadClientPortal().then((m) => ({ default: m.RequestAccess })),
);
export const EvidenceRequests = lazy(() =>
  loadEvidenceRequests().then((m) => ({ default: m.EvidenceRequests })),
);
export const EvidenceRequestDetails = lazy(() =>
  loadEvidenceRequests().then((m) => ({ default: m.EvidenceRequestDetails })),
);
export const AssuranceWorkbench = lazy(() =>
  loadAssuranceWorkbench().then((m) => ({ default: m.AssuranceWorkbench })),
);
export const TestingLab = lazy(() =>
  loadTestingLab().then((m) => ({ default: m.TestingLab })),
);
export const ReportWorkspace = lazy(() =>
  loadReportWorkspace().then((m) => ({ default: m.ReportWorkspace })),
);
export const panelFallback = (
  <div className="loading-grid" role="status" aria-label="Loading">
    <Skeleton className="h-16" />
    <Skeleton className="h-80" />
  </div>
);
/** The workspace shell's placeholder while the engagement loads (#135). */
export const workspaceFallback = (
  <div className="loading-grid" role="status" aria-label="Loading workspace">
    <Skeleton className="h-16" />
    <Skeleton className="h-32" />
    <Skeleton className="h-80" />
  </div>
);
/** Prefetches the code-split panels in the background once the workspace is up. */
export function usePanelPrefetch(bootstrapping: boolean) {
  useEffect(() => {
    if (bootstrapping) return;
    for (const loadPanel of panelModules) void loadPanel().catch(() => {});
  }, [bootstrapping]);
}
