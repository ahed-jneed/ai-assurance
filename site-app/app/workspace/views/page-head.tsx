"use client";
// Heading of an engagement view: title, link and saved-view utilities, view
// actions, the overview context strip and the way back to a procedure.
import {
  ChevronRight,
  FileText,
  Link2,
  Plus,
  Settings2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { classify, type Engagement } from "@/lib/domain";
import { SavedViews } from "../../business-workspace";
import { navigation } from "../modules";
import { Badge } from "../workspace-ui";

export type SavedView = {
  module: string;
  search: string;
  filter: string;
  facet: string;
  sort: string;
};

export function PageHead({
  view,
  engagement: e,
  tenantId,
  viewer,
  lead,
  writer,
  busy,
  savedView,
  onSavedView,
  onCopyLink,
  onSettings,
  onNavigate,
  action,
  procedureContext,
  onClearProcedure,
}: {
  view: string;
  engagement: Engagement;
  tenantId: string;
  viewer: boolean;
  lead: boolean;
  writer: boolean;
  busy: boolean;
  savedView: SavedView;
  onSavedView: (view: SavedView) => void;
  onCopyLink: () => void;
  onSettings: () => void;
  onNavigate: (view: string) => void;
  /** The view's create action, shown to writers. */
  action?: { label: string; onClick: () => void };
  procedureContext: string | undefined;
  onClearProcedure: () => void;
}) {
  const PageIcon =
    navigation.find(([label]) => label === view)?.[1] ?? FileText;
  return (
    <>
      <div className="page-head">
        <div className="page-heading">
          <PageIcon size={22} />
          <h1>
            {view === "Overview"
              ? e.title
              : view === "Methodology"
                ? "Templates & history"
                : view}
          </h1>
        </div>
        <div className="row-actions page-head-actions">
          {!viewer && (
            <div className="page-utilities">
              <Button
                variant="ghost"
                size="icon"
                title="Copy page link"
                aria-label="Copy page link"
                onClick={onCopyLink}
              >
                <Link2 size={16} aria-hidden="true" />
              </Button>
              <SavedViews
                compact
                tenantId={tenantId}
                current={savedView}
                onOpen={onSavedView}
              />
            </div>
          )}
          {view === "Overview" && !viewer && (
            <>
              {lead && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={onSettings}
                  aria-label="Engagement settings"
                >
                  <Settings2 size={16} />
                </Button>
              )}
              <Button onClick={() => onNavigate("Audit program")}>
                {e.workflow ? "Open audit program" : "Set up audit program"}
                <ChevronRight size={15} />
              </Button>
            </>
          )}
          {action && writer && (
            <Button disabled={busy} onClick={action.onClick}>
              <Plus size={16} />
              {action.label}
            </Button>
          )}
        </div>
      </div>
      {view === "Overview" && (
        <div className="context-strip">
          <Badge value={classify(e.classification)} />
          <span>{e.stage}</span>
          {e.dueDate && <span>Due {e.dueDate}</span>}
        </div>
      )}
      {procedureContext &&
        !viewer &&
        view !== "Audit program" &&
        e.workflow?.procedures.some((p) => p.id === procedureContext) && (
          <div className="procedure-return">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("Audit program")}
            >
              <ChevronRight size={14} />
              Return to{" "}
              {
                e.workflow.procedures.find((p) => p.id === procedureContext)
                  ?.templateId
              }{" "}
              ·{" "}
              {
                e.workflow.procedures.find((p) => p.id === procedureContext)
                  ?.title
              }
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear procedure context"
              onClick={onClearProcedure}
            >
              <XCircle size={14} />
            </Button>
          </div>
        )}
    </>
  );
}
