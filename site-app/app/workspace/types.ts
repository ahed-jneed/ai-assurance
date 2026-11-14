// Contracts shared by the workspace shell, its hooks, views, modals and the
// record sheet.
import type { Engagement } from "@/lib/domain/types";
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
/**
 * How a command reports its failure. By default a failed command shows one
 * toast; `quiet` leaves the error to the caller, which shows it in its own
 * form or dialog.
 */
export type CommandOptions = { quiet?: boolean };
/** Runs an engagement command through POST /api/workspace. */
export type WorkspaceAct = (
  op: string,
  values: Record<string, unknown>,
  override?: Engagement,
  options?: CommandOptions,
) => Promise<{
  engagement: Engagement;
  details?: Record<string, string>;
}>;
/** Runs a practice-management command through POST /api/management. */
export type WorkspaceManage = (
  op: string,
  values: Record<string, unknown>,
  options?: CommandOptions,
) => Promise<{
  details: Record<string, string>;
}>;
export type OpenModal = (
  name: string,
  defaults?: Record<string, string>,
  flags?: Record<string, boolean>,
) => void;
/** Opens a record in the record sheet. */
export type ViewDetail = (title: string, value: unknown) => void;
