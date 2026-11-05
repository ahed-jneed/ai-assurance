// Contracts shared by the workspace shell, its hooks, views, modals and the
// record sheet.
import type { Engagement } from "@/lib/domain";
import type { WorkspaceData } from "../workspace-types";

/** Outcome of a guarded workspace change (see navigation-guards.ts). */
export type NavigationResult =
  "busy" | "editor_open" | "needs_confirmation" | "opened";
export type NavigateOptions = {
  search?: string;
  filter?: string;
  facet?: string;
};
export type Navigate = (
  label: string,
  options?: NavigateOptions,
  afterOpen?: () => void,
) => NavigationResult;
export type WorkspaceLoad = (
  tenantId?: string,
  engagementId?: string,
) => Promise<WorkspaceData | null>;
/** Runs an engagement command through POST /api/workspace. */
export type WorkspaceAct = (
  op: string,
  values: Record<string, unknown>,
  override?: Engagement,
) => Promise<{
  engagement: Engagement;
  details?: Record<string, string>;
}>;
/** Runs a practice-management command through POST /api/management. */
export type WorkspaceManage = (
  op: string,
  values: Record<string, unknown>,
) => Promise<{
  error?: string;
  details: Record<string, string>;
}>;
export type OpenModal = (
  name: string,
  defaults?: Record<string, string>,
  flags?: Record<string, boolean>,
) => void;
/** Opens a record in the record sheet. */
export type ViewDetail = (title: string, value: unknown) => void;
