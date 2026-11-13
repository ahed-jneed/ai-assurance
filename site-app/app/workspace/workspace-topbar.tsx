"use client";
// Breadcrumbs, search and the current access role above the open view.
import { ChevronRight, LockKeyhole, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Role } from "@/lib/domain";
import type { WorkspaceData } from "../workspace-types";
import { isManagementView } from "./modules";

export function WorkspaceTopbar({
  data,
  view,
  clientId,
  role,
  searchDisabled,
  onSearch,
  onNavigate,
  onClient,
}: {
  data: WorkspaceData | null;
  view: string;
  /** The client selected in the practice-management views. */
  clientId: string | null;
  role: Role;
  searchDisabled: boolean;
  onSearch: () => void;
  onNavigate: (view: string) => void;
  onClient: (clientId: string) => void;
}) {
  const e = data?.engagement,
    management = isManagementView(view);
  const selectedClient =
    view === "Users & access"
      ? undefined
      : data?.clients.find(
          (c) => c.id === (management ? clientId : e?.clientId),
        );
  return (
    <header className="topbar">
      <div className="workspace-breadcrumbs">
        <SidebarTrigger />
        {view === "Users & access" ? (
          <span>Members & access</span>
        ) : (
          <>
            <button className="crumb" onClick={() => onNavigate("Clients")}>
              Clients
            </button>
            {selectedClient && (
              <>
                <ChevronRight size={13} />
                <button
                  className="crumb"
                  onClick={() => onClient(selectedClient.id)}
                >
                  {selectedClient.name}
                </button>
              </>
            )}
            {!management && e && (
              <>
                <ChevronRight size={13} />
                <button
                  className="crumb engagement-crumb"
                  onClick={() => onNavigate("Overview")}
                >
                  {e.title}
                </button>
                {view !== "Overview" && (
                  <>
                    <ChevronRight size={13} />
                    <span>
                      {view === "Methodology" ? "Templates & history" : view}
                    </span>
                  </>
                )}
              </>
            )}
            {management && view === "Engagements" && (
              <>
                <ChevronRight size={13} />
                <span>Engagements</span>
              </>
            )}
          </>
        )}
      </div>
      <div className="topbar-tools">
        <Button
          className="topbar-search"
          variant="ghost"
          size="sm"
          disabled={searchDisabled}
          aria-label="Search workspace"
          onClick={onSearch}
        >
          <Search size={15} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </Button>
        <span className="topbar-access">
          <LockKeyhole size={13} aria-hidden="true" />
          {role}
        </span>
      </div>
    </header>
  );
}
