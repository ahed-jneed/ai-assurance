import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Engagement, Paper } from "@/lib/domain";
import { readableResults } from "@/lib/presentation";

/** A copy of a saved paper for editing, with readable result text. */
export function editableDraft(paper: Paper) {
  const draft = structuredClone(paper);
  draft.body.results = readableResults(draft.body.results ?? "");
  return draft;
}
const paperFingerprint = (p: Paper) =>
  JSON.stringify({
    body: { ...p.body, results: readableResults(p.body.results ?? "") },
    required: p.required,
    evidenceIds: [...p.evidenceIds].sort(),
  });

/**
 * The open working paper: its unsaved draft, the saved revision the draft is
 * compared with, conflict detection when a newer revision arrives, and the
 * discard confirmation that guards leaving unsaved edits or comments.
 */
export function usePaperEditor(engagement: Engagement | null | undefined) {
  const [paperId, setPaperId] = useState<string | null>(null),
    [paperDraft, setPaperDraft] = useState<Paper | null>(null);
  const [hasPendingComment, setHasPendingComment] = useState(false),
    [commentReset, setCommentReset] = useState(0);
  const [discardPaper, setDiscardPaper] = useState(false),
    [paperConflict, setPaperConflict] = useState(false);
  // The saved revision the open draft is compared with, and the selected
  // paper it was last advanced to.
  const [savedPaper, setSavedPaper] = useState<Paper | undefined>(undefined),
    [seenPaper, setSeenPaper] = useState<Paper | undefined>(undefined);
  const pendingNavigation = useRef<(() => void) | null>(null),
    draftRef = useRef<Paper | null>(null),
    navigationDirtyRef = useRef(false);
  const selectedPaper = engagement?.papers.find((p) => p.id === paperId);
  const paperBaseline =
    savedPaper?.id === paperDraft?.id ? savedPaper : selectedPaper;
  const paperDirty =
    !!paperBaseline &&
    !!paperDraft &&
    paperFingerprint(paperBaseline) !== paperFingerprint(paperDraft);
  const navigationDirty = paperDirty || hasPendingComment;
  // A newer copy of the open paper (a refresh or another user's save)
  // becomes the baseline. A clean draft follows it; a dirty draft is kept and
  // flagged as a conflict when the revision moved.
  if (selectedPaper !== seenPaper) {
    setSeenPaper(selectedPaper);
    if (selectedPaper) {
      setSavedPaper(selectedPaper);
      if (savedPaper?.id === selectedPaper.id && paperDirty) {
        if (savedPaper.revision !== selectedPaper.revision)
          setPaperConflict(true);
      } else {
        setPaperDraft(editableDraft(selectedPaper));
        setPaperConflict(false);
      }
    }
  }
  // Latest values for acceptSavedRevision() and the navigation guards, which
  // read them outside render.
  useLayoutEffect(() => {
    draftRef.current = paperDraft;
    navigationDirtyRef.current = navigationDirty;
  });
  /** Rebases the open draft on a revision returned by an editPaper save. */
  const acceptSavedRevision = useCallback((saved: Paper) => {
    if (draftRef.current?.id !== saved.id) return;
    setSavedPaper(saved);
    setPaperDraft(editableDraft(saved));
    setPaperConflict(false);
  }, []);
  function showPaper(paper: Paper, draft: Paper) {
    setSavedPaper(paper);
    setPaperId(paper.id);
    setPaperDraft(draft);
    setPaperConflict(false);
  }
  function clearPaper() {
    setPaperId(null);
    setPaperDraft(null);
  }
  function forgetSavedPaper() {
    setSavedPaper(undefined);
  }
  /** Whether leaving now would lose unsaved paper edits or comments. */
  const isNavigationDirty = () => navigationDirtyRef.current;
  /** Asks to discard unsaved edits; `next` runs if the user agrees. */
  function confirmDiscard(next: () => void) {
    pendingNavigation.current = next;
    setDiscardPaper(true);
  }
  function keepEditing() {
    pendingNavigation.current = null;
  }
  function discardAndContinue() {
    navigationDirtyRef.current = false;
    setHasPendingComment(false);
    setCommentReset((v) => v + 1);
    pendingNavigation.current?.();
    pendingNavigation.current = null;
    setDiscardPaper(false);
  }
  /** Drops local edits and reloads the newer saved revision. */
  function loadSavedRevision() {
    setPaperDraft(editableDraft(selectedPaper!));
    setPaperConflict(false);
  }
  return {
    paperId,
    paperDraft,
    setPaperDraft,
    selectedPaper,
    paperDirty,
    navigationDirty,
    paperConflict,
    setPaperConflict,
    hasPendingComment,
    setHasPendingComment,
    commentReset,
    discardPaper,
    setDiscardPaper,
    acceptSavedRevision,
    showPaper,
    clearPaper,
    forgetSavedPaper,
    isNavigationDirty,
    confirmDiscard,
    keepEditing,
    discardAndContinue,
    loadSavedRevision,
  };
}
export type PaperEditorState = ReturnType<typeof usePaperEditor>;
