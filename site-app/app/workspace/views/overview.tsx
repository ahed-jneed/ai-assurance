"use client";
import { Suspense } from "react";
import { Progress } from "@/components/ui/progress";
import type { AuditGate, Engagement, Paper, Role } from "@/lib/domain";
import type { PaperTarget } from "@/lib/paper-workflow";
import type { WorkItem } from "@/lib/work-items";
import { EngagementOverview } from "../../engagement-overview";
import type { WorkspaceData } from "../../workspace-types";
import { articleCoverage } from "../coverage";
import { ClientPortal, panelFallback } from "../panels";
import type { Navigate } from "../types";
import { ClientOverview } from "./client-overview";

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
  onEditing: (editing: boolean) => void;
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
      {viewer && role === "Client Contributor" && (
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
        <ClientOverview engagement={e} onView={onNavigate} />
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
          <details className="engagement-details">
            <summary>Article coverage</summary>
            {articleCoverage(e).map((c) => (
              <button
                className="control-row"
                key={c.article}
                onClick={() => {
                  onNavigate("Working papers", {
                    search: c.papers[0]?.templateId ?? "",
                    filter: "all",
                    facet: "all",
                  });
                }}
              >
                <span className="article">{c.article}</span>
                <div>
                  <b>{c.title}</b>
                  <Progress
                    value={c.coverage}
                    aria-label={c.title + " signed coverage"}
                  />
                </div>
                <span className="badge neutral">
                  {c.signed} / {c.papers.length}
                </span>
              </button>
            ))}
          </details>
        </>
      )}
    </>
  );
}
