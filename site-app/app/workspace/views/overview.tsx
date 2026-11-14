"use client";
import { lazy, Suspense } from "react";
import type { AuditGate } from "@/lib/domain/gates";
import type { Engagement, Paper, Role } from "@/lib/domain/types";
import type { PaperTarget } from "@/lib/paper-workflow";
import { canSee } from "@/lib/permissions";
import type { WorkItem } from "@/lib/work-items";
import { EngagementOverview } from "../../engagement-overview";
import type { WorkspaceData } from "../../workspace-types";
import type { EditingReporter } from "../navigation-guards";
import { ClientPortal, panelFallback } from "../panels";
import type { Navigate } from "../types";
import { ClientOverview } from "./client-overview";

// Criteria coverage (GET /api/coverage) is code-split like the other panels.
const CoverageSummary = lazy(() =>
  import("./criteria-coverage").then((m) => ({ default: m.CoverageSummary })),
);

/** The engagement overview: the staff dashboard, or the client summary. */
export function Overview({
  data,
  engagement: e,
  role,
  viewer,
  busy,
  onEditing,
  onReload,
  onNavigate,
  onWork,
  onPaper,
  onGate,
  onRequests,
  onAdvance,
}: {
  data: WorkspaceData;
  engagement: Engagement;
  role: Role;
  viewer: boolean;
  busy: boolean;
  onEditing: EditingReporter;
  onReload: () => Promise<unknown>;
  onNavigate: Navigate;
  onWork: (item: WorkItem) => void;
  onPaper: (paper: Paper, target?: PaperTarget) => void;
  onGate: (gate: AuditGate, target?: PaperTarget) => void;
  onRequests: () => void;
  onAdvance: (stage: string) => void;
}) {
  return (
    <>
      {canSee(role, "clientPortal") && (
        <Suspense fallback={panelFallback}>
          <ClientPortal
            data={data}
            busy={busy}
            onEditing={onEditing}
            onReload={onReload}
          />
        </Suspense>
      )}
      {viewer ? (
        <ClientOverview engagement={e} role={role} onView={onNavigate} />
      ) : (
        <>
          <EngagementOverview
            data={data}
            onWork={onWork}
            engagement={e}
            role={role}
            userId={data.identity.id}
            onPaper={onPaper}
            onNavigate={onNavigate}
            onGate={onGate}
            onRequests={onRequests}
            busy={busy}
            onAdvance={onAdvance}
          />
          <Suspense fallback={<p className="subtle">Loading coverage…</p>}>
            <CoverageSummary
              tenantId={data.tenantId}
              engagementId={e.id}
              version={e.version}
              onOpen={() => onNavigate("Regulatory mapping")}
            />
          </Suspense>
        </>
      )}
    </>
  );
}
