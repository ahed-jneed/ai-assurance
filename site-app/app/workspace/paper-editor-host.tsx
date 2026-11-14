"use client";
// The working-paper editor with its revision-conflict and discard dialogs.
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
import type { Engagement, Paper, Role } from "@/lib/domain/types";
import type { PaperTarget } from "@/lib/paper-workflow";
import { art50Suggestions } from "../audit-program/art50-suggestion";
import { PaperEditor } from "../paper-editor";
import type { WorkspaceData } from "../workspace-types";
import type { ViewDetail, WorkspaceAct } from "./types";
import type { PaperEditorState } from "./use-paper-editor";
import { download } from "./workspace-ui";

export function PaperEditorHost({
  paper,
  sequence,
  engagement,
  data,
  role,
  busy,
  error,
  paperTarget,
  setPaperTarget,
  act,
  resolve,
  onOpenPaper,
  onOpenRecord,
  onVault,
  onRequest,
  onClose,
  onAction,
  onProcedure,
  onDetail,
  onReload,
}: {
  paper: PaperEditorState;
  /** The papers that previous/next step through. */
  sequence: Paper[];
  engagement: Engagement | null | undefined;
  data: WorkspaceData | null;
  role: Role;
  busy: boolean;
  error: string;
  paperTarget: PaperTarget | undefined;
  setPaperTarget: (target: PaperTarget) => void;
  act: WorkspaceAct;
  resolve: (id: string) => string;
  onOpenPaper: (paper: Paper) => void;
  /** Leaves the paper (through the guard) to show a record in the sheet. */
  onOpenRecord: ViewDetail;
  onVault: () => void;
  onRequest: (paper: Paper) => void;
  onClose: () => void;
  onAction: (op: string, values: Record<string, unknown>) => void;
  onProcedure: (id: string) => void;
  onDetail: ViewDetail;
  /** Reloads the open engagement after a stale save. */
  onReload: () => void;
}) {
  const { paperId, paperDraft, selectedPaper } = paper;
  const position = sequence.findIndex((p) => p.id === paperId);
  return (
    <>
      <PaperEditor
        onTargetChange={setPaperTarget}
        error={error}
        conflict={paper.saveConflict}
        onReload={onReload}
        onEvidence={(id) => {
          const artifact = engagement?.artifacts.find((a) => a.id === id);
          if (artifact) onOpenRecord(artifact.name, artifact);
        }}
        tenantId={data?.tenantId ?? ""}
        initialTarget={paperTarget}
        previous={sequence[position - 1]}
        next={position >= 0 ? sequence[position + 1] : undefined}
        position={
          position >= 0 ? position + 1 + " / " + sequence.length : undefined
        }
        onAdjacent={(p) => onOpenPaper(p)}
        onVault={onVault}
        onRequest={() => paperDraft && onRequest(paperDraft)}
        onRequestRecord={(r) => onOpenRecord(r.subject, r)}
        commentReset={paper.commentReset}
        draft={paperDraft}
        saved={selectedPaper}
        setDraft={paper.setPaperDraft}
        engagement={engagement}
        role={role}
        userId={data?.identity.id ?? ""}
        busy={busy}
        dirty={paper.paperDirty}
        onCommentDraftChange={paper.setHasPendingComment}
        onClose={onClose}
        onAction={onAction}
        onComment={(text) =>
          // The editor shows a failed comment beside it: its one error surface.
          act("comment", { paperId: paperId!, text }, undefined, {
            quiet: true,
          })
        }
        onResponse={(commentId, text) =>
          act(
            "respondComment",
            { paperId: paperId!, commentId, text },
            undefined,
            { quiet: true },
          )
        }
        onProcedure={onProcedure}
        onDetail={onDetail}
        onExport={() =>
          download(
            (selectedPaper?.templateId ?? "paper") +
              "-" +
              selectedPaper?.revision +
              ".json",
            selectedPaper,
          )
        }
        resolve={resolve}
        art50={
          paperDraft
            ? art50Suggestions(data, engagement)(paperDraft.templateId)
            : null
        }
      />
      {paper.paperConflict && (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>This paper has a newer revision</DialogTitle>
              <DialogDescription>
                Your local changes are preserved. Export them before reloading
                the saved revision.
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => download("unsaved-paper.json", paperDraft)}
            >
              Export local changes
            </Button>
            <Button onClick={paper.loadSavedRevision}>
              Load saved revision
            </Button>
          </DialogContent>
        </Dialog>
      )}
      <AlertDialog
        open={paper.discardPaper}
        onOpenChange={paper.setDiscardPaper}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {paper.hasPendingComment
                ? "Your unsent comments or responses will be discarded. Saved revisions and recorded comments remain available."
                : "Your unsaved document changes will be discarded. The saved revision remains available."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={paper.keepEditing}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={paper.discardAndContinue}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
