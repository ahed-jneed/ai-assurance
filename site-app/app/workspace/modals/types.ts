import type { ReactNode } from "react";
import type { Engagement, Finding, Paper, Role } from "@/lib/domain";
import type { WorkspaceData } from "../../workspace-types";
import type { WorkspaceAct, WorkspaceLoad, WorkspaceManage } from "../types";

/** What a form's fields render with. */
export type ModalFieldsProps = {
  /** The open form, e.g. "request" or "requestEdit" for a shared form. */
  kind: string;
  choices: Record<string, string>;
  checks: Record<string, boolean>;
  choice: (key: string, value: string) => void;
  check: (key: string, value: boolean) => void;
  data: WorkspaceData | null;
  engagement: Engagement | null | undefined;
  finding: Finding | null;
  role: Role;
  lead: boolean;
};

/** Workspace changes a form makes once it has saved. */
export type ModalFollowUps = {
  /** Opens a newly created paper in a reset Working papers register. */
  showCreatedPaper: (paper: Paper) => void;
  /** Opens `draft` (an unsaved edit of `paper`) at its evidence section; false when navigation was refused. */
  openPaperWithEvidence: (paper: Paper, draft: Paper) => boolean;
  showClient: (clientId: string) => void;
  showEngagementOverview: () => void;
};

/** What a form submits with: the form, its values and the workspace. */
export type ModalSubmitContext = Omit<
  ModalFieldsProps,
  "choice" | "check" | "role" | "lead"
> & {
  form: HTMLFormElement;
  /** The form's named fields. */
  values: Record<string, string>;
  act: WorkspaceAct;
  manage: WorkspaceManage;
  load: WorkspaceLoad;
  setBusy: (busy: boolean) => void;
  followUps: ModalFollowUps;
};

export type ModalDefinition = {
  title: string;
  submitLabel: string;
  Fields?: (props: ModalFieldsProps) => ReactNode;
  /** Keeps the submit button disabled. */
  blocked?: (props: ModalFieldsProps) => boolean;
  /** Synchronous checks before saving; throw an Error with the message. */
  validate?: (ctx: ModalSubmitContext) => void;
  /** Saves the form; "keep-open" leaves the dialog open without an error. */
  submit?: (ctx: ModalSubmitContext) => Promise<unknown> | "keep-open" | void;
  /** Also reports a failure in the workspace error banner and a toast. */
  reportsToWorkspace?: boolean;
};
