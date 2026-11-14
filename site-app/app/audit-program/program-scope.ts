// What every view of the audit program reads: the engagement with its
// adopted workflow, the signed-in member and the form openers.
import type { ReactNode } from "react";
import type { Engagement, Role } from "@/lib/domain";
import type { PaperSuggestion } from "@/lib/domain/art50-papers";
import type { Procedure, Workflow } from "@/lib/workflow-types";
import type { WorkspaceData } from "../workspace-types";
import type { ProgramForms } from "./program-forms";
import type { WorkflowAct } from "./workflow-dialog";

export type ProgramScope = {
  data: WorkspaceData;
  e: Engagement;
  w: Workflow;
  uid: string;
  role: Role;
  busy: boolean;
  act: WorkflowAct;
  // Coarse flags for the program's sections; decisions check their own op.
  writer: boolean;
  lead: boolean;
  reviewer: boolean;
  /** A member's display name, or why there is none. */
  name: (id: string) => string;
  forms: ProgramForms;
  /** The revision warnings of the records `show` accepts. */
  warningCards: (show: (id: string) => boolean) => ReactNode;
  /** The classification's Art 50 applicability suggestion for a procedure. */
  art50Suggestion: (p: Procedure) => PaperSuggestion | null;
  catalogItem: (
    templateId: string,
  ) => NonNullable<WorkspaceData["catalog"]>["items"][number] | undefined;
};
