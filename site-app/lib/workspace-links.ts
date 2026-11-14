import {
  navigationRoutes,
  permittedNavigationRoutes,
  type NavigationRoute,
} from "./navigation-preferences";
import type { Role } from "./domain/types";
import { isClientRole } from "./permissions";
export type WorkspaceLink = {
  tenantId: string;
  engagementId: string;
  module: string;
  kind: string;
  recordId: string;
  section: string;
};
/**
 * The workspace location a URL names. A link that names a practice without a
 * view (`?practice=<id>`) opens that practice at the Overview (#225);
 * useWorkspaceBootstrap opens the Engagements directory instead when the
 * practice has no engagement to show.
 */
export function readWorkspaceLink(search: string): WorkspaceLink | null {
  const q = new URLSearchParams(search),
    view = q.get("view") ?? (q.get("practice") ? "Overview" : null);
  if (!view) return null;
  if (!navigationRoutes.includes(view as NavigationRoute)) return null;
  const value = {
    tenantId: q.get("practice") ?? "",
    engagementId: q.get("engagement") ?? "",
    module: view,
    kind: q.get("kind") ?? "",
    recordId: q.get("record") ?? "",
    section: q.get("section") ?? "",
  };
  if (
    Object.values(value).some((v) => v.length > 300) ||
    ![
      "",
      "paper",
      "procedure",
      "evidence",
      "request",
      "finding",
      "report",
      "model",
      "run",
    ].includes(value.kind)
  )
    return null;
  return value;
}
/**
 * A practice link without a view (readWorkspaceLink) opens the Overview, or
 * the Engagements directory when no engagement opened.
 */
export function practiceLanding(
  link: WorkspaceLink,
  search: string,
  hasEngagement: boolean,
): WorkspaceLink {
  return !hasEngagement && !new URLSearchParams(search).has("view")
    ? { ...link, module: "Engagements" }
    : link;
}
export function authorizedLink(
  link: WorkspaceLink,
  role: Role,
  hasEngagement: boolean,
  practiceAdmin = false,
) {
  return (
    permittedNavigationRoutes(role, hasEngagement, practiceAdmin).includes(
      link.module as NavigationRoute,
    ) &&
    (!isClientRole(role) ||
      !["paper", "procedure", "model", "run"].includes(link.kind))
  );
}
export function linkQuery(link: WorkspaceLink) {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        practice: link.tenantId,
        engagement: link.engagementId,
        view: link.module,
        kind: link.kind,
        record: link.recordId,
        section: link.section,
      }).filter(([, v]) => v),
    ),
  ).toString();
}
