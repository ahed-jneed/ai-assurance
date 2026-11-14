"use client";
// The client portal's header (#36, F-72): Client Viewers and Contributors
// get their own shell instead of the practice sidebar. It names the audit
// practice and the client, offers the destinations the person may open in
// client words (a Client Contributor has no Findings, #182), and never shows
// practice navigation (Clients, Engagements, Members & access, Switch
// practice), search or auditor shortcuts.
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Database,
  FileCheck2,
  LayoutDashboard,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  clientPortalRoutes,
  clientPortalRoutesFor,
  type NavigationRoute,
} from "@/lib/navigation-preferences";
import { canSee } from "@/lib/permissions";
import type { WorkspaceData } from "../workspace-types";

const icons: Record<(typeof clientPortalRoutes)[number][0], LucideIcon> = {
  Overview: LayoutDashboard,
  "Evidence vault": Database,
  Findings: AlertTriangle,
  "Reports & sign-off": FileCheck2,
};

/** How the portal names the signed-in person's access. */
export function clientAccessCopy(role: string) {
  return canSee(role, "clientPortal")
    ? "Can answer evidence requests"
    : "Read-only access";
}

export function ClientPortalHeader({
  data,
  view,
  navigationDisabled,
  onNavigate,
  onSwitch,
  account,
}: {
  data: WorkspaceData;
  view: string;
  navigationDisabled: boolean;
  onNavigate: (view: NavigationRoute) => void;
  onSwitch: () => void;
  /** The account menu (app/account-menu.tsx). */
  account?: ReactNode;
}) {
  const e = data.engagement;
  const practice =
    data.memberships.find((m) => m.tenant_id === data.tenantId)?.name ??
    "your auditor";
  const client = data.clients.find((c) => c.id === e?.clientId)?.name;
  // Only engagements the client may open are listed; a choice needs two.
  const switchable = data.engagements.length > 1;
  const allowed = clientPortalRoutesFor(data.identity.role);
  const routes = clientPortalRoutes.filter(([route]) =>
    allowed.includes(route),
  );
  return (
    <header className="client-portal-header">
      <div className="client-portal-bar">
        <div className="client-portal-brand">
          <span className="client-portal-symbol" aria-hidden="true">
            <ShieldCheck size={18} />
          </span>
          <span className="client-portal-brand-copy">
            <b>{client ? client + " client portal" : "Client portal"}</b>{" "}
            <small>Audit by {practice}</small>
          </span>
        </div>
        <div className="client-portal-account">
          {switchable && e && (
            <button
              type="button"
              className="client-portal-switch"
              disabled={navigationDisabled}
              aria-haspopup="dialog"
              onClick={onSwitch}
            >
              <span>{e.title}</span>{" "}
              <span className="sr-only">, switch engagement</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          )}
          <span className="client-portal-identity">
            <b>{data.identity.name}</b>{" "}
            <small>{clientAccessCopy(data.identity.role)}</small>
          </span>
          {account}
        </div>
      </div>
      {e && (
        <nav
          className="client-portal-nav"
          aria-label="Client portal navigation"
        >
          <ul>
            {routes.map(([route, label]) => {
              const Icon = icons[route];
              return (
                <li key={route}>
                  <button
                    type="button"
                    disabled={navigationDisabled}
                    aria-current={view === route ? "page" : undefined}
                    onClick={() => onNavigate(route)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
