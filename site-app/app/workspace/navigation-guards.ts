// What may stop the workspace from changing view or record, and the single
// function (guarded) every workspace change goes through.
import { useEffect } from "react";
import { toast } from "sonner";
import type { NavigationResult } from "./types";

export type NavigationGuardState = {
  busy: boolean;
  loading: boolean;
  bootstrapping: boolean;
  /** The open form dialog, "" when none. */
  modal: string;
  isModalSubmitting: () => boolean;
  /** A panel or dialog reports an unfinished editor (its onEditing prop). */
  editorOpen: boolean;
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
    if (state.editorOpen) {
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
