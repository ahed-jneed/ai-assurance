"use client";
// The form dialog every workspace form opens in (see modals/), with its
// unsaved-entry tracking, error display and discard confirmation.
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { Engagement, Role } from "@/lib/domain";
import type { WorkspaceData } from "../workspace-types";
import { modalDefinition } from "./modals";
import type {
  ModalFieldsProps,
  ModalFollowUps,
  ModalSubmitContext,
} from "./modals/types";
import type { WorkspaceAct, WorkspaceLoad, WorkspaceManage } from "./types";
import { getForm, type ModalState } from "./use-modal-state";

export function ModalHost({
  state,
  data,
  engagement,
  role,
  lead,
  busy,
  setBusy,
  setError,
  act,
  manage,
  load,
  followUps,
}: {
  state: ModalState;
  data: WorkspaceData | null;
  engagement: Engagement | null | undefined;
  role: Role;
  lead: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  act: WorkspaceAct;
  manage: WorkspaceManage;
  load: WorkspaceLoad;
  followUps: ModalFollowUps;
}) {
  const {
    modal,
    choices,
    checks,
    finding,
    choice,
    check,
    modalError,
    modalDirty,
    discardModal,
    setDiscardModal,
    attachForm,
    attachError,
    fieldsChanged,
    discard,
  } = state;
  const definition = modalDefinition(modal),
    Fields = definition?.Fields;
  const fields: ModalFieldsProps = {
    kind: modal,
    choices,
    checks,
    choice,
    check,
    data,
    engagement,
    finding,
    role,
    lead,
  };
  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget,
      values = getForm(form);
    state.setModalError("");
    state.setSubmitting(true);
    try {
      const ctx: ModalSubmitContext = {
        kind: modal,
        form,
        values,
        choices,
        checks,
        finding,
        data,
        engagement,
        act,
        manage,
        load,
        setBusy,
        followUps,
      };
      // Checks run synchronously, so their message renders in this event.
      definition?.validate?.(ctx);
      const saving = definition?.submit?.(ctx);
      if ((saving instanceof Promise ? await saving : saving) === "keep-open")
        return;
      state.setModal("");
    } catch (err) {
      setBusy(false);
      const message = err instanceof Error ? err.message : "Could not save";
      state.showError(message);
      if (definition?.reportsToWorkspace) {
        setError(message);
        toast.error(message);
      }
    } finally {
      state.setSubmitting(false);
    }
  };
  const close = () => state.close(busy);
  return (
    <>
      <Dialog
        open={!!modal}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        {!!modal && (
          <DialogContent className="audit-dialog">
            <DialogHeader>
              <DialogTitle>{definition?.title}</DialogTitle>
              <DialogDescription className="sr-only">
                Complete the fields below.
              </DialogDescription>
            </DialogHeader>
            <form
              key={modal}
              ref={attachForm}
              onSubmit={submit}
              onChange={fieldsChanged}
              className="standard-form"
            >
              <fieldset disabled={busy} className="form-grid">
                {Fields && <Fields {...fields} />}
                {modalError && (
                  <p
                    ref={attachError}
                    tabIndex={-1}
                    className="form-error"
                    role="alert"
                  >
                    {modalError}
                  </p>
                )}
                <div className="form-footer">
                  <span className={modalDirty ? "unsaved" : "subtle"}>
                    {modalDirty ? "Unsaved changes" : ""}
                  </span>
                  <div className="row-actions">
                    <Button
                      type="submit"
                      disabled={busy || !!definition?.blocked?.(fields)}
                    >
                      {busy
                        ? "Saving…"
                        : (definition?.submitLabel ?? "Save changes")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={close}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </fieldset>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <AlertDialog open={discardModal} onOpenChange={setDiscardModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this form?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved entries will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={discard}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
