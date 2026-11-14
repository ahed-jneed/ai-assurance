// What may stop the workspace from changing view or record, and the single
// function (guarded) every workspace change goes through.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { NavigationResult } from "./types";

/**
 * Panels and dialogs that report an unfinished editor through their
 * `onEditing`/`onEditorOpen` prop. While any of them is editing, workspace
 * changes are refused (not offered for discard), search is disabled, the
 * record sheet stays open and leaving the page asks for confirmation.
 */
export const editingSources = [
  "audit-program",
  "client-portal",
  "request-access",
  "assurance-workbench",
  "testing-lab",
  // The Testing lab's dataset card form, apart from the lab's own dialogs.
  "dataset-registry",
  // The Testing lab's form recording a client's special-category basis.
  "special-category-basis",
  // The Testing lab's LL144 bias audit form (#30).
  "ll144-audit",
  "member-onboarding",
  "finding-assurance",
  "report-release",
] as const;
export type EditingSource = (typeof editingSources)[number];
export type EditingReporter = (editing: boolean) => void;

/** The set of open editors after `source` reports `editing`. */
export function reportEditing(
  open: readonly EditingSource[],
  source: EditingSource,
  editing: boolean,
): readonly EditingSource[] {
  return open.includes(source) === editing
    ? open
    : editing
      ? [...open, source]
      : open.filter((s) => s !== source);
}

/**
 * Registry of open editors. Each source reports through its own stable
 * callback, so a panel that closes its editor (or unmounts) clears only its
 * own entry; a single shared flag let the last reporter win.
 */
export function useEditingRegistry() {
  const [open, setOpen] = useState<readonly EditingSource[]>([]);
  // The open editors as last reported, ahead of the render that shows them:
  // a panel that finishes its action and then opens a record in the same
  // effect is not refused by the render before its report (#202).
  const reported = useRef<readonly EditingSource[]>([]);
  const reporters = useMemo(
    () =>
      Object.fromEntries(
        editingSources.map((source) => [
          source,
          (editing: boolean) => {
            reported.current = reportEditing(reported.current, source, editing);
            setOpen((current) => reportEditing(current, source, editing));
          },
        ]),
      ) as Record<EditingSource, EditingReporter>,
    [],
  );
  const clear = useCallback(() => {
    reported.current = [];
    setOpen((current) => (current.length ? [] : current));
  }, []);
  const isEditorOpen = useCallback(() => reported.current.length > 0, []);
  return { editorOpen: open.length > 0, isEditorOpen, reporters, clear };
}

export type NavigationGuardState = {
  busy: boolean;
  loading: boolean;
  bootstrapping: boolean;
  /** The open form dialog, "" when none. */
  modal: string;
  isModalSubmitting: () => boolean;
  /** A panel or dialog reports an unfinished editor (its onEditing prop). */
  editorOpen: boolean;
  /**
   * The same as last reported, when the guard runs; it wins over
   * `editorOpen`, which is the value of the render that built the guard.
   */
  isEditorOpen?: () => boolean;
  view: string;
  /** Unsaved paper edits or comments, which may be discarded. */
  isDirty: () => boolean;
  confirmDiscard: (next: () => void) => void;
};

/**
 * Builds the guard for one render. `guarded(next)` runs `next` when nothing
 * blocks a workspace change, asks to discard unsaved paper edits first, or
 * refuses while the workspace is busy or an editor or form is open.
 */
export function navigationGuard(state: NavigationGuardState) {
  return function guarded(next: () => void): NavigationResult {
    if (state.busy || state.loading || state.bootstrapping) return "busy";
    if (state.modal && !state.isModalSubmitting()) {
      toast.info("Finish or cancel this form before changing workspace.");
      return "editor_open";
    }
    if (state.isEditorOpen ? state.isEditorOpen() : state.editorOpen) {
      toast.info(
        state.view === "Assurance workbench"
          ? "Finish the pending workbench action or close your unsaved review before changing workspace."
          : "Finish or cancel the model/evaluation setup before changing workspace.",
      );
      return "editor_open";
    }
    if (state.isDirty()) {
      state.confirmDiscard(next);
      return "needs_confirmation";
    }
    next();
    return "opened";
  };
}
export type Guarded = ReturnType<typeof navigationGuard>;

/** Asks for confirmation before the page unloads while anything is unsaved. */
export function useLeaveGuard(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [unsaved]);
}
