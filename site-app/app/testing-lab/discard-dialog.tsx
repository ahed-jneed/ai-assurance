"use client";
// Confirms discarding a changed model registration or evaluation setup.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { LabSetup } from "./use-lab-setup";

export function DiscardDialog({ setup }: { setup: LabSetup }) {
  const { discard, setDiscard } = setup;
  return (
    <Dialog
      open={!!discard}
      onOpenChange={(v) => {
        if (!v) setDiscard(null);
      }}
    >
      {!!discard && (
        <DialogContent className="audit-dialog">
          <DialogHeader>
            <DialogTitle>Discard this setup?</DialogTitle>
            <DialogDescription>
              Unsaved fields will be lost. Registered cards and saved protocols
              remain in the workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="ml-footer">
            <Button variant="outline" onClick={() => setDiscard(null)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                if (discard === "registration") setup.setRegister(null);
                else setup.setWizard(false);
                setDiscard(null);
              }}
            >
              Discard setup
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
