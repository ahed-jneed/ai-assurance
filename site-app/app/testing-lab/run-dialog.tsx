"use client";
// The Evaluation results dialog for one run, with the commands its state
// allows (retry, start, cancel).
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Engagement, Paper } from "@/lib/domain";
import { RunDetails } from "../record-details";
import type { LabAct } from "./drafts";
import type { LabSetup } from "./use-lab-setup";

export function RunDialog({
  engagement: e,
  writer,
  busy,
  resolve,
  act,
  onView,
  onPaper,
  setup,
}: {
  engagement: Engagement;
  writer: boolean;
  busy: boolean;
  resolve: (id: string) => string;
  act: LabAct;
  onView: (view: string) => void;
  onPaper: (p: Paper) => void;
  setup: LabSetup;
}) {
  const { selectedRun, setSelectedRun, shownRun } = setup;
  return (
    <Dialog
      open={!!selectedRun}
      onOpenChange={(v) => {
        if (!v) setSelectedRun(null);
      }}
    >
      {selectedRun && shownRun && (
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>Evaluation results</DialogTitle>
            <DialogDescription>
              {selectedRun.manifest?.model.name ?? resolve(selectedRun.modelId)}
              {selectedRun.manifest
                ? " · Version " + selectedRun.manifest.model.version
                : ""}
            </DialogDescription>
          </DialogHeader>
          {writer && ["failed", "cancelled"].includes(shownRun.state) && (
            <div className="row-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act("retryRun", { runId: shownRun.id })
                    .then(() => {
                      setSelectedRun(null);
                      onView("runs");
                    })
                    .catch(() => {})
                }
              >
                Queue retry with verified inputs
              </Button>
              <span className="subtle">
                Creates a new run; the previous result stays preserved.
              </span>
            </div>
          )}
          {writer && shownRun.state === "queued" && (
            <div className="row-actions">
              <Button
                disabled={busy}
                onClick={() =>
                  void act("executeRun", { runId: shownRun.id }).catch(() => {})
                }
              >
                <Play size={14} />
                Start evaluation
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act("cancelRun", { runId: shownRun.id }).catch(() => {})
                }
              >
                Cancel run
              </Button>
              <span className="subtle">
                Queued with frozen inputs.
                {shownRun.procedureBinding &&
                  " Start or cancel it before queueing another evaluation of the same procedure."}
              </span>
            </div>
          )}
          {shownRun.retryOf && (
            <p className="subtle">Retry of {shownRun.retryOf}</p>
          )}
          <RunDetails
            run={shownRun}
            engagement={e}
            resolve={resolve}
            onPaper={(p) => {
              setSelectedRun(null);
              onPaper(p);
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
